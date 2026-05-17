/**
 * Persistent report schedule config stored in Supabase settings table.
 * Key: "report_schedule", value: { morningTime, eveningTime }
 */
import "server-only";
import { supabase } from "@/lib/supabase";

const SETTINGS_KEY = "report_schedule";

interface ConfigPayload {
  morningTime: string;
  eveningTime: string;
}

/** Read the stored schedule from Supabase. Returns null if not found or on error. */
export async function readReportConfig(): Promise<ConfigPayload | null> {
  try {
    const { data, error } = await supabase
      .from("settings")
      .select("value")
      .eq("key", SETTINGS_KEY)
      .single();

    if (error || !data) return null;
    const val = data.value as ConfigPayload;
    if (!val?.morningTime || !val?.eveningTime) return null;
    return val;
  } catch {
    return null;
  }
}

/** Write the schedule to Supabase settings table. */
export async function writeReportConfig(config: ConfigPayload): Promise<void> {
  const { error } = await supabase
    .from("settings")
    .upsert({ key: SETTINGS_KEY, value: config }, { onConflict: "key" });

  if (error) throw new Error(error.message);
}
