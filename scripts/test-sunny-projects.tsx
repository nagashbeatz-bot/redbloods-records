/**
 * Tests — Sunny Projects Deep Brain: the project contract (fields / links / money / signals / surfaces / integrity),
 * relationship coverage against every project-referencing column in the production schema, the connected project
 * view (link quality, canonical money rules, derived signals, certain / inferred / missing), the portfolio (no score),
 * Owner-only access, entity enrichment, served-term hygiene and the project-change review fingerprints.
 *
 * Run with:   npx tsx scripts/test-sunny-projects.tsx
 * NEVER touches production; writes nothing.
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { FORBIDDEN_SERVED_TERMS, DOMAIN_CONTRACTS, SYSTEM_BASELINE_VERSION, CAPABILITY_CHANGES, validateSystemRegistry } from "../lib/partner/system";
import { PROJECT_BASELINE_VERSION, PROJECT_FIELDS, PROJECT_LINKS, PROJECT_MONEY_MODEL, PROJECT_REVIEWED_FINGERPRINTS, PROJECT_SCHEMA_COLUMNS, PROJECT_SIGNAL_MODEL } from "../lib/partner/system/projects";
import { PARTNER_KNOWLEDGE_REGISTRY } from "../lib/partner/knowledge/catalog";
import { entityKnowledge, queryKnowledgeCore } from "../lib/partner/knowledge/query";
import type { KnowledgeAudience, QueryResponse } from "../lib/partner/knowledge/types";
import { KNOWLEDGE_KINDS } from "../lib/partner/owner-knowledge/kinds";
import type { OperationsRaw } from "../lib/partner/operations/types";
import type { GatewayFinance, GatewaySources } from "../lib/partner/gateway/core";
import { deriveFinanceView } from "../lib/partner/finance/view";
import { buildFinanceBrief } from "../lib/partner/finance/brief";
import type { FinanceRaw } from "../lib/partner/finance/types";
import { projectMoney } from "../lib/partner/projects/money";
import { buildProjectView, projectPortfolio } from "../lib/partner/projects/view";
import type { ProjectDetailRaw } from "../lib/partner/projects/detail-types";
import { NOW, P, U, input } from "./fixtures/integrity-company";
import { empty, tx } from "./fixtures/finance-mirror";

const EMPTY_DETAIL = Object.fromEntries(["projects", "financeNotes", "deliveries", "actions", "sessions", "meetings", "tasks", "engineerWork", "mixVersions", "mixComments", "commentAttachments", "mixTargets", "mixTargetNotes", "finalFiles", "victor", "productions", "budgetItems", "albumTracks", "clipItems", "proposals", "releases", "campaigns", "contentItems", "socialFiles", "projectSettings", "transactionsText", "budgetPayments", "agentAlerts", "notifications"].map((k) => [k, { rows: [], capped: false }])) as unknown as ProjectDetailRaw;
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
const OPS: OperationsRaw = {
  redFilms: sec([{ id: U(801), title: "קליפ שליו", productionType: "קליפ", status: "בעריכה", projectId: P(1), clientId: null, artistName: "שליו טסמה", clientSource: "אמן לייבל", shootDate: "2026-09-20", publishDate: null, editStatus: "בעריכה", collectionStatus: "לא רלוונטי", generalBudget: 8000, clientPrice: null, advanceRequired: null, advanceReceived: null }]),
  budgetPayments: sec([{ productionId: U(801), amount: 2000, paymentDate: "2026-09-10" }]),
  clipItems: sec([{ projectId: P(1), category: "תאורה", amount: 1500, currency: "₪", status: "תכנון בלבד", hasTransaction: false }, { projectId: P(1), category: "ציוד", amount: 200, currency: "$", status: "תכנון בלבד", hasTransaction: false }, { projectId: P(1), category: "x", amount: 999, currency: "₪", status: "בוטל", hasTransaction: false }, { projectId: P(1), category: "y", amount: 900, currency: "₪", status: "הועבר לכספים", hasTransaction: false }]),
  meetings: sec([{ id: U(811), date: "2026-09-28", time: "12:00", status: "נקבעה", projectId: P(2), clientId: null, hasCalendarEvent: true }]),
  projectActions: sec([{ id: U(821), projectId: P(2), actionType: "sent", contentType: "mix", recipientRole: "artist", status: "pending_feedback", actionDate: "2026-09-15", followupDate: "2026-09-20" }]),
  engineerWork: sec([{ id: U(851), projectId: P(2), engineerName: "Steven", workType: "מיקס + מאסטר", workTitle: null, status: "בתהליך", sentDate: "2026-09-10", internalDeadline: "2026-09-30", agreedPrice: 200, amountPaid: 0, currency: "$", paymentDate: null }]),
  mixVersions: sec([{ id: U(861), workId: U(851), status: "בבדיקה", createdAt: "2026-09-18T10:00:00Z" }]),
  mixComments: sec([{ versionId: U(861), status: "open" }, { versionId: U(861), status: "resolved" }]),
  finalFiles: sec([]),
  deliveries: sec([{ projectId: P(3), status: "ready", deliveredAt: null }]),
  projectsMeta: sec([{ id: P(2), name: "אבי 1", status: "בעבודה", projectType: "שיר", businessType: "לקוח", artistText: "אבי מולה", deadline: "2026-09-01", startDate: "2026-08-01", endDate: null, parentProject: "ללא שיוך", isHidden: false, plannedHours: 10, plannedDays: null, updatedAt: "2026-09-20T10:00:00Z" }]),
  budgetItems: sec([]), equipment: sec([]), beats: sec([]), beatAssignments: sec([]), campaigns: sec([]), contentItems: sec([]), promotions: sec([]), balanceCycles: sec([]), albumTracks: sec([]),
  integrations: { googleCalendarConnected: true, dropboxConnected: true },
};

function finRaw(): FinanceRaw {
  return empty({
    transactions: [
      tx({ projectId: P(2), type: "income", amount: 600, status: "שולם" }),
      tx({ projectId: P(2), type: "income", amount: 300, status: "חלקי" }),
      tx({ projectId: P(2), type: "income", amount: 50, currency: "$", status: "שולם" }),
      tx({ projectId: P(2), type: "expense", amount: 100, status: "שולם" }),
      tx({ projectId: P(2), type: "expense", amount: 40, status: "חלקי" }),
    ],
    financeSettings: [{ projectId: P(2), value: { agreedPrice: 1000, currency: "₪" } }],
  });
}
function sources(opts: { ops?: OperationsRaw | "UNAVAILABLE"; fin?: FinanceRaw | "UNAVAILABLE" } = {}): GatewaySources {
  const st = input({ contexts: [] }).state!;
  const ops = opts.ops ?? OPS;
  const raw = opts.fin ?? finRaw();
  let finance: GatewaySources["finance"];
  if (raw === "UNAVAILABLE") finance = { status: "UNAVAILABLE", detail: "x" };
  else {
    const view = deriveFinanceView(raw, NOW, []);
    const f: GatewayFinance = { state: view.state, integrity: view.integrity, actions: view.actions, raw, brief: buildFinanceBrief(view.state, view.integrity, { answersAvailable: true, actionNoteHe: view.actionNoteHe }), answersAvailable: true };
    finance = { status: "OK", value: f };
  }
  return { now: NOW, state: { status: "OK", value: st }, finance, identities: { cleantone: null },
    cases: { status: "OK", value: [] }, actions: { status: "OK", value: [] }, outcomes: { status: "OK", value: [] }, ownerKnowledge: { status: "OK", value: [] },
    projectDetail: { status: "OK", value: EMPTY_DETAIL },
    operations: ops === "UNAVAILABLE" ? { status: "UNAVAILABLE", detail: "x" } : { status: "OK", value: ops } };
}
const q = (capability: string, extra: { mode?: string; params?: Record<string, string> } = {}, src = sources(), aud = OWNER): QueryResponse => queryKnowledgeCore(REG, { capability, ...extra }, src, aud);

function main() {
  section("A. The project contract is valid and wired into the system registry");
  const capIds = REG.all().map((c) => c.id);
  check("validateSystemRegistry()", validateSystemRegistry({ capabilityIds: capIds, knowledgeKinds: KNOWLEDGE_KINDS.map((k) => k.kind) }), []);
  check("baseline versions agree", [SYSTEM_BASELINE_VERSION, PROJECT_BASELINE_VERSION], ["2026.09.25-3", "2026.09.25-3"]);
  ok("PROJECTS domain lists project_view + project_portfolio", ["project_view", "project_portfolio"].every((c) => DOMAIN_CONTRACTS.find((d) => d.id === "PROJECTS")!.readCapabilities.includes(c)));
  ok("a PROJECTS change entry exists for this baseline", CAPABILITY_CHANGES.some((c) => c.version === "2026.09.25-3" && c.domain === "PROJECTS"));
  check("every link's live-read capability is registered", PROJECT_LINKS.filter((l) => l.liveRead && !capIds.includes(l.liveRead)).map((l) => l.id), []);
  const Q = ["CANONICAL_RELATION", "OWNER_CONFIRMED_RELATION", "DERIVED_RELATION", "TEXT_MATCH", "AMBIGUOUS", "UNKNOWN"];
  check("every link quality is from the canonical set", PROJECT_LINKS.filter((l) => !Q.includes(l.quality)).map((l) => l.id), []);
  check("link ids are unique", PROJECT_LINKS.length, new Set(PROJECT_LINKS.map((l) => l.id)).size);
  ok("client + parent + portals are TEXT_MATCH (never claimed canonical)", ["CLIENT", "PARENT_PROJECT", "PORTALS", "LABEL_ARTIST_BY_NAME"].every((id) => PROJECT_LINKS.find((l) => l.id === id)!.quality === "TEXT_MATCH"));
  ok("fields are classified with the mission's classes", PROJECT_FIELDS.every((f) => ["CANONICAL", "DERIVED", "LEGACY", "DISPLAY_ONLY", "AMBIGUOUS", "POSSIBLE_BUG", "CONFLICT"].includes(f.cls)));
  ok("signal model kinds are from the canonical set", PROJECT_SIGNAL_MODEL.every((s) => ["CANONICAL_FACT", "DERIVED_SIGNAL", "OWNER_POLICY", "HYPOTHESIS", "UNKNOWN"].includes(s.kind)));
  ok("money model reports conflicts (report only)", PROJECT_MONEY_MODEL.conflictsHe.length >= 5);

  section("B. Relationship coverage — every project column in the production schema is a known link");
  const tablesCovered = new Set(PROJECT_LINKS.map((l) => l.internal.table).filter(Boolean));
  const EXPLAINED: Record<string, string> = { "projects": "self (parent / type columns)", "social_content_files": "covered by SOCIAL_CONTENT (items + files)" };
  check("schema columns whose table has no link", PROJECT_SCHEMA_COLUMNS.map((c) => c.split(".")[0]).filter((t) => !tablesCovered.has(t) && !EXPLAINED[t]), []);
  const fkCascade = ["agent_alerts", "album_tracks", "clip_items", "project_actions", "project_release_details", "sound_engineer_work", "vendor_project_work"];
  const fkNull = ["final_files", "mix_versions", "proposals", "social_campaigns"];
  const noFk = ["transactions", "sessions", "meetings", "red_films_productions", "social_content_items", "notifications"];
  check("DB cascade links match the production FKs", PROJECT_LINKS.filter((l) => l.internal.table && fkCascade.includes(l.internal.table) && l.enforcement !== "DB_FK_CASCADE").map((l) => l.id), []);
  check("DB set-null links match the production FKs", PROJECT_LINKS.filter((l) => l.internal.table && fkNull.includes(l.internal.table) && l.enforcement !== "DB_FK_SET_NULL").map((l) => l.id), []);
  check("links without an FK are not claimed as enforced", PROJECT_LINKS.filter((l) => l.internal.table && noFk.includes(l.internal.table) && l.enforcement !== "ID_NO_FK").map((l) => l.id), []);

  section("C. Project money — the canonical rules (no new rule)");
  const pid = P(2);
  const m = projectMoney(finRaw(), { id: pid, status: "בעבודה" });
  check("received counts only שולם/התקבל in the price currency", m.song?.received, 600);
  check("חלקי is NOT received (open)", m.song?.openExpected, 300);
  check("debt = agreed − received", [m.verdict, m.song?.collectible], ["DEBT", 400]);
  check("other currency listed separately, never merged", m.otherCurrencyIncome, { "$": { received: 50, open: 0 } });
  check("expense paid only when שולם (חלקי = not paid)", m.expenses, { "₪": { paid: 100, notPaid: 40 } });
  const mk = (rows: Parameters<typeof tx>[0][], value: unknown, status = "בעבודה") => projectMoney(empty({ transactions: rows.map((r) => tx({ projectId: pid, ...r })), financeSettings: value === undefined ? [] : [{ projectId: pid, value }] }), { id: pid, status });
  check("התקבל counts as received", mk([{ amount: 1000, status: "התקבל" }], { agreedPrice: 1000, currency: "₪" }).verdict, "NO_DEBT");
  const over = mk([{ amount: 1200, status: "שולם" }], { agreedPrice: 1000, currency: "₪" });
  check("paid > agreed → OVERPAYMENT (credit / tip), not debt", [over.verdict, over.song?.overpayment], ["OVERPAYMENT", 200]);
  check("צפוי / לא שולם are not received", mk([{ amount: 500, status: "צפוי" }, { amount: 500, status: "לא שולם" }], { agreedPrice: 1000, currency: "₪" }).song?.received, 0);
  check("finance exception → no debt computed", mk([], { agreedPrice: 1000, currency: "₪", financeException: true }).verdict, "FINANCE_EXCEPTION");
  check("no setting, nothing received → PRICE_UNKNOWN", mk([], undefined).verdict, "PRICE_UNKNOWN");
  check("no price but money received → INSUFFICIENT_EVIDENCE (never 'no debt')", mk([{ amount: 300, status: "שולם" }], undefined).verdict, "INSUFFICIENT_EVIDENCE");
  check("malformed setting is reported", mk([], { agreedPrice: "abc" }).price.malformedSetting, true);
  check("cancelled project with a balance → PROJECT_CANCELLED", mk([{ amount: 200, status: "שולם" }], { agreedPrice: 1000, currency: "₪" }, "בוטל").verdict, "PROJECT_CANCELLED");
  const usd = mk([{ amount: 100, status: "שולם", currency: "$" }, { amount: 900, status: "שולם" }], { agreedPrice: 100, currency: "$" });
  check("the deal is measured in the PRICE's currency", [usd.verdict, usd.song?.received, Object.keys(usd.otherCurrencyIncome)], ["NO_DEBT", 100, ["₪"]]);
  const clip = mk([{ amount: 500, status: "שולם" }, { amount: 700, status: "שולם", expenseScope: "קליפ" }], { agreedPrice: 500, currency: "₪", clipAgreedPrice: 2000 });
  check("clip income is separated from the song deal", [clip.verdict, clip.song?.received, clip.clip?.paid, clip.clip?.remaining], ["NO_DEBT", 500, 700, 1300]);
  check("invalid rows are dropped and counted", mk([{ amount: -5, status: "שולם" }, { type: "expense", amount: 10, status: "התקבל" }], { agreedPrice: 100, currency: "₪" }).invalidRows, 2);
  ok("every verdict carries reasons", [m, over, clip].every((x) => x.reasonsHe.length > 0));

  section("D. ONE connected project view");
  const v = buildProjectView(sources(), pid);
  ok("found with identity from the live data", v.found && v.identity?.name === "אבי 1");
  ok("clients are TEXT_MATCH only (never canonical by name)", v.people.clients.length > 0 && v.people.clients.every((c) => c.quality === "TEXT_MATCH"));
  ok("engineers / Victor are CANONICAL (id links)", v.people.engineers.every((e) => e.quality === "CANONICAL_RELATION") && v.people.victor?.quality === "CANONICAL_RELATION");
  check("money verdict + Finance Brain slice", [v.money?.verdict, !!v.moneyBrain], ["DEBT", true]);
  check("engineer pipeline: versions / open comments", [v.work.engineers?.[0].versions, v.work.engineers?.[0].openComments, v.work.engineers?.[0].paid], [1, 1, false]);
  check("project actions: who waits for whom", v.work.projectActions, { open: 1, waitingFeedback: 1, waitingVersion: 0, followupOverdue: 1 });
  check("meetings", v.work.meetings, { upcoming: 1, total: 1 });
  const codes = v.signals.map((s) => s.code);
  ok("signals: AT_ENGINEER, WAITING_FEEDBACK, OUTSTANDING_CLIENT_MONEY, DEADLINE_PASSED", ["AT_ENGINEER", "WAITING_FEEDBACK", "OUTSTANDING_CLIENT_MONEY", "DEADLINE_PASSED"].every((c) => codes.includes(c)));
  ok("deadline signal says a deadline alone is not urgency", v.signals.find((s) => s.code === "DEADLINE_PASSED")!.he.includes("איכות לפני מהירות"));
  ok("stale wording: stale is not urgent", code(read("lib/partner/projects/view.ts")).includes("ישן זה לא דחוף"));
  ok("certain / inferred / missing are all present; live calendar gap + unread detail declared", v.certain.length > 0 && v.inferred.length > 0 && v.missing.some((x) => x.includes("Google Calendar")) && v.missing.some((x) => x.includes("section")));
  check("no parent when 'ללא שיוך'", v.identity?.parentProject, null);
  const v1 = buildProjectView(sources(), P(1));
  ok("label project: release link is CANONICAL", v1.people.labelArtists.some((l) => l.quality === "CANONICAL_RELATION"));
  check("clip planning excludes cancelled + moved-to-finance, currencies kept apart", v1.work.clipPlanning, { rows: 2, byCurrency: { "₪": 1500, "$": 200 } });
  check("Red Films budget paid", v1.work.redFilms?.[0].budgetPaid, 2000);
  ok("CLIP_IN_PRODUCTION on the label project", v1.signals.some((s) => s.code === "CLIP_IN_PRODUCTION"));
  const v6 = buildProjectView(sources(), P(6));
  ok("unknown artist → no client, and it says so", v6.people.clients.length === 0 && v6.missing.some((x) => x.includes("לא תואם אף לקוח")));
  const vx = buildProjectView(sources(), U(99999));
  check("unknown project → not found (fail closed)", [vx.found, vx.identity], [false, null]);
  const vu = buildProjectView(sources({ ops: "UNAVAILABLE", fin: "UNAVAILABLE" }), pid);
  ok("sources unavailable → null blocks + missing (never 'none')", vu.money === null && vu.work.engineers === null && vu.missing.some((x) => x.includes("מוח הכספים")) && vu.missing.some((x) => x.includes("מקור התפעול")));
  ok("no Owner knowledge loaded → none claimed (P2 kept separate from state)", v.ownerKnowledge.length === 0);

  section("E. partner_query — project_view / project_portfolio");
  const r = q("project_view", { params: { project: `project:${pid}` } });
  check("project_view OK for the Owner", [r.status, r.items.length, r.summary.find((x) => x.code === "MONEY_VERDICT")?.value], ["OK", 1, "DEBT"]);
  check("project_view without a project → UNKNOWN + missing", [q("project_view").completeness, q("project_view").missing.length > 0], ["UNKNOWN", true]);
  check("project_view refused for a non-Owner", q("project_view", { params: { project: `project:${pid}` } }, sources(), STRANGER).status === "OK", false);
  check("project_portfolio refused for a non-Owner", q("project_portfolio", {}, sources(), STRANGER).status === "OK", false);
  const pf = projectPortfolio(sources());
  ok("portfolio: no score / rank field", pf.every((row) => !("score" in row) && !("rank" in row) && !("priority" in row)));
  const dl = pf.map((x) => x.deadline ?? "9999");
  check("portfolio sorted by deadline (not ranked)", dl, [...dl].sort());
  ok("portfolio excludes completed / cancelled", pf.every((x) => x.status !== "הושלם" && x.status !== "בוטל"));
  const pq = q("project_portfolio", { params: { signal: "AT_ENGINEER" } });
  check("portfolio signal filter", pq.items.map((i) => i.id), [pid]);
  const enr = entityKnowledge(REG, { ...sources(), audience: OWNER }, `project:${pid}`);
  ok("partner_entity for a project includes the connected view", enr.some((s) => s.capability === "project_view"));

  section("F. system_awareness project_model (served semantically, no internals)");
  const secs = ["fields", "vocabularies", "links", "money", "signals", "surfaces", "side_effects", "integrity"];
  const served = secs.map((s) => q("system_awareness", { mode: "project_model", params: { section: s } }));
  check("every section answers", served.map((x) => [x.status, x.items.length > 0]), secs.map(() => ["OK", true]));
  check("links default section = every link", q("system_awareness", { mode: "project_model" }).page?.total, PROJECT_LINKS.length);
  const all = JSON.stringify(served);
  check("no implementation term (tables, secrets, source paths) is served", FORBIDDEN_SERVED_TERMS.filter((t) => all.toLowerCase().includes(t.toLowerCase())), []);
  ok("the internal table map is never served", !all.includes("\"internal\""));

  section("G. Safety — read-only, no generic reader, reviewed files unchanged");
  for (const f of ["lib/partner/projects/view.ts", "lib/partner/projects/money.ts", "lib/partner/knowledge/capabilities/projects-deep.ts"]) {
    ok(`${f}: no write / network / db access`, !/\.(insert|update|upsert|delete|rpc)\s*\(|fetch\s*\(|supabase|createClient/i.test(code(read(f))));
  }
  const reader = code(read("lib/partner/operations/readers.ts"));
  ok("project meta read selects no notes / files / folders / links", /"id, name, status, project_type, project_business_type, artist, deadline, start_date, end_date, parent_project, is_hidden, planned_hours, planned_days, updated_at"/.test(reader) && !/dropbox_folder|notes|files/.test((reader.match(/projectsMeta[\s\S]{0,400}/)?.[0]) ?? ""));
  for (const [f, want] of Object.entries(PROJECT_REVIEWED_FINGERPRINTS)) {
    const got = createHash("sha256").update(fs.readFileSync(path.join(ROOT, f)).toString("utf8").replace(/\r\n/g, "\n")).digest("hex");
    check(`${f} unchanged since the last Sunny project review (update lib/partner/system/projects.ts + fingerprint together)`, got, want);
  }
  const agents = read("AGENTS.md");
  ok("AGENTS.md requires a Sunny review for project changes", /projects\.ts/.test(agents) && /test-sunny-projects\.tsx/.test(agents));

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}
main();
