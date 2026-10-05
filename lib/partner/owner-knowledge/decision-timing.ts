/**
 * Decision timing (Owner decision 2026-10-06, Decision Persistence C). PURE. The typed WHEN of a BUSINESS_DECISION —
 * never a date the system invents, never money, never a Finance row:
 *   UNSCHEDULED     decided, no time;
 *   THIS_MONTH      during the CALENDAR month of decidedOn (anchored: a decision of 05.10.2026 means October 2026 — in
 *                   November it is NOT "this month" any more; the window has passed → "זה עדיין נכון?");
 *   AT_CYCLE_CLOSE  at the close of the cycle the decision was made in (the cycle's own close date, from the records);
 *   BY_DATE         by timingDate (a date the Owner stated);
 *   ON_CONDITION    when conditionHe happens (Owner evidence only — Sunny never decides that it happened).
 * conditionHe may accompany any timing; it is the Owner's words, shown, never evaluated.
 */
export const DECISION_TIMINGS = ["UNSCHEDULED", "THIS_MONTH", "AT_CYCLE_CLOSE", "BY_DATE", "ON_CONDITION"] as const;
export type DecisionTiming = (typeof DECISION_TIMINGS)[number];
export const DECISION_TIMING_HE: Record<DecisionTiming, string> = {
  UNSCHEDULED: "בלי מועד", THIS_MONTH: "במהלך החודש של ההחלטה", AT_CYCLE_CLOSE: "בסגירת המחזור", BY_DATE: "עד תאריך", ON_CONDITION: "כשהתנאי יתקיים",
};
const HE_MONTHS = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];
const isYmd = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
const ddmm = (ymd: string) => `${ymd.slice(8, 10)}.${ymd.slice(5, 7)}`;

/** The anchored month of a THIS_MONTH decision (from decidedOn — never from today). */
export function decisionMonthOf(decidedOn: unknown): { first: string; last: string; monthHe: string } | null {
  if (!isYmd(decidedOn)) return null;
  const y = Number(decidedOn.slice(0, 4)), m = Number(decidedOn.slice(5, 7));
  const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return { first: `${decidedOn.slice(0, 7)}-01`, last, monthHe: `${HE_MONTHS[m - 1]} ${y}` };
}

/** Field rules (the kind's check): the anchor and the date are explicit, never inferred. */
export function checkDecisionTiming(v: Record<string, unknown>): string[] {
  const e: string[] = [];
  const t = v.timing;
  if (t === undefined || t === null || t === "") { if (v.timingDate) e.push("timingDate: only with timing BY_DATE"); return e; }
  if (t === "THIS_MONTH" && !isYmd(v.decidedOn)) e.push("timing THIS_MONTH needs decidedOn (the month is the month of the decision, never 'now')");
  if (t === "BY_DATE" && !isYmd(v.timingDate)) e.push("timing BY_DATE needs timingDate (YYYY-MM-DD the Owner stated)");
  if (t !== "BY_DATE" && v.timingDate) e.push("timingDate: only with timing BY_DATE (never an invented due date)");
  if (t === "ON_CONDITION" && !v.conditionHe) e.push("timing ON_CONDITION needs conditionHe (the Owner's words)");
  return e;
}

/** The ONE Hebrew wording of a decision's timing (read-back + Financial Forward). */
export function decisionTimingHe(v: Record<string, unknown>): string | null {
  const t = v.timing as DecisionTiming | undefined;
  // the Owner's condition, verbatim (his evidence — never evaluated, never paraphrased)
  const cond = typeof v.conditionHe === "string" && v.conditionHe.trim() ? ` — בתנאי שלך: «${String(v.conditionHe).trim()}»` : "";
  if (t === "THIS_MONTH") { const m = decisionMonthOf(v.decidedOn); return m ? `במהלך ${m.monthHe}${cond}` : null; }
  if (t === "BY_DATE" && isYmd(v.timingDate)) return `עד ${ddmm(v.timingDate)}${cond}`;
  if (t === "AT_CYCLE_CLOSE") return `בסגירת המחזור${cond}`;
  if (t === "ON_CONDITION") return cond ? `כשהתנאי יתקיים${cond}` : null;
  if (t === "UNSCHEDULED") return `בלי מועד${cond}`;
  return cond ? `בלי מועד${cond}` : null;
}
