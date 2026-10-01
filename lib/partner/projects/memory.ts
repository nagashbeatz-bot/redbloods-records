/**
 * Sunny — PROJECT MEMORY (Phase 1, Owner decision 2026-10-01). Pure, READ-ONLY, composed at read time:
 *   CANONICAL           what the records say NOW (project_view: status, deadline, the live ball, the latest recorded event)
 *   OWNER MEMORY        the Owner's "עדכון לסאני" items LINKED to this project (OWNER_REPORTED; link quality EXACT_UNIQUE /
 *                       OWNER_CONFIRMED — never a text guess)
 *   SUNNY UNDERSTANDING the current interpretation (epistemic HYPOTHESIS) + its freshness against the canonical state
 * Canonical ALWAYS wins: an interpretation older than a recorded event / a status change is OUTDATED_BY_CANONICAL and
 * its next step is never shown as current; a ball that contradicts the live ball is BALL_CONFLICT. Nothing is deleted:
 * superseded / retracted interpretations stay history (mode history). Adds no second rule: the ball is projected only
 * from project_view's own signals (lib/inbox-memory canonicalBallOf).
 */
import type { GatewaySources } from "../gateway/core";
import type { OperationsRaw } from "../operations/types";
import { buildProjectView } from "./view";
import { heldConfirmedByOwner } from "../../session-duration";
import { activeInterpretations, activeLinksOf, canonicalBallOf, freshnessOf, FRESHNESS_HE, type Freshness, type InboxInterpretation, type InboxMemory, type ProjectBasis } from "../../inbox-memory";

const ok = <T,>(a: { status: string; value?: T } | undefined): T | null => (a && a.status === "OK" ? (a as { value: T }).value : null);
const SNIPPET = 200;
const snippet = (t: string, n = SNIPPET) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);

/**
 * The latest RECORDED event of a project (ISO): a mix / master version upload, a Victor upload or sent notes, a held
 * session the Owner recorded (its day — an AUTO_MARK held is a clock tick, not an event), a delivery, a release. Only
 * timestamps the app records — never "a date passed".
 */
export function projectLastEventAt(src: GatewaySources, projectId: string): string | null {
  const st = ok(src.state);
  const ops = ok(src.operations) as OperationsRaw | null;
  const times: string[] = [];
  const works = new Set((ops?.engineerWork?.rows ?? []).filter((w) => w.projectId === projectId).map((w) => w.id));
  for (const v of ops?.mixVersions?.rows ?? []) if (v.workId && works.has(v.workId) && v.createdAt) times.push(v.createdAt);
  for (const w of st?.domains.victor.data?.active ?? []) if (w.projectId === projectId) for (const x of [w.lastUploadAt, w.lastNotesSentAt]) if (x) times.push(x);
  for (const d of ops?.deliveries?.rows ?? []) if (d.projectId === projectId && d.deliveredAt) times.push(d.deliveredAt);
  // a held session counts as an event only when the Owner recorded it (AUTO_MARK = the end passed, not proof — 2026-10-01)
  for (const s of st?.domains.sessions.data?.items ?? []) if (s.projectId === projectId && s.dateYmd && heldConfirmedByOwner({ status: s.status, status_source: s.statusSource ?? null, date: s.dateYmd, start_time: s.startTime ?? null, end_time: s.endTime ?? null })) times.push(`${s.dateYmd}T00:00:00Z`);
  for (const r of st?.domains.releasesFull.data?.items ?? []) if (r.projectId === projectId && r.releasedAt) times.push(r.releasedAt);
  const valid = times.filter((x) => Number.isFinite(Date.parse(x)));
  return valid.length ? valid.reduce((a, b) => (Date.parse(b) > Date.parse(a) ? b : a)) : null;
}

/** The canonical basis NOW — null when the company state / operations were not read or the project does not exist. */
export function projectBasisOf(src: GatewaySources, projectId: string): ProjectBasis | null {
  if (!ok(src.state) || !ok(src.operations)) return null;
  const v = buildProjectView(src, projectId);
  if (!v.found || !v.identity) return null;
  return { status: v.identity.status, ball: canonicalBallOf(v.signals.map((s) => s.code)), lastEventAt: projectLastEventAt(src, projectId) };
}

export interface ProjectMemoryUnderstanding {
  id: string; itemId: string; writtenAt: string | null; recordedAt: string;
  whatHappened: string; completed: string[]; openGaps: string[]; blockers: string[]; ballWith: string; inferredNextStep: string | null; confidence: string;
  epistemic: "HYPOTHESIS"; freshness: Freshness; freshnessHe: string; basis: { status: string | null; ball: string | null; eventAt: string | null };
  supersedeKind: string | null;
}
export interface ProjectMemory {
  key: string; found: boolean;
  canonical: { status: string | null; deadline: string | null; ball: string | null; lastEventAt: string | null; signals: Array<{ code: string; he: string }>; read: boolean };
  ownerMemory: { total: number; latest: Array<{ itemId: string; writtenAt: string; text: string; linkId: string; linkQuality: string; status: string; outcome: string | null }> };
  understanding: ProjectMemoryUnderstanding | null;
  /** the hypothesis next step ONLY when the understanding is CURRENT; otherwise null (canonical signals / next_steps stage lead) */
  currentNextStep: { text: string; epistemic: "HYPOTHESIS"; confidence: string } | null;
  historyCount: number;
  history?: Array<{ id: string; itemId: string; recordedAt: string; whatHappened: string; state: "HEAD" | "SUPERSEDED" | "RETRACTED"; supersedeKind: string | null; supersedeReason: string | null; retractedReason: string | null }>;
  links?: Array<{ linkId: string; itemId: string; quality: string; method: string; surface: string; retracted: boolean; retractedReason: string | null }>;
  memoryRead: boolean;
}

export function buildProjectMemory(src: GatewaySources, projectId: string, mode: "summary" | "history" = "summary"): ProjectMemory {
  const key = `project:${projectId}`;
  const view = ok(src.state) ? buildProjectView(src, projectId) : null;
  const basis = projectBasisOf(src, projectId);
  const mem = ok(src.inboxMemory) as InboxMemory | null;
  const items = new Map((ok(src.ownerInbox) ?? []).map((i) => [i.id, i]));
  const links = mem ? activeLinksOf(mem.links, (l) => l.entityKey === key) : [];
  const latest = links
    .map((l) => ({ l, i: items.get(l.itemId) }))
    .filter((x) => !!x.i)
    .sort((a, b) => b.i!.createdAt.localeCompare(a.i!.createdAt) || a.l.id.localeCompare(b.l.id))
    .map(({ l, i }) => ({ itemId: i!.id, writtenAt: i!.createdAt, text: snippet(i!.body), linkId: l.id, linkQuality: l.quality, status: i!.status, outcome: i!.outcome }));
  const active = mem ? activeInterpretations(mem.interpretations, key) : [];
  const head = active[0] ?? null;
  const toU = (h: InboxInterpretation): ProjectMemoryUnderstanding => {
    const f = freshnessOf(h, basis);
    return {
      id: h.id, itemId: h.itemId, writtenAt: items.get(h.itemId)?.createdAt ?? null, recordedAt: h.createdAt,
      whatHappened: h.whatHappened, completed: h.completed, openGaps: h.openGaps, blockers: h.blockers, ballWith: h.ballWith, inferredNextStep: h.inferredNextStep, confidence: h.confidence,
      epistemic: "HYPOTHESIS", freshness: f, freshnessHe: FRESHNESS_HE[f], basis: { status: h.basisStatus, ball: h.basisBall, eventAt: h.basisEventAt }, supersedeKind: h.supersedeKind,
    };
  };
  const understanding = head ? toU(head) : null;
  const all = mem ? mem.interpretations.filter((i) => i.entityKey === key).sort((a, b) => b.seq - a.seq) : [];
  return {
    key, found: !!view?.found,
    canonical: {
      status: view?.identity?.status ?? null, deadline: view?.identity?.deadline ?? null, ball: basis?.ball ?? null, lastEventAt: basis?.lastEventAt ?? null,
      signals: (view?.signals ?? []).slice(0, 8).map((s) => ({ code: s.code, he: s.he })), read: !!basis,
    },
    ownerMemory: { total: latest.length, latest: latest.slice(0, mode === "history" ? 20 : 5) },
    understanding,
    currentNextStep: understanding && understanding.freshness === "CURRENT" && understanding.inferredNextStep ? { text: understanding.inferredNextStep, epistemic: "HYPOTHESIS", confidence: understanding.confidence } : null,
    historyCount: all.length,
    ...(mode === "history" ? {
      history: all.slice(0, 10).map((i) => ({ id: i.id, itemId: i.itemId, recordedAt: i.createdAt, whatHappened: i.whatHappened, state: i.retractedAt ? "RETRACTED" as const : i.id === head?.id ? "HEAD" as const : "SUPERSEDED" as const, supersedeKind: i.supersedeKind, supersedeReason: i.supersedeReason, retractedReason: i.retractedReason })),
      links: (mem?.links ?? []).filter((l) => l.entityKey === key).slice(0, 20).map((l) => ({ linkId: l.id, itemId: l.itemId, quality: l.quality, method: l.method, surface: l.surface, retracted: !!l.retractedAt, retractedReason: l.retractedReason })),
    } : {}),
    memoryRead: !!mem,
  };
}
