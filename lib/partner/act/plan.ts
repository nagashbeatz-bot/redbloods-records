/**
 * SUNNY UNIVERSAL ACTION LAYER — plan model, canonical hashing, validation and the server-side preview (pure).
 * Claude never invents a plan: the server builds it from registered contracts + live state; Claude only renders it.
 */
import { createHash } from "node:crypto";
import type { ActionContract, ConfirmationClass, EffectKey, Phase, Plan, PlanStep, Preview, RiskClass } from "./types";
import { RISK_ORDER } from "./types";

/** Deterministic JSON: object keys sorted recursively; undefined dropped. */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(",")}}`;
}
export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** The plan hash binds EVERYTHING the Boss approves: owner, client, every step (action + version + args + entities + expected state + phase + changes), effects, risk, expiry. */
export function planHash(p: Plan): string {
  return sha256(canonicalJson({ v: 1, planId: p.planId, ownerId: p.ownerId, clientId: p.clientId, intentHe: p.intentHe, steps: p.steps, riskClass: p.riskClass, confirmation: p.confirmation, effects: [...p.effects].sort(), createdAt: p.createdAt, expiresAt: p.expiresAt }));
}
/** One-time execution key per step. */
export const executionKey = (hash: string, s: PlanStep) => sha256(`${hash}:${s.index}:${s.actionId}@${s.actionVersion}`);

const PHASE_ORDER: Record<Phase, number> = { INTERNAL: 0, EXTERNAL: 1, COMMUNICATION: 2 };
export const highestRisk = (xs: readonly RiskClass[]): RiskClass => xs.reduce<RiskClass>((m, x) => (RISK_ORDER.indexOf(x) > RISK_ORDER.indexOf(m) ? x : m), "SAFE_REVERSIBLE");
export function confirmationFor(r: RiskClass): ConfirmationClass {
  if (r === "SECURITY_SENSITIVE") return "NOT_DELEGATED";
  if (r === "DESTRUCTIVE" || r === "BULK" || r === "EXTERNAL_COMMUNICATION") return "C3_STRONG_APPROVAL";
  if (r === "FINANCIAL" || r === "EXTERNAL_SYSTEM_WRITE" || r === "FILE_MUTATION") return "C2_APPROVAL_WITH_VALUES";
  return "C1_APPROVAL";
}

export type PlanProblem = { code: string; step?: number; detail: string };
/** Structural validation of a plan against the registry (no live state needed). */
export function validatePlan(p: Plan, registry: ReadonlyMap<string, ActionContract>): PlanProblem[] {
  const out: PlanProblem[] = [];
  if (!p.steps.length) out.push({ code: "EMPTY_PLAN", detail: "a plan needs at least one step" });
  let lastPhase = -1;
  p.steps.forEach((s, i) => {
    if (s.index !== i) out.push({ code: "STEP_INDEX", step: i, detail: "steps must be numbered 0..n-1 in order" });
    const c = registry.get(s.actionId);
    if (!c) { out.push({ code: "UNKNOWN_ACTION", step: i, detail: s.actionId }); return; }
    if (c.version !== s.actionVersion) out.push({ code: "ACTION_VERSION_MISMATCH", step: i, detail: `${s.actionId} v${s.actionVersion} ≠ v${c.version}` });
    if (c.riskClass === "SECURITY_SENSITIVE" || c.availability === "SUNNY_INTENTIONALLY_EXCLUDED") out.push({ code: "NOT_DELEGATED", step: i, detail: s.actionId });
    if (c.phase !== s.phase) out.push({ code: "PHASE_MISMATCH", step: i, detail: `${s.actionId} is ${c.phase}` });
    if (PHASE_ORDER[s.phase] < lastPhase) out.push({ code: "PHASE_ORDER", step: i, detail: "internal → external → communication" });
    lastPhase = Math.max(lastPhase, PHASE_ORDER[s.phase]);
    if (s.dependsOn.some((d) => d >= i)) out.push({ code: "FORWARD_DEPENDENCY", step: i, detail: "a step can depend only on earlier steps" });
    if (s.expectedFingerprint === null && !s.dependsOn.length) out.push({ code: "MISSING_FINGERPRINT", step: i, detail: "an independent step must carry its expected live-state fingerprint" });
    for (const a of c.args) if (a.required && !(a.name in s.args)) out.push({ code: "MISSING_ARGUMENT", step: i, detail: a.name });
    for (const a of c.args) if (a.kind === "enum" && a.name in s.args && !(a.values ?? []).includes(String(s.args[a.name]))) out.push({ code: "ENUM_VIOLATION", step: i, detail: `${a.name}=${String(s.args[a.name])}` });
    for (const k of Object.keys(s.args)) if (!c.args.some((a) => a.name === k)) out.push({ code: "UNKNOWN_ARGUMENT", step: i, detail: k });
  });
  const risk = highestRisk(p.steps.map((s) => registry.get(s.actionId)?.riskClass ?? "SECURITY_SENSITIVE"));
  if (p.riskClass !== risk) out.push({ code: "RISK_UNDERSTATED", detail: `plan says ${p.riskClass}, steps require ${risk}` });
  if (p.confirmation !== confirmationFor(risk)) out.push({ code: "CONFIRMATION_UNDERSTATED", detail: `requires ${confirmationFor(risk)}` });
  const effects = new Set<EffectKey>(p.steps.flatMap((s) => { const c = registry.get(s.actionId); return c ? [...c.effects, ...c.possibleEffects] : []; }));
  for (const e of effects) if (!p.effects.includes(e)) out.push({ code: "HIDDEN_SIDE_EFFECT", detail: e });
  return out;
}

const EFFECT_HE: Record<EffectKey, string> = {
  FINANCE: "רישום / עדכון בכספים", LEDGER: "עדכון במאזן אמן", CALENDAR: "שינוי ביומן Google", GOOGLE_TASKS: "שינוי ב-Google Tasks", FILES: "שינוי קבצים באחסון",
  PUSH: "שליחת התראה (Push) לאדם אחר", EMAIL: "שליחת מייל", CASCADE: "שינוי ברשומות קשורות", UNLINK: "ניתוק קישור בין רשומות", DELETION: "מחיקה", SETTINGS: "שינוי הגדרה", EXTERNAL_LINK: "יצירת קישור ציבורי",
};
/** Server-side preview. Business language only — no tables / routes. */
export function buildPreview(p: Plan, registry: ReadonlyMap<string, ActionContract>, o: { missingHe?: readonly string[]; duplicateWarningsHe?: readonly string[]; requiredConfirmationValues?: readonly string[] } = {}): Preview {
  return {
    planId: p.planId, planHash: planHash(p), intentHe: p.intentHe, addressHe: "בוס",
    steps: p.steps.map((s) => {
      const c = registry.get(s.actionId)!;
      return { index: s.index, meaningHe: c.meaningHe ?? c.meaningEn, entities: s.entities, changes: s.changes, effectsHe: [...c.effects.map((e) => EFFECT_HE[e]), ...c.possibleEffects.map((e) => `ייתכן: ${EFFECT_HE[e]}`)], willNotHappenHe: c.disclosuresHe };
    }),
    riskClass: p.riskClass, confirmation: p.confirmation, requiredConfirmationValues: o.requiredConfirmationValues ?? [],
    missingHe: o.missingHe ?? [], duplicateWarningsHe: o.duplicateWarningsHe ?? [], expiresAt: p.expiresAt,
    approvalRule: "כל שינוי מחכה לאישור שלך, בוס. אחרי אישור אני קורא שוב את המצב החי — אם משהו השתנה, אני לא מבצע ומראה תצוגה חדשה.",
  };
}
