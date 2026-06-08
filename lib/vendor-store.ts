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
import type {
  VendorWork,
  VendorSettings,
  VictorMonthStats,
  VictorStatus,
  VictorWorkState,
  VictorOutcome,
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
  const proj         = projectMap.get(row.project_id as string);
  const sentDate     = (row.sent_date as string | null) ?? null;
  const daysSinceSent = sentDate ? daysBetween(sentDate) : null;
  // stuck = active AND days since sent > threshold
  const isStuck = row.status === "פעיל" && daysSinceSent !== null && daysSinceSent > stuckAfterDays;

  return {
    id:               row.id as string,
    vendorName:       row.vendor_name as string,
    projectId:        row.project_id as string,
    projectName:      proj?.name   ?? "פרויקט לא ידוע",
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
    filesSent:        (row.files_sent        as VendorWork["filesSent"])    ?? [],
    filesReceived:    (row.files_received    as VendorWork["filesReceived"]) ?? [],
    isStuck,
    daysSinceSent,
    createdAt:        (row.created_at as string) ?? "",
    updatedAt:        (row.updated_at as string) ?? "",
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
  projectId: string,
  initial?: Partial<Pick<VendorWork,
    "status" | "workState" | "outcome" | "sentDate" | "notes" | "dropboxFolder" | "dropboxShareLink"
  >>
): Promise<VendorWork> {
  const { data, error } = await supabase
    .from("vendor_project_work")
    .insert({
      vendor_name:        "victor",
      project_id:         projectId,
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
    status:           VictorStatus;
    workState:        VictorWorkState | null;
    outcome:          VictorOutcome   | null;
    sentDate:         string | null;
    internalDeadline: string | null;
    returnedDate:     string | null;
    dropboxFolder:    string | null;
    dropboxShareLink: string | null;
    notes:            string;
    filesSent:        VendorWork["filesSent"];
    filesReceived:    VendorWork["filesReceived"];
  }>
): Promise<void> {
  const dbFields: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if ("status"           in fields) dbFields.status             = fields.status;
  if ("workState"        in fields) dbFields.work_state         = fields.workState;
  if ("outcome"          in fields) dbFields.outcome            = fields.outcome;
  if ("sentDate"         in fields) dbFields.sent_date          = fields.sentDate;
  if ("internalDeadline" in fields) dbFields.internal_deadline  = fields.internalDeadline;
  if ("returnedDate"     in fields) dbFields.returned_date      = fields.returnedDate;
  if ("dropboxFolder"    in fields) dbFields.dropbox_folder     = fields.dropboxFolder;
  if ("dropboxShareLink" in fields) dbFields.dropbox_share_link = fields.dropboxShareLink;
  if ("notes"            in fields) dbFields.notes              = fields.notes;
  if ("filesSent"        in fields) dbFields.files_sent         = fields.filesSent;
  if ("filesReceived"    in fields) dbFields.files_received     = fields.filesReceived;

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
