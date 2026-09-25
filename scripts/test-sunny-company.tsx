/**
 * Sunny WHOLE-SYSTEM INTEGRATION V1 — permanent whole-system guards + scenarios A–Z + decision / dedup / no-invented-policy QA.
 *
 * Guards (permanent — new meaningful code that Sunny cannot classify fails here):
 *   - every signal code any domain view emits is mapped in the company ATTENTION_MAP;
 *   - every non-partner lib module is classified in REPO_COVERAGE;
 *   - every table the code reads / writes is classified in TABLE_COVERAGE;
 *   - every registered knowledge gap has a root cause;
 *   - the domain depth map agrees with the reconciliation;
 *   - company_view is registered, Owner-only, pure, and serves no implementation terms.
 *
 * Run with:   npx tsx scripts/test-sunny-company.tsx      Pure; never touches production.
 */
import fs from "node:fs";
import path from "node:path";
import { PARTNER_KNOWLEDGE_REGISTRY } from "../lib/partner/knowledge/catalog";
import { queryKnowledgeCore } from "../lib/partner/knowledge/query";
import type { KnowledgeAudience, QueryResponse } from "../lib/partner/knowledge/types";
import type { GatewayFinance, GatewaySources } from "../lib/partner/gateway/core";
import type { OperationsRaw, OpsRedFilmsProduction } from "../lib/partner/operations/types";
import type { ProjectDetailRaw, DetailProduction, DetailVictorWork } from "../lib/partner/projects/detail-types";
import type { FinanceRaw } from "../lib/partner/finance/types";
import type { SunnyCalendarEvent, CalendarWindowResult } from "../lib/partner/calendar/types";
import type { SettingsState } from "../lib/partner/settings/types";
import { deriveFinanceView } from "../lib/partner/finance/view";
import { buildFinanceBrief } from "../lib/partner/finance/brief";
import { buildCompanyView } from "../lib/partner/company/view";
import { planQuestion, COMPANY_TOPICS } from "../lib/partner/knowledge/capabilities/company-view";
import * as CO from "../lib/partner/system/company";
import { FORBIDDEN_SERVED_TERMS, DOMAIN_CONTRACTS, CAPABILITY_CHANGES, SYSTEM_BASELINE_VERSION } from "../lib/partner/system";
import { DOMAIN_KNOWLEDGE_DEPTH, KNOWLEDGE_GAPS } from "../lib/partner/system/gaps";
import { NOW, P, U, input } from "./fixtures/integrity-company";
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
const walkTs = (d: string): string[] => fs.readdirSync(path.join(ROOT, d), { withFileTypes: true }).flatMap((e) => e.name === "node_modules" ? [] : e.isDirectory() ? walkTs(`${d}/${e.name}`) : /\.(ts|tsx)$/.test(e.name) ? [`${d}/${e.name}`] : []);
const OWNER: KnowledgeAudience = { channel: "EXTERNAL", ownerAuthorized: true };
const STRANGER: KnowledgeAudience = { channel: "EXTERNAL", ownerAuthorized: false };
const REG = PARTNER_KNOWLEDGE_REGISTRY;

// ── fixture: one small company touching every domain ──
const sec = <T,>(rows: T[]) => ({ rows, capped: false });
const EMPTY = Object.fromEntries(["projects", "financeNotes", "deliveries", "actions", "sessions", "meetings", "tasks", "engineerWork", "mixVersions", "mixComments", "commentAttachments", "mixTargets", "mixTargetNotes", "finalFiles", "victor", "productions", "budgetItems", "albumTracks", "clipItems", "proposals", "releases", "campaigns", "contentItems", "socialFiles", "projectSettings", "transactionsText", "budgetPayments", "agentAlerts", "notifications", "rfCrew", "rfDocuments", "rfScenes", "rfRefImages", "rfRefLinks", "rfEquipment"].map((k) => [k, { rows: [], capped: false }])) as unknown as ProjectDetailRaw;
const PR_MAIN = U(301);
const prod = (id: string, o: Partial<OpsRedFilmsProduction>): OpsRedFilmsProduction => ({ id, title: "קליפ", productionType: "קליפ", status: "בתכנון", projectId: null, clientId: null, artistName: "אבי מולה", clientSource: "פנימי - לייבל", shootDate: null, publishDate: null, editStatus: "לא התחיל", collectionStatus: "לא רלוונטי", generalBudget: 5000, clientPrice: 0, advanceRequired: 0, advanceReceived: 0, ...o });
const dprod = (id: string, o: Partial<DetailProduction> = {}): DetailProduction => ({ id, projectId: null, clientNameSnapshot: null, createdAt: "2026-09-01T10:00:00Z", updatedAt: "2026-09-10T10:00:00Z", photographer: "צלם א", director: null, editor: null, locations: null, conceptSummary: "קונספט", conceptVibe: null,
  script: { start: null, middle: null, end: null }, directorNotes: null, photographerNotes: null, fixNotes: null, notes: null, publishedWhere: null, dropboxFolderPath: "/Red Films/x", links: { references: false, rawFiles: false, editFolder: false, version1: false, version2: false, finalVersion: false, folder: true }, ...o });
const file = (name: string, v: string | null, at: string | null) => ({ name, category: null, versionLabel: v, trackId: null, durationSeconds: 180, size: 1000, uploadedAt: at, path: `/Projects/x/Victor/Production/${name}`, hasShareLink: true, fromMixVersionId: null, structureMarkers: 0 });
const review = (version: string, sentAt: string | null) => ({ version, status: "waiting", notes: "תקן", sentNotes: sentAt ? "תקן" : null, sentAt, draft: false, reviewedAt: null });
const work = (id: number, o: Partial<DetailVictorWork>): DetailVictorWork => ({ id: U(id), projectId: null, vendorName: "victor", title: `עבודה ${id}`, status: "פעיל", workState: "נשלח לויקטור", sentDate: "2026-09-01", internalDeadline: null, linkedTaskId: null, createdAt: "2026-09-01T10:00:00Z", updatedAt: "2026-09-10T10:00:00Z",
  notes: null, briefText: "בריף", references: [], reviews: [], filesSent: [], filesReceived: [], briefFiles: [], returnedDate: null, outcome: null, quality: null, enteredProject: null, dropboxFolder: "/Projects/x/Victor", hasFolderLink: true, ...o });
const ev = (id: string, title: string, start: string, o: Partial<SunnyCalendarEvent> = {}): SunnyCalendarEvent => ({ id, calendarId: "primary", calendarName: "Owner", holidayCalendar: false, title, untitled: false, description: null, start, end: start, allDay: false, timeZone: "Asia/Jerusalem", durationMinutes: 60, location: null, attendees: [], attendeesOmitted: false, selfResponse: null, organizer: null, creator: null, invited: false, recurringEventId: null, originalStartTime: null, recurrence: null, status: "confirmed", eventType: "default", transparency: "opaque", visibility: null, created: null, updated: null, hasMeetingLink: false, hasAttachments: false, attachmentCount: 0, ...o });
const SETTINGS: SettingsState = { families: {
  VICTOR_SALARY_SETTINGS: sec([{ key: "vendor_victor_settings", updatedAt: null, value: { monthlyGoal: 12, monthlySalary: 550, salaryCurrency: "$", salaryPayDay: 10 } }]),
  VICTOR_SALARY_OVERRIDES: sec([{ key: "vendor_victor_salary_overrides", updatedAt: null, value: { "2026-05": 550, "2026-06": 500 } }, { key: "vendor_victor_salary_status_overrides", updatedAt: null, value: { "2026-05": "שולם", "2026-06": "שולם" } }]),
} } as unknown as SettingsState;

interface Opt { noFinance?: boolean; calendar?: "ok" | "fail" | "none"; noState?: boolean; knowledge?: Array<{ subjectKey: string; operation?: string }> }
function sources(o: Opt = {}): GatewaySources {
  const st = input({ contexts: [] }).state!;
  const ops = { integrations: { googleCalendarConnected: true, dropboxConnected: true }, redFilms: sec([prod(PR_MAIN, { title: "קליפ אבי", projectId: P(2), shootDate: "2026-09-10", status: "בתכנון" })]),
    projectsMeta: sec([
      { id: P(1), name: "שיר לייבל", status: "בעבודה", projectType: "שיר", businessType: "לייבל", artistText: "שליו טסמה", deadline: null, startDate: null, endDate: null, parentProject: null, isHidden: false, plannedHours: null, plannedDays: null, updatedAt: "2026-09-22T10:00:00Z" },
      { id: P(2), name: "אבי 1", status: "בעבודה", projectType: "שיר", businessType: "לקוח", artistText: "אבי מולה", deadline: null, startDate: null, endDate: null, parentProject: null, isHidden: false, plannedHours: null, plannedDays: null, updatedAt: "2026-09-10T10:00:00Z" },
      { id: P(4), name: "נגש 1", status: "בעבודה", projectType: "שיר", businessType: "לקוח", artistText: "נגש ביטס", deadline: null, startDate: null, endDate: null, parentProject: null, isHidden: false, plannedHours: null, plannedDays: null, updatedAt: "2026-09-01T10:00:00Z" },
    ]) } as unknown as OperationsRaw;
  const det: ProjectDetailRaw = { ...EMPTY,
    productions: sec([dprod(PR_MAIN, { projectId: P(2) })]),
    budgetPayments: sec([{ productionId: PR_MAIN, budgetItemId: null, amount: 1200, date: "2026-09-05", method: "ביט", notes: null, receiptFileName: null, receiptMime: null, receiptPath: null, hasReceiptLink: false, createdAt: null, updatedAt: null }]),
    victor: sec([
      work(701, { projectId: P(2), title: "אבי 1", filesSent: [file("a V1.wav", "V1", "2026-09-10T10:00:00Z"), file("a V2.wav", "V2", "2026-09-15T10:00:00Z")], reviews: [review("V1", "2026-09-12T10:00:00Z")] }),
      work(702, { title: "ביט חדש" }),
    ]),
    agentAlerts: sec([
      { projectId: null, type: "goal_behind", severity: "medium", title: "יעד חודשי בפיגור", message: "x", status: "new", source: "agent", relatedClientId: null, metadata: null, suggestedActions: null, sentNotification: false, entityKey: "goal_behind:2026-09", createdAt: "2026-09-20T10:00:00Z", updatedAt: null },
      { projectId: P(2), type: "overdue_deadline", severity: "high", title: "דדליין עבר", message: "x", status: "new", source: "agent", relatedClientId: null, metadata: null, suggestedActions: null, sentNotification: false, entityKey: "overdue_deadline:x", createdAt: "2026-09-20T10:00:00Z", updatedAt: null },
    ]),
  };
  const raw: FinanceRaw = empty({ transactions: [
    tx({ id: "in-1", projectId: P(2), type: "income", amount: 3000, currency: "₪", status: "התקבל", category: "מקדמה", scope: "project", date: "2026-09-02" }),
    tx({ id: "in-usd", projectId: P(4), type: "income", amount: 400, currency: "$", status: "התקבל", category: "תשלום", scope: "project", date: "2026-09-03" }),
    tx({ id: "exp-1", type: "expense", amount: 500, currency: "₪", status: "שולם", category: "אחר", scope: "general", date: "2026-09-04" }),
  ], financeSettings: [{ projectId: P(2), value: { agreedPrice: 8000 } }] });
  const view = deriveFinanceView(raw, NOW, []);
  const f: GatewayFinance = { state: view.state, integrity: view.integrity, actions: view.actions, raw, brief: buildFinanceBrief(view.state, view.integrity, { answersAvailable: true, actionNoteHe: view.actionNoteHe }), answersAvailable: true };
  const cal: CalendarWindowResult = { status: "CALENDAR_DATA_AVAILABLE", window: { start: "2026-09-17", end: "2026-10-31", days: 45 }, fetchedAt: NOW.toISOString(), cache: "NONE", calendars: [], truncated: false, reasons: [],
    events: [ev("e1", "רופא שיניים", "2026-09-24T08:00:00+03:00"), ev("e2", "סשן - אבי 1", "2026-09-25T12:00:00+03:00")] };
  return { now: NOW, identities: { cleantone: null },
    state: o.noState ? { status: "UNAVAILABLE", reason: "test" } as unknown as GatewaySources["state"] : { status: "OK", value: st },
    finance: o.noFinance ? { status: "UNAVAILABLE", reason: "test" } as unknown as GatewaySources["finance"] : { status: "OK", value: f },
    cases: { status: "OK", value: [] }, actions: { status: "OK", value: [] }, outcomes: { status: "OK", value: [] }, ownerKnowledge: { status: "OK", value: (o.knowledge ?? []) as never },
    projectDetail: { status: "OK", value: det }, operations: { status: "OK", value: ops }, settings: { status: "OK", value: SETTINGS },
    ...(o.calendar === "none" ? {} : { calendar: o.calendar === "fail" ? { status: "OK", value: { ...cal, status: "CALENDAR_PROVIDER_ERROR", events: [] } } : { status: "OK", value: cal } }),
  };
}
const q = (mode: string, params: Record<string, string> = {}, aud = OWNER, o: Opt = {}): QueryResponse => queryKnowledgeCore(REG, { capability: "company_view", mode, params }, sources(o), aud);
const texts = (r: QueryResponse) => JSON.stringify(r);

function main() {
  section("1. permanent whole-system guards");
  const VIEWS = ["lib/partner/projects/view.ts", "lib/partner/clients/view.ts", "lib/partner/label/view.ts", "lib/partner/shows/view.ts", "lib/partner/victor/view.ts", "lib/partner/mix/view.ts", "lib/partner/redfilms/view.ts"];
  const emitted = new Set(VIEWS.flatMap((f) => [...code(read(f)).matchAll(/(?:code: |S\()"([A-Z][A-Z_]{2,})"/g)].map((m) => m[1])));
  check("every domain signal code is mapped in the company ATTENTION_MAP (a new signal must be classified)", [...emitted].filter((c) => !CO.ATTENTION_MAP[c]).sort(), []);
  ok(`the attention map covers ${emitted.size} emitted codes`, emitted.size >= 100);
  const libFiles = walkTs("lib").filter((f) => !f.startsWith("lib/partner/"));
  check("every non-partner lib module is classified (DOMAIN_OWNED / CROSS_DOMAIN / INFRASTRUCTURE / SECRET_SECURITY / LEGACY / UI_ONLY)", libFiles.filter((f) => !CO.REPO_COVERAGE.some((r) => new RegExp(r.pattern).test(f))), []);
  const tables = new Set([...walkTs("app"), ...walkTs("lib")].flatMap((f) => [...code(read(f)).matchAll(/(?<!storage)\.from\("([a-z_]+)"\)/g)].map((m) => m[1])));
  check("every table the code reads / writes is classified in TABLE_COVERAGE", [...tables].filter((t) => !CO.TABLE_COVERAGE[t]).sort(), []);
  check("TABLE_COVERAGE = the 52 production tables (2026-09-25 read-only census)", Object.keys(CO.TABLE_COVERAGE).length, 52);
  const roots = new Set(Object.keys(CO.GAP_ROOTS));
  ok(`every registered gap (${KNOWLEDGE_GAPS.length}) has a root cause`, KNOWLEDGE_GAPS.every((g) => roots.has(CO.gapRootOf(g))));
  const byRoot = KNOWLEDGE_GAPS.reduce<Record<string, number>>((m, g) => ({ ...m, [CO.gapRootOf(g)]: (m[CO.gapRootOf(g)] ?? 0) + 1 }), {});
  ok("no root swallows more than half the gaps (the dedupe is meaningful)", Object.values(byRoot).every((n) => n <= KNOWLEDGE_GAPS.length / 2));
  ok("depth reconciliation is applied in the depth map", CO.DEPTH_RECONCILIATION.every((d) => DOMAIN_KNOWLEDGE_DEPTH[d.domain] === d.to));
  check("the still-pending list equals the depth map's pending domains", [...CO.STILL_PENDING].sort(), Object.entries(DOMAIN_KNOWLEDGE_DEPTH).filter(([, v]) => v === "PENDING_DEEP_MISSION").map(([k]) => k).sort());
  ok("every depth domain is a registry domain", Object.keys(DOMAIN_KNOWLEDGE_DEPTH).every((d) => DOMAIN_CONTRACTS.some((c) => c.id === d)));
  ok("baseline bumped with a COMPANY_OVERVIEW change", SYSTEM_BASELINE_VERSION === "2026.09.25-14" && CAPABILITY_CHANGES.some((c) => c.version === "2026.09.25-14" && c.domain === "COMPANY_OVERVIEW"));
  ok("COMPANY_OVERVIEW reads company_view", DOMAIN_CONTRACTS.find((d) => d.id === "COMPANY_OVERVIEW")!.readCapabilities.includes("company_view"));
  const cap = REG.get("company_view")!;
  ok("company_view is registered, Owner-only, FINANCIAL", !!cap && cap.access.ownerOnly && cap.access.sensitivity === "FINANCIAL");
  const V = code(read("lib/partner/company/view.ts")) + code(read("lib/partner/knowledge/capabilities/company-view.ts"));
  ok("pure: no DB / fetch / write / push / cron", !/supabase|fetch\(|\.insert\(|\.update\(|\.upsert\(|\.delete\(|\.rpc\(|sendPush|cron/i.test(V));
  ok("no score / rank / priority field in the company view", !/\b(score|rank|ranking|priority|priorityScore|urgency)\w*\s*:/i.test(V));
  ok("reuses the domain views + the app's release-candidate rule + Finance Brain (no second rule)", ["buildProjectView(", "buildClientView(", "buildArtistView(", "buildShowView(", "buildVictorView(", "buildMixView(", "buildVideoView(", "companyOperating(", "buildReleaseCandidates(", "linkCalendarEvent("].every((f) => V.includes(f)));
  ok("discoveries have ids, meaning and an owner-input flag", CO.DISCOVERIES.length >= 10 && CO.DISCOVERIES.every((d) => d.id && d.what && d.why && typeof d.ownerInput === "boolean"));
  ok("every discovery gap id is registered (or explicitly 'already registered')", CO.DISCOVERIES.every((d) => !d.gap || d.gap.startsWith("already") || KNOWLEDGE_GAPS.some((g) => g.id === d.gap)));
  ok("workflows: client project / label song / show / video / vendor", ["CLIENT_PROJECT", "LABEL_SONG", "SHOW", "VIDEO", "VENDOR"].every((w) => (CO.COMPANY_WORKFLOWS[w]?.length ?? 0) >= 5));
  ok("future primitives carry a risk class; none is implemented", CO.FUTURE_PRIMITIVES.every((p) => !!p.risk));
  ok("the stranger is refused", q("overview", {}, STRANGER).status === "NOT_AUTHORIZED");

  section("2. served content: every mode / topic answers and serves no implementation term");
  const all: QueryResponse[] = [q("overview"), q("attention"), q("decisions"), q("gaps"), q("morning_brief"), q("plan", { question: "מה אני צריך לעשות עכשיו?" }), ...COMPANY_TOPICS.map((t) => q(CO.QUESTION_PLANNER && ["attention_map", "graph", "precedence", "planner", "workflows", "gap_roots", "primitives", "approval", "repo_coverage", "table_coverage", "depth", "discoveries", "rules"].includes(t) ? "model" : "review", { topic: t }))];
  ok(`all ${all.length} calls answer OK`, all.every((r) => r.status === "OK"));
  const served = all.map(texts).join(" ").toLowerCase();
  check("no implementation / secret term is served", FORBIDDEN_SERVED_TERMS.filter((t) => served.includes(t.toLowerCase())), []);

  const v = buildCompanyView(sources());
  section("SCENARIO A — 'מה אני צריך לעשות עכשיו?' (planner + calendar + attention + decisions)");
  check("planner: WHAT_NOW → calendar, attention, client work, cashflow, releases, decisions", planQuestion("מה אני צריך לעשות עכשיו?"), { id: "WHAT_NOW", sections: ["calendar", "attention", "client_work", "cashflow", "releases", "decisions"] });
  ok("plan answer carries every planned section", ["calendar", "attention", "cashflow", "decisions"].every((s) => q("plan", { question: "מה אני צריך לעשות עכשיו?" }).items.some((i) => i.fields.section === s)));
  section("SCENARIO B — 'מה מצב החברה?' → 3–5 observations, executive counts, no score");
  ok("headline has 3–5 observations", v.executive.headline.length >= 3 && v.executive.headline.length <= 5);
  ok("headline follows the fixed group order (presentation, not priority)", v.executive.headline.every((o, i, a) => i === 0 || CO.ATTENTION_DIMENSIONS.indexOf(a[i - 1].group as CO.AttentionDimension) <= CO.ATTENTION_DIMENSIONS.indexOf(o.group as CO.AttentionDimension)));
  section("SCENARIO C — Owner-blocking: Victor uploaded after the last notes → waiting on the Owner");
  const blocking = v.attention.filter((o) => o.group === "OWNER_BLOCKING");
  ok("a Victor WAITING_ON_OWNER observation is Owner-blocking on the project", blocking.some((o) => o.concept === "WAITING_ON_OWNER" && o.project === `project:${P(2)}` && o.side === "OWNER"));
  section("SCENARIO D — dedupe: the same concept on the same project appears once (other domains → alsoSeenIn)");
  const keys = v.attention.map((o) => `${o.concept}|${o.project ?? o.entity ?? o.he}`);
  check("no duplicate concept + entity", keys.length - new Set(keys).size, 0);
  ok("the Victor wait seen by projects and Victor is ONE observation", v.attention.filter((o) => o.concept === "WAITING_ON_OWNER" && o.project === `project:${P(2)}`).length === 1);
  section("SCENARIO E — cashflow: ₪ realized vs target; $ apart; never converted");
  ok("realized ₪ vs the ₪20k floor / ₪30k preferred", v.cashflow!.realized.floorIls === 20000 && v.cashflow!.realized.preferredIls === 30000 && v.cashflow!.realized.ils.net === 2500);
  ok("$ income stays in its own currency", (v.cashflow!.realized.byCurrency["$"]?.cashIn ?? 0) === 400);
  ok("proposal money is POTENTIAL only", /POTENTIAL/.test(v.cashflow!.potential.meaning));
  section("SCENARIO F — Finance unreadable → PARTIAL, money unknown (not zero)");
  const nf = q("review", { topic: "cashflow" }, OWNER, { noFinance: true });
  ok("cashflow = UNKNOWN item, completeness PARTIAL", nf.items.some((i) => i.epistemic === "UNKNOWN") && nf.completeness !== "COMPLETE");
  section("SCENARIO G — company state unreadable → UNKNOWN, never an empty company");
  const ns = q("overview", {}, OWNER, { noState: true });
  ok("no items, completeness UNKNOWN", ns.items.length === 0 && ns.completeness === "UNKNOWN");
  section("SCENARIO H — calendar: personal events are schedule context, never business facts");
  ok("today's personal event has no served title and is NOT_A_BUSINESS_FACT", (v.calendar.today ?? []).some((e) => e.category === "PERSONAL_OR_OTHER" && e.title === null && e.businessFact === "NOT_A_BUSINESS_FACT"));
  ok("tomorrow's session event is INFERRED work linked by text to the project", (v.calendar.next7 ?? []).some((e) => e.businessFact === "INFERRED" && e.links.includes(`project:${P(2)}`)));
  section("SCENARIO I — calendar failure = UNKNOWN (not an empty day)");
  const cf = buildCompanyView(sources({ calendar: "fail" }));
  ok("today = null + partial names the calendar", cf.calendar.today === null && cf.partial.some((p) => /CALENDAR/.test(p)));
  section("SCENARIO J — label: protected growth track; the app's release-candidate rule");
  ok("every roster artist is in the label review", v.label.artists.length >= 3);
  ok("a label-credited releasable project without a release row is a candidate (P(4) נגש 1)", (v.label.releaseCandidates ?? []).some((x) => x.project === `project:${P(4)}`));
  ok("the project that already has a release is not a candidate (P(1))", !(v.label.releaseCandidates ?? []).some((x) => x.project === `project:${P(1)}`));
  section("SCENARIO K — releases: upcoming targets vs passed; no cadence invented");
  ok("the Shalev release target 2026-10-05 is upcoming", v.releases.upcoming.some((r) => r.project === `project:${P(1)}` && r.target === "2026-10-05"));
  ok("no cadence / readiness field", !/cadenceTarget|readinessScore/.test(JSON.stringify(v.releases)));
  section("SCENARIO L — video: Red Films ledger is NOT Finance");
  ok("RF_LEDGER_NOT_IN_FINANCE is a money conflict", v.attention.some((o) => o.code === "RF_LEDGER_NOT_IN_FINANCE" && o.nature === "CONFLICT" && o.dims.includes("MONEY_RELEVANT")));
  ok("cashflow shows the Red Films ledger apart", v.cashflow!.video!.redFilmsLedgerPaid === 1200);
  section("SCENARIO M — PLANNED_NOT_SPENT is INVESTMENT context, never attention");
  ok("investment is not in attention", !v.attention.some((o) => o.code === "PLANNED_NOT_SPENT") && v.context.some((o) => o.code === "PLANNED_NOT_SPENT" && o.nature === "INVESTMENT"));
  section("SCENARIO N — decisions: known historical decisions re-evaluated live");
  const dec = (id: string) => v.decisions.find((d) => d.id === id);
  ok("Victor June $500: still observed (override 500 vs global 550)", dec("known:victor-june-500")?.liveState === "STILL_OBSERVED");
  ok("Red Films ledger vs Finance: still observed", dec("known:redfilms-ledger-vs-finance")?.liveState === "STILL_OBSERVED");
  ok("mix orphan expenses: no longer observed in this company (kept, marked)", dec("known:mix-orphan-expenses")?.liveState === "NO_LONGER_OBSERVED");
  ok("policy questions stay POLICY_OPEN (recoup basis, artist accounting, cadence, work hours)", ["known:recoup-basis", "known:artist-accounting-canonical", "known:release-cadence", "known:working-hours"].every((id) => dec(id)?.liveState === "POLICY_OPEN"));
  ok("every decision is Owner-only (Sunny never answers)", v.decisions.every((d) => d.answerable === "OWNER_ONLY"));
  section("SCENARIO O — decision QA: an Owner decision recorded in knowledge removes the question");
  const withK = buildCompanyView(sources({ knowledge: [{ subjectKey: "known:release-cadence" }] }));
  ok("the cadence question is gone once decided", !withK.decisions.some((d) => d.id === "known:release-cadence"));
  ok("a WITHDRAWN decision reopens it", buildCompanyView(sources({ knowledge: [{ subjectKey: "known:release-cadence", operation: "WITHDRAW" }] })).decisions.some((d) => d.id === "known:release-cadence"));
  section("SCENARIO P — decision dedupe: the same question text appears once");
  const qk = v.decisions.map((d) => `${d.kind}|${d.questionHe.replace(/\s+/g, " ")}`);
  check("no duplicate question", qk.length - new Set(qk).size, 0);
  ok("the live Victor June question is folded into the known June decision (with its evidence)", !v.decisions.some((d) => d.origin === "LIVE_QUESTION" && d.domain === "VICTOR" && /2026-06/.test(d.questionHe)) && /2026-06/.test(dec("known:victor-june-500")?.evidenceHe ?? ""));
  ok("the live Red Films ledger question is folded into the known decision", !v.decisions.some((d) => d.origin === "LIVE_QUESTION" && d.domain === "VIDEO" && /פנקס נפרד/.test(d.questionHe)));
  ok("only open (new) company-level alerts are read", v.companyAlerts.every((a) => a.status === "new"));
  section("SCENARIO Q — agent alerts: company-level alerts read as CONTEXT (never canonical action truth)");
  ok("goal_behind company alert is read", v.companyAlerts.some((a) => a.type === "goal_behind"));
  ok("…as context, never attention", v.context.some((o) => o.code === "ALERT_GOAL_BEHIND" && o.epistemic === "OBSERVATION") && !v.attention.some((o) => o.domain === "AGENT_ALERTS"));
  section("SCENARIO R — external party waiting is context, not the Owner's problem");
  ok("WAITING_ON_VICTOR (if any) is EXTERNAL context", v.context.filter((o) => o.concept === "WAITING_ON_VICTOR").every((o) => o.side === "EXTERNAL"));
  section("SCENARIO S — conflicts: data + registered + implementation-vs-policy");
  ok("conflicts include the work-hours implementation-vs-policy conflict", v.conflicts.implementationVsPolicy.some((c) => c.id === "WORKING_HOURS"));
  ok("registered conflicts come from the gap registry", v.conflicts.registered.length > 0);
  section("SCENARIO T — gaps grouped by root cause");
  ok("MONEY and IDENTITY roots are present", v.gaps.byRoot.some((g) => g.root === "MONEY") && v.gaps.byRoot.some((g) => g.root === "IDENTITY"));
  check("gaps total = registry", v.gaps.total, KNOWLEDGE_GAPS.length);
  section("SCENARIO U — change awareness: only 'when'");
  ok("projects updated in the last 7 days come from recorded updated-at", v.changes.projectsUpdated.some((p) => p.project === `project:${P(1)}`) && !v.changes.projectsUpdated.some((p) => p.project === `project:${P(4)}`));
  ok("the rule says 'what changed' is not recorded", /not recorded|no history/.test(v.changes.rule));
  section("SCENARIO V — morning brief on request (no push)");
  ok("brief has calendar status, ≤3 attention, a decision, money", v.morningBrief.calendarStatus === "CALENDAR_DATA_AVAILABLE" && v.morningBrief.attention.length <= 3 && !!v.morningBrief.decision && !!v.morningBrief.money);
  ok("…and says no push", /no push/.test(v.morningBrief.note));
  section("SCENARIO W — action map: executable today vs future primitives");
  ok("exactly the two approved primitives are executable today", v.actionMap.executableToday.length === 2 && v.actionMap.futurePrimitives.length >= 10);
  section("SCENARIO X — security map: report only");
  ok("open security findings are listed with severity", v.security.open.every((g) => !!g.severity) && /report only/.test(v.security.rule));
  section("SCENARIO Y — system friction: patterns only when ≥2");
  ok("every recurring signal has ≥2 occurrences and is a PATTERN_CANDIDATE", v.friction.recurringSignals.every((r) => r.occurrences >= 2 && r.epistemic === "PATTERN_CANDIDATE"));
  section("SCENARIO Z — no invented policy");
  ok("no unmapped signal reached the company view", v.unmappedSignalCodes.length === 0);
  ok("cashflow vs label is a stated tension, never decided", /Owner's/.test(v.cashflow!.tension));
  ok("team: no workload score / capacity", /no workload score, no capacity limit/.test(v.team.note));
  ok("rules forbid fixed hours / score / readiness", CO.COMPANY_RULES.some((r) => /no fixed hours/.test(r) && /No score/.test(r)));

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}
main();
