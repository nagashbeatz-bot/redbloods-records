import { supabase } from "@/lib/supabase";

export const SHOW_STATUSES = ["ליד חדש","ממתין לתשובה","צריך פולואפ","נסגר","בוצע","בוטל"] as const;
export const PAYMENT_STATUSES = ["לא שולם","חלקי","שולם"] as const;

export type ShowStatus   = typeof SHOW_STATUSES[number];
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

export type CreateShowInput = Omit<Show, "id" | "created_at" | "updated_at">;
export type PatchShowInput  = Partial<CreateShowInput>;

export async function listShows(): Promise<Show[]> {
  const { data, error } = await supabase
    .from("shows")
    .select("*")
    .order("date", { ascending: true, nullsFirst: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as Show[];
}

export async function getShow(id: string): Promise<Show | null> {
  const { data } = await supabase.from("shows").select("*").eq("id", id).single();
  return data as Show | null;
}

export async function createShow(input: Partial<CreateShowInput> & { name: string }): Promise<Show> {
  const { data, error } = await supabase
    .from("shows")
    .insert({
      name:           input.name.trim(),
      artist:         input.artist         ?? "",
      date:           input.date           ?? null,
      start_time:     input.start_time     ?? null,
      location:       input.location       ?? "",
      contact_person: input.contact_person ?? "",
      phone:          input.phone          ?? "",
      status:         input.status         ?? "ליד חדש",
      payment_status: input.payment_status ?? "לא שולם",
      show_price:     input.show_price     ?? 0,
      dj_fee:         input.dj_fee         ?? 500,
      advance_payment:input.advance_payment?? 0,
      notes:          input.notes          ?? "",
    })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as Show;
}

export async function patchShow(id: string, patch: PatchShowInput): Promise<Show> {
  const { data, error } = await supabase
    .from("shows")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as Show;
}

export async function deleteShow(id: string): Promise<void> {
  const { error } = await supabase.from("shows").delete().eq("id", id);
  if (error) throw new Error(error.message);
}
