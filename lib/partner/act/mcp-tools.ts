/**
 * SUNNY UNIVERSAL ACTION LAYER — the MCP action interfaces (Wave 0: defined, NOT registered in tools/list).
 *
 * Five narrow tools. None of them takes SQL, a table, a route, a URL, a file path, code or free-form field maps:
 *   partner_plan_action     intent + a registered action id + typed arguments → the SERVER builds the plan (MAIN);
 *                           or intent + steps[] (2–20 registered actions) → ONE compound plan, one preview, one approval.
 *   partner_preview_action  plan id → the server-side preview (Claude renders it; never invents it).
 *   partner_approve_action  relays the Boss's explicit approval text for a plan hash → one-time approval token.
 *   partner_execute_plan    plan id + approval token → engine (stale check, idempotency, verify, outcome).
 *   partner_plan_status     plan id → recorded status / outcome / detail (a retry returns the recorded outcome);
 *                           or history: true (+ filters, cursor) → the Boss's own action history, newest first.
 * The connector never holds a writer: every call is relayed to MAIN, which owns the registry, stores and executors.
 */
import { ACTION_REGISTRY } from "./registry";
import { DUP_ACK_ARG_NAME, inspectText, isDuplicateAckValue, urlProblem } from "./persist";
import { LOOKS_LIKE_REF_RE } from "./refs";

export const ACT_TOOL_NAMES = ["partner_plan_action", "partner_preview_action", "partner_approve_action", "partner_execute_plan", "partner_plan_status"] as const;
export type ActToolName = (typeof ACT_TOOL_NAMES)[number];

const ID_RE = /^[A-Z][A-Z0-9_.]{2,80}$/;
const PLAN_RE = /^pl_[A-Za-z0-9_-]{16,64}$/;
const HASH_RE = /^[0-9a-f]{64}$/;
const TOKEN_RE = /^ak1\.[A-Za-z0-9_-]{20,1200}\.[A-Za-z0-9_-]{43}$/;
const MAX_TEXT = 500;
const ISO_RE = /^\d{4}-\d{2}-\d{2}(T[0-9:.]{2,15}(Z|[+-]\d{2}:\d{2})?)?$/;
const ENTITY_RE = /^[a-z][a-z0-9-]{1,40}:[A-Za-z0-9._-]{1,80}$/;
/** One logical request = ONE plan (e.g. 11 tracks of one album): up to 20 steps, one preview, one approval, one execute. */
export const MAX_WORKFLOW_STEPS = 20;
/** A plan's truthful aggregate: EXECUTED only when EVERY plan step applied (or needed no change). */
export const HISTORY_OUTCOMES = ["EXECUTED", "PARTIALLY_APPLIED", "STALE", "FAILED", "IN_PROGRESS", "OUTCOME_UNKNOWN", "NOT_EXECUTED", "EXPIRED_NOT_EXECUTED"] as const;
/** Keys that would turn a typed action into a generic writer — refused anywhere in the arguments. */
const FORBIDDEN_ARG_KEYS = /^(sql|query|table|from|route|url|path|endpoint|method|code|script|eval|file|filePath|fields|patch|body|headers|select|where)$/i;

export const ACT_TOOL_DEFINITIONS = [
  { name: "partner_plan_action", description: "Ask Redbloods to build a plan: ONE registered action (actionId + args), or ONE business event made of 2–20 registered actions (steps: [{ actionId, args }], run in that order; every step's target must already exist or be a create). Several steps may change the SAME record only where Redbloods can prove the preview exact (e.g. mix work price + deadline, price → mark paid, agreed price + finance exception): each later step is previewed on the state after the earlier ones and runs only if they applied exactly; otherwise SAME_ENTITY_TWICE / SAME_ENTITY_CONFLICT = plan them as separate plans. A record an EARLIER create step of the same plan makes is referenced as exactly $step<k>.created (k = that step's 0-based index) — e.g. CREATE_PROJECT then MOVE_TRANSACTION { transaction, toProject: '$step0.created' }, or the new project's clip / finance settings { project: '$step0.created' }; never invent an id, never any other $-form (INVALID_PLAN). Returns the server-built preview of the WHOLE plan; nothing changes. POSSIBLE_DUPLICATE / POSSIBLE_DUPLICATE_IN_PLAN = a similar record exists (or two steps look like the same record): show it to the Boss and ask; ONLY if he explicitly says it is a separate record, plan again with the same args + separateFromSimilar: true + the duplicateAck from that refusal (never invent or reuse an ack).", inputSchema: { type: "object", additionalProperties: false, required: ["intentHe"], properties: { intentHe: { type: "string", maxLength: MAX_TEXT }, actionId: { type: "string", pattern: ID_RE.source }, args: { type: "object" }, steps: { type: "array", minItems: 2, maxItems: MAX_WORKFLOW_STEPS, items: { type: "object", additionalProperties: false, required: ["actionId", "args"], properties: { actionId: { type: "string", pattern: ID_RE.source }, args: { type: "object" } } } } } } },
  { name: "partner_preview_action", description: "Get the server-side preview of a plan (exact changes, side effects, risk, what will NOT happen).", inputSchema: { type: "object", additionalProperties: false, required: ["planId"], properties: { planId: { type: "string", pattern: PLAN_RE.source } } } },
  { name: "partner_approve_action", description: "Relay the Boss's explicit approval of THIS preview (plan hash + his words, e.g. \"מאשר\" — he never repeats values). Words that change the plan are refused (APPROVAL_WITH_CHANGES → build a new plan). The ONE exception: a plan made ONLY of Owner-inbox memory steps (LINK_INBOX_ENTITY, RECORD_INBOX_INTERPRETATION, RETRACT_INBOX_LINK, RETRACT_INBOX_INTERPRETATION, MARK_OWNER_INBOX_ITEM) may be approved with the exact text STANDING:OWNER_INBOX_MEMORY (the Boss's standing authorization) — refused for any other or mixed plan; recorded as STANDING_AUTHORIZATION, never as his approval.", inputSchema: { type: "object", additionalProperties: false, required: ["planId", "planHash", "confirmationText"], properties: { planId: { type: "string", pattern: PLAN_RE.source }, planHash: { type: "string", pattern: HASH_RE.source }, confirmationText: { type: "string", maxLength: MAX_TEXT } } } },
  { name: "partner_execute_plan", description: "Execute an approved plan. Refused if anything changed since the preview. A plan executes at most once (ALREADY_EXECUTED / IN_PROGRESS otherwise). OUTCOME_UNKNOWN (e.g. a timeout) → call partner_plan_status before saying anything; never execute it again. Claim only what canonicalEffect / verification.steps[].verifyKind prove: FRESH_READ = re-read and in place (full claim); PARTIAL = the main record was re-read, other fields / side effects were not; RECEIPT = the writer's receipt only (a push / email / sync) — never \"בדקתי מחדש\" for it.", inputSchema: { type: "object", additionalProperties: false, required: ["planId", "approvalToken", "confirmationText"], properties: { planId: { type: "string", pattern: PLAN_RE.source }, approvalToken: { type: "string", pattern: TOKEN_RE.source }, confirmationText: { type: "string", maxLength: MAX_TEXT } } } },
  { name: "partner_plan_status", description: "Read-only. With planId: that plan's detail (intent, steps, entities, before → after, approval / execution state, per-step outcome incl. createdKey of a created record; status EXECUTED only if every step applied, else PARTIALLY_APPLIED / STALE / FAILED; IN_PROGRESS = still running — check again, never re-execute). With history: true: the Boss's action history through Sunny, newest first — filters since / before (ISO), actionId, entity (key), outcome; limit (≤ 50); page with nextBefore.", inputSchema: { type: "object", additionalProperties: false, required: [], properties: { planId: { type: "string", pattern: PLAN_RE.source }, history: { type: "boolean" }, limit: { type: "integer", minimum: 1, maximum: 50 }, before: { type: "string", pattern: ISO_RE.source }, since: { type: "string", pattern: ISO_RE.source }, actionId: { type: "string", pattern: ID_RE.source }, entity: { type: "string", pattern: ENTITY_RE.source }, outcome: { type: "string", enum: HISTORY_OUTCOMES } } } },
] as const;

export type ActInputCheck = { ok: true } | { ok: false; code: string };
function scanArgs(v: unknown, depth = 0): string | null {
  if (depth > 3) return "ARGS_TOO_DEEP";
  if (v === null || typeof v !== "object") return typeof v === "string" && v.length > MAX_TEXT ? "ARG_TOO_LONG" : null;
  if (Array.isArray(v)) { if (v.length > 50) return "ARGS_TOO_MANY"; for (const x of v) { const e = scanArgs(x, depth + 1); if (e) return e; } return null; }
  for (const [k, x] of Object.entries(v)) { if (FORBIDDEN_ARG_KEYS.test(k)) return `FORBIDDEN_ARG:${k}`; const e = scanArgs(x, depth + 1); if (e) return e; }
  return null;
}
/** Strict input validation for the act tools (pure). Unknown tool / extra keys / unregistered action → refused. */
export function validateActInput(name: string, input: Record<string, unknown>): ActInputCheck {
  const def = ACT_TOOL_DEFINITIONS.find((d) => d.name === name);
  if (!def) return { ok: false, code: "UNKNOWN_TOOL" };
  const props = def.inputSchema.properties as Record<string, { pattern?: string; maxLength?: number; type: string; enum?: readonly string[]; minimum?: number; maximum?: number }>;
  for (const k of Object.keys(input)) if (!(k in props)) return { ok: false, code: `UNKNOWN_FIELD:${k}` };
  for (const k of def.inputSchema.required) if (!(k in input)) return { ok: false, code: `MISSING_FIELD:${k}` };
  for (const [k, spec] of Object.entries(props)) {
    const v = input[k];
    if (v === undefined) continue;
    if (spec.type === "string" && (typeof v !== "string" || (spec.maxLength && v.length > spec.maxLength) || (spec.pattern && !new RegExp(spec.pattern).test(v)))) return { ok: false, code: `BAD_FIELD:${k}` };
    if (spec.type === "object" && (typeof v !== "object" || v === null || Array.isArray(v))) return { ok: false, code: `BAD_FIELD:${k}` };
    if (spec.type === "boolean" && typeof v !== "boolean") return { ok: false, code: `BAD_FIELD:${k}` };
    if (spec.type === "integer" && (typeof v !== "number" || !Number.isInteger(v) || (spec.minimum !== undefined && v < spec.minimum) || (spec.maximum !== undefined && v > spec.maximum))) return { ok: false, code: `BAD_FIELD:${k}` };
    if (spec.enum && !spec.enum.includes(v as string)) return { ok: false, code: `BAD_FIELD:${k}` };
    if (spec.type === "array" && (!Array.isArray(v) || v.length < 2 || v.length > MAX_WORKFLOW_STEPS)) return { ok: false, code: `BAD_FIELD:${k}` };
  }
  if (name === "partner_plan_action") {
    const single = input.actionId !== undefined || input.args !== undefined;
    const many = input.steps !== undefined;
    if (single === many) return { ok: false, code: "ACTION_OR_STEPS" };
    if (single && (input.actionId === undefined || input.args === undefined)) return { ok: false, code: "MISSING_FIELD:args" };
    const steps = many ? (input.steps as unknown[]) : [{ actionId: input.actionId, args: input.args }];
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      if (!s || typeof s !== "object" || Array.isArray(s)) return { ok: false, code: `BAD_STEP:${i}` };
      const o = s as Record<string, unknown>;
      if (Object.keys(o).some((k) => k !== "actionId" && k !== "args") || typeof o.actionId !== "string" || !ID_RE.test(o.actionId) || !o.args || typeof o.args !== "object" || Array.isArray(o.args)) return { ok: false, code: `BAD_STEP:${i}` };
      const e = checkActionArgs(o.actionId, o.args as Record<string, unknown>);
      if (e) return { ok: false, code: many ? `STEP_${i}:${e}` : e };
    }
    if (inspectText(String(input.intentHe), "intentHe").length) return { ok: false, code: "UNSAFE_INTENT" };
  }
  if (name === "partner_plan_status") {
    const hist = input.history === true;
    if ((input.planId !== undefined) === hist) return { ok: false, code: "PLAN_OR_HISTORY" };
    if (!hist && Object.keys(input).some((k) => k !== "planId")) return { ok: false, code: "FILTERS_NEED_HISTORY" };
  }
  return { ok: true };
}
/** One registered action + its typed arguments (single plans and every step of a compound plan). null = acceptable. */
function checkActionArgs(actionId: string, args: Record<string, unknown>): string | null {
  const c = ACTION_REGISTRY.get(actionId);
  if (!c) return "UNKNOWN_ACTION";
  if (c.availability === "SUNNY_INTENTIONALLY_EXCLUDED" || c.riskClass === "SECURITY_SENSITIVE") return "NOT_DELEGATED";
  const e = scanArgs(args);
  if (e) return e;
  for (const k of Object.keys(args)) if (!c.args.some((a) => a.name === k)) return `UNKNOWN_ARGUMENT:${k}`;
  for (const [k, v] of Object.entries(args)) {
    if (v !== null && typeof v === "object") return `NESTED_ARGUMENT:${k}`;
    // a `$stepK.created`-looking value is judged by the planner (exact form, argument kind, earlier CREATE) → INVALID_PLAN
    if (typeof v === "string" && LOOKS_LIKE_REF_RE.test(v)) continue;
    if (c.args.find((a) => a.name === k)?.kind === "url") { const e = urlProblem(v); if (e) return `${e}:${k}`; continue; }
    if (k === DUP_ACK_ARG_NAME) { if (!isDuplicateAckValue(v)) return `BAD_DUPLICATE_ACK:${k}`; continue; }
    if (typeof v === "string" && inspectText(v, k).length) return `UNSAFE_ARGUMENT:${k}`;
  }
  return null;
}

/** Wave 0 gate: the act tools are never listed and every call is refused until the DDL is applied and the Boss enables it. */
export function actToolsAvailable(o: { actEnabled: boolean; scope: string }): boolean {
  return o.actEnabled === true && o.scope.split(" ").includes("partner:act");
}
