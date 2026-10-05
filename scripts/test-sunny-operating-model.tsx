/**
 * Sunny OWNER OPERATING MODEL — Owner-confirmed rules, event workflows and their deterministic application.
 * Scenarios A–H (mission 2026-09-25) + QA: provenance, no score, no invented payment terms, personal context stays
 * personal, show workflow asks only what is missing, no push / write path, repeated questions → improvement signal.
 *
 * Run with:   npx tsx scripts/test-sunny-operating-model.tsx      Pure; never touches production.
 */
import fs from "node:fs";
import path from "node:path";
import { PARTNER_KNOWLEDGE_REGISTRY } from "../lib/partner/knowledge/catalog";
import { queryKnowledgeCore } from "../lib/partner/knowledge/query";
import type { KnowledgeAudience, QueryResponse } from "../lib/partner/knowledge/types";
import type { GatewayFinance, GatewaySources } from "../lib/partner/gateway/core";
import type { OperationsRaw } from "../lib/partner/operations/types";
import type { ProjectDetailRaw } from "../lib/partner/projects/detail-types";
import type { OwnerKnowledgeRecord } from "../lib/partner/owner-knowledge/store";
import type { CalendarWindowResult, SunnyCalendarEvent } from "../lib/partner/calendar/types";
import type { CompanyIntegrityRegister } from "../lib/partner/integrity/types";
import { deriveFinanceView } from "../lib/partner/finance/view";
import { buildFinanceBrief } from "../lib/partner/finance/brief";
import { buildCalendarLinkIndex, linkCalendarEvent } from "../lib/partner/calendar/links";
import { companyOperating, projectOperating, repeatedQuestionSignals, showWorkflow } from "../lib/partner/sunny/operating";
import { HISTORICAL_DEBT_CUTOFF, OWNER_MODEL_VERSION, OWNER_OPERATING_RULES, QUESTION_TYPE_TO_MISSING_CONCEPT, WORKFLOW_MODELS } from "../lib/partner/system/owner-model";
import { CAPABILITY_CHANGES, DOMAIN_CONTRACTS, FORBIDDEN_SERVED_TERMS, SYSTEM_BASELINE_VERSION, validateSystemRegistry } from "../lib/partner/system";
import { KNOWLEDGE_GAPS, validateKnowledgeGaps } from "../lib/partner/system/gaps";
import { KNOWLEDGE_KINDS } from "../lib/partner/owner-knowledge/kinds";
import { C_SHALEV, LA_CLEAN, LA_SHALEV, NOW, P, U, input } from "./fixtures/integrity-company";
import { empty, tx } from "./fixtures/finance-mirror";
import type { SettingsState } from "../lib/partner/settings/types";
import type { LabelDetailRaw } from "../lib/partner/label/detail-types";
import { computeShowNotifyFingerprint } from "../lib/show-notify-pure";

let pass = 0, fail = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log(`  ✓ ${name}`); pass++; } else { console.log(`  ✗ ${name}\n      expected ${e}\n      actual   ${a}`); fail++; }
}
const ok = (name: string, cond: boolean) => { if (cond) { console.log(`  ✓ ${name}`); pass++; } else { console.log(`  ✗ ${name}`); fail++; } };
const section = (t: string) => console.log(`\n${t}`);
const ROOT = path.resolve(__dirname, "..");
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8");
const code = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const OWNER: KnowledgeAudience = { channel: "EXTERNAL", ownerAuthorized: true };
const STRANGER: KnowledgeAudience = { channel: "EXTERNAL", ownerAuthorized: false };
const REG = PARTNER_KNOWLEDGE_REGISTRY;

// ── fixture ──
const sec = <T,>(rows: T[]) => ({ rows, capped: false });
const EMPTY_DETAIL = Object.fromEntries(["projects", "financeNotes", "deliveries", "actions", "sessions", "meetings", "tasks", "engineerWork", "mixVersions", "mixComments", "commentAttachments", "mixTargets", "mixTargetNotes", "finalFiles", "victor", "productions", "budgetItems", "albumTracks", "clipItems", "proposals", "releases", "campaigns", "contentItems", "socialFiles", "projectSettings", "transactionsText", "budgetPayments", "agentAlerts", "notifications"].map((k) => [k, { rows: [], capped: false }])) as unknown as ProjectDetailRaw;
const ew = (id: number, pid: string, name: string, status: string, internalDeadline: string | null) => ({ id: U(id), projectId: pid, engineerName: name, workType: "מיקס + מאסטר", workTitle: null, status, sentDate: "2026-09-10", internalDeadline, agreedPrice: 200, amountPaid: 0, currency: "$", paymentDate: null });
const OPS: OperationsRaw = {
  redFilms: sec([]), budgetPayments: sec([]), clipItems: sec([]), meetings: sec([]), finalFiles: sec([]), deliveries: sec([]), mixVersions: sec([]), mixComments: sec([]),
  projectActions: sec([{ id: U(821), projectId: P(2), actionType: "sent", contentType: "mix", recipientRole: "artist", status: "pending_feedback", actionDate: "2026-09-15", followupDate: "2026-09-20" }]),
  engineerWork: sec([ew(851, P(2), "Steven", "בתהליך", "2026-09-20"), ew(852, P(4), "Steven", "בתהליך", "2026-10-10")]),
  projectsMeta: sec([]), budgetItems: sec([]), equipment: sec([]), beats: sec([]), beatAssignments: sec([]), campaigns: sec([]), contentItems: sec([]), promotions: sec([]), balanceCycles: sec([]), albumTracks: sec([]),
  integrations: { googleCalendarConnected: true, dropboxConnected: true },
};
const cev = (id: string, title: string, start: string, end: string, o: Partial<SunnyCalendarEvent> = {}): SunnyCalendarEvent => ({ id, calendarId: "primary", calendarName: "owner", holidayCalendar: false, title, untitled: false, description: null, start, end, allDay: false, timeZone: "Asia/Jerusalem", durationMinutes: (Date.parse(end) - Date.parse(start)) / 60000, location: null, attendees: [], attendeesOmitted: false, selfResponse: null, organizer: null, creator: null, invited: false, recurringEventId: null, originalStartTime: null, recurrence: null, status: "confirmed", eventType: "default", transparency: "opaque", visibility: null, created: null, updated: null, hasMeetingLink: false, hasAttachments: false, attachmentCount: 0, ...o });
const CAL: CalendarWindowResult = { status: "CALENDAR_DATA_AVAILABLE", window: { start: "2026-09-17T00:00:00+03:00", end: "2026-10-31T23:59:59+02:00", days: 45 }, fetchedAt: NOW.toISOString(), cache: "MISS", calendars: [], truncated: false, reasons: [],
  events: [
    cev("drv-1", "קורס יעודי פתח תקווה/דרום השרון", "2026-09-25T17:00:00+03:00", "2026-09-25T19:00:00+03:00", { recurringEventId: "drv" }),
    cev("drv-2", "קורס יעודי פתח תקווה/דרום השרון", "2026-10-15T18:00:00+03:00", "2026-10-15T20:00:00+03:00", { recurringEventId: "drv" }),
    cev("sess", "סשן", "2026-09-26T10:00:00+03:00", "2026-09-26T14:00:00+03:00"),
  ] };
const K = (kind: string, subjectKey: string, value: Record<string, unknown>, meaningHe: string): OwnerKnowledgeRecord => ({ id: `k-${kind}`, createdAt: "2026-09-24T10:00:00Z", kind, subjectKey, identityKeys: [subjectKey], slotKey: kind, value: value as OwnerKnowledgeRecord["value"], epistemic: "OWNER_REPORTED" as OwnerKnowledgeRecord["epistemic"], meaningHe, operation: "ASSERT", supersedesId: null, reviewAt: null, expiresAt: null, provenance: {} as OwnerKnowledgeRecord["provenance"], confirmationId: "c", itemIndex: 0 });
const P2 = [K("ORGANIZATIONAL_ROLE", `label-artist:${LA_CLEAN}`, { role: "LABEL_DJ" }, "DJ CLEANTONE הוא הדי-ג׳יי של הלייבל"), K("ENTITY_RELATIONSHIP", `label-artist:${LA_CLEAN}`, { relation: "PARTICIPATES_IN_SHOWS", frequency: "MOST", object: "company:REDBLOODS" }, "מנגן ברוב ההופעות")];

interface Opt { today?: string; deadlines?: Record<string, string>; victorInternal?: string; cal?: CalendarWindowResult | "NONE"; integrity?: CompanyIntegrityRegister; knowledge?: OwnerKnowledgeRecord[]; incomeFor?: string[]; exceptionFor?: string[]; settings?: SettingsState; labelDetail?: LabelDetailRaw }
function sources(o: Opt = {}): GatewaySources {
  const st = input({ contexts: [] }).state!;
  if (o.today) (st as { todayIL: string }).todayIL = o.today;
  for (const p of st.domains.projects.data?.open ?? []) {
    const d = o.deadlines?.[p.id];
    if (d) (p as { deadline: { ymd: string | null; daysTo: number | null } }).deadline = { ...p.deadline, ymd: d, daysTo: null };
  }
  if (o.victorInternal) for (const w of st.domains.victor.data?.active ?? []) (w as { internalDeadline: string | null }).internalDeadline = o.victorInternal;
  const raw = empty({ transactions: (o.incomeFor ?? [P(2)]).map((pid) => tx({ projectId: pid, type: "income", amount: 600, status: "שולם" })), financeSettings: [{ projectId: P(2), value: { agreedPrice: 1000, currency: "₪" } }, ...(o.exceptionFor ?? []).map((pid) => ({ projectId: pid, value: { financeException: true, financeExceptionReason: "הכסף התקבל מחוץ למערכת", financeExceptionDate: "2026-09-20" } }))] });
  const view = deriveFinanceView(raw, NOW, []);
  const f: GatewayFinance = { state: view.state, integrity: view.integrity, actions: view.actions, raw, brief: buildFinanceBrief(view.state, view.integrity, { answersAvailable: true, actionNoteHe: view.actionNoteHe }), answersAvailable: true };
  return { now: NOW, state: { status: "OK", value: st }, finance: { status: "OK", value: f }, identities: { cleantone: null },
    cases: { status: "OK", value: [] }, actions: { status: "OK", value: [] }, outcomes: { status: "OK", value: [] }, ownerKnowledge: { status: "OK", value: o.knowledge ?? P2 },
    projectDetail: { status: "OK", value: EMPTY_DETAIL }, operations: { status: "OK", value: OPS },
    ...(o.cal === "NONE" ? {} : { calendar: { status: "OK" as const, value: o.cal ?? CAL } }),
    ...(o.integrity ? { integrity: { status: "OK" as const, value: o.integrity } } : {}),
    ...(o.settings ? { settings: { status: "OK" as const, value: o.settings } } : {}),
    ...(o.labelDetail ? { labelDetail: { status: "OK" as const, value: o.labelDetail } } : {}) };
}
const q = (mode: string, params: Record<string, string> = {}, src = sources(), aud = OWNER): QueryResponse => queryKnowledgeCore(REG, { capability: "operating_model", mode, params }, src, aud);
const itemsOf = (r: QueryResponse) => (r.status === "OK" ? r.items : []);
const served = (r: QueryResponse) => r.status === "OK";

function main() {
  section("1. Owner-confirmed rules — provenance, coverage, no invented policy");
  ok("29 rules, every one OWNER_CONFIRMED with a date (16 on 2026-09-25 + Owner authority / \"בוס\" + the 8 integrity-mission decisions + the 3 business rules of 2026-09-27: the שליו / אבי agreement, 'לבדיקה' retired, the team ball cycle)", OWNER_OPERATING_RULES.length === 29 && OWNER_OPERATING_RULES.every((r) => r.provenance === "OWNER_CONFIRMED" && (r.confirmedAt === "2026-09-25" || (r.confirmedAt === "2026-09-27" && ["OWNER_IS_FINAL_AUTHORITY", "ADDRESS_OWNER_AS_BOSS", "PRESENCE_PUSH_ONE_PER_VISIT", "VICTOR_STUCK_SIGNAL_NOT_PUSH", "SHALEV_AVI_PROJECTS_ARE_LABEL", "CLIENT_PAID_IS_NOT_FEE_PAID", "RECOUP_ONLY_PER_AGREEMENT", "RF_PAYMENT_IS_COMPANY_EXPENSE", "TIME_PASSED_IS_NOT_HAPPENED", "NO_SILENT_FX", "SHALEV_AVI_AGREEMENT", "INCOME_STATUS_LEBDIKA_RETIRED", "TEAM_BALL_CYCLE"].includes(r.id)))));
  ok("every rule says what Sunny does AND what it does not mean", OWNER_OPERATING_RULES.every((r) => r.sunnyBehavior.length > 0 && r.doesNotMean.length > 0));
  const ids = OWNER_OPERATING_RULES.map((r) => r.id);
  for (const want of ["CLIENT_DEADLINE_IS_COMMITMENT", "INTERNAL_DEADLINE_IS_EXPECTATION", "HISTORICAL_OVERDUE_IS_OPERATIONAL_DEBT", "CONTINUOUS_PROJECT_OWNERSHIP", "INVESTIGATE_THEN_ASK", "OUTSIDE_COMMUNICATION_EXISTS", "LEARNING_LOOP", "CASHFLOW_TOP_OPERATIONAL_PRIORITY", "ADVANCE_THEN_LATER_PAYMENT", "LABEL_ARTISTS_PROTECTED_GROWTH_TRACK", "MONEY_AND_LABEL_ARE_CONNECTED", "NO_FIXED_WORK_HOURS", "PERSONAL_CONTEXT_IS_REAL_SCHEDULE", "ALIASES_LEARNED_PROGRESSIVELY", "EVENT_STARTS_WORKFLOW", "SUGGEST_SYSTEM_IMPROVEMENTS"]) ok(`rule ${want}`, ids.includes(want));
  const rulesText = JSON.stringify(OWNER_OPERATING_RULES);
  // the ONLY percentages are the Owner's own agreement (2026-09-27) — pinned exactly; no other rule carries a percentage / amount
  const agreementRule = OWNER_OPERATING_RULES.find((r) => r.id === "SHALEV_AVI_AGREEMENT");
  const otherRulesText = JSON.stringify(OWNER_OPERATING_RULES.filter((r) => r.id !== "SHALEV_AVI_AGREEMENT"));
  ok("no invented payment percentage / amount in the rules (the Owner's agreement percentages only, pinned)", !/\d+\s?%|₪\s?\d|\d+\s?₪/.test(otherRulesText) && !!agreementRule && /production \/ mix \/ master = 100 % label; clip = 50 % label \/ 50 % artist of the ACTUAL PAID cost; show = 50 \/ 50 of the NET profit/.test(JSON.stringify(agreementRule)) && !/₪\s?\d|\d+\s?₪/.test(JSON.stringify(agreementRule)));
  const rulesExceptIdentity = JSON.stringify(OWNER_OPERATING_RULES.filter((r) => r.id !== "OWNER_IS_FINAL_AUTHORITY"));
  ok("open questions are NOT silently answered (את היחידה / קרוב אלייך absent; Nagash only in the Owner-answered identity rule, 2026-09-27)", !/נגש|Nagash|את היחידה|קרוב אלייך/.test(rulesExceptIdentity + JSON.stringify(WORKFLOW_MODELS) + read("lib/partner/sunny/operating.ts")) && /Nagash \(נגש\)/.test(JSON.stringify(OWNER_OPERATING_RULES.find((r) => r.id === "OWNER_IS_FINAL_AUTHORITY"))));
  const rr = q("rules");
  ok("capability serves the rules (Owner)", served(rr) && itemsOf(rr).length === OWNER_OPERATING_RULES.length && itemsOf(rr).length === 29 && itemsOf(rr).every((i) => i.epistemic === "OWNER_DECISION"));
  ok("rules filtered by area", itemsOf(q("rules", { area: "DEADLINES" })).length === 3);
  ok("operating_model is Owner-only", !served(q("rules", {}, sources(), STRANGER)));
  ok("version fact served", served(rr) && rr.summary.some((f) => f.code === "OWNER_MODEL_VERSION" && f.value === OWNER_MODEL_VERSION));

  section("SCENARIO A — client deadline in 3 days, work with an engineer, internal deadline passed");
  const a = projectOperating(sources({ deadlines: { [P(2)]: "2026-09-27" }, victorInternal: "2026-09-20" }), P(2))!;
  check("client deadline class AT_RISK", a.clientDeadline.class, "AT_RISK");
  ok("risk: Steven's internal deadline passed", a.clientDeadline.risks.some((r) => /Steven's internal deadline \(2026-09-20\) has passed/.test(r)));
  ok("risk: Victor's internal deadline passed", a.clientDeadline.risks.some((r) => /Victor's internal deadline/.test(r)));
  ok("internal deadlines are expectations, not the client commitment", a.internalDeadlines.length >= 2 && a.internalDeadlines.every((i) => /not the client commitment/.test(i.meaning)));
  ok("client deadline meaning = commitment", /commitment/.test(a.clientDeadline.meaning));
  ok("ball holder evidence names the engineer (RECORDED) and the artist feedback wait", a.ballHolder.evidence.some((b) => b.holder === "ENGINEER:Steven" && b.confidence === "RECORDED") && a.ballHolder.evidence.some((b) => b.holder === "ARTIST"));
  ok("occupancy until the deadline from the live calendar, personal time counted", !!a.occupancyUntilDeadline && (a.occupancyUntilDeadline as { occupiedMinutes?: number }).occupiedMinutes! > 0 && /personal/.test(a.occupancyUntilDeadline.note));
  const aq = q("project", { project: `project:${P(2)}` }, sources({ deadlines: { [P(2)]: "2026-09-27" }, victorInternal: "2026-09-20" }));
  ok("capability project mode serves the assessment", served(aq) && itemsOf(aq).some((i) => i.id === "client_deadline" && i.fields.class === "AT_RISK"));
  check("no deadline + calm → UPCOMING when far", projectOperating(sources({ deadlines: { [P(2)]: "2026-10-20" } }), P(2))!.clientDeadline.class, "UPCOMING");

  section("SCENARIO B — historical overdue project (operational debt, not an emergency)");
  const b = projectOperating(sources({ deadlines: { [P(2)]: "2026-05-01" } }), P(2))!;
  check("old passed deadline → HISTORICAL_OPERATIONAL_DEBT", b.clientDeadline.class, "HISTORICAL_OPERATIONAL_DEBT");
  ok("asks for the real state / rehabilitation step (not an alert)", b.questions.some((x) => x.kind === "DEADLINE_REALITY" && /not an emergency/.test(x.why)));
  check("cutoff", HISTORICAL_DEBT_CUTOFF, "2026-09-25");
  const cmp = companyOperating(sources({ deadlines: { [P(2)]: "2026-05-01" } }));
  ok("company view counts debt separately from new failures", cmp.deadlines.historicalDebt === 1 && cmp.deadlines.newFailures.length === 0);

  section("SCENARIO C — a NEW deadline failure after the cutoff");
  const c = projectOperating(sources({ today: "2026-10-10", deadlines: { [P(2)]: "2026-10-01" } }), P(2))!;
  check("passed after the cutoff → PASSED_NEW_FAILURE", c.clientDeadline.class, "PASSED_NEW_FAILURE");
  ok("no language that blames the Owner / team in the assessment", !/fail(ed)? by|fault|blame|lazy/i.test(JSON.stringify(c)));

  section("SCENARIO D — 'נכנסה הופעה לשליו ב-15.10'");
  const d = showWorkflow(sources(), `label-artist:${LA_SHALEV}`, "2026-10-15");
  ok("resolved as a NEW_SHOW workflow for שליו טסמה", d.resolved && d.workflow === "NEW_SHOW" && d.artist === "שליו טסמה" && d.existingShow === null);
  const asks = d.resolved ? d.questions.map((x) => x.questionHe).join(" | ") : "";
  ok("asks price, venue, DJ, status", /מחיר/.test(asks) && /איפה/.test(asks) && /CLEANTONE/.test(asks) && /סגורה/.test(asks));
  ok("does NOT ask what is known (date / artist / DJ fee / split)", !/תאריך/.test(asks) && !/500|חלוקה/.test(asks));
  ok("CLEANTONE is a frequency → confirm, never assumed", d.resolved && d.questions.some((x) => /never assume/.test(x.why)));
  ok("known: DJ fee default 500 + split (system contract)", d.resolved && d.known.some((k) => k.item === "DJ fee default" && k.value === 500 && k.source === "SYSTEM_CONTRACT"));
  ok("calendar on 15.10 shows the personal driving course (context, not a business fact)", d.resolved && !!d.calendarOnDate?.events?.some((e) => /קורס/.test(e.title ?? "")));
  ok("downstream effects: finance triple, Shalev ledger, portals", d.resolved && d.downstream.some((x) => /2 finance rows/.test(x) && /ENTITLEMENT/.test(x)) && d.downstream.some((x) => /Shalev/.test(x)));
  ok("notifications are proposals only (not applicable until registered)", d.resolved && d.notifications.every((n) => n.state === "NOT_APPLICABLE_YET"));
  ok("actions are FUTURE_PRIMITIVE_REQUIRED", d.resolved && d.actions.every((x) => /FUTURE_PRIMITIVE_REQUIRED/.test(x) || /^CLOSE_SHOW — executable/.test(x)));
  const dd = q("show", { artist: `label-artist:${LA_SHALEV}`, date: "2026-10-15" });
  ok("capability show mode: items flagged sunnySends=false", served(dd) && itemsOf(dd).filter((i) => i.id.startsWith("notify:")).every((i) => i.fields.sunnySends === false));
  const ex = showWorkflow(sources(), `client:${C_SHALEV}`, "2026-08-06");
  ok("an already-registered show is recognised (no duplicate workflow)", ex.resolved && ex.existingShow === `show:${U(401)}` && ex.questions.length === 0);
  ok("settings unreadable → notification state UNKNOWN (never 'not sent')", ex.resolved && ex.notifications.every((n) => n.state === "UNKNOWN"));
  // the one read rule (showNotifyStateOf with the show's CURRENT fingerprint) — the same answer as the send button / show_view
  const SHOW_EX = U(401);
  const exRow = { id: SHOW_EX, name: "הופעה בחיפה", date: "2026-08-06", startTime: "21:00", location: "חיפה" };
  const LDX = { shows: sec([exRow]) } as unknown as LabelDetailRaw;
  const curFp = computeShowNotifyFingerprint({ name: exRow.name, date: exRow.date, startTime: exRow.startTime, location: exRow.location });
  const withClaim = (value: Record<string, unknown> | null, ld: LabelDetailRaw | undefined = LDX) => {
    const st: SettingsState = { families: { SHOW_SENT_TO_ARTIST: sec(value ? [{ key: `show_notify:${SHOW_EX}`, updatedAt: null, value }] : []), SHOW_SENT_TO_DJ: sec([]) } } as unknown as SettingsState;
    const w = showWorkflow(sources({ settings: st, labelDetail: ld }), `client:${C_SHALEV}`, "2026-08-06");
    return w.resolved ? w.notifications.find((n) => n.push === "P_SHOW_TO_ARTIST")! : null;
  };
  const nSent = withClaim({ status: "sent", fingerprint: curFp, claimedAt: "2026-08-01T10:00:00Z", sentAt: "2026-08-01T10:00:05Z" });
  ok("notify: sent for the CURRENT version → SENT, no send proposal", nSent?.state === "SENT" && nSent.proposal === null);
  const nOld = withClaim({ status: "sent", fingerprint: computeShowNotifyFingerprint({ name: exRow.name, date: "2026-08-05", startTime: exRow.startTime, location: exRow.location }), claimedAt: "2026-08-01T10:00:00Z", sentAt: "2026-08-01T10:00:05Z" });
  ok("notify: sent for an OLDER version (date changed) → SENT_PREVIOUS_VERSION, proposes asking the Owner to send again", nOld?.state === "SENT_PREVIOUS_VERSION" && typeof nOld.proposal === "string" && /NOTIFY_SHOW_ARTIST/.test(nOld.proposal));
  const nFail = withClaim({ status: "failed", fingerprint: curFp, claimedAt: "2026-08-01T10:00:00Z" });
  ok("notify: a failed send → FAILED, proposes a send", nFail?.state === "FAILED" && typeof nFail.proposal === "string");
  const nProc = withClaim({ status: "processing", fingerprint: curFp, claimedAt: "2026-08-01T10:00:00Z" });
  ok("notify: in flight → PROCESSING, never proposes a second send", nProc?.state === "PROCESSING" && nProc.proposal === null);
  const nNone = withClaim(null);
  ok("notify: no claim row → NOT_SENT, proposes a send", nNone?.state === "NOT_SENT" && typeof nNone.proposal === "string");
  const nNoLd = withClaim({ status: "sent", fingerprint: curFp, claimedAt: "2026-08-01T10:00:00Z", sentAt: "2026-08-01T10:00:05Z" }, { shows: sec([]) } as unknown as LabelDetailRaw);
  ok("notify: the show's version unreadable (no time / place) → UNKNOWN, never SENT / never a proposal", nNoLd?.state === "UNKNOWN" && nNoLd.proposal === null);
  ok("operating.ts reads the sent state with the app's showNotifyStateOf + computeShowNotifyFingerprint (no inline mapping)", /showNotifyStateOf\(/.test(code(read("lib/partner/sunny/operating.ts"))) && /computeShowNotifyFingerprint\(/.test(code(read("lib/partner/sunny/operating.ts"))) && !/v\.status === "failed" \? "FAILED"/.test(read("lib/partner/sunny/operating.ts")));
  const un = showWorkflow(sources(), "label-artist:nope", "2026-10-15");
  ok("unknown artist → ask, never guess", !un.resolved && /למי/.test(un.questions[0].questionHe));

  section("SCENARIO E — advance evidence (never an invented amount)");
  const e4 = projectOperating(sources({ incomeFor: [P(2)] }), P(4))!;
  check("client project with engineer work and no received income → ADVANCE_EVIDENCE_MISSING", e4.advance.state, "ADVANCE_EVIDENCE_MISSING");
  ok("asks whether an advance arrived", e4.questions.some((x) => x.kind === "PAYMENT_EVIDENCE"));
  ok("no amount / percentage invented anywhere in the assessment", !/\d+\s?%|expected advance|advanceAmount/.test(JSON.stringify(e4)));
  check("payment recorded → ADVANCE_OR_PAYMENT_RECORDED", projectOperating(sources(), P(2))!.advance.state, "ADVANCE_OR_PAYMENT_RECORDED");
  check("label work → NOT_APPLICABLE_LABEL_WORK", projectOperating(sources(), P(1))!.advance.state, "NOT_APPLICABLE_LABEL_WORK");
  // Stage 1 (2026-09-29): the Owner's finance exception explains the money — never "was an advance received?"
  const e4x = projectOperating(sources({ incomeFor: [P(2)], exceptionFor: [P(4)] }), P(4))!;
  check("finance exception → NOT_APPLICABLE_FINANCE_EXCEPTION (the same project, same evidence)", e4x.advance.state, "NOT_APPLICABLE_FINANCE_EXCEPTION");
  ok("finance exception → no PAYMENT_EVIDENCE question, no 'no advance' risk", !e4x.questions.some((x) => x.kind === "PAYMENT_EVIDENCE") && !e4x.clientDeadline.risks.includes("no advance / payment evidence"));
  ok("the exception evidence carries the Owner's reason + date", /2026-09-20/.test(e4x.advance.evidence) && /מחוץ למערכת/.test(e4x.advance.evidence));

  section("SCENARIO F — outside communication / who holds the ball");
  const f = projectOperating(sources(), P(2))!;
  ok("send-log wait carries outsideCommunicationPossible", f.ballHolder.evidence.some((x) => x.holder === "ARTIST" && x.outsideCommunicationPossible));
  const ownerInApp = f.ballHolder.evidence.some((x) => x.holder === "OWNER" && x.confidence === "IN_APP_TIMESTAMPS");
  ok("Owner-as-holder from in-app timestamps → asks about outside communication (only then)", ownerInApp === f.questions.some((x) => x.kind === "OUTSIDE_COMMUNICATION"));
  const f6 = projectOperating(sources(), P(6))!;
  ok("no evidence at all → UNKNOWN + ask (never inferred from age)", f6.ballHolder.certainty === "UNKNOWN" && f6.questions.some((x) => x.kind === "PROJECT_STATE"));

  section("SCENARIO K — known context (Owner decisions D1 / D3 / D4, 2026-10-05): what the Owner told Sunny is never asked again as new");
  {
    const KK = (id: string, kind: string, pid: string, value: Record<string, unknown>, meaningHe: string, o: Partial<OwnerKnowledgeRecord> = {}): OwnerKnowledgeRecord => ({ id, createdAt: "2026-09-23T10:00:00Z", kind, subjectKey: `project:${pid}`, identityKeys: [`project:${pid}`], slotKey: id, value: value as OwnerKnowledgeRecord["value"], epistemic: "OWNER_REPORTED", meaningHe, operation: "ASSERT", supersedesId: null, reviewAt: null, expiresAt: null, ...o } as OwnerKnowledgeRecord);
    const pay = KK("k-pay", "PAYMENT_REPORTED_BY_OWNER", P(4), { direction: "RECEIVED", amount: 1000, currency: "₪", date: "2026-09-20" }, "הבוס דיווח: התקבל ₪1,000");
    const k1 = projectOperating(sources({ incomeFor: [P(2)], knowledge: [pay] }), P(4))!;
    ok("K1. a RECEIVED payment the Owner reported on THIS project → no PAYMENT_EVIDENCE question; a known line with the canonical path (ADD_TRANSACTION prefilled)", !k1.questions.some((x) => x.kind === "PAYMENT_EVIDENCE") && k1.known.some((k) => k.questionKind === "PAYMENT_EVIDENCE" && k.actions[0]?.actionId === "ADD_TRANSACTION" && k.actions[0].args.amount === 1000));
    ok("K1b. …the advance evidence itself is unchanged (knowledge never changes the money)", k1.advance.state === "ADVANCE_EVIDENCE_MISSING");
    const paidOut = KK("k-paid", "PAYMENT_REPORTED_BY_OWNER", P(4), { direction: "PAID", amount: 1000, currency: "₪" }, "שילמתי");
    ok("K2. 'שילמתי' (PAID) never answers 'was an advance received?' — the question stays", projectOperating(sources({ incomeFor: [P(2)], knowledge: [paidOut] }), P(4))!.questions.some((x) => x.kind === "PAYMENT_EVIDENCE"));
    const payOther = { ...pay, id: "k-pay2", subjectKey: `project:${P(2)}`, identityKeys: [`project:${P(2)}`] };
    ok("K3. cross-entity: a payment reported on another project never answers this one", projectOperating(sources({ incomeFor: [P(2)], knowledge: [payOther] }), P(4))!.questions.some((x) => x.kind === "PAYMENT_EVIDENCE"));
    const fu = KK("k-fu", "FOLLOW_UP_EXPECTATION", P(6), { who: "OWNER_WILL_CONTACT", whenRelative: "NEXT_WEEK" }, "אתה חוזר לפרויקט בשבוע הבא.", { reviewAt: "2026-10-01" });
    const k4 = projectOperating(sources({ knowledge: [fu] }), P(6))!;
    ok("K4. PROJECT_STATE answered once (a project follow-up expectation) → no PROJECT_STATE question; the ball is OWNER_REPORTED; a known line", !k4.questions.some((x) => x.kind === "PROJECT_STATE") && k4.ballHolder.evidence.some((b) => b.holder === "OWNER" && b.confidence === "OWNER_REPORTED") && k4.known.some((k) => k.questionKind === "PROJECT_STATE" && k.state === "KNOWN_MATCHES"));
    const due = KK("k-bl", "PROJECT_BLOCKER", P(6), { reason: "WAITING_FOR_ARTIST" }, "מחכים לאמן", { reviewAt: "2026-09-20" });
    const k5 = projectOperating(sources({ knowledge: [due] }), P(6))!;
    ok("K5. D3: a blocker whose reviewAt passed → 'זה עדיין נכון?' (STILL_TRUE_CHECK) — not silence, not the bare original question", k5.known.some((k) => k.state === "STILL_TRUE_CHECK" && /עדיין נכון\?/.test(k.textHe)) && !k5.questions.some((x) => x.kind === "PROJECT_STATE"));
    const old = KK("k-old", "PROJECT_BLOCKER", P(2), { reason: "WAITING_FOR_OWNER" }, "מחכה לבעלים", { createdAt: "2026-09-10T10:00:00Z" });
    const k6 = projectOperating(sources({ knowledge: [old] }), P(2))!;
    ok("K6. D3: a send-log entry (15.09) NEWER than the blocker (10.09) → the old blocker is not treated as still true (no ball entry, no known line)", !k6.ballHolder.evidence.some((b) => b.confidence === "OWNER_REPORTED") && !k6.known.some((k) => k.basis.kind === "OWNER_KNOWLEDGE" && (k.basis as { knowledgeId: string }).knowledgeId === "k-old"));
    const fresh = KK("k-new", "PROJECT_BLOCKER", P(2), { reason: "WAITING_FOR_OWNER" }, "מחכה לבעלים", { createdAt: "2026-09-20T10:00:00Z" });
    ok("K6b. …the same blocker said AFTER the evidence stands", projectOperating(sources({ knowledge: [fresh] }), P(2))!.ballHolder.evidence.some((b) => b.confidence === "OWNER_REPORTED"));
    const withMem = (d: Record<string, unknown>) => ({ ...sources({ deadlines: { [P(2)]: "2026-05-01" } }), memory: { status: "OK" as const, value: { entities: [{ ownerDecisions: [{ entity: `project:${P(2)}`, contextId: "ctx-1", questionId: "q", answerValueYmd: null, answeredAt: "2026-09-22T10:00:00Z", status: "ACTIVE", supersedesId: null, ...d }] }] } as never } });
    const k7 = projectOperating(withMem({ questionType: "WHAT_IS_NEW_PROJECT_DEADLINE", answerCode: "SPECIFIC_DATE", answerValueYmd: "2026-10-20" }), P(2))!;
    ok("K7. DEADLINE_REALITY answered (Owner Context: new deadline 20.10) → no DEADLINE_REALITY question; known line + UPDATE_PROJECT_DEADLINE 2026-10-20 (a proposal)", !k7.questions.some((x) => x.kind === "DEADLINE_REALITY") && k7.known.some((k) => k.questionKind === "DEADLINE_REALITY" && k.state === "KNOWN_DECISION_RECONCILE" && k.actions[0]?.actionId === "UPDATE_PROJECT_DEADLINE" && k.actions[0].args.deadline === "2026-10-20"));
    const k8 = projectOperating(withMem({ questionType: "WHY_DEADLINE_STILL_ACTIVE", answerCode: "CLIENT_DELAY" }), P(2))!;
    ok("K8. 'why is the deadline still active' answered (עיכוב מצד הלקוח) → known line, no action invented, no repeated question", !k8.questions.some((x) => x.kind === "DEADLINE_REALITY") && k8.known.some((k) => k.questionKind === "DEADLINE_REALITY" && k.actions.length === 0 && /עיכוב מצד הלקוח/.test(k.textHe)));
    const k9 = projectOperating(withMem({ questionType: "WHY_DEADLINE_STILL_ACTIVE", answerCode: "CLIENT_DELAY", status: "SUPERSEDED" }), P(2))!;
    ok("K9. a superseded answer does not count → the question is asked", k9.questions.some((x) => x.kind === "DEADLINE_REALITY"));
    const cap = q("project", { project: `project:${P(4)}` }, sources({ incomeFor: [P(2)], knowledge: [pay] }));
    ok("K10. the capability serves the known lines (record text, the basis, the canonical path)", served(cap) && itemsOf(cap).some((i) => i.id.startsWith("known:") && (i.fields as { questionKind?: string }).questionKind === "PAYMENT_EVIDENCE"));
  }

  section("SCENARIO G — personal calendar context stays personal");
  const stG = sources().state;
  const idx = buildCalendarLinkIndex(OPS, stG && stG.status === "OK" ? stG.value : null);
  check("driving course is UNLINKED (never a business fact, never attached to a project)", linkCalendarEvent(CAL.events[0], idx).quality, "UNLINKED");
  ok("PERSONAL_CONTEXT rule: part of the real schedule, not a business fact", /personal/i.test(OWNER_OPERATING_RULES.find((r) => r.id === "PERSONAL_CONTEXT_IS_REAL_SCHEDULE")!.rule));
  ok("no P2 kind for a personal event → model gap registered, nothing stored", !KNOWLEDGE_KINDS.some((k) => /PERSONAL/.test(k.kind)) && KNOWLEDGE_GAPS.some((g) => g.id === "OWN_P2_NO_PERSONAL_EVENT_KIND" && g.status === "FUTURE_SCHEMA_REQUIRED"));
  ok("NO_FIXED_WORK_HOURS: 08–22 is a visualization default only", /VISUALIZATION default/.test(JSON.stringify(OWNER_OPERATING_RULES.find((r) => r.id === "NO_FIXED_WORK_HOURS"))));
  const sched = DOMAIN_CONTRACTS.find((dc) => dc.id === "SESSIONS")!.rules.find((r) => r.id === "SCHEDULING_RULES")!;
  ok("the session-picker hours are no longer taught as Owner policy", sched.class === "IMPLEMENTATION_BEHAVIOR" && /NOT the Owner's working hours/.test(sched.text));
  ok("calendar unreadable → occupancy says unknown (never free)", /unknown/.test(JSON.stringify(projectOperating(sources({ cal: "NONE", deadlines: { [P(2)]: "2026-09-27" } }), P(2))!.occupancyUntilDeadline)));

  section("SCENARIO H — money vs label trade-off (no score) + repeated questions");
  const co = companyOperating(sources());
  ok("company context has cashflow + label + deadlines", !!co.cashflow && !!co.label && !!co.deadlines);
  ok("no score / rank / priority number", !/"(score|rank|priorityScore|weight)"/.test(JSON.stringify(co)));
  ok("trade-off guidance: connected, explain, never drop one side", /connected/.test(co.tradeoffGuidance) && /never drop one side/.test(co.tradeoffGuidance));
  ok("label rule: protected growth track", /protected growth track/.test(co.label.rule));
  const cq = q("company");
  ok("capability company mode served", served(cq) && itemsOf(cq).length === 3);
  const reg = { questions: [{ questionType: "PROJECT_PRICE" }, { questionType: "PROJECT_PRICE" }, { questionType: "WAITING_ON_CLIENT_OR_ARTIST" }], learned: [{ status: "APPLIES", entityKey: "x", decision: { questionType: "WAITING_ON_CLIENT_OR_ARTIST", answerCode: "X" } }], deferredQuestions: 0, findings: [] } as unknown as CompanyIntegrityRegister;
  const sig = repeatedQuestionSignals(sources({ integrity: reg }));
  ok("repeated question types → PATTERN_CANDIDATE with the missing Redbloods concept", sig.length === 2 && sig.every((s) => s.epistemic === "PATTERN_CANDIDATE" && !!s.missingConcept));
  ok("the Owner decides; Sunny never changes the product", sig.every((s) => /Owner decides/.test(s.decision)));
  ok("every mapped question type names a concept", Object.values(QUESTION_TYPE_TO_MISSING_CONCEPT).every((v) => v.length > 10));
  ok("repeated_questions mode served", served(q("repeated_questions", {}, sources({ integrity: reg }))));

  section("2. workflows — event → workflow");
  check("workflow events", WORKFLOW_MODELS.map((w) => w.event), ["NEW_SHOW", "PAST_SHOW_NOT_CLOSED", "NEW_PROJECT", "NEW_CLIENT_OR_LEAD", "NEW_PAYMENT", "NEW_SESSION", "NEW_RELEASE", "NEW_CLIP", "NEW_TASK"]);
  ok("every workflow lists required info with a source, downstream and actions", WORKFLOW_MODELS.every((w) => w.required.length > 0 && w.downstream.length > 0 && w.actions.length > 0));
  ok("no workflow action is executable by Sunny except the existing deadline primitive", WORKFLOW_MODELS.flatMap((w) => w.actions).every((x) => /FUTURE|PROPOSAL_CANDIDATE|NOT_YET_EXECUTABLE|UPDATE_PROJECT_DEADLINE|never/.test(x)));
  const wq = q("workflows", { event: "NEW_SHOW" });
  ok("workflows mode: askOwner list", served(wq) && Array.isArray(itemsOf(wq)[0].fields.askOwner) && (itemsOf(wq)[0].fields.askOwner as string[]).includes("price + currency"));

  section("3. System Awareness cross-links + safety");
  ok("baseline at least -6", ((v) => v.date > "2026.09.25" || (v.date === "2026.09.25" && v.n >= 6))({ date: SYSTEM_BASELINE_VERSION.split("-")[0], n: Number(SYSTEM_BASELINE_VERSION.split("-")[1]) }));
  ok("CAPABILITY_CHANGES has the -6 entry", CAPABILITY_CHANGES.some((x) => x.version === "2026.09.25-6" && x.domain === "SUNNY_CORE"));
  ok("SUNNY_CORE reads operating_model + OWNER_OPERATING_MODEL rule", DOMAIN_CONTRACTS.find((x) => x.id === "SUNNY_CORE")!.readCapabilities.includes("operating_model") && DOMAIN_CONTRACTS.find((x) => x.id === "SUNNY_CORE")!.rules.some((r) => r.id === "OWNER_OPERATING_MODEL"));
  check("system registry valid", validateSystemRegistry({ capabilityIds: REG.all().map((c) => c.id), knowledgeKinds: KNOWLEDGE_KINDS.map((k) => k.kind) }), []);
  check("gaps valid", validateKnowledgeGaps({ domainIds: DOMAIN_CONTRACTS.map((x) => x.id), capabilityIds: REG.all().map((c) => c.id) }), []);
  for (const g of ["OWN_P2_NO_PERSONAL_EVENT_KIND", "OWN_POLICY_CANDIDATE_TOO_WEAK", "OWN_DEAL_TERMS_NOT_RECORDED", "OWN_OUTSIDE_COMMUNICATION", "OWN_DEADLINE_KIND_NOT_RECORDED", "OWN_PROTECTED_LABEL_ARTIST", "OWN_PERSONAL_SOURCES"]) ok(`gap ${g}`, KNOWLEDGE_GAPS.some((x) => x.id === g));
  const servedText = JSON.stringify([itemsOf(q("rules")), itemsOf(q("workflows")), itemsOf(q("company")), itemsOf(q("project", { project: `project:${P(2)}` })), itemsOf(q("show", { artist: `label-artist:${LA_SHALEV}`, date: "2026-10-15" }))]);
  const hits = FORBIDDEN_SERVED_TERMS.filter((t) => servedText.includes(t));
  check("no forbidden served terms (secrets / tables / env)", hits, []);
  const src = code(read("lib/partner/sunny/operating.ts") + read("lib/partner/knowledge/capabilities/operating.ts") + read("lib/partner/system/owner-model.ts"));
  ok("pure: no DB / fetch / write / push / calendar-write path", !/supabase|fetch\(|\.insert\(|\.update\(|\.upsert\(|\.delete\(|sendPush|push\/check|createEvent|events\.insert/.test(src));
  ok("improvement_signals no longer claims the calendar is unread", !/Google Calendar לא נקרא/.test(read("lib/partner/knowledge/capabilities/sunny.ts")));
  ok("AGENTS.md carries the operating-model awareness rule", /Owner operating model/.test(read("AGENTS.md")));

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}
main();
