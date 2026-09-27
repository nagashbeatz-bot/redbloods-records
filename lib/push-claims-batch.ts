import "server-only";
import { supabase } from "./supabase";
import { settingsClaimStore } from "./push-claims";
import type { BatchClaimStore } from "./push-claims-pure";

/**
 * The batch-flush store: the claim store plus a prefix scan and a CONDITIONAL delete (only when the row still equals
 * the exact claimed value — a batch re-opened by a new upload meanwhile survives). Used only by the pending upload-
 * notice flushes (Steven / Victor) and the final-files batches.
 */
export const settingsBatchStore: BatchClaimStore = {
  ...settingsClaimStore,
  async remove(key, expected) {
    let q = supabase.from("settings").delete().eq("key", key);
    if (expected !== undefined) q = q.eq("value", JSON.stringify(expected));
    const { data, error } = await q.select("key");
    if (error) throw new Error(`[push-claims] remove ${key} failed: ${error.message}`);
    return !!data && data.length > 0;
  },
  async list(prefix) {
    const { data, error } = await supabase.from("settings").select("key, value").like("key", `${prefix}%`);
    if (error) throw new Error(`[push-claims] list ${prefix} failed: ${error.message}`);
    return (data ?? []) as Array<{ key: string; value: unknown }>;
  },
};
