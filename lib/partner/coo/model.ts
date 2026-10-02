/**
 * Sunny COO V1 — the shared model (pure). Interaction-time intelligence only: nothing here is stored, scheduled,
 * pushed or written. Every conclusion is DERIVED from canonical records and carries its evidence.
 *
 * Four epistemic layers, never mixed (Owner mission 2026-10-02):
 *   CONFIRMED  — an explicit record says it is closed (a stored crew name, a shoot date, a שולם row …)
 *   NOT_SEEN   — Sunny sees no record proving it. NEVER "missing": "אני לא רואה …", not "אין …"
 *   INSIGHT    — Sunny's inference (risk / stuck / gap) — a HYPOTHESIS until the Owner confirms
 *   RECOMMENDATION — what Sunny would do — executes nothing
 * A readiness state is a derived presentation word (מוכן / דורש תשומת לב / חסום / לא ידוע), never a DB status.
 */

export type ReadinessState = "READY" | "ATTENTION" | "BLOCKED" | "UNKNOWN";
export const READINESS_HE: Record<ReadinessState, string> = { READY: "מוכן", ATTENTION: "דורש תשומת לב", BLOCKED: "חסום", UNKNOWN: "לא ידוע" };

export type CheckDimension = "MONEY" | "PEOPLE" | "CREATIVE" | "LOGISTICS" | "EQUIPMENT" | "DEPENDENCIES" | "AFTER" | "OWNER_DECISION";
export const DIMENSION_HE: Record<CheckDimension, string> = {
  MONEY: "כסף", PEOPLE: "אנשים / צוות", CREATIVE: "קריאייטיב", LOGISTICS: "לוגיסטיקה", EQUIPMENT: "ציוד / קבצים",
  DEPENDENCIES: "תלויות לפני", AFTER: "מה אחרי", OWNER_DECISION: "החלטה שלך",
};

/**
 * CONFIRMED  a record proves it.
 * NOT_SEEN   no record proves it (absence of data ≠ proof it is missing operationally).
 * OPEN       a record shows it is open (e.g. a budget line with an unpaid remainder, a crew member not confirmed).
 * BLOCKED    a record says it is blocked (a stored blocker, a cancelled dependency).
 * UNREADABLE the source could not be read — unknown, never empty.
 */
export type CheckState = "CONFIRMED" | "NOT_SEEN" | "OPEN" | "BLOCKED" | "UNREADABLE";
export interface Evidence { source: string; ref: string | null; he: string }
export interface Check {
  id: string;
  dimension: CheckDimension;
  labelHe: string;
  state: CheckState;
  /** required = without it the event cannot happen as planned; optional items never make an event "not ready" alone. */
  required: boolean;
  he: string;
  evidence: Evidence[];
}

export const check = (id: string, dimension: CheckDimension, labelHe: string, state: CheckState, he: string, evidence: Evidence[] = [], required = true): Check =>
  ({ id, dimension, labelHe, state, required, he, evidence });
export const ev = (source: string, ref: string | null, he: string): Evidence => ({ source, ref, he });

/** The one readiness derivation: blocked > unreadable core > open / not seen on a required item > ready. */
export function deriveReadiness(checks: readonly Check[], coreReadable: boolean): ReadinessState {
  if (!coreReadable) return "UNKNOWN";
  if (checks.some((c) => c.state === "BLOCKED")) return "BLOCKED";
  const req = checks.filter((c) => c.required);
  if (req.length && req.every((c) => c.state === "UNREADABLE")) return "UNKNOWN";
  if (checks.some((c) => c.state === "OPEN") || req.some((c) => c.state === "NOT_SEEN" || c.state === "UNREADABLE")) return "ATTENTION";
  return "READY";
}

/** Natural Hebrew for one check state — never turns "not seen" into "missing". */
export function checkLineHe(c: Check): string {
  const mark = c.state === "CONFIRMED" ? "✓" : c.state === "BLOCKED" ? "✗" : "?";
  return `${mark} ${c.he}`;
}

export type CooEventKind = "SHOOT" | "SHOW" | "RELEASE" | "SESSION" | "MEETING" | "DEADLINE";
export const EVENT_KIND_HE: Record<CooEventKind, string> = { SHOOT: "צילום", SHOW: "הופעה", RELEASE: "ריליס", SESSION: "סשן", MEETING: "פגישה", DEADLINE: "דדליין" };

export interface Readiness {
  key: string;
  kind: CooEventKind;
  titleHe: string;
  date: string | null;
  time: string | null;
  daysTo: number | null;
  entity: string | null;
  project: string | null;
  state: ReadinessState;
  stateHe: string;
  confirmed: string[];
  notSeen: string[];
  open: string[];
  blocked: string[];
  ownerAttention: string[];
  checks: Check[];
  /** Sunny's inferences about this event — HYPOTHESIS, never fact. */
  insights: string[];
  /** Record-derived facts shown as context (money totals, publish date …) — DERIVED from records, not inferences. */
  facts: string[];
  recommendationHe: string | null;
  /** A short natural-Hebrew COO paragraph (✓ / ? / → lines). */
  narrativeHe: string;
  sources: string[];
}

/**
 * INTERNAL heuristics — engineering floors only. NONE of these is Owner policy, none is served as a business rule,
 * and none decides that something is "stuck". They exist only where a pattern cannot be described without a number,
 * and every finding that uses one says so (heuristic: true).
 */
export const INTERNAL_COO_HEURISTICS = {
  /** default look-ahead for readiness / priorities (a window to look at, not a deadline rule) */
  horizonDays: 14,
  /** schedule window (the Owner's "this week") */
  scheduleDays: 7,
  /** a day with at least this many busy minutes counts as "full" for the HEAVY_STRETCH pattern */
  heavyDayBusyMinutes: 8 * 60,
  /** consecutive full days that make a "stretch" */
  heavyStretchDays: 3,
} as const;

/** The executive list is a PRESENTATION limit, not a business rule. */
export const COO_MAX_PRIORITIES = 5;

export const DAY_MS = 86_400_000;
export const daysBetween = (fromYmd: string, toYmd: string) => Math.round((Date.parse(`${toYmd}T00:00:00Z`) - Date.parse(`${fromYmd}T00:00:00Z`)) / DAY_MS);
export const isYmd = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
export const ymdOf = (s: string | null | undefined): string | null => (s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null);
export const addDaysYmd = (ymd: string, n: number) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
export const heDate = (ymd: string | null) => (ymd ? `${ymd.slice(8, 10)}.${ymd.slice(5, 7)}` : "?");
export function whenHe(daysTo: number | null, ymd: string | null): string {
  if (daysTo === null) return ymd ? heDate(ymd) : "תאריך לא ידוע";
  if (daysTo === 0) return "היום";
  if (daysTo === 1) return "מחר";
  if (daysTo < 0) return `לפני ${-daysTo} ימים`;
  return `בעוד ${daysTo} ימים (${heDate(ymd)})`;
}
const present = (v: unknown) => (typeof v === "string" ? v.trim().length > 0 : v !== null && v !== undefined);
export const has = present;

/** Builds the ✓ / ? / → paragraph from the checks (Hebrew, short). */
export function narrative(title: string, state: ReadinessState, checks: readonly Check[], recommendation: string | null, maxLines = 6): string {
  const lines = [`${title} — ${READINESS_HE[state]}`];
  const shown = [...checks.filter((c) => c.state === "BLOCKED"), ...checks.filter((c) => c.state === "CONFIRMED" && c.required), ...checks.filter((c) => c.state === "OPEN"), ...checks.filter((c) => c.state === "NOT_SEEN" && c.required), ...checks.filter((c) => c.state === "UNREADABLE")];
  for (const c of shown.slice(0, maxLines)) lines.push(checkLineHe(c));
  if (recommendation) lines.push(`→ ${recommendation}`);
  return lines.join("\n");
}

export function finishReadiness(r: Omit<Readiness, "state" | "stateHe" | "confirmed" | "notSeen" | "open" | "blocked" | "narrativeHe" | "recommendationHe" | "ownerAttention" | "facts"> & { coreReadable: boolean; ownerAttention?: string[]; facts?: string[] }): Readiness {
  const state = deriveReadiness(r.checks, r.coreReadable);
  const blocked = r.checks.filter((c) => c.state === "BLOCKED").map((c) => c.he);
  const open = r.checks.filter((c) => c.state === "OPEN").map((c) => c.he);
  const notSeen = r.checks.filter((c) => c.state === "NOT_SEEN" || c.state === "UNREADABLE").map((c) => c.he);
  const confirmed = r.checks.filter((c) => c.state === "CONFIRMED").map((c) => c.he);
  const toClose = [...r.checks.filter((c) => c.state === "BLOCKED"), ...r.checks.filter((c) => c.state === "OPEN"), ...r.checks.filter((c) => c.required && c.state === "NOT_SEEN")];
  const ownerAttention = r.ownerAttention ?? toClose.slice(0, 3).map((c) => c.labelHe);
  const recommendationHe = state === "READY" ? null : state === "UNKNOWN" ? "לא נקראו מספיק נתונים כדי לבדוק — שווה לוודא ישירות." : toClose.length ? `הייתי סוגרת: ${toClose.slice(0, 3).map((c) => c.labelHe).join(", ")}.` : null;
  const { coreReadable: _c, facts, ...rest } = r;
  void _c;
  return { ...rest, facts: facts ?? [], state, stateHe: READINESS_HE[state], confirmed, notSeen, open, blocked, ownerAttention, recommendationHe, narrativeHe: narrative(`${EVENT_KIND_HE[r.kind]} ${r.titleHe} ${whenHe(r.daysTo, r.date)}`, state, r.checks, recommendationHe) };
}
