/**
 * Shared segment logic for Victor work metrics.
 * Used by both vendor-store.ts (server) and VictorCard/VictorDrawer (client).
 * Single source of truth — no duplicated filter logic.
 */
import type { VendorWork } from "@/lib/types";

/** Month attribution: sent_date if available, else created_at date part */
export function monthRef(w: VendorWork): string {
  return w.sentDate ?? w.createdAt.slice(0, 10);
}

/** Is this record attributed to the given month? */
export function inMonth(w: VendorWork, month: string): boolean {
  const ref = monthRef(w);
  return ref >= `${month}-01` && ref <= `${month}-31`;
}

export interface VictorSegments {
  /** All records attributed to this month */
  sentThisMonth: VendorWork[];
  /** status=פעיל + inMonth + NOT stuck + NOT needsReview + NOT needsFix */
  pureActive: VendorWork[];
  /** status=פעיל + inMonth + NOT stuck + workState in [חזר מויקטור, דורש בדיקה] */
  needsReview: VendorWork[];
  /** status=פעיל + inMonth + NOT stuck + workState = דורש תיקון */
  needsFix: VendorWork[];
  /** status=פעיל + isStuck — ALL TIME (open issues regardless of month) */
  stuck: VendorWork[];
  /** status=הושלם + inMonth (attributed by sentDate) */
  completed: VendorWork[];
  /** status=בוטל + inMonth (attributed by sentDate) */
  cancelled: VendorWork[];
  /** outcome=אושר + inMonth */
  approved: VendorWork[];
  /** outcome=נכנס לפרויקט בפועל + inMonth */
  entered: VendorWork[];
}

export function segmentVictorWork(work: VendorWork[], month: string): VictorSegments {
  const im = (w: VendorWork) => inMonth(w, month);

  const activeInMonth = work.filter((w) => w.status === "פעיל" && im(w));

  const stuck      = work.filter((w) => w.isStuck); // all-time — open problem

  const needsReview = activeInMonth.filter(
    (w) => !w.isStuck && (w.workState === "חזר מויקטור" || w.workState === "דורש בדיקה")
  );
  const needsFix = activeInMonth.filter(
    (w) => !w.isStuck && w.workState === "דורש תיקון"
  );
  const pureActive = activeInMonth.filter(
    (w) =>
      !w.isStuck &&
      w.workState !== "דורש תיקון" &&
      w.workState !== "חזר מויקטור" &&
      w.workState !== "דורש בדיקה"
  );

  return {
    sentThisMonth: work.filter(im),
    pureActive,
    needsReview,
    needsFix,
    stuck,
    completed: work.filter((w) => w.status === "הושלם" && im(w)),
    cancelled:  work.filter((w) => w.status === "בוטל"  && im(w)),
    approved:   work.filter((w) => w.outcome === "אושר"                && im(w)),
    entered:    work.filter((w) => w.outcome === "נכנס לפרויקט בפועל" && im(w)),
  };
}
