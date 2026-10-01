/**
 * Sound Engineer store — server-only.
 * CRUD for sound_engineer_work. The linked Finance expense has ONE writer: lib/writes/mix.ts reconcileEngineerExpense
 * (integrity fix A2, 2026-09-27 — it replaced the retired price sync and the retired Steven ₪ payment sync). Rules live
 * in lib/mix-payment-pure.ts: paid = agreed > 0 AND paid ≥ agreed AND a payment date; a "שולם" expense is never
 * overwritten or deleted; the work currency is kept, no silent 3.25 conversion.
 */
import "server-only";
import { supabase } from "@/lib/supabase";
import type {
  SoundEngineerWork,
  SoundEngineerStatus,
  SoundEngineerWorkType,
} from "@/lib/types";
import { isClosedStatus } from "@/lib/steven-mix-reminder-pure";
import { isEngineerWorkPaid, shouldPushPaymentConfirmed, unpayBlocked, UNPAY_BLOCKED_HE } from "@/lib/mix-payment-pure";
import {
  isCompletionTransition,
  isBecameOpenTransition,
  computeFinalFilesFlags,
  FINAL_FILES_REQUESTED_PREFIX,
  FINAL_FILES_REQUESTED_PROJECT_PREFIX,
  type StevenCompletionOutcome,
} from "@/lib/steven-completed-pure";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Thrown when a request would un-pay a work whose linked expense is already "שולם" (paid money is protected). */
export class PaidExpenseProtectedError extends Error {
  readonly code = "PAID_EXPENSE_PROTECTED";
  constructor() { super(UNPAY_BLOCKED_HE); }
}

/** Runs THE one Finance writer (dynamic import — lib/writes/mix imports this store lazily too). */
async function reconcile(workId: string, opts: { reason: string; force?: boolean; skipPriceSync?: boolean; payment?: { amountPaid: number; paymentDate: string | null } }) {
  const { reconcileEngineerExpense } = await import("@/lib/writes/mix");
  return reconcileEngineerExpense(workId, opts);
}

/**
 * The name Steven actually SEES for a work — mirrors the client mapRecord
 * (`workTitle || projectName`). Steven-facing work title wins over the original
 * project name; falls back to the project name, then "". Used for push text so
 * a notification never shows a different name than the page.
 */
export function stevenDisplayName(w: Pick<SoundEngineerWork, "workTitle" | "projectName">): string {
  return (w.workTitle ?? "").trim() || (w.projectName ?? "").trim();
}

/** Read-only upload hints for a batch of works — see buildUploadHints. */
type UploadHints = {
  lastUploadAt: Map<string, string>;
  hasMixVersion: Set<string>;
  /** workIds whose current final-files request has already been satisfied: a final file
   *  was uploaded AFTER the request time (project-aware, cycle-aware — see
   *  computeFinalFilesFlags). Only meaningful for works that have a request. */
  hasCurrentFinalFiles: Set<string>;
  /** workIds whose final-files request row exists (project-scoped for a project-linked
   *  work; written only when Steven's LAST open work completed — see steven-completion). */
  finalFilesRequested: Set<string>;
};

function mapRow(
  row: Record<string, unknown>,
  projectMap: Map<string, { name: string; artist: string; projectType: string }>,
  hints?: UploadHints
): SoundEngineerWork {
  const projectId = (row.project_id as string | null) ?? null;
  const workTitle = (row.work_title as string | null) ?? null;
  const proj      = projectId ? projectMap.get(projectId) : undefined;
  const agreed    = Number(row.agreed_price ?? 0);
  const paid      = Number(row.amount_paid  ?? 0);

  return {
    id:                   row.id                    as string,
    projectId,
    // Linked → project name; standalone → the free-text title.
    projectName:          projectId ? (proj?.name ?? "פרויקט לא ידוע") : (workTitle ?? "עבודה עצמאית"),
    workTitle,
    artist:               proj?.artist ?? "",
    // Canonical projects.project_type, joined — "" for a standalone work.
    projectType:          proj?.projectType ?? "",
    engineerName:         row.engineer_name         as string,
    workType:             (row.work_type            as SoundEngineerWorkType) ?? "מיקס",
    status:               (row.status               as SoundEngineerStatus)   ?? "לא נשלח",
    agreedPrice:          agreed,
    currency:             (row.currency             as string) ?? "$",
    amountPaid:           paid,
    balance:              Math.max(0, agreed - paid),
    sentDate:             (row.sent_date            as string | null) ?? null,
    internalDeadline:     (row.internal_deadline    as string | null) ?? null,
    filesLink:            (row.files_link           as string | null) ?? null,
    notes:                (row.notes                as string)        ?? "",
    linkedTransactionId:  (row.linked_transaction_id as string | null) ?? null,
    sortOrder:            row.sort_order != null ? Number(row.sort_order) : null,
    paymentDate:          (row.payment_date         as string | null) ?? null,
    createdAt:            (row.created_at           as string) ?? "",
    updatedAt:            (row.updated_at           as string) ?? "",
    lastUploadAt:         hints?.lastUploadAt.get(row.id as string) ?? null,
    hasMixVersion:        hints?.hasMixVersion.has(row.id as string) ?? false,
    hasCurrentFinalFiles: hints?.hasCurrentFinalFiles.has(row.id as string) ?? false,
    finalFilesRequested:  hints?.finalFilesRequested.has(row.id as string) ?? false,
  };
}

/**
 * Last real UPLOAD per work — max(mix_versions.created_at, final_files.created_at).
 * Read-only aggregate: two selects, no writes, no new column, no migration.
 *
 * Both tables are counted because both are genuine "the engineer uploaded a
 * file" events, even though they are deliberately separate stores (mix versions
 * vs. the Final Files delivery flow). mix_versions.created_at is already the
 * canonical "a new mix landed" signal elsewhere in the app — see
 * hasNewerVersion() in lib/steven-mix-reminder-pure.ts. updated_at is NOT used
 * on either side: it moves on status/label edits, which are not uploads.
 *
 * Rows are ordered created_at DESC so that if the client-library row cap ever
 * kicked in it would drop the OLDEST rows — the ones that can never be a max.
 *
 * Also returns `hasMixVersion` — the set of workIds with ≥1 mix_versions row
 * (final_files deliberately excluded). Same two selects, no extra query.
 *
 * And the two final-files hints (see computeFinalFilesFlags). `finalFilesRequested`
 * reads the request row (one per project, or per standalone work). `hasCurrentFinalFiles`
 * is true when a final file was uploaded AFTER that request's time (its value.at) —
 * final files from an earlier cycle stay untouched but never satisfy a new request.
 * It is PROJECT-aware too: final_files carries project_id AND work_id and the Final
 * Files folder is per project, so a file uploaded through one Steven work satisfies
 * every other work on that project (a standalone work counts only its own work_id).
 * Read-only, no schema change.
 */
async function buildUploadHints(works: { id: string; projectId: string | null }[]): Promise<UploadHints> {
  const workIds = works.map((w) => w.id);
  const projectIds = Array.from(new Set(works.map((w) => w.projectId).filter((p): p is string => !!p)));
  const map = new Map<string, string>();
  const hasMixVersion = new Set<string>();
  if (workIds.length === 0) {
    return { lastUploadAt: map, hasMixVersion, hasCurrentFinalFiles: new Set<string>(), finalFilesRequested: new Set<string>() };
  }

  const keep = (workId: string | null, createdAt: string | null) => {
    if (!workId || !createdAt) return;
    const cur = map.get(workId);
    if (!cur || Date.parse(createdAt) > Date.parse(cur)) map.set(workId, createdAt);
  };

  const [versions, finals, finalsByProject, requestedWork, requestedProject] = await Promise.all([
    supabase
      .from("mix_versions")
      .select("sound_engineer_work_id, created_at")
      .in("sound_engineer_work_id", workIds)
      .order("created_at", { ascending: false }),
    supabase
      .from("final_files")
      .select("work_id, created_at")
      .in("work_id", workIds)
      .order("created_at", { ascending: false }),
    // Project-level final files: every final_files row of the works' projects, whichever
    // work uploaded it. (Skipped when no work is project-linked.)
    projectIds.length > 0
      ? supabase.from("final_files").select("project_id, created_at").in("project_id", projectIds)
      : Promise.resolve({ data: [] as { project_id: string | null; created_at: string | null }[], error: null }),
    // The few final-files request rows (their value.at is the request time): project-scoped,
    // and work-scoped (standalone works).
    supabase.from("settings").select("key, value").like("key", `${FINAL_FILES_REQUESTED_PROJECT_PREFIX}%`),
    supabase.from("settings").select("key, value").like("key", `${FINAL_FILES_REQUESTED_PREFIX}%`),
  ]);

  // A failure here must never break the works list — it only means the extra
  // ordering hint is missing, so those works sort as "no uploads".
  (versions.data ?? []).forEach((r) => {
    const wid = (r as { sound_engineer_work_id: string | null }).sound_engineer_work_id;
    if (wid) hasMixVersion.add(wid);
    keep(wid, (r as { created_at: string | null }).created_at);
  });
  (finals.data ?? []).forEach((r) => {
    keep((r as { work_id: string | null }).work_id, (r as { created_at: string | null }).created_at);
  });

  const flags = computeFinalFilesFlags(works, {
    finalRows: [
      ...((finals.data ?? []) as { work_id: string | null; created_at: string | null }[]),
      ...((finalsByProject.data ?? []) as { project_id: string | null; created_at: string | null }[]),
    ],
    requestRows: [...(requestedWork.data ?? []), ...(requestedProject.data ?? [])] as { key: string; value: unknown }[],
  });
  // FAIL CLOSED. If we could not read final_files we cannot tell whether the request was
  // satisfied, so never ask (no work is offered the focus state); a failed request-row read
  // already leaves finalFilesRequested empty for the same reason.
  if (finals.error || finalsByProject.error) workIds.forEach((id) => flags.hasCurrentFinalFiles.add(id));
  return { lastUploadAt: map, hasMixVersion, hasCurrentFinalFiles: flags.hasCurrentFinalFiles, finalFilesRequested: flags.finalFilesRequested };
}

/**
 * project_id → { name, artist, projectType }. `project_type` is joined here and
 * ONLY here: Steven's page needs it for the "Project Type" column and for the
 * Riddim-mode decision, and this is the single place every work list resolves
 * project data, so both the owner route and the scoped Steven route get it from
 * one query. It is never copied onto sound_engineer_work.
 */
async function buildProjectMap(): Promise<Map<string, { name: string; artist: string; projectType: string }>> {
  const { data } = await supabase.from("projects").select("id, name, artist, project_type");
  const map = new Map<string, { name: string; artist: string; projectType: string }>();
  (data ?? []).forEach((p) =>
    map.set(p.id, { name: p.name, artist: p.artist, projectType: (p.project_type as string | null) ?? "" })
  );
  return map;
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Fetch the sound engineer record for a specific project (null = none). */
export async function getSoundEngineerWorkForProject(
  projectId: string
): Promise<SoundEngineerWork | null> {
  const [{ data, error }, projectMap] = await Promise.all([
    supabase
      .from("sound_engineer_work")
      .select("*")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    buildProjectMap(),
  ]);

  if (error) throw new Error(error.message);
  if (!data) return null;
  return mapRow(data as Record<string, unknown>, projectMap);
}

/** Fetch a single sound engineer work by id (null = not found). Used for
 *  ownership checks on the scoped supplier endpoints. */
export async function getSoundEngineerWork(id: string): Promise<SoundEngineerWork | null> {
  const [{ data, error }, projectMap] = await Promise.all([
    supabase.from("sound_engineer_work").select("*").eq("id", id).maybeSingle(),
    buildProjectMap(),
  ]);
  if (error) throw new Error(error.message);
  if (!data) return null;
  return mapRow(data as Record<string, unknown>, projectMap);
}

/** List all sound engineer work records (optionally filtered by engineer name). */
export async function listSoundEngineerWork(
  engineerName?: string
): Promise<SoundEngineerWork[]> {
  // Manual order first (sort_order ASC), then unordered rows by recency
  // (created_at DESC). nullsFirst:false pushes NULL sort_order to the end.
  let q = supabase
    .from("sound_engineer_work")
    .select("*")
    .order("sort_order", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false });
  if (engineerName) q = q.eq("engineer_name", engineerName);

  const [{ data, error }, projectMap] = await Promise.all([q, buildProjectMap()]);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Record<string, unknown>[];
  // lastUploadAt / hasMixVersion are read-only display/ordering hints (see
  // buildUploadHints); the DB order above is unchanged — the client decides.
  const hints = await buildUploadHints(rows.map((r) => ({ id: r.id as string, projectId: (r.project_id as string | null) ?? null })));
  return rows.map((r) => mapRow(r, projectMap, hints));
}

/**
 * Persist a manual list order: writes sort_order = index for each id in the given
 * order. Only the passed ids are touched (scoped to one engineer's list by the
 * caller). Never creates/deletes rows, never touches Finance.
 */
export async function reorderSoundEngineerWork(orderedIds: string[]): Promise<void> {
  const ids = orderedIds.filter((id) => typeof id === "string" && id);
  await Promise.all(
    ids.map((id, index) =>
      supabase.from("sound_engineer_work").update({ sort_order: index }).eq("id", id)
    )
  );
}

/** Get a list of all unique engineer names ever used. */
export async function listEngineerNames(): Promise<string[]> {
  const { data } = await supabase
    .from("sound_engineer_work")
    .select("engineer_name");
  const names = Array.from(new Set((data ?? []).map((r) => r.engineer_name as string)));
  return names.sort();
}

/**
 * Create a sound engineer work record — EITHER linked to an existing project
 * (projectId) OR standalone with a free-text title (workTitle, project_id=null).
 * Never creates a projects row. Finance sync happens ONLY for project-linked
 * works (a standalone work never touches Finance).
 */
export async function createSoundEngineerWork(
  projectId: string | null,
  fields: {
    engineerName:     string;
    workTitle?:       string | null;
    workType?:        SoundEngineerWorkType;
    status?:          SoundEngineerStatus;
    agreedPrice?:     number;
    currency?:        string;
    amountPaid?:      number;
    /** B5: a work created as paid carries its payment date (YYYY-MM-DD) — else the shared paid rule sees it unpaid. */
    paymentDate?:     string | null;
    sentDate?:        string | null;
    internalDeadline?: string | null;
    filesLink?:       string | null;
    notes?:           string;
    /** When true, do NOT create an expected expense row (PAYMENT_ONLY). (Used by the
     *  Steven send flow, which must not touch Finance.) Not persisted to DB. */
    skipFinanceSync?: boolean;
  }
): Promise<SoundEngineerWork> {
  const workTitle = (fields.workTitle ?? "").trim();
  // Must link to a project OR carry a standalone title (never both empty).
  if (!projectId && !workTitle) throw new Error("projectId או workTitle נדרש");

  // Project-linked works carry the project's artist, name and canonical type;
  // a standalone work has none of them.
  let artist = "", projectName = "", projectType = "";
  if (projectId) {
    const { data: proj } = await supabase
      .from("projects")
      .select("artist, name, project_type")
      .eq("id", projectId)
      .single();
    artist      = (proj?.artist as string) ?? "";
    projectName = (proj?.name as string) ?? "";
    projectType = (proj?.project_type as string | null) ?? "";
  }

  const agreedPrice = fields.agreedPrice ?? 0;
  const amountPaid  = fields.amountPaid  ?? 0;
  const currency    = fields.currency    ?? "$";
  const workType    = fields.workType    ?? "מיקס";

  // Build the insert; add work_title whenever a title was provided (linked OR
  // standalone) so a project-linked work can carry a Steven/Bill-facing name,
  // like the Victor flow. A plain linked insert with no title omits the column
  // entirely, staying valid even if the column migration hasn't run.
  const insertRow: Record<string, unknown> = {
    project_id:        projectId ?? null,
    engineer_name:     fields.engineerName,
    work_type:         workType,
    status:            fields.status          ?? "לא נשלח",
    agreed_price:      agreedPrice,
    currency,
    amount_paid:       amountPaid,
    // B5: only a paid amount carries a payment date (a date on an unpaid work is never stored)
    ...(amountPaid > 0 && fields.paymentDate ? { payment_date: fields.paymentDate } : {}),
    sent_date:         fields.sentDate        ?? null,
    internal_deadline: fields.internalDeadline ?? null,
    files_link:        fields.filesLink        ?? null,
    notes:             fields.notes            ?? "",
    linked_transaction_id: null,
  };
  if (workTitle) insertRow.work_title = workTitle;

  const { data, error } = await supabase
    .from("sound_engineer_work")
    .insert(insertRow)
    .select()
    .single();

  if (error) throw new Error(error.message);

  const row = data as Record<string, unknown>;

  // The linked expense through THE one writer. A new work carries no payment date, so it is never "paid" here: a
  // project-linked non-Steven work with a price gets its expected row (work currency); Steven / skipFinanceSync /
  // standalone works get none (the Steven send flow must not touch Finance).
  if (projectId && agreedPrice > 0) {
    const r = await reconcile(row.id as string, { reason: "work create", skipPriceSync: !!fields.skipFinanceSync });
    row.linked_transaction_id = r.txId;
  }

  const projectMap = projectId
    ? new Map([[projectId, { name: projectName, artist, projectType }]])
    : new Map<string, { name: string; artist: string; projectType: string }>();
  const created = mapRow(row, projectMap);

  // A new OPEN Steven work on a project means that project has open work again: whatever
  // final-files request its previous (finished) cycle left behind is over, so the next
  // completion is a new cycle. Best-effort, restricted to Steven, never throws.
  if (!isClosedStatus(row.status as string | null)) {
    try {
      const { releaseStevenFinalFilesRequestFor } = await import("@/lib/steven-completion");
      await releaseStevenFinalFilesRequestFor({ id: created.id, engineerName: created.engineerName, projectId: created.projectId });
    } catch (e) {
      console.error("[sound-engineer] steven request release (create) failed (non-fatal):", e);
    }
  }
  return created;
}

/** Update a sound engineer work record. Finance-relevant changes run THE one expense writer (reconcileEngineerExpense). */
export async function updateSoundEngineerWork(
  id: string,
  fields: Partial<{
    engineerName:     string;
    workType:         SoundEngineerWorkType;
    status:           SoundEngineerStatus;
    agreedPrice:      number;
    currency:         string;
    amountPaid:       number;
    sentDate:         string | null;
    internalDeadline: string | null;
    filesLink:        string | null;
    notes:            string;
    paymentDate:      string | null;   // YYYY-MM-DD when marked paid, or null to clear
    /** When true: NO expected (price) row — PAYMENT_ONLY (Steven flow). A paid work is still recorded by the one
     *  writer and a "שולם" row is never touched. Not persisted. */
    skipFinanceSync:  boolean;
  }>,
  hooks?: {
    /** Called (once) with the outcome of the Steven "work completed" flow, only when
     *  this call was a REAL transition of a Steven work into completed. Lets the
     *  route tell the owner's UI whether the linked project was synced or failed. */
    onStevenCompletion?: (outcome: StevenCompletionOutcome) => void;
  }
): Promise<SoundEngineerWork> {
  // Fetch current record first
  const { data: current, error: fetchErr } = await supabase
    .from("sound_engineer_work")
    .select("*")
    .eq("id", id)
    .single();
  if (fetchErr || !current) throw new Error(fetchErr?.message ?? "רשומה לא נמצאה");

  const cur = current as Record<string, unknown>;

  // Snapshot the pre-update "Paid" state so we can detect a real transition and
  // push "Payment confirmed" only once (never on re-save / refresh / page load).
  const wasPaid = isEngineerWorkPaid({ agreedPrice: Number(cur.agreed_price ?? 0), amountPaid: Number(cur.amount_paid ?? 0), paymentDate: (cur.payment_date as string | null) ?? null });

  // Un-pay guard (BEFORE any write): a request that touches the payment and leaves the work NOT paid is refused while
  // its linked expense is "שולם" — paid money is cancelled in Finance first, never deleted from a work screen.
  if (fields.amountPaid !== undefined || fields.paymentDate !== undefined) {
    const projectedPaid = isEngineerWorkPaid({
      agreedPrice: fields.agreedPrice ?? Number(cur.agreed_price ?? 0),
      amountPaid:  fields.amountPaid  ?? Number(cur.amount_paid ?? 0),
      paymentDate: fields.paymentDate !== undefined ? fields.paymentDate : ((cur.payment_date as string | null) ?? null),
    });
    const linkedId = (cur.linked_transaction_id as string | null) ?? null;
    let linkedStatus: string | null = null;
    if (linkedId && !projectedPaid) {
      const { data: t, error: tErr } = await supabase.from("transactions").select("payment_status").eq("id", linkedId).maybeSingle();
      if (tErr) throw new Error(tErr.message); // fail closed
      linkedStatus = (t?.payment_status as string | null) ?? null;
    }
    if (unpayBlocked({ touchesPayment: true, projectedPaid, linkedStatus })) throw new PaidExpenseProtectedError();
  }

  // The payment fields (amount paid / payment date) are NOT written here: they travel WITH the linked expense and the link in
  // ONE database transaction (reconcile → public.apply_engineer_payment), so a failure never leaves "work paid, no expense".
  const touchesPayment = fields.amountPaid !== undefined || fields.paymentDate !== undefined;
  const payment = touchesPayment
    ? { amountPaid: fields.amountPaid ?? Number(cur.amount_paid ?? 0), paymentDate: fields.paymentDate !== undefined ? fields.paymentDate : ((cur.payment_date as string | null) ?? null) }
    : undefined;
  const dbUpdate: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (fields.engineerName     !== undefined) dbUpdate.engineer_name      = fields.engineerName;
  if (fields.workType         !== undefined) dbUpdate.work_type          = fields.workType;
  if (fields.status           !== undefined) dbUpdate.status             = fields.status;
  if (fields.agreedPrice      !== undefined) dbUpdate.agreed_price       = fields.agreedPrice;
  if (fields.currency         !== undefined) dbUpdate.currency           = fields.currency;
  if (fields.sentDate         !== undefined) dbUpdate.sent_date          = fields.sentDate;
  if (fields.internalDeadline !== undefined) dbUpdate.internal_deadline  = fields.internalDeadline;
  if (fields.filesLink        !== undefined) dbUpdate.files_link         = fields.filesLink;
  if (fields.notes            !== undefined) dbUpdate.notes              = fields.notes;

  const { data: updated, error } = await supabase
    .from("sound_engineer_work")
    .update(dbUpdate)
    .eq("id", id)
    .select()
    .single();
  if (error) throw new Error(error.message);

  const row       = updated as Record<string, unknown>;

  // ── The linked Finance expense: THE one writer, server-side, in the same request ──
  // Runs when any finance-relevant field changed (price, currency, amount paid, payment date, engineer, type). One call
  // for the Steven page too — its separate payment-expense call is no longer needed. skipFinanceSync (Steven page /
  // Steven send flow) only means "no expected row" (PAYMENT_ONLY); a paid work is always recorded, and a "שולם" row is
  // never overwritten or deleted.
  const financeChanged =
    fields.agreedPrice  !== undefined ||
    fields.amountPaid   !== undefined ||
    fields.paymentDate  !== undefined ||
    fields.currency     !== undefined ||
    fields.engineerName !== undefined ||
    fields.workType     !== undefined;
  let payOutcome: Awaited<ReturnType<typeof reconcile>> | null = null;
  if (financeChanged) {
    const r = await reconcile(id, { reason: "work update", skipPriceSync: !!fields.skipFinanceSync, payment });
    row.linked_transaction_id = r.txId;
    payOutcome = r;
  }
  if (touchesPayment) {
    // the payment fields were written by the atomic function — read the row back so the result (and the push rule) see them
    const { data: fresh, error: freshErr } = await supabase.from("sound_engineer_work").select("*").eq("id", id).single();
    if (freshErr || !fresh) throw new Error(freshErr?.message ?? "רשומה לא נמצאה");
    Object.assign(row, fresh as Record<string, unknown>);
  }

  const projectMap = await buildProjectMap();
  const result = mapRow(row, projectMap);

  // ── "Payment confirmed" push (owner + Steven) on a REAL transition only ──
  // Fires only when the work goes from non-Paid → Paid (THE shared rule, lib/mix-payment-pure). Best-effort, never
  // throws, localhost-guarded, deduped in settings. No other path is touched.
  const nowPaid = isEngineerWorkPaid(result);
  // Owner decision 2026-10-01: a push only for a real unpaid → paid transition whose Finance write COMMITTED with no conflict
  // (never on PROTECTED_PAID / NONE / REFUSED, a rolled-back write — that throws before this line — or a retry on a paid work).
  if (shouldPushPaymentConfirmed({ wasPaid, nowPaid, outcomeKind: payOutcome?.committed ? payOutcome.kind : null, conflictHe: payOutcome?.conflictHe ?? null })) {
    try {
      const { notifyStevenPaymentPaid } = await import("@/lib/steven-payment-notify");
      await notifyStevenPaymentPaid({
        id:          result.id,
        displayName: stevenDisplayName(result), // Steven-facing name, not the raw project name
        currency:    result.currency,
        agreedPrice: result.agreedPrice,
        paymentDate: result.paymentDate,
      });
    } catch (e) {
      console.error("[sound-engineer] payment notify failed (non-fatal):", e);
    }
  }

  // ── Steven "work completed" (final-files request + push + a project SUGGESTION — never a project write) ─────
  // Fires ONLY on a real transition into completed ("אושר"): the pre-update row
  // was not completed, THIS request carried the completed status, and the row now
  // is completed. A re-save / payment edit / refresh never re-fires. All behaviour
  // (last-open-work check, project read → suggestion, marker, claim, push) lives in
  // lib/steven-completion.ts; it is restricted to engineer_name "Steven" and never
  // throws, so it can neither fail nor roll back this update.
  if (isCompletionTransition(cur.status as string | null, fields.status, row.status as string | null)) {
    try {
      const { runStevenWorkCompleted } = await import("@/lib/steven-completion");
      const outcome = await runStevenWorkCompleted({
        id:            result.id,
        engineerName:  result.engineerName,
        projectId:     result.projectId,
        displayName:   stevenDisplayName(result), // the name Steven sees
        fromUpdatedAt: String(cur.updated_at ?? "na"),
      });
      if (outcome) hooks?.onStevenCompletion?.(outcome);
    } catch (e) {
      console.error("[sound-engineer] steven completion flow failed (non-fatal):", e);
    }
    // Owner decision 2026-09-28: a completed work gets its expected Finance expense at the price set in advance (Steven:
    // EXPECTED_ON_COMPLETION; idempotent through linked_transaction_id — a repeated "הושלם" never adds a second row)
    try {
      const r = await reconcile(id, { reason: "work completed" });
      row.linked_transaction_id = r.txId;
    } catch (e) {
      console.error("[sound-engineer] completion expense failed (non-fatal, the next sync completes it):", e);
    }
  }

  // ── A Steven work is OPEN again (closed → open): the project's current final-files
  // request cycle is over. Releasing its request row is what lets the next "last open
  // work completed" be a NEW cycle (הושלם → פעיל → הושלם) instead of being swallowed as
  // a duplicate. Best-effort, restricted to Steven, never throws.
  if (isBecameOpenTransition(cur.status as string | null, fields.status, row.status as string | null)) {
    try {
      const { releaseStevenFinalFilesRequestFor } = await import("@/lib/steven-completion");
      await releaseStevenFinalFilesRequestFor({ id: result.id, engineerName: result.engineerName, projectId: result.projectId });
    } catch (e) {
      console.error("[sound-engineer] steven request release failed (non-fatal):", e);
    }
  }

  return result;
}

/**
 * Reconcile the ONE Finance expense linked to this work's payment (payment-expense route). Kept as the route's entry
 * point; it is THE one writer (lib/writes/mix reconcileEngineerExpense) — work currency, paid rows protected.
 */
export async function reconcileWorkPaymentExpense(workId: string) {
  return reconcile(workId, { reason: "payment-expense route" });
}

/** Delete a sound engineer work record. Does NOT delete the linked transaction. */
export async function deleteSoundEngineerWork(id: string): Promise<void> {
  const { error } = await supabase.from("sound_engineer_work").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/**
 * Explicit "sync" (the drawer button / Sunny force-sync) — THE one writer with force: refuses a standalone work, and a
 * paid ("שולם") linked row is never overwritten ("שורה ששולמה לא נדרסת").
 */
export async function forceSyncTransaction(id: string): Promise<{ txId: string | null; outcome: string; messageHe: string; conflictHe: string | null }> {
  const r = await reconcile(id, { reason: "force sync", force: true });
  return { txId: r.txId, outcome: r.kind, messageHe: r.messageHe, conflictHe: r.conflictHe };
}
