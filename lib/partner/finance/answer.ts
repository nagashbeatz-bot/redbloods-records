/**
 * Redbloods Partner — Finance Owner answer core (F2.8–F2.10). Dependencies injected (tests never touch
 * production); answer-service.ts binds them.
 *
 * The ONLY write this core can cause is one INSERT of a new partner_owner_context revision through the
 * existing append-only primitive (appendOwnerContext). It never writes a transaction, a price, a due date,
 * a finance setting, a recurring model or an Action Event, and never executes anything.
 *
 *   1. strict input (whitelisted keys, codes, 64-hex fingerprint, lowercase-uuid requestId; a date only
 *      for the question's EXACT_DATE answer);
 *   2. requestId: the same requestId with the same scope → REPLAY (no second write, also while the first
 *      is still in flight); with a different scope → REQUEST_ID_CONFLICT;
 *   3. the server RE-DERIVES the live finance state + integrity + the Owner's active answers, and finds the
 *      question among the questions currently surfaced to the Owner. Missing question, different fingerprint
 *      or an answer code the question does not offer → STALE_QUESTION (nothing written);
 *   4. a question whose facts changed since an earlier answer is a REVISION: supersedes_id = that answer
 *      (chosen by the server, never by the client). Otherwise a new root.
 *
 * requestId is not a column of partner_owner_context (no DB change in this phase): replay safety is the
 * in-process ledger plus a DB-backed check — if the question is no longer surfaced because this exact answer
 * (same code, value and seen fingerprint) is already its active answer, the retry is a REPLAY.
 */
import { canonicalStableStringify, sha256Hex } from "../actions/canonical";
import { isValidYmd } from "../investigation/answer-value";
import { OwnerContextStoreError, type OwnerContextDraft } from "../investigation/context-persistence";
import type { PersistedOwnerContext } from "../investigation/context-row";
import { isFinanceQuestionType } from "../investigation/finance-questions";
import { FINANCE_QUESTION_ID_RE } from "./dto";
import { INTEGRITY_SCHEMA_VERSION, type OwnerQuestion, type PartnerFinanceIntegrityState } from "./integrity";
import type { FinanceOwnerAnswer } from "./owner-answers";

export const FINANCE_ANSWER_KEYS = ["questionId", "answerCode", "seenQuestionFingerprint", "requestId", "exactDateYmd"] as const;

export type FinanceLiveView =
  | { ok: true; integrity: PartnerFinanceIntegrityState; answers: FinanceOwnerAnswer[] }
  | { ok: false; detail: string };

export interface FinanceAnswerDeps {
  loadLive(): Promise<FinanceLiveView>;
  appendOwnerContext(draft: OwnerContextDraft): Promise<PersistedOwnerContext>;
  ledger: RequestLedger;
  audit(event: string, data: Record<string, unknown>): void;
}

export type FinanceAnswerResult =
  | { status: "ANSWER_SAVED"; contextId: string; supersedesId: string | null }
  | { status: "REPLAY"; contextId: string }
  | { status: "STALE_QUESTION" }
  | { status: "REQUEST_ID_CONFLICT" }
  | { status: "INVALID_INPUT"; errors: string[] }
  | { status: "LIVE_READ_FAILED"; detail: string }
  | { status: "INVARIANT_VIOLATION"; detail: string }
  | { status: "FAILED"; detail: string };

// ── request ledger (in-process, bounded) ──

interface LedgerEntry { scope: string; result: Promise<FinanceAnswerResult> }
export interface RequestLedger {
  get(requestId: string): LedgerEntry | undefined;
  set(requestId: string, entry: LedgerEntry): void;
  delete(requestId: string): void;
}
export function createRequestLedger(max = 500): RequestLedger {
  const m = new Map<string, LedgerEntry>();
  return {
    get: (id) => m.get(id),
    set: (id, e) => { m.set(id, e); while (m.size > max) m.delete(m.keys().next().value as string); },
    delete: (id) => { m.delete(id); },
  };
}

// ── input ──

const LOWER_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CODE_RE = /^[A-Z][A-Z0-9_]{1,60}$/;
const HEX64_RE = /^[0-9a-f]{64}$/;

interface ValidInput { questionId: string; answerCode: string; seenQuestionFingerprint: string; requestId: string; exactDateYmd: string | null }

export function validateFinanceAnswerInput(input: unknown): { ok: true; value: ValidInput } | { ok: false; errors: string[] } {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return { ok: false, errors: ["input must be an object"] };
  const raw = input as Record<string, unknown>;
  const errors = Object.keys(raw).filter((k) => !(FINANCE_ANSWER_KEYS as readonly string[]).includes(k)).map((k) => `"${k}" cannot be supplied`);
  if (typeof raw.questionId !== "string" || raw.questionId.length > 420 || !FINANCE_QUESTION_ID_RE.test(raw.questionId)) errors.push("questionId: invalid");
  else if (!isFinanceQuestionType(raw.questionId.slice(raw.questionId.lastIndexOf("::") + 2))) errors.push("questionId: not a finance question");
  if (typeof raw.answerCode !== "string" || !CODE_RE.test(raw.answerCode)) errors.push("answerCode: invalid");
  if (typeof raw.seenQuestionFingerprint !== "string" || !HEX64_RE.test(raw.seenQuestionFingerprint)) errors.push("seenQuestionFingerprint must be 64 lowercase hex");
  if (typeof raw.requestId !== "string" || !LOWER_UUID_RE.test(raw.requestId)) errors.push("requestId must be a lowercase uuid");
  const exact = raw.exactDateYmd ?? null;
  if (raw.answerCode === "EXACT_DATE" ? !isValidYmd(exact) : exact !== null) errors.push("exactDateYmd is required (YYYY-MM-DD) exactly for EXACT_DATE, and must be absent/null otherwise");
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { questionId: raw.questionId as string, answerCode: raw.answerCode as string, seenQuestionFingerprint: raw.seenQuestionFingerprint as string, requestId: raw.requestId as string, exactDateYmd: exact as string | null } };
}

const scopeOf = (v: ValidInput) => sha256Hex(canonicalStableStringify({ questionId: v.questionId, answerCode: v.answerCode, seenQuestionFingerprint: v.seenQuestionFingerprint, exactDateYmd: v.exactDateYmd }));

// ── the core ──

export async function answerFinanceQuestionCore(deps: FinanceAnswerDeps, actorUserId: string, input: unknown): Promise<FinanceAnswerResult> {
  const v = validateFinanceAnswerInput(input);
  if (!v.ok) return { status: "INVALID_INPUT", errors: v.errors };
  const scope = scopeOf(v.value);
  const prior = deps.ledger.get(v.value.requestId);
  if (prior) {
    if (prior.scope !== scope) return { status: "REQUEST_ID_CONFLICT" };
    const r = await prior.result;
    if (r.status === "ANSWER_SAVED" || r.status === "REPLAY") return { status: "REPLAY", contextId: r.contextId };
    return r;
  }
  const run = answerOnce(deps, actorUserId, v.value);
  deps.ledger.set(v.value.requestId, { scope, result: run });
  const r = await run;
  // Only a settled outcome is remembered; a failed / unknown attempt may be retried with the same requestId.
  if (r.status === "FAILED" || r.status === "LIVE_READ_FAILED" || r.status === "INVARIANT_VIOLATION") deps.ledger.delete(v.value.requestId);
  return r;
}

async function answerOnce(deps: FinanceAnswerDeps, actorUserId: string, v: ValidInput): Promise<FinanceAnswerResult> {
  let live: FinanceLiveView;
  try { live = await deps.loadLive(); } catch (e) { return { status: "LIVE_READ_FAILED", detail: (e as Error).message }; }
  if (!live.ok) return { status: "LIVE_READ_FAILED", detail: live.detail };

  // The question must be one the Owner is shown right now, exactly as shown.
  const q: OwnerQuestion | undefined = live.integrity.top.questions.find((x) => x.identity?.questionId === v.questionId);
  if (!q || !q.identity) {
    const active = live.answers.find((a) => a.questionId === v.questionId);
    if (active && active.answerCode === v.answerCode && active.answerValueYmd === v.exactDateYmd && active.factsFingerprint === v.seenQuestionFingerprint) {
      return { status: "REPLAY", contextId: active.contextId };
    }
    return { status: "STALE_QUESTION" };
  }
  if (q.identity.fingerprint !== v.seenQuestionFingerprint) return { status: "STALE_QUESTION" };
  if (!q.options.some((o) => o.code === v.answerCode)) return { status: "STALE_QUESTION" };
  if (!isFinanceQuestionType(q.questionType)) return { status: "INVARIANT_VIOLATION", detail: `question ${v.questionId} is not a finance question type` };

  const supersedesId = q.identity.previousAnswer?.contextId ?? null;
  const draft: OwnerContextDraft = {
    questionId: q.identity.questionId,
    questionType: q.questionType,
    questionText: q.textHe,
    caseId: q.identity.caseId,
    caseType: q.identity.issueType,
    caseSchemaVersion: INTEGRITY_SCHEMA_VERSION,
    caseFactsFingerprint: q.identity.fingerprint,
    subjectType: q.subject.type,
    subjectId: q.subject.id,
    answerCode: v.answerCode,
    explicitDateYmd: v.exactDateYmd,
    answeredOnYmd: null,
    triggerContextId: null,
    note: null,
    scope: "CASE_INSTANCE",
    provenance: { source: "owner_manual" },
    supersedesId,
  };
  try {
    const saved = await deps.appendOwnerContext(draft);
    deps.audit("partner_finance_answer", { actorUserId, requestId: v.requestId, questionId: v.questionId, answerCode: v.answerCode, contextId: saved.id, supersedesId });
    return { status: "ANSWER_SAVED", contextId: saved.id, supersedesId };
  } catch (e) {
    if (e instanceof OwnerContextStoreError) {
      if (e.code === "ANSWER_EXISTS_USE_REVISION" || e.code === "REVISION_BRANCH_CONFLICT" || e.code === "REVISION_TARGET_MISMATCH" || e.code === "SUPERSEDED_NOT_FOUND") return { status: "STALE_QUESTION" };
      if (e.code === "INVALID_ANSWER_VALUE") return { status: "INVALID_INPUT", errors: [e.message, ...e.details] };
      if (e.code === "READ_FAILED" || e.code === "WRITE_FAILED") return { status: "FAILED", detail: e.message };
      return { status: "INVARIANT_VIOLATION", detail: e.message };
    }
    return { status: "FAILED", detail: (e as Error).message };
  }
}
