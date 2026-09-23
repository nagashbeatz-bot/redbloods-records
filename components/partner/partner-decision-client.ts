/**
 * Redbloods Partner — Owner decision client helpers (Phase F.1J). Pure (no React, no fetch).
 *
 * Builds the exact request bodies the decision routes accept and interprets
 * their responses strictly (anything unexpected fails closed to an error that
 * changes nothing). The body always echoes EXACTLY what the card was rendered
 * from (actionId, seenSnapshotHash, expectedHeadEventId) — never a newer
 * proposal. A requestId belongs to one decision scope; a retry of the SAME
 * attempt reuses it, a new attempt gets a new one. No automatic retries.
 */
import type { ChangeValueAnswerCode, PartnerActionCardDto } from "@/lib/partner/actions/surface-dto";

export type NotNowChoice = "LATER_TODAY" | "TOMORROW" | "IN_3_DAYS" | "IN_1_WEEK" | "CUSTOM";
/** The Owner's choices. SYSTEM_DEFAULT is deliberately not offered. */
export const NOT_NOW_CHOICES: ReadonlyArray<{ code: NotNowChoice; labelHe: string }> = [
  { code: "LATER_TODAY", labelHe: "מאוחר יותר היום" },
  { code: "TOMORROW", labelHe: "מחר" },
  { code: "IN_3_DAYS", labelHe: "בעוד 3 ימים" },
  { code: "IN_1_WEEK", labelHe: "בעוד שבוע" },
  { code: "CUSTOM", labelHe: "תאריך אחר" },
];

export const DECIDE_URL = "/api/partner/actions/decide";
export const CHANGE_URL = "/api/partner/actions/change-deadline";
export const STALE_MESSAGE_HE = "ההצעה השתנתה. רעננתי את המידע.";

export interface DecisionAttempt { url: string; body: Record<string, unknown>; kind: "APPROVE" | "NOT_NOW" | "CHANGE" }

const YMD = /^\d{4}-\d{2}-\d{2}$/;

export function buildApproveAttempt(item: PartnerActionCardDto, requestId: string): DecisionAttempt {
  return { url: DECIDE_URL, kind: "APPROVE", body: { actionId: item.actionId, decision: "APPROVE", seenSnapshotHash: item.snapshotHash, expectedHeadEventId: item.headEventId, requestId } };
}

export function buildNotNowAttempt(item: PartnerActionCardDto, requestId: string, choice: NotNowChoice, customYmd: string | null): DecisionAttempt | null {
  if (choice === "CUSTOM" && (!customYmd || !YMD.test(customYmd))) return null;
  const body: Record<string, unknown> = { actionId: item.actionId, decision: "NOT_NOW", seenSnapshotHash: item.snapshotHash, expectedHeadEventId: item.headEventId, requestId, deferChoice: choice };
  if (choice === "CUSTOM") body.deferDateYmd = customYmd;
  return { url: DECIDE_URL, kind: "NOT_NOW", body };
}

export function buildChangeAttempt(item: PartnerActionCardDto, answerCode: ChangeValueAnswerCode, specificYmd: string | null): DecisionAttempt | null {
  if (!item.changeValueOptions.some((o) => o.code === answerCode)) return null;
  if (answerCode === "SPECIFIC_DATE" && (!specificYmd || !YMD.test(specificYmd) || specificYmd < item.minChangeDate)) return null;
  return { url: CHANGE_URL, kind: "CHANGE", body: { actionId: item.actionId, seenSnapshotHash: item.snapshotHash, answerCode, explicitDateYmd: answerCode === "SPECIFIC_DATE" ? specificYmd : null } };
}

export type DecisionOutcome =
  | { ui: "approved"; messageHe: string }
  | { ui: "deferred"; messageHe: string }
  | { ui: "changed"; messageHe: string }
  | { ui: "executed"; messageHe: string }
  | { ui: "stale"; messageHe: string }
  | { ui: "retry"; messageHe: string }
  | { ui: "error"; messageHe: string };

function fmtInstantHe(iso: unknown): string | null {
  if (typeof iso !== "string" || Number.isNaN(Date.parse(iso))) return null;
  try { return new Intl.DateTimeFormat("he-IL", { timeZone: "Asia/Jerusalem", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso)); } catch { return null; }
}

/** Strict interpretation of a decision route response. Unknown shapes → error (nothing assumed). */
export function interpretDecisionResponse(kind: DecisionAttempt["kind"], httpStatus: number, json: unknown): DecisionOutcome {
  const r = typeof json === "object" && json !== null && !Array.isArray(json) ? (json as Record<string, unknown>) : null;
  const status = typeof r?.status === "string" ? r.status : null;
  if (httpStatus === 401 || httpStatus === 403) return { ui: "error", messageHe: "אין הרשאה לבצע את הפעולה הזו." };
  if (httpStatus === 503 || status === "RETRYABLE" || status === "LIVE_READ_FAILED") return { ui: "retry", messageHe: "לא הצלחתי לשמור כרגע. אפשר לנסות שוב." };
  if (httpStatus >= 500 || status === null) return { ui: "error", messageHe: "משהו השתבש — לא נשמר דבר." };
  if (httpStatus === 400) return { ui: "error", messageHe: "הבקשה לא תקינה — לא נשמר דבר." };
  if (kind === "CHANGE") {
    if (status === "CONTEXT_REVISED" && typeof r?.newDeadline === "string" && YMD.test(r.newDeadline)) {
      const [y, m, d] = r.newDeadline.split("-");
      return { ui: "changed", messageHe: `התאריך עודכן ל-${d}.${m}.${y}. ההצעה חושבה מחדש.` };
    }
    if (status === "STALE" || status === "NOT_DERIVABLE" || status === "PROPOSAL_CHANGED") return { ui: "stale", messageHe: STALE_MESSAGE_HE };
    return { ui: "error", messageHe: "משהו השתבש — לא נשמר דבר." };
  }
  if (status === "RECORDED" || status === "REPLAY") {
    if (kind === "APPROVE" && r?.eventType === "APPROVED") return { ui: "approved", messageHe: "הפעולה אושרה וממתינה לביצוע." };
    if (kind === "NOT_NOW" && r?.eventType === "NOT_NOW") {
      const when = fmtInstantHe(r?.deferUntil);
      return { ui: "deferred", messageHe: when ? `בסדר, אחזור לזה ב-${when}.` : "בסדר, אחזור לזה בהמשך." };
    }
    return { ui: "error", messageHe: "משהו השתבש — רעננתי את המידע." };
  }
  if (["PROPOSAL_CHANGED", "STALE", "NOT_DERIVABLE", "HEAD_CONFLICT", "ALREADY_IN_STATE", "ALREADY_EXECUTED", "INVALID_TRANSITION"].includes(status)) return { ui: "stale", messageHe: STALE_MESSAGE_HE };
  if (status === "REQUEST_ID_CONFLICT") return { ui: "error", messageHe: "משהו השתבש — רעננתי את המידע. לא נשמר דבר חדש." };
  return { ui: "error", messageHe: "משהו השתבש — לא נשמר דבר." };
}

// ── F.1K: "בצע עכשיו" (execution of an APPROVED action) ─────────────────────────────────────────
export const EXECUTE_URL = "/api/partner/actions/execute";
export const EXECUTE_STALE_MESSAGE_HE = "הפעולה כבר לא מתאימה למצב הנוכחי. רעננתי את המידע.";

export interface ExecuteAttempt { url: typeof EXECUTE_URL; body: { approvalEventId: string; requestId: string } }

/** Only from an AWAITING_EXECUTION card: the persisted approval + ONE requestId for this execution attempt. */
export function buildExecuteAttempt(item: PartnerActionCardDto, requestId: string): ExecuteAttempt | null {
  if (item.state !== "AWAITING_EXECUTION" || !item.approvalEventId || !requestId) return null;
  return { url: EXECUTE_URL, body: { approvalEventId: item.approvalEventId, requestId } };
}

/**
 * Strict mapping of the execute route. The persisted chain stays authoritative: every outcome is followed by
 * a re-fetch of the surface. Unknown shapes fail closed to an error that claims nothing.
 */
export function interpretExecuteResponse(httpStatus: number, json: unknown): DecisionOutcome {
  const r = typeof json === "object" && json !== null && !Array.isArray(json) ? (json as Record<string, unknown>) : null;
  const status = typeof r?.status === "string" ? r.status : null;
  if (httpStatus === 401 || httpStatus === 403) return { ui: "error", messageHe: "אין הרשאה לבצע את הפעולה הזו." };
  if (httpStatus === 503 || status === "RETRYABLE") return { ui: "retry", messageHe: "לא הצלחתי לבצע כרגע. אפשר לנסות שוב." };
  if (httpStatus >= 500 || status === null || status === "INVARIANT_VIOLATION") return { ui: "error", messageHe: "משהו השתבש — הפעולה לא בוצעה." };
  if (httpStatus === 400) return { ui: "error", messageHe: "הבקשה לא תקינה — הפעולה לא בוצעה." };
  switch (status) {
    case "EXECUTED": return { ui: "executed", messageHe: "הפעולה בוצעה." };
    case "ALREADY_EXECUTED": return { ui: "executed", messageHe: "הפעולה כבר בוצעה." };
    case "REPLAY":
      if (r?.eventType === "EXECUTED") return { ui: "executed", messageHe: "הפעולה בוצעה." };
      if (r?.eventType === "STALE_AT_EXECUTION") return { ui: "stale", messageHe: EXECUTE_STALE_MESSAGE_HE };
      return { ui: "error", messageHe: "משהו השתבש — רעננתי את המידע." };
    case "STALE_AT_EXECUTION": return { ui: "stale", messageHe: EXECUTE_STALE_MESSAGE_HE };
    case "APPROVAL_NOT_CURRENT": return { ui: "stale", messageHe: STALE_MESSAGE_HE };
    case "APPROVAL_NOT_FOUND": return { ui: "error", messageHe: "האישור לא נמצא — רעננתי את המידע. הפעולה לא בוצעה." };
    case "ACTION_MISMATCH": return { ui: "error", messageHe: "משהו לא תואם — הפעולה לא בוצעה." };
    case "REQUEST_ID_CONFLICT": return { ui: "error", messageHe: "משהו השתבש — רעננתי את המידע. הפעולה לא בוצעה." };
    default: return { ui: "error", messageHe: "משהו השתבש — הפעולה לא בוצעה." };
  }
}

/** UI phases of one card. */
export type DecisionPhase = "idle" | "submitting" | "success" | "stale" | "error";
export function phaseForOutcome(o: DecisionOutcome): DecisionPhase {
  if (o.ui === "approved" || o.ui === "deferred" || o.ui === "changed" || o.ui === "executed") return "success";
  if (o.ui === "stale") return "stale";
  return "error";
}
