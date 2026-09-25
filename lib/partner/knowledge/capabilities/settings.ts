/**
 * Sunny knowledge — SYSTEM SETTINGS: every registered settings family (lib/partner/system/settings.ts) with its
 * meaning and class, and the live values of the non-secret ones. Owner-only. Authentication secrets are listed as
 * "exists (secret — never read)" and never queried. Project-linked families are served in project_view.
 */
import { SETTINGS_FAMILIES } from "../../system/settings";
import type { SettingsState } from "../../settings/types";
import type { KnowledgeCapability } from "../types";
import { byCount, item, partner, record, result, sfact, unavailable } from "./common";

const READABLE = SETTINGS_FAMILIES.filter((f) => f.read === "SYSTEM_SETTINGS");
const MAX_VALUE_CHARS = 3000;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const bounded = (v: unknown) => { const j = JSON.stringify(v ?? null); return j.length <= MAX_VALUE_CHARS ? { value: v, truncated: false } : { value: j.slice(0, MAX_VALUE_CHARS), truncated: true, sizeChars: j.length }; };
const served = (f: (typeof SETTINGS_FAMILIES)[number]) => ({ family: f.id, class: f.class, domain: f.domain, meaning: f.meaning, writtenBy: f.writtenBy, readBy: f.read, link: f.link });

export const systemSettings: KnowledgeCapability = {
  id: "system_settings", domain: "COMPANY", titleHe: "הגדרות ומצב מערכת",
  descriptionForModel: "Everything Redbloods keeps in its settings store, by family: mode families = every family with its meaning, class (A business / system information, B authentication secret — never read, C internal state with meaning, D display detail), where Sunny reads it and how many entries exist; mode values (param family) = the live non-secret values (Victor salary config / overrides / legacy months, artist balance-cycle anchors, report schedule, maintenance mode, goals, artist availability, push sent-markers and pending batches, portal presence, Sunny's change baseline, old AI budget). Project-linked families (price, delivery, session limit, cover, album info, Steven final-files requests) are served per project in project_view.",
  examplesHe: ["מה מוגדר במשכורת של ויקטור?", "מתי שליו נכנס לפורטל לאחרונה?", "האם נשלחה תזכורת סשן לשליו?", "מה לוח הזמנים של הדוח השבועי?", "האם האפליקציה במצב תחזוקה?", "איזה הגדרות יש במערכת?"],
  modes: { families: { descriptionForModel: "Every settings family + class + meaning (+ entry counts)" }, values: { descriptionForModel: "Live values of one non-secret family (param family)" } },
  defaultMode: "families",
  params: { family: { kind: "enum", values: READABLE.map((f) => f.id), descriptionForModel: "A readable settings family id (see mode families)" } },
  paging: { defaultLimit: 25, maxLimit: 50 }, recordTextLimit: 3000,
  access: { externalRead: true, ownerOnly: true, sensitivity: "FINANCIAL" }, needs: ["SETTINGS"],
  read(src, q) {
    const st = src.settings && src.settings.status === "OK" ? (src.settings as { value: SettingsState }).value : null;
    if (q.mode === "values") {
      if (!q.params.family) return result([], { completeness: "UNKNOWN", missing: [{ fact: "family", whyNeeded: "pass params.family (see mode families)" }] });
      if (!st) return unavailable("settings");
      const f = READABLE.find((x) => x.id === q.params.family)!;
      const sec = st.families[f.id];
      if (!sec) return unavailable("settings");
      const rows = [...sec.rows].sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
      return result(rows.map((r) => { const id = UUID.exec(r.key)?.[0] ?? null; return item({ id: r.key, entity: f.link === "SHOW" && id ? `show:${id}` : null, label: record(r.key), epistemic: f.class === "C_INTERNAL_STATE_WITH_MEANING" ? "OBSERVATION" : "FACT", source: "SETTINGS", fields: { family: f.id, updatedAt: r.updatedAt, ...bounded(r.value) } }); }),
        { summary: [sfact("FAMILY", "משפחה", f.id, "FACT", "SETTINGS"), sfact("MEANING", "משמעות", f.meaning, "FACT", "SETTINGS")], completeness: sec.capped ? "PARTIAL" : "COMPLETE",
          coverage: [partner("ערכים שאינם סודות בלבד; קישורים / אסימונים בתוך הערך הומרו ל-has_*.")] });
    }
    return result(SETTINGS_FAMILIES.map((f) => {
      const sec = st?.families[f.id];
      const entries = f.read === "SYSTEM_SETTINGS" ? (sec ? sec.rows.length : null) : null;
      const lastUpdated = sec?.rows.map((r) => r.updatedAt ?? "").sort().at(-1) || null;
      return item({ id: f.id, label: partner(f.meaning), epistemic: "FACT", source: "SYSTEM_CONTRACTS", fields: { ...served(f), entries, lastUpdated, secret: f.class === "B_AUTHENTICATION_SECRET" } });
    }), {
      summary: [sfact("BY_CLASS", "משפחות לפי סיווג", byCount(SETTINGS_FAMILIES.map((f) => f.class)), "FACT", "SYSTEM_CONTRACTS"), sfact("BY_READ", "איפה סאני קורא", byCount(SETTINGS_FAMILIES.map((f) => f.read)), "FACT", "SYSTEM_CONTRACTS")],
      completeness: st ? "COMPLETE" : "PARTIAL",
      coverage: [partner("סודות (אסימוני Google / Dropbox, אסימוני שיתוף) לא נקראים בכלל — רק העובדה שהם קיימים."), partner("משפחות שקשורות לפרויקט מוצגות ב-project_view.")],
    });
  },
};
