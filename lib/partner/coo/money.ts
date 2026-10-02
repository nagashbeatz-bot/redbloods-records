/**
 * Sunny COO — money readiness of ONE project (pure). NO new money rule: it reads the project's ONE canonical money
 * computation (lib/partner/projects/money.ts projectMoney — the same primitives as the Finance Brain, the drawer,
 * Insights, the dashboard and the agent rules: received = שולם | התקבל; צפוי / לא שולם / בוטל never received;
 * paidIncome ≥ agreedPrice → no client debt; more → OVERPAYMENT / credit, never debt), the engineer-work paid rule
 * (isEngineerWorkPaid, already applied in the project view) and the Red Films line paid rule (budgetLinePaidState,
 * already applied in the production view). Currencies are never added. There is no cash-balance source in Redbloods,
 * so "money available" is never claimed.
 */
import type { ProjectView } from "../projects/view";
import { check, ev, type Check } from "./model";

const fmt = (m: Record<string, number>) => Object.entries(m).filter(([, a]) => a).map(([c, a]) => `${c}${a.toLocaleString("en-US")}`).join(" · ");

export interface MoneyReadiness {
  verdict: string | null;
  checks: Check[];
  facts: string[];
  /** a money gap that could block delivery (client debt on a deliverable, an unpaid supplier commitment before an event) */
  risk: boolean;
}

/** A Red Films production's money as the production view already computed it (line paid state = budgetLinePaidState). */
export interface ProductionMoneyInput {
  id: string; key: string; title: string;
  lines: Array<{ title: string | null; category: string | null; storedStatus: string | null; remaining: number | null; currency: string }>;
  clientPrice: number | null; advanceRequired: number | null; advanceReceived: number | null;
}

/** @param labelWork label work has no paying client — its client-side money is NOT_APPLICABLE, never "unknown price". */
export function moneyReadiness(v: ProjectView | null, opts: { labelWork: boolean; productions?: readonly ProductionMoneyInput[]; financeReadable: boolean }): MoneyReadiness {
  const checks: Check[] = [];
  const facts: string[] = [];
  let risk = false;
  if (!opts.financeReadable) {
    checks.push(check("money.finance", "MONEY", "מצב הכסף", "UNREADABLE", "הכספים לא נקראו — מצב הכסף לא ידוע (לא אפס).", [], false));
    return { verdict: null, checks, facts, risk };
  }
  const m = v?.money ?? null;
  const ref = v?.key ?? null;
  if (m && !opts.labelWork) {
    const s = m.song;
    if (m.verdict === "NO_DEBT") checks.push(check("money.client", "MONEY", "תשלום הלקוח", "CONFIRMED", `הלקוח שילם את המחיר המוסכם (${m.price.currency}${s?.received ?? 0} מתוך ${m.price.currency}${m.price.agreed ?? 0}) — אין חוב.`, [ev("FINANCE", ref, "projectMoney: received ≥ agreed")], false));
    else if (m.verdict === "OVERPAYMENT") checks.push(check("money.client", "MONEY", "תשלום הלקוח", "CONFIRMED", `התקבל יותר מהמחיר המוסכם (עודף ${m.price.currency}${s?.overpayment ?? 0}) — זה זיכוי / טיפ, לא חוב.`, [ev("FINANCE", ref, "projectMoney: OVERPAYMENT")], false));
    else if (m.verdict === "DEBT") { checks.push(check("money.client", "MONEY", "יתרת לקוח", "OPEN", `יתרה פתוחה מהלקוח: ${m.price.currency}${s?.collectible ?? s?.balance ?? "?"} (התקבל ${m.price.currency}${s?.received ?? 0} מתוך ${m.price.currency}${m.price.agreed ?? "?"}).`, [ev("FINANCE", ref, "projectMoney: DEBT")], false)); risk = true; }
    else if (m.verdict === "FINANCE_EXCEPTION") checks.push(check("money.client", "MONEY", "תשלום הלקוח", "CONFIRMED", "הפרויקט מסומן כחריג כספים (ללא חיוב) — אין חוב.", [ev("FINANCE", ref, "finance exception")], false));
    else if (m.verdict === "PRICE_UNKNOWN") checks.push(check("money.client", "MONEY", "מחיר מוסכם", "NOT_SEEN", "אני לא רואה מחיר מוסכם שמור — אי אפשר לדעת אם יש יתרה.", [ev("FINANCE", ref, "no agreedPrice")], false));
    else if (m.verdict === "INSUFFICIENT_EVIDENCE") checks.push(check("money.client", "MONEY", "מחיר מוסכם", "NOT_SEEN", "יש תנועות הכנסה אבל אני לא רואה מחיר מוסכם — אי אפשר לחשב יתרה.", [ev("FINANCE", ref, "income without agreedPrice")], false));
    if (s && s.openExpected > 0) facts.push(`צפוי מהלקוח (לא התקבל עדיין): ${m.price.currency}${s.openExpected} — צפוי ≠ התקבל.`);
  } else if (opts.labelWork) facts.push("עבודת לייבל — אין לקוח שמשלם; הכסף כאן הוא השקעה של הלייבל.");
  if (m) {
    const notPaid = Object.fromEntries(Object.entries(m.expenses).map(([c, e]) => [c, e.notPaid]));
    const paid = Object.fromEntries(Object.entries(m.expenses).map(([c, e]) => [c, e.paid]));
    if (fmt(paid)) facts.push(`הוצאות ששולמו: ${fmt(paid)}`);
    if (fmt(notPaid)) checks.push(check("money.expenses", "MONEY", "הוצאות שלא שולמו", "OPEN", `הוצאות רשומות שעוד לא שולמו: ${fmt(notPaid)}.`, [ev("FINANCE", ref, "expense rows not שולם")], false));
  }
  for (const w of v?.work.engineers ?? []) {
    if (!w.paid && w.status === "אושר") checks.push(check(`money.engineer.${w.engineer}`, "MONEY", `תשלום ל-${w.engineer}`, "OPEN", `עבודת ${w.workType ?? "מיקס"} של ${w.engineer} אושרה ועוד לא שולמה.`, [ev("MIX", ref, "isEngineerWorkPaid = false")], false));
  }
  for (const p of opts.productions ?? []) {
    const openLines = p.lines.filter((l) => l.storedStatus !== "בוטל" && (l.remaining ?? 0) > 0);
    if (openLines.length) {
      const byCur: Record<string, number> = {};
      for (const l of openLines) byCur[l.currency] = (byCur[l.currency] ?? 0) + (l.remaining ?? 0);
      checks.push(check(`money.rf.${p.id}`, "MONEY", "התחייבויות ספקים בהפקה", "OPEN", `שורות תקציב בהפקה "${p.title}" עם יתרה לתשלום: ${fmt(byCur)} (${openLines.map((l) => l.title ?? l.category ?? "שורה").slice(0, 4).join(", ")}).`, [ev("RED_FILMS", p.key, "budgetLinePaidState: remaining > 0")], false));
    } else if (p.lines.length) checks.push(check(`money.rf.${p.id}`, "MONEY", "התחייבויות ספקים בהפקה", "CONFIRMED", `כל שורות התקציב בהפקה "${p.title}" שולמו לפי התשלומים הרשומים.`, [ev("RED_FILMS", p.key, "every line paid")], false));
    else checks.push(check(`money.rf.${p.id}`, "MONEY", "תקציב / ספקים", "NOT_SEEN", `אני לא רואה שורות תקציב רשומות בהפקה "${p.title}" — אם יש התחייבויות לצוות / ספקים, הן לא מחוברות אליי.`, [ev("RED_FILMS", p.key, "no budget lines")], false));
    if (p.clientPrice && p.advanceRequired && !(p.advanceReceived && p.advanceReceived > 0)) {
      checks.push(check(`money.rf.advance.${p.id}`, "MONEY", "מקדמה מהלקוח", "NOT_SEEN", `בהפקה "${p.title}" רשומה דרישת מקדמה ואני לא רואה מקדמה שהתקבלה.`, [ev("RED_FILMS", p.key, "advanceRequired, advanceReceived empty")], false));
      risk = true;
    }
  }
  return { verdict: m?.verdict ?? null, checks, facts, risk };
}
