/**
 * Sunny — PAST_SHOW_NOT_CLOSED: a show whose date passed and that is still "נסגר" / "אושרה" (Owner decision 2026-10-03).
 * ONE pure, read-only, derived rule used by every reader (show_view / show_portfolio, needs_me → the dashboard card,
 * cases / partner_brief, the Finance receivable label). No write, no push, no cron, no DB.
 *
 * The law (Owner, 2026-10-03):
 *   1. a PAID show whose date is before today (Israel) and whose status is נסגר / אושרה → PAST_SHOW_NOT_CLOSED: the Owner's
 *      move — it must be dealt with;
 *   2. the time passing ≠ בוצע. A past date does NOT prove the show took place: nothing here ever marks it בוצע or assumes
 *      it happened;
 *   3. if it DID take place → close it as "בוצע"; the close records whether the client paid and whether the DJ was paid.
 *      A client who has not paid does NOT prevent "בוצע" — the debt simply stays open;
 *   4. if it did NOT take place → it must not be marked בוצע; the status is updated through the existing flow;
 *   5. Sunny never assumes it took place only because the date passed (only when the Owner already said so).
 *
 * "Past" = the date only (the same safe rule as the DATE_PASSED_NOT_CLOSED signal) — no start_time arithmetic.
 * Money is a MULTIPLIER of the urgency, never the reason a show enters: open client money and / or an open DJ fee raise it.
 * The artist's expected entitlement is context only (details), never the headline.
 */

/** Owner decision: ≤ 3 days since the show + open money → NEW_TODAY (top of "מה צריך ממני היום"); otherwise YOUR_TASK. */
export const PAST_SHOW_NEW_TODAY_DAYS = 3;
/** Statuses that make a past show "not closed" (בוצע / בוטל are closed answers; a lead was never confirmed). */
export const PAST_SHOW_OPEN_STATUSES: ReadonlySet<string> = new Set(["נסגר", "אושרה"]);

export type PastShowUrgency = "HIGH_MONEY" | "DJ_OBLIGATION" | "OPERATIONAL";
export type PastShowGroup = "NEW_TODAY" | "YOUR_TASK";

export interface PastUnclosedInput {
  name: string | null | undefined;
  date: string | null | undefined;
  status: string | null | undefined;
  dealType: string | null | undefined;
  currency: string | null | undefined;
  /** today in Israel (YYYY-MM-DD) */
  today: string;
  price: number | null | undefined;
  /** the show's stored client payment label (a MIRROR of Finance) — used only when Finance was not read */
  paymentStatus: string | null | undefined;
  advancePayment: number | null | undefined;
  /** Finance rows were read: `clientRemaining` is the app's own showMoneyOf remaining (price − received, this currency) */
  financeRead: boolean;
  clientRemaining: number | null | undefined;
  /** a DJ is assigned (client id or name) — a DJ_FEE row without a DJ is not a DJ obligation */
  hasDj: boolean;
  /** the show's DJ_FEE row (null / not found when Finance was not read) */
  djRow: { exists: boolean; status?: string | null; amount?: number | null } | null;
  djFee: number | null | undefined;
  /** the artist's ledger row for this show: 'הכנסות צפויות' = EXPECTED, 'הכנסות' = REALIZED */
  entitlement: { type: string; amount: number } | null;
}

export interface PastUnclosed {
  ageDays: number;
  date: string;
  currency: string;
  /** whole-day wording: "מאתמול" / "מ-02.10 (לפני 5 ימים)" */
  whenHe: string;
  client: { open: boolean; amount: number | null; basis: "FINANCE" | "MIRROR" };
  dj: { open: boolean; amount: number | null; known: boolean };
  /** the artist's entitlement is still only EXPECTED (context for the details, never the headline) */
  entitlementExpected: { amount: number } | null;
  moneyOpen: boolean;
  urgency: PastShowUrgency;
  group: PastShowGroup;
  titleHe: string;
  /** "2,500₪ מהלקוח עדיין פתוחים · DJ 500₪ עדיין פתוח" — empty when nothing is open */
  moneyLineHe: string;
  /** the pieces of the money line (null when that part is not open) + the entitlement context */
  clientHe: string | null;
  djHe: string | null;
  entitlementHe: string | null;
  /** the card's one line: the money line, or the unclosed fact when no money is recorded as open */
  whyHe: string;
  nextActionHe: string;
  shortHe: string;
  /** the rule, as a sentence the card shows under "למה זה כאן?" */
  ruleHe: string;
  /** Sunny's general wording (the show was SUPPOSED to take place — a past date proves nothing) */
  sunnyHe: string;
  /** the wording when the Owner already said the show took place */
  sunnyIfHeldHe: string;
}

const ymdOk = (d: string | null | undefined): d is string => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d) && Number.isFinite(Date.parse(`${d}T12:00:00Z`));
const daysBetween = (fromYmd: string, toYmd: string) => Math.round((Date.parse(`${toYmd}T12:00:00Z`) - Date.parse(`${fromYmd}T12:00:00Z`)) / 86_400_000);
const dm = (ymd: string) => `${ymd.slice(8, 10)}.${ymd.slice(5, 7)}`;
const money = (n: number, currency: string) => `${Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 })}${currency}`;
const OPEN_DJ = (s: string | null | undefined) => s !== "שולם" && s !== "בוטל";

/** The derived rule. null = the show is not a PAST_SHOW_NOT_CLOSED (a paid, past, still-open show is). */
export function pastUnclosedOf(i: PastUnclosedInput): PastUnclosed | null {
  if (i.dealType === "UNPAID_COLLAB") return null;                 // an unpaid collaboration has no money layer (deal type ≠ payment status)
  if (!i.status || !PAST_SHOW_OPEN_STATUSES.has(i.status)) return null; // בוצע / בוטל / a lead are not "past, not closed"
  if (!ymdOk(i.date) || !ymdOk(i.today) || i.date >= i.today) return null; // the date only: strictly before today
  const ageDays = daysBetween(i.date, i.today);
  const currency = (i.currency ?? "").trim() || "₪";

  // client money: Finance's own remaining when read; otherwise the stored mirror (never a guess that nothing is open)
  const price = Number(i.price) || 0;
  let clientAmount: number | null = null;
  let basis: "FINANCE" | "MIRROR" = "FINANCE";
  if (i.financeRead && typeof i.clientRemaining === "number") clientAmount = i.clientRemaining;
  else {
    basis = "MIRROR";
    clientAmount = i.paymentStatus === "שולם" || i.paymentStatus === "בוטל" ? 0 : Math.max(0, price - (Number(i.advancePayment) || 0));
  }
  const clientOpen = price > 0 && (clientAmount ?? 0) > 0;

  // the DJ obligation: only a real DJ with a DJ_FEE row that is not paid / cancelled
  const djKnown = !!i.djRow && i.financeRead;
  const djAmount = djKnown && i.djRow!.exists ? Number(i.djRow!.amount ?? i.djFee) || 0 : null;
  const djOpen = i.hasDj && djKnown && !!i.djRow!.exists && OPEN_DJ(i.djRow!.status) && (djAmount ?? 0) > 0;

  const entitlementExpected = i.entitlement && i.entitlement.type === "הכנסות צפויות" && i.entitlement.amount > 0 ? { amount: i.entitlement.amount } : null;
  const moneyOpen = clientOpen || djOpen;
  const urgency: PastShowUrgency = clientOpen ? "HIGH_MONEY" : djOpen ? "DJ_OBLIGATION" : "OPERATIONAL";
  const group: PastShowGroup = moneyOpen && ageDays <= PAST_SHOW_NEW_TODAY_DAYS ? "NEW_TODAY" : "YOUR_TASK";

  const name = (i.name ?? "").trim();
  const showWord = name ? `הופעת ${name}` : "ההופעה";
  const whenHe = ageDays === 1 ? "מאתמול" : `מ-${dm(i.date)} (לפני ${ageDays} ימים)`;
  const parts: string[] = [];
  if (clientOpen) parts.push(`${money(clientAmount!, currency)} מהלקוח עדיין פתוחים`);
  if (djOpen) parts.push(`DJ ${money(djAmount!, currency)} עדיין פתוח`);
  const moneyLineHe = parts.join(" · ");
  const clientHe = clientOpen ? `${money(clientAmount!, currency)} מהלקוח עדיין פתוחים${basis === "MIRROR" ? " (לפי סטטוס התשלום של ההופעה — הכספים לא נקראו)" : ""}` : null;
  const djHe = djOpen ? `שכר ה-DJ ${money(djAmount!, currency)} עדיין פתוח` : null;
  const entitlementHe = entitlementExpected ? `זכאות האמן (${money(entitlementExpected.amount, currency)}) עדיין צפויה — תהפוך להכנסה במאזן רק כשההופעה מסומנת בוצע` : null;
  const unclosedHe = `ההופעה הייתה אמורה להתקיים ב-${dm(i.date)} ועדיין לא נסגרה במערכת (סטטוס "${i.status}")`;
  const titleHe = `${showWord} ${whenHe} עדיין לא נסגרה`;
  const whyHe = moneyLineHe || `${unclosedHe} · אין כסף פתוח רשום`;
  const nextActionHe = "לעדכן מה קרה בהופעה; אם היא התקיימה — לסגור אותה כבוצע ולתעד אם הלקוח שילם ואם ה-DJ שולם (חוב פתוח לא מונע סגירה); אם לא — לעדכן סטטוס מתאים בעמוד ההופעות";
  const ruleHe = `${unclosedHe}. עבר הזמן ≠ בוצע: תאריך שעבר לא מוכיח שההופעה התקיימה. הכדור אצלך — לעדכן מה קרה, ואם התקיימה לסגור אותה ולתעד תשלום לקוח ו-DJ. כסף פתוח מעלה את הדחיפות, הוא לא הסיבה שההופעה כאן.`;
  const moneySentence = moneyLineHe ? ` יש ${[clientOpen ? `${money(clientAmount!, currency)} מהלקוח פתוחים` : null, djOpen ? `DJ ${money(djAmount!, currency)} פתוח` : null].filter(Boolean).join(" ו-")}.` : "";
  const sunnyHe = `${showWord} הייתה אמורה להתקיים ${i.date === addDays(i.today, -1) ? "אתמול" : `ב-${dm(i.date)}`} ועדיין לא נסגרה במערכת.${moneySentence} צריך לעדכן מה קרה בהופעה; אם היא התקיימה, לסגור אותה כבוצע ולתעד את מצב התשלומים.`;
  const heldMoney = [
    clientOpen ? `${money(clientAmount!, currency)} מהלקוח עדיין פתוחים` : null,
    djOpen ? `${clientOpen ? "ושכר" : "שכר"} ה-DJ בסך ${money(djAmount!, currency)} עדיין פתוח` : null,
  ].filter(Boolean).join(" ");
  const sunnyIfHeldHe = `${i.date === addDays(i.today, -1) ? "אתמול" : `ב-${dm(i.date)}`} הייתה ${name || "ההופעה"} ועדיין לא סגרת אותה במערכת.${heldMoney ? ` ${heldMoney}.` : ""} צריך לסגור את ההופעה ולתעד אם הלקוח שילם ואם ה-DJ שולם.`;

  return {
    ageDays, date: i.date, currency, whenHe,
    client: { open: clientOpen, amount: clientAmount, basis },
    dj: { open: djOpen, amount: djAmount, known: djKnown },
    entitlementExpected, moneyOpen, urgency, group, titleHe, moneyLineHe, clientHe, djHe, entitlementHe, whyHe, nextActionHe,
    shortHe: moneyLineHe ? `התאריך עבר וההופעה לא נסגרה · ${moneyLineHe}` : "התאריך עבר וההופעה לא נסגרה",
    ruleHe, sunnyHe, sunnyIfHeldHe,
  };
}

function addDays(ymd: string, n: number) { const d = new Date(`${ymd}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
