// Shared types and constants for shows — safe to import from Client Components
// (no supabase / server-only imports here)

export const SHOW_STATUSES = ["ליד חדש","ממתין לתשובה","צריך פולואפ","נסגר","אושרה","בוצע","בוטל"] as const;
export const PAYMENT_STATUSES = ["לא שולם","חלקי","שולם"] as const;

export type ShowStatus    = typeof SHOW_STATUSES[number];
export type PaymentStatus = typeof PAYMENT_STATUSES[number];

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
}

/**
 * Canonical show distribution — the SINGLE source of truth shared by the Shows
 * UI and the Finance sync, so both always agree (one helper, one calc).
 *
 *   grossAmount = show_price
 *   djFee       = dj_fee
 *   netAfterDj  = max(0, gross - dj)
 *   artistFee   = netAfterDj / 2     (artist always takes half of the net)
 *   labelProfit = netAfterDj / 2
 *
 * The split is ALWAYS 50/50 of whatever remains after the dj. The legacy
 * explicit `artist_fee` field is intentionally NOT consulted, so changing the
 * dj fee always re-splits the rest automatically. `artist_fee` is now vestigial
 * (still stored, but ignored by every calc).
 */
export function computeShowSplit(
  s: Pick<Show, "show_price" | "dj_fee">,
): { grossAmount: number; djFee: number; netAfterDj: number; artistFee: number; labelProfit: number } {
  const grossAmount = s.show_price ?? 0;
  const djFee       = s.dj_fee ?? 0;
  const netAfterDj  = Math.max(0, grossAmount - djFee);
  const artistFee   = netAfterDj / 2;
  const labelProfit = netAfterDj - artistFee; // == netAfterDj/2, avoids fp drift
  return { grossAmount, djFee, netAfterDj, artistFee, labelProfit };
}
