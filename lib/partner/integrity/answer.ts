/**
 * Redbloods Partner — Company Integrity Owner answer core. Dependencies injected (tests never touch production);
 * answer-service.ts binds them. Same architecture as the Finance Owner answer (lib/partner/finance/answer.ts).
 *
 * The ONLY write this core can cause is one INSERT of a new partner_owner_context revision through the existing
 * append-only primitive (appendOwnerContext). It never writes a project, client, label artist, release, session,
 * transaction or any other business row — an answer changes Partner KNOWLEDGE only.
 *
 *   1. strict input: whitelisted keys; questionId must be an integrity question id whose Case id is exactly
 *      integrity:<type>:<subjectId> for the supplied subjectId; answerCode must be one the question type offers;
 *      64-hex fingerprint; lowercase-uuid requestId. The client never supplies epistemic / source / supersedes.
 *   2. requestId: same requestId + same scope → REPLAY (also while the first is in flight); different scope →
 *      REQUEST_ID_CONFLICT.
 *   3. the server RE-DERIVES the live register (canonical data + the Owner's active answers) and finds the question
 *      among the questions CURRENTLY surfaced (max 2). Missing (answered / deferred / no longer ambiguous),
 *      different fingerprint (facts changed) or an answer the live question does not offer → STALE_QUESTION,
 *      nothing written. A missing question that already carries exactly this answer for these facts → REPLAY.
 *   4. a question re-surfaced after an earlier answer (facts changed) is a REVISION: supersedes_id = that answer,
 *      chosen by the server. Otherwise a new root. The store re-validates the whole revision graph before INSERT.
 *   5. after the INSERT the answer is re-read on a FRESH read (verify): `learned` is true only when the new row is
 *      read back and applied, so the UI never claims "למדתי" for an answer that is not really in use.
 */
import { canonicalStableStringify, sha256Hex } from "../actions/canonical";
import { OwnerContextStoreError, type OwnerContextDraft } from "../investigation/context-persistence";
import type { PersistedOwnerContext } from "../investigation/context-row";
import { INTEGRITY_ANSWER_OPTIONS, isIntegrityQuestionType, type IntegrityQuestionType } from "../investigation/integrity-questions";
import type { PartnerOwnerContext } from "../investigation/types";
import { integrityCaseId } from "./register";
import { INTEGRITY_SCHEMA_VERSION, type CompanyIntegrityRegister } from "./types";

export const INTEGRITY_ANSWER_KEYS = ["questionId", "subjectId", "answerCode", "seenQuestionFingerprint", "requestId"] as const;

export type IntegrityLiveView =
  | { ok: true; register: CompanyIntegrityRegister; activeContexts: readonly PartnerOwnerContext[] }
  | { ok: false; detail: string };

export interface IntegrityAnswerDeps {
  loadLive(): Promise<IntegrityLiveView>;
  appendOwnerContext(draft: OwnerContextDraft): Promise<PersistedOwnerContext>;
  /** A FRESH read after the write: is this context now read back and applied to its question? */
  verify(contextId: string, questionId: string): Promise<boolean>;
  ledger: IntegrityRequestLedger;
  audit(event: string, data: Record<string, unknown>): void;
}

export type IntegrityAnswerResult =
  | { status: "ANSWER_SAVED"; contextId: string; supersedesId: string | null; learned: boolean }
  | { status: "REPLAY"; contextId: string; learned: boolean }
  | { status: "STALE_QUESTION" }
  | { status: "REQUEST_ID_CONFLICT" }
  | { status: "INVALID_INPUT"; errors: string[] }
  | { status: "LIVE_READ_FAILED"; detail: string }
  | { status: "INVARIANT_VIOLATION"; detail: string }
  | { status: "FAILED"; detail: string };

// ── request ledger (in-process, bounded) ──

interface LedgerEntry { scope: string; result: Promise<IntegrityAnswerResult> }
export interface IntegrityRequestLedger {
  get(requestId: string): LedgerEntry | undefined;
  set(requestId: string, entry: LedgerEntry): void;
  delete(requestId: string): void;
}
export function createIntegrityRequestLedger(max = 500): IntegrityRequestLedger {
  const m = new Map<string, LedgerEntry>();
  return {
    get: (id) => m.get(id),
    set: (id, e) => { m.set(id, e); while (m.size > max) m.delete(m.keys().next().value as string); },
    delete: (id) => { m.delete(id); },
  };
}

// ── input ──

const LOWER_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HEX64_RE = /^[0-9a-f]{64}$/;
// A subject id is a label-artist uuid or a normalized client name: printable, bounded, no separators / control chars.
const SUBJECT_RE = /^[^\u0000-\u001f\u007f:]{1,120}$/u;

interface ValidInput { questionId: string; questionType: IntegrityQuestionType; subjectId: string; answerCode: string; seenQuestionFingerprint: string; requestId: string }

export function validateIntegrityAnswerInput(input: unknown): { ok: true; value: ValidInput } | { ok: false; errors: string[] } {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return { ok: false, errors: ["input must be an object"] };
  const raw = input as Record<string, unknown>;
  const errors = Object.keys(raw).filter((k) => !(INTEGRITY_ANSWER_KEYS as readonly string[]).includes(k)).map((k) => `"${k}" cannot be supplied`);
  let questionType: IntegrityQuestionType | null = null;
  if (typeof raw.questionId !== "string" || raw.questionId.length > 300) errors.push("questionId: invalid");
  else {
    const t = raw.questionId.slice(raw.questionId.lastIndexOf("::") + 2);
    if (!isIntegrityQuestionType(t)) errors.push("questionId: not an integrity question");
    else questionType = t;
  }
  if (typeof raw.subjectId !== "string" || !SUBJECT_RE.test(raw.subjectId)) errors.push("subjectId: invalid");
  else if (questionType && raw.questionId !== `${integrityCaseId(questionType, raw.subjectId)}::${questionType}`) errors.push("subjectId: does not match the question");
  if (typeof raw.answerCode !== "string") errors.push("answerCode: invalid");
  else if (questionType && !INTEGRITY_ANSWER_OPTIONS[questionType].some((o) => o.code === raw.answerCode)) errors.push("answerCode: not an answer of this question");
  if (typeof raw.seenQuestionFingerprint !== "string" || !HEX64_RE.test(raw.seenQuestionFingerprint)) errors.push("seenQuestionFingerprint must be 64 lowercase hex");
  if (typeof raw.requestId !== "string" || !LOWER_UUID_RE.test(raw.requestId)) errors.push("requestId must be a lowercase uuid");
  if (errors.length || !questionType) return { ok: false, errors: errors.length ? errors : ["questionId: invalid"] };
  return { ok: true, value: { questionId: raw.questionId as string, questionType, subjectId: raw.subjectId as string, answerCode: raw.answerCode as string, seenQuestionFingerprint: raw.seenQuestionFingerprint as string, requestId: raw.requestId as string } };
}

const scopeOf = (v: ValidInput) => sha256Hex(canonicalStableStringify({ questionId: v.questionId, subjectId: v.subjectId, answerCode: v.answerCode, seenQuestionFingerprint: v.seenQuestionFingerprint }));

// ── the core ──

export async function answerIntegrityQuestionCore(deps: IntegrityAnswerDeps, actorUserId: string, input: unknown): Promise<IntegrityAnswerResult> {
  const v = validateIntegrityAnswerInput(input);
  if (!v.ok) return { status: "INVALID_INPUT", errors: v.errors };
  const scope = scopeOf(v.value);
  const prior = deps.ledger.get(v.value.requestId);
  if (prior) {
    if (prior.scope !== scope) return { status: "REQUEST_ID_CONFLICT" };
    const r = await prior.result;
    if (r.status === "ANSWER_SAVED" || r.status === "REPLAY") return { status: "REPLAY", contextId: r.contextId, learned: r.learned };
    return r;
  }
  const run = answerOnce(deps, actorUserId, v.value);
  deps.ledger.set(v.value.requestId, { scope, result: run });
  const r = await run;
  // Only a settled outcome is remembered; a failed / unknown attempt may be retried with the same requestId.
  if (r.status === "FAILED" || r.status === "LIVE_READ_FAILED" || r.status === "INVARIANT_VIOLATION") deps.ledger.delete(v.value.requestId);
  return r;
}

async function safeVerify(deps: IntegrityAnswerDeps, contextId: string, questionId: string): Promise<boolean> {
  try { return await deps.verify(contextId, questionId); } catch { return false; }
}

async function answerOnce(deps: IntegrityAnswerDeps, actorUserId: string, v: ValidInput): Promise<IntegrityAnswerResult> {
  let live: IntegrityLiveView;
  try { live = await deps.loadLive(); } catch (e) { return { status: "LIVE_READ_FAILED", detail: (e as Error).message }; }
  if (!live.ok) return { status: "LIVE_READ_FAILED", detail: live.detail };

  // The question must be one the Owner is shown right now, exactly as shown.
  const q = live.register.questions.find((x) => x.questionId === v.questionId);
  if (!q) {
    const active = live.activeContexts.find((c) => c.questionId === v.questionId);
    if (active && active.answerCode === v.answerCode && active.caseFactsFingerprint === v.seenQuestionFingerprint) {
      return { status: "REPLAY", contextId: active.id, learned: await safeVerify(deps, active.id, v.questionId) };
    }
    return { status: "STALE_QUESTION" };
  }
  if (q.subject.id !== v.subjectId || q.questionType !== v.questionType) return { status: "STALE_QUESTION" };
  if (q.fingerprint !== v.seenQuestionFingerprint) return { status: "STALE_QUESTION" };
  if (!q.options.some((o) => o.code === v.answerCode)) return { status: "STALE_QUESTION" };
  if (!isIntegrityQuestionType(q.questionType)) return { status: "INVARIANT_VIOLATION", detail: `question ${v.questionId} is not an integrity question type` };

  const supersedesId = q.previousAnswer?.contextId ?? null;
  const draft: OwnerContextDraft = {
    questionId: q.questionId,
    questionType: q.questionType,
    questionText: q.textHe,
    caseId: q.caseId,
    caseType: q.questionType,
    caseSchemaVersion: INTEGRITY_SCHEMA_VERSION,
    caseFactsFingerprint: q.fingerprint,
    subjectType: q.subject.type,
    subjectId: q.subject.id,
    answerCode: v.answerCode,
    explicitDateYmd: null,
    answeredOnYmd: null,
    triggerContextId: null,
    note: null,
    scope: "CASE_INSTANCE",
    provenance: { source: "owner_manual" },
    supersedesId,
  };
  let saved: PersistedOwnerContext;
  try {
    saved = await deps.appendOwnerContext(draft);
  } catch (e) {
    if (e instanceof OwnerContextStoreError) {
      if (e.code === "ANSWER_EXISTS_USE_REVISION" || e.code === "REVISION_BRANCH_CONFLICT" || e.code === "REVISION_TARGET_MISMATCH" || e.code === "SUPERSEDED_NOT_FOUND") return { status: "STALE_QUESTION" };
      if (e.code === "READ_FAILED" || e.code === "WRITE_FAILED") return { status: "FAILED", detail: e.message };
      return { status: "INVARIANT_VIOLATION", detail: e.message };
    }
    return { status: "FAILED", detail: (e as Error).message };
  }
  deps.audit("partner_integrity_answer", { actorUserId, requestId: v.requestId, questionId: v.questionId, answerCode: v.answerCode, contextId: saved.id, supersedesId });
  return { status: "ANSWER_SAVED", contextId: saved.id, supersedesId, learned: await safeVerify(deps, saved.id, v.questionId) };
}

/** verify(): the fresh register applies this context to its question, and no longer asks it. Pure helper. */
export function registerAppliesContext(register: CompanyIntegrityRegister, contextId: string, questionId: string): boolean {
  return register.answeredQuestions.some((a) => a.contextId === contextId && a.questionId === questionId) && !register.questions.some((q) => q.questionId === questionId);
}
