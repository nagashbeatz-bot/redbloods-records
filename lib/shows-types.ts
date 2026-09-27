// Shared types and constants for shows — safe to import from Client Components
// (no supabase / server-only imports here)

export const SHOW_STATUSES = ["ליד חדש","ממתין לתשובה","צריך פולואפ","נסגר","אושרה","בוצע","בוטל"] as const;
// Selectable payment statuses (unified for all shows). "חלקי" is legacy-only:
// existing rows may still hold it — it is shown as "מקדמה" and never offered.
export const PAYMENT_STATUSES = ["שולם","לא שולם","צפוי","מקדמה","בוטל"] as const;

/** Currencies a show / Red Films row can be priced in (the symbols Finance already uses). Never converted, never added. */
export const MONEY_CURRENCIES = ["₪", "$", "€"] as const;
export type MoneyCurrency = typeof MONEY_CURRENCIES[number];
export const isMoneyCurrency = (x: unknown): x is MoneyCurrency => typeof x === "string" && (MONEY_CURRENCIES as readonly string[]).includes(x);
/** "₪1,500" / "$1,500" / "€1,500" — every amount is shown with its own currency. */
export function fmtMoney(n: number, currency: string | null | undefined): string { return `${currency || "₪"}${(Number(n) || 0).toLocaleString("he-IL")}`; }

export type ShowStatus    = typeof SHOW_STATUSES[number];
export type PaymentStatus = typeof PAYMENT_STATUSES[number] | "חלקי";

// DJ-side confirmation (separate from the show's own lifecycle `status` —
// never conflated with it). NULL = outside the confirmation system (no DJ
// linked yet, a legacy pre-feature row, or a DJ linked directly on an
// already-closed show — never a retroactive confirmation request).
export const DJ_CONFIRMATION_STATUSES = ["ממתין לאישור", "אושר"] as const;
export type DjConfirmationStatus = typeof DJ_CONFIRMATION_STATUSES[number];

export interface Show {
  id: string;
  name: string;
  artist: string;             // display name (denormalized from artist_client)
  artist_client_id: string | null;
  booker_client_id: string | null;
  booker_name: string;        // display name (denormalized from booker_client)
  date: string | null;
  start_time: string | null;
  location: string;
  contact_person: string;
  phone: string;
  status: ShowStatus;
  payment_status: PaymentStatus;
  show_price: number;
  dj_fee: number;
  dj_client_id: string | null;
  dj_name: string;
  dj_confirmation_status: DjConfirmationStatus | null;
  dj_confirmed_at: string | null;
  artist_fee: number;
  /** D5: a MIRROR of the money received in Finance (the sync writes it; never typed in). */
  advance_payment: number;
  /** Currency of show_price / dj_fee / advance_payment; its Finance rows carry the same currency. */
  currency: MoneyCurrency;
  notes: string;
  calendar_event_id: string | null;
  // Canonical Finance links (Phase 1: created when payment_status = "שולם").
  linked_income_transaction_id: string | null;
  linked_dj_expense_transaction_id: string | null;
  linked_artist_expense_transaction_id: string | null;
  created_at: string;
  updated_at: string;
  // Transient (NOT a DB column): counted rehearsal costs for Fin-2, attached by
  // GET /api/shows so the list split matches the open show panel. Optional.
  rehearsalCounted?: number;
}

/**
 * Canonical show distribution — the SINGLE source of truth shared by the Shows
 * UI and the Finance sync, so both always agree (one helper, one calc).
 *
 *   grossAmount    = show_price
 *   djFee          = dj_fee
 *   rehearsalCosts = Σ counted rehearsal costs (Fin-2, see rehearsalCountedAmount)
 *   netAfterDj     = max(0, gross - dj - rehearsalCosts)   ← distributable base
 *   artistFee      = netAfterDj / 2     (artist always takes half of the base)
 *   labelProfit    = netAfterDj / 2
 *
 * Fin-2: rehearsal costs that count (see rehearsalCountedAmount) are subtracted
 * BEFORE the 50/50, so the artist shares in rehearsal expenses. The split is
 * ALWAYS 50/50 of whatever remains after dj + rehearsals. The legacy explicit
 * `artist_fee` field is intentionally NOT consulted. `rehearsalCosts` defaults
 * to 0 so callers that don't pass it keep the pre-Fin-2 (gross-dj) behaviour.
 */
export function computeShowSplit(
  s: Pick<Show, "show_price" | "dj_fee">,
  rehearsalCosts = 0,
): { grossAmount: number; djFee: number; rehearsalCosts: number; netAfterDj: number; artistFee: number; labelProfit: number } {
  const grossAmount = s.show_price ?? 0;
  const djFee       = s.dj_fee ?? 0;
  const rehc        = Math.max(0, rehearsalCosts || 0);
  const netAfterDj  = Math.max(0, grossAmount - djFee - rehc); // distributable base
  const artistFee   = netAfterDj / 2;
  const labelProfit = netAfterDj - artistFee; // == netAfterDj/2, avoids fp drift
  return { grossAmount, djFee, rehearsalCosts: rehc, netAfterDj, artistFee, labelProfit };
}

/**
 * Fin-2 / D6 (Owner decision 2026-09-27, FINAL) — how much of a single show rehearsal's cost counts toward the
 * show's distributable-base deduction. Pure, shared by the Finance sync (server), the Shows UI and Sunny.
 *
 *   בוצע    → the full cost counts (the rehearsal happened; the obligation exists whatever its payment state)
 *   מתוכנן  → 0  (planned — even if already paid, it does not reduce the split until it is marked בוצע)
 *   בוטל    → 0
 *   התקיים  → LEGACY only: the generic page-load auto-mark used to write it on show rehearsals (it no longer does).
 *             Such a row keeps the pre-D6 rule (counts only when its expense is שולם / התקבל) so no recorded split
 *             changes silently; Sunny flags it for the Owner to confirm (בוצע / בוטל).
 */
export function rehearsalCountedAmount(
  operationalStatus: string | null | undefined,
  paymentStatus: string | null | undefined,
  cost: number | null | undefined,
): number {
  const c = Number(cost) || 0;
  if (c <= 0) return 0;
  if (operationalStatus === "בוצע") return c;
  if (operationalStatus === REHEARSAL_LEGACY_AUTOMARK_STATUS) return paymentStatus === "שולם" || paymentStatus === "התקבל" ? c : 0;
  return 0; // מתוכנן / בוטל / anything else
}
/** sessions.session_type of a show rehearsal. */
export const SHOW_REHEARSAL_SESSION_TYPE = "חזרה להופעה";
/** The status the old generic auto-mark wrote on show rehearsals (kept only for rows written before D6). */
export const REHEARSAL_LEGACY_AUTOMARK_STATUS = "התקיים";
/** A legacy auto-marked rehearsal that the Owner has not confirmed as בוצע / בוטל (surfaced, never decided for him). */
export function isRehearsalLegacyAutoMarked(operationalStatus: string | null | undefined): boolean {
  return operationalStatus === REHEARSAL_LEGACY_AUTOMARK_STATUS;
}

/** True if a rehearsal's payment is "חלקי" — unsupported, surfaced as needs-attention. */
export function isRehearsalPartial(paymentStatus: string | null | undefined): boolean {
  return paymentStatus === "חלקי";
}

/**
 * Pure decision for how a show write should touch dj_confirmation_status /
 * dj_confirmed_at, shared by createShow and patchShow (lib/shows-store.ts) so
 * both agree exactly. `null` return = "don't touch these fields" (routine
 * edits to location/time/notes/price, or a DJ change irrelevant to the given
 * dj id, must never reset an unrelated confirmation).
 *
 *   no DJ change (same id before/after)         → null (untouched)
 *   DJ becomes `djId`, show still open           → 'ממתין לאישור' (never retroactive on a closed show)
 *   DJ becomes `djId`, show already בוצע/בוטל    → null status (no fake retroactive request)
 *   DJ WAS `djId`, changed away / removed         → reset to null
 *   DJ change between two other, unrelated ids    → null (untouched)
 */
export function computeDjConfirmationTransition(
  djId: string,
  oldDjClientId: string | null,
  newDjClientId: string | null,
  effectiveStatus: string | null,
): { dj_confirmation_status: DjConfirmationStatus | null; dj_confirmed_at: null } | null {
  if (newDjClientId === oldDjClientId) return null;
  if (newDjClientId === djId) {
    const closed = effectiveStatus === "בוצע" || effectiveStatus === "בוטל";
    return { dj_confirmation_status: closed ? null : "ממתין לאישור", dj_confirmed_at: null };
  }
  if (oldDjClientId === djId) {
    return { dj_confirmation_status: null, dj_confirmed_at: null };
  }
  return null;
}

// ─── D5: show money in Finance (Owner decision 2026-09-27) ─────────────────────
/** transactions.show_money_role values (the canonical show ↔ Finance link is transactions.show_id). */
export const SHOW_MONEY_ROLES = { PAYMENT: "SHOW_PAYMENT", EXPECTED: "SHOW_BALANCE_EXPECTED", DJ: "DJ_FEE", ARTIST: "ARTIST_FEE", REHEARSAL: "REHEARSAL" } as const;
/** Actual money received (Finance rule): only שולם / התקבל. צפוי / לא שולם / בוטל / חלקי are not received. */
export const RECEIVED_STATUSES: readonly string[] = ["שולם", "התקבל"];
export interface ShowMoneyRow { id: string; role: string | null; status: string | null; amount: number; currency: string | null; date?: string | null }
export interface ShowMoney {
  currency: string; agreed: number;
  /** Σ SHOW_PAYMENT rows with a received status, in the show's currency. */
  received: number; remaining: number;
  /** received above the agreed price — kept visible (overpayment / credit / tip), never discarded. */
  credit: number;
  payments: ShowMoneyRow[]; expected: ShowMoneyRow | null;
  /** payments recorded in another currency — never added, surfaced for the Owner. */
  otherCurrencyPayments: ShowMoneyRow[];
  /** the payment status Finance proves: שולם (received ≥ agreed) / מקדמה (partly) / null (nothing received). */
  derivedPaymentStatus: "שולם" | "מקדמה" | null;
}
/** The ONE show-money rule (sync, payment writer, Shows UI and Sunny all use it). */
export function showMoneyOf(show: { show_price: number; currency?: string | null }, rows: readonly ShowMoneyRow[]): ShowMoney {
  const currency = show.currency || "₪";
  const agreed = Math.max(0, Number(show.show_price) || 0);
  const payRows = rows.filter((r) => r.role === SHOW_MONEY_ROLES.PAYMENT && RECEIVED_STATUSES.includes(String(r.status)));
  const payments = payRows.filter((r) => (r.currency || "₪") === currency);
  const otherCurrencyPayments = payRows.filter((r) => (r.currency || "₪") !== currency);
  const received = Math.round(payments.reduce((t, r) => t + (Number(r.amount) || 0), 0) * 100) / 100;
  const remaining = Math.max(0, Math.round((agreed - received) * 100) / 100);
  const credit = Math.max(0, Math.round((received - agreed) * 100) / 100);
  const expected = rows.find((r) => r.role === SHOW_MONEY_ROLES.EXPECTED) ?? null;
  const derivedPaymentStatus = received <= 0 ? null : agreed > 0 && received >= agreed ? "שולם" : "מקדמה";
  return { currency, agreed, received, remaining, credit, payments, expected, otherCurrencyPayments, derivedPaymentStatus };
}
