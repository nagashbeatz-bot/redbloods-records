/**
 * Redbloods Partner — Action surface DTO (Phase F.1I). Pure; shared by the
 * Owner-only read route (builds it) and the dashboard card (parses it).
 *
 * READ-ONLY: the DTO carries only what the card displays. It carries no
 * snapshot, hash, event id or request id — nothing a caller could use to
 * decide or execute (that is F.1J). The client parser is strict and fails
 * closed: any malformed payload renders nothing.
 */
import { formatYmdHe } from "../investigation/answer-value";
import type { PartnerSuggestedAction } from "./types";

export const ACTION_SURFACE_DTO_VERSION = 1;
export const STATUS_LABEL_HE = "הצעה לפעולה";
const REASON_MARKER = "\n\nהסיבה: ";

export interface PartnerActionCardDto {
  v: typeof ACTION_SURFACE_DTO_VERSION;
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
  /** The full deterministic explanation as derived. */
  explanationHe: string;
  statusLabelHe: typeof STATUS_LABEL_HE;
}

export interface ActionSurfaceResponse { v: typeof ACTION_SURFACE_DTO_VERSION; items: PartnerActionCardDto[] }

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** Server side: the card DTO of one PROPOSED action. */
export function toActionCardDto(action: PartnerSuggestedAction, subjectLabelHe: string | null): PartnerActionCardDto {
  const name = subjectLabelHe && subjectLabelHe.trim() ? subjectLabelHe.trim() : "הפרויקט";
  const idx = action.explanationHe.indexOf(REASON_MARKER);
  const reasonHe = idx >= 0 ? action.explanationHe.slice(idx + REASON_MARKER.length).trim() : "";
  return {
    v: ACTION_SURFACE_DTO_VERSION,
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
    statusLabelHe: STATUS_LABEL_HE,
  };
}

const KEYS: Array<keyof PartnerActionCardDto> = ["v", "actionId", "actionType", "projectId", "projectName", "currentDeadline", "currentDeadlineHe", "suggestedDeadline", "suggestedDeadlineHe", "headlineHe", "reasonHe", "explanationHe", "statusLabelHe"];

function parseItem(x: unknown): PartnerActionCardDto | null {
  if (typeof x !== "object" || x === null || Array.isArray(x)) return null;
  const r = x as Record<string, unknown>;
  const keys = Object.keys(r).sort();
  if (keys.length !== KEYS.length || !KEYS.every((k) => keys.includes(k))) return null;
  if (r.v !== ACTION_SURFACE_DTO_VERSION || r.actionType !== "UPDATE_PROJECT_DEADLINE" || r.statusLabelHe !== STATUS_LABEL_HE) return null;
  for (const k of ["actionId", "projectId", "projectName", "currentDeadlineHe", "suggestedDeadlineHe", "headlineHe", "reasonHe", "explanationHe"] as const) {
    if (typeof r[k] !== "string" || (r[k] as string).length === 0 || (r[k] as string).length > 2000) return null;
  }
  if (typeof r.currentDeadline !== "string" || !YMD.test(r.currentDeadline) || typeof r.suggestedDeadline !== "string" || !YMD.test(r.suggestedDeadline)) return null;
  if (r.currentDeadline === r.suggestedDeadline) return null;
  if (!(r.actionId as string).startsWith("UPDATE_PROJECT_DEADLINE:")) return null;
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
