/**
 * Sunny — SETTINGS read source. NOT a generic settings reader: it queries ONLY the families registered as readable
 * (A business / system information, C internal state with meaning) in lib/partner/system/settings.ts, one bounded
 * prefix / exact-key query per family, and keeps a row only if its key really belongs to that family (LIKE wildcards
 * never widen the read). Authentication-secret families (B) have no query and are never touched. Values are
 * deep-scrubbed (link / token keys → booleans, bearer text redacted). SELECT only; each family fails closed to null.
 */
import { readSection, type OperationsReadClient, type OpsQuery } from "../operations/readers";
import { scrubValue } from "../projects/detail-reader";
import { SETTINGS_FAMILIES, familyOfKey } from "../system/settings";
import type { SettingsState } from "./types";

export const SETTINGS_READ_FAMILIES = SETTINGS_FAMILIES.filter((f) => f.read === "SYSTEM_SETTINGS" && f.internal.query);

export async function readSettingsState(client: OperationsReadClient): Promise<SettingsState> {
  const sections = await Promise.all(SETTINGS_READ_FAMILIES.map((f) => {
    const q = f.internal.query!;
    const filter = (x: OpsQuery) => ("in" in q ? x.in("key", q.in) : x.like("key", q.like.includes("%") ? q.like : `${q.like}%`));
    return readSection(client, "settings", "key, value, updated_at", filter);
  }));
  const families: SettingsState["families"] = {};
  SETTINGS_READ_FAMILIES.forEach((f, i) => {
    const sec = sections[i];
    families[f.id] = sec ? {
      rows: sec.rows.filter((r) => typeof r.key === "string" && familyOfKey(r.key)?.id === f.id)
        .map((r) => ({ key: String(r.key), updatedAt: typeof r.updated_at === "string" ? r.updated_at : null, value: scrubValue(r.value) })),
      capped: sec.capped,
    } : null;
  });
  return { families };
}
