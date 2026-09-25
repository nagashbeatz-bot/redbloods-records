/**
 * Sunny CLIENTS + PROPOSALS DEEP BRAIN — coverage guards + reasoning scenarios A–J.
 *
 * Guards (permanent): the client / proposal schema columns are fully classified; the status / type / meeting
 * vocabularies equal what the code declares; every API route that touches clients / proposals is inventoried; the
 * server-side client / proposal / meeting files are unchanged since the last review (CLIENT_REVIEWED_FINGERPRINTS);
 * every action route exists; the client detail reader is SELECT-only.
 *
 * Run with:   npx tsx scripts/test-sunny-clients.tsx      Pure; never touches production.
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { PARTNER_KNOWLEDGE_REGISTRY } from "../lib/partner/knowledge/catalog";
import { queryKnowledgeCore } from "../lib/partner/knowledge/query";
import type { KnowledgeAudience, QueryResponse } from "../lib/partner/knowledge/types";
import type { GatewayFinance, GatewaySources } from "../lib/partner/gateway/core";
import type { OperationsRaw } from "../lib/partner/operations/types";
import type { ProjectDetailRaw } from "../lib/partner/projects/detail-types";
import type { ClientDetailRaw } from "../lib/partner/clients/detail-types";
import { CLIENT_DETAIL_SOURCES } from "../lib/partner/clients/detail-types";
import type { CalendarWindowResult, SunnyCalendarEvent } from "../lib/partner/calendar/types";
import { deriveFinanceView } from "../lib/partner/finance/view";
import { buildFinanceBrief } from "../lib/partner/finance/brief";
import { buildClientView, clientPortfolio, clientWorkflow } from "../lib/partner/clients/view";
import * as CM from "../lib/partner/system/clients";
import { PROJECT_TABLE_COLUMNS } from "../lib/partner/system/project-columns";
import { DOMAIN_CONTRACTS, FORBIDDEN_SERVED_TERMS, SYSTEM_BASELINE_VERSION, CAPABILITY_CHANGES, validateSystemRegistry } from "../lib/partner/system";
import { DOMAIN_KNOWLEDGE_DEPTH, KNOWLEDGE_GAPS, validateKnowledgeGaps } from "../lib/partner/system/gaps";
import { KNOWLEDGE_KINDS } from "../lib/partner/owner-knowledge/kinds";
import { C_AVI, C_DUP1, C_DUP2, C_SHALEV, LA_SHALEV, NOW, P, U, input } from "./fixtures/integrity-company";
import { empty, tx } from "./fixtures/finance-mirror";

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
const EMPTY = Object.fromEntries(["projects", "financeNotes", "deliveries", "actions", "sessions", "meetings", "tasks", "engineerWork", "mixVersions", "mixComments", "commentAttachments", "mixTargets", "mixTargetNotes", "finalFiles", "victor", "productions", "budgetItems", "albumTracks", "clipItems", "proposals", "releases", "campaigns", "contentItems", "socialFiles", "projectSettings", "transactionsText", "budgetPayments", "agentAlerts", "notifications"].map((k) => [k, { rows: [], capped: false }])) as unknown as ProjectDetailRaw;
const PR_OPEN = U(501), PR_CONV = U(502), PR_CLOSED_NO_PROJECT = U(503), PR_LOST = U(504), MEET = U(601), TASK_FU = U(611), TASK_CLIENT = U(612), TX_SHOW = U(701);
const prop = (id: string, clientId: string, clientName: string, title: string, status: string, amount: number, o: { linked?: string | null; followup?: string | null; sent?: string | null; currency?: string } = {}) =>
  ({ id, clientId, clientName, linkedProjectId: o.linked ?? null, title, amount, currency: o.currency ?? "₪", status, followupYmd: o.followup ?? null, sentYmd: o.sent ?? "2026-09-10", createdAt: "2026-09-10T10:00:00Z", updatedAt: "2026-09-12T10:00:00Z" });
const ew = (pid: string) => ({ id: U(851), projectId: pid, engineerName: "Steven", workType: "מיקס", workTitle: null, status: "בתהליך", sentDate: "2026-09-10", internalDeadline: null, agreedPrice: 200, amountPaid: 0, currency: "$", paymentDate: null });
const cev = (id: string, title: string, start: string, end: string): SunnyCalendarEvent => ({ id, calendarId: "primary", calendarName: "owner", holidayCalendar: false, title, untitled: false, description: null, start, end, allDay: false, timeZone: "Asia/Jerusalem", durationMinutes: 60, location: null, attendees: [], attendeesOmitted: false, selfResponse: null, organizer: null, creator: null, invited: false, recurringEventId: null, originalStartTime: null, recurrence: null, status: "confirmed", eventType: "default", transparency: "opaque", visibility: null, created: null, updated: null, hasMeetingLink: false, hasAttachments: false, attachmentCount: 0 });
const CAL: CalendarWindowResult = { status: "CALENDAR_DATA_AVAILABLE", window: { start: "2026-09-17T00:00:00+03:00", end: "2026-10-31T23:59:59+02:00", days: 45 }, fetchedAt: NOW.toISOString(), cache: "MISS", calendars: [], truncated: false, reasons: [],
  events: [cev("evt-meet", "פגישה עם לקוח כפול — סטודיו", "2026-09-25T12:00:00+03:00", "2026-09-25T13:00:00+03:00"), cev("evt-drive", "קורס יעודי פתח תקווה/דרום השרון", "2026-09-25T17:00:00+03:00", "2026-09-25T19:00:00+03:00")] };

interface Opt { projectStatus?: Record<string, string>; deadlines?: Record<string, string>; proposals?: ReturnType<typeof prop>[]; engineerOn?: string | null; cal?: CalendarWindowResult | "NONE"; clientDetail?: "NONE" }
function sources(o: Opt = {}): GatewaySources {
  const st = input({ contexts: [], status: o.projectStatus }).state!;
  for (const p of st.domains.projects.data?.open ?? []) { const d = o.deadlines?.[p.id]; if (d) (p as { deadline: { ymd: string | null; daysTo: number | null } }).deadline = { ...p.deadline, ymd: d, daysTo: null }; }
  const props = o.proposals ?? [
    prop(PR_OPEN, C_DUP1, "לקוח כפול", "3 שירים", "ממתין לתשובה", 5000, { followup: "2026-09-20" }),
    prop(PR_CONV, C_DUP1, "לקוח כפול", "סינגל", "נסגר", 3000, { linked: P(5), followup: "2026-09-05" }),
    prop(PR_CLOSED_NO_PROJECT, C_AVI, "אבי מולה", "הופעה פרטית", "נסגר", 2000),
    prop(PR_LOST, C_AVI, "אבי מולה", "EP", "לא נסגר", 9000),
  ];
  (st.domains.proposalsFull as { data: { items: unknown[] } }).data.items = props;
  const ops: OperationsRaw = {
    redFilms: sec([]), budgetPayments: sec([]), clipItems: sec([]), meetings: sec([]), finalFiles: sec([]), deliveries: sec([]), mixVersions: sec([]), mixComments: sec([]), projectActions: sec([]),
    engineerWork: sec(o.engineerOn === null ? [] : [ew(o.engineerOn ?? P(5))]), projectsMeta: sec([]), budgetItems: sec([]), equipment: sec([]), beats: sec([]), beatAssignments: sec([]), campaigns: sec([]), contentItems: sec([]), promotions: sec([]), balanceCycles: sec([]), albumTracks: sec([]),
    integrations: { googleCalendarConnected: true, dropboxConnected: true },
    calendarLinks: sec([{ eventId: "evt-meet", kind: "MEETING", entityId: MEET, projectId: null, clientId: C_DUP1, showId: null, date: "2026-09-25", status: "נקבעה" }]),
  };
  const det: ProjectDetailRaw = { ...EMPTY,
    meetings: sec([{ id: MEET, createdAt: "2026-09-20T10:00:00Z", projectId: null, clientId: C_DUP1, clientName: "לקוח כפול", date: "2026-09-25", time: "12:00", duration: 60, location: "סטודיו", notes: "לדבר על מחיר ל-3 שירים", status: "נקבעה", hasCalendarEvent: true },
      { id: U(602), createdAt: "2026-06-01T10:00:00Z", projectId: null, clientId: C_AVI, clientName: "אבי מולה", date: "2026-06-07", time: "10:00", duration: 60, location: null, notes: null, status: "נקבעה", hasCalendarEvent: false }]),
    tasks: sec([{ id: TASK_FU, relatedType: "client", relatedId: C_DUP1, title: "מעקב הצעת מחיר - לקוח כפול", notes: `[proposal_id:${PR_OPEN}]`, status: "פתוח", dueDate: "2026-09-20", startTime: null, endTime: null, showId: null, hasGoogleTask: true, createdAt: null, updatedAt: null },
      { id: TASK_CLIENT, relatedType: "client", relatedId: C_DUP1, title: "לשלוח רפרנסים", notes: "הלקוח ישלם שבוע הבא", status: "פתוח", dueDate: "2026-09-26", startTime: null, endTime: null, showId: null, hasGoogleTask: false, createdAt: null, updatedAt: null }]),
    proposals: sec([{ id: PR_OPEN, linkedProjectId: null, clientId: C_DUP1, title: "3 שירים", notes: "מחיר חבילה" }]),
    projects: sec([{ id: P(5), createdAt: "2026-09-06T10:00:00Z", legacyMondayId: null, notes: null, workMaterials: null, dropboxFolder: null, files: [] }]),
  };
  const cdet: ClientDetailRaw = { clients: sec([{ id: C_DUP1, name: "לקוח כפול", type: "לקוח", status: "חדש", phone: "050-0000000", email: "x@example.com", notes: "מעדיף וואטסאפ", createdAt: "2026-01-01T10:00:00Z" }]),
    unlinkedTransactionsText: sec([{ id: TX_SHOW, type: "income", date: "2026-09-01", description: "הופעה", notes: null, artistText: "לקוח כפול", paymentMethod: null, hasReceipt: false, createdAt: null }]) };
  const showTx = { ...tx({ type: "income", amount: 800, status: "התקבל" }), id: TX_SHOW, projectId: null };
  const raw = empty({ transactions: [tx({ projectId: P(2), type: "income", amount: 600, status: "שולם" }), showTx], financeSettings: [{ projectId: P(5), value: { agreedPrice: 3000, currency: "₪" } }, { projectId: P(2), value: { agreedPrice: 1000, currency: "₪" } }] });
  const view = deriveFinanceView(raw, NOW, []);
  const f: GatewayFinance = { state: view.state, integrity: view.integrity, actions: view.actions, raw, brief: buildFinanceBrief(view.state, view.integrity, { answersAvailable: true, actionNoteHe: view.actionNoteHe }), answersAvailable: true };
  return { now: NOW, state: { status: "OK", value: st }, finance: { status: "OK", value: f }, identities: { cleantone: null },
    cases: { status: "OK", value: [] }, actions: { status: "OK", value: [] }, outcomes: { status: "OK", value: [] }, ownerKnowledge: { status: "OK", value: [] },
    projectDetail: { status: "OK", value: det }, operations: { status: "OK", value: ops },
    ...(o.clientDetail === "NONE" ? {} : { clientDetail: { status: "OK" as const, value: cdet } }),
    ...(o.cal === "NONE" ? {} : { calendar: { status: "OK" as const, value: o.cal ?? CAL } }) };
}
const q = (capability: string, mode: string, params: Record<string, string> = {}, src = sources(), aud = OWNER): QueryResponse => queryKnowledgeCore(REG, { capability, mode, params }, src, aud);
const itemsOf = (r: QueryResponse) => (r.status === "OK" ? r.items : []);
const codes = (v: ReturnType<typeof buildClientView>) => (v?.signals ?? []).map((s) => s.code);

function main() {
  section("1. coverage — schema, vocabularies, routes, fingerprints");
  check("every client column has a field contract", CM.CLIENT_FIELDS.map((f) => f.field), [...CM.CLIENT_SCHEMA_COLUMNS.clients]);
  check("every proposal column has a field contract", CM.PROPOSAL_FIELDS.map((f) => f.field), [...CM.CLIENT_SCHEMA_COLUMNS.proposals]);
  check("proposal columns agree with the pinned project-linked schema", [...CM.CLIENT_SCHEMA_COLUMNS.proposals], [...PROJECT_TABLE_COLUMNS.proposals]);
  ok("every field is fully described (meaning, class, validation, writers, readers, history, Sunny read path)", [...CM.CLIENT_FIELDS, ...CM.PROPOSAL_FIELDS].every((f) => [f.meaning, f.validation, f.writers, f.readers, f.history, f.sunnyReads].every((x) => x.trim().length > 0)));
  const store = read("lib/clients-store.ts");
  const union = (src: string, name: string) => [...(new RegExp(`export type ${name}\\s*=([^;]+);`).exec(src)?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  check("client types = the code's ClientType", union(store, "ClientType"), [...CM.CLIENT_VOCABULARIES.clientTypes]);
  check("client statuses = the code's ClientStatus", union(store, "ClientStatus"), [...CM.CLIENT_VOCABULARIES.clientStatuses]);
  check("proposal statuses = the UI's ProposalStatus", union(read("components/clients/ProposalsSection.tsx"), "ProposalStatus"), [...CM.CLIENT_VOCABULARIES.proposalStatuses]);
  check("every proposal status has semantics", CM.PROPOSAL_STATUS_SEMANTICS.map((s) => s.status).sort(), [...CM.CLIENT_VOCABULARIES.proposalStatuses].sort());
  ok("meeting statuses = the drawer's meeting status union", CM.CLIENT_VOCABULARIES.meetingStatuses.every((s) => read("components/clients/ClientDrawer.tsx").includes(`"${s}"`)));
  const walk = (d: string): string[] => fs.readdirSync(path.join(ROOT, d), { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(`${d}/${e.name}`) : e.name === "route.ts" ? [`${d}/${e.name}`] : []);
  const touching = walk("app/api").filter((f) => /\.from\(\s*["'](clients|proposals)["']\)|["'`][^"'`]*\bclients\(|from "@\/lib\/clients-store"/.test(read(f))).sort();
  check("every API route touching clients / proposals is inventoried", touching.filter((f) => !(f in CM.CLIENT_ROUTE_INVENTORY)), []);
  check("no stale route in the inventory", Object.keys(CM.CLIENT_ROUTE_INVENTORY).filter((f) => !touching.includes(f)), []);
  for (const [f, want] of Object.entries(CM.CLIENT_REVIEWED_FINGERPRINTS)) {
    const got = createHash("sha256").update(read(f).replace(/\r\n/g, "\n")).digest("hex");
    check(`${f} unchanged since the last Sunny client review (update lib/partner/system/clients.ts + fingerprint together)`, got, want);
  }
  ok("every client action names existing routes", CM.CLIENT_ACTIONS.every((a) => a.internal.routes.length > 0 && a.internal.routes.every((r) => fs.existsSync(path.join(ROOT, r)))));
  ok("every mutating client / proposal route is covered by an action", ["app/api/clients/route.ts", "app/api/clients/[id]/route.ts", "app/api/proposals/route.ts", "app/api/proposals/[id]/route.ts", "app/api/proposals/[id]/convert/route.ts", "app/api/projects/sync-artists/route.ts"].every((r) => CM.CLIENT_ACTIONS.some((a) => a.internal.routes.includes(r))));
  ok("no client / proposal action is executable by Sunny today", CM.CLIENT_ACTIONS.every((a) => a.sunnyToday === "KNOWLEDGE_ONLY"));
  ok("destructive actions carry the DESTRUCTIVE class", CM.CLIENT_ACTIONS.filter((a) => a.destructive).every((a) => a.approvalClass === "DESTRUCTIVE"));
  const reader = code(read("lib/partner/clients/detail-reader.ts"));
  ok("client detail reader is SELECT-only and scrubs free text", !/\.(insert|update|upsert|delete|rpc)\(/.test(reader) && /scrubSecrets/.test(reader) && CLIENT_DETAIL_SOURCES.length === 2);
  ok("pure view: no DB / fetch / write / push path", !/supabase|fetch\(|\.insert\(|\.update\(|\.upsert\(|\.delete\(|sendPush/.test(code(read("lib/partner/clients/view.ts") + read("lib/partner/knowledge/capabilities/clients-deep.ts"))));
  ok("every link has a quality + enforcement", CM.CLIENT_LINKS.every((l) => !!l.quality && l.enforcement.length > 0));
  ok("project ↔ client by name is TEXT_MATCH; via proposal is CANONICAL", CM.CLIENT_LINKS.find((l) => l.id === "CLIENT_PROJECT_BY_NAME")!.quality === "TEXT_MATCH" && CM.CLIENT_LINKS.find((l) => l.id === "CLIENT_PROJECT_VIA_PROPOSAL")!.quality === "CANONICAL_RELATION");
  ok("conversion traced end-to-end and marked non-atomic", CM.CONVERSION_FLOW.steps.length >= 7 && CM.CONVERSION_FLOW.atomic === false && CM.CONVERSION_FLOW.failureModes.length >= 3);
  ok("deal-terms decision: Redbloods cannot represent the real deal; model proposed, not executed", CM.DEAL_TERMS_DECISION.canRepresentRealDeal === false && /not created/.test(CM.DEAL_TERMS_DECISION.proposedModel.status));
  ok("every workflow says what to ask and what is executable", CM.CLIENT_WORKFLOWS.every((w) => w.ask.length > 0 || w.supported === "NOT_SUPPORTED") && CM.CLIENT_WORKFLOWS.find((w) => w.event === "NEW_LEAD")!.supported === "NOT_SUPPORTED");

  section("SCENARIO A — 'יש לי לקוח חדש שרוצה 3 שירים'");
  const a = clientWorkflow(sources(), "NEW_CLIENT_REQUEST", { name: "דנה כהן" });
  check("identity: a new name (no existing client)", a.identity, "NEW_NAME");
  ok("asks price, package, advance, follow-up — never invents a price", ["מחיר", "הצעה אחת", "מקדמה", "מתי לחזור"].every((w) => a.ask.some((x) => x.questionHe.includes(w))) && !/\d{3,}/.test(JSON.stringify(a.ask)));
  ok("next step = CREATE_CLIENT then CREATE_PROPOSAL (proposed, not executed)", /CREATE_CLIENT/.test(a.nextStep) && /none/.test(a.mutations));
  const a2 = clientWorkflow(sources(), "NEW_CLIENT_REQUEST", { name: "לקוח כפול" });
  ok("existing client → shows its open proposal + projects first", a2.identity === "EXISTING_CLIENT" && a2.known.some((k) => k.item === "open proposals" && (k.value as unknown[]).length === 1));

  section("SCENARIO B — 'שלחתי לו הצעה'");
  const b = clientWorkflow(sources(), "PROPOSAL_SENT", { client: `client:${C_DUP1}` });
  ok("proposal exists → reports it, asks nothing about its details", b.known.some((k) => k.item === "open proposals") && !b.ask.some((x) => x.kind === "PROPOSAL"));
  const b2 = clientWorkflow(sources(), "PROPOSAL_SENT", { client: `client:${C_SHALEV}` });
  ok("no open proposal recorded → asks what was sent and when to follow up", b2.ask.some((x) => x.kind === "PROPOSAL" && /לא רואה הצעה פתוחה/.test(x.questionHe)));

  section("SCENARIO C — follow-up date passed");
  const vc = buildClientView(sources(), C_DUP1)!;
  const po = vc.proposals.find((p) => p.id === PR_OPEN)!;
  check("follow-up state", po.followUpState, "RECORDED_FOLLOW_UP_PASSED");
  const fu = vc.signals.find((s) => s.code === "FOLLOW_UP_DUE")!;
  ok("says 'recorded follow-up' / 'I don't see recorded activity' — never 'you did not follow up'", /הרשום/.test(fu.he) && /לא רואה/.test(fu.he) && !/לא עשית|didn't follow|did not follow/.test(JSON.stringify(vc.signals) + JSON.stringify(vc.questions)));
  ok("asks about contact outside Redbloods", vc.questions.some((x) => x.kind === "FOLLOW_UP" && /מחוץ למערכת/.test(x.questionHe)));
  ok("follow-up task linked by marker (DERIVED)", !!po.followUpTask && /DERIVED/.test(po.followUpTask.link));

  section("SCENARIO D — proposal converted to a project");
  const pc = vc.proposals.find((p) => p.id === PR_CONV)!;
  const prj = vc.projects.find((p) => p.projectId === P(5))!;
  ok("client → proposal → project is CANONICAL (PROPOSAL_CHAIN)", prj.basis === "PROPOSAL_CHAIN" && prj.quality === "CANONICAL_RELATION" && pc.linkedProject?.key === `project:${P(5)}`);
  check("agreed price on the project read from finance", pc.agreedPriceOnProject, 3000);
  ok("advance evidence assessed for the converted project", prj.advance === "ADVANCE_EVIDENCE_MISSING");
  ok("PROPOSAL_CONVERTED signal", codes(vc).includes("PROPOSAL_CONVERTED"));

  section("SCENARIO E — project at mix without received income");
  const ve = buildClientView(sources({ projectStatus: { [P(5)]: "במיקס" }, engineerOn: null }), C_DUP1)!;
  ok("PAYMENT_EVIDENCE_MISSING + question (no amount)", codes(ve).includes("PAYMENT_EVIDENCE_MISSING") && ve.questions.some((x) => x.kind === "PAYMENT_EVIDENCE"));
  ok("no invented debt: expected stays what is recorded (no expected row → 0), wording has no 'חוב'", (ve.money!.expected["₪"] ?? 0) === 0 && !/חוב|owes|debt/.test(JSON.stringify(ve.signals)));
  ok("DEAL_TERMS_UNKNOWN surfaced", codes(ve).includes("DEAL_TERMS_UNKNOWN"));

  section("SCENARIO F — client meeting tomorrow (live calendar)");
  const vf = buildClientView(sources(), C_DUP1)!;
  ok("meeting upcoming, with notes as evidence", vf.meetings.some((m) => m.state === "UPCOMING" && m.notes === "לדבר על מחיר ל-3 שירים") && codes(vf).includes("MEETING_UPCOMING"));
  const cal = vf.calendar as { canonical?: Array<{ title: string | null }> };
  ok("calendar event linked CANONICALLY via the stored meeting event id", !!cal.canonical && cal.canonical.some((e) => /פגישה עם/.test(e.title ?? "")));
  ok("the personal driving course is NOT a client fact", !JSON.stringify(vf.calendar).includes("קורס יעודי"));
  ok("the same view carries proposal + project state", vf.proposals.length === 2 && vf.projects.length >= 1);
  ok("calendar unreadable → context unknown, never 'nothing scheduled'", /never 'nothing scheduled'/.test(JSON.stringify(buildClientView(sources({ cal: "NONE" }), C_DUP1)!.calendar)));

  section("SCENARIO G — Shalev as client AND label artist");
  const vg = buildClientView(sources(), C_SHALEV)!;
  ok("two records of one person, never merged", vg.roles.labelArtistRecords.length === 1 && vg.roles.labelArtistRecords[0].key === `label-artist:${LA_SHALEV}` && codes(vg).includes("IDENTITY_DUAL_ROLE"));
  const p1 = vg.projects.find((p) => p.projectId === P(1))!;
  ok("label work is not treated as client work (no advance expectation)", p1.labelWork === true && p1.advance === "NOT_APPLICABLE_LABEL_WORK" && !vg.signals.some((s) => s.code === "PAYMENT_EVIDENCE_MISSING" && s.entity === `project:${P(1)}`));
  ok("collaboration project marked (אבי 2 names both)", vg.projects.some((p) => p.basis === "NAME_COLLABORATION"));

  section("SCENARIO H — similar names");
  const h = clientWorkflow(sources(), "NEW_CLIENT_REQUEST", { name: "כפול" });
  ok("no guessed identity — asks which one", h.identity === "SIMILAR_NAMES_AMBIGUOUS" && h.client === null && h.ask.some((x) => x.kind === "IDENTITY" && x.questionHe.includes("לקוח כפול")));
  ok("the two near-duplicate records stay separate clients", buildClientView(sources(), C_DUP2)!.proposals.length === 0);

  section("SCENARIO I — proposal closed without a project");
  const vi = buildClientView(sources(), C_AVI)!;
  ok("PROPOSAL_CLOSED_WITHOUT_PROJECT + question; no project invented", codes(vi).includes("PROPOSAL_CLOSED_WITHOUT_PROJECT") && vi.questions.some((x) => x.kind === "CONVERSION") && !vi.projects.some((p) => p.proposalId === PR_CLOSED_NO_PROJECT));
  ok("lost proposal is not potential money", !(vi.money!.potential["₪"] > 0));

  section("SCENARIO J — old client project with a historical overdue deadline");
  const vj = buildClientView(sources({ deadlines: { [P(2)]: "2026-05-01" } }), C_AVI)!;
  const hd = vj.signals.find((s) => s.code === "HISTORICAL_DEADLINE_DEBT");
  ok("historical operational debt, not a new emergency", !!hd && /לא חירום/.test(hd.he));
  ok("stale meeting is flagged as unknown, not as a failure", codes(vj).includes("MEETING_STATUS_NOT_UPDATED"));

  section("2. money — realized / expected / potential never merged");
  const vm = buildClientView(sources(), C_DUP1)!;
  check("potential = open proposal amount only", vm.money!.potential, { "₪": 5000 });
  ok("project-less show income attributed by ARTIST_TEXT (TEXT_MATCH) as realized", vm.money!.realized["₪"] === 800 && vm.money!.rows.some((r) => r.projectLess === true && /TEXT_MATCH/.test(String(r.link))));
  ok("free text 'הלקוח ישלם שבוע הבא' is a note (evidence), not money", vm.notes.some((n) => n.text.includes("ישלם")) && (vm.money!.expected["₪"] ?? 0) === 0);
  const pf = clientPortfolio(sources());
  ok("portfolio: totals per currency, sorted by name — no score", pf.totals.potential["₪"] === 5000 && !/"(score|rank|likelihood|probability)"/.test(JSON.stringify(pf)));
  ok("every emitted signal is in the signal model", pf.rows.flatMap((r) => r.signals).every((s) => CM.CLIENT_SIGNAL_MODEL.some((m) => m.code === s)));

  section("3. capabilities — Owner-only, progressive, served clean");
  const cv = q("client_view", "view", { client: `client:${C_DUP1}` });
  ok("client_view summary", cv.status === "OK" && cv.summary.some((f) => f.code === "MONEY"));
  for (const s of ["identity", "contact", "roles", "proposals", "projects", "money", "meetings", "calendar", "sessions", "tasks", "notes", "history", "owner_knowledge", "signals", "questions"]) ok(`client_view section ${s}`, q("client_view", "view", { client: `client:${C_DUP1}`, section: s }).status === "OK");
  ok("client_view is Owner-only", q("client_view", "view", { client: `client:${C_DUP1}` }, sources(), STRANGER).status !== "OK");
  ok("client_portfolio is Owner-only", q("client_portfolio", "overview", {}, sources(), STRANGER).status !== "OK");
  for (const m of ["overview", "proposals", "follow_ups", "signal"]) ok(`client_portfolio ${m}`, q("client_portfolio", m).status === "OK");
  const wf = q("client_portfolio", "workflow", { event: "NEW_CLIENT_REQUEST", name: "דנה כהן" });
  ok("client_portfolio workflow serves questions", wf.status === "OK" && itemsOf(wf).some((i) => i.id.startsWith("ask:")));
  const noDetail = q("client_view", "view", { client: `client:${C_DUP1}` }, sources({ clientDetail: "NONE" }));
  ok("client detail unreadable → UNKNOWN / PARTIAL, never 'no contact'", noDetail.completeness !== "COMPLETE");
  for (const s of ["fields", "vocabularies", "statuses", "status_consumers", "links", "conversion", "follow_up", "lead", "deal_terms", "client_id", "history", "actions", "workflows", "signals", "integrity"]) ok(`system_awareness client_model ${s}`, itemsOf(q("system_awareness", "client_model", { section: s })).length > 0);
  const served = JSON.stringify([cv, q("client_portfolio", "overview"), ...["fields", "links", "conversion", "deal_terms", "actions", "client_id"].map((s) => q("system_awareness", "client_model", { section: s }))]);
  check("no forbidden implementation / secret terms served", FORBIDDEN_SERVED_TERMS.filter((t) => served.toLowerCase().includes(t.toLowerCase())), []);
  ok("no share links / tokens in served client data", !/dropbox\.com\/s|token=|access_token/.test(served));

  section("4. System Awareness + gaps");
  ok("baseline -7 with CLIENTS + PROPOSALS change entries", SYSTEM_BASELINE_VERSION >= "2026.09.25-7" && CAPABILITY_CHANGES.filter((c) => c.version === "2026.09.25-7").length >= 2);
  ok("CLIENTS / PROPOSALS read client_view + client_portfolio", ["CLIENTS", "PROPOSALS"].every((d) => ["client_view", "client_portfolio"].every((c) => DOMAIN_CONTRACTS.find((x) => x.id === d)!.readCapabilities.includes(c))));
  ok("CLIENTS / PROPOSALS depth = DEEP_BRAIN_V1", DOMAIN_KNOWLEDGE_DEPTH.CLIENTS === "DEEP_BRAIN_V1" && DOMAIN_KNOWLEDGE_DEPTH.PROPOSALS === "DEEP_BRAIN_V1");
  check("system registry valid", validateSystemRegistry({ capabilityIds: REG.all().map((c) => c.id), knowledgeKinds: KNOWLEDGE_KINDS.map((k) => k.kind) }), []);
  check("gaps valid", validateKnowledgeGaps({ domainIds: DOMAIN_CONTRACTS.map((d) => d.id), capabilityIds: REG.all().map((c) => c.id) }), []);
  const cg = KNOWLEDGE_GAPS.filter((g) => g.id.startsWith("CLI_"));
  ok("client gaps cover every required class", ["DATA_NOT_RECORDED", "DATA_MODEL_GAP", "CONFLICTING_SOURCES", "AMBIGUOUS_IDENTITY", "SYSTEM_BEHAVIOR_GAP", "LEGACY_CONFLICT", "OWNER_DECISION_REQUIRED", "FUTURE_PRIMITIVE_REQUIRED"].every((c) => cg.some((g) => g.class === c)));
  ok("no canonical gap is 'solved' by owner knowledge", cg.every((g) => !g.sunnyReadsVia.includes("owner_knowledge")));

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}
main();
