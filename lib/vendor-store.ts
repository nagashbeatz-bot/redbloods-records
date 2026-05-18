/**
 * Vendor / Team store — server-only.
 * Handles CRUD for vendor_project_work table + Victor settings/stats.
 */
import "server-only";
import { supabase } from "@/lib/supabase";
import type {
  VendorWork,
  VendorSettings,
  VictorMonthStats,
  VictorStatus,
  VictorQuality,
  VictorEntered,
} from "@/lib/types";
import { VICTOR_ACTIVE_STATUSES } from "@/lib/types";

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
  const proj = projectMap.get(row.project_id as string);
  const sentDate = (row.sent_date as string | null) ?? null;
  const daysSinceSent = sentDate ? daysBetween(sentDate) : null;
  const isStuck =
    VICTOR_ACTIVE_STATUSES.has(row.status as VictorStatus) &&
    daysSinceSent !== null &&
    daysSinceSent > stuckAfterDays;

  return {
    id:               row.id as string,
    vendorName:       row.vendor_name as string,
    projectId:        row.project_id as string,
    projectName:      proj?.name   ?? "פרויקט לא ידוע",
    artist:           proj?.artist ?? "",
    status:           (row.status as VictorStatus) ?? "לא נשלח",
    sentDate,
    internalDeadline: (row.internal_deadline as string | null) ?? null,
    returnedDate:     (row.returned_date     as string | null) ?? null,
    dropboxFolder:    (row.dropbox_folder    as string | null) ?? null,
    dropboxShareLink: (row.dropbox_share_link as string | null) ?? null,
    quality:          (row.quality           as VictorQuality | null) ?? null,
    enteredProject:   (row.entered_project   as VictorEntered | null) ?? null,
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
  const { data } = await supabase
    .from("projects")
    .select("id, name, artist");
  const map = new Map<string, { name: string; artist: string }>();
  (data ?? []).forEach((p) => map.set(p.id, { name: p.name, artist: p.artist }));
  return map;
}

// ── Read ──────────────────────────────────────────────────────────────────────

export async function getVictorWork(month?: string): Promise<VendorWork[]> {
  const settings = await getVictorSettings();
  const projectMap = await buildProjectMap();

  let query = supabase
    .from("vendor_project_work")
    .select("*")
    .eq("vendor_name", "victor")
    .order("created_at", { ascending: false });

  if (month) {
    // month = "YYYY-MM" — filter by sent_date in that month OR created_at in that month
    const start = `${month}-01`;
    const end   = `${month}-31`;
    query = supabase
      .from("vendor_project_work")
      .select("*")
      .eq("vendor_name", "victor")
      .or(`sent_date.gte.${start},created_at.gte.${month}-01T00:00:00`)
      .or(`sent_date.lte.${end},created_at.lte.${month}-31T23:59:59`)
      .order("created_at", { ascending: false });
  }

  const { data } = await query;
  return (data ?? []).map((r) =>
    mapRow(r as Record<string, unknown>, projectMap, settings.stuckAfterDays)
  );
}

export async function getVictorWorkForProject(projectId: string): Promise<VendorWork | null> {
  const settings = await getVictorSettings();
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
  initial?: Partial<Pick<VendorWork, "status" | "sentDate" | "notes" | "dropboxFolder" | "dropboxShareLink">>
): Promise<VendorWork> {
  const { data, error } = await supabase
    .from("vendor_project_work")
    .insert({
      vendor_name:       "victor",
      project_id:        projectId,
      status:            initial?.status    ?? "לא נשלח",
      sent_date:         initial?.sentDate  ?? null,
      notes:             initial?.notes     ?? "",
      dropbox_folder:    initial?.dropboxFolder    ?? null,
      dropbox_share_link: initial?.dropboxShareLink ?? null,
    })
    .select()
    .single();

  if (error || !data) throw new Error(error?.message ?? "createVictorWork failed");

  const settings = await getVictorSettings();
  const projectMap = await buildProjectMap();
  return mapRow(data as Record<string, unknown>, projectMap, settings.stuckAfterDays);
}

export async function updateVictorWork(
  id: string,
  fields: Partial<{
    status: VictorStatus;
    sentDate: string | null;
    internalDeadline: string | null;
    returnedDate: string | null;
    dropboxFolder: string | null;
    dropboxShareLink: string | null;
    quality: VictorQuality | null;
    enteredProject: VictorEntered | null;
    notes: string;
    filesSent: VendorWork["filesSent"];
    filesReceived: VendorWork["filesReceived"];
  }>
): Promise<void> {
  // Map camelCase → snake_case
  const dbFields: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if ("status"           in fields) dbFields.status             = fields.status;
  if ("sentDate"         in fields) dbFields.sent_date          = fields.sentDate;
  if ("internalDeadline" in fields) dbFields.internal_deadline  = fields.internalDeadline;
  if ("returnedDate"     in fields) dbFields.returned_date      = fields.returnedDate;
  if ("dropboxFolder"    in fields) dbFields.dropbox_folder     = fields.dropboxFolder;
  if ("dropboxShareLink" in fields) dbFields.dropbox_share_link = fields.dropboxShareLink;
  if ("quality"          in fields) dbFields.quality            = fields.quality;
  if ("enteredProject"   in fields) dbFields.entered_project    = fields.enteredProject;
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
    .upsert({ key: SETTINGS_KEY, value: merged as unknown as Record<string, unknown> }, { onConflict: "key" });
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
      {
        key: paymentKey(month),
        value: { status, paidDate: paidDate ?? null } as unknown as Record<string, unknown>,
      },
      { onConflict: "key" }
    );
}

// ── Monthly stats ─────────────────────────────────────────────────────────────

export async function getVictorMonthStats(month: string): Promise<VictorMonthStats> {
  const settings = await getVictorSettings();
  const projectMap = await buildProjectMap();

  // Fetch all Victor work for this month (sent_date in month OR still active with no sent date)
  const { data: rawAll } = await supabase
    .from("vendor_project_work")
    .select("*")
    .eq("vendor_name", "victor");

  const all = (rawAll ?? []).map((r) =>
    mapRow(r as Record<string, unknown>, projectMap, settings.stuckAfterDays)
  );

  const monthStart = `${month}-01`;
  const monthEnd   = `${month}-31`;

  // Records with sent_date in this month
  const sentThisMonth = all.filter(
    (w) => w.sentDate && w.sentDate >= monthStart && w.sentDate <= monthEnd
  );

  // Records currently in active statuses (regardless of month — still pending)
  const currentlyActive = all.filter((w) => VICTOR_ACTIVE_STATUSES.has(w.status));

  // Terminal/returned records with returned_date in this month OR status in returned statuses
  const RETURNED_STATUSES = new Set<VictorStatus>(["הוחזר מויקטור", "דורש תיקונים", "אושר"]);
  const returnedThisMonth = all.filter(
    (w) =>
      (w.returnedDate && w.returnedDate >= monthStart && w.returnedDate <= monthEnd) ||
      (RETURNED_STATUSES.has(w.status) && (!w.sentDate || (w.sentDate >= monthStart && w.sentDate <= monthEnd)))
  );

  const approvedThisMonth  = all.filter(
    (w) => w.status === "אושר" && (w.sentDate ?? w.createdAt.slice(0, 10)) >= monthStart &&
           (w.sentDate ?? w.createdAt.slice(0, 10)) <= monthEnd
  );
  const needsFixThisMonth  = sentThisMonth.filter((w) => w.status === "דורש תיקונים");
  const rejectedThisMonth  = sentThisMonth.filter((w) => w.status === "לא רלוונטי");
  const enteredThisMonth   = sentThisMonth.filter(
    (w) => w.enteredProject === "כן" || w.enteredProject === "חלקית"
  );
  const stuckAll           = all.filter((w) => w.isStuck);

  // Pace: expected by today
  const now        = new Date();
  const curMonth   = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  let expectedByNow = settings.monthlyGoal;
  if (month === curMonth) {
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    expectedByNow = Math.round(settings.monthlyGoal * (now.getDate() / daysInMonth));
  }

  const returned = returnedThisMonth.length;
  const approved = approvedThisMonth.length;
  const successRate = Math.round((approved / Math.max(returned, 1)) * 100);

  const paymentStatus = await getVictorPaymentStatus(month);

  return {
    month,
    goal:          settings.monthlyGoal,
    sent:          sentThisMonth.length,
    inProgress:    currentlyActive.length,
    returned,
    approved,
    needsFix:      needsFixThisMonth.length,
    rejected:      rejectedThisMonth.length,
    enteredProject: enteredThisMonth.length,
    stuck:         stuckAll.length,
    expectedByNow,
    successRate,
    paymentStatus,
    monthlySalary:  settings.monthlySalary,
    salaryCurrency: settings.salaryCurrency,
  };
}
