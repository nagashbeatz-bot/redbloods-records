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
 * Every executed step has exactly ONE executions row (UNIQUE(plan_id, step_index)): a step that ran is claimed (INSERT
 * CLAIMED, with the claim time in the outcome jsonb so a stuck claim can be aged) and then recorded (UPDATE CLAIMED →
 * terminal); a step that never ran (STALE / NOT_RUN) is settled with ONE INSERT of its terminal status. The status values
 * are exactly the DB CHECK set; the outcome jsonb is allowlisted (index, actionId, status, sanitized detail, a canonical
 * createdKey, an ISO time) — never a token, a confirmation text, a path or a link.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuditEvent, AuditStore, ClaimMeta, IdempotencyStore } from "./engine";
import type { NonceConsumption, NonceStore } from "./approval";
import type { ActionContract, Plan, StepOutcome, StepStatus } from "./types";
import { toPersistablePlan, safeDetail, ENTITY_KEY_RE, MAX_DETAIL_CHARS } from "./persist";
import { planHash } from "./plan";

export const ACT_TABLES = { plans: "partner_action_plans", approvals: "partner_action_approvals", executions: "partner_action_executions", events: "partner_action_plan_events" } as const;
const UNIQUE_VIOLATION = "23505";
const STEP_STATUSES: readonly StepStatus[] = ["APPLIED_AS_EXPECTED", "NO_CHANGE", "FAILED", "STALE", "CONFLICT", "NOT_RUN"];
/** Statuses a step that never ran may be settled with (no claim). */
const SETTLE_STATUSES: readonly StepStatus[] = ["STALE", "NOT_RUN"];
const ISO_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
/** The ONLY outcome JSON ever stored (rebuilt, never copied). */
function storedOutcome(o: StepOutcome): StepOutcome {
  return {
    index: o.index, actionId: o.actionId, status: o.status, detail: safeDetail(o.detail).slice(0, MAX_DETAIL_CHARS), replayed: false,
    ...(typeof o.createdKey === "string" && ENTITY_KEY_RE.test(o.createdKey) ? { createdKey: o.createdKey } : {}),
    ...(typeof o.at === "string" && ISO_AT.test(o.at) ? { at: o.at } : {}),
  };
}
const claimAt = (m: ClaimMeta) => (typeof m.atMs === "number" && Number.isFinite(m.atMs) ? new Date(m.atMs).toISOString() : new Date().toISOString());

export class ActStoreError extends Error { constructor(public readonly op: string, detail: string) { super(`act store ${op} failed: ${detail.slice(0, 160)}`); } }
const fail = (op: string, e: { message?: string } | null | undefined): never => { throw new ActStoreError(op, e?.message ?? "unknown"); };

export interface PlanStore {
  /** Persist a NEW plan (through the persistence contract). Throws if not persistable or on any DB error. */
  save(plan: Plan, registry: ReadonlyMap<string, ActionContract>, registryVersion: string, knownSecrets?: readonly string[]): Promise<{ planHash: string }>;
  /** Load a plan by id (null = not found). */
  load(planId: string): Promise<Plan | null>;
  /** Recorded step outcomes of a plan (status reads). For a CLAIMED row, `outcome` carries only { at } (the claim time). */
  executions(planId: string): Promise<Array<{ stepIndex: number; actionId: string; status: string; outcome: StepOutcome | null }>>;
  /** Event types recorded for a plan (status reads; details are sanitized). */
  events(planId: string): Promise<Array<{ type: string; step: number | null; at: string }>>;
  /** The Owner's plans, newest first (cursor = created_at of the last item), with their recorded executions + event types. */
  history?(ownerId: string, q: HistoryQuery): Promise<{ items: Array<{ plan: Plan; executions: Array<{ stepIndex: number; status: string; outcome?: StepOutcome | null }>; eventTypes: string[]; executedAt: string | null }>; nextBefore: string | null }>;
}
export interface HistoryQuery { limit: number; before: string | null; since: string | null; actionId: string | null; entity: string | null }
/** Rows scanned per history page when filtering by action / entity (the plan JSON is filtered here, never by raw SQL). */
const HISTORY_SCAN = 200;

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
    async history(ownerId, q) {
      const limit = Math.max(1, Math.min(q.limit, 50));
      const filtered = !!(q.actionId || q.entity);
      let query = sb.from(ACT_TABLES.plans).select("plan_id, plan, plan_hash, created_at").eq("owner_id", ownerId);
      if (q.before) query = query.lt("created_at", q.before);
      if (q.since) query = query.gte("created_at", q.since);
      const { data, error } = await query.order("created_at", { ascending: false }).limit(filtered ? HISTORY_SCAN : limit + 1);
      if (error) fail("read_history", error);
      const all = ((data ?? []) as Array<{ plan_id: string; plan: Plan; plan_hash: string; created_at: string }>).filter((r) => planHash(r.plan) === r.plan_hash); // a tampered row is never served
      const hit = all.filter((r) => (!q.actionId || r.plan.steps.some((s) => s.actionId === q.actionId)) && (!q.entity || r.plan.steps.some((s) => s.entities.includes(q.entity!))));
      const rows = hit.slice(0, limit);
      const more = hit.length > limit || (filtered && all.length === HISTORY_SCAN);
      const nextBefore = more ? (hit.length > limit ? rows[rows.length - 1].created_at : all[all.length - 1].created_at) : null;
      if (!rows.length) return { items: [], nextBefore };
      const ids = rows.map((r) => r.plan_id);
      const [{ data: ex, error: e2 }, { data: ev, error: e3 }] = await Promise.all([
        sb.from(ACT_TABLES.executions).select("plan_id, step_index, status, outcome, recorded_at").in("plan_id", ids),
        sb.from(ACT_TABLES.events).select("plan_id, event_type").in("plan_id", ids),
      ]);
      if (e2) fail("read_history_executions", e2);
      if (e3) fail("read_history_events", e3);
      const exs = (ex ?? []) as Array<{ plan_id: string; step_index: number; status: string; outcome: StepOutcome | null; recorded_at: string | null }>;
      const evs = (ev ?? []) as Array<{ plan_id: string; event_type: string }>;
      return {
        items: rows.map((r) => {
          const mine = exs.filter((x) => x.plan_id === r.plan_id);
          const at = mine.map((x) => x.recorded_at).filter((x): x is string => !!x).sort();
          return { plan: r.plan, executions: mine.map((x) => ({ stepIndex: x.step_index, status: x.status, outcome: x.outcome ?? null })), eventTypes: [...new Set(evs.filter((x) => x.plan_id === r.plan_id).map((x) => x.event_type))], executedAt: at.length ? at[at.length - 1] : null };
        }),
        nextBefore,
      };
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
      const { error } = await sb.from(ACT_TABLES.executions).insert({ execution_key: key, plan_id: meta.planId, step_index: meta.stepIndex, action_id: meta.actionId, action_version: meta.actionVersion, status: "CLAIMED", outcome: { at: claimAt(meta) } });
      if (!error) return true;
      if (error.code === UNIQUE_VIOLATION) return false; // someone already claimed this step → never execute twice
      return fail("claim_execution", error);
    },
    async record(key, o) {
      if (!STEP_STATUSES.includes(o.status)) throw new ActStoreError("record_execution", "unknown step status");
      const { data, error } = await sb.from(ACT_TABLES.executions).update({ status: o.status, outcome: storedOutcome(o), recorded_at: new Date().toISOString() }).eq("execution_key", key).eq("status", "CLAIMED").select("execution_key");
      if (error) fail("record_execution", error);
      if (!data || (data as unknown[]).length !== 1) throw new ActStoreError("record_execution", "the claimed row was not found (or was already recorded)");
    },
    async settle(key, meta, o) {
      if (!SETTLE_STATUSES.includes(o.status)) throw new ActStoreError("settle_execution", "only a step that never ran is settled without a claim");
      const { error } = await sb.from(ACT_TABLES.executions).insert({ execution_key: key, plan_id: meta.planId, step_index: meta.stepIndex, action_id: meta.actionId, action_version: meta.actionVersion, status: o.status, outcome: storedOutcome({ ...o, at: o.at ?? claimAt(meta) }), recorded_at: new Date().toISOString() });
      if (!error) return true;
      if (error.code === UNIQUE_VIOLATION) return false; // the step already has its one row
      return fail("settle_execution", error);
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
