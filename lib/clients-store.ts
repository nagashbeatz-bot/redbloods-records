import "server-only";
import { supabase } from "./supabase";

export type ClientType   = "אמן" | "לקוח" | "איש צוות" | "אחר";
export type ClientStatus = "פעיל" | "לא פעיל" | "בעייתי" | "VIP" | "חדש";

export interface Client {
  id:         string;
  name:       string;
  phone:      string;
  email:      string;
  type:       ClientType;
  status:     ClientStatus;
  notes:      string;
  created_at?: string;
}

export async function listClients(): Promise<Client[]> {
  const { data, error } = await supabase
    .from("clients")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return data as Client[];
}

export async function createClient(fields: Omit<Client, "id" | "created_at">): Promise<Client> {
  const { data, error } = await supabase
    .from("clients")
    .insert(fields)
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data as Client;
}

export async function updateClient(id: string, fields: Omit<Client, "id" | "created_at">): Promise<void> {
  const { error } = await supabase
    .from("clients")
    .update(fields)
    .eq("id", id);

  if (error) throw new Error(error.message);
}

export async function deleteClient(id: string): Promise<void> {
  const { error } = await supabase
    .from("clients")
    .delete()
    .eq("id", id);

  if (error) throw new Error(error.message);
}
