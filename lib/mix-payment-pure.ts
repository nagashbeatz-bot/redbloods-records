/**
 * Engineer (mix / master) PAYMENT rules — ONE shared, pure module (no "server-only", no DB) used by every reader and by
 * the single Finance writer (lib/writes/mix.ts reconcileEngineerExpense):
 *   UI (StevenProfilePage), the store (payment push transition), COO facts, the Finance Brain open expenses, Sunny
 *   (mix/view, projects/view, the mix_pipeline capability) and the integrity test.
 *
 * Owner rules (integrity fix A2, 2026-09-27):
 *   • paid = agreed > 0 AND paid ≥ agreed AND a payment date. A legacy work with paid ≥ agreed but NO date is NOT paid
 *     by this rule (Owner accepted); Sunny reports it separately instead of guessing.
 *   • Paid Finance evidence is protected: a linked expense whose payment_status is "שולם" is never overwritten
 *     (amount / currency / status / date) or deleted by a price edit, a legacy sync or a force-sync. A disagreement is
 *     left in place and reported (CONFLICTING_SOURCES), never silently resolved.
 *   • ONE writer, currency-aware: an expense is recorded in the WORK'S OWN currency and amount. There is NO silent
 *     3.25 conversion into a ₪ amount presented as actual money — the ₪ figure is only an "הערכה" in the notes text.
 *     (Historical ₪650-style rows written by the retired Steven sync stay untouched; the Owner deferred whether they
 *     are real.)
 */

/** Code WORKING VALUE, NOT Owner policy: the ratio the retired Steven sync used ($ agreed → ₪ recorded). Today it only
 *  produces an ESTIMATE in the expense notes and lets Sunny explain historical ₪ rows. */
export const APP_PAYMENT_RATIO = 3.25;
/** Code WORKING VALUE, NOT Owner policy: PayPal gross estimate factor (note text only; no fee policy is stored). */
export const PAYPAL_GROSS_FACTOR = 1.05;
export const ENGINEER_EXPENSE_CATEGORY = "מיקס / מאסטר";
/** Supplier-expense "paid" status (never "התקבל", which is income-only). */
export const EXPENSE_PAID_STATUS = "שולם";
/** Partial payment status — money evidence too: it may be re-priced by the expected-row sync, never deleted. */
export const EXPENSE_PARTIAL_STATUS = "חלקי";
export const STEVEN_ENGINEER_NAME = "Steven";

export interface EngineerPayInput { agreedPrice: number | null | undefined; amountPaid: number | null | undefined; paymentDate?: string | null }
export type EngineerPayStatus = "שולם" | "חלקי" | "לא שולם";

const n = (x: number | null | undefined) => (typeof x === "number" && Number.isFinite(x) ? x : Number(x ?? 0) || 0);
const round2 = (x: number) => Math.round(x * 100) / 100;

/** THE paid rule (one copy for the whole app). */
export function isEngineerWorkPaid(w: EngineerPayInput): boolean {
  const agreed = n(w.agreedPrice), paid = n(w.amountPaid);
  return agreed > 0 && paid >= agreed && !!w.paymentDate;
}

/** Display / expense status derived from the work. paid ≥ agreed WITHOUT a date is "חלקי" (money recorded, not paid by the rule). */
export function engineerPayStatus(w: EngineerPayInput): EngineerPayStatus {
  if (n(w.agreedPrice) <= 0) return "לא שולם";
  if (isEngineerWorkPaid(w)) return "שולם";
  if (n(w.amountPaid) > 0) return "חלקי";
  return "לא שולם";
}

/** A legacy work that recorded the full amount but no payment date (not paid by the rule; reported, never guessed). */
export function isLegacyPaidWithoutDate(w: EngineerPayInput): boolean {
  const agreed = n(w.agreedPrice), paid = n(w.amountPaid);
  return agreed > 0 && paid >= agreed && !w.paymentDate;
}

/** A linked expense that is paid money evidence — never overwritten or deleted automatically. */
export const isProtectedPaidExpense = (status: string | null | undefined) => (status ?? "") === EXPENSE_PAID_STATUS;
/** Money evidence that is never deleted automatically (שולם or חלקי). */
export const isMoneyEvidenceExpense = (status: string | null | undefined) => isProtectedPaidExpense(status) || (status ?? "") === EXPENSE_PARTIAL_STATUS;

/**
 * Which expense a work may have:
 *  • PAYMENT_ONLY — Steven's semantics (and any caller that asked to skip the price sync): NO expected row; the expense
 *    exists only once the work is paid.
 *  • EXPECTED_AND_PAYMENT — every other engineer on a project: an expected (לא שולם / חלקי) row follows the price, and
 *    becomes שולם with the payment date once paid.
 */
/**
 * PAYMENT_ONLY          no row until the work is paid (a send flow that asked for no expected row, e.g. a pre-filled price)
 * EXPECTED_AND_PAYMENT  an expected row that follows the price (other engineers on a project)
 * EXPECTED_ON_COMPLETION Steven (Owner decision 2026-09-28): paid per COMPLETED project at the price set in advance —
 *                       nothing while the work is open; once completed ("אושר") an expected "לא שולם" row at the work's
 *                       own agreed price (never a guessed / default price; no price → no row, reported); paying turns the
 *                       SAME row "שולם". An expected row is never deleted when a work is re-opened.
 */
export type EngineerExpenseMode = "PAYMENT_ONLY" | "EXPECTED_AND_PAYMENT" | "EXPECTED_ON_COMPLETION";
/** The engineer work's completed status (DB "אושר", shown as "הושלם"). */
export const ENGINEER_COMPLETED_STATUS = "אושר";
export function engineerExpenseMode(engineerName: string | null | undefined, skipPriceSync?: boolean): EngineerExpenseMode {
  if (engineerName === STEVEN_ENGINEER_NAME) return "EXPECTED_ON_COMPLETION"; // Steven's page flag never switches this off
  return skipPriceSync ? "PAYMENT_ONLY" : "EXPECTED_AND_PAYMENT";
}

export interface ReconcileWork extends EngineerPayInput {
  id: string; projectId: string | null; engineerName: string; workType: string; workTitle?: string | null; currency: string;
  /** the work's status (EXPECTED_ON_COMPLETION needs it) */
  status?: string | null;
}
export interface ReconcileTx { id: string; paymentStatus: string | null; amount: number | null; currency: string | null; date: string | null }
export interface ExpenseFields {
  project_id: string | null; scope: "project" | "general"; type: "expense"; category: string; description: string; artist: string;
  amount: number; currency: string; payment_status: string; payment_method: string; receipt_ref: string; notes: string;
  date?: string | null; linked_session_id: string;
}
export type ReconcileDecision =
  | { kind: "NONE"; reasonHe: string }
  | { kind: "PROTECTED_PAID"; txId: string; conflictHe: string | null }
  | { kind: "INSERT"; fields: ExpenseFields }
  | { kind: "UPDATE"; txId: string; fields: ExpenseFields }
  | { kind: "REMOVE_UNPAID"; txId: string }
  | { kind: "REFUSED"; code: "STANDALONE_NO_FORCE_SYNC" | "NO_PRICE"; reasonHe: string };

const money = (c: string, x: number) => `${c}${x.toLocaleString("en-US", { minimumFractionDigits: x % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 })}`;

/** Notes text. The ₪ figure for a $ work is an ESTIMATE only (working ratio, not Owner policy, not actual money). */
export function engineerExpenseNotes(w: ReconcileWork): string {
  const agreed = n(w.agreedPrice), paid = n(w.amountPaid), cur = w.currency || "$";
  const base = isEngineerWorkPaid(w) ? `תשלום ${w.engineerName}: ${money(cur, agreed)} (במטבע העבודה)`
    : paid > 0 ? `שולם ${money(cur, paid)} מתוך ${money(cur, agreed)}` : `ממתין לתשלום — ${money(cur, agreed)}`;
  const est: string[] = [];
  if (cur === "$" && agreed > 0) est.push(`הערכה בלבד (לא סכום בפועל): ≈ ₪${round2(agreed * APP_PAYMENT_RATIO)} לפי יחס עבודה ${APP_PAYMENT_RATIO} (ערך עבודה בקוד, לא מדיניות)`);
  if (cur === "$" && agreed > 0 && w.engineerName === STEVEN_ENGINEER_NAME) est.push(`PayPal gross (הערכה): ${money("$", round2(agreed * PAYPAL_GROSS_FACTOR))}`);
  return [base, ...est].join(" · ");
}

/** The fields the ONE writer would record for this work right now (work currency + agreed amount; no conversion). */
export function engineerExpenseFields(w: ReconcileWork, ctx: { artist: string; projectName: string }): ExpenseFields {
  const paid = isEngineerWorkPaid(w);
  const title = (w.projectId ? ctx.projectName : (w.workTitle ?? "")).trim();
  return {
    project_id: w.projectId, scope: w.projectId ? "project" : "general", type: "expense", category: ENGINEER_EXPENSE_CATEGORY,
    description: `${w.engineerName} — ${w.workType}${title ? ` · ${title}` : ""}`, artist: ctx.artist,
    amount: n(w.agreedPrice), currency: w.currency || "$", payment_status: engineerPayStatus(w), payment_method: "", receipt_ref: "",
    notes: engineerExpenseNotes(w), ...(paid ? { date: w.paymentDate ?? null } : {}), linked_session_id: "",
  };
}

/**
 * THE reconcile decision (pure). `linked` = the row behind linked_transaction_id (null = no link or the linked row is gone).
 * `force` = an explicit "sync" (drawer button / Sunny force-sync): refused for a standalone work.
 */
export function decideEngineerExpense(w: ReconcileWork, linked: ReconcileTx | null, opts: { mode: EngineerExpenseMode; artist: string; projectName: string; force?: boolean }): ReconcileDecision {
  if (opts.force && !w.projectId) return { kind: "REFUSED", code: "STANDALONE_NO_FORCE_SYNC", reasonHe: "עבודה עצמאית (בלי פרויקט) — אין סנכרון כפוי לכספים; ההוצאה נרשמת רק כשמסמנים שולם" };
  const paid = isEngineerWorkPaid(w);
  const want = engineerExpenseFields(w, opts);

  // 1. paid Finance evidence is never touched automatically
  if (linked && isProtectedPaidExpense(linked.paymentStatus)) {
    const diffs: string[] = [];
    if (!paid) diffs.push("השורה בכספים 'שולם' אבל העבודה לא שולמה לפי הכלל (סכום ששולם ≥ מחיר + תאריך תשלום)");
    else {
      if ((linked.currency ?? "") !== want.currency || Math.abs(n(linked.amount) - want.amount) > 0.005) diffs.push(`בכספים ${linked.currency ?? ""}${n(linked.amount)} ≠ בעבודה ${want.currency}${want.amount}`);
      if ((linked.date ?? null) !== (w.paymentDate ?? null)) diffs.push(`תאריך בכספים ${linked.date ?? "—"} ≠ תאריך התשלום בעבודה ${w.paymentDate ?? "—"}`);
    }
    return { kind: "PROTECTED_PAID", txId: linked.id, conflictHe: diffs.length ? diffs.join("; ") : null };
  }

  // 2. paid → record / refresh the paid row (standalone allowed: general scope)
  if (paid) {
    const fields = linked && linked.date && !want.date ? { ...want, date: linked.date } : want; // never null an existing date
    return linked ? { kind: "UPDATE", txId: linked.id, fields } : { kind: "INSERT", fields };
  }

  // 3. not paid
  if (opts.mode === "EXPECTED_ON_COMPLETION") {
    if (w.status !== ENGINEER_COMPLETED_STATUS) return { kind: "NONE", reasonHe: linked ? "העבודה נפתחה מחדש — ההוצאה הצפויה נשארת (לא נמחקת אוטומטית)" : "אין הוצאה עד שהעבודה מסומנת הושלם" };
    if (!w.projectId) return { kind: "NONE", reasonHe: "עבודה עצמאית (בלי פרויקט) — ההוצאה נרשמת כשמסמנים שולם" };
    if (n(w.agreedPrice) <= 0) return { kind: "NONE", reasonHe: "הושלם, אבל אין מחיר מוגדר לעבודה — לא מנחשים מחיר (צריך להגדיר מחיר)" };
    if (!linked) return { kind: "INSERT", fields: { ...want, date: null } };
    const { date: _d, ...rest2 } = want;
    return { kind: "UPDATE", txId: linked.id, fields: rest2 as ExpenseFields };
  }
  if (opts.mode === "PAYMENT_ONLY") {
    if (!linked) return { kind: "NONE", reasonHe: "אין הוצאה עד שמסמנים שולם" };
    if (isMoneyEvidenceExpense(linked.paymentStatus)) return { kind: "NONE", reasonHe: "שורה חלקית נשמרת (ראיה לכסף) — לא נמחקת אוטומטית" };
    return { kind: "REMOVE_UNPAID", txId: linked.id };
  }
  if (!w.projectId) return { kind: "NONE", reasonHe: "עבודה עצמאית — אין הוצאה צפויה" };
  if (n(w.agreedPrice) <= 0) return opts.force ? { kind: "REFUSED", code: "NO_PRICE", reasonHe: "אין מחיר לסנכרן" } : { kind: "NONE", reasonHe: "אין מחיר" };
  if (!linked) return { kind: "INSERT", fields: { ...want, date: null } };
  const { date: _omit, ...rest } = want; // an unpaid re-price never nulls an existing date
  return { kind: "UPDATE", txId: linked.id, fields: rest as ExpenseFields };
}

/**
 * Explicit un-pay guard: a request that changes the payment (amount paid / payment date) and leaves the work NOT paid
 * is refused while its linked expense is "שולם" — paid money is cancelled in Finance first (an explicit Owner action
 * there), never deleted or rewritten from a work screen.
 */
export function unpayBlocked(p: { touchesPayment: boolean; projectedPaid: boolean; linkedStatus: string | null | undefined }): boolean {
  return p.touchesPayment && !p.projectedPaid && isProtectedPaidExpense(p.linkedStatus);
}
export const UNPAY_BLOCKED_HE = "ההוצאה המקושרת בכספים כבר מסומנת 'שולם' — שורה ששולמה לא נמחקת ולא נדרסת. כדי לבטל את התשלום משנים קודם את השורה ב-Finance.";
