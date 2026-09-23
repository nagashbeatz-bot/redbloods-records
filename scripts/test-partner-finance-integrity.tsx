/**
 * Tests — Redbloods Partner Finance Integrity + Data Rehabilitation Brain (F2.5–F2.7).
 *
 * Run with:   npx tsx scripts/test-partner-finance-integrity.tsx
 *
 * NEVER touches production: pure core on in-memory fixtures (shared production mirror), the REAL GET
 * route in-process with requireOwner() + the binding faked, react-dom/server rendering, static guards.
 * READ → DERIVE → CLASSIFY → PRIORITIZE → SURFACE only — the suite proves there is no write path.
 */
import fs from "node:fs";
import path from "node:path";
import Module from "node:module";
import { randomUUID } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
import { NextResponse } from "next/server";
import { buildFinanceBrain } from "../lib/partner/finance/core";
import { buildFinanceBrief } from "../lib/partner/finance/brief";
import { buildFinanceIntegrity, prioritize, ISSUE_TYPES, MAX_REHAB_ITEMS, MAX_SURFACED_QUESTIONS, QUESTION_OPTIONS, type RehabIssue } from "../lib/partner/finance/integrity";
import { parseFinanceBriefResponse, FINANCE_BRIEF_MAX_ITEMS, FINANCE_REHAB_MAX_ITEMS, FINANCE_REHAB_MAX_QUESTIONS, type FinanceBriefDto } from "../lib/partner/finance/dto";
import { detectChangeDerivedCases } from "../lib/partner/cases/detectors/changeDerived";
import type { PartnerCompanyState } from "../lib/partner/eyes/types";
import type { FinanceRaw } from "../lib/partner/finance/types";
import { PartnerActionsView } from "../components/partner/PartnerActionCard";
import { isAviAllowedPath, isCleantoneAllowedPath, isShalevAllowedPath, isStevenAllowedPath, isVictorAllowedPath } from "../lib/roles";
import { empty, id, productionMirror, project, tx, withPrice, work } from "./fixtures/finance-mirror";

let pass = 0, fail = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log(`  ✓ ${name}`); pass++; } else { console.log(`  ✗ ${name}\n      expected ${e}\n      actual   ${a}`); fail++; }
}
const ok = (name: string, cond: boolean) => { if (cond) { console.log(`  ✓ ${name}`); pass++; } else { console.log(`  ✗ ${name}`); fail++; } };

const NOW = new Date("2026-09-24T09:00:00Z");
const run = (raw: FinanceRaw, now: Date = NOW) => { const state = buildFinanceBrain(raw, now); const integrity = buildFinanceIntegrity(raw, state, now); return { state, integrity, brief: buildFinanceBrief(state, integrity) }; };
const issuesOf = (raw: FinanceRaw, type: string, now: Date = NOW) => run(raw, now).integrity.issues.filter((i) => i.issueType === type);
const BLAME = /שכחת|טעית|בעיה חמורה|אשמת|אשמה|הזנחת|forgot/;

// ── REAL route with requireOwner + binding faked ──
const auth = { role: "owner" as "owner" | "none" | "victor" };
const bind = { calls: 0, result: null as unknown };
const ML = Module as unknown as { _load(request: string, parent: unknown, isMain: boolean): unknown };
const origLoad = ML._load;
ML._load = function (request: string, parent: unknown, isMain: boolean) {
  if (/lib\/require-auth$/.test(request)) return { async requireOwner() { return auth.role === "owner" ? null : NextResponse.json({ error: "x" }, { status: auth.role === "none" ? 401 : 403 }); } };
  if (/partner\/finance\/server$/.test(request)) return { async getFinanceBrief() { bind.calls++; return bind.result; } };
  return origLoad.call(this, request, parent, isMain);
};

async function main() {
  const ROOT = path.resolve(__dirname, "..");
  const rd = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8");
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");

  console.log("Semantics regression (1-8)");
  {
    const s = run(empty({ transactions: [
      tx({ type: "income", status: "שולם", amount: 100 }), tx({ type: "income", status: "התקבל", amount: 200 }),
      tx({ type: "expense", status: "שולם", amount: 10 }), tx({ type: "expense", status: "התקבל", amount: 1000 }), tx({ type: "expense", status: "חלקי", amount: 20 }),
      tx({ type: "expense", status: "צפוי", amount: 30 }), tx({ type: "expense", status: "לא שולם", amount: 40 }), tx({ type: "expense", status: "בוטל", amount: 50 }),
    ] }));
    check("1-2. income שולם + התקבל received", s.state.realized.ils.cashIn, 300);
    check("3. expense שולם paid", s.state.realized.ils.cashOut, 10);
    ok("4. expense התקבל never paid (flagged as malformed finance data)", s.state.realized.ils.cashOut === 10 && s.integrity.issues.some((i) => i.issueType === "MALFORMED_FINANCE_DATA" && i.reasonCodes.includes("EXPENSE_WITH_INCOME_ONLY_STATUS")));
    check("5-8. expense חלקי / צפוי / לא שולם open (not paid), בוטל neither", s.state.openExpenses.items.map((e) => e.amount).sort((a, b) => a - b), [20, 30, 40]);
    const state = { domains: { transactions: { data: { items: [{ id: "e1", type: "expense" }] } }, shows: { data: { items: [] } }, proposalsFull: { data: { items: [] } }, releasesFull: { data: { items: [] } } } } as unknown as PartnerCompanyState;
    check("an expense never creates MONEY_RECEIVED", detectChangeDerivedCases(state, [{ id: "c", domain: "transactions", entityType: "transaction", entityId: "e1", kind: "STATUS_CHANGED", field: "receivedSemantic", before: "NOT_RECEIVED", after: "RECEIVED", observedBetween: { from: null, to: "x" }, sourceOccurredAt: null, epistemicType: "DERIVED", evidence: [] }], null).length, 0);
  }

  console.log("Historical vs post-policy (9-10)");
  {
    const old = project({ status: "הושלם", updatedAt: "2026-07-01T00:00:00Z" });
    const oldRaw = empty({ projects: [old], transactions: [tx({ projectId: old.id, scope: "project", type: "expense", amount: 650, status: "שולם", date: "2026-06-20" })] });
    check("9. a historical completed project with cost and no income is rehabilitation work (LOW, HISTORICAL)", issuesOf(oldRaw, "COMPLETED_WORK_NO_INCOME").map((i) => [i.severityBand, i.period, i.epistemicStatus]), [["LOW", "HISTORICAL", "FACT"]]);
    const neu = project({ status: "הושלם", updatedAt: "2026-09-24T08:00:00Z" });
    const newRaw = empty({ projects: [neu], financeSettings: [withPrice(neu, 4000)], transactions: [tx({ projectId: neu.id, scope: "project", type: "expense", amount: 650, status: "שולם", date: "2026-09-24" })] });
    check("10. after the policy date, a priced completed client project with no income is a HIGH integrity signal", issuesOf(newRaw, "COMPLETED_WORK_NO_INCOME").map((i) => [i.severityBand, i.period, i.reasonCodes.includes("PRICE_KNOWN_RECEIVABLE_EXISTS")]), [["HIGH", "POST_POLICY", true]]);
    const due = tx({ type: "income", amount: 1500, status: "צפוי", date: "2026-10-02", createdAt: "2026-09-25T00:00:00Z" });
    check("10. post-policy expected income past due → HIGH INCOME_EXPECTED_BUT_NOT_RECORDED (DERIVED)", issuesOf(empty({ transactions: [due] }), "INCOME_EXPECTED_BUT_NOT_RECORDED", new Date("2026-10-05T09:00:00Z")).map((i) => [i.severityBand, i.period, i.epistemicStatus]), [["HIGH", "POST_POLICY", "DERIVED"]]);
    const hist = tx({ type: "income", amount: 1500, status: "צפוי", date: "2026-09-10" });
    check("…the same gap before the policy date is MEDIUM / HISTORICAL", issuesOf(empty({ transactions: [hist] }), "INCOME_EXPECTED_BUT_NOT_RECORDED").map((i) => [i.severityBand, i.period]), [["MEDIUM", "HISTORICAL"]]);
  }

  console.log("Project finance classification (11-15)");
  {
    const client = project({ status: "בעבודה", businessType: "לקוח" });
    const label = project({ status: "בעבודה", businessType: "לייבל" });
    const unknown = project({ status: "בעבודה", businessType: null });
    const s = run(empty({ projects: [client, label, unknown] }));
    check("11. PRICE_UNKNOWN is not zero (no receivable, no debt)", [s.state.receivables.length, s.integrity.projects.map((p) => p.receivable)], [0, ["RECEIVABLE_UNKNOWN", "NOT_APPLICABLE", "RECEIVABLE_UNKNOWN"]]);
    check("12-13. client + unknown-business projects need a price; the LABEL project does not", [s.integrity.projects.map((p) => [p.business, p.price]), s.integrity.issues.filter((i) => i.issueType === "PRICE_MISSING").map((i) => i.subjectId)], [[["CLIENT", "PRICE_UNKNOWN"], ["LABEL", "NOT_APPLICABLE"], ["UNKNOWN", "PRICE_UNKNOWN"]], [client.id, unknown.id]]);
    check("a finance exception is NOT_APPLICABLE (intentional, no issue)", run(empty({ projects: [client], financeSettings: [{ projectId: client.id, value: { financeException: true } }] })).integrity.projects[0].price, "NOT_APPLICABLE");
    const done = project({ status: "הושלם", name: "שיר", updatedAt: "2026-07-01T00:00:00Z" });
    const r = run(empty({ projects: [done], transactions: [tx({ projectId: done.id, scope: "project", type: "expense", amount: 650, status: "שולם", date: "2026-07-01" })] }));
    const i = r.integrity.issues.find((x) => x.issueType === "COMPLETED_WORK_NO_INCOME")!;
    check("14. completed + recorded cost + no income → FACT with evidence (project + expense)", [i.epistemicStatus, i.reasonCodes.slice(0, 3), i.evidence.map((e) => e.sourceType)], ["FACT", ["COMPLETED", "NO_INCOME_TRANSACTION", "PAID_EXPENSE_RECORDED"], ["project", "transaction"]]);
    ok("15. no false 'unpaid' claim without price (reason + wording)", i.reasonCodes.includes("PRICE_UNKNOWN_CANNOT_CLAIM_UNPAID") && !/לא שולם|חוב|חייב/.test(i.recommendedOwnerQuestion!.textHe + r.integrity.top.items.map((x) => x.textHe).join(" ")));
    check("a completed project with no cost evidence is not flagged (not every project must show money)", issuesOf(empty({ projects: [project({ status: "הושלם" })] }), "COMPLETED_WORK_NO_INCOME").length, 0);
    check("a completed LABEL project is never flagged for missing client income", issuesOf(empty({ projects: [project({ status: "הושלם", businessType: "לייבל", id: "lp" } as never)], transactions: [tx({ projectId: "lp", scope: "project", type: "expense", amount: 100 })] }), "COMPLETED_WORK_NO_INCOME").length, 0);
    check("project profile: income / expenses / due-date states", run(empty({ projects: [done], financeSettings: [withPrice(done, 3000)], transactions: [tx({ projectId: done.id, scope: "project", amount: 1000 })], engineerWorks: [work({ projectId: done.id, amountPaid: 200, agreedPrice: 200 })] })).integrity.projects.map((p) => [p.price, p.income, p.expenses, p.receivable, p.dueDate]), [["PRICE_KNOWN", "INCOME_VISIBLE", "EXPENSES_PARTIAL", "RECEIVABLE_KNOWN", "DUE_DATE_MISSING"]]);
  }

  console.log("Orphan review queue (16-18)");
  {
    const a = randomUUID(), b = randomUUID();
    const raw = empty({ financeSettings: [{ projectId: a, value: { agreedPrice: 9000, currency: "₪" } }, { projectId: b, value: { agreedPrice: 500, currency: "₪" } }], transactions: [tx({ projectId: b, scope: "project", amount: 500 })] });
    const r = run(raw);
    check("16. orphans never count as money (cash / receivables / forecast)", [r.state.receivables.length, r.state.pacing.knownIncomingIls, r.state.expected.length], [0, 0, 0]);
    check("17. queue is evidence-first (linked records before a bigger amount) — larger is not 'more urgent'", r.integrity.orphanQueue.map((o) => [o.amount, o.txRowsForId]), [[500, 1], [9000, 0]]);
    check("18. question shape: A/B/C, UNKNOWN epistemic, NEEDS_OWNER_REVIEW", [r.integrity.orphanQueue[0].question.questionType, r.integrity.orphanQueue[0].question.options.map((o) => o.labelHe), r.integrity.issues.filter((i) => i.issueType === "ORPHAN_FINANCE_SETTING").map((i) => [i.epistemicStatus, i.reasonCodes.includes("NEEDS_OWNER_REVIEW")])], ["ORPHAN_PRICE_MEANING", ["נתון היסטורי בלבד", "עסקה אמיתית שצריך לשחזר/לקשר", "לא יודע כרגע"], [["UNKNOWN", true], ["UNKNOWN", true]]]);
    check("orphan trust state is NEEDS_OWNER_REVIEW", r.integrity.trust.orphanPriceData.state, "NEEDS_OWNER_REVIEW");
    ok("18. orphan question text", r.integrity.orphanQueue[1].question.textHe === "מצאתי מחיר ישן של ₪9,000 לפרויקט שכבר לא קיים. מה זה?");
  }

  console.log("Recurring expenses (19-23)");
  {
    const known = run(empty({ victorSalary: [{ workMonth: "2026-08", dueDate: "2026-09-10", amount: 550, currency: "$", status: "לא שולם", transactionId: null }] }));
    check("19/23. explicit recurring missing this period → RECURRING_EXPENSE_MISSING_THIS_PERIOD (HIGH, DERIVED)", known.integrity.issues.filter((i) => i.issueType === "RECURRING_EXPENSE_MISSING_THIS_PERIOD").map((i) => [i.severityBand, i.epistemicStatus, i.currency, i.amount]), [["HIGH", "DERIVED", "$", 550]]);
    const outside = run(empty({ victorSalary: [{ workMonth: "2026-08", dueDate: "2026-09-10", amount: 550, currency: "$", status: "שולם", transactionId: null }] }));
    check("19. marked paid outside Finance → EXPENSE_EXPECTED_BUT_NOT_FOUND (FACT)", outside.integrity.issues.filter((i) => i.issueType === "EXPENSE_EXPECTED_BUT_NOT_FOUND").map((i) => i.epistemicStatus), ["FACT"]);
    const rows = [["2026-06-03", 118], ["2026-07-03", 120], ["2026-08-03", 125]].map(([d, a]) => tx({ type: "expense", amount: a as number, status: "שולם", date: d as string, category: "תוכנה" }));
    const c = run(empty({ transactions: rows }));
    check("20-21. similar amounts (±10%) in ≥3 months → RECURRING_EXPENSE_CANDIDATE (HYPOTHESIS)", c.integrity.issues.filter((i) => i.issueType === "RECURRING_EXPENSE_CANDIDATE").map((i) => [i.epistemicStatus, i.amount, i.reasonCodes[1]]), [["HYPOTHESIS", 120, "MONTHS_3"]]);
    check("22. a candidate is never a committed outflow", [c.state.pacing.knownOutgoingIls, c.state.openExpenses.items.length], [0, 0]);
    const unrelated = run(empty({ transactions: [["2026-06-03", 120], ["2026-07-03", 300], ["2026-08-03", 900]].map(([d, a]) => tx({ type: "expense", amount: a as number, status: "שולם", date: d as string, category: "תוכנה" })) }));
    check("unrelated amounts under the same category are never merged", unrelated.integrity.issues.filter((i) => i.issueType === "RECURRING_EXPENSE_CANDIDATE").length, 0);
    const noCat = run(empty({ transactions: ["2026-06-03", "2026-07-03", "2026-08-03"].map((d) => tx({ type: "expense", amount: 100, status: "שולם", date: d, category: "" })) }));
    check("rows without a category are never grouped (no free-text guessing)", noCat.state.recurring.candidates.length, 0);
  }

  console.log("Expense classification (24-25)");
  {
    const r = run(empty({ transactions: [tx({ type: "expense", category: "משהו", date: "2026-09-12" }), tx({ type: "expense", category: "תוכנה", date: "2026-09-12" }), tx({ type: "expense", category: "תוכנה חדשה", date: "2026-09-12" }), tx({ type: "expense", category: "שכירות", date: "2026-09-12" })] }));
    check("24-25. only exact explicit categories classify; anything else is UNKNOWN (no fuzzy text)", r.integrity.expenseClassification.map((e) => e.category), ["UNKNOWN", "SOFTWARE", "UNKNOWN", "RENT"]);
    check("unknown classification this month → MEDIUM issue with a classification question", r.integrity.issues.filter((i) => i.issueType === "EXPENSE_CLASSIFICATION_UNKNOWN").map((i) => [i.severityBand, i.epistemicStatus, i.recommendedOwnerQuestion?.questionType]), [["MEDIUM", "UNKNOWN", "EXPENSE_CLASSIFICATION"], ["MEDIUM", "UNKNOWN", "EXPENSE_CLASSIFICATION"]]);
    const p = project();
    check("explicit links win (project / show payout / clip)", run(empty({ projects: [p], transactions: [tx({ type: "expense", projectId: p.id, scope: "project" }), tx({ type: "expense", expenseScope: "קליפ" })] })).integrity.expenseClassification.map((e) => [e.category, e.basis]), [["PROJECT_COST", "LINKED_TO_PROJECT"], ["VIDEO_PHOTO", "CLIP_SCOPE"]]);
  }

  console.log("Due dates / overdue reasons / expected income (26-32)");
  {
    const p = project({ status: "הושלם", name: "מראות" });
    const r = run(empty({ projects: [p], financeSettings: [withPrice(p, 3200)], transactions: [tx({ projectId: p.id, scope: "project", amount: 1600 })] }));
    check("26. known balance without a due date → RECEIVABLE_DUE_DATE_MISSING", r.integrity.issues.filter((i) => i.issueType === "RECEIVABLE_DUE_DATE_MISSING").map((i) => [i.amount, i.epistemicStatus, i.severityBand]), [[1600, "FACT", "MEDIUM"]]);
    check("27. due-date question generated (no date created)", [r.integrity.dueDateQueue.length, r.integrity.issues.find((i) => i.issueType === "RECEIVABLE_DUE_DATE_MISSING")?.recommendedOwnerQuestion?.textHe], [1, "יש יתרה של ₪1,600 בפרויקט 'מראות' בלי תאריך גבייה. מתי אמורים לגבות?"]);
    const settled = run(empty({ projects: [p], financeSettings: [withPrice(p, 1600)], transactions: [tx({ projectId: p.id, scope: "project", amount: 1600 })] }));
    check("28. a settled receivable is never queued", [settled.integrity.dueDateQueue.length, settled.integrity.issues.filter((i) => i.issueType === "RECEIVABLE_DUE_DATE_MISSING").length], [0, 0]);
    const over = run(empty({ transactions: [tx({ type: "income", amount: 800, status: "צפוי", date: "2026-09-15" })] }));
    const oi = over.integrity.issues.find((i) => i.issueType === "OVERDUE_RECEIVABLE_REASON_UNKNOWN")!;
    check("29. overdue → reason UNKNOWN (never invented)", [oi.epistemicStatus, over.integrity.overdueReasonGaps.map((g) => g.reason)], ["UNKNOWN", ["OVERDUE_REASON_UNKNOWN"]]);
    check("30. future-compatible reason question shape (codes + Hebrew)", QUESTION_OPTIONS.WHY_PAYMENT_OPEN.map((o) => [o.code, o.labelHe]), [["WAITING_ON_CLIENT", "מחכה ללקוח"], ["NEW_DATE_PROMISED", "הבטיח תאריך חדש"], ["DISPUTE", "יש מחלוקת"], ["WAITING_ON_DELIVERY", "מחכה למסירה"], ["AGREED_TO_POSTPONE", "סיכמנו לדחות"], ["OTHER", "אחר"], ["UNKNOWN", "לא יודע"]]);
    const pp = project();
    const expected = tx({ projectId: pp.id, scope: "project", type: "income", amount: 1200, status: "צפוי", date: "2026-09-20" });
    check("31. expected income due with no received record → signal", issuesOf(empty({ projects: [pp], transactions: [expected] }), "INCOME_EXPECTED_BUT_NOT_RECORDED").length, 1);
    const replacement = tx({ projectId: pp.id, scope: "project", type: "income", amount: 1200, status: "התקבל", date: "2026-09-19" });
    check("32. a received replacement record closes the signal", issuesOf(empty({ projects: [pp], transactions: [expected, replacement] }), "INCOME_EXPECTED_BUT_NOT_RECORDED").length, 0);
  }

  console.log("Duplicates / overlaps / currency (33-36)");
  {
    const p = project();
    const raw = empty({ projects: [p], transactions: [0, 1].map(() => tx({ projectId: p.id, scope: "project", type: "expense", amount: 100, date: "2026-08-01", category: "YouTube" })) });
    const snapshot = JSON.stringify(raw);
    const r = run(raw);
    check("33. duplicate-looking records → one HYPOTHESIS issue and nothing mutated", [r.integrity.issues.filter((i) => i.issueType === "POSSIBLE_DUPLICATE").map((i) => i.epistemicStatus), JSON.stringify(raw) === snapshot], [["HYPOTHESIS"], true]);
    const q = project();
    const ov = run(empty({ projects: [q], engineerWorks: [work({ projectId: q.id, agreedPrice: 300 })], transactions: [tx({ projectId: q.id, scope: "project", type: "expense", amount: 300, currency: "$", status: "לא שולם", date: null, category: "מיקס / מאסטר" })] }));
    check("34. obligation overlap flagged, counted once", [ov.state.openExpenses.totalsByCurrency, ov.integrity.issues.filter((i) => i.issueType === "POSSIBLE_OBLIGATION_OVERLAP").map((i) => [i.epistemicStatus, i.reasonCodes.includes("COUNTED_ONCE")])], [{ $: 300 }, [["HYPOTHESIS", true]]]);
    const s = tx({ type: "expense", amount: 650, status: "שולם", date: "2026-07-05" });
    const cur = run(empty({ transactions: [s], engineerWorks: [work({ agreedPrice: 200, amountPaid: 200, linkedTransactionId: s.id })] }));
    check("35. currency ambiguity preserved (USD work settled in ILS)", cur.integrity.issues.filter((i) => i.issueType === "CURRENCY_AMBIGUOUS").map((i) => i.reasonCodes), [["WORK_IN_$_TRANSACTION_IN_₪", "NO_APPROVED_FX_POLICY"]]);
    check("36. no FX conversion (currencies stay separate)", run(empty({ transactions: [tx({ amount: 100, currency: "$" }), tx({ amount: 100 })] })).state.realized.byCurrency, { $: { cashIn: 100, cashOut: 0, net: 100 }, "₪": { cashIn: 100, cashOut: 0, net: 100 } });
  }

  console.log("Prioritizer (37-40)");
  {
    const prod = run(productionMirror(), new Date("2026-09-23T09:00:00Z"));
    check("37. at most 3 rehab items", [prod.integrity.top.items.length <= MAX_REHAB_ITEMS, MAX_REHAB_ITEMS, FINANCE_REHAB_MAX_ITEMS], [true, 3, 3]);
    const post = tx({ type: "income", amount: 500, status: "צפוי", date: "2026-10-02", createdAt: "2026-09-25T00:00:00Z" });
    const mixed = run(empty({ transactions: [post], financeSettings: Array.from({ length: 5 }, () => ({ projectId: randomUUID(), value: { agreedPrice: 50000, currency: "₪" } })) }), new Date("2026-10-05T09:00:00Z"));
    check("38. a post-policy integrity signal outranks even large historical orphans", mixed.integrity.top.items[0].issueType, "INCOME_EXPECTED_BUT_NOT_RECORDED");
    const coll = run(empty({ transactions: [tx({ type: "income", amount: 800, status: "צפוי", date: "2026-09-15" }), ...["2026-06-03", "2026-07-03", "2026-08-03"].map((d) => tx({ type: "expense", amount: 100, status: "שולם", date: d, category: "תוכנה" }))] }));
    ok("39. an active collection outranks a vague recurring hypothesis", coll.integrity.top.items.findIndex((i) => i.issueType === "OVERDUE_RECEIVABLE_REASON_UNKNOWN" || i.issueType === "INCOME_EXPECTED_BUT_NOT_RECORDED") < coll.integrity.top.items.findIndex((i) => i.issueType === "RECURRING_EXPENSE_CANDIDATE"));
    check("40. at most 2 surfaced questions (distinct types)", [prod.integrity.top.questions.length <= MAX_SURFACED_QUESTIONS, new Set(prod.integrity.top.questions.map((q) => q.questionType)).size === prod.integrity.top.questions.length, FINANCE_REHAB_MAX_QUESTIONS], [true, true, 2]);
    const many: RehabIssue[] = ISSUE_TYPES.map((t) => ({ id: t, issueType: t, severityBand: "MEDIUM", epistemicStatus: "FACT", subjectType: "company", subjectId: t, subjectLabel: "x", currency: "₪", amount: 1, date: "2026-09-10", period: "HISTORICAL", reasonCodes: [], evidence: [], recommendedOwnerQuestion: null }));
    check("prioritizer caps any input at 3 items / 2 questions", [prioritize(many).items.length, prioritize(many).questions.length <= 2], [3, true]);
  }

  console.log("Evidence + epistemic discipline (41-42)");
  {
    const prod = run(productionMirror(), new Date("2026-09-23T09:00:00Z"));
    ok("41. every issue retains evidence", prod.integrity.issues.every((i) => i.evidence.length > 0));
    ok("41. every issue carries the required fields", prod.integrity.issues.every((i) => i.issueType && i.severityBand && i.epistemicStatus && i.subjectType && i.subjectId && Array.isArray(i.reasonCodes) && "currency" in i && "amount" in i && "date" in i && "recommendedOwnerQuestion" in i));
    const kinds = new Set(prod.integrity.issues.map((i) => i.epistemicStatus));
    ok("42. FACT / DERIVED(or UNKNOWN) / HYPOTHESIS preserved (never flattened)", kinds.has("FACT") && kinds.has("UNKNOWN") && kinds.has("HYPOTHESIS"));
    check("42. orphans are UNKNOWN, duplicates HYPOTHESIS, price gaps FACT", ["ORPHAN_FINANCE_SETTING", "POSSIBLE_DUPLICATE", "PRICE_MISSING"].map((t) => [...new Set(prod.integrity.issues.filter((i) => i.issueType === t).map((i) => i.epistemicStatus))]), [["UNKNOWN"], ["HYPOTHESIS"], ["FACT"]]);
  }

  console.log("64-67. production mirror → exact composition");
  {
    const prod = run(productionMirror(), new Date("2026-09-23T09:00:00Z"));
    check("64. rehab items (צריך ממך)", prod.brief.rehab.items, [
      { issueType: "EXPENSE_EXPECTED_BUT_NOT_FOUND", epistemic: "FACT", textHe: "משכורת Victor עבור אוגוסט 2026 מסומנת כשולמה, אבל לא מצאתי לה רישום בכספים." },
      { issueType: "RECEIVABLE_DUE_DATE_MISSING", epistemic: "FACT", textHe: "יש יתרה של ₪1,600 בלי תאריך גבייה. צריך לקבוע תאריך גבייה." },
      { issueType: "COMPLETED_WORK_NO_INCOME", epistemic: "FACT", textHe: "8 פרויקטים שהסתיימו עם הוצאה מתועדת, אבל אני לא רואה בהם הכנסה. צריך בירור." },
    ]);
    check("64. surfaced questions (2)", prod.brief.rehab.questions.map((q) => [q.questionType, q.options.length]), [["RECURRING_EXPENSE_RECORD", 3], ["DUE_DATE_FOR_BALANCE", 5]]);
    check("65. main brief keeps money status, no duplicates of 'צריך ממך'", prod.brief.items.map((i) => i.family), ["UPCOMING_COLLECTION", "COMMITTED_EXPENSE", "REVENUE_OPPORTUNITY"]);
    ok("65/66. main ≤5, rehab ≤3, questions ≤2", prod.brief.items.length <= FINANCE_BRIEF_MAX_ITEMS && prod.brief.rehab.items.length <= 3 && prod.brief.rehab.questions.length <= 2);
    check("F2 numbers unchanged (₪ in 2,700 / out 500 / net 2,200; position 3,100)", [prod.state.realized.ils, prod.state.pacing.knownMonthEndPositionIls], [{ cashIn: 2700, cashOut: 500, net: 2200 }, 3100]);
    check("F2 brief without an integrity state is unchanged (rehab empty)", [buildFinanceBrief(prod.state).items.map((i) => i.family), buildFinanceBrief(prod.state).rehab], [["FINANCIAL_DATA_BLOCKER", "UPCOMING_COLLECTION", "COLLECTION_NO_DATE", "COMMITTED_EXPENSE", "MISSING_EXPECTED_RECORD"], { items: [], questions: [] }]);
    const allText = [...prod.integrity.issues.map((i) => i.recommendedOwnerQuestion?.textHe ?? ""), ...prod.integrity.questions.map((q) => q.textHe + q.whyItMattersHe), ...prod.brief.rehab.items.map((i) => i.textHe), ...prod.brief.items.map((i) => i.textHe)].join(" ");
    ok("67. no blame wording anywhere", !BLAME.test(allText));
    ok("coverage reasons are given as reasons (no percentage score)", prod.integrity.coverageReasonsHe.length > 0 && !/%|אחוז|ציון/.test(prod.integrity.coverageReasonsHe.join(" ")));
    ok("calm line only when nothing needs the Owner", prod.brief.calmHe === null && run(empty({ transactions: [tx({ date: "2026-10-02", amount: 25000 })] }), new Date("2026-10-05T09:00:00Z")).brief.calmHe !== null);
  }

  console.log("DTO / route (43-46)");
  {
    const prod = run(productionMirror(), new Date("2026-09-23T09:00:00Z")).brief;
    const b = JSON.parse(JSON.stringify(prod));
    check("46. strict parser accepts v2 with rehab", parseFinanceBriefResponse(b).ok, true);
    check("46. forged rehab payloads fail closed", [
      parseFinanceBriefResponse({ ...b, rehab: { ...b.rehab, items: [...b.rehab.items, { issueType: "PRICE_MISSING", epistemic: "FACT", textHe: "x" }] } }).ok,
      parseFinanceBriefResponse({ ...b, rehab: { ...b.rehab, questions: [...b.rehab.questions, b.rehab.questions[0]] } }).ok,
      parseFinanceBriefResponse({ ...b, rehab: { items: b.rehab.items, questions: [{ ...b.rehab.questions[0], options: ["only one"] }] } }).ok,
      parseFinanceBriefResponse({ ...b, rehab: { items: [{ ...b.rehab.items[0], epistemic: "SURE" }], questions: [] } }).ok,
      parseFinanceBriefResponse({ ...b, rehab: { items: [], questions: [], extra: 1 } }).ok,
      parseFinanceBriefResponse({ ...b, rehab: undefined }).ok,
      parseFinanceBriefResponse({ ...b, v: 1 }).ok,
      parseFinanceBriefResponse({ ...b, items: [], rehab: { items: [], questions: [] }, calmHe: null }).ok,
    ], [false, false, false, false, false, false, false, false]);
    const route = require("../app/api/partner/finance/route") as { GET(): Promise<Response> }; // eslint-disable-line @typescript-eslint/no-require-imports
    bind.result = { status: "OK", brief: prod, state: {}, integrity: {} };
    auth.role = "none"; bind.calls = 0;
    check("43. Owner auth required (401, nothing computed)", [(await route.GET()).status, bind.calls], [401, 0]);
    auth.role = "victor";
    check("44. non-owner blocked (403)", [(await route.GET()).status, bind.calls], [403, 0]);
    check("44. no non-owner role may reach /api/partner/finance", [isVictorAllowedPath, isStevenAllowedPath, isShalevAllowedPath, isCleantoneAllowedPath, isAviAllowedPath].map((f) => f("/api/partner/finance")), [false, false, false, false, false]);
    auth.role = "owner";
    const res = await route.GET();
    check("43. Owner → 200 v2 brief", [res.status, parseFinanceBriefResponse(await res.json()).ok], [200, true]);
    ok("45. GET only", !/export (async )?function (POST|PUT|PATCH|DELETE)/.test(rd("app/api/partner/finance/route.ts")));
  }

  console.log("ZERO write paths (47-58)");
  {
    const FILES = ["lib/partner/finance/integrity.ts", "lib/partner/finance/core.ts", "lib/partner/finance/brief.ts", "lib/partner/finance/dto.ts", "lib/partner/finance/server.ts", "lib/partner/finance/readers.ts", "components/partner/PartnerFinanceBrief.tsx", "app/api/partner/finance/route.ts"];
    const src = FILES.map((f) => strip(rd(f)));
    ok("47-49. no insert / update / upsert / delete (transactions, settings)", src.every((s) => !/\.insert\(|\.update\(|\.upsert\(|\.delete\(/.test(s)));
    ok("50. no Action Event write / decision / execution", src.every((s) => !/partner_action_events|appendDecision|decideSuggestedAction|executeApprovedAction|event-store/.test(s)));
    ok("51. no Owner Context write", src.every((s) => !/appendOwnerContext|context-store|context-persistence|partner_owner_context/.test(s)));
    ok("52. no Feedback write", src.every((s) => !/feedback\/|partner_feedback/.test(s)));
    ok("53. no baseline write", src.every((s) => !/savePartnerBaseline|baseline\/|partner_change_baseline/.test(s)));
    ok("54. no project mutation", src.every((s) => !/updateProject|projects-store|\/api\/projects/.test(s)));
    ok("55. no RPC", src.every((s) => !/\.rpc\(|partner_execute_update_project_deadline/.test(s)));
    ok("56-58. no Push / Cron / Agent Alerts", src.every((s) => !/web-push|lib\/push|node-cron|cron|agent_alerts|alerts-store|lib\/agent\//i.test(s)));
    ok("the integrity core is pure (no supabase / server-only / clock)", !/lib\/supabase|server-only|new Date\(\)|Date\.now\(/.test(strip(rd("lib/partner/finance/integrity.ts"))));
    ok("the integrity layer reuses the Finance Brain validation (no second copy of the status rules)", /import \{ RECORDING_POLICY_START, validateTx, type ValidatedTx \} from "\.\/core";/.test(rd("lib/partner/finance/integrity.ts")) && !/isReceivedStatus|"שולם", "התקבל"/.test(strip(rd("lib/partner/finance/integrity.ts"))));
    ok("the UI rehab section is read-only (no buttons / handlers / hooks / fetch)", !/<button|onClick|onChange|useState|useEffect|fetch\(/.test(strip(rd("components/partner/PartnerFinanceBrief.tsx"))));
  }

  console.log("UI (59-63)");
  {
    const prod = run(productionMirror(), new Date("2026-09-23T09:00:00Z")).brief;
    const d = renderToStaticMarkup(<PartnerActionsView items={[]} isMobile={false} finance={prod} />);
    const m = renderToStaticMarkup(<PartnerActionsView items={[]} isMobile={true} finance={prod} />);
    ok("59-60. Hebrew RTL, 'צריך ממך' region inside 'כסף'", /<section dir="rtl" lang="he"/.test(d) && d.includes(">צריך ממך</h4>") && /aria-label="צריך ממך"/.test(d) && d.indexOf(">כסף</h3>") < d.indexOf(">צריך ממך</h4>"));
    check("rendered counts: 3 main items, 3 rehab items, 2 questions, options as plain text (no buttons / inputs)", [(d.match(/data-finance-item=/g) ?? []).length, (d.match(/data-rehab-item=/g) ?? []).length, (d.match(/data-rehab-question=/g) ?? []).length, (d.match(/<button|<input|<a /g) ?? []).length], [3, 3, 2, 0]);
    ok("61. desktop row summary", /data-finance-summary="true" style="display:flex;flex-direction:row/.test(d));
    ok("62. mobile stacked summary", /data-finance-summary="true" style="display:flex;flex-direction:column/.test(m));
    ok("questions are clearly not answerable here yet", d.includes("עדיין אי אפשר לענות כאן"));
    check("63. loading / error → nothing rendered (fail closed)", renderToStaticMarkup(<PartnerActionsView items={[]} isMobile={false} finance={null} />), "");
    const noRehab: FinanceBriefDto = { ...prod, rehab: { items: [], questions: [] } };
    ok("no 'צריך ממך' block when there is nothing to ask", !renderToStaticMarkup(<PartnerActionsView items={[]} isMobile={false} finance={noRehab} />).includes("צריך ממך"));
  }

  const self = fs.readFileSync(__filename, "utf8");
  ok("this test never imports a production binding", !/from\s+["'][^"']*(lib\/supabase|finance\/server|require-auth|vendor-store)["']/.test(self));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
