/**
 * SUNNY UNIVERSAL ACTION LAYER — the ONE execution orchestrator (pure; every dependency injected).
 *
 * APPROVAL → registry re-check → fresh reread + stale check → one-time claim → execute through the registered shared
 * writer → fresh reread + verify → per-step outcome → audit. A retry returns the recorded outcome and never executes twice.
 * A failure stops every later step; a COMMUNICATION step never runs after any failure. Nothing is ever reported as done
 * without verification. There is no generic writer: a step can only run through an executor registered for its action.
 */
import type { ActionContract, Plan, PlanEventType, PlanOutcome, PlanStep, StepOutcome, StepStatus } from "./types";
import { executionKey, planHash, validatePlan } from "./plan";
import { verifyApproval, type NonceStore } from "./approval";
import { safeDetail, toPersistablePlan } from "./persist";

export interface IdempotencyStore {
  /** The recorded outcome for this execution key, if any (a replay returns it). */
  recorded(key: string): Promise<StepOutcome | null>;
  /** Claim the key once (DB unique constraint in production). false = someone already claimed it. */
  claim(key: string, meta: { planId: string; stepIndex: number; actionId: string; actionVersion: number }): Promise<boolean>;
  record(key: string, outcome: StepOutcome): Promise<void>;
}
export interface AuditEvent { planId: string; planHash: string; type: PlanEventType; step: number | null; detail: string; ownerId: string; clientId: string }
export interface AuditStore { append(e: AuditEvent): Promise<void> }
/** A registered primitive's server side (MAIN). There is no fallback / generic executor. */
export interface PrimitiveExecutor {
  /** Fresh read → the fingerprint of exactly the state the step was previewed against. */
  fingerprint(step: PlanStep): Promise<string>;
  execute(step: PlanStep, priorOutputs: ReadonlyMap<number, unknown>): Promise<{ changed: boolean; output?: unknown }>;
  /** Fresh read after execution: did the canonical state become what the preview said? */
  verify(step: PlanStep, output: unknown): Promise<boolean>;
}
export interface EngineDeps {
  nowMs: number;
  secret: string;
  registry: ReadonlyMap<string, ActionContract>;
  executors: ReadonlyMap<string, PrimitiveExecutor>;
  nonces: NonceStore;
  idem: IdempotencyStore;
  audit: AuditStore;
  /** The server's own secret values (knownSecretValues(process.env)) — never persisted, redacted from every detail. */
  knownSecrets?: readonly string[];
}

const refuse = (p: Plan, hash: string, refusal: string): PlanOutcome => ({ planId: p.planId, planHash: hash, status: "REFUSED", refusal, steps: p.steps.map((s) => ({ index: s.index, actionId: s.actionId, status: "NOT_RUN" as StepStatus, detail: refusal, replayed: false })) });

export async function executePlan(plan: Plan, approval: { token: string; ownerId: string; clientId: string; confirmationText: string }, d: EngineDeps): Promise<PlanOutcome> {
  const hash = planHash(plan);
  const log = (type: PlanEventType, step: number | null, detail: string) => d.audit.append({ planId: plan.planId, planHash: hash, type, step, detail: safeDetail(detail, d.knownSecrets), ownerId: approval.ownerId, clientId: approval.clientId });
  // 1. structure + registry (versions, availability, no hidden effects, no security steps)
  const problems = validatePlan(plan, d.registry);
  if (problems.length) { await log("REFUSED", null, `INVALID_PLAN:${problems.map((x) => x.code).join(",")}`); return refuse(plan, hash, `INVALID_PLAN:${problems[0].code}`); }
  // 1b. the persistence contract: a plan that could not be stored safely is never executed either
  const persistable = toPersistablePlan(plan, d.registry, { knownSecrets: d.knownSecrets });
  if (!persistable.ok) { await log("REFUSED", null, `NOT_PERSISTABLE:${[...new Set(persistable.problems.map((x) => x.code))].join(",")}`); return refuse(plan, hash, `NOT_PERSISTABLE:${persistable.problems[0].code}`); }
  if (d.nowMs > Date.parse(plan.expiresAt)) { await log("REFUSED", null, "PLAN_EXPIRED"); return refuse(plan, hash, "PLAN_EXPIRED"); }
  for (const s of plan.steps) {
    const c = d.registry.get(s.actionId)!;
    if (c.availability !== "SUNNY_EXECUTABLE" || c.availabilityDetail !== "EXECUTABLE") { await log("REFUSED", s.index, `NOT_EXECUTABLE:${s.actionId}`); return refuse(plan, hash, `NOT_EXECUTABLE:${s.actionId}`); }
    if (!d.executors.has(s.actionId)) { await log("REFUSED", s.index, `NO_EXECUTOR:${s.actionId}`); return refuse(plan, hash, `NO_EXECUTOR:${s.actionId}`); }
  }
  // 2. the Boss's approval, bound to this exact plan
  const v = await verifyApproval(d.secret, approval.token, { planId: plan.planId, planHash: hash, ownerId: approval.ownerId, clientId: approval.clientId, nowMs: d.nowMs, confirmationText: approval.confirmationText, nonces: d.nonces });
  if (!v.ok) {
    // a replayed token for an already-executed plan returns the recorded outcome (idempotent), never a second run
    if (v.refusal === "TOKEN_REPLAYED") {
      const prior = await Promise.all(plan.steps.map((s) => d.idem.recorded(executionKey(hash, s))));
      if (prior.every((x) => x)) return summarize(plan, hash, prior.map((x) => ({ ...x!, replayed: true })));
    }
    await log("REFUSED", null, v.refusal);
    return refuse(plan, hash, v.refusal);
  }
  await log("APPROVED", null, "owner approval verified");
  // 3. fresh reread + stale check for every independent step BEFORE anything executes
  const executors = d.executors;
  for (const s of plan.steps) {
    if (s.expectedFingerprint === null) continue;
    const already = await d.idem.recorded(executionKey(hash, s));
    if (already) continue;
    const now = await executors.get(s.actionId)!.fingerprint(s);
    if (now !== s.expectedFingerprint) {
      await log("STALE", s.index, "live state changed since the preview");
      return { planId: plan.planId, planHash: hash, status: "STALE", refusal: null, steps: plan.steps.map((x) => ({ index: x.index, actionId: x.actionId, status: (x.index === s.index ? "STALE" : "NOT_RUN") as StepStatus, detail: x.index === s.index ? "live state changed — a new preview is required" : "not run (plan stale)", replayed: false })) };
    }
  }
  // 4. execute in order
  const results: StepOutcome[] = [];
  const outputs = new Map<number, unknown>();
  let failed = false;
  for (const s of plan.steps) {
    const key = executionKey(hash, s);
    const prior = await d.idem.recorded(key);
    if (prior) { results.push({ ...prior, replayed: true }); if (prior.status === "FAILED" || prior.status === "CONFLICT") failed = true; continue; }
    if (failed) { results.push({ index: s.index, actionId: s.actionId, status: "NOT_RUN", detail: s.phase === "COMMUNICATION" ? "communication never runs after a failed step" : "not run after an earlier failure", replayed: false }); continue; }
    if (s.dependsOn.some((i) => results[i]?.status !== "APPLIED_AS_EXPECTED" && results[i]?.status !== "NO_CHANGE")) { failed = true; results.push({ index: s.index, actionId: s.actionId, status: "NOT_RUN", detail: "a prerequisite step did not apply", replayed: false }); continue; }
    const ex = executors.get(s.actionId)!;
    if (s.expectedFingerprint !== null && (await ex.fingerprint(s)) !== s.expectedFingerprint) {
      failed = true; const o: StepOutcome = { index: s.index, actionId: s.actionId, status: "STALE", detail: "live state changed immediately before execution", replayed: false };
      results.push(o); await log("STALE", s.index, o.detail); continue;
    }
    if (!(await d.idem.claim(key, { planId: plan.planId, stepIndex: s.index, actionId: s.actionId, actionVersion: s.actionVersion }))) { failed = true; results.push({ index: s.index, actionId: s.actionId, status: "CONFLICT", detail: "already being executed (duplicate request)", replayed: false }); continue; }
    let o: StepOutcome;
    try {
      const r = await ex.execute(s, outputs);
      outputs.set(s.index, r.output);
      const ok = await ex.verify(s, r.output);
      o = { index: s.index, actionId: s.actionId, status: !ok ? "FAILED" : r.changed ? "APPLIED_AS_EXPECTED" : "NO_CHANGE", detail: ok ? "verified by a fresh read" : "executed but the fresh read does not match the preview", replayed: false };
      await log(ok ? "VERIFIED" : "STEP_FAILED", s.index, o.detail);
      if (ok) await log("STEP_EXECUTED", s.index, r.changed ? "changed" : "no change");
    } catch (e) {
      o = { index: s.index, actionId: s.actionId, status: "FAILED", detail: safeDetail(`execution error: ${(e as Error).message}`, d.knownSecrets).slice(0, 200), replayed: false };
      await log("STEP_FAILED", s.index, o.detail);
    }
    await d.idem.record(key, o);
    results.push(o);
    if (o.status === "FAILED") failed = true;
  }
  return summarize(plan, hash, results);
}

function summarize(plan: Plan, hash: string, steps: StepOutcome[]): PlanOutcome {
  const ok = steps.filter((s) => s.status === "APPLIED_AS_EXPECTED").length;
  const none = steps.filter((s) => s.status === "NO_CHANGE").length;
  const status = ok + none === steps.length ? (ok ? "APPLIED_AS_EXPECTED" : "NO_CHANGE") : ok ? "PARTIALLY_APPLIED" : steps.some((s) => s.status === "STALE") ? "STALE" : "FAILED";
  return { planId: plan.planId, planHash: hash, status, refusal: null, steps };
}

// ── in-memory stores (tests / local only; production stores need the approved DDL) ──────────────────────────────────
export function memoryStores() {
  const nonces = new Set<string>();
  const claimed = new Set<string>();
  const recorded = new Map<string, StepOutcome>();
  const events: AuditEvent[] = [];
  return {
    nonces: { consume: async (c: { nonce: string }) => (nonces.has(c.nonce) ? false : (nonces.add(c.nonce), true)) } satisfies NonceStore,
    idem: { recorded: async (k: string) => recorded.get(k) ?? null, claim: async (k: string) => (claimed.has(k) ? false : (claimed.add(k), true)), record: async (k: string, o: StepOutcome) => { recorded.set(k, o); } } satisfies IdempotencyStore,
    audit: { append: async (e: AuditEvent) => { events.push(e); } } satisfies AuditStore,
    events,
  };
}
