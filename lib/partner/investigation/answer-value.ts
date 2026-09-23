/**
 * Redbloods Partner — structured answer values (Phase F.1E v2). Pure,
 * deterministic, no clock: the anchor date is always passed in (the store
 * derives it on the server from the Asia/Jerusalem calendar).
 *
 * - VALUE_SPEC says, per (questionType, answerCode), whether an answer
 *   carries a value and how it is obtained. Anything not listed is
 *   code-only (value must be null) — every pre-v2 question is code-only.
 * - A RELATIVE answer ("in two weeks") is resolved ONCE, from the anchor
 *   date, and the result is re-verifiable from the recorded resolution.
 *   A caller never supplies the resolved date; if a value is ever submitted
 *   or stored that the rule does not reproduce, it is rejected.
 * - An EXPLICIT date must be a real calendar date. For
 *   WHAT_IS_NEW_PROJECT_DEADLINE it may not be earlier than the answer date
 *   (same day allowed) — a question-specific rule, not a DATE limitation.
 */
import { COO_TZ, addDays, parseYmd } from "../../coo/dates";
import type { InvestigationQuestionType, OwnerContextAnswerValue } from "./types";

type RelativeRule = "PLUS_7_DAYS" | "PLUS_14_DAYS" | "END_OF_MONTH";

export type AnswerValueSpec =
  | { kind: "NONE" }
  | { kind: "DATE_RELATIVE"; rule: RelativeRule }
  | { kind: "DATE_EXPLICIT"; notBeforeAnchor: boolean };

const NONE: AnswerValueSpec = { kind: "NONE" };

export const VALUE_SPEC: Partial<Record<InvestigationQuestionType, Record<string, AnswerValueSpec>>> = {
  WHAT_IS_NEW_PROJECT_DEADLINE: {
    IN_ONE_WEEK: { kind: "DATE_RELATIVE", rule: "PLUS_7_DAYS" },
    IN_TWO_WEEKS: { kind: "DATE_RELATIVE", rule: "PLUS_14_DAYS" },
    END_OF_MONTH: { kind: "DATE_RELATIVE", rule: "END_OF_MONTH" },
    SPECIFIC_DATE: { kind: "DATE_EXPLICIT", notBeforeAnchor: true },
    // NOT_KNOWN_YET / OTHER → code-only
  },
  // F2.8–F2.10: an exact collection date the Owner states (never in the past). Every other timing answer is code-only (a period, no date).
  FINANCE_RECEIVABLE_TIMING: {
    EXACT_DATE: { kind: "DATE_EXPLICIT", notBeforeAnchor: true },
  },
};

export function valueSpecFor(questionType: InvestigationQuestionType, answerCode: string): AnswerValueSpec {
  return VALUE_SPEC[questionType]?.[answerCode] ?? NONE;
}

const STRICT_YMD = /^\d{4}-\d{2}-\d{2}$/;
/** A real calendar date in strict YYYY-MM-DD (2026-02-30 → false). */
export const isValidYmd = (v: unknown): v is string => typeof v === "string" && STRICT_YMD.test(v) && parseYmd(v) === v;

/** Last calendar day of `ymd`'s month. */
export function endOfMonthYmd(ymd: string): string {
  const [y, m] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m, 0)); // day 0 of the next month
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

export function applyRelativeRule(rule: RelativeRule, anchorYmd: string): string {
  if (rule === "PLUS_7_DAYS") return addDays(anchorYmd, 7);
  if (rule === "PLUS_14_DAYS") return addDays(anchorYmd, 14);
  return endOfMonthYmd(anchorYmd);
}

/** "2026-10-07" → "07.10.2026" (display only; storage is always YYYY-MM-DD). */
export const formatYmdHe = (ymd: string) => `${ymd.slice(8, 10)}.${ymd.slice(5, 7)}.${ymd.slice(0, 4)}`;

export type ResolveResult = { ok: true; value: OwnerContextAnswerValue | null } | { ok: false; errors: string[] };

/**
 * Resolves the value of an answer at answer time. `explicitYmd` is only
 * accepted where the spec is DATE_EXPLICIT; everywhere else it must be absent.
 */
export function resolveAnswerValue(
  questionType: InvestigationQuestionType,
  answerCode: string,
  input: { anchorYmd: string; explicitYmd?: string | null },
): ResolveResult {
  const spec = valueSpecFor(questionType, answerCode);
  const explicit = input.explicitYmd ?? null;
  if (!isValidYmd(input.anchorYmd)) return { ok: false, errors: [`anchorYmd ${JSON.stringify(input.anchorYmd)} is not a valid YYYY-MM-DD date`] };
  if (spec.kind === "NONE") {
    return explicit === null ? { ok: true, value: null } : { ok: false, errors: [`${questionType}:${answerCode} carries no value — explicit date not allowed`] };
  }
  if (spec.kind === "DATE_RELATIVE") {
    if (explicit !== null) return { ok: false, errors: [`${questionType}:${answerCode} is resolved by the server (${spec.rule}) — the caller may not supply the date`] };
    return { ok: true, value: { kind: "DATE", ymd: applyRelativeRule(spec.rule, input.anchorYmd), resolution: { method: "RELATIVE", rule: spec.rule, anchorYmd: input.anchorYmd, timeZone: COO_TZ as "Asia/Jerusalem" } } };
  }
  if (!isValidYmd(explicit)) return { ok: false, errors: [`${questionType}:${answerCode} requires a real calendar date YYYY-MM-DD (got ${JSON.stringify(explicit)})`] };
  if (spec.notBeforeAnchor && explicit < input.anchorYmd) return { ok: false, errors: [`${explicit} is earlier than the answer date ${input.anchorYmd} — a new deadline cannot be in the past`] };
  return { ok: true, value: { kind: "DATE", ymd: explicit, resolution: { method: "EXPLICIT", anchorYmd: input.anchorYmd, timeZone: COO_TZ as "Asia/Jerusalem" } } };
}

/**
 * Validates a value read from storage (or built elsewhere) against the spec
 * for its question/answer — strictly: exact keys, real dates, and a RELATIVE
 * value must be reproduced exactly by its own recorded rule + anchor.
 */
export function validateAnswerValue(questionType: InvestigationQuestionType, answerCode: string, raw: unknown): string[] {
  const spec = valueSpecFor(questionType, answerCode);
  if (raw === null || raw === undefined) return spec.kind === "NONE" ? [] : [`${questionType}:${answerCode} requires a DATE value`];
  if (spec.kind === "NONE") return [`${questionType}:${answerCode} is code-only — answer_value must be null`];
  const errors: string[] = [];
  const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
  if (!isObj(raw)) return ["answer_value must be an object"];
  for (const k of Object.keys(raw)) if (!["kind", "ymd", "resolution"].includes(k)) errors.push(`answer_value: unknown key "${k}"`);
  if (raw.kind !== "DATE") errors.push(`answer_value.kind ${JSON.stringify(raw.kind)} is not supported`);
  if (!isValidYmd(raw.ymd)) errors.push("answer_value.ymd must be a real YYYY-MM-DD date");
  const r = raw.resolution;
  if (!isObj(r)) return [...errors, "answer_value.resolution must be an object"];
  if (r.timeZone !== COO_TZ) errors.push(`answer_value.resolution.timeZone must be ${COO_TZ}`);
  if (!isValidYmd(r.anchorYmd)) errors.push("answer_value.resolution.anchorYmd must be a real YYYY-MM-DD date");
  if (spec.kind === "DATE_RELATIVE") {
    for (const k of Object.keys(r)) if (!["method", "rule", "anchorYmd", "timeZone"].includes(k)) errors.push(`answer_value.resolution: unknown key "${k}"`);
    if (r.method !== "RELATIVE") errors.push(`${answerCode} must be RELATIVE`);
    if (r.rule !== spec.rule) errors.push(`${answerCode} must use rule ${spec.rule}`);
    if (!errors.length && raw.ymd !== applyRelativeRule(spec.rule, r.anchorYmd as string)) {
      errors.push(`answer_value.ymd ${String(raw.ymd)} is not ${spec.rule} from ${String(r.anchorYmd)} — value does not match its own resolution`);
    }
  } else {
    for (const k of Object.keys(r)) if (!["method", "anchorYmd", "timeZone"].includes(k)) errors.push(`answer_value.resolution: unknown key "${k}"`);
    if (r.method !== "EXPLICIT") errors.push(`${answerCode} must be EXPLICIT`);
    if (!errors.length && spec.notBeforeAnchor && (raw.ymd as string) < (r.anchorYmd as string)) errors.push(`answer_value.ymd is earlier than its anchor ${String(r.anchorYmd)}`);
  }
  return errors;
}
