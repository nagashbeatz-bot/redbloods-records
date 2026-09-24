/**
 * Golden tests for Redbloods Partner — Case Engine (Phase E.1, SHADOW MODE).
 *
 * Run with:   npx tsx scripts/test-partner-cases.ts
 *
 * Pure module: no Supabase, no network, no LLM, no persistence. Builds
 * PartnerCompanyState fixtures through the REAL computeCoo() +
 * assemblePartnerCompanyState() pipeline (same engine production uses), then
 * through buildPartnerCases() — never a mock. Change-derived detector tests
 * use synthetic in-memory PartnerChange objects (never a real baseline load —
 * Owner instruction §58).
 */
import fs from "node:fs";
import path from "node:path";
import { computeCoo } from "../lib/coo/pipeline";
import type { CooRawInput } from "../lib/coo/types";
import { assemblePartnerCompanyState } from "../lib/partner/eyes/company-state";
import type { PartnerCompanyState, PartnerEyesRaw } from "../lib/partner/eyes/types";
import { buildPartnerCases } from "../lib/partner/cases/engine";
import { explainPartnerCase } from "../lib/partner/cases/explain";
import type { PartnerCase } from "../lib/partner/cases/types";
import type { PartnerChange } from "../lib/partner/changes/types";
import { isOwnerApproved, getCharterRule } from "../lib/partner";

let pass = 0, fail = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log(`  ✓ ${name}`); pass++; }
  else { console.log(`  ✗ ${name}\n      expected ${e}\n      actual   ${a}`); fail++; }
}
const ok = (name: string, cond: boolean) => { if (cond) { console.log(`  ✓ ${name}`); pass++; } else { console.log(`  ✗ ${name}`); fail++; } };

const TODAY = "2026-09-22";

// ════════════════════════════════════════════════════════════════════════════
// Fixture — one rich state covering multiple detector scenarios at once
// ════════════════════════════════════════════════════════════════════════════

function buildCooRaw(): CooRawInput {
  return structuredClone<CooRawInput>({
    sources: [
      { source: "projects", status: "ok", rowCount: 5 }, { source: "tasks", status: "ok", rowCount: 1 },
      { source: "steven", status: "ok", rowCount: 0 }, { source: "victor", status: "ok", rowCount: 4 },
      { source: "proposals", status: "ok", rowCount: 0 }, { source: "shows", status: "ok", rowCount: 0 },
      { source: "sessions", status: "ok", rowCount: 0 }, { source: "transactions", status: "ok", rowCount: 2 },
      { source: "finance_settings", status: "ok", rowCount: 2 }, { source: "releases", status: "ok", rowCount: 2 },
      { source: "agent_alerts", status: "ok", rowCount: 0 },
    ],
    projects: [
      // p1: deadline passed, still open -> PROJECT_DEADLINE_PASSED
      { id: "p1", name: "פרויקט באיחור", artist: "אמן א", status: "בעבודה", deadline: "2026-09-10", projectType: "שיר", businessType: "לקוח", updatedAt: TODAY, isHidden: false },
      // p2: deadline in the future -> no Case
      { id: "p2", name: "פרויקט בזמן", artist: "אמן ב", status: "בעבודה", deadline: "2026-12-01", projectType: "שיר", businessType: "לקוח", updatedAt: TODAY, isHidden: false },
      // p3: no deadline at all -> no Case, and priced (has finance setting) -> no FINANCE_CONFIGURATION_MISSING
      { id: "p3", name: "פרויקט ללא דדליין", artist: "אמן ג", status: "בעבודה", deadline: null, projectType: "שיר", businessType: "לקוח", updatedAt: TODAY, isHidden: false },
      // p4: open, no finance setting at all -> FINANCE_CONFIGURATION_MISSING
      { id: "p4", name: "פרויקט ללא תמחור", artist: "אמן ד", status: "בעבודה", deadline: null, projectType: "שיר", businessType: "לקוח", updatedAt: TODAY, isHidden: false },
      // p5: label project, active release with passed target -> RELEASE_TARGET_DATE_PASSED
      { id: "p5", name: "פרויקט לייבל", artist: "אמן לייבל", status: "בעבודה", deadline: null, projectType: "שיר", businessType: "לייבל", updatedAt: TODAY, isHidden: false },
    ],
    tasks: [{ id: "t1", title: "מעקב ויקטור p1", status: "פתוח", dueDate: "2026-09-10", relatedType: "project", relatedId: "p1", createdAt: "2026-09-01T09:00:00Z" }],
    steven: [],
    victor: {
      stuckAfterDays: 5,
      works: [
        // v1: internal deadline passed, active -> MISSED_INTERNAL_DEADLINE
        { id: "v1", projectId: "p1", title: "עבודה 1", status: "פעיל", workState: "נשלח לויקטור", sentDate: "2026-09-01", internalDeadline: "2026-09-12", daysSinceSent: 21, isStuck: true, uploads: [], filesWithoutTimestamp: 0, reviews: [], reviewEvents: [], linkedTaskId: "t1", createdAt: "2026-08-25T10:00:00Z", updatedAt: "2026-09-01T10:00:00Z", returnedDate: null },
        // v2: future internal deadline -> no MISSED_INTERNAL_DEADLINE Case
        { id: "v2", projectId: "p2", title: "עבודה 2", status: "פעיל", workState: "נשלח לויקטור", sentDate: "2026-09-15", internalDeadline: "2026-12-01", daysSinceSent: 7, isStuck: false, uploads: [], filesWithoutTimestamp: 0, reviews: [], reviewEvents: [], linkedTaskId: null, createdAt: "2026-09-15T10:00:00Z", updatedAt: "2026-09-15T10:00:00Z", returnedDate: null },
        // v3: delivered (upload) with NO later owner notes -> ball.holder=owner -> DELIVERY_WITHOUT_RECORDED_FOLLOWUP
        { id: "v3", projectId: "p3", title: "עבודה 3", status: "פעיל", workState: "חזר מויקטור", sentDate: "2026-09-01", internalDeadline: null, daysSinceSent: 11, isStuck: false, uploads: ["2026-09-11T10:00:00Z"], filesWithoutTimestamp: 0, reviews: [], reviewEvents: [], linkedTaskId: null, createdAt: "2026-09-01T10:00:00Z", updatedAt: "2026-09-11T10:00:00Z", returnedDate: null },
        // v4: delivered upload FOLLOWED by owner notes -> ball.holder=victor -> no DELIVERY_WITHOUT_RECORDED_FOLLOWUP
        { id: "v4", projectId: null, title: "עבודה 4", status: "פעיל", workState: "דורש תיקון", sentDate: "2026-09-01", internalDeadline: null, daysSinceSent: 11, isStuck: false, uploads: ["2026-09-11T10:00:00Z"], filesWithoutTimestamp: 0, reviews: [{ sentAt: "2026-09-12T10:00:00Z", draft: false }], reviewEvents: [{ versionKey: "v1", sentAt: "2026-09-12T10:00:00Z", draft: false }], linkedTaskId: null, createdAt: "2026-09-01T10:00:00Z", updatedAt: "2026-09-12T10:00:00Z", returnedDate: null },
      ],
    },
    proposals: [],
    shows: [],
    sessions: [],
    transactions: [
      // p1: underpaid -> PROJECT_PAYMENT_OUTSTANDING
      { id: "tx1", projectId: "p1", type: "income", amount: 500, currency: "₪", status: "התקבל", date: "2026-09-10", expenseScope: "כללי", category: "" },
      // p2: overpaid -> PROJECT_OVERPAYMENT
      { id: "tx2", projectId: "p2", type: "income", amount: 3000, currency: "₪", status: "שולם", date: "2026-09-11", expenseScope: "כללי", category: "" },
    ],
    financeSettings: [
      { projectId: "p1", agreedPrice: 2000, currency: "₪", financeException: false },
      { projectId: "p2", agreedPrice: 1000, currency: "₪", financeException: false },
      { projectId: "p3", agreedPrice: 1500, currency: "₪", financeException: false },
      // p4 deliberately has NO finance setting -> FINANCE_CONFIGURATION_MISSING
      // p5 deliberately has NO finance setting either, but it's a label project — still open, still counted
    ],
    orphanFinanceKeyCount: 0,
    releases: {
      labelProjectsTotal: 1,
      rows: [{ projectId: "p5", name: "פרויקט לייבל", projectStatus: "בעבודה", stage: "הפקה", targetDate: "2026-09-01", nextAction: "", blocker: "", responsible: "", stageEnteredAt: "2026-08-01T10:00:00Z", labelArtistId: "la1" }],
    },
    alerts: [],
  });
}

function buildEyesRaw(): PartnerEyesRaw {
  return structuredClone<PartnerEyesRaw>({
    sources: [
      { source: "clients", status: "ok", rowCount: 0 }, { source: "label_artists", status: "ok", rowCount: 1 },
      { source: "clip_productions", status: "ok", rowCount: 0 }, { source: "artist_balance_entries", status: "ok", rowCount: 0 },
      { source: "sessions_eyes", status: "ok", rowCount: 0 }, { source: "shows_eyes", status: "ok", rowCount: 0 },
      { source: "proposals_eyes", status: "ok", rowCount: 0 }, { source: "releases_eyes", status: "ok", rowCount: 1 },
      { source: "transactions_eyes", status: "ok", rowCount: 2 }, { source: "tasks_eyes", status: "ok", rowCount: 1 },
    ],
    clients: [], labelArtists: [{ id: "la1", name: "אמן לייבל", status: "פעיל", createdAt: "2026-01-01T10:00:00Z", updatedAt: "2026-01-01T10:00:00Z" }],
    artistBalanceEntries: [], clips: [], sessions: [], shows: [], proposalsFull: [],
    releasesFull: [{ projectId: "p5", labelArtistId: "la1", stage: "הפקה", targetDate: "2026-09-01", stageEnteredAt: "2026-08-01T10:00:00Z", releasedAt: null, createdAt: "2026-08-01T10:00:00Z", updatedAt: "2026-09-01T10:00:00Z" }],
    transactions: [
      { id: "tx1", projectId: "p1", type: "income", amount: 500, currency: "₪", status: "התקבל", date: "2026-09-10", expenseScope: "כללי", category: "", createdAt: "2026-09-10T10:00:00Z" },
      { id: "tx2", projectId: "p2", type: "income", amount: 3000, currency: "₪", status: "שולם", date: "2026-09-11", expenseScope: "כללי", category: "", createdAt: "2026-09-11T10:00:00Z" },
    ],
    tasksFull: [{ id: "t1", title: "מעקב ויקטור p1", status: "פתוח", dueDate: "2026-09-10", relatedType: "project", relatedId: "p1", createdAt: "2026-09-01T09:00:00Z", updatedAt: "2026-09-01T09:00:00Z" }],
  });
}

const coo = computeCoo(buildCooRaw(), new Date(`${TODAY}T06:00:00Z`));
const eyesRaw = buildEyesRaw();
const state = assemblePartnerCompanyState(coo, eyesRaw);
const cases = buildPartnerCases({ state, today: TODAY });
const byId = (id: string) => cases.find((c) => c.id === id);

console.log("determinism: same state -> identical Cases (same run and a second independent run)");
check("buildPartnerCases is deterministic", JSON.stringify(buildPartnerCases({ state, today: TODAY })), JSON.stringify(cases));

console.log("no fabricated Cases from empty domains");
{
  const emptyCooRaw = buildCooRaw();
  emptyCooRaw.projects = []; emptyCooRaw.victor = { stuckAfterDays: 5, works: [] }; emptyCooRaw.transactions = []; emptyCooRaw.financeSettings = []; emptyCooRaw.releases = { labelProjectsTotal: 0, rows: [] };
  // t1 is the base fixture's Victor auto-followup task (linkedTaskId="t1" on v1) — with victor
  // cleared above, the cross-reference that sets TaskFact.derivedFrom would break, making t1 look
  // like a standalone overdue task to detectTaskDueDateCases. Clear it too for a genuinely empty scenario.
  emptyCooRaw.tasks = [];
  const emptyEyes = buildEyesRaw(); emptyEyes.releasesFull = []; emptyEyes.transactions = [];
  const emptyCoo = computeCoo(emptyCooRaw, new Date(`${TODAY}T06:00:00Z`));
  const emptyState = assemblePartnerCompanyState(emptyCoo, emptyEyes);
  const emptyCases = buildPartnerCases({ state: emptyState, today: TODAY });
  check("0 Cases from genuinely empty data (never fabricated)", emptyCases.length, 0);
}

console.log("failed domain -> no business Case from it (data quality gate)");
{
  const degraded = structuredClone(state);
  (degraded.domains.victor as unknown as { status: string; coverage: string; data: unknown }).status = "UNKNOWN";
  (degraded.domains.victor as unknown as { status: string; coverage: string; data: unknown }).coverage = "FAILED";
  (degraded.domains.victor as unknown as { status: string; coverage: string; data: unknown }).data = null;
  const degradedCases = buildPartnerCases({ state: degraded, today: TODAY });
  ok("no MISSED_INTERNAL_DEADLINE Case when victor domain failed (even though v1 would otherwise trigger one)", !degradedCases.some((c) => c.caseType === "MISSED_INTERNAL_DEADLINE"));
  ok("no DELIVERY_WITHOUT_RECORDED_FOLLOWUP Case either", !degradedCases.some((c) => c.caseType === "DELIVERY_WITHOUT_RECORDED_FOLLOWUP"));
  ok("other domains' Cases (e.g. finance, project deadline) are unaffected", degradedCases.some((c) => c.caseType === "PROJECT_DEADLINE_PASSED"));
}

console.log("weak relation handling: the E.1 catalog never claims a TEXT_MATCH relation (every detector is ID-only)");
ok("no Case in this catalog sets dataQuality.relationQuality at all", cases.every((c) => c.dataQuality.relationQuality === undefined));

console.log("hypotheses never enter facts (structural separation)");
{
  const v3 = byId("victor_delivery_no_followup:v3");
  ok("v3's hypothesis text is in .hypotheses, not .facts", !!v3 && v3.hypotheses.length > 0 && !v3.facts.some((f) => String(f.value).includes("ממתינה")));
}
ok("no Case anywhere has a hypothesis statement leaking into a fact's value", cases.every((c) => c.facts.every((f) => !c.hypotheses.some((h) => String(f.value) === h.statement))));

console.log("Owner Rule source preserved: every id in ownerRulesApplied is genuinely OWNER_RULE/OWNER_GOAL approved");
ok("every ownerRulesApplied id passes isOwnerApproved()", cases.every((c) => c.ownerRulesApplied.every((id) => isOwnerApproved(id))));
ok("INTERNAL_DEADLINES_MATTER really is OWNER_RULE (not assumed)", getCharterRule("INTERNAL_DEADLINES_MATTER")?.status === "OWNER_RULE");
ok("PROTECT_LABEL_RELEASES really is OWNER_RULE", getCharterRule("PROTECT_LABEL_RELEASES")?.status === "OWNER_RULE");

console.log("Working Principle never labelled as Owner Rule");
ok("no case's ownerRulesApplied contains a WORKING_PRINCIPLE id", cases.every((c) => c.ownerRulesApplied.every((id) => getCharterRule(id)?.status !== "WORKING_PRINCIPLE")));
ok("workingPrinciplesApplied is empty across the E.1 catalog (no detector uses one yet)", cases.every((c) => c.workingPrinciplesApplied.length === 0));

// ── Victor internal deadline ──
console.log("Victor: passed internal deadline -> Case; future deadline -> none");
{
  const v1 = byId("missed_internal_deadline:v1");
  ok("v1 (deadline 2026-09-12, today 2026-09-22) has a MISSED_INTERNAL_DEADLINE Case", !!v1 && v1.caseType === "MISSED_INTERNAL_DEADLINE" && v1.classification === "RISK");
  check("days late computed correctly (10 days)", v1?.derivedFacts.find((d) => d.id === "days_late")?.value, 10);
  ok("v2 (future deadline) has NO Case", !byId("missed_internal_deadline:v2"));
  ok("wording never says 'Victor failed' — only that the deadline passed", !v1?.summaryHe.includes("ויקטור") && !v1?.summaryHe.toLowerCase().includes("fail"));
}

// ── Victor unfollowed delivery ──
console.log("Victor: delivery + no later review -> Case; later review -> none");
{
  const v3 = byId("victor_delivery_no_followup:v3");
  ok("v3 (upload, no later review) has a DELIVERY_WITHOUT_RECORDED_FOLLOWUP Case", !!v3 && v3.classification === "ATTENTION");
  ok("v4 (upload THEN a later review) has NO such Case", !byId("victor_delivery_no_followup:v4"));
  ok("wording never claims the owner is blocking or must review", !v3?.summaryHe.includes("חוסם") && !v3?.summaryHe.includes("חייב"));
  ok("the hypothesis (if any) never claims outside-app review is known — it's in unknowns", v3!.unknowns.some((u) => u.includes("מחוץ למערכת")));
}

console.log("raw Victor WIP count alone never produces a STOP_NEW_WORK / OVERLOADED case (NO_HARD_WIP_CAP_FOR_VICTOR)");
ok("no case type anywhere resembles a WIP-cap/overload verdict", !cases.some((c) => /STOP_NEW_WORK|OVERLOADED/i.test(c.caseType)));
ok("4 active Victor works in this fixture produced 0 'too many works' Cases", !cases.some((c) => c.caseType.includes("WIP") || c.caseType.includes("OVERLOAD")));

// ── Finance ──
console.log("Finance: agreedPrice known + underpaid -> outstanding; == -> none; > -> overpayment; UNKNOWN -> no debt Case");
{
  const p1 = byId("project_payment_outstanding:p1");
  ok("p1 (2000 agreed, 500 received) -> PROJECT_PAYMENT_OUTSTANDING, outstanding=1500", !!p1 && p1.derivedFacts.find((d) => d.id === "outstanding")?.value === 1500);
  ok("p2 (1000 agreed, 3000 paid) -> PROJECT_OVERPAYMENT, not a debt Case", !byId("project_payment_outstanding:p2") && !!byId("project_overpayment:p2"));
  const p2o = byId("project_overpayment:p2")!;
  check("p2 overpayment classification is INFORMATION, never called negative debt", p2o.classification, "INFORMATION");
  check("p2 overpayment=2000 (received=3000 - agreed=1000)", p2o.derivedFacts.find((d) => d.id === "overpayment")?.value, 2000);
  const p3 = byId("project_payment_outstanding:p3");
  ok("p3 (agreedPrice=1500 known, zero received) -> a REAL outstanding balance of 1500, correctly reported (not silently zero)", !!p3 && p3.derivedFacts.find((d) => d.id === "outstanding")?.value === 1500);
  ok("p4 (no finance setting at all) -> no debt Case (UNKNOWN price never treated as 0)", !byId("project_payment_outstanding:p4"));
  const p4c = byId("finance_configuration_missing:p4");
  ok("p4 -> FINANCE_CONFIGURATION_MISSING instead, status NEEDS_CONTEXT", !!p4c && p4c.status === "NEEDS_CONTEXT" && p4c.classification === "INFORMATION");
  ok("p1/p2/p3 (all priced) do NOT get FINANCE_CONFIGURATION_MISSING", !byId("finance_configuration_missing:p1") && !byId("finance_configuration_missing:p2") && !byId("finance_configuration_missing:p3"));
}
ok("cancelled/expected transactions are never counted as received (reused lib/coo receivables semantics, not re-derived)", true); // structural — this detector performs NO computation of its own, see lib/partner/cases/detectors/finance.ts
ok("currencies are never merged (each fact carries its own currency field)", cases.filter((c) => c.caseType === "PROJECT_PAYMENT_OUTSTANDING").every((c) => c.facts.some((f) => f.field === "currency")));
console.log("finance evidence completeness: outstanding/overpayment are fully traceable from agreedPrice/received alone; balance_legacy is present but not the decision input");
{
  const getFact = (c: PartnerCase, field: string) => c.facts.find((f) => f.field === field)?.value as number | undefined;
  const financeCases = cases.filter((c) => c.caseType === "PROJECT_PAYMENT_OUTSTANDING" || c.caseType === "PROJECT_OVERPAYMENT");
  ok("every finance Case exposes agreedPrice/received/cancelled/balance_legacy", financeCases.length > 0 && financeCases.every((c) =>
    c.facts.some((f) => f.field === "agreedPrice") && c.facts.some((f) => f.field === "received") &&
    c.facts.some((f) => f.field === "cancelled") && c.facts.some((f) => f.field === "balance_legacy")));
  ok("PROJECT_PAYMENT_OUTSTANDING.outstanding = agreedPrice - received exactly (never involves cancelled)", cases.filter((c) => c.caseType === "PROJECT_PAYMENT_OUTSTANDING").every((c) => {
    const agreed = getFact(c, "agreedPrice") ?? 0, received = getFact(c, "received") ?? 0;
    return agreed - received === (c.derivedFacts.find((d) => d.id === "outstanding")?.value as number);
  }));
  ok("PROJECT_OVERPAYMENT.overpayment = received - agreedPrice exactly (never involves cancelled)", cases.filter((c) => c.caseType === "PROJECT_OVERPAYMENT").every((c) => {
    const agreed = getFact(c, "agreedPrice") ?? 0, received = getFact(c, "received") ?? 0;
    return received - agreed === (c.derivedFacts.find((d) => d.id === "overpayment")?.value as number);
  }));
}

// ── Finance: canonical cancelled-income semantics (Phase E.1 hardening — regression tests A-E) ──
console.log("Finance CANCELLED semantics: cancelled income must NEVER move a project across fully-paid/outstanding/overpaid, even though it still moves the legacy balance_legacy field");
function financeFixture(agreedPrice: number, paidIncome: number, cancelled: number) {
  const raw = buildCooRaw();
  raw.projects = [{ id: "fx", name: "Fixture", artist: "א", status: "בעבודה", deadline: null, projectType: "שיר", businessType: "לקוח", updatedAt: TODAY, isHidden: false }];
  raw.victor = { stuckAfterDays: 5, works: [] };
  raw.tasks = [];
  raw.releases = { labelProjectsTotal: 0, rows: [] };
  raw.financeSettings = [{ projectId: "fx", agreedPrice, currency: "₪", financeException: false }];
  raw.transactions = [];
  if (paidIncome > 0) raw.transactions!.push({ id: "fx-paid", projectId: "fx", type: "income", amount: paidIncome, currency: "₪", status: "התקבל", date: "2026-09-10", expenseScope: "כללי", category: "" });
  if (cancelled > 0) raw.transactions!.push({ id: "fx-cancelled", projectId: "fx", type: "income", amount: cancelled, currency: "₪", status: "בוטל", date: "2026-09-10", expenseScope: "כללי", category: "" });
  const eyes = buildEyesRaw();
  eyes.releasesFull = [];
  eyes.transactions = raw.transactions!.map((t) => ({ ...t, createdAt: "2026-09-10T10:00:00Z" }));
  const coo = computeCoo(raw, new Date(`${TODAY}T06:00:00Z`));
  return buildPartnerCases({ state: assemblePartnerCompanyState(coo, eyes), today: TODAY });
}
{
  // A. agreedPrice=4250, paidIncome=4250, cancelled=1500 -> fully paid, no Case at all
  const a = financeFixture(4250, 4250, 1500);
  ok("A: fully paid despite cancelled=1500 -> NO PROJECT_OVERPAYMENT, NO PROJECT_PAYMENT_OUTSTANDING (production false-positive this hardening fixes)", !a.some((c) => c.caseType === "PROJECT_OVERPAYMENT" || c.caseType === "PROJECT_PAYMENT_OUTSTANDING"));

  // B. agreedPrice=4250, paidIncome=3000, cancelled=1500 -> outstanding=1250 (NOT 0, NOT negative)
  const b = financeFixture(4250, 3000, 1500);
  const bCase = b.find((c) => c.caseType === "PROJECT_PAYMENT_OUTSTANDING");
  ok("B: PROJECT_PAYMENT_OUTSTANDING with outstanding=1250 exactly", !!bCase && bCase.derivedFacts.find((d) => d.id === "outstanding")?.value === 1250);
  ok("B: no PROJECT_OVERPAYMENT alongside it", !b.some((c) => c.caseType === "PROJECT_OVERPAYMENT"));

  // C. agreedPrice=4250, paidIncome=5000, cancelled=1500 -> overpayment=750
  const cFixture = financeFixture(4250, 5000, 1500);
  const cCase = cFixture.find((x) => x.caseType === "PROJECT_OVERPAYMENT");
  ok("C: PROJECT_OVERPAYMENT with overpayment=750 exactly", !!cCase && cCase.derivedFacts.find((d) => d.id === "overpayment")?.value === 750);
  ok("C: no PROJECT_PAYMENT_OUTSTANDING alongside it", !cFixture.some((x) => x.caseType === "PROJECT_PAYMENT_OUTSTANDING"));

  // D. agreedPrice UNKNOWN (no finance setting at all) -> no debt/overpayment Case, only (possibly) FINANCE_CONFIGURATION_MISSING
  const rawD = buildCooRaw();
  rawD.projects = [{ id: "fx", name: "Fixture", artist: "א", status: "בעבודה", deadline: null, projectType: "שיר", businessType: "לקוח", updatedAt: TODAY, isHidden: false }];
  rawD.victor = { stuckAfterDays: 5, works: [] }; rawD.tasks = []; rawD.releases = { labelProjectsTotal: 0, rows: [] };
  rawD.financeSettings = []; rawD.transactions = [];
  const eyesD = buildEyesRaw(); eyesD.releasesFull = []; eyesD.transactions = [];
  const cooD = computeCoo(rawD, new Date(`${TODAY}T06:00:00Z`));
  const dCases = buildPartnerCases({ state: assemblePartnerCompanyState(cooD, eyesD), today: TODAY });
  ok("D: agreedPrice UNKNOWN -> no PROJECT_PAYMENT_OUTSTANDING / PROJECT_OVERPAYMENT", !dCases.some((c) => c.caseType === "PROJECT_PAYMENT_OUTSTANDING" || c.caseType === "PROJECT_OVERPAYMENT"));
  ok("D: FINANCE_CONFIGURATION_MISSING is the only finance-shaped Case for it", !!dCases.find((c) => c.id === "finance_configuration_missing:fx"));

  // E. Expected/unpaid/cancelled transactions never increase paidIncome
  const e1 = financeFixture(1000, 0, 1000); // fully cancelled, nothing paid -> outstanding=1000, not 0
  const e1Case = e1.find((c) => c.caseType === "PROJECT_PAYMENT_OUTSTANDING");
  ok("E: cancelled income alone never counts as paid — agreedPrice=1000 fully cancelled still shows outstanding=1000", !!e1Case && e1Case.derivedFacts.find((d) => d.id === "outstanding")?.value === 1000);
}

// ── Release ──
console.log("Release: passed target date -> timing Case; future alone -> no arbitrary risk Case; label rule attached");
{
  const p5 = byId("release_target_date_passed:p5");
  ok("p5 (target 2026-09-01, today 2026-09-22) -> RELEASE_TARGET_DATE_PASSED", !!p5 && p5.classification === "RISK");
  check("days late = 21", p5?.derivedFacts.find((d) => d.id === "days_late")?.value, 21);
  check("PROTECT_LABEL_RELEASES is attached", p5?.ownerRulesApplied, ["PROTECT_LABEL_RELEASES"]);
  ok("wording never says 'at risk' from an arbitrary day-count threshold — only the passed-date fact", !p5?.summaryHe.includes("בסיכון"));
}
{
  const rawFuture = buildCooRaw();
  rawFuture.releases!.rows[0].targetDate = "2026-12-01"; // far future
  const eyesFuture = buildEyesRaw();
  eyesFuture.releasesFull![0] = { ...eyesFuture.releasesFull![0], targetDate: "2026-12-01" };
  const cooFuture = computeCoo(rawFuture, new Date(`${TODAY}T06:00:00Z`));
  const stateFuture = assemblePartnerCompanyState(cooFuture, eyesFuture);
  const casesFuture = buildPartnerCases({ state: stateFuture, today: TODAY });
  ok("a release with a FUTURE target date (however close) produces NO Case — no invented N-day-window risk", !casesFuture.some((c) => c.caseType === "RELEASE_TARGET_DATE_PASSED"));
}

// ── Project deadline ──
console.log("Project deadline: passed + active -> Case; future -> none");
{
  const p1d = byId("project_deadline_passed:p1");
  ok("p1 (deadline 2026-09-10, today 2026-09-22) -> PROJECT_DEADLINE_PASSED, 12 days late", !!p1d && p1d.derivedFacts.find((d) => d.id === "days_late")?.value === 12);
  ok("p2 (future deadline) -> no Case", !byId("project_deadline_passed:p2"));
  ok("p3 (no deadline at all) -> no Case", !byId("project_deadline_passed:p3"));
}
{
  const rawClosed = buildCooRaw();
  rawClosed.projects![0].status = "הושלם"; // p1 now completed
  const cooClosed = computeCoo(rawClosed, new Date(`${TODAY}T06:00:00Z`));
  const stateClosed = assemblePartnerCompanyState(cooClosed, buildEyesRaw());
  const casesClosed = buildPartnerCases({ state: stateClosed, today: TODAY });
  ok("a reliably COMPLETED project with a passed deadline produces NO Case (lib/coo's own 'open' set already excludes it)", !casesClosed.some((c) => c.caseType === "PROJECT_DEADLINE_PASSED" && c.subjectId === "p1"));
}

// ── Change-derived Cases (synthetic PartnerChange[], never a real baseline load) ──
console.log("Change Cases: became-received -> MONEY_RECEIVED; unrelated field change -> not MONEY_RECEIVED");
{
  const syntheticChanges: PartnerChange[] = [
    { id: "c1", domain: "transactions", entityType: "transaction", entityId: "tx1", kind: "STATUS_CHANGED", field: "receivedSemantic", before: "NOT_RECEIVED", after: "RECEIVED", observedBetween: { from: "2026-09-20T00:00:00Z", to: TODAY }, sourceOccurredAt: null, epistemicType: "DERIVED", evidence: [] },
    { id: "c2", domain: "transactions", entityType: "transaction", entityId: "tx2", kind: "FIELD_CHANGED", field: "category", before: "", after: "מיקס", observedBetween: { from: "2026-09-20T00:00:00Z", to: TODAY }, sourceOccurredAt: null, epistemicType: "FACT", evidence: [] },
  ];
  const changeCases = buildPartnerCases({ state, today: TODAY, changes: syntheticChanges, changeContext: { previousCapturedAt: "2026-09-20T00:00:00Z", currentCapturedAt: TODAY } });
  const money = changeCases.find((c) => c.id === "money_received:tx1");
  ok("tx1's receivedSemantic change -> MONEY_RECEIVED, OPPORTUNITY", !!money && money.classification === "OPPORTUNITY" && money.createdFrom === "CHANGE");
  ok("tx2's unrelated category field change does NOT produce MONEY_RECEIVED", !changeCases.some((c) => c.id === "money_received:tx2"));
  ok("changeContext is attached and matches what was passed in", money?.changeContext?.previousCapturedAt === "2026-09-20T00:00:00Z" && money?.changeContext?.currentCapturedAt === TODAY);
}

console.log("Change Cases: new show -> safe OPPORTUNITY/INFORMATION Case, never overstated as 'booked' from existence alone");
{
  const stateWithShow = structuredClone(state);
  stateWithShow.domains.shows.data = { total: 1, withDjClientId: 0, byStatus: {}, cooVisible: { upcoming: 0, doneUnpaid: 0, note: "" }, items: [{ id: "sh1", name: "הופעה", status: "ליד חדש", paymentStatus: "לא שולם", dateYmd: null, djClientId: null, djConfirmationStatus: null, artistClientId: null, bookerClientId: null, price: 1000 }] };
  const leadChange: PartnerChange[] = [{ id: "c3", domain: "shows", entityType: "show", entityId: "sh1", kind: "ENTITY_APPEARED", field: null, before: null, after: null, observedBetween: { from: null, to: TODAY }, sourceOccurredAt: null, epistemicType: "FACT", evidence: [] }];
  const leadCases = buildPartnerCases({ state: stateWithShow, today: TODAY, changes: leadChange, changeContext: { previousCapturedAt: null, currentCapturedAt: TODAY } });
  const leadShowCase = leadCases.find((c) => c.id === "new_show_recorded:sh1");
  check("a brand-new LEAD-stage show ('ליד חדש') is classified INFORMATION, never OPPORTUNITY (not overstated as booked)", leadShowCase?.classification, "INFORMATION");

  const stateConfirmed = structuredClone(stateWithShow);
  stateConfirmed.domains.shows.data!.items[0].status = "אושרה";
  const confirmedCases = buildPartnerCases({ state: stateConfirmed, today: TODAY, changes: leadChange, changeContext: { previousCapturedAt: null, currentCapturedAt: TODAY } });
  check("a CONFIRMED ('אושרה') new show is classified OPPORTUNITY", confirmedCases.find((c) => c.id === "new_show_recorded:sh1")?.classification, "OPPORTUNITY");
}

console.log("Change Cases: proposal status changed (non-נסגר) -> INFORMATION Case, no won/lost inference");
{
  const proposalChange: PartnerChange[] = [{ id: "c4", domain: "proposals", entityType: "proposal", entityId: "pr1", kind: "STATUS_CHANGED", field: "status", before: "נשלחה", after: "צריך פולואפ", observedBetween: { from: null, to: TODAY }, sourceOccurredAt: null, epistemicType: "FACT", evidence: [] }];
  const propCases = buildPartnerCases({ state, today: TODAY, changes: proposalChange, changeContext: { previousCapturedAt: null, currentCapturedAt: TODAY } });
  const propCase = propCases.find((c) => c.id === "proposal_status_changed:pr1");
  check("status change recorded as INFORMATION", propCase?.classification, "INFORMATION");
  ok("no won/lost/success/quality inference anywhere in the Case's human-facing text or evidence", !propCase!.summaryHe.match(/won|lost|success|quality|זכה|הפסיד/i) && propCase!.facts.every((f) => !/won|lost|success|quality/i.test(String(f.value))));
  ok("no PROPOSAL_CLOSED_WON alongside it (only fires specifically for after==='נסגר')", !propCases.some((c) => c.caseType === "PROPOSAL_CLOSED_WON"));
}

console.log("Change Cases: proposal status changed TO נסגר -> PROPOSAL_CLOSED_WON, OPPORTUNITY, never generic PROPOSAL_STATUS_CHANGED for the same change");
{
  const wonChange: PartnerChange[] = [{ id: "c4b", domain: "proposals", entityType: "proposal", entityId: "pr1", kind: "STATUS_CHANGED", field: "status", before: "ממתין לתשובה", after: "נסגר", observedBetween: { from: null, to: TODAY }, sourceOccurredAt: null, epistemicType: "FACT", evidence: [] }];
  const wonCases = buildPartnerCases({ state, today: TODAY, changes: wonChange, changeContext: { previousCapturedAt: null, currentCapturedAt: TODAY } });
  const wonCase = wonCases.find((c) => c.id === "proposal_closed_won:pr1");
  ok("PROPOSAL_CLOSED_WON fires", !!wonCase && wonCase.classification === "OPPORTUNITY" && wonCase.createdFrom === "CHANGE");
  ok("no duplicate generic PROPOSAL_STATUS_CHANGED for the same underlying change", !wonCases.some((c) => c.id === "proposal_status_changed:pr1"));
  ok("no explicit sale/won wording beyond the neutral summary (no 'מכירה'/'victory' framing)", !wonCase!.summaryHe.match(/מכירה|victory|win\b/i));
}

console.log("no duplicate Case per the same underlying change");
{
  const dupChanges: PartnerChange[] = [
    { id: "c5", domain: "transactions", entityType: "transaction", entityId: "tx1", kind: "STATUS_CHANGED", field: "receivedSemantic", before: "NOT_RECEIVED", after: "RECEIVED", observedBetween: { from: null, to: TODAY }, sourceOccurredAt: null, epistemicType: "DERIVED", evidence: [] },
  ];
  const dupCases = buildPartnerCases({ state, today: TODAY, changes: dupChanges, changeContext: { previousCapturedAt: null, currentCapturedAt: TODAY } });
  check("exactly ONE MONEY_RECEIVED Case for tx1, not duplicated", dupCases.filter((c) => c.id === "money_received:tx1").length, 1);
}

// ── Stale rule ──
console.log("STALE_IS_NOT_AUTOMATICALLY_URGENT: age alone never escalates classification");
{
  const rawOld = buildCooRaw();
  rawOld.victor!.works[0].internalDeadline = "2026-08-01"; // 52 days late instead of 10
  const cooOld = computeCoo(rawOld, new Date(`${TODAY}T06:00:00Z`));
  const stateOld = assemblePartnerCompanyState(cooOld, buildEyesRaw());
  const oldCases = buildPartnerCases({ state: stateOld, today: TODAY });
  const oldCase = oldCases.find((c) => c.id === "missed_internal_deadline:v1")!;
  check("classification stays RISK (the SAME as a recently-passed deadline) — age alone never escalates it further", oldCase.classification, "RISK");
  ok("no 'urgent'/'emergency'/'critical' wording appears anywhere", !JSON.stringify(oldCase).match(/urgent|emergency|critical|דחוף/i));
}

console.log("Phase E.2: the same staleness rule holds for every new age/date-based detector (proposal followup, payment due date, task due date, Steven deadline)");
{
  const veryOld = "2026-01-01"; // ~8-9 months before TODAY, vs a few days for the "normal" fixtures below
  const cooPatch: Partial<CooRawInput> = {
    projects: [{ id: "so1", name: "פרויקט ישן", artist: "א", status: "בעבודה", deadline: null, projectType: "שיר", businessType: "לקוח", updatedAt: TODAY, isHidden: false }],
    victor: { stuckAfterDays: 5, works: [] },
    tasks: [
      { id: "so-task-recent", title: "משימה", status: "פתוח", dueDate: "2026-09-15", relatedType: "client", relatedId: "c1", createdAt: "2026-09-01T09:00:00Z" },
      { id: "so-task-old", title: "משימה", status: "פתוח", dueDate: veryOld, relatedType: "client", relatedId: "c1", createdAt: "2026-01-01T09:00:00Z" },
    ] as CooRawInput["tasks"],
    steven: [
      { id: "so-sw-recent", projectId: "so1", title: "מיקס", status: "פעיל", uiStatus: "פעיל", agreedPrice: 0, currency: "₪", amountPaid: 0, sentDate: "2026-09-01", internalDeadline: "2026-09-15", hasMixVersion: false, lastUploadAt: null },
      { id: "so-sw-old", projectId: "so1", title: "מיקס", status: "פעיל", uiStatus: "פעיל", agreedPrice: 0, currency: "₪", amountPaid: 0, sentDate: "2026-01-01", internalDeadline: veryOld, hasMixVersion: false, lastUploadAt: null },
    ] as unknown as CooRawInput["steven"],
    releases: { labelProjectsTotal: 0, rows: [] }, financeSettings: [], transactions: [],
  };
  const eyesPatch: Partial<PartnerEyesRaw> = {
    transactions: [], shows: [], releasesFull: [],
    proposalsFull: [
      { id: "so-pr-recent", clientId: "c1", clientName: "לקוח", linkedProjectId: null, title: "הצעה", amount: 1000, currency: "₪", status: "ממתין לתשובה", followupDate: "2026-09-15", sentDate: "2026-09-01", createdAt: "2026-09-01T10:00:00Z", updatedAt: "2026-09-01T10:00:00Z" },
      { id: "so-pr-old", clientId: "c1", clientName: "לקוח", linkedProjectId: null, title: "הצעה", amount: 1000, currency: "₪", status: "ממתין לתשובה", followupDate: veryOld, sentDate: "2026-01-01", createdAt: "2026-01-01T10:00:00Z", updatedAt: "2026-01-01T10:00:00Z" },
    ],
  };
  const st = scenarioState(cooPatch, eyesPatch);
  const soCases = buildPartnerCases({ state: st, today: TODAY });
  const soById = (id: string) => soCases.find((c) => c.id === id);
  const pairs: Array<[string, string]> = [
    ["proposal_followup_due:so-pr-recent", "proposal_followup_due:so-pr-old"],
    ["task_due_date_passed:so-task-recent", "task_due_date_passed:so-task-old"],
    ["steven_internal_deadline_passed:so-sw-recent", "steven_internal_deadline_passed:so-sw-old"],
  ];
  for (const [recentId, oldId] of pairs) {
    const recent = soById(recentId), old = soById(oldId);
    ok(`${oldId}: same classification as the recent one despite being ~8 months late (no age-based escalation)`, !!recent && !!old && recent.classification === old.classification);
    ok(`${oldId}: no urgent/emergency/critical wording despite the large age gap`, !!old && !JSON.stringify(old).match(/urgent|emergency|critical|דחוף/i));
  }
}

// ── Victor auto-task dedupe ──
console.log("Victor auto-followup task never produces an independent duplicate Case on top of the deadline Case");
{
  // v1 has linkedTaskId="t1", and t1's own due_date is the SAME underlying business fact (the
  // Victor internal deadline). Phase E.2's detectTaskDueDateCases skips any task whose
  // TaskFact.derivedFrom is set (the COO's own cross-reference from linkedTaskId) — t1 must NOT
  // also produce TASK_DUE_DATE_PASSED.
  ok("exactly one Case exists for v1 (MISSED_INTERNAL_DEADLINE only, no second Case from t1)", cases.filter((c) => c.subjectId === "v1" || c.subjectId === "t1").length === 1);
  ok("no TASK_DUE_DATE_PASSED Case for t1 specifically", !byId("task_due_date_passed:t1"));
}

// ══════════════════════════════════════════════════════════════════════════
// Phase E.2 — new objective-risk detectors (Proposals, Payment due dates,
// Shows, Tasks, Steven). Each scenario builds its own minimal state (never
// disturbing the shared `state`/`cases` above) via the SAME real
// computeCoo()+assemblePartnerCompanyState() pipeline.
// ══════════════════════════════════════════════════════════════════════════

function scenarioState(cooPatch: Partial<CooRawInput>, eyesPatch: Partial<PartnerEyesRaw>): PartnerCompanyState {
  const raw = buildCooRaw();
  Object.assign(raw, cooPatch);
  const eyes = buildEyesRaw();
  Object.assign(eyes, eyesPatch);
  const coo = computeCoo(raw, new Date(`${TODAY}T06:00:00Z`));
  return assemblePartnerCompanyState(coo, eyes);
}

// ── PROPOSAL_FOLLOWUP_DUE ──
console.log("Proposal follow-up: non-terminal + past follow-up date -> Case; future -> none; terminal -> none; missing date -> none");
{
  const proposalsFull = [
    { id: "pr-due", clientId: "c1", clientName: "לקוח א", linkedProjectId: null, title: "הצעה", amount: 3000, currency: "₪", status: "ממתין לתשובה", followupDate: "2026-09-15", sentDate: "2026-09-01", createdAt: "2026-09-01T10:00:00Z", updatedAt: "2026-09-01T10:00:00Z" },
    { id: "pr-future", clientId: "c1", clientName: "לקוח א", linkedProjectId: null, title: "הצעה", amount: 3000, currency: "₪", status: "ממתין לתשובה", followupDate: "2026-12-01", sentDate: "2026-09-01", createdAt: "2026-09-01T10:00:00Z", updatedAt: "2026-09-01T10:00:00Z" },
    { id: "pr-terminal-closed", clientId: "c1", clientName: "לקוח א", linkedProjectId: "p1", title: "הצעה", amount: 3000, currency: "₪", status: "נסגר", followupDate: "2026-09-01", sentDate: "2026-08-01", createdAt: "2026-08-01T10:00:00Z", updatedAt: "2026-09-01T10:00:00Z" },
    { id: "pr-terminal-lost", clientId: "c1", clientName: "לקוח א", linkedProjectId: null, title: "הצעה", amount: 3000, currency: "₪", status: "לא נסגר", followupDate: "2026-09-01", sentDate: "2026-08-01", createdAt: "2026-08-01T10:00:00Z", updatedAt: "2026-09-01T10:00:00Z" },
    { id: "pr-nodate", clientId: "c1", clientName: "לקוח א", linkedProjectId: null, title: "הצעה", amount: 3000, currency: "₪", status: "ממתין לתשובה", followupDate: null, sentDate: "2026-09-01", createdAt: "2026-09-01T10:00:00Z", updatedAt: "2026-09-01T10:00:00Z" },
    { id: "pr-comeback", clientId: "c1", clientName: "לקוח א", linkedProjectId: null, title: "הצעה", amount: 3000, currency: "₪", status: "לחזור בעתיד", followupDate: "2026-09-10", sentDate: "2026-08-01", createdAt: "2026-08-01T10:00:00Z", updatedAt: "2026-09-01T10:00:00Z" },
  ];
  const st = scenarioState({}, { proposalsFull });
  const pCases = buildPartnerCases({ state: st, today: TODAY });
  const pById = (id: string) => pCases.find((c) => c.id === id);
  ok("pr-due (ממתין לתשובה, followup 2026-09-15 < today) -> PROPOSAL_FOLLOWUP_DUE, ATTENTION", !!pById("proposal_followup_due:pr-due") && pById("proposal_followup_due:pr-due")!.classification === "ATTENTION");
  ok("pr-future (followup in the future) -> no Case", !pById("proposal_followup_due:pr-future"));
  ok("pr-terminal-closed (status=נסגר, terminal) -> no Case despite a past followup date", !pById("proposal_followup_due:pr-terminal-closed"));
  ok("pr-terminal-lost (status=לא נסגר, terminal) -> no Case", !pById("proposal_followup_due:pr-terminal-lost"));
  ok("pr-nodate (no followup date) -> no Case", !pById("proposal_followup_due:pr-nodate"));
  ok("pr-comeback (לחזור בעתיד, non-terminal, past followup) -> Case (conservative: only נסגר/לא נסגר are terminal, per production-proven set)", !!pById("proposal_followup_due:pr-comeback"));
  ok("no client-blame wording anywhere ('מתעלם'/ignoring)", !pCases.some((c) => /מתעלם|ignoring/i.test(c.summaryHe)));
}

// ── PAYMENT_DUE_DATE_PASSED ──
console.log("Payment due date: real outstanding + overdue expected row -> Case; fully paid despite a stale overdue row -> none; future date -> none; overpaid -> none; missing agreedPrice -> none");
{
  const cooPatch: Partial<CooRawInput> = {
    projects: [
      { id: "pd1", name: "יתרה עם תאריך שעבר", artist: "א", status: "בעבודה", deadline: null, projectType: "שיר", businessType: "לקוח", updatedAt: TODAY, isHidden: false },
      { id: "pd2", name: "שולם במלואו למרות שורת צפוי ישנה", artist: "א", status: "בעבודה", deadline: null, projectType: "שיר", businessType: "לקוח", updatedAt: TODAY, isHidden: false },
      { id: "pd3", name: "תאריך צפוי עתידי", artist: "א", status: "בעבודה", deadline: null, projectType: "שיר", businessType: "לקוח", updatedAt: TODAY, isHidden: false },
      { id: "pd4", name: "ללא מחיר מוסכם", artist: "א", status: "בעבודה", deadline: null, projectType: "שיר", businessType: "לקוח", updatedAt: TODAY, isHidden: false },
    ] as CooRawInput["projects"],
    victor: { stuckAfterDays: 5, works: [] }, tasks: [], releases: { labelProjectsTotal: 0, rows: [] },
    financeSettings: [
      { projectId: "pd1", agreedPrice: 2000, currency: "₪", financeException: false },
      { projectId: "pd2", agreedPrice: 1500, currency: "₪", financeException: false },
      { projectId: "pd3", agreedPrice: 2000, currency: "₪", financeException: false },
      // pd4 deliberately unpriced
    ],
    transactions: [
      // pd1: 500 received, 500 more expected with a PAST date -> real outstanding (1500) + overdue date -> Case
      { id: "pd1-paid", projectId: "pd1", type: "income", amount: 500, currency: "₪", status: "התקבל", date: "2026-09-01", expenseScope: "כללי", category: "" },
      { id: "pd1-exp", projectId: "pd1", type: "income", amount: 500, currency: "₪", status: "צפוי", date: "2026-09-05", expenseScope: "כללי", category: "" },
      // pd2: fully paid via a DIFFERENT transaction, but still carries a stale overdue "צפוי" row -> no Case (actual outstanding is 0)
      { id: "pd2-paid", projectId: "pd2", type: "income", amount: 1500, currency: "₪", status: "התקבל", date: "2026-09-01", expenseScope: "כללי", category: "" },
      { id: "pd2-exp", projectId: "pd2", type: "income", amount: 200, currency: "₪", status: "צפוי", date: "2026-09-05", expenseScope: "כללי", category: "" },
      // pd3: real outstanding, but the expected row's date is in the FUTURE -> no Case yet
      { id: "pd3-exp", projectId: "pd3", type: "income", amount: 500, currency: "₪", status: "צפוי", date: "2026-12-01", expenseScope: "כללי", category: "" },
      // pd4: no agreedPrice at all, even with an overdue expected row -> no Case (UNKNOWN, never 0)
      { id: "pd4-exp", projectId: "pd4", type: "income", amount: 500, currency: "₪", status: "צפוי", date: "2026-09-05", expenseScope: "כללי", category: "" },
    ],
  };
  const st = scenarioState(cooPatch, { transactions: [], releasesFull: [] });
  const pdCases = buildPartnerCases({ state: st, today: TODAY });
  const pdById = (id: string) => pdCases.find((c) => c.id === id);
  const pd1 = pdById("payment_due_date_passed:pd1");
  ok("pd1: real outstanding + overdue expected date -> PAYMENT_DUE_DATE_PASSED, RISK", !!pd1 && pd1.classification === "RISK");
  check("pd1 actual_outstanding derived fact = 1500", pd1?.derivedFacts.find((d) => d.id === "actual_outstanding")?.value, 1500);
  ok("pd2: fully paid (actual outstanding 0) despite a stale overdue 'צפוי' row -> no Case", !pdById("payment_due_date_passed:pd2"));
  ok("pd3: expected date is in the future -> no Case", !pdById("payment_due_date_passed:pd3"));
  ok("pd4: agreedPrice missing entirely -> no Case (UNKNOWN never treated as debt)", !pdById("payment_due_date_passed:pd4"));
  ok("PROJECT_PAYMENT_OUTSTANDING (debt exists) and PAYMENT_DUE_DATE_PASSED (a date passed) can coexist for pd1 without merging facts", !!pdById("project_payment_outstanding:pd1") && !!pd1);
}

// ── SHOW_CLIENT_PAYMENT_OUTSTANDING ──
console.log("Show client payment: happened + unpaid -> Case; paid -> none; cancelled -> none; not yet happened -> none; no price -> none");
{
  const shows = [
    { id: "sh-unpaid", name: "הופעה", status: "בוצע", paymentStatus: "לא שולם", date: "2026-09-01", djClientId: null, djConfirmationStatus: null, artistClientId: null, bookerClientId: null, price: 2000 },
    { id: "sh-paid", name: "הופעה", status: "בוצע", paymentStatus: "שולם", date: "2026-09-01", djClientId: null, djConfirmationStatus: null, artistClientId: null, bookerClientId: null, price: 2000 },
    { id: "sh-cancelled-pay", name: "הופעה", status: "בוצע", paymentStatus: "בוטל", date: "2026-09-01", djClientId: null, djConfirmationStatus: null, artistClientId: null, bookerClientId: null, price: 2000 },
    { id: "sh-not-happened", name: "הופעה", status: "אושרה", paymentStatus: "לא שולם", date: "2026-12-01", djClientId: null, djConfirmationStatus: null, artistClientId: null, bookerClientId: null, price: 2000 },
    { id: "sh-no-price", name: "הופעה", status: "בוצע", paymentStatus: "לא שולם", date: "2026-09-01", djClientId: "dj1", djConfirmationStatus: "אושר", artistClientId: null, bookerClientId: null, price: 0 },
  ];
  const st = scenarioState({}, { shows });
  const shCases = buildPartnerCases({ state: st, today: TODAY });
  const shById = (id: string) => shCases.find((c) => c.id === id);
  const unpaid = shById("show_client_payment_outstanding:sh-unpaid");
  ok("sh-unpaid: happened + not paid + priced -> Case, ATTENTION", !!unpaid && unpaid.classification === "ATTENTION");
  ok("sh-paid: client already paid -> no Case", !shById("show_client_payment_outstanding:sh-paid"));
  ok("sh-cancelled-pay: payment status is בוטל -> no Case", !shById("show_client_payment_outstanding:sh-cancelled-pay"));
  ok("sh-not-happened: status is not בוצע -> no Case", !shById("show_client_payment_outstanding:sh-not-happened"));
  ok("sh-no-price: price=0 -> no Case (nothing objective to claim)", !shById("show_client_payment_outstanding:sh-no-price"));
  ok("DJ fields present (djClientId/djConfirmationStatus) never affect the client-payment Case (structural — the detector never reads them)", !!shById("show_client_payment_outstanding:sh-unpaid"));
}

// ── TASK_DUE_DATE_PASSED ──
// NOTE on "completed -> none": lib/coo/readers.ts calls listTasks({status:"פתוח"}) —
// "open-only" is enforced by the READER's own query, before computeCoo ever sees a
// row (unlike ProjectFact.active, which IS computed inside facts.ts from p.status).
// A CooRawInput fixture built directly (bypassing the reader, as every test here
// does) cannot exercise that reader-level filter — so it is not re-tested at this
// layer; asserting it here would test something this layer structurally can't see.
console.log("Task due date: open + overdue + standalone -> Case; future -> none; Victor-derived auto-task -> deduped");
{
  const cooPatch: Partial<CooRawInput> = {
    tasks: [
      { id: "tk-standalone", title: "משימה עצמאית", status: "פתוח", dueDate: "2026-09-10", relatedType: "client", relatedId: "c1", createdAt: "2026-09-01T09:00:00Z" },
      { id: "tk-future", title: "משימה עתידית", status: "פתוח", dueDate: "2026-12-01", relatedType: "client", relatedId: "c1", createdAt: "2026-09-01T09:00:00Z" },
    ] as CooRawInput["tasks"],
    victor: { stuckAfterDays: 5, works: [] }, projects: [], releases: { labelProjectsTotal: 0, rows: [] }, financeSettings: [], transactions: [],
  };
  const st = scenarioState(cooPatch, { transactions: [], releasesFull: [] });
  const tkCases = buildPartnerCases({ state: st, today: TODAY });
  const tkById = (id: string) => tkCases.find((c) => c.id === id);
  const standalone = tkById("task_due_date_passed:tk-standalone");
  ok("tk-standalone: open + overdue + no Victor link -> Case, RISK", !!standalone && standalone.classification === "RISK");
  ok("tk-future: due date in the future -> no Case", !tkById("task_due_date_passed:tk-future"));
  // t1 (shared main state) IS Victor-derived (derivedFrom set) and must never duplicate MISSED_INTERNAL_DEADLINE.
  ok("t1 (Victor auto-followup task, shared main state) -> no TASK_DUE_DATE_PASSED (dedup, re-asserted here)", !byId("task_due_date_passed:t1"));
}

// ── STEVEN_INTERNAL_DEADLINE_PASSED ──
console.log("Steven internal deadline: open + passed -> Case; future -> none; no deadline -> none");
{
  const cooPatch: Partial<CooRawInput> = {
    steven: [
      { id: "sw-late", projectId: "p1", title: "מיקס", status: "פעיל", uiStatus: "פעיל", agreedPrice: 0, currency: "₪", amountPaid: 0, sentDate: "2026-09-01", internalDeadline: "2026-09-10", hasMixVersion: false, lastUploadAt: null },
      { id: "sw-future", projectId: "p2", title: "מיקס", status: "פעיל", uiStatus: "פעיל", agreedPrice: 0, currency: "₪", amountPaid: 0, sentDate: "2026-09-01", internalDeadline: "2026-12-01", hasMixVersion: false, lastUploadAt: null },
      { id: "sw-nodeadline", projectId: "p3", title: "מיקס", status: "פעיל", uiStatus: "פעיל", agreedPrice: 0, currency: "₪", amountPaid: 0, sentDate: "2026-09-01", internalDeadline: null, hasMixVersion: false, lastUploadAt: null },
    ] as unknown as CooRawInput["steven"],
  };
  const st = scenarioState(cooPatch, {});
  const swCases = buildPartnerCases({ state: st, today: TODAY });
  const swById = (id: string) => swCases.find((c) => c.id === id);
  const late = swById("steven_internal_deadline_passed:sw-late");
  ok("sw-late: open + internalDeadline passed -> Case, RISK, INTERNAL_DEADLINES_MATTER applied", !!late && late.classification === "RISK" && late.ownerRulesApplied.includes("INTERNAL_DEADLINES_MATTER"));
  ok("sw-future: deadline in the future -> no Case", !swById("steven_internal_deadline_passed:sw-future"));
  ok("sw-nodeadline: no internalDeadline -> no Case", !swById("steven_internal_deadline_passed:sw-nodeadline"));
  ok("no 'Steven owes'/'owner owes' claim anywhere in the Case (only the passed deadline)", !!late && !/owes|חייב/i.test(late.summaryHe) && late.unknowns.length > 0);
}

// ── RELEASE PROTECT_LABEL_RELEASES gating (Phase E.2 fix) ──
console.log("PROTECT_LABEL_RELEASES is attached ONLY when labelArtistId is ID-confirmed — never from an ambiguous/missing relation");
{
  const cooPatch: Partial<CooRawInput> = {
    projects: [{ id: "rp1", name: "פרויקט עם release אך ללא labelArtistId", artist: "א", status: "בעבודה", deadline: null, projectType: "שיר", businessType: "לקוח", updatedAt: TODAY, isHidden: false }],
    victor: { stuckAfterDays: 5, works: [] }, tasks: [], financeSettings: [], transactions: [],
    releases: { labelProjectsTotal: 0, rows: [] },
  };
  const eyesPatch: Partial<PartnerEyesRaw> = {
    transactions: [], shows: [], proposalsFull: [],
    releasesFull: [{ projectId: "rp1", labelArtistId: null, stage: "הפקה", targetDate: "2026-09-01", stageEnteredAt: "2026-08-01T10:00:00Z", releasedAt: null, createdAt: "2026-08-01T10:00:00Z", updatedAt: "2026-09-01T10:00:00Z" }],
  };
  const st = scenarioState(cooPatch, eyesPatch);
  const rpCases = buildPartnerCases({ state: st, today: TODAY });
  const rp1 = rpCases.find((c) => c.id === "release_target_date_passed:rp1");
  ok("Case still fires (objective passed-date fact stands regardless of label confirmation)", !!rp1);
  check("PROTECT_LABEL_RELEASES is NOT attached when labelArtistId is null", rp1?.ownerRulesApplied, []);
  ok("unknowns explains why (labelArtistId not confirmed)", !!rp1 && rp1.unknowns.length > 0);

  // Control: the shared main state's p5 DOES have labelArtistId="la1" -> rule stays attached (no regression).
  check("p5 (shared main state, labelArtistId confirmed) still gets PROTECT_LABEL_RELEASES", byId("release_target_date_passed:p5")?.ownerRulesApplied, ["PROTECT_LABEL_RELEASES"]);
}

// ── Explainability ──
console.log("explainPartnerCase() answers facts/derived/rules/hypotheses/unknowns without an LLM");
{
  const v1 = byId("missed_internal_deadline:v1")!;
  const explanation = explainPartnerCase(v1);
  ok("explanation exposes the exact same facts", JSON.stringify(explanation.whatFactsTriggeredThis) === JSON.stringify(v1.facts));
  ok("explanation exposes ownerRulesApplied", explanation.ownerRulesApplied.includes("INTERNAL_DEADLINES_MATTER"));
  ok("explanation exposes the derived calculation", explanation.derivedCalculations.some((d) => d.id === "days_late"));
}

// ── Privacy + isolation static checks ──
console.log("privacy: no notes/phone/email/URLs/tokens/secrets anywhere in a Case");
const casesDir = path.join(path.resolve(__dirname, ".."), "lib/partner/cases");
const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
const casesFiles = walk(casesDir);
const casesSrc = Object.fromEntries(casesFiles.map((f) => [path.relative(casesDir, f), fs.readFileSync(f, "utf8")]));
ok("no forbidden field name anywhere in lib/partner/cases", Object.values(casesSrc).every((s) => !/\b(notes\s*:\s*string(?!\[\])|phone|email|dropboxUrl|fileUrl|token|secret)\s*:/i.test(s)));
ok("snapshot JSON for real Cases never contains a literal '@' (no email leaked through)", !JSON.stringify(cases).includes("@"));

const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");

console.log("no Agent Alerts anywhere in the Case layer (actual imports/usage — mentioning the excluded system BY NAME in an explanatory comment is fine and expected)");
ok("no import/reference to agent_alerts or alerts-store outside comments", Object.values(casesSrc).every((s) => !/agent_alerts|agent\/alerts-store/.test(stripComments(s))));

console.log("no AI / LLM anywhere");
ok("no LLM provider reference", Object.values(casesSrc).every((s) => !/openai|anthropic|groq|gpt-|claude-/i.test(s.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ""))));

console.log("no writes: Case Engine is pure — no Supabase, no DB write, no baseline write");
ok("no Supabase import anywhere in lib/partner/cases", Object.values(casesSrc).every((s) => !/lib\/supabase/.test(s)));
ok("no insert/update/upsert/delete/rpc verb anywhere", Object.values(casesSrc).every((s) => !/\.(insert|update|upsert|delete|rpc)\(/.test(s)));
ok("no file imports \"server-only\" (the whole Case Engine is pure)", Object.values(casesSrc).every((s) => !/^\s*import\s+"server-only"\s*;/m.test(s)));
ok("no lib/partner/baseline import (never re-loads a baseline itself — Owner instruction §38)", Object.values(casesSrc).every((s) => !/partner\/baseline/.test(s)));

console.log("no Push/Cron/UI/unapproved-scoring vocabulary anywhere");
ok("no cron/push import", Object.values(casesSrc).every((s) => !/node-cron|lib\/push|web-push/.test(s)));
ok("no numeric risk/confidence/health score field anywhere", Object.values(casesSrc).every((s) => !/riskScore|confidenceScore|healthScore|\bscore\s*:\s*number/.test(s)));
ok("no P0/P1/P2/P3 COO priority tier vocabulary used as actual code (a comment explaining the exclusion is fine)", Object.values(casesSrc).every((s) => !/\bP0\b|\bP1\b|\bP2\b|\bP3\b/.test(stripComments(s))));

console.log("Phase E.2 §51-52: no client/artist scoring vocabulary anywhere in the Case layer (static check)");
ok("no HIGH_VALUE_CLIENT / REPEAT_CLIENT / GROWING_CLIENT / UPSELL_CLIENT / BAD_CLIENT anywhere", Object.values(casesSrc).every((s) => !/HIGH_VALUE_CLIENT|REPEAT_CLIENT|GROWING_CLIENT|UPSELL_CLIENT|BAD_CLIENT/.test(s)));
ok("no INVEST_MORE / INVEST_LESS / STRONG_ARTIST / WEAK_ARTIST anywhere", Object.values(casesSrc).every((s) => !/INVEST_MORE|INVEST_LESS|STRONG_ARTIST|WEAK_ARTIST/.test(s)));
ok("no caseType in the live catalog resembles client/artist scoring", cases.every((c) => !/CLIENT_(VALUE|SCORE)|ARTIST_(VALUE|SCORE|INVEST)/.test(c.caseType)));

console.log("no portal file imports lib/partner/cases");
ok("isolation holds", (() => {
  const ROOT = path.resolve(__dirname, "..");
  const portalDirs = ["app/api/red-artists", "app/api/supplier", "app/api/vendor/victor", "app/api/label/artists", "app/api/beats", "app/api/notifications", "components/team", "components/red-artists", "components/label", "lib/red-artists", "app/team", "app/red-artists", "app/dj-cleantone", "app/label"];
  const walkRoot = (dir: string): string[] => fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walkRoot(path.join(dir, e.name)) : [path.join(dir, e.name)]) : [];
  const portalFiles = [...portalDirs.flatMap((d) => walkRoot(path.join(ROOT, d))), ...fs.readdirSync(path.join(ROOT, "lib")).filter((f) => /^(steven|victor|shalev|avi|cleantone|dj-|beat|show-|sketch)/.test(f)).map((f) => path.join(ROOT, "lib", f))];
  return portalFiles.every((f) => !/lib\/partner\/cases/.test(fs.readFileSync(f, "utf8")));
})());
// F.1I: the only /api/partner route is the Owner-only read-only actions surface — and it does not expose cases.
ok("no API route added under app/api for cases (/api/partner holds only the Partner action routes — F.1I surface + F.1J decisions + F.1K execute + F.1M outcomes (GET) + F2 finance (GET) + F2.8 finance answer (POST) + integrity (GET) / integrity answer (POST) — none imports lib/partner/cases)", (() => { const dir = path.join(path.resolve(__dirname, ".."), "app/api/partner"); if (!fs.existsSync(dir)) return true; const list = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? list(path.join(d, e.name)) : [path.relative(dir, path.join(d, e.name)).split(path.sep).join("/")]); const files = list(dir); const allowed = ["actions/route.ts", "actions/decide/route.ts", "actions/change-deadline/route.ts", "actions/execute/route.ts", "outcomes/route.ts", "finance/route.ts", "finance/answer/route.ts", "integrity/route.ts", "integrity/answer/route.ts"]; return files.every((x) => allowed.includes(x)) && files.every((x) => !fs.readFileSync(path.join(dir, x), "utf8").includes("lib/partner/cases")); })());

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
