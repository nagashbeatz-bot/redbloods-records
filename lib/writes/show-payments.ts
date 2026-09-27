/**
 * D5 — show payments in Finance (Owner decision 2026-09-27; migration 75bf144e…). Shared by the Shows hub route
 * (POST /api/shows/[id]/payments) and Sunny's RECORD_SHOW_PAYMENT: one writer, one rule (showMoneyOf).
 *
 * A payment = one income row in Finance (status התקבל, show_id + show_money_role SHOW_PAYMENT, the show's currency).
 * Deposit / partial / full / overpayment are the same operation; the expected-balance row then holds price − received
 * (or closes at 0). Received ≥ price → no debt; received > price → the credit stays visible. Refused: an unconfirmed
 * show (a lead), another currency than the show's (no silent FX), a non-positive amount, a bad date, and the same
 * amount on the same date already recorded for this show (a double-click / replay) unless explicitly allowed.
 */
import { supabase } from "@/lib/supabase";
import { getShow } from "@/lib/shows-store";
import type { Show, ShowMoney } from "@/lib/shows-types";
import { isMoneyCurrency, isUnpaidCollab, UNPAID_COLLAB_NO_MONEY_HE } from "@/lib/shows-types";

const YMD = /^\d{4}-\d{2}-\d{2}$/;
export const PAYMENT_METHODS = ["", "העברה בנקאית", "מזומן", "ביט", "פייבוקס", "צ'ק", "כרטיס אשראי", "PayPal", "אחר"] as const;
const REFUSED = "refused" as const;
const MISSING = "not_found" as const;
export type RecordShowPaymentResult =
  | { kind: typeof MISSING }
  | { kind: typeof REFUSED; code: "NOT_CONFIRMED" | "UNPAID_COLLAB" | "BAD_AMOUNT" | "BAD_DATE" | "CURRENCY_MISMATCH" | "DUPLICATE" | "BAD_METHOD"; messageHe: string }
  | { kind: "ok"; transactionId: string; before: ShowMoney; after: ShowMoney };

export async function showPaymentState(showId: string): Promise<{ show: Show; money: ShowMoney } | null> {
  const show = await getShow(showId);
  if (!show) return null;
  const { showMoneyForShow } = await import("@/lib/shows-finance-sync");
  return { show, money: await showMoneyForShow(show) };
}

export async function recordShowPayment(showId: string, p: { amount: unknown; date: unknown; currency?: unknown; method?: unknown; note?: unknown; allowDuplicate?: boolean }): Promise<RecordShowPaymentResult> {
  const st = await showPaymentState(showId);
  if (!st) return { kind: MISSING };
  const { show, money } = st;
  // an unpaid collaboration never receives a payment row (switch the deal type to PAID first)
  if (isUnpaidCollab(show)) return { kind: REFUSED, code: "UNPAID_COLLAB", messageHe: UNPAID_COLLAB_NO_MONEY_HE };
  const fin = await import("@/lib/shows-finance-sync");
  if (!fin.isConfirmedShowStatus(show.status) && show.status !== "בוטל") return { kind: REFUSED, code: "NOT_CONFIRMED", messageHe: "ההופעה עוד לא מאושרת (ליד) — קודם לאשר אותה, ואז לרשום תשלום" };
  const amount = typeof p.amount === "number" ? p.amount : Number(p.amount);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 10_000_000) return { kind: REFUSED, code: "BAD_AMOUNT", messageHe: "סכום לא תקין" };
  const date = typeof p.date === "string" ? p.date : "";
  if (!YMD.test(date) || Number.isNaN(Date.parse(date))) return { kind: REFUSED, code: "BAD_DATE", messageHe: "תאריך לא תקין (YYYY-MM-DD)" };
  const currency = show.currency || "₪";
  if (p.currency !== undefined && p.currency !== null && p.currency !== "" && (!isMoneyCurrency(p.currency) || p.currency !== currency)) {
    return { kind: REFUSED, code: "CURRENCY_MISMATCH", messageHe: `ההופעה מתומחרת ב-${currency} — תשלום במטבע אחר לא נרשם עליה (אין המרה)` };
  }
  const method = typeof p.method === "string" ? p.method : "";
  if (!(PAYMENT_METHODS as readonly string[]).includes(method)) return { kind: REFUSED, code: "BAD_METHOD", messageHe: "אמצעי תשלום לא מוכר" };
  if (!p.allowDuplicate && money.payments.some((x) => Math.abs(x.amount - amount) < 0.005 && x.date === date)) {
    return { kind: REFUSED, code: "DUPLICATE", messageHe: `כבר רשום תשלום של ${currency}${amount.toLocaleString("he-IL")} בתאריך ${date} להופעה הזאת` };
  }
  const note = typeof p.note === "string" ? p.note.slice(0, 300) : "";
  const transactionId = await fin.insertShowPayment(show, { amount: Math.round(amount * 100) / 100, date, method, note });
  // The expected balance, the derived payment status and the DJ / artist rows follow (the one sync)
  const fresh = await getShow(showId);
  if (fresh) await fin.syncShowFinance(fresh);
  const after = await fin.showMoneyForShow(fresh ?? show);
  return { kind: "ok", transactionId, before: money, after };
}

/** Payments of a show for the screens / Sunny (no ids beyond the rows' own; amounts carry the currency). */
export async function showPaymentRows(showId: string): Promise<Array<{ id: string; amount: number; currency: string; date: string | null; status: string | null }>> {
  const { data, error } = await supabase.from("transactions").select("id, amount, currency, date, payment_status").eq("show_id", showId).eq("show_money_role", "SHOW_PAYMENT").order("date", { ascending: true });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Array<{ id: string; amount: number; currency: string | null; date: string | null; payment_status: string | null }>).map((r) => ({ id: r.id, amount: Number(r.amount) || 0, currency: r.currency || "₪", date: r.date, status: r.payment_status }));
}
