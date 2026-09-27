/**
 * The ONE project-overdue rule (B5, 2026-09-27) — pure, client + server safe (no Supabase / server imports).
 *
 * A project is overdue only when ALL hold:
 *   1. its deadline is a strict "YYYY-MM-DD" calendar date (projects.deadline is TEXT — anything else is NOT overdue
 *      and is surfaced as a parse issue by readers that report issues: `deadlineParseIssue`);
 *   2. that date is strictly before the Israel calendar day (Asia/Jerusalem, DST-safe — never the host's timezone);
 *   3. its status is not closed: הושלם / בוטל / בהשהייה (Owner: completed, cancelled and on-hold are never overdue);
 *   4. it is not hidden (`isHidden === true` → never overdue). Callers that already filter hidden projects out of
 *      their list / push query (the dashboard list, the push digest query) may omit `isHidden`; passing it keeps the
 *      rule explicit.
 *
 * Every UI helper, report, the push digest, the agent snapshot and Sunny's readers use this module, so the same
 * project is overdue (or not) everywhere.
 */

/** Statuses that are never overdue / never a deadline candidate (completed, cancelled, on hold). */
export const NOT_OVERDUE_STATUSES: readonly string[] = ["הושלם", "בוטל", "בהשהייה"];

const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A strict, real calendar date "YYYY-MM-DD" (rejects "2026-02-30", timestamps, free text). */
export function isStrictYmd(s: unknown): s is string {
  if (typeof s !== "string") return false;
  const m = YMD_RE.exec(s);
  if (!m) return false;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/** The Israel calendar day "YYYY-MM-DD" (Asia/Jerusalem, independent of the host timezone). */
export function israelTodayYmd(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** A non-empty deadline that is not a strict YYYY-MM-DD date (a reader that reports issues surfaces it). */
export function deadlineParseIssue(deadline: string | null | undefined): boolean {
  return typeof deadline === "string" && deadline.trim() !== "" && !isStrictYmd(deadline);
}

/** A status that may be overdue / due soon (not completed / cancelled / on hold). */
export function isOverdueCandidateStatus(status: string | null | undefined): boolean {
  return !NOT_OVERDUE_STATUSES.includes(status ?? "");
}

export interface OverdueInput { deadline: string | null | undefined; status: string | null | undefined; isHidden?: boolean | null }

/** THE project-overdue rule (see the module header). `todayYmdIL` defaults to the Israel calendar day. */
export function isProjectOverdue(p: OverdueInput, todayYmdIL: string = israelTodayYmd()): boolean {
  if (p.isHidden === true) return false;
  if (!isOverdueCandidateStatus(p.status)) return false;
  if (!isStrictYmd(p.deadline)) return false;
  return p.deadline < todayYmdIL;
}

/** Whole days from `todayYmdIL` to a strict deadline (negative = passed); null when the deadline is not strict. */
export function daysUntilProjectDeadline(deadline: string | null | undefined, todayYmdIL: string = israelTodayYmd()): number | null {
  if (!isStrictYmd(deadline) || !isStrictYmd(todayYmdIL)) return null;
  const u = (s: string) => { const [y, m, d] = s.split("-").map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((u(deadline) - u(todayYmdIL)) / 86400000);
}
