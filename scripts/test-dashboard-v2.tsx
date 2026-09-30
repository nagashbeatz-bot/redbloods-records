/**
 * Dashboard V2 (/dashboard-v2): the pure view in lib/dashboard-v2.ts — Needs-Me dedupe (entity + business reason),
 * the fixed badge order, the today+7 timeline (a calendar event stored on a session / show shows once), the /finance
 * month strip (received = שולם / התקבל only, per currency, never mixed) — and the wiring guards (the old /dashboard
 * untouched, no write of its own, no Sunny write before the DB is approved). No network, no DB.
 * Run with:   npx tsx scripts/test-dashboard-v2.tsx
 */
import fs from "node:fs";
import path from "node:path";
import { buildNeedsMe, buildTimeline, financeMonth, releaseBadge, NEEDS_ME_VISIBLE, STALE_TASKS_KEY } from "../lib/dashboard-v2";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: unknown) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 700)}` : ""}`); } };
const read = (p: string) => fs.readFileSync(path.resolve(__dirname, "..", p), "utf8");

const TODAY = "2026-09-30";
const P1 = "11111111-1111-1111-1111-111111111111";
const PR = "22222222-2222-2222-2222-222222222222";
const CL = "33333333-3333-3333-3333-333333333333";

console.log("Needs-Me — dedupe by entity + reason");
{
  const items = buildNeedsMe({
    today: TODAY,
    cooCases: [
      { id: "c1", entity: { type: "project", id: P1, name: "אלבום" }, title: "אלבום", subtitle: null, tier: "P0", signals: [{ type: "PROJECT_OVERDUE", role: "primary" }], summary: [{ t: "דדליין עבר" }] },
      { id: "c2", entity: { type: "proposal", id: PR.toUpperCase(), name: "לקוח" }, title: "לקוח", subtitle: null, tier: "P0", signals: [{ type: "PROPOSAL_FOLLOWUP_DUE", role: "primary" }], summary: [] },
      { id: "c3", entity: { type: "team", id: "steven", name: "Steven" }, title: "Steven", subtitle: null, tier: "P1", signals: [{ type: "STEVEN_WAITING_OWNER", role: "primary" }], summary: [] },
      { id: "c4", entity: { type: "company", id: "x", name: "חברה" }, title: "חברה", subtitle: null, tier: "P0", signals: [{ type: "EXTERNAL_ALERT", role: "notice" }], summary: [] },
      { id: "c5", entity: { type: "project", id: "p-low", name: "נמוך" }, title: "נמוך", subtitle: null, tier: "P2", signals: [{ type: "PROJECT_DUE_SOON", role: "primary" }], summary: [] },
    ],
    partnerActions: [{ actionId: "a1", actionType: "UPDATE_PROJECT_DEADLINE", state: "SHOW", headlineHe: "להזיז דדליין", projectId: P1, projectName: "אלבום" }],
    integrityQuestions: [{ questionId: "q1", subjectLabel: "שליו", textHe: "מי ה-DJ?" }],
    tasks: [
      { id: "t1", title: "פולואפ", status: "פתוח", due_date: TODAY, notes: `[proposal_id:${PR}] [quote_followup]` },
      { id: "t2", title: "באיחור", status: "פתוח", due_date: "2026-09-20" },
      { id: "t3", title: "עתידי", status: "פתוח", due_date: "2026-10-05" },
      { id: "t4", title: "בוצע", status: "בוצע", due_date: "2026-09-20" },
    ],
    proposals: [{ id: PR, title: "הצעה", status: "צריך פולואפ", amount: 5000, currency: "₪", followup_date: "2026-09-01", client_id: CL, client_name: "לקוח" }],
  });
  const keys = items.map((i) => i.key);
  ok("one item per entity + reason", new Set(keys).size === keys.length, keys);
  const deadline = items.filter((i) => i.entityKey === `project:${P1}`);
  ok("COO overdue + Partner deadline action on the same project → ONE item", deadline.length === 1, deadline);
  ok("…the decision badge wins, both sources kept", deadline[0]?.badge === "החלטה" && deadline[0].sources.includes("coo") && deadline[0].sources.includes("partner-action"), deadline[0]);
  const fu = items.filter((i) => i.entityKey === `proposal:${PR}`);
  ok("proposal rule + a task marked with the same proposal → ONE item (the more canonical source wins the tie)", fu.length === 1 && ["coo", "proposal", "task"].every((x) => fu[0].sources.includes(x)) && fu[0].title === "לקוח", fu);
  ok("…anchored to the earliest date", fu[0]?.date === "2026-09-01", fu[0]?.date);
  ok("…a P0 COO case on the same proposal (any id case) merges too — דחוף wins", fu[0]?.badge === "דחוף" && fu[0].sources.includes("coo"), fu[0]);
  ok("…opens the client drawer", fu[0]?.open.kind === "client" && (fu[0].open as { id: string }).id === CL, fu[0]?.open);
  ok("an empty COO summary falls back to the next source's context (the proposal amount, sensitive)", fu[0]?.context.some((p) => p.s === true), fu[0]?.context);
  ok("overdue task → דחוף", items.find((i) => i.entityKey === "task:t2")?.badge === "דחוף");
  ok("future / closed tasks are not needs", !keys.some((k) => k.startsWith("task:t3") || k.startsWith("task:t4")));
  ok("waiting-owner COO case → ממתין (opens Steven)", items.find((i) => i.entityKey === "team:steven")?.badge === "ממתין" && items.find((i) => i.entityKey === "team:steven")?.open.kind === "href");
  ok("company notices and P2 cases are not needs", !keys.some((k) => k.startsWith("company:") || k.includes("p-low")));
  ok("integrity question → החלטה", items.find((i) => i.entityKey === "integrity:q1")?.badge === "החלטה");
  const order = ["החלטה", "דחוף", "פעולה", "ממתין"];
  ok("fixed badge order", items.every((it, i) => i === 0 || order.indexOf(items[i - 1].badge) <= order.indexOf(it.badge)), items.map((i) => i.badge));
  ok("the screen shows at most 5", NEEDS_ME_VISIBLE === 5);
}

console.log("Needs-Me — old overdue tasks are folded into ONE item (Owner decision 2026-09-30)");
{
  const tasks = [
    { id: "old1", title: "ישנה 1", status: "פתוח", due_date: "2026-06-29", updated_at: "2026-06-20T10:00:00Z" },
    { id: "old2", title: "ישנה 2", status: "פתוח", due_date: "2026-07-01", updated_at: null },
    { id: "old3", title: "ישנה 3", status: "פתוח", due_date: "2026-07-13", updated_at: "garbage" },
    { id: "oldTouched", title: "ישנה שעודכנה", status: "פתוח", due_date: "2026-07-07", updated_at: "2026-09-25T10:00:00Z" },
    { id: "edge14", title: "בדיוק 14", status: "פתוח", due_date: "2026-09-16", updated_at: "2026-09-01T10:00:00Z" },
    { id: "late", title: "באיחור קצר", status: "פתוח", due_date: "2026-09-25", updated_at: "2026-09-01T10:00:00Z" },
    { id: "today", title: "היום", status: "פתוח", due_date: TODAY },
    { id: "oldDone", title: "סגורה", status: "בוצע", due_date: "2026-06-01" },
    { id: "oldFollow", title: "פולואפ ישן", status: "פתוח", due_date: "2026-06-01", notes: `[proposal_id:${PR}]` },
  ];
  const snapshot = JSON.stringify(tasks);
  const items = buildNeedsMe({ today: TODAY, cooCases: [], partnerActions: [], integrityQuestions: [], tasks, proposals: [] });
  const agg = items.find((i) => i.key === STALE_TASKS_KEY);
  const keys = items.map((i) => i.key);
  ok("three old, not-recently-updated tasks → ONE item 'משימות ישנות באיחור (3)'", agg?.title === "משימות ישנות באיחור (3)", agg);
  ok("…none of them appears as its own item", !keys.some((k) => ["task:old1|TASK", "task:old2|TASK", "task:old3|TASK"].includes(k)), keys);
  ok("…the aggregate is always last", keys[keys.length - 1] === STALE_TASKS_KEY, keys);
  ok("…it opens the task modal with all of them (oldest first)", agg?.open.kind === "tasks" && (agg.open as { tasks: { id: string }[] }).tasks.map((t) => t.id).join() === "old1,old2,old3", agg?.open);
  ok("an old task updated within 14 days stays its own item", keys.includes("task:oldtouched|TASK"), keys);
  ok("exactly 14 days overdue is not 'more than 14' → own item", keys.includes("task:edge14|TASK"), keys);
  ok("a short delay and today stay their own items", keys.includes("task:late|TASK") && keys.includes("task:today|TASK"));
  ok("closed tasks never count", !JSON.stringify(agg).includes("oldDone"));
  ok("a proposal follow-up task is never folded (it merges with its proposal)", keys.includes(`proposal:${PR}|FOLLOWUP`), keys);
  ok("display-only: the task input is not changed", JSON.stringify(tasks) === snapshot);
  const many = buildNeedsMe({ today: TODAY, cooCases: [], partnerActions: [], integrityQuestions: [], proposals: [],
    tasks: [...Array.from({ length: 12 }, (_, i) => ({ id: `s${i}`, title: `ישנה ${i}`, status: "פתוח", due_date: "2026-07-01" })),
      { id: "fresh", title: "טרייה", status: "פתוח", due_date: "2026-09-28" }] });
  ok("12 old tasks do not take the first five slots", many.length === 2 && many[0].key === "task:fresh|TASK" && many.slice(0, NEEDS_ME_VISIBLE).filter((i) => i.key !== STALE_TASKS_KEY).length === 1, many.map((i) => i.key));
}

console.log("Needs-Me — failed sources are absent, never invented");
{
  const items = buildNeedsMe({ today: TODAY, cooCases: null, partnerActions: null, integrityQuestions: null, tasks: null, proposals: null });
  ok("all sources failed → empty list (the UI names the failures)", items.length === 0);
}

console.log("Timeline — today + 7 days");
{
  const tl = buildTimeline({
    today: TODAY,
    calendar: [
      { id: "ev-session", title: "סשן (יומן)", startTime: "2026-10-01T12:00:00+03:00" },
      { id: "ev-free", title: "פגישה חיצונית", type: "פגישה", startTime: "2026-10-02T15:00:00+03:00" },
      { id: "ev-far", title: "רחוק", startTime: "2026-10-20T10:00:00+03:00" },
      { id: "ev-allday", title: "כל היום", startTime: "2026-09-30", isAllDay: true },
    ],
    sessions: [
      { id: "s1", project_id: P1, date: "2026-10-01", start_time: "12:00:00", status: "מתוכנן", session_type: "סשן", calendar_event_id: "ev-session" },
      { id: "s2", project_id: P1, date: "2026-10-03", start_time: "10:00:00", status: "מתוכנן", session_type: "צילום קליפ" },
      { id: "s3", project_id: P1, date: "2026-10-03", status: "בוטל", session_type: "סשן" },
    ],
    shows: [{ id: "sh1", name: "הופעה", date: "2026-10-04", status: "מאושר" }, { id: "sh2", name: "בוטלה", date: "2026-10-04", status: "בוטל" }],
    projects: [
      { id: P1, name: "אלבום", artist: "אמן", status: "בעבודה", deadline: "2026-10-06" },
      { id: "p-done", name: "גמור", status: "הושלם", deadline: "2026-10-02" },
      { id: "p-hidden", name: "מוסתר", status: "בעבודה", deadline: "2026-10-02", isHidden: true },
    ],
    tasks: [{ id: "t1", title: "משימה", status: "פתוח", due_date: "2026-10-02" }],
  });
  const keys = tl.map((t) => t.key);
  ok("a calendar event stored on a session shows once (as the session)", !keys.includes("cal:ev-session") && keys.includes("session:s1"), keys);
  ok("an unlinked calendar event is kept", keys.includes("cal:ev-free"));
  ok("outside the window is dropped", !keys.includes("cal:ev-far"));
  ok("a clip shoot session → shoot", tl.find((t) => t.key === "session:s2")?.kind === "shoot");
  ok("cancelled sessions / shows are dropped", !keys.includes("session:s3") && !keys.includes("show:sh2"));
  ok("closed / hidden project deadlines are dropped", keys.includes(`deadline:${P1}`) && !keys.includes("deadline:p-done") && !keys.includes("deadline:p-hidden"));
  ok("sorted by date then time", tl.every((t, i) => i === 0 || tl[i - 1].date <= t.date), keys);
  ok("an all-day event has no time", tl.find((t) => t.key === "cal:ev-allday")?.time === null);
}

console.log("Finance strip — the /finance month formula");
{
  const now = new Date(2026, 8, 15);
  const lines = financeMonth([
    { type: "income", payment_status: "שולם", amount: 1000, currency: "₪", date: "2026-09-02" },
    { type: "income", payment_status: "התקבל", amount: 500, currency: "₪", date: "2026-09-30" },
    { type: "income", payment_status: "צפוי", amount: 300, currency: "₪", date: "2026-09-10" },
    { type: "income", payment_status: "לא שולם", amount: 200, currency: "₪", date: "2026-09-10" },
    { type: "income", payment_status: "בוטל", amount: 9999, currency: "₪", date: "2026-09-10" },
    { type: "income", payment_status: "שולם", amount: 7777, currency: "₪", date: "2026-08-31" },
    { type: "expense", payment_status: "צפוי", amount: 400, currency: "₪", date: "2026-09-11" },
    { type: "expense", payment_status: "שולם", amount: 50, currency: "₪", date: "2026-09-11" },
    { type: "income", payment_status: "התקבל", amount: 100, currency: "$", date: "2026-09-12" },
    { type: "expense", payment_status: "צפוי", amount: 200, currency: "$", date: "2026-09-12" },
  ], now);
  const ils = lines.find((l) => l.currency === "₪");
  const usd = lines.find((l) => l.currency === "$");
  ok("received = שולם / התקבל only (this month)", ils?.received === 1500, ils);
  ok("expected never counts as received; בוטל counts nowhere", ils?.expected === 500, ils);
  ok("payable = expected expenses", ils?.payable === 400, ils);
  ok("$ is its own line, never added to ₪", usd?.received === 100 && usd.payable === 200 && ils!.received === 1500, lines);
}

console.log("Release badge");
ok("types → badge", releaseBadge("שיר") === "סינגל" && releaseBadge("שיר + קליפ") === "סינגל" && releaseBadge("EP") === "EP" && releaseBadge("אלבום") === "אלבום");

console.log("Wiring");
{
  const page = read("components/dashboard-v2/DashboardV2.tsx");
  const lib = read("lib/dashboard-v2.ts");
  ok("the current /dashboard still renders the old dashboard", read("app/dashboard/page.tsx").includes("DashboardDesignPreview") && !read("app/dashboard/page.tsx").includes("DashboardV2"));
  ok("/dashboard-v2 wraps the same AppShell", read("app/dashboard-v2/page.tsx").includes("<AppShell>"));
  const writes = [...page.matchAll(/fetch\("([^"]+)",\s*\{\s*method:\s*"(POST|PATCH|PUT|DELETE)"/g)].map((m) => `${m[2]} ${m[1]}`);
  ok("V2's ONLY own write is 'עדכון לסאני' (POST /api/sunny/inbox)", writes.length === 1 && writes[0] === "POST /api/sunny/inbox", writes);
  ok("…with a per-text requestKey (a retry / double click reuses it)", page.includes("crypto.randomUUID()") && page.includes("requestKey: sunnyKey.current.key"));
  ok("…and it never writes the table directly", !/from\("sunny_owner_inbox"\)/.test(page));
  ok("no push / agent-alert / calendar-write call", !/\/api\/push|\/api\/agent\/alerts|create-event|create-task/.test(page));
  ok("the calendar read failure is never shown as empty", page.includes("זה לא יומן ריק"));
  ok("money reuses calcPeriodStats (no second rule)", lib.includes("calcPeriodStats(") && !/payment_status\s*===/.test(lib));
  ok("the registry knows the surface", read("lib/partner/system/registry.ts").includes('"/dashboard-v2"'));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
