/**
 * Sunny — ONE project's money, explained. Pure, READ-ONLY. No new business rule: it applies the SAME canonical
 * primitives, in the SAME order, as the Finance Brain's project loop (lib/partner/finance/core.ts):
 *   validateTx (received = שולם|התקבל for income; paid = שולם only for expenses; invalid rows dropped),
 *   parseSetting (agreed price / currency / exception / clip price), isSongIncome / isClipIncome,
 *   collectibleAmount / overpaymentAmount (lib/payment-status), summarizeClipFinance (lib/clip-finance).
 * Currencies are NEVER combined: the deal is measured only in the price's currency; everything else is listed per
 * currency. The verdict carries its reasons so Sunny can say WHY it believes there is / isn't debt.
 */
import { parseSetting, validateTx } from "../finance/core";
import type { FinanceRaw } from "../finance/types";
import { isClipIncome, isSongIncome, summarizeClipFinance } from "../../clip-finance";
import { actualBalanceAgainstAgreedPrice, collectibleAmount, isFullyPaid, overpaymentAmount } from "../../payment-status";

export type MoneyVerdict =
  | "DEBT" | "NO_DEBT" | "OVERPAYMENT" | "FINANCE_EXCEPTION" | "PRICE_UNKNOWN" | "PROJECT_CANCELLED" | "INSUFFICIENT_EVIDENCE";

export interface ProjectMoney {
  price: { agreed: number | null; currency: string; exception: boolean; clipAgreed: number | null; malformedSetting: boolean; settingExists: boolean };
  song: {
    /** received song income in the price currency (שולם|התקבל, not cancelled) */
    received: number;
    /** open (not received, not cancelled) song income rows in the price currency — צפוי / לא שולם / חלקי … */
    openExpected: number;
    cancelled: number;
    /** agreed − received (signed: negative = overpaid) */
    balance: number | null;
    /** what is still planned to be collected (0 once paid in full; cancelled income netted only if the project is cancelled) */
    collectible: number | null;
    overpayment: number;
    fullyPaid: boolean | null;
  } | null;
  clip: { agreed: number; paid: number; expected: number; remaining: number; credit: number; status: string } | null;
  /** income in OTHER currencies (never merged into the deal) */
  otherCurrencyIncome: Record<string, { received: number; open: number }>;
  expenses: Record<string, { paid: number; notPaid: number }>;
  invalidRows: number;
  verdict: MoneyVerdict;
  reasonsHe: string[];
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function projectMoney(raw: FinanceRaw, project: { id: string; status: string }): ProjectMoney {
  const rows = raw.transactions.filter((t) => t.projectId === project.id);
  const txs = rows.map(validateTx).filter((t): t is NonNullable<ReturnType<typeof validateTx>> => t !== null);
  const invalidRows = rows.length - txs.length;
  const settingRow = raw.financeSettings.find((s) => s.projectId === project.id) ?? null;
  const st = settingRow ? parseSetting(settingRow.value) : null;
  const currency = st?.currency ?? "₪";
  const txLike = (t: (typeof txs)[number]) => ({ type: t.type, amount: t.amount, payment_status: t.row.status, expense_scope: t.row.expenseScope });
  const open = (t: (typeof txs)[number]) => t.type === "income" && !t.received && !t.cancelled;

  const song = txs.filter((t) => t.type === "income" && isSongIncome(txLike(t)));
  const same = song.filter((t) => t.currency === currency);
  const received = r2(same.filter((t) => t.received && !t.cancelled).reduce((s, t) => s + t.amount, 0));
  const cancelled = r2(same.filter((t) => t.cancelled).reduce((s, t) => s + t.amount, 0));
  const openExpected = r2(same.filter(open).reduce((s, t) => s + t.amount, 0));
  const price = st?.price ?? null;

  const other: ProjectMoney["otherCurrencyIncome"] = {};
  for (const t of txs.filter((x) => x.type === "income" && x.currency !== currency && !x.cancelled)) {
    const o = (other[t.currency] ??= { received: 0, open: 0 });
    if (t.received) o.received = r2(o.received + t.amount); else o.open = r2(o.open + t.amount);
  }
  const expenses: ProjectMoney["expenses"] = {};
  for (const t of txs.filter((x) => x.type === "expense" && !x.cancelled)) {
    const e = (expenses[t.currency] ??= { paid: 0, notPaid: 0 });
    if (t.received) e.paid = r2(e.paid + t.amount); else e.notPaid = r2(e.notPaid + t.amount);
  }
  const clipRows = txs.filter((t) => t.type === "income" && isClipIncome(txLike(t)) && t.currency === currency);
  const clip = st?.clipPrice && !st.exception ? (() => { const c = summarizeClipFinance(clipRows.map(txLike), st.clipPrice!); return { agreed: c.agreed, paid: c.paid, expected: c.expected, remaining: c.remaining, credit: c.credit, status: c.status }; })() : null;

  const reasons: string[] = [];
  let verdict: MoneyVerdict;
  let songOut: ProjectMoney["song"] = null;
  if (st?.exception) {
    verdict = "FINANCE_EXCEPTION";
    reasons.push("הפרויקט מסומן כחריג כספים (ללא חיוב) — אין חוב מחושב.");
  } else if (!price) {
    verdict = received > 0 || openExpected > 0 ? "INSUFFICIENT_EVIDENCE" : "PRICE_UNKNOWN";
    reasons.push(settingRow ? (st?.malformed ? "הגדרת המחיר פגומה — לא ניתן לחשב חוב." : "אין מחיר מוסכם שמור (או שהוא 0).") : "אין הגדרת כספים לפרויקט — אין מחיר מוסכם.");
    if (received > 0) reasons.push(`התקבלו ${currency}${received} אבל בלי מחיר מוסכם אי אפשר לדעת אם נשאר חוב.`);
  } else {
    const balance = actualBalanceAgainstAgreedPrice(price, received);
    const collectible = collectibleAmount(price, received, cancelled, project.status);
    const over = overpaymentAmount(price, received);
    songOut = { received, openExpected, cancelled, balance: r2(balance), collectible: r2(collectible), overpayment: r2(over), fullyPaid: isFullyPaid(price, received) };
    reasons.push(`מחיר מוסכם ${currency}${price}; התקבל בפועל (שולם/התקבל) ${currency}${received}.`);
    if (project.status === "בוטל" && balance > 0) { verdict = "PROJECT_CANCELLED"; reasons.push("הפרויקט בוטל — היתרה לא נחשבת לגבייה."); }
    else if (over > 0) { verdict = "OVERPAYMENT"; reasons.push(`התקבל יותר מהמחיר: ${currency}${r2(over)} עודף (זכות/טיפ) — לא חוב.`); }
    else if (collectible > 0) { verdict = "DEBT"; reasons.push(`נשאר לגבות ${currency}${r2(collectible)}${openExpected > 0 ? ` (מתוכם רשום כצפוי ${currency}${openExpected})` : ""}.`); }
    else { verdict = "NO_DEBT"; reasons.push("התקבל לפחות המחיר המוסכם — אין חוב."); }
  }
  if (Object.keys(other).length) reasons.push(`יש הכנסות במטבע אחר (${Object.keys(other).join(", ")}) — לא מחושבות מול המחיר ולא מומרות.`);
  if (invalidRows) reasons.push(`${invalidRows} רשומות כספים לא תקינות לא נספרו.`);
  return {
    price: { agreed: price, currency, exception: !!st?.exception, clipAgreed: st?.clipPrice ?? null, malformedSetting: !!st?.malformed, settingExists: !!settingRow },
    song: songOut, clip, otherCurrencyIncome: other, expenses, invalidRows, verdict: verdict!, reasonsHe: reasons,
  };
}
