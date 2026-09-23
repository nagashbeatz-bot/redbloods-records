/**
 * Redbloods Partner — Owner Context persistence (Phase F.1E). Explicit
 * public.partner_owner_context row ↔ domain mapping + runtime validation.
 * Pure, no I/O.
 *
 * Nothing read from the table is trusted by cast. The schema version is
 * checked first (an unsupported version is never parsed with v1 rules), then
 * every column is validated — including the SEMANTIC rules the DB cannot
 * express: question_type is in the current taxonomy and answer_code belongs
 * to that question type. question_text is returned exactly as stored — it is
 * the wording the Owner actually answered and is never regenerated on read.
 * `note` is carried verbatim; nothing here inspects it.
 */
import { ANSWER_OPTIONS, answerOptionsFor } from "./questions";
import type { InvestigationQuestionType, PartnerOwnerContext } from "./types";

export const PARTNER_OWNER_CONTEXT_TABLE = "partner_owner_context";

/** Stamps the SHAPE of a persisted Owner Context record (distinct from the Case's own schema version). */
export const OWNER_CONTEXT_SCHEMA_VERSION = "partner-owner-context-schema-v1";
export const SUPPORTED_OWNER_CONTEXT_SCHEMA_VERSIONS: readonly string[] = [OWNER_CONTEXT_SCHEMA_VERSION];

/**
 * A persisted Owner Context: the pure PartnerOwnerContext (unchanged, so the
 * attention queue and interpretation consume it as-is) plus the two fields
 * only persistence knows about. `id` / `answeredAt` are the DB's id /
 * created_at; `schemaVersion` is the stored context_schema_version.
 */
export interface PersistedOwnerContext extends PartnerOwnerContext {
  caseSchemaVersion: string;
  supersedesId: string | null;
}

/** Exact column shape of public.partner_owner_context (verified in production, 2026-09-23). */
export interface OwnerContextRow {
  id: string;
  created_at: string;
  context_schema_version: string;
  question_id: string;
  question_type: string;
  question_text: string;
  case_id: string;
  case_type: string;
  case_schema_version: string;
  case_facts_fingerprint: string;
  subject_type: string;
  subject_id: string;
  answer_code: string;
  note: string | null;
  scope: string;
  provenance: unknown;
  supersedes_id: string | null;
}

/** What an INSERT sends: never id / created_at — the DB defaults (gen_random_uuid(), now()) are authoritative. */
export type OwnerContextInsertRow = Omit<OwnerContextRow, "id" | "created_at">;

export const OWNER_CONTEXT_COLUMNS =
  "id,created_at,context_schema_version,question_id,question_type,question_text,case_id,case_type,case_schema_version,case_facts_fingerprint,subject_type,subject_id,answer_code,note,scope,provenance,supersedes_id";

export type ContextRowParseResult =
  | { ok: true; value: PersistedOwnerContext }
  | { ok: false; code: "UNSUPPORTED_CONTEXT_SCHEMA" | "INVALID_STORED_ROW"; errors: string[] };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);
const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isNonEmptyString = (v: unknown): v is string => typeof v === "string" && v.length > 0;

export const isKnownQuestionType = (t: unknown): t is InvestigationQuestionType =>
  typeof t === "string" && Object.prototype.hasOwnProperty.call(ANSWER_OPTIONS, t);

/** Semantic validity the DB cannot check: the answer is one the question type actually offers (incl. OTHER). */
export function isAnswerCodeValidFor(questionType: InvestigationQuestionType, answerCode: unknown): boolean {
  return typeof answerCode === "string" && answerOptionsFor(questionType).some((o) => o.code === answerCode);
}

export const deriveQuestionId = (caseId: string, questionType: string) => `${caseId}::${questionType}`;

/** v1 knows exactly one provenance: owner_manual. It is recorded, never acted on (it can never create an Owner Rule). */
export function parseContextProvenance(raw: unknown, errors: string[]): PartnerOwnerContext["provenance"] | null {
  if (!isPlainObject(raw)) { errors.push("provenance: must be a JSON object"); return null; }
  const before = errors.length;
  for (const k of Object.keys(raw)) if (k !== "source") errors.push(`provenance: unknown key "${k}"`);
  if (raw.source !== "owner_manual") errors.push(`provenance.source: unsupported value ${JSON.stringify(raw.source)}`);
  return errors.length > before ? null : { source: "owner_manual" };
}

/** The ONLY way a stored row becomes a PersistedOwnerContext. Fail-closed on anything unexpected. */
export function mapOwnerContextRow(raw: unknown): ContextRowParseResult {
  if (!isPlainObject(raw)) return { ok: false, code: "INVALID_STORED_ROW", errors: ["row: not an object"] };
  const version = raw.context_schema_version;
  if (typeof version !== "string" || !SUPPORTED_OWNER_CONTEXT_SCHEMA_VERSIONS.includes(version)) {
    return { ok: false, code: "UNSUPPORTED_CONTEXT_SCHEMA", errors: [`context_schema_version ${JSON.stringify(version)} is not supported by this reader (supported: ${SUPPORTED_OWNER_CONTEXT_SCHEMA_VERSIONS.join(", ")})`] };
  }

  const errors: string[] = [];
  if (!isUuid(raw.id)) errors.push("id: must be a uuid");
  if (typeof raw.created_at !== "string" || Number.isNaN(Date.parse(raw.created_at))) errors.push("created_at: must be a valid timestamp");
  for (const k of ["question_id", "question_text", "case_id", "case_type", "case_schema_version", "case_facts_fingerprint", "subject_type", "subject_id"] as const) {
    if (!isNonEmptyString(raw[k])) errors.push(`${k}: must be a non-empty string`);
  }
  if (!isKnownQuestionType(raw.question_type)) errors.push(`question_type ${JSON.stringify(raw.question_type)} is not in the current investigation taxonomy`);
  else if (!isAnswerCodeValidFor(raw.question_type, raw.answer_code)) errors.push(`answer_code ${JSON.stringify(raw.answer_code)} is not an answer of ${raw.question_type}`);
  if (isNonEmptyString(raw.case_id) && typeof raw.question_type === "string" && raw.question_id !== deriveQuestionId(raw.case_id, raw.question_type)) {
    errors.push("question_id does not equal case_id::question_type");
  }
  if (raw.scope !== "CASE_INSTANCE") errors.push(`scope ${JSON.stringify(raw.scope)} is not supported (CASE_INSTANCE only)`);
  if (raw.note !== null && typeof raw.note !== "string") errors.push("note: must be a string or null");
  if (raw.supersedes_id !== null && !isUuid(raw.supersedes_id)) errors.push("supersedes_id: must be a uuid or null");
  const provenance = parseContextProvenance(raw.provenance, errors);

  if (errors.length || !provenance) return { ok: false, code: "INVALID_STORED_ROW", errors };
  return {
    ok: true,
    value: {
      id: raw.id as string,
      schemaVersion: version,
      questionId: raw.question_id as string,
      questionType: raw.question_type as InvestigationQuestionType,
      caseId: raw.case_id as string,
      caseType: raw.case_type as string,
      subjectType: raw.subject_type as string,
      subjectId: raw.subject_id as string,
      answerCode: raw.answer_code as string,
      questionTextHe: raw.question_text as string,
      caseFactsFingerprint: raw.case_facts_fingerprint as string,
      note: raw.note as string | null,
      answeredAt: new Date(raw.created_at as string).toISOString(),
      scope: "CASE_INSTANCE",
      provenance,
      caseSchemaVersion: raw.case_schema_version as string,
      supersedesId: raw.supersedes_id as string | null,
    },
  };
}
