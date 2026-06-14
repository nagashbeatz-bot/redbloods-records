// Shared types and constants for shows — safe to import from Client Components
// (no supabase / server-only imports here)

export const SHOW_STATUSES = ["ליד חדש","ממתין לתשובה","צריך פולואפ","נסגר","בוצע","בוטל"] as const;
export const PAYMENT_STATUSES = ["לא שולם","חלקי","שולם"] as const;

export type ShowStatus    = typeof SHOW_STATUSES[number];
export type PaymentStatus = typeof PAYMENT_STATUSES[number];

export interface Show {
  id: string;
  name: string;
  artist: string;
  date: string | null;
  start_time: string | null;
  location: string;
  contact_person: string;
  phone: string;
  status: ShowStatus;
  payment_status: PaymentStatus;
  show_price: number;
  dj_fee: number;
  advance_payment: number;
  notes: string;
  created_at: string;
  updated_at: string;
}
