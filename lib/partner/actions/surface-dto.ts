/**
 * Redbloods Partner — Action surface DTO (Phase F.1I, v2 in F.1J). Pure;
 * shared by the Owner-only read route (builds it) and the dashboard card
 * (parses it).
 *
 * v2 (F.1J) adds what an Owner decision must echo back EXACTLY: the SHA-256 of
 * the snapshot the Owner is looking at and the chain head it saw — plus the
 * card state (SHOW = fresh proposal, AWAITING_EXECUTION = approved, not yet
 * executed) and the structured "change date" options. It still carries no
 * snapshot body, no event ids other than the head, no actor and no from / to
 * that a caller could submit (the server re-derives those).
 * The client parser is strict and fails closed: any malformed payload renders nothing.
 */
import { formatYmdHe } from "../investigation/answer-value";
import type { PartnerSuggestedAction } from "./types";

export const ACTION_SURFACE_DTO_VERSION = 2;
export const STATUS_LABEL_HE = "הצעה לפעולה";
export const AWAITING_LABEL_HE = "אושר — ממתין לביצוע";
const REASON_MARKER = "\n\nהסיבה: ";

/** The only answers "שנה תאריך" offers: the date-bearing answers of WHAT_IS_NEW_PROJECT_DEADLINE. */
export const CHANGE_VALUE_ANSWER_CODES = ["IN_ONE_WEEK", "IN_TWO_WEEKS", "END_OF_MONTH", "SPECIFIC_DATE"] as const;
export type ChangeValueAnswerCode = (typeof CHANGE_VALUE_ANSWER_CODES)[number];
export interface ChangeValueOption { code: ChangeValueAnswerCode; labelHe: string }

export type ActionCardState = "SHOW" | "AWAITING_EXECUTION";

export interface PartnerActionCardDto {
  v: typeof ACTION_SURFACE_DTO_VERSION;
  state: ActionCardState;
  actionId: string;
  actionType: "UPDATE_PROJECT_DEADLINE";
  projectId: string;
  projectName: string;
  /** YYYY-MM-DD as persisted today. */
  currentDeadline: string;
  currentDeadlineHe: string;
  /** YYYY-MM-DD the Partner proposes. */
  suggestedDeadline: string;
  suggestedDeadlineHe: string;
  headlineHe: string;
  /** The "why" part of the deterministic explanation (built from structured answers, never from notes). */
  reasonHe: string;
  explanationHe: string;
  statusLabelHe: string;
  /** SHA-256 of the exact snapshot shown — echoed back by a decision (never trusted for content). */
  snapshotHash: string;
  /** The chain head the Owner saw (null = no decision yet) — echoed back as expectedHeadEventId. */
  headEventId: string | null;
  /** "שנה תאריך" choices (labels from the investigation question). */
  changeValueOptions: ChangeValueOption[];
  /** Earliest date SPECIFIC_DATE may pick (today, Israel calendar). YYYY-MM-DD. */
  minChangeDate: string;
}

export interface ActionSurfaceResponse { v: typeof ACTION_SURFACE_DTO_VERSION; items: PartnerActionCardDto[] }

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Server side: the card DTO of one derived PROPOSED action. */
export function toActionCardDto(
  action: PartnerSuggestedAction,
  subjectLabelHe: string | null,
  extra: { state: ActionCardState; snapshotHash: string; headEventId: string | null; changeValueOptions: ChangeValueOption[]; minChangeDate: string },
): PartnerActionCardDto {
  const name = subjectLabelHe && subjectLabelHe.trim() ? subjectLabelHe.trim() : "הפרויקט";
  const idx = action.explanationHe.indexOf(REASON_MARKER);
  const reasonHe = idx >= 0 ? action.explanationHe.slice(idx + REASON_MARKER.length).trim() : "";
  return {
    v: ACTION_SURFACE_DTO_VERSION,
    state: extra.state,
    actionId: action.id,
    actionType: "UPDATE_PROJECT_DEADLINE",
    projectId: action.proposedChange.entityId,
    projectName: name,
    currentDeadline: action.proposedChange.from,
    currentDeadlineHe: formatYmdHe(action.proposedChange.from),
    suggestedDeadline: action.proposedChange.to,
    suggestedDeadlineHe: formatYmdHe(action.proposedChange.to),
    headlineHe: `הדדליין של '${name}' לא מעודכן.`,
    reasonHe,
    explanationHe: action.explanationHe,
    statusLabelHe: extra.state === "SHOW" ? STATUS_LABEL_HE : AWAITING_LABEL_HE,
    snapshotHash: extra.snapshotHash,
    headEventId: extra.headEventId,
    changeValueOptions: extra.changeValueOptions,
    minChangeDate: extra.minChangeDate,
  };
}

const KEYS: Array<keyof PartnerActionCardDto> = ["v", "state", "actionId", "actionType", "projectId", "projectName", "currentDeadline", "currentDeadlineHe", "suggestedDeadline", "suggestedDeadlineHe", "headlineHe", "reasonHe", "explanationHe", "statusLabelHe", "snapshotHash", "headEventId", "changeValueOptions", "minChangeDate"];

function parseItem(x: unknown): PartnerActionCardDto | null {
  if (typeof x !== "object" || x === null || Array.isArray(x)) return null;
  const r = x as Record<string, unknown>;
  const keys = Object.keys(r).sort();
  if (keys.length !== KEYS.length || !KEYS.every((k) => keys.includes(k))) return null;
  if (r.v !== ACTION_SURFACE_DTO_VERSION || r.actionType !== "UPDATE_PROJECT_DEADLINE") return null;
  if (r.state !== "SHOW" && r.state !== "AWAITING_EXECUTION") return null;
  if (r.statusLabelHe !== (r.state === "SHOW" ? STATUS_LABEL_HE : AWAITING_LABEL_HE)) return null;
  for (const k of ["actionId", "projectId", "projectName", "currentDeadlineHe", "suggestedDeadlineHe", "headlineHe", "reasonHe", "explanationHe"] as const) {
    if (typeof r[k] !== "string" || (r[k] as string).length === 0 || (r[k] as string).length > 2000) return null;
  }
  if (typeof r.currentDeadline !== "string" || !YMD.test(r.currentDeadline) || typeof r.suggestedDeadline !== "string" || !YMD.test(r.suggestedDeadline)) return null;
  if (r.currentDeadline === r.suggestedDeadline) return null;
  if (!(r.actionId as string).startsWith("UPDATE_PROJECT_DEADLINE:")) return null;
  if (typeof r.snapshotHash !== "string" || !HEX64.test(r.snapshotHash)) return null;
  if (!(r.headEventId === null || (typeof r.headEventId === "string" && UUID.test(r.headEventId)))) return null;
  if (typeof r.minChangeDate !== "string" || !YMD.test(r.minChangeDate)) return null;
  if (!Array.isArray(r.changeValueOptions) || r.changeValueOptions.length === 0 || r.changeValueOptions.length > CHANGE_VALUE_ANSWER_CODES.length) return null;
  for (const o of r.changeValueOptions) {
    if (typeof o !== "object" || o === null || Array.isArray(o)) return null;
    const oo = o as Record<string, unknown>;
    if (Object.keys(oo).length !== 2 || !(CHANGE_VALUE_ANSWER_CODES as readonly unknown[]).includes(oo.code) || typeof oo.labelHe !== "string" || !oo.labelHe) return null;
  }
  return r as unknown as PartnerActionCardDto;
}

/** Client side: strict, fail-closed. Any malformed field → { ok: false } and nothing is rendered. */
export function parseActionSurfaceResponse(json: unknown): { ok: true; items: PartnerActionCardDto[] } | { ok: false } {
  if (typeof json !== "object" || json === null || Array.isArray(json)) return { ok: false };
  const r = json as Record<string, unknown>;
  if (r.v !== ACTION_SURFACE_DTO_VERSION || !Array.isArray(r.items) || Object.keys(r).length !== 2) return { ok: false };
  const items: PartnerActionCardDto[] = [];
  for (const x of r.items) {
    const p = parseItem(x);
    if (!p) return { ok: false };
    items.push(p);
  }
  return { ok: true, items };
}
