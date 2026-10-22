/**
 * Tests — "מה קרה אתמול?" + the morning brief (Owner request 2026-10-22, from the 22.10 conversation with Sunny).
 * Pure, in-memory fixtures; never touches production.
 *   A  a payment marked after midnight (00:40) belongs to the new day, never to "yesterday"
 *   B  a typed payment date different from the last update — two labelled facts, never "paid at"
 *   C  a record edited after it was paid — LAST_UPDATED is an observation, never the payment time
 *   D  "what happened yesterday" with several kinds of activity, each with its time kind
 *   E  no exact status-change time — said (notRecorded / mix_view money.timing), never inferred
 *   F  a payment-date fix through Sunny: preview old → new, no push when already paid, the paid Finance row's date stays
 *   G  the brief: fresh line, ONE social line, payment + task = ONE money line, ≤3 moves
 *   H  critical info is never cut by the 3-move limit; instructions + contracts
 *
 * Run with:   npx tsx scripts/test-sunny-day-activity.tsx
 */
import type { GatewaySources } from "../lib/partner/gateway/core";
import { dayActivity, finishDay, israelYesterday, DAY_NOT_RECORDED_HE, type DayActivity } from "../lib/partner/sunny/day-activity";
import { deriveWithActionHistory, historyDerivationFor } from "../lib/partner/sunny/with-history";
import { buildMixWork } from "../lib/partner/mix/view";
import { MIX_PRIMITIVES } from "../lib/partner/act/primitives/mix";
import { ACTION_REGISTRY } from "../lib/partner/act/registry";
import { motionAnswerHe } from "../lib/partner/coo/motion";
import { buildCooView } from "../lib/partner/coo/priorities";
import { SERVER_INSTRUCTIONS } from "../lib/integrations/partner-mcp/mcp";
import { KNOWLEDGE_GAPS } from "../lib/partner/system/gaps";
import { DOMAIN_CONTRACTS } from "../lib/partner/system/registry";
import { PARTNER_KNOWLEDGE_REGISTRY } from "../lib/partner/knowledge/catalog";
import { queryKnowledgeCore } from "../lib/partner/knowledge/query";
import { src as motionSrc, K, P_KESEF, P_YAHALOM, U } from "./fixtures/motion-company";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: unknown) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 900)}` : ""}`); } };
const section = (t: string) => console.log(`\n${t}`);

const P1 = U(501), P2 = U(502), W1 = U(511), W2 = U(512), W3 = U(513), V1 = U(521);
const S = <T,>(rows: T[]) => ({ rows, capped: false });
const work = (id: string, projectId: string, o: Record<string, unknown>) => ({ id, projectId, engineerName: "Steven", notes: null, hasFilesLink: false, sortOrder: 0, createdAt: "2026-09-01T10:00:00Z", updatedAt: null, workTitle: null, workType: "מיקס + מאסטר", status: "אושר", agreedPrice: 550, currency: "$", amountPaid: 0, sentDate: null, internalDeadline: null, linkedTransactionId: null, paymentDate: null, ...o });

function fixture(o: { works?: unknown[]; versions?: unknown[]; victor?: unknown[]; sessions?: unknown[]; tasks?: unknown[]; txs?: unknown[]; content?: unknown[]; inbox?: unknown[] } = {}): GatewaySources {
  const det = { projects: S([]), financeNotes: S([]), deliveries: S([]), actions: S([]), sessions: S(o.sessions ?? []), meetings: S([]), tasks: S(o.tasks ?? []), engineerWork: S(o.works ?? []), mixVersions: S(o.versions ?? []), mixComments: S([]), commentAttachments: S([]),
    mixTargets: S([]), mixTargetNotes: S([]), finalFiles: S([]), victor: S(o.victor ?? []), productions: S([]), budgetItems: S([]), albumTracks: S([]), clipItems: S([]), proposals: S([]), releases: S([]), campaigns: S([]), contentItems: S([]), socialFiles: S([]),
    projectSettings: S([]), transactionsText: S([]), budgetPayments: S([]), notifications: S([]) };
  const ops = { projectsMeta: S([]), contentItems: S(o.content ?? []) };
  const index = { [P1]: { id: P1, name: "EP - 3 SONGS" }, [P2]: { id: P2, name: "כסף" } };
  return {
    now: new Date("2026-10-22T07:00:00Z"),
    state: { status: "OK", value: { domains: { projects: { data: { index, open: [] } } } } } as never,
    projectDetail: { status: "OK", value: det } as never,
    operations: { status: "OK", value: ops } as never,
    finance: { status: "OK", value: { raw: { transactions: o.txs ?? [], shows: [] } } } as never,
    ownerInbox: { status: "OK", value: o.inbox ?? [] } as never,
  };
}
const tx = (id: string, o: Record<string, unknown>) => ({ id, projectId: P1, type: "expense", date: null, amount: 550, currency: "$", status: "שולם", category: "מיקס / מאסטר", scope: null, expenseScope: null, linkedSessionId: null, createdAt: "2026-09-28T09:00:00Z", description: "מיקס + מאסטר · EP - 3 SONGS", ...o });
const kinds = (a: DayActivity) => ({ happened: a.happened.map((e) => e.kind), dated: a.dated.map((e) => e.kind), last: a.lastUpdated.map((e) => e.kind) });

async function main() {
  section("A. PAID AFTER MIDNIGHT (22.10 00:40 Israel = 21.10 21:40Z) — never yesterday");
  const fxA = fixture({ works: [work(W1, P1, { amountPaid: 550, paymentDate: "2026-10-22", updatedAt: "2026-10-21T21:40:00Z", linkedTransactionId: "t1" })], txs: [tx("t1", { date: "2026-10-22" })] });
  const y = dayActivity(fxA, "2026-10-21"), t = dayActivity(fxA, "2026-10-22");
  ok("A1. yesterday (21.10) has no payment, no update and no Finance date", ![...y.happened, ...y.dated, ...y.lastUpdated].some((e) => e.entity === `mix-work:${W1}` || e.entity === "transaction:t1"), kinds(y));
  ok("A2. 22.10: the payment is a TYPED date (ENTERED_DATE), not something that 'happened'", t.dated.some((e) => e.kind === "ENGINEER_PAYMENT_DATE" && e.timeKind === "ENTERED_DATE") && !t.happened.some((e) => e.entity === `mix-work:${W1}`), kinds(t));
  ok("A3. 22.10: the work's last update is an OBSERVATION at 00:40 Israel time", t.lastUpdated.some((e) => e.entity === `mix-work:${W1}` && e.time === "00:40" && e.epistemic === "OBSERVATION"), t.lastUpdated);
  ok("A4. the Finance row's date is said with its creation day (28.09) — never 'paid on 28.09'", t.dated.some((e) => e.kind === "TRANSACTION_DATE" && /השורה נוצרה ב-28\.09/.test(e.he) && /מתי הסטטוס שונה — לא נרשם/.test(e.he)));
  ok("A5. israelYesterday(22.10 07:00Z) = 2026-10-21; (21.10 22:30Z = 22.10 01:30 Israel) → 2026-10-21", israelYesterday(new Date("2026-10-22T07:00:00Z")) === "2026-10-21" && israelYesterday(new Date("2026-10-21T22:30:00Z")) === "2026-10-21");

  section("B. TYPED PAYMENT DATE ≠ LAST UPDATE — two labelled facts");
  const fxB = fixture({ works: [work(W2, P1, { amountPaid: 550, paymentDate: "2026-10-20", updatedAt: "2026-10-22T10:00:00Z" })] });
  const b20 = dayActivity(fxB, "2026-10-20"), b22 = dayActivity(fxB, "2026-10-22");
  ok("B1. 20.10 carries the typed payment date only", b20.dated.some((e) => e.kind === "ENGINEER_PAYMENT_DATE") && b20.lastUpdated.length === 0);
  ok("B2. 22.10 carries only 'updated last' — never the payment", b22.lastUpdated.some((e) => e.entity === `mix-work:${W2}`) && !b22.dated.some((e) => e.kind === "ENGINEER_PAYMENT_DATE") && !b22.happened.length, kinds(b22));
  ok("B3. the update line says it is not necessarily the moment it was marked paid", b22.lastUpdated.every((e) => /לא בהכרח רגע סימון התשלום/.test(e.he)));

  section("C. EDITED AFTER IT WAS PAID — LAST_UPDATED never becomes the payment time");
  const fxC = fixture({ works: [work(W3, P2, { amountPaid: 200, agreedPrice: 200, paymentDate: "2026-10-15", updatedAt: "2026-10-21T09:00:00Z" })] });
  const c21 = dayActivity(fxC, "2026-10-21");
  ok("C1. the later edit day shows ONLY an observation (no payment, no 'happened')", c21.happened.length === 0 && c21.dated.length === 0 && c21.lastUpdated.length === 1, kinds(c21));
  ok("C2. the observation is labelled 'עריכה כלשהי' — never 'שולם'", /עריכה כלשהי/.test(c21.lastUpdated[0]?.he ?? "") && !/שולם ב/.test(c21.lastUpdated[0]?.he ?? ""));

  section("D. WHAT HAPPENED YESTERDAY — several kinds, each with its time kind");
  const fxD = fixture({
    works: [work(W1, P2, { status: "חזר" })],
    versions: [{ id: "v1", workId: W1, projectId: P2, label: "V3", uploadedAt: "2026-10-21T15:30:00Z", createdAt: "2026-10-21T15:30:00Z" }, { id: "v2", workId: W1, projectId: P2, label: "V4", uploadedAt: "2026-10-21T22:10:00Z", createdAt: "2026-10-21T22:10:00Z" }],
    victor: [{ id: V1, projectId: P1, title: "סוד", notes: null, briefText: null, references: [], reviews: [{ version: "v2", status: null, notes: null, sentNotes: "x", sentAt: "2026-10-21T08:00:00Z", draft: false, reviewedAt: null }], filesSent: [], filesReceived: [{ name: "a.wav", uploadedAt: "2026-10-20T10:00:00Z", category: null, versionLabel: "v2", trackId: null, durationSeconds: null, size: null, path: null, hasShareLink: false, fromMixVersionId: null, structureMarkers: 0 }], briefFiles: [], returnedDate: null, outcome: null, quality: null, enteredProject: null, dropboxFolder: null, hasFolderLink: false, createdAt: "2026-09-01T10:00:00Z" }],
    sessions: [{ id: "s1", projectId: null, showId: null, date: "2026-10-21", startTime: "19:00", endTime: "21:00", status: "התקיים", type: "סשן", statusSource: "MANUAL", statusChangedAt: "2026-10-21T19:30:00Z", title: null, notes: null, location: null, photographer: null, cost: null, hasCalendarEvent: false, createdAt: "2026-10-18T10:00:00Z" }],
    tasks: [{ id: "k1", relatedType: null, relatedId: null, title: "לשלם גז", notes: null, status: "פתוח", dueDate: "2026-10-21", startTime: null, endTime: null, showId: null, hasGoogleTask: false, createdAt: "2026-10-21T06:00:00Z", updatedAt: "2026-10-21T06:00:00Z" }],
    txs: [tx("t9", { type: "income", amount: 2000, currency: "₪", status: "התקבל", date: "2026-10-21", createdAt: "2026-10-21T11:00:00Z", description: "מזומן" })],
    content: [{ id: "c1", title: "עובדים על הבית השני", status: "draft", dueDate: "2026-10-21", publishDate: null, campaignId: null, contentType: "reel", platform: "instagram" }, { id: "c2", title: "פורסם", status: "published", dueDate: "2026-10-20", publishDate: "2026-10-21", campaignId: null, contentType: "story", platform: "instagram" }],
    inbox: [{ id: "n1", createdAt: "2026-10-21T20:00:00Z", body: "עדכון קטן" }],
  });
  const d = dayActivity(fxD, "2026-10-21");
  const k = kinds(d);
  ok("D1. the version uploaded 18:30 Israel is in 'happened' with its exact time", d.happened.some((e) => e.kind === "MIX_VERSION" && e.time === "18:30" && e.timeKind === "EVENT_TIME"), d.happened);
  ok("D2. the version uploaded 01:10 Israel on 22.10 is NOT yesterday", d.happened.filter((e) => e.kind === "MIX_VERSION").length === 1);
  ok("D3. notes sent to Victor (EVENT_TIME), a task created (RECORDED_AT), Finance income recorded (RECORDED_AT), the session's status change (STATUS_CHANGED)", ["VICTOR_NOTES", "TASK_CREATED", "TRANSACTION_CREATED", "SESSION_STATUS", "OWNER_UPDATE"].every((x) => k.happened.includes(x)), k);
  ok("D4. a Victor upload of 20.10 is not yesterday", !k.happened.includes("VICTOR_UPLOAD"));
  ok("D5. typed dates: the session date, the missed social item, the published one, the task due — in 'dated' (not 'happened')", ["SESSION_DATE", "SOCIAL_MISSED", "SOCIAL_PUBLISHED", "TASK_DUE"].every((x) => k.dated.includes(x)), k);
  ok("D6. a transaction created AND dated that day is told once (no duplicate typed-date line)", !k.dated.includes("TRANSACTION_DATE"));
  ok("D7. 'happened' is in time order", d.happened.every((e, i, a) => i === 0 || (a[i - 1].at ?? "") <= (e.at ?? "")));
  ok("D8. a manually recorded session says so; summary leads with real work events", /סומן על ידך/.test(d.dated.find((e) => e.kind === "SESSION_DATE")?.he ?? "") && d.summaryHe.startsWith("התרחש"), d.summaryHe);
  const withActs = finishDay(d.day, [...d.happened, ...d.dated, ...d.lastUpdated], d.unread, [{ planId: "pl_1", at: "2026-10-21T09:15:00Z", outcome: "EXECUTED", steps: [{ actionId: "SCHEDULE_SESSION", entity: "session:new", outcome: "APPLIED_AS_EXPECTED" }] }, { planId: "pl_2", at: "2026-10-20T09:15:00Z", outcome: "EXECUTED", steps: [{ actionId: "CREATE_TASK", entity: "task:new", outcome: "APPLIED_AS_EXPECTED" }] }]);
  ok("D9. the connector adds Sunny's executed actions of THAT Israel day only", withActs.happened.filter((e) => e.kind === "SUNNY_ACTION").length === 1 && withActs.actions.status === "READ");
  ok("D10. without the history: said 'not checked', never 'nothing done'", d.actions.status === "NOT_READ" && /לא נבדקו/.test(d.summaryHe));
  const unreadFx = fixture(); (unreadFx as { projectDetail: unknown }).projectDetail = { status: "UNAVAILABLE", reason: "x" };
  ok("D11. an unread source is UNKNOWN in the answer, never 'nothing happened'", /לא נקרא/.test(dayActivity(unreadFx, "2026-10-21").summaryHe));

  section("E. NO EXACT STATUS-CHANGE TIME — said, never inferred");
  ok("E1. notRecorded names the payment-marked time, task done time and project status time", DAY_NOT_RECORDED_HE.some((x) => /סומן 'שולם'/.test(x)) && DAY_NOT_RECORDED_HE.some((x) => /בוצע/.test(x)) && DAY_NOT_RECORDED_HE.some((x) => /סטטוס פרויקט/.test(x)) && d.notRecorded.length === DAY_NOT_RECORDED_HE.length);
  const mixSrc = motionSrc();
  const mrow = (mixSrc.projectDetail as { value: { engineerWork: { rows: Array<Record<string, unknown>> } } }).value.engineerWork.rows[0];
  Object.assign(mrow, { agreedPrice: 550, amountPaid: 550, currency: "$", paymentDate: "2026-10-22", updatedAt: "2026-10-21T21:40:00Z" });
  const mw = buildMixWork(mixSrc, mrow as never);
  const timing = (mw.money as unknown as { timing: Record<string, { kind: string; value: unknown; israel?: string | null }> }).timing;
  ok("E2. mix_view money.timing: payment date = ENTERED_DATE, work update = LAST_UPDATED (22.10 00:40 Israel), expense created = RECORDED_AT", timing.paymentDate.kind === "ENTERED_DATE" && timing.workLastUpdatedAt.kind === "LAST_UPDATED" && timing.workLastUpdatedAt.israel === "22.10 00:40" && (timing.expenseCreatedAt === null || timing.expenseCreatedAt.kind === "RECORDED_AT"), timing);
  ok("E3. paidMarkedAt is NOT_RECORDED with the registered gap", timing.paidMarkedAt.kind === "NOT_RECORDED" && timing.paidMarkedAt.value === null && KNOWLEDGE_GAPS.some((g) => g.id === "MIX_PAYMENT_MARKED_AT_NOT_RECORDED" && g.class === "DATA_NOT_RECORDED" && g.status === "DATA_NOT_RECORDED"));

  section("F. FIXING A PAYMENT DATE THROUGH SUNNY — preview, approval, the true limit");
  const pay = MIX_PRIMITIVES.find((p) => p.actionId === "RECORD_ENGINEER_PAYMENT")!;
  const cur = { engineerName: "Steven", agreedPrice: 550, currency: "$", amountPaid: 550, paymentDate: "2026-10-22", expenseStatus: "שולם" };
  const args = { mixWork: `mix-work:${W1}`, paid: true, paymentDate: "2026-10-21" };
  const plan = pay.plan(args, cur) as { ok: boolean; after?: Record<string, unknown> };
  const warn = pay.warnings!(cur, args);
  ok("F1. the plan shows current → new payment date (old value read, new value typed)", plan.ok && plan.after?.paymentDate === "2026-10-21", plan);
  ok("F2. already paid: the preview says date-only, NO push, and the paid Finance row keeps its date", warn.some((w) => /תיקון תאריך התשלום בעבודה בלבד: 2026-10-22 → 2026-10-21; לא יישלח Push/.test(w)) && warn.some((w) => /התאריך שלה לא ישתנה/.test(w)) && !warn.some((w) => /Push 'התשלום אושר' נשלח/.test(w)), warn);
  ok("F3. a first payment of Steven still warns about his push", pay.warnings!({ ...cur, amountPaid: 0, paymentDate: null, expenseStatus: null }, { ...args, paymentDate: "2026-10-22" }).some((w) => /Push 'התשלום אושר'/.test(w)));
  ok("F4. the approval binds the exact new date (requiredValues)", (pay.requiredValues!(args, plan.after!) as string[]).includes("2026-10-21"));
  const reg = ACTION_REGISTRY.get("RECORD_ENGINEER_PAYMENT");
  ok("F5. the action is registered as Sunny-executable (after the Boss's approval)", !!reg && reg.availability === "SUNNY_EXECUTABLE", reg?.availability);
  const fin = DOMAIN_CONTRACTS.find((x) => x.id === "FINANCE")!;
  ok("F6. the Finance limitation no longer says 'only through its screen'", fin.limitationsHe.some((l) => /פעולת סאני של אותו תחום/.test(l) && /RECORD_ENGINEER_PAYMENT/.test(l)) && !fin.limitationsHe.some((l) => /— רק דרך המסך שלה\.$/.test(l)));

  section("G. THE BRIEF — fresh line, ONE social line, payment + task = ONE line, ≤3 moves");
  const s0 = motionSrc();
  const det0 = (s0.projectDetail as { value: Record<string, { rows: unknown[] }> }).value;
  const ops0 = (s0.operations as { value: Record<string, { rows: unknown[] } | undefined> }).value;
  // the fixture's "today" is 2026-10-05: a version uploaded yesterday on a project with no greeting move
  const kesefWork = (det0.engineerWork.rows as Array<{ id: string; projectId: string | null }>).find((w) => w.projectId === P_KESEF) ?? (det0.engineerWork.rows as Array<{ id: string }>)[0];
  det0.mixVersions.rows.push({ id: "fresh-v", workId: kesefWork.id, projectId: P_KESEF, label: "V9", uploadedAt: "2026-10-04T15:30:00Z", createdAt: "2026-10-04T15:30:00Z", status: null } as never);
  ops0.contentItems = { rows: [1, 2, 3, 4, 5, 6].map((n) => ({ id: `sc${n}`, title: `t${n}`, status: "draft", dueDate: `2026-10-0${n % 3 + 1}`, publishDate: null, campaignId: null, contentType: "story", platform: "instagram" })) } as never;
  const m = buildCooView(s0).motion;
  ok("G1. ≤3 greeting moves", m.greeting.length <= 3);
  ok("G2. a version uploaded yesterday is in motion.fresh and in the answer", !!m.fresh.lineHe && /חדש מאתמול/.test(m.fresh.lineHe) && /V9/.test(m.fresh.lineHe) && m.answerHe.includes(m.fresh.lineHe), m.fresh);
  ok("G3. social = ONE line with the count and the range — never the titles", !!m.social.lineHe && /6 תכנים באיחור/.test(m.social.lineHe) && /01\.10–03\.10/.test(m.social.lineHe) && !/t1|t2/.test(m.social.lineHe) && m.answerHe.split("\n").filter((l) => l.startsWith("סושיאל")).length === 1, m.social);
  const greetProject = m.greeting[0]?.entity;
  if (greetProject) {
    const s1 = motionSrc();
    const d1 = (s1.projectDetail as { value: Record<string, { rows: unknown[] }> }).value;
    const w1 = (d1.engineerWork.rows as Array<{ id: string; projectId: string | null }>).find((w) => `project:${w.projectId}` === greetProject);
    if (w1) d1.mixVersions.rows.push({ id: "dup-v", workId: w1.id, projectId: w1.projectId, label: "VX", uploadedAt: "2026-10-04T15:30:00Z", createdAt: "2026-10-04T15:30:00Z", status: null } as never);
    ok("G4. a fresh event on a project a greeting move already carries is not repeated", !(buildCooView(s1).motion.fresh.lineHe ?? "").includes("VX"));
  }
  const answer = motionAnswerHe({ greeting: [{ he: "1" }, { he: "2" }, { he: "3" }], week: { lineHe: "w", heavyToday: false, opportunity: null }, ownerBottleneck: { lineHe: "ויקטור: 29 גרסאות…" }, inbox: { lineHe: null }, more: 0,
    fresh: { lineHe: "חדש מאתמול: Steven העלה גרסה ל\"כסף\" (אתמול 18:30)" }, social: { lineHe: "סושיאל: 6 תכנים באיחור" },
    financial: { surprises: [], overdueAsks: ["הוצאה צפויה ₪4,060 (13.10)", "הוצאה צפויה ₪569 (15.10)"], overdueTasks: ["\"לשלם שכר דירה ₪4,060 ואקו\"ם ₪569\" (19.10)"], coverageHe: "לפי התזרים הרשום במערכת" } });
  const moneyLines = answer.split("\n").filter((l) => /4,060/.test(l));
  ok("G5. the overdue payment and its open task are ONE line", moneyLines.length === 1 && /אותו עניין כמו המשימה הפתוחה/.test(moneyLines[0]), moneyLines);
  ok("G6. the curated Victor line, not a bare count", answer.includes("ויקטור: 29 גרסאות…"));

  section("H. CRITICAL INFO SURVIVES THE LIMIT; instructions; the capability");
  ok("H1. the fresh line sits right after the moves (never cut by the 3-move limit)", answer.split("\n")[4]?.startsWith("חדש מאתמול"), answer.split("\n"));
  ok("H2. instructions: the brief is built FROM motion, never a private template; critical never dropped", /THE MORNING BRIEF \/ GREETING IS BUILT FROM motion/.test(SERVER_INSTRUCTIONS) && /A critical or unusual item is never dropped to keep three/.test(SERVER_INSTRUCTIONS));
  ok("H3. instructions: 'what happened' → coo mode day; typed date ≠ when it happened; after midnight = new day", /coo mode day/.test(SERVER_INSTRUCTIONS) && /never "זה קרה ב-X"/.test(SERVER_INSTRUCTIONS) && /A stamp after midnight belongs to the new day/.test(SERVER_INSTRUCTIONS));
  ok("H4. instructions: answer first, never send him to a screen for what Sunny can prepare, state the TRUE limit", /the first sentence answers his exact question/.test(SERVER_INSTRUCTIONS) && /never send him to a screen for something you can prepare/.test(SERVER_INSTRUCTIONS));
  ok("H5. the connector applies the action history to coo day", historyDerivationFor({ tool: "partner_query", capability: "coo", mode: "day" }) === "day");
  const r = queryKnowledgeCore(PARTNER_KNOWLEDGE_REGISTRY, { capability: "coo", mode: "day", params: { date: "2026-10-04" } }, s0 as never, { channel: "INTERNAL", ownerAuthorized: true });
  const served = r as unknown as { status?: string; summary?: Array<{ code: string; value: unknown }>; items?: unknown[] };
  ok("H6. coo mode day is served (DAY + ANSWER + NOT_RECORDED facts)", ["DAY", "ANSWER", "NOT_RECORDED"].every((c) => served.summary?.some((x) => x.code === c)), { status: served.status, codes: served.summary?.map((x) => x.code), err: (r as unknown as { error: unknown }).error, missing: (r as unknown as { missing: unknown }).missing });
  const derived = deriveWithActionHistory("day", served as unknown as Record<string, unknown>, [{ planId: "pl_1", at: "2026-10-04T09:15:00Z", outcome: "EXECUTED", steps: [{ actionId: "SCHEDULE_SESSION", entity: "session:new", outcome: "APPLIED_AS_EXPECTED" }] }], Date.parse("2026-10-05T07:00:00Z"));
  const dDay = (derived.summary as Array<{ code: string; value: DayActivity }>).find((x) => x.code === "DAY")?.value;
  ok("H7. with the history the day answer gains the executed action", dDay?.actions.status === "READ" && dDay.happened.some((e) => e.kind === "SUNNY_ACTION"), dDay?.actions);
  ok("H8. the served day (fixture 04.10) carries the fresh version V9 at 18:30 Israel", !!dDay && dDay.happened.some((e) => e.kind === "MIX_VERSION" && /V9/.test(e.he) && e.time === "18:30"));
  void K; void P_YAHALOM;

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
