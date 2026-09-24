/**
 * Tests — Redbloods Partner derived Action Outcome (Phase F.1L).
 *
 * Run with:   npx tsx scripts/test-partner-action-outcome.ts
 *
 * NEVER touches production: chains are built by the REAL decision core against an in-memory
 * Action Event store; EXECUTED rows mirror exactly what the approved RPC appends; the live
 * project read is injected. The first real fixture reuses the production ids
 * (approval a9ab2392…, execution 0245272e…, hash 6bd79a9c…).
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { CASE_SCHEMA_VERSION, type PartnerCase } from "../lib/partner/cases/types";
import type { PersistedOwnerContext } from "../lib/partner/investigation/context-row";
import { deriveCaseDecisionState } from "../lib/partner/investigation";
import { deriveSuggestedActions, type PartnerSuggestedAction } from "../lib/partner/actions";
import { detectProjectDeadlineCases } from "../lib/partner/cases/detectors/project";
import type { PartnerCompanyState } from "../lib/partner/eyes/types";
import { buildActionSnapshot, hashActionSnapshot } from "../lib/partner/actions/snapshot";
import { mapActionEventRow, type ActionEventInsertRow, type PartnerActionEvent } from "../lib/partner/actions/events";
import { createActionEventStore, type ActionEventTableClient, type ActionEventSelectQuery } from "../lib/partner/actions/event-persistence";
import { decideSuggestedActionCore, type ActionServiceDeps, type LiveActionLookup, type LiveCaseView } from "../lib/partner/actions/service";
import { resolveActionSurfacing } from "../lib/partner/actions/surfacing";
import { buildActionSurface } from "../lib/partner/actions/surface";
import {
  ACTION_OUTCOME_STATES, deriveExecutedActionOutcome, listExecutedActionOutcomesCore, readExecutedActionOutcomeCore,
  type LiveDeadlineRead, type OutcomeReaderDeps, type OutcomeReadResult, type PartnerActionOutcome,
} from "../lib/partner/actions/outcome";

let pass = 0, fail = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log(`  ✓ ${name}`); pass++; } else { console.log(`  ✗ ${name}\n      expected ${e}\n      actual   ${a}`); fail++; }
}
const ok = (name: string, cond: boolean) => { if (cond) { console.log(`  ✓ ${name}`); pass++; } else { console.log(`  ✗ ${name}`); fail++; } };

// ── the real "קרוב אלייך" fixture (as approved in production) ──
const PID = "10d23186-a5ab-4eed-a9a4-eeda221a34d5";
const CASE_ID = `project_deadline_passed:${PID}`;
const A_ID = "fe35603a-79e6-45eb-92df-2567933e220f";
const B_ID = "de27b6d2-f35e-47c0-99e6-359db9d3d13c";
const FP = "cc7d8bca34c49059";
const LABEL = "קרוב אלייך";
const OWNER = "4ced002e-db18-4eb7-affb-4afac5aca8b6";
const PROD = {
  actionId: `UPDATE_PROJECT_DEADLINE:${PID}:${B_ID}:2026-10-07`,
  approval: { id: "a9ab2392-68bc-4e74-b579-d9d0f316a8e5", request: "6fe0bc4c-62aa-43bf-9c98-f5adcfd1d0ee", at: "2026-09-23T16:50:50.311475+00:00" },
  execution: { id: "0245272e-446a-44cb-b774-7bca5e96bdea", request: "708cc9c5-225e-4ba0-8e07-b53aab05f2c0", at: "2026-09-23T17:05:19.291913+00:00" },
  hash: "6bd79a9c6e7cacb0fca7cc837d8855fdf8c622a17c465ea925bf8121853e03d2",
};
const C: PartnerCase = {
  id: CASE_ID, schemaVersion: CASE_SCHEMA_VERSION, caseType: "PROJECT_DEADLINE_PASSED", subjectType: "project", subjectId: PID,
  classification: "RISK", status: "OPEN", createdFrom: "STATE",
  facts: [{ domain: "projects", entityId: PID, field: "deadline", value: "2026-07-14", label: "deadline" }, { domain: "projects", entityId: PID, field: "status", value: "במיקס", label: "status" }],
  derivedFacts: [], hypotheses: [], ownerRulesApplied: [], workingPrinciplesApplied: [], unknowns: [], dataQuality: { notes: [] },
  interventionStyle: "GENTLE", summaryHe: "", changeContext: null,
};
const A: PersistedOwnerContext = {
  id: A_ID, schemaVersion: "partner-owner-context-schema-v1", questionId: `${CASE_ID}::WHY_DEADLINE_STILL_ACTIVE`, questionType: "WHY_DEADLINE_STILL_ACTIVE",
  caseId: CASE_ID, caseType: "PROJECT_DEADLINE_PASSED", subjectType: "project", subjectId: PID, answerCode: "DEADLINE_NOT_UPDATED", answerValue: null, triggerContextId: null,
  questionTextHe: "q", caseFactsFingerprint: FP, note: null, answeredAt: "2026-09-23T09:10:08.684Z", scope: "CASE_INSTANCE",
  provenance: { source: "owner_manual" }, caseSchemaVersion: CASE_SCHEMA_VERSION, supersedesId: null,
};
const B: PersistedOwnerContext = {
  id: B_ID, schemaVersion: "partner-owner-context-schema-v2", questionId: `${CASE_ID}::WHAT_IS_NEW_PROJECT_DEADLINE`, questionType: "WHAT_IS_NEW_PROJECT_DEADLINE",
  caseId: CASE_ID, caseType: "PROJECT_DEADLINE_PASSED", subjectType: "project", subjectId: PID, answerCode: "IN_TWO_WEEKS",
  answerValue: { kind: "DATE", ymd: "2026-10-07", resolution: { method: "RELATIVE", rule: "PLUS_14_DAYS", anchorYmd: "2026-09-23", timeZone: "Asia/Jerusalem" } },
  triggerContextId: A_ID, questionTextHe: "q", caseFactsFingerprint: FP, note: null, answeredAt: "2026-09-23T09:50:47.036Z", scope: "CASE_INSTANCE",
  provenance: { source: "owner_manual" }, caseSchemaVersion: CASE_SCHEMA_VERSION, supersedesId: null,
};
const derive = (c: PartnerCase, h: PersistedOwnerContext[]) => deriveSuggestedActions({ case: c, decisionState: deriveCaseDecisionState(c, h), subjectLabelHe: LABEL }).actions;
const action: PartnerSuggestedAction = derive(C, [A, B])[0];

// ── in-memory Action Event table (records every touch) ──
class FakeEvents {
  rows: Record<string, unknown>[] = [];
  touches: string[] = [];
  client(): ActionEventTableClient {
    const db = this;
    return {
      from(t: string) {
        db.touches.push(`from:${t}`);
        return {
          select: () => {
            const f: Array<[string, string]> = [];
            const q: ActionEventSelectQuery = { eq(c, v) { f.push([c, v]); return q; }, order() { return q; }, range() { return q; },
              then(res, rej) { db.touches.push("select"); return Promise.resolve({ data: JSON.parse(JSON.stringify(db.rows.filter((r) => f.every(([c, v]) => r[c] === v)))), error: null }).then(res, rej); } };
            return q;
          },
          insert: (row: ActionEventInsertRow) => ({ select: () => ({ single: async () => {
            db.touches.push("insert");
            const stored = { ...JSON.parse(JSON.stringify(row)), id: randomUUID(), created_at: new Date(Date.parse("2026-09-23T16:50:50Z") + db.rows.length * 1000).toISOString() };
            db.rows.push(stored);
            return { data: stored, error: null };
          } }) }),
        };
      },
      rpc: async () => { db.touches.push("rpc"); return { data: null, error: { code: "XX", message: "must never be called by the Outcome layer" } }; },
    } as unknown as ActionEventTableClient;
  }
}

/** The APPROVED row as the REAL decision core writes it, then pinned to the production ids. */
async function approvedRow(): Promise<Record<string, unknown>> {
  const db = new FakeEvents();
  const deps: ActionServiceDeps = {
    now: () => new Date("2026-09-23T16:50:50Z"), store: createActionEventStore(db.client()), audit: () => {},
    live: {
      async findAction(id: string): Promise<LiveActionLookup> { const a = derive(C, [A, B]).find((x) => x.id === id); return a ? { status: "FOUND", action: a, caseRef: C } : { status: "NOT_DERIVABLE" }; },
      async loadCaseView(): Promise<LiveCaseView> { return { status: "OK", caseRef: C, contexts: [A, B], derived: derive(C, [A, B]) }; },
    },
  };
  const r = await decideSuggestedActionCore(deps, { userId: OWNER }, { actionId: action.id, decision: "APPROVE", seenSnapshotHash: hashActionSnapshot(buildActionSnapshot(action, C)), expectedHeadEventId: null, requestId: PROD.approval.request });
  if (r.status !== "RECORDED") throw new Error(`fixture approve: ${r.status}`);
  return { ...db.rows[0], id: PROD.approval.id, created_at: PROD.approval.at };
}
/** Exactly what partner_execute_update_project_deadline appends on success. */
const executedRow = (approved: Record<string, unknown>, over: Record<string, unknown> = {}): Record<string, unknown> => ({
  ...approved, id: PROD.execution.id, request_id: PROD.execution.request, event_type: "EXECUTED", supersedes_event_id: approved.id, created_at: PROD.execution.at,
  revalidation: { revalidatedAt: "2026-09-23T17:05:19.000Z", appStaleReasons: [], expectedTriggerHead: A_ID },
  execution: { from: "2026-07-14", to: "2026-10-07", rowsAffected: 1, lockedContextIds: [A_ID, B_ID], mutated: true },
  ...over,
});
const staleRow = (approved: Record<string, unknown>) => ({
  ...approved, id: randomUUID(), request_id: randomUUID(), event_type: "STALE_AT_EXECUTION", supersedes_event_id: approved.id, created_at: "2026-09-23T17:05:19+00:00",
  execution: { expectedFrom: "2026-07-14", to: "2026-10-07", projectFound: true, observedDeadline: "2026-08-01", staleReasons: ["PERSISTED_VALUE_MATCHES_EXPECTED"], mutated: false },
});
const toEvents = (rows: Record<string, unknown>[]): PartnerActionEvent[] => rows.map((r) => { const m = mapActionEventRow(r); if (!m.ok) throw new Error(m.errors.join("; ")); return m.value; });
const LIVE_OK: LiveDeadlineRead = { status: "FOUND", deadline: "2026-10-07", updatedAt: PROD.execution.at };
const AT = new Date("2026-09-23T18:00:00Z");
const outcomeOf = (r: OutcomeReadResult): PartnerActionOutcome | null => (r.kind === "OUTCOME" ? r.outcome : null);

function readerDeps(rows: Record<string, unknown>[], live: LiveDeadlineRead | (() => Promise<LiveDeadlineRead>)) {
  const db = new FakeEvents();
  db.rows = JSON.parse(JSON.stringify(rows));
  const store = createActionEventStore(db.client());
  const liveCalls: string[] = [];
  const deps: OutcomeReaderDeps = {
    store: { getEventById: (id) => store.getEventById(id), getActionChain: (id) => store.getActionChain(id) },
    readProjectDeadline: async (pid) => { liveCalls.push(pid); return typeof live === "function" ? live() : live; },
    now: () => AT,
  };
  return { db, store, deps, liveCalls };
}

async function main() {
  const ROOT = path.resolve(__dirname, "..");
  const rd = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8");
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
  const ap = await approvedRow();
  const ex = executedRow(ap);
  const chain = toEvents([ap, ex]);

  console.log("First real fixture (21, 10-13)");
  {
    check("the fixture reproduces the PRODUCTION snapshot hash", [ap.snapshot_hash, action.id], [PROD.hash, PROD.actionId]);
    const { deps, liveCalls } = readerDeps([ap, ex], LIVE_OK);
    const r = await readExecutedActionOutcomeCore(deps, PROD.execution.id);
    const o = outcomeOf(r)!;
    check("21. first real fixture → APPLIED_AS_EXPECTED", o?.state, "APPLIED_AS_EXPECTED");
    check("10/11. exact chain + hash validated: approval → execution ids, same hash", [o.approvalEventId, o.executedEventId, o.snapshotHash, o.actionId, o.subject], [PROD.approval.id, PROD.execution.id, PROD.hash, PROD.actionId, { type: "project", id: PID }]);
    check("12. historical from/to preserved from the persisted snapshot + audit", o.executed, { field: "deadline", from: "2026-07-14", to: "2026-10-07", executedAt: PROD.execution.at, approvedAt: PROD.approval.at });
    check("13. current live value kept separate from the historical executed value", [o.expectedValue, o.current], ["2026-10-07", { value: "2026-10-07", updatedAt: PROD.execution.at }]);
    check("23. the live value comes from the canonical project read (projectId from the persisted subject)", liveCalls, [PID]);
    check("G. APPLIED_AS_EXPECTED says only that the live field still equals the executed value", [o.summaryHe, o.reasons, o.evaluatedAt], ["השינוי שבוצע עדיין תואם למצב הנוכחי.", [], AT.toISOString()]);
    ok("no success / business-goal vocabulary in the model", !/SUCCESS|PROJECT_FIXED|GOAL_ACHIEVED|BUSINESS_SUCCESS/.test(strip(rd("lib/partner/actions/outcome.ts"))) && !ACTION_OUTCOME_STATES.some((s) => /SUCCESS|FIXED|GOAL/.test(s)));
  }

  console.log("Live state changed after execution (2-3)");
  {
    const before = JSON.stringify(chain);
    const r = deriveExecutedActionOutcome({ actionId: PROD.actionId, events: chain, live: { status: "FOUND", deadline: "2026-10-20", updatedAt: "2026-09-30T10:00:00+00:00" }, evaluatedAt: AT });
    const o = outcomeOf(r)!;
    check("2. live value differs → LIVE_STATE_CHANGED_AFTER_EXECUTION with expected + current values", [o.state, o.expectedValue, o.current?.value], ["LIVE_STATE_CHANGED_AFTER_EXECUTION", "2026-10-07", "2026-10-20"]);
    check("2/H. evidence explains the difference (value + later update)", o.reasons, ["LIVE_VALUE_DIFFERS: expected 2026-10-07, current 2026-10-20", `project updated after execution (2026-09-30T10:00:00+00:00 > ${PROD.execution.at})`]);
    check("H. calm Hebrew — not a failure", o.summaryHe, "הדדליין השתנה מאז הביצוע: בוצע 07.10.2026, כעת 20.10.2026.");
    check("3. the difference never rewrites EXECUTED history (executed block + input chain unchanged)", [o.executed?.to, o.executed?.from, JSON.stringify(chain) === before], ["2026-10-07", "2026-07-14", true]);
    const cleared = outcomeOf(deriveExecutedActionOutcome({ actionId: PROD.actionId, events: chain, live: { status: "FOUND", deadline: null, updatedAt: null }, evaluatedAt: AT }))!;
    check("a cleared live deadline is also LIVE_STATE_CHANGED (not a failure)", [cleared.state, cleared.current?.value, cleared.summaryHe], ["LIVE_STATE_CHANGED_AFTER_EXECUTION", null, "הדדליין השתנה מאז הביצוע: בוצע 07.10.2026, כעת ללא דדליין."]);
    const { db, deps } = readerDeps([ap, ex], { status: "FOUND", deadline: "2026-10-20", updatedAt: "2026-09-30T10:00:00+00:00" });
    const stored = JSON.stringify(db.rows);
    await readExecutedActionOutcomeCore(deps, PROD.execution.id);
    check("3. stored events are byte-identical after evaluation", JSON.stringify(db.rows) === stored, true);
  }

  console.log("Target / read failures (4-5)");
  {
    const nf = outcomeOf(await readExecutedActionOutcomeCore(readerDeps([ap, ex], { status: "NOT_FOUND" }).deps, PROD.execution.id))!;
    check("4. missing project → TARGET_NOT_FOUND (history still reported)", [nf.state, nf.executed?.to, nf.current], ["TARGET_NOT_FOUND", "2026-10-07", null]);
    const rf = outcomeOf(await readExecutedActionOutcomeCore(readerDeps([ap, ex], { status: "READ_FAILED", detail: "timeout" }).deps, PROD.execution.id))!;
    check("5. live read failure → READ_FAILED, nothing concluded", [rf.state, rf.current, rf.reasons], ["READ_FAILED", null, ["live project read failed: timeout"]]);
    const th = outcomeOf(await readExecutedActionOutcomeCore(readerDeps([ap, ex], async () => { throw new Error("socket hang up"); }).deps, PROD.execution.id))!;
    check("5. a throwing live reader → READ_FAILED (fail closed)", [th.state, th.reasons], ["READ_FAILED", ["live project read failed: socket hang up"]]);
  }

  console.log("Malformed / unsupported / non-executed chains (6-11, 24)");
  {
    const inv = (rows: Record<string, unknown>[] | PartnerActionEvent[], label: string) => {
      const events = (rows as Array<Record<string, unknown>>)[0] && "eventType" in (rows as Array<Record<string, unknown>>)[0] ? rows as PartnerActionEvent[] : toEvents(rows as Record<string, unknown>[]);
      const o = outcomeOf(deriveExecutedActionOutcome({ actionId: PROD.actionId, events, live: LIVE_OK, evaluatedAt: AT }));
      check(`${label} → INVARIANT_VIOLATION`, o?.state, "INVARIANT_VIOLATION");
      return o;
    };
    const tampered = chain.map((e) => e.eventType === "EXECUTED" ? { ...e, snapshot: { ...e.snapshot, proposedChange: { ...e.snapshot.proposedChange, to: "2027-01-01" } } } : e);
    const t = inv(tampered, "6. EXECUTED snapshot altered after the fact (hash no longer matches)");
    ok("6. …reason names the integrity failure", !!t?.reasons.some((x) => /SHA-256/.test(x)));
    check("24. the store refuses the same tampering at read time (row unreadable)", mapActionEventRow({ ...ex, action_snapshot: { ...(ex.action_snapshot as Record<string, unknown>), proposedChange: { ...((ex.action_snapshot as Record<string, unknown>).proposedChange as Record<string, unknown>), to: "2027-01-01" } } }).ok, false);
    inv([ap, executedRow(ap, { execution: { from: "2026-07-14", to: "2026-10-07", rowsAffected: 1, mutated: false } })], "6. execution audit says not mutated");
    inv([ap, executedRow(ap, { execution: { from: "2026-07-14", to: "2026-10-20", rowsAffected: 1, mutated: true } })], "6. execution audit disagrees with the snapshot (to)");
    inv([ap, executedRow(ap, { execution: { from: "2026-07-14", to: "2026-10-07", rowsAffected: 0, mutated: true } })], "6. execution audit with 0 rows affected");
    inv([ap, executedRow(ap, { execution: {} })], "6. empty execution audit");
    const otherHash = chain.map((e) => e.eventType === "APPROVED" ? { ...e, snapshotHash: "0".repeat(64) } : e);
    inv(otherHash, "11. APPROVED and EXECUTED hashes differ");
    const twoRoots = [...chain, { ...chain[0], id: randomUUID() }];
    inv(twoRoots, "10. two roots in one chain");
    inv([chain[1]], "10. EXECUTED without its APPROVED event (dangling)");
    inv([chain[0], { ...chain[1], actionId: "UPDATE_PROJECT_DEADLINE:other" }], "10. event of another action in the chain");
    const unsupported = chain.map((e) => e.eventType === "EXECUTED" ? { ...e, actionType: "ARCHIVE_PROJECT" as unknown as "UPDATE_PROJECT_DEADLINE" } : e);
    const u = outcomeOf(deriveExecutedActionOutcome({ actionId: PROD.actionId, events: unsupported, live: LIVE_OK, evaluatedAt: AT }));
    check("7. unsupported Action type → UNSUPPORTED_ACTION (no live conclusion)", [u?.state, u?.current, u?.expectedValue], ["UNSUPPORTED_ACTION", null, null]);
    check("7. the store itself only accepts UPDATE_PROJECT_DEADLINE rows", mapActionEventRow({ ...ex, action_type: "ARCHIVE_PROJECT" }).ok, false);

    const onlyApproved = readerDeps([ap], LIVE_OK);
    check("8. APPROVED without EXECUTED is not an Outcome", deriveExecutedActionOutcome({ actionId: PROD.actionId, events: toEvents([ap]), live: LIVE_OK, evaluatedAt: AT }), { kind: "NO_OUTCOME", actionId: PROD.actionId, reason: "NOT_EXECUTED", headEventType: "APPROVED" });
    check("8. …the reader refuses an APPROVED event id and never reads the live project", [(await readExecutedActionOutcomeCore(onlyApproved.deps, PROD.approval.id)).kind, onlyApproved.liveCalls.length], ["NOT_AN_EXECUTION_EVENT", 0]);
    const st = staleRow(ap);
    const staleDeps = readerDeps([ap, st], LIVE_OK);
    check("9. STALE_AT_EXECUTION is not an executed Outcome", deriveExecutedActionOutcome({ actionId: PROD.actionId, events: toEvents([ap, st]), live: LIVE_OK, evaluatedAt: AT }), { kind: "NO_OUTCOME", actionId: PROD.actionId, reason: "STALE_AT_EXECUTION", headEventType: "STALE_AT_EXECUTION" });
    check("9. …the reader refuses a STALE_AT_EXECUTION event id, no live read", [(await readExecutedActionOutcomeCore(staleDeps.deps, st.id as string)).kind, staleDeps.liveCalls.length], ["NOT_AN_EXECUTION_EVENT", 0]);
    check("empty chain → NO_OUTCOME (NO_EVENTS)", deriveExecutedActionOutcome({ actionId: PROD.actionId, events: [], live: LIVE_OK, evaluatedAt: AT }), { kind: "NO_OUTCOME", actionId: PROD.actionId, reason: "NO_EVENTS", headEventType: null });

    const bad = readerDeps([ap, { ...ex, snapshot_hash: "f".repeat(64) }], LIVE_OK);
    check("24. malformed stored EXECUTED row → STORED_DATA_INVALID, no live read", [(await readExecutedActionOutcomeCore(bad.deps, PROD.execution.id)).kind, bad.liveCalls.length], ["STORED_DATA_INVALID", 0]);
    const unknown = readerDeps([ap, ex], LIVE_OK);
    check("24. unknown / malformed ids fail closed", [(await readExecutedActionOutcomeCore(unknown.deps, randomUUID())).kind, (await readExecutedActionOutcomeCore(unknown.deps, "0245272E-446A-44CB-B774-7BCA5E96BDEA")).kind, (await readExecutedActionOutcomeCore(unknown.deps, { id: PROD.execution.id })).kind], ["EVENT_NOT_FOUND", "INVALID_INPUT", "INVALID_INPUT"]);
    const failing: OutcomeReaderDeps = { ...unknown.deps, store: { getEventById: async () => ({ status: "READ_FAILED", detail: "db down" }), getActionChain: async () => ({ status: "READ_FAILED", detail: "db down" }) } };
    check("24. store read failure → STORE_READ_FAILED (nothing concluded)", await readExecutedActionOutcomeCore(failing, PROD.execution.id), { kind: "STORE_READ_FAILED", detail: "db down" });
    const brokenChain: OutcomeReaderDeps = { ...unknown.deps, store: { getEventById: unknown.deps.store.getEventById, getActionChain: async () => ({ status: "INVALID_CHAIN", reasons: ["event x has 2 successors"] }) } };
    check("10/24. an invalid stored chain → INVARIANT_VIOLATION", outcomeOf(await readExecutedActionOutcomeCore(brokenChain, PROD.execution.id))?.state, "INVARIANT_VIOLATION");
  }

  console.log("Listing executed Outcomes (store getEventsByType)");
  {
    const { db, store, deps } = readerDeps([ap, ex, staleRow({ ...ap, id: randomUUID(), action_id: ap.action_id })].slice(0, 2), LIVE_OK);
    const listed = await store.getEventsByType("EXECUTED");
    check("getEventsByType(EXECUTED) returns only the executed event (read-only)", listed.status === "OK" ? listed.events.map((e) => e.id) : listed, [PROD.execution.id]);
    const all = await listExecutedActionOutcomesCore({ ...deps, listExecutedEvents: () => store.getEventsByType("EXECUTED") });
    check("listExecutedActionOutcomes → one APPLIED_AS_EXPECTED", all.status === "OK" ? all.results.map((r) => outcomeOf(r)?.state) : all, ["APPLIED_AS_EXPECTED"]);
    check("getEventsByType rejects an unknown type", (await store.getEventsByType("PROPOSED" as never)).status, "INVALID_STORED_EVENT");
    check("14/19. the Outcome layer only SELECTs partner_action_events (no insert, no rpc)", [...new Set(db.touches)].sort(), ["from:partner_action_events", "select"]);
  }

  console.log("Old proposal closure (22)");
  {
    const openProject = (ymd: string, daysTo: number) => ({
      domains: { projects: { status: "AVAILABLE", data: { open: [{ id: PID, name: LABEL, artistText: "", status: "במיקס", projectType: "שיר", businessType: "לקוח", deadline: { raw: ymd, ymd, daysTo, parseOk: true }, daysSinceUpdate: 0, active: true, hasFinanceSetting: false }], index: {} } } },
    }) as unknown as PartnerCompanyState;
    check("control: with the OLD deadline the PROJECT_DEADLINE_PASSED Case exists", detectProjectDeadlineCases(openProject("2026-07-14", -71), "2026-09-23").map((c) => c.id), [CASE_ID]);
    check("22. with the canonical deadline 2026-10-07 the Case is not derived at all", detectProjectDeadlineCases(openProject("2026-10-07", 14), "2026-09-23"), []);
    const surf = await buildActionSurface({ listProposals: async () => ({ status: "OK", items: [] }), getActionChain: async () => ({ status: "OK", chain, head: chain[1] }), now: () => AT, log: () => {} });
    check("22. the Owner surface is empty — the old 14.07 → 07.10 proposal is not a current proposal", surf.status === "OK" ? surf.response.items : surf, []);
    const hash = hashActionSnapshot(buildActionSnapshot(action, C));
    check("22. even if the identical proposal were derived again, EXECUTED → DONE (never re-proposed)", resolveActionSurfacing({ actionId: PROD.actionId, current: { status: "PROPOSED", snapshotHash: hash }, events: chain, now: AT }).state, "DONE");
    check("historical Action chain remains intact (APPROVED → EXECUTED)", chain.map((e) => [e.id, e.eventType, e.supersedesEventId]), [[PROD.approval.id, "APPROVED", null], [PROD.execution.id, "EXECUTED", PROD.approval.id]]);
  }

  console.log("Static boundaries (14-20, 23)");
  {
    const OUT = strip(rd("lib/partner/actions/outcome.ts")), SRV = strip(rd("lib/partner/actions/outcome-server.ts"));
    ok("the core is pure: no server-only, no supabase, no clock (now() injected)", !/server-only|lib\/supabase|@supabase|new Date\(\)|Date\.now\(/.test(OUT));
    ok("the binding is server-only", /^import "server-only";/m.test(rd("lib/partner/actions/outcome-server.ts")));
    ok("14. no Action Event write (no appendDecision / insert / callExecuteRpc)", ![OUT, SRV].some((s) => /appendDecision|\.insert\(|callExecuteRpc|decideSuggestedAction|executeApprovedAction/.test(s)));
    ok("15. no Owner Context write", ![OUT, SRV].some((s) => /appendOwnerContext|context-store|context-persistence/.test(s)));
    ok("16. no Feedback write", ![OUT, SRV].some((s) => /feedback\/|partner_feedback|appendFeedback/.test(s)));
    ok("17. no baseline write", ![OUT, SRV].some((s) => /savePartnerBaseline|baseline\/|partner_change_baseline/.test(s)));
    // F2.29 adds exactly one more READ: the finance Outcome's transactions SELECT by business key (no mutation anywhere).
    ok("18. no project mutation (project access = one SELECT of deadline, updated_at, name by id; + one transactions SELECT by business key)", ![OUT, SRV].some((s) => /\.update\(|\.upsert\(|\.delete\(|\.insert\(|\.rpc\(/.test(s)) && (SRV.match(/\.from\(/g) ?? []).length === 2 && /supabase\.from\("projects"\)\.select\("deadline,updated_at,name"\)\.eq\("id", projectId\)\.maybeSingle\(\)/.test(SRV) && /supabase\.from\("transactions"\)\s*\.select\("id,type,payment_status,amount,currency,date,description,category,scope,expense_scope,artist,project_id,linked_session_id"\)\s*\.eq\("linked_session_id", linkedSessionId\);/.test(SRV));
    ok("19. no RPC execution", ![OUT, SRV].some((s) => /\.rpc\(|partner_execute_update_project_deadline|EXECUTE_RPC/.test(s)));
    ok("20. no Push / Cron / Agent Alerts", ![OUT, SRV].some((s) => /web-push|lib\/push|node-cron|cron|agent_alerts|alerts-store|lib\/agent\//i.test(s)));
    ok("23. current value = live canonical projects.deadline, never the snapshot", /current = \{ value: live\.deadline, updatedAt: live\.updatedAt \}/.test(OUT) && /live\.deadline === v\.to/.test(OUT));
    ok("store addition is read-only (getEventsByType → readRows SELECT)", /async getEventsByType\(eventType\) \{[\s\S]{0,400}readRows\("event_type", eventType\)/.test(rd("lib/partner/actions/event-persistence.ts")));
    const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
    const importers = [...walk(path.join(ROOT, "app")), ...walk(path.join(ROOT, "components")), ...walk(path.join(ROOT, "lib"))].filter((f) => /\.(ts|tsx)$/.test(f) && /from "[^"]*(actions\/outcome|\.\/outcome)(-server)?"/.test(fs.readFileSync(f, "utf8"))).map((f) => path.relative(ROOT, f).replace(/\\/g, "/"));
    // F2.23 adds exactly two read-only consumers: Organizational Memory core (TYPE import only) and its server-only
    // binding (listExecutedActionOutcomes — a READ). Neither may evaluate, write or execute anything.
    // F2.29 adds exactly one: the pure finance Outcome core (reuses the Outcome state taxonomy — a read-only import).
    check("F.1M: the Outcome is consumed ONLY by its read-only chain (DTO, recent-outcomes core, server binding), the Owner-only GET route, the read-only Memory V1 and the pure finance Outcome core — no cron / agent / write path", importers.sort(), ["app/api/partner/outcomes/route.ts", "lib/partner/actions/finance-outcome.ts", "lib/partner/actions/outcome-dto.ts", "lib/partner/actions/outcome-server.ts", "lib/partner/actions/recent-outcomes.ts", "lib/partner/memory/core.ts", "lib/partner/memory/server.ts"]);
    ok("F2.23: Memory core imports the Outcome as a TYPE only; the memory server only calls the read", /^import type \{ PartnerActionOutcome \} from "\.\.\/actions\/outcome";$/m.test(rd("lib/partner/memory/core.ts")) && !/^import \{[^}]*\} from "\.\.\/actions\/outcome";$/m.test(rd("lib/partner/memory/core.ts")) && rd("lib/partner/memory/server.ts").split(/\r?\n/).includes(["import { listExecutedActionOutcomes, listFinanceOutcomes } from ", '"../actions/', 'outcome-server";'].join("")));
    ok("no Outcome event type was invented (event types unchanged)", /ACTION_EVENT_TYPES = \["APPROVED", "NOT_NOW", "REJECTED", "EXECUTED", "STALE_AT_EXECUTION"\] as const/.test(rd("lib/partner/actions/events.ts")));
  }

  const self = fs.readFileSync(__filename, "utf8");
  ok("this test never imports a production binding", !/from\s+["'][^"']*(lib\/supabase|outcome-server|surface-server|actions\/event-store|actions\/live|actions\/action-service|context-store)["']/.test(self));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
