/**
 * Universal Action Layer — the Owner's company-level operations: every primitive through the REAL service on fakes
 * (6 standard checks each) + family rules (only the Boss's own notifications; bulk mark-all confirms the count; the
 * Agent Alerts are retired — no alert primitive; goals are KPIs with ₪ / $ only for revenue; a report email is C3 and names the report;
 * disconnect / maintenance repeat their word), pinned vocabularies and the hardened shared writers the routes use.
 * Run with:   npx tsx scripts/test-sunny-act-system.tsx      Pure; never touches production.
 */
import fs from "node:fs";
import path from "node:path";
import { runCases, mkDeps, fullFlow, U, OWNER, type FamilyCase } from "./fixtures/act-harness";
import { planAction } from "../lib/partner/act/service";
import { GOAL_NAME_VALUES, SYSTEM_PRIMITIVES } from "../lib/partner/act/primitives/system";
import { ACTION_REGISTRY } from "../lib/partner/act/registry";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: unknown) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 500)}` : ""}`); } };
const read = (p: string) => fs.readFileSync(path.resolve(__dirname, "..", p), "utf8");

interface W { notes: Record<string, { title: string; readAt: string | null; owner: boolean }>; goals: Record<string, { target: number; currency?: string }>; schedule: { morningTime: string | null; eveningTime: string | null }; emailOk: boolean; sent: string[]; dropbox: boolean; maintenance: boolean }
const world = (): W => ({
  notes: { [U(1)]: { title: "סטיבן העלה גרסה", readAt: null, owner: true }, [U(2)]: { title: "הופעה אושרה", readAt: null, owner: true }, [U(3)]: { title: "של ויקטור", readAt: null, owner: false } },
  goals: { monthlyRevenue: { target: 20000, currency: "₪" }, weeklySessions: { target: 8 }, monthlyVictor: { target: 12 }, monthlyCompletions: { target: 4 } },
  schedule: { morningTime: "08:00", eveningTime: "20:00" }, emailOk: true, sent: [], dropbox: true, maintenance: false,
});
function mk() {
  const w = world(); const calls: string[] = [];
  const own = () => Object.entries(w.notes).filter(([, n]) => n.owner);
  const writers = {
    async readOwnerNotification(id: string) { const n = w.notes[id]; return n && n.owner ? { title: n.title, readAt: n.readAt } : null; },
    async listOwnerUnread() { return own().filter(([, n]) => !n.readAt).map(([id, n]) => ({ id, title: n.title, createdAt: null })); },
    async countOwnerUnread() { return own().filter(([, n]) => !n.readAt).length; },
    async markOwnerNotificationRead(id: string) { calls.push("markOwnerNotificationRead"); if (w.notes[id]?.owner) w.notes[id].readAt = "now"; },
    async markAllOwnerNotificationsRead() { calls.push("markAllOwnerNotificationsRead"); let n = 0; for (const [, x] of own()) if (!x.readAt) { x.readAt = "now"; n++; } return n; },
    async readBusinessGoals() { return JSON.parse(JSON.stringify(w.goals)); },
    async setBusinessGoal(name: string, v: { target: number; currency?: string }) { calls.push("setBusinessGoal"); w.goals[name] = v; },
    async readReportSchedule() { return { ...w.schedule }; },
    async setReportSchedule(m: string, e: string) { calls.push("setReportSchedule"); w.schedule = { morningTime: m, eveningTime: e }; },
    async reportEmailConfigured() { return w.emailOk; },
    async sendReportNow(kind: string) { calls.push("sendReportNow"); w.sent.push(kind); return { subject: `דוח ${kind}` }; },
    async fileStorageConnected() { return w.dropbox; },
    async disconnectFileStorage() { calls.push("disconnectFileStorage"); w.dropbox = false; },
    async readMaintenance() { return w.maintenance; },
    async setMaintenance(e: boolean) { calls.push("setMaintenance"); w.maintenance = e; },
  };
  return { w, calls, writers };
}
const N1 = `notification:${U(1)}`, G1 = "system:goal-monthlyRevenue";
const CASES: FamilyCase<W>[] = [
  { id: "MARK_NOTIFICATIONS_READ", args: { notification: N1 }, bad: { notification: "notification:1" }, missing: { notification: `notification:${U(9)}` }, wrongKind: { notification: G1 }, stale: (w) => { w.notes[U(1)].readAt = "earlier"; }, check: (w) => !!w.notes[U(1)].readAt && !w.notes[U(2)].readAt && !w.notes[U(3)].readAt },
  { id: "MARK_ALL_NOTIFICATIONS_READ", args: {}, confirm: "כן בוס, כל ההתראות", bad: { extra: 1 }, stale: (w) => { w.notes[U(2)].readAt = "x"; }, check: (w) => !!w.notes[U(1)].readAt && !!w.notes[U(2)].readAt && !w.notes[U(3)].readAt },
  { id: "SET_BUSINESS_GOAL", args: { goal: "monthlyRevenue", target: 25000, currency: "₪" }, bad: { goal: "happiness", target: 10 }, stale: (w) => { w.goals.monthlyRevenue.target = 22000; }, check: (w) => w.goals.monthlyRevenue.target === 25000 && w.goals.monthlyRevenue.currency === "₪" },
  { id: "SET_REPORT_SCHEDULE", args: { morningTime: "07:30", eveningTime: "21:00" }, bad: { morningTime: "7:30", eveningTime: "21:00" }, stale: (w) => { w.schedule.morningTime = "09:00"; }, check: (w) => w.schedule.morningTime === "07:30" && w.schedule.eveningTime === "21:00" },
  { id: "SEND_REPORT_NOW", args: { report: "morning" }, confirm: "כן בוס, דוח בוקר", bad: { report: "monthly" }, stale: (w) => { w.emailOk = false; }, check: (w) => w.sent.join() === "morning" },
  { id: "DISCONNECT_DROPBOX", args: {}, confirm: "כן בוס, ניתוק", bad: { force: true }, stale: (w) => { w.dropbox = false; }, check: (w) => !w.dropbox },
  { id: "SET_MAINTENANCE_MODE", args: { enabled: true }, confirm: "כן בוס, נעילה", bad: { enabled: "yes" }, stale: (w) => { w.maintenance = true; }, check: (w) => w.maintenance },
];

(async () => {
  console.log("System — standard checks");
  ok("the case table covers every system primitive", CASES.map((c) => c.id).sort().join() === SYSTEM_PRIMITIVES.map((p) => p.actionId).sort().join());
  await runCases(CASES, mk, ok);

  console.log("\nFamily rules");
  const q = (id: string, args: Record<string, unknown>, h = mk()) => planAction({ intentHe: "x", actionId: id, args }, OWNER, mkDeps(h.writers).d);
  const other = await q("MARK_NOTIFICATIONS_READ", { notification: `notification:${U(3)}` });
  ok("another user's notification is not found — and the refusal lists only the Boss's unread ones", other.status === "ENTITY_NOT_FOUND" && String(other.messageHe).includes(`notification:${U(1)}`) && !String(other.messageHe).includes(U(3)), other.messageHe);
  ok("Agent Alerts retired (2026-10-05): no alert primitive exists", !SYSTEM_PRIMITIVES.some((p) => /ALERT/.test(p.actionId)) && !ACTION_REGISTRY.has("MARK_AGENT_ALERT_HANDLED"));
  ok("a currency only for the revenue goal", (await q("SET_BUSINESS_GOAL", { goal: "weeklySessions", target: 10, currency: "$" })).status === "BAD_ARGS");
  const ne = mk(); ne.w.emailOk = false;
  ok("no report email when the server has no email configured", (await q("SEND_REPORT_NOW", { report: "weekly" }, ne)).status === "NOT_CONFIGURED");
  const m1 = mk(); const r1 = await fullFlow(mkDeps(m1.writers).d, "SEND_REPORT_NOW", { report: "morning" }, "לא");
  ok("\"לא\" is never an approval — no report email", r1.a?.status === "NOT_AN_APPROVAL" && m1.calls.length === 0, r1.a?.status);
  ok("mark-all is BULK (C3); report email C3 with EMAIL; disconnect C3; maintenance C3", ["MARK_ALL_NOTIFICATIONS_READ", "SEND_REPORT_NOW", "DISCONNECT_DROPBOX", "SET_MAINTENANCE_MODE"].every((id) => ACTION_REGISTRY.get(id)!.confirmation === "C3_STRONG_APPROVAL") && ACTION_REGISTRY.get("SEND_REPORT_NOW")!.effects.includes("EMAIL" as never));
  ok("no credential / address argument anywhere in the family", SYSTEM_PRIMITIVES.every((p) => p.meta.args.every((a) => !/token|secret|password|email|address|url/i.test(a.name))));

  console.log("\nVocabularies + shared writers");
  const ws = read("lib/writes/system.ts");
  ok("goal names = lib/agent/goals GOAL_KEYS = lib/writes/system", GOAL_NAME_VALUES.every((g) => read("lib/agent/goals.ts").includes(`"${g}"`)) && ws.includes(`GOAL_NAMES = [${GOAL_NAME_VALUES.map((x) => `"${x}"`).join(", ")}]`));
  ok("the shared system writer has no alert-status writer", !/setAlertStatus|ALERT_STATUSES|agent_alerts/.test(ws));
  ok("the goals route validates every key before writing (no arbitrary goal_<key> settings rows)", /validGoal\(key, body\[key\]\)/.test(read("app/api/agent/goals/route.ts")) && !/updateGoal\(/.test(read("app/api/agent/goals/route.ts")));
  ok("the report / Dropbox / maintenance routes use the shared writers", /setReportSchedule\(/.test(read("app/api/reports/config/route.ts")) && ["morning", "evening", "weekly"].every((k) => read(`app/api/reports/${k}/route.ts`).includes(`sendReportNow("${k}")`)) && /disconnectDropbox\(/.test(read("app/api/dropbox/status/route.ts")) && /setMaintenanceChecked\(/.test(read("app/api/maintenance/route.ts")));
  ok("Owner notifications are bound by OWNER_EMAILS user ids — never the recipient_role echo", /resolveOwnerUserIds/.test(ws) && /in\("recipient_user_id", await ownerIds\(\)\)/.test(ws) && !/\.eq\("recipient_role"/.test(ws));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
