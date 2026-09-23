/**
 * Redbloods Partner — Finance Brief display DTO (Finance Brain V1). Pure; shared by server and client.
 * Display data only (no ids, no raw evidence). The client parses it strictly and renders nothing on any
 * malformed field (fail closed).
 *
 * v2 (F2.5–F2.7): adds `rehab` — the read-only "צריך ממך" section: at most 3 rehabilitation items and at
 * most 2 structured Owner questions (display only — there is no way to answer them here yet).
 */
export const FINANCE_BRIEF_DTO_VERSION = 2;
export const FINANCE_BRIEF_MAX_ITEMS = 5;
export const FINANCE_REHAB_MAX_ITEMS = 3;
export const FINANCE_REHAB_MAX_QUESTIONS = 2;

export const FINANCE_BRIEF_FAMILIES = [
  "FINANCIAL_DATA_BLOCKER", "OVERDUE_COLLECTION", "UPCOMING_COLLECTION", "COLLECTION_NO_DATE",
  "COMMITTED_EXPENSE", "MISSING_EXPECTED_RECORD", "REVENUE_OPPORTUNITY", "RECURRING_EXPENSE_REVIEW",
] as const;
export type FinanceBriefFamily = (typeof FINANCE_BRIEF_FAMILIES)[number];
export const FINANCE_EPISTEMIC = ["FACT", "DERIVED", "HYPOTHESIS", "UNKNOWN"] as const;
export type FinanceBriefEpistemic = (typeof FINANCE_EPISTEMIC)[number];

export interface FinanceBriefItemDto { family: FinanceBriefFamily; epistemic: FinanceBriefEpistemic; textHe: string }
export interface FinanceRehabItemDto { issueType: string; epistemic: FinanceBriefEpistemic; textHe: string }
export interface FinanceRehabQuestionDto { questionType: string; textHe: string; whyHe: string; options: string[] }
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
  /** "צריך ממך" — read-only rehabilitation items (≤3) and suggested questions (≤2). */
  rehab: { items: FinanceRehabItemDto[]; questions: FinanceRehabQuestionDto[] };
  /** Only when nothing (main or rehab) needs the Owner. */
  calmHe: string | null;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown, max = 600) => typeof v === "string" && v.length > 0 && v.length <= max;
const strOrNull = (v: unknown, max = 600) => v === null || str(v, max);
const fin = (v: unknown) => typeof v === "number" && Number.isFinite(v);
const exactKeys = (o: Record<string, unknown>, keys: readonly string[]) => { const k = Object.keys(o); return k.length === keys.length && keys.every((x) => k.includes(x)); };
const SUMMARY_KEYS = ["basisHe", "recordedNetIls", "floorIls", "preferredIls", "gapToFloor", "gapToPreferred", "daysRemaining", "lineHe", "positionLineHe", "otherCurrencyLineHe"] as const;
const DTO_KEYS = ["v", "month", "asOfDate", "coverage", "coverageNoteHe", "summary", "items", "rehab", "calmHe"] as const;
const ISSUE_RE = /^[A-Z_]{3,60}$/;

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
  const r = json.rehab;
  if (!isObj(r) || !exactKeys(r, ["items", "questions"]) || !Array.isArray(r.items) || !Array.isArray(r.questions)) return { ok: false };
  if (r.items.length > FINANCE_REHAB_MAX_ITEMS || r.questions.length > FINANCE_REHAB_MAX_QUESTIONS) return { ok: false };
  const seenIssue = new Set<string>();
  for (const it of r.items) {
    if (!isObj(it) || !exactKeys(it, ["issueType", "epistemic", "textHe"]) || typeof it.issueType !== "string" || !ISSUE_RE.test(it.issueType) || !(FINANCE_EPISTEMIC as readonly unknown[]).includes(it.epistemic) || !str(it.textHe, 400)) return { ok: false };
    if (seenIssue.has(it.textHe as string)) return { ok: false };
    seenIssue.add(it.textHe as string);
  }
  for (const q of r.questions) {
    if (!isObj(q) || !exactKeys(q, ["questionType", "textHe", "whyHe", "options"]) || typeof q.questionType !== "string" || !ISSUE_RE.test(q.questionType) || !str(q.textHe, 400) || !str(q.whyHe, 400)) return { ok: false };
    if (!Array.isArray(q.options) || q.options.length < 2 || q.options.length > 8 || !q.options.every((o) => str(o, 80))) return { ok: false };
  }
  if ((json.items.length === 0 && r.items.length === 0) !== (json.calmHe !== null)) return { ok: false };
  return { ok: true, brief: json as unknown as FinanceBriefDto };
}
