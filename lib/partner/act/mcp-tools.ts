/**
 * SUNNY UNIVERSAL ACTION LAYER — the MCP action interfaces (Wave 0: defined, NOT registered in tools/list).
 *
 * Five narrow tools. None of them takes SQL, a table, a route, a URL, a file path, code or free-form field maps:
 *   partner_plan_action     intent + a registered action id + typed arguments → the SERVER builds the plan (MAIN).
 *   partner_preview_action  plan id → the server-side preview (Claude renders it; never invents it).
 *   partner_approve_action  relays the Boss's explicit approval text for a plan hash → one-time approval token.
 *   partner_execute_plan    plan id + approval token → engine (stale check, idempotency, verify, outcome).
 *   partner_plan_status     plan id → recorded status / outcome (a retry returns the recorded outcome).
 * The connector never holds a writer: every call is relayed to MAIN, which owns the registry, stores and executors.
 */
import { ACTION_REGISTRY } from "./registry";
import { inspectText } from "./persist";

export const ACT_TOOL_NAMES = ["partner_plan_action", "partner_preview_action", "partner_approve_action", "partner_execute_plan", "partner_plan_status"] as const;
export type ActToolName = (typeof ACT_TOOL_NAMES)[number];

const ID_RE = /^[A-Z][A-Z0-9_.]{2,80}$/;
const PLAN_RE = /^pl_[A-Za-z0-9_-]{16,64}$/;
const HASH_RE = /^[0-9a-f]{64}$/;
const TOKEN_RE = /^ak1\.[A-Za-z0-9_-]{20,1200}\.[A-Za-z0-9_-]{43}$/;
const MAX_TEXT = 500;
/** Keys that would turn a typed action into a generic writer — refused anywhere in the arguments. */
const FORBIDDEN_ARG_KEYS = /^(sql|query|table|from|route|url|path|endpoint|method|code|script|eval|file|filePath|fields|patch|body|headers|select|where)$/i;

export const ACT_TOOL_DEFINITIONS = [
  { name: "partner_plan_action", description: "Ask Redbloods to build a plan for ONE registered action. Returns a plan id; nothing changes.", inputSchema: { type: "object", additionalProperties: false, required: ["intentHe", "actionId", "args"], properties: { intentHe: { type: "string", maxLength: MAX_TEXT }, actionId: { type: "string", pattern: ID_RE.source }, args: { type: "object" } } } },
  { name: "partner_preview_action", description: "Get the server-side preview of a plan (exact changes, side effects, risk, what will NOT happen).", inputSchema: { type: "object", additionalProperties: false, required: ["planId"], properties: { planId: { type: "string", pattern: PLAN_RE.source } } } },
  { name: "partner_approve_action", description: "Relay the Boss's explicit approval of THIS preview (plan hash + the exact confirmation text).", inputSchema: { type: "object", additionalProperties: false, required: ["planId", "planHash", "confirmationText"], properties: { planId: { type: "string", pattern: PLAN_RE.source }, planHash: { type: "string", pattern: HASH_RE.source }, confirmationText: { type: "string", maxLength: MAX_TEXT } } } },
  { name: "partner_execute_plan", description: "Execute an approved plan. Refused if anything changed since the preview.", inputSchema: { type: "object", additionalProperties: false, required: ["planId", "approvalToken", "confirmationText"], properties: { planId: { type: "string", pattern: PLAN_RE.source }, approvalToken: { type: "string", pattern: TOKEN_RE.source }, confirmationText: { type: "string", maxLength: MAX_TEXT } } } },
  { name: "partner_plan_status", description: "The recorded status / outcome of a plan.", inputSchema: { type: "object", additionalProperties: false, required: ["planId"], properties: { planId: { type: "string", pattern: PLAN_RE.source } } } },
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
  const props = def.inputSchema.properties as Record<string, { pattern?: string; maxLength?: number; type: string }>;
  for (const k of Object.keys(input)) if (!(k in props)) return { ok: false, code: `UNKNOWN_FIELD:${k}` };
  for (const k of def.inputSchema.required) if (!(k in input)) return { ok: false, code: `MISSING_FIELD:${k}` };
  for (const [k, spec] of Object.entries(props)) {
    const v = input[k];
    if (v === undefined) continue;
    if (spec.type === "string" && (typeof v !== "string" || (spec.maxLength && v.length > spec.maxLength) || (spec.pattern && !new RegExp(spec.pattern).test(v)))) return { ok: false, code: `BAD_FIELD:${k}` };
    if (spec.type === "object" && (typeof v !== "object" || v === null || Array.isArray(v))) return { ok: false, code: `BAD_FIELD:${k}` };
  }
  if (name === "partner_plan_action") {
    const c = ACTION_REGISTRY.get(String(input.actionId));
    if (!c) return { ok: false, code: "UNKNOWN_ACTION" };
    if (c.availability === "SUNNY_INTENTIONALLY_EXCLUDED" || c.riskClass === "SECURITY_SENSITIVE") return { ok: false, code: "NOT_DELEGATED" };
    const e = scanArgs(input.args);
    if (e) return { ok: false, code: e };
    for (const k of Object.keys(input.args as object)) if (!c.args.some((a) => a.name === k)) return { ok: false, code: `UNKNOWN_ARGUMENT:${k}` };
    for (const [k, v] of Object.entries(input.args as Record<string, unknown>)) {
      if (v !== null && typeof v === "object") return { ok: false, code: `NESTED_ARGUMENT:${k}` };
      if (typeof v === "string" && inspectText(v, k).length) return { ok: false, code: `UNSAFE_ARGUMENT:${k}` };
    }
    if (inspectText(String(input.intentHe), "intentHe").length) return { ok: false, code: "UNSAFE_INTENT" };
  }
  return { ok: true };
}

/** Wave 0 gate: the act tools are never listed and every call is refused until the DDL is applied and the Boss enables it. */
export function actToolsAvailable(o: { actEnabled: boolean; scope: string }): boolean {
  return o.actEnabled === true && o.scope.split(" ").includes("partner:act");
}
