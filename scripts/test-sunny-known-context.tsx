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
import { canonicalEffectOf, previewKnowledgeCore, type KnowledgeProposeDeps } from "../lib/partner/owner-knowledge/propose";
import { activeKnowledge, type OwnerKnowledgeRecord } from "../lib/partner/owner-knowledge/store";
import { knowledgeKind } from "../lib/partner/owner-knowledge/kinds";
import { followUpKnowledgeFor, followUpKnown, vendorWorkKnown, victorDeliveryQuestionId } from "../lib/partner/sunny/known-context";
import { buildVictorView } from "../lib/partner/victor/view";
import { PRIMITIVES_BY_ID } from "../lib/partner/act/primitives";
import { recentActionsFor } from "../lib/integrations/partner-mcp/mcp";
import { buildNeedsMe } from "../lib/partner/needs-me/curate";
import { buildClientView } from "../lib/partner/clients/view";
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

  console.log("\nS5. Stage 3 — FOLLOW_UP_EXPECTATION: known context per proposal, canonical SET_PROPOSAL_FOLLOWUP, never cross-proposal");
  {
    const T = "2026-10-05";
    const PR1 = `proposal:${U(301)}`, PR2 = `proposal:${U(302)}`, CL = `client:${U(201)}`;
    const fu = (o: Partial<OwnerKnowledgeRecord> & { id: string; value: Record<string, unknown> }) => ({ createdAt: "2026-10-04T10:00:00Z", kind: "FOLLOW_UP_EXPECTATION", subjectKey: CL, identityKeys: [CL], slotKey: `${o.id}-s`, epistemic: "OWNER_REPORTED", meaningHe: "אתה חוזר לנוי עד 2026-10-20.", operation: "ASSERT", supersedesId: null, reviewAt: "2026-10-20", expiresAt: null, ...o } as OwnerKnowledgeRecord);
    const onPr1 = fu({ id: "f1", value: { who: "OWNER_WILL_CONTACT", when: "2026-10-20", proposal: PR1 } });
    ok("5a. an expectation naming proposal 1 applies to proposal 1 only — never to proposal 2 of the same client", followUpKnowledgeFor([onPr1], PR1, CL, 2)?.id === "f1" && followUpKnowledgeFor([onPr1], PR2, CL, 2) === null);
    const clientLevel = fu({ id: "f2", value: { who: "OWNER_WILL_CONTACT", when: "2026-10-20" } });
    ok("5b. a client-level expectation (no proposal named) applies only when the client has exactly ONE open proposal", followUpKnowledgeFor([clientLevel], PR1, CL, 1)?.id === "f2" && followUpKnowledgeFor([clientLevel], PR1, CL, 2) === null);
    const k1 = followUpKnown(onPr1, PR1, "4 שירים", "2026-10-01", T);
    ok("5c. 'לחזור ב-20.10' → known line + SET_PROPOSAL_FOLLOWUP 2026-10-20 (a proposal — knowledge alone changes nothing)", k1.state === "KNOWN_CONTEXT_RECONCILE" && k1.actions.length === 1 && k1.actions[0].actionId === "SET_PROPOSAL_FOLLOWUP" && k1.actions[0].args.followupDate === "2026-10-20" && k1.actions[0].args.proposal === PR1 && /כבר אמרת לי/.test(k1.textHe) && /לסנכרן\?/.test(k1.textHe), k1);
    const k1done = followUpKnown(onPr1, PR1, "4 שירים", "2026-10-20", T);
    ok("5d. after the canonical write (follow-up = 20.10, read back) → KNOWN_MATCHES, no action, no question", k1done.state === "KNOWN_MATCHES" && k1done.actions.length === 0, k1done);
    const notNow = followUpKnown(fu({ id: "f3", value: { who: "OWNER_WILL_CONTACT", whenRelative: "NOT_NOW", proposal: PR1 }, reviewAt: "2026-11-04" }), PR1, null, "2026-10-01", T);
    ok("5e. 'לא לחזור כרגע' (NOT_NOW) → clear the follow-up (SET_PROPOSAL_FOLLOWUP clear) — not a repeated question", notNow.actions[0]?.actionId === "SET_PROPOSAL_FOLLOWUP" && notNow.actions[0].args.clear === true && notNow.state !== "STILL_TRUE_CHECK", notNow);
    const rel = followUpKnown(fu({ id: "f4", value: { who: "OWNER_WILL_CONTACT", whenRelative: "AFTER_HOLIDAYS", proposal: PR1 }, reviewAt: "2026-11-01" }), PR1, null, "2026-10-01", T);
    ok("5f. 'אחרי החגים' → the date is MISSING (asked), never invented", rel.actions[0]?.missing.join() === "followupDate" && !("followupDate" in rel.actions[0].args), rel.actions);
    const due = followUpKnown(fu({ id: "f5", value: { who: "OWNER_WILL_CONTACT", when: "2026-10-03", proposal: PR1 }, reviewAt: "2026-10-03" }), PR1, null, "2026-10-01", T);
    ok("5g. reviewAt passed → 'זה עדיין נכון?' (STILL_TRUE_CHECK, no action) — not expiry, not the bare original question", due.state === "STILL_TRUE_CHECK" && due.actions.length === 0 && /עדיין נכון\?/.test(due.textHe) && /אמרת לי/.test(due.textHe), due);
    const wd = [onPr1, { ...onPr1, id: "f1w", operation: "WITHDRAW", supersedesId: "f1", createdAt: "2026-10-05T08:00:00Z" } as OwnerKnowledgeRecord];
    ok("5h. a withdrawn expectation stops applying (activeKnowledge → the question returns)", followUpKnowledgeFor(activeKnowledge(wd, T), PR1, CL, 1) === null);
    // the kind itself: per-proposal slot, NOT_NOW, ownership check, VENDOR_COMMITMENT due optional + work, communication ≠ commitment
    const FK = knowledgeKind("FOLLOW_UP_EXPECTATION")!;
    ok("5i. two proposals of one client never supersede each other (slot per proposal); without a proposal the old slot is unchanged", FK.slot({ who: "OWNER_WILL_CONTACT", proposal: PR1 }) !== FK.slot({ who: "OWNER_WILL_CONTACT", proposal: PR2 }) && FK.slot({ who: "OWNER_WILL_CONTACT" }) === "followup:OWNER_WILL_CONTACT");
    const live = (owner: { clientKey: string | null; projectKey: string | null; vendorKey: string | null } | null) => ({ todayIL: T, projectStatus: () => null, financeMatch: () => null, refOwner: () => owner });
    ok("5j. a proposal of ANOTHER client is refused (REF_NOT_OF_SUBJECT, blocking) — never linked across entities", FK.conflicts(CL, { who: "OWNER_WILL_CONTACT", proposal: PR1 }, live({ clientKey: `client:${U(299)}`, projectKey: null, vendorKey: null })).some((c) => c.code === "REF_NOT_OF_SUBJECT" && c.severity === "BLOCKING")
      && FK.conflicts(CL, { who: "OWNER_WILL_CONTACT", proposal: PR1 }, live({ clientKey: CL, projectKey: null, vendorKey: null })).length === 0);
    ok("5k. NOT_NOW is a registered whenRelative value (no new kind)", (FK.fields.whenRelative as { values: readonly string[] }).values.includes("NOT_NOW"));
    const VC = knowledgeKind("VENDOR_COMMITMENT")!;
    ok("5l. VENDOR_COMMITMENT: due optional, work is a typed reference, per-work slot", !(VC.fields.due as { required: boolean }).required && VC.fields.work?.type === "ref" && VC.slot({ commitment: "SEND_REVISION", work: `victor-work:${U(1)}` }) !== VC.slot({ commitment: "SEND_REVISION", work: `victor-work:${U(2)}` }));
    ok("5m. a Victor work belongs to vendor:VICTOR only (Steven's commitment cannot point at it)", VC.conflicts("vendor:STEVEN", { commitment: "SEND_REVISION", work: `victor-work:${U(1)}` }, live({ clientKey: null, projectKey: null, vendorKey: "vendor:VICTOR" })).some((c) => c.code === "REF_NOT_OF_SUBJECT"));
    ok("5n. the model is told: outside communication ('דיברתי איתו / שלחתי לו / עברנו על זה') is NEVER a commitment", /NOT a commitment/.test(VC.descriptionForModel) && /NEVER a commitment/.test(read("lib/integrations/partner-mcp/tools.ts")));
  }

  console.log("\nS6. needs_me — known context ENRICHES (D1): the record item stays, the Owner's statement is shown, records win");
  {
    const TODAY = "2026-10-05";
    const PM = U(12), PO = U(13);
    const kb = (o: Partial<OwnerKnowledgeRecord> & { id: string; value: Record<string, unknown> }) => ({ createdAt: "2026-09-27T20:47:00Z", kind: "PROJECT_BLOCKER", subjectKey: `project:${PM}`, identityKeys: [`project:${PM}`], slotKey: `${o.id}-s`, epistemic: "OWNER_REPORTED", meaningHe: "דאנסהול סקול תקוע: מחכים לאמן (אברהם איילאו) — מחכים לפידבק של איילו על המיקס", operation: "ASSERT", supersedesId: null, reviewAt: "2026-10-11", expiresAt: null, ...o } as OwnerKnowledgeRecord);
    const nsrc = (o: { versionAt: string; knowledge: OwnerKnowledgeRecord[] | null; proposals?: unknown[] }) => {
      const steven = { id: U(70), projectId: PM, engineerName: "Steven", workTitle: null, workType: "מיקס + מאסטר", status: "בתהליך", agreedPrice: 200, currency: "$", amountPaid: 0, sentDate: "2026-09-10", internalDeadline: null, linkedTransactionId: null, paymentDate: null, notes: null, hasFilesLink: false, sortOrder: 0, createdAt: null, updatedAt: null };
      const ver = { id: U(80), workId: U(70), projectId: PM, label: "v2", fileName: "v2.wav", status: null, uploadedBy: "steven", durationSeconds: null, uploadedAt: o.versionAt, targetId: null, path: null, size: null, type: null, createdAt: o.versionAt, updatedAt: null };
      const index = { [PM]: { name: "דאנסהול סקול", status: "במיקס", artistText: "נגש ביטס", businessType: "לייבל" }, [PO]: { name: "אחר", status: "במיקס", artistText: "X", businessType: "לקוח" } };
      const state = { todayIL: TODAY, domains: { projects: { data: { index, open: [] } }, clients: { data: { items: [] } }, labelArtists: { data: { items: [] } }, victor: { data: { active: [] } }, sessions: { data: { items: [] } }, releasesFull: { data: { items: [] } }, proposalsFull: { data: { items: o.proposals ?? [] } }, tasksFull: { data: { items: [] } } } };
      const det = { victor: { rows: [], capped: false }, engineerWork: { rows: [steven], capped: false }, mixVersions: { rows: [ver], capped: false }, mixComments: { rows: [], capped: false }, mixTargets: { rows: [], capped: false }, mixTargetNotes: { rows: [], capped: false }, finalFiles: { rows: [], capped: false }, projectSettings: { rows: [], capped: false }, tasks: { rows: [], capped: false }, actions: { rows: [], capped: false } };
      const ops = { engineerWork: { rows: [steven], capped: false }, mixVersions: { rows: [ver], capped: false }, projectsMeta: { rows: [], capped: false }, projectActions: { rows: [], capped: false } };
      return {
        now: new Date(`${TODAY}T09:00:00Z`), identities: { cleantone: null }, state: { status: "OK", value: state }, operations: { status: "OK", value: ops }, projectDetail: { status: "OK", value: det },
        labelDetail: { status: "OK", value: { shows: { rows: [], capped: false }, artists: { rows: [], capped: false } } }, settings: { status: "OK", value: { families: {} } }, actions: { status: "OK", value: [] },
        integrity: { status: "OK", value: { questions: [] } }, ownerInbox: { status: "OK", value: [] }, inboxMemory: { status: "OK", value: { links: [], interpretations: [] } },
        ownerKnowledge: o.knowledge === null ? { status: "UNAVAILABLE", detail: "x" } : { status: "OK", value: o.knowledge }, audience: { channel: "INTERNAL", ownerAuthorized: true },
      } as never;
    };
    const n = buildNeedsMe(nsrc({ versionAt: "2026-09-21T00:04:38Z", knowledge: [kb({ id: "b1", value: { reason: "WAITING_FOR_ARTIST", waitingOn: `client:${U(5)}` } })] }));
    const it = n.items.find((i) => i.entityKey === `mix-work:${U(70)}`);
    ok("6a. the record item STAYS (the ball is the Owner's by engineerHandoff) — knowledge never removes it", !!it && it.ball.holder === "OWNER", n.items.map((i) => i.entityKey));
    ok("6b. the Owner's blocker is shown as known context with the contradiction (records win, nothing changed)", !!it?.known?.length && /כבר אמרת לי/.test(it.known[0].textHe) && /הרשומות קובעות/.test(it.known[0].textHe) && it.evidence.some((e) => e.code === "OWNER_KNOWLEDGE_VS_RECORDS") && n.knowledge.conflicts === 1, it?.known);
    const newer = buildNeedsMe(nsrc({ versionAt: "2026-09-30T10:00:00Z", knowledge: [kb({ id: "b1", value: { reason: "WAITING_FOR_ARTIST" } })] }));
    ok("6c. D3: a version uploaded AFTER the statement → newer canonical evidence wins; the old blocker is not shown as still true", !newer.items.find((i) => i.entityKey === `mix-work:${U(70)}`)?.known?.length, newer.items.find((i) => i.entityKey === `mix-work:${U(70)}`)?.known);
    const other = buildNeedsMe(nsrc({ versionAt: "2026-09-21T00:04:38Z", knowledge: [kb({ id: "b2", subjectKey: `project:${PO}`, identityKeys: [`project:${PO}`], value: { reason: "WAITING_FOR_ARTIST" } })] }));
    ok("6d. cross-entity: a blocker on ANOTHER project never enriches this one", !other.items.find((i) => i.entityKey === `mix-work:${U(70)}`)?.known?.length);
    const review = buildNeedsMe(nsrc({ versionAt: "2026-09-21T00:04:38Z", knowledge: [kb({ id: "b1", value: { reason: "WAITING_FOR_ARTIST" }, reviewAt: "2026-10-01" })] }));
    const rk = review.items.find((i) => i.entityKey === `mix-work:${U(70)}`)?.known?.[0];
    ok("6e. reviewAt passed → 'זה עדיין נכון?' (STILL_TRUE_CHECK), not silently true", rk?.state === "STILL_TRUE_CHECK" && /עדיין נכון\?/.test(rk.textHe), rk);
    const un = buildNeedsMe(nsrc({ versionAt: "2026-09-21T00:04:38Z", knowledge: null }));
    ok("6f. knowledge unreadable → 'לא נבדק' (unknown), never 'nothing was said'", un.unchecked.some((u) => u.source === "OWNER_KNOWLEDGE") && !un.knowledge.read);
    // the proposal follow-up item stays and carries the canonical path
    const prop = { id: U(301), clientId: U(201), clientName: "נוי", linkedProjectId: null, title: "4 שירים", amount: 2700, currency: "₪", status: "הצעה נשלחה", followupYmd: "2026-10-04", sentYmd: "2026-09-20", createdAt: null, updatedAt: null };
    const fuK = { createdAt: "2026-10-04T12:00:00Z", kind: "FOLLOW_UP_EXPECTATION", subjectKey: `client:${U(201)}`, identityKeys: [`client:${U(201)}`], slotKey: "fu-s", epistemic: "OWNER_REPORTED", meaningHe: "אתה חוזר לנוי עד 2026-10-20.", operation: "ASSERT", supersedesId: null, reviewAt: "2026-10-20", expiresAt: null, value: { who: "OWNER_WILL_CONTACT", when: "2026-10-20", proposal: `proposal:${U(301)}` } } as unknown as OwnerKnowledgeRecord;
    const pn = buildNeedsMe(nsrc({ versionAt: "2026-09-21T00:04:38Z", knowledge: [fuK], proposals: [prop] }));
    const pit = [...pn.items, ...pn.moreToday].find((i) => i.entityKey === `proposal:${U(301)}`);
    ok("6g. the due proposal follow-up STAYS (records) and carries 'כבר אמרת לי … לסנכרן?' + SET_PROPOSAL_FOLLOWUP 20.10", !!pit && pit.known?.[0]?.actions[0]?.actionId === "SET_PROPOSAL_FOLLOWUP" && pit.known[0].actions[0].args.followupDate === "2026-10-20", pit?.known);
  }

  console.log("\nS7. client_view — a due proposal follow-up the Owner already spoke about is a known line, not a repeated question");
  {
    const TODAY = "2026-10-05", CID = U(201);
    const prop = (id: number, follow: string) => ({ id: U(id), clientId: CID, clientName: "נוי", linkedProjectId: null, title: `הצעה ${id}`, amount: 2700, currency: "₪", status: "הצעה נשלחה", followupYmd: follow, sentYmd: "2026-09-20", createdAt: "2026-09-20T10:00:00Z", updatedAt: null });
    const fuOn = (pid: number) => ({ id: `fu${pid}`, createdAt: "2026-10-04T12:00:00Z", kind: "FOLLOW_UP_EXPECTATION", subjectKey: `client:${CID}`, identityKeys: [`client:${CID}`], slotKey: `fu${pid}`, epistemic: "OWNER_REPORTED", meaningHe: "אתה חוזר לנוי עד 2026-10-20.", operation: "ASSERT", supersedesId: null, reviewAt: "2026-10-20", expiresAt: null, value: { who: "OWNER_WILL_CONTACT", when: "2026-10-20", proposal: `proposal:${U(pid)}` } });
    const csrc = (knowledge: unknown[]) => ({
      now: new Date(`${TODAY}T09:00:00Z`), identities: { cleantone: null },
      state: { status: "OK", value: { todayIL: TODAY, domains: { projects: { data: { index: {}, open: [] } }, clients: { data: { items: [{ id: CID, name: "נוי", type: "אמן", status: "חדש", createdAt: null }] } }, labelArtists: { data: { items: [] } }, victor: { data: { active: [] } }, sessions: { data: { items: [] } }, releasesFull: { data: { items: [] } }, proposalsFull: { data: { items: [prop(301, "2026-10-03"), prop(302, "2026-10-03")] } }, tasksFull: { data: { items: [] } }, shows: { data: { items: [] } } } } },
      ownerKnowledge: { status: "OK", value: knowledge }, audience: { channel: "INTERNAL", ownerAuthorized: true },
    } as never);
    const v = buildClientView(csrc([fuOn(301)]), CID)!;
    ok("7a. proposal 301 (the Owner said 'לחזור ב-20.10') → a known line with SET_PROPOSAL_FOLLOWUP, NOT a FOLLOW_UP question", v.known.some((k) => k.entityKey === `proposal:${U(301)}` && k.actions[0]?.actionId === "SET_PROPOSAL_FOLLOWUP") && !v.questions.some((q) => q.kind === "FOLLOW_UP" && q.questionHe.includes("הצעה 301")), { known: v.known, q: v.questions });
    ok("7b. proposal 302 of the SAME client (nothing said about it) is still asked — no cross-proposal suppression", v.questions.some((q) => q.kind === "FOLLOW_UP" && q.questionHe.includes("הצעה 302")), v.questions);
    ok("7c. the record signal FOLLOW_UP_DUE stays for both proposals (D1: knowledge never removes a record signal)", v.signals.filter((s) => s.code === "FOLLOW_UP_DUE").length === 2);
  }

  console.log("\nS8. Stage 5 — Victor / vendor outside communication: work-level identity, commitment ≠ communication, push ≠ proof");
  {
    const T = "2026-10-05", W1 = `victor-work:${U(401)}`, W2 = `victor-work:${U(402)}`;
    const vc = (o: Partial<OwnerKnowledgeRecord> & { id: string; value: Record<string, unknown> }) => ({ createdAt: "2026-10-03T10:00:00Z", kind: "VENDOR_COMMITMENT", subjectKey: "vendor:VICTOR", identityKeys: ["vendor:VICTOR"], slotKey: `${o.id}-s`, epistemic: "OWNER_REPORTED", meaningHe: "ויקטור התחייב לשלוח תיקון (בלי מועד).", operation: "ASSERT", supersedesId: null, reviewAt: "2026-10-17", expiresAt: null, ...o } as OwnerKnowledgeRecord);
    const base = { label: "Mad Luv", lastUploadAt: "2026-09-19T10:00:00Z", todayIL: T, vendorLabel: "ויקטור", vendorBall: "VICTOR" };
    const onW1 = vc({ id: "c1", value: { commitment: "SEND_REVISION", work: W1 } });
    const k1 = vendorWorkKnown({ ...base, workKey: W1, records: [onW1] });
    ok("8a. a commitment on THIS work ('הוא על זה') → a known line (no repeated 'contact Victor?'); nothing canonical is claimed", !!k1 && k1.questionKind === "OUTSIDE_COMMUNICATION" && k1.actions.length === 0 && /אין פעולה קנונית/.test(k1.canonicalHe) && !/עדכנתי|רשמתי|סגרתי/.test(k1.textHe), k1);
    ok("8b. …never applied to another work of the same vendor", vendorWorkKnown({ ...base, workKey: W2, records: [onW1] }) === null);
    ok("8c. a vendor-level commitment without a work never covers a specific work (no vendor-wide suppression)", vendorWorkKnown({ ...base, workKey: W1, records: [vc({ id: "c2", value: { commitment: "SEND_REVISION" } })] }) === null);
    ok("8d. a version uploaded AFTER the commitment → newer canonical evidence: the old statement no longer counts (the question may return)", vendorWorkKnown({ ...base, workKey: W1, lastUploadAt: "2026-10-04T10:00:00Z", records: [onW1] }) === null);
    const wd = [onW1, { ...onW1, id: "c1w", operation: "WITHDRAW", supersedesId: "c1", createdAt: "2026-10-04T08:00:00Z" } as OwnerKnowledgeRecord];
    ok("8e. a withdrawn commitment → the question can be asked again (activeKnowledge)", vendorWorkKnown({ ...base, workKey: W1, records: activeKnowledge(wd, T) }) === null);
    const ans = (o: Record<string, unknown>) => ({ questionId: victorDeliveryQuestionId(U(401)), contextId: "ctx-9", questionType: "WAS_DELIVERY_REVIEWED_OUTSIDE_SYSTEM", answerCode: "REVIEWED_OUTSIDE_SYSTEM", answeredAt: "2026-09-25T10:00:00Z", status: "ACTIVE", ...o });
    const k2 = vendorWorkKnown({ ...base, workKey: W1, records: [], answers: [ans({})] });
    ok("8f. 'דיברתי איתו / עברנו על זה' recorded as the existing review answer (Owner Context) → known line, basis OWNER_ANSWER — outside communication, NOT a commitment", k2?.basis.kind === "OWNER_ANSWER" && /מחוץ למערכת/.test(k2.textHe) && k2.questionKind === "OUTSIDE_COMMUNICATION", k2);
    ok("8g. the answer of ANOTHER work's case never applies (exact question id per work)", vendorWorkKnown({ ...base, workKey: W2, records: [], answers: [ans({})] }) === null);
    ok("8h. a superseded / not-applicable answer does not count", vendorWorkKnown({ ...base, workKey: W1, records: [], answers: [ans({ status: "SUPERSEDED" })] }) === null);
    ok("8i. a newer upload than the answer → a real new reason (null → the question returns)", vendorWorkKnown({ ...base, workKey: W1, lastUploadAt: "2026-09-30T10:00:00Z", records: [], answers: [ans({})] }) === null);
    const upd = (ballWith: string) => ({ id: "i1", ballWith, createdAt: "2026-09-28T10:00:00Z", whatHappened: "שלחתי לויקטור הערות בוואטסאפ" });
    ok("8j. a processed update on the work's project that puts the ball with Victor → known (the caller passes it only for the project's single Victor work)", vendorWorkKnown({ ...base, workKey: W1, records: [], projectUpdate: upd("VICTOR") })?.basis.kind === "OWNER_KNOWLEDGE");
    ok("8k. an update that says the ball is the Owner's / an engineer's is not about Victor → no known line", vendorWorkKnown({ ...base, workKey: W1, records: [], projectUpdate: upd("OWNER") }) === null && vendorWorkKnown({ ...base, workKey: W1, records: [], projectUpdate: upd("ENGINEER") }) === null);
    const kc = read("lib/partner/sunny/known-context.ts");
    ok("8l. push ≠ proof: the vendor helper has no push / marker / notification input", !/markerStateOf|sendPush|push_|P_VICTOR|notifiedAt/.test(kc.slice(kc.indexOf("export function vendorWorkKnown"))));
    // victor_view: the question for THIS work is replaced; the other work is still asked; the record signal stays
    const vFile = (at: string, v: string) => ({ name: `${v}.wav`, uploadedAt: at, versionLabel: v, durationSeconds: null, size: null, hasShareLink: false, path: null, uploadedBy: "victor" });
    const vRow = (id: number) => ({ id: U(id), projectId: null, vendorName: "victor", title: `work ${id}`, status: "פעיל", workState: null, sentDate: "2026-09-01", internalDeadline: null, linkedTaskId: null, notes: null, briefText: null, references: [], filesSent: [vFile("2026-09-01T10:00:00Z", "v1"), vFile("2026-09-19T10:00:00Z", "v2")], filesReceived: [], briefFiles: [],
      reviews: [{ version: "v1", sentAt: "2026-09-05T10:00:00Z", draft: false, notes: "x", sentNotes: "x", status: "waiting" }], returnedDate: null, outcome: null, quality: null, enteredProject: null, dropboxFolder: null, hasFolderLink: false, createdAt: null, updatedAt: null });
    const vsrc = (knowledge: unknown[], answers: unknown[] = []) => ({
      now: new Date(`${T}T09:00:00Z`), identities: { cleantone: null },
      state: { status: "OK", value: { todayIL: T, domains: { projects: { data: { index: {}, open: [] } }, clients: { data: { items: [] } }, labelArtists: { data: { items: [] } }, victor: { data: { active: [] } }, sessions: { data: { items: [] } }, releasesFull: { data: { items: [] } }, proposalsFull: { data: { items: [] } }, tasksFull: { data: { items: [] } } } } },
      projectDetail: { status: "OK", value: { victor: { rows: [vRow(401), vRow(402)], capped: false }, engineerWork: { rows: [], capped: false }, mixVersions: { rows: [], capped: false }, mixComments: { rows: [], capped: false }, tasks: { rows: [], capped: false }, actions: { rows: [], capped: false }, projectSettings: { rows: [], capped: false }, finalFiles: { rows: [], capped: false }, mixTargets: { rows: [], capped: false }, mixTargetNotes: { rows: [], capped: false } } },
      settings: { status: "OK", value: { families: {} } }, ownerKnowledge: { status: "OK", value: knowledge },
      memory: { status: "OK", value: { entities: [{ ownerDecisions: answers }] } }, audience: { channel: "INTERNAL", ownerAuthorized: true },
    } as never);
    const vv = buildVictorView(vsrc([onW1]));
    ok("8m. victor_view: work 401 (commitment) → known line, no OUTSIDE_COMMUNICATION question; work 402 (nothing said) → still asked", vv.known.some((k) => k.entityKey === W1) && !vv.questions.some((q) => q.kind === "OUTSIDE_COMMUNICATION" && q.work === W1) && vv.questions.some((q) => q.kind === "OUTSIDE_COMMUNICATION" && q.work === W2), { known: vv.known.map((k) => k.entityKey), q: vv.questions.map((q) => `${q.kind}:${q.work}`) });
    ok("8n. the record signal WAITING_ON_OWNER stays for both works (the ball is unchanged)", vv.signals.filter((s) => s.code === "WAITING_ON_OWNER").length === 2);
    const vv2 = buildVictorView(vsrc([], [ans({})]));
    ok("8o. the existing review answer (dashboard) also turns the question into a known line for THAT work only", vv2.known.some((k) => k.entityKey === W1 && k.basis.kind === "OWNER_ANSWER") && vv2.questions.some((q) => q.kind === "OUTSIDE_COMMUNICATION" && q.work === W2));
  }

  console.log("\nS9. Stage 6 — the Action Layer: markers read, PRIOR_EXECUTION warning only, recentActions provenance only, price 0 refused");
  {
    const SV = PRIMITIVES_BY_ID.get("SEND_VICTOR_VERSION_NOTES")!;
    ok("9a. SEND_VICTOR_VERSION_NOTES: the review already sent (no newer draft) → the plan refuses ALREADY_SENT (the record says sent — no second push)", (SV.plan({ versionKey: "v2" }, { title: "Mad Luv", hasNotes: true, notesSent: true }) as { ok: boolean; code?: string }).code === "ALREADY_SENT");
    ok("9b. …new notes saved as a draft after the send → plannable again", (SV.plan({ versionKey: "v2" }, { title: "Mad Luv", hasNotes: true, notesSent: false }) as { ok: boolean }).ok === true);
    ok("9c. the read derives notesSent from the record (sent && !draft) — never a constant", /notesSent: !!rv\?\.sent && !rv\.draft/.test(read("lib/partner/act/primitives/victor.ts")));
    const NM = PRIMITIVES_BY_ID.get("NOTIFY_MIX_READY")!;
    const st = { notified: true, engineerName: "Steven" };
    ok("9d. NOTIFY_MIX_READY: the app's marker says sent → refused at PLAN time (ALREADY_SENT), not a failed step; sendAgain → plannable", (NM.plan({}, st) as { code?: string }).code === "ALREADY_SENT" && (NM.plan({ sendAgain: true }, st) as { ok: boolean }).ok === true && (NM.plan({}, { notified: false, engineerName: "Steven" }) as { ok: boolean }).ok === true);
    ok("9d2. the read uses the existing marker reader (readMixReadySent), never a constant false", /notified: await d\.readMixReadySent\(id\)/.test(read("lib/partner/act/primitives/mix.ts")));
    const AP = PRIMITIVES_BY_ID.get("SET_AGREED_PRICE")!;
    ok("9e. SET_AGREED_PRICE 0 → refused ZERO_PRICE with the no-charge path named (no loop)", (AP.plan({ agreedPrice: 0, currency: "₪" }, { agreedPrice: null, currency: "₪" }) as { code?: string; messageHe?: string }).code === "ZERO_PRICE");
    // PRIOR_EXECUTION through the real service on the harness: a RECEIPT action (an email report) executed once → the next plan warns
    const w = { sent: 0 };
    const m = mkDeps({ async reportEmailConfigured() { return true; }, async sendReportNow() { w.sent++; return { subject: "דוח בוקר" }; } });
    const p1 = await planAction({ intentHe: "דוח בוקר", actionId: "SEND_REPORT_NOW", args: { report: "morning" } }, OWNER, m.d);
    ok("9f. first plan of a RECEIPT action → no priorExecution", p1.status === "PREVIEW" && !("priorExecution" in p1), p1);
    const a1 = await approveAction({ planId: p1.planId, planHash: p1.planHash, confirmationText: "מאשר" }, OWNER, m.d);
    const e1 = await executeAction({ planId: p1.planId, approvalToken: a1.approvalToken, confirmationText: "מאשר" }, OWNER, m.d);
    ok("9g. executed: canonicalEffect RECEIPT (never presented as FRESH_READ)", e1.status === "APPLIED_AS_EXPECTED" && e1.canonicalEffect === "RECEIPT" && !/בדקתי מחדש/.test(String(e1.messageHe)), e1);
    const p2 = await planAction({ intentHe: "דוח בוקר", actionId: "SEND_REPORT_NOW", args: { report: "morning" } }, OWNER, m.d);
    const pe = (p2.priorExecution as Array<{ outcome: string; warningHe: string; verifyKind: string }> | undefined) ?? [];
    ok("9h. a second plan → PREVIEW (never blocked) with priorExecution: action + target + time + RECEIPT verification", p2.status === "PREVIEW" && pe.length === 1 && pe[0].outcome === "APPLIED_AS_EXPECTED" && pe[0].verifyKind === "RECEIPT" && /כבר בוצעה בעבר/.test(pe[0].warningHe) && /קבלה/.test(pe[0].warningHe), p2);
    ok("9i. …and the warning is in the preview's warnings shown to the Boss", JSON.stringify(p2.preview).includes("כבר בוצעה בעבר"));
    const hist = await planStatus({ history: true }, OWNER, m.d);
    ok("9j. history carries each step's verifyKind (RECEIPT) — a receipt never reads like a re-read change", (hist.items as Array<{ steps: Array<{ verifyKind: string }> }>).some((x) => x.steps[0]?.verifyKind === "RECEIPT"), hist.items);
    // an OUTCOME_UNKNOWN earlier run → "ייתכן שכבר בוצעה", never "בוצע"
    const m2 = mkDeps({ async reportEmailConfigured() { return true; }, async sendReportNow() { return { subject: "x" }; } });
    const q1 = await planAction({ intentHe: "דוח ערב", actionId: "SEND_REPORT_NOW", args: { report: "evening" } }, OWNER, m2.d);
    await approveAction({ planId: q1.planId, planHash: q1.planHash, confirmationText: "מאשר" }, OWNER, m2.d);
    const plan1 = m2.db.rows(ACT_TABLES.plans).find((x) => x.plan_id === q1.planId)!.plan as Plan;
    const old = new Date(m2.d.nowMs() - 3_600_000).toISOString();
    m2.db.rows(ACT_TABLES.executions).push({ execution_key: executionKey(planHash(plan1), plan1.steps[0]), plan_id: q1.planId, step_index: 0, action_id: "SEND_REPORT_NOW", action_version: plan1.steps[0].actionVersion, status: "FAILED", outcome: { index: 0, actionId: "SEND_REPORT_NOW", status: "FAILED", detail: `${MAY_HAVE_RUN} interrupted`, replayed: false, at: old }, recorded_at: old });
    const q2 = await planAction({ intentHe: "דוח ערב", actionId: "SEND_REPORT_NOW", args: { report: "evening" } }, OWNER, m2.d);
    const pu = (q2.priorExecution as Array<{ outcome: string; warningHe: string }> | undefined) ?? [];
    ok("9k. an OUTCOME_UNKNOWN earlier run → 'ייתכן שכבר בוצעה … לא אומתה' — never presented as done; still only a warning", q2.status === "PREVIEW" && pu[0]?.outcome === "OUTCOME_UNKNOWN" && /ייתכן/.test(pu[0].warningHe) && /לא אומתה/.test(pu[0].warningHe) && !/כבר בוצעה בעבר/.test(pu[0].warningHe), q2);
    // recentActions (connector): provenance only; unavailable ≠ "nothing was done"
    const P = { userId: "owner-user-1", clientId: "client-1", scope: "partner:read partner:act", tokenId: "t" } as never;
    const deps = (call: () => Promise<Record<string, unknown>>) => ({ config: { actEnabled: true, toolTimeoutMs: 2000 }, act: { call } }) as never;
    const ra = await recentActionsFor("project:x", P, deps(async () => ({ status: "HISTORY", items: [{ planId: "pl_1", executedAt: "2026-10-05T10:00:00Z", intentHe: { text: "מחיר", trust: "OWNER_REQUEST" }, outcome: "EXECUTED", steps: [{ actionId: "SET_AGREED_PRICE", entity: "project:x", outcome: "APPLIED_AS_EXPECTED", verifyKind: "FRESH_READ" }] }, { planId: "pl_2", outcome: "NOT_EXECUTED", steps: [] }] })));
    ok("9l. recentActions = provenance only (meaning PROVENANCE_ONLY, the note says the live records are the state); never-executed plans are left out", ra.status === "OK" && ra.meaning === "PROVENANCE_ONLY" && /לא מצב/.test(String(ra.noteHe)) && (ra.items as unknown[]).length === 1, ra);
    const rb = await recentActionsFor(null, P, deps(async () => { throw new Error("down"); }));
    ok("9m. history unreadable → UNAVAILABLE + 'זה לא אומר שלא בוצע כלום' (never 'nothing was done')", rb.status === "UNAVAILABLE" && /לא אומר שלא בוצע/.test(String(rb.noteHe)));
    const rc = await recentActionsFor(null, { ...(P as object), scope: "partner:read" } as never, deps(async () => ({ status: "HISTORY", items: [] })));
    ok("9n. without the act scope / channel → NOT_CONNECTED (not 'none')", rc.status === "NOT_CONNECTED");
    ok("9o. recentActions never touches truth: it is attached beside the gateway result (no reader of it in any detector / view)", !/recentActions/.test([read("lib/partner/needs-me/curate.ts"), read("lib/partner/sunny/operating.ts"), read("lib/partner/finance/integrity.ts"), read("lib/partner/cases/engine.ts")].join("\n")));
  }

  console.log("\nS10. Stage 7 — hygiene on these flows: payment correction is asked, a LEARNED close needs knowledge in use, no stale 'no primitive' text");
  {
    const OWNER_ID = "0f0f0f0f-0000-4000-8000-00000000a0a0";
    const ACTOR = { userId: OWNER_ID, clientId: "rbmcp_" + "c".repeat(40), tokenId: "00000000-0000-4000-8000-00000000abcd" };
    const PID = U(10);
    const ksrc = { now: new Date("2026-10-05T09:00:00Z"), identities: { cleantone: null }, state: { status: "OK", value: { todayIL: "2026-10-05", domains: { projects: { data: { index: { [PID]: { name: "יהלום", status: "בעבודה" } }, open: [] } }, clients: { data: { items: [] } }, labelArtists: { data: { items: [] } }, shows: { data: { items: [] } }, proposalsFull: { data: { items: [] } }, victor: { data: { active: [] } }, steven: { data: { open: [] } } } } } } as never;
    const recs: OwnerKnowledgeRecord[] = [{ id: "p-old", createdAt: "2026-10-04T10:00:00Z", kind: "PAYMENT_REPORTED_BY_OWNER", subjectKey: `project:${PID}`, identityKeys: [`project:${PID}`], slotKey: `PAYMENT_REPORTED_BY_OWNER|project:${PID}|payment:RECEIVED:1000:₪:-`, value: { direction: "RECEIVED", amount: 1000, currency: "₪" }, epistemic: "OWNER_REPORTED", meaningHe: "הבוס דיווח: התקבל ₪1,000", operation: "ASSERT", supersedesId: null, reviewAt: "2026-10-11", expiresAt: null } as unknown as OwnerKnowledgeRecord];
    const deps: KnowledgeProposeDeps = {
      secret: "s".repeat(48), nowMs: () => Date.parse("2026-10-05T09:00:00Z"), isOwner: async (u) => u === OWNER_ID,
      async loadLive() { return { ok: true, live: { src: ksrc, records: recs.map((r) => ({ ...r })), facts: { todayIL: "2026-10-05", projectStatus: () => "בעבודה", financeMatch: () => false } } }; },
      store: { async list() { return { status: "OK", records: recs }; }, async appendBatch() { return { status: "APPENDED", records: [] }; } } as never,
      async freshRecords() { return recs; }, consumeNonce: () => true,
    };
    const pv = (await previewKnowledgeCore(deps, ACTOR, [{ kind: "PAYMENT_REPORTED_BY_OWNER", subject: `project:${PID}`, fields: { direction: "RECEIVED", amount: 1500, currency: "₪" } }])) as unknown as { status: string; items?: Array<{ conflicts: Array<{ code: string; severity: string; messageHe: string }> }> };
    const cf = pv.items?.[0]?.conflicts ?? [];
    ok("10a. a second RECEIVED report on the same project (1,500 after 1,000) → a NOTE that asks: a correction (withdraw the old) or another payment? — never two silent actives, never decided alone", pv.status === "PREVIEW" && cf.some((c) => c.code === "PAYMENT_REPORT_EXISTS" && c.severity === "NOTE" && /תיקון/.test(c.messageHe) && /תשלום נוסף/.test(c.messageHe)), pv);
    const pv2 = (await previewKnowledgeCore(deps, ACTOR, [{ kind: "PAYMENT_REPORTED_BY_OWNER", subject: `project:${PID}`, fields: { direction: "PAID", amount: 300, currency: "₪" } }])) as unknown as { status: string; items?: Array<{ conflicts: Array<{ code: string }> }> };
    ok("10b. a PAID report is not compared with a RECEIVED one (direction never mixed)", pv2.status === "PREVIEW" && !(pv2.items?.[0]?.conflicts ?? []).some((c) => c.code === "PAYMENT_REPORT_EXISTS"), pv2);
    ok("10c. an inbox update closes as LEARNED_KNOWLEDGE only with knowledge IN USE (activeKnowledge) — never a withdrawn / superseded row", /activeKnowledge\(r\.records, today\)\.some\(\(k\) => k\.id === id\)/.test(read("lib/partner/act/server.ts")));
    ok("10d. client_view's workflow names the existing proposal primitives — no stale FUTURE_PRIMITIVE_REQUIRED / 'not executable today'", !/FUTURE_PRIMITIVE_REQUIRED|no client \/ proposal primitive is executable today/.test(read("lib/partner/clients/view.ts")));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
})();
