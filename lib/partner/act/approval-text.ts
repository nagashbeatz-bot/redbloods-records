/**
 * SUNNY UNIVERSAL ACTION LAYER — the Boss's approval words (pure, deterministic).
 *
 * Owner decision 2026-09-27 (POLISH FIX #1): after a clear preview, "מאשר" / "כן, מאשר" / "מאושר" is enough. The Boss
 * never has to repeat amounts, dates, recipients or words like "מחיקה". Safety comes from the binding, not from the
 * words: the approval token is bound to the exact plan hash + Owner + connector client + expiry + a one-time nonce, and
 * execution re-reads live state (STALE → nothing runs).
 *
 * What this module decides is only whether the words ARE an approval of the previewed plan as-is:
 *   APPROVED               an approval word, and nothing that changes or negates the plan.
 *   NOT_AN_APPROVAL        no approval word, or a negation / hold ("לא", "רגע", "עצור" …).
 *   APPROVAL_WITH_CHANGES  approval words plus a change ("מאשר אבל 500 במקום 400", a number the plan does not contain):
 *                          that is a NEW request → a new plan + a new preview; plan A is never executed.
 * Values the plan itself contains (the Boss may still repeat them) are removed before scanning, so "כן, 400₪ לא שולם"
 * for a plan whose status is "לא שולם" is still an approval.
 */

export type ApprovalTextVerdict =
  | { ok: true }
  | { ok: false; code: "NOT_AN_APPROVAL" | "APPROVAL_WITH_CHANGES"; detail: string };

const APPROVE = new Set(["מאשר", "מאשרת", "מאושר", "מאושרת", "אשר", "אשרי", "אישור", "מאשרים", "כן", "בטח", "סבבה", "יאללה", "בצע", "בצעי", "תבצע", "תבצעי", "קדימה", "ok", "okay", "yes", "approve", "approved", "confirm", "confirmed", "go", "👍", "✅"]);
const NEGATE = new Set(["לא", "אל", "עצור", "עצרי", "תעצור", "תעצרי", "חכה", "חכי", "רגע", "תמתין", "תמתיני", "no", "stop", "wait", "dont", "don't", "cancel"]);
const CHANGE = new Set(["אבל", "במקום", "רק", "חוץ", "בלי", "תשנה", "תשני", "שנה", "תחליף", "תחליפי", "תעשה", "תעשי", "תוסיף", "תוסיפי", "תוריד", "תורידי", "תעדכן", "תעדכני", "תזיז", "תזיזי", "but", "instead", "except", "only", "without", "change", "make"]);

const norm = (s: string) => s.normalize("NFKC").toLowerCase();
/** currencies named in words or symbols — a currency the plan does not carry is a change (never a silent FX) */
const CURRENCY: ReadonlyArray<[RegExp, string]> = [[/₪|ש"ח|ש״ח|שקל/g, "₪"], [/\$|דולר|usd/g, "$"], [/€|יורו|eur/g, "€"]];
const currenciesOf = (s: string) => CURRENCY.filter(([re]) => { re.lastIndex = 0; return re.test(s); }).map(([, c]) => c);
const digitsOf = (s: string) => (s.replace(/(\d),(?=\d{3}\b)/g, "$1").match(/\d+(?:\.\d+)?/g) ?? []);
const words = (s: string) => s.replace(/["'״׳`.,;:!?()[\]{}\-–—/\\|*_~<>=+₪$€%#@]+/g, " ").split(/\s+/).filter(Boolean);
/** a Hebrew word may carry a one-letter prefix (ו / ש / ה / ב / ל): "ותוסיף", "שלא" */
const variants = (w: string) => (/^[ושהבל][֐-׿]{2,}$/.test(w) ? [w, w.slice(1)] : [w]);
const hit = (set: ReadonlySet<string>, w: string) => variants(w).some((x) => set.has(x));

/**
 * @param text        the Boss's words, verbatim
 * @param planValues  every value of the previewed plan (after-values, arguments, key values) — only used so a
 *                    voluntary repeat of the plan's own values is never mistaken for a change
 */
export function classifyApprovalText(text: string, planValues: readonly string[]): ApprovalTextVerdict {
  let t = ` ${norm(text)} `;
  const planCur = new Set(planValues.flatMap((v) => currenciesOf(norm(String(v)))));
  const vals = [...new Set(planValues.map((v) => norm(String(v)).trim()).filter((v) => v.length >= 2))].sort((a, b) => b.length - a.length);
  for (const v of vals) t = t.split(v).join(" ");
  const ws = words(t);
  const known = new Set(planValues.flatMap((v) => digitsOf(norm(String(v)))));
  const foreign = digitsOf(t).filter((n) => !known.has(n));
  if (ws.some((w) => hit(CHANGE, w))) return { ok: false, code: "APPROVAL_WITH_CHANGES", detail: "the reply changes the plan" };
  const otherCur = currenciesOf(t).filter((c) => !planCur.has(c));
  if (otherCur.length) return { ok: false, code: "APPROVAL_WITH_CHANGES", detail: `a currency not in the plan: ${otherCur.join(", ")}` };
  if (foreign.length) return { ok: false, code: "APPROVAL_WITH_CHANGES", detail: `a value not in the plan: ${foreign.slice(0, 3).join(", ")}` };
  if (ws.some((w) => hit(NEGATE, w))) return { ok: false, code: "NOT_AN_APPROVAL", detail: "negation / hold" };
  if (!ws.some((w) => hit(APPROVE, w))) return { ok: false, code: "NOT_AN_APPROVAL", detail: "no approval word" };
  return { ok: true };
}
