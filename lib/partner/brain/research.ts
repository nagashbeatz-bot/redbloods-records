/**
 * Sunny Brain — research freshness, comparison and RECHECK PROPOSALS. Pure (no DB, no IO, no clock of its own).
 *
 * Product model (Owner decision 2026-10-02): social / web research is Owner-requested browser work. Claude reads a
 * PUBLIC page in the Owner's browser session only when he asks, or when he says yes to Sunny's proposal; the Brain
 * stores what was read (EXTERNAL_SOURCE + CLAUDE_READ) only under a live tracking authorization. There is NO platform
 * API, NO crawler, NO cron, NO background monitoring.
 *
 * This module answers, from the EXISTING observations only (no second history):
 *   when did we last check · what was the value then · what changed between the last two checks · where was it read ·
 *   is it from today or old · may a new check be STORED (a covering ACTIVE authorization) — and, at interaction time,
 *   whether Sunny should PROPOSE a recheck. A proposal executes nothing and writes nothing: it is a question for the
 *   Owner ("רוצה שאבדוק עכשיו?"). Nothing here is persisted, scheduled, pushed or alerted; reviewAt is never computed.
 */
import { brainState, type BrainAuthorization, type BrainObservation, type BrainSnapshot } from "./model";

/**
 * Recheck policy — ENGINEERING DEFAULTS, NOT an Owner business policy (no approved rule defines them yet). Explicit
 * constants so the Owner can change them; never stored as DB truth.
 */
export const RECHECK_POLICY = {
  /** A series whose last current observation is at least this old is STALE (proposed default: 14 days). */
  staleAfterDays: 14,
  /** A release whose target date is within this many days makes stale research material (proposed default: 21). */
  releaseWindowDays: 21,
  /** At most this many proposals per answer — never a list to spam. */
  maxProposals: 2,
} as const;

export type Freshness = "TODAY" | "RECENT" | "STALE";
export type StoreStatus = "CAN_STORE" | "NO_AUTHORIZATION" | "AUTHORIZATION_REVOKED" | "AUTHORIZATION_SUPERSEDED" | "AUTHORIZATION_EXPIRED" | "AUTHORIZATION_NOT_YET_VALID";
export type RecheckReason = "STALE_EVIDENCE" | "RELEASE_SOON" | "OWNER_DISCUSSING";

export interface ResearchPoint { observationId: string; observedAt: string; value: number | string | boolean | null; unit: string | null; sourceKind: string; sourceRef: string | null; captureMethod: string; confidence: string; sourceType: string }
export interface ResearchSeries {
  key: string;
  subject: { resourceId: string } | { entityKey: string };
  subjectLabel: string;
  type: string;
  family: string;
  points: number;
  last: ResearchPoint;
  previous: ResearchPoint | null;
  comparison: { kind: "NUMBER"; delta: number; deltaPct: number | null; daysBetween: number } | { kind: "CHANGED"; changed: boolean; daysBetween: number } | { kind: "NOT_COMPARABLE"; why: string } | null;
  ageDays: number;
  freshness: Freshness;
  storeStatus: StoreStatus;
  coveringAuthorizationIds: string[];
  allowedSourceKinds: string[];
  /** Entities named next to this series by an authorization's scope — NOT ownership (OWNS_RESOURCE is not modelled). */
  scopeEntities: string[];
  dependentRecordIds: string[];
}
export interface RecheckProposal { seriesKey: string; reasons: RecheckReason[]; textHe: string; lastCheckedAt: string; ageDays: number; storeStatus: StoreStatus; nextStep: "ASK_OWNER_THEN_BROWSER_CHECK_AND_RECORD" | "ASK_OWNER_THEN_REQUEST_AUTHORIZATION"; executesNothing: true }
export interface ResearchContext {
  todayIL: string;
  now: Date;
  /** What the Owner is talking about right now (an entity key or a resource id) — a material reason, never a schedule. */
  focus?: { entityKey?: string; resourceId?: string };
  /** Upcoming releases from the canonical release records (label artist id + target date). */
  releases?: ReadonlyArray<{ labelArtistId: string | null; targetYmd: string | null; released: boolean }>;
  labelOf?: (entityKey: string) => string | null;
}

const DAY = 86_400_000;
const ilYmd = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
const valueOf = (o: BrainObservation) => o.valueNum ?? o.valueText ?? o.valueBool;
const pointOf = (o: BrainObservation): ResearchPoint => ({ observationId: o.id, observedAt: o.observedAt, value: valueOf(o), unit: o.unit, sourceKind: o.sourceKind, sourceRef: o.sourceRef, captureMethod: o.captureMethod, confidence: o.confidence, sourceType: o.sourceType });
const daysBetween = (a: string, b: string) => Math.round(Math.abs(Date.parse(a) - Date.parse(b)) / DAY * 10) / 10;

function covers(a: BrainAuthorization, o: { resourceId: string | null; entityKey: string | null }, family: string, parentOf: (id: string) => string | null): boolean {
  if (!a.observationFamilies.includes(family)) return false;
  if (o.resourceId) return a.resourceIds.includes(o.resourceId) || (a.includeChildResources && !!parentOf(o.resourceId) && a.resourceIds.includes(parentOf(o.resourceId)!));
  return !!o.entityKey && a.entityKeys.includes(o.entityKey);
}

/** Every current observation series (subject + type) with its last check, comparison, freshness and storability. */
export function researchSeries(s: BrainSnapshot, ctx: ResearchContext): ResearchSeries[] {
  const st = brainState(s, ctx.todayIL, ctx.now.toISOString());
  const res = new Map(s.resources.map((r) => [r.id, r]));
  const parentOf = (id: string) => res.get(id)?.parentId ?? null;
  const groups = new Map<string, BrainObservation[]>();
  for (const o of s.observations) {
    if (!st.observationValid(o.id)) continue; // history is never current state
    const key = `${o.resourceId ? `resource:${o.resourceId}` : o.entityKey}|${o.type}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(o);
  }
  const liveRecords = s.records.filter((r) => ["OPEN", "ENDORSED", "ACCEPTED"].includes(st.recordStatus(r.id) ?? ""));
  const out: ResearchSeries[] = [];
  for (const [key, list] of groups) {
    list.sort((a, b) => a.observedAt.localeCompare(b.observedAt) || a.seq - b.seq);
    const last = list[list.length - 1], prev = list.length > 1 ? list[list.length - 2] : null;
    const family = last.type.split(".")[0];
    const subj = { resourceId: last.resourceId, entityKey: last.entityKey };
    const r = last.resourceId ? res.get(last.resourceId) : undefined;
    const subjectLabel = r ? `${r.platform} ${r.displayName ?? r.firstHandle ?? r.identityKey}` : (ctx.labelOf?.(last.entityKey!) ?? last.entityKey!);
    let comparison: ResearchSeries["comparison"] = null;
    if (prev) {
      const d = daysBetween(last.observedAt, prev.observedAt);
      if (last.valueNum !== null && prev.valueNum !== null) comparison = (last.unit ?? "") === (prev.unit ?? "") ? { kind: "NUMBER", delta: last.valueNum - prev.valueNum, deltaPct: prev.valueNum !== 0 ? Math.round(((last.valueNum - prev.valueNum) / Math.abs(prev.valueNum)) * 1000) / 10 : null, daysBetween: d } : { kind: "NOT_COMPARABLE", why: "different units" };
      else if (typeof valueOf(last) === typeof valueOf(prev)) comparison = { kind: "CHANGED", changed: valueOf(last) !== valueOf(prev), daysBetween: d };
      else comparison = { kind: "NOT_COMPARABLE", why: "different value kinds" };
    }
    const ageDays = Math.max(0, Math.floor((ctx.now.getTime() - Date.parse(last.observedAt)) / DAY));
    const freshness: Freshness = ilYmd(last.observedAt) === ctx.todayIL ? "TODAY" : ageDays >= RECHECK_POLICY.staleAfterDays ? "STALE" : "RECENT";
    const covering = s.authorizations.filter((a) => covers(a, subj, family, parentOf));
    const active = covering.filter((a) => st.authorizationState(a) === "ACTIVE");
    const states = covering.map((a) => st.authorizationState(a));
    const storeStatus: StoreStatus = active.length ? "CAN_STORE" : states.includes("NOT_YET_VALID") ? "AUTHORIZATION_NOT_YET_VALID" : states.includes("EXPIRED") ? "AUTHORIZATION_EXPIRED"
      : states.includes("REVOKED") ? "AUTHORIZATION_REVOKED" : states.includes("SUPERSEDED") ? "AUTHORIZATION_SUPERSEDED" : "NO_AUTHORIZATION";
    const obsIds = new Set(list.map((o) => o.id));
    const dependent = liveRecords.filter((rec) => s.links.some((l) => l.role === "EVIDENCE_FOR" && l.toRecordId === rec.id && l.fromObservationId && obsIds.has(l.fromObservationId) && st.linkActive(l.id))).map((rec) => rec.id);
    out.push({
      key, subject: last.resourceId ? { resourceId: last.resourceId } : { entityKey: last.entityKey! }, subjectLabel, type: last.type, family, points: list.length,
      last: pointOf(last), previous: prev ? pointOf(prev) : null, comparison, ageDays, freshness, storeStatus,
      coveringAuthorizationIds: active.map((a) => a.id), allowedSourceKinds: [...new Set(active.flatMap((a) => a.sourceKinds))].sort(),
      scopeEntities: [...new Set(covering.flatMap((a) => a.entityKeys))].sort(), dependentRecordIds: dependent,
    });
  }
  return out.sort((a, b) => a.key.localeCompare(b.key));
}

/**
 * Interaction-time recheck proposals. Conservative: only a series with history that is STALE AND has a material reason
 * (stale evidence behind a live insight / recommendation, a release coming for an entity in scope, or the Owner talking
 * about it right now). Deterministic (same records → same proposals; nothing stored, so a refresh cannot multiply them).
 */
export function recheckProposals(series: readonly ResearchSeries[], ctx: ResearchContext): RecheckProposal[] {
  const today = Date.parse(`${ctx.todayIL}T00:00:00Z`);
  const releaseSoon = new Set((ctx.releases ?? []).filter((r) => !r.released && r.labelArtistId && r.targetYmd && Date.parse(`${r.targetYmd}T00:00:00Z`) >= today && Date.parse(`${r.targetYmd}T00:00:00Z`) - today <= RECHECK_POLICY.releaseWindowDays * DAY).map((r) => `label-artist:${r.labelArtistId}`));
  const out: Array<RecheckProposal & { rank: number }> = [];
  for (const x of series) {
    if (x.freshness !== "STALE") continue;
    const entities = "entityKey" in x.subject ? [x.subject.entityKey, ...x.scopeEntities] : x.scopeEntities;
    const reasons: RecheckReason[] = [];
    if (x.dependentRecordIds.length) reasons.push("STALE_EVIDENCE");
    if (entities.some((e) => releaseSoon.has(e))) reasons.push("RELEASE_SOON");
    const f = ctx.focus;
    if (f && ((f.resourceId && "resourceId" in x.subject && x.subject.resourceId === f.resourceId) || (f.entityKey && entities.includes(f.entityKey)))) reasons.push("OWNER_DISCUSSING");
    if (!reasons.length) continue;
    const date = ilYmd(x.last.observedAt);
    const why = reasons.includes("RELEASE_SOON") ? " יש ריליס קרוב, והנתון האחרון שלנו כבר לא עדכני." : reasons.includes("STALE_EVIDENCE") ? " תובנה / המלצה פתוחה נשענת על הנתון הישן הזה." : "";
    const store = x.storeStatus === "CAN_STORE" ? "" : " כדי לשמור את הבדיקה ולהשוות לאורך זמן צריך הרשאת מעקב — אבקש אותה ממך ב-Redbloods.";
    out.push({
      seriesKey: x.key, reasons, lastCheckedAt: x.last.observedAt, ageDays: x.ageDays, storeStatus: x.storeStatus, executesNothing: true,
      nextStep: x.storeStatus === "CAN_STORE" ? "ASK_OWNER_THEN_BROWSER_CHECK_AND_RECORD" : "ASK_OWNER_THEN_REQUEST_AUTHORIZATION",
      textHe: `עבר זמן מאז שבדקנו את ${x.subjectLabel} (${x.type}) — הבדיקה האחרונה מ-${date}, לפני ${x.ageDays} ימים.${why} רוצה שאבדוק עכשיו דרך הדפדפן ואשווה לפעם הקודמת?${store}`,
      rank: (reasons.includes("STALE_EVIDENCE") ? 0 : reasons.includes("RELEASE_SOON") ? 1 : 2),
    });
  }
  return out.sort((a, b) => a.rank - b.rank || b.ageDays - a.ageDays || a.seriesKey.localeCompare(b.seriesKey)).slice(0, RECHECK_POLICY.maxProposals).map(({ rank: _r, ...p }) => p);
}
