/**
 * Redbloods Partner — Finance Owner answer client helpers (F2.8–F2.10). Pure (no React, no fetch).
 *
 * Builds the exact body POST /api/partner/finance/answer accepts — always echoing the question EXACTLY as
 * it was rendered (questionId + fingerprint) — and interprets the response strictly (anything unexpected
 * fails closed to an error that changes nothing). One requestId per click; no automatic retries.
 */
import type { FinanceRehabQuestionDto } from "@/lib/partner/finance/dto";

export const FINANCE_ANSWER_URL = "/api/partner/finance/answer";
export const FINANCE_STALE_MESSAGE_HE = "השאלה השתנתה. רעננתי את המידע.";
export const FINANCE_SAVED_MESSAGE_HE = "נשמר. עדכנתי את התמונה לפי מה שאמרת.";
export const FINANCE_ERROR_MESSAGE_HE = "לא הצלחתי לשמור את התשובה. לא נשמר דבר — אפשר לנסות שוב.";

const YMD = /^\d{4}-\d{2}-\d{2}$/;

export interface FinanceAnswerAttempt { url: string; body: { questionId: string; answerCode: string; seenQuestionFingerprint: string; requestId: string; exactDateYmd: string | null } }

export function buildFinanceAnswerAttempt(q: FinanceRehabQuestionDto, answerCode: string, exactDateYmd: string | null, requestId: string): FinanceAnswerAttempt | null {
  if (!q.answer || !requestId) return null;
  if (!q.options.some((o) => o.code === answerCode)) return null;
  const needsDate = q.answer.exactDateCode === answerCode;
  if (needsDate ? !(exactDateYmd && YMD.test(exactDateYmd)) : exactDateYmd !== null) return null;
  return { url: FINANCE_ANSWER_URL, body: { questionId: q.answer.questionId, answerCode, seenQuestionFingerprint: q.answer.fingerprint, requestId, exactDateYmd: needsDate ? exactDateYmd : null } };
}

export type FinanceAnswerOutcome = { ui: "saved" | "stale" | "error"; messageHe: string };

export function interpretFinanceAnswerResponse(httpStatus: number, json: unknown): FinanceAnswerOutcome {
  const status = typeof json === "object" && json !== null && !Array.isArray(json) ? (json as { status?: unknown }).status : undefined;
  if (httpStatus === 200 && (status === "ANSWER_SAVED" || status === "REPLAY")) return { ui: "saved", messageHe: FINANCE_SAVED_MESSAGE_HE };
  if (httpStatus === 200 && status === "STALE_QUESTION") return { ui: "stale", messageHe: FINANCE_STALE_MESSAGE_HE };
  if (httpStatus === 400 && status === "INVALID_INPUT") return { ui: "error", messageHe: "התשובה לא התקבלה (למשל תאריך שכבר עבר). לא נשמר דבר." };
  if (httpStatus === 401 || httpStatus === 403) return { ui: "error", messageHe: "אין הרשאה לשמור תשובה. לא נשמר דבר." };
  return { ui: "error", messageHe: FINANCE_ERROR_MESSAGE_HE };
}
