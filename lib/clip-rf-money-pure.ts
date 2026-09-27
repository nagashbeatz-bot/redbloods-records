/**
 * Clip / Red Films money semantics — the ONE pure rule set (B3, Owner canon 2026-09-27). No I/O: client components,
 * server routes, Sunny views and scripts all import these same functions.
 *
 * Owner canon (four different things, never merged, never derived from each other):
 *   A  the CLIENT clip price / clip income (finance_<project>.clipAgreedPrice + income rows with expense scope קליפ);
 *   B  the PLANNED budget (red_films_productions.general_budget, budget lines, clip planning rows) — planning, not money;
 *   C  the ACTUAL cost (Finance expenses with expense scope קליפ; paid only when שולם). A Red Films budget payment is
 *      real company money: since DB-1 (live 2026-09-27, red_films_budget_payments.linked_transaction_id) each payment of a
 *      clip production becomes exactly ONE linked Finance expense (scope קליפ, שולם) and is then PART of C. Only an
 *      UNLINKED payment is "outside Finance" — shown apart, never added to C; a linked one is never counted twice;
 *   D  the RECOUPABLE amount — only what the specific artist agreement says. No agreement rule is recorded today, so the
 *      clip contribution to recoup is NOT_DEFINED (null) with a reason — never 50 %, never from the budget or the price.
 */
import { normalizeCurrency } from "./finance/currency";
import { isReceivedStatus as _received, isCancelledStatus as _cancelled } from "./finance/classify";

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

// ── 3. budget line paid state ────────────────────────────────────────────────────────────────────────────────────────
export type BudgetLinePaidStateCode = "PAID" | "PARTIAL" | "UNPAID" | "NO_PLAN";
export const BUDGET_LINE_PAID_STATE_HE: Readonly<Record<BudgetLinePaidStateCode, string>> = { PAID: "שולם", PARTIAL: "חלקי", UNPAID: "לא שולם", NO_PLAN: "ללא סכום מתוכנן" };
export interface BudgetLineLike { planned_amount?: number | string | null; currency?: string | null; status?: string | null }
export interface BudgetPaymentLike { amount?: number | string | null; currency?: string | null }
export interface BudgetLinePaidState {
  state: BudgetLinePaidStateCode;
  /** Σ of the line's payments IN THE LINE CURRENCY (a payment with no currency is in its line's currency — the writer enforces it). */
  paid: number;
  planned: number;
  /** planned − paid, never negative. */
  remaining: number;
  /** paid − planned when more was paid than planned (never negative). */
  over: number;
  currency: string;
  /** Payments recorded in another currency — never added (no FX); count only. */
  otherCurrencyPayments: number;
  /** The stored `status` column is PLANNING INTENT only (מתוכנן / שולם / בוטל) — never the paid truth. */
  storedStatus: string;
}
/**
 * THE budget-line paid rule: paid = Σ payments in the line currency; PAID when planned > 0 and paid ≥ planned, PARTIAL
 * when 0 < paid < planned, UNPAID when nothing is paid, NO_PLAN when the planned amount is 0 (whatever was paid).
 * The stored status never decides; `actual_amount` (a legacy manual mirror) is ignored.
 */
export function budgetLinePaidState(line: BudgetLineLike, payments: readonly BudgetPaymentLike[]): BudgetLinePaidState {
  const currency = normalizeCurrency(line.currency);
  let paid = 0, other = 0;
  for (const p of payments) {
    if (p.currency !== undefined && p.currency !== null && p.currency !== "" && normalizeCurrency(p.currency) !== currency) { other++; continue; }
    paid += num(p.amount);
  }
  paid = r2(paid);
  const planned = r2(num(line.planned_amount));
  const state: BudgetLinePaidStateCode = planned <= 0 ? "NO_PLAN" : paid >= planned ? "PAID" : paid > 0 ? "PARTIAL" : "UNPAID";
  return { state, paid, planned, remaining: r2(Math.max(0, planned - paid)), over: r2(Math.max(0, paid - planned)), currency, otherCurrencyPayments: other, storedStatus: String(line.status ?? "") };
}
export type BudgetLineStatusConflictCode = "STATUS_PAID_WITHOUT_PAYMENTS" | "STATUS_PLANNED_BUT_PAID";
/**
 * Stored status vs the payments (CONFLICTING_SOURCES — reported, never resolved): the line says שולם with no payment
 * recorded, or says מתוכנן while its payments already cover the plan. A cancelled line (בוטל) is never a conflict.
 */
export function budgetLineStatusConflict(line: BudgetLineLike, payments: readonly BudgetPaymentLike[]): { code: BudgetLineStatusConflictCode; he: string } | null {
  const s = budgetLinePaidState(line, payments);
  if (line.status === "שולם" && s.paid <= 0) return { code: "STATUS_PAID_WITHOUT_PAYMENTS", he: "השורה מסומנת 'שולם' ואין עליה אף תשלום רשום" };
  if (line.status === "מתוכנן" && s.state === "PAID") return { code: "STATUS_PLANNED_BUT_PAID", he: `השורה מסומנת 'מתוכנן' והתשלומים כבר מכסים את התכנון (${s.currency}${s.paid})` };
  return null;
}

// ── 4. Red Films ledger ↔ Finance linkage + scope ────────────────────────────────────────────────────────────────────
/** The signal / state of Red Films payments that are NOT linked to Finance yet (DB-1 live: each payment → ONE linked
 *  Finance expense; the historical payments are linked by the Owner through LINK_RF_PAYMENT_TO_FINANCE). */
export const RF_LEDGER_LINKAGE = "RF_LEDGER_NOT_IN_FINANCE" as const;
export const RF_LEDGER_LINKAGE_HE = "שולם בפנקס של Red Films — כסף אמיתי של החברה, עדיין לא מקושר לכספים (קישור: LINK_RF_PAYMENT_TO_FINANCE)";
/** Per payment: LINKED (its ONE Finance expense exists — counted in Finance, never again), UNLINKED (a clip production
 *  with a project — linkable), SCOPE_REQUIRED (non-clip — no canonical scope), PROJECT_REQUIRED (clip without project). */
export type RfPaymentLinkageCode = "LINKED" | "UNLINKED" | "SCOPE_REQUIRED" | "PROJECT_REQUIRED";
export function rfPaymentLinkage(p: { linkedTransactionId?: string | null; hasTransaction?: boolean }, production: { productionType?: string | null; projectId?: string | null } | null | undefined): RfPaymentLinkageCode {
  if (p.linkedTransactionId || p.hasTransaction) return "LINKED";
  if (!rfPaymentFinanceScope(production?.productionType).scope) return "SCOPE_REQUIRED";
  return production?.projectId ? "UNLINKED" : "PROJECT_REQUIRED";
}
/**
 * The Finance expense scope a Red Films payment carries: a clip production → קליפ. Any other production type has
 * no canonical scope → SCOPE_REQUIRED (never a silent "כללי").
 */
export function rfPaymentFinanceScope(productionType: string | null | undefined): { scope: "קליפ" } | { scope: null; state: "SCOPE_REQUIRED"; he: string } {
  if ((productionType ?? "") === "קליפ") return { scope: "קליפ" };
  return { scope: null, state: "SCOPE_REQUIRED", he: `הפקה מסוג '${productionType || "—"}' — אין שיוך קנוני בכספים; צריך החלטה (לא 'כללי' שקט)` };
}

// ── 2. clip recoup (D) + A / B / C information ───────────────────────────────────────────────────────────────────────
export const CLIP_RECOUP_NOT_DEFINED_HE = "חסר כלל חוזה: אילו הוצאות קליפ מתקזזות מול האמן";
export const CLIP_RECOUP_NOT_DEFINED_UI_HE = "לא נקבע";
export interface ClipRecoupContribution { status: "NOT_DEFINED"; amount: null; reasonHe: string }
/** The clip part of an artist's recoup. Until the artist agreement rule is recorded it is ALWAYS NOT_DEFINED. */
export function clipRecoupContribution(): ClipRecoupContribution {
  return { status: "NOT_DEFINED", amount: null, reasonHe: CLIP_RECOUP_NOT_DEFINED_HE };
}
export interface Amount { amount: number | null | undefined; currency: string | null | undefined }
export interface ClipMoneyByCurrency {
  /** A — the client clip price (information only). */
  clientClipPrice: number;
  /** B — planned budget (planning, not money). */
  plannedBudget: number;
  /** C — actual clip cost in Finance, paid (שולם) only. */
  actualCostPaid: number;
  /** Paid in the Red Films ledger and NOT linked to Finance (DB-1: a linked payment is already in C). Never added to C. */
  rfLedgerPaid: number;
}
/** A / B / C (+ the Red Films ledger) PER CURRENCY — four separate numbers, never added together, never a recoup. */
export function clipMoneyByCurrency(input: { clientClipPrices?: readonly Amount[]; plannedBudgets?: readonly Amount[]; actualCostsPaid?: readonly Amount[]; rfLedgerPaid?: readonly Amount[] }): Record<string, ClipMoneyByCurrency> {
  const out: Record<string, ClipMoneyByCurrency> = {};
  const add = (list: readonly Amount[] | undefined, k: keyof ClipMoneyByCurrency) => {
    for (const a of list ?? []) {
      const v = num(a.amount); if (!v) continue;
      const b = (out[normalizeCurrency(a.currency)] ??= { clientClipPrice: 0, plannedBudget: 0, actualCostPaid: 0, rfLedgerPaid: 0 });
      b[k] = r2(b[k] + v);
    }
  };
  add(input.clientClipPrices, "clientClipPrice"); add(input.plannedBudgets, "plannedBudget"); add(input.actualCostsPaid, "actualCostPaid"); add(input.rfLedgerPaid, "rfLedgerPaid");
  return out;
}
/**
 * DERIVED observation: a production created by 'שלח קליפ' before B3 got its budget from the clip price (the retired
 * price → budget sync). When the budget still equals the clip price in the same currency, say so — it is planning that
 * happens to equal A, not a decision that B = A.
 */
export function budgetEqualsOldClipPriceSync(p: { managedBySendClip: boolean; budget: number | null | undefined; budgetCurrency: string | null | undefined; clipAgreedPrice: number | null | undefined; clipCurrency: string | null | undefined }): boolean {
  const b = num(p.budget), c = num(p.clipAgreedPrice);
  return p.managedBySendClip && b > 0 && b === c && normalizeCurrency(p.budgetCurrency) === normalizeCurrency(p.clipCurrency);
}
export const BUDGET_EQUALS_CLIP_PRICE_HE = "התקציב שווה למחיר הקליפ — שריד של הסנכרון הישן (מחיר → תקציב); זה תכנון, לא החלטה שהתקציב = המחיר";

// ── 8. clip planning rows ────────────────────────────────────────────────────────────────────────────────────────────
/** The clip_items.status vocabulary — pinned to components/ui/ProjectDrawer.tsx ClipItemStatus. */
export const CLIP_ITEM_STATUSES = ["תכנון בלבד", "הועבר לכספים", "שולם", "בוטל"] as const;
export type ClipItemStatus = (typeof CLIP_ITEM_STATUSES)[number];
export const CLIP_ITEM_PROMOTED_STATUS: ClipItemStatus = "הועבר לכספים";
export function isClipItemStatus(v: unknown): v is ClipItemStatus { return typeof v === "string" && (CLIP_ITEM_STATUSES as readonly string[]).includes(v); }
export interface ClipItemLike { status?: string | null; linked_transaction_id?: string | null; linkedTransactionId?: string | null; hasTransaction?: boolean }
const linkedOf = (r: ClipItemLike) => !!(r.linked_transaction_id || r.linkedTransactionId || r.hasTransaction);
/** Promoted = linked to its Finance expense (or a legacy row marked הועבר לכספים / שולם). Never planning again. */
export function isClipItemPromoted(r: ClipItemLike): boolean { return linkedOf(r) || r.status === "הועבר לכספים" || r.status === "שולם"; }
/** Planned = an unlinked, not-cancelled planning row. The ONE rule for the drawer strip, the operations capability and Sunny. */
export function isClipItemPlanned(r: ClipItemLike): boolean { return r.status !== "בוטל" && !isClipItemPromoted(r); }

// ── 6. transaction edit — the expense scope is never reset on income ────────────────────────────────────────────────
/**
 * The expense-scope part of a transaction edit body: an expense sends its chosen scope (default כללי); an INCOME edit
 * never sends a scope (clip income keeps קליפ, show income keeps its scope) — the scope of income changes only through
 * an explicit scope action.
 */
export function txEditScopePatch(type: string | null | undefined, draftScope: string | null | undefined): { expenseScope?: string } {
  return type === "expense" ? { expenseScope: draftScope || "כללי" } : {};
}

// ── 7. Red Films client_source from the project classification ──────────────────────────────────────────────────────
/** Pinned to components/red-films/RedFilmsStatusBadge.tsx (the client-source vocabulary of the Red Films screens). */
export const RF_CLIENT_SOURCES = ["פנימי - לייבל", "לקוח חיצוני", "אמן לייבל", "פרויקט שיווקי", "אחר"] as const;
export const RF_CLIENT_SOURCE_DEFAULT = "פנימי - לייבל";
/**
 * The client_source a NEW production gets from its project's classification (lib/project-classification: the stored
 * project_business_type is the only classifier): לייבל → "פנימי - לייבל", לקוח → "לקוח חיצוני". No project / an
 * unclassified project keeps the screens' default (an internal production). Existing rows are never touched.
 */
export function rfClientSourceFor(project: { businessType?: string | null } | null | undefined): string {
  if (!project) return RF_CLIENT_SOURCE_DEFAULT;
  if (project.businessType === "לייבל") return "פנימי - לייבל";
  if (project.businessType === "לקוח") return "לקוח חיצוני";
  return RF_CLIENT_SOURCE_DEFAULT;
}

// ── 5. income scope: song money vs clip money, before / after a scope change ──────────────────────────────────────
/** The only scopes an INCOME row may be given by the scope action (show income keeps its own writer). */
export const INCOME_SCOPES: readonly string[] = ["קליפ", "כללי"];
export interface IncomeRowLike { id: string; amount: number; currency: string | null; paymentStatus: string | null; expenseScope: string | null }
export interface SongClipSplit { song: { received: number; open: number }; clip: { received: number; open: number } }
/**
 * A project's income PER CURRENCY split into song money (everything not scoped קליפ) and clip money (scope קליפ), now and
 * after moving ONE row to `newScope`. Received = שולם / התקבל (lib/finance/classify); cancelled rows are never money.
 * Used by the preview of the income-scope action — the Owner sees exactly what moves between the song and the clip deal.
 */
export function songClipSplitBeforeAfter(incomes: readonly IncomeRowLike[], txId: string, newScope: string): { before: Record<string, SongClipSplit>; after: Record<string, SongClipSplit> } {
  const build = (scopeOf: (r: IncomeRowLike) => string) => {
    const out: Record<string, SongClipSplit> = {};
    for (const r of incomes) {
      if (_cancelled(r.paymentStatus)) continue;
      const c = normalizeCurrency(r.currency);
      const b = (out[c] ??= { song: { received: 0, open: 0 }, clip: { received: 0, open: 0 } });
      const side = scopeOf(r) === "קליפ" ? b.clip : b.song;
      if (_received(r.paymentStatus)) side.received = r2(side.received + num(r.amount)); else side.open = r2(side.open + num(r.amount));
    }
    return out;
  };
  return { before: build((r) => r.expenseScope ?? ""), after: build((r) => (r.id === txId ? newScope : r.expenseScope ?? "")) };
}
/** One-line Hebrew text of a split (per currency; no "/" so it is never path-like). */
export function songClipSplitText(m: Record<string, SongClipSplit>): string {
  const e = Object.entries(m).sort(([a], [b]) => a.localeCompare(b));
  if (!e.length) return "אין הכנסות";
  return e.map(([c, s]) => `${c}: שיר התקבל ${c}${s.song.received} (פתוח ${c}${s.song.open}) · קליפ התקבל ${c}${s.clip.received} (פתוח ${c}${s.clip.open})`).join(" | ");
}
