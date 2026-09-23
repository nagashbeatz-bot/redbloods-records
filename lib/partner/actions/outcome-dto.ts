/**
 * Redbloods Partner — recent executed Actions + their derived Outcome, display DTO (Phase F.1M). Pure.
 *
 * Built on the server ONLY from a derived F.1L PartnerActionOutcome (never re-derived here), and parsed
 * strictly on the client (fail closed). The DTO keeps the HISTORICAL executed values (from → to, when)
 * separate from the CURRENT live value; the current value is never presented as what Partner executed.
 *
 * Displayable states:
 *   APPLIED_AS_EXPECTED                 "בוצע" — the live field still equals the executed value;
 *   LIVE_STATE_CHANGED_AFTER_EXECUTION  "בוצע" — the live field changed since; calm, never called a failure;
 *   TARGET_NOT_FOUND                    a warning state (not normal successful history), no current value;
 *   READ_FAILED                         the live state is unknown right now — no current value is shown.
 * UNSUPPORTED_ACTION / INVARIANT_VIOLATION / no Outcome are omitted by the server (and logged).
 */
import type { PartnerActionOutcome } from "./outcome";

export const RECENT_OUTCOMES_DTO_VERSION = 1;
export const RECENT_OUTCOMES_LIMIT = 5;

export const OUTCOME_CARD_STATES = ["APPLIED_AS_EXPECTED", "LIVE_STATE_CHANGED_AFTER_EXECUTION", "TARGET_NOT_FOUND", "READ_FAILED"] as const;
export type OutcomeCardState = (typeof OUTCOME_CARD_STATES)[number];

export const OUTCOME_TEXT_HE: Record<OutcomeCardState, { badgeHe: string; statusHe: string }> = {
  APPLIED_AS_EXPECTED: { badgeHe: "בוצע", statusHe: "השינוי שבוצע עדיין תואם למצב הנוכחי." },
  LIVE_STATE_CHANGED_AFTER_EXECUTION: { badgeHe: "בוצע", statusHe: "הדדליין השתנה מאז הפעולה של Partner." },
  TARGET_NOT_FOUND: { badgeHe: "לתשומת לב", statusHe: "הפרויקט שעליו בוצעה הפעולה לא נמצא כרגע במערכת." },
  READ_FAILED: { badgeHe: "בוצע", statusHe: "לא הצלחתי לקרוא כרגע את המצב הנוכחי." },
};

export interface PartnerOutcomeCardDto {
  v: typeof RECENT_OUTCOMES_DTO_VERSION;
  state: OutcomeCardState;
  executedEventId: string;
  actionType: "UPDATE_PROJECT_DEADLINE";
  projectId: string;
  projectName: string;
  /** HISTORICAL — from the persisted snapshot + execution audit. */
  executedFrom: string;
  executedFromHe: string;
  executedTo: string;
  executedToHe: string;
  executedAt: string;
  executedAtHe: string;
  /** CURRENT — live canonical value; null when unknown / not found (never invented). */
  currentValue: string | null;
  currentValueHe: string | null;
  headlineHe: string;
  badgeHe: string;
  statusHe: string;
}

export interface RecentOutcomesResponse { v: typeof RECENT_OUTCOMES_DTO_VERSION; items: PartnerOutcomeCardDto[] }

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const ymdHe = (ymd: string) => `${ymd.slice(8, 10)}.${ymd.slice(5, 7)}.${ymd.slice(0, 4)}`;

/** Israel wall-clock "DD.MM.YYYY, HH:MM" (deterministic parts, no locale-dependent separators). */
export function instantHe(iso: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(iso));
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${g("day")}.${g("month")}.${g("year")}, ${g("hour")}:${g("minute")}`;
}

export class OutcomeDtoError extends Error {
  constructor(message: string) { super(message); this.name = "OutcomeDtoError"; }
}

/** Server side: display DTO from a derived Outcome. Throws for anything that must not be displayed. */
export function toOutcomeCardDto(o: PartnerActionOutcome): PartnerOutcomeCardDto {
  if (!(OUTCOME_CARD_STATES as readonly string[]).includes(o.state)) throw new OutcomeDtoError(`outcome state ${o.state} is not displayable`);
  if (o.actionType !== "UPDATE_PROJECT_DEADLINE" || !o.subject || !o.executed || !o.executedEventId) throw new OutcomeDtoError("outcome lacks the executed history");
  const { from, to, executedAt } = o.executed;
  if (!YMD.test(from) || !YMD.test(to) || Number.isNaN(Date.parse(executedAt))) throw new OutcomeDtoError("executed values are malformed");
  const state = o.state as OutcomeCardState;
  let currentValue: string | null = null;
  if (state === "APPLIED_AS_EXPECTED" || state === "LIVE_STATE_CHANGED_AFTER_EXECUTION") {
    currentValue = o.current?.value ?? null;
    if (currentValue !== null && !YMD.test(currentValue)) throw new OutcomeDtoError("current value is not a date");
    if ((state === "APPLIED_AS_EXPECTED") !== (currentValue === to)) throw new OutcomeDtoError("state and current value disagree");
  }
  const name = o.subjectLabel && o.subjectLabel.trim() ? o.subjectLabel.trim() : "הפרויקט";
  const text = OUTCOME_TEXT_HE[state];
  return {
    v: RECENT_OUTCOMES_DTO_VERSION,
    state,
    executedEventId: o.executedEventId,
    actionType: "UPDATE_PROJECT_DEADLINE",
    projectId: o.subject.id,
    projectName: name,
    executedFrom: from,
    executedFromHe: ymdHe(from),
    executedTo: to,
    executedToHe: ymdHe(to),
    executedAt,
    executedAtHe: instantHe(executedAt),
    currentValue,
    currentValueHe: state === "APPLIED_AS_EXPECTED" || state === "LIVE_STATE_CHANGED_AFTER_EXECUTION" ? (currentValue ? ymdHe(currentValue) : "ללא דדליין") : null,
    headlineHe: `הדדליין של '${name}' עודכן ל־${ymdHe(to)}`,
    badgeHe: text.badgeHe,
    statusHe: text.statusHe,
  };
}

const KEYS: Array<keyof PartnerOutcomeCardDto> = ["v", "state", "executedEventId", "actionType", "projectId", "projectName", "executedFrom", "executedFromHe", "executedTo", "executedToHe", "executedAt", "executedAtHe", "currentValue", "currentValueHe", "headlineHe", "badgeHe", "statusHe"];

function parseItem(x: unknown): PartnerOutcomeCardDto | null {
  if (typeof x !== "object" || x === null || Array.isArray(x)) return null;
  const r = x as Record<string, unknown>;
  const keys = Object.keys(r);
  if (keys.length !== KEYS.length || !KEYS.every((k) => keys.includes(k))) return null;
  if (r.v !== RECENT_OUTCOMES_DTO_VERSION || r.actionType !== "UPDATE_PROJECT_DEADLINE") return null;
  if (!(OUTCOME_CARD_STATES as readonly unknown[]).includes(r.state)) return null;
  const state = r.state as OutcomeCardState;
  if (r.badgeHe !== OUTCOME_TEXT_HE[state].badgeHe || r.statusHe !== OUTCOME_TEXT_HE[state].statusHe) return null;
  for (const k of ["projectName", "executedFromHe", "executedToHe", "executedAtHe", "headlineHe"] as const) {
    if (typeof r[k] !== "string" || (r[k] as string).length === 0 || (r[k] as string).length > 500) return null;
  }
  if (typeof r.executedEventId !== "string" || !UUID.test(r.executedEventId) || typeof r.projectId !== "string" || !UUID.test(r.projectId)) return null;
  if (typeof r.executedFrom !== "string" || !YMD.test(r.executedFrom) || typeof r.executedTo !== "string" || !YMD.test(r.executedTo) || r.executedFrom === r.executedTo) return null;
  if (r.executedFromHe !== ymdHe(r.executedFrom) || r.executedToHe !== ymdHe(r.executedTo)) return null;
  if (typeof r.executedAt !== "string" || Number.isNaN(Date.parse(r.executedAt))) return null;
  const live = state === "APPLIED_AS_EXPECTED" || state === "LIVE_STATE_CHANGED_AFTER_EXECUTION";
  if (live) {
    if (!(r.currentValue === null || (typeof r.currentValue === "string" && YMD.test(r.currentValue)))) return null;
    if ((state === "APPLIED_AS_EXPECTED") !== (r.currentValue === r.executedTo)) return null;
    if (r.currentValueHe !== (r.currentValue ? ymdHe(r.currentValue as string) : "ללא דדליין")) return null;
  } else if (r.currentValue !== null || r.currentValueHe !== null) return null;
  return r as unknown as PartnerOutcomeCardDto;
}

/** Client side: strict, fail-closed. Any malformed item → { ok: false } and nothing is rendered. */
export function parseRecentOutcomesResponse(json: unknown): { ok: true; items: PartnerOutcomeCardDto[] } | { ok: false } {
  if (typeof json !== "object" || json === null || Array.isArray(json)) return { ok: false };
  const r = json as Record<string, unknown>;
  if (r.v !== RECENT_OUTCOMES_DTO_VERSION || !Array.isArray(r.items) || Object.keys(r).length !== 2 || r.items.length > RECENT_OUTCOMES_LIMIT) return { ok: false };
  const items: PartnerOutcomeCardDto[] = [];
  const seen = new Set<string>();
  for (const x of r.items) {
    const p = parseItem(x);
    if (!p || seen.has(p.executedEventId)) return { ok: false };
    seen.add(p.executedEventId);
    items.push(p);
  }
  for (let i = 1; i < items.length; i++) if (Date.parse(items[i - 1].executedAt) < Date.parse(items[i].executedAt)) return { ok: false };
  return { ok: true, items };
}
