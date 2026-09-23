/**
 * Redbloods Partner — Collections resolver (Finance Brain V1). Pure, deterministic, no I/O.
 *
 * Owner-approved ADAPTIVE reminder policy (display-only in V1 — no Push, no Cron):
 *   important (≥ ₪3,000, or a VIP client):  7 days before · 1 day before · due date · weekly while overdue
 *   standard:                               3 days before · due date · weekly while overdue
 *   no due date:                            surfaced weekly as "צריך לקבוע תאריך גבייה"
 * Non-ILS amounts have no approved threshold: they are "important" only via VIP.
 */
import { diffDays } from "../../coo/dates";
import type { CollectionInfo, ImportanceBasis } from "./types";

export const HIGH_VALUE_THRESHOLD_ILS = 3000;
/** The weekday (Israel week start, Sunday = 0) on which weekly items are due for a reminder. */
export const WEEKLY_REMINDER_WEEKDAY = 0;

export function importanceOf(amount: number, currency: string, vip: boolean): { important: boolean; basis: ImportanceBasis } {
  if (vip) return { important: true, basis: "VIP_CLIENT" };
  if (currency !== "₪") return { important: false, basis: "NON_ILS_NO_THRESHOLD" };
  return amount >= HIGH_VALUE_THRESHOLD_ILS ? { important: true, basis: "HIGH_VALUE" } : { important: false, basis: "STANDARD" };
}

const weekday = (ymd: string) => new Date(`${ymd}T12:00:00Z`).getUTCDay();

export interface CollectionInput {
  amount: number;
  currency: string;
  dueDate: string | null;
  today: string;
  vip: boolean;
  /** Nothing left to collect (paid ≥ agreed). */
  settled?: boolean;
  /** The project itself is cancelled — the balance is not an active collection. */
  notCollectible?: boolean;
  /** Conflicting data (e.g. currency mismatch) — never presented as a clean collection. */
  needsReview?: boolean;
}

export function resolveCollection(i: CollectionInput): CollectionInfo {
  const { important, basis } = importanceOf(i.amount, i.currency, i.vip);
  const base = { important, importanceBasis: basis };
  if (i.settled || i.amount <= 0) return { ...base, state: "SETTLED", reminderStage: "NONE", daysUntilDue: null, daysOverdue: null, remindToday: false };
  if (i.notCollectible) return { ...base, state: "NOT_COLLECTIBLE", reminderStage: "NONE", daysUntilDue: null, daysOverdue: null, remindToday: false };
  if (i.needsReview) return { ...base, state: "NEEDS_REVIEW", reminderStage: "NONE", daysUntilDue: null, daysOverdue: null, remindToday: false };
  if (!i.dueDate) {
    return { ...base, state: "NO_DUE_DATE", reminderStage: "WEEKLY_NO_DATE", daysUntilDue: null, daysOverdue: null, remindToday: weekday(i.today) === WEEKLY_REMINDER_WEEKDAY };
  }
  const until = diffDays(i.today, i.dueDate);
  if (until === 0) return { ...base, state: "DUE_TODAY", reminderStage: "DUE_TODAY", daysUntilDue: 0, daysOverdue: 0, remindToday: true };
  if (until < 0) {
    const overdue = -until;
    return { ...base, state: "OVERDUE", reminderStage: "WEEKLY_OVERDUE", daysUntilDue: until, daysOverdue: overdue, remindToday: overdue % 7 === 0 };
  }
  if (important) {
    if (until === 1) return { ...base, state: "DUE_SOON", reminderStage: "1D_BEFORE", daysUntilDue: 1, daysOverdue: null, remindToday: true };
    if (until <= 7) return { ...base, state: "DUE_SOON", reminderStage: "7D_BEFORE", daysUntilDue: until, daysOverdue: null, remindToday: until === 7 };
  } else if (until <= 3) {
    return { ...base, state: "DUE_SOON", reminderStage: "3D_BEFORE", daysUntilDue: until, daysOverdue: null, remindToday: until === 3 };
  }
  return { ...base, state: "UPCOMING", reminderStage: "NONE", daysUntilDue: until, daysOverdue: null, remindToday: false };
}
