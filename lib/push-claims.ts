import "server-only";
import { supabase } from "./supabase";
import type { ClaimStore } from "./push-claims-pure";

/**
 * The real ClaimStore over the existing `settings` key/value table (no schema change). Used by every delivery claim
 * (lib/push-claims-pure.ts), the portal presence model (lib/push-presence-pure.ts), the external push cron's per-day
 * claims and the report-email per-day claims. It never deletes; the pending-batch flushes use lib/push-claims-batch.ts.
 *
 * Atomicity: INSERT-first (unique key → 23505 = someone else claimed) and compare-and-swap updates / deletes that
 * match the EXACT previous jsonb value — the same pattern lib/show-notify.ts proved. A read error throws (it is never
 * read as "no row"), so a claim fails closed instead of sending.
 */
export const settingsClaimStore: ClaimStore = {
  async read(key) {
    const { data, error } = await supabase.from("settings").select("value").eq("key", key).maybeSingle();
    if (error) throw new Error(`[push-claims] read ${key} failed: ${error.message}`);
    return (data?.value ?? null) as unknown;
  },
  async insert(key, value) {
    const { error } = await supabase.from("settings").insert({ key, value });
    if (!error) return "ok";
    if (error.code === "23505") return "conflict";
    console.error(`[push-claims] insert ${key} failed: ${error.message}`);
    return "error";
  },
  async cas(key, expected, next) {
    const { data, error } = await supabase.from("settings").update({ value: next }).eq("key", key).eq("value", JSON.stringify(expected)).select("key");
    if (error) throw new Error(`[push-claims] cas ${key} failed: ${error.message}`);
    return !!data && data.length > 0;
  },
  async upsert(key, value) {
    const { error } = await supabase.from("settings").upsert({ key, value }, { onConflict: "key" });
    if (error) throw new Error(`[push-claims] upsert ${key} failed: ${error.message}`);
  },
};

/** Never send real push / email from local / dev — only production (or an explicit opt-in). The one shared guard. */
export function pushAllowed(): boolean {
  return process.env.NODE_ENV === "production" || process.env.ALLOW_SERVER_PUSH === "true";
}
