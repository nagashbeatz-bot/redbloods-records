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
 * A plan is ONE action or ONE compound business event (2–20 registered actions, one preview, one approval bound to the
 * exact whole plan hash; the engine re-reads every step before anything runs and reports partial failure truthfully).
 * Every operation re-checks: the caller is the Owner, the plan belongs to this Owner + connector client, the action is
 * registered and EXECUTABLE, and the executor comes ONLY from the registered action id.
 *
 * Reliability (2026-09-27):
 *   - duplicates: a money CREATE with a LIKELY_SAME live record, or two LIKELY_SAME create steps in one plan, is refused
 *     (POSSIBLE_DUPLICATE / POSSIBLE_DUPLICATE_IN_PLAN) with a server-issued duplicateAck; separateFromSimilar: true is
 *     honoured ONLY with a valid ack for the same Owner / client / action / arguments / current similar records.
 *     SIMILAR steps in one plan are allowed with a preview warning.
 *   - a plan executes at most once: approve / execute refuse a plan that already has executions rows (ALREADY_EXECUTED,
 *     or IN_PROGRESS while a young claim / a recent run is still going); a replay of the same token returns the record.
 *   - truthful status: EXECUTED only when EVERY plan step applied / needed no change; otherwise PARTIALLY_APPLIED /
 *     STALE / FAILED / IN_PROGRESS / OUTCOME_UNKNOWN (legacy plans: missing steps = NOT_RUN, a STALE event = STALE).
 *   - a CLAIMED row older than CLAIM_RECONCILE_AFTER_MS (a crashed / killed run) is reconciled READ-ONLY by the step's
 *     own verify against the planned after-values → APPLIED_AS_EXPECTED or FAILED ("outcome unknown → not applied");
 *     it is NEVER re-executed.
 */
import { STANDING_PHRASE, approvedByOf, mentionsStanding, standingEligible } from "./standing";
import { COVERAGE_MAP } from "./coverage-map";
import { randomBytes } from "node:crypto";
import type { ActionContract, Plan, PlanOutcome, PlanStep, StepOutcome } from "./types";
import { buildPreview, confirmationFor, executionKey, highestRisk, planHash, validatePlan } from "./plan";
import { issueApprovalToken, issueDuplicateAck, verifyDuplicateAck } from "./approval";
import { inPlanDuplicates, type InPlanDup } from "./primitives/duplicates";
import { albumPlanConflict } from "./primitives/worklog";
import { classifyApprovalText } from "./approval-text";
import { executePlan, type AuditStore, type IdempotencyStore, type PrimitiveExecutor } from "./engine";
import type { NonceStore } from "./approval";
import type { PlanStore } from "./store-supabase";
import { isSafeUrl, planSafeValue, toPersistablePlan, safeDetail } from "./persist";
import { chainFingerprint, chainOmit, chainView, currentOf, executorFor, fieldsFingerprint, PRIMITIVES_BY_ID, stepTargetId, type Fields, type WriterDeps } from "./primitives";
import { chainContexts, isChainedStep } from "./engine";
import { asApproved, malformedRefArgs, REF_TARGET_KEY_RE, refSentinelId, refString, refTargetKey, refsOf, resolveStepRefs, sentinelArgs } from "./refs";
import { newProjectMeta, REF_CREATED_KINDS, withPlannedRecords, type ResolvedTarget } from "./primitives";
import { HISTORY_OUTCOMES, MAX_WORKFLOW_STEPS, validateActInput } from "./mcp-tools";
import { nextStepsFor } from "./next-step";
import { verifyKindOf, weakestVerifyKind, type VerifyKind } from "./verify-kind";

export const PLAN_TTL_MS = 15 * 60_000;
/** A CLAIMED step older than this is treated as an interrupted run and reconciled read-only (never re-executed). A live
 *  run finishes far sooner (the connector relay gives up after ~45 s; MAIN keeps going and records the outcome). */
export const CLAIM_RECONCILE_AFTER_MS = 5 * 60_000;
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

/** The live before / after of a step, for the Boss (fresh read — never taken from storage). A chained step is shown on
 *  the projected state (the earlier steps' planned values), exactly as the engine will check it. */
async function liveView(step: PlanStep, d: ActServiceDeps, chain?: Awaited<ReturnType<typeof chainContexts>>) {
  const spec = PRIMITIVES_BY_ID.get(step.actionId)!;
  const id = step.entities[0].slice(step.entities[0].indexOf(":") + 1);
  if (refsOf(step.args).length || REF_TARGET_KEY_RE.test(step.entities[0])) {
    // a step with a `$stepK.created` reference: the created record does not exist yet — its change is the approved
    // preview (checked against the fresh state at its turn); a secondary reference keeps the live check of its own record
    const own = REF_TARGET_KEY_RE.test(step.entities[0]);
    const cur = own ? null : await currentOf(spec, d.writers, step);
    return { exists: own ? true : !!cur, stale: own ? false : fieldsFingerprint(step.actionId, id, cur) !== step.expectedFingerprint, changes: step.changes.map((c) => ({ field: c.field, before: c.before, after: c.after })) };
  }
  const raw = await currentOf(spec, d.writers, step);
  const c = chain?.ctx.get(step.index);
  const cur = raw && c ? chainView(raw, c.overlay) : raw;
  const planned = cur ? spec.plan(step.args, cur) : null;
  let fp: string;
  if (!c) fp = fieldsFingerprint(step.actionId, id, raw);
  else { const omit = raw && !chain!.broken.has(step.index) ? chainOmit(spec, raw, c.priorDerived) : null; fp = raw && omit ? chainFingerprint(step.actionId, id, cur!, omit) : "CHAIN_BROKEN"; }
  return {
    exists: !!raw, stale: fp !== step.expectedFingerprint,
    changes: planned && planned.ok ? Object.keys(planned.after).map((k) => ({ field: k, before: cur?.[k] ?? null, after: planned.after[k] })) : [],
  };
}

// ── plan ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
interface BuiltStep { step: PlanStep; contract: ActionContract; key: string; label: string; fields: Fields; after: Fields; requiredValues: string[]; warnings: string[]; disclosuresHe: readonly string[]; /** declared derived fields of this step's writer (chained steps only) */ derived: readonly string[]; /** plan-time stand-in id → the `$stepK.created` reference it means (shown to the Boss instead of the stand-in) */ refMap?: Readonly<Record<string, string>> }
/** How a step shares a record with EARLIER steps of the same plan (chained): their planned values + derived fields. */
interface ChainPlan { overlay: Fields; priorDerived: string[]; dependsOn: number[] }
type ChainFor = (key: string, spec: NonNullable<ReturnType<typeof PRIMITIVES_BY_ID.get>>, live: Fields, index: number) => ChainPlan | ActResult | undefined;
/** The in-plan duplicate context of one step: LIKELY_SAME / SIMILAR create steps earlier in the same plan. */
interface InPlan { likely: InPlanDup[]; similar: InPlanDup[] }
const NO_IN_PLAN: InPlan = { likely: [], similar: [] };
/**
 * The duplicate subject an ack is bound to: the live creation-context fingerprint (it covers the similar records the
 * reader found — a new one changes it) + the LIKELY_SAME steps of the same plan.
 */
const dupSubject = (fingerprint: string, inPlan: InPlan) => `${fingerprint}|plan:${inPlan.likely.map((x) => x.summary).join(" | ")}`;
/** One registered action → one server-built step (resolve → live read → exact change). Shared by single plans and workflows. */
async function buildStep(actionId: string, args: Record<string, unknown>, index: number, d: ActServiceDeps, c: Caller, inPlan: InPlan = NO_IN_PLAN, chainFor?: ChainFor, created?: ReadonlyMap<number, CreatedBy>): Promise<BuiltStep | ActResult> {
  const contract = executableContract(actionId, d);
  if (!contract) {
    const known = d.registry.get(actionId);
    const via = known ? COVERAGE_MAP[known.id] : undefined;
    if (known && via && known.availabilityDetail === "EXECUTABLE") return refused("USE_PRIMITIVES", `זו פעולה של המערכת שמתבצעת דרך הפעולות המוקלדות: ${via.by.join(", ")} — לתכנן אחת מהן`, { availability: known.availability, useActions: via.by });
    return refused("NOT_AVAILABLE", "סאני עוד לא יכולה לבצע את הפעולה הזאת", known ? { availability: known.availability, reasonEn: known.reason } : {});
  }
  const spec = PRIMITIVES_BY_ID.get(actionId)!;
  // `$stepK.created` (validated by refCheck): planned with a stand-in key whose record exists only in the plan's projection
  const refs = refsOf(args);
  const refMap: Record<string, string> = {};
  let planArgs: Record<string, unknown> = args;
  let writers = d.writers;
  let t: ResolvedTarget;
  if (refs.length) {
    const by = (k: number) => created!.get(k)!;
    planArgs = sentinelArgs(args, (k) => by(k).kind);
    const planned = new Map<string, NonNullable<ReturnType<typeof newProjectMeta>>>();
    for (const r of refs) {
      const cb = by(r.k);
      refMap[refSentinelId(r.k)] = refString(r.k);
      refMap[`${cb.kind}:${refSentinelId(r.k)}`] = refString(r.k);
      const m = cb.kind === "project" ? newProjectMeta(cb) : null;
      if (!m) return refused("INVALID_PLAN", "בוס, אני לא יכולה להציג במדויק את הרשומה שתיווצר — נבצע בשתי תוכניות", { codes: ["REF_KIND_NOT_SUPPORTED"], step: index });
      planned.set(refSentinelId(r.k), m);
    }
    writers = withPlannedRecords(d.writers, planned);
    const own = spec.refTarget ? refs.find((r) => r.arg === spec.refTarget!.arg) : undefined;
    if (own) {
      // the step's OWN record is created earlier in the plan: its "before" is what a fresh record of that kind shows
      const cb = by(own.k);
      const view = spec.refTarget!.view(cb);
      if (!view) return refused("INVALID_PLAN", "בוס, אני לא יכולה להציג במדויק את המצב של הרשומה החדשה — נבצע בשתי תוכניות", { codes: ["REF_TARGET_VIEW_UNKNOWN"], step: index });
      t = { key: refTargetKey(cb.kind, own.k), id: refSentinelId(own.k), label: createdLabel(cb, own.k), fields: view };
    } else {
      const r = await spec.resolve(writers, planArgs);
      if ("ok" in r && r.ok === false) return refused(r.code, r.messageHe);
      t = r as ResolvedTarget;
    }
  } else {
    const target = await spec.resolve(d.writers, args);
    if ("ok" in target && target.ok === false) return refused(target.code, target.messageHe);
    t = target as ResolvedTarget;
  }
  const ownRef = REF_TARGET_KEY_RE.test(t.key);
  // a step on a record that EARLIER steps of this plan change: planned on the PROJECTED state (never an estimate)
  const ch = chainFor ? chainFor(t.key, spec, t.fields, index) : undefined;
  if (ch && "status" in ch) return ch;
  let fields: Fields = t.fields;
  let fingerprint: string;
  if (ch) {
    fields = chainView(t.fields, ch.overlay);
    const omit = chainOmit(spec, t.fields, ch.priorDerived);
    if (!omit) return refused("SAME_ENTITY_CONFLICT", "בוס, שלב קודם בתוכנית עלול לשנות שדה שהשלב הזה נשען עליו (תופעת לוואי של הכותב) — אי אפשר להוכיח שהתצוגה תהיה מדויקת. נבצע אותם בשתי תוכניות נפרדות", { entity: t.key, step: index, fields: ch.priorDerived.filter((f) => f in t.fields) });
    fingerprint = chainFingerprint(actionId, t.id, fields, omit);
  } else fingerprint = fieldsFingerprint(actionId, t.id, t.fields);
  const subject = { ownerId: c.ownerId, clientId: c.clientId, actionId, args, similar: dupSubject(fingerprint, inPlan) };
  const ackFor = () => { const a = issueDuplicateAck(d.approvalSecret, subject, d.nowMs()); return { duplicateAck: a.duplicateAck, duplicateAckExpiresAt: a.expiresAt, replanWith: { separateFromSimilar: true, duplicateAck: a.duplicateAck }, ruleHe: "רק אם הבוס אמר במפורש שזו רשומה נוספת — לתכנן שוב עם אותם ערכים + separateFromSimilar: true + duplicateAck. אם זו אותה רשומה — לא לרשום" }; };
  const p = spec.plan(planArgs, fields);
  if (!p.ok) return p.code === "POSSIBLE_DUPLICATE" ? refused(p.code, p.messageHe, ackFor()) : refused(p.code, p.messageHe);
  if (args.separateFromSimilar === true) {
    // never usable blindly: only with the ack the server issued for THIS Owner / client / action / args / similar records
    const v = verifyDuplicateAck(d.approvalSecret, args.duplicateAck, subject, d.nowMs());
    if (!v.ok) return refused("DUPLICATE_ACK_REQUIRED", "בוס, 'רשומה נוספת' צריך להגיע מההחלטה שלך על רשומה דומה שהראיתי לך — והאישור הזה לא תקף (חסר / פג / לרשומות או לערכים אחרים, או שנוספה רשומה דומה חדשה). אתכנן בלי separateFromSimilar ואראה לך מה דומה", { reason: v.refusal });
  } else if (inPlan.likely.length) {
    const o = inPlan.likely[0];
    return refused("POSSIBLE_DUPLICATE_IN_PLAN", `בוס, שני שלבים בתוכנית נראים כמו אותה רשומה: שלב ${index + 1} ו${o.summary}. זו אותה רשומה (נשאיר שלב אחד) או שתי רשומות נפרדות?`, { steps: [o.other, index], ...ackFor() });
  }
  const step: PlanStep = {
    index, actionId, actionVersion: contract.version, args, entities: [t.key], phase: contract.phase,
    // a record created earlier in the plan does not exist yet: its step is checked at its turn against the preview itself
    expectedFingerprint: ownRef ? null : fingerprint,
    changes: Object.keys(p.after).map((k) => { const a = asApproved(p.after[k], refMap); return { field: k, before: planSafeValue(fields[k]), after: contract.args.some((x) => x.name === k && x.kind === "url") && isSafeUrl(a) ? String(a) : planSafeValue(a) }; }),
    dependsOn: [...new Set([...(ch ? ch.dependsOn : []), ...refs.map((r) => r.k)])].sort((a, b) => a - b),
  };
  const inPlanWarnings = [
    ...inPlan.similar.map((x) => `שני שלבים דומים בתוכנית: שלב ${index + 1} ו${x.summary} — ייבדקו כרשומות נפרדות`),
    ...(args.separateFromSimilar === true && inPlan.likely.length ? [`לפי ההחלטה שלך — שלב ${index + 1} נרשם בנפרד מ${inPlan.likely.map((x) => x.summary).join(", ")}`] : []),
  ];
  const chainNote = ch ? [`שלב ${index + 1} משנה את אותה רשומה אחרי שלב ${ch.dependsOn.map((i) => i + 1).join(", ")} — מה שמוצג כאן הוא המצב שיהיה אחרי השלבים הקודמים; הוא רץ רק אם הם בוצעו בדיוק כמתוכנן`] : [];
  // the Boss sees WHICH future record a reference means — never a bare placeholder
  const human = (v: string) => { let out = v; for (const r of refs) { const cb = created!.get(r.k)!; for (const s of [`${cb.kind}:${refSentinelId(r.k)}`, refSentinelId(r.k), refString(r.k)]) out = out.split(s).join(createdLabel(cb, r.k)); } return out; };
  const refNote = refs.map((r) => `${r.arg}: ${createdLabel(created!.get(r.k)!, r.k)} — המזהה ייקבע רק ביצירה; השלב הזה רץ רק אם שלב ${r.k + 1} יצר אותו בדיוק כמתוכנן (אחרת לא ירוץ, בלי ניחוש)`);
  return { step, contract, key: t.key, label: t.label, fields, after: p.after, requiredValues: (spec.requiredValues?.(planArgs, p.after) ?? []).map(human), warnings: [...(spec.warnings?.(fields, planArgs) ?? []).map(human), ...inPlanWarnings, ...chainNote, ...refNote], disclosuresHe: spec.disclosuresHe, derived: spec.chain ? [...spec.chain.derived(fields, planArgs)] : [], refMap };
}
/** The CREATE step a `$stepK.created` points at: its kind and planned values (from the built plan). */
interface CreatedBy { actionId: string; after: Fields; kind: string; name: string }
const KIND_HE: Record<string, string> = { project: "הפרויקט" };
const createdLabel = (cb: CreatedBy, k: number) => `${KIND_HE[cb.kind] ?? cb.kind} שייווצר בשלב ${k + 1}${cb.name ? `: "${cb.name}"` : ""}`;
/** Every `$stepK.created` rule a step's arguments must meet (planning) — any break is INVALID_PLAN, nothing is stored. */
function refCheck(actionId: string, args: Readonly<Record<string, unknown>>, index: number, built: readonly BuiltStep[], d: ActServiceDeps): ActResult | null {
  const bad = (code: string, arg: string) => refused("INVALID_PLAN", "בוס, ההפניה לרשומה שנוצרת בתוכנית לא תקינה — לא שמרתי כלום", { codes: [code], step: index, arg });
  const m = malformedRefArgs(args);
  if (m.length) return bad("REF_SYNTAX", m[0]);
  const refs = refsOf(args);
  if (!refs.length) return null;
  const spec = PRIMITIVES_BY_ID.get(actionId);
  const contract = d.registry.get(actionId);
  for (const r of refs) {
    if (r.k === index) return bad("REF_SELF", r.arg);
    if (r.k > index || !built[r.k]) return bad("REF_FORWARD", r.arg);
    if (!built[r.k].key.endsWith(":new")) return bad("REF_NOT_A_CREATE", r.arg);
    if (contract?.args.find((a) => a.name === r.arg)?.kind !== "entityKey") return bad("REF_NOT_ENTITY_KEY", r.arg);
    const accepted = spec?.refArgs?.[r.arg] ?? (spec?.refTarget?.arg === r.arg ? spec.refTarget.kinds : undefined);
    if (!accepted) return bad("REF_ARG_NOT_SUPPORTED", r.arg);
    const kind = built[r.k].key.slice(0, built[r.k].key.indexOf(":"));
    if (!accepted.includes(kind)) return bad("REF_KIND_MISMATCH", r.arg);
    if (!(REF_CREATED_KINDS as readonly string[]).includes(kind)) return bad("REF_KIND_NOT_SUPPORTED", r.arg);
  }
  return null;
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
  const changesOf = (b: BuiltStep) => Object.keys(b.after).map((k) => ({ field: k, before: { value: b.fields[k] ?? null, trust: "RECORD" }, after: { value: asApproved(b.after[k], b.refMap ?? {}), trust: "RECORD" } }));
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
  // a single action has no earlier step to reference
  const single = (input.args ?? {}) as Record<string, unknown>;
  if (refsOf(single).length || malformedRefArgs(single).length) return refused("INVALID_PLAN", "בוס, הפניה לרשומה שנוצרת קיימת רק בתוכנית של כמה שלבים — לא שמרתי כלום", { codes: [refsOf(single).length ? "REF_WITHOUT_WORKFLOW" : "REF_SYNTAX"] });
  const b = await buildStep(String(input.actionId), input.args as Record<string, unknown>, 0, d, c);
  if (!isBuilt(b)) return b;
  return persistAndPreview(String(input.intentHe), [b], c, d);
}

/**
 * A compound workflow: several registered actions in ONE plan → one server-side preview → ONE approval of the whole
 * plan (every step's exact values) → the engine runs them in order (stale check on every step first; a failure stops
 * every later step; communication never runs after a failure; the outcome says exactly which steps applied).
 * Every step targets an entity that already exists, is a create, or is a record an EARLIER create step makes via exactly
 * `$step<k>.created` (refCheck + lib/partner/act/refs: planned on the projected record, resolved at execution only from
 * that step's recorded createdKey).
 */
async function planWorkflow(input: { intentHe: unknown; steps: unknown[] }, c: Caller, d: ActServiceDeps): Promise<ActResult> {
  const steps = input.steps;
  if (steps.length < 2 || steps.length > MAX_WORKFLOW_STEPS) return refused("INVALID_INPUT", `תהליך הוא 2–${MAX_WORKFLOW_STEPS} שלבים`, { code: "WORKFLOW_SIZE" });
  const built: BuiltStep[] = [];
  // duplicates INSIDE the plan (same context + amount, near date; LIKELY_SAME → held for the Boss, SIMILAR → a warning)
  const dups = inPlanDuplicates(steps.map((s) => { const x = s as { actionId: unknown; args: unknown }; return { actionId: String(x.actionId), args: (x.args ?? {}) as Record<string, unknown> }; }));
  // Several steps on ONE record (2026-09-29): allowed only when BOTH primitives opted in (spec.chain) and it is provably
  // exact — the same read view (the later step is planned on the earlier steps' planned values), or different views with
  // no overlapping field; an earlier writer's declared side effect on a field this step reads must be tolerated by it.
  // Anything else stays refused: SAME_ENTITY_TWICE (not chainable) / SAME_ENTITY_CONFLICT (not provably exact).
  const chainFor: ChainFor = (key, spec, live, index) => {
    if (key.endsWith(":new")) return undefined;
    const prior = built.filter((b) => b.key === key);
    if (!prior.length) return undefined;
    // two steps on a record the plan itself creates: not chained yet (its state is only a projection) — separate plans
    if (REF_TARGET_KEY_RE.test(key)) return refused("SAME_ENTITY_TWICE", "בוס, שני שלבים משנים את הרשומה שנוצרת בתוכנית עצמה — כרגע רק שלב אחד יכול לעדכן אותה באותה תוכנית. את השאר נעשה בתוכנית נוספת אחרי היצירה", { entity: key });
    if (!spec.chain || prior.some((b) => !PRIMITIVES_BY_ID.get(b.step.actionId)?.chain)) return refused("SAME_ENTITY_TWICE", "שני שלבים באותו תהליך משנים את אותה רשומה, ואחת הפעולות לא מוגדרת לשרשור בטוח — כל שלב חייב לראות את המצב שהוצג לך. נבצע ברצף בשתי תוכניות", { entity: key });
    let overlay: Fields = {};
    const priorDerived: string[] = [];
    for (const b of prior) {
      const bs = PRIMITIVES_BY_ID.get(b.step.actionId)!;
      if (bs.read !== spec.read) {
        const clash = Object.keys(b.after).filter((k) => k in live);
        if (clash.length) return refused("SAME_ENTITY_CONFLICT", "בוס, שני השלבים קוראים את הרשומה דרך תצוגות שונות ששתיהן כוללות את אותו שדה — אי אפשר להוכיח שהתצוגה של השלב השני מדויקת. נבצע אותם בשתי תוכניות נפרדות", { entity: key, steps: [b.step.index, index], fields: clash });
      }
      overlay = { ...overlay, ...b.after };
      priorDerived.push(...b.derived);
    }
    return { overlay, priorDerived, dependsOn: prior.map((b) => b.step.index) };
  };
  // records created by earlier steps (a `$stepK.created` target): their kind + planned values, for the projection
  const created = new Map<number, CreatedBy>();
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i] as { actionId: unknown; args: unknown };
    const rc = refCheck(String(s.actionId), s.args as Record<string, unknown>, i, built, d);
    if (rc) return { ...rc, step: i, actionId: String(s.actionId) };
    const mine = dups.filter((x) => x.step === i);
    const b = await buildStep(String(s.actionId), s.args as Record<string, unknown>, i, d, c, { likely: mine.filter((x) => x.level === "LIKELY_SAME"), similar: mine.filter((x) => x.level === "SIMILAR") }, chainFor, created);
    if (!isBuilt(b)) return { ...b, step: i, actionId: String(s.actionId) };
    built.push(b);
    if (b.key.endsWith(":new")) created.set(i, { actionId: b.step.actionId, after: b.after, kind: b.key.slice(0, b.key.indexOf(":")), name: String(b.after.name ?? b.label ?? "") });
  }
  // album rules inside ONE plan: a track number twice / adding + moving tracks of the same album → refused before storage
  const album = albumPlanConflict(built.map((b) => ({ actionId: b.step.actionId, args: b.step.args, fields: b.fields })));
  if (album) return refused(album.code, album.messageHe);
  return persistAndPreview(String(input.intentHe), built, c, d);
}

// ── preview ──────────────────────────────────────────────────────────────────────────────────────────────────────────
export async function previewAction(input: { planId: unknown }, c: Caller, d: ActServiceDeps): Promise<ActResult> {
  const g = await guardCaller(c, d); if (g) return g;
  const plan = await loadOwnPlan(input.planId, c, d); if (isResult(plan)) return plan;
  const chain = await chainContexts(plan, new Map(plan.steps.filter((s) => PRIMITIVES_BY_ID.has(s.actionId)).map((s) => [s.actionId, executorFor(PRIMITIVES_BY_ID.get(s.actionId)!, d.writers)])));
  const lives = await Promise.all(plan.steps.map((s) => liveView(s, d, chain)));
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
  // a plan executes at most once — never a second approval for a plan that already ran (or is running)
  const ran = await executedState(plan, d);
  if (ran) return ran;
  if (d.nowMs() > Date.parse(plan.expiresAt)) return refused("EXPIRED", "התוכנית פגה — צריך תצוגה חדשה");
  const text = typeof input.confirmationText === "string" ? input.confirmationText.trim() : "";
  if (!text || text.length > 500) return refused("APPROVAL_MISSING", "צריך את האישור המפורש שלך, בוס");
  // STANDING authorization (Owner decision 2026-09-30): the exact phrase approves ONLY a plan made solely of Owner-inbox
  // housekeeping; anything else that mentions it is never an approval (the Boss's own words are needed)
  const standing = text === STANDING_PHRASE;
  if (mentionsStanding(text) && !(standing && standingEligible(plan))) return refused("NOT_AN_APPROVAL", "הרשאה קבועה חלה רק על סימון עדכונים שכתבת לסאני כטופלים — כל פעולה אחרת (וכל תוכנית מעורבת) צריכה את האישור שלך, בוס. לא אישרתי כלום");
  // Owner decision 2026-09-27: "מאשר" after a clear preview is enough (no repeated values). The safety is the binding
  // below (plan hash + Owner + client + expiry + one-time nonce) and the fresh re-read / stale check at execution.
  const verdict = standing ? { ok: true as const } : classifyApprovalText(text, planValuesOf(plan));
  if (!verdict.ok) return verdict.code === "APPROVAL_WITH_CHANGES"
    ? refused("APPROVAL_WITH_CHANGES", "בוס, זה שינוי של התוכנית ולא אישור שלה — לא אישרתי כלום. אבנה תוכנית חדשה עם השינוי ואראה לך אותה")
    : refused("NOT_AN_APPROVAL", "לא זיהיתי אישור, בוס — לא אישרתי כלום");
  // never guess between open previews: a plan superseded by a NEWER open preview of this Owner + client is not approvable
  const newer = await newerOpenPreview(plan, c, d);
  if (newer === "UNKNOWN") return refused("AMBIGUITY_CHECK_FAILED", "לא הצלחתי לוודא שאין תצוגה פתוחה אחרת — לא אישרתי כלום");
  if (newer) return refused("AMBIGUOUS_OPEN_PREVIEWS", "בוס, יש תצוגה חדשה יותר שמחכה לאישור — לא אנחש לאיזו התכוונת. איזו לבצע? (אם את הקודמת — אכין לה תצוגה מחדש)", { newerPlanId: newer });
  const token = issueApprovalToken(d.approvalSecret, { planHash: hash, ownerId: c.ownerId, clientId: c.clientId, nowMs: d.nowMs(), standing });
  // the token and the confirmation text are returned to the caller only — never stored
  return { status: "APPROVED_PENDING_EXECUTION", planId: plan.planId, planHash: hash, approvalToken: token, approvedBy: standing ? "STANDING_AUTHORIZATION" : "OWNER_APPROVAL", noteHe: "האישור תקף לתוכנית הזאת בלבד, פעם אחת, ל-10 דקות" };
}

// ── execute ──────────────────────────────────────────────────────────────────────────────────────────────────────────
export async function executeAction(input: { planId: unknown; approvalToken: unknown; confirmationText: unknown }, c: Caller, d: ActServiceDeps): Promise<ActResult> {
  const g = await guardCaller(c, d); if (g) return g;
  const plan = await loadOwnPlan(input.planId, c, d); if (isResult(plan)) return plan;
  for (const s of plan.steps) if (!executableContract(s.actionId, d)) return refused("NOT_AVAILABLE", "הפעולה כבר לא זמינה");
  const executors = new Map<string, PrimitiveExecutor>(plan.steps.map((s) => [s.actionId, executorFor(PRIMITIVES_BY_ID.get(s.actionId)!, d.writers)]));
  // still running (a young claim / a run that is between steps) → never a second execution
  let before: ExRow[];
  try { before = await reconciledRows(plan, d); } catch { return refused("OUTCOME_UNKNOWN", "לא הצלחתי לקרוא את מצב הביצוע — לא ביצעתי כלום. אבדוק את סטטוס התוכנית"); }
  const pre = aggregateOf(plan, before, [], d.nowMs());
  if (pre.outcome === "IN_PROGRESS") return refused("IN_PROGRESS", "בוס, הביצוע של התוכנית הזאת עדיין רץ — לא מריץ שוב. אבדוק את הסטטוס עוד רגע", { planId: plan.planId, planStatus: pre.outcome, steps: pre.steps });
  let out: PlanOutcome;
  try {
    out = await executePlan(plan, { token: String(input.approvalToken ?? ""), ownerId: c.ownerId, clientId: c.clientId, confirmationText: String(input.confirmationText ?? "") }, {
      nowMs: d.nowMs(), secret: d.approvalSecret, registry: d.registry, executors, nonces: d.stores.nonces, idem: d.stores.idem, audit: d.stores.audit, knownSecrets: d.knownSecrets,
    });
  } catch (e) {
    // a persistence / store failure mid-flow: the claim protects against a second run; never claim success
    return refused("OUTCOME_UNKNOWN", "לא הצלחתי לתעד את הביצוע עד הסוף — אבדוק את המצב לפני שאגיד משהו", { detail: safeDetail((e as Error).message, d.knownSecrets).slice(0, 200) });
  }
  // already executed: a fresh token is refused; a replay whose record is incomplete reports the recorded state
  if (out.refusal === "ALREADY_EXECUTED" || out.refusal === "TOKEN_REPLAYED") {
    let rows: ExRow[] = before;
    try { rows = await d.stores.plans.executions(plan.planId); } catch { /* the pre-read rows stand */ }
    if (rows.length) {
      const agg = aggregateOf(plan, rows, [], d.nowMs());
      return agg.outcome === "IN_PROGRESS"
        ? refused("IN_PROGRESS", "בוס, הביצוע של התוכנית הזאת עדיין רץ — לא מריץ שוב. אבדוק את הסטטוס עוד רגע", { planId: plan.planId, planStatus: agg.outcome, steps: agg.steps })
        : refused("ALREADY_EXECUTED", agg.outcome === "OUTCOME_UNKNOWN" ? UNKNOWN_RAN_HE : "בוס, התוכנית הזאת כבר בוצעה — היא לא רצה פעמיים. זה מה שנרשם", { planId: plan.planId, planStatus: agg.outcome, steps: agg.steps, ...(agg.outcome === "OUTCOME_UNKNOWN" ? { outcomeUnknown: true } : {}) });
    }
  }
  if (out.steps.some((x) => x.status === "CONFLICT")) {
    return refused("IN_PROGRESS", "בוס, ביצוע אחר של התוכנית הזאת כבר רץ — לא הרצתי אותה שוב. אבדוק את הסטטוס", { planId: plan.planId, steps: out.steps });
  }
  // fresh read + the derived next step (a PROPOSAL only — never executed); a created record is read by its new key
  const fresh = await Promise.all(plan.steps.map(async (s, i) => {
    const sp = PRIMITIVES_BY_ID.get(s.actionId)!;
    // a step whose target was created earlier in the run is read by the key that step recorded
    const key = out.steps[i]?.createdKey ?? resolveStepRefs(s, (k) => out.steps[k]?.createdKey)?.step.entities[0] ?? s.entities[0];
    const id = key.slice(key.indexOf(":") + 1);
    try { return { entity: key, now: id === "new" || REF_TARGET_KEY_RE.test(key) ? null : await sp.read(d.writers, id), readFailed: false }; } catch { return { entity: key, now: null, readFailed: true }; }
  }));
  const s0 = plan.steps[0];
  const now: Fields | null = fresh[0].now;
  const next = nextStepFor(s0.actionId, now);
  const ok = out.status === "APPLIED_AS_EXPECTED" || out.status === "NO_CHANGE";
  // Claim contract (2026-10-05): what each step's verification actually proves decides what may be said about it.
  const kindOf = (s: PlanStep): VerifyKind => verifyKindOf(s.actionId, PRIMITIVES_BY_ID.get(s.actionId)?.kinds ?? []);
  const appliedKinds = plan.steps.filter((s, i) => out.steps[i]?.status === "APPLIED_AS_EXPECTED").map(kindOf);
  const weakest = appliedKinds.length ? weakestVerifyKind(appliedKinds) : null;
  const verification = { kind: weakest, steps: plan.steps.map((s, i) => ({ index: s.index, actionId: s.actionId, status: out.steps[i]?.status ?? "NOT_RUN", verifyKind: kindOf(s) })) };
  const canonicalEffect = out.status === "APPLIED_AS_EXPECTED" ? (weakest ?? "FRESH_READ") : out.status === "NO_CHANGE" ? "NONE" : out.status === "PARTIALLY_APPLIED" ? "PARTIAL" : "FAILED";
  // A RECEIPT step's read view cannot show its effect (a push / email / sync): never present that view as a record of the result.
  const asState = (f: { entity: string; now: Fields | null; readFailed: boolean }, i: number) => (plan.steps[i] && kindOf(plan.steps[i]) === "RECEIPT"
    ? { entity: f.entity, receiptOnly: true, noteHe: "לפעולה הזאת אין קריאה טרייה של התוצאה — האישור הוא של המערכת שביצעה אותה (קבלה), לא בדיקה מחדש" }
    : f.now ? { entity: f.entity, fields: Object.fromEntries(Object.entries(f.now).map(([k, v]) => [k, { value: v, trust: "RECORD" }])) } : f.readFailed ? { entity: f.entity, readFailed: true } : null);
  const appliedHe = weakest === "RECEIPT"
    ? "בוצע בוס — המערכת שביצעה את זה אישרה (קבלה). את התוצאה עצמה לא קראתי שוב"
    : weakest === "PARTIAL"
      ? "בוצע בוס — בדקתי מחדש את הרשומה הראשית והיא קיימת; שדות / השפעות נוספות (יומן, כספים, קישורים) לא נבדקו מחדש"
      : "בוצע בוס — בדקתי מחדש והשינוי קיים";
  const partial = plan.steps.length > 1 && !ok ? {
    applied: out.steps.filter((x) => x.status === "APPLIED_AS_EXPECTED" || x.status === "NO_CHANGE").map((x) => x.index),
    failed: out.steps.filter((x) => x.status === "FAILED" || x.status === "CONFLICT" || x.status === "STALE").map((x) => x.index),
    notRun: out.steps.filter((x) => x.status === "NOT_RUN").map((x) => x.index),
    rollbackHe: "לא בוצע ביטול אוטומטי — מה שבוצע נשאר, ומה שלא רץ לא רץ. המצב החי מופיע ב-freshStates",
  } : null;
  return {
    status: out.status, planId: plan.planId, refusal: out.refusal, steps: out.steps,
    ...(out.steps.some((x) => x.createdKey) ? { created: out.steps.filter((x) => x.createdKey).map((x) => ({ index: x.index, createdKey: x.createdKey })) } : {}),
    freshState: asState(fresh[0], 0),
    ...(plan.steps.length > 1 ? { freshStates: fresh.map((f, i) => asState(f, i)), partial } : {}),
    canonicalEffect, verification,
    nextStep: next ? { ...next, epistemic: "DERIVED" } : null,
    messageHe: ok ? (out.status === "NO_CHANGE" ? "בוס, לא היה מה לשנות — המצב כבר כזה" : appliedHe) : out.status === "STALE" ? "בוס, המצב השתנה מאז התצוגה, לא ביצעתי כלום. צריך תצוגה חדשה" : out.status === "PARTIALLY_APPLIED" ? `בוס, התהליך בוצע חלקית: שלבים ${partial?.applied.map((i) => i + 1).join(", ") || "—"} בוצעו, ${partial?.failed.map((i) => i + 1).join(", ") || "—"} נכשל, ${partial?.notRun.map((i) => i + 1).join(", ") || "—"} לא רצו. זה המצב החי עכשיו` : "בוס, הפעולה לא בוצעה — הנה מה שקרה",
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
    const open = h.items.find((x) => x.plan.planId !== plan.planId && !standingEligible(x.plan) && x.plan.clientId === c.clientId && Date.parse(x.plan.createdAt) > Date.parse(plan.createdAt) && now <= Date.parse(x.plan.expiresAt) && x.executions.length === 0 && !x.eventTypes.some((t) => /APPROVED|EXECUT|VERIFIED|OUTCOME|STALE|REFUS|FAIL|EXPIRED/.test(t)));
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

// ── execution state: truthful aggregate, stuck-claim reconciliation (read-only verify), at-most-once ─────────────────
type ExRow = { stepIndex: number; actionId: string; status: string; outcome?: StepOutcome | null };
type HistoryOutcome = (typeof HISTORY_OUTCOMES)[number];
const APPLIED = new Set(["APPLIED_AS_EXPECTED", "NO_CHANGE"]);
/**
 * P0-2 (2026-10-05): an interrupted RECEIPT step (push / email / sync / file) MAY have run — its effect cannot be read back.
 * Stored as a FAILED row (the executions status vocabulary is unchanged) whose detail carries this marker; every reader
 * presents it as OUTCOME_UNKNOWN — never FAILED ("not sent") and never applied ("sent"). Rows written before the marker
 * carry the older "it may have happened" wording and are read the same way.
 */
export const MAY_HAVE_RUN = "OUTCOME_UNKNOWN(MAY_HAVE_RUN):";
export function mayHaveRun(r: { status: string; outcome?: { detail?: string } | null }): boolean {
  const det = String(r.outcome?.detail ?? "");
  return r.status === "FAILED" && (det.startsWith(MAY_HAVE_RUN) || (det.startsWith("OUTCOME_UNKNOWN") && /it may have happened/.test(det)));
}
const STOPS = new Set(["FAILED", "STALE", "CONFLICT", "NOT_RUN"]);
const atOf = (r: ExRow) => { const t = Date.parse(String((r.outcome as { at?: unknown } | null | undefined)?.at ?? "")); return Number.isFinite(t) ? t : null; };
/**
 * A plan's truthful execution state, derived only from what was stored (plan steps → executions rows → events).
 * EXECUTED only when EVERY plan step applied / needed no change. A step without a row after the run = NOT_RUN (derived)
 * — unless the run is still going (a young claim, or rows written within CLAIM_RECONCILE_AFTER_MS with no stop) →
 * IN_PROGRESS. An old claim = OUTCOME_UNKNOWN until reconciled. Legacy plans (before per-step rows): a STALE event with
 * no rows = STALE.
 */
function aggregateOf(p: Plan, rows: readonly ExRow[], eventTypes: readonly string[], nowMs: number) {
  const byIdx = new Map(rows.map((r) => [r.stepIndex, r]));
  const times = rows.map(atOf).filter((x): x is number => x !== null);
  const recent = times.length > 0 && nowMs - Math.max(...times) < CLAIM_RECONCILE_AFTER_MS;
  const claimed = rows.filter((r) => r.status === "CLAIMED");
  const missing = p.steps.filter((s) => !byIdx.has(s.index));
  const running = claimed.some((r) => { const t = atOf(r); return t !== null && nowMs - t < CLAIM_RECONCILE_AFTER_MS; }) || (!claimed.length && rows.length > 0 && missing.length > 0 && !rows.some((r) => STOPS.has(r.status)) && recent);
  const legacyStale = !rows.length && eventTypes.includes("STALE");
  const began = rows.length > 0 || legacyStale;
  const steps = began ? p.steps.map((s) => {
    const r = byIdx.get(s.index);
    if (r) return { index: s.index, actionId: s.actionId, status: mayHaveRun(r) ? "OUTCOME_UNKNOWN" : r.status, outcome: r.status === "CLAIMED" ? null : r.outcome ?? null, ...(r.outcome?.createdKey ? { createdKey: r.outcome.createdKey } : {}) };
    return { index: s.index, actionId: s.actionId, status: running ? "PENDING" : "NOT_RUN", outcome: null, derived: true };
  }) : [];
  let outcome: HistoryOutcome;
  if (!began) outcome = nowMs > Date.parse(p.expiresAt) ? "EXPIRED_NOT_EXECUTED" : "NOT_EXECUTED";
  else if (running) outcome = "IN_PROGRESS";
  else if (claimed.length || rows.some(mayHaveRun)) outcome = "OUTCOME_UNKNOWN";
  else {
    const applied = steps.filter((s) => APPLIED.has(s.status)).length;
    outcome = applied === p.steps.length ? "EXECUTED" : applied > 0 ? "PARTIALLY_APPLIED" : legacyStale || steps.some((s) => s.status === "STALE") ? "STALE" : "FAILED";
  }
  return { outcome, steps, began };
}
const PLACEHOLDER = /^\[טקסט · \d+ תווים\]$/;
const UNKNOWN_RAN_HE = "בוס, התוכנית הזאת כבר הורצה ולא תרוץ שוב — אבל התוצאה של שלב בה לא אומתה: ייתכן שבוצע וייתכן שלא. לא אומר שבוצע ולא שנכשל — צריך לבדוק במקור לפני שחוזרים על זה";
/**
 * An interrupted step (CLAIMED, never recorded): READ-ONLY verification against the planned after-values — never a
 * second execution. Live = preview state → not applied; live = planned result (the step's own verify) → applied;
 * otherwise / a create (no id to read) / a command → FAILED "outcome unknown", treated as not applied.
 */
async function verifyInterrupted(plan: Plan, s0: PlanStep, d: ActServiceDeps, createdOf: (k: number) => string | undefined = () => undefined): Promise<StepOutcome> {
  const at = new Date(d.nowMs()).toISOString();
  const out = (status: StepOutcome["status"], detail: string): StepOutcome => ({ index: s0.index, actionId: s0.actionId, status, detail, replayed: false, at });
  const spec = PRIMITIVES_BY_ID.get(s0.actionId);
  if (!spec) return out("FAILED", "OUTCOME_UNKNOWN: the execution was interrupted and the action is no longer registered — treated as not applied (never re-executed)");
  // `$stepK.created`: resolved ONLY from the createdKey step K recorded in this plan's execution
  const res = resolveStepRefs(s0, createdOf);
  if (!res) return out("FAILED", "OUTCOME_UNKNOWN: the execution was interrupted and the record an earlier step created is not known — treated as not applied (never re-executed)");
  const s = res.step;
  if (stepTargetId(s) === "new") return out("FAILED", "OUTCOME_UNKNOWN: the execution was interrupted; a created record cannot be verified without its id — check the live records before planning it again (never re-executed)");
  // A RECEIPT step (push / email / sync / file move) cannot be re-verified from records: it MAY have run — never "not applied".
  if (verifyKindOf(spec.actionId, spec.kinds) === "RECEIPT") return out("FAILED", `${MAY_HAVE_RUN} the execution was interrupted; this step's effect (a push / email / sync / file) cannot be checked from the records — it may have happened. Check before repeating it (never re-executed)`);
  try {
    const ex = executorFor(spec, d.writers);
    if (s !== s0) {
      // the approved change is compared on the record as it is now (the created id shown as the reference)
      const now = await spec.read(d.writers, stepTargetId(s), s.args);
      const cmp = s0.changes.filter((c) => !(typeof c.after === "string" && PLACEHOLDER.test(c.after)));
      if (!cmp.length) return out("FAILED", "OUTCOME_UNKNOWN: the execution was interrupted and the planned result cannot be compared — treated as not applied (never re-executed)");
      const applied = !!now && cmp.every((c) => { const v = asApproved(now[c.field], res.map); return v === c.after || planSafeValue(v) === c.after; });
      return applied ? out("APPLIED_AS_EXPECTED", "verified by a fresh read after an interrupted execution (never re-executed)") : out("FAILED", "OUTCOME_UNKNOWN: the execution was interrupted; the approved change is not in place → treated as not applied (never re-executed)");
    }
    // a chained step's previewed state is a PROJECTION (earlier steps applied) — only its own planned result is compared
    if (!isChainedStep(plan, s) && s.expectedFingerprint !== null && (await ex.fingerprint(s)) === s.expectedFingerprint) return out("FAILED", "the execution was interrupted; the live state is still exactly the previewed state → not applied (never re-executed)");
    const after = Object.fromEntries(s.changes.filter((c) => !(typeof c.after === "string" && PLACEHOLDER.test(c.after))).map((c) => [c.field, c.after]));
    if (!Object.keys(after).length) return out("FAILED", "OUTCOME_UNKNOWN: the execution was interrupted and the planned result cannot be compared — treated as not applied (never re-executed)");
    return (await ex.verify(s, { after }))
      ? out("APPLIED_AS_EXPECTED", "verified by a fresh read after an interrupted execution (never re-executed)")
      : out("FAILED", "OUTCOME_UNKNOWN: the execution was interrupted; the live state matches neither the preview nor the planned result → treated as not applied (never re-executed)");
  } catch {
    return out("FAILED", "OUTCOME_UNKNOWN: the execution was interrupted and the fresh read failed — treated as not applied (never re-executed)");
  }
}
/** The plan's executions rows, after reconciling claims older than CLAIM_RECONCILE_AFTER_MS (read-only verify → record). */
async function reconciledRows(plan: Plan, d: ActServiceDeps): Promise<ExRow[]> {
  const rows: ExRow[] = await d.stores.plans.executions(plan.planId);
  const now = d.nowMs();
  const stuck = rows.filter((r) => r.status === "CLAIMED" && (() => { const t = atOf(r); return t === null || now - t >= CLAIM_RECONCILE_AFTER_MS; })());
  if (!stuck.length) return rows;
  const hash = planHash(plan);
  let changed = false;
  for (const r of stuck) {
    const s = plan.steps[r.stepIndex];
    if (!s) continue;
    const o = await verifyInterrupted(plan, s, d, (k) => { const x = rows.find((y) => y.stepIndex === k); return x?.status === "APPLIED_AS_EXPECTED" ? x.outcome?.createdKey : undefined; });
    try {
      await d.stores.idem.record(executionKey(hash, s), o); // CLAIMED → terminal, the claimed row only
      changed = true;
      await d.stores.audit.append({ planId: plan.planId, planHash: hash, type: o.status === "APPLIED_AS_EXPECTED" ? "VERIFIED" : "STEP_FAILED", step: s.index, detail: safeDetail(`reconciled after an interrupted execution: ${o.detail}`, d.knownSecrets).slice(0, 300), ownerId: plan.ownerId, clientId: plan.clientId });
    } catch { /* the original run recorded it meanwhile — the re-read below shows its outcome */ }
  }
  if (!changed) return d.stores.plans.executions(plan.planId);
  // the interrupted run never reached the later steps: each gets its one NOT_RUN row
  const after = await d.stores.plans.executions(plan.planId);
  const have = new Set(after.map((x) => x.stepIndex));
  const at = new Date(now).toISOString();
  for (const s of plan.steps) if (!have.has(s.index)) {
    try { await d.stores.idem.settle(executionKey(hash, s), { planId: plan.planId, stepIndex: s.index, actionId: s.actionId, actionVersion: s.actionVersion, atMs: now }, { index: s.index, actionId: s.actionId, status: "NOT_RUN", detail: "not run — the execution was interrupted before this step", replayed: false, at }); } catch { /* shown as derived NOT_RUN */ }
  }
  return d.stores.plans.executions(plan.planId);
}
/** A plan that already ran (or is running) → the refusal for approve; null = never executed. */
async function executedState(plan: Plan, d: ActServiceDeps): Promise<ActResult | null> {
  let rows: ExRow[];
  try { rows = await reconciledRows(plan, d); } catch { return refused("OUTCOME_UNKNOWN", "לא הצלחתי לקרוא את מצב הביצוע — לא אישרתי כלום"); }
  if (!rows.length) return null;
  const agg = aggregateOf(plan, rows, [], d.nowMs());
  return agg.outcome === "IN_PROGRESS"
    ? refused("IN_PROGRESS", "בוס, התוכנית הזאת כבר בביצוע — לא מאשר אותה שוב. אבדוק את הסטטוס", { planId: plan.planId, planStatus: agg.outcome, steps: agg.steps })
    : refused("ALREADY_EXECUTED", agg.outcome === "EXECUTED" ? "בוס, התוכנית הזאת כבר בוצעה — היא לא רצה פעמיים. לשינוי נוסף צריך תוכנית חדשה" : agg.outcome === "OUTCOME_UNKNOWN" ? UNKNOWN_RAN_HE : "בוס, התוכנית הזאת כבר הורצה (היא לא רצה פעמיים) — זה מה שנרשם. למה שלא בוצע צריך תוכנית חדשה", { planId: plan.planId, planStatus: agg.outcome, steps: agg.steps, ...(agg.outcome === "OUTCOME_UNKNOWN" ? { outcomeUnknown: true } : {}) });
}

// ── status ───────────────────────────────────────────────────────────────────────────────────────────────────────────
export async function planStatus(input: Record<string, unknown>, c: Caller, d: ActServiceDeps): Promise<ActResult> {
  const g = await guardCaller(c, d); if (g) return g;
  const v = validateActInput("partner_plan_status", input);
  if (!v.ok) return refused("INVALID_INPUT", "הבקשה לא תקינה", { code: v.code });
  if (input.history === true) return actionHistory(input, c, d);
  const plan = await loadOwnPlan(input.planId, c, d, "OWNER"); if (isResult(plan)) return plan;
  const [ex, ev] = await Promise.all([reconciledRows(plan, d), d.stores.plans.events(plan.planId)]);
  const agg = aggregateOf(plan, ex, ev.map((e) => e.type), d.nowMs());
  return {
    status: agg.outcome === "EXPIRED_NOT_EXECUTED" ? "EXPIRED" : agg.outcome,
    planId: plan.planId, planHash: planHash(plan), steps: agg.steps, events: ev,
    ...(agg.outcome === "IN_PROGRESS" ? { messageHe: "הביצוע עדיין רץ — לבדוק שוב עוד רגע; לא להריץ שוב" } : agg.outcome === "OUTCOME_UNKNOWN" ? { messageHe: "תוצאת שלב לא ידועה — ייתכן שבוצע וייתכן שלא; לא לדווח כבוצע ולא כנכשל, ולא להריץ שוב", outcomeUnknown: true } : {}),
    detail: { intentHe: { text: plan.intentHe, trust: "OWNER_REQUEST" }, createdAt: plan.createdAt, expiresAt: plan.expiresAt, riskClass: plan.riskClass, approved: ev.some((e) => e.type === "APPROVED"), approvedBy: approvedByOf(ev.find((e) => e.type === "APPROVED")?.detail), plannedSteps: plan.steps.map((s) => ({ index: s.index, actionId: s.actionId, entity: s.entities[0], changes: s.changes, dependsOn: s.dependsOn })) },
  };
}

// ── history: what Sunny did for the Boss (Owner-scoped, read-only, newest first, cursor pagination) ─────────────────
/** A plan's recorded lifecycle, derived only from what was stored (plan → events → executions). Read-only (no reconcile). */
function lifecycleOf(p: Plan, executions: readonly ExRow[], eventTypes: readonly string[], nowMs: number) {
  const agg = aggregateOf(p, executions, eventTypes, nowMs);
  return { outcome: agg.outcome, steps: agg.steps, approved: eventTypes.includes("APPROVED"), stale: eventTypes.includes("STALE"), partial: agg.outcome === "PARTIALLY_APPLIED" };
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
    const lc = lifecycleOf(r.plan, r.executions.map((x) => ({ actionId: "", outcome: null, ...x })), r.eventTypes, nowMs);
    return {
      planId: r.plan.planId, createdAt: r.plan.createdAt, executedAt: r.executedAt, intentHe: { text: r.plan.intentHe, trust: "OWNER_REQUEST" },
      compound: r.plan.steps.length > 1, approved: lc.approved, approvedBy: lc.approved ? approvedByOf(r.approvalDetail ?? "") : null, outcome: lc.outcome, partiallyApplied: lc.partial, staleSeen: lc.stale,
      steps: r.plan.steps.map((s) => ({ index: s.index, actionId: s.actionId, entity: s.entities[0], fields: s.changes.map((x) => x.field), outcome: lc.steps.find((x) => x.index === s.index)?.status ?? null })),
    };
  });
  if (typeof input.outcome === "string") items = items.filter((x) => x.outcome === input.outcome);
  return {
    status: "HISTORY", items, nextBefore: page.nextBefore, epistemic: "FACT",
    noteHe: "רק פעולות שעברו דרך סאני (תוכנית → אישור → ביצוע). שינויים שנעשו ישירות במסכים מופיעים ברשומות החיות, לא כאן. לפרטי תוכנית: planId",
  };
}
