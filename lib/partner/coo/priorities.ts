/**
 * Sunny COO — EXECUTIVE PRIORITIZATION + the aggregate (pure). A DERIVED presentation layer: never stored, never a DB
 * ranking, never a score shown to the Owner. 3–5 items is a presentation limit, not a business rule.
 *
 * Order (evidence, not age):
 *   tier 1 — a recorded blocker; a real conflict or an event ≤ 2 days away that is not ready;
 *   tier 2 — a client commitment / shoot / show / release in the horizon that is not ready; the ball with the Owner;
 *            a release / deadline whose next step is not scheduled;
 *   tier 3 — a label project with no next step recorded; a session / meeting with an open item; a schedule pattern.
 * Inside a tier: the nearest date first, then label work (a protected track), then name. Old ≠ important: nothing is
 * promoted for being old.
 */
import type { GatewaySources } from "../gateway/core";
import { cooCtx, type CooCtx } from "./context";
import { readinessBoard, type ReadinessBoard } from "./readiness";
import { portfolioMomentum, rosterCare, type ArtistCare, type ProjectMomentum } from "./momentum";
import { scheduleHealth, type ScheduleHealth } from "./schedule";
import { COO_MAX_PRIORITIES, INTERNAL_COO_HEURISTICS, whenHe } from "./model";

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
  priorities: CooPriority[];
  more: number;
  unchecked: string[];
}

function candidates(c: CooCtx, board: ReadinessBoard, momentum: readonly ProjectMomentum[], schedule: ScheduleHealth): CooPriority[] {
  const out: CooPriority[] = [];
  for (const r of board.events) {
    if (r.state === "READY") continue;
    const near = r.daysTo !== null && r.daysTo <= 2;
    const commitment = r.kind === "SHOOT" || r.kind === "SHOW" || r.kind === "RELEASE" || r.kind === "DEADLINE";
    if (r.state === "UNKNOWN" && !near) continue;
    const tier: 1 | 2 | 3 = r.state === "BLOCKED" || (near && r.state === "ATTENTION" && commitment) ? 1 : commitment ? 2 : 3;
    const items = [...r.blocked, ...r.open, ...r.notSeen.filter((_, i) => i < 2)];
    out.push({ key: r.key, tier, kind: "READINESS", entity: r.entity, daysTo: r.daysTo, labelWork: !!r.project && c.isLabel(r.project.slice(8)),
      he: `${r.narrativeHe.split("\n")[0]}${items.length ? ` — ${items.slice(0, 2).join(" ")}` : ""}`, why: items, recommendationHe: r.recommendationHe, epistemic: "DERIVED" });
  }
  for (const f of schedule.findings) {
    const d = f.date ? Math.round((Date.parse(`${f.date}T00:00:00Z`) - Date.parse(`${c.today}T00:00:00Z`)) / 86_400_000) : null;
    if (f.kind === "CONFLICT") out.push({ key: `conflict:${f.evidence.join("|")}`, tier: d !== null && d <= 2 ? 1 : 2, kind: "CONFLICT", entity: null, daysTo: d, labelWork: false, he: f.he, why: f.evidence, recommendationHe: "כדאי להחליט מה מזיזים — אני לא משנה כלום ביומן.", epistemic: "DERIVED" });
    else if (f.code === "NO_PREP_WINDOW" || f.code === "NO_ROOM_FOR_FOLLOWUPS") out.push({ key: `schedule:${f.code}:${f.date ?? ""}`, tier: 3, kind: "SCHEDULE", entity: null, daysTo: d, labelWork: false, he: f.he, why: f.evidence, recommendationHe: null, epistemic: "DERIVED" });
  }
  for (const m of momentum) {
    if (!m.warning) continue;
    const tier: 1 | 2 | 3 = m.state === "OWNER_BALL" || m.risks.length ? 2 : 3;
    if (m.state === "NO_NEXT_STEP" && !m.labelWork && !m.risks.length) continue; // a client project with no step and no near date: context, not executive
    const d = m.risks.length ? (m.release?.daysTo ?? m.deadlineDaysTo) : null;
    out.push({ key: `momentum:${m.key}`, tier, kind: "MOMENTUM", entity: m.key, daysTo: d, labelWork: m.labelWork, he: m.he, why: [m.stateHe, ...m.risks], recommendationHe: m.state === "NO_NEXT_STEP" ? "לקבוע את השלב הבא (סשן / משימה) כדי לשמור על תנועה." : m.state === "OWNER_BALL" ? "לסגור את מה שמחכה לך." : null, epistemic: "DERIVED" });
  }
  return out;
}

/** The ONE ordering: tier, then nearest date, then label work, then name — never age. */
export function prioritize(items: readonly CooPriority[], max = COO_MAX_PRIORITIES): { top: CooPriority[]; more: number } {
  const byEntity = new Map<string, CooPriority>();
  for (const i of items) {
    const k = i.entity ?? i.key;
    const prev = byEntity.get(k);
    if (!prev || i.tier < prev.tier || (i.tier === prev.tier && (i.daysTo ?? 999) < (prev.daysTo ?? 999))) byEntity.set(k, prev ? { ...i, why: [...new Set([...i.why, ...prev.why])] } : i);
    else byEntity.set(k, { ...prev, why: [...new Set([...prev.why, ...i.why])] });
  }
  const all = [...byEntity.values()].sort((a, b) => a.tier - b.tier || (a.daysTo ?? 999) - (b.daysTo ?? 999) || Number(b.labelWork) - Number(a.labelWork) || a.he.localeCompare(b.he));
  return { top: all.slice(0, max), more: Math.max(0, all.length - max) };
}

export function buildCooView(src: GatewaySources, horizon: number = INTERNAL_COO_HEURISTICS.horizonDays): CooView {
  const c = cooCtx(src);
  const readiness = readinessBoard(c, horizon);
  const momentum = portfolioMomentum(c, horizon);
  const artists = rosterCare(c, horizon);
  const schedule = scheduleHealth(c, { readiness: readiness.events, momentum, artists });
  const { top, more } = prioritize(candidates(c, readiness, momentum, schedule));
  return { today: c.today, horizonDays: horizon, readiness, momentum, artists, schedule, priorities: top, more, unchecked: [...new Set([...readiness.unchecked, ...schedule.unchecked])] };
}

/** "שלושה דברים שהייתי סוגרת עכשיו" — the short Hebrew answer. */
export function prioritiesHe(v: CooView): string {
  if (!v.priorities.length) return v.unchecked.length ? `לא מצאתי משהו דחוף ברשומות שנקראו — אבל ${v.unchecked[0]}` : "לא רואה כרגע משהו שדורש אותך מעבר לשגרה.";
  const n = v.priorities.length;
  const head = n === 1 ? "דבר אחד שהייתי סוגרת עכשיו:" : `${n === 2 ? "שני" : n === 3 ? "שלושה" : n === 4 ? "ארבעה" : "חמישה"} דברים שהייתי סוגרת עכשיו:`;
  return [head, ...v.priorities.map((p, i) => `${i + 1}. ${p.he}${p.recommendationHe ? ` → ${p.recommendationHe}` : ""}`), ...(v.more ? [`(ויש עוד ${v.more} — אפשר לפרט.)`] : [])].join("\n");
}
export { whenHe };
