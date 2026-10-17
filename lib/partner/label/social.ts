/**
 * Artist social — stage 0 (Owner approval 2026-10-17): identity + inspirations + tracking for EACH label artist. Pure (no DB,
 * no IO, no clock of its own). It CONNECTS what already exists, it copies nothing:
 *
 *   accounts      Sunny Brain resources (sunny_resources) — what is tracked
 *   whose account Owner knowledge ENTITY_RELATIONSHIP OWNS_RESOURCE (subject label-artist:<id>, or the company for a shared
 *                 label channel) — the ONE ownership source; only what the Owner approved (OWNER_CONFIRMED_RELATION)
 *   inspirations  Owner knowledge ENTITY_RELATIONSHIP INSPIRATION_SOURCE (label artist → account, + what we learn)
 *   measurements  the existing research series (lib/partner/brain/research.ts) — last check, change since the previous one,
 *                 TODAY / EARLIER with the date and age; an old reading is never "now"
 *   insights      Brain intel records — tied to the artist when they name the artist (entity key) or rest on the artist's accounts (DERIVED)
 *
 * Rules: a shared label channel (owner = the company, e.g. Redbloods Records) is never counted as an artist's own presence —
 * it is served apart (`labelChannels`, shared: true). An account nobody owns is listed as unassigned (a gap), never guessed
 * from a name or handle. Nothing here writes, schedules, pushes or browses; a recheck is only a PROPOSAL for the Owner.
 */
import { brainState, type BrainRecord, type BrainResource, type BrainSnapshot } from "../brain/model";
import { recheckProposals, researchSeries, type RecheckProposal, type ResearchContext, type ResearchSeries } from "../brain/research";
import { STATUS_HE } from "../brain/vocab";
import { activeKnowledge, type OwnerKnowledgeRecord } from "../owner-knowledge/store";
import { CLASSIFICATION_VALUE_HE } from "../owner-knowledge/taxonomy";

export const COMPANY_OWNER_KEY = "company:REDBLOODS";
const LIVE_RECORD = new Set(["OPEN", "ENDORSED", "ACCEPTED"]);
const DAY = 86_400_000;
const ilYmd = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
const heDate = (ymd: string) => `${ymd.slice(8, 10)}.${ymd.slice(5, 7)}.${ymd.slice(0, 4)}`;

/** The ONE wording of how fresh a reading is (point 3: every number has its date; old is never "now"). */
export function freshnessHeOf(observedAt: string, todayIL: string, now: Date): { freshness: "TODAY" | "EARLIER"; checkedOn: string; ageDays: number; freshnessHe: string } {
  const checkedOn = ilYmd(observedAt);
  const ageDays = Math.max(0, Math.floor((now.getTime() - Date.parse(observedAt)) / DAY));
  const today = checkedOn === todayIL;
  return { freshness: today ? "TODAY" : "EARLIER", checkedOn, ageDays, freshnessHe: today ? `נבדק היום (${heDate(checkedOn)})` : `נבדק ב-${heDate(checkedOn)}, לפני ${ageDays} ימים — לא נתון של עכשיו` };
}

export interface SocialMetric {
  type: string; family: string; value: number | string | boolean | null; unit: string | null;
  checkedOn: string; ageDays: number; freshness: "TODAY" | "EARLIER"; freshnessHe: string;
  previous: { value: number | string | boolean | null; checkedOn: string } | null;
  change: ResearchSeries["comparison"]; points: number; sourceKind: string; confidence: string; canStoreNewCheck: boolean;
}
export interface SocialContentItem { resourceId: string; label: string; contentKind: string | null; metrics: SocialMetric[]; lastCheckedOn: string | null }
export interface SocialAccount {
  resourceId: string; platform: string; label: string;
  /** Whose account, from the Owner's approved knowledge — null for an inspiration (not ours). */
  ownership: { ownerKey: string; channelPurpose: string | null; channelPurposeHe: string | null; knowledgeId: string; approvedOn: string; relationQuality: "OWNER_CONFIRMED_RELATION" } | null;
  shared: boolean;
  metrics: SocialMetric[];
  content: { tracked: number; items: SocialContentItem[] };
  lastCheckedOn: string | null; lastCheckFreshnessHe: string | null;
}
export interface SocialInspiration extends SocialAccount { learnHe: string | null; inspirationKnowledgeId: string; approvedOn: string }
export interface SocialRecord {
  recordId: string; recordType: string; titleHe: string; status: string | null; statusHe: string | null; area: string; createdOn: string;
  /** CANONICAL = the record itself names the artist; DERIVED = it rests on one of the artist's accounts (through the Owner-approved ownership). */
  tie: "CANONICAL" | "DERIVED"; evidenceCheckedOn: string | null; evidenceFreshnessHe: string | null; alsoSharedChannel: boolean;
}
export interface ArtistSocial {
  artistKey: string; artistName: string;
  accounts: SocialAccount[];
  labelChannels: SocialAccount[];
  inspirations: SocialInspiration[];
  records: SocialRecord[];
  historyRecords: number;
  lastCheckedOn: string | null;
  recheck: RecheckProposal | null;
  unassignedAccounts: Array<{ resourceId: string; platform: string; label: string }>;
}

const labelOfResource = (r: BrainResource) => `${r.platform} ${r.displayName ?? r.firstHandle ?? r.identityKey}`.trim();
const resourceIdOf = (key: unknown) => (typeof key === "string" && key.startsWith("resource:") ? key.slice(9) : null);

/** Every CURRENT Owner-approved resource relation (ownership + inspiration), from the ONE knowledge rule (activeKnowledge). */
export function resourceRelations(records: readonly OwnerKnowledgeRecord[], todayIL: string) {
  const live = activeKnowledge(records, todayIL).filter((k) => k.kind === "ENTITY_RELATIONSHIP" && resourceIdOf(k.value.resource));
  const owners = new Map<string, OwnerKnowledgeRecord>();
  for (const k of live.filter((x) => x.value.relation === "OWNS_RESOURCE").sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    const id = resourceIdOf(k.value.resource)!;
    if (!owners.has(id)) owners.set(id, k); // the writer refuses a second current owner; the oldest wins if one slipped through
  }
  return { owners, inspirations: live.filter((x) => x.value.relation === "INSPIRATION_SOURCE") };
}

export interface ArtistSocialInput {
  brain: BrainSnapshot; knowledge: readonly OwnerKnowledgeRecord[]; todayIL: string; now: Date;
  artist: { id: string; name: string };
  releases?: ResearchContext["releases"];
}

export function artistSocialOf(i: ArtistSocialInput): ArtistSocial {
  const { brain: s, todayIL, now } = i;
  const artistKey = `label-artist:${i.artist.id}`;
  const st = brainState(s, todayIL, now.toISOString());
  const res = new Map(s.resources.map((r) => [r.id, r]));
  const { owners, inspirations } = resourceRelations(i.knowledge, todayIL);
  const ctx: ResearchContext = { todayIL, now, focus: { entityKey: artistKey }, releases: i.releases };
  // the ownership (Owner-approved) joins a series to its owner for the recheck context only — a copy, never the research rule
  const ownerOfResource = (id: string | null): string | null => { if (!id) return null; const r = res.get(id); const acc = r?.parentId ?? id; return owners.has(acc) ? owners.get(acc)!.subjectKey : null; };
  const series = researchSeries(s, ctx).map((x) => { const o = "resourceId" in x.subject ? ownerOfResource(x.subject.resourceId) : null; return o && !x.scopeEntities.includes(o) ? { ...x, scopeEntities: [...x.scopeEntities, o].sort() } : x; });
  const seriesOf = (resourceId: string) => series.filter((x) => "resourceId" in x.subject && x.subject.resourceId === resourceId);
  const metric = (x: ResearchSeries): SocialMetric => {
    const f = freshnessHeOf(x.last.observedAt, todayIL, now);
    return { type: x.type, family: x.family, value: x.last.value, unit: x.last.unit, checkedOn: f.checkedOn, ageDays: f.ageDays, freshness: f.freshness, freshnessHe: f.freshnessHe,
      previous: x.previous ? { value: x.previous.value, checkedOn: ilYmd(x.previous.observedAt) } : null, change: x.comparison, points: x.points, sourceKind: x.last.sourceKind, confidence: x.last.confidence, canStoreNewCheck: x.storeStatus === "CAN_STORE" };
  };
  const latest = (xs: readonly (string | null)[]) => xs.filter((x): x is string => !!x).sort().at(-1) ?? null;
  const accountView = (r: BrainResource, own: OwnerKnowledgeRecord | null): SocialAccount => {
    const metrics = seriesOf(r.id).map(metric);
    const children = s.resources.filter((c) => c.parentId === r.id && st.resourceActive(c.id));
    const items = children.map((c): SocialContentItem => { const m = seriesOf(c.id).map(metric); return { resourceId: c.id, label: c.displayName ?? c.identityKey, contentKind: c.contentKind, metrics: m, lastCheckedOn: latest(m.map((x) => x.checkedOn)) }; })
      .sort((a, b) => (b.lastCheckedOn ?? "").localeCompare(a.lastCheckedOn ?? "") || a.resourceId.localeCompare(b.resourceId));
    const last = latest([...metrics.map((x) => x.checkedOn), ...items.map((x) => x.lastCheckedOn)]);
    const purpose = own ? String(own.value.channelPurpose ?? "") || null : null;
    return {
      resourceId: r.id, platform: r.platform, label: labelOfResource(r),
      ownership: own ? { ownerKey: own.subjectKey, channelPurpose: purpose, channelPurposeHe: purpose ? CLASSIFICATION_VALUE_HE[purpose] ?? purpose : null, knowledgeId: own.id, approvedOn: own.createdAt.slice(0, 10), relationQuality: "OWNER_CONFIRMED_RELATION" } : null,
      shared: own?.subjectKey === COMPANY_OWNER_KEY,
      metrics, content: { tracked: children.length, items: items.slice(0, 10) },
      lastCheckedOn: last, lastCheckFreshnessHe: last ? (last === todayIL ? `נבדק היום (${heDate(last)})` : `בדיקה אחרונה ${heDate(last)} — לא נתון של עכשיו`) : "עוד לא נבדק",
    };
  };
  const activeAccounts = s.resources.filter((r) => r.resourceKind === "ACCOUNT" && st.resourceActive(r.id));
  const accounts = activeAccounts.filter((r) => owners.get(r.id)?.subjectKey === artistKey).map((r) => accountView(r, owners.get(r.id)!));
  const labelChannels = activeAccounts.filter((r) => owners.get(r.id)?.subjectKey === COMPANY_OWNER_KEY).map((r) => accountView(r, owners.get(r.id)!));
  const insp = inspirations.filter((k) => k.subjectKey === artistKey).flatMap((k): SocialInspiration[] => {
    const r = res.get(resourceIdOf(k.value.resource)!);
    if (!r || !st.resourceActive(r.id)) return [];
    return [{ ...accountView(r, null), learnHe: typeof k.value.learnHe === "string" ? k.value.learnHe : null, inspirationKnowledgeId: k.id, approvedOn: k.createdAt.slice(0, 10) }];
  });
  const inspiredIds = new Set(inspirations.map((k) => resourceIdOf(k.value.resource)));
  const unassignedAccounts = activeAccounts.filter((r) => !owners.has(r.id) && !inspiredIds.has(r.id)).map((r) => ({ resourceId: r.id, platform: r.platform, label: labelOfResource(r) }));

  // insights / recommendations: CANONICAL when the record names the artist; DERIVED when it rests on the artist's accounts (or their content)
  const mine = new Set(accounts.flatMap((a) => [a.resourceId, ...s.resources.filter((c) => c.parentId === a.resourceId).map((c) => c.id)]));
  const shared = new Set(labelChannels.flatMap((a) => [a.resourceId, ...s.resources.filter((c) => c.parentId === a.resourceId).map((c) => c.id)]));
  const evidenceDate = (rec: BrainRecord) => latest(s.links.filter((l) => l.role === "EVIDENCE_FOR" && l.toRecordId === rec.id && l.fromObservationId && st.linkActive(l.id))
    .map((l) => s.observations.find((o) => o.id === l.fromObservationId)?.observedAt ?? null).map((x) => (x ? ilYmd(x) : null)));
  const tied = s.records.flatMap((rec): Array<SocialRecord & { live: boolean }> => {
    const canonical = rec.entityKeys.includes(artistKey);
    if (!canonical && !rec.resourceIds.some((id) => mine.has(id))) return [];
    const status = st.recordStatus(rec.id);
    const ev = evidenceDate(rec);
    return [{ recordId: rec.id, recordType: rec.recordType, titleHe: rec.titleHe, status, statusHe: status ? STATUS_HE[status] ?? status : null, area: rec.area, createdOn: ilYmd(rec.createdAt),
      tie: canonical ? "CANONICAL" : "DERIVED", evidenceCheckedOn: ev, evidenceFreshnessHe: ev ? freshnessHeOf(`${ev}T12:00:00+03:00`, todayIL, now).freshnessHe : null,
      alsoSharedChannel: rec.resourceIds.some((id) => shared.has(id)), live: LIVE_RECORD.has(status ?? "") }];
  });
  const records = tied.filter((x) => x.live).map(({ live: _l, ...x }) => x).sort((a, b) => b.createdOn.localeCompare(a.createdOn) || a.recordId.localeCompare(b.recordId));

  // at most ONE recheck proposal, over the artist's own accounts only (never the shared label channel, never an inspiration)
  const mySeries = series.filter((x) => "resourceId" in x.subject && mine.has(x.subject.resourceId));
  const recheck = recheckProposals(mySeries, ctx)[0] ?? null;
  return {
    artistKey, artistName: i.artist.name, accounts, labelChannels, inspirations: insp, records, historyRecords: tied.length - records.length,
    lastCheckedOn: latest(accounts.map((a) => a.lastCheckedOn)), recheck, unassignedAccounts,
  };
}
