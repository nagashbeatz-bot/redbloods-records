/**
 * Sunny Owner Inbox — the shared writer ("עדכון לסאני"). Every write to sunny_owner_inbox goes through here (the
 * dashboard routes today; a future Sunny primitive MARK_OWNER_INBOX_ITEM must call the SAME functions).
 *   submit        — the Owner's text, validated (lib/owner-inbox checkInboxBody), idempotent by requestKey.
 *   markProcessed — NEW → PROCESSED with a typed outcome. It records what happened; it never turns the text into a
 *                   fact: knowledge / actions come only from the existing preview + Owner-approval flows.
 * No push, no calendar, no finance, no deletion.
 */
import { UUID_RE, checkInboxBody, INBOX_REF_MAX_CHARS, isInboxOutcome, type InboxVia, type OwnerInboxItem } from "../owner-inbox";
import type { InboxWriteResult, OwnerInboxStore } from "../owner-inbox-store";

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
  const ref = input.outcomeRef === undefined || input.outcomeRef === null ? null : typeof input.outcomeRef === "string" ? input.outcomeRef.trim() : undefined;
  if (ref === undefined || (ref !== null && (ref.length > INBOX_REF_MAX_CHARS || /[\u0000-\u001f\u007f]/.test(ref)))) return { status: "INVALID_INPUT", code: "OUTCOME_REF", messageHe: `הפניה לא תקינה (עד ${INBOX_REF_MAX_CHARS} תווים).` };
  const r = await store.markProcessed(input.id.toLowerCase(), via, input.outcome, ref || null);
  return fromWrite(r, "PROCESSED");
}

function fromWrite<S extends "SAVED" | "PROCESSED">(r: InboxWriteResult, okStatus: S) {
  switch (r.status) {
    case "OK": return { status: okStatus, item: r.item } as { status: S; item: OwnerInboxItem };
    case "REQUEST_KEY_REUSED": return { status: "CONFLICT" as const, messageHe: "הבקשה הזו כבר נשמרה עם טקסט אחר." };
    case "NOT_NEW_OR_MISSING": return { status: "CONFLICT" as const, messageHe: "הפריט לא קיים או שכבר טופל." };
    case "INVALID": return { status: "INVALID_INPUT" as const, code: "DB_REFUSED", messageHe: "הערך נדחה ע״י בסיס הנתונים." };
    default: return { status: "FAILED" as const, messageHe: "השמירה נכשלה — שום דבר לא נשמר." };
  }
}
