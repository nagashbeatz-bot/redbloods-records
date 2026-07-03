/**
 * Sound Engineer store — server-only.
 * CRUD for sound_engineer_work table + auto-sync with transactions.
 *
 * Transaction sync rules:
 *   amountPaid === 0                   → payment_status = "צפוי"
 *   0 < amountPaid < agreedPrice       → payment_status = "חלקי"
 *   amountPaid >= agreedPrice > 0      → payment_status = "שולם"
 *
 * When agreedPrice > 0:
 *   - First time: creates an expense transaction, saves ID in linked_transaction_id
 *   - Subsequent updates: PATCHes the existing transaction
 */
import "server-only";
import { supabase } from "@/lib/supabase";
import type {
  SoundEngineerWork,
  SoundEngineerStatus,
  SoundEngineerWorkType,
} from "@/lib/types";

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Maps (agreedPrice, amountPaid) → expense payment_status.
 * Uses "שולם" (not "התקבל") — "התקבל" is reserved for income from clients.
 * "לא שולם" = haven't paid yet (expense owed but not sent).
 */
function paymentStatusFromAmounts(agreed: number, paid: number): string {
  if (agreed <= 0) return "לא שולם";
  if (paid >= agreed) return "שולם";
  if (paid > 0)       return "חלקי";
  return "לא שולם";
}

function mapRow(
  row: Record<string, unknown>,
  projectMap: Map<string, { name: string; artist: string }>
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
    createdAt:            (row.created_at           as string) ?? "",
    updatedAt:            (row.updated_at           as string) ?? "",
  };
}

async function buildProjectMap(): Promise<Map<string, { name: string; artist: string }>> {
  const { data } = await supabase.from("projects").select("id, name, artist");
  const map = new Map<string, { name: string; artist: string }>();
  (data ?? []).forEach((p) => map.set(p.id, { name: p.name, artist: p.artist }));
  return map;
}

// ── Transaction sync ──────────────────────────────────────────────────────────

/**
 * Creates or updates the linked expense transaction for a sound engineer record.
 * Returns the transaction ID (new or existing).
 * No-ops if agreedPrice === 0.
 */
async function syncTransaction(work: {
  projectId: string;
  artist: string;
  engineerName: string;
  workType: string;
  agreedPrice: number;
  currency: string;
  amountPaid: number;
  linkedTransactionId: string | null;
}): Promise<string | null> {
  if (work.agreedPrice <= 0) return work.linkedTransactionId;

  const paymentStatus = paymentStatusFromAmounts(work.agreedPrice, work.amountPaid);

  const txData = {
    project_id:     work.projectId,
    type:           "expense",
    category:       "מיקס / מאסטר",
    description:    `${work.engineerName} — ${work.workType}`,
    artist:         work.artist,
    amount:         work.agreedPrice,
    currency:       work.currency,
    payment_status: paymentStatus,
    payment_method: "",
    receipt_ref:    "",
    notes:          work.amountPaid > 0
      ? `שולם ${work.currency}${work.amountPaid} מתוך ${work.currency}${work.agreedPrice}`
      : `ממתין לתשלום — ${work.currency}${work.agreedPrice}`,
    linked_session_id: "",
  };

  if (work.linkedTransactionId) {
    // Update existing
    await supabase
      .from("transactions")
      .update({ ...txData, date: null })
      .eq("id", work.linkedTransactionId);
    return work.linkedTransactionId;
  }

  // Create new
  const { data, error } = await supabase
    .from("transactions")
    .insert({ ...txData, date: null })
    .select("id")
    .single();

  if (error) throw new Error(error.message);
  return data?.id ?? null;
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

/** List all sound engineer work records (optionally filtered by engineer name). */
export async function listSoundEngineerWork(
  engineerName?: string
): Promise<SoundEngineerWork[]> {
  let q = supabase.from("sound_engineer_work").select("*").order("created_at", { ascending: false });
  if (engineerName) q = q.eq("engineer_name", engineerName);

  const [{ data, error }, projectMap] = await Promise.all([q, buildProjectMap()]);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => mapRow(r as Record<string, unknown>, projectMap));
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
    sentDate?:        string | null;
    internalDeadline?: string | null;
    filesLink?:       string | null;
    notes?:           string;
    /** When true, do NOT create the linked expense transaction. (Used by the
     *  Steven send flow, which must not touch Finance.) Not persisted to DB. */
    skipFinanceSync?: boolean;
  }
): Promise<SoundEngineerWork> {
  const workTitle = (fields.workTitle ?? "").trim();
  // Must link to a project OR carry a standalone title (never both empty).
  if (!projectId && !workTitle) throw new Error("projectId או workTitle נדרש");

  // Artist only exists for project-linked works.
  let artist = "";
  if (projectId) {
    const { data: proj } = await supabase
      .from("projects")
      .select("artist")
      .eq("id", projectId)
      .single();
    artist = (proj?.artist as string) ?? "";
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
  let linkedTransactionId: string | null = null;

  // Finance sync ONLY for project-linked works (standalone never touches Finance).
  if (projectId && !fields.skipFinanceSync && agreedPrice > 0) {
    linkedTransactionId = await syncTransaction({
      projectId,
      artist,
      engineerName: fields.engineerName,
      workType,
      agreedPrice,
      currency,
      amountPaid,
      linkedTransactionId: null,
    });

    if (linkedTransactionId) {
      await supabase
        .from("sound_engineer_work")
        .update({ linked_transaction_id: linkedTransactionId })
        .eq("id", row.id as string);
      row.linked_transaction_id = linkedTransactionId;
    }
  }

  const projectMap = projectId ? new Map([[projectId, { name: "", artist }]]) : new Map<string, { name: string; artist: string }>();
  return mapRow(row, projectMap);
}

/** Update a sound engineer work record. Syncs transaction if price fields changed. */
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
    /** When true, skip the linked-transaction sync entirely (Steven flow). Not persisted. */
    skipFinanceSync:  boolean;
  }>
): Promise<SoundEngineerWork> {
  // Fetch current record first
  const { data: current, error: fetchErr } = await supabase
    .from("sound_engineer_work")
    .select("*")
    .eq("id", id)
    .single();
  if (fetchErr || !current) throw new Error(fetchErr?.message ?? "רשומה לא נמצאה");

  const cur = current as Record<string, unknown>;

  const dbUpdate: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (fields.engineerName     !== undefined) dbUpdate.engineer_name      = fields.engineerName;
  if (fields.workType         !== undefined) dbUpdate.work_type          = fields.workType;
  if (fields.status           !== undefined) dbUpdate.status             = fields.status;
  if (fields.agreedPrice      !== undefined) dbUpdate.agreed_price       = fields.agreedPrice;
  if (fields.currency         !== undefined) dbUpdate.currency           = fields.currency;
  if (fields.amountPaid       !== undefined) dbUpdate.amount_paid        = fields.amountPaid;
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
  const agreed    = Number(row.agreed_price ?? 0);
  const paid      = Number(row.amount_paid  ?? 0);
  const currency  = (row.currency as string) ?? "$";
  const engineer  = row.engineer_name as string;
  const workType  = (row.work_type as SoundEngineerWorkType) ?? "מיקס";
  const projectId = row.project_id as string;
  const linkedTxId = (row.linked_transaction_id as string | null) ?? null;

  // Re-sync transaction if any financial field changed
  const priceChanged =
    fields.agreedPrice !== undefined ||
    fields.amountPaid  !== undefined ||
    fields.currency    !== undefined ||
    fields.engineerName !== undefined ||
    fields.workType     !== undefined;

  if (!fields.skipFinanceSync && priceChanged && agreed > 0) {
    const { data: proj } = await supabase
      .from("projects")
      .select("artist")
      .eq("id", projectId)
      .single();
    const artist = (proj?.artist as string) ?? "";

    const newTxId = await syncTransaction({
      projectId,
      artist,
      engineerName: engineer,
      workType,
      agreedPrice: agreed,
      currency,
      amountPaid: paid,
      linkedTransactionId: linkedTxId,
    });

    if (newTxId && newTxId !== linkedTxId) {
      await supabase
        .from("sound_engineer_work")
        .update({ linked_transaction_id: newTxId })
        .eq("id", id);
      row.linked_transaction_id = newTxId;
    }
  }

  const projectMap = await buildProjectMap();
  return mapRow(row, projectMap);
}

/** Delete a sound engineer work record. Does NOT delete the linked transaction. */
export async function deleteSoundEngineerWork(id: string): Promise<void> {
  const { error } = await supabase.from("sound_engineer_work").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/**
 * Manually trigger a transaction sync for an existing record.
 * Use this if the auto-sync failed on creation/update.
 */
export async function forceSyncTransaction(id: string): Promise<{ txId: string | null }> {
  const { data, error } = await supabase
    .from("sound_engineer_work")
    .select("*")
    .eq("id", id)
    .single();
  if (error || !data) throw new Error(error?.message ?? "רשומה לא נמצאה");

  const row = data as Record<string, unknown>;
  const { data: proj } = await supabase
    .from("projects")
    .select("artist")
    .eq("id", row.project_id as string)
    .single();

  const newTxId = await syncTransaction({
    projectId:           row.project_id as string,
    artist:              (proj?.artist as string) ?? "",
    engineerName:        row.engineer_name as string,
    workType:            (row.work_type as string) ?? "מיקס",
    agreedPrice:         Number(row.agreed_price ?? 0),
    currency:            (row.currency as string) ?? "$",
    amountPaid:          Number(row.amount_paid ?? 0),
    linkedTransactionId: (row.linked_transaction_id as string | null) ?? null,
  });

  if (newTxId && newTxId !== row.linked_transaction_id) {
    await supabase
      .from("sound_engineer_work")
      .update({ linked_transaction_id: newTxId })
      .eq("id", id);
  }

  return { txId: newTxId };
}
