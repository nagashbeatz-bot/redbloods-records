/**
 * Sunny ONE memory (Owner-approved Phase 2, 2026-10-05) — what Sunny was told / did is used by every Sunny surface,
 * without ever becoming business truth.
 *
 *   Stage 1 (P0): the claim contract survives the connector size guard; an interrupted RECEIPT step is OUTCOME_UNKNOWN
 *                 (never FAILED, never done); a reported payment is "already recorded" only against REAL money rows.
 *
 * Run with:   npx tsx scripts/test-sunny-known-context.tsx      Pure; never touches production.
 */
import fs from "node:fs";
import path from "node:path";
import { mkDeps, U, OWNER } from "./fixtures/act-harness";
import { approveAction, executeAction, planAction, planStatus, MAY_HAVE_RUN, mayHaveRun } from "../lib/partner/act/service";
import { executionKey, planHash } from "../lib/partner/act/plan";
import { ACT_TABLES } from "../lib/partner/act/store-supabase";
import { guardOutput } from "../lib/integrations/partner-mcp/tools";
import { matchReportedPayment } from "../lib/partner/finance/payment-match";
import type { FinanceTxRow } from "../lib/partner/finance/types";
import { financeKnowledgeContextOf, reconcileForKnowledge } from "../lib/partner/finance/decision-gate";
import { canonicalEffectOf } from "../lib/partner/owner-knowledge/propose";
import type { OwnerKnowledgeRecord } from "../lib/partner/owner-knowledge/store";
import type { Plan } from "../lib/partner/act/types";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: unknown) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 700)}` : ""}`); } };
const read = (p: string) => fs.readFileSync(path.resolve(__dirname, "..", p), "utf8");

const P = `project:${U(10)}`;
function projWriters() {
  const w = { projects: { [U(10)]: { name: "יהלום", notes: "", startDate: null, plannedHours: null, plannedDays: null, projectType: "שיר", parentProject: "", deadline: "2026-10-01" as string | null } } };
  const calls: string[] = [];
  const writers = {
    async readProjectMeta(id: string) { return w.projects[id] ? { name: w.projects[id].name, artist: "", status: "בעבודה", isHidden: false, businessType: "לקוח", projectType: "שיר", hasRelease: false } : null; },
    async readProject(id: string) { return w.projects[id] ? { ...w.projects[id] } : null; },
    async writeProject(id: string, p: { deadline?: string | null }) { calls.push("writeProject"); Object.assign(w.projects[id], p); },
  };
  return { w, calls, writers };
}
const tx = (o: Partial<FinanceTxRow> & { id: string }): FinanceTxRow => ({ projectId: U(10), type: "income", date: "2026-10-01", amount: 1000, currency: "₪", status: "התקבל", category: null, scope: null, expenseScope: null, linkedSessionId: null, createdAt: "2026-10-01T10:00:00Z", ...o });

(async () => {
  console.log("S1. P0-1 — the size guard never strips what a verification proves");
  {
    const huge = Array.from({ length: 400 }, (_, i) => ({ entity: `project:${i}`, fields: { notes: { value: "x".repeat(400), trust: "RECORD" } } }));
    const payload = { status: "APPLIED_AS_EXPECTED", planId: "pl_x", steps: [{ index: 0, actionId: "SEND_VICTOR_VERSION_NOTES", status: "APPLIED_AS_EXPECTED" }], freshStates: huge, canonicalEffect: "RECEIPT", verification: { kind: "RECEIPT", steps: [{ index: 0, actionId: "SEND_VICTOR_VERSION_NOTES", status: "APPLIED_AS_EXPECTED", verifyKind: "RECEIPT" }] }, messageHe: "בוס — המערכת שביצעה את זה אישרה (קבלה)", partial: null, nextStep: { big: "y".repeat(80_000) } };
    const g = guardOutput(payload as Record<string, unknown>, 20_000);
    ok("1a. an oversized action result keeps canonicalEffect / verification / messageHe / steps / planId", g.guarded && g.payload.canonicalEffect === "RECEIPT" && (g.payload.verification as { kind: string }).kind === "RECEIPT" && typeof g.payload.messageHe === "string" && Array.isArray(g.payload.steps) && g.payload.planId === "pl_x", Object.keys(g.payload));
    ok("1b. …so it can never read as a bare APPLIED_AS_EXPECTED (= re-read and in place)", !(g.payload.status === "APPLIED_AS_EXPECTED" && !("canonicalEffect" in g.payload)));
    const g2 = guardOutput({ ...payload, nextStep: null } as Record<string, unknown>, 60_000);
    ok("1c. freshStates is trimmed first (counted in budgetGuard); the verification stays whole", Array.isArray(g2.payload.freshStates) && (g2.payload.freshStates as unknown[]).length < huge.length && g2.payload.canonicalEffect === "RECEIPT" && !!(g2.payload.budgetGuard as { trimmed?: Record<string, number> })?.trimmed?.freshStates, g2.payload.budgetGuard);
  }

  console.log("\nS2. P0-2 — an interrupted RECEIPT step may have run: OUTCOME_UNKNOWN, never FAILED, never done");
  {
    const h = projWriters(); const m = mkDeps(h.writers);
    const p = await planAction({ intentHe: "דדליין", actionId: "UPDATE_PROJECT_DEADLINE", args: { project: P, deadline: "2026-10-20" } }, OWNER, m.d);
    const a = await approveAction({ planId: p.planId, planHash: p.planHash, confirmationText: "מאשר" }, OWNER, m.d);
    const plan = m.db.rows(ACT_TABLES.plans).find((x) => x.plan_id === p.planId)!.plan as Plan;
    const old = new Date(m.d.nowMs() - 3_600_000).toISOString();
    // what the read-only reconcile records for an interrupted RECEIPT step (FAILED row + the MAY_HAVE_RUN marker)
    m.db.rows(ACT_TABLES.executions).push({ execution_key: executionKey(planHash(plan), plan.steps[0]), plan_id: p.planId, step_index: 0, action_id: plan.steps[0].actionId, action_version: plan.steps[0].actionVersion, status: "FAILED", outcome: { index: 0, actionId: plan.steps[0].actionId, status: "FAILED", detail: `${MAY_HAVE_RUN} the execution was interrupted; … it may have happened`, replayed: false, at: old }, recorded_at: old });
    const s = await planStatus({ planId: p.planId }, OWNER, m.d);
    ok("2a. plan status = OUTCOME_UNKNOWN (not FAILED), the step reads OUTCOME_UNKNOWN, the message forbids 'done' AND 'failed'", s.status === "OUTCOME_UNKNOWN" && (s.steps as Array<{ status: string }>)[0].status === "OUTCOME_UNKNOWN" && /ייתכן שבוצע וייתכן שלא/.test(String(s.messageHe)) && s.outcomeUnknown === true, { st: s.status, steps: s.steps, msg: s.messageHe });
    const e = await executeAction({ planId: p.planId, approvalToken: a.approvalToken, confirmationText: "מאשר" }, OWNER, m.d);
    ok("2b. executing it again is refused (never re-run) and the refusal says the result was NOT verified — not 'כבר בוצעה'", e.status === "ALREADY_EXECUTED" && e.planStatus === "OUTCOME_UNKNOWN" && e.outcomeUnknown === true && !/כבר בוצעה —/.test(String(e.messageHe)) && /לא אומתה/.test(String(e.messageHe)) && !h.calls.includes("writeProject"), { st: e.status, ps: e.planStatus, msg: e.messageHe });
    const hist = await planStatus({ history: true }, OWNER, m.d);
    const item = (hist.items as Array<{ planId: string; outcome: string; steps: Array<{ outcome: string }> }>).find((x) => x.planId === p.planId);
    ok("2c. history shows OUTCOME_UNKNOWN for the plan and the step — never EXECUTED / FAILED", item?.outcome === "OUTCOME_UNKNOWN" && item.steps[0].outcome === "OUTCOME_UNKNOWN", item);
  }
  ok("2d. the marker reader: the new marker and the legacy 'it may have happened' wording → may have run; a plain 'not applied' FAILED → not",
    mayHaveRun({ status: "FAILED", outcome: { detail: `${MAY_HAVE_RUN} x` } }) && mayHaveRun({ status: "FAILED", outcome: { detail: "OUTCOME_UNKNOWN: interrupted … it may have happened. Check" } })
    && !mayHaveRun({ status: "FAILED", outcome: { detail: "OUTCOME_UNKNOWN: the approved change is not in place → treated as not applied" } }) && !mayHaveRun({ status: "APPLIED_AS_EXPECTED", outcome: { detail: MAY_HAVE_RUN } }));
  {
    const svc = read("lib/partner/act/service.ts");
    ok("2e. the reconcile writes the marker for a RECEIPT step (the stored status vocabulary is unchanged: FAILED + marker)", /=== "RECEIPT"\) return out\("FAILED", `\$\{MAY_HAVE_RUN\}/.test(svc));
  }

  console.log("\nS3. P0-3 — a reported payment is 'already recorded' only against a REAL money row");
  {
    const base = { subjectKey: P, direction: "RECEIVED", amount: 1000, currency: "₪" };
    ok("3a. income התקבל, same amount + currency → RECORDED", matchReportedPayment(base, [tx({ id: "t1" })]).kind === "RECORDED");
    ok("3b. income שולם (also received) → RECORDED", matchReportedPayment(base, [tx({ id: "t1", status: "שולם" })]).kind === "RECORDED");
    const exp = matchReportedPayment(base, [tx({ id: "t1", status: "צפוי" })]);
    ok("3c. an EXPECTED (צפוי) row is never 'recorded' — it is the unique row to move to התקבל", exp.kind === "EXPECTED_UNIQUE" && exp.txId === "t1" && exp.toStatus === "התקבל", exp);
    ok("3d. a CANCELLED row is never 'recorded' and never a candidate", matchReportedPayment(base, [tx({ id: "t1", status: "בוטל" })]).kind === "NONE");
    ok("3e. no rows → NONE (a create may be proposed, never written here)", matchReportedPayment(base, []).kind === "NONE");
    ok("3f. two identical expected rows → AMBIGUOUS (ASK, never guess)", (() => { const r = matchReportedPayment(base, [tx({ id: "a", status: "צפוי" }), tx({ id: "b", status: "צפוי" })]); return r.kind === "AMBIGUOUS" && r.reason === "MULTIPLE_CANDIDATES"; })());
    ok("3g. partial payment (expected 2,000, reported 1,000) → AMBIGUOUS AMOUNT_DIFFERS", (() => { const r = matchReportedPayment(base, [tx({ id: "a", status: "צפוי", amount: 2000 })]); return r.kind === "AMBIGUOUS" && r.reason === "AMOUNT_DIFFERS"; })());
    ok("3h. different currency ($1,000 expected, ₪1,000 reported) → AMBIGUOUS CURRENCY_DIFFERS", (() => { const r = matchReportedPayment(base, [tx({ id: "a", status: "צפוי", currency: "$" })]); return r.kind === "AMBIGUOUS" && r.reason === "CURRENCY_DIFFERS"; })());
    ok("3i. a partly-paid (חלקי) row of the same amount is never moved automatically → AMBIGUOUS PARTIAL_ROW", (() => { const r = matchReportedPayment(base, [tx({ id: "a", status: "חלקי" })]); return r.kind === "AMBIGUOUS" && r.reason === "PARTIAL_ROW"; })());
    ok("3j. the same amount on ANOTHER project never matches (cross-entity)", matchReportedPayment(base, [tx({ id: "a", projectId: U(11) })]).kind === "NONE");
    ok("3k. direction is never flipped: RECEIVED ignores an expense row of the same amount", matchReportedPayment(base, [tx({ id: "a", type: "expense", status: "שולם" })]).kind === "NONE");
    const paid = matchReportedPayment({ ...base, direction: "PAID" }, [tx({ id: "a", type: "expense", status: "לא שולם" })]);
    ok("3l. PAID: an expense 'לא שולם' of the same amount → the unique row moves to שולם (never התקבל)", paid.kind === "EXPECTED_UNIQUE" && paid.toStatus === "שולם", paid);
    ok("3m. PAID ignores an income row (never 'קיבלתי' ↔ 'שילמתי')", matchReportedPayment({ ...base, direction: "PAID" }, [tx({ id: "a" })]).kind === "NONE");
    ok("3n. a client / show subject or unread Finance → UNKNOWN (never 'not recorded')", matchReportedPayment({ ...base, subjectKey: `client:${U(3)}` }, []).kind === "UNKNOWN" && matchReportedPayment(base, null).kind === "UNKNOWN");
    const srv = read("lib/partner/owner-knowledge/server.ts");
    ok("3o. financeMatch (the ALREADY_RECORDED_IN_FINANCE note) uses the ONE matcher — no second rule", /matchReportedPayment\(/.test(srv) && !/Number\(t\.amount\) === amount/.test(srv));
  }

  console.log("\nS4. Stage 2 — a reported payment proposes the ONE canonical path (never written, never guessed)");
  {
    const today = "2026-10-05";
    const issue = (o: Partial<{ issueType: string; subjectId: string }> = {}) => ({ issueType: o.issueType ?? "COMPLETED_WORK_NO_INCOME", subjectType: "project", subjectId: o.subjectId ?? U(10), subjectLabel: "יהלום", amount: null, currency: "₪", evidence: [] });
    const rec = (o: Partial<OwnerKnowledgeRecord> & { id: string; value: Record<string, unknown> }): OwnerKnowledgeRecord => ({ createdAt: "2026-10-04T10:00:00Z", kind: "PAYMENT_REPORTED_BY_OWNER", subjectKey: P, identityKeys: [P], slotKey: `${o.id}-slot`, epistemic: "OWNER_REPORTED", meaningHe: "הבוס דיווח: התקבל ₪1,000", operation: "ASSERT", supersedesId: null, reviewAt: null, expiresAt: null, ...o } as OwnerKnowledgeRecord);
    const RECV = { direction: "RECEIVED", amount: 1000, currency: "₪", date: "2026-10-03" };
    const ctxOf = (rs: OwnerKnowledgeRecord[]) => financeKnowledgeContextOf(rs, today);
    const none = reconcileForKnowledge(issue(), ctxOf([rec({ id: "k1", value: RECV })]), []);
    ok("4a. no row in Finance → KNOWN_CONTEXT_RECONCILE + ADD_TRANSACTION prefilled (project, income, amount, currency, התקבל, date) — a proposal only", none?.state === "KNOWN_CONTEXT_RECONCILE" && none.actions.length === 1 && none.actions[0].actionId === "ADD_TRANSACTION" && JSON.stringify(none.actions[0].args) === JSON.stringify({ project: P, type: "income", amount: 1000, currency: "₪", paymentStatus: "התקבל", date: "2026-10-03" }) && none.actions[0].missing.length === 0, none);
    const noDate = reconcileForKnowledge(issue(), ctxOf([rec({ id: "k1", value: { direction: "RECEIVED", amount: 1000, currency: "₪" } })]), []);
    ok("4b. a report without a date → the date is MISSING (asked), never invented", noDate?.actions[0].missing.join() === "date" && !("date" in (noDate?.actions[0].args ?? {})), noDate?.actions);
    const expd = reconcileForKnowledge(issue(), ctxOf([rec({ id: "k1", value: RECV })]), [tx({ id: "t9", status: "צפוי" })]);
    ok("4c. exactly ONE expected row of the same amount + currency → SET_TRANSACTION_STATUS on THAT row → התקבל (never a second row)", expd?.actions.length === 1 && expd.actions[0].actionId === "SET_TRANSACTION_STATUS" && expd.actions[0].args.transaction === "transaction:t9" && expd.actions[0].args.paymentStatus === "התקבל", expd?.actions);
    const amb = reconcileForKnowledge(issue(), ctxOf([rec({ id: "k1", value: RECV })]), [tx({ id: "a", status: "צפוי" }), tx({ id: "b", status: "צפוי" })]);
    ok("4d. two candidate rows → a reconcile line that ASKS which (no action, nothing guessed) — still not a fresh question", amb?.state === "KNOWN_CONTEXT_RECONCILE" && amb.actions.length === 0 && /לא אנחש/.test(amb.canonicalHe), amb);
    const part = reconcileForKnowledge(issue(), ctxOf([rec({ id: "k1", value: RECV })]), [tx({ id: "a", status: "צפוי", amount: 2500 })]);
    ok("4e. partial payment vs a different expected amount → ASK (no action)", part?.actions.length === 0 && /חלקי/.test(part.canonicalHe), part?.canonicalHe);
    const cur = reconcileForKnowledge(issue(), ctxOf([rec({ id: "k1", value: RECV })]), [tx({ id: "a", status: "צפוי", currency: "$" })]);
    ok("4f. a different currency → ASK (no action)", cur?.actions.length === 0 && /מטבע/.test(cur.canonicalHe), cur?.canonicalHe);
    const done = reconcileForKnowledge(issue({ issueType: "OVERDUE_RECEIVABLE_REASON_UNKNOWN" }), ctxOf([rec({ id: "k1", value: RECV })]), [tx({ id: "a", status: "התקבל" })]);
    ok("4g. the reported payment is ALREADY recorded → the report does not explain a remaining issue (no duplicate action; the issue is asked on its own facts)", done === null, done);
    const paid = ctxOf([rec({ id: "k2", value: { direction: "PAID", amount: 1000, currency: "₪" } })]);
    ok("4h. 'שילמתי' (PAID) never reconciles a missing-INCOME issue — never income", paid.length === 0 && reconcileForKnowledge(issue(), paid, []) === null);
    const other = reconcileForKnowledge(issue({ subjectId: U(11) }), ctxOf([rec({ id: "k1", value: RECV })]), []);
    ok("4i. cross-entity: a report on project A never touches project B (same amount)", other === null, other);
    const withdrawn = [rec({ id: "k1", value: RECV, slotKey: "s" }), rec({ id: "k1w", value: RECV, slotKey: "s", operation: "WITHDRAW", supersedesId: "k1", createdAt: "2026-10-05T09:00:00Z" })];
    ok("4j. a withdrawn report stops affecting the gate (activeKnowledge)", ctxOf(withdrawn).length === 0 && reconcileForKnowledge(issue(), ctxOf(withdrawn), []) === null);
    // the propose preview uses the SAME gate with the live rows; a WITHDRAW is never previewed as an assertion
    const src = { finance: { status: "OK", value: { raw: { transactions: [tx({ id: "t9", status: "צפוי" })] }, integrity: { issues: [{ ...issue(), ownerResolved: false, reconcile: null, recommendedOwnerQuestion: { textHe: "מה קרה?" } }] } } } } as never;
    const item = { kind: "PAYMENT_REPORTED_BY_OWNER", subjectKey: P, identityKeys: [P], value: RECV, meaningHe: "התקבל ₪1,000" };
    const eff = canonicalEffectOf(src, [item as never], today);
    ok("4k. the knowledge preview shows the canonical path (SET_TRANSACTION_STATUS t9) and canonicalEffect NONE — saving knowledge changes no record", eff.canonicalEffect === "NONE" && eff.canonicalPath.length === 1 && eff.canonicalPath[0].actionId === "SET_TRANSACTION_STATUS" && eff.stillSurfaced[0]?.willAppearAs === "RECONCILIATION", eff);
    const effW = canonicalEffectOf(src, [{ ...item, operation: "WITHDRAW" } as never], today);
    ok("4l. a WITHDRAW preview is not presented as the assertion (no reconcile, no canonical path)", effW.canonicalPath.length === 0 && effW.stillSurfaced.every((x) => x.willAppearAs !== "RECONCILIATION"), effW);
    const om = read("lib/partner/system/owner-model.ts");
    ok("4m. the payment workflow names the existing primitives (no stale FUTURE_PRIMITIVE_REQUIRED)", !/RECORD_RECEIVED_INCOME — FUTURE_PRIMITIVE_REQUIRED/.test(om) && /SET_TRANSACTION_STATUS \(צפוי → התקבל\)/.test(om));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
})();
