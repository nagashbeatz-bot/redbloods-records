/**
 * Golden tests for Redbloods Partner Eyes / Company State (Phase B).
 *
 * Run with:   npx tsx scripts/test-partner-eyes.ts
 *
 * Pure module: no Supabase, no network, no LLM. Builds a small CooRawInput
 * fixture, runs it through the REAL computeCoo() (same engine production
 * uses), then through assemblePartnerCompanyState() — never a mock of
 * either pipeline.
 */
import fs from "node:fs";
import path from "node:path";
import { computeCoo } from "../lib/coo/pipeline";
import type { CooRawInput } from "../lib/coo/types";
import { assemblePartnerCompanyState } from "../lib/partner/eyes/company-state";
import type { PartnerEyesRaw } from "../lib/partner/eyes/types";

let pass = 0, fail = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log(`  ✓ ${name}`); pass++; }
  else { console.log(`  ✗ ${name}\n      expected ${e}\n      actual   ${a}`); fail++; }
}
const ok = (name: string, cond: boolean) => { if (cond) { console.log(`  ✓ ${name}`); pass++; } else { console.log(`  ✗ ${name}`); fail++; } };

const NOW = new Date("2026-09-22T06:00:00Z");

function buildCooRaw(): CooRawInput {
  return structuredClone<CooRawInput>({
    sources: [{ source: "projects", status: "ok", rowCount: 2 }],
    projects: [
      { id: "p1", name: "פרויקט א", artist: "אמן בדיקה", status: "בעבודה", deadline: "2026-10-01", projectType: "שיר", businessType: "לקוח", updatedAt: "2026-09-20T10:00:00Z", isHidden: false },
      { id: "p2", name: "פרויקט לייבל", artist: "אמן לייבל בדיקה", status: "בעבודה", deadline: null, projectType: "שיר", businessType: "לייבל", updatedAt: "2026-09-20T10:00:00Z", isHidden: false },
    ],
    tasks: [
      { id: "t1", title: "משימה", status: "פתוח", dueDate: "2026-09-25", relatedType: "project", relatedId: "p1", createdAt: "2026-09-10T09:00:00Z" },
    ],
    steven: [
      { id: "s1", projectId: "p1", title: "מיקס", status: "בתהליך", agreedPrice: 200, currency: "$", amountPaid: 0, sentDate: "2026-09-15", internalDeadline: "2026-09-24", hasMixVersion: true, lastUploadAt: "2026-09-20T10:00:00Z" },
    ],
    victor: {
      stuckAfterDays: 5,
      works: [
        { id: "v1", projectId: "p1", title: "עבודת Victor", status: "פעיל", workState: "נשלח לויקטור", sentDate: "2026-09-12", internalDeadline: null, daysSinceSent: 10, isStuck: true, uploads: ["2026-09-12T10:00:00Z"], filesWithoutTimestamp: 0, reviews: [], linkedTaskId: null },
      ],
    },
    proposals: [
      { id: "pr1", clientName: "לקוח א", title: "הצעה", amount: 3000, currency: "₪", status: "נסגר", followupDate: null, linkedProjectId: "p1" },
    ],
    shows: [
      { id: "sh1", name: "הופעה", status: "בוצע", paymentStatus: "שולם", date: "2026-09-01", price: 2000, advance: 0, incomeTxId: null },
    ],
    sessions: [
      { id: "se1", projectId: "p1", date: "2026-09-23", startTime: "18:00", endTime: "20:00", status: "מתוכנן", sessionType: "סשן" },
    ],
    transactions: [
      { id: "tx1", projectId: "p1", type: "income", amount: 1000, currency: "₪", status: "התקבל", date: "2026-09-10", expenseScope: "כללי", category: "" },
    ],
    financeSettings: [
      { projectId: "p1", agreedPrice: 2000, currency: "₪", financeException: false },
      // p2 deliberately has NO finance setting → agreedPrice must read UNKNOWN, never 0
    ],
    orphanFinanceKeyCount: 0,
    releases: { labelProjectsTotal: 1, rows: [{ projectId: "p2", name: "פרויקט לייבל", projectStatus: "בעבודה", stage: "הפקה", targetDate: "2026-10-15", nextAction: "", blocker: "", responsible: "", stageEnteredAt: "2026-09-01T10:00:00Z" }] },
    alerts: [
      { id: "al1", type: "week_understaffed", severity: "info", title: "השבוע", message: "…", createdAt: "2026-09-21T08:00:00Z", relatedProjectId: null },
    ],
  });
}

function buildEyesRaw(): PartnerEyesRaw {
  return structuredClone<PartnerEyesRaw>({
    sources: [
      { source: "clients", status: "ok", rowCount: 2 },
      { source: "label_artists", status: "ok", rowCount: 1 },
      { source: "clip_productions", status: "ok", rowCount: 2 },
      { source: "artist_balance_entries", status: "ok", rowCount: 1 },
      { source: "agent_alerts_eyes", status: "ok", rowCount: 3 },
    ],
    clients: [
      { id: "c1", name: "אמן בדיקה", type: "אמן", status: "פעיל" },
      { id: "c2", name: "לקוח כללי", type: "לקוח", status: "פעיל" },
    ],
    labelArtists: [
      { id: "la1", name: "אמן לייבל בדיקה", status: "פעיל" },
    ],
    artistBalanceCounts: { la1: 3 },
    clips: [
      { id: "clip1", title: "קליפ עם פרויקט", status: "בתהליך", projectId: "p1", artistName: "אמן בדיקה" },
      { id: "clip2", title: "קליפ ישן (שם בלבד)", status: "בתהליך", projectId: null, artistName: "אמן לייבל בדיקה" },
    ],
    // 3 alerts spanning statuses/types COO's own status="new"-only read never sees at all (al2, al3)
    alerts: [
      { id: "al1", type: "week_understaffed", severity: "info", status: "new", hasEntityKey: false, relatedProjectId: null, createdAt: "2026-09-21T08:00:00Z" },
      { id: "al2", type: "overdue_deadline", severity: "important", status: "handled", hasEntityKey: true, relatedProjectId: "p1", createdAt: "2026-08-01T08:00:00Z" },
      { id: "al3", type: "some_old_type", severity: "warning", status: "dismissed", hasEntityKey: false, relatedProjectId: null, createdAt: "2026-06-01T08:00:00Z" },
    ],
  });
}

const coo = computeCoo(buildCooRaw(), NOW);
const eyesRaw = buildEyesRaw();
const P = assemblePartnerCompanyState(coo, eyesRaw);

console.log("existing COO domains are mapped correctly (reused, not recomputed)");
check("projects domain data is the SAME object COO built (reference reuse, not a copy/recompute)", P.domains.projects.data === coo.state.projects, true);
check("victor domain data is the SAME object as state.team.victor", P.domains.victor.data === coo.state.team.victor, true);
check("steven domain data is the SAME object as state.team.steven", P.domains.steven.data === coo.state.team.steven, true);
check("tasks domain data is the SAME object as state.tasks", P.domains.tasks.data === coo.state.tasks, true);
check("receivables domain data is the SAME object as state.receivables (finance UNKNOWN semantics untouched)", P.domains.receivables.data === coo.state.receivables, true);
ok("p2 has no finance setting → still UNKNOWN in the reused receivables data, never coerced to 0", !coo.state.receivables!.rows.some((r) => r.projectId === "p2"));
check("cooSchemaVersion matches the underlying CompanyState", P.cooSchemaVersion, coo.state.meta.schemaVersion);
check("cooSources is the COO read's own source list, verbatim", P.cooSources, coo.state.sources);

console.log("missing source ≠ zero, failed source ≠ empty");
{
  const raw2 = buildCooRaw();
  raw2.tasks = null;
  raw2.sources = [{ source: "tasks", status: "failed", rowCount: null, error: "boom" }];
  const coo2 = computeCoo(raw2, NOW);
  const P2 = assemblePartnerCompanyState(coo2, eyesRaw);
  check("a failed tasks source → domain status UNKNOWN, not AVAILABLE", P2.domains.tasks.status, "UNKNOWN");
  check("…coverage FAILED, not NONE (NONE would silently read as '0 tasks')", P2.domains.tasks.coverage, "FAILED");
  check("…and data stays null, never []", P2.domains.tasks.data, null);
}
{
  const raw3 = buildEyesRaw();
  raw3.clients = null;
  raw3.sources = raw3.sources.map((s) => (s.source === "clients" ? { source: "clients", status: "failed" as const, rowCount: null, error: "boom" } : s));
  const P3 = assemblePartnerCompanyState(coo, raw3);
  check("a failed Partner-only source (clients) → status UNKNOWN, data null, coverage FAILED", [P3.domains.clients.status, P3.domains.clients.data, P3.domains.clients.coverage], ["UNKNOWN", null, "FAILED"]);
}

console.log("relation quality reflects reality, never overstates it");
check("Clients ↔ Projects is TEXT_MATCH (no id path exists at all)", P.domains.clients.relations[0].quality, "TEXT_MATCH");
check("Label Artists ↔ Projects primary relation is TEXT_MATCH (not falsely ID-linked)", P.domains.labelArtists.relations[0].quality, "TEXT_MATCH");
ok("…but the release-row ID path is documented separately, with its OWN coverage (not folded into the primary relation)", (() => {
  const rel = P.domains.labelArtists.relations.find((r) => r.via.includes("label_artist_id"))!;
  return rel.quality === "ID" && rel.coverage !== undefined;
})());

console.log("Phase B.1 fix: relation QUALITY is never downgraded because of partial COVERAGE (was a real bug in Phase B)");
ok("Clips ↔ Projects: 1 of 2 rows carry project_id in this fixture → quality stays ID, coverage is PARTIAL (previously wrongly downgraded to TEXT_MATCH)", (() => {
  const rel = P.domains.clips.relations.find((r) => r.via.includes("project_id"))!;
  return rel.quality === "ID" && rel.coverage === "PARTIAL";
})());
ok("…the exact split (1/2) is in a warning, never silently rounded away", P.domains.clips.warnings.some((w) => w.includes("1/2")));
check("Clips data counts withProjectId/withoutProjectId correctly from the fixture (1 and 1)", [P.domains.clips.data!.withProjectId, P.domains.clips.data!.withoutProjectId], [1, 1]);
ok("if ALL rows carried project_id, coverage would read FULL (not just ID)", (() => {
  const rawAllLinked = buildEyesRaw(); rawAllLinked.clips = [{ id: "x1", title: "t", status: "s", projectId: "p1", artistName: "a" }];
  const rel = assemblePartnerCompanyState(coo, rawAllLinked).domains.clips.relations.find((r) => r.via.includes("project_id"))!;
  return rel.quality === "ID" && rel.coverage === "FULL";
})());
ok("if NO rows carried project_id, quality falls back to TEXT_MATCH (never invents an id relation from nothing)", (() => {
  const rawNoneLinked = buildEyesRaw(); rawNoneLinked.clips = [{ id: "x1", title: "t", status: "s", projectId: null, artistName: "a" }];
  const rel = assemblePartnerCompanyState(coo, rawNoneLinked).domains.clips.relations.find((r) => r.via.includes("project_id"))!;
  return rel.quality === "TEXT_MATCH";
})());

console.log("Phase B.1: Victor relation coverage stays explicit, no invented fallback relation");
ok("Victor ↔ Projects relation carries a coverage figure derived from lib/coo's own victor.link entry", P.domains.victor.relations[0].coverage !== undefined);
ok("the Victor domain explains WHY unlinked works have no reliable fallback (projectName collapses to the work's own title, never a real project/artist name)", P.domains.victor.warnings.some((w) => w.includes("projectName") && w.includes("title")));
ok("…and explicitly says no new TEXT_MATCH relation was invented for Victor", P.domains.victor.warnings.some((w) => w.includes("TEXT_MATCH")));

console.log("Phase B.1: Shows DJ fields flow through the additive lib/coo change");
ok("shows.djClientId is now populated (non-undefined key) on the reused CompanyState data", (() => {
  const rows = [...coo.state.shows!.upcoming, ...coo.state.shows!.doneUnpaid];
  return rows.every((s) => "djClientId" in s);
})());
ok("Shows ↔ external relation is quality ID with a real coverage figure now that the field is exposed", (() => {
  const rel = P.domains.shows.relations.find((r) => r.via === "shows.dj_client_id")!;
  return rel.quality === "ID" && rel.coverage !== undefined;
})());
ok("a show with djClientId=null never creates a fake relation (coverage accounts for it, quality stays ID for the relation TYPE, not per-row)", (() => {
  // the one fixture show (sh1) has no dj fields set → djClientId is null/undefined-mapped-to-null
  const rows = [...coo.state.shows!.upcoming, ...coo.state.shows!.doneUnpaid];
  return rows.every((s) => s.djClientId === null);
})());

console.log("Phase B.1: Agent Alerts sees the true breadth, not just what COO's brief shows");
check("Partner's agentAlerts domain sees ALL 3 alerts (2 of which COO's status=\"new\"-only read never even fetches)", P.domains.agentAlerts.data!.total, 3);
check("byStatus breaks down new/handled/dismissed correctly", P.domains.agentAlerts.data!.byStatus, { new: 1, handled: 1, dismissed: 1 });
ok("cooVisible cross-references what the brief actually shows, separately from the true total", P.domains.agentAlerts.data!.cooVisible.shownByBrief !== null && P.domains.agentAlerts.data!.total > (P.domains.agentAlerts.data!.cooVisible.shownByBrief ?? 0));
ok("a resolved/dismissed alert is present as a historical row, never re-labelled as a current issue (no severity/urgency field invented)", !JSON.stringify(P.domains.agentAlerts.data!.items).includes("current"));
ok("agentAlerts is no longer adapted from lib/coo's narrow state.alerts — it has its own Partner-only reader", P.domains.agentAlerts.provenance.reader.includes("readPartnerEyesRaw"));
check("withEntityKey counts correctly (al2 has one)", P.domains.agentAlerts.data!.withEntityKey, 1);
check("withRelatedProject counts correctly (al2 has one)", P.domains.agentAlerts.data!.withRelatedProject, 1);
{
  const raw4 = buildEyesRaw(); raw4.alerts = null;
  raw4.sources = raw4.sources.map((s) => (s.source === "agent_alerts_eyes" ? { source: "agent_alerts_eyes", status: "failed" as const, rowCount: null, error: "boom" } : s));
  const P4 = assemblePartnerCompanyState(coo, raw4);
  check("a failed Agent Alerts read → status UNKNOWN, data null, coverage FAILED (never an empty/zero total)", [P4.domains.agentAlerts.status, P4.domains.agentAlerts.data, P4.domains.agentAlerts.coverage], ["UNKNOWN", null, "FAILED"]);
}

console.log("Phase B.1 fix: an anchor domain with no outbound relation is not penalized to LOW reliability");
check("projects has no outbound relation (it's the anchor entity) yet FULL coverage → reliability HIGH, not LOW", [P.domains.projects.relations.length, P.domains.projects.coverage, P.domains.projects.reliability], [0, "FULL", "HIGH"]);

console.log("Phase B.1: relation model review — no relation ever mixes quality and coverage semantics");
ok("every relation with a numeric split (some rows linked, not all) reports quality=ID + a coverage field, never a downgraded quality", (() => {
  const allRelations = Object.values(P.domains).flatMap((d) => d.relations);
  return allRelations.every((r) => !(r.quality === "TEXT_MATCH" && r.coverage === "FULL"));
})());
ok("Coverage values used on relations are only ever the 4 defined Coverage values", (() => {
  const allRelations = Object.values(P.domains).flatMap((d) => d.relations);
  const valid = new Set(["FULL", "PARTIAL", "NONE", "FAILED", undefined]);
  return allRelations.every((r) => valid.has(r.coverage));
})());

console.log("Steven ball stays UNKNOWN/unsupported — no new ball logic");
ok("Steven domain warns BALL_LOCATION is UNKNOWN/UNSUPPORTED", P.domains.steven.warnings.some((w) => w.includes("BALL_LOCATION") && w.includes("UNKNOWN")));
ok("no field on the Steven domain's data claims to know who holds the ball (Hardening-1 Victor-only concept)", !JSON.stringify(P.domains.steven.data).includes("\"ball\""));

console.log("Victor latest-action semantics preserved (Hardening 1) — no reinterpretation");
check("victor domain's ballCounts is passed through unchanged from CompanyState", P.domains.victor.data!.ballCounts, coo.state.team.victor!.ballCounts);
ok("the Victor domain warning describes 'latest recorded action', not 'owner owes'", P.domains.victor.warnings.some((w) => w.includes("latest recorded action") || w.includes("recorded action")));
ok("…and never claims the owner currently owes a review", !P.domains.victor.warnings.some((w) => /owner (currently )?owes|owner must review/i.test(w)));

console.log("suppliers: re-audited, correctly reported as not existing as a separate domain");
check("suppliers domain status is UNAVAILABLE (no invented table)", P.domains.suppliers.status, "UNAVAILABLE");
check("…and its data is null, not an empty object pretending to be a real (empty) domain", P.domains.suppliers.data, null);
ok("the warning names the actual re-audit finding (vendor_name hardcoded to victor)", P.domains.suppliers.warnings.some((w) => w.includes("vendor_name") && w.includes("victor")));

console.log("sessions: honestly scoped, not falsely 'complete'");
check("sessions coverage is PARTIAL (forward-window only), never FULL", P.domains.sessions.coverage, "PARTIAL");
ok("…and the warning says why (future window, no history)", P.domains.sessions.warnings.some((w) => w.includes("חלון") || w.toLowerCase().includes("window")));

console.log("determinism (same input → identical output, pure assembly)");
check("assemblePartnerCompanyState is deterministic", JSON.stringify(assemblePartnerCompanyState(coo, eyesRaw)), JSON.stringify(P));

console.log("engine constraints (static checks on lib/partner/eyes)");
const ROOT = path.resolve(__dirname, "..");
const eyesDir = path.join(ROOT, "lib/partner/eyes");
const eyesFiles = fs.readdirSync(eyesDir).map((f) => path.join(eyesDir, f));
const eyesSrc = Object.fromEntries(eyesFiles.map((f) => [path.basename(f), fs.readFileSync(f, "utf8")]));
ok("no LLM / AI provider anywhere in lib/partner/eyes", Object.values(eyesSrc).every((s) => !/openai|anthropic|groq|gpt-|claude-/i.test(s.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ""))));
ok("no DB write verb anywhere in lib/partner/eyes", Object.values(eyesSrc).every((s) => !/\.(insert|update|upsert|delete|rpc)\(/.test(s)));
ok("no push / notification / email import", Object.values(eyesSrc).every((s) => !/lib\/push|web-push|nodemailer|notifications/.test(s.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ""))));
ok("only readers.ts / build.ts are server-only (all other eyes modules are pure)", Object.entries(eyesSrc).filter(([, s]) => s.includes('import "server-only"')).map(([f]) => f).sort().join() === "build.ts,readers.ts");
ok("the pure eyes modules import no store / supabase", Object.entries(eyesSrc).filter(([f]) => !["readers.ts", "build.ts"].includes(f)).every(([, s]) => !/lib\/supabase|-store"/.test(s)));
ok("no portal file imports anything from lib/partner", (() => {
  const portalDirs = ["app/api/red-artists", "app/api/supplier", "app/api/vendor/victor", "app/api/label/artists", "app/api/beats", "app/api/notifications", "components/team", "components/red-artists", "components/label", "lib/red-artists", "app/team", "app/red-artists", "app/dj-cleantone", "app/label"];
  const walk = (dir: string): string[] => fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]) : [];
  const portalFiles = [...portalDirs.flatMap((d) => walk(path.join(ROOT, d))), ...fs.readdirSync(path.join(ROOT, "lib")).filter((f) => /^(steven|victor|shalev|avi|cleantone|dj-|beat|show-|sketch)/.test(f)).map((f) => path.join(ROOT, "lib", f))];
  return portalFiles.every((f) => !/lib\/partner/.test(fs.readFileSync(f, "utf8")));
})());
ok("lib/coo has no reverse dependency on lib/partner (the only lib/coo edits this block are the additive Shows DJ fields — see report)", (() => {
  const cooDir = path.join(ROOT, "lib/coo");
  return fs.readdirSync(cooDir).every((f) => !/lib\/partner/.test(fs.readFileSync(path.join(cooDir, f), "utf8")));
})());
ok("no new API route added under app/api for Partner in this block", !fs.existsSync(path.join(ROOT, "app/api/partner")));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
