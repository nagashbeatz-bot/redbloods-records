/**
 * NEEDS ME — Sunny-curated "מה צריך ממני היום" (Owner decision 2026-10-01, Q1–Q5), over a Gateway source set:
 * the ball comes only from the records (computeVictorBall / engineerHandoff / the send log); a task inherits the ball of
 * what it is linked to; the Owner's processed update only enriches (records win, a contradiction is shown); at most 5,
 * never filled; backlog / undecided / unchecked are never silently dropped; the capability is read-only and the
 * dashboard reads it through the Owner-only knowledge route.
 * Run with:   npx tsx scripts/test-needs-me-curation.tsx      Pure; never touches production.
 */
import fs from "node:fs";
import path from "node:path";
import type { GatewaySources } from "../lib/partner/gateway/core";
import { buildNeedsMe, NEEDS_ME_MAX, OWNER_TASK_GRACE_DAYS } from "../lib/partner/needs-me/curate";
import { PARTNER_KNOWLEDGE_REGISTRY } from "../lib/partner/knowledge/catalog";
import { queryKnowledgeCore } from "../lib/partner/knowledge/query";
import type { InboxInterpretation, InboxMemory } from "../lib/inbox-memory";
import { parseBoard } from "../components/dashboard-v2/DashboardV2";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: unknown) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 900)}` : ""}`); } };
const read = (p: string) => fs.readFileSync(path.resolve(__dirname, "..", p), "utf8");
const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const TODAY = "2026-10-01";
const P_VIC_AWAY = U(10), P_VIC_OWNER = U(11), P_MIX = U(12), P_SEND = U(13);

// ── fixtures ──
const vFile = (at: string, v = "v1") => ({ name: `${v}.wav`, uploadedAt: at, versionLabel: v, durationSeconds: null, size: null, hasShareLink: false, path: null, uploadedBy: "victor" });
const victorRow = (id: string, projectId: string, o: { uploads: string[]; notes: string[]; task?: string | null; drafts?: number }) => ({
  id, projectId, vendorName: "victor", title: null, status: "פעיל", workState: null, sentDate: "2026-09-01", internalDeadline: "2026-09-17", linkedTaskId: o.task ?? null,
  notes: null, briefText: null, references: [], filesSent: o.uploads.map((t, i) => vFile(t, `v${i + 1}`)), filesReceived: [], briefFiles: [],
  reviews: [...o.notes.map((t, i) => ({ version: `v${i + 1}`, sentAt: t, draft: false, notes: "x", sentNotes: "x", status: "waiting" })),
    ...Array.from({ length: o.drafts ?? 0 }, () => ({ version: null, sentAt: null, draft: true, notes: "טיוטה", sentNotes: null, status: "waiting" }))],
  returnedDate: null, outcome: null, quality: null, enteredProject: null, dropboxFolder: null, hasFolderLink: false, createdAt: null, updatedAt: null,
});
const task = (id: string, title: string, due: string, o: { relatedType?: string; relatedId?: string | null; notes?: string | null } = {}) => ({
  id, relatedType: o.relatedType ?? "general", relatedId: o.relatedId ?? null, title, notes: o.notes ?? null, status: "פתוח", dueDate: due, startTime: null, endTime: null, showId: null, hasGoogleTask: false, createdAt: null, updatedAt: null,
});
const interp = (id: string, entityKey: string, o: Partial<InboxInterpretation> = {}): InboxInterpretation => ({
  id, seq: 1, itemId: U(900), linkId: U(901), entityKey, whatHappened: "חיים אוהב את המיקס, נשארו 2 תיקונים", completed: [], openGaps: ["2 תיקונים"], blockers: [],
  ballWith: "OWNER", inferredNextStep: "לסגור 2 תיקוני מיקס", confidence: "HIGH", epistemic: "HYPOTHESIS", source: "OWNER_REPORTED_DERIVED",
  basisStatus: "במיקס", basisBall: "ENGINEER", basisEventAt: "2026-09-28T10:00:00Z", supersedesId: null, supersedeKind: null, supersedeReason: null,
  createdAt: "2026-10-01T08:00:00Z", retractedAt: null, retractedReason: null, ...o,
});

interface Opts {
  victor?: unknown[]; engineer?: unknown[]; versions?: unknown[]; comments?: unknown[]; tasks?: unknown[]; actionsLog?: unknown[];
  proposals?: unknown[]; partnerActions?: unknown[] | null; integrityQs?: unknown[] | null; shows?: unknown[] | null; memory?: InboxMemory | null;
  det?: boolean; mixProjectStatus?: string;
}
function src(o: Opts = {}): GatewaySources {
  const index: Record<string, unknown> = {
    [P_VIC_AWAY]: { name: "מעברים", status: "בהפקה", artistText: "אבי מולה", businessType: "לייבל" },
    [P_VIC_OWNER]: { name: "לא מאמינה", status: "בהפקה", artistText: "אבי מולה", businessType: "לייבל" },
    [P_MIX]: { name: "קרוב אלייך", status: o.mixProjectStatus ?? "במיקס", artistText: "חיים באינסאי", businessType: "לקוח" },
    [P_SEND]: { name: "שיר שנשלח", status: "בעבודה", artistText: "X", businessType: "לקוח" },
  };
  const state = {
    todayIL: TODAY,
    domains: {
      projects: { data: { index, open: [] } }, clients: { data: { items: [] } }, labelArtists: { data: { items: [] } }, victor: { data: { active: [] } }, shows: { data: { items: [] } },
      sessions: { data: { items: [] } }, releasesFull: { data: { items: [] } }, proposalsFull: { data: { items: o.proposals ?? [] } }, tasksFull: { data: { items: [] } },
    },
  };
  const det = {
    victor: { rows: o.victor ?? [], capped: false }, engineerWork: { rows: o.engineer ?? [], capped: false }, mixVersions: { rows: o.versions ?? [], capped: false },
    mixComments: { rows: o.comments ?? [], capped: false }, mixTargets: { rows: [], capped: false }, mixTargetNotes: { rows: [], capped: false }, finalFiles: { rows: [], capped: false },
    projectSettings: { rows: [], capped: false }, tasks: { rows: o.tasks ?? [], capped: false }, actions: { rows: o.actionsLog ?? [], capped: false },
  };
  const ops = { engineerWork: { rows: o.engineer ?? [], capped: false }, mixVersions: { rows: o.versions ?? [], capped: false }, projectsMeta: { rows: [], capped: false }, projectActions: { rows: o.actionsLog ?? [], capped: false } };
  return {
    now: new Date(`${TODAY}T09:00:00Z`), identities: { cleantone: null },
    state: { status: "OK", value: state } as never,
    operations: { status: "OK", value: ops } as never,
    projectDetail: o.det === false ? { status: "UNAVAILABLE", detail: "x" } as never : { status: "OK", value: det } as never,
    labelDetail: o.shows === null ? { status: "UNAVAILABLE", detail: "x" } as never : { status: "OK", value: { shows: { rows: o.shows ?? [], capped: false }, artists: { rows: [], capped: false } } } as never,
    settings: { status: "OK", value: { families: {} } } as never,
    actions: o.partnerActions === null ? { status: "UNAVAILABLE", detail: "x" } as never : { status: "OK", value: o.partnerActions ?? [] } as never,
    integrity: o.integrityQs === null ? { status: "UNAVAILABLE", detail: "x" } as never : { status: "OK", value: { questions: o.integrityQs ?? [] } } as never,
    ownerInbox: { status: "OK", value: [{ id: U(950), createdAt: "2026-10-01T07:00:00Z", body: "קרוב אלייך — עדכון חדש שעוד לא עובד", author: "OWNER", epistemic: "OWNER_REPORTED", source: "DASHBOARD_V2", status: "NEW", processedAt: null, processedVia: null, outcome: null, outcomeRef: null }] } as never,
    inboxMemory: o.memory === null ? { status: "UNAVAILABLE", detail: "x" } as never : { status: "OK", value: o.memory ?? { links: [], interpretations: [] } } as never,
    // D1 (2026-10-05): the Owner's P2 knowledge is an optional enrichment source — read here (empty) like production
    ownerKnowledge: { status: "OK", value: [] } as never,
    audience: { channel: "INTERNAL", ownerAuthorized: true },
  } as GatewaySources;
}

// The production-like day: the screenshot's shapes.
const steven = (status: string) => ({ id: U(70), projectId: P_MIX, engineerName: "Steven", workTitle: null, workType: "מיקס", status, agreedPrice: 200, currency: "$", amountPaid: 0, sentDate: "2026-09-20", internalDeadline: null, linkedTransactionId: null, paymentDate: null, notes: null, hasFilesLink: false, sortOrder: 0, createdAt: null, updatedAt: null });
const mixV = (at: string) => ({ id: U(80), workId: U(70), projectId: P_MIX, label: "v2", fileName: "v2.wav", status: null, uploadedBy: "steven", durationSeconds: null, uploadedAt: at, targetId: null, path: null, size: null, type: null, createdAt: at, updatedAt: null });
const comment = (at: string) => ({ id: U(81), versionId: U(80), timestampSeconds: 10, text: "להרים ווקאל", author: "owner", role: "owner", status: "open", createdAt: at, updatedAt: null });
const BASE: Opts = {
  victor: [
    victorRow(U(20), P_VIC_AWAY, { uploads: ["2026-09-10T10:00:00Z"], notes: ["2026-09-12T10:00:00Z"], task: U(30) }),   // ball at Victor
    victorRow(U(21), P_VIC_OWNER, { uploads: ["2026-09-01T10:00:00Z", "2026-09-19T10:00:00Z"], notes: ["2026-09-05T10:00:00Z"], task: U(31) }), // ball with the Owner
  ],
  engineer: [steven("בתהליך")], versions: [mixV("2026-09-28T10:00:00Z")],
  tasks: [
    task(U(30), "מעקב ויקטור — מעברים", "2026-09-17", { relatedType: "project", relatedId: P_VIC_AWAY }),
    task(U(31), "מעקב ויקטור — לא מאמינה", "2026-09-19", { relatedType: "project", relatedId: P_VIC_OWNER }),
    task(U(32), "לשלם נז", "2026-09-21"),
    task(U(33), "תזכורת: טל צבאי אמור להביא 2,000 ₪ — בלאגן", "2026-09-29"),
    task(U(34), "להתקשר לאולפן", TODAY),
    task(U(35), "לשלוח לסטפו מאסטר", "2026-09-19", { relatedType: "project", relatedId: P_MIX }),
  ],
};

console.log("The ball decides — auto Victor tasks follow their work");
{
  const n = buildNeedsMe(src(BASE));
  const keys = n.items.map((i) => i.entityKey);
  ok("ball at Victor: the work and its overdue auto task are OUT (excluded with the reason)", !keys.includes(`victor-work:${U(20)}`) && !keys.includes(`task:${U(30)}`)
    && n.excluded.some((e) => e.entityKey === `task:${U(30)}` && e.reasonCode === "AUTO_TASK_BALL_AT_VICTOR") && n.excluded.some((e) => e.entityKey === `victor-work:${U(20)}` && e.reasonCode === "BALL_AT_VICTOR"), n.excluded);
  const vo = n.items.find((i) => i.entityKey === `victor-work:${U(21)}`);
  ok("ball with the Owner: Victor's version waiting → WAITING_ON_YOU with 'מחכה לך 12 ימים' (Q3)", !!vo && vo.group === "WAITING_ON_YOU" && vo.waitingDays === 12 && vo.whyToday.includes("מחכה לך 12 ימים") && vo.ball.waitingParty === "ויקטור", vo);
  ok("its auto task merges into the SAME item (no duplicate 'לא מאמינה' row)", !keys.includes(`task:${U(31)}`) && !!vo?.evidence.some((e) => e.code === "LINKED_TASK"), vo?.evidence);
  ok("every item carries whyToday + ball + evidence + nextAction", n.items.every((i) => i.whyToday && i.ball.holder === "OWNER" && i.ball.ruleHe && i.evidence.length > 0 && i.nextAction.he));
  ok("own task overdue 10 days (> 3) → Backlog, not today (Q1)", n.backlog.some((e) => e.entityKey === `task:${U(32)}` && e.reasonCode === "OWN_TASK_OVERDUE_OLD") && !keys.includes(`task:${U(32)}`));
  ok("own reminder overdue 2 days (≤ 3) → today as the Owner's own action (Q1/Q4: the action enters, not the debt)", keys.includes(`task:${U(33)}`));
  ok("own task due today → today", keys.includes(`task:${U(34)}`));
  ok("Steven's version uploaded, no Owner comment after → the mix item is the Owner's (engineerHandoff)", n.items.some((i) => i.entityKey === `mix-work:${U(70)}` && i.ball.waitingParty === "Steven"));
  ok("a task linked to a project whose ball is the Owner's merges into that item (the age does not matter — Q1 exception)", !keys.includes(`task:${U(35)}`) && !!n.items.find((i) => i.entityKey === `mix-work:${U(70)}`)?.evidence.some((e) => e.code === "LINKED_TASK"));
  ok("order: WAITING_ON_YOU before own tasks; inside it the most recent event first (Steven 28.09 before Victor 19.09)", n.items[0].entityKey === `mix-work:${U(70)}` && n.items[1].entityKey === `victor-work:${U(21)}` && n.items[2].group === "YOUR_TASK", n.items.map((i) => i.entityKey));
  ok("ONE Victor work waiting is not aggregated (aggregation needs several)", !n.items.some((i) => i.group === "LONG_WAITS"));
  ok(`at most ${NEEDS_ME_MAX}`, n.items.length <= NEEDS_ME_MAX);
  ok("a NEW (unprocessed) Owner update never enters by itself", !n.items.some((i) => i.fromInbox) && n.inbox.interpretations === 0);
}

console.log("\nPrecedence + Victor aggregation (Owner decision 2026-10-01): fresh actionable > stale repeated backlog");
{
  const P = (n: number) => U(300 + n);
  const victor = [
    victorRow(U(220), P(1), { uploads: ["2026-08-18T10:00:00Z"], notes: [] }),                    // 44 days
    victorRow(U(221), P(2), { uploads: ["2026-08-25T10:00:00Z"], notes: [], task: U(230) }),        // 37 days + its auto task
    victorRow(U(222), P(3), { uploads: ["2026-09-28T10:00:00Z"], notes: [] }),                    // 3 days (recent week)
    victorRow(U(223), P(4), { uploads: ["2026-09-30T18:00:00Z"], notes: [] }),                    // yesterday → its own NEW item
  ];
  const memory: InboxMemory = { links: [], interpretations: [interp(U(64), `project:${P_MIX}`, { basisEventAt: "2026-10-01T06:00:00Z", basisBall: "OWNER" })] };
  const n = buildNeedsMe(src({ victor, engineer: [steven("בתהליך")], versions: [mixV("2026-10-01T06:00:00Z")], memory,
    tasks: [task(U(230), "מעקב ויקטור — 2", "2026-09-10", { relatedType: "project", relatedId: P(2) }), task(U(231), "משימה להיום", TODAY), ...Array.from({ length: 4 }, (_, i) => task(U(240 + i), `משימה ${i}`, TODAY))] }));
  ok("'קרוב אלייך' (Steven uploaded today + the Owner's update) is FIRST — NEW_TODAY beats a 44-day Victor wait", n.items[0].entityKey === `mix-work:${U(70)}` && n.items[0].group === "NEW_TODAY" && n.items[0].evidence.some((e) => e.code === "NEW_SINCE_YESTERDAY"), n.items.map((i) => [i.group, i.entityKey]));
  ok("its next step comes from the Owner's CURRENT update", n.items[0].nextAction.he.includes("לסגור 2 תיקוני מיקס"), n.items[0].nextAction);
  ok("a Victor work whose version arrived yesterday is lifted OUT of the group as its own NEW item", n.items.some((i) => i.entityKey === `victor-work:${U(223)}` && i.group === "NEW_TODAY"));
  const all = [...n.items, ...n.moreToday];
  const agg = n.summaries.find((i) => i.group === "LONG_WAITS");
  ok("the other Victor waits become ONE item 'ויקטור מחכה לפידבק שלך ב-3 עבודות' (never 3 slots)", !!agg && agg.title === "ויקטור מחכה לפידבק שלך ב-3 עבודות" && !all.some((i) => [U(220), U(221), U(222)].some((id) => i.entityKey === `victor-work:${id}`)), agg?.title);
  ok("the aggregate says how long the oldest waits, how many got a version in the last 7 days, and the linked tasks", !!agg && agg.whyToday.includes("הישנה ביותר: 44 ימים") && agg.whyToday.includes("1 התעדכנו ב-7 הימים האחרונים") && agg.whyToday.includes("1 מעקבים פתוחים"), agg?.whyToday);
  ok("'פתח' on the aggregate = the list of its works, each opening its own record", agg?.open.kind === "list" && agg.open.entries.length === 3 && agg.open.entries.every((e) => e.open.kind !== "list"));
  ok("the aggregate is an always-visible SUMMARY line — never a top-5 / moreToday slot; balls unchanged (display only)", !all.some((i) => i.group === "LONG_WAITS") && n.summaries.length === 1 && agg?.ball.holder === "OWNER" && agg.ball.ruleHe.includes("לתצוגה בלבד"));
  const many = buildNeedsMe(src({ victor, tasks: Array.from({ length: 7 }, (_, i) => task(U(260 + i), `משימה ${i}`, TODAY)) }));
  const b2 = parseBoard(JSON.parse(JSON.stringify(queryKnowledgeCore(PARTNER_KNOWLEDGE_REGISTRY, { capability: "needs_me" }, src({ victor }), { channel: "INTERNAL", ownerAuthorized: true }))) as Record<string, unknown>);
  ok("Dashboard V2 reads the summary line from the capability (section summary) and opens it as a list", !!b2 && b2.summaries.length === 1 && b2.summaries[0].open.kind === "list" && !b2.today.concat(b2.moreToday).some((i) => i.group === "LONG_WAITS"), b2?.summaries);
  ok("with a full top 5 the Victor summary line is still there (it does not compete for a slot)", many.items.length === NEEDS_ME_MAX && many.summaries.length === 1 && many.summaries[0].title.startsWith("ויקטור מחכה לפידבק שלך ב-"), { items: many.items.length, summaries: many.summaries.map((x) => x.title) });
  const order = all.map((i) => i.group);
  const rank = (g: string) => ["NEW_TODAY", "SCHEDULED", "WAITING_ON_YOU", "APPROVAL", "YOUR_TASK", "LONG_WAITS"].indexOf(g);
  ok("the fixed precedence holds across the whole list", order.every((g, i) => i === 0 || rank(order[i - 1]) <= rank(g)), order);
}

console.log("\nSteven must work → out; the Owner's update cannot pull it back (records win, contradiction shown — Q5)");
{
  const memory: InboxMemory = { links: [], interpretations: [interp(U(60), `project:${P_MIX}`, { basisEventAt: "2026-09-30T10:00:00Z" })] };
  const n = buildNeedsMe(src({ ...BASE, comments: [comment("2026-09-30T10:00:00Z")], memory }));
  ok("Owner commented after the version → ball at Steven → the mix is OUT", !n.items.some((i) => i.entityKey === `mix-work:${U(70)}`) && n.excluded.some((e) => e.entityKey === `mix-work:${U(70)}` && e.reasonCode === "BALL_AT_ENGINEER"), n.items.map((i) => i.entityKey));
  const c = n.undecided.find((e) => e.reasonCode === "INBOX_VS_RECORDS");
  ok("the update says the ball is the Owner's, records say Steven → shown in 'לא הוכרע' as 'כתבת ש… — לפי הרשומות כרגע …' (never hidden, nothing changed)", !!c && c.reasonHe.includes("לפי מה שכתבת") && c.reasonHe.includes("לפי הרשומות כרגע הוא אצל Steven"), n.undecided);
  ok("the project's linked task follows Steven's ball (overdue → out, not 'today')", n.excluded.some((e) => e.entityKey === `task:${U(35)}` && e.reasonCode === "PROJECT_BALL_EXTERNAL"));
}

console.log("\nThe Owner must send feedback → the update enriches the item (case A: חיים → קרוב אלייך → Steven)");
{
  const memory: InboxMemory = { links: [], interpretations: [interp(U(61), `project:${P_MIX}`, { basisEventAt: "2026-09-28T10:00:00Z", basisBall: "NONE" })] };
  const n = buildNeedsMe(src({ ...BASE, memory }));
  const it = n.items.find((i) => i.entityKey === `mix-work:${U(70)}`);
  ok("a CURRENT understanding words the next step (marked as the Owner's update), the ball stays the records'", !!it && it.fromInbox?.freshness === "CURRENT" && it.nextAction.he.includes("לסגור 2 תיקוני מיקס") && it.nextAction.he.includes("לפי העדכון שלך") && it.ball.ruleHe.includes("engineerHandoff"), it);
  ok("the update is evidence with epistemic HYPOTHESIS", !!it?.evidence.some((e) => e.code === "OWNER_UPDATE" && e.epistemic === "HYPOTHESIS"));
  const outdated: InboxMemory = { links: [], interpretations: [interp(U(62), `project:${P_MIX}`, { basisEventAt: "2026-09-20T10:00:00Z" })] };
  const o2 = buildNeedsMe(src({ ...BASE, memory: outdated })).items.find((i) => i.entityKey === `mix-work:${U(70)}`);
  ok("an OUTDATED understanding (records moved after it) is context only: no next step from it", !!o2 && o2.fromInbox?.freshness === "OUTDATED_BY_CANONICAL" && o2.fromInbox.nextStep === null && !o2.nextAction.he.includes("לפי העדכון שלך"), o2?.fromInbox);
  const only: InboxMemory = { links: [], interpretations: [interp(U(63), `project:${P_SEND}`, { basisStatus: "בעבודה", basisEventAt: null, basisBall: "NONE" })] };
  const n3 = buildNeedsMe(src({ ...BASE, memory: only }));
  ok("an update that says 'the ball is yours' with NO record evidence does not create an item — it goes to 'לא הוכרע'", !n3.items.some((i) => i.projectId === P_SEND) && n3.undecided.some((e) => e.reasonCode === "INBOX_ONLY" && e.entityKey === `project:${P_SEND}`), n3.undecided);
}

console.log("\nSend log: Owner-side alone → today; Owner-side + waiting on others = MIXED → 'לא הוכרע'");
{
  const act = (id: number, status: string, actionType: string, date: string) => ({ id: U(id), projectId: P_SEND, actionType, contentType: "mix", versionLabel: null, recipientRole: "client", recipientName: "X", recipientClientId: null, recipientPhone: null, hasLink: false, status, actionDate: date, followupDate: null, notes: null, linkedWorkId: null, linkedTaskId: null, createdAt: `${date}T10:00:00Z`, updatedAt: null });
  const alone = buildNeedsMe(src({ actionsLog: [act(700, "pending_feedback", "received", "2026-09-29")] }));
  const it = alone.items.find((i) => i.entityKey === `project:${P_SEND}`);
  ok("a received version with no feedback after it → WAITING_ON_YOU", !!it && it.evidence.some((e) => e.code === "OWNER_FEEDBACK_DUE"), { items: alone.items.map((i) => i.entityKey), undecided: alone.undecided });
  const mixed = buildNeedsMe(src({ actionsLog: [act(700, "pending_feedback", "received", "2026-06-14"), act(701, "pending_version", "sent", "2026-06-20")] }));
  ok("the same project also waits on others → not in today; 'לא הוכרע' (SEND_LOG_MIXED)", !mixed.items.some((i) => i.projectId === P_SEND) && mixed.undecided.some((e) => e.reasonCode === "SEND_LOG_MIXED"), { items: mixed.items.map((i) => i.entityKey), undecided: mixed.undecided });
}

console.log("\nProposals, partner actions, shows, integrity");
{
  const proposals = [
    { id: U(40), clientId: U(41), clientName: "בלאגן", linkedProjectId: null, title: "הצעה", amount: 5000, currency: "₪", status: "צריך פולואפ", followupYmd: TODAY, sentYmd: null, createdAt: null },
    { id: U(42), clientId: U(43), clientName: "ישן", linkedProjectId: null, title: "הצעה ישנה", amount: 1000, currency: "₪", status: "צריך פולואפ", followupYmd: "2026-09-01", sentYmd: null, createdAt: null },
  ];
  const followTask = task(U(44), "מעקב הצעת מחיר - בלאגן", TODAY, { relatedType: "client", relatedId: U(41), notes: `[proposal_id:${U(40)}]` });
  const partnerActions = [{ v: 3, state: "AWAITING_EXECUTION", actionId: "a1", actionType: "UPDATE_PROJECT_DEADLINE", projectId: P_SEND, projectName: "שיר שנשלח", headlineHe: "להזיז דדליין" }];
  const shows = [
    { id: U(45), name: "פסטיבל", artistText: "שליו טסמה", date: TODAY, startTime: "22:00", location: null, contactPerson: null, hasPhone: false, status: "סגור", paymentStatus: "לא שולם", price: 1000, djFee: 0, artistFee: 0, advancePayment: 0, currency: "₪", notes: null, djClientId: null, djConfirmationStatus: null, artistClientId: null, bookerClientId: null },
  ];
  const n = buildNeedsMe(src({ tasks: [followTask], proposals, partnerActions, shows, integrityQs: [{ questionId: "q1", subject: { label: "שליו" }, textHe: "מי ה-DJ?" }, { questionId: "q2", subject: { label: "x" }, textHe: "?" }] }));
  const keys = n.items.map((i) => i.entityKey);
  ok("proposal follow-up due today → today, its marker task merged (one item)", keys.includes(`proposal:${U(40)}`) && !keys.includes(`task:${U(44)}`) && !!n.items.find((i) => i.entityKey === `proposal:${U(40)}`)?.evidence.some((e) => e.code === "FOLLOWUP_TASK"));
  ok("an old follow-up (> 3 days) → Backlog", n.backlog.some((e) => e.entityKey === `proposal:${U(42)}`));
  ok("an approved partner action awaiting execution → APPROVAL with its action id", n.items.some((i) => i.group === "APPROVAL" && i.nextAction.actionId === "a1"));
  ok("a show today with no DJ → SCHEDULED (the show view's own NO_DJ signal)", n.items.some((i) => i.group === "SCHEDULED" && i.evidence.some((e) => e.code === "NO_DJ")), n.items.map((i) => [i.group, i.evidence.map((e) => e.code)]));
  ok("integrity questions never enter the list; they are a separate line (Q2)", !keys.some((k) => k.startsWith("integrity")) && n.integrity.count === 2 && n.integrity.blocking === 0);
}

console.log("\nAt most 5, never filled; honest empty; failure is never 'nothing'");
{
  const many = Array.from({ length: 7 }, (_, i) => task(U(500 + i), `משימה ${i}`, TODAY));
  const n = buildNeedsMe(src({ tasks: many }));
  ok(`7 qualified → ${NEEDS_ME_MAX} shown + 2 in moreToday (never dropped)`, n.items.length === NEEDS_ME_MAX && n.moreToday.length === 2);
  const two = buildNeedsMe(src({ tasks: many.slice(0, 2) }));
  ok("2 real things → exactly 2 (never filled)", two.items.length === 2 && two.moreToday.length === 0);
  const empty = buildNeedsMe(src({ tasks: [task(U(600), "ישנה", "2026-08-01")] }));
  ok("nothing qualifies → 0 items, checked > 0, the old task in Backlog, no unchecked source", empty.items.length === 0 && empty.checked > 0 && empty.backlog.length === 1 && empty.unchecked.length === 0, empty);
  const failed = buildNeedsMe(src({ ...BASE, det: false, partnerActions: null, shows: null, memory: null, integrityQs: null }));
  ok("PROJECT_DETAIL / ACTIONS / shows / inbox / integrity unreadable → listed as 'לא נבדק', no throw", ["PROJECT_DETAIL", "TASKS", "ACTIONS", "LABEL_DETAIL", "OWNER_INBOX", "INTEGRITY"].every((s) => failed.unchecked.some((u) => u.source === s)) && failed.integrity.count === null, failed.unchecked);
  ok(`grace constant = ${OWNER_TASK_GRACE_DAYS} (Owner Q1)`, OWNER_TASK_GRACE_DAYS === 3);
}

console.log("\nThe capability (one list for Dashboard V2 and Sunny)");
{
  const reg = PARTNER_KNOWLEDGE_REGISTRY;
  const r = queryKnowledgeCore(reg, { capability: "needs_me" }, src(BASE), { channel: "INTERNAL", ownerAuthorized: true });
  const sections = new Set(r.items.map((i) => (i.fields as { section: string }).section));
  ok("registered, Owner-only, board = today + backlog (excluded only on request)", r.status === "OK" && sections.has("today") && sections.has("backlog") && !sections.has("excluded"), { status: r.status, sections: [...sections] });
  const x = queryKnowledgeCore(reg, { capability: "needs_me", mode: "excluded" }, src(BASE), { channel: "INTERNAL", ownerAuthorized: true });
  ok("mode excluded answers 'למה X לא מופיע?' with the reason", x.items.some((i) => (i.fields as { reasonCode?: string }).reasonCode === "AUTO_TASK_BALL_AT_VICTOR"));
  const denied = queryKnowledgeCore(reg, { capability: "needs_me" }, src(BASE), { channel: "EXTERNAL", ownerAuthorized: false });
  ok("not served without the Owner's authority", denied.status !== "OK");
  const board = parseBoard(JSON.parse(JSON.stringify(r)) as Record<string, unknown>);
  ok("Dashboard V2's parser reads the real capability answer (same items, ball party, evidence, backlog)", !!board && board.today.length === buildNeedsMe(src(BASE)).items.length
    && board.today.some((i) => i.ball.waitingParty === "ויקטור") && board.today[0].evidence.length > 0 && board.backlog.length > 0 && board.today.every((i) => i.title && i.whyToday && i.nextAction), board);
  ok("a non-OK answer parses as 'not checked' (null), never an empty list", parseBoard({ status: "FORBIDDEN", items: [] }) === null);
  const cap = reg.get("needs_me");
  ok("the capability needs no write source and declares PROJECT_DETAIL / OWNER_INBOX", !!cap && cap.needs.includes("PROJECT_DETAIL") && cap.needs.includes("OWNER_INBOX"));
}

console.log("\nRead-only guards");
{
  const lib = read("lib/partner/needs-me/curate.ts") + read("lib/partner/knowledge/capabilities/needs-me.ts");
  ok("no write / push / fetch / task creation in the curation", !/\.insert\(|\.update\(|\.upsert\(|\.delete\(|\bfetch\(|sendPush|createTask|lib\/writes|\.rpc\(/.test(lib));
  const ui = read("components/dashboard-v2/DashboardV2.tsx");
  // Phase B (2026-10-05): the SAME needs_me answer now arrives inside the Owner-only executive read (GET), parsed by the same parseBoard
  ok("Dashboard V2 reads needs_me through the Owner-only executive read (GET) with the same parser", /"\/api\/partner\/executive"/.test(ui) && /parseBoard\(exec\.needsMe\)/.test(ui) && /needsMe: \{ capability: "needs_me", mode: "board" \}/.test(read("lib/partner/gateway/executive.ts")));
  ok("Dashboard V2 no longer derives Needs-Me from the raw aggregation (only as the labelled fallback)", !/buildNeedsMe\(\{/.test(ui) || /לא מסונן/.test(ui));
  ok("the old /dashboard is untouched by this change (no needs_me there)", !/needs_me/.test(read("app/dashboard/page.tsx")));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
