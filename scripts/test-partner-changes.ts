/**
 * Golden tests for Redbloods Partner — Change Engine (Phase D.1).
 *
 * Run with:   npx tsx scripts/test-partner-changes.ts
 *
 * Pure module: no Supabase, no network, no LLM, no persistence (D.2/D.3 not
 * exercised here). Builds PartnerCompanyState fixtures through the REAL
 * computeCoo() + assemblePartnerCompanyState() pipeline (same engine
 * production uses), then through buildPartnerChangeSnapshot() and
 * comparePartnerChangeSnapshots() — never a mock of any of them. Edge-case
 * safety tests (source failure, scope change, coverage change, incompatible
 * schema, missing id) construct PartnerChangeSnapshot values directly, since
 * those are properties of the comparator itself, not of any one domain's
 * real-world data.
 */
import fs from "node:fs";
import path from "node:path";
import { computeCoo } from "../lib/coo/pipeline";
import type { CooRawInput } from "../lib/coo/types";
import { assemblePartnerCompanyState } from "../lib/partner/eyes/company-state";
import type { PartnerEyesRaw } from "../lib/partner/eyes/types";
import { buildPartnerChangeSnapshot } from "../lib/partner/changes/snapshot";
import { comparePartnerChangeSnapshots } from "../lib/partner/changes/compare";
import { CHANGE_SNAPSHOT_SCHEMA_VERSION, type PartnerChangeSnapshot } from "../lib/partner/changes/types";

let pass = 0, fail = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log(`  ✓ ${name}`); pass++; }
  else { console.log(`  ✗ ${name}\n      expected ${e}\n      actual   ${a}`); fail++; }
}
const ok = (name: string, cond: boolean) => { if (cond) { console.log(`  ✓ ${name}`); pass++; } else { console.log(`  ✗ ${name}`); fail++; } };

// ════════════════════════════════════════════════════════════════════════════
// Fixture A — a full PartnerCompanyState, reused as the baseline "previous"
// ════════════════════════════════════════════════════════════════════════════

function buildCooRaw(now: string): CooRawInput {
  return structuredClone<CooRawInput>({
    sources: [
      { source: "projects", status: "ok", rowCount: 2 }, { source: "tasks", status: "ok", rowCount: 1 },
      { source: "steven", status: "ok", rowCount: 1 }, { source: "victor", status: "ok", rowCount: 1 },
      { source: "proposals", status: "ok", rowCount: 1 }, { source: "shows", status: "ok", rowCount: 1 },
      { source: "sessions", status: "ok", rowCount: 1 }, { source: "transactions", status: "ok", rowCount: 1 },
      { source: "finance_settings", status: "ok", rowCount: 1 }, { source: "releases", status: "ok", rowCount: 1 },
      { source: "agent_alerts", status: "ok", rowCount: 0 },
    ],
    projects: [
      { id: "p1", name: "פרויקט א", artist: "אמן בדיקה", status: "בעבודה", deadline: "2026-10-01", projectType: "שיר", businessType: "לקוח", updatedAt: now, isHidden: false },
      { id: "p2", name: "פרויקט לייבל", artist: "אמן לייבל בדיקה", status: "בעבודה", deadline: null, projectType: "שיר", businessType: "לייבל", updatedAt: now, isHidden: false },
    ],
    tasks: [{ id: "t1", title: "משימה", status: "פתוח", dueDate: "2026-09-25", relatedType: "project", relatedId: "p1", createdAt: "2026-09-10T09:00:00Z" }],
    steven: [{ id: "s1", projectId: "p1", title: "מיקס", status: "בתהליך", agreedPrice: 200, currency: "$", amountPaid: 0, sentDate: "2026-09-15", internalDeadline: "2026-09-24", hasMixVersion: false, lastUploadAt: null, createdAt: "2026-09-01T10:00:00Z", updatedAt: "2026-09-01T10:00:00Z" }],
    victor: {
      stuckAfterDays: 5,
      works: [{
        id: "v1", projectId: "p1", title: "עבודת Victor", status: "פעיל", workState: "נשלח לויקטור", sentDate: "2026-09-12",
        internalDeadline: "2026-09-30", daysSinceSent: 10, isStuck: true, uploads: ["2026-09-12T10:00:00Z"], filesWithoutTimestamp: 0,
        reviews: [], reviewEvents: [], linkedTaskId: null, createdAt: "2026-09-01T10:00:00Z", updatedAt: "2026-09-12T10:00:00Z", returnedDate: null,
      }],
    },
    proposals: [{ id: "pr1", clientName: "לקוח א", title: "הצעה", amount: 3000, currency: "₪", status: "נסגר", followupDate: null, linkedProjectId: "p1" }],
    shows: [{ id: "sh1", name: "הופעה", status: "בוצע", paymentStatus: "לא שולם", date: "2026-09-01", price: 2000, advance: 0, incomeTxId: null }],
    sessions: [{ id: "se1", projectId: "p1", date: "2026-09-23", startTime: "18:00", endTime: "20:00", status: "מתוכנן", sessionType: "סשן" }],
    transactions: [{ id: "tx1", projectId: "p1", type: "income", amount: 1000, currency: "₪", status: "צפוי", date: "2026-09-10", expenseScope: "כללי", category: "" }],
    financeSettings: [{ projectId: "p1", agreedPrice: 2000, currency: "₪", financeException: false }],
    orphanFinanceKeyCount: 0,
    releases: { labelProjectsTotal: 1, rows: [{ projectId: "p2", name: "פרויקט לייבל", projectStatus: "בעבודה", stage: "הפקה", targetDate: "2026-10-15", nextAction: "", blocker: "", responsible: "", stageEnteredAt: "2026-09-01T10:00:00Z", labelArtistId: "la1" }] },
    alerts: [],
  });
}

function buildEyesRaw(): PartnerEyesRaw {
  return structuredClone<PartnerEyesRaw>({
    sources: [
      { source: "clients", status: "ok", rowCount: 1 }, { source: "label_artists", status: "ok", rowCount: 1 },
      { source: "clip_productions", status: "ok", rowCount: 1 }, { source: "artist_balance_entries", status: "ok", rowCount: 1 },
      { source: "sessions_eyes", status: "ok", rowCount: 1 }, { source: "shows_eyes", status: "ok", rowCount: 1 },
      { source: "proposals_eyes", status: "ok", rowCount: 1 }, { source: "releases_eyes", status: "ok", rowCount: 1 },
      { source: "transactions_eyes", status: "ok", rowCount: 1 }, { source: "tasks_eyes", status: "ok", rowCount: 1 },
    ],
    clients: [{ id: "c1", name: "אמן בדיקה", type: "אמן", status: "פעיל", createdAt: "2026-01-01T10:00:00Z" }],
    labelArtists: [{ id: "la1", name: "אמן לייבל בדיקה", status: "פעיל", createdAt: "2026-01-01T10:00:00Z", updatedAt: "2026-01-01T10:00:00Z" }],
    artistBalanceEntries: [{ id: "be1", artistId: "la1", entryType: "הכנסות", amount: 500, entryDate: "2026-08-01" }],
    clips: [{ id: "clip1", title: "קליפ", status: "בתהליך", projectId: "p1", artistName: "אמן בדיקה", createdAt: "2026-08-01T10:00:00Z", updatedAt: "2026-08-01T10:00:00Z" }],
    sessions: [{ id: "se1", projectId: "p1", showId: null, date: "2026-09-23", startTime: "18:00", endTime: "20:00", status: "מתוכנן", sessionType: "סשן" }],
    shows: [{ id: "sh1", name: "הופעה", status: "בוצע", paymentStatus: "לא שולם", date: "2026-09-01", djClientId: null, djConfirmationStatus: null, artistClientId: "c1", bookerClientId: null, price: 1000 }],
    proposalsFull: [{ id: "pr1", clientId: "c1", clientName: "אמן בדיקה", linkedProjectId: "p1", title: "הצעה", amount: 3000, currency: "₪", status: "נסגר", followupDate: null, sentDate: "2026-09-01", createdAt: "2026-09-01T10:00:00Z", updatedAt: "2026-09-01T10:00:00Z" }],
    releasesFull: [{ projectId: "p2", labelArtistId: "la1", stage: "הפקה", targetDate: "2026-10-15", stageEnteredAt: "2026-09-01T10:00:00Z", releasedAt: null, createdAt: "2026-08-01T10:00:00Z", updatedAt: "2026-09-01T10:00:00Z" }],
    transactions: [{ id: "tx1", projectId: "p1", type: "income", amount: 1000, currency: "₪", status: "צפוי", date: "2026-09-10", expenseScope: "כללי", category: "", createdAt: "2026-09-10T10:00:00Z" }],
    tasksFull: [{ id: "t1", title: "משימה", status: "פתוח", dueDate: "2026-09-25", relatedType: "project", relatedId: "p1", createdAt: "2026-09-10T09:00:00Z", updatedAt: "2026-09-10T09:00:00Z" }],
  });
}

const NOW_A = new Date("2026-09-22T06:00:00Z");
const NOW_B = new Date("2026-09-23T06:00:00Z");

const cooA = computeCoo(buildCooRaw("2026-09-20T10:00:00Z"), NOW_A);
const eyesA = buildEyesRaw();
const stateA = assemblePartnerCompanyState(cooA, eyesA);
const snapA = buildPartnerChangeSnapshot(stateA);

console.log("schema version is set and stable");
check("snapshot carries the current schema version", snapA.schemaVersion, CHANGE_SNAPSHOT_SCHEMA_VERSION);

console.log("determinism: same input -> identical snapshot");
check("buildPartnerChangeSnapshot is deterministic", JSON.stringify(buildPartnerChangeSnapshot(stateA)), JSON.stringify(snapA));

console.log("identical snapshots -> zero changes");
{
  const r = comparePartnerChangeSnapshots(snapA, snapA);
  check("0 changes", r.changes.length, 0);
  ok("comparable is true", r.comparable);
  check("0 diagnostics", r.diagnostics.length, 0);
}

console.log("capturedAt-only difference (same underlying data, different observation time) -> zero business changes");
{
  const cooA2 = computeCoo(buildCooRaw("2026-09-20T10:00:00Z"), NOW_B); // same raw data, later `now`
  const stateA2 = assemblePartnerCompanyState(cooA2, eyesA);
  const snapA2 = buildPartnerChangeSnapshot(stateA2);
  ok("capturedAt actually differs between the two snapshots (sanity)", snapA.capturedAt !== snapA2.capturedAt);
  const r = comparePartnerChangeSnapshots(snapA, snapA2);
  check("0 changes despite different capturedAt", r.changes.length, 0);
  check("observedBetween window uses the two real capturedAt values", [r.previousCapturedAt, r.currentCapturedAt], [snapA.capturedAt, snapA2.capturedAt]);
}

console.log("reordered arrays -> zero changes (canonical keying by stable id, not array position)");
{
  const cooRawReordered = buildCooRaw("2026-09-20T10:00:00Z");
  cooRawReordered.projects!.reverse();
  cooRawReordered.transactions!.reverse();
  const eyesReordered = buildEyesRaw();
  eyesReordered.proposalsFull!.reverse();
  eyesReordered.releasesFull && eyesReordered.releasesFull.reverse();
  const cooR = computeCoo(cooRawReordered, NOW_A);
  const stateR = assemblePartnerCompanyState(cooR, eyesReordered);
  const snapR = buildPartnerChangeSnapshot(stateR);
  const r = comparePartnerChangeSnapshots(snapA, snapR);
  check("0 changes from array reordering alone", r.changes.length, 0);
}

// ════════════════════════════════════════════════════════════════════════════
// Fixture B — a mutated snapshot: one representative business change per domain
// ════════════════════════════════════════════════════════════════════════════

function buildCooRawB(): CooRawInput {
  const raw = buildCooRaw("2026-09-22T12:00:00Z");
  raw.projects![0].deadline = "2026-11-01"; // p1: DATE_CHANGED (status untouched — stays in COO's 'open' set so deadline stays resolvable)
  raw.projects![1].status = "הושלם"; // p2: STATUS_CHANGED (p2 has no deadline in the fixture, so this is a clean isolated status change)
  raw.steven![0].hasMixVersion = true; // s1: FIELD_CHANGED
  raw.steven![0].lastUploadAt = "2026-09-22T09:00:00Z"; // s1: DATE_CHANGED
  raw.victor!.works[0].workState = "חזר מויקטור"; // v1: STATUS_CHANGED
  raw.victor!.works[0].uploads = [...raw.victor!.works[0].uploads, "2026-09-22T08:00:00Z"]; // v1: NESTED_ITEM_ADDED (upload)
  raw.victor!.works[0].reviewEvents = [{ versionKey: "v2", sentAt: "2026-09-22T09:30:00Z", draft: false }]; // v1: NESTED_ITEM_ADDED (reviewSent)
  return raw;
}

function buildEyesRawB(): PartnerEyesRaw {
  const raw = buildEyesRaw();
  raw.clients![0].status = "לא פעיל"; // c1: STATUS_CHANGED
  raw.proposalsFull![0].status = "אושרה"; // pr1: STATUS_CHANGED
  raw.proposalsFull![0].amount = 3500; // pr1: AMOUNT_CHANGED
  raw.clips![0].status = "הושלם"; // clip1: STATUS_CHANGED
  raw.labelArtists![0].status = "לא פעיל"; // la1: STATUS_CHANGED
  raw.artistBalanceEntries!.push({ id: "be2", artistId: "la1", entryType: "תשלומים", amount: 100, entryDate: "2026-09-20" }); // ENTITY_APPEARED (balanceLedger)
  raw.artistBalanceEntries![0] = { ...raw.artistBalanceEntries![0], amount: 600 }; // be1: AMOUNT_CHANGED
  // The following 5 are ALL Partner-only, eyes-sourced full-history reads (Phase C.3) — separate
  // fixture objects from CooRawInput's own same-named-but-narrower-scope domains above.
  raw.transactions![0] = { ...raw.transactions![0], status: "שולם" }; // tx1: STATUS_CHANGED + DERIVED BECAME_RECEIVED
  raw.tasksFull![0] = { ...raw.tasksFull![0], status: "בוצע" }; // t1: STATUS_CHANGED (lib/coo's own open-only tasks domain is untouched)
  raw.releasesFull![0] = { ...raw.releasesFull![0], stage: "יצא", targetDate: "2026-12-01" }; // p2 release: STATUS_CHANGED (stage) + DATE_CHANGED
  raw.sessions![0] = { ...raw.sessions![0], status: "בוצע" }; // se1: STATUS_CHANGED
  raw.shows![0] = { ...raw.shows![0], paymentStatus: "שולם" }; // sh1: STATUS_CHANGED
  return raw;
}

function buildFinanceSettingsB(raw: CooRawInput): CooRawInput {
  raw.financeSettings![0].agreedPrice = 2500; // p1 finance setting: AMOUNT_CHANGED
  return raw;
}

const cooRawB = buildFinanceSettingsB(buildCooRawB());
const cooB = computeCoo(cooRawB, NOW_B);
const eyesB = buildEyesRawB();
const stateB = assemblePartnerCompanyState(cooB, eyesB);
const snapB = buildPartnerChangeSnapshot(stateB);

const resultAB = comparePartnerChangeSnapshots(snapA, snapB);
const byKey = (domain: string, entityId: string, field: string | null) => resultAB.changes.find((c) => c.domain === domain && c.entityId === entityId && c.field === field);

console.log("Projects: status + deadline changed, both structural FACTs");
ok("p2 status changed", byKey("projects", "p2", "status")?.kind === "STATUS_CHANGED" && byKey("projects", "p2", "status")?.before === "בעבודה" && byKey("projects", "p2", "status")?.after === "הושלם");
ok("p1 deadline changed", byKey("projects", "p1", "deadlineYmd")?.kind === "DATE_CHANGED" && byKey("projects", "p1", "deadlineYmd")?.after === "2026-11-01");

console.log("Clients: status changed, no updated_at anywhere on the entity (schema fact)");
ok("c1 status changed", byKey("clients", "c1", "status")?.before === "פעיל" && byKey("clients", "c1", "status")?.after === "לא פעיל");

console.log("Proposals: status + amount changed, full history (client_id/linked_project_id relations available as fields)");
ok("pr1 status changed", byKey("proposals", "pr1", "status")?.before === "נסגר" && byKey("proposals", "pr1", "status")?.after === "אושרה");
ok("pr1 amount changed", byKey("proposals", "pr1", "amount")?.kind === "AMOUNT_CHANGED" && byKey("proposals", "pr1", "amount")?.before === 3000 && byKey("proposals", "pr1", "amount")?.after === 3500);

console.log("Transactions: structural STATUS_CHANGED + a SEPARATE DERIVED receivedSemantic change, never duplicated as the same field");
ok("tx1 raw status changed (FACT)", (() => { const c = byKey("transactions", "tx1", "status"); return c?.epistemicType === "FACT" && c?.before === "צפוי" && c?.after === "שולם"; })());
ok("tx1 derived receivedSemantic changed (DERIVED), a DIFFERENT field than 'status'", (() => { const c = byKey("transactions", "tx1", "receivedSemantic"); return c?.epistemicType === "DERIVED" && c?.before === "NOT_RECEIVED" && c?.after === "RECEIVED"; })());
ok("exactly one change for field='status' on tx1 (never both STATUS_CHANGED and FIELD_CHANGED for the same field)", resultAB.changes.filter((c) => c.domain === "transactions" && c.entityId === "tx1" && c.field === "status").length === 1);

console.log("Tasks: full-history status change (open -> done), visible even though lib/coo's own tasks stay open-only");
ok("t1 status changed", byKey("tasks", "t1", "status")?.before === "פתוח" && byKey("tasks", "t1", "status")?.after === "בוצע");

console.log("Releases: stage + target date changed (full history, project_id is the stable id)");
ok("p2 release stage changed", byKey("releases", "p2", "stage")?.before === "הפקה" && byKey("releases", "p2", "stage")?.after === "יצא");
ok("p2 release target date changed", byKey("releases", "p2", "targetYmd")?.after === "2026-12-01");

console.log("Sessions: status changed, no fake updated_at timestamp anywhere on the entity");
ok("se1 status changed", byKey("sessions", "se1", "status")?.before === "מתוכנן" && byKey("sessions", "se1", "status")?.after === "בוצע");

console.log("Shows: payment status changed");
ok("sh1 payment status changed", byKey("shows", "sh1", "paymentStatus")?.before === "לא שולם" && byKey("shows", "sh1", "paymentStatus")?.after === "שולם");

console.log("Victor: work_state changed (structural) + delivery upload + owner revision, both as NESTED_ITEM_ADDED with real evidence timestamps");
ok("v1 workState changed", byKey("victor", "v1", "workState")?.before === "נשלח לויקטור" && byKey("victor", "v1", "workState")?.after === "חזר מויקטור");
{
  const upload = resultAB.changes.find((c) => c.domain === "victor" && c.entityId === "v1" && c.field === "upload[2026-09-22T08:00:00Z]");
  ok("new Victor upload recorded as NESTED_ITEM_ADDED with sourceOccurredAt = the real uploadedAt value", !!upload && upload.kind === "NESTED_ITEM_ADDED" && upload.sourceOccurredAt === "2026-09-22T08:00:00Z" && upload.epistemicType === "FACT");
}
{
  const review = resultAB.changes.find((c) => c.domain === "victor" && c.entityId === "v1" && c.field === "reviewSent[v2]");
  ok("new owner revision (version_reviews.sentAt) recorded as NESTED_ITEM_ADDED, identified by version key, not filename/URL", !!review && review.kind === "NESTED_ITEM_ADDED" && review.sourceOccurredAt === "2026-09-22T09:30:00Z");
}
ok("Victor's PRE-EXISTING upload (from A) is never re-reported as added in B", !resultAB.changes.some((c) => c.domain === "victor" && c.field === "upload[2026-09-12T10:00:00Z]"));

console.log("Steven: hasMixVersion flip (false->true) reported as a plain FACT field change — no ball-location inference, no new Steven ball logic");
ok("s1 hasMixVersion changed", byKey("steven", "s1", "hasMixVersion")?.before === false && byKey("steven", "s1", "hasMixVersion")?.after === true);
ok("s1 lastUploadAt changed too, as DATE_CHANGED (not claimed to be an exact causal timestamp beyond the field's own new value)", byKey("steven", "s1", "lastUploadAt")?.kind === "DATE_CHANGED");
ok("no Steven change ever carries a 'ball' field", !JSON.stringify(resultAB.changes.filter((c) => c.domain === "steven")).includes("\"ball\""));

console.log("Clips: status changed");
ok("clip1 status changed", byKey("clips", "clip1", "status")?.before === "בתהליך" && byKey("clips", "clip1", "status")?.after === "הושלם");

console.log("Label Artists: status changed, no investment/momentum/quality score anywhere");
ok("la1 status changed", byKey("labelArtists", "la1", "status")?.before === "פעיל" && byKey("labelArtists", "la1", "status")?.after === "לא פעיל");
ok("no label artist change carries a score/investment/momentum field", !/investmentScore|momentum|quality.*score/i.test(JSON.stringify(resultAB.changes.filter((c) => c.domain === "labelArtists"))));

console.log("Balance Ledger: existing entry amount changed (FACT) + a brand new entry appeared (ENTITY_APPEARED), individually identifiable");
ok("be1 amount changed", byKey("balanceLedger", "be1", "amount")?.before === 500 && byKey("balanceLedger", "be1", "amount")?.after === 600);
ok("be2 (new ledger entry) appeared", resultAB.changes.some((c) => c.domain === "balanceLedger" && c.entityId === "be2" && c.kind === "ENTITY_APPEARED"));

console.log("Project Finance Settings: agreed price changed (via eyes:receivables, priced/non-exception scope)");
ok("p1 agreedPrice changed", byKey("projectFinanceSettings", "p1", "agreedPrice")?.before === 2000 && byKey("projectFinanceSettings", "p1", "agreedPrice")?.after === 2500);

console.log("no HYPOTHESIS anywhere — every change is FACT or DERIVED only");
ok("epistemicType is only ever FACT or DERIVED", resultAB.changes.every((c) => c.epistemicType === "FACT" || c.epistemicType === "DERIVED"));

console.log("determinism + order: identical re-run produces the identical, identically-ordered change list");
{
  const resultAB2 = comparePartnerChangeSnapshots(snapA, snapB);
  check("comparePartnerChangeSnapshots is deterministic (same order too)", JSON.stringify(resultAB2), JSON.stringify(resultAB));
}

console.log("no duplicate change ids in one comparison run");
ok("every change id is unique", new Set(resultAB.changes.map((c) => c.id)).size === resultAB.changes.length);

// ════════════════════════════════════════════════════════════════════════════
// Edge-case safety — constructed PartnerChangeSnapshot values directly
// ════════════════════════════════════════════════════════════════════════════

function blankSnapshot(capturedAt: string): PartnerChangeSnapshot {
  const empty = { status: "UNAVAILABLE" as const, coverage: "NONE" as const, scopeDescription: "x", entities: {} };
  return {
    schemaVersion: CHANGE_SNAPSHOT_SCHEMA_VERSION, capturedAt,
    projects: empty, clients: empty, proposals: empty, transactions: empty, tasks: empty, releases: empty,
    sessions: empty, shows: empty, victor: empty, steven: empty, clips: empty, labelArtists: empty,
    balanceLedger: empty, projectFinanceSettings: empty,
  };
}

console.log("no baseline -> NO_BASELINE diagnostic, 0 changes, not comparable");
{
  const r = comparePartnerChangeSnapshots(null, blankSnapshot("2026-09-22T06:00:00Z"));
  check("0 changes", r.changes.length, 0);
  ok("comparable is false", !r.comparable);
  check("diagnostic code", r.diagnostics.map((d) => d.code), ["NO_BASELINE"]);
  check("previousCapturedAt is null", r.previousCapturedAt, null);
}

console.log("incompatible schema -> INCOMPATIBLE_SCHEMA diagnostic, 0 changes, never guesses across versions");
{
  const prev = blankSnapshot("2026-09-21T06:00:00Z");
  const curr = { ...blankSnapshot("2026-09-22T06:00:00Z"), schemaVersion: "partner-change-snapshot-v999" };
  const r = comparePartnerChangeSnapshots(prev, curr);
  check("0 changes", r.changes.length, 0);
  ok("comparable is false", !r.comparable);
  check("diagnostic code", r.diagnostics.map((d) => d.code), ["INCOMPATIBLE_SCHEMA"]);
}

console.log("source failure (A available, B failed) -> SOURCE_FAILED_CURRENT, never reports mass disappearance");
{
  const prev = blankSnapshot("2026-09-21T06:00:00Z");
  prev.projects = { status: "AVAILABLE", coverage: "PARTIAL", scopeDescription: "visible projects", entities: { p1: { id: "p1", name: "x", status: "s", businessType: "b", artistText: "a", deadlineYmd: null, active: true } } };
  const curr = blankSnapshot("2026-09-22T06:00:00Z");
  curr.projects = { status: "UNKNOWN", coverage: "FAILED", scopeDescription: "visible projects", entities: {} };
  const r = comparePartnerChangeSnapshots(prev, curr);
  const projectChanges = r.changes.filter((c) => c.domain === "projects");
  check("0 project changes (never '1 project disappeared')", projectChanges.length, 0);
  ok("diagnostic is SOURCE_FAILED_CURRENT for projects", r.diagnostics.some((d) => d.code === "SOURCE_FAILED_CURRENT" && d.domain === "projects"));
}

console.log("source recovery (A failed, B available) -> SOURCE_RECOVERED_NO_BASELINE, never reports mass appearance");
{
  const prev = blankSnapshot("2026-09-21T06:00:00Z");
  prev.projects = { status: "UNKNOWN", coverage: "FAILED", scopeDescription: "visible projects", entities: {} };
  const curr = blankSnapshot("2026-09-22T06:00:00Z");
  curr.projects = { status: "AVAILABLE", coverage: "PARTIAL", scopeDescription: "visible projects", entities: { p1: { id: "p1", name: "x", status: "s", businessType: "b", artistText: "a", deadlineYmd: null, active: true }, p2: { id: "p2", name: "y", status: "s", businessType: "b", artistText: "a", deadlineYmd: null, active: true } } };
  const r = comparePartnerChangeSnapshots(prev, curr);
  const projectChanges = r.changes.filter((c) => c.domain === "projects");
  check("0 project changes (never '2 new projects')", projectChanges.length, 0);
  ok("diagnostic is SOURCE_RECOVERED_NO_BASELINE for projects", r.diagnostics.some((d) => d.code === "SOURCE_RECOVERED_NO_BASELINE" && d.domain === "projects"));
}

console.log("scope change (open-only -> full history) -> SCOPE_CHANGED, appeared/disappeared suppressed entirely");
{
  const prev = blankSnapshot("2026-09-21T06:00:00Z");
  prev.tasks = { status: "AVAILABLE", coverage: "PARTIAL", scopeDescription: "open tasks only", entities: { t1: { id: "t1", status: "פתוח", dueYmd: null, relatedType: "project", relatedId: "p1" } } };
  const curr = blankSnapshot("2026-09-22T06:00:00Z");
  curr.tasks = { status: "AVAILABLE", coverage: "FULL", scopeDescription: "all tasks, full history", entities: { t1: { id: "t1", status: "פתוח", dueYmd: null, relatedType: "project", relatedId: "p1" }, t2: { id: "t2", status: "בוצע", dueYmd: null, relatedType: "project", relatedId: "p1" } } };
  const r = comparePartnerChangeSnapshots(prev, curr);
  check("0 task changes despite t2 only existing in current", r.changes.filter((c) => c.domain === "tasks").length, 0);
  ok("diagnostic is SCOPE_CHANGED for tasks", r.diagnostics.some((d) => d.code === "SCOPE_CHANGED" && d.domain === "tasks"));
}

console.log("coverage change (FULL -> PARTIAL, same scope) -> COVERAGE_CHANGED; appeared/disappeared suppressed, common entities still field-diffed");
{
  const prev = blankSnapshot("2026-09-21T06:00:00Z");
  prev.clips = { status: "AVAILABLE", coverage: "FULL", scopeDescription: "all clips", entities: {
    clip1: { id: "clip1", status: "בתהליך", projectId: "p1", artistName: "a" },
    clip2: { id: "clip2", status: "בתהליך", projectId: "p1", artistName: "a" },
  } };
  const curr = blankSnapshot("2026-09-22T06:00:00Z");
  curr.clips = { status: "AVAILABLE", coverage: "PARTIAL", scopeDescription: "all clips", entities: {
    clip1: { id: "clip1", status: "הושלם", projectId: "p1", artistName: "a" }, // clip2 missing — must NOT be reported as disappeared
  } };
  const r = comparePartnerChangeSnapshots(prev, curr);
  const clipChanges = r.changes.filter((c) => c.domain === "clips");
  ok("diagnostic is COVERAGE_CHANGED for clips", r.diagnostics.some((d) => d.code === "COVERAGE_CHANGED" && d.domain === "clips"));
  ok("clip1's real status change IS still reported (common entity, safe to diff)", clipChanges.some((c) => c.entityId === "clip1" && c.field === "status"));
  ok("clip2's disappearance is NOT reported (coverage change makes it unsafe to trust)", !clipChanges.some((c) => c.entityId === "clip2"));
}

console.log("missing stable id -> MISSING_STABLE_ID diagnostic, that entity excluded, never crashes");
{
  const prev = blankSnapshot("2026-09-21T06:00:00Z");
  prev.clients = { status: "AVAILABLE", coverage: "FULL", scopeDescription: "all clients", entities: { "": { id: "", name: "broken", type: "x", status: "s" }, c1: { id: "c1", name: "ok", type: "x", status: "s" } } };
  const curr = blankSnapshot("2026-09-22T06:00:00Z");
  curr.clients = { status: "AVAILABLE", coverage: "FULL", scopeDescription: "all clients", entities: { c1: { id: "c1", name: "ok", type: "x", status: "s2" } } };
  const r = comparePartnerChangeSnapshots(prev, curr);
  ok("diagnostic is MISSING_STABLE_ID for clients", r.diagnostics.some((d) => d.code === "MISSING_STABLE_ID" && d.domain === "clients"));
  ok("the broken empty-id entity produces no ENTITY_DISAPPEARED / phantom change", !r.changes.some((c) => c.domain === "clients" && c.entityId === ""));
  ok("the valid c1 entity is still diffed normally", r.changes.some((c) => c.domain === "clients" && c.entityId === "c1" && c.field === "status"));
}

console.log("entity appears / disappears safely (normal, non-degraded scope+coverage)");
{
  const prev = blankSnapshot("2026-09-21T06:00:00Z");
  prev.labelArtists = { status: "AVAILABLE", coverage: "FULL", scopeDescription: "all label artists", entities: { la1: { id: "la1", name: "a", status: "s" }, la2: { id: "la2", name: "b", status: "s" } } };
  const curr = blankSnapshot("2026-09-22T06:00:00Z");
  curr.labelArtists = { status: "AVAILABLE", coverage: "FULL", scopeDescription: "all label artists", entities: { la1: { id: "la1", name: "a", status: "s" }, la3: { id: "la3", name: "c", status: "s" } } };
  const r = comparePartnerChangeSnapshots(prev, curr);
  const changes = r.changes.filter((c) => c.domain === "labelArtists");
  check("la2 disappeared, la3 appeared, la1 unchanged (2 changes total)", changes.map((c) => `${c.entityId}:${c.kind}`).sort(), ["la2:ENTITY_DISAPPEARED", "la3:ENTITY_APPEARED"]);
  ok("disappearance evidence never AFFIRMS deletion (it explicitly says NOT necessarily deleted)", changes.filter((c) => c.kind === "ENTITY_DISAPPEARED").every((c) => /not necessarily deleted/i.test(c.evidence.join(" ")) && !/\bwas deleted\b/i.test(c.evidence.join(" "))));
}

// ════════════════════════════════════════════════════════════════════════════
// Privacy — static check
// ════════════════════════════════════════════════════════════════════════════

console.log("privacy: PartnerChangeSnapshot types never carry notes/phone/email/URLs/tokens/secrets");
const changesDir = path.join(path.resolve(__dirname, ".."), "lib/partner/changes");
const changesSrc = Object.fromEntries(fs.readdirSync(changesDir).map((f) => [f, fs.readFileSync(path.join(changesDir, f), "utf8")]));
ok("no forbidden field name anywhere in lib/partner/changes", Object.values(changesSrc).every((s) => !/\b(notes|phone|email|dropboxUrl|fileUrl|token|secret)\s*:/i.test(s)));
ok("no dropbox/http URL literal anywhere in lib/partner/changes", Object.values(changesSrc).every((s) => !/dropbox\.com|https?:\/\//i.test(s)));
ok("snapshot JSON for a full real state never contains a literal '@' (no email leaked through)", !JSON.stringify(snapA).includes("@"));

console.log("engine constraints (static checks on lib/partner/changes)");
ok("no LLM / AI provider anywhere", Object.values(changesSrc).every((s) => !/openai|anthropic|groq|gpt-|claude-/i.test(s.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ""))));
ok("no DB write verb / Supabase import anywhere (this module is pure — D.2 persistence lives elsewhere)", Object.values(changesSrc).every((s) => !/\.(insert|update|upsert|delete|rpc)\(|lib\/supabase/.test(s)));
ok("no file imports \"server-only\" (the whole module is pure)", Object.values(changesSrc).every((s) => !/^\s*import\s+"server-only"\s*;/m.test(s)));
ok("no reference to agent_alerts anywhere (Owner decision holds)", Object.values(changesSrc).every((s) => !/agent_alerts|agent\/alerts-store/.test(s)));
ok("no Cases/Recommendations/Priority vocabulary anywhere (Phase E not started)", Object.values(changesSrc).every((s) => !/PartnerCase\b|CaseObject|RecommendationEngine|PriorityTier\b|riskScore|opportunityScore/.test(s)));
ok("no portal file imports lib/partner/changes", (() => {
  const ROOT = path.resolve(__dirname, "..");
  const portalDirs = ["app/api/red-artists", "app/api/supplier", "app/api/vendor/victor", "app/api/label/artists", "app/api/beats", "app/api/notifications", "components/team", "components/red-artists", "components/label", "lib/red-artists", "app/team", "app/red-artists", "app/dj-cleantone", "app/label"];
  const walk = (dir: string): string[] => fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]) : [];
  const portalFiles = [...portalDirs.flatMap((d) => walk(path.join(ROOT, d))), ...fs.readdirSync(path.join(ROOT, "lib")).filter((f) => /^(steven|victor|shalev|avi|cleantone|dj-|beat|show-|sketch)/.test(f)).map((f) => path.join(ROOT, "lib", f))];
  return portalFiles.every((f) => !/lib\/partner\/changes/.test(fs.readFileSync(f, "utf8")));
})());
// F.1I: the only /api/partner route is the Owner-only read-only actions surface — and it does not expose changes.
ok("no API route added under app/api for changes (/api/partner holds only the Partner action routes — F.1I surface + F.1J decisions + F.1K execute + F.1M outcomes (GET) + F2 finance (GET) + F2.8 finance answer (POST) + integrity (GET) / integrity answer (POST) + unified knowledge (GET) — none imports lib/partner/changes)", (() => { const dir = path.join(path.resolve(__dirname, ".."), "app/api/partner"); if (!fs.existsSync(dir)) return true; const list = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? list(path.join(d, e.name)) : [path.relative(dir, path.join(d, e.name)).split(path.sep).join("/")]); const files = list(dir); const allowed = ["actions/route.ts", "actions/decide/route.ts", "actions/change-deadline/route.ts", "actions/execute/route.ts", "outcomes/route.ts", "finance/route.ts", "finance/answer/route.ts", "integrity/route.ts", "integrity/answer/route.ts", "knowledge/route.ts"]; return files.every((x) => allowed.includes(x)) && files.every((x) => !fs.readFileSync(path.join(dir, x), "utf8").includes("lib/partner/changes")); })());

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
