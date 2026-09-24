/**
 * Redbloods Partner — Company Integrity Owner answer client helpers. Pure (no React, no fetch).
 *
 * Builds the exact body POST /api/partner/integrity/answer accepts — always echoing the question EXACTLY as it was
 * rendered (questionId + subjectId + fingerprint) — and interprets the response strictly: "למדתי" is shown ONLY when
 * the server saved the answer AND re-read it as applied (learned: true). Anything else fails closed.
 */
import type { IntegrityQuestionDto } from "@/lib/partner/integrity/dto";

export const INTEGRITY_ANSWER_URL = "/api/partner/integrity/answer";
export const INTEGRITY_STALE_MESSAGE_HE = "השאלה השתנתה בינתיים. רעננתי את המידע.";
export const INTEGRITY_ERROR_MESSAGE_HE = "לא הצלחתי לשמור את התשובה. לא נשמר דבר — אפשר לנסות שוב.";
export const INTEGRITY_UNVERIFIED_MESSAGE_HE = "התשובה נשלחה, אבל עוד לא הצלחתי לוודא שהיא בשימוש. רעננתי את המידע.";
export const learnedMessageHe = (subjectLabel: string) => `למדתי. אשתמש בזה כשאני מנתח את הפרויקטים של ${subjectLabel}.`;

export interface IntegrityAnswerAttempt { url: string; body: { questionId: string; subjectId: string; answerCode: string; seenQuestionFingerprint: string; requestId: string } }

export function buildIntegrityAnswerAttempt(q: IntegrityQuestionDto, answerCode: string, requestId: string): IntegrityAnswerAttempt | null {
  if (!requestId || !q.options.some((o) => o.code === answerCode)) return null;
  return { url: INTEGRITY_ANSWER_URL, body: { questionId: q.questionId, subjectId: q.subjectId, answerCode, seenQuestionFingerprint: q.fingerprint, requestId } };
}

export type IntegrityAnswerOutcome = { ui: "learned" | "unverified" | "stale" | "error"; messageHe: string };

export function interpretIntegrityAnswerResponse(httpStatus: number, json: unknown, subjectLabel: string): IntegrityAnswerOutcome {
  const o = typeof json === "object" && json !== null && !Array.isArray(json) ? (json as { status?: unknown; learned?: unknown }) : {};
  if (httpStatus === 200 && (o.status === "ANSWER_SAVED" || o.status === "REPLAY")) {
    return o.learned === true ? { ui: "learned", messageHe: learnedMessageHe(subjectLabel) } : { ui: "unverified", messageHe: INTEGRITY_UNVERIFIED_MESSAGE_HE };
  }
  if (httpStatus === 200 && o.status === "STALE_QUESTION") return { ui: "stale", messageHe: INTEGRITY_STALE_MESSAGE_HE };
  if (httpStatus === 401 || httpStatus === 403) return { ui: "error", messageHe: "אין הרשאה לשמור תשובה. לא נשמר דבר." };
  return { ui: "error", messageHe: INTEGRITY_ERROR_MESSAGE_HE };
}
