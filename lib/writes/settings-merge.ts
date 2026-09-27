/**
 * Safe merge of one settings JSON value — compare-and-swap, never a blind read-modify-write.
 *
 * Why: several writers merge fields into the same `finance_<projectId>` blob (agreed price, clip price,
 * clip production id, notes …). A plain `read → upsert({ ...existing, ...patch })` loses a concurrent
 * writer's field. This helper:
 *   1. reads the current value;
 *   2. missing row → INSERT the patch (a unique-key conflict, Postgres 23505, means another writer
 *      created it first → retry);
 *   3. existing row → UPDATE … WHERE key = key AND value = <the value we read> and checks that exactly
 *      one row changed; 0 rows = someone changed it meanwhile → re-read and retry.
 * After `retries` lost races it throws (the caller surfaces the error; nothing is half-written).
 *
 * Finance single truth / integrity fix (Owner-approved, 2026-09-27). Server-only (it writes the DB).
 */

export type SettingsValue = Record<string, unknown>;
export type SettingsPatch = SettingsValue | ((existing: SettingsValue) => SettingsValue);

/** The minimal Supabase surface the merge needs (lets the tests run it on a fake). */
export interface SettingsMergeClient {
  from(table: "settings"): {
    select(cols: string): { eq(col: string, v: string): { maybeSingle(): PromiseLike<{ data: { value: unknown } | null; error: { message: string } | null }> } };
    insert(row: { key: string; value: SettingsValue }): PromiseLike<{ error: { code?: string; message: string } | null }>;
    update(row: { value: SettingsValue; updated_at?: string }): {
      eq(col: string, v: string): { eq(col: string, v: string): { select(cols: string): PromiseLike<{ data: unknown[] | null; error: { message: string } | null }> } };
    };
  };
}

export class SettingsMergeConflictError extends Error {
  constructor(key: string, attempts: number) { super(`settings ${key}: concurrent update — gave up after ${attempts} attempts`); this.name = "SettingsMergeConflictError"; }
}

const asObject = (v: unknown): SettingsValue => (v && typeof v === "object" && !Array.isArray(v) ? (v as SettingsValue) : {});

/**
 * Merge `patch` into settings[`key`] with compare-and-swap + retry. Returns the value written.
 * `client` is injectable for tests; production uses the server Supabase client.
 */
export async function mergeSettingsKey(key: string, patch: SettingsPatch, retries = 3, client?: SettingsMergeClient): Promise<SettingsValue> {
  const db: SettingsMergeClient = client ?? ((await import("@/lib/supabase")).supabase as unknown as SettingsMergeClient);
  const attempts = Math.max(1, retries);
  for (let i = 0; i < attempts; i++) {
    const { data, error } = await db.from("settings").select("value").eq("key", key).maybeSingle();
    if (error) throw new Error(error.message);
    const existing = asObject(data?.value);
    const next = typeof patch === "function" ? patch(existing) : { ...existing, ...patch };
    if (!data) {
      const ins = await db.from("settings").insert({ key, value: next });
      if (!ins.error) return next;
      if (ins.error.code === "23505") continue; // another writer created the row first → re-read and merge again
      throw new Error(ins.error.message);
    }
    const upd = await db.from("settings").update({ value: next, updated_at: new Date().toISOString() }).eq("key", key).eq("value", JSON.stringify(data.value)).select("key");
    if (upd.error) throw new Error(upd.error.message);
    if ((upd.data ?? []).length === 1) return next;
    // 0 rows: the value changed since we read it → retry from a fresh read
  }
  throw new SettingsMergeConflictError(key, attempts);
}
