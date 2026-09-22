import "server-only";

/**
 * Redbloods Partner — Baseline persistence (Phase D.2). The ONLY file in
 * lib/partner/baseline that touches Supabase.
 *
 * Storage: the existing `settings` table (key/value jsonb) — the SAME
 * generic key-value store already used ~159 places across this codebase
 * (Google Calendar tokens, Dropbox tokens, Victor/Steven settings, per-
 * project finance settings, maintenance mode, etc. — see
 * lib/vendor-store.ts:getVictorSettings/updateVictorSettings for the
 * identical read/upsert pattern this file mirrors). One key, one row. No new
 * table, no migration, no schema change (Phase D.2 storage diagnosis — see
 * the Phase D.2 report).
 *
 * Only ONE baseline is kept — no history, no event log (Owner instruction §53).
 */
import { supabase } from "@/lib/supabase";
import type { StoredPartnerBaseline } from "./types";

const BASELINE_KEY = "partner_change_baseline";

/** null = no baseline has ever been saved (first observation) OR the stored value is not a well-formed baseline (never crashes; caller decides how to treat it). */
export async function loadPartnerBaseline(): Promise<StoredPartnerBaseline | null> {
  const { data, error } = await supabase.from("settings").select("value").eq("key", BASELINE_KEY).maybeSingle();
  if (error) throw new Error(error.message);
  const value = data?.value as Partial<StoredPartnerBaseline> | undefined;
  if (!value || typeof value !== "object" || !value.schemaVersion || !value.snapshot || !value.savedAt) return null;
  return value as StoredPartnerBaseline;
}

/** Replaces the single baseline record. Idempotent (same key every time — never accumulates rows). */
export async function savePartnerBaseline(baseline: StoredPartnerBaseline): Promise<void> {
  const { error } = await supabase
    .from("settings")
    .upsert({ key: BASELINE_KEY, value: baseline as unknown as Record<string, unknown> }, { onConflict: "key" });
  if (error) throw new Error(error.message);
}
