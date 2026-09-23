/**
 * Redbloods Partner — Finance Brief display DTO (Finance Brain V1). Pure; shared by server and client.
 * Display data only (no ids, no raw evidence). The client parses it strictly and renders nothing on any
 * malformed field (fail closed).
 */
export const FINANCE_BRIEF_DTO_VERSION = 1;
export const FINANCE_BRIEF_MAX_ITEMS = 5;

export const FINANCE_BRIEF_FAMILIES = [
  "FINANCIAL_DATA_BLOCKER", "OVERDUE_COLLECTION", "UPCOMING_COLLECTION", "COLLECTION_NO_DATE",
  "COMMITTED_EXPENSE", "MISSING_EXPECTED_RECORD", "REVENUE_OPPORTUNITY", "RECURRING_EXPENSE_REVIEW",
] as const;
export type FinanceBriefFamily = (typeof FINANCE_BRIEF_FAMILIES)[number];
export const FINANCE_EPISTEMIC = ["FACT", "DERIVED", "HYPOTHESIS", "UNKNOWN"] as const;
export type FinanceBriefEpistemic = (typeof FINANCE_EPISTEMIC)[number];

export interface FinanceBriefItemDto { family: FinanceBriefFamily; epistemic: FinanceBriefEpistemic; textHe: string }
export interface FinanceBriefSummaryDto {
  /** "לפי הנתונים הרשומים כרגע" when coverage is partial — the net is never presented as authoritative then. */
  basisHe: string;
  recordedNetIls: number;
  floorIls: number;
  preferredIls: number;
  gapToFloor: number;
  gapToPreferred: number;
  daysRemaining: number;
  lineHe: string;
  positionLineHe: string | null;
  otherCurrencyLineHe: string | null;
}
export interface FinanceBriefDto {
  v: typeof FINANCE_BRIEF_DTO_VERSION;
  month: string;
  asOfDate: string;
  coverage: "RELIABLE" | "PARTIAL";
  coverageNoteHe: string | null;
  summary: FinanceBriefSummaryDto;
  items: FinanceBriefItemDto[];
  /** Only when nothing needs the Owner. */
  calmHe: string | null;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown, max = 600) => typeof v === "string" && v.length > 0 && v.length <= max;
const strOrNull = (v: unknown, max = 600) => v === null || str(v, max);
const fin = (v: unknown) => typeof v === "number" && Number.isFinite(v);
const exactKeys = (o: Record<string, unknown>, keys: readonly string[]) => { const k = Object.keys(o); return k.length === keys.length && keys.every((x) => k.includes(x)); };
const SUMMARY_KEYS = ["basisHe", "recordedNetIls", "floorIls", "preferredIls", "gapToFloor", "gapToPreferred", "daysRemaining", "lineHe", "positionLineHe", "otherCurrencyLineHe"] as const;
const DTO_KEYS = ["v", "month", "asOfDate", "coverage", "coverageNoteHe", "summary", "items", "calmHe"] as const;

/** Client side: strict, fail-closed. */
export function parseFinanceBriefResponse(json: unknown): { ok: true; brief: FinanceBriefDto } | { ok: false } {
  if (!isObj(json) || !exactKeys(json, DTO_KEYS)) return { ok: false };
  if (json.v !== FINANCE_BRIEF_DTO_VERSION || !/^\d{4}-\d{2}$/.test(String(json.month)) || !/^\d{4}-\d{2}-\d{2}$/.test(String(json.asOfDate))) return { ok: false };
  if (json.coverage !== "RELIABLE" && json.coverage !== "PARTIAL") return { ok: false };
  if (!strOrNull(json.coverageNoteHe) || !strOrNull(json.calmHe)) return { ok: false };
  if (json.coverage === "PARTIAL" && !json.coverageNoteHe) return { ok: false };
  const s = json.summary;
  if (!isObj(s) || !exactKeys(s, SUMMARY_KEYS)) return { ok: false };
  if (!str(s.basisHe) || !str(s.lineHe) || !strOrNull(s.positionLineHe) || !strOrNull(s.otherCurrencyLineHe)) return { ok: false };
  for (const k of ["recordedNetIls", "floorIls", "preferredIls", "gapToFloor", "gapToPreferred", "daysRemaining"] as const) if (!fin(s[k])) return { ok: false };
  if (!Array.isArray(json.items) || json.items.length > FINANCE_BRIEF_MAX_ITEMS) return { ok: false };
  const seen = new Set<string>();
  for (const it of json.items) {
    if (!isObj(it) || !exactKeys(it, ["family", "epistemic", "textHe"])) return { ok: false };
    if (!(FINANCE_BRIEF_FAMILIES as readonly unknown[]).includes(it.family) || !(FINANCE_EPISTEMIC as readonly unknown[]).includes(it.epistemic) || !str(it.textHe, 400)) return { ok: false };
    if (seen.has(it.family as string)) return { ok: false };
    seen.add(it.family as string);
  }
  if ((json.items.length === 0) !== (json.calmHe !== null)) return { ok: false };
  return { ok: true, brief: json as unknown as FinanceBriefDto };
}
