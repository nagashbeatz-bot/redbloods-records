/**
 * SUNNY UNIVERSAL ACTION LAYER — the ONE execution orchestrator (pure; every dependency injected).
 *
 * APPROVAL → registry re-check → fresh reread + stale check → one-time claim → execute through the registered shared
 * writer → fresh reread + verify → per-step outcome → audit. A retry returns the recorded outcome and never executes twice.
 * A failure stops every later step; a COMMUNICATION step never runs after any failure. Nothing is ever reported as done
 * without verification. There is no generic writer: a step can only run through an executor registered for its action.
 *
 * Reliability (2026-09-27):
 *   - Every step of an executed plan gets exactly ONE recorded row: APPLIED / NO_CHANGE / FAILED through claim → record;
 *     STALE / NOT_RUN settled directly (no claim — the step never ran). A lost claim (CONFLICT) is never written: the row
 *     belongs to the run that holds it, and this run stops at once (nothing later is settled or executed).
 *   - A plan that already has recorded outcomes is never executed again: a replay of the SAME consumed token returns the
 *     recorded outcome; a fresh token for it is refused (ALREADY_EXECUTED).
 *   - Self-stale fix: each step's re-check / execution reads its creation context with the ids created by EARLIER steps
 *     of THIS run left out (StepContext.excludeCreated) — the plan's own creations never make it STALE, any external
 *     change still does. The expected fingerprint is never recomputed.
 *   - Chained steps (2026-09-29): a step on the SAME record as earlier steps (dependsOn) was approved on the PROJECTED
 *     state. Before anything runs it is checked on the live state seen through the earlier steps' planned values (any
 *     external change to the base → STALE, nothing runs); it runs only if every step it depends on is
 *     APPLIED_AS_EXPECTED; at its turn the fresh state must still yield exactly the approved after-values + warnings
 *     (else STALE, no write). Plans without chained steps read and behave exactly as before.
 *   - `$stepK.created` references (lib/partner/act/refs): resolved at the step's turn ONLY from the createdKey step K
 *     recorded in THIS run (K must be APPLIED_AS_EXPECTED — dependsOn); unresolved → NOT_RUN, never guessed. The
 *     resolved step is what is fingerprinted / checked against its exact preview / executed / verified.
 */
import { OWNER_EVENT_DETAIL, STANDING_EVENT_DETAIL, standingEligible } from "./standing";
import type { ActionContract, Plan, PlanEventType, PlanOutcome, PlanStep, StepOutcome, StepStatus } from "./types";
import { executionKey, planHash, validatePlan } from "./plan";
import { verifyApproval, type NonceStore } from "./approval";
import { verifiedDetail, type VerifyKind } from "./verify-kind";
import { ENTITY_KEY_RE, safeDetail, toPersistablePlan } from "./persist";
import { resolveStepRefs } from "./refs";

export interface ClaimMeta { planId: string; stepIndex: number; actionId: string; actionVersion: number; /** engine clock (ms) — stored so a stuck claim can be aged */ atMs?: number }
export interface IdempotencyStore {
  /** The recorded (terminal) outcome for this execution key, if any (a replay returns it). A CLAIMED row is not an outcome. */
  recorded(key: string): Promise<StepOutcome | null>;
  /** Claim the key once (DB unique constraint in production). false = someone already claimed it. */
  claim(key: string, meta: ClaimMeta): Promise<boolean>;
  /** CLAIMED → terminal outcome (the claimed row only). */
  record(key: string, outcome: StepOutcome): Promise<void>;
  /** A terminal row for a step that never ran (STALE / NOT_RUN) — inserted without a claim. false = the step already has a row. */
  settle(key: string, meta: ClaimMeta, outcome: StepOutcome): Promise<boolean>;
}
/** What a step may know about its own run: the ids earlier steps of THIS plan created (left out of duplicate context),
 *  and — for a CHAINED step (same record as earlier steps, dependsOn) — the projected state it was approved against. */
export interface StepContext { excludeCreated: readonly string[]; chain?: { overlay: Record<string, string | number | boolean | null>; priorDerived: readonly string[]; expect?: string } }
/** A step's planned result on a (projected) live state — used only to chain steps on the same record. null = the plan no longer holds. */
export interface StepProjection { after: Record<string, string | number | boolean | null>; derived: readonly string[]; expect: string }
export interface AuditEvent { planId: string; planHash: string; type: PlanEventType; step: number | null; detail: string; ownerId: string; clientId: string }
export interface AuditStore { append(e: AuditEvent): Promise<void> }
/** A registered primitive's server side (MAIN). There is no fallback / generic executor. */
export interface PrimitiveExecutor {
  /** Fresh read → the fingerprint of exactly the state the step was previewed against (ctx: this run's own creations left out). */
  fingerprint(step: PlanStep, ctx?: StepContext): Promise<string>;
  /** A step with a `$stepK.created` reference (resolved): the fresh state shows exactly the previewed before-values and
   *  yields exactly the previewed after-values (map: created id → the reference as approved). Required for such steps. */
  matchesPreview?(step: PlanStep, map: Readonly<Record<string, string>>, ctx?: StepContext): Promise<boolean>;
  /** The step's planned after-values on the live state seen through ctx.chain (optional; required to chain steps). */
  project?(step: PlanStep, ctx?: StepContext): Promise<StepProjection | null>;
  execute(step: PlanStep, priorOutputs: ReadonlyMap<number, unknown>, ctx?: StepContext): Promise<{ changed: boolean; output?: unknown }>;
  /** Fresh read after execution: did the canonical state become what the preview said? */
  verify(step: PlanStep, output: unknown): Promise<boolean>;
  /** What `verify` actually proves (claim contract 2026-10-05, lib/partner/act/verify-kind.ts); absent = FRESH_READ. */
  verifyKind?: VerifyKind;
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
  // 2b. a plan that already has recorded outcomes is never executed again (a fresh token cannot re-run it)
  const recordedBefore = await Promise.all(plan.steps.map((s) => d.idem.recorded(executionKey(hash, s))));
  if (recordedBefore.some(Boolean)) {
    await log("REFUSED", null, "ALREADY_EXECUTED");
    return { planId: plan.planId, planHash: hash, status: "REFUSED", refusal: "ALREADY_EXECUTED", steps: plan.steps.map((s, i) => (recordedBefore[i] ? { ...recordedBefore[i]!, replayed: true } : { index: s.index, actionId: s.actionId, status: "NOT_RUN" as StepStatus, detail: "no recorded outcome for this step", replayed: false })) };
  }
  // 2c. a STANDING approval (Owner-inbox housekeeping) is re-checked here: only a plan made solely of standing-authorized
  //     primitives; it is recorded distinctly so the history always says who approved
  const standing = v.claims.k === "S";
  if (standing && !standingEligible(plan)) { await log("REFUSED", null, "STANDING_NOT_ELIGIBLE"); return refuse(plan, hash, "STANDING_NOT_ELIGIBLE"); }
  await log("APPROVED", null, standing ? STANDING_EVENT_DETAIL : OWNER_EVENT_DETAIL);
  const at = new Date(d.nowMs).toISOString();
  const meta = (s: PlanStep): ClaimMeta => ({ planId: plan.planId, stepIndex: s.index, actionId: s.actionId, actionVersion: s.actionVersion, atMs: d.nowMs });
  /** a terminal row for a step that did not run; a store failure never turns "did not run" into anything else */
  const settle = async (s: PlanStep, o: StepOutcome) => { try { await d.idem.settle(executionKey(hash, s), meta(s), o); } catch { /* the response still says exactly what happened */ } };
  // 3. fresh reread + stale check for every independent step BEFORE anything executes. A CHAINED step (same record as
  //    earlier steps) is checked on the projected live state (earlier steps' planned values on its view) — so any
  //    external change to the approved BASE state still makes the whole plan STALE before anything runs.
  const executors = d.executors;
  const chain = await chainContexts(plan, executors);
  for (const s of plan.steps) {
    if (s.expectedFingerprint === null) continue;
    const c = chain.ctx.get(s.index);
    const now = chain.broken.has(s.index) ? "CHAIN_BROKEN" : await executors.get(s.actionId)!.fingerprint(s, c ? { excludeCreated: [], chain: { overlay: c.overlay, priorDerived: c.priorDerived } } : undefined);
    if (now !== s.expectedFingerprint) {
      await log("STALE", s.index, "live state changed since the preview");
      const steps = plan.steps.map((x): StepOutcome => ({ index: x.index, actionId: x.actionId, status: x.index === s.index ? "STALE" : "NOT_RUN", detail: x.index === s.index ? "live state changed — a new preview is required" : "not run (plan stale)", replayed: false, at }));
      for (const x of plan.steps) await settle(x, steps[x.index]);
      return { planId: plan.planId, planHash: hash, status: "STALE", refusal: null, steps };
    }
  }
  // 4. execute in order
  const results: StepOutcome[] = [];
  const outputs = new Map<number, unknown>();
  const created: string[] = [];
  let failed = false;
  for (const s of plan.steps) {
    const key = executionKey(hash, s);
    if (failed) { const o: StepOutcome = { index: s.index, actionId: s.actionId, status: "NOT_RUN", detail: s.phase === "COMMUNICATION" ? "communication never runs after a failed step" : "not run after an earlier failure", replayed: false, at }; results.push(o); await settle(s, o); continue; }
    // a step that depends on earlier steps runs only when EVERY one of them applied exactly as approved
    if (s.dependsOn.some((i) => results[i]?.status !== "APPLIED_AS_EXPECTED")) { failed = true; const o: StepOutcome = { index: s.index, actionId: s.actionId, status: "NOT_RUN", detail: "a prerequisite step did not apply", replayed: false, at }; results.push(o); await settle(s, o); continue; }
    const ex = executors.get(s.actionId)!;
    const cc = chain.ctx.get(s.index);
    const ctx: StepContext = { excludeCreated: [...created], ...(cc ? { chain: cc } : {}) };
    // `$stepK.created`: the real key comes ONLY from the createdKey step K recorded in THIS run (never from the caller)
    const resolved = resolveStepRefs(s, (k) => (results[k]?.status === "APPLIED_AS_EXPECTED" ? results[k]?.createdKey : undefined));
    if (!resolved) { failed = true; const o: StepOutcome = { index: s.index, actionId: s.actionId, status: "NOT_RUN", detail: "the record an earlier step should have created is not known — not run (never guessed)", replayed: false, at }; results.push(o); await settle(s, o); continue; }
    const rs = resolved.step;
    const hasRefs = rs !== s;
    if (s.expectedFingerprint !== null && (await ex.fingerprint(rs, ctx)) !== s.expectedFingerprint) {
      failed = true; const o: StepOutcome = { index: s.index, actionId: s.actionId, status: "STALE", detail: "live state changed immediately before execution", replayed: false, at };
      results.push(o); await log("STALE", s.index, o.detail); await settle(s, o); continue;
    }
    if (hasRefs && !(ex.matchesPreview && (await ex.matchesPreview(rs, resolved.map, ctx)))) {
      failed = true; const o: StepOutcome = { index: s.index, actionId: s.actionId, status: "STALE", detail: "the state no longer matches the previewed change for the created record — not written", replayed: false, at };
      results.push(o); await log("STALE", s.index, o.detail); await settle(s, o); continue;
    }
    if (!(await d.idem.claim(key, meta(s)))) {
      // another run holds this step: stop at once — never settle / execute anything it may still be doing
      results.push({ index: s.index, actionId: s.actionId, status: "CONFLICT", detail: "already being executed (duplicate request)", replayed: false });
      for (const x of plan.steps.slice(s.index + 1)) results.push({ index: x.index, actionId: x.actionId, status: "NOT_RUN", detail: "not run here — another execution of this plan is in progress", replayed: false });
      break;
    }
    let o: StepOutcome;
    try {
      const r = await ex.execute(rs, outputs, ctx);
      outputs.set(s.index, r.output);
      const cid = (r.output as { createdId?: unknown } | undefined)?.createdId;
      if (typeof cid === "string" && cid) created.push(cid);
      const ok = await ex.verify(rs, r.output);
      const createdKey = createdKeyOf(s, cid);
      o = { index: s.index, actionId: s.actionId, status: !ok ? "FAILED" : r.changed ? "APPLIED_AS_EXPECTED" : "NO_CHANGE", detail: verifiedDetail(ex.verifyKind ?? "FRESH_READ", ok), replayed: false, at, ...(createdKey ? { createdKey } : {}) };
      await log(ok ? "VERIFIED" : "STEP_FAILED", s.index, o.detail);
      if (ok) await log("STEP_EXECUTED", s.index, r.changed ? "changed" : "no change");
    } catch (e) {
      o = { index: s.index, actionId: s.actionId, status: "FAILED", detail: safeDetail(`execution error: ${(e as Error).message}`, d.knownSecrets).slice(0, 200), replayed: false, at };
      await log("STEP_FAILED", s.index, o.detail);
    }
    await d.idem.record(key, o);
    results.push(o);
    if (o.status === "FAILED") failed = true;
  }
  return summarize(plan, hash, results);
}
/** A step shares the record of the earlier steps it depends on (the only way a plan gets dependsOn today). */
export const isChainedStep = (plan: Plan, s: PlanStep) => s.dependsOn.length > 0 && s.dependsOn.every((i) => plan.steps[i]?.entities[0] === s.entities[0]);
/**
 * The projected state of every chained step, walked in plan order on the CURRENT live state: each involved step's
 * planned after-values (and declared derived fields) accumulate per record; a chained step gets them as its context
 * plus the exact {after, warnings} it yields on that projection (checked again at its turn). broken = a step whose plan
 * no longer holds on the live state (or whose executor cannot project) — never executable. Plans without chained steps
 * read nothing here.
 */
export async function chainContexts(plan: Plan, executors: ReadonlyMap<string, PrimitiveExecutor>): Promise<{ ctx: Map<number, NonNullable<StepContext["chain"]>>; broken: Set<number> }> {
  const ctx = new Map<number, NonNullable<StepContext["chain"]>>();
  const broken = new Set<number>();
  const needed = new Set<number>();
  for (const s of plan.steps) if (isChainedStep(plan, s)) { needed.add(s.index); s.dependsOn.forEach((i) => needed.add(i)); }
  if (!needed.size) return { ctx, broken };
  const overlay = new Map<string, StepProjection["after"]>();
  const derived = new Map<string, string[]>();
  for (const s of plan.steps) {
    if (!needed.has(s.index)) continue;
    const key = s.entities[0];
    const c = isChainedStep(plan, s) ? { overlay: { ...(overlay.get(key) ?? {}) }, priorDerived: [...(derived.get(key) ?? [])] } : undefined;
    const ex = executors.get(s.actionId);
    let pr: StepProjection | null = null;
    try { pr = ex?.project ? await ex.project(s, { excludeCreated: [], ...(c ? { chain: c } : {}) }) : null; } catch { pr = null; }
    if (!pr) { broken.add(s.index); if (c) ctx.set(s.index, c); continue; }
    if (c) ctx.set(s.index, { ...c, expect: pr.expect });
    overlay.set(key, { ...(overlay.get(key) ?? {}), ...pr.after });
    derived.set(key, [...(derived.get(key) ?? []), ...pr.derived]);
  }
  return { ctx, broken };
}

/** The canonical key of the record a CREATE step made ("kind:<created id>") — only for a step planned on "kind:new". */
export function createdKeyOf(s: PlanStep, createdId: unknown): string | undefined {
  const k = s.entities[0] ?? "";
  if (typeof createdId !== "string" || !createdId || !k.endsWith(":new")) return undefined;
  const key = `${k.slice(0, k.indexOf(":"))}:${createdId}`;
  return ENTITY_KEY_RE.test(key) ? key : undefined;
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
    idem: {
      recorded: async (k: string) => recorded.get(k) ?? null,
      claim: async (k: string) => (claimed.has(k) ? false : (claimed.add(k), true)),
      record: async (k: string, o: StepOutcome) => { recorded.set(k, o); },
      settle: async (k: string, _m: ClaimMeta, o: StepOutcome) => (claimed.has(k) || recorded.has(k) ? false : (claimed.add(k), recorded.set(k, o), true)),
    } satisfies IdempotencyStore,
    audit: { append: async (e: AuditEvent) => { events.push(e); } } satisfies AuditStore,
    events,
  };
}
