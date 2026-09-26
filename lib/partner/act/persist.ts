/**
 * SUNNY UNIVERSAL ACTION LAYER — the PLAN PERSISTENCE CONTRACT (pure). What may ever be stored in the plan JSON
 * (partner_action_plans.plan) and in plan-event details.
 *
 * ALLOWLIST, rebuilt — never copied: `toPersistablePlan` constructs a NEW object from the allowed fields only. Every
 * value is validated against the registered contract's typed arguments. Anything that is not allowed, or that looks
 * like a credential / secret / path / URL / route, REJECTS the whole plan. Nothing is silently dropped or redacted:
 * a plan that is not persistable is never persisted and never executed. The engine refuses such a plan before approval.
 *
 * Allowed in plan JSON:
 *   planId, ownerId, clientId, intentHe (short business text), createdAt, expiresAt, riskClass, confirmation, effects[],
 *   steps[]: index, actionId, actionVersion, phase, dependsOn[], expectedFingerprint (64-hex or null),
 *            entities[] (canonical entity keys "kind:id" only — never a storage path),
 *            args{} (ONLY the contract's declared, typed arguments),
 *            changes[] {field = a declared argument name, before / after = scalar business values}.
 * Never allowed: passwords, cookies, OAuth / access / refresh tokens, service keys, API / webhook / encryption secrets,
 *   Authorization headers, connector or Dropbox / Google credentials, approval tokens, raw file-system / storage paths,
 *   request bodies, headers, SQL / code / route / URL payloads, nested objects of any kind.
 * Stored business text is DATA: nothing in Redbloods ever interprets a stored plan field as an instruction.
 */
import type { ActionContract, ArgSpec, Plan, PlanStep } from "./types";
import { EFFECT_KEYS, RISK_ORDER } from "./types";

export const MAX_TEXT_CHARS = 500;
export const MAX_INTENT_CHARS = 300;
export const MAX_STEPS = 20;
export const MAX_ENTITIES_PER_STEP = 10;
export const MAX_PLAN_LIFETIME_MS = 60 * 60_000;

const PLAN_ID_RE = /^pl_[A-Za-z0-9_-]{16,64}$/;
const PRINCIPAL_RE = /^[A-Za-z0-9_.:-]{1,80}$/;
const ACTION_ID_RE = /^[A-Z][A-Z0-9_.]{2,80}$/;
const HEX64_RE = /^[0-9a-f]{64}$/;
/** A canonical entity key: "kind:id". Never a path, URL or free text. */
export const ENTITY_KEY_RE = /^[a-z][a-z_]{1,30}:[A-Za-z0-9._-]{1,100}$/;
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
/** Argument names that would turn a typed action into a generic writer — never valid, in any contract. */
export const FORBIDDEN_ARG_NAME_RE = /^(sql|query|table|from|route|url|uri|href|path|filepath|file_path|storagepath|dropboxpath|endpoint|method|code|script|eval|fields|patch|body|headers?|cookies?|select|where|token|secret|password|passwd|apikey|api_key|authorization|credentials?)$/i;

/** Credential / secret shapes. A match anywhere in a persisted string rejects the plan. */
export const SECRET_PATTERNS: ReadonlyArray<{ id: string; re: RegExp }> = [
  { id: "JWT", re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\./ },
  { id: "STRIPE_LIKE_KEY", re: /\b(sk|pk|rk)_(live|test)_[A-Za-z0-9]{8,}/ },
  { id: "SUPABASE_KEY", re: /\bsb_(secret|publishable)_[A-Za-z0-9_-]{8,}/ },
  { id: "GOOGLE_ACCESS_TOKEN", re: /\bya29\.[A-Za-z0-9_-]{10,}/ },
  { id: "GOOGLE_REFRESH_TOKEN", re: /\b1\/\/[A-Za-z0-9_-]{20,}/ },
  { id: "GOOGLE_API_KEY", re: /\bAIza[0-9A-Za-z_-]{30,}/ },
  { id: "DROPBOX_TOKEN", re: /\bsl\.[A-Za-z0-9_-]{20,}/ },
  { id: "GITHUB_TOKEN", re: /\bgh[pousr]_[A-Za-z0-9]{20,}/ },
  { id: "SLACK_TOKEN", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}/ },
  { id: "AWS_KEY", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { id: "PARTNER_TOKEN", re: /\b(ak1|pk1|rbt|rbr)\.[A-Za-z0-9_-]{16,}/ },
  { id: "PRIVATE_KEY", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { id: "AUTH_HEADER", re: /\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]{12,}/i },
  { id: "SECRET_ASSIGNMENT", re: /\b(authorization|cookie|set-cookie|password|passwd|pwd|secret|api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|service[_-]?role|private[_-]?key)\s*[:=]/i },
  { id: "OPAQUE_BLOB", re: /[A-Za-z0-9+/_-]{40,}={0,2}/ },
];
/** Storage / file-system paths, URLs and internal routes are never business values in a plan. */
export const LOCATION_PATTERNS: ReadonlyArray<{ id: string; re: RegExp }> = [
  { id: "ABSOLUTE_PATH", re: /(^|\s)(\/[^\s/]+){2,}/ },
  { id: "WINDOWS_PATH", re: /\b[A-Za-z]:[\\/]/ },
  { id: "UNC_PATH", re: /\\\\[^\s\\]+\\/ },
  { id: "PARENT_TRAVERSAL", re: /\.\.[\\/]/ },
  { id: "HOME_PATH", re: /(^|\s)~\// },
  { id: "URL_SCHEME", re: /\b(https?|ftp|file|data|javascript|vbscript|blob|ws|wss):/i },
  { id: "INTERNAL_ROUTE", re: /\/api\// },
];
const CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

export type PersistProblem = { code: string; where: string };

/** Rejects secrets, locations and control characters in one string. `knownSecrets` = the server's own secret values. */
export function inspectText(s: string, where: string, knownSecrets: readonly string[] = []): PersistProblem[] {
  const out: PersistProblem[] = [];
  if (CONTROL_RE.test(s)) out.push({ code: "CONTROL_CHARACTER", where });
  for (const p of SECRET_PATTERNS) if (p.re.test(s)) out.push({ code: `SECRET_LIKE:${p.id}`, where });
  for (const p of LOCATION_PATTERNS) if (p.re.test(s)) out.push({ code: `LOCATION_LIKE:${p.id}`, where });
  for (const k of knownSecrets) if (k.length >= 12 && s.includes(k)) out.push({ code: "KNOWN_SERVER_SECRET", where });
  return out;
}
/** The server's own secret values (env names that look like secrets), so an exact leak is always caught. */
export function knownSecretValues(env: Record<string, string | undefined>): string[] {
  return Object.entries(env).filter(([k, v]) => /SECRET|KEY|TOKEN|PASSWORD|PRIVATE|CREDENTIAL/i.test(k) && typeof v === "string" && v.length >= 16).map(([, v]) => v as string);
}

function checkScalar(v: unknown, where: string, known: readonly string[], maxLen = MAX_TEXT_CHARS): PersistProblem[] {
  if (v === null || typeof v === "boolean") return [];
  if (typeof v === "number") return Number.isFinite(v) ? [] : [{ code: "NON_FINITE_NUMBER", where }];
  if (typeof v === "string") return v.length > maxLen ? [{ code: "TEXT_TOO_LONG", where }] : inspectText(v, where, known);
  return [{ code: "NOT_A_SCALAR", where }];
}
function checkArg(spec: ArgSpec, v: unknown, where: string, known: readonly string[]): PersistProblem[] {
  switch (spec.kind) {
    case "entityKey": return typeof v === "string" && ENTITY_KEY_RE.test(v) ? inspectText(v, where, known) : [{ code: "BAD_ENTITY_KEY", where }];
    case "ymd": return typeof v === "string" && YMD_RE.test(v) ? [] : [{ code: "BAD_DATE", where }];
    case "time": return typeof v === "string" && TIME_RE.test(v) ? [] : [{ code: "BAD_TIME", where }];
    case "number": return typeof v === "number" && Number.isFinite(v) ? [] : [{ code: "BAD_NUMBER", where }];
    case "money": return typeof v === "number" && Number.isFinite(v) && v >= 0 && Math.round(v * 100) === v * 100 ? [] : [{ code: "BAD_MONEY", where }];
    case "boolean": return typeof v === "boolean" ? [] : [{ code: "BAD_BOOLEAN", where }];
    case "enum": return typeof v === "string" && (spec.values ?? []).includes(v) ? [] : [{ code: "BAD_ENUM", where }];
    case "text": return typeof v === "string" ? checkScalar(v, where, known) : [{ code: "BAD_TEXT", where }];
    default: return [{ code: "UNKNOWN_ARG_KIND", where }];
  }
}

const ALLOWED_PLAN_KEYS = ["planId", "ownerId", "clientId", "intentHe", "steps", "riskClass", "confirmation", "effects", "createdAt", "expiresAt"] as const;
const ALLOWED_STEP_KEYS = ["index", "actionId", "actionVersion", "args", "entities", "phase", "expectedFingerprint", "changes", "dependsOn"] as const;
const ALLOWED_CHANGE_KEYS = ["field", "before", "after"] as const;
const extraKeys = (o: object, allowed: readonly string[]) => Object.keys(o).filter((k) => !allowed.includes(k));

/**
 * Build the ONLY object that may be persisted for a plan. ok:false → the plan must be neither persisted nor executed.
 * The result is rebuilt from allowlisted fields; a plan with ANY extra field is rejected (not trimmed), so what was
 * hashed and approved is exactly what is stored.
 */
export function toPersistablePlan(plan: Plan, registry: ReadonlyMap<string, ActionContract>, o: { knownSecrets?: readonly string[] } = {}): { ok: true; json: Plan } | { ok: false; problems: PersistProblem[] } {
  const known = o.knownSecrets ?? [];
  const p: PersistProblem[] = [];
  if (!plan || typeof plan !== "object") return { ok: false, problems: [{ code: "NOT_AN_OBJECT", where: "plan" }] };
  for (const k of extraKeys(plan, ALLOWED_PLAN_KEYS)) p.push({ code: "FIELD_NOT_ALLOWED", where: `plan.${k}` });
  if (!PLAN_ID_RE.test(String(plan.planId))) p.push({ code: "BAD_PLAN_ID", where: "planId" });
  if (!PRINCIPAL_RE.test(String(plan.ownerId))) p.push({ code: "BAD_OWNER_ID", where: "ownerId" });
  if (!PRINCIPAL_RE.test(String(plan.clientId))) p.push({ code: "BAD_CLIENT_ID", where: "clientId" });
  if (typeof plan.intentHe !== "string") p.push({ code: "BAD_INTENT", where: "intentHe" }); else p.push(...checkScalar(plan.intentHe, "intentHe", known, MAX_INTENT_CHARS));
  if (!RISK_ORDER.includes(plan.riskClass) || plan.riskClass === "SECURITY_SENSITIVE") p.push({ code: "BAD_RISK", where: "riskClass" });
  if (!["C1_APPROVAL", "C2_APPROVAL_WITH_VALUES", "C3_STRONG_APPROVAL"].includes(plan.confirmation)) p.push({ code: "BAD_CONFIRMATION", where: "confirmation" });
  if (!Array.isArray(plan.effects) || plan.effects.some((e) => !EFFECT_KEYS.includes(e))) p.push({ code: "BAD_EFFECTS", where: "effects" });
  if (!ISO_RE.test(String(plan.createdAt)) || !ISO_RE.test(String(plan.expiresAt))) p.push({ code: "BAD_TIMESTAMP", where: "createdAt/expiresAt" });
  else { const life = Date.parse(plan.expiresAt) - Date.parse(plan.createdAt); if (!(life > 0 && life <= MAX_PLAN_LIFETIME_MS)) p.push({ code: "BAD_LIFETIME", where: "expiresAt" }); }
  if (!Array.isArray(plan.steps) || !plan.steps.length || plan.steps.length > MAX_STEPS) p.push({ code: "BAD_STEPS", where: "steps" });
  const steps: PlanStep[] = [];
  (Array.isArray(plan.steps) ? (plan.steps as readonly unknown[]) : []).forEach((raw, i) => {
    const w = `steps[${i}]`;
    if (!raw || typeof raw !== "object") { p.push({ code: "NOT_AN_OBJECT", where: w }); return; }
    const s = raw as PlanStep;
    for (const k of extraKeys(s, ALLOWED_STEP_KEYS)) p.push({ code: "FIELD_NOT_ALLOWED", where: `${w}.${k}` });
    const c = ACTION_ID_RE.test(String(s.actionId)) ? registry.get(s.actionId) : undefined;
    if (!c) { p.push({ code: "UNKNOWN_ACTION", where: `${w}.actionId` }); return; }
    if (!Number.isInteger(s.index) || !Number.isInteger(s.actionVersion)) p.push({ code: "BAD_INTEGER", where: w });
    if (!["INTERNAL", "EXTERNAL", "COMMUNICATION"].includes(s.phase)) p.push({ code: "BAD_PHASE", where: `${w}.phase` });
    if (s.expectedFingerprint !== null && !HEX64_RE.test(String(s.expectedFingerprint))) p.push({ code: "BAD_FINGERPRINT", where: `${w}.expectedFingerprint` });
    if (!Array.isArray(s.dependsOn) || s.dependsOn.some((d) => !Number.isInteger(d))) p.push({ code: "BAD_DEPENDS_ON", where: `${w}.dependsOn` });
    if (!Array.isArray(s.entities) || s.entities.length > MAX_ENTITIES_PER_STEP) p.push({ code: "BAD_ENTITIES", where: `${w}.entities` });
    else s.entities.forEach((e, j) => { if (typeof e !== "string" || !ENTITY_KEY_RE.test(e)) p.push({ code: "BAD_ENTITY_KEY", where: `${w}.entities[${j}]` }); else p.push(...inspectText(e, `${w}.entities[${j}]`, known)); });
    const args = s.args && typeof s.args === "object" && !Array.isArray(s.args) ? s.args : null;
    if (!args) p.push({ code: "BAD_ARGS", where: `${w}.args` });
    else for (const [k, v] of Object.entries(args)) {
      const spec = c.args.find((a) => a.name === k);
      if (!spec || FORBIDDEN_ARG_NAME_RE.test(k)) { p.push({ code: "ARGUMENT_NOT_DECLARED", where: `${w}.args.${k}` }); continue; }
      p.push(...checkArg(spec, v, `${w}.args.${k}`, known));
    }
    const changes: PlanStep["changes"] | null = Array.isArray(s.changes) ? s.changes : null;
    if (!changes) p.push({ code: "BAD_CHANGES", where: `${w}.changes` });
    else (changes as readonly unknown[]).forEach((rawCh, j) => {
      const cw = `${w}.changes[${j}]`;
      if (!rawCh || typeof rawCh !== "object") { p.push({ code: "NOT_AN_OBJECT", where: cw }); return; }
      const ch = rawCh as PlanStep["changes"][number];
      for (const k of extraKeys(ch, ALLOWED_CHANGE_KEYS)) p.push({ code: "FIELD_NOT_ALLOWED", where: `${cw}.${k}` });
      if (!c.args.some((a) => a.name === ch.field)) p.push({ code: "CHANGE_FIELD_NOT_DECLARED", where: `${cw}.field` });
      p.push(...checkScalar(ch.before, `${cw}.before`, known), ...checkScalar(ch.after, `${cw}.after`, known));
    });
    steps.push({
      index: s.index, actionId: s.actionId, actionVersion: s.actionVersion, phase: s.phase, dependsOn: [...(s.dependsOn ?? [])],
      expectedFingerprint: s.expectedFingerprint, entities: [...(s.entities ?? [])],
      args: Object.fromEntries(Object.entries(args ?? {}).filter(([k]) => c.args.some((a) => a.name === k))),
      changes: (changes ?? []).map((ch) => ({ field: ch.field, before: ch.before, after: ch.after })),
    });
  });
  if (p.length) return { ok: false, problems: p };
  return { ok: true, json: { planId: plan.planId, ownerId: plan.ownerId, clientId: plan.clientId, intentHe: plan.intentHe, steps, riskClass: plan.riskClass, confirmation: plan.confirmation, effects: [...plan.effects], createdAt: plan.createdAt, expiresAt: plan.expiresAt } };
}

/** Plan-event / outcome detail text: fixed engine vocabulary + sanitized error text. Secrets and locations are
 *  REDACTED (never stored), control characters stripped, length capped to the DB limit. */
export const MAX_DETAIL_CHARS = 400;
export function safeDetail(s: string, knownSecrets: readonly string[] = []): string {
  let t = String(s).replace(/[\u0000-\u001F\u007F]/g, " ");
  for (const k of knownSecrets) if (k.length >= 12) t = t.split(k).join("[REDACTED]");
  // a secret assignment loses its VALUE, not only its name
  t = t.replace(/\b(authorization|cookie|set-cookie|password|passwd|pwd|secret|api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|service[_-]?role|private[_-]?key)\s*[:=]\s*(bearer\s+|basic\s+)?\S+/gi, "$1=[REDACTED]");
  for (const p of [...SECRET_PATTERNS, ...LOCATION_PATTERNS]) t = t.replace(new RegExp(p.re.source, p.re.flags.includes("g") ? p.re.flags : `${p.re.flags}g`), "[REDACTED]");
  return t.slice(0, MAX_DETAIL_CHARS);
}
