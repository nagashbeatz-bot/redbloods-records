import "server-only";
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL!;
const key = process.env.SUPABASE_SECRET_KEY!;

if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SECRET_KEY חסרים");

export const supabase = createClient(url, key);
