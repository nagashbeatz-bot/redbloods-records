/**
 * Pure logic for the "Steven work completed" flow — no "server-only"/Supabase/
 * push imports, so it is directly testable from a plain tsx script
 * (scripts/test-steven-completed.ts). lib/steven-completion.ts supplies the real
 * Supabase/push wiring behind the injectable deps below. Mirrors the pure/notify
 * split used by lib/steven-mix-reminder-pure.ts.
 *
 * WHAT HAPPENS, and only on a REAL transition of a Steven work into the
 * completed state (DB "אושר", shown as "הושלם"):
 *
 *   1. Is this the LAST OPEN Steven work on its project? Other Steven works on
 *      the same project_id that are neither "אושר" nor "בוטל" count as open. If
 *      one exists, the work simply completes: the project is NOT touched and
 *      Steven is NOT asked for final files yet (that would claim the whole
 *      project is done while another job of his is still running).
 *   2. Project sync (one-way, Steven → Projects, project_id only — never by
 *      name): projects.status → "הושלם" and end_date → today, exactly what the
 *      Projects PATCH route writes. A project that is already "הושלם", or that
 *      the owner stopped ("בוטל" / "בהשהייה"), is left untouched. A standalone
 *      work (no project_id) has no project to sync.
 *   3. THE FINAL-FILES REQUEST — one per "cycle", scoped to the PROJECT (or to the
 *      work itself when it has no project). It is a single settings row that is
 *      BOTH the INSERT-first claim and the marker Steven's WorkModal reads to show
 *      the "Upload Final Files" focus state. Whoever inserts it first sends the
 *      push (and owner confirmation); everyone else — a double click, a retry, or
 *      the OTHER of two works that finished at the same moment — loses the insert
 *      and does nothing. So exactly one request, one push, one confirmation.
 *      The row's value.at is the REQUEST TIME of the cycle. A final file satisfies the
 *      request only if it was uploaded AFTER that instant (computeFinalFilesFlags), so
 *      files from an earlier cycle — which stay untouched — never satisfy a new one.
 *   4. A cycle ends when a Steven work on that project becomes OPEN again (closed →
 *      open, e.g. הושלם → פעיל) or a new open Steven work is created on it. That
 *      releases the row, so the next "last open work completed" is a NEW cycle and
 *      may request final files again. The row is deliberately NOT a permanent flag.
 *
 * WHY "nobody is the last work" cannot happen: each request commits its own status
 * write BEFORE it lists its siblings, and the list reads committed rows. For two
 * works A and B to both see the other still open, it would take
 * commitA < listA < commitB < listB < commitA — a contradiction. The only race is
 * the opposite one (both commit, then both list, both think they are last), and
 * step 3 makes that harmless.
 *
 * A project-sync failure never rolls the work back and never stops the request:
 * it is reported (returned to the caller, logged, and pushed to the owner).
 */
import { COMPLETED_STATUS, isClosedStatus } from "@/lib/steven-mix-reminder-pure";
import { classifyPushResult } from "@/lib/shalev-weekly-pure";

/** projects.status value for "הושלם" — the SAME string the UI shows. */
export const PROJECT_COMPLETED_STATUS = "הושלם";
/** Owner-stopped project statuses a supplier's work must never overwrite. */
export const PROJECT_PROTECTED_STATUSES: readonly string[] = ["בוטל", "בהשהייה"];

// ── Keys (settings table) ─────────────────────────────────────────────────────
// Two prefixes on purpose: "…requested:" (work-scoped, standalone works only) is NOT
// a prefix of "…requested_project:", so neither parser ever matches the other's keys.
export const FINAL_FILES_REQUESTED_PREFIX = "steven_final_files_requested:";
export const FINAL_FILES_REQUESTED_PROJECT_PREFIX = "steven_final_files_requested_project:";

export const finalFilesRequestedKey = (workId: string) => `${FINAL_FILES_REQUESTED_PREFIX}${workId}`;
export const finalFilesRequestedProjectKey = (projectId: string) => `${FINAL_FILES_REQUESTED_PROJECT_PREFIX}${projectId}`;

/** The ONE row a work's final-files request lives in: the project's when it is
 *  project-linked (the Final Files folder is per project), else its own. */
export const finalFilesRequestKeyFor = (w: { id: string; projectId: string | null }) =>
  w.projectId ? finalFilesRequestedProjectKey(w.projectId) : finalFilesRequestedKey(w.id);

export function workIdFromRequestedKey(key: string): string | null {
  return key.startsWith(FINAL_FILES_REQUESTED_PREFIX) ? key.slice(FINAL_FILES_REQUESTED_PREFIX.length) : null;
}
export function projectIdFromRequestedKey(key: string): string | null {
  return key.startsWith(FINAL_FILES_REQUESTED_PROJECT_PREFIX) ? key.slice(FINAL_FILES_REQUESTED_PROJECT_PREFIX.length) : null;
}

// ── Decisions ─────────────────────────────────────────────────────────────────

/**
 * A REAL transition into completed: the pre-update row was not completed, this
 * request itself carried the completed status, and the row now is completed.
 * All three are required so that a re-save, a payment edit, a refresh, or an
 * unrelated concurrent PATCH that merely READ the completed row back never
 * counts (the concurrent-PATCH case is additionally covered by the request row).
 */
export function isCompletionTransition(
  prevStatus: string | null | undefined,
  requestedStatus: string | undefined,
  nextStatus: string | null | undefined,
): boolean {
  return requestedStatus === COMPLETED_STATUS && prevStatus !== COMPLETED_STATUS && nextStatus === COMPLETED_STATUS;
}

/** A REAL reopen: this request carried a status, and the work went from a closed
 *  status ("אושר"/"בוטל") to an open one. Ends the project's current cycle. */
export function isBecameOpenTransition(
  prevStatus: string | null | undefined,
  requestedStatus: string | undefined,
  nextStatus: string | null | undefined,
): boolean {
  return requestedStatus !== undefined && isClosedStatus(prevStatus) && !isClosedStatus(nextStatus);
}

/** True when any OTHER Steven work of the same project is still open (not
 *  completed, not cancelled). A NULL status is open, like the store's default. */
export function hasOtherOpenWork(others: { status: string | null }[]): boolean {
  return others.some((w) => !isClosedStatus(w.status));
}

export type ProjectSyncDecision = "sync" | "already_completed" | "protected";

/** What may be done to a project whose CURRENT status is `projectStatus`. */
export function decideProjectSync(projectStatus: string | null | undefined): ProjectSyncDecision {
  if (projectStatus === PROJECT_COMPLETED_STATUS) return "already_completed";
  if (projectStatus != null && PROJECT_PROTECTED_STATUSES.includes(projectStatus)) return "protected";
  return "sync";
}

/** The request time of a request row: the ISO timestamp the claim wrote into value.at
 *  (settings has no created_at, and updated_at is not something this can rely on).
 *  null when missing/unreadable. */
export function parseRequestAt(value: unknown): number | null {
  const at = value && typeof value === "object" ? (value as { at?: unknown }).at : null;
  const t = typeof at === "string" ? Date.parse(at) : NaN;
  return Number.isFinite(t) ? t : null;
}

/**
 * Per-work flags for a list of works — PROJECT-AWARE and CYCLE-AWARE.
 *
 *  finalFilesRequested   — does the work's request row exist? Project-linked works read
 *                          the PROJECT's row; standalone works read their own. A
 *                          work-scoped row on a project-linked work is ignored.
 *  hasCurrentFinalFiles  — was a final file uploaded AFTER the current request was made
 *                          (final_files.created_at > the request row's value.at)?
 *                          Final files from before the request — an earlier cycle, or
 *                          anything uploaded before Steven was asked — never satisfy it,
 *                          but are also never touched (not deleted, not flagged). It is
 *                          project-aware: final_files carries project_id AND work_id and
 *                          the Final Files folder is per project, so a file uploaded
 *                          through Work A satisfies Work B on the same project (a
 *                          standalone work only counts its own work_id). Only meaningful
 *                          where a request exists; false everywhere else. An unreadable
 *                          request timestamp FAILS CLOSED (counts as satisfied → no
 *                          Blur), because a wrong Blur is worse than a missing one.
 *
 * `finalRows` may mix rows from a by-work query and a by-project query (each row just
 * needs created_at plus whichever of work_id / project_id it has); `requestRows` are the
 * raw settings rows of both key families. Strict `>`: a file stamped at exactly the
 * request instant does not satisfy it.
 *
 * CLOCKS, and why there is deliberately NO tolerance. The request time (value.at) comes
 * from the app server's clock (Railway); final_files.created_at is the DB's (Supabase).
 * Measured on production settings rows that the app writes together with a DB-stamped
 * updated_at: the DB stamp trails the app stamp by ~67–200 ms on plain writes, never
 * negative → the skew between the two clocks is well under 0.1 s. A genuine post-request
 * upload can only be inserted after Steven has received the push, opened the job, picked
 * files and the bytes reached Dropbox (finalizeFinalFile inserts the row last) — many
 * seconds — so a strict `>` cannot mistake it for older. A tolerance would only add
 * risk: it would let a file from the PREVIOUS cycle, uploaded moments before a quick
 * reopen → re-complete, count as new.
 */
export function computeFinalFilesFlags(
  works: { id: string; projectId: string | null }[],
  src: {
    finalRows: { work_id?: string | null; project_id?: string | null; created_at: string | null }[];
    requestRows: { key: string; value: unknown }[];
  },
): { hasCurrentFinalFiles: Set<string>; finalFilesRequested: Set<string> } {
  const requestAtByWork = new Map<string, number | null>();
  const requestAtByProject = new Map<string, number | null>();
  for (const r of src.requestRows) {
    const wid = workIdFromRequestedKey(r.key);
    if (wid) { requestAtByWork.set(wid, parseRequestAt(r.value)); continue; }
    const pid = projectIdFromRequestedKey(r.key);
    if (pid) requestAtByProject.set(pid, parseRequestAt(r.value));
  }

  const latestByWork = new Map<string, number>();
  const latestByProject = new Map<string, number>();
  const bump = (m: Map<string, number>, id: string, t: number) => { if (t > (m.get(id) ?? -Infinity)) m.set(id, t); };
  for (const f of src.finalRows) {
    const t = f.created_at ? Date.parse(f.created_at) : NaN;
    if (!Number.isFinite(t)) continue;
    if (f.work_id) bump(latestByWork, f.work_id, t);
    if (f.project_id) bump(latestByProject, f.project_id, t);
  }

  const hasCurrentFinalFiles = new Set<string>();
  const finalFilesRequested = new Set<string>();
  for (const w of works) {
    const scoped = w.projectId ? requestAtByProject : requestAtByWork;
    const scopeId = w.projectId ?? w.id;
    if (!scoped.has(scopeId)) continue;                        // no request → nothing to satisfy
    finalFilesRequested.add(w.id);
    const requestAt = scoped.get(scopeId) ?? null;
    if (requestAt === null) { hasCurrentFinalFiles.add(w.id); continue; }   // fail closed
    const own = latestByWork.get(w.id);
    const proj = w.projectId ? latestByProject.get(w.projectId) : undefined;
    const latest = Math.max(own ?? -Infinity, proj ?? -Infinity);
    if (latest > requestAt) hasCurrentFinalFiles.add(w.id);
  }
  return { hasCurrentFinalFiles, finalFilesRequested };
}

// ── Texts ─────────────────────────────────────────────────────────────────────

/** Shape-compatible with lib/push.ts PushPayload (kept local: this file must not
 *  import push). Steven's payload never carries projectId/entity fields — a
 *  supplier's bell row must not open the owner's ProjectDrawer. */
export interface CompletionPush {
  title: string; body: string; url?: string; tag?: string; eventId?: string;
  entityType?: string; entityId?: string; actorName?: string;
}

const ownerMeta = (workId: string) =>
  ({ url: `/team/steven?work=${workId}`, entityType: "sound_engineer_work", entityId: workId, actorName: "סטיבן" });

export function buildStevenPush(workId: string, name: string, fromUpdatedAt: string): CompletionPush {
  const n = (name ?? "").trim();
  return {
    title: "Project completed",
    body:  n ? `${n} — please upload the final files.` : "Please upload the final files.",
    url:   `/team/steven?work=${workId}`,
    tag:   `steven-completed-${workId}`,
    // Makes the notifications-history row idempotent; the SEND itself is guarded
    // by the INSERT-first request row (the SW's renotify:true means a repeated tag
    // would ALERT again, so the tag is not a dedupe).
    eventId: `steven-completed:${workId}:${fromUpdatedAt}`,
  };
}

/** Deliberately "נשלחה" — web-push success only proves the push service accepted
 *  it, never that Steven saw or opened it. Never "Steven קיבל". */
export function buildOwnerConfirmPush(workId: string, name: string): CompletionPush {
  const n = (name ?? "").trim();
  return {
    title: "התראה נשלחה ל-Steven",
    body:  n
      ? `נשלחה ל-Steven התראה שהפרויקט "${n}" הושלם ושיש להעלות קבצים סופיים.`
      : "נשלחה ל-Steven התראה שהפרויקט הושלם ושיש להעלות קבצים סופיים.",
    tag: `steven-completed-owner-${workId}`,
    ...ownerMeta(workId),
  };
}

export type PushFailReason = "no_subscription" | "send_failed";

export function buildOwnerPushFailedPush(workId: string, name: string, reason: PushFailReason): CompletionPush {
  const n = (name ?? "").trim();
  const base = n ? `לא ניתן היה לשלוח ל-Steven התראה עבור "${n}".` : "לא ניתן היה לשלוח ל-Steven התראה.";
  const why  = reason === "no_subscription" ? " אין ל-Steven מכשיר רשום להתראות." : " השליחה נכשלה.";
  return { title: "התראה ל-Steven לא נשלחה", body: base + why, tag: `steven-completed-owner-${workId}`, ...ownerMeta(workId) };
}

export function buildOwnerProjectSyncFailedPush(workId: string, name: string): CompletionPush {
  const n = (name ?? "").trim();
  return {
    title: "סנכרון הפרויקט נכשל",
    body:  `${n ? `"${n}": ` : ""}העבודה של Steven סומנה כהושלמה, אך לא ניתן היה לעדכן את סטטוס הפרויקט.`,
    tag:   `steven-project-sync-failed-${workId}`,
    ...ownerMeta(workId),
  };
}

// ── Orchestration (injectable deps → testable without a DB / real push) ────────

export type ProjectSyncOutcome =
  | "updated"            // projects.status → "הושלם", end_date → today, actually written
  | "already_completed"  // project was already "הושלם": no-op (end_date untouched)
  | "protected"          // project is "בוטל"/"בהשהייה": left as the owner set it
  | "no_project"         // standalone work: nothing to sync, never guessed by name
  | "other_open_work"    // another Steven work on this project is still open
  | "failed";            // sync (or the check that gates it) errored — reported, not rolled back

export type CompletionPushOutcome =
  | "not_attempted"      // not the last open work / nothing to ask for
  | "disabled"           // localhost / dev: pushAllowed() is false
  | "skipped_duplicate"  // request row already exists: this cycle's request was already made
  | "claim_error"        // could not write the request row → nothing sent (no dedupe guarantee)
  | "sent"               // Steven's push accepted → owner confirmation attempted
  | "no_subscription"    // Steven has no registered device → owner failure notice
  | "send_failed";       // send threw / every device rejected → owner failure notice

export interface StevenCompletionOutcome {
  /** false when another open Steven work exists (or that could not be determined). */
  lastOpenWork: boolean;
  projectSync: ProjectSyncOutcome;
  /** true when THIS call created the cycle's final-files request row (the winner). */
  finalFilesRequested: boolean;
  push: CompletionPushOutcome;
}

export interface StevenCompletionWork {
  id: string;
  /** null = standalone work. */
  projectId: string | null;
  /** The name Steven SEES (workTitle || projectName). */
  displayName: string;
  /** The work row's updated_at from BEFORE this transition's write (push eventId only). */
  fromUpdatedAt: string;
}

export interface FinalFilesRequestValue { workId: string; at: string; fromUpdatedAt: string }

export interface StevenReleaseDeps {
  /** Deletes the request row (no-op when absent). Throws on error. */
  releaseFinalFilesRequest(key: string): Promise<void>;
  log(msg: string): void;
  logError(msg: string, err?: unknown): void;
}

export interface StevenCompletionDeps extends StevenReleaseDeps {
  /** Epoch ms "now" — the clock that stamps the request (value.at). Injectable for tests. */
  now(): number;
  /** Other Steven works on the project (excludes `excludeWorkId`). Throws on error. */
  listOtherStevenWorks(projectId: string, excludeWorkId: string): Promise<{ status: string | null }[]>;
  /** Reads, decides (decideProjectSync) and conditionally writes status+end_date. Throws on error. */
  syncProjectCompleted(projectId: string): Promise<"updated" | "already_completed" | "protected">;
  /** INSERT-first: exactly one caller per key wins while the row exists. The row is the marker. */
  claimFinalFilesRequest(key: string, value: FinalFilesRequestValue): Promise<"won" | "lost" | "error">;
  pushAllowed(): boolean;
  sendToSteven(push: CompletionPush): Promise<{ status: string }[]>;
  sendToOwner(push: CompletionPush): Promise<void>;
}

export async function processStevenCompletion(
  work: StevenCompletionWork,
  deps: StevenCompletionDeps,
): Promise<StevenCompletionOutcome> {
  const out: StevenCompletionOutcome = {
    lastOpenWork: true, projectSync: "no_project", finalFilesRequested: false, push: "not_attempted",
  };
  const name = work.displayName;

  async function ownerSafe(push: CompletionPush) {
    if (!deps.pushAllowed()) return;
    try { await deps.sendToOwner(push); } catch (e) { deps.logError(`owner notice failed for work ${work.id}`, e); }
  }
  async function reportSyncFailure(what: string, err: unknown) {
    out.projectSync = "failed";
    deps.logError(`[steven-completion] PROJECT SYNC FAILED (${what}) for work ${work.id} project ${work.projectId} — work stays completed, project NOT updated`, err);
    await ownerSafe(buildOwnerProjectSyncFailedPush(work.id, name));
  }

  // 1 + 2. Project-linked: is this the last open Steven work, and if so sync the project.
  if (work.projectId) {
    let others: { status: string | null }[];
    try {
      others = await deps.listOtherStevenWorks(work.projectId, work.id);
    } catch (e) {
      // Cannot tell whether this is the last open work → do NOT sync and do NOT ask
      // for final files (either could be wrong). Report it; the owner can re-toggle.
      out.lastOpenWork = false;
      await reportSyncFailure("could not list the project's other Steven works", e);
      return out;
    }
    if (hasOtherOpenWork(others)) {
      out.lastOpenWork = false;
      out.projectSync = "other_open_work";
      deps.log(`[steven-completion] work ${work.id}: another Steven work on project ${work.projectId} is still open — project untouched, no final-files request`);
      return out;
    }
    try {
      out.projectSync = await deps.syncProjectCompleted(work.projectId);
    } catch (e) {
      await reportSyncFailure("projects update", e);
      // Deliberately continues: the work IS done, so Steven is still asked for final files.
    }
  }

  // 3. The cycle's final-files request: INSERT-first on ONE row per project (or per
  //    standalone work). Written whether or not push is allowed — it is state (the
  //    Blur marker), not a notification. Losing the insert means this cycle's
  //    request was already made (double click / retry / the other of two works that
  //    finished together) → do nothing more.
  const key = finalFilesRequestKeyFor(work);
  let claim: "won" | "lost" | "error";
  try {
    // `at` IS the request time of this cycle: a final file only satisfies the request if
    // it was uploaded after it (see computeFinalFilesFlags).
    claim = await deps.claimFinalFilesRequest(key, { workId: work.id, at: new Date(deps.now()).toISOString(), fromUpdatedAt: work.fromUpdatedAt });
  } catch (e) {
    deps.logError(`[steven-completion] final-files request claim threw for work ${work.id}`, e);
    claim = "error";
  }
  if (claim === "lost") {
    out.push = "skipped_duplicate";
    deps.log(`[steven-completion] work ${work.id}: this cycle's final-files request (${key}) already exists — no second request/push`);
    return out;
  }
  if (claim === "error") {
    out.push = "claim_error";
    deps.logError(`[steven-completion] could not record the final-files request (${key}) for work ${work.id} — nothing sent`);
    await ownerSafe(buildOwnerPushFailedPush(work.id, name, "send_failed"));
    return out;
  }
  out.finalFilesRequested = true;

  // 4. Push. Localhost/dev never sends.
  if (!deps.pushAllowed()) { out.push = "disabled"; return out; }

  let results: { status: string }[] | null = null;
  try {
    results = await deps.sendToSteven(buildStevenPush(work.id, name, work.fromUpdatedAt));
  } catch (e) {
    deps.logError(`[steven-completion] push to Steven threw for work ${work.id}`, e);
  }
  const cls = results === null ? "send_failed" : classifyPushResult(results);
  if (cls === "sent") {
    out.push = "sent";
    await ownerSafe(buildOwnerConfirmPush(work.id, name));
  } else {
    out.push = cls;
    deps.logError(`[steven-completion] push to Steven not delivered (${cls}) for work ${work.id}`);
    await ownerSafe(buildOwnerPushFailedPush(work.id, name, cls));
  }
  return out;
}

/**
 * Ends the current cycle for a Steven work's project (or the work itself when it
 * has none): deletes the request row so the NEXT "last open work completed" is a
 * new cycle. Called when a Steven work goes closed → open, or a new open Steven
 * work is created. Best-effort — a failure is logged loudly (a stale row would
 * silently swallow the next request) and never thrown.
 */
export async function releaseStevenFinalFilesRequest(
  work: { id: string; projectId: string | null },
  deps: StevenReleaseDeps,
): Promise<void> {
  const key = finalFilesRequestKeyFor(work);
  try {
    await deps.releaseFinalFilesRequest(key);
    deps.log(`[steven-completion] cycle ended for ${key} (work ${work.id} is open again / a new open work exists)`);
  } catch (e) {
    deps.logError(`[steven-completion] COULD NOT RELEASE ${key} — the next final-files request for it would be swallowed until it is deleted`, e);
  }
}
