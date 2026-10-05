/**
 * Universal Action Layer — how each primitive's verification actually proves its change (claim contract, Owner-approved
 * 2026-10-05). Pure constants, one place, pinned by scripts/test-sunny-claim-contract.tsx.
 *
 *   FRESH_READ — the target is read again after the write and EVERY planned after-value is in place (or, for a delete, the
 *                record is gone). Only this allows the full claim "בוצע — בדקתי מחדש והשינוי קיים".
 *   PARTIAL    — a fresh read confirms the main record (it exists / its key fields), but not every field or not the side
 *                effects the writer also performs (calendar, finance rows, ledger, links). Say what was confirmed.
 *   RECEIPT    — no fresh read of the effect itself: the writer's own receipt (a push / email / sync / file move / a settings
 *                write whose read view cannot show it). Say "the system that did it confirmed it", never "I checked again".
 *
 * Nothing here changes what a primitive does — only what may be SAID about it.
 */
export type VerifyKind = "FRESH_READ" | "PARTIAL" | "RECEIPT";

/** Verification is the writer's receipt only (commands, pushes, emails, syncs, file moves, constant read views). */
export const RECEIPT_VERIFIED: ReadonlySet<string> = new Set([
  "SYNC_GOOGLE_TASKS_NOW", "CREATE_GOOGLE_TASK", "SEND_CYCLE_REMINDER", "NOTIFY_SKETCH", "SET_NEXT_WORK", "SET_NEXT_RELEASE",
  "FORCE_ENGINEER_FINANCE_SYNC", "NOTIFY_MIX_READY", "SEND_MIX_NOTES", "MARK_SHOW_QUOTE_SENT", "NOTIFY_VICTOR_WORK", "SEND_VICTOR_VERSION_NOTES",
  "DELETE_CANCELLED_PRODUCTIONS", "SHARE_FILE_TO_PORTAL", "IMPORT_DELIVERY_FROM_LINK", "SEND_REPORT_NOW",
]);

/** A fresh read confirms the main record, but not every field / not the writer's side effects. */
export const PARTIAL_VERIFIED: ReadonlySet<string> = new Set([
  // creates that re-read the new record by 1–3 key fields
  "CREATE_CLIENT", "CREATE_PROPOSAL", "CREATE_MEETING", "CREATE_TASK", "CREATE_CALENDAR_EVENT", "CREATE_CALENDAR_INVITE", "CREATE_LABEL_ARTIST",
  "ADD_LEDGER_ENTRY", "CREATE_ENGINEER_WORK", "ADD_MIX_COMMENT", "ADD_RIDDIM_LINE", "ADD_PREMIX_NOTE", "CREATE_PROJECT", "CREATE_LABEL_SONG",
  "CREATE_PRODUCTION", "ADD_RF_BUDGET_LINE", "ADD_CLIP_ROW", "ADD_EQUIPMENT", "CREATE_SHOW", "CREATE_VICTOR_WORK", "ADD_SEND_LOG_ENTRY",
  "CREATE_SOCIAL_CAMPAIGN", "ADD_SOCIAL_CONTENT", "ADD_PROMOTION",
  // the main record is re-read; money / ledger / calendar / link side effects are not
  "CONVERT_PROPOSAL", "CLOSE_SHOW", "SET_SHOW_MONEY", "UPDATE_SHOW_REHEARSAL", "RECORD_RF_BUDGET_PAYMENT", "LINK_RF_PAYMENTS_FOR_PRODUCTION",
]);

/** Primitives with a CUSTOM verify that still re-reads every planned value (or proves a delete by absence) — FRESH_READ. */
export const CUSTOM_FRESH_READ: ReadonlySet<string> = new Set([
  "BACKFILL_PROJECT_START_DATES", "CREATE_MISSING_ARTIST_CLIENTS", "FREEZE_PROJECT_FOLDERS", "RENAME_CLIENT", "UPDATE_CALENDAR_EVENT",
  "ADD_TRANSACTION", "SPLIT_INCOME", "LINK_INBOX_ENTITY", "RECORD_INBOX_INTERPRETATION", "ADD_MEDIA_INCOME", "ADD_RF_VIDEO_REFERENCE",
  "ADD_VICTOR_REFERENCE", "LINK_RF_PAYMENT_TO_FINANCE", "PROMOTE_CLIP_ROW", "SET_SHOW_DEAL_TYPE", "ASSIGN_SHOW_DJ", "NOTIFY_SHOW_ARTIST",
  "NOTIFY_SHOW_DJ", "RECORD_SHOW_PAYMENT", "BOOK_SHOW_REHEARSAL", "UPDATE_VICTOR_VERSION_REVIEW", "SET_ALBUM_PREV_ROW", "ADD_ALBUM_TRACK",
]);

/**
 * Upload placements (kinds ["upload"], lib/partner/act/primitives/uploads.ts) re-read only that the inbox item was consumed —
 * the file's arrival at its destination is the shared writer's receipt. DISCARD_INBOX_ITEM's effect IS the consumed item.
 */
export const isUploadPlacement = (spec: { actionId: string; kinds: readonly string[] }) => spec.kinds.includes("upload") && spec.actionId !== "DISCARD_INBOX_ITEM";

export function verifyKindOf(actionId: string, kinds: readonly string[] = []): VerifyKind {
  if (RECEIPT_VERIFIED.has(actionId) || isUploadPlacement({ actionId, kinds })) return "RECEIPT";
  if (PARTIAL_VERIFIED.has(actionId)) return "PARTIAL";
  return "FRESH_READ";
}

/** The weakest verification across the applied steps decides what may be claimed for the whole plan. */
export function weakestVerifyKind(kinds: readonly VerifyKind[]): VerifyKind {
  return kinds.includes("RECEIPT") ? "RECEIPT" : kinds.includes("PARTIAL") ? "PARTIAL" : "FRESH_READ";
}

/** Engine step detail for a verified / failed step (FRESH_READ keeps the historical wording). */
export function verifiedDetail(kind: VerifyKind, ok: boolean): string {
  if (kind === "RECEIPT") return ok ? "confirmed by the writer's receipt — the effect itself was not read again" : "the writer did not confirm the change";
  if (kind === "PARTIAL") return ok ? "the main record was verified by a fresh read; other fields / side effects were not read again" : "executed but the fresh read of the main record does not match the preview";
  return ok ? "verified by a fresh read" : "executed but the fresh read does not match the preview";
}
