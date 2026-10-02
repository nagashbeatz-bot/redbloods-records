/**
 * Tests — Sunny COO V1 (2026-10-02): operational readiness, project momentum, label-artist care, schedule health,
 * money readiness, executive priorities, factual uncertainty, no side effects, no background jobs.
 *
 * Run with:   npx tsx scripts/test-sunny-coo.tsx      Pure; in-memory fixtures; never touches production.
 */
import fs from "node:fs";
import path from "node:path";
import type { GatewaySources } from "../lib/partner/gateway/core";
import { cooCtx } from "../lib/partner/coo/context";
import { readinessBoard, readinessOf, songOfClip } from "../lib/partner/coo/readiness";
import { artistCare, projectMomentum, rosterCare } from "../lib/partner/coo/momentum";
import { moneyReadiness } from "../lib/partner/coo/money";
import { buildCooView, prioritize, prioritiesHe, type CooPriority } from "../lib/partner/coo/priorities";
import { scheduleHealth } from "../lib/partner/coo/schedule";
import { deriveReadiness, check, INTERNAL_COO_HEURISTICS, COO_MAX_PRIORITIES, READINESS_HE } from "../lib/partner/coo/model";
import { PARTNER_KNOWLEDGE_REGISTRY } from "../lib/partner/knowledge/catalog";
import { entityKnowledge, queryKnowledgeCore } from "../lib/partner/knowledge/query";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: unknown) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 700)}` : ""}`); } };
const section = (t: string) => console.log(`\n${t}`);
const ROOT = path.resolve(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const TODAY = "2026-10-04";
const D = (n: number) => new Date(Date.parse(`${TODAY}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

// ── ids ──
const A_AVI = U(1), A_SHALEV = U(2), A_CT = U(3);
const P_READY = U(10), P_MONEY = U(11), P_CREAT = U(12), P_IDLE = U(13), P_ACTIVE = U(14), P_REL = U(15), P_PAID = U(16), P_OVER = U(17), P_SONG = U(18), P_CLIPSIM = U(19), P_DJ = U(20);
const RF_READY = U(30), RF_MONEY = U(31), RF_CREAT = U(32), RF_SIM = U(33);

interface Fx { calendar?: unknown; extraProjects?: Array<[string, Record<string, unknown>]>; extraRF?: unknown[]; ops?: boolean; det?: boolean; labelDetail?: boolean; brain?: unknown; proposals?: unknown[]; tasks?: unknown[]; roster?: Array<{ id: string; name: string }>; sessions?: unknown[] }

const proj = (name: string, o: Record<string, unknown> = {}) => ({ name, status: "בעבודה", artistText: null, businessType: "לקוח", projectType: "שיר", ...o });
const PROJECTS: Array<[string, Record<string, unknown>]> = [
  [P_READY, proj("שמש — קליפ", { projectType: "קליפ", artistText: "לקוח א" })],
  [P_MONEY, proj("רוח — קליפ", { projectType: "קליפ", artistText: "לקוח ב" })],
  [P_CREAT, proj("גשם — קליפ", { projectType: "קליפ", artistText: "לקוח ג" })],
  [P_IDLE, proj("שיר שקט", { businessType: "לייבל", artistText: "אבי מולה" })],
  [P_ACTIVE, proj("שיר זז", { businessType: "לייבל", artistText: "שליו טסמה" })],
  [P_REL, proj("סינגל", { businessType: "לייבל", artistText: "שליו טסמה", status: "במיקס" })],
  [P_PAID, proj("לקוח ששילם", { status: "במיקס", artistText: "לקוח ד", deadline: D(5) })],
  [P_OVER, proj("לקוח ששילם יותר", { status: "במיקס", artistText: "לקוח ה" })],
  [P_SONG, proj("ים", { artistText: "לקוח ו" })],
  [P_CLIPSIM, proj("ים — קליפ", { projectType: "קליפ", artistText: "לקוח ו" })],
  [P_DJ, proj("סט של הדיג׳יי", { artistText: "DJ CLEANTONE" })],
];
const production = (id: string, projectId: string, title: string, shootDate: string, o: Record<string, unknown> = {}) => ({ id, title, productionType: "קליפ", status: "בהכנה", projectId, clientId: null, artistName: (o.artistName as string) ?? "אמן", clientSource: null, shootDate, publishDate: null, editStatus: null, collectionStatus: null, generalBudget: 0, clientPrice: (o.clientPrice as number) ?? null, advanceRequired: (o.advanceRequired as number) ?? null, advanceReceived: (o.advanceReceived as number) ?? null });
const prodDetail = (id: string, projectId: string, o: Record<string, unknown> = {}) => ({ id, projectId, clientNameSnapshot: null, createdAt: null, updatedAt: null, photographer: o.photographer ?? null, director: o.director ?? null, editor: o.editor ?? null, locations: o.locations ?? null, conceptSummary: o.concept ?? null, conceptVibe: null, script: { start: null, middle: null, end: null }, directorNotes: null, photographerNotes: null, fixNotes: null, notes: null, publishedWhere: null, dropboxFolderPath: null, links: { references: false, rawFiles: false, editFolder: false, version1: false, version2: false, finalVersion: false, folder: false }, currency: "₪" });
const doc = (prod: string, type: string) => ({ id: `${prod}-${type}`, productionId: prod, fileName: `${type}.pdf`, fileType: type, mimeType: "application/pdf", path: null, hasPublicLink: false, notes: null, createdAt: null, updatedAt: null });
const line = (id: string, prod: string, planned: number) => ({ id, productionId: prod, title: "צלם", category: "צוות", vendorName: null, status: "מתוכנן", planned, actual: null, notes: null, linkedTransactionId: null, createdAt: null, updatedAt: null, currency: "₪" });
const pay = (prod: string, item: string, amount: number) => ({ id: `${item}-pay`, productionId: prod, budgetItemId: item, amount, date: D(-2), method: "העברה", notes: null, receiptFileName: null, receiptMime: null, receiptPath: null, hasReceiptLink: false, createdAt: null, updatedAt: null, currency: "₪", linkedTransactionId: `tx-${item}` });
const dsession = (id: string, projectId: string | null, date: string, o: Record<string, unknown> = {}) => ({ id, projectId, showId: null, date, startTime: (o.start as string) ?? null, endTime: (o.end as string) ?? null, status: (o.status as string) ?? "מתוכנן", type: (o.type as string) ?? "סשן", statusSource: null, title: null, notes: null, location: (o.location as string) ?? null, photographer: (o.photographer as string) ?? null, cost: null, hasCalendarEvent: false, createdAt: null });
const tx = (id: string, projectId: string, type: string, amount: number, status: string) => ({ id, projectId, type, date: D(-3), amount, currency: "₪", status, category: null, scope: null, expenseScope: null, linkedSessionId: null });
const setting = (projectId: string, agreedPrice: number) => ({ projectId, value: { agreedPrice, currency: "₪" } });
const calEvent = (id: string, title: string, startIso: string, endIso: string) => ({ id, calendarId: "primary", calendarName: null, holidayCalendar: false, title, untitled: false, description: null, start: startIso, end: endIso, allDay: false, timeZone: "Asia/Jerusalem", durationMinutes: null, location: null, attendees: [], attendeesOmitted: false, selfResponse: null, organizer: null, creator: null, invited: false, recurringEventId: null, originalStartTime: null, recurrence: null, status: "confirmed", eventType: "default", transparency: "opaque", visibility: null, created: null, updated: null, hasMeetingLink: false, hasAttachments: false, attachmentCount: 0 });
const calWindow = (events: unknown[]) => ({ status: "CALENDAR_DATA_AVAILABLE", window: { start: TODAY, end: D(13), days: 14 }, fetchedAt: `${TODAY}T08:00:00Z`, cache: "NONE", calendars: [], events, truncated: false, reasons: [] });
/** a 9-hour busy day (non-overlapping 08:00–17:00 Israel = 05:00–14:00Z) */
const fullDay = (n: number) => calEvent(`full-${n}`, "עבודה רצופה", `${D(n)}T05:00:00Z`, `${D(n)}T14:00:00Z`);

function src(fx: Fx = {}): GatewaySources {
  const all = [...PROJECTS, ...(fx.extraProjects ?? [])];
  const index = Object.fromEntries(all.map(([id, p]) => [id, p]));
  const open = all.map(([id, p]) => ({ id, name: p.name, status: p.status, businessType: p.businessType, projectType: p.projectType, deadline: { ymd: (p.deadline as string) ?? null, daysTo: p.deadline ? Math.round((Date.parse(`${p.deadline}T00:00:00Z`) - Date.parse(`${TODAY}T00:00:00Z`)) / 86_400_000) : null }, daysSinceUpdate: 2, active: true }));
  const meta = all.map(([id, p]) => ({ id, name: p.name, status: p.status, projectType: p.projectType, businessType: p.businessType, artistText: p.artistText, deadline: p.deadline ?? null, startDate: null, endDate: null, parentProject: null, isHidden: false, songProjectId: (p.songProjectId as string) ?? null, plannedHours: null, plannedDays: null, updatedAt: null }));
  const roster = fx.roster ?? [{ id: A_AVI, name: "אבי מולה" }, { id: A_SHALEV, name: "שליו טסמה" }, { id: A_CT, name: "DJ CLEANTONE" }];
  const rf = [
    production(RF_READY, P_READY, "שמש", D(2), { artistName: "לקוח א" }),
    production(RF_MONEY, P_MONEY, "רוח", D(3), { artistName: "לקוח ב", clientPrice: 6000, advanceRequired: 2000 }),
    production(RF_CREAT, P_CREAT, "גשם", D(4), { artistName: "לקוח ג" }),
    production(RF_SIM, P_CLIPSIM, "ים", D(6), { artistName: "לקוח ו" }),
    ...(fx.extraRF ?? []),
  ];
  const dets = [
    prodDetail(RF_READY, P_READY, { photographer: "דני", director: "רוני", editor: "עדי", locations: "חוף הצוק", concept: "ריקוד בשקיעה" }),
    prodDetail(RF_MONEY, P_MONEY, { photographer: "דני", locations: "סטודיו", concept: "שחור לבן", editor: "עדי" }),
    prodDetail(RF_CREAT, P_CREAT, { photographer: "דני", locations: "מדבר" }),
    prodDetail(RF_SIM, P_CLIPSIM, { photographer: "דני", locations: "ים", concept: "גלים" }),
  ];
  const sessionsEyes = [
    { id: U(40), projectId: P_READY, showId: null, dateYmd: D(2), status: "מתוכנן", sessionType: "צילום קליפ", startTime: "10:00", endTime: "18:00" },
    { id: U(41), projectId: P_ACTIVE, showId: null, dateYmd: D(1), status: "מתוכנן", sessionType: "סשן", startTime: "12:00", endTime: "15:00" },
    { id: U(42), projectId: P_ACTIVE, showId: null, dateYmd: D(-5), status: "התקיים", sessionType: "סשן", startTime: "12:00", endTime: "15:00" },
    ...((fx.sessions ?? []) as never[]),
  ];
  const detSessions = sessionsEyes.map((s) => dsession(s.id, s.projectId, s.dateYmd, { start: s.startTime, end: s.endTime, status: s.status, type: s.sessionType }));
  const state = {
    todayIL: TODAY,
    domains: {
      projects: { data: { index, open } }, clients: { data: { items: [{ id: U(90), name: "DJ CLEANTONE", type: "DJ", status: "פעיל", createdAt: null }] } },
      labelArtists: { data: { items: roster.map((a) => ({ ...a, status: "פעיל", createdAt: null, updatedAt: null, balanceEntries: 0 })) } },
      victor: { data: { active: [] } }, sessions: { data: { items: sessionsEyes } },
      releasesFull: { data: { items: [{ projectId: P_REL, labelArtistId: A_SHALEV, stage: "מיקס", targetYmd: D(6), stageEnteredAt: `${D(-10)}T10:00:00Z`, releasedAt: null, createdAt: null, updatedAt: null }] } },
      proposalsFull: { data: { items: fx.proposals ?? [] } }, tasksFull: { data: { items: fx.tasks ?? [] } }, shows: { data: { items: [] } },
    },
  };
  const engineer = [{ id: U(60), projectId: P_ACTIVE, engineerName: "Steven", workType: "מיקס", workTitle: null, status: "בתהליך", sentDate: D(-3), internalDeadline: D(8), agreedPrice: 200, amountPaid: 0, currency: "$", paymentDate: null },
    { id: U(61), projectId: P_REL, engineerName: "Steven", workType: "מיקס", workTitle: null, status: "נשלח", sentDate: D(-2), internalDeadline: null, agreedPrice: 200, amountPaid: 0, currency: "$", paymentDate: null }];
  const ops = { redFilms: { rows: rf, capped: false }, projectsMeta: { rows: meta, capped: false }, engineerWork: { rows: engineer, capped: false }, mixVersions: { rows: [], capped: false }, mixComments: { rows: [], capped: false }, finalFiles: { rows: [], capped: false }, meetings: { rows: [], capped: false }, projectActions: { rows: [], capped: false }, calendarLinks: { rows: [], capped: false }, clipItems: { rows: [], capped: false }, campaigns: { rows: [], capped: false }, albumTracks: { rows: [], capped: false }, deliveries: { rows: [], capped: false }, budgetPayments: { rows: [], capped: false }, equipment: { rows: [], capped: false } };
  const det = {
    productions: { rows: dets, capped: false }, budgetItems: { rows: [line("l1", RF_READY, 1500), line("l2", RF_MONEY, 1000)], capped: false },
    budgetPayments: { rows: [pay(RF_READY, "l1", 1500), pay(RF_MONEY, "l2", 400)], capped: false },
    rfDocuments: { rows: [doc(RF_READY, "שוט ליסט"), doc(RF_MONEY, "שוט ליסט")], capped: false }, rfRefImages: { rows: [], capped: false }, rfRefLinks: { rows: [], capped: false }, rfCrew: { rows: [], capped: false },
    tasks: { rows: [], capped: false }, sessions: { rows: detSessions, capped: false }, meetings: { rows: [], capped: false }, releases: { rows: [{ projectId: P_REL, nextAction: null, blocker: null, responsible: null, stageEnteredAt: null, releasedAt: null }], capped: false },
  };
  const finance = { raw: { transactions: [tx("t1", P_READY, "income", 5000, "שולם"), tx("t2", P_PAID, "income", 3000, "התקבל"), tx("t3", P_OVER, "income", 1200, "שולם"), tx("t4", P_MONEY, "income", 2000, "צפוי")], financeSettings: [setting(P_READY, 5000), setting(P_PAID, 3000), setting(P_OVER, 1000), setting(P_MONEY, 6000)], projects: [], engineerWorks: [], shows: [], proposals: [], clients: [], labelArtists: [], ledger: [], mediaIncome: [], redFilmsPayments: [] }, state: { receivables: [], credits: [] } };
  return {
    now: new Date(`${TODAY}T08:00:00Z`), identities: { cleantone: { clientId: U(90), displayName: "DJ CLEANTONE", retiredKeys: [`label-artist:${A_CT}`] } },
    state: { status: "OK", value: state } as never,
    finance: { status: "OK", value: finance } as never,
    operations: fx.ops === false ? { status: "UNAVAILABLE", detail: "x" } as never : { status: "OK", value: ops } as never,
    projectDetail: fx.det === false ? { status: "UNAVAILABLE", detail: "x" } as never : { status: "OK", value: det } as never,
    labelDetail: fx.labelDetail === false ? { status: "UNAVAILABLE", detail: "x" } as never : { status: "OK", value: { shows: { rows: [], capped: false }, artists: { rows: [], capped: false } } } as never,
    settings: { status: "OK", value: { families: {} } } as never,
    calendar: fx.calendar === undefined ? { status: "OK", value: calWindow([]) } as never : fx.calendar as never,
    ...(fx.brain ? { brain: { status: "OK", value: fx.brain } as never } : {}),
    audience: { channel: "INTERNAL", ownerAuthorized: true },
  } as GatewaySources;
}
const OWNER = { channel: "INTERNAL" as const, ownerAuthorized: true };
const allTexts = (o: unknown): string[] => (typeof o === "string" ? [o] : Array.isArray(o) ? o.flatMap(allTexts) : o && typeof o === "object" ? Object.values(o).flatMap(allTexts) : []);

async function main() {
  section("Model — derived readiness, never a DB status");
  ok("blocked beats everything; an open item → attention; all required confirmed → ready; unreadable core → unknown", [
    deriveReadiness([check("a", "LOGISTICS", "x", "CONFIRMED", "x"), check("b", "DEPENDENCIES", "x", "BLOCKED", "x")], true),
    deriveReadiness([check("a", "LOGISTICS", "x", "CONFIRMED", "x"), check("b", "MONEY", "x", "OPEN", "x", [], false)], true),
    deriveReadiness([check("a", "LOGISTICS", "x", "CONFIRMED", "x"), check("b", "CREATIVE", "x", "NOT_SEEN", "x", [], false)], true),
    deriveReadiness([check("a", "LOGISTICS", "x", "CONFIRMED", "x")], false),
  ].join() === "BLOCKED,ATTENTION,READY,UNKNOWN");
  ok("Hebrew states: מוכן / דורש תשומת לב / חסום / לא ידוע", Object.values(READINESS_HE).join("|") === "מוכן|דורש תשומת לב|חסום|לא ידוע");

  const S = src();
  const c = cooCtx(S);
  const board = readinessBoard(c);
  const byKey = (k: string) => board.events.find((e) => e.key === k)!;

  section("A. SHOOT READY — everything relevant confirmed");
  const a = byKey(`readiness:video-production:${RF_READY}`);
  ok("→ מוכן", a?.state === "READY", a && { state: a.state, open: a.open, notSeen: a.notSeen });
  ok("confirmed: date, time (shoot session), location, photographer / director, talent, concept, shotlist, editor, supplier lines paid, client paid", ["תאריך הצילום", "10:00", "חוף הצוק", "דני", "ריקוד", "שוט ליסט", "עדי", "שולמו", "אין חוב"].every((x) => a.confirmed.some((t) => t.includes(x))), a.confirmed);
  ok("narrative is natural Hebrew with ✓ lines", a.narrativeHe.startsWith("צילום שמש") && a.narrativeHe.includes("✓"));

  section("B. SHOOT MONEY GAP — supplier commitment open, advance not seen");
  const b = byKey(`readiness:video-production:${RF_MONEY}`);
  ok("→ דורש תשומת לב", b?.state === "ATTENTION", b?.state);
  ok("open: budget line remaining ₪600 (budgetLinePaidState), advance required but not seen", b.open.some((t) => t.includes("600")) && b.notSeen.some((t) => t.includes("מקדמה")), { open: b.open, notSeen: b.notSeen });
  ok("expected income is reported as expected (צפוי ≠ התקבל), never received", b.insights.some((t) => t.includes("צפוי") && t.includes("2000")), b.insights);
  ok("never claims money is available", !allTexts(b).some((t) => /יש כסף|כסף זמין|available cash/.test(t)));

  section("C. SHOOT UNKNOWN CREATIVE — 'לא רואה', never 'אין'");
  const cc = byKey(`readiness:video-production:${RF_CREAT}`);
  ok("→ דורש תשומת לב (date / crew / location confirmed)", cc.state === "ATTENTION" && cc.confirmed.some((t) => t.includes("מדבר")), cc);
  ok("concept + shotlist reported as NOT SEEN with 'אני לא רואה'", cc.notSeen.some((t) => t.startsWith("אני לא רואה קונספט")) && cc.checks.some((x) => x.id === "creative.shotlist" && x.state === "NOT_SEEN" && x.he.startsWith("אני לא רואה שוט ליסט")), cc.notSeen);
  ok("no readiness text anywhere claims 'אין שוט ליסט' / 'אין קונספט' / 'אין לוקיישן'", !board.events.flatMap((e) => allTexts(e)).some((t) => /אין (שוט|קונספט|לוקיישן|צלם|תסריט)/.test(t)));

  section("D / E. MOMENTUM — label project with no next step vs. one with a session + open work");
  const idle = projectMomentum(c, P_IDLE), active = projectMomentum(c, P_ACTIVE);
  ok("D: active label project, no session / work / task / release step → NO_NEXT_STEP warning", idle.state === "NO_NEXT_STEP" && idle.warning && idle.he.includes("אני לא רואה צעד הבא"), idle);
  ok("E: session tomorrow + mix at Steven → SCHEDULED, no warning", active.state === "SCHEDULED" && !active.warning && active.scheduledNext?.source === "SESSIONS", active);
  ok("E: last progress = the held session (recorded התקיים)", active.lastProgress?.source === "SESSIONS" && active.lastProgress.date === D(-5), active.lastProgress);
  ok("no age threshold anywhere in momentum (daysSinceUpdate never decides)", !/daysSinceUpdate\s*>=|>=\s*\d+\s*\)\s*\?\s*"STUCK"|stuck/i.test(read("lib/partner/coo/momentum.ts").replace(/never "stuck"|is "stuck"|'stuck'|nothing is "stuck"/g, "")));

  section("F. RELEASE APPROACHING + DEPENDENCY OPEN");
  const f = byKey(`readiness:release:${P_REL}`);
  ok("→ דורש תשומת לב: mix still open at Steven, no next action recorded", f?.state === "ATTENTION" && f.open.some((t) => t.includes("Steven")) && f.notSeen.some((t) => t.includes("צעד הבא")), f && { open: f.open, notSeen: f.notSeen });
  ok("a release never requires a video / campaign (optional only)", f.checks.find((x) => x.id === "after.social")?.required === false);

  section("G. FULL CALENDAR, NO REAL CONFLICT — no complaint for being busy");
  const G = src({ calendar: { status: "OK", value: calWindow([0, 1, 2, 3, 4, 5, 6].map(fullDay)) } });
  const gv = buildCooView(G);
  ok("no CONFLICT finding", !gv.schedule.findings.some((x) => x.kind === "CONFLICT"), gv.schedule.findings);
  ok("busy alone is not a finding (no follow-ups / tasks due → no NO_ROOM_FOR_FOLLOWUPS)", !gv.schedule.findings.some((x) => x.code === "NO_ROOM_FOR_FOLLOWUPS"));
  ok("every observation is tied to something it squeezes (an unready event / a label project / a release) — never 'busy' alone", gv.schedule.findings.filter((x) => x.kind === "OBSERVATION").every((x) => x.evidence.some((e) => !e.startsWith("day:"))), gv.schedule.findings);
  const G3 = buildCooView(src({ calendar: { status: "OK", value: calWindow([0, 1].map(fullDay)) } }));
  ok("full days with nothing squeezed → the summary says busy is not a problem in itself", G3.schedule.he.includes("עמוס זה לא בעיה") && !G3.schedule.findings.some((x) => x.code === "NO_PREP_WINDOW" || x.code === "NO_ROOM_FOR_FOLLOWUPS"), G3.schedule);
  const G2 = src({ calendar: { status: "OK", value: calWindow([0, 1, 2, 3].map(fullDay)) }, tasks: [{ id: U(70), title: "לשלוח הצעה", status: "פתוח", dueYmd: D(2), relatedType: "general", relatedId: null, createdAt: null, updatedAt: null }] });
  const g2 = buildCooView(G2).schedule.findings.find((x) => x.code === "NO_ROOM_FOR_FOLLOWUPS");
  ok("a full stretch + something due → an OBSERVATION, marked heuristic, changes nothing", !!g2 && g2.heuristic && g2.kind === "OBSERVATION" && g2.he.includes("לא משנה כלום ביומן"), g2);

  section("H. REAL CONFLICT — raised clearly");
  const H = src({ calendar: { status: "OK", value: calWindow([calEvent("e1", "פגישה עם לקוח", `${D(1)}T08:00:00Z`, `${D(1)}T10:00:00Z`), calEvent("e2", "סשן הקלטה", `${D(1)}T09:00:00Z`, `${D(1)}T11:00:00Z`)]) } });
  const hv = buildCooView(H);
  const conflict = hv.schedule.findings.find((x) => x.kind === "CONFLICT");
  ok("overlap → CONFLICT with both titles", !!conflict && conflict.he.includes("פגישה עם לקוח") && conflict.he.includes("סשן הקלטה"), hv.schedule.findings);
  ok("a conflict tomorrow is tier 1 in the priorities", hv.priorities.some((p) => p.kind === "CONFLICT" && p.tier === 1), hv.priorities.map((p) => [p.kind, p.tier]));
  const HS = src({ sessions: [{ id: U(43), projectId: P_ACTIVE, showId: null, dateYmd: D(1), status: "מתוכנן", sessionType: "סשן", startTime: "13:00", endTime: "16:00" }] });
  ok("two Redbloods sessions overlapping in time → CONFLICT even without the calendar", buildCooView(HS).schedule.findings.some((x) => x.kind === "CONFLICT" && x.evidence.includes(`session:${U(43)}`)));

  section("I / J. MONEY — paid in full never debt; overpaid = credit");
  const paid = moneyReadiness(c.project(P_PAID), { labelWork: false, financeReadable: true });
  ok("I: paidIncome ≥ agreedPrice → CONFIRMED 'אין חוב', no money risk", paid.verdict === "NO_DEBT" && paid.checks.some((x) => x.state === "CONFIRMED" && x.he.includes("אין חוב")) && !paid.risk, paid);
  ok("I: the paid client project never shows a debt in any COO output", !allTexts(buildCooView(S)).some((t) => t.includes("לקוח ששילם") && /יתרה פתוחה|חוב פתוח/.test(t)));
  const over = moneyReadiness(c.project(P_OVER), { labelWork: false, financeReadable: true });
  ok("J: paidIncome > agreedPrice → OVERPAYMENT, 'זיכוי / טיפ, לא חוב', CONFIRMED (not open)", over.verdict === "OVERPAYMENT" && over.checks.some((x) => x.state === "CONFIRMED" && x.he.includes("זיכוי") && x.he.includes("לא חוב")) && !over.risk, over);
  ok("money reuses the ONE canonical computation (projectMoney via the project view) — no new formula", /from "\.\.\/projects\/view"/.test(read("lib/partner/coo/money.ts")) && !/reduce\(\(s, t\) => s \+ t\.amount/.test(read("lib/partner/coo/money.ts")) && !/validateTx/.test(read("lib/partner/coo/money.ts")));
  ok("label work: client money is not applicable (never 'price unknown')", moneyReadiness(c.project(P_IDLE), { labelWork: true, financeReadable: true }).checks.every((x) => x.id !== "money.client"));
  ok("finance unreadable → UNREADABLE, never zero", moneyReadiness(c.project(P_PAID), { labelWork: false, financeReadable: false }).checks[0]?.state === "UNREADABLE");

  section("K. SONG + CLIP WITH THE SAME NAME — separate, no invented link");
  const so = songOfClip(c, P_CLIPSIM);
  ok("no song_project_id → no song link; a similar name is only reported", so.song === null && so.similarNameNoLink.includes("ים"), so);
  const k = byKey(`readiness:video-production:${RF_SIM}`);
  ok("the shoot says it sees a similar song but no canonical link — and checks no playback for it", k.insights.some((t) => t.includes("שם דומה") && t.includes("קישור קנוני")) && !k.checks.some((x) => x.id === "creative.playback"), k.insights);
  const linked = src({ extraProjects: [[U(21), proj("ים — קליפ 2", { projectType: "קליפ", songProjectId: P_SONG })]] });
  ok("with song_project_id → the canonical song (never a name match)", songOfClip(cooCtx(linked), U(21)).song?.id === P_SONG);

  section("L. MISSING DATA → UNKNOWN, not a false claim");
  const L = src({ ops: false, det: false, calendar: { status: "UNAVAILABLE", detail: "provider error" } });
  const lv = buildCooView(L);
  ok("unread sources are named (operations, project detail, calendar) — unknown, not empty", lv.unchecked.some((t) => t.includes("התפעול")) && lv.unchecked.some((t) => t.includes("פרטי הפרויקטים")) && lv.unchecked.some((t) => t.includes("היומן לא נקרא")), lv.unchecked);
  ok("no shoot is declared 'not ready' when Red Films could not be read", !lv.readiness.events.some((e) => e.kind === "SHOOT"));
  ok("calendar unreadable → schedule says it only sees Redbloods records", lv.schedule.unchecked.some((t) => t.includes("רק את מה שרשום ב-Redbloods")));
  const noLd = src({ labelDetail: false });
  const showSrc = { ...noLd, state: { status: "OK", value: { ...(noLd.state as unknown as { value: Record<string, unknown> }).value, domains: { ...((noLd.state as unknown as { value: { domains: Record<string, unknown> } }).value.domains), shows: { data: { items: [{ id: U(80), name: "הופעה", status: "מאושר", paymentStatus: "לא שולם", dateYmd: D(3), djClientId: null, djConfirmationStatus: null, artistClientId: null, bookerClientId: null, price: 5000 }] } } } } } } as GatewaySources;
  const showR = readinessOf(cooCtx(showSrc), `show:${U(80)}`)[0];
  ok("a show whose detail was not read → לא ידוע (never 'not ready')", showR?.state === "UNKNOWN" && showR.stateHe === "לא ידוע", showR && { state: showR.state, checks: showR.checks.map((x) => x.state) });
  const capL = queryKnowledgeCore(PARTNER_KNOWLEDGE_REGISTRY, { capability: "coo" }, L as never, OWNER);
  ok("capability: completeness PARTIAL / UNKNOWN when a source failed (never COMPLETE)", capL.status === "OK" && (capL.completeness === "PARTIAL" || capL.completeness === "UNKNOWN"), capL.completeness);

  section("M. EXECUTIVE PRIORITY — 10 candidates → only 3–5");
  const many: CooPriority[] = Array.from({ length: 10 }, (_, i) => ({ key: `k${i}`, tier: (i % 3 + 1) as 1 | 2 | 3, kind: "READINESS", he: `פריט ${i}`, why: [], entity: `project:${U(100 + i)}`, daysTo: i, labelWork: false, recommendationHe: null, epistemic: "DERIVED" }));
  const pr = prioritize(many);
  ok(`≤ ${COO_MAX_PRIORITIES} returned, the rest counted (never silently dropped)`, pr.top.length === 5 && pr.more === 5, pr);
  ok("order = tier, then the nearest date (never age)", pr.top.map((p) => p.tier).join() === "1,1,1,1,2" && pr.top[0].daysTo === 0);
  ok("the same entity twice → ONE item with merged reasons", prioritize([{ ...many[0], why: ["א"] }, { ...many[0], key: "x", tier: 2, why: ["ב"] }]).top.length === 1);
  const mv = buildCooView(S);
  ok("live view: 1–5 priorities from readiness / momentum / schedule", mv.priorities.length >= 1 && mv.priorities.length <= 5, mv.priorities.map((p) => p.he));
  ok("the short answer reads 'דברים שהייתי סוגרת עכשיו'", /דברים שהייתי סוגרת עכשיו|דבר אחד שהייתי סוגרת עכשיו/.test(prioritiesHe(mv)), prioritiesHe(mv));
  ok("old ≠ important: no priority rule uses daysSinceUpdate / age", !/daysSinceUpdate|age/.test(read("lib/partner/coo/priorities.ts").replace(/never age|not age|Old ≠ important|nothing is promoted for being old|— never age/g, "")));

  section("N. LABEL ROSTER — staff / DJ never treated as a label artist");
  const roster = rosterCare(c);
  ok("roster = label_artists minus the retired DJ identity", roster.map((r) => r.name).sort().join("|") === "אבי מולה|שליו טסמה", roster.map((r) => r.name));
  ok("DJ CLEANTONE (client record + a project naming him) is not an artist", !roster.some((r) => r.name.includes("CLEANTONE")) && artistCare(c, A_CT) === null);
  ok("artist care: Avi needs a next step; Shalev is moving and has a session", roster.find((r) => r.name === "אבי מולה")!.needsStep.includes("שיר שקט") && roster.find((r) => r.name === "שליו טסמה")!.nextSession?.date === D(1));
  ok("artist release readiness is attached (Shalev's single, mix open)", roster.find((r) => r.name === "שליו טסמה")!.nextRelease?.state === "ATTENTION");
  ok("no weekly-session quota (facts only)", !/quota\s*[:=]\s*\d|perWeek|sessionsPerWeek/.test(read("lib/partner/coo/momentum.ts")));

  section("O. BRAIN — an insight stays an inference");
  const brain = { resources: [], authorizations: [{ id: U(200), purposeKind: "OWN_PRESENCE", entityKeys: [`label-artist:${A_SHALEV}`], resourceIds: [], includeChildResources: false, observationFamilies: ["INSTAGRAM"], sourceKinds: ["PUBLIC_PROFILE_PAGE"], validFrom: D(-10), validUntil: null }],
    observations: [{ id: U(201), entityKey: `label-artist:${A_SHALEV}`, resourceId: null, observedAt: `${D(-2)}T10:00:00Z`, valueNum: 1200 }],
    records: [{ id: U(202), seq: 1, recordType: "INSIGHT", entityKeys: [`label-artist:${A_SHALEV}`], resourceIds: [], topic: null, area: "SOCIAL", titleHe: "העוקבים לא זזו מאז הבדיקה הקודמת", body: {}, sourceType: "INFERRED", confidence: "LOW", reviewAt: null, supersedesId: null, authorizationId: U(200), createdAt: `${D(-1)}T10:00:00Z` }],
    links: [], events: [], approvals: null, truncated: false };
  const ob = artistCare(cooCtx(src({ brain })), A_SHALEV)!;
  ok("brain context attached: 1 observation, last observed date", ob.brain?.observations === 1 && !!ob.brain.lastObservedAt?.startsWith(D(-2)), ob.brain);
  ok("the live insight is HYPOTHESIS, never fact", ob.brain!.liveInsights.length === 1 && ob.brain!.liveInsights[0].epistemic === "HYPOTHESIS");
  ok("COO readiness does not depend on Brain (no brain → same readiness)", JSON.stringify(readinessBoard(cooCtx(src())).events.map((e) => e.state)) === JSON.stringify(readinessBoard(cooCtx(src({ brain }))).events.map((e) => e.state)));

  section("Capability + partner_entity enrichment");
  const q = (mode: string, params: Record<string, string> = {}) => queryKnowledgeCore(PARTNER_KNOWLEDGE_REGISTRY, { capability: "coo", mode, params }, S as never, OWNER);
  const qp = q("priorities");
  ok("coo priorities: OK, ≤5 items, the short Hebrew answer in summary", qp.status === "OK" && qp.items.length <= 5 && qp.summary.some((x) => x.code === "ANSWER"), qp.status);
  ok("coo readiness / momentum / artists / schedule / money modes all answer", ["readiness", "momentum", "artists", "schedule"].every((m) => q(m).status === "OK") && q("money", { entity: `project:${P_PAID}` }).status === "OK");
  ok("coo is Owner-only (external non-owner refused)", queryKnowledgeCore(PARTNER_KNOWLEDGE_REGISTRY, { capability: "coo" }, S as never, { channel: "EXTERNAL", ownerAuthorized: false }).status !== "OK");
  const ent = entityKnowledge(PARTNER_KNOWLEDGE_REGISTRY, S as never, `project:${P_READY}`);
  ok("partner_entity(project) carries the COO section (readiness of its shoot)", ent.some((s) => s.capability === "coo" && s.items.length > 0), ent.map((s) => s.capability));
  const entA = entityKnowledge(PARTNER_KNOWLEDGE_REGISTRY, S as never, `label-artist:${A_AVI}`);
  ok("partner_entity(label-artist) carries artist care", entA.some((s) => s.capability === "coo"), entA.map((s) => s.capability));

  section("No side effects / no background mechanism (static)");
  const cooFiles = ["context", "model", "readiness", "momentum", "schedule", "money", "priorities"].map((f) => read(`lib/partner/coo/${f}.ts`)).join("\n") + read("lib/partner/knowledge/capabilities/coo.ts");
  ok("no DB write / RPC / fetch / supabase import in the COO layer", !/\.insert\(|\.update\(|\.upsert\(|\.delete\(|\.rpc\(|fetch\(|@\/lib\/supabase|from "server-only"|createSupabase/.test(cooFiles));
  ok("no push / cron / interval / timeout / scheduler / agent alert / calendar write / task write", !/sendPush|setInterval|setTimeout|cron|schedule\(|agent_alerts|createEvent|insertEvent|calendar\.events\.insert|tasks\.insert|writes\//.test(cooFiles));
  ok("no browser research / platform API triggered by reading", !/partner_observe|record_observations|CLAUDE_READ|PLATFORM_API/.test(cooFiles));
  ok("heuristics are declared as internal (not Owner policy) and served as such", /INTERNAL heuristics — engineering floors only\. NONE of these is Owner policy/.test(read("lib/partner/coo/model.ts")) && JSON.stringify(INTERNAL_COO_HEURISTICS).includes("heavyDayBusyMinutes"));
  ok("no new page-load reader: no app/ route imports the COO layer", !fs.readdirSync(path.join(ROOT, "app"), { recursive: true } as never).some((f) => /\.(ts|tsx)$/.test(String(f)) && /lib\/partner\/coo\//.test(fs.readFileSync(path.join(ROOT, "app", String(f)), "utf8"))));
  ok("the schedule never writes: it only reads availability()", /availability\(/.test(read("lib/partner/coo/schedule.ts")) && !/move|reschedule|patch/i.test(read("lib/partner/coo/schedule.ts").replace(/NO moving events|never moves|moves or writes|Never moves|what moves|מזיזים/g, "")));
  ok("AGENTS.md carries the COO awareness section", /Sunny COO V1/.test(read("AGENTS.md")) && /test-sunny-coo\.tsx/.test(read("AGENTS.md")));

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
void scheduleHealth;
