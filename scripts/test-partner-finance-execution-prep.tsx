/**
 * Tests — F2.29 pre-production Finance execution compatibility (READ-ONLY app preparation).
 *
 * Run with:   npx tsx scripts/test-partner-finance-execution-prep.tsx
 *
 * NEVER touches production. Proves, on fixtures shaped exactly like the F2.24 candidate RPC output:
 *   memory (1-20): finance Actions indexed by snapshot.subjectKey, type-specific Outcome memory, the full learning chain;
 *   Victor salary route (21-28): the REAL route over a fake PostgREST host (23505 mapping, nothing else swallowed);
 *   parser (29-35) and Outcome (36-42) incl. the Recent Outcomes finance card;
 *   the static write boundary: no app path can approve / execute / insert a finance action.
 */
import fs from "node:fs";
import path from "node:path";
import Module from "node:module";
import { NextResponse } from "next/server";
import { renderToStaticMarkup } from "react-dom/server";

// ── fakes installed BEFORE any app module loads ──
process.env.SUPABASE_URL = "https://fake-supabase.test";
process.env.SUPABASE_SECRET_KEY = "test-only";
type Row = Record<string, unknown>;
const pg = { transactions: [] as Row[], inserts: 0, nextInsert: "ok" as "ok" | "victor_conflict" | "other_unique" | "db_error", requests: [] as string[] };
const realFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url);
  if (url.host !== "fake-supabase.test") return realFetch(input as RequestInfo, init);
  const method = (init?.method ?? "GET").toUpperCase();
  const headers = new Headers(init?.headers);
  const wantsObject = (headers.get("accept") ?? "").includes("vnd.pgrst.object");
  pg.requests.push(`${method} ${url.pathname}`);
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  if (url.pathname !== "/rest/v1/transactions") return json({ code: "42P01", message: "unknown table" }, 404);
  if (method === "GET") {
    const f = url.searchParams.get("linked_session_id");
    const rows = pg.transactions.filter((r) => !f || r.linked_session_id === f.replace(/^eq\./, ""));
    if (wantsObject) return rows.length === 1 ? json(rows[0]) : json({ code: "PGRST116", message: "0 or many rows" }, 406);
    return json(rows);
  }
  if (method === "POST") {
    pg.inserts++;
    const body = JSON.parse(String(init?.body ?? "{}")) as Row;
    if (pg.nextInsert === "victor_conflict") {
      // the race: another writer committed this period between the route's pre-check and its INSERT
      pg.transactions.push({ ...body, id: "99999999-9999-4999-8999-999999999999", payment_status: "שולם" });
      return json({ code: "23505", details: `Key (linked_session_id)=(${String(body.linked_session_id)}) already exists.`, hint: null, message: "duplicate key value violates unique constraint \"transactions_victor_salary_period_uk\"" }, 409);
    }
    if (pg.nextInsert === "other_unique") return json({ code: "23505", details: "Key (id) already exists.", hint: null, message: "duplicate key value violates unique constraint \"transactions_pkey\"" }, 409);
    if (pg.nextInsert === "db_error") return json({ code: "XX000", details: null, hint: null, message: "internal error" }, 500);
    const row = { ...body, id: "11111111-1111-4111-8111-111111111111" };
    pg.transactions.push(row);
    return json(wantsObject ? row : [row], 201);
  }
  return json({ code: "405", message: "method not emulated" }, 405);
}) as typeof fetch;
const auth = { role: "owner" as "owner" | "none" | "victor" };
const ML = Module as unknown as { _load(request: string, parent: unknown, isMain: boolean): unknown };
const origLoad = ML._load;
ML._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === "server-only") return {};
  if (/lib\/require-auth$/.test(request)) return { async requireOwner() { return auth.role === "owner" ? null : NextResponse.json({ error: "x" }, { status: auth.role === "none" ? 401 : 403 }); } };
  return origLoad.call(this, request, parent, isMain);
};

import { FINANCE_SUBJECT_NAMESPACE, financeActionId, financeSubjectUuid, mapFinanceActionEventRow, uuidV5, validateFinanceSnapshot, type PartnerFinanceActionEvent } from "../lib/partner/actions/finance-events";
import { deriveFinanceExpenseOutcome, financeOutcomeHeadlineHe, listFinanceOutcomesCore, type FinanceTxLiveRow, type PartnerFinanceActionOutcome } from "../lib/partner/actions/finance-outcome";
import { mapActionEventRow, type PartnerActionEvent } from "../lib/partner/actions/events";
import { createActionEventStore, type ActionEventSelectQuery, type ActionEventTableClient } from "../lib/partner/actions/event-persistence";
import { deriveExecutedActionOutcome, type PartnerActionOutcome } from "../lib/partner/actions/outcome";
import { buildRecentOutcomes } from "../lib/partner/actions/recent-outcomes";
import { FINANCE_OUTCOME_STATUS_HE, parseRecentOutcomesResponse, toFinanceOutcomeCardDto, type PartnerOutcomeItemDto } from "../lib/partner/actions/outcome-dto";
import { hashActionSnapshot } from "../lib/partner/actions/snapshot";
import { buildPartnerMemory, recallEntity, type MemorySources } from "../lib/partner/memory/core";
import { resolveKnownAnswerBeforeAsking } from "../lib/partner/memory/preflight";
import { deriveFinanceView } from "../lib/partner/finance/view";
import { FINANCE_ACTION_REGISTRY } from "../lib/partner/finance/actions";
import { isVictorAllowedPath } from "../lib/roles";
import { PartnerOutcomesList } from "../components/partner/PartnerOutcomeCard";
import type { FinanceOwnerAnswer } from "../lib/partner/finance/owner-answers";
import type { FinanceRaw } from "../lib/partner/finance/types";
import type { PersistedOwnerContext } from "../lib/partner/investigation/context-row";
import { productionMirror } from "./fixtures/finance-mirror";

let pass = 0, fail = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log(`  ✓ ${name}`); pass++; } else { console.log(`  ✗ ${name}\n      expected ${e}\n      actual   ${a}`); fail++; }
}
const ok = (name: string, cond: boolean) => { if (cond) { console.log(`  ✓ ${name}`); pass++; } else { console.log(`  ✗ ${name}`); fail++; } };

// ── fixtures: exactly the production Victor August case ──
const NOW = new Date("2026-09-24T09:00:00Z");
const S_ID = "a8018e6e-17c0-47e4-a2d0-97b3aeb817b0", D_ID = "933ba4c2-4fc6-4685-9102-2b42bfc0739d";
const S_FP = "f50eaad3440c9561b6b65267a64f5aecf801a00442bb3729ed03da163810a777", D_FP = "b0d04f510f044378e6ae3a5cb68441a81be70ecac1743c2c166dbd2736f3752b";
const ACTOR = "00000000-0000-4000-8000-00000000a0a0";
const TX_ID = "0c0f3993-1c04-414f-8bc6-9a41b34ee36e";   // the id the candidate RPC produced in the disposable DB
const APPR_ID = "a1111111-1111-4111-8111-111111111111", EXEC_ID = "e2222222-2222-4222-8222-222222222222";
const KEY = "recurring:VICTOR_SALARY:2026-08";

function fsnap(o: { period?: string; s?: string; d?: string; amount?: number; currency?: string; date?: string } = {}) {
  const period = o.period ?? "2026-08", s = o.s ?? S_ID, d = o.d ?? D_ID, amount = o.amount ?? 550, currency = o.currency ?? "$", date = o.date ?? "2026-09-10";
  const months = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];
  const subjectKey = `VICTOR_SALARY:${period}`;
  return {
    id: financeActionId(subjectKey, period, s, d, amount, currency, date), schemaVersion: "partner-finance-action-v1", actionType: "RECORD_PAID_EXPENSE",
    subjectType: "recurring", subjectKey, subjectId: financeSubjectUuid(subjectKey), status: "PROPOSED", requiresOwnerApproval: true, riskLevel: "MEDIUM",
    source: "VICTOR_SALARY", period,
    facts: { amount, currency, date, paymentStatus: "שולם", type: "expense", description: `משכורת Victor — ${months[Number(period.slice(5)) - 1]} ${period.slice(0, 4)}`, category: "צוות", scope: "general", expenseScope: "כללי", artist: "Victor", projectId: null, linkedSessionId: `victor_salary_${period}`, notes: "" },
    sourceContextIds: [s, d],
    ownerContext: { status: { id: s, questionType: "FINANCE_RECURRING_PAYMENT_STATUS", answerCode: "PAID_NEEDS_RECORDING", fingerprint: S_FP }, date: { id: d, questionType: "FINANCE_PAYMENT_DATE", answerCode: "EXACT_DATE", ymd: date, fingerprint: D_FP } },
    salaryConfig: { amount, currency, basis: "OVERRIDE_OR_MONTHLY" },
    duplicateState: { businessKey: `victor_salary_${period}`, existingTransactionIds: [] },
  };
}
function frow(eventType: string, snap: Record<string, unknown>, o: { id: string; sup?: string | null; at: string; execution?: Row | null; req?: string; hash?: string; atype?: string; schema?: string; stype?: string; sid?: string }): Row {
  return {
    id: o.id, created_at: o.at, event_schema_version: "partner-action-event-v1", request_id: o.req ?? uuidV5(FINANCE_SUBJECT_NAMESPACE, `req:${o.id}`), action_id: snap.id,
    action_type: o.atype ?? "RECORD_PAID_EXPENSE", action_schema_version: o.schema ?? "partner-finance-action-v1", subject_type: o.stype ?? "recurring", subject_id: o.sid ?? snap.subjectId,
    event_type: eventType, supersedes_event_id: o.sup ?? null, actor_kind: "OWNER", actor_user_id: ACTOR, action_snapshot: snap, snapshot_hash: o.hash ?? hashActionSnapshot(snap),
    revalidation: {}, execution: o.execution ?? (eventType === "EXECUTED" || eventType === "STALE_AT_EXECUTION" ? {} : null), defer_choice: null, defer_until: null, note: null,
  };
}
const execAudit = (txId = TX_ID, key = "victor_salary_2026-08"): Row => ({ transactionId: txId, businessKey: key, from: { financeRecord: null }, to: { transactionId: txId, amount: 550, currency: "$", date: "2026-09-10", linkedSessionId: key }, rowsAffected: 1, lockedContextIds: [S_ID, D_ID], mutated: true });
const SNAP = fsnap();
const APPROVED_ROW = frow("APPROVED", SNAP, { id: APPR_ID, at: "2026-09-25T08:00:00.000Z" });
const EXECUTED_ROW = frow("EXECUTED", SNAP, { id: EXEC_ID, sup: APPR_ID, at: "2026-09-25T08:01:00.000Z", execution: execAudit() });
const parse = (r: Row) => { const m = mapFinanceActionEventRow(r); if (!m.ok) throw new Error(m.errors.join("; ")); return m.value; };
const EVENTS: PartnerFinanceActionEvent[] = [parse(APPROVED_ROW), parse(EXECUTED_ROW)];
const TX: FinanceTxLiveRow = { id: TX_ID, type: "expense", payment_status: "שולם", amount: 550, currency: "$", date: "2026-09-10", description: "משכורת Victor — אוגוסט 2026", category: "צוות", scope: "general", expense_scope: "כללי", artist: "Victor", project_id: null, linked_session_id: "victor_salary_2026-08" };
const outcomeOf = (rows: FinanceTxLiveRow[] | null, events: readonly PartnerFinanceActionEvent[] = EVENTS) =>
  deriveFinanceExpenseOutcome({ actionId: SNAP.id, events, live: rows ? { status: "OK", rows } : { status: "READ_FAILED", detail: "boom" }, evaluatedAt: NOW });
const OUT = (() => { const d = outcomeOf([TX]); if (d.kind !== "OUTCOME") throw new Error("no outcome"); return d.outcome; })();

// world before / after, with the production Owner Context
function answersFor(raw: FinanceRaw): FinanceOwnerAnswer[] {
  const v0 = deriveFinanceView(raw, NOW);
  const find = (t: string, v = v0) => [...v.integrity.questions, ...v.integrity.top.questions].find((x) => x.questionType === t && x.subject.id === "VICTOR_SALARY:2026-08")!;
  const qs = find("FINANCE_RECURRING_PAYMENT_STATUS");
  const a1: FinanceOwnerAnswer = { contextId: S_ID, questionId: qs.identity!.questionId, questionType: "FINANCE_RECURRING_PAYMENT_STATUS", caseId: qs.identity!.caseId, caseType: qs.identity!.issueType, subjectType: "recurring", subjectId: "VICTOR_SALARY:2026-08", answerCode: "PAID_NEEDS_RECORDING", answerValueYmd: null, factsFingerprint: qs.identity!.fingerprint, answeredAt: "2026-09-23T23:17:12.375Z" };
  const qd = find("FINANCE_PAYMENT_DATE", deriveFinanceView(raw, NOW, [a1]));
  const a2: FinanceOwnerAnswer = { contextId: D_ID, questionId: qd.identity!.questionId, questionType: "FINANCE_PAYMENT_DATE", caseId: qd.identity!.caseId, caseType: qd.identity!.issueType, subjectType: "recurring", subjectId: "VICTOR_SALARY:2026-08", answerCode: "EXACT_DATE", answerValueYmd: "2026-09-10", factsFingerprint: qd.identity!.fingerprint, answeredAt: "2026-09-24T05:55:07.397Z" };
  return [a1, a2];
}
const BEFORE = productionMirror();
const ANSWERS = answersFor(BEFORE);
const withRow = (raw: FinanceRaw, row: FinanceTxLiveRow | null): FinanceRaw => {
  const r = JSON.parse(JSON.stringify(raw)) as FinanceRaw;
  if (row) {
    r.transactions.push({ id: row.id, projectId: null, type: row.type, date: row.date, amount: Number(row.amount), currency: row.currency, status: row.payment_status, category: row.category, scope: row.scope, expenseScope: row.expense_scope, linkedSessionId: row.linked_session_id, createdAt: "2026-09-25T08:01:00.000Z" });
    r.victorSalary = (r.victorSalary ?? []).map((m) => (m.workMonth === "2026-08" ? { ...m, status: "שולם", transactionId: row.id } : m));
  }
  return r;
};
const AFTER = withRow(BEFORE, TX);
const ctxRow = (a: FinanceOwnerAnswer, ymd: string | null): PersistedOwnerContext => ({
  id: a.contextId, schemaVersion: "partner-owner-context-schema-v2", questionId: a.questionId, questionType: a.questionType, caseId: a.caseId, caseType: a.caseType,
  subjectType: "recurring", subjectId: "VICTOR_SALARY:2026-08", answerCode: a.answerCode,
  answerValue: ymd ? { kind: "DATE", ymd, resolution: { method: "EXPLICIT", anchorYmd: "2026-09-24", timeZone: "Asia/Jerusalem" } } : null,
  triggerContextId: null, questionTextHe: "q", caseFactsFingerprint: a.factsFingerprint, note: null, answeredAt: a.answeredAt, scope: "CASE_INSTANCE",
  provenance: { source: "owner_manual" }, caseSchemaVersion: "v", supersedesId: null,
} as unknown as PersistedOwnerContext);
const HISTORY = [ctxRow(ANSWERS[0], null), ctxRow(ANSWERS[1], "2026-09-10")];

// the existing deadline chain (קרוב אלייך) — must keep mapping exactly as before
const PID = "10d23186-a5ab-4eed-a9a4-eeda221a34d5";
const dl = (id: string, type: string, at: string, sup: string | null): PartnerActionEvent => ({
  id, createdAt: at, requestId: uuidV5(FINANCE_SUBJECT_NAMESPACE, `dlreq:${id}`), actionId: `UPDATE_PROJECT_DEADLINE:${PID}:de27b6d2-f35e-47c0-99e6-359db9d3d13c:2026-10-07`, actionType: "UPDATE_PROJECT_DEADLINE",
  subjectType: "project", subjectId: PID, eventType: type as PartnerActionEvent["eventType"], supersedesEventId: sup, actorKind: "OWNER", actorUserId: ACTOR,
  snapshot: { sourceContextIds: ["fe35603a-79e6-45eb-92df-2567933e220f", "de27b6d2-f35e-47c0-99e6-359db9d3d13c"] } as unknown as PartnerActionEvent["snapshot"], snapshotHash: "a".repeat(64), revalidation: {}, execution: type === "EXECUTED" ? {} : null, deferChoice: null, deferUntil: null, note: null,
});
const DL_EVENTS = [dl("a9ab2392-0000-4000-8000-000000000001", "APPROVED", "2026-09-23T16:50:50Z", null), dl("0245272e-0000-4000-8000-000000000002", "EXECUTED", "2026-09-23T17:05:19Z", "a9ab2392-0000-4000-8000-000000000001")];
const DL_OUTCOME: PartnerActionOutcome = {
  schemaVersion: "partner-action-outcome-v1", state: "APPLIED_AS_EXPECTED", actionId: DL_EVENTS[0].actionId, actionType: "UPDATE_PROJECT_DEADLINE", subject: { type: "project", id: PID }, subjectLabel: "קרוב אלייך",
  approvalEventId: DL_EVENTS[0].id, executedEventId: DL_EVENTS[1].id, snapshotHash: "a".repeat(64), executed: { field: "deadline", from: "2026-07-14", to: "2026-10-07", executedAt: "2026-09-23T17:05:19Z", approvedAt: "2026-09-23T16:50:50Z" },
  expectedValue: "2026-10-07", current: { value: "2026-10-07", updatedAt: "2026-09-23T17:05:19Z" }, evaluatedAt: NOW.toISOString(), evidence: [], reasons: [], summaryHe: "השינוי שבוצע עדיין תואם למצב הנוכחי.",
};
function sources(raw: FinanceRaw, events: Array<PartnerActionEvent | PartnerFinanceActionEvent>, outcomes: Array<PartnerActionOutcome | PartnerFinanceActionOutcome>): MemorySources {
  return { now: NOW, finance: { status: "OK", raw, view: deriveFinanceView(raw, NOW, ANSWERS) }, ownerContexts: { status: "OK", history: HISTORY }, actionEvents: { status: "OK", events }, outcomes: { status: "OK", outcomes } };
}
const ent = (m: ReturnType<typeof buildPartnerMemory>, key: string) => m.entities.find((e) => e.entity.key === key);

// in-memory PostgREST-like client for the Action Event store (reads only are used here)
function storeOver(rows: Row[]) {
  const client = {
    from: () => ({
      select: () => {
        let r = [...rows];
        const q: ActionEventSelectQuery = {
          eq: (c: string, v: string) => { r = r.filter((x) => x[c] === v); return q; },
          order: () => q,
          range: (a: number, b: number) => { r = r.slice(a, b + 1); return q; },
          then: (f: (v: { data: unknown[]; error: null }) => unknown) => Promise.resolve({ data: r, error: null }).then(f),
        } as unknown as ActionEventSelectQuery;
        return q;
      },
      insert: () => { throw new Error("WRITE_ATTEMPTED"); },
    }),
    rpc: () => { throw new Error("RPC_ATTEMPTED"); },
  } as unknown as ActionEventTableClient;
  return createActionEventStore(client);
}

async function main() {
  const ROOT = path.resolve(__dirname, "..");
  const rd = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8");
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");

  console.log("Organizational Memory — finance Action + Outcome (1-20)");
  const mB = buildPartnerMemory(sources(BEFORE, DL_EVENTS, [DL_OUTCOME]));
  const mA = buildPartnerMemory(sources(AFTER, [...DL_EVENTS, ...EVENTS], [DL_OUTCOME, OUT]));
  const aug = ent(mA, KEY)!;
  {
    check("1. the finance Action is indexed by snapshot.subjectKey (VICTOR_SALARY:2026-08)", aug.actions.map((a) => [a.actionType, a.headEventType, a.events.map((x) => x.eventType)]), [["RECORD_PAID_EXPENSE", "EXECUTED", ["APPROVED", "EXECUTED"]]]);
    ok("2. the derived UUID never becomes a memory entity (business identity kept)", !mA.entities.some((e) => e.entity.key.includes(SNAP.subjectId)) && SNAP.subjectId === "60211a82-8060-5e7b-b5e7-8dab85e6a9de");
    check("3. Victor August maps to the exact period entity", [aug.entity.kind, aug.entity.period, aug.entity.parents], ["recurring_period", "2026-08", ["recurring:VICTOR_SALARY", "vendor:VICTOR"]]);
    ok("4. vendor:VICTOR history includes the executed Action", recallEntity(mA, "vendor:VICTOR").some((e) => e.entity.key === KEY && e.actions.some((a) => a.actionType === "RECORD_PAID_EXPENSE")));
    const sept = JSON.parse(JSON.stringify(AFTER)) as FinanceRaw;
    sept.victorSalary = (sept.victorSalary ?? []).map((m) => (m.workMonth === "2026-09" ? { ...m, dueDate: "2026-09-20", status: "שולם" } : m));
    const mS = buildPartnerMemory({ ...sources(sept, EVENTS, [OUT]), finance: { status: "OK", raw: sept, view: deriveFinanceView(sept, NOW, ANSWERS) } });
    const sep = ent(mS, "recurring:VICTOR_SALARY:2026-09");
    const vS = deriveFinanceView(sept, NOW, ANSWERS);
    const septQ = vS.integrity.questions.find((q) => q.subject.id === "VICTOR_SALARY:2026-09");
    ok("5. August history never leaks into September (no Action / Outcome / record fact / decision / resolution; question not pre-answered)",
      !!sep && sep.actions.length === 0 && sep.outcomes.length === 0 && sep.ownerDecisions.length === 0 && sep.resolutions.length === 0 && !sep.facts.some((f) => f.code === "FINANCE_EXPENSE_RECORDED")
      && (!septQ || resolveKnownAnswerBeforeAsking(septQ, { raw: sept, answers: ANSWERS }).status === "NOT_KNOWN"));
    const p = ent(mA, `project:${PID}`)!;
    check("6. the deadline Action still maps to its project, with its Outcome + PROJECT_DEADLINE fact + resolution", [p.actions.map((a) => a.actionType), p.outcomes.map((o) => o.state), p.facts.filter((f) => f.code === "PROJECT_DEADLINE").map((f) => f.value), p.resolutions.map((r) => r.code)], [["UPDATE_PROJECT_DEADLINE"], ["APPLIED_AS_EXPECTED"], ["2026-10-07"], ["RESOLVED_BY_ACTION"]]);
    ok("7. a finance Outcome never creates a PROJECT_DEADLINE fact", !aug.facts.some((f) => f.code === "PROJECT_DEADLINE") && mA.entities.filter((e) => e.facts.some((f) => f.code === "PROJECT_DEADLINE")).every((e) => e.entity.key === `project:${PID}`));
    check("8. the finance Outcome creates FINANCE_EXPENSE_RECORDED with the structured facts", aug.facts.filter((f) => f.code === "FINANCE_EXPENSE_RECORDED").map((f) => f.value), [{ sourceKey: "VICTOR_SALARY:2026-08", period: "2026-08", transactionId: TX_ID, amount: 550, currency: "$", paymentDate: "2026-09-10", linkedSessionId: "victor_salary_2026-08", outcomeStatus: "APPLIED_AS_EXPECTED" }]);
    check("9. a successful finance Outcome → RESOLVED_BY_ACTION (the specific cause replaces the generic live-state one)", aug.resolutions.map((r) => [r.code, r.resolvedIssue]), [["RESOLVED_BY_ACTION", "PAID_BUT_MISSING_FINANCE_RECORD"]]);
    check("10. the historical observation is retained", aug.observations.map((o) => [o.signature.issueType, o.current]), [["PAID_BUT_MISSING_FINANCE_RECORD", false]]);
    ok("11. the current missing-record observation disappears (before: current; after: none current)", ent(mB, KEY)!.observations.some((o) => o.current) && !aug.observations.some((o) => o.current));
    ok("12. pattern evidence keeps the one clean occurrence (observation counted, uncontested)", aug.observations.length === 1 && aug.observations[0].contested === false);
    check("13. one occurrence never confirms a pattern (no candidate, nothing confirmed)", [mA.patternCandidates.length, mA.confirmedPatterns], [0, []]);
    const edited = outcomeOf([{ ...TX, amount: 600 }]);
    const mE = buildPartnerMemory(sources(withRow(BEFORE, { ...TX, amount: 600 }), EVENTS, [edited.kind === "OUTCOME" ? edited.outcome : OUT]));
    const aE = ent(mE, KEY)!;
    check("14. a live edit of the recorded row → Outcome LIVE_STATE_CHANGED, recorded in memory, no RESOLVED_BY_ACTION", [edited.kind === "OUTCOME" && edited.outcome.state, aE.facts.find((f) => f.code === "FINANCE_EXPENSE_RECORDED")?.value && (aE.facts.find((f) => f.code === "FINANCE_EXPENSE_RECORDED")!.value as { outcomeStatus: string }).outcomeStatus, aE.resolutions.some((r) => r.code === "RESOLVED_BY_ACTION")], ["LIVE_STATE_CHANGED_AFTER_EXECUTION", "LIVE_STATE_CHANGED_AFTER_EXECUTION", false]);
    const gone = outcomeOf([]);
    check("15. the recorded row removed → TARGET_NOT_FOUND", gone.kind === "OUTCOME" && gone.outcome.state, "TARGET_NOT_FOUND");
    const dup = outcomeOf([TX, { ...TX, id: "77777777-7777-4777-8777-777777777777" }]);
    check("16. two rows for the business key → INVARIANT_VIOLATION", dup.kind === "OUTCOME" && dup.outcome.state, "INVARIANT_VIOLATION");
    const bad = mapFinanceActionEventRow({ ...EXECUTED_ROW, action_snapshot: { ...SNAP, facts: { ...SNAP.facts, amount: 600 } } });
    const st = await storeOver([APPROVED_ROW, { ...EXECUTED_ROW, snapshot_hash: "0".repeat(64) }]).getFinanceEventsByType("EXECUTED");
    ok("17. a malformed finance event fails closed (parser + store read)", !bad.ok && st.status === "INVALID_STORED_EVENT");
    const uns = deriveFinanceExpenseOutcome({ actionId: DL_EVENTS[0].actionId, events: DL_EVENTS, live: { status: "OK", rows: [] }, evaluatedAt: NOW });
    const mU = buildPartnerMemory(sources(AFTER, [], [{ ...OUT, actionType: "SOMETHING_ELSE" } as PartnerFinanceActionOutcome, { ...DL_OUTCOME, actionType: "SOMETHING_ELSE" }]));
    ok("18. an unsupported action fails closed (UNSUPPORTED_ACTION; memory adds nothing for unknown Outcome types)", uns.kind === "OUTCOME" && uns.outcome.state === "UNSUPPORTED_ACTION" && mU.entities.every((e) => e.outcomes.length === 0));
    check("19. Owner Context links stay traceable: the Action relies on exactly the entity's two ACTIVE decisions", [aug.actions[0].ownerContextIds, aug.ownerDecisions.filter((d) => d.status === "ACTIVE").map((d) => d.contextId)], [[S_ID, D_ID], [S_ID, D_ID]]);
    const src = sources(AFTER, [...DL_EVENTS, ...EVENTS], [DL_OUTCOME, OUT]);
    check("20. fresh-process reconstruction (serialized sources) → identical memory", JSON.stringify(buildPartnerMemory({ ...JSON.parse(JSON.stringify(src)), now: NOW })), JSON.stringify(buildPartnerMemory(src)));
  }

  console.log("Learning chain of the FIRST finance Action (Part C / S)");
  {
    const b = ent(mB, KEY)!;
    check("PROBLEM → OWNER DECISION → EXACT DATE (before execution)", [b.observations.map((o) => [o.signature.issueType, o.current]), b.ownerDecisions.map((d) => [d.answerCode, d.answerValueYmd])], [[["PAID_BUT_MISSING_FINANCE_RECORD", true]], [["PAID_NEEDS_RECORDING", null], ["EXACT_DATE", "2026-09-10"]]]);
    ok("canonical config $550 + READY_TO_PROPOSE (executor blocked) before execution", b.facts.some((f) => f.code === "SALARY_CONFIGURED" && JSON.stringify(f.value) === JSON.stringify({ amount: 550, currency: "$" })) && b.facts.some((f) => f.code === "ACTION_READINESS:RECORD_PAID_EXPENSE" && (f.value as { readiness: string; executable: boolean }).readiness === "READY_TO_PROPOSE" && (f.value as { executable: boolean }).executable === false));
    check("ACTION → EXECUTION → OUTCOME → RESOLUTION → PATTERN EVIDENCE (after)", [aug.actions[0].headEventType, aug.outcomes.map((o) => [o.state, o.expectedValue]), aug.resolutions.map((r) => r.code), aug.observations.length, aug.facts.find((f) => f.code === "FINANCE_RECORD")?.value], ["EXECUTED", [["APPLIED_AS_EXPECTED", TX_ID]], ["RESOLVED_BY_ACTION"], 1, { present: true, paid: true, transactionIds: [TX_ID] }]);
  }

  console.log("Victor salary route (21-28)");
  {
    const route = await import("../app/api/vendor/victor/salary/route");
    const post = (body: Row) => route.POST(new Request("https://app.example/api/vendor/victor/salary", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) as never);
    const body = { workMonth: "2026-08", amount: 550, currency: "$", historicPaid: true, paidDate: "2026-09-10" };
    const reset = (mode: typeof pg.nextInsert, rows: Row[] = []) => { pg.transactions = rows; pg.inserts = 0; pg.nextInsert = mode; pg.requests = []; auth.role = "owner"; };
    reset("ok");
    let res = await post(body); let j = await res.json() as Row;
    check("21. normal insert still works (one insert, canonical row)", [res.status, j.ok, j.duplicate ?? null, pg.inserts, pg.transactions.length, (pg.transactions[0] ?? {}).linked_session_id, (pg.transactions[0] ?? {}).notes], [200, true, null, 1, 1, "victor_salary_2026-08", "סומן כשולם היסטורית מתוך כרטיס Victor"]);
    reset("ok", [{ id: TX_ID, linked_session_id: "victor_salary_2026-08", payment_status: "שולם" }]);
    res = await post(body); j = await res.json() as Row;
    check("22. existing row → duplicate-safe answer, no insert", [res.status, j.ok, j.duplicate, pg.inserts], [200, true, true, 0]);
    reset("victor_conflict");
    res = await post(body); j = await res.json() as Row;
    check("23. unique race 23505 on transactions_victor_salary_period_uk → safe duplicate (the winner re-read)", [res.status, j.ok, j.duplicate, (j.transaction as Row | undefined)?.id, pg.inserts], [200, true, true, "99999999-9999-4999-8999-999999999999", 1]);
    check("26. no duplicate transaction was created in the race", pg.transactions.filter((r) => r.linked_session_id === "victor_salary_2026-08").length, 1);
    reset("other_unique");
    res = await post(body); j = await res.json() as Row;
    check("24. an unrelated 23505 is NOT swallowed (500)", [res.status, j.ok], [500, false]);
    reset("db_error");
    res = await post(body); j = await res.json() as Row;
    check("25. any other DB error remains a failure (500)", [res.status, j.ok], [500, false]);
    reset("ok"); auth.role = "none"; res = await post(body); const s401 = res.status;
    auth.role = "victor"; res = await post(body); const s403 = res.status; auth.role = "owner";
    check("27. Owner auth unchanged (anonymous 401, Victor 403, nothing written)", [s401, s403, pg.inserts], [401, 403, 0]);
    ok("27b. every salary handler still starts with requireOwner()", (rd("app/api/vendor/victor/salary/route.ts").match(/const denied = await requireOwner\(\); if \(denied\) return denied;/g) ?? []).length === 3);
    ok("28. Victor stays blocked from salary settings + salary routes (proxy allowlist)", !isVictorAllowedPath("/api/vendor/victor/settings") && !isVictorAllowedPath("/api/vendor/victor/salary"));
  }

  console.log("Parser (29-35)");
  {
    const dlSnap = { id: "UPDATE_PROJECT_DEADLINE:x", subjectId: PID, status: "PROPOSED", requiresOwnerApproval: true };
    const dlRow = { id: "a9ab2392-0000-4000-8000-000000000009", created_at: "2026-09-23T16:50:50Z", event_schema_version: "partner-action-event-v1", request_id: "0e0e0e0e-0000-4000-8000-000000000001", action_id: dlSnap.id, action_type: "UPDATE_PROJECT_DEADLINE", action_schema_version: "partner-suggested-action-v1", subject_type: "project", subject_id: PID, event_type: "APPROVED", supersedes_event_id: null, actor_kind: "OWNER", actor_user_id: ACTOR, action_snapshot: dlSnap, snapshot_hash: hashActionSnapshot(dlSnap), revalidation: {}, execution: null, defer_choice: null, defer_until: null, note: null };
    ok("29. an existing deadline event still parses (deadline parser unchanged)", mapActionEventRow(dlRow).ok);
    check("30. a future finance event parses (APPROVED + EXECUTED) with its business key", EVENTS.map((e) => [e.eventType, e.subjectKey, e.period, e.subjectId]), [["APPROVED", "VICTOR_SALARY:2026-08", "2026-08", SNAP.subjectId], ["EXECUTED", "VICTOR_SALARY:2026-08", "2026-08", SNAP.subjectId]]);
    ok("31. wrong action/schema binding rejected (both parsers)", !mapFinanceActionEventRow({ ...APPROVED_ROW, action_schema_version: "partner-suggested-action-v1" }).ok && !mapActionEventRow(APPROVED_ROW).ok);
    ok("32. wrong subject type rejected", !mapFinanceActionEventRow({ ...APPROVED_ROW, subject_type: "project" }).ok);
    const badKey = (k: string) => { const s = { ...SNAP, subjectKey: k }; return mapFinanceActionEventRow({ ...APPROVED_ROW, action_snapshot: s, snapshot_hash: hashActionSnapshot(s) }).ok; };
    ok("33. malformed subjectKey rejected (month 13, other vendor, no period)", !badKey("VICTOR_SALARY:2026-13") && !badKey("OTHER:2026-08") && !badKey("VICTOR_SALARY"));
    const tamper = (f: Record<string, unknown>) => { const s = { ...SNAP, facts: { ...SNAP.facts, ...f } }; return validateFinanceSnapshot(s).length > 0; };
    ok("34. malformed finance snapshots rejected (description, invented notes, string amount, other key, currency)", tamper({ description: "x" }) && tamper({ notes: "סומן כשולם היסטורית מתוך כרטיס Victor" }) && tamper({ amount: "550" }) && tamper({ linkedSessionId: "victor_salary_2026-07" }) && tamper({ currency: "USD" })
      && !mapFinanceActionEventRow({ ...APPROVED_ROW, snapshot_hash: "f".repeat(64) }).ok);
    const store = storeOver([dlRow, APPROVED_ROW, EXECUTED_ROW]);
    const dlByType = await store.getEventsByType("APPROVED"), finByType = await store.getFinanceEventsByType("APPROVED"), chain = await store.getActionChain(dlSnap.id);
    const unknown = await storeOver([{ ...dlRow, action_type: "SOMETHING_ELSE" }]).getEventsByType("APPROVED");
    check("35. current deadline reads are unchanged: finance rows are invisible to them, unknown types still fail closed",
      [dlByType.status === "OK" && dlByType.events.map((e) => e.actionType), finByType.status === "OK" && finByType.events.map((e) => e.actionType), chain.status, unknown.status],
      [["UPDATE_PROJECT_DEADLINE"], ["RECORD_PAID_EXPENSE"], "OK", "INVALID_STORED_EVENT"]);
  }

  console.log("Outcome + Recent Outcomes (36-42)");
  {
    check("36. APPLIED_AS_EXPECTED only for the exact executed canonical row", [OUT.state, OUT.current, OUT.subject, OUT.executed?.transactionId], ["APPLIED_AS_EXPECTED", { transactionIds: [TX_ID], matches: true }, { type: "recurring", key: "VICTOR_SALARY:2026-08" }, TX_ID]);
    const each = ["payment_status", "amount", "currency", "date", "description", "category", "scope", "expense_scope", "artist", "type"].map((k) => {
      const d = outcomeOf([{ ...TX, [k]: k === "amount" ? 551 : k === "date" ? "2026-09-11" : "x" } as FinanceTxLiveRow]);
      return d.kind === "OUTCOME" ? d.outcome.state : "none";
    });
    check("37. any canonical field changed later → LIVE_STATE_CHANGED_AFTER_EXECUTION", [...new Set(each)], ["LIVE_STATE_CHANGED_AFTER_EXECUTION"]);
    check("38. TARGET_NOT_FOUND", (outcomeOf([]) as { outcome: { state: string } }).outcome.state, "TARGET_NOT_FOUND");
    const other = outcomeOf([{ ...TX, id: "77777777-7777-4777-8777-777777777777" }]);
    const badAudit = outcomeOf([TX], [EVENTS[0], parse(frow("EXECUTED", SNAP, { id: EXEC_ID, sup: APPR_ID, at: "2026-09-25T08:01:00.000Z", execution: execAudit("77777777-7777-4777-8777-777777777777") }))]);
    check("39. INVARIANT_VIOLATION: the key's row is not the executed row / two rows", [other.kind === "OUTCOME" && other.outcome.state, badAudit.kind === "OUTCOME" && badAudit.outcome.state, (outcomeOf([TX, { ...TX, id: "77777777-7777-4777-8777-777777777777" }]) as { outcome: { state: string } }).outcome.state], ["INVARIANT_VIOLATION", "INVARIANT_VIOLATION", "INVARIANT_VIOLATION"]);
    check("40. READ_FAILED", (outcomeOf(null) as { outcome: { state: string } }).outcome.state, "READ_FAILED");
    const dlUnaffected = deriveExecutedActionOutcome({ actionId: SNAP.id, events: EVENTS as unknown as PartnerActionEvent[], live: { status: "FOUND", deadline: null, updatedAt: null }, evaluatedAt: NOW });
    ok("41. the deadline Outcome model is unchanged (it still refuses anything that is not UPDATE_PROJECT_DEADLINE)", dlUnaffected.kind === "OUTCOME" && dlUnaffected.outcome.state === "UNSUPPORTED_ACTION");
    const card = toFinanceOutcomeCardDto(OUT);
    check("42. finance card: business headline + status, no ids / hashes in any text", [card.headlineHe, card.statusHe, card.badgeHe, card.executedAtHe], ["משכורת Victor עבור אוגוסט 2026 נרשמה בכספים — $550, 10.09.2026.", "הרישום עדיין תואם למצב הנוכחי.", "בוצע", "25.09.2026, 11:01"]);
    check("42b. headline formatter", financeOutcomeHeadlineHe("2026-08", "$", 550, "2026-09-10"), "משכורת Victor עבור אוגוסט 2026 נרשמה בכספים — $550, 10.09.2026.");
    const logs: string[] = [];
    const mixed = await buildRecentOutcomes({
      listExecutedEvents: async () => ({ status: "OK", events: [DL_EVENTS[1]] }),
      readOutcome: async () => ({ kind: "OUTCOME", outcome: DL_OUTCOME }),
      listFinanceOutcomes: async () => ({ status: "OK", outcomes: [OUT], omitted: [] }),
      log: (e) => logs.push(e),
    });
    const onlyDl = await buildRecentOutcomes({ listExecutedEvents: async () => ({ status: "OK", events: [DL_EVENTS[1]] }), readOutcome: async () => ({ kind: "OUTCOME", outcome: DL_OUTCOME }), log: () => {} });
    const noFin = await buildRecentOutcomes({ listExecutedEvents: async () => ({ status: "OK", events: [DL_EVENTS[1]] }), readOutcome: async () => ({ kind: "OUTCOME", outcome: DL_OUTCOME }), listFinanceOutcomes: async () => ({ status: "OK", outcomes: [], omitted: [] }), log: () => {} });
    check("42c. Recent Outcomes selects the right card per type, newest first", mixed.status === "OK" ? mixed.response.items.map((i) => i.actionType) : mixed, ["RECORD_PAID_EXPENSE", "UPDATE_PROJECT_DEADLINE"]);
    check("42d. with no finance execution the surface is byte-identical to the deadline-only surface", JSON.stringify(noFin), JSON.stringify(onlyDl));
    const failing = await buildRecentOutcomes({ listExecutedEvents: async () => ({ status: "OK", events: [DL_EVENTS[1]] }), readOutcome: async () => ({ kind: "OUTCOME", outcome: DL_OUTCOME }), listFinanceOutcomes: async () => ({ status: "STORE_READ_FAILED", detail: "x" }), log: () => {} });
    check("42e. a failing finance read never blanks the deadline cards", JSON.stringify(failing), JSON.stringify(onlyDl));
    const parsed = parseRecentOutcomesResponse(JSON.parse(JSON.stringify(mixed.status === "OK" ? mixed.response : null)));
    ok("42f. the client parser accepts the mixed payload and rejects a finance headline carrying an id", parsed.ok && !parseRecentOutcomesResponse({ v: 1, items: [{ ...card, headlineHe: `x ${TX_ID}` }] }).ok && !parseRecentOutcomesResponse({ v: 1, items: [{ ...card, statusHe: "x" }] }).ok);
    const html = renderToStaticMarkup(<PartnerOutcomesList items={parsed.ok ? parsed.items as PartnerOutcomeItemDto[] : []} isMobile={false} />);
    const text = html.replace(/<[^>]+>/g, " ");
    ok("42g. renders the finance sentence + status, no id / hash in the visible text", text.includes("משכורת Victor עבור אוגוסט 2026 נרשמה בכספים — $550, 10.09.2026.") && text.includes(FINANCE_OUTCOME_STATUS_HE.APPLIED_AS_EXPECTED) && !/[0-9a-f]{8}-[0-9a-f]{4}-/.test(text) && !/[0-9a-f]{64}/.test(text));
    const lst = await listFinanceOutcomesCore({ listFinanceEvents: async () => ({ status: "OK", events: [] }), readBusinessKey: async () => { throw new Error("must not read"); }, now: () => NOW });
    check("no finance execution → no finance Outcome and no transactions read", lst, { status: "OK", outcomes: [], omitted: [] });
  }

  console.log("Static write boundary (Part O)");
  {
    const walk = (d: string): string[] => fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.name === "node_modules" || e.name.startsWith(".") ? [] : e.isDirectory() ? walk(path.join(d, e.name)) : /\.(ts|tsx)$/.test(e.name) ? [path.join(d, e.name)] : []) : [];
    const SRC = ["app", "components", "lib"].flatMap((d) => walk(path.join(ROOT, d)));
    const rel = (f: string) => path.relative(ROOT, f).split(path.sep).join("/");
    // F2.31 (finance execution ENABLED through the existing Owner routes): the boundary moves deliberately, and stays narrow.
    // the constant (finance-events.ts) + the registry's human-readable writePrimitive description (finance/actions.ts) — no call site
    check("the finance RPC is named ONLY by its constant + the registry documentation string", SRC.filter((f) => /partner_execute_record_paid_expense/.test(strip(fs.readFileSync(f, "utf8")))).map(rel).sort(), ["lib/partner/actions/finance-events.ts", "lib/partner/finance/actions.ts"]);
    ok("…and the registry mentions it only inside its writePrimitive text", (strip(rd("lib/partner/finance/actions.ts")).match(/partner_execute_record_paid_expense/g) ?? []).length === 1 && /writePrimitive: "DB RPC partner_execute_record_paid_expense/.test(rd("lib/partner/finance/actions.ts")));
    ok("finance event / outcome modules are pure reads (no Supabase, insert, update, upsert, delete, rpc, fetch)", ["lib/partner/actions/finance-events.ts", "lib/partner/actions/finance-outcome.ts"].every((f) => !/lib\/supabase|\.insert\(|\.update\(|\.upsert\(|\.delete\(|\.rpc\(|fetch\(/.test(strip(rd(f)).replace(/createHash\("sha1"\)\.update\(/g, ""))));
    const EP = strip(rd("lib/partner/actions/event-persistence.ts"));
    ok("the store writes finance ONLY as APPROVED / NOT_NOW decisions + the ONE finance RPC; the deadline write shape is unchanged",
      /action_type: "UPDATE_PROJECT_DEADLINE";/.test(rd("lib/partner/actions/events.ts")) && /export const EXECUTE_RPC = "partner_execute_update_project_deadline";/.test(rd("lib/partner/actions/events.ts"))
      && /if \(i\.eventType !== "APPROVED" && i\.eventType !== "NOT_NOW"\) errors\.push/.test(EP) && (EP.match(/\.rpc\(/g) ?? []).length === 2 && /client\.rpc\(FINANCE_EXECUTE_RPC, args\)/.test(EP));
    check("RECORD_PAID_EXPENSE appears in no route — only display, read, surface and the narrow finance core", SRC.filter((f) => /RECORD_PAID_EXPENSE/.test(strip(fs.readFileSync(f, "utf8")))).map(rel).sort(),
      ["components/partner/PartnerActionCard.tsx", "components/partner/PartnerOutcomeCard.tsx", "lib/partner/act/business-events.ts", "lib/partner/act/registry.ts", "lib/partner/actions/finance-events.ts", "lib/partner/actions/outcome-dto.ts", "lib/partner/actions/surface-dto.ts", "lib/partner/actions/surface.ts", "lib/partner/finance/actions.ts", "lib/partner/gateway/entity-common.ts", "lib/partner/memory/contract.ts", "lib/partner/memory/core.ts", "lib/partner/sunny/action-proposal.ts", "lib/partner/system/company.ts", "lib/partner/system/gaps.ts", "lib/partner/system/registry.ts", "lib/partner/system/victor.ts"].sort()); // Gateway V1: a display label only (read-only); Sunny: a REFUSAL list only; system awareness (registry + gaps + Victor + company contract): a description only; Universal Action Layer registry + event map (2026-09-27): a contract id only, never a writer
    ok("only RECORD_PAID_EXPENSE is executable; every other finance type stays blocked", FINANCE_ACTION_REGISTRY.RECORD_PAID_EXPENSE.executable === true && Object.values(FINANCE_ACTION_REGISTRY).filter((c) => c.actionType !== "RECORD_PAID_EXPENSE").every((c) => c.executable === false));
    ok("no finance-specific endpoint exists; the shared execute route stays generic (dispatch lives in action-service)", !fs.existsSync(path.join(ROOT, "app/api/partner/finance/execute")) && !fs.existsSync(path.join(ROOT, "app/api/partner/finance/approve")) && !/RECORD_PAID_EXPENSE|finance/i.test(strip(rd("app/api/partner/actions/execute/route.ts")).replace(/r\.kind === "FINANCE"/g, "")));
    ok("the only finance reads added to servers are SELECTs (event store read + transactions by business key)", /getFinanceEventsByType\(t\)/.test(rd("lib/partner/actions/outcome-server.ts")) && /getFinanceEventsByType\(t\)/.test(rd("lib/partner/memory/server.ts")));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
