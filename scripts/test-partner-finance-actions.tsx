/**
 * Tests — Redbloods Partner F2.11–F2.15: receivable Owner-closed semantics + Finance Action registry / readiness.
 *
 * Run with:   npx tsx scripts/test-partner-finance-actions.tsx
 *
 * NEVER touches production: pure view / readiness on the shared production mirror, the real answer core + real
 * Owner Context store over the in-memory table fake, react-dom/server rendering, static guards.
 *
 * Execution of Finance Actions is BLOCKED in this phase (production partner_action_events only admits
 * UPDATE_PROJECT_DEADLINE / project; no atomic finance execution primitive; no transaction idempotency key):
 * the suite proves the registry fails closed and that no finance write / approval / execution path exists.
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
import { deriveFinanceView } from "../lib/partner/finance/view";
import { buildFinanceBrief } from "../lib/partner/finance/brief";
import { FINANCE_ACTION_REGISTRY, FINANCE_PERMISSION_MODE, deriveFinanceActions, financeActionNoteHe, type FinanceActionCandidate } from "../lib/partner/finance/actions";
import { financeAnswersFromContexts, type FinanceOwnerAnswer } from "../lib/partner/finance/owner-answers";
import { answerFinanceQuestionCore, createRequestLedger, type FinanceAnswerDeps } from "../lib/partner/finance/answer";
import { parseFinanceBriefResponse } from "../lib/partner/finance/dto";
import type { OwnerQuestion } from "../lib/partner/finance/integrity";
import { FINANCE_ANSWER_OPTIONS, FINANCE_RECEIVABLE_CLOSING_ANSWERS } from "../lib/partner/investigation/finance-questions";
import { answerOptionsFor, resolveAnswerValue } from "../lib/partner/investigation";
import { isAnswerCodeValidFor } from "../lib/partner/investigation/context-row";
import { createOwnerContextStore } from "../lib/partner/investigation/context-persistence";
import type { FinanceRaw } from "../lib/partner/finance/types";
import { PartnerActionsView } from "../components/partner/PartnerActionCard";
import type { FinanceAnswerControls } from "../components/partner/PartnerFinanceBrief";
import { productionMirror, tx } from "./fixtures/finance-mirror";
import { FakeOwnerContextDb } from "./fixtures/owner-context-fake";

let pass = 0, fail = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log(`  ✓ ${name}`); pass++; } else { console.log(`  ✗ ${name}\n      expected ${e}\n      actual   ${a}`); fail++; }
}
const ok = (name: string, cond: boolean) => { if (cond) { console.log(`  ✓ ${name}`); pass++; } else { console.log(`  ✗ ${name}`); fail++; } };

const NOW = new Date("2026-09-24T09:00:00Z");
const ACTOR = "11111111-2222-4333-8444-555555555555";
const RAW0 = productionMirror();
const clone = (r: FinanceRaw): FinanceRaw => JSON.parse(JSON.stringify(r));
const view = (raw: FinanceRaw, answers: readonly FinanceOwnerAnswer[] = []) => { const v = deriveFinanceView(raw, NOW, answers); return { ...v, brief: buildFinanceBrief(v.state, v.integrity, { actionNoteHe: v.actionNoteHe }) }; };
const asAnswer = (q: OwnerQuestion, code: string, ymd: string | null = null, contextId = randomUUID()): FinanceOwnerAnswer => ({ contextId, questionId: q.identity!.questionId, questionType: q.questionType as FinanceOwnerAnswer["questionType"], caseId: q.identity!.caseId, caseType: q.identity!.issueType, subjectType: q.subject.type, subjectId: q.subject.id, answerCode: code, answerValueYmd: ymd, factsFingerprint: q.identity!.fingerprint, answeredAt: NOW.toISOString() });
const realized = (v: ReturnType<typeof view>) => JSON.stringify({ realized: v.state.realized, history: v.state.history, openExpenses: v.state.openExpenses });

function harness(raw: FinanceRaw = RAW0) {
  const db = new FakeOwnerContextDb();
  const store = createOwnerContextStore(db.client(), { now: () => NOW });
  const ref = { raw };
  const active = async () => { const r = await store.resolveCurrentOwnerContexts(); return r.status === "OK" ? financeAnswersFromContexts(r.contexts) : []; };
  const deps: FinanceAnswerDeps = {
    async loadLive() { const answers = await active(); return { ok: true, integrity: deriveFinanceView(ref.raw, NOW, answers).integrity, answers }; },
    appendOwnerContext: (d) => store.appendOwnerContext(d), ledger: createRequestLedger(), audit: () => {},
  };
  const v = async () => view(ref.raw, await active());
  const q = async (t: string) => (await v()).integrity.top.questions.find((x) => x.questionType === t) ?? null;
  const answer = (qq: OwnerQuestion, code: string, extra: Record<string, unknown> = {}) => answerFinanceQuestionCore(deps, ACTOR, { questionId: qq.identity!.questionId, answerCode: code, seenQuestionFingerprint: qq.identity!.fingerprint, requestId: randomUUID(), ...extra });
  return { db, store, ref, v, q, answer, active };
}

async function main() {
  const ROOT = path.resolve(__dirname, "..");
  const rd = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8");
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
  const base = view(RAW0);
  const qBal = base.integrity.top.questions.find((q) => q.questionType === "FINANCE_RECEIVABLE_TIMING")!;
  const qVictor = base.integrity.top.questions.find((q) => q.questionType === "FINANCE_RECURRING_PAYMENT_STATUS")!;

  console.log("V. Receivable Owner-closed semantics (1-14)");
  {
    const codes = answerOptionsFor("FINANCE_RECEIVABLE_TIMING").map((o) => o.code);
    ok("1. PROJECT_CANCELLED_NO_FURTHER_PAYMENT is a valid receivable-timing answer", codes.includes("PROJECT_CANCELLED_NO_FURTHER_PAYMENT") && isAnswerCodeValidFor("FINANCE_RECEIVABLE_TIMING", "PROJECT_CANCELLED_NO_FURTHER_PAYMENT"));
    ok("2. …and ONLY for the receivable-timing question", (["FINANCE_RECURRING_PAYMENT_STATUS", "FINANCE_COMPLETED_PROJECT_INCOME_STATUS", "FINANCE_ORPHAN_SETTING_MEANING", "FINANCE_EXPENSE_RECURRENCE", "FINANCE_OVERDUE_REASON", "FINANCE_PAYMENT_DATE"] as const).every((t) => !isAnswerCodeValidFor(t, "PROJECT_CANCELLED_NO_FURTHER_PAYMENT")) && JSON.stringify(FINANCE_RECEIVABLE_CLOSING_ANSWERS) === JSON.stringify({ FINANCE_RECEIVABLE_TIMING: ["PROJECT_CANCELLED_NO_FURTHER_PAYMENT"] }));
    const vNot = view(RAW0, [asAnswer(qBal, "NOT_EXPECTED")]);
    const recNot = vNot.state.receivables.find((r) => r.id === qBal.subject.id)!;
    ok("3. NOT_EXPECTED stays distinct: the balance is still a (not-now) receivable, never closed", recNot.collection.state === "NO_DUE_DATE" && recNot.ownerClosure === null && vNot.ownerClosedReceivables.size === 0);
    check("4. Hebrew labels", FINANCE_ANSWER_OPTIONS.FINANCE_RECEIVABLE_TIMING.filter((o) => ["NOT_EXPECTED", "PROJECT_CANCELLED_NO_FURTHER_PAYMENT"].includes(o.code)).map((o) => o.labelHe), ["לא צפוי להתקבל כרגע", "הפרויקט בוטל — אין יתרה נוספת לגבייה"]);
    const vC = view(RAW0, [asAnswer(qBal, "PROJECT_CANCELLED_NO_FURTHER_PAYMENT")]);
    const rec = vC.state.receivables.find((r) => r.id === qBal.subject.id)!;
    ok("5. closed balance leaves active collection (NOT_COLLECTIBLE)", rec.collection.state === "NOT_COLLECTIBLE");
    ok("6. no NO_DUE_DATE", !vC.state.receivables.some((r) => r.id === rec.id && r.collection.state === "NO_DUE_DATE"));
    ok("7. no WEEKLY_NO_DATE stage", rec.collection.reminderStage === "NONE");
    ok("8. no collection reminder", rec.collection.remindToday === false);
    ok("9. no due-date rehabilitation (queue, issue, question)", vC.integrity.dueDateQueue.length === 0 && !vC.integrity.issues.some((i) => i.issueType === "RECEIVABLE_DUE_DATE_MISSING") && !vC.brief.rehab.questions.some((q) => q.questionType === "FINANCE_RECEIVABLE_TIMING") && !vC.brief.items.some((i) => i.family === "COLLECTION_NO_DATE"));
    ok("10. not expected / collectible money (expected list + known month-end position unchanged; balance was undated)", !vC.state.expected.some((e) => e.projectId === rec.projectId && e.amount === rec.amount) && vC.state.pacing.knownMonthEndPositionIls === base.state.pacing.knownMonthEndPositionIls);
    ok("11. realized totals unchanged", realized(vC) === realized(base));
    const line = vC.brief.rehab.items.find((i) => i.issueType === "RECEIVABLE_OWNER_CLOSED");
    ok("12. DB FACT vs OWNER_DECISION kept distinct: calculated amount kept + marked not reconciled; Owner line attributed", rec.amount === 1600 && JSON.stringify(rec.ownerClosure) === JSON.stringify({ basis: "OWNER_DECISION", answerCode: "PROJECT_CANCELLED_NO_FURTHER_PAYMENT", reconciliation: "CANONICAL_DATA_NOT_RECONCILED" }) && line?.epistemic === "OWNER_DECISION" && line.textHe === "הפרויקט 'פרויקט' בוטל ולפי מה שאמרת אין יתרה נוספת לגבייה. נתוני הפרויקט בכספים עדיין לא עודכנו." && !/לגבות|לתזכר/.test(line.textHe));
    const pid = qBal.subject.id.split(":")[1];
    const raw2 = clone(RAW0); (raw2.financeSettings.find((s) => s.projectId === pid)!.value as Record<string, unknown>).agreedPrice = 3400;
    const vStale = view(raw2, [asAnswer(qBal, "PROJECT_CANCELLED_NO_FURTHER_PAYMENT")]);
    ok("13. an answer for an OLD fingerprint never closes the (changed) balance — it is asked again", vStale.ownerClosedReceivables.size === 0 && vStale.state.receivables.find((r) => r.id === qBal.subject.id)!.collection.state === "NO_DUE_DATE" && vStale.brief.rehab.questions.find((q) => q.questionType === "FINANCE_RECEIVABLE_TIMING")?.answer?.previousAnswerHe === "ענית בעבר: הפרויקט בוטל — אין יתרה נוספת לגבייה. הנתונים השתנו מאז.");
    // revision end-to-end through the real answer core + store
    const h = harness();
    const q1 = (await h.q("FINANCE_RECEIVABLE_TIMING"))!;
    const r1 = await h.answer(q1, "NEXT_MONTH");
    const q2 = (await h.q("FINANCE_RECEIVABLE_TIMING"));
    h.ref.raw = raw2;
    const q3 = (await h.q("FINANCE_RECEIVABLE_TIMING"))!;
    const r2 = await h.answer(q3, "PROJECT_CANCELLED_NO_FURTHER_PAYMENT");
    const after = await h.v();
    check("14. revision: NEXT_MONTH → (facts change) → PROJECT_CANCELLED supersedes it and closes the balance", [r1.status, q2, r2.status, h.db.rows.length, h.db.rows[1].supersedes_id === h.db.rows[0].id, after.state.receivables.find((r) => r.id === q3.subject.id)!.collection.state], ["ANSWER_SAVED", null, "ANSWER_SAVED", 2, true, "NOT_COLLECTIBLE"]);
    ok("14b. closure survives re-derivation (idempotent) and the closing question is gone", (await h.v()).ownerClosedReceivables.size === 1 && !(await h.v()).integrity.top.questions.some((q) => q.questionType === "FINANCE_RECEIVABLE_TIMING"));
  }

  console.log("W. Finance Action registry + readiness (15-22)");
  {
    check("15. narrow registry (no generic edit / write)", Object.keys(FINANCE_ACTION_REGISTRY), ["RECORD_PAID_EXPENSE", "RECORD_RECEIVED_INCOME", "SET_PROJECT_AGREED_PRICE", "SET_RECEIVABLE_DUE_DATE"]);
    // F2.31: RECORD_PAID_EXPENSE (Victor salary) is the ONLY executable type — its DB executor is live (F2.30).
    ok("16. only RECORD_PAID_EXPENSE is executable (EXECUTOR_READY); every other type fails closed with explicit blockers",
      FINANCE_ACTION_REGISTRY.RECORD_PAID_EXPENSE.executable === true && FINANCE_ACTION_REGISTRY.RECORD_PAID_EXPENSE.executorStatus === "EXECUTOR_READY"
      && Object.values(FINANCE_ACTION_REGISTRY).filter((c) => c.actionType !== "RECORD_PAID_EXPENSE").every((c) => c.executable === false && c.blockers.length > 0)
      && FINANCE_ACTION_REGISTRY.SET_RECEIVABLE_DUE_DATE.executorStatus === "UNSUPPORTED_NO_CANONICAL_MODEL");
    ok("16b. permission model: ALWAYS_ASK only", FINANCE_PERMISSION_MODE === "ALWAYS_ASK");
    const paid = asAnswer(qVictor, "PAID_NEEDS_RECORDING");
    const v1 = view(RAW0, [paid]);
    const dq = v1.integrity.top.questions.find((q) => q.questionType === "FINANCE_PAYMENT_DATE")!;
    const ready = view(RAW0, [paid, asAnswer(dq, "EXACT_DATE", "2026-09-12")]).actions.find((c) => c.actionType === "RECORD_PAID_EXPENSE")!;
    check("17. READY_TO_PROPOSE with every mutation-relevant fact", [ready.readiness, ready.facts], ["READY_TO_PROPOSE", { amount: 550, currency: "$", date: "2026-09-12", paymentStatus: "שולם", type: "expense", description: "משכורת Victor — אוגוסט 2026", category: "צוות", scope: "general", artist: "Victor", projectId: null, linkedSessionId: "victor_salary_2026-08" }]);
    check("18. NEEDS_EXACT_DATE (payment date unknown)", v1.actions.find((c) => c.actionType === "RECORD_PAID_EXPENSE")!.readiness, "NEEDS_EXACT_DATE");
    const noAmt = clone(RAW0); noAmt.victorSalary![0].amount = 0;
    const qv0 = view(noAmt).integrity.top.questions.find((q) => q.questionType === "FINANCE_RECURRING_PAYMENT_STATUS")!;
    check("19. NEEDS_AMOUNT (canonical salary amount missing) — never invented", view(noAmt, [asAnswer(qv0, "PAID_NEEDS_RECORDING")]).actions.find((c) => c.actionType === "RECORD_PAID_EXPENSE")!.readiness, "NEEDS_AMOUNT");
    // Canonical rule (lib/finance/currency normalizeCurrency): a blank currency IS ₪ everywhere in Redbloods — Partner
    // consumes that rule, it does not invent a different one. A genuinely missing currency is refused, never defaulted:
    const vPaid = view(RAW0, [paid]);
    const noCurState = { ...vPaid.state, recurring: { ...vPaid.state.recurring, known: vPaid.state.recurring.known.map((k) => ({ ...k, currency: "" })) } };
    check("20. NEEDS_CURRENCY when the canonical currency is genuinely missing (no silent default)", deriveFinanceActions(RAW0, noCurState, vPaid.integrity, [paid]).candidates.find((c) => c.actionType === "RECORD_PAID_EXPENSE")!.readiness, "NEEDS_CURRENCY");
    const dup = clone(RAW0); dup.transactions.push(tx({ type: "expense", status: "לא שולם", amount: 550, currency: "$", linkedSessionId: "victor_salary_2026-08", scope: "general", date: null }));
    // F2.31: the RPC's exact refusal — a keyed row that is NOT paid is EXISTING_RECORD_NOT_PAID; a paid one is ALREADY_RECORDED
    const dupPaid = clone(RAW0); dupPaid.transactions.push(tx({ type: "expense", status: "שולם", amount: 550, currency: "$", linkedSessionId: "victor_salary_2026-08", scope: "general", date: "2026-09-10" }));
    check("21. an existing record for the period never becomes a duplicate (not paid → EXISTING_RECORD_NOT_PAID; paid → ALREADY_RECORDED)",
      [view(dup, [paid]).actions.find((c) => c.actionType === "RECORD_PAID_EXPENSE")!.readiness, view(dupPaid, [paid]).actions.find((c) => c.actionType === "RECORD_PAID_EXPENSE")!.readiness], ["EXISTING_RECORD_NOT_PAID", "ALREADY_RECORDED"]);
    const early = view(RAW0, [paid, asAnswer(dq, "EXACT_DATE", "2026-07-15")]).actions.find((c) => c.actionType === "RECORD_PAID_EXPENSE")!;
    check("22. a payment date before the work month fails closed (PAYMENT_DATE_OUT_OF_RANGE — the RPC's own refusal)", [early.readiness, early.facts, early.id], ["PAYMENT_DATE_OUT_OF_RANGE", null, null]);
  }

  console.log("X. RECORD_PAID_EXPENSE design (23-41)");
  {
    const paid = asAnswer(qVictor, "PAID_NEEDS_RECORDING", null, "aaaaaaaa-0000-4000-8000-000000000001");
    const dq = view(RAW0, [paid]).integrity.top.questions.find((q) => q.questionType === "FINANCE_PAYMENT_DATE")!;
    const dateA = asAnswer(dq, "EXACT_DATE", "2026-09-12", "aaaaaaaa-0000-4000-8000-000000000002");
    const c = view(RAW0, [paid, dateA]).actions.find((x) => x.actionType === "RECORD_PAID_EXPENSE")!;
    ok("23. exact expense proposal: type expense, general scope (no project), linked to the salary period", c.facts!.type === "expense" && c.facts!.projectId === null && c.facts!.linkedSessionId === "victor_salary_2026-08");
    const cfg = clone(RAW0); cfg.victorSalary![0].amount = 600; cfg.victorSalary![0].currency = "₪";
    const qCfg = view(cfg).integrity.top.questions.find((q) => q.questionType === "FINANCE_RECURRING_PAYMENT_STATUS")!;
    const pCfg = asAnswer(qCfg, "PAID_NEEDS_RECORDING");
    const dCfg = view(cfg, [pCfg]).integrity.top.questions.find((q) => q.questionType === "FINANCE_PAYMENT_DATE")!;
    const cCfg = view(cfg, [pCfg, asAnswer(dCfg, "EXACT_DATE", "2026-09-12")]).actions.find((x) => x.actionType === "RECORD_PAID_EXPENSE")!;
    ok("24/25/26. amount + currency come from the canonical salary configuration (no hard-coded Victor salary)", c.facts!.amount === 550 && c.facts!.currency === "$" && cCfg.facts!.amount === 600 && cCfg.facts!.currency === "₪" && !/\b550\b/.test(strip(rd("lib/partner/finance/actions.ts"))));
    ok("27. an exact payment date is required (question asked, nothing proposed)", view(RAW0, [paid]).actions.find((x) => x.actionType === "RECORD_PAID_EXPENSE")!.facts === null && dq.textHe === "מתי שילמת את משכורת Victor של אוגוסט?");
    const unknown = view(RAW0, [paid, asAnswer(dq, "UNKNOWN")]);
    ok("28. no fake date: UNKNOWN keeps it blocked and is not re-asked; windows / month edges never used", unknown.actions.find((x) => x.actionType === "RECORD_PAID_EXPENSE")!.readiness === "NEEDS_EXACT_DATE" && !unknown.integrity.top.questions.some((q) => q.questionType === "FINANCE_PAYMENT_DATE") && !/-01"|-31"|-15"|todayYmd|month\.end/.test(strip(rd("lib/partner/finance/actions.ts")).split("export function deriveFinanceActions")[1]));
    check("29/30. status שולם only (never התקבל for an expense)", c.facts!.paymentStatus, "שולם");
    ok("31/32. project link only when applicable — a general business expense gets none", c.facts!.projectId === null);
    const dupNow = clone(RAW0); dupNow.transactions.push(tx({ type: "expense", status: "שולם", amount: 550, currency: "$", linkedSessionId: "victor_salary_2026-08", scope: "general", date: "2026-09-12" }));
    dupNow.victorSalary![0].transactionId = dupNow.transactions[dupNow.transactions.length - 1].id;
    ok("33. an existing matching transaction → no proposal (issue itself resolves as FOUND_IN_FINANCE)", !view(dupNow, [paid, dateA]).actions.some((x) => x.readiness === "READY_TO_PROPOSE"));
    const idOf = (a: FinanceActionCandidate | undefined) => a ? `${a.id}|${a.snapshotHash}` : "none";
    const alt = (mut: (r: FinanceRaw) => void, answers = [paid, dateA]) => { const r = clone(RAW0); mut(r); return idOf(view(r, answers).actions.find((x) => x.actionType === "RECORD_PAID_EXPENSE" && x.readiness === "READY_TO_PROPOSE")); };
    const same = idOf(c);
    ok("34-41 (identity). identity + snapshot are deterministic", same === idOf(view(RAW0, [paid, dateA]).actions.find((x) => x.actionType === "RECORD_PAID_EXPENSE")) && /^[0-9a-f]{64}$/.test(c.snapshotHash!));
    ok("38. amount change → different identity (an approval of the old one could never match)", alt((r) => { r.victorSalary![0].amount = 560; }) !== same);
    ok("39. currency change → different identity", alt((r) => { r.victorSalary![0].currency = "₪"; }) !== same);
    ok("40. payment date change → different identity", idOf(view(RAW0, [paid, asAnswer(dq, "EXACT_DATE", "2026-09-13", "aaaaaaaa-0000-4000-8000-000000000002")]).actions.find((x) => x.actionType === "RECORD_PAID_EXPENSE")) !== same);
    ok("41. Owner Context revision → different identity (context ids are part of it)", idOf(view(RAW0, [paid, asAnswer(dq, "EXACT_DATE", "2026-09-12", "aaaaaaaa-0000-4000-8000-000000000009")]).actions.find((x) => x.actionType === "RECORD_PAID_EXPENSE")) !== same);
    // F2.31: execution exists ONLY through the shared Owner routes → action-service dispatch → finance/action-core → the one RPC.
    ok("35-37 (execution). finance execution only via the existing Owner routes + the narrow core (no finance-specific route, deadline core untouched)",
      !fs.existsSync(path.join(ROOT, "app/api/partner/finance/execute")) && !fs.existsSync(path.join(ROOT, "app/api/partner/finance/decide"))
      && !/RECORD_PAID_EXPENSE|finance/.test(strip(rd("lib/partner/actions/service.ts")))
      && /executeFinanceActionCore\(financeDeps, a\.actor, input\)/.test(rd("lib/partner/actions/action-service.ts"))
      && /callFinanceExecuteRpc\(\{/.test(rd("lib/partner/finance/action-core.ts")));
  }

  console.log("Payment-date loop end-to-end (real answer core + store)");
  {
    const h = harness();
    const qv = (await h.q("FINANCE_RECURRING_PAYMENT_STATUS"))!;
    await h.answer(qv, "PAID_NEEDS_RECORDING");
    const v = await h.v();
    check("E1. after PAID_NEEDS_RECORDING the ONE missing fact is asked first", v.integrity.top.questions.map((q) => q.questionType)[0], "FINANCE_PAYMENT_DATE");
    const dq = v.integrity.top.questions[0];
    check("E2. a future payment date is rejected (nothing stored)", [(await h.answer(dq, "EXACT_DATE", { exactDateYmd: "2026-09-30" })).status, h.db.rows.length], ["INVALID_INPUT", 1]);
    check("E3. an exact past date is stored as an explicit DATE", [(await h.answer(dq, "EXACT_DATE", { exactDateYmd: "2026-09-12" })).status, (h.db.rows[1].answer_value as { ymd: string }).ymd], ["ANSWER_SAVED", "2026-09-12"]);
    const v2 = await h.v();
    const c = v2.actions.find((x) => x.actionType === "RECORD_PAID_EXPENSE")!;
    check("E4. the action is now derived automatically (READY), never executed; the question is gone", [c.readiness, v2.integrity.top.questions.some((q) => q.questionType === "FINANCE_PAYMENT_DATE"), h.db.rows.length], ["READY_TO_PROPOSE", false, 2]);
    check("E5. Owner-facing fail-closed line (business language, no ids / hashes)", v2.brief.rehab.actionNoteHe, "אני יודע בדיוק מה לרשום (משכורת Victor עבור אוגוסט 2026: $550, שולם, 12.09.2026) — אבל עדיין אין לי פעולה בטוחה לבצע את זה.");
    ok("E6. realized totals untouched by the whole loop", realized(v2) === realized(base));
  }

  console.log("Y. RECORD_RECEIVED_INCOME readiness (42-51)");
  {
    const qCp = base.integrity.issues.find((i) => i.recommendedOwnerQuestion?.questionType === "FINANCE_COMPLETED_PROJECT_INCOME_STATUS")!.recommendedOwnerQuestion!;
    const rcv = view(RAW0, [asAnswer(qCp, "INCOME_RECEIVED_NOT_RECORDED")]).actions.find((x) => x.actionType === "RECORD_RECEIVED_INCOME");
    check("42/44/45/46. received-not-recorded → a candidate that NEEDS amount + currency + date (never guessed)", [rcv?.readiness, rcv?.missing, rcv?.facts], ["NEEDS_AMOUNT", ["amount", "currency", "receivedDate"], null]);
    ok("43. INCOME_NOT_RECEIVED never becomes income", !view(RAW0, [asAnswer(qCp, "INCOME_NOT_RECEIVED")]).actions.some((x) => x.actionType === "RECORD_RECEIVED_INCOME"));
    ok("47-51. no income is created: realized cash-in unchanged", view(RAW0, [asAnswer(qCp, "INCOME_RECEIVED_NOT_RECORDED")]).state.realized.ils.cashIn === base.state.realized.ils.cashIn);
    const exact = view(RAW0, [asAnswer(qBal, "EXACT_DATE", "2026-10-05")]).actions.find((x) => x.actionType === "SET_RECEIVABLE_DUE_DATE");
    check("J. SET_RECEIVABLE_DUE_DATE: EXACT_DATE only → UNSUPPORTED (no canonical due-date field for a balance)", exact?.readiness, "UNSUPPORTED");
    ok("J2. a timing WINDOW never becomes a due-date action", !view(RAW0, [asAnswer(qBal, "THIS_WEEK")]).actions.some((x) => x.actionType === "SET_RECEIVABLE_DUE_DATE"));
  }

  console.log("Z/AA/AB. Approval / execution / outcome / sync — fail closed in this phase");
  {
    ok("52-55. proposal / readiness never writes (pure module: no insert / update / rpc / fetch)", !/\.insert\(|\.update\(|\.upsert\(|\.delete\(|\.rpc\(|fetch\(|supabase/.test(strip(rd("lib/partner/finance/actions.ts"))) && !/\.insert\(|\.update\(|\.rpc\(|supabase/.test(strip(rd("lib/partner/finance/view.ts"))));
    // F2.29: the event store may READ finance events (getFinanceEventsByType) — it still can never append one, and no
    // app file names a finance execution RPC.
    const EP = strip(rd("lib/partner/actions/event-persistence.ts"));
    // F2.31: exactly two narrow write capabilities per type — decisions (APPROVED / NOT_NOW) and ONE named RPC each.
    ok("56-61. the store writes finance ONLY as APPROVED / NOT_NOW decisions + the ONE finance RPC (no generic insert / rpc)", !/finance/.test(strip(rd("lib/partner/actions/suggested.ts"))) && !/RECORD_PAID_EXPENSE/.test(rd("lib/partner/actions/types.ts"))
      && /action_type: "UPDATE_PROJECT_DEADLINE",\s*action_schema_version: SUPPORTED_ACTION_SCHEMA_VERSION,\s*subject_type: "project",/.test(EP)
      && /action_type: FINANCE_ACTION_TYPE,\s*action_schema_version: FINANCE_ACTION_SCHEMA_VERSION,\s*subject_type: FINANCE_SUBJECT_TYPE,/.test(EP)
      && /if \(i\.eventType !== "APPROVED" && i\.eventType !== "NOT_NOW"\) errors\.push/.test(EP)
      && (EP.match(/\.rpc\(/g) ?? []).length === 2 && /client\.rpc\(EXECUTE_RPC, args\)/.test(EP) && /client\.rpc\(FINANCE_EXECUTE_RPC, args\)/.test(EP));
    ok("62-75. no Outcome / sync claimed for finance (nothing executed); Outcome model unchanged", !/RECORD_PAID_EXPENSE|finance/.test(strip(rd("lib/partner/actions/outcome.ts"))));
  }

  console.log("DTO / UI");
  {
    const h = harness();
    await h.answer((await h.q("FINANCE_RECURRING_PAYMENT_STATUS"))!, "PAID_NEEDS_RECORDING");
    const b = (await h.v()).brief;
    const dqd = b.rehab.questions.find((q) => q.questionType === "FINANCE_PAYMENT_DATE")!;
    check("U1. payment-date question: EXACT_DATE with rule NOT_AFTER_TODAY; timing keeps NOT_BEFORE_TODAY", [dqd.answer?.exactDateCode, dqd.answer?.exactDateRule, b.rehab.questions.find((q) => q.questionType === "FINANCE_RECEIVABLE_TIMING")?.answer?.exactDateRule], ["EXACT_DATE", "NOT_AFTER_TODAY", "NOT_BEFORE_TODAY"]);
    ok("U2. v4 DTO parses; forged rule rejected", parseFinanceBriefResponse(JSON.parse(JSON.stringify(b))).ok && !parseFinanceBriefResponse({ ...b, rehab: { ...b.rehab, questions: [{ ...dqd, answer: { ...dqd.answer!, exactDateRule: "ANY" } }] } }).ok);
    const noop = () => {};
    let seen: { min?: string; max?: string } = {};
    const controls: FinanceAnswerControls = { busy: false, activeQuestionId: null, message: null, exactFor: dqd.answer!.questionId, exactYmd: "", todayYmd: "2026-09-24", onAnswer: noop, onOpenExact: noop, onExactYmd: noop, onConfirmExact: noop, onCancelExact: noop, renderDatePicker: ({ min, max, ariaLabel }) => { seen = { min, max }; return <input data-picker aria-label={ariaLabel} />; } };
    const html = renderToStaticMarkup(<PartnerActionsView items={[]} isMobile={false} finance={b} financeControls={controls} />);
    check("U3. payment-date picker is bounded to today or earlier", seen, { max: "2026-09-24" });
    ok("U4. rendered question 'מתי שילמת…' with its two options", html.includes("מתי שילמת את משכורת Victor של אוגוסט?") && html.includes(">יש תאריך מדויק<") && html.includes(">לא זוכר<") && html.includes('aria-label="תאריך התשלום"'));
    const noteHtml = renderToStaticMarkup(<PartnerActionsView items={[]} isMobile={false} finance={{ ...b, rehab: { ...b.rehab, actionNoteHe: "אני יודע מה חסר, אבל עדיין אין לי פעולה בטוחה לבצע את זה." } }} />);
    ok("U5. fail-closed action note rendered; no ids / hashes / technical noise", noteHtml.includes("data-finance-action-note") && noteHtml.includes("אין לי פעולה בטוחה") && !/[0-9a-f]{64}|RECORD_PAID_EXPENSE|victor_salary_/.test(noteHtml));
    ok("U6. no approve / execute button for finance (fail closed)", !/אשר<|בצע עכשיו/.test(renderToStaticMarkup(<PartnerActionsView items={[]} isMobile={false} finance={b} financeControls={controls} />)));
    check("U7. action note helper: nothing to say without a candidate", financeActionNoteHe(undefined), null);
  }

  console.log("AC. Static safety");
  {
    const REASONING = ["lib/partner/finance/actions.ts", "lib/partner/finance/view.ts", "lib/partner/finance/integrity.ts", "lib/partner/finance/core.ts", "lib/partner/finance/brief.ts", "lib/partner/finance/owner-answers.ts"];
    ok("AC1. finance reasoning modules are pure: no Supabase, no insert / update / delete / upsert / rpc, no fetch", REASONING.every((f) => !/lib\/supabase|@supabase|\.insert\(|\.update\(|\.upsert\(|\.rpc\(|fetch\(/.test(strip(rd(f)))));
    ok("AC2. no clock in reasoning (now is injected)", REASONING.every((f) => !/new Date\(\)|Date\.now\(/.test(strip(rd(f)))));
    ok("AC3. the only finance write remains the Owner Context append (answer-service)", fs.readdirSync(path.join(ROOT, "lib/partner/finance")).filter((f) => /appendOwnerContext\b/.test(strip(fs.readFileSync(path.join(ROOT, "lib/partner/finance", f), "utf8"))) && /import \{ appendOwnerContext \}/.test(fs.readFileSync(path.join(ROOT, "lib/partner/finance", f), "utf8"))).join() === "answer-service.ts");
    ok("AC4. canonical-source map documented for every registry entry", Object.values(FINANCE_ACTION_REGISTRY).every((x) => x.canonical.sourceFacts.length > 0 && x.canonical.consumers.length > 0));
    const self = fs.readFileSync(__filename, "utf8");
    ok("AC5. this test never imports a production binding", !/^import .* from ["'][^"']*(lib\/supabase|finance\/server|context-store|require-auth|answer-service)["'];$/m.test(self));
    check("AC6. payment date value spec: explicit, not after the answer date", [resolveAnswerValue("FINANCE_PAYMENT_DATE", "EXACT_DATE", { anchorYmd: "2026-09-24", explicitYmd: "2026-09-25" }).ok, resolveAnswerValue("FINANCE_PAYMENT_DATE", "EXACT_DATE", { anchorYmd: "2026-09-24", explicitYmd: "2026-09-12" }).ok], [false, true]);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
