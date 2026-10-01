/**
 * Sunny knowledge infrastructure — provenance + time-awareness over the typed `value`. Pure.
 *
 * Every NEW / EXTENDED knowledge item says where it came from (sourceType + confidence + optional sourceRef / observedAt)
 * and, for time-aware kinds, when it holds (status + validFrom + validUntil). Rows stored before 2026-10-01 carry none of
 * these fields; they READ as OWNER_STATEMENT / ACTIVE (the Owner stated and confirmed them) — nothing is rewritten.
 *
 * HARD RULES: INFERRED is never CONFIRMED; an INFERRED assertion never replaces a slot whose current row is an
 * OWNER_STATEMENT / SYSTEM_RECORD (or a legacy row) — that is an explicit PROVENANCE_CONFLICT, never a silent overwrite.
 */
import { CONFIDENCES, DEFAULT_CONFIDENCE, SOURCE_TYPES, TIME_STATUSES, type Confidence, type SourceType, type TimeStatus } from "./taxonomy";

type Val = Record<string, string | number>;
const str = (v: unknown) => (typeof v === "string" ? v : "");

export interface ProvenanceView { sourceType: SourceType; confidence: Confidence; sourceRef: string | null; observedAt: string | null; explicit: boolean }

export function provenanceOf(value: Val): ProvenanceView {
  const st = (SOURCE_TYPES as readonly string[]).includes(str(value.sourceType)) ? (str(value.sourceType) as SourceType) : null;
  const sourceType = st ?? "OWNER_STATEMENT";
  const cf = (CONFIDENCES as readonly string[]).includes(str(value.confidence)) ? (str(value.confidence) as Confidence) : null;
  return { sourceType, confidence: cf ?? DEFAULT_CONFIDENCE[sourceType], sourceRef: str(value.sourceRef) || null, observedAt: str(value.observedAt) || null, explicit: !!st };
}

/** Owner statements, canonical-record facts and legacy rows are AUTHORITATIVE: an inference never replaces them. */
export const isAuthoritative = (value: Val): boolean => { const t = provenanceOf(value).sourceType; return t === "OWNER_STATEMENT" || t === "SYSTEM_RECORD"; };

/** Fills the defaults a NEW write carries (only for the keys the kind declares). Idempotent. */
export function withProvenanceDefaults(value: Val, declared: ReadonlySet<string>): Val {
  const out: Val = { ...value };
  if (declared.has("sourceType") && !out.sourceType) out.sourceType = "OWNER_STATEMENT";
  if (declared.has("confidence") && !out.confidence && out.sourceType) out.confidence = DEFAULT_CONFIDENCE[out.sourceType as SourceType];
  if (declared.has("status") && !out.status) out.status = "ACTIVE";
  return out;
}

/** Cross-field validation of provenance + time. Returns clear errors (empty = valid). */
export function checkProvenanceAndTime(value: Val): string[] {
  const e: string[] = [];
  if (value.sourceType === "INFERRED" && value.confidence === "CONFIRMED") e.push("confidence: an INFERRED item can never be CONFIRMED (use HIGH / MEDIUM / LOW)");
  if (value.sourceType === "SYSTEM_RECORD" && !value.sourceRef) e.push("sourceRef: a SYSTEM_RECORD item must say which record it comes from");
  if (value.validFrom && value.validUntil && str(value.validUntil) < str(value.validFrom)) e.push("validUntil: must not be before validFrom");
  return e;
}

export type Temporal = "CURRENT" | "HISTORICAL" | "FUTURE";

/** Time-awareness of one ASSERTED value. Status wins; then the validity window against today (Israel date). */
export function temporalOf(value: Val, todayIL: string): Temporal {
  const status = (TIME_STATUSES as readonly string[]).includes(str(value.status)) ? (str(value.status) as TimeStatus) : "ACTIVE";
  if (status !== "ACTIVE") return "HISTORICAL";
  if (value.validFrom && str(value.validFrom) > todayIL) return "FUTURE";
  if (value.validUntil && str(value.validUntil) < todayIL) return "HISTORICAL";
  return "CURRENT";
}
