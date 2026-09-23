/**
 * Redbloods Partner — Owner Context persistence core (Phase F.1E + v2).
 * Append-only store over public.partner_owner_context.
 *
 * Same proven shape as the feedback persistence core (Phase F.1B):
 *   - the client is INJECTED (tests drive this exact code against an
 *     in-memory fake; production is never written by tests); context-store.ts
 *     is the only file that binds it to the real service-role client and the
 *     only one that imports "server-only";
 *   - `OwnerContextTableClient` exposes only `select` and `insert` — there is
 *     no update / delete / upsert path. A changed answer is a NEW row with
 *     supersedesId pointing at the prior one;
 *   - appends THROW a typed OwnerContextStoreError; reads RETURN a
 *     discriminated result. A DB failure is never an empty history.
 *
 * v2 (structured answers + follow-ups):
 *   - the caller picks an answer CODE (plus a date only for an explicit-date
 *     answer); the store resolves the value on the server from the
 *     Asia/Jerusalem calendar — a caller can never supply a resolved value;
 *   - a follow-up answer carries the exact Owner Context that triggered it
 *     (triggerContextId, never rewritten). A revision keeps question, Case,
 *     subject AND trigger. One live chain per slot (questionId, trigger):
 *     a second root is rejected (ANSWER_EXISTS_USE_REVISION) — also enforced
 *     by the DB's one-root-per-slot unique index;
 *   - "current" means CURRENT_APPLICABLE (context-applicability.ts): a
 *     follow-up whose trigger no longer supports it stays in history but is
 *     not returned as current.
 *
 * Provider- and UI-independent by design: structured domain records in and
 * out, no chat text, no AI, no browser concept. The table is the source of
 * truth for any caller (UI, backend job, a future conversational layer).
 *
 * Read ordering (every read): created_at ASC, then id ASC — in SQL and again
 * in application code. Reads page through the table.
 */
import { ilYmd } from "../../coo/dates";
import { redactSecrets } from "../feedback/persistence";
import { isValidYmd, resolveAnswerValue } from "./answer-value";
import { classifyOwnerContexts, triggerSupportsFollowUp, type ContextApplicability } from "./context-applicability";
import {
  OWNER_CONTEXT_COLUMNS, OWNER_CONTEXT_SCHEMA_VERSION, PARTNER_OWNER_CONTEXT_TABLE,
  deriveQuestionId, isAnswerCodeValidFor, isKnownQuestionType, mapOwnerContextRow, parseContextProvenance,
  type OwnerContextInsertRow, type PersistedOwnerContext,
} from "./context-row";
import { isFollowUpQuestionType, triggersFollowUp } from "./questions";
import type { InvestigationQuestionType, PartnerInvestigationQuestion } from "./types";

// ── injected client: minimal Supabase-shaped surface (select + insert ONLY) ──

export interface ContextDbError { code?: string; message?: string; details?: string | null }
export interface ContextDbResponse<T> { data: T | null; error: ContextDbError | null }

export interface ContextSelectQuery extends PromiseLike<ContextDbResponse<unknown[]>> {
  eq(column: string, value: string): ContextSelectQuery;
  order(column: string, options: { ascending: boolean }): ContextSelectQuery;
  range(from: number, to: number): ContextSelectQuery;
  maybeSingle(): PromiseLike<ContextDbResponse<unknown>>;
}

export interface OwnerContextTableClient {
  from(table: typeof PARTNER_OWNER_CONTEXT_TABLE): {
    select(columns: string): ContextSelectQuery;
    insert(row: OwnerContextInsertRow): { select(columns: string): { single(): PromiseLike<ContextDbResponse<unknown>> } };
  };
}

// ── typed errors ──

export type OwnerContextStoreErrorCode =
  | "VALIDATION_FAILED"            // draft rejected before any DB write
  | "INVALID_QUESTION_IDENTITY"    // questionId ≠ caseId::questionType, or unknown questionType
  | "INVALID_ANSWER_CODE"          // answerCode not offered by that questionType
  | "INVALID_ANSWER_VALUE"         // value / explicit date / anchor rejected by the question's value spec
  | "INVALID_TRIGGER"              // follow-up without trigger, root with trigger, wrong / non-current / other-Case trigger
  | "ANSWER_EXISTS_USE_REVISION"   // a live answer already exists for this question — supersede it instead
  | "SUPERSEDED_NOT_FOUND"
  | "REVISION_TARGET_MISMATCH"     // revision of a different question / Case / subject / trigger
  | "REVISION_BRANCH_CONFLICT"     // the superseded row already has a successor (pre-check OR DB unique index)
  | "DUPLICATE_CONTEXT_ID"
  | "UNSUPPORTED_CONTEXT_SCHEMA"
  | "INVALID_STORED_ROW"
  | "INVALID_REVISION_GRAPH"
  | "INVALID_QUERY"
  | "READ_FAILED"
  | "WRITE_FAILED";

export class OwnerContextStoreError extends Error {
  readonly code: OwnerContextStoreErrorCode;
  readonly details: readonly string[];
  constructor(code: OwnerContextStoreErrorCode, message: string, details: readonly string[] = []) {
    super(`[${code}] ${message}`);
    this.name = "OwnerContextStoreError";
    this.code = code;
    this.details = details;
  }
}

function describeDbError(e: ContextDbError | unknown): string {
  if (e && typeof e === "object") {
    const { code, message } = e as ContextDbError;
    return redactSecrets(`${code ?? "no-code"}: ${message ?? "no message"}`);
  }
  return redactSecrets(String(e));
}

// ── results ──

export interface RejectedContextRow { id: string | null; code: "UNSUPPORTED_CONTEXT_SCHEMA" | "INVALID_STORED_ROW"; errors: string[] }

export type OwnerContextHistoryResult =
  | { status: "OK"; contexts: PersistedOwnerContext[] }
  | { status: "NO_CONTEXT"; contexts: [] }
  | { status: "READ_FAILED"; error: OwnerContextStoreError }
  /** Fail-closed: any unreadable row → no partial history. */
  | { status: "INVALID_STORED_ROWS"; rejected: RejectedContextRow[] };

export type ContextGraphDiagnosticKind =
  | "BRANCH" | "SELF_SUPERSESSION" | "DANGLING_SUPERSEDES" | "TARGET_MISMATCH" | "CYCLE"
  | "TRIGGER_MISMATCH" | "DANGLING_TRIGGER" | "TRIGGER_CASE_MISMATCH" | "DUPLICATE_ROOT";
export interface ContextGraphDiagnostic { kind: ContextGraphDiagnosticKind; contextIds: string[]; message: string }

export type CurrentOwnerContextsResult =
  | {
      status: "OK";
      /** CURRENT_APPLICABLE only — what downstream logic may consume. */
      contexts: PersistedOwnerContext[];
      /** Terminal but no longer supported by their trigger — history, not current. */
      notApplicable: Array<{ context: PersistedOwnerContext; applicability: ContextApplicability }>;
      historyCount: number;
    }
  | { status: "NO_CONTEXT"; contexts: [] }
  | { status: "READ_FAILED"; error: OwnerContextStoreError }
  | { status: "INVALID_STORED_ROWS"; rejected: RejectedContextRow[] }
  /** Never guessed around: no current answers are returned, only diagnostics. */
  | { status: "INVALID_REVISION_GRAPH"; diagnostics: ContextGraphDiagnostic[] };

export type CurrentContextForQuestionResult =
  | { status: "CURRENT"; context: PersistedOwnerContext; historyCount: number }
  /** The question's latest answer exists in history but its trigger no longer supports it. */
  | { status: "NOT_APPLICABLE"; context: PersistedOwnerContext; applicability: ContextApplicability }
  | { status: "NO_CONTEXT"; contexts: [] }
  | { status: "READ_FAILED"; error: OwnerContextStoreError }
  | { status: "INVALID_STORED_ROWS"; rejected: RejectedContextRow[] }
  | { status: "INVALID_REVISION_GRAPH"; diagnostics: ContextGraphDiagnostic[] };

export type OwnerContextFilter =
  | { questionId: string }
  | { caseId: string }
  | { caseType: string }
  | { subjectType: string; subjectId: string };

// ── pure helpers ──

/** created_at (answeredAt) ASC, then id ASC. */
export function compareContextOrder(a: PersistedOwnerContext, b: PersistedOwnerContext): number {
  const d = Date.parse(a.answeredAt) - Date.parse(b.answeredAt);
  if (d !== 0) return d;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

type Target = Pick<PersistedOwnerContext, "questionId" | "caseId" | "caseType" | "subjectType" | "subjectId" | "triggerContextId">;
/** A revision may only supersede a row about the SAME question, Case, subject and trigger. */
export function sameContextTarget(a: Target, b: Target): boolean {
  return a.questionId === b.questionId && a.caseId === b.caseId && a.caseType === b.caseType
    && a.subjectType === b.subjectType && a.subjectId === b.subjectId && a.triggerContextId === b.triggerContextId;
}

const slotKey = (c: Pick<PersistedOwnerContext, "questionId" | "triggerContextId">) => `${c.questionId}|${c.triggerContextId ?? ""}`;

/** Full-graph integrity check — must run on the COMPLETE history (a subset can hide a successor or a trigger). */
export function analyzeOwnerContextGraph(history: readonly PersistedOwnerContext[]): ContextGraphDiagnostic[] {
  const diagnostics: ContextGraphDiagnostic[] = [];
  const byId = new Map(history.map((c) => [c.id, c]));
  const successors = new Map<string, string[]>();
  for (const c of history) if (c.supersedesId !== null) successors.set(c.supersedesId, [...(successors.get(c.supersedesId) ?? []), c.id]);
  for (const [prior, ids] of [...successors.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (ids.length > 1) diagnostics.push({ kind: "BRANCH", contextIds: [prior, ...[...ids].sort()], message: `${prior} has ${ids.length} direct successors` });
  }
  const roots = new Map<string, string[]>();
  for (const c of history) if (c.supersedesId === null) roots.set(slotKey(c), [...(roots.get(slotKey(c)) ?? []), c.id]);
  for (const [slot, ids] of [...roots.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (ids.length > 1) diagnostics.push({ kind: "DUPLICATE_ROOT", contextIds: [...ids].sort(), message: `${ids.length} independent answers for the same slot ${slot}` });
  }
  for (const c of history) {
    if (c.triggerContextId !== null) {
      const t = byId.get(c.triggerContextId);
      if (!t) diagnostics.push({ kind: "DANGLING_TRIGGER", contextIds: [c.id, c.triggerContextId], message: `${c.id} is triggered by ${c.triggerContextId}, which is not in the history` });
      else if (t.caseId !== c.caseId || t.caseType !== c.caseType || t.subjectType !== c.subjectType || t.subjectId !== c.subjectId) {
        diagnostics.push({ kind: "TRIGGER_CASE_MISMATCH", contextIds: [t.id, c.id], message: `${c.id} is triggered by a context about another Case/subject` });
      }
    }
    if (c.supersedesId === null) continue;
    if (c.supersedesId === c.id) { diagnostics.push({ kind: "SELF_SUPERSESSION", contextIds: [c.id], message: `${c.id} supersedes itself` }); continue; }
    const prior = byId.get(c.supersedesId);
    if (!prior) { diagnostics.push({ kind: "DANGLING_SUPERSEDES", contextIds: [c.id, c.supersedesId], message: `${c.id} supersedes ${c.supersedesId}, which is not in the history` }); continue; }
    if (prior.triggerContextId !== c.triggerContextId) diagnostics.push({ kind: "TRIGGER_MISMATCH", contextIds: [prior.id, c.id], message: `${c.id} revises ${prior.id} but changes its trigger` });
    else if (!sameContextTarget(c, prior)) diagnostics.push({ kind: "TARGET_MISMATCH", contextIds: [prior.id, c.id], message: `${c.id} supersedes ${prior.id} across different questions/Cases/subjects` });
  }
  const reported = new Set<string>();
  for (const start of history) {
    const seen = new Set<string>([start.id]);
    let cur = start.supersedesId ? byId.get(start.supersedesId) : undefined;
    while (cur && cur.id !== start.id && !seen.has(cur.id)) { seen.add(cur.id); cur = cur.supersedesId ? byId.get(cur.supersedesId) : undefined; }
    if (cur && cur.id === start.id && start.supersedesId !== start.id) {
      const ids = [...seen].sort();
      if (!reported.has(ids.join())) { reported.add(ids.join()); diagnostics.push({ kind: "CYCLE", contextIds: ids, message: `revision cycle: ${ids.join(" → ")}` }); }
    }
  }
  return diagnostics.sort((a, b) => a.kind.localeCompare(b.kind) || a.contextIds.join().localeCompare(b.contextIds.join()));
}

/** Terminal row of each revision chain. Assumes a valid graph — callers check first. */
export function terminalContexts(history: readonly PersistedOwnerContext[]): PersistedOwnerContext[] {
  const superseded = new Set(history.map((c) => c.supersedesId).filter((id): id is string => id !== null));
  return history.filter((c) => !superseded.has(c.id)).sort(compareContextOrder);
}

function matchesFilter(c: PersistedOwnerContext, f: OwnerContextFilter | undefined): boolean {
  if (!f) return true;
  if ("questionId" in f) return c.questionId === f.questionId;
  if ("caseId" in f) return c.caseId === f.caseId;
  if ("caseType" in f) return c.caseType === f.caseType;
  return c.subjectType === f.subjectType && c.subjectId === f.subjectId;
}

// ── append input ──

/**
 * What a caller hands the store. No id / createdAt / answeredAt / schema
 * version / resolved answerValue: the DB assigns id + created_at, the store
 * stamps the schema version and resolves the value. Supplying any of them is
 * VALIDATION_FAILED.
 */
export interface OwnerContextDraft {
  questionId: string;
  questionType: InvestigationQuestionType;
  /** The exact wording shown to the Owner. Persisted as-is; never regenerated. */
  questionText: string;
  caseId: string;
  caseType: string;
  caseSchemaVersion: string;
  caseFactsFingerprint: string;
  subjectType: string;
  subjectId: string;
  answerCode: string;
  /** Only for an explicit-date answer (e.g. SPECIFIC_DATE): YYYY-MM-DD. Must be null everywhere else. */
  explicitDateYmd: string | null;
  /**
   * The Israel calendar date the Owner actually answered. null = today (server clock). An explicit date is only for
   * an answer captured outside the system: never in the future, never before the trigger's own answer date.
   */
  answeredOnYmd: string | null;
  /** null for a Case question; the exact triggering Owner Context for a follow-up (from question.origin). */
  triggerContextId: string | null;
  note: string | null;
  scope: "CASE_INSTANCE";
  provenance: { source: "owner_manual" };
  supersedesId: string | null;
}

/** Builds a draft from the question the Owner was actually shown. Pure; the store still validates everything. */
export function buildOwnerContextDraft(
  question: PartnerInvestigationQuestion,
  caseSchemaVersion: string,
  input: { answerCode: string; note?: string | null; supersedesId?: string | null; explicitDateYmd?: string | null; answeredOnYmd?: string | null },
): OwnerContextDraft {
  return {
    questionId: question.id,
    questionType: question.questionType,
    questionText: question.questionTextHe,
    caseId: question.caseId,
    caseType: question.caseType,
    caseSchemaVersion,
    caseFactsFingerprint: question.caseFactsFingerprint,
    subjectType: question.subjectType,
    subjectId: question.subjectId,
    answerCode: input.answerCode,
    explicitDateYmd: input.explicitDateYmd ?? null,
    answeredOnYmd: input.answeredOnYmd ?? null,
    triggerContextId: question.origin.kind === "OWNER_CONTEXT" ? question.origin.triggerContextId : null,
    note: input.note ?? null,
    scope: "CASE_INSTANCE",
    provenance: { source: "owner_manual" },
    supersedesId: input.supersedesId ?? null,
  };
}

const DRAFT_KEYS = ["questionId", "questionType", "questionText", "caseId", "caseType", "caseSchemaVersion", "caseFactsFingerprint", "subjectType", "subjectId", "answerCode", "explicitDateYmd", "answeredOnYmd", "triggerContextId", "note", "scope", "provenance", "supersedesId"];
const STORE_ASSIGNED_KEYS = ["id", "createdAt", "answeredAt", "schemaVersion", "contextSchemaVersion", "answerValue"];
const LOWER_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const uuidOrNull = (v: unknown) => v === null || (typeof v === "string" && LOWER_UUID_RE.test(v));

interface ValidatedDraft {
  base: Omit<OwnerContextInsertRow, "answer_value">;
  questionType: InvestigationQuestionType;
  explicitDateYmd: string | null;
  answeredOnYmd: string | null;
}

/** Shape / identity / answer-code validation of a draft. Never coerces. No DB access. */
function validateDraftShape(input: unknown): ValidatedDraft {
  if (typeof input !== "object" || input === null || Array.isArray(input)) throw new OwnerContextStoreError("VALIDATION_FAILED", "owner context draft must be an object");
  const raw = input as Record<string, unknown>;
  const errors: string[] = [];
  for (const k of Object.keys(raw)) {
    if (STORE_ASSIGNED_KEYS.includes(k)) errors.push(`"${k}" is assigned by the database/store and cannot be supplied by a caller`);
    else if (!DRAFT_KEYS.includes(k)) errors.push(`unknown key "${k}"`);
  }
  for (const k of ["questionId", "questionText", "caseId", "caseType", "caseSchemaVersion", "caseFactsFingerprint", "subjectType", "subjectId", "answerCode"]) {
    if (typeof raw[k] !== "string" || (raw[k] as string).length === 0) errors.push(`${k}: must be a non-empty string`);
  }
  for (const k of ["explicitDateYmd", "answeredOnYmd", "triggerContextId", "note", "supersedesId"]) if (!(k in raw)) errors.push(`${k}: required (null when absent)`);
  if (raw.note !== null && typeof raw.note !== "string") errors.push("note: must be a string or null");
  if (raw.scope !== "CASE_INSTANCE") errors.push(`scope ${JSON.stringify(raw.scope)} is not supported (CASE_INSTANCE only — never broadened automatically)`);
  if (!uuidOrNull(raw.supersedesId)) errors.push("supersedesId: must be a lowercase uuid or null");
  if (!uuidOrNull(raw.triggerContextId)) errors.push("triggerContextId: must be a lowercase uuid or null");
  if (raw.explicitDateYmd !== null && typeof raw.explicitDateYmd !== "string") errors.push("explicitDateYmd: must be a YYYY-MM-DD string or null");
  if (raw.answeredOnYmd !== null && !isValidYmd(raw.answeredOnYmd)) errors.push("answeredOnYmd: must be a real YYYY-MM-DD date or null");
  const provenance = parseContextProvenance(raw.provenance, errors);
  if (errors.length || !provenance) throw new OwnerContextStoreError("VALIDATION_FAILED", "owner context draft failed runtime validation", errors);

  if (!isKnownQuestionType(raw.questionType)) throw new OwnerContextStoreError("INVALID_QUESTION_IDENTITY", `questionType ${JSON.stringify(raw.questionType)} is not in the investigation taxonomy`);
  const expectedId = deriveQuestionId(raw.caseId as string, raw.questionType);
  if (raw.questionId !== expectedId) throw new OwnerContextStoreError("INVALID_QUESTION_IDENTITY", "questionId must equal caseId::questionType", [`expected ${expectedId}`, `got ${String(raw.questionId)}`]);
  if (!isAnswerCodeValidFor(raw.questionType, raw.answerCode)) throw new OwnerContextStoreError("INVALID_ANSWER_CODE", `answerCode ${JSON.stringify(raw.answerCode)} is not an answer of ${raw.questionType} (use OTHER + note)`);

  const followUp = isFollowUpQuestionType(raw.questionType);
  if (followUp && raw.triggerContextId === null) throw new OwnerContextStoreError("INVALID_TRIGGER", `${raw.questionType} is a follow-up question — triggerContextId is required`);
  if (!followUp && raw.triggerContextId !== null) throw new OwnerContextStoreError("INVALID_TRIGGER", `${raw.questionType} is generated from the Case — triggerContextId must be null`);

  return {
    questionType: raw.questionType,
    explicitDateYmd: raw.explicitDateYmd as string | null,
    answeredOnYmd: raw.answeredOnYmd as string | null,
    base: {
      context_schema_version: OWNER_CONTEXT_SCHEMA_VERSION,
      question_id: raw.questionId as string,
      question_type: raw.questionType,
      question_text: raw.questionText as string,
      case_id: raw.caseId as string,
      case_type: raw.caseType as string,
      case_schema_version: raw.caseSchemaVersion as string,
      case_facts_fingerprint: raw.caseFactsFingerprint as string,
      subject_type: raw.subjectType as string,
      subject_id: raw.subjectId as string,
      answer_code: raw.answerCode as string,
      note: raw.note as string | null,
      scope: "CASE_INSTANCE",
      provenance,
      supersedes_id: raw.supersedesId as string | null,
      trigger_context_id: raw.triggerContextId as string | null,
    },
  };
}

// ── the store ──

export interface OwnerContextStore {
  appendOwnerContext(draft: OwnerContextDraft): Promise<PersistedOwnerContext>;
  /** Full history, created_at ASC then id ASC. */
  listOwnerContexts(): Promise<OwnerContextHistoryResult>;
  /** Complete revision history of one question (not only the latest). */
  getContextsForQuestion(questionId: string): Promise<OwnerContextHistoryResult>;
  getContextsForCase(caseId: string): Promise<OwnerContextHistoryResult>;
  /** Exact match on the indexed subject_type + subject_id columns. No fuzzy matching, no JSON scan. */
  getContextsForSubject(subjectType: string, subjectId: string): Promise<OwnerContextHistoryResult>;
  getContextsForCaseType(caseType: string): Promise<OwnerContextHistoryResult>;
  /** CURRENT_APPLICABLE answers, resolved over the FULL history (graph + applicability), then filtered. */
  resolveCurrentOwnerContexts(filter?: OwnerContextFilter): Promise<CurrentOwnerContextsResult>;
  /** The current applicable answer to one question (the queue's read). */
  getCurrentContextForQuestion(questionId: string): Promise<CurrentContextForQuestionResult>;
}

export interface OwnerContextStoreOptions {
  /** Server clock. Injected for tests; the Israel calendar date is derived from it (lib/coo/dates ilYmd). */
  now?: () => Date;
}

export const CONTEXT_PAGE_SIZE = 1000;

export function createOwnerContextStore(client: OwnerContextTableClient, options: OwnerContextStoreOptions = {}): OwnerContextStore {
  const table = () => client.from(PARTNER_OWNER_CONTEXT_TABLE);
  const now = options.now ?? (() => new Date());

  async function readHistory(filters: ReadonlyArray<readonly [string, string]>): Promise<OwnerContextHistoryResult> {
    const rows: unknown[] = [];
    for (let from = 0; ; from += CONTEXT_PAGE_SIZE) {
      let q = table().select(OWNER_CONTEXT_COLUMNS);
      for (const [col, val] of filters) q = q.eq(col, val);
      q = q.order("created_at", { ascending: true }).order("id", { ascending: true }).range(from, from + CONTEXT_PAGE_SIZE - 1);
      let res: ContextDbResponse<unknown[]>;
      try { res = await q; } catch (e) {
        return { status: "READ_FAILED", error: new OwnerContextStoreError("READ_FAILED", `partner_owner_context read threw: ${describeDbError(e)}`) };
      }
      if (res.error) return { status: "READ_FAILED", error: new OwnerContextStoreError("READ_FAILED", `partner_owner_context read failed: ${describeDbError(res.error)}`) };
      if (!Array.isArray(res.data)) return { status: "READ_FAILED", error: new OwnerContextStoreError("READ_FAILED", "partner_owner_context read returned no data array") };
      rows.push(...res.data);
      if (res.data.length < CONTEXT_PAGE_SIZE) break;
    }
    const contexts: PersistedOwnerContext[] = [];
    const rejected: RejectedContextRow[] = [];
    for (const row of rows) {
      const m = mapOwnerContextRow(row);
      if (m.ok) contexts.push(m.value);
      else rejected.push({ id: row && typeof row === "object" && typeof (row as { id?: unknown }).id === "string" ? (row as { id: string }).id : null, code: m.code, errors: m.errors });
    }
    if (rejected.length) return { status: "INVALID_STORED_ROWS", rejected };
    if (!contexts.length) return { status: "NO_CONTEXT", contexts: [] };
    return { status: "OK", contexts: contexts.sort(compareContextOrder) };
  }

  const requireKey = (name: string, v: unknown): string => {
    if (typeof v !== "string" || v.length === 0) throw new OwnerContextStoreError("INVALID_QUERY", `${name} must be a non-empty string`);
    return v;
  };
  const validateFilter = (f?: OwnerContextFilter) => {
    if (!f) return;
    if ("questionId" in f) requireKey("questionId", f.questionId);
    else if ("caseId" in f) requireKey("caseId", f.caseId);
    else if ("caseType" in f) requireKey("caseType", f.caseType);
    else { requireKey("subjectType", f.subjectType); requireKey("subjectId", f.subjectId); }
  };

  /** The full, valid history — the basis for every append check and every "current" read. */
  async function validHistory(): Promise<{ ok: true; history: PersistedOwnerContext[] } | { ok: false; result: Exclude<CurrentOwnerContextsResult, { status: "OK" }> }> {
    const h = await readHistory([]);
    if (h.status === "NO_CONTEXT") return { ok: true, history: [] };
    if (h.status !== "OK") return { ok: false, result: h };
    const diagnostics = analyzeOwnerContextGraph(h.contexts);
    if (diagnostics.length) return { ok: false, result: { status: "INVALID_REVISION_GRAPH", diagnostics } };
    return { ok: true, history: h.contexts };
  }

  async function resolveCurrent(filter?: OwnerContextFilter): Promise<CurrentOwnerContextsResult> {
    validateFilter(filter);
    const v = await validHistory();
    if (!v.ok) return v.result;
    if (!v.history.length) return { status: "NO_CONTEXT", contexts: [] };
    const cls = classifyOwnerContexts(v.history);
    const inScope = v.history.filter((c) => matchesFilter(c, filter));
    const contexts = inScope.filter((c) => cls.get(c.id)?.status === "CURRENT_APPLICABLE").sort(compareContextOrder);
    const notApplicable = inScope.filter((c) => cls.get(c.id)?.status === "NOT_APPLICABLE_TRIGGER_SUPERSEDED").sort(compareContextOrder).map((c) => ({ context: c, applicability: cls.get(c.id)! }));
    if (!contexts.length && !notApplicable.length) return { status: "NO_CONTEXT", contexts: [] };
    return { status: "OK", contexts, notApplicable, historyCount: v.history.length };
  }

  return {
    async appendOwnerContext(draft) {
      const d = validateDraftShape(draft);

      // All relational checks run against ONE full, graph-valid read of the history.
      const v = await validHistory();
      if (!v.ok) {
        const r = v.result;
        if (r.status === "READ_FAILED") throw r.error;
        if (r.status === "INVALID_STORED_ROWS") throw new OwnerContextStoreError("INVALID_STORED_ROW", "existing history is not readable — refusing to append", r.rejected.map((x) => `${x.id}: ${x.code}`));
        throw new OwnerContextStoreError("INVALID_REVISION_GRAPH", "existing history has an invalid revision graph — refusing to append", r.status === "INVALID_REVISION_GRAPH" ? r.diagnostics.map((x) => `${x.kind}: ${x.message}`) : []);
      }
      const history = v.history;
      const byId = new Map(history.map((c) => [c.id, c]));
      const cls = classifyOwnerContexts(history);
      const row = d.base;

      // Anchor date: the server's Israel calendar; an explicit earlier date only for an answer captured outside the system.
      const todayIl = ilYmd(now());
      const anchorYmd = d.answeredOnYmd ?? todayIl;
      if (anchorYmd > todayIl) throw new OwnerContextStoreError("INVALID_ANSWER_VALUE", `answeredOnYmd ${anchorYmd} is in the future (today ${todayIl}, Asia/Jerusalem)`);

      // Trigger (follow-ups): exact row, same Case/subject, triggering answer, and still effectively current.
      if (row.trigger_context_id !== null) {
        const t = byId.get(row.trigger_context_id);
        if (!t) throw new OwnerContextStoreError("INVALID_TRIGGER", `trigger context ${row.trigger_context_id} does not exist`);
        if (t.caseId !== row.case_id || t.caseType !== row.case_type || t.subjectType !== row.subject_type || t.subjectId !== row.subject_id) {
          throw new OwnerContextStoreError("INVALID_TRIGGER", "the trigger context is about a different Case/subject");
        }
        if (!triggersFollowUp(t.questionType, t.answerCode, d.questionType)) {
          throw new OwnerContextStoreError("INVALID_TRIGGER", `${t.questionType}:${t.answerCode} does not trigger ${d.questionType}`);
        }
        // Effectively current: the trigger's chain still supports this follow-up — the same rule applicability uses for the child.
        const support = triggerSupportsFollowUp(history, t.id, d.questionType);
        if (!support.ok) throw new OwnerContextStoreError("INVALID_TRIGGER", "the trigger is no longer current / no longer supports this follow-up", support.reasons);
        if (anchorYmd < ilYmd(new Date(t.answeredAt))) throw new OwnerContextStoreError("INVALID_ANSWER_VALUE", `answeredOnYmd ${anchorYmd} is before the trigger was answered (${ilYmd(new Date(t.answeredAt))})`);
      }

      // Structured value: resolved here, never supplied by the caller.
      const resolved = resolveAnswerValue(d.questionType, row.answer_code, { anchorYmd, explicitYmd: d.explicitDateYmd });
      if (!resolved.ok) throw new OwnerContextStoreError("INVALID_ANSWER_VALUE", "answer value rejected", resolved.errors);

      if (row.supersedes_id !== null) {
        // Revision: same question + Case + subject + trigger; no branch.
        const prior = byId.get(row.supersedes_id);
        if (!prior) throw new OwnerContextStoreError("SUPERSEDED_NOT_FOUND", `supersedesId ${row.supersedes_id} does not exist`);
        const next: Target = { questionId: row.question_id, caseId: row.case_id, caseType: row.case_type, subjectType: row.subject_type, subjectId: row.subject_id, triggerContextId: row.trigger_context_id };
        if (!sameContextTarget(next, prior)) {
          const diffs = (["questionId", "caseId", "caseType", "subjectType", "subjectId", "triggerContextId"] as const).filter((k) => next[k] !== prior[k]).map((k) => `${k}: prior=${prior[k]} revision=${next[k]}`);
          throw new OwnerContextStoreError("REVISION_TARGET_MISMATCH", `a revision must answer the SAME question about the SAME Case, subject and trigger as ${prior.id}`, diffs);
        }
        if (history.some((c) => c.supersedesId === prior.id)) throw new OwnerContextStoreError("REVISION_BRANCH_CONFLICT", `context ${prior.id} already has a successor — revise the current (terminal) answer instead`);
      } else {
        // New root: nothing already answers this slot, and no other live answer to this question applies.
        const sameSlot = history.find((c) => c.questionId === row.question_id && c.triggerContextId === row.trigger_context_id);
        if (sameSlot) throw new OwnerContextStoreError("ANSWER_EXISTS_USE_REVISION", `question ${row.question_id} is already answered in this slot — supersede the current answer instead`, [sameSlot.id]);
        const liveOther = history.find((c) => c.questionId === row.question_id && cls.get(c.id)?.status === "CURRENT_APPLICABLE");
        if (liveOther) throw new OwnerContextStoreError("ANSWER_EXISTS_USE_REVISION", `question ${row.question_id} already has a current applicable answer — supersede it instead`, [liveOther.id]);
      }

      const insert: OwnerContextInsertRow = { ...row, answer_value: resolved.value };
      let res: ContextDbResponse<unknown>;
      try { res = await table().insert(insert).select(OWNER_CONTEXT_COLUMNS).single(); } catch (e) {
        throw new OwnerContextStoreError("WRITE_FAILED", `partner_owner_context insert threw: ${describeDbError(e)}`);
      }
      if (res.error) {
        const detail = describeDbError(res.error);
        const text = `${res.error.message ?? ""} ${res.error.details ?? ""}`;
        if (res.error.code === "23505" && /one_root_per_slot/i.test(text)) throw new OwnerContextStoreError("ANSWER_EXISTS_USE_REVISION", "another answer for this slot was written concurrently (DB unique index)", [detail]);
        if (res.error.code === "23505" && /supersedes/i.test(text)) throw new OwnerContextStoreError("REVISION_BRANCH_CONFLICT", `context ${row.supersedes_id} already has a successor (DB unique index)`, [detail]);
        if (res.error.code === "23505") throw new OwnerContextStoreError("DUPLICATE_CONTEXT_ID", "DB-generated context id collided", [detail]);
        if (res.error.code === "23503" && /trigger/i.test(text)) throw new OwnerContextStoreError("INVALID_TRIGGER", `trigger context ${String(row.trigger_context_id)} does not exist (DB foreign key)`, [detail]);
        if (res.error.code === "23503") throw new OwnerContextStoreError("SUPERSEDED_NOT_FOUND", `supersedesId ${String(row.supersedes_id)} does not exist for this question (DB composite foreign key)`, [detail]);
        throw new OwnerContextStoreError("WRITE_FAILED", "partner_owner_context insert failed", [detail]);
      }
      const m = mapOwnerContextRow(res.data);
      if (!m.ok) throw new OwnerContextStoreError(m.code, "context was inserted but its read-back failed validation", m.errors);
      return m.value;
    },

    listOwnerContexts: () => readHistory([]),
    getContextsForQuestion: async (questionId) => readHistory([["question_id", requireKey("questionId", questionId)]]),
    getContextsForCase: async (caseId) => readHistory([["case_id", requireKey("caseId", caseId)]]),
    getContextsForSubject: async (subjectType, subjectId) => readHistory([["subject_type", requireKey("subjectType", subjectType)], ["subject_id", requireKey("subjectId", subjectId)]]),
    getContextsForCaseType: async (caseType) => readHistory([["case_type", requireKey("caseType", caseType)]]),
    resolveCurrentOwnerContexts: (filter) => resolveCurrent(filter),

    async getCurrentContextForQuestion(questionId) {
      const r = await resolveCurrent({ questionId: requireKey("questionId", questionId) });
      if (r.status !== "OK") return r;
      if (r.contexts.length) return { status: "CURRENT", context: r.contexts[r.contexts.length - 1], historyCount: r.historyCount };
      const last = r.notApplicable[r.notApplicable.length - 1];
      return { status: "NOT_APPLICABLE", context: last.context, applicability: last.applicability };
    },
  };
}
