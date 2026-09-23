/**
 * Redbloods Partner — Structured Owner Feedback (Phase F.1B). Append-only
 * persistence core for public.partner_feedback.
 *
 * Deliberately NOT bound to a concrete Supabase client and NOT "server-only":
 * the client is injected, so scripts/test-partner-feedback-store.ts drives
 * the exact same code against an in-memory fake and production is never
 * written by tests. store.ts is the only file that binds this to the real
 * service-role client (and it is the one that imports "server-only").
 *
 * APPEND-ONLY by construction: `FeedbackTableClient` exposes only
 * `select` and `insert`. There is no update/delete/upsert path to call —
 * changing your mind is a NEW row with `supersedesId` pointing at the prior
 * one (lib/partner/feedback/revisions.ts).
 *
 * Nothing here applies feedback to anything. No Case, detector, threshold,
 * Charter, Owner Rule, baseline or alert is read or written — only the
 * partner_feedback table (Phase F.1B is persistence only).
 *
 * Error semantics:
 *   - append  → resolves with the persisted record, or THROWS a
 *               PartnerFeedbackStoreError (a write never fails silently).
 *   - reads   → resolve with a discriminated result: OK / NO_FEEDBACK /
 *               READ_FAILED / INVALID_STORED_ROWS (and, for revision
 *               resolution, INVALID_REVISION_GRAPH). A DB failure is never
 *               reported as an empty history.
 *
 * Read ordering (every read): created_at ASC, then id ASC — applied in SQL
 * and re-applied in application code, so the order never depends on the
 * adapter. Reads page through the table (PAGE_SIZE rows per request) so a
 * PostgREST max-rows cap can never silently truncate history.
 */
import { validatePartnerFeedback } from "./validate";
import { findRevisionBranches, resolveCurrentRevisions, targetsMatch } from "./revisions";
import { FEEDBACK_SCHEMA_VERSION, type PartnerFeedback, type PartnerFeedbackDraft } from "./types";
import {
  CASE_DERIVED_SCOPES, PARTNER_FEEDBACK_COLUMNS, PARTNER_FEEDBACK_TABLE, draftToInsertRow, mapFeedbackRow,
  parseCaseSnapshot, parseFeedbackDimensions, parseFeedbackTarget, parseProvenance, snapshotIdentityIssues,
  type PartnerFeedbackInsertRow,
} from "./row";

// ── injected client: a minimal Supabase-shaped surface (select + insert ONLY) ──

export interface FeedbackDbError { code?: string; message?: string; details?: string | null }
export interface FeedbackDbResponse<T> { data: T | null; error: FeedbackDbError | null }

export interface FeedbackSelectQuery extends PromiseLike<FeedbackDbResponse<unknown[]>> {
  eq(column: string, value: string): FeedbackSelectQuery;
  order(column: string, options: { ascending: boolean }): FeedbackSelectQuery;
  range(from: number, to: number): FeedbackSelectQuery;
  maybeSingle(): PromiseLike<FeedbackDbResponse<unknown>>;
}

export interface FeedbackTableClient {
  from(table: typeof PARTNER_FEEDBACK_TABLE): {
    select(columns: string): FeedbackSelectQuery;
    insert(row: PartnerFeedbackInsertRow): { select(columns: string): { single(): PromiseLike<FeedbackDbResponse<unknown>> } };
  };
}

// ── typed errors ──

export type PartnerFeedbackStoreErrorCode =
  | "VALIDATION_FAILED"            // input rejected before any DB call
  | "SUBJECT_IDENTITY_MISSING"     // Case-derived feedback without caseId/caseType/subjectType/subjectId on its target
  | "SUBJECT_IDENTITY_MISMATCH"    // Case-derived target identity contradicts its caseSnapshot
  | "SUPERSEDED_NOT_FOUND"         // supersedesId points at no stored row
  | "REVISION_TARGET_MISMATCH"     // revision refers to a different logical target than the row it supersedes
  | "REVISION_BRANCH_CONFLICT"     // the superseded row already has a direct successor (pre-check OR DB unique index)
  | "DUPLICATE_FEEDBACK_ID"        // primary-key collision
  | "UNSUPPORTED_FEEDBACK_SCHEMA"  // a stored row this reader does not understand
  | "INVALID_STORED_ROW"           // a stored row failed runtime validation
  | "INVALID_QUERY"                // a read was called with an empty/invalid key
  | "READ_FAILED"
  | "WRITE_FAILED";

export class PartnerFeedbackStoreError extends Error {
  readonly code: PartnerFeedbackStoreErrorCode;
  readonly details: readonly string[];
  constructor(code: PartnerFeedbackStoreErrorCode, message: string, details: readonly string[] = []) {
    super(`[${code}] ${message}`);
    this.name = "PartnerFeedbackStoreError";
    this.code = code;
    this.details = details;
  }
}

/** DB/network error text is passed through a redactor — JWTs, Supabase secret/publishable keys and bearer tokens never reach an error message. */
export function redactSecrets(text: string): string {
  return text
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g, "[redacted-jwt]")
    .replace(/sb_(secret|publishable)_[A-Za-z0-9_-]+/g, "[redacted-key]")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]");
}

function describeDbError(e: FeedbackDbError | unknown): string {
  if (e && typeof e === "object") {
    const { code, message } = e as FeedbackDbError;
    return redactSecrets(`${code ?? "no-code"}: ${message ?? "no message"}`);
  }
  return redactSecrets(String(e));
}

// ── read results ──

export interface RejectedFeedbackRow { id: string | null; code: "UNSUPPORTED_FEEDBACK_SCHEMA" | "INVALID_STORED_ROW"; errors: string[] }

export type FeedbackHistoryResult =
  | { status: "OK"; feedback: PartnerFeedback[] }
  | { status: "NO_FEEDBACK"; feedback: [] }
  | { status: "READ_FAILED"; error: PartnerFeedbackStoreError }
  /** Fail-closed: if ANY row is unreadable, no partial history is returned (a partial history would silently skew learning). */
  | { status: "INVALID_STORED_ROWS"; rejected: RejectedFeedbackRow[] };

export type RevisionGraphDiagnosticKind = "BRANCH" | "SELF_SUPERSESSION" | "DANGLING_SUPERSEDES" | "TARGET_MISMATCH" | "CYCLE";
export interface RevisionGraphDiagnostic { kind: RevisionGraphDiagnosticKind; feedbackIds: string[]; message: string }

export type CurrentFeedbackResult =
  | { status: "OK"; feedback: PartnerFeedback[]; historyCount: number }
  | { status: "NO_FEEDBACK"; feedback: [] }
  | { status: "READ_FAILED"; error: PartnerFeedbackStoreError }
  | { status: "INVALID_STORED_ROWS"; rejected: RejectedFeedbackRow[] }
  /** Never guessed around: an invalid graph yields NO current feedback, only diagnostics. */
  | { status: "INVALID_REVISION_GRAPH"; diagnostics: RevisionGraphDiagnostic[] };

export type CurrentFeedbackFilter =
  | { caseId: string }
  | { caseType: string }
  | { subjectType: string; subjectId: string };

// ── pure helpers ──

/** created_at ASC, then id ASC (uuid text order == Postgres uuid order for lowercase hex). */
export function compareFeedbackOrder(a: PartnerFeedback, b: PartnerFeedback): number {
  const d = Date.parse(a.createdAt) - Date.parse(b.createdAt);
  if (d !== 0) return d;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Full-graph integrity check. Must be run on the COMPLETE history (a
 * filtered subset can hide a successor and make a superseded row look
 * current) — resolveCurrentFeedbackRevision always does.
 */
export function analyzeFeedbackRevisionGraph(history: readonly PartnerFeedback[]): RevisionGraphDiagnostic[] {
  const diagnostics: RevisionGraphDiagnostic[] = [];
  const byId = new Map(history.map((f) => [f.id, f]));

  for (const b of findRevisionBranches(history)) {
    diagnostics.push({ kind: "BRANCH", feedbackIds: [b.supersedesId, ...b.branchIds], message: `${b.supersedesId} has ${b.branchIds.length} direct successors` });
  }
  for (const f of history) {
    if (f.supersedesId === null) continue;
    if (f.supersedesId === f.id) { diagnostics.push({ kind: "SELF_SUPERSESSION", feedbackIds: [f.id], message: `${f.id} supersedes itself` }); continue; }
    const prior = byId.get(f.supersedesId);
    if (!prior) { diagnostics.push({ kind: "DANGLING_SUPERSEDES", feedbackIds: [f.id, f.supersedesId], message: `${f.id} supersedes ${f.supersedesId}, which is not in the history` }); continue; }
    if (!targetsMatch(f.target, prior.target)) diagnostics.push({ kind: "TARGET_MISMATCH", feedbackIds: [prior.id, f.id], message: `${f.id} supersedes ${prior.id} across different targets` });
  }
  const reported = new Set<string>();
  for (const start of history) {
    const seen = new Set<string>([start.id]);
    let cur = start.supersedesId ? byId.get(start.supersedesId) : undefined;
    while (cur && cur.id !== start.id && !seen.has(cur.id)) { seen.add(cur.id); cur = cur.supersedesId ? byId.get(cur.supersedesId) : undefined; }
    if (cur && cur.id === start.id && start.supersedesId !== start.id) {
      const ids = [...seen].sort();
      const key = ids.join(",");
      if (!reported.has(key)) { reported.add(key); diagnostics.push({ kind: "CYCLE", feedbackIds: ids, message: `revision cycle: ${ids.join(" → ")}` }); }
    }
  }
  return diagnostics.sort((a, b) => a.kind.localeCompare(b.kind) || a.feedbackIds.join().localeCompare(b.feedbackIds.join()));
}

function matchesFilter(f: PartnerFeedback, filter: CurrentFeedbackFilter | undefined): boolean {
  if (!filter) return true;
  if ("caseId" in filter) return f.target.caseId === filter.caseId;
  if ("caseType" in filter) return f.target.caseType === filter.caseType;
  return f.target.subjectType === filter.subjectType && f.target.subjectId === filter.subjectId;
}

// ── append input ──

/**
 * A draft: no `id`, no `createdAt`, no `schemaVersion`. The DB assigns id
 * (gen_random_uuid()) and created_at (now()); the store stamps
 * FEEDBACK_SCHEMA_VERSION. A caller can therefore never choose a persisted
 * id or a persisted chronology — passing any of the three is a
 * VALIDATION_FAILED, never silently dropped.
 */
export type AppendPartnerFeedbackInput = PartnerFeedbackDraft;

export interface AppendPartnerFeedbackOptions {
  /** The current Case Engine catalog, passed to validatePartnerFeedback (unknown caseType → warning, not error). */
  knownCaseTypes: readonly string[];
}

export interface AppendPartnerFeedbackResult {
  /** Fully materialized from the DB's own response — id and createdAt are the database's. */
  feedback: PartnerFeedback;
  /** Non-fatal validatePartnerFeedback warnings (e.g. caseType not in the current catalog). */
  warnings: string[];
}

const DRAFT_KEYS = ["target", "dimensions", "note", "caseSnapshot", "supersedesId", "provenance"];
const DB_ASSIGNED_KEYS = ["id", "createdAt", "schemaVersion"];
const LOWER_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * validatePartnerFeedback() checks a materialized record, which includes
 * presence checks on id/createdAt. A draft has neither YET, so it is
 * validated with these fixed, clearly-fake placeholders. They satisfy only
 * those two presence checks and are never persisted or returned — the
 * INSERT row is built from the draft alone (draftToInsertRow).
 */
const VALIDATION_PLACEHOLDER_ID = "pending-db-assigned-id";
const VALIDATION_PLACEHOLDER_CREATED_AT = "1970-01-01T00:00:00.000Z";

/** Runtime validation of an append draft. Never coerces — any deviation is an error. */
function buildValidatedDraft(input: unknown, knownCaseTypes: readonly string[]): { draft: PartnerFeedbackDraft; warnings: string[] } {
  const errors: string[] = [];
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new PartnerFeedbackStoreError("VALIDATION_FAILED", "feedback input must be an object");
  }
  const raw = input as Record<string, unknown>;
  for (const k of Object.keys(raw)) {
    if (DB_ASSIGNED_KEYS.includes(k)) errors.push(`"${k}" is assigned by the database/store and cannot be supplied by a caller`);
    else if (!DRAFT_KEYS.includes(k)) errors.push(`unknown key "${k}"`);
  }
  if (raw.note !== null && typeof raw.note !== "string") errors.push("note: must be a string or null");
  if (raw.supersedesId !== null && (typeof raw.supersedesId !== "string" || !LOWER_UUID_RE.test(raw.supersedesId))) errors.push("supersedesId: must be a lowercase uuid or null");
  if (!("caseSnapshot" in raw)) errors.push("caseSnapshot: required (null when the scope has no Case)");

  const target = parseFeedbackTarget(raw.target, errors);
  const dimensions = parseFeedbackDimensions(raw.dimensions, errors);
  const caseSnapshot = raw.caseSnapshot === null || raw.caseSnapshot === undefined ? null : parseCaseSnapshot(raw.caseSnapshot, errors);
  const provenance = parseProvenance(raw.provenance, errors);

  if (errors.length || !target || !dimensions || !provenance) {
    throw new PartnerFeedbackStoreError("VALIDATION_FAILED", "feedback input failed runtime validation", errors);
  }

  // Case-derived subject identity: present on the target AND equal to the snapshot — reported, never filled in.
  const identity = snapshotIdentityIssues(target, caseSnapshot);
  if (identity.mismatch.length) throw new PartnerFeedbackStoreError("SUBJECT_IDENTITY_MISMATCH", "Case-derived target identity contradicts caseSnapshot", identity.mismatch);
  if (identity.missing.length) throw new PartnerFeedbackStoreError("SUBJECT_IDENTITY_MISSING", "Case-derived feedback must carry its Case + subject identity on the target", identity.missing);

  const draft: PartnerFeedbackDraft = {
    target,
    dimensions,
    note: raw.note as string | null,
    caseSnapshot,
    supersedesId: raw.supersedesId as string | null,
    provenance,
  };

  const v = validatePartnerFeedback(
    { ...draft, id: VALIDATION_PLACEHOLDER_ID, createdAt: VALIDATION_PLACEHOLDER_CREATED_AT, schemaVersion: FEEDBACK_SCHEMA_VERSION },
    knownCaseTypes,
  );
  const scopeErrors: string[] = [];
  if (!CASE_DERIVED_SCOPES.has(target.scope) && caseSnapshot !== null) {
    scopeErrors.push(`${target.scope} target must not carry a caseSnapshot (only CASE_INSTANCE/HYPOTHESIS snapshot a Case)`);
  }
  if (!v.valid || scopeErrors.length) {
    throw new PartnerFeedbackStoreError("VALIDATION_FAILED", "feedback failed validation", [...v.errors, ...scopeErrors]);
  }
  return { draft, warnings: v.warnings };
}

// ── the store ──

export interface PartnerFeedbackStore {
  appendPartnerFeedback(input: AppendPartnerFeedbackInput, options: AppendPartnerFeedbackOptions): Promise<AppendPartnerFeedbackResult>;
  /** Full history, created_at ASC then id ASC. */
  listPartnerFeedback(): Promise<FeedbackHistoryResult>;
  /** Full history for one Case (every row with case_id = caseId, including superseded ones). */
  getFeedbackForCase(caseId: string): Promise<FeedbackHistoryResult>;
  /**
   * Every row whose first-class subject_type + subject_id columns match exactly — explicit SUBJECT-scoped
   * feedback AND Case-derived (CASE_INSTANCE/HYPOTHESIS) feedback about a Case on that subject, plus any
   * other scope whose target names the subject. Each row keeps its own target scope: discovery never turns
   * instance feedback into subject-wide feedback. Indexed columns only — case_snapshot JSON is never queried.
   */
  getFeedbackForSubject(subjectType: string, subjectId: string): Promise<FeedbackHistoryResult>;
  /** Full history for one CaseType (exact case_type column match). */
  getFeedbackForCaseType(caseType: string): Promise<FeedbackHistoryResult>;
  /** Effective feedback: the terminal row of every revision chain, resolved over the FULL history, then filtered. */
  resolveCurrentFeedbackRevision(filter?: CurrentFeedbackFilter): Promise<CurrentFeedbackResult>;
}

export const PAGE_SIZE = 1000;

export function createPartnerFeedbackStore(client: FeedbackTableClient): PartnerFeedbackStore {
  const table = () => client.from(PARTNER_FEEDBACK_TABLE);

  async function readHistory(filters: ReadonlyArray<readonly [string, string]>): Promise<FeedbackHistoryResult> {
    const rows: unknown[] = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      let q = table().select(PARTNER_FEEDBACK_COLUMNS);
      for (const [col, val] of filters) q = q.eq(col, val);
      q = q.order("created_at", { ascending: true }).order("id", { ascending: true }).range(from, from + PAGE_SIZE - 1);
      let res: FeedbackDbResponse<unknown[]>;
      try { res = await q; } catch (e) {
        return { status: "READ_FAILED", error: new PartnerFeedbackStoreError("READ_FAILED", `partner_feedback read threw: ${describeDbError(e)}`) };
      }
      if (res.error) return { status: "READ_FAILED", error: new PartnerFeedbackStoreError("READ_FAILED", `partner_feedback read failed: ${describeDbError(res.error)}`) };
      if (!Array.isArray(res.data)) return { status: "READ_FAILED", error: new PartnerFeedbackStoreError("READ_FAILED", "partner_feedback read returned no data array") };
      rows.push(...res.data);
      if (res.data.length < PAGE_SIZE) break;
    }

    const feedback: PartnerFeedback[] = [];
    const rejected: RejectedFeedbackRow[] = [];
    for (const row of rows) {
      const m = mapFeedbackRow(row);
      if (m.ok) feedback.push(m.value);
      else {
        const id = row && typeof row === "object" && typeof (row as { id?: unknown }).id === "string" ? (row as { id: string }).id : null;
        rejected.push({ id, code: m.code, errors: m.errors });
      }
    }
    if (rejected.length) return { status: "INVALID_STORED_ROWS", rejected };
    if (!feedback.length) return { status: "NO_FEEDBACK", feedback: [] };
    return { status: "OK", feedback: feedback.sort(compareFeedbackOrder) };
  }

  function requireKey(name: string, value: unknown): string {
    if (typeof value !== "string" || value.length === 0) throw new PartnerFeedbackStoreError("INVALID_QUERY", `${name} must be a non-empty string`);
    return value;
  }

  async function loadPrior(id: string): Promise<PartnerFeedback> {
    let res: FeedbackDbResponse<unknown>;
    try { res = await table().select(PARTNER_FEEDBACK_COLUMNS).eq("id", id).maybeSingle(); } catch (e) {
      throw new PartnerFeedbackStoreError("READ_FAILED", `could not load superseded row: ${describeDbError(e)}`);
    }
    if (res.error) throw new PartnerFeedbackStoreError("READ_FAILED", `could not load superseded row: ${describeDbError(res.error)}`);
    if (res.data === null) throw new PartnerFeedbackStoreError("SUPERSEDED_NOT_FOUND", `supersedesId ${id} does not exist`);
    const m = mapFeedbackRow(res.data);
    if (!m.ok) throw new PartnerFeedbackStoreError(m.code, `superseded row ${id} is not readable`, m.errors);
    return m.value;
  }

  async function assertNoSuccessor(priorId: string): Promise<void> {
    let res: FeedbackDbResponse<unknown[]>;
    try { res = await table().select("id").eq("supersedes_id", priorId).range(0, 0); } catch (e) {
      throw new PartnerFeedbackStoreError("READ_FAILED", `could not check existing revisions: ${describeDbError(e)}`);
    }
    if (res.error) throw new PartnerFeedbackStoreError("READ_FAILED", `could not check existing revisions: ${describeDbError(res.error)}`);
    if (res.data && res.data.length > 0) {
      throw new PartnerFeedbackStoreError("REVISION_BRANCH_CONFLICT", `feedback ${priorId} already has a successor — revise the current (terminal) record instead`);
    }
  }

  return {
    async appendPartnerFeedback(input, options) {
      const { draft, warnings } = buildValidatedDraft(input, options.knownCaseTypes);

      // No createdAt comparison against the prior row: the DB's now() on this INSERT is the chronology's source of truth.
      if (draft.supersedesId !== null) {
        const prior = await loadPrior(draft.supersedesId);
        if (!targetsMatch(draft.target, prior.target)) {
          throw new PartnerFeedbackStoreError("REVISION_TARGET_MISMATCH", `revision does not refer to the same logical target as ${prior.id}`, [`prior: ${JSON.stringify(prior.target)}`, `revision: ${JSON.stringify(draft.target)}`]);
        }
        // targetsMatch compares caseId for Case-derived scopes; the persisted subject identity must not drift across a revision either.
        if (CASE_DERIVED_SCOPES.has(draft.target.scope) && (draft.target.subjectType !== prior.target.subjectType || draft.target.subjectId !== prior.target.subjectId)) {
          throw new PartnerFeedbackStoreError("REVISION_TARGET_MISMATCH", `revision subject (${draft.target.subjectType}:${draft.target.subjectId}) differs from ${prior.id}'s (${prior.target.subjectType}:${prior.target.subjectId})`);
        }
        await assertNoSuccessor(prior.id);
      }

      let res: FeedbackDbResponse<unknown>;
      try { res = await table().insert(draftToInsertRow(draft, FEEDBACK_SCHEMA_VERSION)).select(PARTNER_FEEDBACK_COLUMNS).single(); } catch (e) {
        throw new PartnerFeedbackStoreError("WRITE_FAILED", `partner_feedback insert threw: ${describeDbError(e)}`);
      }
      if (res.error) {
        const detail = describeDbError(res.error);
        const text = `${res.error.message ?? ""} ${res.error.details ?? ""}`;
        if (res.error.code === "23505" && /supersedes/i.test(text)) {
          // Lost a race with another revision of the same row — the DB's partial UNIQUE index caught it. Surfaced, never swallowed.
          throw new PartnerFeedbackStoreError("REVISION_BRANCH_CONFLICT", `feedback ${draft.supersedesId} already has a successor (DB unique index)`, [detail]);
        }
        if (res.error.code === "23505") throw new PartnerFeedbackStoreError("DUPLICATE_FEEDBACK_ID", "DB-generated feedback id collided (primary key)", [detail]);
        if (res.error.code === "23503") throw new PartnerFeedbackStoreError("SUPERSEDED_NOT_FOUND", `supersedesId ${String(draft.supersedesId)} does not exist (DB foreign key)`, [detail]);
        throw new PartnerFeedbackStoreError("WRITE_FAILED", "partner_feedback insert failed", [detail]);
      }
      const m = mapFeedbackRow(res.data);
      if (!m.ok) throw new PartnerFeedbackStoreError(m.code, "row was inserted but its read-back failed validation", m.errors);
      return { feedback: m.value, warnings };
    },

    listPartnerFeedback: () => readHistory([]),
    getFeedbackForCase: async (caseId) => readHistory([["case_id", requireKey("caseId", caseId)]]),
    getFeedbackForSubject: async (subjectType, subjectId) => readHistory([["subject_type", requireKey("subjectType", subjectType)], ["subject_id", requireKey("subjectId", subjectId)]]),
    getFeedbackForCaseType: async (caseType) => readHistory([["case_type", requireKey("caseType", caseType)]]),

    async resolveCurrentFeedbackRevision(filter) {
      if (filter) {
        if ("caseId" in filter) requireKey("caseId", filter.caseId);
        else if ("caseType" in filter) requireKey("caseType", filter.caseType);
        else { requireKey("subjectType", filter.subjectType); requireKey("subjectId", filter.subjectId); }
      }
      const history = await readHistory([]);
      if (history.status !== "OK") return history;
      const diagnostics = analyzeFeedbackRevisionGraph(history.feedback);
      if (diagnostics.length) return { status: "INVALID_REVISION_GRAPH", diagnostics };
      const current = resolveCurrentRevisions(history.feedback).filter((f) => matchesFilter(f, filter)).sort(compareFeedbackOrder);
      if (!current.length) return { status: "NO_FEEDBACK", feedback: [] };
      return { status: "OK", feedback: current, historyCount: history.feedback.length };
    },
  };
}
