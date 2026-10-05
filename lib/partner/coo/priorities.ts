/**
 * Sunny COO — EXECUTIVE PRIORITIES = BUSINESS_MOTION's TODAY (Owner mission 2026-10-05, Phase 2). There is ONE ranking
 * in Sunny: lib/partner/coo/motion.ts. This file only composes the COO view (readiness, momentum, roster care, schedule)
 * and serves motion.todayItems as the priorities — never a second engine. A derived presentation layer: never stored,
 * never a DB ranking, never a score shown to the Owner. ≤5 items is a presentation limit, not a business rule.
 * Old ≠ important: nothing is promoted for being old.
 */
import type { GatewaySources } from "../gateway/core";
import { cooCtx } from "./context";
import { readinessBoard, type ReadinessBoard } from "./readiness";
import { portfolioMomentum, rosterCare, type ArtistCare, type ProjectMomentum } from "./momentum";
import { scheduleHealth, type ScheduleHealth } from "./schedule";
import { INTERNAL_COO_HEURISTICS, whenHe } from "./model";
import { buildMotion, prioritiesAnswerHe, type BusinessMotion, type MotionItem } from "./motion";

export interface CooPriority {
  key: string;
  tier: 1 | 2 | 3;
  kind: "READINESS" | "CONFLICT" | "MOMENTUM" | "SCHEDULE";
  he: string;
  why: string[];
  entity: string | null;
  daysTo: number | null;
  labelWork: boolean;
  recommendationHe: string | null;
  epistemic: "DERIVED";
}

export interface CooView {
  today: string;
  horizonDays: number;
  readiness: ReadinessBoard;
  momentum: ProjectMomentum[];
  artists: ArtistCare[];
  schedule: ScheduleHealth;
  /** = motion.todayItems (the ONE ranking), in the CooPriority shape */
  priorities: CooPriority[];
  more: number;
  unchecked: string[];
  motion: BusinessMotion;
}

/** A motion item in the COO priority shape (MUST → tier 1, SHOULD → tier 2, else 3). */
export function priorityOf(i: MotionItem): CooPriority {
  return {
    key: i.key, tier: i.level === "MUST" ? 1 : i.level === "SHOULD" ? 2 : 3,
    kind: i.codes.includes("SCHEDULE_CONFLICT") ? "CONFLICT" : i.codes.some((c) => c === "COMMITMENT_NOT_READY" || c === "STAGE_VS_DEADLINE") ? "READINESS" : "MOMENTUM",
    he: `${i.titleHe}: ${i.reasonsHe.slice(0, 2).join("; ")}`, why: i.reasonsHe, entity: i.entity, daysTo: i.daysTo, labelWork: i.labelWork,
    recommendationHe: i.move?.he ?? null, epistemic: "DERIVED",
  };
}

export function buildCooView(src: GatewaySources, horizon: number = INTERNAL_COO_HEURISTICS.horizonDays): CooView {
  const c = cooCtx(src);
  const readiness = readinessBoard(c, horizon);
  const momentum = portfolioMomentum(c, horizon);
  const artists = rosterCare(c, horizon);
  const schedule = scheduleHealth(c, { readiness: readiness.events, momentum, artists });
  const motion = buildMotion(src, c, { readiness, momentum, artists, schedule });
  return { today: c.today, horizonDays: horizon, readiness, momentum, artists, schedule, priorities: motion.todayItems.map(priorityOf), more: motion.more,
    unchecked: [...new Set([...readiness.unchecked, ...schedule.unchecked, ...motion.unchecked])], motion };
}

/** "שלושה דברים שהייתי סוגרת עכשיו" — the short Hebrew answer (the same moves, the same order as motion). */
export function prioritiesHe(v: CooView): string {
  if (!v.priorities.length) return v.unchecked.length ? `לא מצאתי משהו דחוף ברשומות שנקראו — אבל ${v.unchecked[0]}` : "לא רואה כרגע משהו שדורש אותך מעבר לשגרה.";
  return prioritiesAnswerHe(v.motion.todayItems, v.more);

}
export { whenHe };
