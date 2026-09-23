/**
 * Redbloods Partner — Finance Brief display DTO (Finance Brain V1). Pure; shared by server and client.
 * Display data only (no raw evidence). The client parses it strictly and renders nothing on any
 * malformed field (fail closed).
 *
 * v2 (F2.5–F2.7): adds `rehab` — the "צריך ממך" section: at most 3 rehabilitation items and at
 * most 2 structured Owner questions.
 * v3 (F2.8–F2.10): an answerable question carries `answer` — its deterministic questionId, the
 * fingerprint of exactly what the Owner sees, and (when the facts changed since an earlier answer) that
 * earlier answer's label. Options carry their codes. Display-only questions carry `answer: null`.
 * `questionsNoteHe` explains when questions are hidden (Owner answers could not be read — never re-ask blindly).
 * Item epistemic OWNER_DECISION = what the Owner said (Owner Context), never a financial fact.
 */
export const FINANCE_BRIEF_DTO_VERSION = 3;
export const FINANCE_BRIEF_MAX_ITEMS = 5;
export const FINANCE_REHAB_MAX_ITEMS = 3;
export const FINANCE_REHAB_MAX_QUESTIONS = 2;

export const FINANCE_BRIEF_FAMILIES = [
  "FINANCIAL_DATA_BLOCKER", "OVERDUE_COLLECTION", "UPCOMING_COLLECTION", "COLLECTION_NO_DATE",
  "COMMITTED_EXPENSE", "MISSING_EXPECTED_RECORD", "REVENUE_OPPORTUNITY", "RECURRING_EXPENSE_REVIEW",
] as const;
export type FinanceBriefFamily = (typeof FINANCE_BRIEF_FAMILIES)[number];
export const FINANCE_EPISTEMIC = ["FACT", "DERIVED", "HYPOTHESIS", "UNKNOWN", "OWNER_DECISION"] as const;
export type FinanceBriefEpistemic = (typeof FINANCE_EPISTEMIC)[number];

export interface FinanceBriefItemDto { family: FinanceBriefFamily; epistemic: FinanceBriefEpistemic; textHe: string }
export interface FinanceRehabItemDto { issueType: string; epistemic: FinanceBriefEpistemic; textHe: string }
export interface FinanceAnswerOptionDto { code: string; labelHe: string }
export interface FinanceQuestionAnswerDto {
  questionId: string;
  /** SHA-256 of the question exactly as shown; sent back as seenQuestionFingerprint. */
  fingerprint: string;
  /** The option code that needs an explicit date (EXACT_DATE), if any. */
  exactDateCode: string | null;
  /** The facts changed since an earlier answer — shown as "ענית בעבר: …"; a new answer supersedes it. */
  previousAnswerHe: string | null;
}
export interface FinanceRehabQuestionDto {
  questionType: string;
  textHe: string;
  whyHe: string;
  options: FinanceAnswerOptionDto[];
  /** null = display-only (cannot be answered here). */
  answer: FinanceQuestionAnswerDto | null;
}
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
  /** "צריך ממך" — rehabilitation items (≤3) and Owner questions (≤2). */
  rehab: { items: FinanceRehabItemDto[]; questions: FinanceRehabQuestionDto[]; questionsNoteHe: string | null };
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
const CODE_RE = /^[A-Z][A-Z0-9_]{1,60}$/;
const HEX64_RE = /^[0-9a-f]{64}$/;
/** finance:<ISSUE_TYPE>:<subject_type>:<subjectId>::FINANCE_<TYPE> (see owner-answers.ts). */
export const FINANCE_QUESTION_ID_RE = /^finance:[A-Z_]{3,60}:[a-z_]{2,40}:[^\n\r]{1,300}::FINANCE_[A-Z_]{3,60}$/;

function validQuestion(q: unknown): boolean {
  if (!isObj(q) || !exactKeys(q, ["questionType", "textHe", "whyHe", "options", "answer"]) || typeof q.questionType !== "string" || !ISSUE_RE.test(q.questionType) || !str(q.textHe, 400) || !str(q.whyHe, 400)) return false;
  if (!Array.isArray(q.options) || q.options.length < 2 || q.options.length > 8) return false;
  const codes = new Set<string>();
  for (const o of q.options) {
    if (!isObj(o) || !exactKeys(o, ["code", "labelHe"]) || typeof o.code !== "string" || !CODE_RE.test(o.code) || !str(o.labelHe, 80) || codes.has(o.code)) return false;
    codes.add(o.code);
  }
  const a = q.answer;
  if (a === null) return true;
  if (!isObj(a) || !exactKeys(a, ["questionId", "fingerprint", "exactDateCode", "previousAnswerHe"])) return false;
  if (typeof a.questionId !== "string" || !FINANCE_QUESTION_ID_RE.test(a.questionId) || !a.questionId.endsWith(`::${q.questionType}`)) return false;
  if (typeof a.fingerprint !== "string" || !HEX64_RE.test(a.fingerprint)) return false;
  if (a.exactDateCode !== null && !(typeof a.exactDateCode === "string" && codes.has(a.exactDateCode))) return false;
  return strOrNull(a.previousAnswerHe, 200);
}

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
  if (!isObj(r) || !exactKeys(r, ["items", "questions", "questionsNoteHe"]) || !Array.isArray(r.items) || !Array.isArray(r.questions) || !strOrNull(r.questionsNoteHe, 300)) return { ok: false };
  if (r.items.length > FINANCE_REHAB_MAX_ITEMS || r.questions.length > FINANCE_REHAB_MAX_QUESTIONS) return { ok: false };
  const seenIssue = new Set<string>();
  for (const it of r.items) {
    if (!isObj(it) || !exactKeys(it, ["issueType", "epistemic", "textHe"]) || typeof it.issueType !== "string" || !ISSUE_RE.test(it.issueType) || !(FINANCE_EPISTEMIC as readonly unknown[]).includes(it.epistemic) || !str(it.textHe, 400)) return { ok: false };
    if (seenIssue.has(it.textHe as string)) return { ok: false };
    seenIssue.add(it.textHe as string);
  }
  const seenQ = new Set<string>();
  for (const q of r.questions) {
    if (!validQuestion(q)) return { ok: false };
    const id = (q as { answer: { questionId: string } | null }).answer?.questionId;
    if (id) { if (seenQ.has(id)) return { ok: false }; seenQ.add(id); }
  }
  if ((json.items.length === 0 && r.items.length === 0) !== (json.calmHe !== null)) return { ok: false };
  return { ok: true, brief: json as unknown as FinanceBriefDto };
}
