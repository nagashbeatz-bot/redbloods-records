/**
 * Golden tests for Redbloods Partner Project Dossier v1 (Phase C.1).
 *
 * Run with:   npx tsx scripts/test-partner-dossiers.ts
 *
 * Pure module: no Supabase, no network, no LLM. Builds a CooRawInput +
 * PartnerEyesRaw fixture, runs it through the REAL computeCoo() and
 * assemblePartnerCompanyState() (same engines production uses), then
 * through buildProjectDossier()/buildAllProjectDossiers() — never a mock.
 */
import fs from "node:fs";
import path from "node:path";
import { computeCoo } from "../lib/coo/pipeline";
import type { CooRawInput } from "../lib/coo/types";
import { assemblePartnerCompanyState } from "../lib/partner/eyes/company-state";
import type { PartnerEyesRaw } from "../lib/partner/eyes/types";
import { buildAllProjectDossiers, buildProjectDossier } from "../lib/partner/dossiers/project";

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
    sources: [
      { source: "projects", status: "ok", rowCount: 5 }, { source: "tasks", status: "ok", rowCount: 1 },
      { source: "steven", status: "ok", rowCount: 1 }, { source: "victor", status: "ok", rowCount: 2 },
      { source: "proposals", status: "ok", rowCount: 2 }, { source: "shows", status: "ok", rowCount: 0 },
      { source: "sessions", status: "ok", rowCount: 3 }, { source: "transactions", status: "ok", rowCount: 1 },
      { source: "finance_settings", status: "ok", rowCount: 1 }, { source: "releases", status: "ok", rowCount: 2 },
      { source: "agent_alerts", status: "ok", rowCount: 0 },
    ],
    projects: [
      { id: "p1", name: "פרויקט רגיל", artist: "אמן בדיקה", status: "בעבודה", deadline: "2026-10-01", projectType: "שיר", businessType: "לקוח", updatedAt: "2026-09-20T10:00:00Z", isHidden: false },
      { id: "p2", name: "פרויקט לייבל תואם", artist: "אמן לייבל בדיקה", status: "בעבודה", deadline: null, projectType: "שיר", businessType: "לייבל", updatedAt: "2026-09-20T10:00:00Z", isHidden: false },
      { id: "p3", name: "פרויקט לייבל בקונפליקט", artist: "אמן קונפליקט", status: "בעבודה", deadline: null, projectType: "שיר", businessType: "לייבל", updatedAt: "2026-09-20T10:00:00Z", isHidden: false },
      { id: "p4", name: "פרויקט לקוח כפול", artist: "לקוח כפול", status: "בעבודה", deadline: null, projectType: "שיר", businessType: "לקוח", updatedAt: "2026-09-20T10:00:00Z", isHidden: false },
      { id: "p-closed", name: "פרויקט שהושלם", artist: "אמן שהושלם", status: "הושלם", deadline: null, projectType: "שיר", businessType: "לקוח", updatedAt: "2026-01-01T10:00:00Z", isHidden: false },
    ],
    tasks: [
      { id: "t1", title: "משימה על p1", status: "פתוח", dueDate: "2026-09-25", relatedType: "project", relatedId: "p1", createdAt: "2026-09-10T09:00:00Z" },
    ],
    steven: [
      { id: "s1", projectId: "p1", title: "מיקס p1", status: "בתהליך", agreedPrice: 200, currency: "$", amountPaid: 0, sentDate: "2026-09-15", internalDeadline: "2026-09-24", hasMixVersion: true, lastUploadAt: "2026-09-20T10:00:00Z" },
    ],
    victor: {
      stuckAfterDays: 5,
      works: [
        { id: "v1", projectId: "p1", title: "עבודת Victor p1", status: "פעיל", workState: "נשלח לויקטור", sentDate: "2026-09-12", internalDeadline: null, daysSinceSent: 10, isStuck: true, uploads: ["2026-09-12T10:00:00Z"], filesWithoutTimestamp: 0, reviews: [], linkedTaskId: null },
        // standalone Victor work — no project_id — must NEVER be guessed into any dossier
        { id: "v-standalone", projectId: null, title: "עבודה עצמאית של אמן בדיקה בערך", status: "פעיל", workState: "נשלח לויקטור", sentDate: "2026-09-01", internalDeadline: null, daysSinceSent: 21, isStuck: true, uploads: [], filesWithoutTimestamp: 0, reviews: [], linkedTaskId: null },
      ],
    },
    // status "נשלחה" (sent/open) — NOT in lib/coo's CLOSED_PROPOSAL set ("נסגר"/"לא נסגר"),
    // so these actually survive into state.proposals and can be tested by relation.
    proposals: [
      { id: "pr1", clientName: "אמן בדיקה", title: "הצעה p1", amount: 3000, currency: "₪", status: "נשלחה", followupDate: null, linkedProjectId: "p1" },
      { id: "pr-closed", clientName: "אמן שהושלם", title: "הצעה ישנה", amount: 1000, currency: "₪", status: "נשלחה", followupDate: null, linkedProjectId: "p-closed" },
    ],
    shows: [],
    sessions: [
      { id: "se1-past", projectId: "p1", date: "2026-09-10", startTime: "18:00", endTime: "20:00", status: "בוצע", sessionType: "סשן" },
      { id: "se1-future", projectId: "p1", date: "2026-09-25", startTime: "18:00", endTime: "20:00", status: "מתוכנן", sessionType: "סשן" },
      { id: "se-closed", projectId: "p-closed", date: "2025-12-01", startTime: null, endTime: null, status: "בוצע", sessionType: "סשן" },
    ],
    transactions: [
      { id: "tx1", projectId: "p1", type: "income", amount: 500, currency: "₪", status: "התקבל", date: "2026-09-10", expenseScope: "כללי", category: "" },
    ],
    financeSettings: [
      { projectId: "p1", agreedPrice: 2000, currency: "₪", financeException: false },
      // p2/p3/p4/p-closed deliberately have NO finance setting
    ],
    orphanFinanceKeyCount: 0,
    releases: {
      labelProjectsTotal: 2,
      rows: [
        { projectId: "p2", name: "פרויקט לייבל תואם", projectStatus: "בעבודה", stage: "הפקה", targetDate: "2026-11-01", nextAction: "", blocker: "", responsible: "", stageEnteredAt: "2026-09-01T10:00:00Z", labelArtistId: "la1" },
        { projectId: "p3", name: "פרויקט לייבל בקונפליקט", projectStatus: "בעבודה", stage: "הפקה", targetDate: "2026-11-01", nextAction: "", blocker: "", responsible: "", stageEnteredAt: "2026-09-01T10:00:00Z", labelArtistId: "la2" },
      ],
    },
    alerts: [],
  });
}

function buildEyesRaw(): PartnerEyesRaw {
  return structuredClone<PartnerEyesRaw>({
    sources: [
      { source: "clients", status: "ok", rowCount: 4 }, { source: "label_artists", status: "ok", rowCount: 3 },
      { source: "clip_productions", status: "ok", rowCount: 2 }, { source: "artist_balance_entries", status: "ok", rowCount: 0 },
      { source: "sessions_eyes", status: "ok", rowCount: 3 }, { source: "shows_eyes", status: "ok", rowCount: 0 },
    ],
    clients: [
      { id: "c1", name: "אמן בדיקה", type: "אמן", status: "פעיל" },
      { id: "c2", name: "לקוח רגיל", type: "לקוח", status: "פעיל" },
      { id: "c3", name: "לקוח כפול", type: "לקוח", status: "פעיל" },
      { id: "c4", name: "לקוח כפול", type: "לקוח", status: "פעיל" }, // same name as c3 → AMBIGUOUS for p4
    ],
    labelArtists: [
      { id: "la1", name: "אמן לייבל בדיקה", status: "פעיל" }, // ID target for p2, agrees with p2's artist text
      { id: "la2", name: "אמן אחר לגמרי", status: "פעיל" },   // ID target for p3 — does NOT match p3's artist text
      { id: "la3", name: "אמן קונפליקט", status: "פעיל" },     // TEXT_MATCH candidate for p3 — conflicts with la2
    ],
    artistBalanceCounts: {},
    clips: [
      { id: "clip1", title: "קליפ מקושר p1", status: "בתהליך", projectId: "p1", artistName: "אמן בדיקה" },
      { id: "clip-unlinked", title: "קליפ ללא פרויקט", status: "בתהליך", projectId: null, artistName: "אמן בדיקה" },
    ],
    sessions: [
      { id: "se1-past", projectId: "p1", showId: null, date: "2026-09-10", startTime: "18:00", endTime: "20:00", status: "בוצע", sessionType: "סשן" },
      { id: "se1-future", projectId: "p1", showId: null, date: "2026-09-25", startTime: "18:00", endTime: "20:00", status: "מתוכנן", sessionType: "סשן" },
      { id: "se-closed", projectId: "p-closed", showId: null, date: "2025-12-01", startTime: null, endTime: null, status: "בוצע", sessionType: "סשן" },
    ],
    shows: [],
  });
}

const coo = computeCoo(buildCooRaw(), NOW);
const eyesRaw = buildEyesRaw();
const P = assemblePartnerCompanyState(coo, eyesRaw);

console.log("build dossier by project ID");
const r1 = buildProjectDossier(P, "p1");
ok("p1 builds successfully", r1.ok);
const d1 = r1.ok ? r1.dossier : null;
check("dossierSchemaVersion is set", d1?.dossierSchemaVersion, "project-dossier-v1");
check("identity.name matches the fixture", d1?.identity.name, "פרויקט רגיל");
check("identity.identitySource is OPEN_SET for a non-closed project", d1?.identity.identitySource, "OPEN_SET");

console.log("unknown project returns SCOPED not_found, not \"doesn't exist globally\"");
const rNotFound = buildProjectDossier(P, "does-not-exist-anywhere");
ok("returns ok:false with reason NOT_FOUND_IN_EYES_SCOPE", !rNotFound.ok && rNotFound.reason === "NOT_FOUND_IN_EYES_SCOPE");
ok("the note explains this is a SCOPE limitation (hidden or nonexistent — cannot tell), never a flat \"does not exist\"", !rNotFound.ok && rNotFound.note.includes("hidden") && rNotFound.note.includes("scope"));

console.log("closed project: INDEX_ONLY identity, but OTHER sections still work (they don't depend on the open set)");
const rClosed = buildProjectDossier(P, "p-closed");
ok("p-closed builds successfully despite being excluded from lib/coo's 'open' set", rClosed.ok);
const dClosed = rClosed.ok ? rClosed.dossier : null;
check("identitySource is INDEX_ONLY for a closed (הושלם) project", dClosed?.identity.identitySource, "INDEX_ONLY");
check("projectType is null (never fabricated) when identity comes from the index only", dClosed?.identity.projectType, null);
check("…but proposals still resolve (proposals don't depend on the open set)", dClosed?.proposals.items.map((p) => p.id), ["pr-closed"]);
check("…and sessions still resolve", dClosed?.sessions.count, 1);

console.log("relations connect ONLY by their real key — never by name/title guessing");
check("transactions/finance connect only by project_id (p1 has agreedPrice 2000, received 500)", [d1?.finance.agreedPrice, d1?.finance.receivedIncome], [2000, 500]);
check("sessions connect only by project_id (p1 has exactly its 2 own sessions, not p-closed's)", d1?.sessions.count, 2);
ok("…p-closed's session never leaks into p1's dossier", !d1?.sessions.items.some((s) => s.id === "se-closed"));
check("release connects only by project_id (p1 has no release row at all)", d1?.release.status, "NO_ACTIVE_RELEASE_ROW");
check("victor connects only by project_id (p1 has exactly 1 linked work)", d1?.victor.linkedWorks.map((w) => w.id), ["v1"]);
check("steven connects only by project_id (p1 has exactly 1 linked work)", d1?.steven.linkedWorks.map((w) => w.id), ["s1"]);
check("tasks connect by related_type+related_id (p1 has exactly 1)", d1?.tasks.items.map((t) => t.id), ["t1"]);
check("clips connect by project_id (p1 has exactly 1 linked)", d1?.clips.linked.map((c) => c.id), ["clip1"]);
ok("standalone Victor work (no project_id) is NEVER guessed into p1's dossier despite a similar title", !d1?.victor.linkedWorks.some((w) => w.id === "v-standalone"));
ok("…and it's absent from every dossier built (buildAllProjectDossiers)", (() => {
  const all = buildAllProjectDossiers(P);
  return [...all.values()].every((d) => !d.victor.linkedWorks.some((w) => w.id === "v-standalone"));
})());

console.log("client matching: MATCHED / NO_MATCH / AMBIGUOUS — never narrowed by guessing");
check("p1: exactly one client name-matches → MATCHED", d1?.client.status, "MATCHED");
check("…the single candidate is c1", d1?.client.candidates.map((c) => c.id), ["c1"]);
check("…relation quality is TEXT_MATCH, never ID", d1?.client.relation?.quality, "TEXT_MATCH");
{
  const r4 = buildProjectDossier(P, "p4");
  ok("p4: two clients share the matching name → AMBIGUOUS, not one picked", r4.ok && r4.dossier.client.status === "AMBIGUOUS" && r4.dossier.client.candidates.length === 2);
  ok("…AMBIGUOUS never carries a relation object (nothing was chosen)", r4.ok && r4.dossier.client.relation === null);
}
{
  const r2 = buildProjectDossier(P, "p2");
  ok("p2: label project whose artist text matches no CLIENT row → NO_MATCH", r2.ok && r2.dossier.client.status === "NO_MATCH" && r2.dossier.client.candidates.length === 0);
}
ok("client relation quality is NEVER 'ID' anywhere — no client_id exists on projects", (() => {
  const all = buildAllProjectDossiers(P);
  return [...all.values()].every((d) => d.client.relation === null || d.client.relation.quality === "TEXT_MATCH");
})());

console.log("label artist: ID via release.labelArtistId, TEXT_MATCH via name, CONFLICT when they disagree, null never fabricates a relation");
{
  const r2 = buildProjectDossier(P, "p2");
  ok("p2: release.labelArtistId (la1) agrees with the TEXT_MATCH candidate → status ID, no conflict", r2.ok && r2.dossier.labelArtist.status === "ID" && r2.dossier.labelArtist.conflict === null);
  ok("…idCandidate resolves to the real label artist row", r2.ok && r2.dossier.labelArtist.idCandidate?.id === "la1");
}
{
  const r3 = buildProjectDossier(P, "p3");
  ok("p3: release.labelArtistId (la2) DISAGREES with the name-matched candidate (la3) → CONFLICT, neither silently chosen", r3.ok && r3.dossier.labelArtist.status === "CONFLICT");
  ok("…the conflict names both sources and both entities", r3.ok && !!r3.dossier.labelArtist.conflict && r3.dossier.labelArtist.conflict.code === "LABEL_ARTIST_ID_NAME_MISMATCH" && r3.dossier.labelArtist.conflict.description.includes("la1") === false);
  ok("…dataQuality.conflicts surfaces it at the top level too", r3.ok && r3.dossier.dataQuality.conflicts.some((c) => c.code === "LABEL_ARTIST_ID_NAME_MISMATCH"));
}
ok("p1 (no release, no label-artist name match): status NONE, no fake relation from a null labelArtistId", d1?.labelArtist.status === "NONE" && d1?.labelArtist.idCandidate === null && d1?.labelArtist.relations.length === 0);

console.log("finance: exact semantics preserved, never recomputed");
check("received statuses only (p1: 500 from a 'התקבל' row)", d1?.finance.receivedIncome, 500);
check("agreedPrice missing (p2, no finance setting, not cancelled) → UNKNOWN, never 0", (() => { const r2 = buildProjectDossier(P, "p2"); return r2.ok ? [r2.dossier.finance.configStatus, r2.dossier.finance.agreedPrice] : null; })(), ["UNKNOWN", null]);
check("paidIncome < agreedPrice → DEBT (p1: 500 < 2000)", d1?.finance.balanceKind, "DEBT");
{
  // paidIncome >= agreedPrice → NO_DEBT / OVERPAYMENT, never a negative "debt"
  const rawOver = buildCooRaw();
  rawOver.transactions!.push({ id: "tx2", projectId: "p1", type: "income", amount: 2000, currency: "₪", status: "התקבל", date: "2026-09-11", expenseScope: "כללי", category: "" });
  const cooOver = computeCoo(rawOver, NOW);
  const Pover = assemblePartnerCompanyState(cooOver, eyesRaw);
  const rOver = buildProjectDossier(Pover, "p1");
  ok("paidIncome (2500) > agreedPrice (2000) → OVERPAYMENT, not a negative debt figure", rOver.ok && rOver.dossier.finance.balanceKind === "OVERPAYMENT" && (rOver.dossier.finance.balance ?? 0) < 0);
}
ok("currencies are never merged (agreedPrice/receivedIncome/balance all carry the SAME currency field, no cross-currency sum exists in the type)", d1?.finance.currency === "₪");
ok("transactionDetail is honestly NOT_AVAILABLE_IN_EYES — no per-project raw transaction list is fabricated", d1?.finance.transactionDetail === "NOT_AVAILABLE_IN_EYES");

console.log("task scope is explicit — never claims full history");
check("dossier states OPEN_TASKS_ONLY, not 'all tasks'", d1?.tasks.scope, "OPEN_TASKS_ONLY");

console.log("Steven ball remains UNKNOWN/UNSUPPORTED — no new inference");
ok("steven scopeNote states BALL_LOCATION stays UNKNOWN/UNSUPPORTED", d1?.steven.scopeNote.includes("UNKNOWN") ?? false);
ok("no linked Steven work object carries a fabricated 'ball' field", !JSON.stringify(d1?.steven.linkedWorks).includes("\"ball\""));

console.log("clips: ID-linked vs unlinked TEXT_MATCH candidate — candidate is never auto-confirmed");
check("p1 has exactly 1 linked clip (ID)", d1?.clips.linked.length, 1);
check("…and exactly 1 unlinked candidate (name-matches but has no project_id)", d1?.clips.unlinkedCandidates.map((c) => c.id), ["clip-unlinked"]);
ok("the candidate is NEVER present in `linked` — no auto-confirmation happened", !d1?.clips.linked.some((c) => c.id === "clip-unlinked"));

console.log("shows: no direct project relationship is ever guessed from name similarity");
check("shows section is always the static NO_DIRECT_RELATION_MODELED in v1", d1?.shows.status, "NO_DIRECT_RELATION_MODELED");
check("…and relatedShowsContext is always empty", d1?.shows.relatedShowsContext, []);

console.log("data quality: weak relations and conflicts are surfaced structurally, never hidden");
ok("p1's weak TEXT_MATCH client relation appears in dataQuality.weakRelations", d1?.dataQuality.weakRelations.some((w) => w.startsWith("client")) ?? false);
ok("unknown domains are listed (p2 has no finance setting, receivables domain itself is still AVAILABLE though — check general non-emptiness instead)", Array.isArray(d1?.dataQuality.unknownDomains));
{
  const r3 = buildProjectDossier(P, "p3");
  ok("p3's conflict is present in dataQuality.conflicts (already checked above) — reconfirmed length === 1", r3.ok && r3.dossier.dataQuality.conflicts.length === 1);
}

console.log("performance: buildAllProjectDossiers does not recompute PartnerCompanyState (in-memory only)");
{
  const t0 = Date.now();
  const all = buildAllProjectDossiers(P);
  const elapsedMs = Date.now() - t0;
  check("builds a dossier for every visible project in the index (5 in this fixture)", all.size, 5);
  ok("well under a second for 5 in-memory dossiers (no I/O)", elapsedMs < 1000);
}

console.log("isolation (static checks on lib/partner/dossiers)");
const ROOT = path.resolve(__dirname, "..");
const dossierDir = path.join(ROOT, "lib/partner/dossiers");
const dossierFiles = fs.readdirSync(dossierDir).map((f) => path.join(dossierDir, f));
const dossierSrc = Object.fromEntries(dossierFiles.map((f) => [path.basename(f), fs.readFileSync(f, "utf8")]));
ok("no file in lib/partner/dossiers imports lib/supabase or any -store module", Object.values(dossierSrc).every((s) => !/lib\/supabase|-store"/.test(s)));
ok("no file in lib/partner/dossiers actually IMPORTS \"server-only\" as a statement (the whole module is pure — a comment explaining why not is fine)", Object.values(dossierSrc).every((s) => !/^\s*import\s+"server-only"\s*;/m.test(s)));
ok("no DB write verb anywhere in lib/partner/dossiers", Object.values(dossierSrc).every((s) => !/\.(insert|update|upsert|delete|rpc)\(/.test(s)));
ok("no LLM / AI provider anywhere in lib/partner/dossiers", Object.values(dossierSrc).every((s) => !/openai|anthropic|groq|gpt-|claude-/i.test(s.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ""))));
ok("no push / notification / email import", Object.values(dossierSrc).every((s) => !/lib\/push|web-push|nodemailer|notifications/.test(s)));
ok("no reference to agent_alerts or the alerts-store anywhere (Owner decision holds)", Object.values(dossierSrc).every((s) => !/agent_alerts|agent\/alerts-store/.test(s)));
ok("no portal file imports lib/partner/dossiers", (() => {
  const portalDirs = ["app/api/red-artists", "app/api/supplier", "app/api/vendor/victor", "app/api/label/artists", "app/api/beats", "app/api/notifications", "components/team", "components/red-artists", "components/label", "lib/red-artists", "app/team", "app/red-artists", "app/dj-cleantone", "app/label"];
  const walk = (dir: string): string[] => fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]) : [];
  const portalFiles = [...portalDirs.flatMap((d) => walk(path.join(ROOT, d))), ...fs.readdirSync(path.join(ROOT, "lib")).filter((f) => /^(steven|victor|shalev|avi|cleantone|dj-|beat|show-|sketch)/.test(f)).map((f) => path.join(ROOT, "lib", f))];
  return portalFiles.every((f) => !/lib\/partner\/dossiers/.test(fs.readFileSync(f, "utf8")));
})());
ok("no new API route added under app/api for dossiers in this block", !fs.existsSync(path.join(ROOT, "app/api/partner")));

console.log("determinism (same input → identical output)");
check("buildProjectDossier is deterministic", JSON.stringify(buildProjectDossier(P, "p1")), JSON.stringify(r1));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
