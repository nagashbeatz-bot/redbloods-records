/**
 * SUNNY UNIVERSAL ACTION LAYER — the production stores (Wave 1) over the four Wave 0 tables.
 *
 * FAIL CLOSED: every database error throws (the caller refuses the request; nothing is reported as done).
 * Persistence goes ONLY through the Wave 0 persistence contract (toPersistablePlan) — a plan that is not persistable is
 * never written. Nothing here stores an approval token, a confirmation text, a credential or a raw storage path:
 *   plans       — the allowlisted plan JSON + hash + owner / client + risk / confirmation / registry version / expiry
 *   approvals   — the one-time nonce (primary key → a second use fails) bound to plan id / hash / owner / client
 *   executions  — one row per step execution key (primary key → the claim is atomic; a retry reads the recorded outcome)
 *   plan_events — append-only (the DB blocks UPDATE / DELETE / TRUNCATE); details are already sanitized + capped
 * The service role holds exactly INSERT + SELECT (and UPDATE on executions only, to record the outcome of a claim).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuditEvent, AuditStore, IdempotencyStore } from "./engine";
import type { NonceConsumption, NonceStore } from "./approval";
import type { ActionContract, Plan, StepOutcome, StepStatus } from "./types";
import { toPersistablePlan, safeDetail, MAX_DETAIL_CHARS } from "./persist";
import { planHash } from "./plan";

export const ACT_TABLES = { plans: "partner_action_plans", approvals: "partner_action_approvals", executions: "partner_action_executions", events: "partner_action_plan_events" } as const;
const UNIQUE_VIOLATION = "23505";
const STEP_STATUSES: readonly StepStatus[] = ["APPLIED_AS_EXPECTED", "NO_CHANGE", "FAILED", "STALE", "CONFLICT", "NOT_RUN"];

export class ActStoreError extends Error { constructor(public readonly op: string, detail: string) { super(`act store ${op} failed: ${detail.slice(0, 160)}`); } }
const fail = (op: string, e: { message?: string } | null | undefined): never => { throw new ActStoreError(op, e?.message ?? "unknown"); };

export interface PlanStore {
  /** Persist a NEW plan (through the persistence contract). Throws if not persistable or on any DB error. */
  save(plan: Plan, registry: ReadonlyMap<string, ActionContract>, registryVersion: string, knownSecrets?: readonly string[]): Promise<{ planHash: string }>;
  /** Load a plan by id (null = not found). */
  load(planId: string): Promise<Plan | null>;
  /** Recorded step outcomes of a plan (status reads). */
  executions(planId: string): Promise<Array<{ stepIndex: number; actionId: string; status: string; outcome: StepOutcome | null }>>;
  /** Event types recorded for a plan (status reads; details are sanitized). */
  events(planId: string): Promise<Array<{ type: string; step: number | null; at: string }>>;
}

export function supabaseActStores(sb: SupabaseClient) {
  const plans: PlanStore = {
    async save(plan, registry, registryVersion, knownSecrets) {
      const p = toPersistablePlan(plan, registry, { knownSecrets });
      if (!p.ok) throw new ActStoreError("save_plan", `not persistable: ${[...new Set(p.problems.map((x) => x.code))].join(",")}`);
      const hash = planHash(p.json);
      const { error } = await sb.from(ACT_TABLES.plans).insert({
        plan_id: p.json.planId, plan_hash: hash, owner_id: p.json.ownerId, client_id: p.json.clientId, plan: p.json,
        risk_class: p.json.riskClass, confirmation: p.json.confirmation, registry_version: registryVersion, created_at: p.json.createdAt, expires_at: p.json.expiresAt,
      });
      if (error) fail("save_plan", error);
      return { planHash: hash };
    },
    async load(planId) {
      const { data, error } = await sb.from(ACT_TABLES.plans).select("plan, plan_hash").eq("plan_id", planId).maybeSingle();
      if (error) fail("load_plan", error);
      if (!data) return null;
      const plan = (data as { plan: Plan }).plan;
      // integrity: the stored JSON must still hash to the stored hash
      if (planHash(plan) !== (data as { plan_hash: string }).plan_hash) throw new ActStoreError("load_plan", "stored plan does not match its hash");
      return plan;
    },
    async executions(planId) {
      const { data, error } = await sb.from(ACT_TABLES.executions).select("step_index, action_id, status, outcome").eq("plan_id", planId).order("step_index", { ascending: true });
      if (error) fail("read_executions", error);
      return ((data ?? []) as Array<{ step_index: number; action_id: string; status: string; outcome: StepOutcome | null }>).map((r) => ({ stepIndex: r.step_index, actionId: r.action_id, status: r.status, outcome: r.outcome }));
    },
    async events(planId) {
      const { data, error } = await sb.from(ACT_TABLES.events).select("event_type, step_index, created_at").eq("plan_id", planId).order("id", { ascending: true });
      if (error) fail("read_events", error);
      return ((data ?? []) as Array<{ event_type: string; step_index: number | null; created_at: string }>).map((r) => ({ type: r.event_type, step: r.step_index, at: r.created_at }));
    },
  };

  const nonces: NonceStore = {
    async consume(c: NonceConsumption) {
      const { error } = await sb.from(ACT_TABLES.approvals).insert({ nonce: c.nonce, plan_id: c.planId, plan_hash: c.planHash, owner_id: c.ownerId, client_id: c.clientId, expires_at: new Date(c.expMs).toISOString() });
      if (!error) return true;
      if (error.code === UNIQUE_VIOLATION) return false; // already consumed → replay
      return fail("consume_nonce", error);
    },
  };

  const idem: IdempotencyStore = {
    async recorded(key) {
      const { data, error } = await sb.from(ACT_TABLES.executions).select("status, outcome").eq("execution_key", key).maybeSingle();
      if (error) fail("read_execution", error);
      const r = data as { status: string; outcome: StepOutcome | null } | null;
      if (!r || r.status === "CLAIMED" || !r.outcome) return null;
      return r.outcome;
    },
    async claim(key, meta) {
      const { error } = await sb.from(ACT_TABLES.executions).insert({ execution_key: key, plan_id: meta.planId, step_index: meta.stepIndex, action_id: meta.actionId, action_version: meta.actionVersion, status: "CLAIMED" });
      if (!error) return true;
      if (error.code === UNIQUE_VIOLATION) return false; // someone already claimed this step → never execute twice
      return fail("claim_execution", error);
    },
    async record(key, o) {
      if (!STEP_STATUSES.includes(o.status)) throw new ActStoreError("record_execution", "unknown step status");
      const outcome: StepOutcome = { index: o.index, actionId: o.actionId, status: o.status, detail: safeDetail(o.detail).slice(0, MAX_DETAIL_CHARS), replayed: false };
      const { data, error } = await sb.from(ACT_TABLES.executions).update({ status: o.status, outcome, recorded_at: new Date().toISOString() }).eq("execution_key", key).eq("status", "CLAIMED").select("execution_key");
      if (error) fail("record_execution", error);
      if (!data || (data as unknown[]).length !== 1) throw new ActStoreError("record_execution", "the claimed row was not found (or was already recorded)");
    },
  };

  const audit: AuditStore = {
    async append(e: AuditEvent) {
      const { error } = await sb.from(ACT_TABLES.events).insert({ plan_id: e.planId, plan_hash: e.planHash, event_type: e.type, step_index: e.step, detail: safeDetail(e.detail).slice(0, MAX_DETAIL_CHARS), owner_id: e.ownerId, client_id: e.clientId });
      if (error) fail("append_event", error);
    },
  };

  return { plans, nonces, idem, audit };
}
