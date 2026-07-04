/**
 * Vendor / Team store — server-only.
 * Handles CRUD for vendor_project_work table + Victor settings/stats.
 *
 * Status model (v2):
 *   status    — "פעיל" | "הושלם" | "בוטל"
 *   work_state — "נשלח לויקטור" | "חזר מויקטור" | "דורש בדיקה" | "דורש תיקון" | "מחכה לקבצים" | "לא רלוונטי"
 *   outcome   — "אושר" | "נכנס לפרויקט בפועל" | "חלקית" | "לא נכנס לפרויקט" | "נדחה"
 */
import "server-only";
import { supabase } from "@/lib/supabase";
import { segmentVictorWork } from "@/lib/victor-segments";
import { fileRefOf } from "@/lib/victor-files";
import type {
  VendorWork,
  VendorSettings,
  VictorMonthStats,
  VictorStatus,
  VictorWorkState,
  VictorOutcome,
  VictorSalaryMonth,
  SalaryStatus,
  VictorReference,
  FileLink,
} from "@/lib/types";

// ── Defaults ──────────────────────────────────────────────────────────────────

const DEFAULT_SETTINGS: VendorSettings = {
  monthlyGoal:    10,
  monthlySalary:  550,
  salaryCurrency: "$",
  salaryPayDay:   10,
  stuckAfterDays: 5,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function daysBetween(dateStr: string): number {
  const sent = new Date(dateStr);
  const now  = new Date();
  return Math.floor((now.getTime() - sent.getTime()) / (1000 * 60 * 60 * 24));
}

function mapRow(
  row: Record<string, unknown>,
  projectMap: Map<string, { name: string; artist: string }>,
  stuckAfterDays: number
): VendorWork {
  const projectId    = (row.project_id as string | null) ?? null;
  const title        = (row.title as string | null) ?? null;
  const proj         = projectId ? projectMap.get(projectId) : undefined;
  const sentDate     = (row.sent_date as string | null) ?? null;
  const daysSinceSent = sentDate ? daysBetween(sentDate) : null;
  // stuck = active AND days since sent > threshold
  const isStuck = row.status === "פעיל" && daysSinceSent !== null && daysSinceSent > stuckAfterDays;

  return {
    id:               row.id as string,
    vendorName:       row.vendor_name as string,
    projectId,
    title,
    projectName:      proj?.name ?? title ?? "עבודה ללא פרויקט",
    artist:           proj?.artist ?? "",
    status:           (row.status     as VictorStatus)    ?? "פעיל",
    workState:        (row.work_state as VictorWorkState | null) ?? null,
    outcome:          (row.outcome    as VictorOutcome   | null) ?? null,
    sentDate,
    internalDeadline: (row.internal_deadline as string | null) ?? null,
    returnedDate:     (row.returned_date     as string | null) ?? null,
    dropboxFolder:    (row.dropbox_folder    as string | null) ?? null,
    dropboxShareLink: (row.dropbox_share_link as string | null) ?? null,
    notes:            (row.notes             as string) ?? "",
    briefText:        (row.brief_text        as string | null) ?? "",
    references:       (row.reference_links   as VictorReference[] | null) ?? [],
    filesSent:        (row.files_sent        as VendorWork["filesSent"])    ?? [],
    filesReceived:    (row.files_received    as VendorWork["filesReceived"]) ?? [],
    briefFiles:       (row.brief_files       as VendorWork["briefFiles"])   ?? [],
    isStuck,
    daysSinceSent,
    linkedTaskId:     (row.linked_task_id as string | null) ?? null,
    versionReviews:   (row.version_reviews as VendorWork["versionReviews"] | null) ?? {},
    createdAt:        (row.created_at as string) ?? "",
    updatedAt:        (row.updated_at as string) ?? "",
  };
}

// ── Victor payload sanitizer ───────────────────────────────────────────────────
// Strip everything that would reveal the Artist / Client / Project or the
// Dropbox folder from a work before it is sent to a VICTOR client. Apply this in
// every route that returns work data when the caller's role is "victor"; the
// owner keeps the full record. projectName collapses to the Victor-facing work
// title (never the real project name), so client fallbacks never leak it.
// NOTE: per-file dropboxPath/url inside filesSent/briefFiles still carry the
// folder path (the player/stream need them) — that is a separate, larger change.
export function sanitizeWorkForVictor(w: VendorWork): VendorWork {
  return {
    ...w,
    projectName:      (w.title && w.title.trim()) ? w.title : "—",
    artist:           "",
    projectId:        null,
    dropboxFolder:    null,
    dropboxShareLink: null,
    notes:            "", // owner-internal notes — never shown to Victor
    filesSent:        (w.filesSent     ?? []).map(fileForVictor),
    filesReceived:    (w.filesReceived ?? []).map(fileForVictor),
    briefFiles:       (w.briefFiles    ?? []).map(fileForVictor),
  };
}

// Path-free file object for Victor: drop dropboxPath/url/dropboxShareUrl (all
// carry /Projects/{artist}/{project}/…) and hand back an opaque fileRef that the
// stream/download routes resolve server-side. Keep only what the UI needs.
function fileForVictor(f: FileLink): FileLink {
  return {
    name:            f.name,
    url:             "", // required by the type; the client uses fileRef instead
    ...(f.versionLabel    !== undefined ? { versionLabel: f.versionLabel } : {}),
    ...(f.category        !== undefined ? { category: f.category } : {}),
    ...(f.durationSeconds !== undefined ? { durationSeconds: f.durationSeconds } : {}),
    ...(f.size            !== undefined ? { size: f.size } : {}),
    ...(f.segments        !== undefined ? { segments: f.segments } : {}),
    ...(f.dropboxPath ? { fileRef: fileRefOf(f.dropboxPath) } : {}),
  };
}

// ── Project lookup helper ─────────────────────────────────────────────────────

async function buildProjectMap(): Promise<Map<string, { name: string; artist: string }>> {
  const { data } = await supabase.from("projects").select("id, name, artist");
  const map = new Map<string, { name: string; artist: string }>();
  (data ?? []).forEach((p) => map.set(p.id, { name: p.name, artist: p.artist }));
  return map;
}

// ── Read ──────────────────────────────────────────────────────────────────────

export async function getVictorWork(_month?: string): Promise<VendorWork[]> {
  // Always return ALL records — same dataset as getVictorMonthStats.
  // Month-filtering was causing invalid dates (e.g. June-31) and dataset
  // mismatches between the stats counts and the drill-down list.
  // The פרויקטים tab groups by status, not by month, so no month filter needed.
  const settings   = await getVictorSettings();
  const projectMap = await buildProjectMap();

  const { data } = await supabase
    .from("vendor_project_work")
    .select("*")
    .eq("vendor_name", "victor")
    .order("created_at", { ascending: false });

  return (data ?? []).map((r) =>
    mapRow(r as Record<string, unknown>, projectMap, settings.stuckAfterDays)
  );
}

export async function getVictorWorkById(id: string): Promise<VendorWork | null> {
  const settings   = await getVictorSettings();
  const projectMap = await buildProjectMap();

  const { data } = await supabase
    .from("vendor_project_work")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (!data) return null;
  return mapRow(data as Record<string, unknown>, projectMap, settings.stuckAfterDays);
}

export async function getVictorWorkForProject(projectId: string): Promise<VendorWork | null> {
  const settings   = await getVictorSettings();
  const projectMap = await buildProjectMap();

  const { data } = await supabase
    .from("vendor_project_work")
    .select("*")
    .eq("vendor_name", "victor")
    .eq("project_id", projectId)
    .maybeSingle();

  if (!data) return null;
  return mapRow(data as Record<string, unknown>, projectMap, settings.stuckAfterDays);
}

// ── Write ─────────────────────────────────────────────────────────────────────

export async function createVictorWork(
  projectId: string | null,
  initial?: Partial<Pick<VendorWork,
    "title" | "status" | "workState" | "outcome" | "sentDate" | "notes" | "dropboxFolder" | "dropboxShareLink"
  >>
): Promise<VendorWork> {
  const { data, error } = await supabase
    .from("vendor_project_work")
    .insert({
      vendor_name:        "victor",
      project_id:         projectId ?? null,
      title:              initial?.title      ?? null,
      status:             initial?.status     ?? "פעיל",
      work_state:         initial?.workState  ?? "נשלח לויקטור",
      outcome:            initial?.outcome    ?? null,
      sent_date:          initial?.sentDate   ?? new Date().toISOString().split("T")[0],
      notes:              initial?.notes      ?? "",
      dropbox_folder:     initial?.dropboxFolder    ?? null,
      dropbox_share_link: initial?.dropboxShareLink ?? null,
    })
    .select()
    .single();

  if (error || !data) throw new Error(error?.message ?? "createVictorWork failed");

  const settings   = await getVictorSettings();
  const projectMap = await buildProjectMap();
  return mapRow(data as Record<string, unknown>, projectMap, settings.stuckAfterDays);
}

export async function updateVictorWork(
  id: string,
  fields: Partial<{
    title:            string | null;
    status:           VictorStatus;
    workState:        VictorWorkState | null;
    outcome:          VictorOutcome   | null;
    sentDate:         string | null;
    internalDeadline: string | null;
    returnedDate:     string | null;
    dropboxFolder:    string | null;
    dropboxShareLink: string | null;
    notes:            string;
    briefText:        string;
    references:       VictorReference[];
    filesSent:        VendorWork["filesSent"];
    filesReceived:    VendorWork["filesReceived"];
    briefFiles:       VendorWork["briefFiles"];
    linkedTaskId:     string | null;
    versionReviews:   VendorWork["versionReviews"];
  }>
): Promise<void> {
  const dbFields: Record<string, unknown> = { updated_at: new Date().toISOString() };
  // Victor-facing work title (owner-only edit). Blank → null so display falls
  // back to the linked project's name. Never touches projects.name / project_id.
  if ("title" in fields) dbFields.title = (fields.title ?? "").toString().trim() || null;
  if ("status" in fields) {
    dbFields.status = fields.status;
    // Keep completion date in sync with status (single source of truth):
    // → "הושלם" sets returned_date to today; any other status clears it.
    // Skipped if the caller explicitly provided returnedDate in the same patch.
    if (!("returnedDate" in fields)) {
      dbFields.returned_date =
        fields.status === "הושלם" ? new Date().toISOString().split("T")[0] : null;
    }
  }
  if ("workState"        in fields) dbFields.work_state         = fields.workState;
  if ("outcome"          in fields) dbFields.outcome            = fields.outcome;
  if ("sentDate"         in fields) dbFields.sent_date          = fields.sentDate;
  if ("internalDeadline" in fields) dbFields.internal_deadline  = fields.internalDeadline;
  if ("returnedDate"     in fields) dbFields.returned_date      = fields.returnedDate;
  if ("dropboxFolder"    in fields) dbFields.dropbox_folder     = fields.dropboxFolder;
  if ("dropboxShareLink" in fields) dbFields.dropbox_share_link = fields.dropboxShareLink;
  if ("notes"            in fields) dbFields.notes              = fields.notes;
  if ("briefText"        in fields) dbFields.brief_text         = fields.briefText;
  if ("references"       in fields) dbFields.reference_links    = fields.references;
  if ("filesSent"        in fields) dbFields.files_sent         = fields.filesSent;
  if ("filesReceived"    in fields) dbFields.files_received     = fields.filesReceived;
  if ("briefFiles"       in fields) dbFields.brief_files        = fields.briefFiles;
  if ("linkedTaskId"     in fields) dbFields.linked_task_id     = fields.linkedTaskId;
  if ("versionReviews"   in fields) dbFields.version_reviews    = fields.versionReviews;

  await supabase.from("vendor_project_work").update(dbFields).eq("id", id);
}

export async function deleteVictorWork(id: string): Promise<void> {
  await supabase.from("vendor_project_work").delete().eq("id", id);
}

// ── Settings ──────────────────────────────────────────────────────────────────

const SETTINGS_KEY = "vendor_victor_settings";

export async function getVictorSettings(): Promise<VendorSettings> {
  const { data } = await supabase
    .from("settings")
    .select("value")
    .eq("key", SETTINGS_KEY)
    .maybeSingle();
  if (!data?.value) return { ...DEFAULT_SETTINGS };
  return { ...DEFAULT_SETTINGS, ...(data.value as Partial<VendorSettings>) };
}

export async function updateVictorSettings(fields: Partial<VendorSettings>): Promise<void> {
  const current = await getVictorSettings();
  const merged  = { ...current, ...fields };
  await supabase
    .from("settings")
    .upsert(
      { key: SETTINGS_KEY, value: merged as unknown as Record<string, unknown> },
      { onConflict: "key" }
    );
}

// ── Monthly payment ───────────────────────────────────────────────────────────

function paymentKey(month: string) {
  return `vendor_victor_payment_${month.replace("-", "_")}`;
}

export async function getVictorPaymentStatus(month: string): Promise<string> {
  const { data } = await supabase
    .from("settings")
    .select("value")
    .eq("key", paymentKey(month))
    .maybeSingle();
  if (!data?.value) return "צפוי";
  return ((data.value as Record<string, unknown>).status as string) ?? "צפוי";
}

export async function setVictorPaymentStatus(month: string, status: string, paidDate?: string): Promise<void> {
  await supabase
    .from("settings")
    .upsert(
      { key: paymentKey(month), value: { status, paidDate: paidDate ?? null } as unknown as Record<string, unknown> },
      { onConflict: "key" }
    );
}

// ── Salary months ─────────────────────────────────────────────────────────────

const SALARY_OVERRIDES_KEY = "vendor_victor_salary_overrides";
// Internal, finance-independent salary status overrides (month → "צפוי" | "שולם" | …)
const SALARY_STATUS_OVERRIDES_KEY = "vendor_victor_salary_status_overrides";

const HE_MONTHS_SALARY = [
  "ינואר","פברואר","מרץ","אפריל","מאי","יוני",
  "יולי","אוגוסט","ספטמבר","אוקטובר","נובמבר","דצמבר",
];

function salaryLinkedId(workMonth: string) {
  return `victor_salary_${workMonth}`;
}

export function salaryDueDate(workMonth: string): string {
  const [y, m] = workMonth.split("-").map(Number);
  const dueYear = m === 12 ? y + 1 : y;
  const dueMon  = m === 12 ? 1 : m + 1;
  return `${dueYear}-${String(dueMon).padStart(2, "0")}-10`;
}

export function salaryMonthLabel(workMonth: string): string {
  const [y, m] = workMonth.split("-").map(Number);
  return `${HE_MONTHS_SALARY[m - 1]} ${y}`;
}

export async function getVictorSalaryMonths(year: number): Promise<VictorSalaryMonth[]> {
  const settings = await getVictorSettings();

  // Salary amount overrides per month
  const { data: overridesRow } = await supabase
    .from("settings")
    .select("value")
    .eq("key", SALARY_OVERRIDES_KEY)
    .maybeSingle();
  const overrides = (overridesRow?.value ?? {}) as Record<string, number>;

  // Internal status overrides per month (finance-independent — wins when present)
  const { data: statusOverridesRow } = await supabase
    .from("settings")
    .select("value")
    .eq("key", SALARY_STATUS_OVERRIDES_KEY)
    .maybeSingle();
  const statusOverrides = (statusOverridesRow?.value ?? {}) as Record<string, string>;

  // All Victor salary transactions (filter in JS to avoid SQL LIKE wildcard issues)
  const { data: txsRaw } = await supabase
    .from("transactions")
    .select("id, linked_session_id, payment_status, amount, currency")
    .like("linked_session_id", "victor\\_salary\\_%");

  // Build map: workMonth → transaction
  const txMap = new Map<string, { id: string; paymentStatus: string }>();
  for (const tx of (txsRaw ?? [])) {
    const lid = tx.linked_session_id as string | null;
    if (!lid) continue;
    // Validate format: "victor_salary_YYYY-MM"
    const m = /^victor_salary_(\d{4}-\d{2})$/.exec(lid);
    if (!m) continue;
    txMap.set(m[1], { id: tx.id as string, paymentStatus: tx.payment_status as string });
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const months: VictorSalaryMonth[] = [];
  for (let mo = 1; mo <= 12; mo++) {
    const workMonth = `${year}-${String(mo).padStart(2, "0")}`;
    const dueDate   = salaryDueDate(workMonth);
    const amount    = overrides[workMonth] ?? settings.monthlySalary;
    const currency  = settings.salaryCurrency;
    const tx        = txMap.get(workMonth);

    let status: SalaryStatus;
    const statusOverride = statusOverrides[workMonth];
    if (statusOverride) {
      // Internal override wins — fully finance-independent.
      status = statusOverride as SalaryStatus;
    } else if (!tx) {
      const due = new Date(dueDate);
      status = due <= today ? "לא שולם" : "צפוי";
    } else {
      const ps = tx.paymentStatus;
      if (ps === "שולם" || ps === "התקבל") status = "שולם";
      else if (ps === "חלקי")              status = "חלקי";
      else if (ps === "בוטל") {
        // Cancelled transaction — show status as if no transaction (based on dueDate)
        const due = new Date(dueDate);
        status = due <= today ? "לא שולם" : "צפוי";
      }
      else                                 status = "נשלח לכספים";
    }

    months.push({
      workMonth,
      dueDate,
      amount,
      currency,
      status,
      transactionId:              tx?.id              ?? null,
      transactionPaymentStatus:   tx?.paymentStatus   ?? null,
    });
  }

  return months;
}

export async function setSalaryAmountOverride(workMonth: string, amount: number): Promise<void> {
  const { data: existing } = await supabase
    .from("settings")
    .select("value")
    .eq("key", SALARY_OVERRIDES_KEY)
    .maybeSingle();
  const current = (existing?.value ?? {}) as Record<string, number>;
  await supabase
    .from("settings")
    .upsert(
      { key: SALARY_OVERRIDES_KEY, value: { ...current, [workMonth]: amount } },
      { onConflict: "key" }
    );
}

// Internal salary status override — settings only, never touches Finance/transactions.
export async function setSalaryStatusOverride(workMonth: string, status: string): Promise<void> {
  const { data: existing } = await supabase
    .from("settings")
    .select("value")
    .eq("key", SALARY_STATUS_OVERRIDES_KEY)
    .maybeSingle();
  const current = (existing?.value ?? {}) as Record<string, string>;
  await supabase
    .from("settings")
    .upsert(
      { key: SALARY_STATUS_OVERRIDES_KEY, value: { ...current, [workMonth]: status } },
      { onConflict: "key" }
    );
}

export { salaryLinkedId };

// ── Monthly stats ─────────────────────────────────────────────────────────────

export async function getVictorMonthStats(month: string): Promise<VictorMonthStats> {
  const settings   = await getVictorSettings();
  const projectMap = await buildProjectMap();

  const { data: rawAll } = await supabase
    .from("vendor_project_work")
    .select("*")
    .eq("vendor_name", "victor");

  const all = (rawAll ?? []).map((r) =>
    mapRow(r as Record<string, unknown>, projectMap, settings.stuckAfterDays)
  );

  const seg = segmentVictorWork(all, month);

  // paceValue = sent this month that are NOT בוטל
  const paceValue = seg.sentThisMonth.filter((w) => w.status !== "בוטל").length;

  const now      = new Date();
  const curMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  let expectedByNow = settings.monthlyGoal;
  if (month === curMonth) {
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    expectedByNow     = Math.round(settings.monthlyGoal * (now.getDate() / daysInMonth));
  }

  const paymentStatus = await getVictorPaymentStatus(month);

  return {
    month,
    goal:           settings.monthlyGoal,
    sent:           seg.sentThisMonth.length,
    active:         seg.pureActive.length,
    completed:      seg.completed.length,
    cancelled:      seg.cancelled.length,
    needsReview:    seg.needsReview.length,
    needsFix:       seg.needsFix.length,
    stuck:          seg.stuck.length,
    approved:       seg.approved.length,
    enteredProject: seg.entered.length,
    paceValue,
    expectedByNow,
    paymentStatus,
    monthlySalary:  settings.monthlySalary,
    salaryCurrency: settings.salaryCurrency,
  };
}
