/**
 * Sunny COO — the request-scoped read context (pure, memoized per GatewaySources object). It only COMPOSES what the
 * Gateway already loaded and the existing Deep Brain views already compute (project view, production view, show
 * view, project operating / ball, calendar links). No reader, no DB, no write, no cache across requests.
 */
import type { GatewaySources } from "../gateway/core";
import { ok } from "../gateway/core";
import type { PartnerCompanyState } from "../eyes/types";
import type { OperationsRaw } from "../operations/types";
import type { ProjectDetailRaw } from "../projects/detail-types";
import type { LabelDetailRaw } from "../label/detail-types";
import type { CalendarWindowResult } from "../calendar/types";
import type { BrainSnapshot } from "../brain/model";
import { buildProjectView, type ProjectView } from "../projects/view";
import { buildProduction, type VideoProduction } from "../redfilms/view";
import { buildShowView, type ShowView } from "../shows/view";
import { projectOperating } from "../sunny/operating";
import { buildCalendarLinkIndex, linkCalendarEvent, type LinkedCalendarEvent } from "../calendar/links";
import { isLabelProject } from "../../project-classification";
import { buildNeedsMe, type NeedsMe, type ProjectRecordedBall } from "../needs-me/curate";

export interface CooCtx {
  src: GatewaySources;
  today: string;
  st: PartnerCompanyState | null;
  ops: OperationsRaw | null;
  det: ProjectDetailRaw | null;
  ld: LabelDetailRaw | null;
  cal: CalendarWindowResult | null;
  calReadable: boolean;
  calStatus: string;
  brain: BrainSnapshot | null;
  financeReadable: boolean;
  /** the canonical roster (label_artists), minus any retired team identity (DJ CLEANTONE is TEAM, never a label artist) */
  roster: Array<{ id: string; name: string; key: string }>;
  project(id: string): ProjectView;
  production(id: string): VideoProduction | null;
  show(id: string): ShowView | null;
  operating(id: string): ReturnType<typeof projectOperating> | null;
  /** needs_me, built ONCE per request (null = not readable). The SAME board the dashboard and Sunny read. */
  needsMe(): NeedsMe | null;
  /** The ONE recorded project-ball rule (needs_me's projectBalls, Owner decision 2026-10-05). "UNREAD" = needs_me could
   *  not be built (never "not the Owner's"); absent evidence = NONE. An Owner statement never sets it. */
  recordedBall(projectId: string): ProjectRecordedBall | "UNREAD";
  isLabel(id: string): boolean;
  projectName(id: string | null): string | null;
  linked(): LinkedCalendarEvent[];
}

const memo = new WeakMap<GatewaySources, CooCtx>();
const ilToday = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

export function cooCtx(src: GatewaySources): CooCtx {
  const hit = memo.get(src);
  if (hit) return hit;
  const st = ok(src.state) as PartnerCompanyState | null;
  const ops = ok(src.operations) as OperationsRaw | null;
  const det = ok(src.projectDetail) as ProjectDetailRaw | null;
  const ld = ok(src.labelDetail) as LabelDetailRaw | null;
  const cal = ok(src.calendar) as CalendarWindowResult | null;
  const calReadable = !!cal && (cal.status === "CALENDAR_DATA_AVAILABLE" || cal.status === "CALENDAR_PARTIAL");
  const today = st?.todayIL ?? ilToday(src.now);
  const retired = new Set(src.identities?.cleantone?.retiredKeys ?? []);
  const teamName = (src.identities?.cleantone?.displayName ?? "").trim().toLowerCase();
  const roster = (st?.domains.labelArtists.data?.items ?? [])
    .map((a) => ({ id: a.id, name: a.name, key: `label-artist:${a.id}` }))
    .filter((a) => !retired.has(a.key) && (!teamName || a.name.trim().toLowerCase() !== teamName));
  const pv = new Map<string, ProjectView>(), pr = new Map<string, VideoProduction | null>(), sv = new Map<string, ShowView | null>(), po = new Map<string, ReturnType<typeof projectOperating> | null>();
  let linkedCache: LinkedCalendarEvent[] | null = null;
  let nmCache: NeedsMe | null | undefined;
  const needsMe = () => { if (nmCache === undefined) { try { nmCache = buildNeedsMe(src); } catch { nmCache = null; } } return nmCache; };
  const NO_BALL: ProjectRecordedBall = { ball: "NONE", ownerWait: false, undecided: false };
  const idx = st?.domains.projects.data?.index ?? {};
  const meta = new Map((ops?.projectsMeta?.rows ?? []).map((p) => [p.id, p]));
  const c: CooCtx = {
    src, today, st, ops, det, ld, cal, calReadable, calStatus: cal?.status ?? (src.calendar ? "CALENDAR_UNREADABLE" : "NOT_LOADED"),
    brain: ok(src.brain) as BrainSnapshot | null, financeReadable: !!ok(src.finance), roster,
    project: (id) => { if (!pv.has(id)) pv.set(id, buildProjectView(src, id)); return pv.get(id)!; },
    production: (id) => {
      if (!pr.has(id)) { const p = ops?.redFilms?.rows.find((x) => x.id === id); pr.set(id, p ? buildProduction(src, p) : null); }
      return pr.get(id)!;
    },
    show: (id) => { if (!sv.has(id)) { let v: ShowView | null = null; try { v = buildShowView(src, id); } catch { v = null; } sv.set(id, v); } return sv.get(id)!; },
    operating: (id) => { if (!po.has(id)) { let v: ReturnType<typeof projectOperating> | null = null; try { v = projectOperating(src, id); } catch { v = null; } po.set(id, v); } return po.get(id)!; },
    needsMe,
    recordedBall: (id) => { const nm = needsMe(); return nm ? nm.projectBalls[id] ?? NO_BALL : "UNREAD"; },
    isLabel: (id) => { const p = idx[id] ?? meta.get(id); return !!p && isLabelProject(p as Parameters<typeof isLabelProject>[0]); },
    projectName: (id) => (id ? idx[id]?.name ?? meta.get(id)?.name ?? null : null),
    linked: () => {
      if (!linkedCache) { const li = buildCalendarLinkIndex(ops, st); linkedCache = calReadable ? cal!.events.map((e) => linkCalendarEvent(e, li)) : []; }
      return linkedCache;
    },
  };
  memo.set(src, c);
  return c;
}

/** Calendar events on one Israel day that relate to an entity (canonical first, then text match). */
export function calendarFor(c: CooCtx, ymd: string, keys: readonly string[]): LinkedCalendarEvent[] {
  const day = (e: LinkedCalendarEvent) => (e.event.allDay ? e.event.start : new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(e.event.start))) === ymd;
  return c.linked().filter((l) => day(l) && l.edges.some((e) => keys.includes(e.to)));
}
export const hmOf = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jerusalem", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
