/**
 * SUNNY UNIVERSAL ACTION LAYER — references to a record created by an EARLIER step of the same plan (2026-09-29).
 *
 * ONE closed syntax: `$step<k>.created` — the canonical key of the record step k (a CREATE) made. Nothing else: no
 * generic interpolation, no paths, no `$step0.anything`, no output field other than the created record. A reference is
 * a typed capability: it is allowed only in an entityKey argument a primitive explicitly declares as reference-capable
 * (spec.refArgs / spec.refTarget) for the created kind, only to an earlier CREATE step, and the step then depends on it.
 * The plan stores the reference itself (the approved plan hash binds it); the real id comes ONLY from the createdKey
 * recorded in step k's outcome of the same execution — never from Claude, never guessed. Pure.
 */
import type { Plan, PlanStep } from "./types";

export const STEP_REF_RE = /^\$step([0-9]{1,2})\.created$/;
/** Anything that looks like an attempt at a reference (only the exact form above is valid). "$200 נטו" is not one. */
export const LOOKS_LIKE_REF_RE = /^\s*\$\s*step/i;
export const parseStepRef = (v: unknown): number | null => { if (typeof v !== "string") return null; const m = STEP_REF_RE.exec(v); return m ? Number(m[1]) : null; };
export const refString = (k: number) => `$step${k}.created`;
/** The placeholder target key of a step whose OWN record is created earlier in the plan (never a real key: not a uuid). */
export const refTargetKey = (kind: string, k: number) => `${kind}:step${k}`;
export const REF_TARGET_KEY_RE = /^([a-z][a-z_-]{1,30}):step([0-9]{1,2})$/;
/** A plan-time stand-in id for the not-yet-created record (a valid uuid shape that no record can have: version nibble 0). */
export const refSentinelId = (k: number) => `00000000-0000-0000-0000-5e9f000000${String(k).padStart(2, "0")}`;

export interface StepRef { arg: string; k: number }
/** Every reference in a step's arguments (top level only — nested values are refused by the argument validator). */
export const refsOf = (args: Readonly<Record<string, unknown>>): StepRef[] =>
  Object.entries(args).flatMap(([arg, v]) => { const k = parseStepRef(v); return k === null ? [] : [{ arg, k }]; });
/** An argument value that tries to be a reference but is not the exact typed form (e.g. `$step0.id`, `$step 1.created`). */
export const malformedRefArgs = (args: Readonly<Record<string, unknown>>): string[] =>
  Object.entries(args).filter(([, v]) => typeof v === "string" && LOOKS_LIKE_REF_RE.test(v) && parseStepRef(v) === null).map(([k]) => k);

/**
 * Structural rules (planning AND the engine's plan validation): the exact form, an earlier step, a CREATE step
 * (its target key is "<kind>:new"), declared in dependsOn; a step whose own target is a created record uses the
 * "<kind>:step<k>" placeholder with a reference to that same step.
 */
export function refProblems(p: Plan): Array<{ code: string; step: number; detail: string }> {
  const out: Array<{ code: string; step: number; detail: string }> = [];
  p.steps.forEach((s, i) => {
    for (const a of malformedRefArgs(s.args)) out.push({ code: "REF_SYNTAX", step: i, detail: a });
    for (const r of refsOf(s.args)) {
      if (r.k === i) { out.push({ code: "REF_SELF", step: i, detail: r.arg }); continue; }
      if (r.k > i || !p.steps[r.k]) { out.push({ code: "REF_FORWARD", step: i, detail: r.arg }); continue; }
      if (!String(p.steps[r.k].entities[0] ?? "").endsWith(":new")) { out.push({ code: "REF_NOT_A_CREATE", step: i, detail: r.arg }); continue; }
      if (!s.dependsOn.includes(r.k)) out.push({ code: "REF_NOT_A_DEPENDENCY", step: i, detail: r.arg });
    }
    const t = REF_TARGET_KEY_RE.exec(String(s.entities[0] ?? ""));
    if (t) {
      const k = Number(t[2]);
      const created = String(p.steps[k]?.entities[0] ?? "");
      if (!(k < i) || created !== `${t[1]}:new` || !refsOf(s.args).some((r) => r.k === k) || !s.dependsOn.includes(k)) out.push({ code: "REF_TARGET_INVALID", step: i, detail: String(s.entities[0]) });
    }
  });
  return out;
}

/** The step as it runs: every reference replaced by the key step k created in THIS execution (null = unresolved). */
export function resolveStepRefs(s: PlanStep, createdKeyOf: (k: number) => string | undefined): { step: PlanStep; map: Record<string, string> } | null {
  const refs = refsOf(s.args);
  const t = REF_TARGET_KEY_RE.exec(String(s.entities[0] ?? ""));
  if (!refs.length && !t) return { step: s, map: {} };
  const args: Record<string, unknown> = { ...s.args };
  const map: Record<string, string> = {};
  for (const r of refs) {
    const key = createdKeyOf(r.k);
    if (!key || !/^[a-z][a-z_-]{1,30}:[0-9a-f-]{36}$/i.test(key)) return null;
    args[r.arg] = key;
    map[key] = refString(r.k);
    map[key.slice(key.indexOf(":") + 1)] = refString(r.k);
  }
  let entities = s.entities;
  if (t) {
    const key = createdKeyOf(Number(t[2]));
    if (!key || !key.startsWith(`${t[1]}:`)) return null;
    entities = [key, ...s.entities.slice(1)];
  }
  return { step: { ...s, args, entities }, map };
}
/** Plan-time form of a step: every reference replaced by a stand-in key of the created kind (for planning only). */
export function sentinelArgs(args: Readonly<Record<string, unknown>>, kindOf: (k: number) => string): Record<string, unknown> {
  const out: Record<string, unknown> = { ...args };
  for (const r of refsOf(args)) out[r.arg] = `${kindOf(r.k)}:${refSentinelId(r.k)}`;
  return out;
}
/** A value as the Boss approved it: the stand-in / real created id shown as the reference itself. */
export function asApproved(v: unknown, map: Readonly<Record<string, string>>): unknown {
  return typeof v === "string" && v in map ? map[v] : v;
}
