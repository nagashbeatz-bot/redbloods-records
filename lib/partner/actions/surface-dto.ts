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
 * v3 (F.1K): an AWAITING_EXECUTION card is built from the PERSISTED APPROVED snapshot (exactly what was
 * approved, never a newer derivation) and carries its approvalEventId — the only id "בצע עכשיו" sends.
 * The client parser is strict and fails closed: any malformed payload renders nothing.
 */
import { formatYmdHe } from "../investigation/answer-value";
import type { PartnerSuggestedAction } from "./types";
import type { FinanceActionSnapshotV1 } from "./finance-events";
import { salaryMonthLabel } from "../../victor-salary-format";

export const ACTION_SURFACE_DTO_VERSION = 3;
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
  /** AWAITING_EXECUTION only: the APPROVED event to execute (null on a SHOW card). */
  approvalEventId: string | null;
  /** "שנה תאריך" choices (labels from the investigation question). */
  changeValueOptions: ChangeValueOption[];
  /** Earliest date SPECIFIC_DATE may pick (today, Israel calendar). YYYY-MM-DD. */
  minChangeDate: string;
}

/**
 * F2.31 — a RECORD_PAID_EXPENSE (Victor salary) Suggested Action card. Business language only; it carries
 * exactly what a decision must echo back (snapshotHash, headEventId, approvalEventId) and nothing a caller could
 * submit as a value (the server re-derives amount / currency / date / description).
 */
export interface FinanceActionCardDto {
  v: typeof ACTION_SURFACE_DTO_VERSION;
  state: ActionCardState;
  actionId: string;
  actionType: "RECORD_PAID_EXPENSE";
  /** "אפשר לרשום את משכורת Victor של אוגוסט בכספים." */
  headlineHe: string;
  /** "משכורת Victor — אוגוסט 2026" */
  titleHe: string;
  /** "$550" */
  amountHe: string;
  paymentStatusHe: "שולם";
  /** "10.09.2026" */
  paymentDateHe: string;
  reasonHe: string;
  statusLabelHe: string;
  snapshotHash: string;
  headEventId: string | null;
  approvalEventId: string | null;
}
export type ActionSurfaceItemDto = PartnerActionCardDto | FinanceActionCardDto;

export interface ActionSurfaceResponse { v: typeof ACTION_SURFACE_DTO_VERSION; items: ActionSurfaceItemDto[] }

const ymdHe = (ymd: string) => `${ymd.slice(8, 10)}.${ymd.slice(5, 7)}.${ymd.slice(0, 4)}`;
const moneyHe = (currency: string, amount: number) => `${currency}${amount.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

/** Server side: the finance card of a live (SHOW) or persisted APPROVED (AWAITING_EXECUTION) snapshot. */
export function toFinanceActionCardDto(
  snap: FinanceActionSnapshotV1,
  extra: { state: ActionCardState; snapshotHash: string; headEventId: string | null; approvalEventId: string | null },
): FinanceActionCardDto {
  const f = snap.facts;
  const monthLabel = salaryMonthLabel(snap.period);
  return {
    v: ACTION_SURFACE_DTO_VERSION,
    state: extra.state,
    actionId: snap.id,
    actionType: "RECORD_PAID_EXPENSE",
    headlineHe: `אפשר לרשום את משכורת Victor של ${monthLabel.split(" ")[0]} בכספים.`,
    titleHe: `משכורת Victor — ${monthLabel}`,
    amountHe: moneyHe(f.currency, f.amount),
    paymentStatusHe: "שולם",
    paymentDateHe: ymdHe(f.date),
    reasonHe: `אישרת שהמשכורת שולמה ב־${ymdHe(f.date)} — והיא עדיין לא רשומה בכספים.`,
    statusLabelHe: extra.state === "SHOW" ? STATUS_LABEL_HE : AWAITING_LABEL_HE,
    snapshotHash: extra.snapshotHash,
    headEventId: extra.headEventId,
    approvalEventId: extra.approvalEventId,
  };
}

const FINANCE_KEYS: Array<keyof FinanceActionCardDto> = ["v", "state", "actionId", "actionType", "headlineHe", "titleHe", "amountHe", "paymentStatusHe", "paymentDateHe", "reasonHe", "statusLabelHe", "snapshotHash", "headEventId", "approvalEventId"];
const UUID_ANYWHERE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function parseFinanceItem(r: Record<string, unknown>): FinanceActionCardDto | null {
  const keys = Object.keys(r);
  if (keys.length !== FINANCE_KEYS.length || !FINANCE_KEYS.every((k) => keys.includes(k))) return null;
  if (r.v !== ACTION_SURFACE_DTO_VERSION || r.actionType !== "RECORD_PAID_EXPENSE" || r.paymentStatusHe !== "שולם") return null;
  if (r.state !== "SHOW" && r.state !== "AWAITING_EXECUTION") return null;
  if (r.statusLabelHe !== (r.state === "SHOW" ? STATUS_LABEL_HE : AWAITING_LABEL_HE)) return null;
  if (typeof r.actionId !== "string" || !r.actionId.startsWith("RECORD_PAID_EXPENSE:") || r.actionId.length > 300) return null;
  for (const k of ["headlineHe", "titleHe", "amountHe", "paymentDateHe", "reasonHe"] as const) {
    if (typeof r[k] !== "string" || (r[k] as string).length === 0 || (r[k] as string).length > 500 || UUID_ANYWHERE.test(r[k] as string)) return null;
  }
  if (!/^\d{2}\.\d{2}\.\d{4}$/.test(r.paymentDateHe as string)) return null;
  if (typeof r.snapshotHash !== "string" || !HEX64.test(r.snapshotHash)) return null;
  if (!(r.headEventId === null || (typeof r.headEventId === "string" && UUID.test(r.headEventId)))) return null;
  if (r.state === "AWAITING_EXECUTION" ? !(typeof r.approvalEventId === "string" && UUID.test(r.approvalEventId) && r.approvalEventId === r.headEventId) : r.approvalEventId !== null) return null;
  return r as unknown as FinanceActionCardDto;
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Server side: the card DTO of one derived PROPOSED action. */
export function toActionCardDto(
  action: PartnerSuggestedAction,
  subjectLabelHe: string | null,
  extra: { state: ActionCardState; snapshotHash: string; headEventId: string | null; approvalEventId: string | null; changeValueOptions: ChangeValueOption[]; minChangeDate: string },
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
    approvalEventId: extra.approvalEventId,
    changeValueOptions: extra.changeValueOptions,
    minChangeDate: extra.minChangeDate,
  };
}

const KEYS: Array<keyof PartnerActionCardDto> = ["v", "state", "actionId", "actionType", "projectId", "projectName", "currentDeadline", "currentDeadlineHe", "suggestedDeadline", "suggestedDeadlineHe", "headlineHe", "reasonHe", "explanationHe", "statusLabelHe", "snapshotHash", "headEventId", "approvalEventId", "changeValueOptions", "minChangeDate"];

function parseItem(x: unknown): ActionSurfaceItemDto | null {
  if (typeof x !== "object" || x === null || Array.isArray(x)) return null;
  const r = x as Record<string, unknown>;
  if (r.actionType === "RECORD_PAID_EXPENSE") return parseFinanceItem(r);
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
  // approvalEventId exactly on AWAITING_EXECUTION (a uuid), and there it is the chain head.
  if (r.state === "AWAITING_EXECUTION" ? !(typeof r.approvalEventId === "string" && UUID.test(r.approvalEventId) && r.approvalEventId === r.headEventId) : r.approvalEventId !== null) return null;
  if (!Array.isArray(r.changeValueOptions) || r.changeValueOptions.length === 0 || r.changeValueOptions.length > CHANGE_VALUE_ANSWER_CODES.length) return null;
  for (const o of r.changeValueOptions) {
    if (typeof o !== "object" || o === null || Array.isArray(o)) return null;
    const oo = o as Record<string, unknown>;
    if (Object.keys(oo).length !== 2 || !(CHANGE_VALUE_ANSWER_CODES as readonly unknown[]).includes(oo.code) || typeof oo.labelHe !== "string" || !oo.labelHe) return null;
  }
  return r as unknown as PartnerActionCardDto;
}

/** Client side: strict, fail-closed. Any malformed field → { ok: false } and nothing is rendered. */
export function parseActionSurfaceResponse(json: unknown): { ok: true; items: ActionSurfaceItemDto[] } | { ok: false } {
  if (typeof json !== "object" || json === null || Array.isArray(json)) return { ok: false };
  const r = json as Record<string, unknown>;
  if (r.v !== ACTION_SURFACE_DTO_VERSION || !Array.isArray(r.items) || Object.keys(r).length !== 2) return { ok: false };
  const items: ActionSurfaceItemDto[] = [];
  for (const x of r.items) {
    const p = parseItem(x);
    if (!p) return { ok: false };
    items.push(p);
  }
  return { ok: true, items };
}
