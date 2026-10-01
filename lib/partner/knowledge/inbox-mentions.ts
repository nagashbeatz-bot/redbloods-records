/**
 * "עדכון לסאני" ↔ company entities — which entities an Owner update's free text NAMES. Pure, deterministic, read-time
 * only (never stored, never canonical). Owner rules (2026-09-30):
 *   - whole words only, after the resolver's deterministic normalization (lib/partner/gateway/resolve normalizeName);
 *     a Hebrew name may carry ONE attached prefix letter (ו ה ב ל מ ש כ) — "לשליו" names "שליו" — nothing else;
 *   - a short name (< 3 letters) or a generic word ("שיר", "אלבום", "עכשיו", "test" …) → AMBIGUOUS, never linked;
 *   - one name that fits several different entities (different identity groups) → AMBIGUOUS, never linked;
 *   - the SAME identity in several roles (a client + a label artist with the exact same name) stays ONE TEXT_MATCH.
 * The names come ONLY from partner_resolve's own index (canonical records + the app's own HIGH display names).
 * Quality is TEXT_MATCH at best: a name in the text is evidence of a mention, not proof of a link.
 */
import { buildResolveIndex, KNOWN_DISPLAY_NAMES, normalizeName } from "../gateway/resolve";
import type { GatewaySources } from "../gateway/core";
import type { GatewayEntityType } from "../gateway/types";

export type MentionQuality = "TEXT_MATCH" | "AMBIGUOUS";
export type AmbiguousReason = "SHORT_OR_GENERIC_NAME" | "SEVERAL_ENTITIES" | "PARTIAL_NAME";
export interface InboxMention {
  name: string;
  quality: MentionQuality;
  /** TEXT_MATCH: the one identity's keys (several only for the same identity in several roles). AMBIGUOUS: every candidate. */
  keys: string[];
  types: GatewayEntityType[];
  reason?: AmbiguousReason;
}
export interface MentionEntry { key: string; type: GatewayEntityType; name: string; norm: string; group: string }

/** Words that are also names of records in the company but mean something generic in an update — never linked. */
export const GENERIC_NAME_WORDS: ReadonlySet<string> = new Set([
  "שיר", "שירים", "אלבום", "סינגל", "ep", "קליפ", "הופעה", "סשן", "חזרה", "פרויקט", "לקוח", "אמן", "מיקס", "מאסטר", "דמו", "רמיקס", "ביט",
  "חדש", "חדשה", "ישן", "היום", "מחר", "עכשיו", "אתמול", "כלום", "בלי", "שם", "עוד", "הכל", "טוב", "אהבה", "לילה", "בית", "אמא", "אבא",
  "test", "demo", "new", "untitled", "song", "album", "single", "mix", "master", "remix", "intro", "outro", "love", "home",
]);
const HE_PREFIXES = new Set(["ו", "ה", "ב", "ל", "מ", "ש", "כ"]);
const HEBREW = /^[א-ת]/;
const letters = (s: string) => s.replace(/[^\p{L}\p{N}]/gu, "").length;

/** Short / generic → never a link on its own. */
export function isWeakName(norm: string): boolean {
  const toks = norm.split(" ").filter(Boolean);
  if (letters(norm) < 3) return true;
  return toks.length === 1 && GENERIC_NAME_WORDS.has(toks[0]);
}

/** Does the normalized text contain the name's tokens as whole words (the first token may carry ONE Hebrew prefix)? */
export function containsWholeName(textTokens: readonly string[], nameTokens: readonly string[]): boolean {
  if (!nameTokens.length || nameTokens.length > textTokens.length) return false;
  for (let i = 0; i + nameTokens.length <= textTokens.length; i++) {
    let okRun = true;
    for (let j = 0; j < nameTokens.length && okRun; j++) {
      const t = textTokens[i + j], n = nameTokens[j];
      if (t === n) continue;
      const prefixed = j === 0 && HEBREW.test(n) && n.length >= 3 && t.length === n.length + 1 && HE_PREFIXES.has(t[0]) && t.slice(1) === n;
      if (!prefixed) okRun = false;
    }
    if (okRun) return true;
  }
  return false;
}

/** The name index, from partner_resolve's own index + the app's own HIGH-confidence display names (e.g. ויקטור). */
export function buildMentionIndex(src: GatewaySources): MentionEntry[] {
  const idx = buildResolveIndex(src);
  const out: MentionEntry[] = idx.map((e) => ({ key: e.key, type: e.type, name: e.name, norm: e.norm, group: e.group.id }));
  for (const d of KNOWN_DISPLAY_NAMES) {
    if (d.confidence !== "HIGH") continue;
    const target = d.target === "VICTOR" ? idx.find((e) => e.key === "vendor:VICTOR") : d.target === "STEVEN" ? idx.find((e) => e.key === "vendor:STEVEN") : idx.find((e) => e.group.id === "app:cleantone" && e.type === "dj");
    if (target) out.push({ key: target.key, type: target.type, name: d.name, norm: normalizeName(d.name), group: target.group.id });
  }
  return out.filter((e) => e.norm);
}

/** Every entity name the text contains as whole words, grouped by the normalized name. */
export function findMentions(text: string, index: readonly MentionEntry[]): InboxMention[] {
  const tt = normalizeName(text).split(" ").filter(Boolean);
  const byName = new Map<string, MentionEntry[]>();
  for (const e of index) {
    if (!containsWholeName(tt, e.norm.split(" "))) continue;
    byName.set(e.norm, [...(byName.get(e.norm) ?? []), e]);
  }
  const out: InboxMention[] = [];
  for (const [norm, es] of byName) {
    const keys = [...new Set(es.map((e) => e.key))].sort();
    const types = [...new Set(es.map((e) => e.type))];
    const groups = new Set(es.map((e) => e.group));
    if (isWeakName(norm)) out.push({ name: es[0].name, quality: "AMBIGUOUS", keys, types, reason: "SHORT_OR_GENERIC_NAME" });
    else if (groups.size > 1) out.push({ name: es[0].name, quality: "AMBIGUOUS", keys, types, reason: "SEVERAL_ENTITIES" });
    else out.push({ name: es[0].name, quality: "TEXT_MATCH", keys, types });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, "he") || a.keys[0].localeCompare(b.keys[0]));
}

/** Does the text name THIS entity (TEXT_MATCH only — an AMBIGUOUS mention never counts)? */
export function mentionsEntity(mentions: readonly InboxMention[], key: string): boolean {
  return mentions.some((m) => m.quality === "TEXT_MATCH" && m.keys.includes(key));
}

/**
 * PARTIAL names (Owner reality 2026-10-01: he writes first names — "שליו", "מאור", "חיים"). A word of the text (one
 * Hebrew prefix letter allowed) that equals ONE token of a multi-word record name is a PARTIAL_NAME mention — always
 * AMBIGUOUS (a candidate list to propose and confirm, never a link and never a fact). Names already matched whole are
 * skipped; short / generic words never count. `persons` = the non-project identity groups behind it (one = likely one person).
 */
export interface PartialMention extends InboxMention { persons: string[] }
export function findPartialMentions(text: string, index: readonly MentionEntry[], covered: ReadonlySet<string> = new Set()): PartialMention[] {
  const words = [...new Set(normalizeName(text).split(" ").filter(Boolean))];
  const out: PartialMention[] = [];
  for (const w of words) {
    const forms = [w, ...(HEBREW.test(w) && w.length >= 4 && HE_PREFIXES.has(w[0]) ? [w.slice(1)] : [])];
    for (const f of forms) {
      if (isWeakName(f)) continue;
      const es = index.filter((e) => !covered.has(e.norm) && e.norm.includes(" ") && e.norm.split(" ").includes(f));
      if (!es.length) continue;
      const keys = [...new Set(es.map((e) => e.key))].sort();
      out.push({ name: f, quality: "AMBIGUOUS", keys, types: [...new Set(es.map((e) => e.type))], reason: "PARTIAL_NAME", persons: [...new Set(es.filter((e) => e.type !== "project").map((e) => e.group))].sort() });
      break;
    }
  }
  const seen = new Set<string>();
  return out.filter((m) => (seen.has(m.name) ? false : (seen.add(m.name), true))).sort((a, b) => a.name.localeCompare(b.name, "he"));
}
