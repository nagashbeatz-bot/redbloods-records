/**
 * Redbloods Partner — the minimal investigation CASE answer, reached from Claude through the bridge (Question memory stage 6, Owner decision Q1, 2026-10-05).
 *
 * ONE question type only: WAS_DELIVERY_REVIEWED_OUTSIDE_SYSTEM on the investigation case DELIVERY_WITHOUT_RECORDED_FOLLOWUP
 * of ONE Victor work ("דיברתי עם ויקטור / בדקתי את זה מחוץ למערכת"). Not a generic investigation bridge: any other
 * question type, case type or subject is refused; OTHER (free text) is never offered.
 *
 *   1. the questionRef carries the work id + a SEEN mark of the version the Owner was shown (sha256 of work + the latest
 *      upload instant) — the server re-reads the LIVE case and refuses when a newer version was uploaded since (STALE);
 *   2. exact identity: the live case id, subject type victorWork and subject id must be exactly the ref's work — an
 *      answer about work A can never be written on work B;
 *   3. the question is rebuilt by the investigation model (decideInvestigation) and the draft by buildOwnerContextDraft;
 *      the ONLY write is one append-only partner_owner_context row (provenance owner_via_claude, set here);
 *   4. an earlier answer on the SAME facts → ALREADY_ANSWERED (nothing written); an earlier answer on OLDER facts (a new
 *      version since) → a revision superseding it (the server picks the head, never the input);
 *   5. LEARNED only after a FRESH read shows the row CURRENT and served on THIS work.
 *
 * Meaning (said to the Owner, never more): his statement about THIS delivery. It is not Victor's commitment, it changes no
 * record and does not move the ball (computeVictorBall is untouched); a push is never proof of communication; a NEW
 * version uploaded later reopens the question for that work only.
 */
import { sha256Hex } from "../actions/canonical";
import type { PartnerCase } from "../cases/types";
import { OwnerContextStoreError, buildOwnerContextDraft, type OwnerContextDraft } from "./context-persistence";
import type { PersistedOwnerContext } from "./context-row";
import { ANSWER_OPTIONS, decideInvestigation } from "./questions";
import type { OwnerContextProvenance } from "./types";
import { victorDeliveryQuestionId } from "../sunny/known-context";
import { encodeQuestionRef, type QuestionRef } from "../bridge/ref";

export const CASE_ANSWER_QUESTION_TYPE = "WAS_DELIVERY_REVIEWED_OUTSIDE_SYSTEM" as const;
export const CASE_ANSWER_CASE_TYPE = "DELIVERY_WITHOUT_RECORDED_FOLLOWUP" as const;
/** The closed answers offered through Claude — exactly the question's own options, never OTHER. */
export const CASE_ANSWER_OPTIONS: ReadonlyArray<{ code: string; labelHe: string }> = ANSWER_OPTIONS[CASE_ANSWER_QUESTION_TYPE].map((o) => ({ code: o.code, labelHe: o.labelHe }));

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const caseIdOf = (workId: string) => `victor_delivery_no_followup:${workId}`;
const instant = (x: string) => { const t = Date.parse(x); return Number.isFinite(t) ? new Date(t).toISOString() : x; };

/** The SEEN mark: which version of THIS work the Owner was shown (a new upload changes it). */
export function victorDeliverySeen(workId: string, lastUploadAt: string): string {
  return sha256Hex(`victor-delivery-seen-v1|${workId}|${instant(lastUploadAt)}`);
}

/** The ref a Victor OUTSIDE_COMMUNICATION question carries (null when the work has no recorded upload). */
export function victorDeliveryQuestionRef(workId: string, lastUploadAt: string | null): string | null {
  if (!UUID_RE.test(workId) || !lastUploadAt) return null;
  return encodeQuestionRef({ kind: "case", questionId: victorDeliveryQuestionId(workId), subjectId: workId, fingerprint: victorDeliverySeen(workId, lastUploadAt) });
}

export type LiveCaseRead =
  | { status: "OK"; caseRef: PartnerCase | null; contexts: PersistedOwnerContext[] }
  | { status: "READ_FAILED"; detail: string };

export interface CaseAnswerDeps {
  /** The LIVE case (null = it no longer exists) + its full Owner Context history. */
  loadCase(caseId: string): Promise<LiveCaseRead>;
  appendOwnerContext(draft: OwnerContextDraft): Promise<PersistedOwnerContext>;
  /** A FRESH read: the row is CURRENT and served as the Owner's decision on THIS work. */
  verify(contextId: string, questionId: string, workId: string): Promise<boolean>;
  audit(event: string, data: Record<string, unknown>): void;
}

export type CaseAnswerResult =
  | { status: "ANSWER_SAVED"; contextId: string; supersedesId: string | null; learned: boolean }
  | { status: "ALREADY_ANSWERED"; contextId: string; answerCode: string; sameAnswer: boolean }
  | { status: "STALE_QUESTION" | "NOT_CURRENT" }
  | { status: "INVALID"; detail: string }
  | { status: "LIVE_READ_FAILED" | "FAILED" | "INVARIANT_VIOLATION"; detail: string };

/** The head (no successor) of this question's revision chain — the row a new answer must supersede. */
export function questionHead(contexts: readonly PersistedOwnerContext[], questionId: string): { head: PersistedOwnerContext | null; ok: boolean } {
  const rows = contexts.filter((c) => c.questionId === questionId);
  const superseded = new Set(rows.map((c) => c.supersedesId).filter(Boolean));
  const heads = rows.filter((c) => !superseded.has(c.id));
  return heads.length > 1 ? { head: null, ok: false } : { head: heads[0] ?? null, ok: true };
}

export async function answerCaseQuestionCore(deps: CaseAnswerDeps & { provenance: OwnerContextProvenance }, actorUserId: string, ref: QuestionRef, answerCode: string): Promise<CaseAnswerResult> {
  const workId = ref.subjectId;
  if (ref.kind !== "case" || !UUID_RE.test(workId) || ref.questionId !== victorDeliveryQuestionId(workId)) return { status: "INVALID", detail: "not a Victor delivery question" };
  if (!CASE_ANSWER_OPTIONS.some((o) => o.code === answerCode)) return { status: "INVALID", detail: "answer is not an option of this question" };

  let live: LiveCaseRead;
  try { live = await deps.loadCase(caseIdOf(workId)); } catch (e) { return { status: "LIVE_READ_FAILED", detail: (e as Error).message }; }
  if (live.status === "READ_FAILED") return { status: "LIVE_READ_FAILED", detail: live.detail };
  const { head, ok } = questionHead(live.contexts, ref.questionId);
  if (!ok) return { status: "INVARIANT_VIOLATION", detail: `question ${ref.questionId} has more than one head` };
  const c = live.caseRef;
  if (!c) {
    // the case is gone (notes sent / work closed): the answer already given for the version shown is a replay, anything else is not current
    return head && head.answerCode === answerCode ? { status: "ALREADY_ANSWERED", contextId: head.id, answerCode, sameAnswer: true } : { status: "NOT_CURRENT" };
  }
  // exact identity: THIS work's case only
  if (c.id !== caseIdOf(workId) || c.caseType !== CASE_ANSWER_CASE_TYPE || c.subjectType !== "victorWork" || c.subjectId !== workId) return { status: "INVARIANT_VIOLATION", detail: "live case identity does not match the work" };
  const upload = c.facts.find((f) => f.field === "lastUploadAt")?.value;
  if (typeof upload !== "string" || victorDeliverySeen(workId, upload) !== ref.fingerprint) return { status: "STALE_QUESTION" };
  const q = decideInvestigation(c).question;
  if (!q || q.questionType !== CASE_ANSWER_QUESTION_TYPE || q.id !== ref.questionId) return { status: "NOT_CURRENT" };

  if (head && head.caseFactsFingerprint === q.caseFactsFingerprint) return { status: "ALREADY_ANSWERED", contextId: head.id, answerCode: head.answerCode, sameAnswer: head.answerCode === answerCode };
  const supersedesId = head?.id ?? null;
  const draft: OwnerContextDraft = { ...buildOwnerContextDraft(q, c.schemaVersion, { answerCode, supersedesId, note: null }), provenance: deps.provenance };
  let saved: PersistedOwnerContext;
  try { saved = await deps.appendOwnerContext(draft); } catch (e) {
    if (e instanceof OwnerContextStoreError) {
      if (e.code === "ANSWER_EXISTS_USE_REVISION" || e.code === "REVISION_BRANCH_CONFLICT" || e.code === "REVISION_TARGET_MISMATCH" || e.code === "SUPERSEDED_NOT_FOUND") return { status: "STALE_QUESTION" };
      if (e.code === "READ_FAILED" || e.code === "WRITE_FAILED") return { status: "FAILED", detail: e.message };
      return { status: "INVARIANT_VIOLATION", detail: e.message };
    }
    return { status: "FAILED", detail: (e as Error).message };
  }
  deps.audit("partner_case_answer", { actorUserId, questionId: ref.questionId, workId, answerCode, contextId: saved.id, supersedesId });
  let learned = false;
  try { learned = await deps.verify(saved.id, ref.questionId, workId); } catch { learned = false; }
  return { status: "ANSWER_SAVED", contextId: saved.id, supersedesId, learned };
}

/** What the Owner is told (fixed wording): his statement, on THIS delivery only — never a commitment, never a record change. */
export function caseLearnedMessageHe(answerCode: string): string {
  const label = CASE_ANSWER_OPTIONS.find((o) => o.code === answerCode)?.labelHe ?? answerCode;
  return `למדתי. שמרתי את מה שאמרת על המסירה הזו של ויקטור בלבד: ${label}. זו אמירה שלך — לא התחייבות של ויקטור, ושום רשומה לא השתנתה (הכדור לפי הרשומות לא זז). אם ויקטור יעלה גרסה חדשה, אשאל שוב רק על העבודה הזו.`;
}
