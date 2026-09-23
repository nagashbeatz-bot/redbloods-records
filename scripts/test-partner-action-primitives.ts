/**
 * Tests — Redbloods Partner Action primitives (Phase F.1H).
 *
 * Run with:   npx tsx scripts/test-partner-action-primitives.ts
 *
 * NEVER touches production: the real cores (event-persistence.ts, service.ts,
 * surfacing.ts, snapshot.ts, canonical.ts, defer.ts) run against an in-memory
 * fake of public.partner_action_events + the execution RPC that mirrors the
 * F.1G constraints (request_uk, one_root_uk, linear_uk, composite parent FK,
 * transition guard, snapshot CHECKs, defer iff, 64-hex hash). The server-only
 * bindings (event-store.ts, live.ts, action-service.ts) are inspected
 * statically only. Fixture = the real production chain for "קרוב אלייך".
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { CASE_SCHEMA_VERSION, type PartnerCase } from "../lib/partner/cases/types";
import type { PersistedOwnerContext } from "../lib/partner/investigation/context-row";
import { deriveCaseDecisionState } from "../lib/partner/investigation";
import { fingerprintCaseFacts } from "../lib/partner/feedback";
import { deriveSuggestedActions, type PartnerSuggestedAction } from "../lib/partner/actions";
import { canonicalStableStringify, canonicalSha256, CanonicalSerializationError } from "../lib/partner/actions/canonical";
import { buildActionSnapshot, hashActionSnapshot, type PartnerActionSnapshot } from "../lib/partner/actions/snapshot";
import { ACTION_EVENT_TYPES, isAllowedTransition, mapActionEventRow, type ActionEventInsertRow, type PartnerActionEvent } from "../lib/partner/actions/events";
import { createActionEventStore, type ActionEventDbResponse, type ActionEventSelectQuery, type ActionEventTableClient, type ExecuteRpcArgs } from "../lib/partner/actions/event-persistence";
import { decideSuggestedActionCore, executeApprovedActionCore, mapRpcResult, type ActionServiceDeps, type LiveActionLookup, type LiveCaseView } from "../lib/partner/actions/service";
import { resolveActionSurfacing } from "../lib/partner/actions/surfacing";
import { resolveDeferUntil } from "../lib/partner/actions/defer";

let pass = 0, fail = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log(`  ✓ ${name}`); pass++; } else { console.log(`  ✗ ${name}\n      expected ${e}\n      actual   ${a}`); fail++; }
}
const ok = (name: string, cond: boolean) => { if (cond) { console.log(`  ✓ ${name}`); pass++; } else { console.log(`  ✗ ${name}`); fail++; } };

// ── real fixture ──
const PID = "10d23186-a5ab-4eed-a9a4-eeda221a34d5";
const CASE_ID = `project_deadline_passed:${PID}`;
const A_ID = "fe35603a-79e6-45eb-92df-2567933e220f";
const B_ID = "de27b6d2-f35e-47c0-99e6-359db9d3d13c";
const FP = "cc7d8bca34c49059";
const LABEL = "קרוב אלייך";
const OWNER = "5f1c1d2e-0000-4000-8000-00000000aaaa";
const OTHER_ACTOR = "5f1c1d2e-0000-4000-8000-00000000bbbb";

function caseFor(pid: string, deadline = "2026-07-14", status = "במיקס"): PartnerCase {
  return {
    id: `project_deadline_passed:${pid}`, schemaVersion: CASE_SCHEMA_VERSION, caseType: "PROJECT_DEADLINE_PASSED", subjectType: "project", subjectId: pid,
    classification: "RISK", status: "OPEN", createdFrom: "STATE",
    facts: [{ domain: "projects", entityId: pid, field: "deadline", value: deadline, label: "deadline" }, { domain: "projects", entityId: pid, field: "status", value: status, label: "status" }],
    derivedFacts: [], hypotheses: [], ownerRulesApplied: [], workingPrinciplesApplied: [], unknowns: [], dataQuality: { notes: [] },
    interventionStyle: "GENTLE", summaryHe: "", changeContext: null,
  };
}
function ctxA(pid: string, id: string): PersistedOwnerContext {
  const cid = `project_deadline_passed:${pid}`;
  return {
    id, schemaVersion: "partner-owner-context-schema-v1", questionId: `${cid}::WHY_DEADLINE_STILL_ACTIVE`, questionType: "WHY_DEADLINE_STILL_ACTIVE",
    caseId: cid, caseType: "PROJECT_DEADLINE_PASSED", subjectType: "project", subjectId: pid, answerCode: "DEADLINE_NOT_UPDATED",
    answerValue: null, triggerContextId: null, questionTextHe: "q", caseFactsFingerprint: fingerprintCaseFacts(caseFor(pid)), note: "לא הספקתי לעדכן",
    answeredAt: "2026-09-23T09:10:08.684Z", scope: "CASE_INSTANCE", provenance: { source: "owner_manual" }, caseSchemaVersion: CASE_SCHEMA_VERSION, supersedesId: null,
  };
}
function ctxB(pid: string, id: string, aId: string, ymd = "2026-10-07", supersedesId: string | null = null): PersistedOwnerContext {
  const cid = `project_deadline_passed:${pid}`;
  return {
    id, schemaVersion: "partner-owner-context-schema-v2", questionId: `${cid}::WHAT_IS_NEW_PROJECT_DEADLINE`, questionType: "WHAT_IS_NEW_PROJECT_DEADLINE",
    caseId: cid, caseType: "PROJECT_DEADLINE_PASSED", subjectType: "project", subjectId: pid, answerCode: "IN_TWO_WEEKS",
    answerValue: { kind: "DATE", ymd, resolution: { method: "RELATIVE", rule: "PLUS_14_DAYS", anchorYmd: "2026-09-23", timeZone: "Asia/Jerusalem" } },
    triggerContextId: aId, questionTextHe: "q", caseFactsFingerprint: fingerprintCaseFacts(caseFor(pid)), note: null, answeredAt: "2026-09-23T09:50:47.036Z",
    scope: "CASE_INSTANCE", provenance: { source: "owner_manual" }, caseSchemaVersion: CASE_SCHEMA_VERSION, supersedesId,
  };
}
const derive = (c: PartnerCase, h: PersistedOwnerContext[]) => deriveSuggestedActions({ case: c, decisionState: deriveCaseDecisionState(c, h), subjectLabelHe: LABEL }).actions;

// second, unrelated fixture (for cross-action request_id conflicts)
const PID2 = "20d23186-a5ab-4eed-a9a4-eeda221a34d5", A2 = "a1111111-1111-4111-8111-111111111111", B2 = "b2222222-2222-4222-8222-222222222222";

// ── in-memory fake of public.partner_action_events + the RPC ──
type Row = Record<string, unknown>;
const ALLOWED: Record<string, string[]> = { ROOT: ["APPROVED", "NOT_NOW", "REJECTED"], NOT_NOW: ["APPROVED", "NOT_NOW", "REJECTED"], REJECTED: ["APPROVED", "NOT_NOW"], APPROVED: ["NOT_NOW", "REJECTED", "EXECUTED", "STALE_AT_EXECUTION"], STALE_AT_EXECUTION: ["APPROVED", "NOT_NOW", "REJECTED"], EXECUTED: [] };
class FakeEventsDb {
  rows: Row[] = [];
  tablesTouched = new Set<string>();
  rpcCalls: ExecuteRpcArgs[] = [];
  rpcResponse: ActionEventDbResponse<unknown> = { data: null, error: { code: "XX000", message: "no rpc response scripted" } };
  insertError: ActionEventDbResponse<unknown>["error"] = null;
  hideRequestIdOnce: string | null = null;
  clock = Date.parse("2026-09-23T10:00:00.000Z");
  client(): ActionEventTableClient {
    const db = this;
    return {
      from(table: string) {
        db.tablesTouched.add(table);
        if (table !== "partner_action_events") throw new Error(`fake: table ${table} is not reachable from the Action store`);
        return {
          select: (_cols: string) => db.query(),
          insert: (row: ActionEventInsertRow) => ({ select: () => ({ single: async () => db.insert(row as unknown as Row) }) }),
        };
      },
      rpc: async (fn: string, args: ExecuteRpcArgs) => { if (fn !== "partner_execute_update_project_deadline") throw new Error("unexpected rpc"); db.rpcCalls.push(args); return db.rpcResponse; },
    } as unknown as ActionEventTableClient;
  }
  query(): ActionEventSelectQuery {
    const filters: Array<[string, string]> = []; let range: [number, number] = [0, 1e9];
    const db = this;
    const q: ActionEventSelectQuery = {
      eq(c, v) { filters.push([c, v]); return q; },
      order() { return q; },
      range(f, t) { range = [f, t]; return q; },
      then(res, rej) {
        let out = db.rows.filter((r) => filters.every(([c, v]) => r[c] === v));
        if (db.hideRequestIdOnce && filters.some(([c, v]) => c === "request_id" && v === db.hideRequestIdOnce)) { db.hideRequestIdOnce = null; out = []; }
        out = [...out].sort((a, b) => Date.parse(a.created_at as string) - Date.parse(b.created_at as string) || String(a.id).localeCompare(String(b.id))).slice(range[0], range[1] + 1);
        return Promise.resolve({ data: JSON.parse(JSON.stringify(out)), error: null }).then(res, rej);
      },
    };
    return q;
  }
  insert(row: Row): ActionEventDbResponse<unknown> {
    if (this.insertError) return { data: null, error: this.insertError };
    const err = (code: string, message: string) => ({ data: null, error: { code, message } });
    if (this.rows.some((r) => r.request_id === row.request_id)) return err("23505", 'duplicate key value violates unique constraint "partner_action_events_request_uk"');
    const sup = row.supersedes_event_id as string | null;
    if (sup === null) {
      if (this.rows.some((r) => r.action_id === row.action_id && r.supersedes_event_id === null)) return err("23505", 'duplicate key value violates unique constraint "partner_action_events_one_root_uk"');
      if (!ALLOWED.ROOT.includes(row.event_type as string)) return err("23514", "PARTNER_ACTION_INVALID_ROOT");
    } else {
      const parent = this.rows.find((r) => r.id === sup && r.action_id === row.action_id);
      if (!parent) return err("23503", "violates foreign key constraint partner_action_events_supersedes_fk");
      if (!ALLOWED[parent.event_type as string].includes(row.event_type as string)) return err("23514", "PARTNER_ACTION_INVALID_TRANSITION");
      if (this.rows.some((r) => r.supersedes_event_id === sup)) return err("23505", 'duplicate key value violates unique constraint "partner_action_events_linear_uk"');
    }
    const snap = row.action_snapshot as Record<string, unknown>;
    if (snap.id !== row.action_id || snap.subjectId !== row.subject_id || snap.status !== "PROPOSED" || snap.requiresOwnerApproval !== true) return err("23514", "partner_action_events_snapshot_matches");
    if (!/^[0-9a-f]{64}$/.test(row.snapshot_hash as string)) return err("23514", "snapshot_hash check");
    if ((row.event_type === "NOT_NOW") !== (row.defer_until !== null)) return err("23514", "partner_action_events_defer_iff");
    this.clock += 1000;
    const stored = { ...JSON.parse(JSON.stringify(row)), id: randomUUID(), created_at: new Date(this.clock).toISOString().replace("Z", "+00:00") };
    this.rows.push(stored);
    return { data: JSON.parse(JSON.stringify(stored)), error: null };
  }
  count(where: (r: Row) => boolean = () => true) { return this.rows.filter(where).length; }
}

// ── fake live view (pure fixtures; records calls) ──
class FakeLive {
  cases = new Map<string, { c: PartnerCase; ctx: PersistedOwnerContext[] }>();
  calls = 0;
  failRead = false;
  constructor() {
    this.cases.set(CASE_ID, { c: caseFor(PID), ctx: [ctxA(PID, A_ID), ctxB(PID, B_ID, A_ID)] });
    this.cases.set(`project_deadline_passed:${PID2}`, { c: caseFor(PID2), ctx: [ctxA(PID2, A2), ctxB(PID2, B2, A2)] });
  }
  view() {
    const self = this;
    return {
      async findAction(actionId: string): Promise<LiveActionLookup> {
        self.calls++;
        if (self.failRead) return { status: "READ_FAILED", detail: "fake read failure" };
        for (const { c, ctx } of self.cases.values()) {
          const a = derive(c, ctx).find((x) => x.id === actionId);
          if (a) return { status: "FOUND", action: a, caseRef: c };
        }
        return { status: "NOT_DERIVABLE" };
      },
      async loadCaseView(caseId: string): Promise<LiveCaseView> {
        self.calls++;
        if (self.failRead) return { status: "READ_FAILED", detail: "fake read failure" };
        const e = self.cases.get(caseId);
        return { status: "OK", caseRef: e?.c ?? null, contexts: e?.ctx ?? [], derived: e ? derive(e.c, e.ctx) : [] };
      },
    };
  }
}

function setup(nowIso = "2026-09-23T10:00:00.000Z") {
  const db = new FakeEventsDb();
  const live = new FakeLive();
  const audits: string[] = [];
  const store = createActionEventStore(db.client());
  const deps: ActionServiceDeps = { now: () => new Date(nowIso), store, live: live.view(), audit: (e, d) => audits.push(`${e}:${String(d.result)}`) };
  return { db, live, store, deps, audits };
}
const ACTION_ID = `UPDATE_PROJECT_DEADLINE:${PID}:${B_ID}:2026-10-07`;
const ACTION2_ID = `UPDATE_PROJECT_DEADLINE:${PID2}:${B2}:2026-10-07`;
const realAction = (): PartnerSuggestedAction => derive(caseFor(PID), [ctxA(PID, A_ID), ctxB(PID, B_ID, A_ID)])[0];
const realSnapshot = (): PartnerActionSnapshot => buildActionSnapshot(realAction(), caseFor(PID));
const HASH = hashActionSnapshot(realSnapshot());
const snap2 = () => buildActionSnapshot(derive(caseFor(PID2), [ctxA(PID2, A2), ctxB(PID2, B2, A2)])[0], caseFor(PID2));
const rid = () => randomUUID();

async function main() {
  console.log("Canonical serialization + SHA-256 (1-3)");
  {
    check("1. canonical text is exact and stable", canonicalStableStringify({ b: 1, a: [2, { d: 1, c: "ש" }], n: null, t: true }), '{"a":[2,{"c":"ש","d":1}],"b":1,"n":null,"t":true}');
    ok("1. same snapshot → same hash (deterministic), 64 lowercase hex", hashActionSnapshot(realSnapshot()) === HASH && /^[0-9a-f]{64}$/.test(HASH));
    ok("1. jsonb-style round trip keeps the hash", hashActionSnapshot(JSON.parse(JSON.stringify(realSnapshot()))) === HASH);
    ok("2. key order independence", canonicalSha256({ a: 1, b: { x: 1, y: [1, 2] } }) === canonicalSha256({ b: { y: [1, 2], x: 1 }, a: 1 }));
    ok("2. array order is significant", canonicalSha256([1, 2]) !== canonicalSha256([2, 1]));
    class K { x = 1; }
    const bad: Array<[string, unknown]> = [["undefined", { a: undefined }], ["Date", { d: new Date(0) }], ["function", { f: () => 1 }], ["symbol", { s: Symbol("x") }], ["bigint", { b: BigInt(1) }], ["NaN", { n: NaN }], ["Infinity", { n: Infinity }], ["-Infinity", [-Infinity]], ["Map", { m: new Map() }], ["class instance", { k: new K() }], ["sparse array", [1, , 3]]];
    for (const [label, v] of bad) {
      let threw = false; try { canonicalStableStringify(v); } catch (e) { threw = e instanceof CanonicalSerializationError; }
      ok(`3. rejects ${label}`, threw);
    }
    ok("SHA-256 is not the 16-hex Case fingerprint", HASH.length === 64 && HASH !== FP);
  }

  console.log("Action snapshot (4)");
  {
    const a = realAction(), s = realSnapshot();
    check("4. evidence copied exactly", s.evidence, a.evidence);
    check("4. caseFacts / caseType / caseSchemaVersion", [s.caseFacts, s.caseType, s.caseSchemaVersion], [{ deadline: "2026-07-14", status: "במיקס" }, "PROJECT_DEADLINE_PASSED", CASE_SCHEMA_VERSION]);
    check("4. approved field set present", ["id", "schemaVersion", "actionType", "subjectType", "subjectId", "proposedChange", "riskLevel", "reasonCodes", "blockingReasons", "evidence", "sourceCaseId", "sourceQuestionIds", "sourceContextIds", "caseFactsFingerprint", "caseFacts", "caseType", "caseSchemaVersion", "preconditions", "staleness", "requiresOwnerApproval", "status", "explanationHe"].filter((k) => !(k in s)), []);
    check("4. proposal content", [s.id, s.status, s.requiresOwnerApproval, s.proposedChange, s.sourceContextIds, s.caseFactsFingerprint], [ACTION_ID, "PROPOSED", true, { entity: "project", entityId: PID, field: "deadline", from: "2026-07-14", to: "2026-10-07" }, [A_ID, B_ID], FP]);
    ok("4. no note / secret text in the snapshot", !/לא הספקתי לעדכן|note|eyJ|sb_secret/.test(JSON.stringify(s)));
    let threw = false; try { buildActionSnapshot({ ...a, status: "STALE" }, caseFor(PID)); } catch { threw = true; }
    ok("only a PROPOSED action can be snapshotted", threw);
  }

  console.log("Decisions (5-14, 20, 27-29)");
  {
    const { db, deps } = setup();
    const r = await decideSuggestedActionCore(deps, { userId: OWNER }, { actionId: ACTION_ID, decision: "APPROVE", seenSnapshotHash: HASH, expectedHeadEventId: null, requestId: rid() });
    check("5. APPROVE → RECORDED", r.status, "RECORDED");
    const row = db.rows[0];
    ok("5. stored snapshot is exactly the live-derived snapshot", JSON.stringify(row.action_snapshot) === JSON.stringify(realSnapshot()) && row.snapshot_hash === HASH);
    check("5. APPROVED root, actor = server session, OWNER kind", [row.event_type, row.supersedes_event_id, row.actor_user_id, row.actor_kind, row.defer_until], ["APPROVED", null, OWNER, "OWNER", null]);
    ok("27. actor comes only from the session argument", row.actor_user_id === OWNER);
  }
  {
    const { db, deps } = setup();
    const r = await decideSuggestedActionCore(deps, { userId: OWNER }, { actionId: ACTION_ID, decision: "REJECT", seenSnapshotHash: HASH, expectedHeadEventId: null, requestId: rid() });
    check("6. REJECT → RECORDED with the exact snapshot", [r.status, db.rows[0]?.event_type, db.rows[0]?.snapshot_hash, JSON.stringify(db.rows[0]?.action_snapshot) === JSON.stringify(realSnapshot())], ["RECORDED", "REJECTED", HASH, true]);
  }
  {
    const { db, deps } = setup("2026-09-23T10:00:00.000Z");
    await decideSuggestedActionCore(deps, { userId: OWNER }, { actionId: ACTION_ID, decision: "NOT_NOW", seenSnapshotHash: HASH, expectedHeadEventId: null, requestId: rid(), deferChoice: "TOMORROW" });
    check("7. NOT_NOW TOMORROW → exact stored defer target (09:00 Israel = 06:00Z)", [db.rows[0]?.event_type, db.rows[0]?.defer_choice, db.rows[0]?.defer_until], ["NOT_NOW", "TOMORROW", "2026-09-24T06:00:00.000Z"]);
    const head = (db.rows[0] as { id: string }).id;
    await decideSuggestedActionCore(deps, { userId: OWNER }, { actionId: ACTION_ID, decision: "NOT_NOW", seenSnapshotHash: HASH, expectedHeadEventId: head, requestId: rid() });
    check("7. NOT_NOW without a choice → SYSTEM_DEFAULT, +3 Israel days 09:00", [db.rows[1]?.defer_choice, db.rows[1]?.defer_until], ["SYSTEM_DEFAULT", "2026-09-26T06:00:00.000Z"]);
    const head2 = (db.rows[1] as { id: string }).id;
    await decideSuggestedActionCore(deps, { userId: OWNER }, { actionId: ACTION_ID, decision: "NOT_NOW", seenSnapshotHash: HASH, expectedHeadEventId: head2, requestId: rid(), deferChoice: "CUSTOM", deferUntil: "2026-10-02T07:30:00.000Z" });
    check("7. CUSTOM stores the exact instant", [db.rows[2]?.defer_choice, db.rows[2]?.defer_until], ["CUSTOM", "2026-10-02T07:30:00.000Z"]);
    check("7. resolver: LATER_TODAY / IN_1_WEEK / DST day", [resolveDeferUntil("LATER_TODAY", new Date("2026-09-23T10:00:00Z")), resolveDeferUntil("IN_1_WEEK", new Date("2026-09-23T10:00:00Z")), resolveDeferUntil("TOMORROW", new Date("2026-10-24T12:00:00Z"))].map((x) => x.ok ? x.deferUntil : x.error), ["2026-09-23T13:00:00.000Z", "2026-09-30T06:00:00.000Z", "2026-10-25T07:00:00.000Z"]);
    check("7. resolver rejects CUSTOM in the past / > 365 days / instant without CUSTOM", [resolveDeferUntil("CUSTOM", new Date("2026-09-23T10:00:00Z"), "2026-09-23T10:01:00Z").ok, resolveDeferUntil("CUSTOM", new Date("2026-09-23T10:00:00Z"), "2027-12-01T00:00:00Z").ok, resolveDeferUntil("TOMORROW", new Date("2026-09-23T10:00:00Z"), "2026-10-01T00:00:00Z").ok], [false, false, false]);
    const r = await decideSuggestedActionCore(deps, { userId: OWNER }, { actionId: ACTION_ID, decision: "NOT_NOW", seenSnapshotHash: HASH, expectedHeadEventId: (db.rows[2] as { id: string }).id, requestId: rid(), deferChoice: "SYSTEM_DEFAULT" });
    check("the client cannot pick SYSTEM_DEFAULT explicitly", r.status, "INVALID_INPUT");
  }
  {
    const { db, deps } = setup();
    const req = rid();
    const input = { actionId: ACTION_ID, decision: "APPROVE", seenSnapshotHash: HASH, expectedHeadEventId: null, requestId: req };
    const first = await decideSuggestedActionCore(deps, { userId: OWNER }, input);
    const again = await decideSuggestedActionCore(deps, { userId: OWNER }, input);
    check("8. same request_id + same scope → REPLAY of the same event, no new row", [first.status, again.status, "event" in again && "event" in first ? again.event.id === first.event.id : false, db.count()], ["RECORDED", "REPLAY", true, 1]);
    const other = await decideSuggestedActionCore(deps, { userId: OWNER }, { ...input, actionId: ACTION2_ID, seenSnapshotHash: hashActionSnapshot(snap2()) });
    check("9. same request_id, other action → REQUEST_ID_CONFLICT (no write)", [other.status, db.count()], ["REQUEST_ID_CONFLICT", 1]);
    const otherDecision = await decideSuggestedActionCore(deps, { userId: OWNER }, { ...input, decision: "REJECT" });
    check("10. same request_id, other decision → REQUEST_ID_CONFLICT", [otherDecision.status, db.count()], ["REQUEST_ID_CONFLICT", 1]);
    const otherActor = await decideSuggestedActionCore(deps, { userId: OTHER_ACTOR }, input);
    check("11. same request_id, other actor → REQUEST_ID_CONFLICT", [otherActor.status, db.count()], ["REQUEST_ID_CONFLICT", 1]);
    const otherHead = await decideSuggestedActionCore(deps, { userId: OWNER }, { ...input, expectedHeadEventId: randomUUID() });
    check("same request_id, other expected head → REQUEST_ID_CONFLICT", otherHead.status, "REQUEST_ID_CONFLICT");
    // DB race path: the pre-read misses, the insert hits request_uk → re-read → scope-safe decision.
    db.hideRequestIdOnce = req;
    const raced = await decideSuggestedActionCore(deps, { userId: OWNER }, input);
    check("request_uk race → REPLAY after re-read (never a blind success)", [raced.status, db.count()], ["REPLAY", 1]);
    db.hideRequestIdOnce = req;
    const racedConflict = await decideSuggestedActionCore(deps, { userId: OWNER }, { ...input, decision: "REJECT" });
    check("request_uk race with another scope → REQUEST_ID_CONFLICT", racedConflict.status, "REQUEST_ID_CONFLICT");
    // Cross-action race: the pre-read misses, this action's chain has no such request, the INSERT hits request_uk → re-read → conflict.
    db.hideRequestIdOnce = req;
    const cross = await decideSuggestedActionCore(deps, { userId: OWNER }, { ...input, actionId: ACTION2_ID, seenSnapshotHash: hashActionSnapshot(snap2()) });
    check("request_uk hit on INSERT (another action) → re-read → REQUEST_ID_CONFLICT, no write", [cross.status, db.count()], ["REQUEST_ID_CONFLICT", 1]);
  }
  {
    const { db, live, deps } = setup();
    live.cases.set(CASE_ID, { c: caseFor(PID, "2026-08-01"), ctx: [ctxA(PID, A_ID), ctxB(PID, B_ID, A_ID)] });
    const r = await decideSuggestedActionCore(deps, { userId: OWNER }, { actionId: ACTION_ID, decision: "APPROVE", seenSnapshotHash: HASH, expectedHeadEventId: null, requestId: rid() });
    check("12. stale proposal (facts changed) → STALE, no write", [r.status, db.count()], ["STALE", 0]);
    live.cases.delete(CASE_ID);
    const r2 = await decideSuggestedActionCore(deps, { userId: OWNER }, { actionId: ACTION_ID, decision: "APPROVE", seenSnapshotHash: HASH, expectedHeadEventId: null, requestId: rid() });
    check("12. Case gone → NOT_DERIVABLE, no write", [r2.status, db.count()], ["NOT_DERIVABLE", 0]);
    live.failRead = true;
    const r3 = await decideSuggestedActionCore(deps, { userId: OWNER }, { actionId: ACTION_ID, decision: "APPROVE", seenSnapshotHash: HASH, expectedHeadEventId: null, requestId: rid() });
    check("live read failure → LIVE_READ_FAILED, no write", [r3.status, db.count()], ["LIVE_READ_FAILED", 0]);
  }
  {
    const { db, deps } = setup();
    const r = await decideSuggestedActionCore(deps, { userId: OWNER }, { actionId: ACTION_ID, decision: "APPROVE", seenSnapshotHash: "0".repeat(64), expectedHeadEventId: null, requestId: rid() });
    check("13. seen hash ≠ live snapshot hash → PROPOSAL_CHANGED (returns the current hash), no write", [r.status, "currentSnapshotHash" in r ? r.currentSnapshotHash : null, db.count()], ["PROPOSAL_CHANGED", HASH, 0]);
  }
  {
    const { db, deps } = setup();
    const a = await decideSuggestedActionCore(deps, { userId: OWNER }, { actionId: ACTION_ID, decision: "APPROVE", seenSnapshotHash: HASH, expectedHeadEventId: null, requestId: rid() });
    const r = await decideSuggestedActionCore(deps, { userId: OWNER }, { actionId: ACTION_ID, decision: "NOT_NOW", seenSnapshotHash: HASH, expectedHeadEventId: null, requestId: rid(), deferChoice: "TOMORROW" });
    check("14. stale expected head → HEAD_CONFLICT (returns the real head), no write", [r.status, "head" in r && r.head ? r.head.id : null, db.count()], ["HEAD_CONFLICT", "event" in a ? a.event.id : "?", 1]);
    const dup = await decideSuggestedActionCore(deps, { userId: OWNER }, { actionId: ACTION_ID, decision: "APPROVE", seenSnapshotHash: HASH, expectedHeadEventId: null, requestId: rid() });
    check("duplicate APPROVE (new request) → ALREADY_IN_STATE, no write", [dup.status, db.count()], ["ALREADY_IN_STATE", 1]);
  }
  {
    const { db, live, deps } = setup();
    const r = await decideSuggestedActionCore(deps, { userId: OWNER }, { actionId: ACTION_ID, decision: "CHANGE_VALUE" });
    check("20. CHANGE_VALUE → Owner Context flow, no Action Event, no live read", [r.status, "questionType" in r ? r.questionType : null, db.count(), live.calls], ["USE_OWNER_CONTEXT_FLOW", "WHAT_IS_NEW_PROJECT_DEADLINE", 0, 0]);
  }
  {
    const { db, deps } = setup();
    const base = { actionId: ACTION_ID, decision: "APPROVE", seenSnapshotHash: HASH, expectedHeadEventId: null, requestId: rid() };
    const forged: Array<[string, Record<string, unknown>]> = [["actorUserId", { actorUserId: OTHER_ACTOR }], ["snapshot", { snapshot: realSnapshot() }], ["from", { from: "2026-07-14" }], ["to", { to: "2027-01-01" }], ["proposedChange", { proposedChange: {} }], ["snapshotHash", { snapshotHash: HASH }], ["eventType", { eventType: "EXECUTED" }]];
    for (const [k, extra] of forged) {
      const r = await decideSuggestedActionCore(deps, { userId: OWNER }, { ...base, ...extra });
      ok(`27/28. client-supplied "${k}" is rejected`, r.status === "INVALID_INPUT");
    }
    check("27/28. nothing written for forged inputs", db.count(), 0);
    const noActor = await decideSuggestedActionCore(deps, { userId: "" }, base);
    check("27. no authenticated actor → rejected", noActor.status, "INVALID_INPUT");
  }
  {
    const { db, deps } = setup();
    const note = "APPROVE REJECT NOT_NOW 2027-01-01 CUSTOM ← לא לפענח";
    const r = await decideSuggestedActionCore(deps, { userId: OWNER }, { actionId: ACTION_ID, decision: "NOT_NOW", seenSnapshotHash: HASH, expectedHeadEventId: null, requestId: rid(), note });
    check("29. note stored verbatim and never interpreted (defer = SYSTEM_DEFAULT)", [r.status, db.rows[0]?.note, db.rows[0]?.defer_choice, db.rows[0]?.event_type], ["RECORDED", note, "SYSTEM_DEFAULT", "NOT_NOW"]);
  }

  console.log("Surfacing (15-19)");
  {
    const now = new Date("2026-09-23T12:00:00Z");
    const mk = (type: string, sup: string | null, extra: Partial<PartnerActionEvent> = {}): PartnerActionEvent => ({
      id: randomUUID(), createdAt: new Date(Date.now()).toISOString(), requestId: randomUUID(), actionId: ACTION_ID, actionType: "UPDATE_PROJECT_DEADLINE", subjectType: "project", subjectId: PID,
      eventType: type as PartnerActionEvent["eventType"], supersedesEventId: sup, actorKind: "OWNER", actorUserId: OWNER, snapshot: realSnapshot(), snapshotHash: HASH,
      revalidation: {}, execution: type === "EXECUTED" || type === "STALE_AT_EXECUTION" ? {} : null, deferChoice: null, deferUntil: null, note: null, ...extra,
    });
    const cur = { status: "PROPOSED" as const, snapshotHash: HASH };
    check("no events + PROPOSED → SHOW", resolveActionSurfacing({ actionId: ACTION_ID, current: cur, events: [], now }).state, "SHOW");
    const rej = mk("REJECTED", null);
    check("15. REJECTED → SUPPRESSED for this exact action", resolveActionSurfacing({ actionId: ACTION_ID, current: cur, events: [rej], now }).state, "SUPPRESSED");
    // 16: a new Context B → new action id, derived with its own (empty) chain
    const bNew: PersistedOwnerContext = { ...ctxB(PID, "c3333333-3333-4333-8333-333333333333", A_ID, "2026-10-30", B_ID), answerCode: "SPECIFIC_DATE", answerValue: { kind: "DATE", ymd: "2026-10-30", resolution: { method: "EXPLICIT", anchorYmd: "2026-09-23", timeZone: "Asia/Jerusalem" } } };
    const newAction = derive(caseFor(PID), [ctxA(PID, A_ID), ctxB(PID, B_ID, A_ID), bNew]).find((a) => a.status === "PROPOSED");
    ok("16. revised Context B → a NEW action id", !!newAction && newAction.id !== ACTION_ID && newAction.id.includes("c3333333"));
    check("16. the old REJECTED does not suppress the new id", resolveActionSurfacing({ actionId: newAction!.id, current: { status: "PROPOSED", snapshotHash: "x".repeat(64) }, events: [], now }).state, "SHOW");
    const nn = mk("NOT_NOW", null, { deferChoice: "TOMORROW", deferUntil: "2026-09-24T06:00:00.000Z" });
    const early = resolveActionSurfacing({ actionId: ACTION_ID, current: cur, events: [nn], now });
    check("17. NOT_NOW → HIDDEN until the stored defer_until", [early.state, early.hiddenUntil], ["HIDDEN", "2026-09-24T06:00:00.000Z"]);
    check("17. after defer_until → SHOW again (still PROPOSED)", resolveActionSurfacing({ actionId: ACTION_ID, current: cur, events: [nn], now: new Date("2026-09-24T06:00:01Z") }).state, "SHOW");
    const ap = mk("APPROVED", null);
    check("18. APPROVED → AWAITING_EXECUTION", resolveActionSurfacing({ actionId: ACTION_ID, current: cur, events: [ap], now }).state, "AWAITING_EXECUTION");
    const ex = mk("EXECUTED", ap.id);
    check("19. EXECUTED → DONE", resolveActionSurfacing({ actionId: ACTION_ID, current: cur, events: [ap, ex], now }).state, "DONE");
    check("19. EXECUTED is terminal in the transition model", ACTION_EVENT_TYPES.filter((t) => isAllowedTransition("EXECUTED", t)), []);
    const st = mk("STALE_AT_EXECUTION", ap.id);
    check("STALE_AT_EXECUTION → SHOW only for the same id + same hash", [resolveActionSurfacing({ actionId: ACTION_ID, current: cur, events: [ap, st], now }).state, resolveActionSurfacing({ actionId: ACTION_ID, current: { status: "PROPOSED", snapshotHash: "f".repeat(64) }, events: [ap, st], now }).state, resolveActionSurfacing({ actionId: ACTION_ID, current: null, events: [ap, st], now }).state], ["SHOW", "NOT_PROPOSED", "NOT_PROPOSED"]);
    check("branched chain → BLOCKED (fail closed)", resolveActionSurfacing({ actionId: ACTION_ID, current: cur, events: [ap, mk("REJECTED", ap.id), mk("NOT_NOW", ap.id, { deferUntil: "2026-09-30T00:00:00Z", deferChoice: "TOMORROW" })], now }).state, "BLOCKED");
    const { db, deps } = setup();
    const a = await decideSuggestedActionCore(deps, { userId: OWNER }, { actionId: ACTION_ID, decision: "APPROVE", seenSnapshotHash: HASH, expectedHeadEventId: null, requestId: rid() });
    db.rows.push({ ...db.rows[0], id: randomUUID(), request_id: randomUUID(), event_type: "EXECUTED", supersedes_event_id: "event" in a ? a.event.id : null, execution: {}, created_at: "2026-09-23T10:10:00+00:00" });
    const after = await decideSuggestedActionCore(deps, { userId: OWNER }, { actionId: ACTION_ID, decision: "REJECT", seenSnapshotHash: HASH, expectedHeadEventId: db.rows[1].id as string, requestId: rid() });
    check("19. any decision after EXECUTED → ALREADY_EXECUTED, no write", [after.status, db.count()], ["ALREADY_EXECUTED", 2]);
  }

  console.log("Execution primitive (21-24)");
  const approveInto = async (s: ReturnType<typeof setup>) => {
    const a = await decideSuggestedActionCore(s.deps, { userId: OWNER }, { actionId: ACTION_ID, decision: "APPROVE", seenSnapshotHash: HASH, expectedHeadEventId: null, requestId: rid() });
    return "event" in a ? a.event.id : "";
  };
  {
    const s = setup();
    const ap = await approveInto(s);
    const evId = randomUUID();
    s.db.rpcResponse = { data: { result: "EXECUTED", eventId: evId, actionId: ACTION_ID, from: "2026-07-14", to: "2026-10-07" }, error: null };
    const req = rid();
    const r = await executeApprovedActionCore(s.deps, { userId: OWNER }, { approvalEventId: ap, requestId: req });
    check("happy path → EXECUTED mapped from the RPC", [r.status, "eventId" in r ? r.eventId : null, "to" in r ? r.to : null], ["EXECUTED", evId, "2026-10-07"]);
    const call = s.db.rpcCalls[0];
    check("RPC args: ids + TS head + TS reasons only (values come from the stored snapshot)", [call.p_request_id === req, call.p_approval_event_id === ap, call.p_action_id, call.p_actor_user_id, call.p_expected_trigger_head_id, call.p_app_stale_reasons, Object.keys(call).sort()],
      [true, true, ACTION_ID, OWNER, A_ID, [], ["p_action_id", "p_actor_user_id", "p_app_stale_reasons", "p_approval_event_id", "p_expected_trigger_head_id", "p_request_id", "p_revalidation"]]);
    check("21. the Action store only ever touches partner_action_events", [...s.db.tablesTouched], ["partner_action_events"]);
  }
  {
    const s = setup();
    const ap = await approveInto(s);
    s.live.cases.set(CASE_ID, { c: caseFor(PID, "2026-10-01"), ctx: [ctxA(PID, A_ID), ctxB(PID, B_ID, A_ID)] });
    s.db.rpcResponse = { data: { result: "STALE_AT_EXECUTION", eventId: randomUUID(), reasons: ["PERSISTED_VALUE_MATCHES_EXPECTED"] }, error: null };
    const r = await executeApprovedActionCore(s.deps, { userId: OWNER }, { approvalEventId: ap, requestId: rid() });
    check("changed live deadline → TS stale reasons passed to the RPC; RPC decides STALE_AT_EXECUTION", [r.status, s.db.rpcCalls[0].p_app_stale_reasons.includes("CASE_FACTS_MATCH_DECISION")], ["STALE_AT_EXECUTION", true]);
  }
  {
    const s = setup();
    const ap = await approveInto(s);
    s.live.failRead = true;
    const r = await executeApprovedActionCore(s.deps, { userId: OWNER }, { approvalEventId: ap, requestId: rid() });
    check("live read failure → RETRYABLE and the RPC is NOT called", [r.status, s.db.rpcCalls.length], ["RETRYABLE", 0]);
    const nf = await executeApprovedActionCore(s.deps, { userId: OWNER }, { approvalEventId: randomUUID(), requestId: rid() });
    check("unknown approval → APPROVAL_NOT_FOUND, RPC not called", [nf.status, s.db.rpcCalls.length], ["APPROVAL_NOT_FOUND", 0]);
    const forged = await executeApprovedActionCore(s.deps, { userId: OWNER }, { approvalEventId: ap, requestId: rid(), to: "2027-01-01", actorUserId: OTHER_ACTOR });
    check("execute input cannot carry values / actor", [forged.status, s.db.rpcCalls.length], ["INVALID_INPUT", 0]);
  }
  {
    const codes = ["EXECUTED", "STALE_AT_EXECUTION", "REPLAY", "ALREADY_EXECUTED", "APPROVAL_NOT_CURRENT", "APPROVAL_NOT_FOUND", "ACTION_MISMATCH", "REQUEST_ID_CONFLICT"];
    check("22. every RPC result maps to the same strict status", codes.map((c) => mapRpcResult({ result: c, eventId: randomUUID(), eventType: "EXECUTED" }).status), codes);
    check("22. unknown / malformed RPC results fail closed", [mapRpcResult({ result: "DONE" }).status, mapRpcResult(null).status, mapRpcResult({ result: "EXECUTED" }).status], ["INVARIANT_VIOLATION", "INVARIANT_VIOLATION", "INVARIANT_VIOLATION"]);
    for (const [code, msg] of [["40P01", "deadlock detected"], ["55P03", "canceling statement due to lock timeout"], ["40001", "PARTNER_ACTION_CAS_FAILED"], ["23505", "duplicate key value violates unique constraint \"partner_action_events_linear_uk\""]]) {
      const s = setup();
      const ap = await approveInto(s);
      s.db.rpcResponse = { data: null, error: { code, message: msg } };
      const r = await executeApprovedActionCore(s.deps, { userId: OWNER }, { approvalEventId: ap, requestId: rid() });
      check(`23. ${code} → RETRYABLE, called once (no automatic retry), audited`, [r.status, s.db.rpcCalls.length, s.audits.some((a) => a.startsWith("partner_action_execute_error:RETRYABLE"))], ["RETRYABLE", 1, true]);
    }
    for (const [code, msg] of [["42501", "PARTNER_ACTION_EVENTS_APPEND_ONLY"], ["42501", "PARTNER_OWNER_CONTEXT_APPEND_ONLY"], ["55000", "PARTNER_LOCK_PROTOCOL_MISSING"], ["22023", "PARTNER_ACTION_SNAPSHOT_INVALID"]]) {
      const s = setup();
      const ap = await approveInto(s);
      s.db.rpcResponse = { data: null, error: { code, message: msg } };
      const r = await executeApprovedActionCore(s.deps, { userId: OWNER }, { approvalEventId: ap, requestId: rid() });
      check(`24. ${code} ${msg} → INVARIANT_VIOLATION (fail closed, no retry)`, [r.status, s.db.rpcCalls.length], ["INVARIANT_VIOLATION", 1]);
    }
    const s = setup();
    s.db.insertError = { code: "42501", message: "PARTNER_ACTION_EVENTS_APPEND_ONLY" };
    const r = await decideSuggestedActionCore(s.deps, { userId: OWNER }, { actionId: ACTION_ID, decision: "APPROVE", seenSnapshotHash: HASH, expectedHeadEventId: null, requestId: rid() });
    check("24. append-only / permission error on a decision insert → INVARIANT_VIOLATION", r.status, "INVARIANT_VIOLATION");
    s.db.insertError = { code: "40P01", message: "deadlock detected" };
    const r2 = await decideSuggestedActionCore(s.deps, { userId: OWNER }, { actionId: ACTION_ID, decision: "APPROVE", seenSnapshotHash: HASH, expectedHeadEventId: null, requestId: rid() });
    check("23. deadlock on a decision insert → RETRYABLE (no automatic retry)", r2.status, "RETRYABLE");
  }

  console.log("Fail-closed reads (25-26)");
  {
    const s = setup();
    await approveInto(s);
    const good = s.db.rows[0];
    check("stored row maps cleanly", mapActionEventRow(good).ok, true);
    s.db.rows[0] = { ...good, action_snapshot: { ...(good.action_snapshot as object), explanationHe: "tampered" } };
    const chain = await s.store.getActionChain(ACTION_ID);
    check("25. tampered snapshot (hash mismatch) → INVALID_STORED_EVENT", chain.status, "INVALID_STORED_EVENT");
    const r = await decideSuggestedActionCore(s.deps, { userId: OWNER }, { actionId: ACTION_ID, decision: "REJECT", seenSnapshotHash: HASH, expectedHeadEventId: good.id as string, requestId: rid() });
    check("25. decisions refuse to write over an unreadable chain", [r.status, s.db.count()], ["INVARIANT_VIOLATION", 1]);
    const bad: Array<[string, Row]> = [["unknown event type", { ...good, event_type: "PROPOSED" }], ["NOT_NOW without defer", { ...good, event_type: "NOT_NOW" }], ["execution payload on a decision", { ...good, execution: {} }], ["16-hex hash", { ...good, snapshot_hash: FP }], ["actor not a uuid", { ...good, actor_user_id: "owner" }]];
    for (const [label, row] of bad) check(`25. ${label} → INVALID_STORED_EVENT`, mapActionEventRow(row).ok ? "OK" : (mapActionEventRow(row) as { code: string }).code, "INVALID_STORED_EVENT");
    check("26. unsupported event schema → UNSUPPORTED_EVENT_SCHEMA", (mapActionEventRow({ ...good, event_schema_version: "partner-action-event-v9" }) as { code: string }).code, "UNSUPPORTED_EVENT_SCHEMA");
    check("26. unsupported action schema → INVALID_STORED_EVENT", (mapActionEventRow({ ...good, action_schema_version: "partner-suggested-action-v2" }) as { code: string }).code, "INVALID_STORED_EVENT");
  }

  console.log("Isolation / static (21, 29-32)");
  {
    const ROOT = path.resolve(__dirname, "..");
    const rd = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8");
    const files = ["canonical.ts", "snapshot.ts", "events.ts", "defer.ts", "surfacing.ts", "event-persistence.ts", "service.ts", "event-store.ts", "live.ts", "action-service.ts"].map((f) => `lib/partner/actions/${f}`);
    const src = Object.fromEntries(files.map((f) => [f, rd(f)]));
    // createHash("sha256").update(text) is hashing, not a DB write — stripped before the check.
    ok("21. no file writes projects (no from('projects') / .update( / .upsert( / .delete()", Object.values(src).every((s) => !/from\(\s*["'](projects|tasks|settings|transactions)["']|\.update\(|\.upsert\(|\.delete\(/.test(s.replace(/createHash\("sha256"\)\.update\(/g, ""))));
    ok("21. the only RPC is the approved one", Object.values(src).every((s) => (s.match(/\.rpc\(/g) ?? []).length === 0 || /client\.rpc\(EXECUTE_RPC/.test(s)));
    ok("29. note is never parsed (no regex / split / includes / JSON.parse on note)", Object.values(src).every((s) => !/note\s*\.\s*(match|split|includes|replace|test|indexOf|startsWith)|parse\([^)]*note/.test(s)));
    ok("30. no AI / provider dependency", Object.values(src).every((s) => !/openai|anthropic|groq|gpt-|claude-|lib\/mai/i.test(s.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ""))));
    ok("31. no Chrome / browser automation dependency", Object.values(src).every((s) => !/claude-in-chrome|puppeteer|playwright|\bwindow\.|\bdocument\./.test(s)));
    ok("server-only on every binding (store / live / service), pure cores without it", ["event-store.ts", "live.ts", "action-service.ts"].every((f) => /^import "server-only";/m.test(src[`lib/partner/actions/${f}`])) && ["canonical.ts", "snapshot.ts", "events.ts", "defer.ts", "surfacing.ts", "event-persistence.ts", "service.ts"].every((f) => !/^import "server-only";|from "[^"]*lib\/supabase"|@supabase\//m.test(src[`lib/partner/actions/${f}`])));
    ok("Owner auth on both primitives (requireOwner + session actor)", /requireOwner\(\)/.test(src["lib/partner/actions/action-service.ts"]) && /getAuthUser\(\)/.test(src["lib/partner/actions/action-service.ts"]) && (src["lib/partner/actions/action-service.ts"].match(/resolveOwnerActor\(\)/g) ?? []).length >= 3);
    ok("the actions public index still exports no execution / persistence", !/event-store|action-service|service"|execute/i.test(rd("lib/partner/actions/index.ts")));
    const walk = (d: string): string[] => fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]) : [];
    // F.1J: exactly the two Owner decision routes may import the primitives' binding (the old filter also skipped
    // app/api/partner/actions/** — fixed: only lib/partner/actions itself is excluded now).
    const LIB_ACTIONS = path.join(ROOT, "lib", "partner", "actions") + path.sep;
    const DECISION_ROUTES = [path.join("app", "api", "partner", "actions", "decide", "route.ts"), path.join("app", "api", "partner", "actions", "change-deadline", "route.ts"), path.join("app", "api", "partner", "actions", "execute", "route.ts")];
    const primitiveImporters = [...walk(path.join(ROOT, "app")), ...walk(path.join(ROOT, "components")), ...walk(path.join(ROOT, "lib"))].filter((f) => /\.(ts|tsx)$/.test(f) && !f.startsWith(LIB_ACTIONS) && /partner\/actions\/(action-service|event-store|live|service)/.test(fs.readFileSync(f, "utf8"))).map((f) => path.relative(ROOT, f));
    check("no route / UI / cron / agent imports the primitives — except the three Owner routes (decide / change-deadline / execute)", primitiveImporters.filter((f) => !DECISION_ROUTES.includes(f)), []);
    // F.1K: execution is reachable from exactly one place outside lib/partner/actions — the execute route — and only via executeApprovedAction.
    const EXECUTE_ROUTE = path.join("app", "api", "partner", "actions", "execute", "route.ts");
    const outside = [...walk(path.join(ROOT, "app")), ...walk(path.join(ROOT, "components")), ...walk(path.join(ROOT, "lib"))].filter((f) => /\.(ts|tsx)$/.test(f) && !f.startsWith(LIB_ACTIONS));
    check("F.1K: outside lib/partner/actions ONLY the execute route references executeApprovedAction", outside.filter((f) => /executeApprovedAction/.test(fs.readFileSync(f, "utf8"))).map((f) => path.relative(ROOT, f)), [EXECUTE_ROUTE]);
    ok("F.1K: nothing outside lib/partner/actions names the RPC or calls callExecuteRpc", outside.every((f) => !/callExecuteRpc|partner_execute_update_project_deadline/.test(fs.readFileSync(f, "utf8"))));
    const stripC = (s: string) => s.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    check("F.1K: inside lib/partner/actions the RPC name is defined ONLY in events.ts (EXECUTE_RPC)", walk(path.join(ROOT, "lib", "partner", "actions")).filter((f) => /partner_execute_update_project_deadline/.test(stripC(fs.readFileSync(f, "utf8")))).map((f) => path.basename(f)), ["events.ts"]);
    check("F.1K: only event-persistence.ts calls the RPC (client.rpc(EXECUTE_RPC))", walk(path.join(ROOT, "lib", "partner", "actions")).filter((f) => /\.rpc\(/.test(stripC(fs.readFileSync(f, "utf8")))).map((f) => path.basename(f)), ["event-persistence.ts"]);
    ok("instrumentation / crons never reference the primitives", !fs.existsSync(path.join(ROOT, "instrumentation.ts")) || !/partner\/actions/.test(rd("instrumentation.ts")));
    const self = fs.readFileSync(__filename, "utf8");
    ok("32. this test never imports a production binding (supabase / event-store / live / action-service)", !/from\s+["'][^"']*(lib\/supabase|actions\/event-store|actions\/live|actions\/action-service)["']/.test(self));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
