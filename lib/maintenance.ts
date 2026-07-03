import { supabase } from "./supabase";

/**
 * Global maintenance lock — stored in the existing settings key/value table
 * (no schema change). When enabled, the proxy blocks every non-owner request
 * (pages → /maintenance screen, APIs → 503) while the owner keeps full access.
 */
const KEY = "maintenance_mode";

export async function getMaintenance(): Promise<boolean> {
  const { data } = await supabase.from("settings").select("value").eq("key", KEY).maybeSingle();
  return (data?.value as { enabled?: boolean } | null)?.enabled === true;
}

export async function setMaintenance(enabled: boolean): Promise<void> {
  await supabase
    .from("settings")
    .upsert(
      { key: KEY, value: { enabled, updatedAt: new Date().toISOString() } as unknown as Record<string, unknown> },
      { onConflict: "key" },
    );
}
