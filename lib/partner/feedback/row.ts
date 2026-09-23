/**
 * Redbloods Partner — Structured Owner Feedback (Phase F.1B). Explicit
 * DB row ↔ domain mapping + runtime validation of everything read from (or
 * about to be written to) public.partner_feedback. Pure, no I/O.
 *
 * Nothing here trusts a JSONB column by cast: dimensions / case_snapshot /
 * provenance are parsed field-by-field against the v1 shape, unknown keys
 * are rejected (never silently dropped), and an unsupported
 * feedback_schema_version is surfaced as UNSUPPORTED_FEEDBACK_SCHEMA — never
 * read as if it were current.
 *
 * `note` is carried through as an opaque string. No function in this file
 * (or anywhere in lib/partner/feedback) inspects its content (§11).
 */
import type { CaseClassification, CaseCreatedFrom, CaseStatus } from "../cases/types";
import {
  FEEDBACK_SCHEMA_VERSION,
  type AccuracyFeedback, type ContextValue, type FeedbackTarget, type FeedbackTargetScope, type ImportanceFeedback,
  type InferenceValue, type OverrideValue, type PartnerCaseFeedbackSnapshot, type PartnerFeedback,
  type PartnerFeedbackDimensions, type RemindDirection, type TimingReaction,
} from "./types";

export const PARTNER_FEEDBACK_TABLE = "partner_feedback";

/** Feedback record shapes this reader understands. Anything else → UNSUPPORTED_FEEDBACK_SCHEMA. */
export const SUPPORTED_FEEDBACK_SCHEMA_VERSIONS: readonly string[] = [FEEDBACK_SCHEMA_VERSION];

/** Exact column shape of public.partner_feedback (verified in production, 2026-09-23). snake_case never leaves this file + persistence.ts. */
export interface PartnerFeedbackRow {
  id: string;
  created_at: string;
  feedback_schema_version: string;
  target_scope: string;
  case_id: string | null;
  case_type: string | null;
  subject_type: string | null;
  subject_id: string | null;
  owner_rule_id: string | null;
  hypothesis_id: string | null;
  proposal_id: string | null;
  dimensions: unknown;
  note: string | null;
  case_snapshot: unknown;
  provenance: unknown;
  supersedes_id: string | null;
}

export const PARTNER_FEEDBACK_COLUMNS =
  "id,created_at,feedback_schema_version,target_scope,case_id,case_type,subject_type,subject_id,owner_rule_id,hypothesis_id,proposal_id,dimensions,note,case_snapshot,provenance,supersedes_id";

export type RowParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: "UNSUPPORTED_FEEDBACK_SCHEMA" | "INVALID_STORED_ROW"; errors: string[] };

// ── closed value sets (Record<Union, true> keeps them exhaustive at compile time) ──

const setOf = <T extends string>(r: Record<T, true>): ReadonlySet<string> => new Set(Object.keys(r));
const SCOPES = setOf<FeedbackTargetScope>({ CASE_INSTANCE: true, CASE_TYPE: true, SUBJECT: true, RULE_APPLICATION: true, HYPOTHESIS: true, THRESHOLD_PROPOSAL: true });
const ACCURACY = setOf<AccuracyFeedback>({ CORRECT: true, INCORRECT: true, UNSPECIFIED: true });
const IMPORTANCE = setOf<ImportanceFeedback>({ IMPORTANT: true, NOT_IMPORTANT: true, UNSPECIFIED: true });
const TIMING = setOf<TimingReaction>({ TOO_EARLY: true, RIGHT_TIME: true, TOO_LATE: true, UNSPECIFIED: true });
const REMIND = setOf<RemindDirection>({ EARLIER: true, LATER: true });
const CONTEXT = setOf<ContextValue>({ HAS_MISSING_CONTEXT: true, NONE: true, UNSPECIFIED: true });
const INFERENCE = setOf<InferenceValue>({ DO_NOT_INFER: true, UNSPECIFIED: true });
const OVERRIDE = setOf<OverrideValue>({ OWNER_OVERRIDE: true, NONE: true });
const CLASSIFICATION = setOf<CaseClassification>({ ATTENTION: true, RISK: true, OPPORTUNITY: true, INFORMATION: true });
const CASE_STATUS = setOf<CaseStatus>({ OPEN: true, RESOLVED_BY_STATE: true, NEEDS_CONTEXT: true, UNKNOWN: true });
const CREATED_FROM = setOf<CaseCreatedFrom>({ STATE: true, CHANGE: true, STATE_AND_CHANGE: true });

const SNAPSHOT_KEYS = ["caseId", "caseType", "subjectType", "subjectId", "classification", "status", "createdFrom", "caseSchemaVersion", "evidenceFingerprint", "capturedAt"] as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isNonEmptyString = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const isIsoTimestamp = (v: unknown): v is string => typeof v === "string" && !Number.isNaN(Date.parse(v));

function unknownKeys(obj: Record<string, unknown>, allowed: readonly string[], where: string, errors: string[]) {
  for (const k of Object.keys(obj)) if (!allowed.includes(k)) errors.push(`${where}: unknown key "${k}"`);
}

function enumField(obj: Record<string, unknown>, key: string, allowed: ReadonlySet<string>, where: string, errors: string[]): string {
  const v = obj[key];
  if (typeof v !== "string" || !allowed.has(v)) errors.push(`${where}.${key}: invalid value ${JSON.stringify(v)}`);
  return v as string;
}

function nullableCode(obj: Record<string, unknown>, key: string, where: string, errors: string[]): string | null {
  const v = obj[key];
  if (v === null) return null;
  if (!isNonEmptyString(v)) { errors.push(`${where}.${key}: must be a non-empty string or null`); return null; }
  return v;
}

// ── JSONB parsers (shared by the write path and the read path) ──

export function parseFeedbackDimensions(raw: unknown, errors: string[]): PartnerFeedbackDimensions | null {
  const at = "dimensions";
  if (!isPlainObject(raw)) { errors.push(`${at}: must be a JSON object`); return null; }
  const before = errors.length;
  unknownKeys(raw, ["accuracy", "importance", "timing", "context", "inference", "override"], at, errors);

  const accuracy = enumField(raw, "accuracy", ACCURACY, at, errors) as AccuracyFeedback;
  const importance = enumField(raw, "importance", IMPORTANCE, at, errors) as ImportanceFeedback;

  const t = raw.timing;
  let timing: PartnerFeedbackDimensions["timing"] = { reaction: "UNSPECIFIED", remindAdjustment: null };
  if (!isPlainObject(t)) errors.push(`${at}.timing: must be a JSON object`);
  else {
    unknownKeys(t, ["reaction", "remindAdjustment"], `${at}.timing`, errors);
    const reaction = enumField(t, "reaction", TIMING, `${at}.timing`, errors) as TimingReaction;
    let remindAdjustment: PartnerFeedbackDimensions["timing"]["remindAdjustment"] = null;
    const ra = t.remindAdjustment;
    if (ra === undefined) errors.push(`${at}.timing.remindAdjustment: required (null when absent)`);
    else if (ra !== null) {
      if (!isPlainObject(ra)) errors.push(`${at}.timing.remindAdjustment: must be an object or null`);
      else {
        const w = `${at}.timing.remindAdjustment`;
        unknownKeys(ra, ["direction", "days", "date"], w, errors);
        const direction = enumField(ra, "direction", REMIND, w, errors) as RemindDirection;
        remindAdjustment = { direction };
        if (ra.days !== undefined) {
          if (typeof ra.days !== "number" || !Number.isInteger(ra.days) || ra.days <= 0) errors.push(`${w}.days: must be a positive integer`);
          else remindAdjustment.days = ra.days;
        }
        if (ra.date !== undefined) {
          if (!isIsoTimestamp(ra.date)) errors.push(`${w}.date: must be a valid date string`);
          else remindAdjustment.date = ra.date;
        }
      }
    }
    timing = { reaction, remindAdjustment };
  }

  const pair = <V extends string, C extends string>(key: string, set: ReadonlySet<string>, codeKey: C): ({ value: V } & Record<C, string | null>) | null => {
    const o = raw[key];
    if (!isPlainObject(o)) { errors.push(`${at}.${key}: must be a JSON object`); return null; }
    unknownKeys(o, ["value", codeKey], `${at}.${key}`, errors);
    if (!(codeKey in o)) errors.push(`${at}.${key}.${codeKey}: required (null when absent)`);
    return { value: enumField(o, "value", set, `${at}.${key}`, errors) as V, [codeKey]: nullableCode(o, codeKey, `${at}.${key}`, errors) } as { value: V } & Record<C, string | null>;
  };
  const context = pair<ContextValue, "contextCode">("context", CONTEXT, "contextCode");
  const inference = pair<InferenceValue, "hypothesisId">("inference", INFERENCE, "hypothesisId");
  const override = pair<OverrideValue, "reasonCode">("override", OVERRIDE, "reasonCode");

  if (errors.length > before || !context || !inference || !override) return null;
  return { accuracy, importance, timing, context, inference, override };
}

/** Accepts ONLY the compact PartnerCaseFeedbackSnapshot shape. A full PartnerCase (facts, derivedFacts, hypotheses, …) is rejected by the unknown-key check — never trimmed down silently. */
export function parseCaseSnapshot(raw: unknown, errors: string[]): PartnerCaseFeedbackSnapshot | null {
  const at = "caseSnapshot";
  if (!isPlainObject(raw)) { errors.push(`${at}: must be a JSON object`); return null; }
  const before = errors.length;
  unknownKeys(raw, SNAPSHOT_KEYS, at, errors);
  for (const k of ["caseId", "caseType", "subjectType", "subjectId", "caseSchemaVersion", "evidenceFingerprint"] as const) {
    if (!isNonEmptyString(raw[k])) errors.push(`${at}.${k}: must be a non-empty string`);
  }
  enumField(raw, "classification", CLASSIFICATION, at, errors);
  enumField(raw, "status", CASE_STATUS, at, errors);
  enumField(raw, "createdFrom", CREATED_FROM, at, errors);
  if (!isIsoTimestamp(raw.capturedAt)) errors.push(`${at}.capturedAt: must be a valid ISO timestamp`);
  if (errors.length > before) return null;
  // Rebuilt key-by-key: the returned object can never carry anything beyond the 10 snapshot fields.
  return {
    caseId: raw.caseId as string,
    caseType: raw.caseType as string,
    subjectType: raw.subjectType as string,
    subjectId: raw.subjectId as string,
    classification: raw.classification as CaseClassification,
    status: raw.status as CaseStatus,
    createdFrom: raw.createdFrom as CaseCreatedFrom,
    caseSchemaVersion: raw.caseSchemaVersion as string,
    evidenceFingerprint: raw.evidenceFingerprint as string,
    capturedAt: raw.capturedAt as string,
  };
}

/** v1 knows exactly one provenance: owner_manual. Provenance is recorded, never acted on (it can never create an Owner Rule). */
export function parseProvenance(raw: unknown, errors: string[]): PartnerFeedback["provenance"] | null {
  if (!isPlainObject(raw)) { errors.push("provenance: must be a JSON object"); return null; }
  const before = errors.length;
  unknownKeys(raw, ["source"], "provenance", errors);
  if (raw.source !== "owner_manual") errors.push(`provenance.source: unsupported value ${JSON.stringify(raw.source)}`);
  return errors.length > before ? null : { source: "owner_manual" };
}

const TARGET_KEYS = ["caseId", "caseType", "subjectType", "subjectId", "ownerRuleId", "hypothesisId", "proposalId"] as const;

/** Runtime shape check of a target object (scope membership + every id field a non-empty string or absent). Scope REQUIREMENTS are validatePartnerFeedback's job. */
export function parseFeedbackTarget(raw: unknown, errors: string[]): FeedbackTarget | null {
  if (!isPlainObject(raw)) { errors.push("target: must be an object"); return null; }
  const before = errors.length;
  unknownKeys(raw, ["scope", ...TARGET_KEYS], "target", errors);
  const scope = enumField(raw, "scope", SCOPES, "target", errors) as FeedbackTargetScope;
  const target: FeedbackTarget = { scope };
  for (const k of TARGET_KEYS) {
    const v = raw[k];
    if (v === undefined || v === null) continue;
    if (!isNonEmptyString(v)) errors.push(`target.${k}: must be a non-empty string when present`);
    else target[k] = v;
  }
  return errors.length > before ? null : target;
}

// ── domain → row (write path; input already validated by persistence.ts) ──

export function feedbackToRow(f: PartnerFeedback): PartnerFeedbackRow {
  const t = f.target;
  return {
    id: f.id,
    created_at: f.createdAt,
    feedback_schema_version: f.schemaVersion,
    target_scope: t.scope,
    case_id: t.caseId ?? null,
    case_type: t.caseType ?? null,
    subject_type: t.subjectType ?? null,
    subject_id: t.subjectId ?? null,
    owner_rule_id: t.ownerRuleId ?? null,
    hypothesis_id: t.hypothesisId ?? null,
    proposal_id: t.proposalId ?? null,
    dimensions: f.dimensions,
    note: f.note,
    case_snapshot: f.caseSnapshot,
    provenance: f.provenance,
    supersedes_id: f.supersedesId,
  };
}

// ── row → domain (read path) ──

/**
 * The ONLY way a stored row becomes a PartnerFeedback. Schema version is
 * checked FIRST: an unknown version is never parsed with v1 rules and never
 * treated as current. `createdAt` is normalized to a canonical ISO string
 * (Postgres returns "+00:00"; the domain uses "Z") — same instant.
 */
export function mapFeedbackRow(raw: unknown): RowParseResult<PartnerFeedback> {
  if (!isPlainObject(raw)) return { ok: false, code: "INVALID_STORED_ROW", errors: ["row: not an object"] };
  const version = raw.feedback_schema_version;
  if (typeof version !== "string" || !SUPPORTED_FEEDBACK_SCHEMA_VERSIONS.includes(version)) {
    return { ok: false, code: "UNSUPPORTED_FEEDBACK_SCHEMA", errors: [`feedback_schema_version ${JSON.stringify(version)} is not supported by this reader (supported: ${SUPPORTED_FEEDBACK_SCHEMA_VERSIONS.join(", ")})`] };
  }

  const errors: string[] = [];
  if (!isUuid(raw.id)) errors.push("id: must be a uuid");
  if (!isIsoTimestamp(raw.created_at)) errors.push("created_at: must be a valid timestamp");
  if (raw.supersedes_id !== null && !isUuid(raw.supersedes_id)) errors.push("supersedes_id: must be a uuid or null");
  if (raw.note !== null && typeof raw.note !== "string") errors.push("note: must be a string or null");

  const target = parseFeedbackTarget({
    scope: raw.target_scope,
    caseId: raw.case_id, caseType: raw.case_type, subjectType: raw.subject_type, subjectId: raw.subject_id,
    ownerRuleId: raw.owner_rule_id, hypothesisId: raw.hypothesis_id, proposalId: raw.proposal_id,
  }, errors);
  const dimensions = parseFeedbackDimensions(raw.dimensions, errors);
  const caseSnapshot = raw.case_snapshot === null ? null : parseCaseSnapshot(raw.case_snapshot, errors);
  const provenance = parseProvenance(raw.provenance, errors);

  if (errors.length || !target || !dimensions || !provenance) return { ok: false, code: "INVALID_STORED_ROW", errors };
  return {
    ok: true,
    value: {
      id: raw.id as string,
      schemaVersion: version,
      createdAt: new Date(raw.created_at as string).toISOString(),
      target,
      dimensions,
      note: raw.note as string | null,
      caseSnapshot,
      supersedesId: raw.supersedes_id as string | null,
      provenance,
    },
  };
}
