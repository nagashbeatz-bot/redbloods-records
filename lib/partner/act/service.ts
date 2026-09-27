/**
 * SUNNY UNIVERSAL ACTION LAYER — the Owner action service on Redbloods MAIN (pure over injected deps).
 *
 * The five operations behind the five MCP action tools. There is exactly ONE action system: registry → server-built
 * plan → server-side preview → the Boss's explicit approval → fresh read + stale check → one-time claim → the shared
 * business writer → fresh verification → outcome → append-only audit.
 *   plan     — natural language was already turned into { actionId, typed args } by Claude; the SERVER resolves and
 *              type-checks the entity, reads live state, computes the exact change, persists the plan, returns the preview.
 *   preview  — re-reads live state for a persisted plan (tells the Boss if it changed meanwhile).
 *   approve  — relays the Boss's explicit approval ("מאשר" is enough — no repeated values) for THIS plan hash → a
 *              one-time approval token (never stored). Words that change the plan are a new request, never an approval.
 *   execute  — the engine; then a fresh read + the derived next step.
 *   status   — recorded outcome / events / detail of a plan (a retry reads this instead of executing again), or the
 *              Boss's own action history (filters + cursor pagination; read-only; tokens / secrets are never stored).
 * A plan is ONE action or ONE compound business event (2–8 registered actions, one preview, one approval bound to the
 * exact whole plan hash; the engine re-reads every step before anything runs and reports partial failure truthfully).
 * Every operation re-checks: the caller is the Owner, the plan belongs to this Owner + connector client, the action is
 * registered and EXECUTABLE, and the executor comes ONLY from the registered action id.
 */
import { COVERAGE_MAP } from "./coverage-map";
import { randomBytes } from "node:crypto";
import type { ActionContract, Plan, PlanOutcome, PlanStep } from "./types";
import { buildPreview, confirmationFor, highestRisk, planHash, validatePlan } from "./plan";
import { issueApprovalToken } from "./approval";
import { classifyApprovalText } from "./approval-text";
import { executePlan, type AuditStore, type IdempotencyStore, type PrimitiveExecutor } from "./engine";
import type { NonceStore } from "./approval";
import type { PlanStore } from "./store-supabase";
import { isSafeUrl, planSafeValue, toPersistablePlan, safeDetail } from "./persist";
import { currentOf, executorFor, fieldsFingerprint, PRIMITIVES_BY_ID, type Fields, type WriterDeps } from "./primitives";
import { HISTORY_OUTCOMES, MAX_WORKFLOW_STEPS, validateActInput } from "./mcp-tools";
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
async function loadOwnPlan(planId: unknown, c: Caller, d: ActServiceDeps, scope: "CLIENT" | "OWNER" = "CLIENT"): Promise<Plan | ActResult> {
  if (typeof planId !== "string" || !PLAN_ID.test(planId)) return refused("REFUSED", "מזהה תוכנית לא תקין");
  let plan: Plan | null;
  try { plan = await d.stores.plans.load(planId); } catch {
    // unreadable, or the stored JSON no longer matches its hash (tampered) → fail closed, never act on it
    return refused("PLAN_UNREADABLE", "התוכנית השמורה לא תקינה או לא נגישה — לא אבצע אותה. צריך תצוגה חדשה");
  }
  if (!plan) return refused("PLAN_NOT_FOUND", "לא מצאתי את התוכנית");
  if (plan.ownerId !== c.ownerId || (scope === "CLIENT" && plan.clientId !== c.clientId)) return refused("PLAN_NOT_FOUND", "לא מצאתי את התוכנית"); // never reveal another caller's plan
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
  const cur = await currentOf(spec, d.writers, step);
  const planned = cur ? spec.plan(step.args, cur) : null;
  const fp = fieldsFingerprint(step.actionId, id, cur);
  return {
    exists: !!cur, stale: fp !== step.expectedFingerprint,
    changes: planned && planned.ok ? Object.keys(planned.after).map((k) => ({ field: k, before: cur?.[k] ?? null, after: planned.after[k] })) : [],
  };
}

// ── plan ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
interface BuiltStep { step: PlanStep; contract: ActionContract; key: string; label: string; fields: Fields; after: Fields; requiredValues: string[]; warnings: string[]; disclosuresHe: readonly string[] }
/** One registered action → one server-built step (resolve → live read → exact change). Shared by single plans and workflows. */
async function buildStep(actionId: string, args: Record<string, unknown>, index: number, d: ActServiceDeps): Promise<BuiltStep | ActResult> {
  const contract = executableContract(actionId, d);
  if (!contract) {
    const known = d.registry.get(actionId);
    const via = known ? COVERAGE_MAP[known.id] : undefined;
    if (known && via && known.availabilityDetail === "EXECUTABLE") return refused("USE_PRIMITIVES", `זו פעולה של המערכת שמתבצעת דרך הפעולות המוקלדות: ${via.by.join(", ")} — לתכנן אחת מהן`, { availability: known.availability, useActions: via.by });
    return refused("NOT_AVAILABLE", "סאני עוד לא יכולה לבצע את הפעולה הזאת", known ? { availability: known.availability, reasonEn: known.reason } : {});
  }
  const spec = PRIMITIVES_BY_ID.get(actionId)!;
  const target = await spec.resolve(d.writers, args);
  if ("ok" in target && target.ok === false) return refused(target.code, target.messageHe);
  const t = target as Exclude<typeof target, { ok: false }>;
  const p = spec.plan(args, t.fields);
  if (!p.ok) return refused(p.code, p.messageHe);
  const step: PlanStep = {
    index, actionId, actionVersion: contract.version, args, entities: [t.key], phase: contract.phase,
    expectedFingerprint: fieldsFingerprint(actionId, t.id, t.fields),
    changes: Object.keys(p.after).map((k) => ({ field: k, before: planSafeValue(t.fields[k]), after: contract.args.some((a) => a.name === k && a.kind === "url") && isSafeUrl(p.after[k]) ? String(p.after[k]) : planSafeValue(p.after[k]) })),
    dependsOn: [],
  };
  return { step, contract, key: t.key, label: t.label, fields: t.fields, after: p.after, requiredValues: spec.requiredValues?.(args, p.after) ?? [], warnings: spec.warnings?.(t.fields, args) ?? [], disclosuresHe: spec.disclosuresHe };
}
const isBuilt = (x: BuiltStep | ActResult): x is BuiltStep => "step" in x && !!(x as BuiltStep).step;

/** Persist a server-built plan and return its preview (single action or workflow). */
async function persistAndPreview(intentHe: string, built: readonly BuiltStep[], c: Caller, d: ActServiceDeps): Promise<ActResult> {
  const now = d.nowMs();
  const risk = highestRisk(built.map((b) => b.contract.riskClass));
  const plan: Plan = {
    planId: d.newPlanId ? d.newPlanId() : `pl_${randomBytes(18).toString("base64url")}`, ownerId: c.ownerId, clientId: c.clientId,
    intentHe: intentHe.slice(0, 300), steps: built.map((b) => b.step), riskClass: risk, confirmation: confirmationFor(risk),
    effects: [...new Set(built.flatMap((b) => [...b.contract.effects, ...b.contract.possibleEffects]))], createdAt: new Date(now).toISOString(), expiresAt: new Date(now + PLAN_TTL_MS).toISOString(),
  };
  const problems = validatePlan(plan, d.registry);
  if (problems.length) return refused("INVALID_PLAN", "לא הצלחתי לבנות תוכנית תקינה", { codes: problems.map((x) => x.code) });
  const persistable = toPersistablePlan(plan, d.registry, { knownSecrets: d.knownSecrets });
  if (!persistable.ok) return refused("NOT_PERSISTABLE", "הבקשה מכילה תוכן שאסור לשמור (סוד / נתיב / קישור) — נסח אותה בלי זה", { codes: [...new Set(persistable.problems.map((x) => x.code))] });
  const { planHash: hash } = await d.stores.plans.save(persistable.json, d.registry, d.registryVersion, d.knownSecrets);
  await d.stores.audit.append({ planId: plan.planId, planHash: hash, type: "PLAN_CREATED", step: null, detail: built.length === 1 ? `${built[0].step.actionId}@${built[0].contract.version}` : `WORKFLOW:${built.map((b) => b.step.actionId).join("+")}`.slice(0, 200), ownerId: c.ownerId, clientId: c.clientId });
  const preview = buildPreview(persistable.json, d.registry, { requiredConfirmationValues: built.flatMap((b) => b.requiredValues), duplicateWarningsHe: built.flatMap((b) => b.warnings) });
  await d.stores.audit.append({ planId: plan.planId, planHash: hash, type: "PREVIEWED", step: null, detail: "server-side preview returned", ownerId: c.ownerId, clientId: c.clientId });
  const changesOf = (b: BuiltStep) => Object.keys(b.after).map((k) => ({ field: k, before: { value: b.fields[k] ?? null, trust: "RECORD" }, after: { value: b.after[k], trust: "RECORD" } }));
  if (built.length === 1) {
    const b = built[0];
    return {
      status: "PREVIEW", planId: plan.planId, planHash: hash, expiresAt: plan.expiresAt,
      entity: { key: b.key, labelHe: { text: b.label, trust: "RECORD" } }, changes: changesOf(b),
      preview, disclosuresHe: b.disclosuresHe, requiredConfirmationValues: preview.requiredConfirmationValues,
      askHe: "בוס, זה מה שאני עומדת לשנות. לאשר?",
    };
  }
  return {
    status: "PREVIEW", planId: plan.planId, planHash: hash, expiresAt: plan.expiresAt, workflow: true,
    steps: built.map((b, i) => ({ index: i, actionId: b.step.actionId, entity: { key: b.key, labelHe: { text: b.label, trust: "RECORD" } }, changes: changesOf(b), disclosuresHe: b.disclosuresHe })),
    preview, requiredConfirmationValues: preview.requiredConfirmationValues,
    executionRuleHe: "השלבים רצים לפי הסדר; אם שלב נכשל או שהמצב השתנה — השלבים שאחריו לא רצים, ואני מדווחת בדיוק מה בוצע ומה לא",
    askHe: `בוס, אלה ${built.length} השלבים שאני עומדת לבצע יחד. לאשר את כולם?`,
  };
}

export async function planAction(input: { intentHe: unknown; actionId?: unknown; args?: unknown; steps?: unknown }, c: Caller, d: ActServiceDeps): Promise<ActResult> {
  const g = await guardCaller(c, d); if (g) return g;
  const v = validateActInput("partner_plan_action", input as Record<string, unknown>);
  if (!v.ok) return refused("INVALID_INPUT", "הבקשה לא תקינה", { code: v.code });
  if (Array.isArray(input.steps)) return planWorkflow({ intentHe: input.intentHe, steps: input.steps }, c, d);
  const b = await buildStep(String(input.actionId), input.args as Record<string, unknown>, 0, d);
  if (!isBuilt(b)) return b;
  return persistAndPreview(String(input.intentHe), [b], c, d);
}

/**
 * A compound workflow: several registered actions in ONE plan → one server-side preview → ONE approval of the whole
 * plan (every step's exact values) → the engine runs them in order (stale check on every step first; a failure stops
 * every later step; communication never runs after a failure; the outcome says exactly which steps applied).
 * Every step targets an entity that already exists (or is a create). A step that needs an entity another step of the
 * same plan creates cannot be previewed exactly — it is planned right after, with the created entity.
 */
async function planWorkflow(input: { intentHe: unknown; steps: unknown[] }, c: Caller, d: ActServiceDeps): Promise<ActResult> {
  const steps = input.steps;
  if (steps.length < 2 || steps.length > MAX_WORKFLOW_STEPS) return refused("INVALID_INPUT", `תהליך הוא 2–${MAX_WORKFLOW_STEPS} שלבים`, { code: "WORKFLOW_SIZE" });
  const built: BuiltStep[] = [];
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i] as { actionId: unknown; args: unknown };
    const b = await buildStep(String(s.actionId), s.args as Record<string, unknown>, i, d);
    if (!isBuilt(b)) return { ...b, step: i, actionId: String(s.actionId) };
    built.push(b);
  }
  const keys = built.map((b) => b.key).filter((k) => !k.endsWith(":new"));
  const dup = keys.find((k, i) => keys.indexOf(k) !== i);
  if (dup) return refused("SAME_ENTITY_TWICE", "שני שלבים באותו תהליך משנים את אותה רשומה — כל שלב חייב לראות את המצב שהוצג לך. נאחד לשלב אחד או נבצע ברצף", { entity: dup });
  return persistAndPreview(String(input.intentHe), built, c, d);
}

// ── preview ──────────────────────────────────────────────────────────────────────────────────────────────────────────
export async function previewAction(input: { planId: unknown }, c: Caller, d: ActServiceDeps): Promise<ActResult> {
  const g = await guardCaller(c, d); if (g) return g;
  const plan = await loadOwnPlan(input.planId, c, d); if (isResult(plan)) return plan;
  const lives = await Promise.all(plan.steps.map((s) => liveView(s, d)));
  const stale = lives.some((x) => x.stale);
  const hash = planHash(plan);
  await d.stores.audit.append({ planId: plan.planId, planHash: hash, type: "PREVIEWED", step: null, detail: stale ? "preview re-read: live state changed" : "preview re-read", ownerId: c.ownerId, clientId: c.clientId });
  const asTrust = (xs: Array<{ field: string; before: unknown; after: unknown }>) => xs.map((x) => ({ field: x.field, before: { value: x.before, trust: "RECORD" }, after: { value: x.after, trust: "RECORD" } }));
  return {
    status: stale ? "STALE" : d.nowMs() > Date.parse(plan.expiresAt) ? "EXPIRED" : "PREVIEW", planId: plan.planId, planHash: hash, expiresAt: plan.expiresAt,
    preview: buildPreview(plan, d.registry, { requiredConfirmationValues: requiredValuesOf(plan) }), liveChanges: asTrust(lives[0].changes),
    ...(plan.steps.length > 1 ? { stepsLive: lives.map((x, i) => ({ index: i, stale: x.stale, liveChanges: asTrust(x.changes) })) } : {}),
    ...(stale ? { messageHe: "בוס, המצב השתנה מאז התצוגה — צריך תוכנית חדשה" } : {}),
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
  // Owner decision 2026-09-27: "מאשר" after a clear preview is enough (no repeated values). The safety is the binding
  // below (plan hash + Owner + client + expiry + one-time nonce) and the fresh re-read / stale check at execution.
  const verdict = classifyApprovalText(text, planValuesOf(plan));
  if (!verdict.ok) return verdict.code === "APPROVAL_WITH_CHANGES"
    ? refused("APPROVAL_WITH_CHANGES", "בוס, זה שינוי של התוכנית ולא אישור שלה — לא אישרתי כלום. אבנה תוכנית חדשה עם השינוי ואראה לך אותה")
    : refused("NOT_AN_APPROVAL", "לא זיהיתי אישור, בוס — לא אישרתי כלום");
  // never guess between open previews: a plan superseded by a NEWER open preview of this Owner + client is not approvable
  const newer = await newerOpenPreview(plan, c, d);
  if (newer === "UNKNOWN") return refused("AMBIGUITY_CHECK_FAILED", "לא הצלחתי לוודא שאין תצוגה פתוחה אחרת — לא אישרתי כלום");
  if (newer) return refused("AMBIGUOUS_OPEN_PREVIEWS", "בוס, יש תצוגה חדשה יותר שמחכה לאישור — לא אנחש לאיזו התכוונת. איזו לבצע? (אם את הקודמת — אכין לה תצוגה מחדש)", { newerPlanId: newer });
  const token = issueApprovalToken(d.approvalSecret, { planHash: hash, ownerId: c.ownerId, clientId: c.clientId, nowMs: d.nowMs() });
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
  const fresh = await Promise.all(plan.steps.map(async (s) => {
    const sp = PRIMITIVES_BY_ID.get(s.actionId)!;
    const id = s.entities[0].slice(s.entities[0].indexOf(":") + 1);
    try { return { entity: s.entities[0], now: id === "new" ? null : await sp.read(d.writers, id), readFailed: false }; } catch { return { entity: s.entities[0], now: null, readFailed: true }; }
  }));
  const s0 = plan.steps[0];
  const now: Fields | null = fresh[0].now;
  const next = nextStepFor(s0.actionId, now);
  const ok = out.status === "APPLIED_AS_EXPECTED" || out.status === "NO_CHANGE";
  const asState = (f: { entity: string; now: Fields | null; readFailed: boolean }) => (f.now ? { entity: f.entity, fields: Object.fromEntries(Object.entries(f.now).map(([k, v]) => [k, { value: v, trust: "RECORD" }])) } : f.readFailed ? { entity: f.entity, readFailed: true } : null);
  const partial = plan.steps.length > 1 && !ok ? {
    applied: out.steps.filter((x) => x.status === "APPLIED_AS_EXPECTED" || x.status === "NO_CHANGE").map((x) => x.index),
    failed: out.steps.filter((x) => x.status === "FAILED" || x.status === "CONFLICT" || x.status === "STALE").map((x) => x.index),
    notRun: out.steps.filter((x) => x.status === "NOT_RUN").map((x) => x.index),
    rollbackHe: "לא בוצע ביטול אוטומטי — מה שבוצע נשאר, ומה שלא רץ לא רץ. המצב החי מופיע ב-freshStates",
  } : null;
  return {
    status: out.status, planId: plan.planId, refusal: out.refusal, steps: out.steps,
    freshState: asState(fresh[0]),
    ...(plan.steps.length > 1 ? { freshStates: fresh.map(asState), partial } : {}),
    nextStep: next ? { ...next, epistemic: "DERIVED" } : null,
    messageHe: ok ? (out.status === "NO_CHANGE" ? "בוס, לא היה מה לשנות — המצב כבר כזה" : "בוצע בוס — בדקתי מחדש והשינוי קיים") : out.status === "STALE" ? "בוס, המצב השתנה מאז התצוגה, לא ביצעתי כלום. צריך תצוגה חדשה" : out.status === "PARTIALLY_APPLIED" ? `בוס, התהליך בוצע חלקית: שלבים ${partial?.applied.map((i) => i + 1).join(", ") || "—"} בוצעו, ${partial?.failed.map((i) => i + 1).join(", ") || "—"} נכשל, ${partial?.notRun.map((i) => i + 1).join(", ") || "—"} לא רצו. זה המצב החי עכשיו` : "בוס, הפעולה לא בוצעה — הנה מה שקרה",
  };
}
/** Every value the plan itself carries (arguments, after-values, key values) — only so a voluntary repeat is never read as a change. */
function planValuesOf(plan: Plan): string[] {
  const flat = (v: unknown): string[] => (v === null || v === undefined ? [] : Array.isArray(v) ? v.flatMap(flat) : typeof v === "object" ? Object.values(v as object).flatMap(flat) : [String(v)]);
  return [...requiredValuesOf(plan), ...plan.steps.flatMap((s) => [...flat(s.args), ...s.changes.flatMap((c) => flat(c.after))]), ...plan.steps.flatMap((s) => s.entities)];
}
/** The newest OTHER open (unexecuted, unexpired) plan of this Owner + client created after this one; "UNKNOWN" = could not check (fail closed). */
async function newerOpenPreview(plan: Plan, c: Caller, d: ActServiceDeps): Promise<string | null | "UNKNOWN"> {
  if (!d.stores.plans.history) return "UNKNOWN";
  try {
    const h = await d.stores.plans.history(c.ownerId, { limit: 50, before: null, since: null, actionId: null, entity: null }); // newest first — newer plans are at the top
    const now = d.nowMs();
    const open = h.items.find((x) => x.plan.planId !== plan.planId && x.plan.clientId === c.clientId && Date.parse(x.plan.createdAt) > Date.parse(plan.createdAt) && now <= Date.parse(x.plan.expiresAt) && x.executions.length === 0 && !x.eventTypes.some((t) => /APPROVED|EXECUT|VERIFIED|OUTCOME|STALE|REFUS|FAIL|EXPIRED/.test(t)));
    return open ? open.plan.planId : null;
  } catch { return "UNKNOWN"; }
}
/** The key values of the plan (money, recipients, targets) — shown in the preview; the Boss does NOT have to repeat them. */
function requiredValuesOf(plan: Plan): string[] {
  return plan.steps.flatMap((s) => {
    const spec = PRIMITIVES_BY_ID.get(s.actionId);
    const after = Object.fromEntries(s.changes.map((c) => [c.field, c.after])) as Fields;
    return spec?.requiredValues?.(s.args, after) ?? [];
  });
}
function nextStepFor(actionId: string, now: Fields | null) {
  if (!now) return null;
  const map: Record<string, [string, string]> = { CHANGE_RELEASE_STAGE: ["RELEASE_STAGE", "releaseStage"], UPDATE_MIX_VERSION_STATUS_OR_LABEL: ["MIX_VERSION_STATUS", "status"], RESOLVE_MIX_COMMENT: ["MIX_COMMENT_STATUS", "status"], REOPEN_MIX_COMMENT: ["MIX_COMMENT_STATUS", "status"], UPDATE_VICTOR_WORK_STATE: ["VICTOR_WORK_STATE", "workState"], UPDATE_VICTOR_OUTCOME: ["VICTOR_OUTCOME", "outcome"], UPDATE_LABEL_ARTIST_NOTES_STATUS: ["LABEL_ARTIST_STATUS", "status"] };
  const m = map[actionId];
  return m && typeof now[m[1]] === "string" ? nextStepsFor(m[0], String(now[m[1]])) : null;
}

// ── status ───────────────────────────────────────────────────────────────────────────────────────────────────────────
export async function planStatus(input: Record<string, unknown>, c: Caller, d: ActServiceDeps): Promise<ActResult> {
  const g = await guardCaller(c, d); if (g) return g;
  const v = validateActInput("partner_plan_status", input);
  if (!v.ok) return refused("INVALID_INPUT", "הבקשה לא תקינה", { code: v.code });
  if (input.history === true) return actionHistory(input, c, d);
  const plan = await loadOwnPlan(input.planId, c, d, "OWNER"); if (isResult(plan)) return plan;
  const [ex, ev] = await Promise.all([d.stores.plans.executions(plan.planId), d.stores.plans.events(plan.planId)]);
  const executed = ex.filter((x) => x.status !== "CLAIMED");
  return {
    status: executed.length ? (executed.every((x) => x.status === "APPLIED_AS_EXPECTED" || x.status === "NO_CHANGE") ? "EXECUTED" : "EXECUTED_WITH_ISSUES") : ex.length ? "IN_PROGRESS_OR_UNKNOWN" : d.nowMs() > Date.parse(plan.expiresAt) ? "EXPIRED" : "NOT_EXECUTED",
    planId: plan.planId, planHash: planHash(plan), steps: ex.map((x) => ({ index: x.stepIndex, actionId: x.actionId, status: x.status, outcome: x.outcome })), events: ev,
    detail: { intentHe: { text: plan.intentHe, trust: "OWNER_REQUEST" }, createdAt: plan.createdAt, expiresAt: plan.expiresAt, riskClass: plan.riskClass, approved: ev.some((e) => e.type === "APPROVED"), plannedSteps: plan.steps.map((s) => ({ index: s.index, actionId: s.actionId, entity: s.entities[0], changes: s.changes, dependsOn: s.dependsOn })) },
  };
}

// ── history: what Sunny did for the Boss (Owner-scoped, read-only, newest first, cursor pagination) ─────────────────
/** A plan's recorded lifecycle, derived only from what was stored (plan → events → executions). */
function lifecycleOf(p: Plan, executions: ReadonlyArray<{ stepIndex: number; status: string }>, eventTypes: readonly string[], nowMs: number) {
  const done = executions.filter((x) => x.status !== "CLAIMED");
  const outcome = done.length
    ? (done.length === p.steps.length && done.every((x) => x.status === "APPLIED_AS_EXPECTED" || x.status === "NO_CHANGE") ? "EXECUTED" : "EXECUTED_WITH_ISSUES")
    : executions.length ? "IN_PROGRESS_OR_UNKNOWN" : nowMs > Date.parse(p.expiresAt) ? "EXPIRED_NOT_EXECUTED" : "NOT_EXECUTED";
  const partial = done.some((x) => x.status === "APPLIED_AS_EXPECTED") && done.some((x) => x.status !== "APPLIED_AS_EXPECTED" && x.status !== "NO_CHANGE");
  return { outcome: outcome as (typeof HISTORY_OUTCOMES)[number], approved: eventTypes.includes("APPROVED"), stale: eventTypes.includes("STALE"), partial };
}
async function actionHistory(input: Record<string, unknown>, c: Caller, d: ActServiceDeps): Promise<ActResult> {
  const store = d.stores.plans;
  if (!store.history) return refused("UNAVAILABLE", "היסטוריית הפעולות לא זמינה כרגע");
  const limit = typeof input.limit === "number" ? input.limit : 10;
  const page = await store.history(c.ownerId, {
    limit, before: typeof input.before === "string" ? input.before : null, since: typeof input.since === "string" ? input.since : null,
    actionId: typeof input.actionId === "string" ? input.actionId : null, entity: typeof input.entity === "string" ? input.entity : null,
  });
  const nowMs = d.nowMs();
  let items = page.items.map((r) => {
    const lc = lifecycleOf(r.plan, r.executions, r.eventTypes, nowMs);
    return {
      planId: r.plan.planId, createdAt: r.plan.createdAt, executedAt: r.executedAt, intentHe: { text: r.plan.intentHe, trust: "OWNER_REQUEST" },
      compound: r.plan.steps.length > 1, approved: lc.approved, outcome: lc.outcome, partiallyApplied: lc.partial, staleSeen: lc.stale,
      steps: r.plan.steps.map((s) => ({ index: s.index, actionId: s.actionId, entity: s.entities[0], fields: s.changes.map((x) => x.field), outcome: r.executions.find((x) => x.stepIndex === s.index && x.status !== "CLAIMED")?.status ?? null })),
    };
  });
  if (typeof input.outcome === "string") items = items.filter((x) => x.outcome === input.outcome);
  return {
    status: "HISTORY", items, nextBefore: page.nextBefore, epistemic: "FACT",
    noteHe: "רק פעולות שעברו דרך סאני (תוכנית → אישור → ביצוע). שינויים שנעשו ישירות במסכים מופיעים ברשומות החיות, לא כאן. לפרטי תוכנית: planId",
  };
}
