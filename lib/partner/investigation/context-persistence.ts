/**
 * Redbloods Partner — Owner Context persistence core (Phase F.1E).
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
 *     discriminated result (OK / NO_CONTEXT / READ_FAILED /
 *     INVALID_STORED_ROWS, plus INVALID_REVISION_GRAPH for current-answer
 *     resolution). A DB failure is never an empty history.
 *
 * Provider- and UI-independent by design: structured domain records in and
 * out, no chat text, no AI, no browser concept. Any future caller (Partner
 * UI, backend job, a conversational layer) uses the same primitives; none of
 * them becomes the source of truth — this table is.
 *
 * Read ordering (every read): created_at ASC, then id ASC — in SQL and again
 * in application code. Reads page through the table so a PostgREST max-rows
 * cap can never silently truncate history.
 */
import { redactSecrets } from "../feedback/persistence";
import {
  OWNER_CONTEXT_COLUMNS, OWNER_CONTEXT_SCHEMA_VERSION, PARTNER_OWNER_CONTEXT_TABLE,
  deriveQuestionId, isAnswerCodeValidFor, isKnownQuestionType, mapOwnerContextRow, parseContextProvenance,
  type OwnerContextInsertRow, type PersistedOwnerContext,
} from "./context-row";
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
  | "VALIDATION_FAILED"            // draft rejected before any DB call
  | "INVALID_QUESTION_IDENTITY"    // questionId ≠ caseId::questionType, or unknown questionType
  | "INVALID_ANSWER_CODE"          // answerCode not offered by that questionType
  | "SUPERSEDED_NOT_FOUND"
  | "REVISION_TARGET_MISMATCH"     // revision of a different question / Case / subject
  | "REVISION_BRANCH_CONFLICT"     // the superseded row already has a successor (pre-check OR DB unique index)
  | "DUPLICATE_CONTEXT_ID"
  | "UNSUPPORTED_CONTEXT_SCHEMA"
  | "INVALID_STORED_ROW"
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

export type ContextGraphDiagnosticKind = "BRANCH" | "SELF_SUPERSESSION" | "DANGLING_SUPERSEDES" | "TARGET_MISMATCH" | "CYCLE";
export interface ContextGraphDiagnostic { kind: ContextGraphDiagnosticKind; contextIds: string[]; message: string }

export type CurrentOwnerContextsResult =
  | { status: "OK"; contexts: PersistedOwnerContext[]; historyCount: number }
  | { status: "NO_CONTEXT"; contexts: [] }
  | { status: "READ_FAILED"; error: OwnerContextStoreError }
  | { status: "INVALID_STORED_ROWS"; rejected: RejectedContextRow[] }
  /** Never guessed around: no current answers are returned, only diagnostics. */
  | { status: "INVALID_REVISION_GRAPH"; diagnostics: ContextGraphDiagnostic[] };

export type CurrentContextForQuestionResult =
  | { status: "CURRENT"; context: PersistedOwnerContext; historyCount: number }
  | Exclude<CurrentOwnerContextsResult, { status: "OK" }>;

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

/** A revision may only supersede a row about the SAME question, Case and subject. */
export function sameContextTarget(a: Pick<PersistedOwnerContext, "questionId" | "caseId" | "caseType" | "subjectType" | "subjectId">, b: typeof a): boolean {
  return a.questionId === b.questionId && a.caseId === b.caseId && a.caseType === b.caseType && a.subjectType === b.subjectType && a.subjectId === b.subjectId;
}

/** Full-graph integrity check — must run on the COMPLETE history (a subset can hide a successor). */
export function analyzeOwnerContextGraph(history: readonly PersistedOwnerContext[]): ContextGraphDiagnostic[] {
  const diagnostics: ContextGraphDiagnostic[] = [];
  const byId = new Map(history.map((c) => [c.id, c]));
  const successors = new Map<string, string[]>();
  for (const c of history) if (c.supersedesId !== null) successors.set(c.supersedesId, [...(successors.get(c.supersedesId) ?? []), c.id]);
  for (const [prior, ids] of [...successors.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (ids.length > 1) diagnostics.push({ kind: "BRANCH", contextIds: [prior, ...[...ids].sort()], message: `${prior} has ${ids.length} direct successors` });
  }
  for (const c of history) {
    if (c.supersedesId === null) continue;
    if (c.supersedesId === c.id) { diagnostics.push({ kind: "SELF_SUPERSESSION", contextIds: [c.id], message: `${c.id} supersedes itself` }); continue; }
    const prior = byId.get(c.supersedesId);
    if (!prior) { diagnostics.push({ kind: "DANGLING_SUPERSEDES", contextIds: [c.id, c.supersedesId], message: `${c.id} supersedes ${c.supersedesId}, which is not in the history` }); continue; }
    if (!sameContextTarget(c, prior)) diagnostics.push({ kind: "TARGET_MISMATCH", contextIds: [prior.id, c.id], message: `${c.id} supersedes ${prior.id} across different questions/Cases/subjects` });
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

/** Terminal row of each revision chain (never referenced as someone's supersedesId). Assumes a valid graph — callers check first. */
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
 * What a caller hands the store. No id, no createdAt/answeredAt, no schema
 * version: the DB assigns id + created_at, the store stamps
 * OWNER_CONTEXT_SCHEMA_VERSION. Passing any of them is VALIDATION_FAILED.
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
  note: string | null;
  scope: "CASE_INSTANCE";
  provenance: { source: "owner_manual" };
  supersedesId: string | null;
}

/** Builds a draft from the question the Owner was actually shown. Pure; the store still validates everything. */
export function buildOwnerContextDraft(
  question: PartnerInvestigationQuestion,
  caseSchemaVersion: string,
  input: { answerCode: string; note?: string | null; supersedesId?: string | null },
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
    note: input.note ?? null,
    scope: "CASE_INSTANCE",
    provenance: { source: "owner_manual" },
    supersedesId: input.supersedesId ?? null,
  };
}

const DRAFT_KEYS = ["questionId", "questionType", "questionText", "caseId", "caseType", "caseSchemaVersion", "caseFactsFingerprint", "subjectType", "subjectId", "answerCode", "note", "scope", "provenance", "supersedesId"];
const STORE_ASSIGNED_KEYS = ["id", "createdAt", "answeredAt", "schemaVersion", "contextSchemaVersion"];
const LOWER_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Runtime validation of a draft into an insert row. Never coerces. */
function validateDraft(input: unknown): OwnerContextInsertRow {
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
  if (raw.note !== null && typeof raw.note !== "string") errors.push("note: must be a string or null");
  if (raw.scope !== "CASE_INSTANCE") errors.push(`scope ${JSON.stringify(raw.scope)} is not supported (CASE_INSTANCE only — never broadened automatically)`);
  if (raw.supersedesId !== null && (typeof raw.supersedesId !== "string" || !LOWER_UUID_RE.test(raw.supersedesId))) errors.push("supersedesId: must be a lowercase uuid or null");
  const provenance = parseContextProvenance(raw.provenance, errors);
  if (errors.length || !provenance) throw new OwnerContextStoreError("VALIDATION_FAILED", "owner context draft failed runtime validation", errors);

  // Question identity: known type + deterministic id.
  if (!isKnownQuestionType(raw.questionType)) throw new OwnerContextStoreError("INVALID_QUESTION_IDENTITY", `questionType ${JSON.stringify(raw.questionType)} is not in the investigation taxonomy`);
  const expectedId = deriveQuestionId(raw.caseId as string, raw.questionType);
  if (raw.questionId !== expectedId) throw new OwnerContextStoreError("INVALID_QUESTION_IDENTITY", "questionId must equal caseId::questionType", [`expected ${expectedId}`, `got ${String(raw.questionId)}`]);
  // Answer semantics: the DB only checks format.
  if (!isAnswerCodeValidFor(raw.questionType, raw.answerCode)) throw new OwnerContextStoreError("INVALID_ANSWER_CODE", `answerCode ${JSON.stringify(raw.answerCode)} is not an answer of ${raw.questionType} (use OTHER + note)`);

  return {
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
  /** Current answers = terminal rows of valid revision chains, resolved over the FULL history, then filtered. */
  resolveCurrentOwnerContexts(filter?: OwnerContextFilter): Promise<CurrentOwnerContextsResult>;
  /** The current answer to one question (the queue's read). */
  getCurrentContextForQuestion(questionId: string): Promise<CurrentContextForQuestionResult>;
}

export const CONTEXT_PAGE_SIZE = 1000;

export function createOwnerContextStore(client: OwnerContextTableClient): OwnerContextStore {
  const table = () => client.from(PARTNER_OWNER_CONTEXT_TABLE);

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

  async function loadPrior(id: string): Promise<PersistedOwnerContext> {
    let res: ContextDbResponse<unknown>;
    try { res = await table().select(OWNER_CONTEXT_COLUMNS).eq("id", id).maybeSingle(); } catch (e) {
      throw new OwnerContextStoreError("READ_FAILED", `could not load superseded context: ${describeDbError(e)}`);
    }
    if (res.error) throw new OwnerContextStoreError("READ_FAILED", `could not load superseded context: ${describeDbError(res.error)}`);
    if (res.data === null) throw new OwnerContextStoreError("SUPERSEDED_NOT_FOUND", `supersedesId ${id} does not exist`);
    const m = mapOwnerContextRow(res.data);
    if (!m.ok) throw new OwnerContextStoreError(m.code, `superseded context ${id} is not readable`, m.errors);
    return m.value;
  }

  async function assertNoSuccessor(priorId: string): Promise<void> {
    let res: ContextDbResponse<unknown[]>;
    try { res = await table().select("id").eq("supersedes_id", priorId).range(0, 0); } catch (e) {
      throw new OwnerContextStoreError("READ_FAILED", `could not check existing revisions: ${describeDbError(e)}`);
    }
    if (res.error) throw new OwnerContextStoreError("READ_FAILED", `could not check existing revisions: ${describeDbError(res.error)}`);
    if (res.data && res.data.length > 0) throw new OwnerContextStoreError("REVISION_BRANCH_CONFLICT", `context ${priorId} already has a successor — revise the current (terminal) answer instead`);
  }

  async function resolveCurrent(filter?: OwnerContextFilter): Promise<CurrentOwnerContextsResult> {
    validateFilter(filter);
    const history = await readHistory([]);
    if (history.status !== "OK") return history;
    const diagnostics = analyzeOwnerContextGraph(history.contexts);
    if (diagnostics.length) return { status: "INVALID_REVISION_GRAPH", diagnostics };
    const current = terminalContexts(history.contexts).filter((c) => matchesFilter(c, filter));
    if (!current.length) return { status: "NO_CONTEXT", contexts: [] };
    return { status: "OK", contexts: current, historyCount: history.contexts.length };
  }

  return {
    async appendOwnerContext(draft) {
      const row = validateDraft(draft);

      // No createdAt comparison: the DB's now() on this INSERT is the chronology.
      if (row.supersedes_id !== null) {
        const prior = await loadPrior(row.supersedes_id);
        const next = { questionId: row.question_id, caseId: row.case_id, caseType: row.case_type, subjectType: row.subject_type, subjectId: row.subject_id };
        if (!sameContextTarget(next, prior)) {
          const diffs = (["questionId", "caseId", "caseType", "subjectType", "subjectId"] as const).filter((k) => next[k] !== prior[k]).map((k) => `${k}: prior=${prior[k]} revision=${next[k]}`);
          throw new OwnerContextStoreError("REVISION_TARGET_MISMATCH", `a revision must answer the SAME question about the SAME Case and subject as ${prior.id}`, diffs);
        }
        await assertNoSuccessor(prior.id);
      }

      let res: ContextDbResponse<unknown>;
      try { res = await table().insert(row).select(OWNER_CONTEXT_COLUMNS).single(); } catch (e) {
        throw new OwnerContextStoreError("WRITE_FAILED", `partner_owner_context insert threw: ${describeDbError(e)}`);
      }
      if (res.error) {
        const detail = describeDbError(res.error);
        const text = `${res.error.message ?? ""} ${res.error.details ?? ""}`;
        if (res.error.code === "23505" && /supersedes/i.test(text)) throw new OwnerContextStoreError("REVISION_BRANCH_CONFLICT", `context ${row.supersedes_id} already has a successor (DB unique index)`, [detail]);
        if (res.error.code === "23505") throw new OwnerContextStoreError("DUPLICATE_CONTEXT_ID", "DB-generated context id collided", [detail]);
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
      // A valid graph has at most one terminal row per question (branches are diagnosed above).
      return { status: "CURRENT", context: r.contexts[r.contexts.length - 1], historyCount: r.historyCount };
    },
  };
}

