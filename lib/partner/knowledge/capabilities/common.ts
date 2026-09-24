/**
 * Redbloods Partner — knowledge capability helpers. Pure. Small builders only — never business rules
 * (those live in the domain modules the capabilities read: Eyes, Finance Brain, Memory, Integrity, Cases).
 */
import { ok, partner, partnerRecord, record } from "../../gateway/core";
import { splitArtistNames } from "../../dossiers/relations";
import { normalizeName } from "../../gateway/resolve";
import type { GText, GatewayEpistemic, GatewayFreshness, GatewaySourceName, GatewayMissing } from "../../gateway/types";
import type { KnowledgeFact, KnowledgeItem, KnowledgeReadResult, KnowledgeSources } from "../types";

export { ok, partner, partnerRecord, record, splitArtistNames, normalizeName };

export const item = (o: { id: string; entity?: string | null; label: GText; epistemic: GatewayEpistemic; source: GatewaySourceName; freshness?: GatewayFreshness; relationQuality?: KnowledgeItem["relationQuality"]; fields: Record<string, unknown> }): KnowledgeItem =>
  ({ id: o.id, entity: o.entity ?? null, label: o.label, epistemic: o.epistemic, freshness: o.freshness ?? "LIVE", source: o.source, ...(o.relationQuality ? { relationQuality: o.relationQuality } : {}), fields: o.fields });

export const sfact = (code: string, labelHe: string, value: unknown, epistemic: GatewayEpistemic, source: GatewaySourceName, freshness: GatewayFreshness = "LIVE"): KnowledgeFact =>
  ({ code, label: partner(labelHe), value, epistemic, freshness, source });

export const result = (items: KnowledgeItem[], o: { summary?: KnowledgeFact[]; completeness?: KnowledgeReadResult["completeness"]; coverage?: GText[]; missing?: GatewayMissing[] } = {}): KnowledgeReadResult =>
  ({ items, summary: o.summary ?? [], completeness: o.completeness ?? "COMPLETE", coverage: o.coverage ?? [], missing: o.missing ?? [] });

export const unavailable = (what: string): KnowledgeReadResult =>
  ({ items: [], summary: [], completeness: "UNKNOWN", coverage: [], missing: [{ fact: what, whyNeeded: "the source could not be read — nothing here means \"none\"" }] });

export const byCount = (xs: readonly string[]): Record<string, number> => {
  const m: Record<string, number> = {};
  for (const x of xs) m[x] = (m[x] ?? 0) + 1;
  return Object.fromEntries(Object.entries(m).sort(([a], [b]) => a.localeCompare(b)));
};

export const idOf = (key: string) => key.slice(key.indexOf(":") + 1);
export const state = (src: KnowledgeSources) => ok(src.state);
export const clientName = (src: KnowledgeSources, id: string | null) => (id ? state(src)?.domains.clients.data?.items.find((c) => c.id === id)?.name ?? null : null);
export const projectName = (src: KnowledgeSources, id: string | null) => (id ? state(src)?.domains.projects.data?.index[id]?.name ?? null : null);
export const labelArtistName = (src: KnowledgeSources, id: string | null) => (id ? state(src)?.domains.labelArtists.data?.items.find((a) => a.id === id)?.name ?? null : null);

/** Does free text name this artist? TEXT_MATCH only (exact token, or normalized token). */
export function textMentions(text: string | null | undefined, name: string): boolean {
  const want = normalizeName(name);
  return splitArtistNames(text ?? "").some((t) => t === name || normalizeName(t) === want);
}

export const CLOSED_PROJECT = new Set(["הושלם", "בוטל"]);
