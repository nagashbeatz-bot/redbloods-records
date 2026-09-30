/**
 * Sunny Owner Inbox — the shared writer ("עדכון לסאני"). Every write to sunny_owner_inbox goes through here: the
 * dashboard routes (via DASHBOARD) and Sunny's typed primitive MARK_OWNER_INBOX_ITEM (via SUNNY) call the SAME functions.
 *   submit        — the Owner's text, validated (lib/owner-inbox checkInboxBody), idempotent by requestKey.
 *   markProcessed — NEW → PROCESSED (final, no reopen) with a typed outcome + its REAL reference (a plan id / a knowledge
 *                   id / none — never a free-text note). It records what happened; it never turns the text into a fact:
 *                   knowledge / actions come only from their own preview + Owner-approval flows.
 * No push, no calendar, no finance, no deletion.
 */
import { UUID_RE, checkInboxBody, checkOutcomeRef, INBOX_REF_MAX_CHARS, isInboxOutcome, type InboxVia, type OwnerInboxItem } from "../owner-inbox";
import type { InboxWriteResult, OwnerInboxStore } from "../owner-inbox-store";
import { STANDING_AUTHORIZATIONS } from "../partner/act/standing";

export type OwnerInboxSubmitResult =
  | { status: "SAVED"; item: OwnerInboxItem }
  | { status: "INVALID_INPUT"; code: string; messageHe: string }
  | { status: "CONFLICT"; messageHe: string }
  | { status: "FAILED"; messageHe: string };

export async function submitOwnerInboxUpdate(store: OwnerInboxStore, input: { body: unknown; requestKey: unknown }): Promise<OwnerInboxSubmitResult> {
  if (typeof input.requestKey !== "string" || !UUID_RE.test(input.requestKey)) return { status: "INVALID_INPUT", code: "REQUEST_KEY", messageHe: "מזהה בקשה לא תקין." };
  const checked = checkInboxBody(input.body);
  if (!checked.ok) return { status: "INVALID_INPUT", code: checked.code, messageHe: checked.messageHe };
  const r = await store.submit(checked.body, input.requestKey.toLowerCase());
  return fromWrite(r, "SAVED");
}

export type OwnerInboxProcessResult =
  | { status: "PROCESSED"; item: OwnerInboxItem }
  | { status: "INVALID_INPUT"; code: string; messageHe: string }
  | { status: "CONFLICT"; messageHe: string }
  | { status: "FAILED"; messageHe: string };

export async function markOwnerInboxItemProcessed(store: OwnerInboxStore, via: InboxVia, input: { id: unknown; outcome: unknown; outcomeRef?: unknown }): Promise<OwnerInboxProcessResult> {
  if (typeof input.id !== "string" || !UUID_RE.test(input.id)) return { status: "INVALID_INPUT", code: "ID", messageHe: "מזהה פריט לא תקין." };
  if (!isInboxOutcome(input.outcome)) return { status: "INVALID_INPUT", code: "OUTCOME", messageHe: "תוצאה לא מוכרת." };
  // outcomeRef is a REAL reference (a plan id / a knowledge id) or null — never a free-text note (Owner decision 2026-09-30)
  const ref = checkOutcomeRef(input.outcome, input.outcomeRef);
  if (!ref.ok) return { status: "INVALID_INPUT", code: ref.code, messageHe: ref.messageHe };
  if (ref.ref !== null && ref.ref.length > INBOX_REF_MAX_CHARS) return { status: "INVALID_INPUT", code: "OUTCOME_REF", messageHe: `הפניה ארוכה מדי (עד ${INBOX_REF_MAX_CHARS} תווים).` };
  const r = await store.markProcessed(input.id.toLowerCase(), via, input.outcome, ref.ref);
  return fromWrite(r, "PROCESSED");
}

function fromWrite<S extends "SAVED" | "PROCESSED">(r: InboxWriteResult, okStatus: S) {
  switch (r.status) {
    case "OK": return { status: okStatus, item: r.item } as { status: S; item: OwnerInboxItem };
    case "REQUEST_KEY_REUSED": return { status: "CONFLICT" as const, messageHe: "הבקשה הזו כבר נשמרה עם טקסט אחר." };
    case "NOT_NEW_OR_MISSING": return { status: "CONFLICT" as const, messageHe: "הפריט לא קיים או שכבר טופל." };
    case "INVALID": return { status: "INVALID_INPUT" as const, code: "DB_REFUSED", messageHe: `הערך נדחה ע״י בסיס הנתונים (${r.detail}).` };
    default: return { status: "FAILED" as const, messageHe: "השמירה נכשלה — שום דבר לא נשמר." };
  }
}

// ── outcomeRef must point at something REAL (Owner decision 2026-09-30, standing housekeeping) ──
export type PlanRefState = "EXECUTED" | "NOT_EXECUTED" | "NOT_FOUND" | "HOUSEKEEPING_ONLY";
const DONE_STEP = new Set(["APPLIED_AS_EXPECTED", "NO_CHANGE"]);
/** ACTION_PLANNED needs a business plan that already went through the normal flow and ran: every step applied. */
export function planRefState(plan: { steps: ReadonlyArray<{ actionId: string }> } | null, executions: ReadonlyArray<{ status: string }>): PlanRefState {
  if (!plan) return "NOT_FOUND";
  if (plan.steps.length > 0 && plan.steps.every((s) => STANDING_AUTHORIZATIONS.includes(s.actionId))) return "HOUSEKEEPING_ONLY";
  return executions.length === plan.steps.length && executions.every((e) => DONE_STEP.has(e.status)) ? "EXECUTED" : "NOT_EXECUTED";
}
