/**
 * Redbloods Partner — Gateway V1: entity resolver (partner_resolve). Pure, deterministic.
 *
 * Natural Owner wording → ranked candidate entities, from canonical names only (projects, clients, label
 * artists, shows, the two team vendors, and DJs as they appear on shows). No fuzzy guessing, no aliases
 * table (none exists): deterministic normalization + exact / whole-token / contains matching, plus the
 * few display names the application itself already uses in code (KNOWN_DISPLAY_NAMES).
 *
 * Never silently picks: several different candidates at the best confidence → AMBIGUOUS, and the caller
 * asks the Owner. The same person in several roles (e.g. a client record and a label-artist record with
 * the same exact name) → MULTI_ROLE, every role returned.
 */
import type { ClientSummary, LabelArtistSummary, ShowSummary } from "../eyes/types";
import { envelope, ok, partner, partnerRecord, record, heDate, type GatewaySources } from "./core";
import {
  GATEWAY_LIMITS,
  type GatewayEntityType, type ResolveCandidate, type ResolveConfidence, type ResolveMatchReason, type ResolveResponse, type ResolveStatus,
} from "./types";

/** Deterministic normalization: Unicode NFKC, case, Hebrew points, geresh / quote variants, punctuation, whitespace. */
export function normalizeName(s: string): string {
  return s.normalize("NFKC").toLowerCase()
    .replace(/[֑-ׇ]/g, "")
    .replace(/[׳`‘’]/g, "'")
    .replace(/[״“”]/g, "\"")
    .replace(/[^\p{L}\p{N}'"]+/gu, " ")
    .trim().replace(/\s+/g, " ");
}
const tokens = (s: string) => (s ? s.split(" ") : []);
function containsTokenRun(name: string[], q: string[]): boolean {
  if (!q.length || q.length > name.length) return false;
  for (let i = 0; i + q.length <= name.length; i++) if (q.every((t, j) => name[i + j] === t)) return true;
  return false;
}

/**
 * Display names the application already uses for an entity (never invented business data):
 *   Victor / ויקטור — the team vendor as the app names him in English and Hebrew;
 *   Steven — the team vendor's app name; סטיבן is its Hebrew transliteration (MEDIUM, not in the app);
 *   קלינטון — the app's own greeting for DJ CLEANTONE (components/red-artists portal); Cleantone / Clinton
 *   are his artist name's token and its English transliteration (MEDIUM for the transliteration).
 * Persisted per-Owner aliases do not exist — reported as a future gap.
 */
export const KNOWN_DISPLAY_NAMES: ReadonlyArray<{ name: string; target: "VICTOR" | "STEVEN" | "CLEANTONE"; confidence: ResolveConfidence }> = [
  { name: "victor", target: "VICTOR", confidence: "HIGH" },
  { name: "ויקטור", target: "VICTOR", confidence: "HIGH" },
  { name: "steven", target: "STEVEN", confidence: "HIGH" },
  { name: "סטיבן", target: "STEVEN", confidence: "MEDIUM" },
  { name: "קלינטון", target: "CLEANTONE", confidence: "HIGH" },
  { name: "cleantone", target: "CLEANTONE", confidence: "HIGH" },
  { name: "clinton", target: "CLEANTONE", confidence: "MEDIUM" },
];

interface IndexEntry { key: string; type: GatewayEntityType; name: string; norm: string; group: ResolveCandidate["identityGroup"]; detail: string | null; detailTrust: "PARTNER" | "PARTNER_RECORD" }

const TYPE_ORDER: GatewayEntityType[] = ["vendor", "dj", "label-artist", "client", "project", "show", "release", "session", "recurring"];
const CONF_ORDER: ResolveConfidence[] = ["HIGH", "MEDIUM", "LOW"];

/** The resolvable name index, built once per request from the shared Eyes state. */
export function buildResolveIndex(src: GatewaySources): IndexEntry[] {
  const state = ok(src.state);
  const out: IndexEntry[] = [
    { key: "vendor:VICTOR", type: "vendor", name: "Victor", norm: "victor", group: { id: "vendor:VICTOR", basis: "SINGLE" }, detail: "איש צוות — עבודות ומשכורת", detailTrust: "PARTNER" },
    { key: "vendor:STEVEN", type: "vendor", name: "Steven", norm: "steven", group: { id: "vendor:STEVEN", basis: "SINGLE" }, detail: "טכנאי סאונד — עבודות", detailTrust: "PARTNER" },
  ];
  if (!state) return out;
  const clients: ClientSummary[] = state.domains.clients.data?.items ?? [];
  const artists: LabelArtistSummary[] = state.domains.labelArtists.data?.items ?? [];
  const shows: ShowSummary[] = state.domains.shows.data?.items ?? [];
  const cleantone = src.identities.cleantone;
  const artistNames = new Map(artists.map((a) => [normalizeName(a.name), a]));
  const djIds = new Set(shows.map((s) => s.djClientId).filter((x): x is string => !!x));

  const groupForClient = (c: ClientSummary): ResolveCandidate["identityGroup"] => {
    if (cleantone && c.id === cleantone.clientId) return { id: "app:cleantone", basis: "APP_CANONICAL_LINK" };
    if (artistNames.has(normalizeName(c.name))) return { id: `name:${normalizeName(c.name)}`, basis: "SAME_EXACT_NAME" };
    return { id: `client:${c.id}`, basis: djIds.has(c.id) ? "SAME_RECORD" : "SINGLE" };
  };
  for (const c of clients) {
    const g = groupForClient(c);
    out.push({ key: `client:${c.id}`, type: "client", name: c.name, norm: normalizeName(c.name), group: g, detail: `${c.type} · ${c.status}`, detailTrust: "PARTNER_RECORD" });
    if (djIds.has(c.id)) {
      const n = shows.filter((s) => s.djClientId === c.id).length;
      out.push({ key: `dj:${c.id}`, type: "dj", name: c.name, norm: normalizeName(c.name), group: g, detail: `DJ ב־${n} הופעות`, detailTrust: "PARTNER" });
    }
  }
  for (const a of artists) {
    const isCleantone = !!cleantone && a.name === cleantone.labelArtistName;
    const clientSameName = clients.some((c) => normalizeName(c.name) === normalizeName(a.name));
    const g: ResolveCandidate["identityGroup"] = isCleantone ? { id: "app:cleantone", basis: "APP_CANONICAL_LINK" }
      : clientSameName ? { id: `name:${normalizeName(a.name)}`, basis: "SAME_EXACT_NAME" } : { id: `label-artist:${a.id}`, basis: "SINGLE" };
    out.push({ key: `label-artist:${a.id}`, type: "label-artist", name: a.name, norm: normalizeName(a.name), group: g, detail: `אמן לייבל · ${a.status}`, detailTrust: "PARTNER_RECORD" });
  }
  for (const [id, p] of Object.entries(state.domains.projects.data?.index ?? {})) {
    out.push({ key: `project:${id}`, type: "project", name: p.name, norm: normalizeName(p.name), group: { id: `project:${id}`, basis: "SINGLE" }, detail: `פרויקט · ${p.status} · ${p.artistText}`, detailTrust: "PARTNER_RECORD" });
  }
  for (const s of shows) {
    out.push({ key: `show:${s.id}`, type: "show", name: s.name, norm: normalizeName(s.name), group: { id: `show:${s.id}`, basis: "SINGLE" }, detail: `הופעה · ${heDate(s.dateYmd) ?? "ללא תאריך"} · ${s.status}`, detailTrust: "PARTNER_RECORD" });
  }
  return out;
}

const cand = (e: IndexEntry, confidence: ResolveConfidence, matchReason: ResolveMatchReason, detail?: string): ResolveCandidate => ({
  key: e.key, type: e.type, label: record(e.name), confidence, matchReason, identityGroup: e.group,
  detail: detail ? partnerRecord(detail) : e.detail ? { text: e.detail, trust: e.detailTrust } : null,
});

function matchName(index: IndexEntry[], q: string): ResolveCandidate[] {
  const qt = tokens(q);
  const best = new Map<string, ResolveCandidate>();
  const put = (c: ResolveCandidate) => {
    const prev = best.get(c.key);
    if (!prev || CONF_ORDER.indexOf(c.confidence) < CONF_ORDER.indexOf(prev.confidence)) best.set(c.key, c);
  };
  for (const e of index) {
    if (e.norm === q) put(cand(e, "HIGH", "EXACT_NAME"));
    else if (containsTokenRun(tokens(e.norm), qt)) put(cand(e, "MEDIUM", "NAME_TOKEN"));
    else if (q.length >= 3 && e.norm.includes(q)) put(cand(e, "LOW", "NAME_CONTAINS"));
  }
  for (const k of KNOWN_DISPLAY_NAMES) {
    if (normalizeName(k.name) !== q) continue;
    const targets = k.target === "VICTOR" ? index.filter((e) => e.key === "vendor:VICTOR")
      : k.target === "STEVEN" ? index.filter((e) => e.key === "vendor:STEVEN")
      : index.filter((e) => e.group.id === "app:cleantone" && (e.type === "dj" || e.type === "label-artist"));
    for (const e of targets) put(cand(e, k.confidence, "KNOWN_DISPLAY_NAME"));
  }
  return [...best.values()];
}

const SHOW_OF = /^(?:ה)?(?:הופעה|הופעות|show|shows)\s+(?:של\s+|of\s+)?(.+)$/;

function matchShowOf(index: IndexEntry[], who: string, src: GatewaySources): ResolveCandidate[] {
  const state = ok(src.state);
  if (!state) return [];
  const people = matchName(index, who).filter((c) => c.type === "client" || c.type === "dj" || c.type === "label-artist");
  if (!people.length) return [];
  const topConf = CONF_ORDER.find((c) => people.some((p) => p.confidence === c))!;
  const top = people.filter((p) => p.confidence === topConf);
  const clients = state.domains.clients.data?.items ?? [];
  const personClientIds = new Map<string, string>(); // clientId → the person's label
  for (const p of top) {
    const id = p.key.split(":")[1];
    if (p.type === "client" || p.type === "dj") personClientIds.set(id, p.label.text);
    if (p.type === "label-artist") {
      // label artist → client only through the exact same name (TEXT_MATCH) or the app's canonical link
      const via = clients.filter((c) => normalizeName(c.name) === normalizeName(p.label.text) || (p.identityGroup.basis === "APP_CANONICAL_LINK" && src.identities.cleantone?.clientId === c.id));
      for (const c of via) personClientIds.set(c.id, p.label.text);
    }
  }
  const shows = (state.domains.shows.data?.items ?? []).filter((s) => (s.artistClientId && personClientIds.has(s.artistClientId)) || (s.djClientId && personClientIds.has(s.djClientId)));
  return shows
    .sort((a, b) => (b.dateYmd ?? "").localeCompare(a.dateYmd ?? "") || a.id.localeCompare(b.id))
    .map((s) => {
      const e = index.find((x) => x.key === `show:${s.id}`)!;
      const who = personClientIds.get(s.artistClientId ?? "") ?? personClientIds.get(s.djClientId ?? "") ?? "";
      const role = s.artistClientId && personClientIds.has(s.artistClientId) ? "אמן" : "DJ";
      return cand(e, "MEDIUM", "SHOW_OF_ARTIST", `הופעה · ${heDate(s.dateYmd) ?? "ללא תאריך"} · ${s.status} · ${role}: ${who}`);
    });
}

function rank(cs: ResolveCandidate[]): ResolveCandidate[] {
  return [...cs].sort((a, b) =>
    CONF_ORDER.indexOf(a.confidence) - CONF_ORDER.indexOf(b.confidence)
    || (a.matchReason === "SHOW_OF_ARTIST" && b.matchReason === "SHOW_OF_ARTIST" ? 0 : TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type))
    || (a.matchReason === "SHOW_OF_ARTIST" ? 0 : a.label.text.localeCompare(b.label.text))
    || (a.matchReason === "SHOW_OF_ARTIST" ? 0 : a.key.localeCompare(b.key)));
}

export function statusOf(cs: readonly ResolveCandidate[]): ResolveStatus {
  if (!cs.length) return "NOT_FOUND";
  const top = cs.filter((c) => c.confidence === cs[0].confidence);
  if (top.length === 1) return "RESOLVED";
  return new Set(top.map((c) => c.identityGroup.id)).size === 1 ? "MULTI_ROLE" : "AMBIGUOUS";
}

export function resolvePartnerEntityCore(query: string, src: GatewaySources): ResolveResponse {
  const q = normalizeName(query ?? "");
  const env = envelope("partner_resolve", { query: query ?? "" }, src, [["PROJECTS", src.state], ["APP_IDENTITY", { status: "OK", value: null }]]);
  const index = buildResolveIndex(src);
  const showOf = SHOW_OF.exec(q);
  let all = q ? (showOf ? matchShowOf(index, showOf[1].trim(), src) : []) : [];
  if (q && !all.length) all = matchName(index, q);
  const ranked = rank(all);
  const candidates = ranked.slice(0, GATEWAY_LIMITS.resolveCandidates);
  const status = statusOf(candidates);
  const missing = status === "NOT_FOUND"
    ? [{ fact: `entity named "${(query ?? "").slice(0, 60)}"`, whyNeeded: "no canonical project, client, label artist, show, DJ or team member name matches; persisted nicknames do not exist yet" }]
    : [];
  if (!ok(src.state)) missing.push({ fact: "company state", whyNeeded: "names could not be read; only the team vendors are resolvable right now" });
  return {
    ...env, status, candidates, truncated: Math.max(0, ranked.length - candidates.length), missing,
    drillDown: candidates.map((c) => ({ tool: "partner_entity" as const, args: { key: c.key }, label: partner(`פתח: ${c.type}`) })),
  };
}
