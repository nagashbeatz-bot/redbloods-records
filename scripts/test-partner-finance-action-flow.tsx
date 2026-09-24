/**
 * Tests — F2.31–F2.35: the first end-to-end Partner business Action (RECORD_PAID_EXPENSE, Victor salary).
 *
 * Run with:   npx tsx scripts/test-partner-finance-action-flow.tsx
 *
 * NEVER touches production. The REAL readiness, surface, decide + execute cores and Action Event store run over an
 * in-memory partner_action_events table; the finance RPC is SCRIPTED here (its real behaviour is proven against the
 * disposable PostgreSQL 17 copy of production in C:/Redbloods-F1G-Test/f224/harness — f231-e2e).
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
import { deriveFinanceView } from "../lib/partner/finance/view";
import { buildFinanceBrief } from "../lib/partner/finance/brief";
import { financeActionNoteHe, strictVictorSalaryConfig, type FinanceActionCandidate } from "../lib/partner/finance/actions";
import { decideFinanceActionCore, executeFinanceActionCore, mapFinanceRpcResult, type FinanceActionServiceDeps } from "../lib/partner/finance/action-core";
import { createActionEventStore, type ActionEventSelectQuery, type ActionEventTableClient } from "../lib/partner/actions/event-persistence";
import { FINANCE_EXECUTE_RPC, validateFinanceSnapshot } from "../lib/partner/actions/finance-events";
import { hashActionSnapshot } from "../lib/partner/actions/snapshot";
import { buildActionSurface } from "../lib/partner/actions/surface";
import { parseActionSurfaceResponse, type ActionSurfaceItemDto, type FinanceActionCardDto } from "../lib/partner/actions/surface-dto";
import { interpretExecuteResponse, FINANCE_STALE_MESSAGE_HE, EXECUTE_STALE_MESSAGE_HE, buildApproveAttempt, buildExecuteAttempt } from "../components/partner/partner-decision-client";
import { PartnerActionsView, type CardControls } from "../components/partner/PartnerActionCard";
import type { FinanceOwnerAnswer } from "../lib/partner/finance/owner-answers";
import type { FinanceRaw } from "../lib/partner/finance/types";
import { productionMirror, tx } from "./fixtures/finance-mirror";

let pass = 0, fail = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log(`  ✓ ${name}`); pass++; } else { console.log(`  ✗ ${name}\n      expected ${e}\n      actual   ${a}`); fail++; }
}
const ok = (name: string, cond: boolean) => { if (cond) { console.log(`  ✓ ${name}`); pass++; } else { console.log(`  ✗ ${name}`); fail++; } };

const NOW = new Date("2026-09-24T09:00:00Z");
const ACTOR = "00000000-0000-4000-8000-00000000a0a0";
const S_ID = "a8018e6e-17c0-47e4-a2d0-97b3aeb817b0", D_ID = "933ba4c2-4fc6-4685-9102-2b42bfc0739d";
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
/** The production mirror + the raw Victor salary config exactly as production stores it (read-only preflight 2026-09-24). */
function prodRaw(): FinanceRaw {
  const r = productionMirror();
  r.victorSalaryConfig = {
    settings: { paceMetric: "נכנסו לפרויקט בפועל", monthlyGoal: 12, salaryPayDay: 10, monthlySalary: 550, salaryCurrency: "$", stuckAfterDays: 5 },
    overrides: { "2026-05": 550, "2026-06": 500, "2026-07": 550, "2026-08": 550 },
    statusOverrides: { "2026-05": "שולם", "2026-06": "שולם", "2026-07": "שולם", "2026-08": "שולם" },
  };
  return r;
}
function answersFor(raw: FinanceRaw, ymd = "2026-09-10"): FinanceOwnerAnswer[] {
  const v0 = deriveFinanceView(raw, NOW);
  const find = (t: string, v = v0) => [...v.integrity.questions, ...v.integrity.top.questions].find((x) => x.questionType === t && x.subject.id === "VICTOR_SALARY:2026-08")!;
  const qs = find("FINANCE_RECURRING_PAYMENT_STATUS");
  const a1: FinanceOwnerAnswer = { contextId: S_ID, questionId: qs.identity!.questionId, questionType: "FINANCE_RECURRING_PAYMENT_STATUS", caseId: qs.identity!.caseId, caseType: qs.identity!.issueType, subjectType: "recurring", subjectId: "VICTOR_SALARY:2026-08", answerCode: "PAID_NEEDS_RECORDING", answerValueYmd: null, factsFingerprint: qs.identity!.fingerprint, answeredAt: "2026-09-23T23:17:12.375Z" };
  const qd = find("FINANCE_PAYMENT_DATE", deriveFinanceView(raw, NOW, [a1]));
  const a2: FinanceOwnerAnswer = { contextId: D_ID, questionId: qd.identity!.questionId, questionType: "FINANCE_PAYMENT_DATE", caseId: qd.identity!.caseId, caseType: qd.identity!.issueType, subjectType: "recurring", subjectId: "VICTOR_SALARY:2026-08", answerCode: "EXACT_DATE", answerValueYmd: ymd, factsFingerprint: qd.identity!.fingerprint, answeredAt: "2026-09-24T05:55:07.397Z" };
  return [a1, a2];
}
const RAW = prodRaw();
const ANSWERS = answersFor(RAW);
const victor = (raw: FinanceRaw, answers = ANSWERS) => deriveFinanceView(raw, NOW, answers).actions.find((c) => c.actionType === "RECORD_PAID_EXPENSE")!;
const mut = (f: (r: FinanceRaw) => void) => { const r = clone(RAW); f(r); return r; };

// ── in-memory partner_action_events (unique request_id / one successor per event, like the DB) ──
type Row = Record<string, unknown>;
function memDb() {
  const rows: Row[] = [];
  const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  let rpcImpl: (fn: string, args: Record<string, unknown>) => { data: unknown; error: { code?: string; message?: string } | null } = () => ({ data: null, error: { code: "XX000", message: "no rpc scripted" } });
  let seq = 0;
  const client = {
    from: () => ({
      select: () => {
        let r = [...rows];
        const q = {
          eq: (c: string, v: string) => { r = r.filter((x) => x[c] === v); return q; },
          order: () => q,
          range: (a: number, b: number) => { r = r.slice(a, b + 1); return q; },
          then: (f: (v: { data: unknown[]; error: null }) => unknown) => Promise.resolve({ data: clone(r), error: null }).then(f),
        };
        return q as unknown as ActionEventSelectQuery;
      },
      insert: (row: Row) => ({
        select: () => ({
          single: async () => {
            if (rows.some((x) => x.request_id === row.request_id)) return { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint \"partner_action_events_request_uk\"" } };
            if (row.supersedes_event_id && rows.some((x) => x.supersedes_event_id === row.supersedes_event_id)) return { data: null, error: { code: "23505", message: "partner_action_events_linear_uk" } };
            seq++;
            const full = { id: `0000000${seq}-0000-4000-8000-000000000000`.slice(-36).replace(/^0+/, (m) => m), created_at: new Date(NOW.getTime() + seq * 1000).toISOString(), ...clone(row) };
            full.id = `${String(seq).padStart(8, "0")}-0000-4000-8000-${String(seq).padStart(12, "0")}`;
            rows.push(full);
            return { data: clone(full), error: null };
          },
        }),
      }),
    }),
    rpc: async (fn: string, args: Record<string, unknown>) => { rpcCalls.push({ fn, args: clone(args) }); return rpcImpl(fn, args); },
  } as unknown as ActionEventTableClient;
  return { rows, rpcCalls, store: createActionEventStore(client), script(f: typeof rpcImpl) { rpcImpl = f; } };
}
function deps(db: ReturnType<typeof memDb>, raw: () => FinanceRaw, answers: () => FinanceOwnerAnswer[] = () => ANSWERS): FinanceActionServiceDeps {
  return { now: () => NOW, store: db.store, live: { loadCandidates: async () => ({ status: "OK", candidates: deriveFinanceView(raw(), NOW, answers()).actions }) }, audit: () => {} };
}
async function surfaceFor(db: ReturnType<typeof memDb>, raw: FinanceRaw) {
  const r = await buildActionSurface({
    listProposals: async () => ({ status: "OK", items: [] }),
    getActionChain: async () => ({ status: "OK", chain: [], head: null }),
    listFinanceCandidates: async () => ({ status: "OK", candidates: deriveFinanceView(raw, NOW, ANSWERS).actions }),
    getFinanceActionChain: (id) => db.store.getFinanceActionChain(id),
    now: () => NOW, log: () => {},
  });
  return r.status === "OK" ? r : null;
}
const noop = () => {};
const controls = (over: Partial<CardControls> = {}): CardControls => ({ phase: "idle", panel: "none", message: null, canRetry: false, notNowChoice: null, customYmd: "", changeCode: null, changeYmd: "", onApprove: noop, onOpenNotNow: noop, onOpenChange: noop, onCancel: noop, onRetry: noop, onNotNowChoice: noop, onCustomYmd: noop, onConfirmNotNow: noop, onChangeCode: noop, onChangeYmd: noop, onConfirmChange: noop, onExecute: noop, renderDatePicker: () => null, ...over });
const render = (items: ActionSurfaceItemDto[]) => renderToStaticMarkup(<PartnerActionsView items={items} isMobile={false} controlsFor={() => controls()} />);
const visibleText = (html: string) => html.replace(/<[^>]+>/g, " ");

async function main() {
  const ROOT = path.resolve(__dirname, "..");
  const rd = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8");
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");

  console.log("Readiness aligned with the RPC (Step 3)");
  const c = victor(RAW);
  {
    check("READY_TO_PROPOSE + executable, facts exactly the canonical row", [c.readiness, c.executable, c.facts?.amount, c.facts?.currency, c.facts?.date, c.facts?.description], ["READY_TO_PROPOSE", true, 550, "$", "2026-09-10", "משכורת Victor — אוגוסט 2026"]);
    ok("identity + snapshot = the finance-action-v1 contract proven against the RPC (validate = [], hash = canonical SHA-256)", !!c.eventSnapshot && validateFinanceSnapshot(c.eventSnapshot).length === 0 && c.eventSnapshot.id === c.id && c.snapshotHash === hashActionSnapshot(c.eventSnapshot)
      && c.id === `RECORD_PAID_EXPENSE:VICTOR_SALARY:2026-08:2026-08:${S_ID}+${D_ID}:550:$:2026-09-10`);
    const unverified = victor(mut((r) => { delete r.victorSalaryConfig; }));
    check("raw config not read (older caller) → READY but NEVER executable, no snapshot", [unverified.readiness, unverified.executable, unverified.eventSnapshot ?? null], ["READY_TO_PROPOSE", false, null]);
    const codes: Array<[string, (r: FinanceRaw) => void, string]> = [
      ["config row missing", (r) => { r.victorSalaryConfig!.settings = null; }, "CONFIG_MISSING"],
      ["currency blank", (r) => { (r.victorSalaryConfig!.settings as Record<string, unknown>).salaryCurrency = " "; }, "CONFIG_MISSING"],
      ["no override + no monthlySalary", (r) => { r.victorSalaryConfig!.overrides = {}; delete (r.victorSalaryConfig!.settings as Record<string, unknown>).monthlySalary; }, "CONFIG_MISSING"],
      ["override not a number", (r) => { (r.victorSalaryConfig!.overrides as Record<string, unknown>)["2026-08"] = "550"; }, "CONFIG_INVALID"],
      ["currency not allowed", (r) => { (r.victorSalaryConfig!.settings as Record<string, unknown>).salaryCurrency = "USD"; }, "CONFIG_INVALID"],
      ["salary page says not paid", (r) => { (r.victorSalaryConfig!.statusOverrides as Record<string, unknown>)["2026-08"] = "לא שולם"; }, "STATUS_CONTRADICTS"],
      ["existing paid row", (r) => { r.transactions.push(tx({ type: "expense", status: "שולם", amount: 550, currency: "$", linkedSessionId: "victor_salary_2026-08" })); }, "ALREADY_RECORDED"],
      ["existing cancelled row (Owner policy: fail closed)", (r) => { r.transactions.push(tx({ type: "expense", status: "בוטל", amount: 550, currency: "$", linkedSessionId: "victor_salary_2026-08" })); }, "CANCELLED_RECORD_EXISTS"],
      ["existing not-paid row", (r) => { r.transactions.push(tx({ type: "expense", status: "לא שולם", amount: 550, currency: "$", linkedSessionId: "victor_salary_2026-08" })); }, "EXISTING_RECORD_NOT_PAID"],
      ["unkeyed row with the canonical description", (r) => { r.transactions.push({ ...tx({ type: "expense", status: "שולם", amount: 550, currency: "$", linkedSessionId: "" }), description: "משכורת Victor — אוגוסט 2026" }); }, "AMBIGUOUS_EXISTING_RECORD"],
    ];
    for (const [name, f, code] of codes) {
      const x = victor(mut(f));
      check(`${code} ← ${name} (never executable, no snapshot)`, [x.readiness, x.executable, x.id], [code, false, null]);
    }
    const future = victor(RAW, answersFor(RAW, "2026-12-01"));
    check("PAYMENT_DATE_OUT_OF_RANGE ← a payment date after today", [future.readiness, future.executable], ["PAYMENT_DATE_OUT_OF_RANGE", false]);
    const o600 = victor(mut((r) => { (r.victorSalaryConfig!.overrides as Record<string, unknown>)["2026-08"] = 600; }));
    ok("the canonical override decides the amount (600 → a DIFFERENT action identity; August is never 'always 550')", o600.readiness === "READY_TO_PROPOSE" && o600.facts?.amount === 600 && o600.id !== c.id);
    ok("no status override for the period is fine (Owner Context is the authority)", victor(mut((r) => { delete (r.victorSalaryConfig!.statusOverrides as Record<string, unknown>)["2026-08"]; })).executable === true);
    check("strict config helper = the RPC's reading", [strictVictorSalaryConfig(RAW.victorSalaryConfig, "2026-06"), strictVictorSalaryConfig(RAW.victorSalaryConfig, "2025-01")], [{ status: "OK", amount: 500, currency: "$" }, { status: "OK", amount: 550, currency: "$" }]);
    const v = deriveFinanceView(RAW, NOW, ANSWERS);
    check("the brief no longer says 'no safe action' — the card is the action", [financeActionNoteHe(c), buildFinanceBrief(v.state, v.integrity, { actionNoteHe: v.actionNoteHe }).rehab.actionNoteHe], [null, null]);
  }

  console.log("Surface + Owner decision (Steps 2, 4, 5, 17: 1-7)");
  {
    const db = memDb();
    const s0 = await surfaceFor(db, RAW);
    const card = s0!.response.items[0] as FinanceActionCardDto;
    check("1. READY_TO_PROPOSE shows the action with the Owner text", [s0!.response.items.length, card.actionType, card.state, card.headlineHe, card.titleHe, card.amountHe, card.paymentStatusHe, card.paymentDateHe],
      [1, "RECORD_PAID_EXPENSE", "SHOW", "אפשר לרשום את משכורת Victor של אוגוסט בכספים.", "משכורת Victor — אוגוסט 2026", "$550", "שולם", "10.09.2026"]);
    ok("the card parses strictly on the client and carries no value a caller could submit", parseActionSurfaceResponse(JSON.parse(JSON.stringify(s0!.response))).ok && !("amount" in card) && !("facts" in card));
    const html = render([card]);
    ok("SHOW renders [אשר] [לא עכשיו] only (no שנה תאריך, no בצע עכשיו) and no ids / hashes as text", /אשר</.test(html) && /לא עכשיו</.test(html) && !/שנה תאריך/.test(html) && !/בצע עכשיו/.test(html) && !/[0-9a-f]{8}-[0-9a-f]{4}-|[0-9a-f]{64}/.test(visibleText(html)));
    ok("loading the surface wrote nothing (no Action Event)", db.rows.length === 0 && db.rpcCalls.length === 0);

    // 2. NOT_NOW writes a decision only
    const d2 = memDb();
    const nn = await decideFinanceActionCore(deps(d2, () => RAW), { userId: ACTOR }, { ...buildApproveAttempt(card, randomUUID()).body, decision: "NOT_NOW", deferChoice: "TOMORROW" });
    check("2. NOT_NOW writes ONLY the NOT_NOW decision event (no RPC)", [nn.status, d2.rows.map((r) => [r.event_type, r.action_type]), d2.rpcCalls.length], ["RECORDED", [["NOT_NOW", "RECORD_PAID_EXPENSE"]], 0]);
    check("2b. deferred → hidden from the surface", (await surfaceFor(d2, RAW))!.response.items.length, 0);

    // 3-5. APPROVE writes the APPROVED event only — no transaction, no RPC, no Finance change
    const realizedBefore = JSON.stringify(deriveFinanceView(RAW, NOW, ANSWERS).state.realized);
    const ap = await decideFinanceActionCore(deps(db, () => RAW), { userId: ACTOR }, buildApproveAttempt(card, randomUUID()).body);
    check("3. APPROVED writes exactly one APPROVED event with the exact v1 snapshot", [ap.status, db.rows.length, db.rows[0]?.event_type, db.rows[0]?.action_schema_version, db.rows[0]?.subject_type, JSON.stringify(db.rows[0]?.action_snapshot) === JSON.stringify(c.eventSnapshot)], ["RECORDED", 1, "APPROVED", "partner-finance-action-v1", "recurring", true]);
    ok("4. approval does not execute: no RPC call, no transaction written", db.rpcCalls.length === 0 && RAW.transactions.every((t) => t.linkedSessionId !== "victor_salary_2026-08"));
    check("5. approval does not change Finance totals", JSON.stringify(deriveFinanceView(RAW, NOW, ANSWERS).state.realized), realizedBefore);
    const s1 = await surfaceFor(db, RAW);
    const aw = s1!.response.items[0] as FinanceActionCardDto;
    check("6. approved state shows [בצע עכשיו] with the approved summary", [aw.state, aw.approvalEventId === db.rows[0].id, /בצע עכשיו/.test(render([aw])), /ההוצאה עדיין לא נרשמה בכספים\./.test(render([aw])), aw.titleHe, aw.amountHe, aw.paymentDateHe], ["AWAITING_EXECUTION", true, true, true, "משכורת Victor — אוגוסט 2026", "$550", "10.09.2026"]);
    const changed = mut((r) => { (r.victorSalaryConfig!.overrides as Record<string, unknown>)["2026-08"] = 600; });
    const sChanged = await surfaceFor(db, changed);
    ok("an approval the RPC would refuse is never offered for execution (config changed → the approved card disappears, a NEW proposal shows)", sChanged!.response.items.length === 1 && (sChanged!.response.items[0] as FinanceActionCardDto).state === "SHOW" && (sChanged!.response.items[0] as FinanceActionCardDto).amountHe === "$600");
    const sBlocked = await surfaceFor(db, mut((r) => { r.transactions.push(tx({ type: "expense", status: "בוטל", amount: 550, currency: "$", linkedSessionId: "victor_salary_2026-08" })); }));
    check("7. an unsupported / blocked finance state never shows Execute (cancelled row → no card at all)", sBlocked!.response.items.length, 0);
    check("7b. a non-executable candidate is never surfaced (config not read)", (await surfaceFor(memDb(), mut((r) => { delete r.victorSalaryConfig; })))!.response.items.length, 0);

    // decide guards
    const g = memDb();
    const gd = deps(g, () => RAW);
    const vals = await Promise.all((["amount", "date", "description", "status"] as const).map((k) => decideFinanceActionCore(gd, { userId: ACTOR }, { ...buildApproveAttempt(card, randomUUID()).body, [k]: "x" })));
    check("decide: every browser-supplied value → INVALID_INPUT, nothing written", [vals.map((r) => r.status), g.rows.length], [["INVALID_INPUT", "INVALID_INPUT", "INVALID_INPUT", "INVALID_INPUT"], 0]);
    check("decide: a stale hash → PROPOSAL_CHANGED (nothing written)", [(await decideFinanceActionCore(gd, { userId: ACTOR }, { ...buildApproveAttempt(card, randomUUID()).body, seenSnapshotHash: "0".repeat(64) })).status, g.rows.length], ["PROPOSAL_CHANGED", 0]);
    check("decide: the action no longer derivable → NOT_DERIVABLE", (await decideFinanceActionCore(deps(g, () => mut((r) => { (r.victorSalaryConfig!.overrides as Record<string, unknown>)["2026-08"] = 600; })), { userId: ACTOR }, buildApproveAttempt(card, randomUUID()).body)).status, "NOT_DERIVABLE");
    const rid = randomUUID();
    const r1 = await decideFinanceActionCore(gd, { userId: ACTOR }, buildApproveAttempt(card, rid).body);
    const r2 = await decideFinanceActionCore(gd, { userId: ACTOR }, buildApproveAttempt(card, rid).body);
    check("decide: a double click with the same requestId → REPLAY (one event)", [r1.status, r2.status, g.rows.length], ["RECORDED", "REPLAY", 1]);
  }

  console.log("Execution dispatch + request contract (Steps 6-9)");
  {
    const db = memDb();
    const s0 = await surfaceFor(db, RAW);
    await decideFinanceActionCore(deps(db, () => RAW), { userId: ACTOR }, buildApproveAttempt(s0!.response.items[0] as FinanceActionCardDto, randomUUID()).body);
    const approval = db.rows[0];
    const aw = (await surfaceFor(db, RAW))!.response.items[0] as FinanceActionCardDto;
    const TXID = "0c0f3993-1c04-414f-8bc6-9a41b34ee36e";
    db.script((fn) => fn === FINANCE_EXECUTE_RPC ? { data: { result: "EXECUTED", eventId: "0e0e0e0e-0000-4000-8000-000000000001", actionId: approval.action_id, transactionId: TXID, amount: 550, currency: "$", date: "2026-09-10", linkedSessionId: "victor_salary_2026-08" }, error: null } : { data: null, error: { code: "42883", message: "wrong function" } });
    const body = buildExecuteAttempt(aw, randomUUID())!.body;
    check("the browser sends ONLY approvalEventId + requestId", Object.keys(body).sort(), ["approvalEventId", "requestId"]);
    const ex = await executeFinanceActionCore(deps(db, () => RAW), { userId: ACTOR }, body);
    check("8. an approved finance action calls ONLY the finance RPC, with identifiers only (no amount / currency / date)", [ex.status, db.rpcCalls.map((x) => x.fn), Object.keys(db.rpcCalls[0].args).sort(), db.rpcCalls[0].args.p_app_stale_reasons],
      ["EXECUTED", [FINANCE_EXECUTE_RPC], ["p_action_id", "p_actor_user_id", "p_app_stale_reasons", "p_approval_event_id", "p_request_id", "p_revalidation"], []]);
    check("…the actor comes from the session and the action from the persisted approval", [db.rpcCalls[0].args.p_actor_user_id, db.rpcCalls[0].args.p_action_id, db.rpcCalls[0].args.p_approval_event_id], [ACTOR, approval.action_id, approval.id]);
    check("execute: any extra (value) key → INVALID_INPUT, no RPC", [(await executeFinanceActionCore(deps(db, () => RAW), { userId: ACTOR }, { ...body, amount: 550 })).status, db.rpcCalls.length], ["INVALID_INPUT", 1]);
    check("execute: an unknown approval → APPROVAL_NOT_FOUND, no RPC", [(await executeFinanceActionCore(deps(db, () => RAW), { userId: ACTOR }, { approvalEventId: randomUUID(), requestId: randomUUID() })).status, db.rpcCalls.length], ["APPROVAL_NOT_FOUND", 1]);

    // app-side revalidation reasons (the RPC records them as STALE_AT_EXECUTION — never a write)
    const reasonsFor = async (raw: FinanceRaw, answers = ANSWERS) => {
      const n = db.rpcCalls.length;
      db.script(() => ({ data: { result: "STALE_AT_EXECUTION", eventId: "0e0e0e0e-0000-4000-8000-000000000002", reasons: ["X"] }, error: null }));
      await executeFinanceActionCore(deps(db, () => raw, () => answers), { userId: ACTOR }, { approvalEventId: approval.id as string, requestId: randomUUID() });
      return db.rpcCalls[n].args.p_app_stale_reasons;
    };
    check("13. stale Owner Context (payment date revised) → OWNER_CONTEXT / date reasons, passed to the RPC", await reasonsFor(RAW, answersFor(RAW, "2026-09-12").map((a) => (a.questionType === "FINANCE_PAYMENT_DATE" ? { ...a, contextId: "a1a1a1a1-0000-4000-8000-000000000001" } : a))), ["OWNER_CONTEXT_REVISED", "PAYMENT_DATE_CHANGED"]);
    check("14. changed salary → SALARY_AMOUNT_CHANGED", await reasonsFor(mut((r) => { (r.victorSalaryConfig!.overrides as Record<string, unknown>)["2026-08"] = 600; })), ["SALARY_AMOUNT_CHANGED"]);
    check("15. existing transaction → ALREADY_RECORDED", await reasonsFor(mut((r) => { r.transactions.push(tx({ type: "expense", status: "שולם", amount: 550, currency: "$", linkedSessionId: "victor_salary_2026-08" })); })), ["ALREADY_RECORDED"]);
    check("16. cancelled row → CANCELLED_RECORD_EXISTS (fail closed, Owner decision needed)", await reasonsFor(mut((r) => { r.transactions.push(tx({ type: "expense", status: "בוטל", amount: 550, currency: "$", linkedSessionId: "victor_salary_2026-08" })); })), ["CANCELLED_RECORD_EXISTS"]);
    check("17. not-paid row → EXISTING_RECORD_NOT_PAID", await reasonsFor(mut((r) => { r.transactions.push(tx({ type: "expense", status: "לא שולם", amount: 550, currency: "$", linkedSessionId: "victor_salary_2026-08" })); })), ["EXISTING_RECORD_NOT_PAID"]);
    check("18. ambiguous row → AMBIGUOUS_EXISTING_RECORD", await reasonsFor(mut((r) => { r.transactions.push({ ...tx({ type: "expense", status: "שולם", amount: 550, currency: "$", linkedSessionId: "" }), description: "משכורת Victor — אוגוסט 2026" }); })), ["AMBIGUOUS_EXISTING_RECORD"]);
    check("unchanged live state → no app reasons", await reasonsFor(RAW), []);

    // strict RPC result mapping (fail closed)
    check("RPC result mapping is strict", [
      mapFinanceRpcResult({ result: "EXECUTED", eventId: "0e0e0e0e-0000-4000-8000-000000000001" }).status,
      mapFinanceRpcResult({ result: "WHATEVER" }).status,
      mapFinanceRpcResult({ result: "UNSUPPORTED_ACTION" }).status,
      mapFinanceRpcResult({ result: "STALE_AT_EXECUTION", eventId: "0e0e0e0e-0000-4000-8000-000000000001", reasons: ["ALREADY_RECORDED", "bad reason; drop"] }),
    ], ["INVARIANT_VIOLATION", "INVARIANT_VIOLATION", "UNSUPPORTED_ACTION", { kind: "FINANCE", status: "STALE_AT_EXECUTION", eventId: "0e0e0e0e-0000-4000-8000-000000000001", eventType: "STALE_AT_EXECUTION", reasons: ["ALREADY_RECORDED"], transactionId: null }]);
    db.script(() => ({ data: null, error: { code: "22023", message: "PARTNER_ACTION_SNAPSHOT_INVALID: facts" } }));
    const inv = await executeFinanceActionCore(deps(db, () => RAW), { userId: ACTOR }, { approvalEventId: approval.id as string, requestId: randomUUID() });
    db.script(() => ({ data: null, error: { code: "55P03", message: "lock timeout" } }));
    const retry = await executeFinanceActionCore(deps(db, () => RAW), { userId: ACTOR }, { approvalEventId: approval.id as string, requestId: randomUUID() });
    check("RPC errors: invariant (22023) fails closed; lock timeout → RETRYABLE", [inv.status, retry.status], ["INVARIANT_VIOLATION", "RETRYABLE"]);
  }

  console.log("Owner messages (Step 9) — never raw SQL / RPC text");
  {
    const m = (status: string, reasons: string[] | undefined, eventType?: string) => interpretExecuteResponse(200, reasons ? { status, eventType, reasons } : { status, eventType }).messageHe;
    check("finance results", [
      m("EXECUTED", [], "EXECUTED"), m("STALE_AT_EXECUTION", ["ALREADY_RECORDED"], "STALE_AT_EXECUTION"), m("STALE_AT_EXECUTION", ["CANCELLED_RECORD_EXISTS"], "STALE_AT_EXECUTION"),
      m("STALE_AT_EXECUTION", ["SALARY_AMOUNT_CHANGED"], "STALE_AT_EXECUTION"), m("STALE_AT_EXECUTION", ["SOMETHING_NEW"], "STALE_AT_EXECUTION"), m("ALREADY_EXECUTED", [], "EXECUTED"),
    ], [
      "ההוצאה נרשמה בכספים.", "ההוצאה כבר רשומה בכספים.", "קיימת רשומה מבוטלת לחודש הזה. צריך החלטה שלך לפני שיוצרים רישום חדש.",
      "הגדרות המשכורת של Victor השתנו מאז האישור. לא ביצעתי — צריך לאשר מחדש.", FINANCE_STALE_MESSAGE_HE, "ההוצאה כבר נרשמה בכספים.",
    ]);
    check("the deadline messages are unchanged (no reasons in its response)", [m("STALE_AT_EXECUTION", undefined, "STALE_AT_EXECUTION"), m("EXECUTED", undefined, "EXECUTED")], [EXECUTE_STALE_MESSAGE_HE, "הפעולה בוצעה."]);
    ok("UNSUPPORTED_ACTION → a calm error (nothing executed)", interpretExecuteResponse(200, { status: "UNSUPPORTED_ACTION" }).ui === "error");
    ok("no message contains SQL / constraint / function names", [FINANCE_STALE_MESSAGE_HE, m("STALE_AT_EXECUTION", ["ALREADY_RECORDED"])].every((x) => !/partner_|transactions_|SQL|23505|rpc/i.test(x)));
  }

  console.log("Static safety (Steps 6-8, 16, 28)");
  {
    const EXEC_ROUTE = strip(rd("app/api/partner/actions/execute/route.ts"));
    ok("the execute route still accepts ONLY approvalEventId + requestId (same-origin JSON, Owner via the service)", /const ALLOWED_KEYS = \["approvalEventId", "requestId"\];/.test(rd("app/api/partner/actions/execute/route.ts")) && /checkSameOriginJson\(req\.headers\)/.test(EXEC_ROUTE));
    ok("no finance-specific route was added (no generic Finance / transaction endpoint)", !fs.existsSync(path.join(ROOT, "app/api/partner/finance/execute")) && !fs.existsSync(path.join(ROOT, "app/api/partner/finance/decide")) && !fs.existsSync(path.join(ROOT, "app/api/partner/transactions")));
    ok("TypeScript never inserts a transaction: the finance core only calls the store", !/from\(["']transactions["']\)|\.insert\(/.test(strip(rd("lib/partner/finance/action-core.ts"))));
    ok("approval never executes: decideFinanceActionCore has no RPC call", !/callFinanceExecuteRpc|\.rpc\(/.test(strip(rd("lib/partner/finance/action-core.ts")).split("export async function executeFinanceActionCore")[0]));
    ok("no automatic execution anywhere (execute only from the explicit click handler)", (strip(rd("components/partner/PartnerActionsSection.tsx")).match(/buildExecuteAttempt\(/g) ?? []).length === 1 && /onExecute: \(\) => submit\(item\.actionId, executeAttempt\(buildExecuteAttempt\(item, newRequestId\(\)\)\)\)/.test(rd("components/partner/PartnerActionsSection.tsx")));
    ok("this test never imports a production binding", !/^import .* from ["'][^"']*(lib\/supabase|finance\/server|event-store|action-service|surface-server)["'];$/m.test(fs.readFileSync(__filename, "utf8")));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
