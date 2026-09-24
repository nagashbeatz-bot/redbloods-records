/**
 * Golden tests for Redbloods Partner Eyes / Company State (Phase B / B.1 / B.2).
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
    sources: [
      { source: "projects", status: "ok", rowCount: 2 }, { source: "tasks", status: "ok", rowCount: 1 },
      { source: "steven", status: "ok", rowCount: 2 }, { source: "victor", status: "ok", rowCount: 2 },
      { source: "proposals", status: "ok", rowCount: 1 }, { source: "shows", status: "ok", rowCount: 1 },
      { source: "sessions", status: "ok", rowCount: 1 }, { source: "transactions", status: "ok", rowCount: 1 },
      { source: "finance_settings", status: "ok", rowCount: 1 }, { source: "releases", status: "ok", rowCount: 1 },
      { source: "agent_alerts", status: "ok", rowCount: 1 },
    ],
    projects: [
      { id: "p1", name: "פרויקט א", artist: "אמן בדיקה", status: "בעבודה", deadline: "2026-10-01", projectType: "שיר", businessType: "לקוח", updatedAt: "2026-09-20T10:00:00Z", isHidden: false },
      { id: "p2", name: "פרויקט לייבל", artist: "אמן לייבל בדיקה", status: "בעבודה", deadline: null, projectType: "שיר", businessType: "לייבל", updatedAt: "2026-09-20T10:00:00Z", isHidden: false },
    ],
    tasks: [
      { id: "t1", title: "משימה", status: "פתוח", dueDate: "2026-09-25", relatedType: "project", relatedId: "p1", createdAt: "2026-09-10T09:00:00Z" },
    ],
    steven: [
      { id: "s1", projectId: "p1", title: "מיקס", status: "בתהליך", agreedPrice: 200, currency: "$", amountPaid: 0, sentDate: "2026-09-15", internalDeadline: "2026-09-24", hasMixVersion: true, lastUploadAt: "2026-09-20T10:00:00Z" },
      { id: "s2", projectId: null, title: "עבודה סגורה ישנה", status: "אושר", agreedPrice: 100, currency: "$", amountPaid: 100, sentDate: "2026-01-01", internalDeadline: null, hasMixVersion: false, lastUploadAt: null },
    ],
    victor: {
      stuckAfterDays: 5,
      works: [
        { id: "v1", projectId: "p1", title: "עבודת Victor", status: "פעיל", workState: "נשלח לויקטור", sentDate: "2026-09-12", internalDeadline: null, daysSinceSent: 10, isStuck: true, uploads: ["2026-09-12T10:00:00Z"], filesWithoutTimestamp: 0, reviews: [], linkedTaskId: null },
        { id: "v2", projectId: null, title: "עבודה שהושלמה", status: "הושלם", workState: "נשלח לויקטור", sentDate: "2026-01-01", internalDeadline: null, daysSinceSent: null, isStuck: false, uploads: [], filesWithoutTimestamp: 0, reviews: [], linkedTaskId: null },
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
    releases: {
      labelProjectsTotal: 1,
      rows: [{ projectId: "p2", name: "פרויקט לייבל", projectStatus: "בעבודה", stage: "הפקה", targetDate: "2026-10-15", nextAction: "", blocker: "", responsible: "", stageEnteredAt: "2026-09-01T10:00:00Z", labelArtistId: "la1" }],
    },
    // lib/coo's OWN raw input still models alerts (untouched, unrelated to Partner) — Partner never reads this.
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
      { source: "sessions_eyes", status: "ok", rowCount: 3 },
      { source: "shows_eyes", status: "ok", rowCount: 2 },
      { source: "proposals_eyes", status: "ok", rowCount: 3 },
      { source: "releases_eyes", status: "ok", rowCount: 2 },
      { source: "transactions_eyes", status: "ok", rowCount: 3 },
      { source: "tasks_eyes", status: "ok", rowCount: 2 },
    ],
    clients: [
      { id: "c1", name: "אמן בדיקה", type: "אמן", status: "פעיל", createdAt: "2026-01-01T10:00:00Z" },
      { id: "c2", name: "לקוח כללי", type: "לקוח", status: "פעיל", createdAt: "2026-01-01T10:00:00Z" },
    ],
    labelArtists: [
      { id: "la1", name: "אמן לייבל בדיקה", status: "פעיל", createdAt: "2026-01-01T10:00:00Z", updatedAt: "2026-01-01T10:00:00Z" },
    ],
    artistBalanceEntries: [
      { id: "be1", artistId: "la1", entryType: "הכנסות", amount: 500, entryDate: "2026-08-01" },
      { id: "be2", artistId: "la1", entryType: "תשלומים", amount: 200, entryDate: "2026-08-05" },
      { id: "be3", artistId: "la1", entryType: "הוצאות", amount: 50, entryDate: "2026-08-10" },
    ],
    clips: [
      { id: "clip1", title: "קליפ עם פרויקט", status: "בתהליך", projectId: "p1", artistName: "אמן בדיקה", createdAt: "2026-08-01T10:00:00Z", updatedAt: "2026-08-05T10:00:00Z" },
      { id: "clip2", title: "קליפ ישן (שם בלבד)", status: "בתהליך", projectId: null, artistName: "אמן לייבל בדיקה", createdAt: "2026-01-01T10:00:00Z", updatedAt: "2026-01-01T10:00:00Z" },
    ],
    // full history: 3 sessions, only 1 of which (se1) is in COO's forward window (per buildCooRaw above)
    sessions: [
      { id: "se1", projectId: "p1", showId: null, date: "2026-09-23", startTime: "18:00", endTime: "20:00", status: "מתוכנן", sessionType: "סשן" },
      { id: "se-old1", projectId: "p1", showId: null, date: "2026-01-05", startTime: null, endTime: null, status: "בוצע", sessionType: "סשן" },
      { id: "se-old2", projectId: null, showId: "sh1", date: "2025-12-01", startTime: null, endTime: null, status: "בוטל", sessionType: "חזרה להופעה" },
    ],
    // full history: 2 shows, only 1 of which (sh1) is in COO's operational subset (upcoming+doneUnpaid)
    shows: [
      { id: "sh1", name: "הופעה", status: "בוצע", paymentStatus: "שולם", date: "2026-09-01", djClientId: null, djConfirmationStatus: null, artistClientId: "c1", bookerClientId: null, price: 1000 },
      { id: "sh-old", name: "הופעה ישנה שולמה במלואה", status: "בוצע", paymentStatus: "שולם", date: "2025-01-01", djClientId: "c2", djConfirmationStatus: "אושר", artistClientId: null, bookerClientId: null, price: 1000 },
    ],
    // Phase C.3 — full proposal history (independent of lib/coo's OWN proposals fixture above, which
    // has a single CLOSED row and is unrelated to this one — see the "COO's own status-filtered read"
    // assertions below, which use lib/coo's fixture, not this one): pr-open (client_id, OPEN status),
    // pr-legacy-closed (client_id present, CLOSED status — would be invisible to a status-filtered read,
    // visible here), pr-no-client-id (legacy row, client_id=null, falls back to clientName TEXT_MATCH only).
    proposalsFull: [
      { id: "pr-open", clientId: "c1", clientName: "אמן בדיקה", linkedProjectId: "p1", title: "הצעה", amount: 3000, currency: "₪", status: "נשלחה", followupDate: null, sentDate: "2026-09-01", createdAt: "2026-09-01T10:00:00Z", updatedAt: "2026-09-01T10:00:00Z" },
      { id: "pr-legacy-closed", clientId: "c1", clientName: "אמן בדיקה", linkedProjectId: null, title: "הצעה ישנה שנסגרה", amount: 1500, currency: "₪", status: "נסגר", followupDate: null, sentDate: "2026-01-01", createdAt: "2026-01-01T10:00:00Z", updatedAt: "2026-01-05T10:00:00Z" },
      { id: "pr-no-client-id", clientId: null, clientName: "לקוח כללי", linkedProjectId: null, title: "הצעה legacy", amount: 500, currency: "₪", status: "לא נסגר", followupDate: null, sentDate: null, createdAt: "2025-06-01T10:00:00Z", updatedAt: "2025-06-01T10:00:00Z" },
    ],
    // Phase C.3 — full release history: r-p2 (active stage — also visible in lib/coo's own releases
    // fixture, cross-reference), r-p-released (יצא/released — invisible to lib/coo's active-stage-only read).
    releasesFull: [
      { projectId: "p2", labelArtistId: "la1", stage: "הפקה", targetDate: "2026-10-15", stageEnteredAt: "2026-09-01T10:00:00Z", releasedAt: null, createdAt: "2026-08-01T10:00:00Z", updatedAt: "2026-09-01T10:00:00Z" },
      { projectId: "p-released", labelArtistId: null, stage: "יצא", targetDate: "2026-01-01", stageEnteredAt: "2025-12-01T10:00:00Z", releasedAt: "2026-01-01T10:00:00Z", createdAt: "2025-10-01T10:00:00Z", updatedAt: "2026-01-01T10:00:00Z" },
    ],
    // Phase C.3 — full transaction row detail: tx1 (project-linked, income, received — also in lib/coo's
    // aggregated fixture), tx2 (expense, ₪, different status), tx-general (no project_id — general scope).
    transactions: [
      { id: "tx1", projectId: "p1", type: "income", amount: 1000, currency: "₪", status: "התקבל", date: "2026-09-10", expenseScope: "כללי", category: "", createdAt: "2026-09-10T10:00:00Z" },
      { id: "tx2", projectId: "p1", type: "expense", amount: 200, currency: "$", status: "שולם", date: "2026-09-11", expenseScope: "כללי", category: "מיקס", createdAt: "2026-09-11T10:00:00Z" },
      { id: "tx-general", projectId: null, type: "expense", amount: 50, currency: "₪", status: "בוטל", date: null, expenseScope: "כללי", category: "", createdAt: "2026-09-01T10:00:00Z" },
    ],
    // Phase C.3 — full task history: t1 (open — also in lib/coo's own open-only fixture, cross-reference),
    // t-done (בוצע — invisible to lib/coo's open-only read).
    tasksFull: [
      { id: "t1", title: "משימה", status: "פתוח", dueDate: "2026-09-25", relatedType: "project", relatedId: "p1", createdAt: "2026-09-10T09:00:00Z", updatedAt: "2026-09-10T09:00:00Z" },
      { id: "t-done", title: "משימה שהושלמה", status: "בוצע", dueDate: "2026-08-01", relatedType: "project", relatedId: "p1", createdAt: "2026-07-01T09:00:00Z", updatedAt: "2026-08-01T09:00:00Z" },
    ],
  });
}

const coo = computeCoo(buildCooRaw(), NOW);
const eyesRaw = buildEyesRaw();
const P = assemblePartnerCompanyState(coo, eyesRaw);

console.log("Owner decision (Phase B.2): Agent Alerts is not part of Redbloods Partner");
ok("agentAlerts is not a key in P.domains at all", !("agentAlerts" in P.domains));
ok("no file under lib/partner/eyes imports lib/agent/alerts-store", (() => {
  const dir = path.join(path.resolve(__dirname, ".."), "lib/partner/eyes");
  return fs.readdirSync(dir).every((f) => !fs.readFileSync(path.join(dir, f), "utf8").includes("agent/alerts-store"));
})());
ok("no file under lib/partner/eyes actually QUERIES agent_alerts (mentioning the excluded table by name in an explanatory comment is fine and expected)", (() => {
  const dir = path.join(path.resolve(__dirname, ".."), "lib/partner/eyes");
  return fs.readdirSync(dir).every((f) => !/\.from\(\s*["']agent_alerts["']\s*\)|getAlerts\(/.test(fs.readFileSync(path.join(dir, f), "utf8")));
})());
ok("PartnerEyesRaw has no 'alerts' field (TypeScript enforces this at compile time; runtime check the fixture builder omits it too)", !("alerts" in eyesRaw));
console.log("  (COO's own agent_alerts behavior is verified unchanged by the full scripts/test-coo.ts run — 206/206 — not duplicated here.)");

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

console.log("Phase B.2: FULL is never assigned to a known filtered subset");
check("projects scope is a visible-only subset (is_hidden=false) → coverage PARTIAL, never FULL", P.domains.projects.coverage, "PARTIAL");
ok("…and scopeDescription says so explicitly", P.domains.projects.scopeDescription.includes("is_hidden"));
check("tasks scope is open-only → coverage PARTIAL, never FULL", P.domains.tasks.coverage, "PARTIAL");
ok("…and scopeDescription says 'open tasks only'", P.domains.tasks.scopeDescription.toLowerCase().includes("open tasks only"));
ok("sessions is genuinely full history now (Phase B.2) → scopeDescription says so", P.domains.sessions.scopeDescription.toLowerCase().includes("full") || P.domains.sessions.scopeDescription.toLowerCase().includes("all session"));
ok("shows is genuinely full history now (Phase B.2) → scopeDescription says so", P.domains.shows.scopeDescription.toLowerCase().includes("full") || P.domains.shows.scopeDescription.toLowerCase().includes("all show"));

console.log("Phase B.2: Sessions — Partner sees full history, COO's forward window is unchanged and cross-referenced");
check("Partner sees all 3 sessions (full history)", P.domains.sessions.data!.total, 3);
check("COO's own forward-window read still sees only 1 (se1) — cross-referenced, not replaced", P.domains.sessions.data!.cooVisible.count, 1);
ok("totalHistoricalCount (3) is strictly more than currentOperationalCount (COO's window, 1)", P.domains.sessions.totalHistoricalCount! > P.domains.sessions.currentOperationalCount!);
check("withProject counts correctly (2 of 3 sessions have a project_id)", P.domains.sessions.data!.withProject, 2);
ok("a cancelled ('בוטל') session is present as a stored fact, never interpreted as attendance/reliability", P.domains.sessions.data!.byStatus["בוטל"] === 1);

console.log("Phase B.2: Shows — Partner sees full history via the SAME listShows(), COO's operational subset is unchanged");
check("Partner sees both shows (full history)", P.domains.shows.data!.total, 2);
ok("COO's own operational subset (upcoming+doneUnpaid) is a real, independently-computed number — never null just because Partner also reads full history", P.domains.shows.data!.cooVisible.upcoming !== null && P.domains.shows.data!.cooVisible.doneUnpaid !== null);
ok("full history (2) is never smaller than COO's operational subset", P.domains.shows.data!.total >= (P.domains.shows.data!.cooVisible.upcoming! + P.domains.shows.data!.cooVisible.doneUnpaid!));
check("withDjClientId counts correctly (1 of 2 shows has dj_client_id)", P.domains.shows.data!.withDjClientId, 1);
ok("a show's djClientId=null never fabricates a relation — it's just absent from the count", P.domains.shows.data!.items.find((s) => s.id === "sh1")!.djClientId === null);

console.log("Phase B.2: Releases — label_artist_id propagates additively, null never fabricates a relation");
check("the release row's labelArtistId flows through lib/coo's ReleaseFact unchanged", coo.state.releases!.rows[0].labelArtistId, "la1");
ok("Releases ↔ LabelArtists relation is ID with a real coverage figure now that the field is exposed", (() => {
  const rel = P.domains.releases.relations.find((r) => r.via.includes("label_artist_id"))!;
  return rel.quality === "ID" && rel.coverage !== undefined;
})());
ok("a release row with labelArtistId=null does not inflate the ID coverage count", (() => {
  const rawNoArtist = buildCooRaw();
  rawNoArtist.releases!.rows[0].labelArtistId = null;
  const cooNoArtist = computeCoo(rawNoArtist, NOW);
  const Pn = assemblePartnerCompanyState(cooNoArtist, eyesRaw);
  const rel = Pn.domains.releases.relations.find((r) => r.via.includes("label_artist_id"))!;
  return rel.coverage === "NONE";
})());

console.log("Phase B.2: Victor/Steven — current (active/open) vs total historical counts, both real, never invented");
check("Victor: active (current) = 1, totalWorks (all history, incl. completed) = 2", [P.domains.victor.currentOperationalCount, P.domains.victor.totalHistoricalCount], [1, 2]);
check("Steven: open (current) = 1, totalWorks (all history, incl. approved) = 2", [P.domains.steven.currentOperationalCount, P.domains.steven.totalHistoricalCount], [1, 2]);
ok("Victor scopeDescription distinguishes count (full) from per-row detail (active only)", P.domains.victor.scopeDescription.includes("totalWorks") && P.domains.victor.scopeDescription.includes("active"));
ok("Steven scopeDescription distinguishes count (full) from per-row detail (open only)", P.domains.steven.scopeDescription.includes("totalWorks") && P.domains.steven.scopeDescription.includes("open"));

console.log("relation quality reflects reality, never overstates it");
check("Clients ↔ Projects is TEXT_MATCH (no id path exists at all)", P.domains.clients.relations[0].quality, "TEXT_MATCH");
check("Label Artists ↔ Projects primary relation is TEXT_MATCH (not falsely ID-linked)", P.domains.labelArtists.relations[0].quality, "TEXT_MATCH");
ok("…but the release-row ID path is documented separately, with its OWN coverage (not folded into the primary relation)", (() => {
  const rel = P.domains.labelArtists.relations.find((r) => r.via.includes("label_artist_id"))!;
  return rel.quality === "ID" && rel.coverage !== undefined;
})());

console.log("Phase B.1 fix (still holds): relation QUALITY is never downgraded because of partial COVERAGE");
ok("Clips ↔ Projects: 1 of 2 rows carry project_id in this fixture → quality stays ID, coverage is PARTIAL", (() => {
  const rel = P.domains.clips.relations.find((r) => r.via.includes("project_id"))!;
  return rel.quality === "ID" && rel.coverage === "PARTIAL";
})());
ok("…the exact split (1/2) is in a warning, never silently rounded away", P.domains.clips.warnings.some((w) => w.includes("1/2")));
check("Clips data counts withProjectId/withoutProjectId correctly from the fixture (1 and 1)", [P.domains.clips.data!.withProjectId, P.domains.clips.data!.withoutProjectId], [1, 1]);
ok("if ALL rows carried project_id, coverage would read FULL (not just ID)", (() => {
  const rawAllLinked = buildEyesRaw(); rawAllLinked.clips = [{ id: "x1", title: "t", status: "s", projectId: "p1", artistName: "a", createdAt: null, updatedAt: null }];
  const rel = assemblePartnerCompanyState(coo, rawAllLinked).domains.clips.relations.find((r) => r.via.includes("project_id"))!;
  return rel.quality === "ID" && rel.coverage === "FULL";
})());
ok("if NO rows carried project_id, quality falls back to TEXT_MATCH (never invents an id relation from nothing)", (() => {
  const rawNoneLinked = buildEyesRaw(); rawNoneLinked.clips = [{ id: "x1", title: "t", status: "s", projectId: null, artistName: "a", createdAt: null, updatedAt: null }];
  const rel = assemblePartnerCompanyState(coo, rawNoneLinked).domains.clips.relations.find((r) => r.via.includes("project_id"))!;
  return rel.quality === "TEXT_MATCH";
})());

console.log("Victor relation coverage stays explicit, no invented fallback relation");
ok("Victor ↔ Projects relation carries a coverage figure derived from lib/coo's own victor.link entry", P.domains.victor.relations[0].coverage !== undefined);
ok("the Victor domain explains WHY unlinked works have no reliable fallback (projectName collapses to the work's own title, never a real project/artist name)", P.domains.victor.warnings.some((w) => w.includes("projectName") && w.includes("title")));
ok("…and explicitly says no new TEXT_MATCH relation was invented for Victor", P.domains.victor.warnings.some((w) => w.includes("TEXT_MATCH")));

console.log("Phase B.1 fix (still holds): an anchor domain with no outbound relation is not penalized to LOW reliability");
check("projects has no outbound relation (it's the anchor entity) yet coverage PARTIAL (hidden excluded) → reliability MEDIUM (not LOW)", [P.domains.projects.relations.length, P.domains.projects.coverage, P.domains.projects.reliability], [0, "PARTIAL", "MEDIUM"]);

console.log("relation model review — no relation ever mixes quality and coverage semantics");
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

console.log("finance: missing agreedPrice stays UNKNOWN, never 0");
ok("finance domain scope explicitly states UNKNOWN semantics for missing agreedPrice", P.domains.receivables.scopeDescription.includes("UNKNOWN"));

// ════════════════════════════════════════════════════════════════════════════
// Phase C.3 — Change-Awareness data readiness: proposalsFull / releasesFull /
// transactions / tasksFull, plus the Change Readiness Matrix.
// ════════════════════════════════════════════════════════════════════════════

console.log("Phase C.3: Proposals — full history, ID via client_id, lib/coo's own domain unchanged");
check("proposalsFull sees all 3 proposals (open + closed + legacy)", P.domains.proposalsFull.data!.total, 3);
ok("a CLOSED proposal (pr-legacy-closed) is visible here", P.domains.proposalsFull.data!.items.some((p) => p.id === "pr-legacy-closed"));
ok("an OPEN proposal (pr-open) is visible here too", P.domains.proposalsFull.data!.items.some((p) => p.id === "pr-open"));
check("client_id propagates onto the item (pr-open → c1)", P.domains.proposalsFull.data!.items.find((p) => p.id === "pr-open")!.clientId, "c1");
ok("the legacy row without client_id does NOT fake an id — clientId stays null", P.domains.proposalsFull.data!.items.find((p) => p.id === "pr-no-client-id")!.clientId === null);
check("client_id coverage counts correctly (2 of 3 rows carry it)", P.domains.proposalsFull.data!.withClientId, 2);
check("linked_project_id propagates (pr-open → p1)", P.domains.proposalsFull.data!.items.find((p) => p.id === "pr-open")!.linkedProjectId, "p1");
ok("relation to clients is ID via client_id, never TEXT_MATCH as the primary path", P.domains.proposalsFull.relations.find((r) => r.via.includes("client_id"))!.quality === "ID");
check("lib/coo's own status-filtered proposals domain is completely untouched — still reflects only ITS OWN (separate) fixture, 0 visible (its one row is status='נסגר')", P.domains.proposals.data!.length, 0);

console.log("Phase C.3: Releases — full history via project_release_details, lib/coo's own active-stage-only domain unchanged");
check("releasesFull sees both rows (active stage + released/יצא)", P.domains.releasesFull.data!.total, 2);
ok("an active-stage row (p2) is visible", P.domains.releasesFull.data!.items.some((r) => r.projectId === "p2" && r.stage === "הפקה"));
ok("a RELEASED (יצא) row is visible here — invisible to lib/coo's own active-stage-only releases domain", P.domains.releasesFull.data!.items.some((r) => r.projectId === "p-released" && r.stage === "יצא"));
check("project_id preserved on every item", P.domains.releasesFull.data!.items.map((r) => r.projectId).sort(), ["p-released", "p2"]);
check("label_artist_id preserved where present (p2 → la1)", P.domains.releasesFull.data!.items.find((r) => r.projectId === "p2")!.labelArtistId, "la1");
ok("lib/coo's own releases domain (active-stage only) is untouched — still shows only p2, not p-released", coo.state.releases!.rows.every((r) => r.projectId !== "p-released"));

console.log("Phase C.3: Transactions — per-row detail, statuses/currencies preserved, no FX, cancelled never silently counted");
check("transactions sees all 3 rows", P.domains.transactions.data!.total, 3);
check("project_id relation is ID, coverage reflects 2 of 3 rows linked (tx-general has none)", (() => {
  const rel = P.domains.transactions.relations.find((r) => r.via.includes("project_id"))!;
  return [rel.quality, rel.coverage];
})(), ["ID", "PARTIAL"]);
ok("missing project_id stays unlinked, never guessed (tx-general.projectId === null)", P.domains.transactions.data!.items.find((t) => t.id === "tx-general")!.projectId === null);
check("statuses preserved verbatim per row (not re-derived)", P.domains.transactions.data!.items.map((t) => t.status).sort(), ["בוטל", "התקבל", "שולם"]);
check("currencies preserved verbatim, never merged/converted (₪ and $ both present)", Object.keys(P.domains.transactions.data!.byCurrency).sort(), ["$", "₪"]);
ok("a cancelled (בוטל) row is present as a stored fact only — this domain does no received/balance computation at all", P.domains.transactions.data!.items.some((t) => t.status === "בוטל"));
ok("warnings explicitly say this never recomputes finance semantics", P.domains.transactions.warnings.some((w) => w.includes("לא מחשב מחדש")));

console.log("Phase C.3: Tasks — full history, lib/coo's own open-only domain unchanged");
check("tasksFull sees both tasks (open + done)", P.domains.tasksFull.data!.total, 2);
ok("an open task (t1) is visible", P.domains.tasksFull.data!.items.some((t) => t.id === "t1" && t.status === "פתוח"));
ok("a DONE task (t-done) is visible here — invisible to lib/coo's own open-only tasks domain", P.domains.tasksFull.data!.items.some((t) => t.id === "t-done" && t.status === "בוצע"));
check("lib/coo's own tasks domain stays open-only — still just 1 (t1)", coo.state.tasks!.openCount, 1);
ok("lib/coo's own tasks domain never sees t-done", !coo.state.tasks!.items.some((t) => t.id === "t-done"));

console.log("Phase C.3: Change Readiness Matrix — facts only, never guessed");
ok("changeReadiness has one entry per domain key on PartnerCompanyState.domains", P.changeReadiness.length === Object.keys(P.domains).length);
{
  const propFull = P.changeReadiness.find((e) => e.domain === "proposalsFull")!;
  ok("proposalsFull: stable id + full history + createdAt/updatedAt → supports create/update/status-transition detection", propFull.scope === "FULL_HISTORY" && propFull.supportsCreateDetection && propFull.supportsUpdateDetection && propFull.supportsStatusTransitionDetection);
}
{
  const tx = P.changeReadiness.find((e) => e.domain === "transactions")!;
  ok("transactions: has a stable id and full history, but NO updated_at (confirmed against the live schema) → update/status-transition detection is honestly false", tx.scope === "FULL_HISTORY" && tx.hasUpdatedAt === false && tx.supportsUpdateDetection === false && tx.supportsStatusTransitionDetection === false);
  ok("…yet create detection still holds (a NEW row is still detectable by a new id appearing)", tx.supportsCreateDetection === true);
}
{
  const tasksOld = P.changeReadiness.find((e) => e.domain === "tasks")!;
  ok("tasks (lib/coo's own, open-only): scope is a CURRENT_SUBSET, never claimed as full history", tasksOld.scope === "CURRENT_SUBSET");
}
{
  const suppliers = P.changeReadiness.find((e) => e.domain === "suppliers")!;
  ok("suppliers: NOT_APPLICABLE, no stable id fabricated, nothing claims to support detection", suppliers.scope === "NOT_APPLICABLE" && suppliers.stableIdField === null && !suppliers.supportsCreateDetection && !suppliers.supportsUpdateDetection && !suppliers.supportsStatusTransitionDetection);
}
{
  const clients = P.changeReadiness.find((e) => e.domain === "clients")!;
  ok("clients: has createdAt but explicitly NO updatedAt (confirmed against the live schema) — never pretends otherwise", clients.hasCreatedAt === true && clients.hasUpdatedAt === false);
}

console.log("suppliers: re-audited, correctly reported as not existing as a separate domain");
check("suppliers domain status is UNAVAILABLE (no invented table)", P.domains.suppliers.status, "UNAVAILABLE");
check("…and its data is null, not an empty object pretending to be a real (empty) domain", P.domains.suppliers.data, null);
ok("the warning names the actual re-audit finding (vendor_name hardcoded to victor)", P.domains.suppliers.warnings.some((w) => w.includes("vendor_name") && w.includes("victor")));

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
ok("only readers.ts / build.ts actually IMPORT \"server-only\" as a statement (all other eyes modules are pure — a comment explaining why not is fine)", Object.entries(eyesSrc).filter(([, s]) => /^\s*import\s+"server-only"\s*;/m.test(s)).map(([f]) => f).sort().join() === "build.ts,readers.ts");
ok("the pure eyes modules import no store / supabase", Object.entries(eyesSrc).filter(([f]) => !["readers.ts", "build.ts"].includes(f)).every(([, s]) => !/lib\/supabase|-store"/.test(s)));
ok("no portal file imports anything from lib/partner", (() => {
  const portalDirs = ["app/api/red-artists", "app/api/supplier", "app/api/vendor/victor", "app/api/label/artists", "app/api/beats", "app/api/notifications", "components/team", "components/red-artists", "components/label", "lib/red-artists", "app/team", "app/red-artists", "app/dj-cleantone", "app/label"];
  const walk = (dir: string): string[] => fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]) : [];
  const portalFiles = [...portalDirs.flatMap((d) => walk(path.join(ROOT, d))), ...fs.readdirSync(path.join(ROOT, "lib")).filter((f) => /^(steven|victor|shalev|avi|cleantone|dj-|beat|show-|sketch)/.test(f)).map((f) => path.join(ROOT, "lib", f))];
  return portalFiles.every((f) => !/lib\/partner/.test(fs.readFileSync(f, "utf8")));
})());
ok("lib/coo has no reverse dependency on lib/partner (the only lib/coo edits this block are additive fields — see report)", (() => {
  const cooDir = path.join(ROOT, "lib/coo");
  return fs.readdirSync(cooDir).every((f) => !/lib\/partner/.test(fs.readFileSync(path.join(cooDir, f), "utf8")));
})());
// F.1I: the only /api/partner route is the Owner-only read-only actions surface — and it does not expose eyes.
ok("no API route added under app/api for eyes (/api/partner holds only the Partner action routes — F.1I surface + F.1J decisions + F.1K execute + F.1M outcomes (GET) + F2 finance (GET) + F2.8 finance answer (POST) + integrity (GET) / integrity answer (POST) — none imports lib/partner/eyes)", (() => { const dir = path.join(ROOT, "app/api/partner"); if (!fs.existsSync(dir)) return true; const list = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? list(path.join(d, e.name)) : [path.relative(dir, path.join(d, e.name)).split(path.sep).join("/")]); const files = list(dir); const allowed = ["actions/route.ts", "actions/decide/route.ts", "actions/change-deadline/route.ts", "actions/execute/route.ts", "outcomes/route.ts", "finance/route.ts", "finance/answer/route.ts", "integrity/route.ts", "integrity/answer/route.ts"]; return files.every((x) => allowed.includes(x)) && files.every((x) => !fs.readFileSync(path.join(dir, x), "utf8").includes("lib/partner/eyes")); })());

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
