/**
 * SUNNY UNIVERSAL ACTION LAYER — the Owner action service on Redbloods MAIN (pure over injected deps).
 *
 * The five operations behind the five MCP action tools. There is exactly ONE action system: registry → server-built
 * plan → server-side preview → the Boss's explicit approval → fresh read + stale check → one-time claim → the shared
 * business writer → fresh verification → outcome → append-only audit.
 *   plan     — natural language was already turned into { actionId, typed args } by Claude; the SERVER resolves and
 *              type-checks the entity, reads live state, computes the exact change, persists the plan, returns the preview.
 *   preview  — re-reads live state for a persisted plan (tells the Boss if it changed meanwhile).
 *   approve  — relays the Boss's explicit approval text for THIS plan hash → a one-time approval token (never stored).
 *   execute  — the engine; then a fresh read + the derived next step.
 *   status   — recorded outcome / events of a plan (a retry reads this instead of executing again).
 * Every operation re-checks: the caller is the Owner, the plan belongs to this Owner + connector client, the action is
 * registered and EXECUTABLE, and the executor comes ONLY from the registered action id.
 */
import { randomBytes } from "node:crypto";
import type { ActionContract, Plan, PlanOutcome, PlanStep } from "./types";
import { buildPreview, confirmationFor, planHash, validatePlan } from "./plan";
import { issueApprovalToken } from "./approval";
import { executePlan, type AuditStore, type IdempotencyStore, type PrimitiveExecutor } from "./engine";
import type { NonceStore } from "./approval";
import type { PlanStore } from "./store-supabase";
import { planSafeValue, toPersistablePlan, safeDetail } from "./persist";
import { executorFor, fieldsFingerprint, PRIMITIVES_BY_ID, type Fields, type WriterDeps } from "./primitives";
import { validateActInput } from "./mcp-tools";
import { nextStepsFor } from "./next-step";

export const PLAN_TTL_MS = 15 * 60_000;
export interface ActServiceDeps {
  nowMs(): number;
  approvalSecret: string;
  registry: ReadonlyMap<string, ActionContract>;
  registryVersion: string;
  stores: { plans: PlanStore; nonces: NonceStore; idem: IdempotencyStore; audit: AuditStore };
  writers: WriterDeps;
  /** Live Owner check (the Redbloods owner role), never a claim from the connector. */
  isOwner(userId: string): Promise<boolean>;
  knownSecrets: readonly string[];
  newPlanId?(): string;
}
export interface Caller { ownerId: string; clientId: string }
export type ActResult = { status: string; [k: string]: unknown };

const refused = (status: string, messageHe: string, extra: Record<string, unknown> = {}): ActResult => ({ status, messageHe, ...extra });
const PRINCIPAL = /^[A-Za-z0-9_.:-]{1,80}$/;
const PLAN_ID = /^pl_[A-Za-z0-9_-]{16,64}$/;

async function guardCaller(c: Caller, d: ActServiceDeps): Promise<ActResult | null> {
  if (!PRINCIPAL.test(c.ownerId) || !PRINCIPAL.test(c.clientId)) return refused("REFUSED", "זהות לא תקינה");
  if (!(await d.isOwner(c.ownerId))) return refused("NOT_OWNER", "רק הבעלים יכול לבצע פעולות");
  return null;
}
async function loadOwnPlan(planId: unknown, c: Caller, d: ActServiceDeps): Promise<Plan | ActResult> {
  if (typeof planId !== "string" || !PLAN_ID.test(planId)) return refused("REFUSED", "מזהה תוכנית לא תקין");
  let plan: Plan | null;
  try { plan = await d.stores.plans.load(planId); } catch {
    // unreadable, or the stored JSON no longer matches its hash (tampered) → fail closed, never act on it
    return refused("PLAN_UNREADABLE", "התוכנית השמורה לא תקינה או לא נגישה — לא אבצע אותה. צריך תצוגה חדשה");
  }
  if (!plan) return refused("PLAN_NOT_FOUND", "לא מצאתי את התוכנית");
  if (plan.ownerId !== c.ownerId || plan.clientId !== c.clientId) return refused("PLAN_NOT_FOUND", "לא מצאתי את התוכנית"); // never reveal another caller's plan
  return plan;
}
const isResult = (x: unknown): x is ActResult => !!x && typeof x === "object" && typeof (x as ActResult).status === "string" && !("steps" in (x as object));
const executableContract = (id: string, d: ActServiceDeps) => {
  const c = d.registry.get(id);
  return c && c.availability === "SUNNY_EXECUTABLE" && c.availabilityDetail === "EXECUTABLE" && PRIMITIVES_BY_ID.has(id) ? c : null;
};

/** The live before / after of a step, for the Boss (fresh read — never taken from storage). */
async function liveView(step: PlanStep, d: ActServiceDeps) {
  const spec = PRIMITIVES_BY_ID.get(step.actionId)!;
  const id = step.entities[0].slice(step.entities[0].indexOf(":") + 1);
  const cur = await spec.read(d.writers, id);
  const planned = cur ? spec.plan(step.args, cur) : null;
  const fp = fieldsFingerprint(step.actionId, id, cur);
  return {
    exists: !!cur, stale: fp !== step.expectedFingerprint,
    changes: planned && planned.ok ? Object.keys(planned.after).map((k) => ({ field: k, before: cur?.[k] ?? null, after: planned.after[k] })) : [],
  };
}

// ── plan ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
export async function planAction(input: { intentHe: unknown; actionId: unknown; args: unknown }, c: Caller, d: ActServiceDeps): Promise<ActResult> {
  const g = await guardCaller(c, d); if (g) return g;
  const v = validateActInput("partner_plan_action", input as Record<string, unknown>);
  if (!v.ok) return refused("INVALID_INPUT", "הבקשה לא תקינה", { code: v.code });
  const actionId = String(input.actionId);
  const contract = executableContract(actionId, d);
  if (!contract) {
    const known = d.registry.get(actionId);
    return refused("NOT_AVAILABLE", "סאני עוד לא יכולה לבצע את הפעולה הזאת", known ? { availability: known.availability, reasonEn: known.reason } : {});
  }
  const spec = PRIMITIVES_BY_ID.get(actionId)!;
  const args = input.args as Record<string, unknown>;
  const target = await spec.resolve(d.writers, args);
  if ("ok" in target && target.ok === false) return refused(target.code, target.messageHe);
  const t = target as Exclude<typeof target, { ok: false }>;
  const p = spec.plan(args, t.fields);
  if (!p.ok) return refused(p.code, p.messageHe);
  const now = d.nowMs();
  const step: PlanStep = {
    index: 0, actionId, actionVersion: contract.version, args, entities: [t.key], phase: contract.phase,
    expectedFingerprint: fieldsFingerprint(actionId, t.id, t.fields),
    changes: Object.keys(p.after).map((k) => ({ field: k, before: planSafeValue(t.fields[k]), after: planSafeValue(p.after[k]) })),
    dependsOn: [],
  };
  const plan: Plan = {
    planId: d.newPlanId ? d.newPlanId() : `pl_${randomBytes(18).toString("base64url")}`, ownerId: c.ownerId, clientId: c.clientId,
    intentHe: String(input.intentHe).slice(0, 300), steps: [step], riskClass: contract.riskClass, confirmation: confirmationFor(contract.riskClass),
    effects: [...contract.effects, ...contract.possibleEffects], createdAt: new Date(now).toISOString(), expiresAt: new Date(now + PLAN_TTL_MS).toISOString(),
  };
  const problems = validatePlan(plan, d.registry);
  if (problems.length) return refused("INVALID_PLAN", "לא הצלחתי לבנות תוכנית תקינה", { codes: problems.map((x) => x.code) });
  const persistable = toPersistablePlan(plan, d.registry, { knownSecrets: d.knownSecrets });
  if (!persistable.ok) return refused("NOT_PERSISTABLE", "הבקשה מכילה תוכן שאסור לשמור (סוד / נתיב / קישור) — נסח אותה בלי זה", { codes: [...new Set(persistable.problems.map((x) => x.code))] });
  const { planHash: hash } = await d.stores.plans.save(persistable.json, d.registry, d.registryVersion, d.knownSecrets);
  await d.stores.audit.append({ planId: plan.planId, planHash: hash, type: "PLAN_CREATED", step: null, detail: `${actionId}@${contract.version}`, ownerId: c.ownerId, clientId: c.clientId });
  const preview = buildPreview(persistable.json, d.registry);
  await d.stores.audit.append({ planId: plan.planId, planHash: hash, type: "PREVIEWED", step: null, detail: "server-side preview returned", ownerId: c.ownerId, clientId: c.clientId });
  return {
    status: "PREVIEW", planId: plan.planId, planHash: hash, expiresAt: plan.expiresAt,
    entity: { key: t.key, labelHe: { text: t.label, trust: "RECORD" } },
    changes: Object.keys(p.after).map((k) => ({ field: k, before: { value: t.fields[k] ?? null, trust: "RECORD" }, after: { value: p.after[k], trust: "RECORD" } })),
    preview, disclosuresHe: spec.disclosuresHe, requiredConfirmationValues: preview.requiredConfirmationValues,
    askHe: "בוס, זה מה שאני עומדת לשנות. לאשר?",
  };
}

// ── preview ──────────────────────────────────────────────────────────────────────────────────────────────────────────
export async function previewAction(input: { planId: unknown }, c: Caller, d: ActServiceDeps): Promise<ActResult> {
  const g = await guardCaller(c, d); if (g) return g;
  const plan = await loadOwnPlan(input.planId, c, d); if (isResult(plan)) return plan;
  const live = await liveView(plan.steps[0], d);
  const hash = planHash(plan);
  await d.stores.audit.append({ planId: plan.planId, planHash: hash, type: "PREVIEWED", step: null, detail: live.stale ? "preview re-read: live state changed" : "preview re-read", ownerId: c.ownerId, clientId: c.clientId });
  return {
    status: live.stale ? "STALE" : d.nowMs() > Date.parse(plan.expiresAt) ? "EXPIRED" : "PREVIEW", planId: plan.planId, planHash: hash, expiresAt: plan.expiresAt,
    preview: buildPreview(plan, d.registry), liveChanges: live.changes.map((x) => ({ field: x.field, before: { value: x.before, trust: "RECORD" }, after: { value: x.after, trust: "RECORD" } })),
    ...(live.stale ? { messageHe: "בוס, המצב השתנה מאז התצוגה — צריך תוכנית חדשה" } : {}),
  };
}

// ── approve ──────────────────────────────────────────────────────────────────────────────────────────────────────────
export async function approveAction(input: { planId: unknown; planHash: unknown; confirmationText: unknown }, c: Caller, d: ActServiceDeps): Promise<ActResult> {
  const g = await guardCaller(c, d); if (g) return g;
  const plan = await loadOwnPlan(input.planId, c, d); if (isResult(plan)) return plan;
  const hash = planHash(plan);
  if (input.planHash !== hash) return refused("PLAN_CHANGED", "התוכנית שאושרה אינה התוכנית השמורה — צריך תצוגה חדשה");
  if (d.nowMs() > Date.parse(plan.expiresAt)) return refused("EXPIRED", "התוכנית פגה — צריך תצוגה חדשה");
  const text = typeof input.confirmationText === "string" ? input.confirmationText.trim() : "";
  if (!text || text.length > 500) return refused("APPROVAL_MISSING", "צריך את האישור המפורש שלך, בוס");
  const pv = buildPreview(plan, d.registry);
  if (pv.requiredConfirmationValues.some((v) => !text.includes(v))) return refused("CONFIRMATION_VALUES_MISSING", "האישור צריך לחזור על הערכים המדויקים", { requiredConfirmationValues: pv.requiredConfirmationValues });
  const token = issueApprovalToken(d.approvalSecret, { planHash: hash, ownerId: c.ownerId, clientId: c.clientId, nowMs: d.nowMs(), requiredValues: pv.requiredConfirmationValues });
  // the token and the confirmation text are returned to the caller only — never stored
  return { status: "APPROVED_PENDING_EXECUTION", planId: plan.planId, planHash: hash, approvalToken: token, noteHe: "האישור תקף לתוכנית הזאת בלבד, פעם אחת, ל-10 דקות" };
}

// ── execute ──────────────────────────────────────────────────────────────────────────────────────────────────────────
export async function executeAction(input: { planId: unknown; approvalToken: unknown; confirmationText: unknown }, c: Caller, d: ActServiceDeps): Promise<ActResult> {
  const g = await guardCaller(c, d); if (g) return g;
  const plan = await loadOwnPlan(input.planId, c, d); if (isResult(plan)) return plan;
  for (const s of plan.steps) if (!executableContract(s.actionId, d)) return refused("NOT_AVAILABLE", "הפעולה כבר לא זמינה");
  const executors = new Map<string, PrimitiveExecutor>(plan.steps.map((s) => [s.actionId, executorFor(PRIMITIVES_BY_ID.get(s.actionId)!, d.writers)]));
  let out: PlanOutcome;
  try {
    out = await executePlan(plan, { token: String(input.approvalToken ?? ""), ownerId: c.ownerId, clientId: c.clientId, confirmationText: String(input.confirmationText ?? "") }, {
      nowMs: d.nowMs(), secret: d.approvalSecret, registry: d.registry, executors, nonces: d.stores.nonces, idem: d.stores.idem, audit: d.stores.audit, knownSecrets: d.knownSecrets,
    });
  } catch (e) {
    // a persistence / store failure mid-flow: the claim protects against a second run; never claim success
    return refused("OUTCOME_UNKNOWN", "לא הצלחתי לתעד את הביצוע עד הסוף — אבדוק את המצב לפני שאגיד משהו", { detail: safeDetail((e as Error).message, d.knownSecrets).slice(0, 200) });
  }
  // fresh read + the derived next step (a PROPOSAL only — never executed)
  const s0 = plan.steps[0];
  const spec = PRIMITIVES_BY_ID.get(s0.actionId)!;
  const id = s0.entities[0].slice(s0.entities[0].indexOf(":") + 1);
  const now: Fields | null = await spec.read(d.writers, id);
  const next = nextStepFor(s0.actionId, now);
  const ok = out.status === "APPLIED_AS_EXPECTED" || out.status === "NO_CHANGE";
  return {
    status: out.status, planId: plan.planId, refusal: out.refusal, steps: out.steps,
    freshState: now ? { entity: s0.entities[0], fields: Object.fromEntries(Object.entries(now).map(([k, v]) => [k, { value: v, trust: "RECORD" }])) } : null,
    nextStep: next ? { ...next, epistemic: "DERIVED" } : null,
    messageHe: ok ? (out.status === "NO_CHANGE" ? "בוס, לא היה מה לשנות — המצב כבר כזה" : "בוצע בוס — בדקתי מחדש והשינוי קיים") : out.status === "STALE" ? "בוס, המצב השתנה מאז התצוגה, לא ביצעתי כלום. צריך תצוגה חדשה" : "בוס, הפעולה לא בוצעה — הנה מה שקרה",
  };
}
function nextStepFor(actionId: string, now: Fields | null) {
  if (!now) return null;
  const map: Record<string, [string, string]> = { CHANGE_RELEASE_STAGE: ["RELEASE_STAGE", "releaseStage"], UPDATE_MIX_VERSION_STATUS_OR_LABEL: ["MIX_VERSION_STATUS", "status"], RESOLVE_MIX_COMMENT: ["MIX_COMMENT_STATUS", "status"], REOPEN_MIX_COMMENT: ["MIX_COMMENT_STATUS", "status"], UPDATE_VICTOR_WORK_STATE: ["VICTOR_WORK_STATE", "workState"], UPDATE_VICTOR_OUTCOME: ["VICTOR_OUTCOME", "outcome"], UPDATE_LABEL_ARTIST_NOTES_STATUS: ["LABEL_ARTIST_STATUS", "status"] };
  const m = map[actionId];
  return m && typeof now[m[1]] === "string" ? nextStepsFor(m[0], String(now[m[1]])) : null;
}

// ── status ───────────────────────────────────────────────────────────────────────────────────────────────────────────
export async function planStatus(input: { planId: unknown }, c: Caller, d: ActServiceDeps): Promise<ActResult> {
  const g = await guardCaller(c, d); if (g) return g;
  const plan = await loadOwnPlan(input.planId, c, d); if (isResult(plan)) return plan;
  const [ex, ev] = await Promise.all([d.stores.plans.executions(plan.planId), d.stores.plans.events(plan.planId)]);
  const executed = ex.filter((x) => x.status !== "CLAIMED");
  return {
    status: executed.length ? (executed.every((x) => x.status === "APPLIED_AS_EXPECTED" || x.status === "NO_CHANGE") ? "EXECUTED" : "EXECUTED_WITH_ISSUES") : ex.length ? "IN_PROGRESS_OR_UNKNOWN" : d.nowMs() > Date.parse(plan.expiresAt) ? "EXPIRED" : "NOT_EXECUTED",
    planId: plan.planId, planHash: planHash(plan), steps: ex.map((x) => ({ index: x.stepIndex, actionId: x.actionId, status: x.status, outcome: x.outcome })), events: ev,
  };
}
