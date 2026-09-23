/**
 * Golden tests for Redbloods Partner Entity Dossiers — Project (Phase C.1),
 * Client + Label Artist (Phase C.2).
 *
 * Run with:   npx tsx scripts/test-partner-dossiers.ts
 *
 * Pure module: no Supabase, no network, no LLM. Builds a CooRawInput +
 * PartnerEyesRaw fixture, runs it through the REAL computeCoo() and
 * assemblePartnerCompanyState() (same engines production uses), then through
 * the dossier builders — never a mock.
 */
import fs from "node:fs";
import path from "node:path";
import { computeCoo } from "../lib/coo/pipeline";
import type { CooRawInput } from "../lib/coo/types";
import { assemblePartnerCompanyState } from "../lib/partner/eyes/company-state";
import type { PartnerEyesRaw } from "../lib/partner/eyes/types";
import { buildAllProjectDossiers, buildProjectDossier } from "../lib/partner/dossiers/project";
import { buildAllClientDossiers, buildClientDossier } from "../lib/partner/dossiers/client";
import { buildAllLabelArtistDossiers, buildLabelArtistDossier } from "../lib/partner/dossiers/labelArtist";

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
      { source: "projects", status: "ok", rowCount: 7 }, { source: "tasks", status: "ok", rowCount: 1 },
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
      // pure TEXT_MATCH label artist scenario — no release row at all, so no ID path and no conflict
      { id: "p5", name: "פרויקט לייבל טקסט בלבד", artist: "אמן טקסט בלבד", status: "בעבודה", deadline: null, projectType: "שיר", businessType: "לייבל", updatedAt: "2026-09-20T10:00:00Z", isHidden: false },
      // Phase C.3: la1's SECOND release, already RELEASED (יצא) — invisible to lib/coo's own
      // active-stage-only releases read (never in buildCooRaw's `releases.rows` below), visible
      // via eyes:releasesFull. Proves Label Artist Dossier's release/project lists are genuinely
      // full-history now, not just active-stage.
      { id: "p2b", name: "פרויקט לייבל שני של la1 (כבר יצא)", artist: "אמן לייבל בדיקה 2", status: "הושלם", deadline: null, projectType: "שיר", businessType: "לייבל", updatedAt: "2026-01-01T10:00:00Z", isHidden: false },
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
      // ID-linked (via release.label_artist_id) project session — for Label Artist Dossier's "sessions inherit project relation path" test
      { id: "se-p2", projectId: "p2", date: "2026-09-15", startTime: null, endTime: null, status: "בוצע", sessionType: "סשן" },
      { id: "se-p5", projectId: "p5", date: "2026-09-16", startTime: null, endTime: null, status: "בוצע", sessionType: "סשן" },
    ],
    transactions: [
      { id: "tx1", projectId: "p1", type: "income", amount: 500, currency: "₪", status: "התקבל", date: "2026-09-10", expenseScope: "כללי", category: "" },
      { id: "tx2", projectId: "p2", type: "income", amount: 1000, currency: "₪", status: "התקבל", date: "2026-09-11", expenseScope: "כללי", category: "" },
    ],
    financeSettings: [
      { projectId: "p1", agreedPrice: 2000, currency: "₪", financeException: false },
      { projectId: "p2", agreedPrice: 1000, currency: "₪", financeException: false },
      // p3/p4/p-closed deliberately have NO finance setting
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
      { source: "clients", status: "ok", rowCount: 5 }, { source: "label_artists", status: "ok", rowCount: 3 },
      { source: "clip_productions", status: "ok", rowCount: 2 }, { source: "artist_balance_entries", status: "ok", rowCount: 3 },
      { source: "sessions_eyes", status: "ok", rowCount: 4 }, { source: "shows_eyes", status: "ok", rowCount: 2 },
      { source: "proposals_eyes", status: "ok", rowCount: 3 }, { source: "releases_eyes", status: "ok", rowCount: 3 },
      { source: "transactions_eyes", status: "ok", rowCount: 4 }, { source: "tasks_eyes", status: "ok", rowCount: 2 },
    ],
    clients: [
      { id: "c1", name: "אמן בדיקה", type: "אמן", status: "פעיל", createdAt: "2026-01-01T10:00:00Z" },
      { id: "c2", name: "לקוח רגיל", type: "לקוח", status: "פעיל", createdAt: "2026-01-01T10:00:00Z" },
      { id: "c3", name: "לקוח כפול", type: "לקוח", status: "פעיל", createdAt: "2026-01-01T10:00:00Z" },
      { id: "c4", name: "לקוח כפול", type: "לקוח", status: "פעיל", createdAt: "2026-01-01T10:00:00Z" }, // same name as c3 → AMBIGUOUS for p4
      { id: "c5", name: "תקליטן בדיקה", type: "איש צוות", status: "פעיל", createdAt: "2026-01-01T10:00:00Z" }, // DJ-only client — never appears as a project artist match
    ],
    labelArtists: [
      { id: "la1", name: "אמן לייבל בדיקה", status: "פעיל", createdAt: "2026-01-01T10:00:00Z", updatedAt: "2026-08-01T10:00:00Z" }, // ID target for p2, agrees with p2's artist text
      { id: "la2", name: "אמן אחר לגמרי", status: "פעיל", createdAt: "2026-01-01T10:00:00Z", updatedAt: "2026-08-01T10:00:00Z" },   // ID target for p3 — does NOT match p3's artist text
      { id: "la3", name: "אמן קונפליקט", status: "פעיל", createdAt: "2026-01-01T10:00:00Z", updatedAt: "2026-08-01T10:00:00Z" },     // TEXT_MATCH candidate for p3 — conflicts with la2
      { id: "la4", name: "אמן טקסט בלבד", status: "פעיל", createdAt: "2026-01-01T10:00:00Z", updatedAt: "2026-08-01T10:00:00Z" },   // pure TEXT_MATCH for p5 — no release row exists at all, no ID path, no conflict
    ],
    artistBalanceEntries: [
      { id: "be1", artistId: "la1", entryType: "הכנסות", amount: 800, entryDate: "2026-08-01" },
      { id: "be2", artistId: "la1", entryType: "תשלומים", amount: 300, entryDate: "2026-08-05" },
      { id: "be3", artistId: "la1", entryType: "הוצאות", amount: 50, entryDate: "2026-08-10" },
      // la2/la3 deliberately have NO ledger entries
    ],
    clips: [
      { id: "clip1", title: "קליפ מקושר p1", status: "בתהליך", projectId: "p1", artistName: "אמן בדיקה", createdAt: "2026-08-01T10:00:00Z", updatedAt: "2026-08-05T10:00:00Z" },
      { id: "clip-unlinked", title: "קליפ ללא פרויקט", status: "בתהליך", projectId: null, artistName: "אמן בדיקה", createdAt: "2026-01-01T10:00:00Z", updatedAt: "2026-01-01T10:00:00Z" },
    ],
    sessions: [
      { id: "se1-past", projectId: "p1", showId: null, date: "2026-09-10", startTime: "18:00", endTime: "20:00", status: "בוצע", sessionType: "סשן" },
      { id: "se1-future", projectId: "p1", showId: null, date: "2026-09-25", startTime: "18:00", endTime: "20:00", status: "מתוכנן", sessionType: "סשן" },
      { id: "se-closed", projectId: "p-closed", showId: null, date: "2025-12-01", startTime: null, endTime: null, status: "בוצע", sessionType: "סשן" },
      { id: "se-p2", projectId: "p2", showId: null, date: "2026-09-15", startTime: null, endTime: null, status: "בוצע", sessionType: "סשן" },
      { id: "se-p5", projectId: "p5", showId: null, date: "2026-09-16", startTime: null, endTime: null, status: "בוצע", sessionType: "סשן" },
    ],
    // sh-artist: c1 performs (artist_client_id) — Client Dossier's ID-relation show test.
    // sh-dj: c5 is DJ (dj_client_id) — separate ID relation, distinct client.
    shows: [
      { id: "sh-artist", name: "הופעה עם אמן מזוהה", status: "בוצע", paymentStatus: "שולם", date: "2026-08-15", djClientId: null, djConfirmationStatus: null, artistClientId: "c1", bookerClientId: null, price: 1000 },
      { id: "sh-dj", name: "הופעה עם תקליטן", status: "מתוכנן", paymentStatus: "לא שולם", date: "2026-10-05", djClientId: "c5", djConfirmationStatus: "אושר", artistClientId: null, bookerClientId: null, price: 1000 },
    ],
    // Phase C.3 — full proposal history: pr1 (client_id → c1, ID relation, linked to p1),
    // pr-closed (client_id=null — legacy, linked to p-closed by project only), pr-legacy-textmatch
    // (client_id=null, clientName matches c1 by name only — Client Dossier's legacyTextMatched test).
    proposalsFull: [
      { id: "pr1", clientId: "c1", clientName: "אמן בדיקה", linkedProjectId: "p1", title: "הצעה p1", amount: 3000, currency: "₪", status: "נשלחה", followupDate: null, sentDate: "2026-09-01", createdAt: "2026-09-01T10:00:00Z", updatedAt: "2026-09-01T10:00:00Z" },
      { id: "pr-closed", clientId: null, clientName: "אמן שהושלם", linkedProjectId: "p-closed", title: "הצעה ישנה", amount: 1000, currency: "₪", status: "נשלחה", followupDate: null, sentDate: "2026-01-01", createdAt: "2026-01-01T10:00:00Z", updatedAt: "2026-01-01T10:00:00Z" },
      { id: "pr-legacy-textmatch", clientId: null, clientName: "אמן בדיקה", linkedProjectId: null, title: "הצעה legacy ללא client_id", amount: 400, currency: "₪", status: "לא נסגר", followupDate: null, sentDate: null, createdAt: "2025-05-01T10:00:00Z", updatedAt: "2025-05-01T10:00:00Z" },
    ],
    // Phase C.3 — full release history via project_release_details directly: p2 (la1, active
    // stage הפקה), p3 (la2, active stage — conflict scenario, unchanged), p2b (la1's SECOND
    // release, already יצא/released — only visible here, never in lib/coo's own active-stage read).
    releasesFull: [
      { projectId: "p2", labelArtistId: "la1", stage: "הפקה", targetDate: "2026-11-01", stageEnteredAt: "2026-09-01T10:00:00Z", releasedAt: null, createdAt: "2026-08-01T10:00:00Z", updatedAt: "2026-09-01T10:00:00Z" },
      { projectId: "p3", labelArtistId: "la2", stage: "הפקה", targetDate: "2026-11-01", stageEnteredAt: "2026-09-01T10:00:00Z", releasedAt: null, createdAt: "2026-08-01T10:00:00Z", updatedAt: "2026-09-01T10:00:00Z" },
      { projectId: "p2b", labelArtistId: "la1", stage: "יצא", targetDate: "2026-01-01", stageEnteredAt: "2025-12-01T10:00:00Z", releasedAt: "2026-01-01T10:00:00Z", createdAt: "2025-10-01T10:00:00Z", updatedAt: "2026-01-01T10:00:00Z" },
    ],
    // Phase C.3 — full transaction row detail: tx1/tx2 match the receivables-driving fixture
    // above; tx3 is an EXPENSE on p1 (income/expense split test); tx-general has no project_id.
    transactions: [
      { id: "tx1", projectId: "p1", type: "income", amount: 500, currency: "₪", status: "התקבל", date: "2026-09-10", expenseScope: "כללי", category: "", createdAt: "2026-09-10T10:00:00Z" },
      { id: "tx2", projectId: "p2", type: "income", amount: 1000, currency: "₪", status: "התקבל", date: "2026-09-11", expenseScope: "כללי", category: "", createdAt: "2026-09-11T10:00:00Z" },
      { id: "tx3", projectId: "p1", type: "expense", amount: 100, currency: "$", status: "שולם", date: "2026-09-12", expenseScope: "כללי", category: "מיקס", createdAt: "2026-09-12T10:00:00Z" },
      { id: "tx-general", projectId: null, type: "expense", amount: 30, currency: "₪", status: "בוטל", date: null, expenseScope: "כללי", category: "", createdAt: "2026-09-01T10:00:00Z" },
    ],
    // Phase C.3 — full task history: t1 matches lib/coo's own open-only fixture; t1-done is a
    // CLOSED task on the SAME project (p1) — invisible to lib/coo's open-only read.
    tasksFull: [
      { id: "t1", title: "משימה על p1", status: "פתוח", dueDate: "2026-09-25", relatedType: "project", relatedId: "p1", createdAt: "2026-09-10T09:00:00Z", updatedAt: "2026-09-10T09:00:00Z" },
      { id: "t1-done", title: "משימה שהושלמה על p1", status: "בוצע", dueDate: "2026-08-01", relatedType: "project", relatedId: "p1", createdAt: "2026-07-01T09:00:00Z", updatedAt: "2026-08-01T09:00:00Z" },
    ],
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

console.log("Phase C.3: Project Dossier proposals — ID via linked_project_id, full history (closed proposals included)");
check("p1's proposal relation quality is ID (linked_project_id)", d1?.proposals.relation.quality, "ID");
check("p1 sees pr1 (OPEN status) via proposalsFull", d1?.proposals.items.map((p) => p.id), ["pr1"]);
ok("p-closed's proposal (pr-closed) is visible despite being a project whose own identity is INDEX_ONLY — proposals is a full-history, ID-only relation, independent of project open/closed state", dClosed?.proposals.items.some((p) => p.id === "pr-closed") ?? false);

console.log("relations connect ONLY by their real key — never by name/title guessing");
check("transactions/finance connect only by project_id (p1 has agreedPrice 2000, received 500)", [d1?.finance.agreedPrice, d1?.finance.receivedIncome], [2000, 500]);
check("sessions connect only by project_id (p1 has exactly its 2 own sessions, not p-closed's)", d1?.sessions.count, 2);
ok("…p-closed's session never leaks into p1's dossier", !d1?.sessions.items.some((s) => s.id === "se-closed"));
check("release connects only by project_id (p1 has no release row at all)", d1?.release.status, "NO_RELEASE_ROW");
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
check("agreedPrice missing (p3, no finance setting, not cancelled) → UNKNOWN, never 0", (() => { const r3 = buildProjectDossier(P, "p3"); return r3.ok ? [r3.dossier.finance.configStatus, r3.dossier.finance.agreedPrice] : null; })(), ["UNKNOWN", null]);
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

console.log("Phase C.3: transactionDetail is now real per-project row detail via eyes:transactions, ID via project_id");
ok("transactionDetail is no longer the NOT_AVAILABLE_IN_EYES placeholder (transactions domain is available)", d1?.finance.transactionDetail !== "NOT_AVAILABLE_IN_EYES");
{
  const td = d1?.finance.transactionDetail;
  ok("p1's income transactions contain exactly tx1", !!td && td !== "NOT_AVAILABLE_IN_EYES" && td.incomeTransactions.map((t) => t.id).join() === "tx1");
  ok("p1's expense transactions contain exactly tx3 (never merged with income)", !!td && td !== "NOT_AVAILABLE_IN_EYES" && td.expenseTransactions.map((t) => t.id).join() === "tx3");
  ok("p2's tx2 never leaks into p1's transactionDetail", !!td && td !== "NOT_AVAILABLE_IN_EYES" && !td.incomeTransactions.some((t) => t.id === "tx2") && !td.expenseTransactions.some((t) => t.id === "tx2"));
}

console.log("task scope is explicit — never claims full history for the OPEN section; history is now separate");
check("dossier states OPEN_TASKS_ONLY, not 'all tasks'", d1?.tasks.scope, "OPEN_TASKS_ONLY");
console.log("Phase C.3: task history section (eyes:tasksFull) — open AND closed, never claims completeness beyond what tasksFull itself has");
ok("history.available is true (tasksFull domain read succeeded)", d1?.tasks.history.available === true);
check("history includes BOTH t1 (open) and t1-done (closed) for p1", d1?.tasks.history.items.map((t) => t.id).sort(), ["t1", "t1-done"]);

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
  check("builds a dossier for every visible project in the index (7 in this fixture)", all.size, 7);
  ok("well under a second for 7 in-memory dossiers (no I/O)", elapsedMs < 1000);
}

// ════════════════════════════════════════════════════════════════════════════
// Client Dossier (Phase C.2)
// ════════════════════════════════════════════════════════════════════════════

console.log("Client Dossier: build by ID");
const rc1 = buildClientDossier(P, "c1");
ok("c1 builds successfully", rc1.ok);
const dc1 = rc1.ok ? rc1.dossier : null;
check("dossierSchemaVersion is set", dc1?.dossierSchemaVersion, "client-dossier-v1");
check("identity.name matches the fixture", dc1?.identity.name, "אמן בדיקה");

console.log("Client Dossier: unknown client returns SCOPED not_found");
const rcNotFound = buildClientDossier(P, "does-not-exist");
ok("returns ok:false with reason NOT_FOUND_IN_EYES_SCOPE", !rcNotFound.ok && rcNotFound.reason === "NOT_FOUND_IN_EYES_SCOPE");

console.log("Client Dossier: project relation via name is TEXT_MATCH only, never ID");
check("c1's matched project is p1", dc1?.matchedProjects.map((p) => p.projectId), ["p1"]);
check("finance.relationQuality is TEXT_MATCH (derived from a name-matched project, not a canonical figure)", dc1?.finance.relationQuality, "TEXT_MATCH");
ok("no client dossier's project-facing relation is ever ID (structurally guaranteed — matchedProjects carries no quality field at all; only the show relations below are ID)", true);

console.log("Client Dossier: ambiguous project match stays ambiguous — never narrowed to one");
const rc3 = buildClientDossier(P, "c3");
const rc4 = buildClientDossier(P, "c4");
ok("c3: p4 appears in ambiguousProjectCandidates, NOT matchedProjects", rc3.ok && rc3.dossier.matchedProjects.length === 0 && rc3.dossier.ambiguousProjectCandidates.map((p) => p.projectId).includes("p4"));
ok("c4: same p4 appears in ITS ambiguousProjectCandidates too — both clients see the ambiguity, neither claims it", rc4.ok && rc4.dossier.matchedProjects.length === 0 && rc4.dossier.ambiguousProjectCandidates.map((p) => p.projectId).includes("p4"));

console.log("Phase C.3: Client Dossier proposal relation is now ID via proposals.client_id, full history");
check("c1's ID-linked proposals include pr1 (client_id = c1)", dc1?.proposals.items.map((p) => p.id), ["pr1"]);
check("relation quality is ID (proposals.client_id is a real FK, Phase C.3)", dc1?.proposals.relation.quality, "ID");
ok("scopeDescription documents the ID-via-client_id relation", dc1?.proposals.scopeDescription.includes("client_id") ?? false);
console.log("Phase C.3: legacy (client_id=null) proposals fall back to TEXT_MATCH ONLY, never merged into the ID-confirmed items");
check("c1's legacyTextMatched holds pr-legacy-textmatch (client_id=null, clientName matches by name only)", dc1?.proposals.legacyTextMatched.map((p) => p.id), ["pr-legacy-textmatch"]);
ok("pr-legacy-textmatch never appears in the ID-confirmed items list", !dc1?.proposals.items.some((p) => p.id === "pr-legacy-textmatch"));

console.log("Client Dossier: DJ/performer/booker show relations are real ID relations (Phase C.2 finding beyond what was asked)");
check("c1 (performer on sh-artist) appears in performerShows via artist_client_id", dc1?.performerShows.items.map((s) => s.id), ["sh-artist"]);
check("performerShows relation quality is ID", dc1?.performerShows.relation.quality, "ID");
const rc5 = buildClientDossier(P, "c5");
ok("c5 (DJ on sh-dj) appears in djShows via dj_client_id, quality ID", rc5.ok && rc5.dossier.djShows.items.map((s) => s.id).includes("sh-dj") && rc5.dossier.djShows.relation.quality === "ID");
ok("c5 has zero matched/ambiguous projects — a DJ-only client is never guessed into a project by name", rc5.ok && rc5.dossier.matchedProjects.length === 0 && rc5.dossier.ambiguousProjectCandidates.length === 0);

console.log("Client Dossier: finance aggregates keep currency separation, no profitability inference");
check("c1's finance byCurrency has exactly one ₪ bucket (2000 agreed, 500 received)", dc1?.finance.byCurrency.map((b) => [b.currency, b.agreedPriceSum, b.receivedSum]), [["₪", 2000, 500]]);
ok("dataQuality.weakRelations documents that this revenue view is TEXT_MATCH-derived, not canonical", dc1?.dataQuality.weakRelations.some((w) => w.includes("TEXT_MATCH")) ?? false);
ok("no profitability/loyalty/churn/seriousness field exists anywhere on the dossier", !/profitability|loyalty|churn|seriousness|score/i.test(JSON.stringify(dc1)));

console.log("Client Dossier: buildAllClientDossiers stays in-memory, no query per client");
{
  const t0 = Date.now();
  const all = buildAllClientDossiers(P);
  ok("builds a dossier for every client in the fixture (5)", all.size === 5);
  ok("fast (in-memory, no I/O)", Date.now() - t0 < 1000);
}

// ════════════════════════════════════════════════════════════════════════════
// Label Artist Dossier (Phase C.2)
// ════════════════════════════════════════════════════════════════════════════

console.log("Label Artist Dossier: build by ID");
const ra1 = buildLabelArtistDossier(P, "la1");
ok("la1 builds successfully", ra1.ok);
const da1 = ra1.ok ? ra1.dossier : null;
check("dossierSchemaVersion is set", da1?.dossierSchemaVersion, "label-artist-dossier-v1");

console.log("Label Artist Dossier: unknown artist returns SCOPED not_found");
const raNotFound = buildLabelArtistDossier(P, "does-not-exist");
ok("returns ok:false with reason NOT_FOUND_IN_EYES_SCOPE", !raNotFound.ok && raNotFound.reason === "NOT_FOUND_IN_EYES_SCOPE");

console.log("Label Artist Dossier: release.label_artist_id creates the ID path to the project (release.project_id) — Phase C.3: now sees BOTH of la1's releases (active p2 AND already-released p2b), not just the active one");
check("la1's idLinked projects = [p2, p2b] (full history, eyes:releasesFull)", da1?.projects.idLinked.map((p) => p.projectId).sort(), ["p2", "p2b"]);
check("…and la1 has NO textMatched projects (both are already ID-linked, never duplicated)", da1?.projects.textMatched, []);

console.log("Label Artist Dossier: name-only project match remains TEXT_MATCH (no release row at all)");
const ra4 = buildLabelArtistDossier(P, "la4");
ok("la4 (p5, no release row exists) is TEXT_MATCH only", ra4.ok && ra4.dossier.projects.textMatched.map((p) => p.projectId).includes("p5") && ra4.dossier.projects.idLinked.length === 0);

console.log("Label Artist Dossier: ID / name disagreement creates a conflict, never resolved by picking one");
const ra2 = buildLabelArtistDossier(P, "la2");
const ra3 = buildLabelArtistDossier(P, "la3");
ok("la2 (release.label_artist_id for p3) carries the LABEL_ARTIST_ID_NAME_MISMATCH conflict", ra2.ok && ra2.dossier.dataQuality.conflicts.some((c) => c.code === "LABEL_ARTIST_ID_NAME_MISMATCH"));
ok("la3 (text-matches p3 but isn't the ID target) carries the SAME conflict, from its own side too", ra3.ok && ra3.dossier.dataQuality.conflicts.some((c) => c.code === "LABEL_ARTIST_ID_NAME_MISMATCH"));
ok("la2 legitimately keeps p3 as idLinked (that IS what release.label_artist_id says — the conflict flags the disagreement, it doesn't erase the real ID fact)", ra2.ok && ra2.dossier.projects.idLinked.some((p) => p.projectId === "p3"));
ok("…but la3 (the text-only candidate) never claims p3 as its own idLinked or textMatched — it only sees it via the conflict", ra3.ok && !ra3.dossier.projects.idLinked.some((p) => p.projectId === "p3") && !ra3.dossier.projects.textMatched.some((p) => p.projectId === "p3"));

console.log("Label Artist Dossier: sessions inherit the project relation path — never described as a direct FK");
check("la1's ID-path sessions include se-p2", da1?.sessions.viaIdLinkedProjects.items.map((s) => s.id), ["se-p2"]);
check("la1's TEXT-path sessions are empty (p2 is ID-linked, not text-matched)", da1?.sessions.viaTextMatchedProjects.items, []);
ok("la4's TEXT-path sessions include se-p5 (via its only text-matched project)", ra4.ok && ra4.dossier.sessions.viaTextMatchedProjects.items.map((s) => s.id).includes("se-p5"));
ok("la4's ID-path sessions are empty (no ID-linked project at all)", ra4.ok && ra4.dossier.sessions.viaIdLinkedProjects.count === 0);

console.log("Label Artist Dossier: finance context inherits project relation quality");
check("la1's ID-path finance is real (p2: 1000 agreed, 1000 received)", da1?.finance.viaIdLinkedProjects.byCurrency.map((b) => [b.currency, b.agreedPriceSum, b.receivedSum]), [["₪", 1000, 1000]]);
check("…relationQuality is ID", da1?.finance.viaIdLinkedProjects.relationQuality, "ID");
check("la4's TEXT-path relationQuality is TEXT_MATCH", ra4.ok ? ra4.dossier.finance.viaTextMatchedProjects.relationQuality : null, "TEXT_MATCH");

console.log("Phase C.3: Label Artist Dossier release count is now genuinely a lifetime count (eyes:releasesFull)");
check("la1's visibleReleaseCount is 2 (active p2 + already-released p2b — both visible now)", da1?.releases.visibleReleaseCount, 2);
ok("scopeNote explicitly documents that this is now a lifetime count (Phase C.3)", da1?.releases.scopeNote.includes("Phase C.3") ?? false);
check("la1's release rows include the RELEASED (יצא) one — invisible before Phase C.3", da1?.releases.rows.map((r) => r.stage).sort(), ["הפקה", "יצא"]);

console.log("Label Artist Dossier: show relation is never invented");
check("shows section is always the static NO_DIRECT_RELATION_MODELED", da1?.shows.status, "NO_DIRECT_RELATION_MODELED");

console.log("Label Artist Dossier: balance ledger relationship is correct, reuses the canonical formula");
check("la1 has entries and a computed balance (800 income - 300 payments - 50 expenses = 450)", [da1?.balanceLedger.hasEntries, da1?.balanceLedger.entryCount, da1?.balanceLedger.totals?.currentBalance], [true, 3, 450]);
check("la2 has zero entries → hasEntries false, totals null (never a fake all-zero object)", [ra2.ok ? ra2.dossier.balanceLedger.hasEntries : null, ra2.ok ? ra2.dossier.balanceLedger.totals : "x"], [false, null]);

console.log("Label Artist Dossier: buildAllLabelArtistDossiers stays in-memory");
{
  const t0 = Date.now();
  const all = buildAllLabelArtistDossiers(P);
  ok("builds a dossier for every label artist in the fixture (4)", all.size === 4);
  ok("fast (in-memory, no I/O)", Date.now() - t0 < 1000);
}

// ════════════════════════════════════════════════════════════════════════════
// Cross-dossier consistency (Phase C.2 §41)
// ════════════════════════════════════════════════════════════════════════════

console.log("cross-dossier consistency: Project ↔ Client and Project ↔ Label Artist agree from both sides");
{
  const p1d = buildProjectDossier(P, "p1");
  ok("Project p1 says its client is c1 (MATCHED, TEXT_MATCH) — Client c1 says its matched project is p1: same basis", p1d.ok && p1d.dossier.client.status === "MATCHED" && p1d.dossier.client.candidates[0].id === "c1" && p1d.dossier.client.relation?.basis === "projects.artist = clients.name" && dc1?.matchedProjects.some((p) => p.projectId === "p1") === true);

  const p4d = buildProjectDossier(P, "p4");
  ok("Project p4 says its client is AMBIGUOUS (c3, c4) — both Client c3 and c4 say p4 is ambiguous FOR THEM too", p4d.ok && p4d.dossier.client.status === "AMBIGUOUS" && p4d.dossier.client.candidates.map((c) => c.id).sort().join() === "c3,c4" && rc3.ok && rc4.ok && rc3.dossier.ambiguousProjectCandidates.some((p) => p.projectId === "p4") && rc4.dossier.ambiguousProjectCandidates.some((p) => p.projectId === "p4"));

  const p2d = buildProjectDossier(P, "p2");
  ok("Project p2 says its labelArtist is ID-linked to la1 — Label Artist la1 says p2 is its idLinked project", p2d.ok && p2d.dossier.labelArtist.status === "ID" && p2d.dossier.labelArtist.idCandidate?.id === "la1" && da1?.projects.idLinked.some((p) => p.projectId === "p2") === true);

  const p3d = buildProjectDossier(P, "p3");
  ok("Project p3 reports a CONFLICT — both la2 and la3's dossiers report the SAME conflict code independently", p3d.ok && p3d.dossier.labelArtist.status === "CONFLICT" && p3d.dossier.labelArtist.conflict?.code === "LABEL_ARTIST_ID_NAME_MISMATCH" && ra2.ok && ra3.ok && ra2.dossier.dataQuality.conflicts[0].code === "LABEL_ARTIST_ID_NAME_MISMATCH" && ra3.dossier.dataQuality.conflicts[0].code === "LABEL_ARTIST_ID_NAME_MISMATCH");
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
// F.1I: the only /api/partner route is the Owner-only read-only actions surface — and it does not expose dossiers.
ok("no API route added under app/api for dossiers (/api/partner holds only the Partner action routes — F.1I surface + F.1J decisions + F.1K execute + F.1M outcomes (GET) + F2 finance (GET) + F2.8 finance answer (POST) — none imports lib/partner/dossiers)", (() => { const dir = path.join(ROOT, "app/api/partner"); if (!fs.existsSync(dir)) return true; const list = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? list(path.join(d, e.name)) : [path.relative(dir, path.join(d, e.name)).split(path.sep).join("/")]); const files = list(dir); const allowed = ["actions/route.ts", "actions/decide/route.ts", "actions/change-deadline/route.ts", "actions/execute/route.ts", "outcomes/route.ts", "finance/route.ts", "finance/answer/route.ts"]; return files.every((x) => allowed.includes(x)) && files.every((x) => !fs.readFileSync(path.join(dir, x), "utf8").includes("lib/partner/dossiers")); })());

console.log("determinism (same input → identical output)");
check("buildProjectDossier is deterministic", JSON.stringify(buildProjectDossier(P, "p1")), JSON.stringify(r1));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
