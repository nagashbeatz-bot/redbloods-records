// Shared types and constants for shows — safe to import from Client Components
// (no supabase / server-only imports here)

export const SHOW_STATUSES = ["ליד חדש","ממתין לתשובה","צריך פולואפ","נסגר","אושרה","בוצע","בוטל"] as const;
// Selectable payment statuses (unified for all shows). "חלקי" is legacy-only:
// existing rows may still hold it — it is shown as "מקדמה" and never offered.
export const PAYMENT_STATUSES = ["שולם","לא שולם","צפוי","מקדמה","בוטל"] as const;

export type ShowStatus    = typeof SHOW_STATUSES[number];
export type PaymentStatus = typeof PAYMENT_STATUSES[number] | "חלקי";

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
  artist_fee: number;
  advance_payment: number;
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
 * Fin-2 — how much of a single rehearsal's cost counts toward the show's
 * distributable-base deduction. Pure, shared by the Finance sync (server) and
 * the Shows UI (client) so both agree exactly.
 *
 *   operationalStatus ∈ "מתוכנן" | "בוצע" | "בוטל"   (sessions.status)
 *   paymentStatus     ∈ "לא שולם" | "שולם" | "חלקי" | "בוטל" | null  (its transaction)
 *
 * Rules (partial "חלקי" is intentionally NOT supported — no canonical paid-amount
 * source; such a rehearsal is never counted and is surfaced as needs-attention):
 *   בוצע (any paid state, except חלקי) → full cost   (real obligation)
 *   מתוכנן/בוטל + שולם                 → full cost   (money already out)
 *   מתוכנן/בוטל + לא שולם              → 0
 *   any + חלקי                         → 0  (flagged elsewhere, never invented)
 */
export function rehearsalCountedAmount(
  operationalStatus: string | null | undefined,
  paymentStatus: string | null | undefined,
  cost: number | null | undefined,
): number {
  const c = Number(cost) || 0;
  if (c <= 0) return 0;
  if (paymentStatus === "חלקי") return 0;            // unsupported — never counted
  if (operationalStatus === "בוצע") return c;        // obligation exists regardless of payment
  if (paymentStatus === "שולם" || paymentStatus === "התקבל") return c; // planned/cancelled but paid
  return 0;                                          // planned/cancelled & unpaid
}

/** True if a rehearsal's payment is "חלקי" — unsupported, surfaced as needs-attention. */
export function isRehearsalPartial(paymentStatus: string | null | undefined): boolean {
  return paymentStatus === "חלקי";
}
