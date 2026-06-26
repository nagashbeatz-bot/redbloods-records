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
 * Effective artist fee, bridging the legacy 50/50 model to the explicit
 * `artist_fee` field introduced in Phase B.
 *
 *  • artist_fee > 0            → explicit override, use as-is.
 *  • artist_fee 0/null/undefined → "not set": fall back to the old model where
 *    the artist took half of what remained after the dj — max(0, (price-dj)/2).
 *  • price - dj <= 0           → nothing to distribute, fee is 0.
 *
 * So existing shows (artist_fee = 0) keep their original 50/50 behaviour with
 * no manual backfill, while any explicit artist_fee replaces the split.
 * NOTE: until a separate "artist truly gets 0" flag exists, 0 means "not set".
 */
export function getEffectiveArtistFee(
  s: Pick<Show, "artist_fee" | "show_price" | "dj_fee">,
): number {
  if ((s.artist_fee ?? 0) > 0) return s.artist_fee;
  const distributable = (s.show_price ?? 0) - (s.dj_fee ?? 0);
  return distributable > 0 ? distributable / 2 : 0;
}
