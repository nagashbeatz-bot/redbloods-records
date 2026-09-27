/**
 * Shared writers for the Owner's company-level operations: his notification bell, business goals, agent-alert
 * handling, the report schedule / send-now, the Dropbox disconnect and the maintenance lock. Used by the routes and by
 * Sunny's typed primitives. HARDENED (2026-09-27, Universal Actions):
 *   • goals: only the four known goals, each with a validated shape, are written (the route used to turn ANY body key
 *     into a `goal_<key>` settings row) and a failed write is an error (it used to be ignored);
 *   • alert status: a failed write is an error (it used to be ignored); the kill-switch rule is unchanged;
 *   • notifications: a recipient-bound writer for the OWNER's own rows (resolved from OWNER_EMAILS, never the per-row
 *     recipient_role echo) — the bell's session-scoped routes are unchanged;
 *   • maintenance: a failed write is an error (it used to be ignored).
 * The Dropbox token is only read inside this module to revoke it; it never leaves.
 */
import { supabase } from "@/lib/supabase";
import type { BusinessGoals } from "@/lib/types";

export class SystemInputError extends Error {}

// ── Owner notifications ──
async function ownerIds(): Promise<string[]> {
  const { resolveOwnerUserIds } = await import("@/lib/owner-notifications-cleanup");
  const ids = await resolveOwnerUserIds();
  if (!ids.length) throw new Error("no Owner user resolved");
  return ids;
}
export async function readOwnerNotification(id: string): Promise<{ title: string | null; readAt: string | null } | null> {
  const { data, error } = await supabase.from("notifications").select("id, title, read_at").eq("id", id).in("recipient_user_id", await ownerIds()).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? { title: (data.title as string | null) ?? null, readAt: (data.read_at as string | null) ?? null } : null;
}
export async function listOwnerUnread(limit = 30): Promise<Array<{ id: string; title: string | null; createdAt: string | null }>> {
  const { data, error } = await supabase.from("notifications").select("id, title, created_at").in("recipient_user_id", await ownerIds()).is("read_at", null).order("created_at", { ascending: false }).limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({ id: String(r.id), title: (r.title as string | null) ?? null, createdAt: (r.created_at as string | null) ?? null }));
}
export async function countOwnerUnread(): Promise<number> {
  const { count, error } = await supabase.from("notifications").select("id", { count: "exact", head: true }).in("recipient_user_id", await ownerIds()).is("read_at", null);
  if (error) throw new Error(error.message);
  return count ?? 0;
}
export async function markOwnerNotificationRead(id: string): Promise<void> {
  const { error } = await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", id).in("recipient_user_id", await ownerIds()).is("read_at", null);
  if (error) throw new Error(error.message);
}
export async function markAllOwnerNotificationsRead(): Promise<number> {
  const { data, error } = await supabase.from("notifications").update({ read_at: new Date().toISOString() }).in("recipient_user_id", await ownerIds()).is("read_at", null).select("id");
  if (error) throw new Error(error.message);
  return (data ?? []).length;
}

// ── business goals (KPIs — never a pay rule) ──
export const GOAL_NAMES = ["monthlyRevenue", "weeklySessions", "monthlyVictor", "monthlyCompletions"] as const;
export type GoalName = typeof GOAL_NAMES[number];
const goalKey = (g: string) => `goal_${g.replace(/([A-Z])/g, "_$1").toLowerCase()}`;
export function validGoal(name: string, value: unknown): BusinessGoals[GoalName] {
  if (!(GOAL_NAMES as readonly string[]).includes(name)) throw new SystemInputError(`יעד לא מוכר: ${name}`);
  const v = value as Record<string, unknown> | null;
  const target = Number(v?.target);
  if (!v || typeof v !== "object" || !Number.isFinite(target) || target < 0) throw new SystemInputError(`${name}: יעד לא תקין`);
  if (name === "monthlyRevenue") {
    if (v.currency !== "₪" && v.currency !== "$") throw new SystemInputError("monthlyRevenue: מטבע ₪ / $");
    return { target, currency: String(v.currency) };
  }
  return { target } as BusinessGoals[GoalName];
}
export async function setBusinessGoal(name: string, value: unknown): Promise<void> {
  const clean = validGoal(name, value);
  const { error } = await supabase.from("settings").upsert({ key: goalKey(name), value: clean as unknown as Record<string, unknown> }, { onConflict: "key" });
  if (error) throw new Error(error.message);
}
export async function readBusinessGoals(): Promise<BusinessGoals> { const { getGoals } = await import("@/lib/agent/goals"); return getGoals(); }

// ── agent alerts (context only; the kill-switch rule is the route's, reused) ──
export const ALERT_STATUSES = ["new", "handled", "dismissed", "ignored"] as const;
export async function readAlert(id: string): Promise<{ type: string; status: string; title: string } | null> {
  const { getAlertById } = await import("@/lib/agent/alerts-store");
  const a = await getAlertById(id);
  return a ? { type: String(a.type), status: String(a.status), title: String(a.title ?? "") } : null;
}
/** Whether this alert may be acted on (AGENT_ALERT_RULES_ENABLED off → only the exempt week-strength type). */
export async function alertActionable(type: string): Promise<boolean> {
  const { AGENT_ALERT_RULES_ENABLED } = await import("@/lib/feature-flags");
  const { WEEK_STRENGTH_ALERT_TYPE } = await import("@/lib/week-strength-pure");
  return AGENT_ALERT_RULES_ENABLED || type === WEEK_STRENGTH_ALERT_TYPE;
}
export async function setAlertStatus(id: string, status: string): Promise<void> {
  if (!(ALERT_STATUSES as readonly string[]).includes(status)) throw new SystemInputError("invalid status");
  const { error } = await supabase.from("agent_alerts").update({ status, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) throw new Error(error.message);
}

// ── reports ──
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
export async function readReportSchedule(): Promise<{ morningTime: string | null; eveningTime: string | null }> {
  const { readReportConfig } = await import("@/lib/reports/monday-config");
  const c = await readReportConfig();
  return { morningTime: c?.morningTime ?? null, eveningTime: c?.eveningTime ?? null };
}
/** POST /api/reports/config semantics: settings (persistent) + this process's in-memory schedule (+ local file backup). */
export async function setReportSchedule(morningTime: string, eveningTime: string): Promise<void> {
  if (!TIME_RE.test(morningTime) || !TIME_RE.test(eveningTime)) throw new SystemInputError("פורמט שעה לא תקין — נדרש HH:MM");
  const config = { morningTime, eveningTime };
  const { writeReportConfig } = await import("@/lib/reports/monday-config");
  const { setRuntimeConfig } = await import("@/lib/reports/runtime-config");
  await writeReportConfig(config);
  setRuntimeConfig(config);
  try { const { saveReportConfig } = await import("@/lib/reports/config"); saveReportConfig(config); } catch { /* non-fatal on Railway */ }
}
export type ReportKind = "morning" | "evening" | "weekly";
export async function reportEmailConfigured(): Promise<boolean> { const { isEmailConfigured } = await import("@/lib/reports/email"); return isEmailConfigured(); }
/** POST /api/reports/{morning,evening,weekly} semantics: generate the report and email it to the configured address. */
export async function sendReportNow(kind: ReportKind): Promise<{ subject: string }> {
  const { sendReportEmail, isEmailConfigured } = await import("@/lib/reports/email");
  if (!isEmailConfigured()) throw new SystemInputError("אימייל לא מוגדר");
  let report: { subject: string; html: string };
  if (kind === "weekly") {
    const { generateWeeklyReport } = await import("@/lib/reports/weekly");
    report = await generateWeeklyReport();
  } else {
    const { fetchReportData } = await import("@/lib/reports/data");
    const { getRecommendations } = await import("@/lib/reports/ai");
    const T = await import("@/lib/reports/templates");
    const data = await fetchReportData();
    const recs = await getRecommendations(data, kind);
    report = kind === "morning" ? T.generateMorningReport(data, recs) : T.generateEveningReport(data, recs);
  }
  await sendReportEmail(report as Parameters<typeof sendReportEmail>[0]);
  return { subject: report.subject };
}

// ── Dropbox integration ──
export async function dropboxConnected(): Promise<boolean> {
  const { data, error } = await supabase.from("settings").select("value").eq("key", "dropbox_tokens").maybeSingle();
  if (error) throw new Error(error.message);
  return !!(data?.value as Record<string, unknown> | undefined)?.refresh_token;
}
/** DELETE /api/dropbox/status semantics: revoke (best-effort) and remove the stored token. */
export async function disconnectDropbox(): Promise<void> {
  const { data } = await supabase.from("settings").select("value").eq("key", "dropbox_tokens").maybeSingle();
  const accessToken = (data?.value as Record<string, unknown> | undefined)?.access_token as string | undefined;
  if (accessToken) {
    try { await fetch("https://api.dropboxapi.com/2/auth/token/revoke", { method: "POST", headers: { Authorization: `Bearer ${accessToken}` } }); } catch { /* ignore */ }
  }
  const { error } = await supabase.from("settings").delete().eq("key", "dropbox_tokens");
  if (error) throw new Error(error.message);
}

// ── maintenance lock ──
export async function readMaintenance(): Promise<boolean> { const { getMaintenance } = await import("@/lib/maintenance"); return getMaintenance(); }
export async function setMaintenanceChecked(enabled: boolean): Promise<void> {
  const { error } = await supabase.from("settings").upsert({ key: "maintenance_mode", value: { enabled, updatedAt: new Date().toISOString() } }, { onConflict: "key" });
  if (error) throw new Error(error.message);
}
