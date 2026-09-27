/**
 * TEAM BALL CYCLE — the Owner-approved workflow (2026-09-27) for external team work (Steven / any mix engineer, Victor),
 * stated ONCE on top of the app's own evidence rules (lib/coo/victor-ball computeVictorBall, lib/partner/mix/handoff
 * engineerHandoff). Pure: no I/O. It adds no second rule — it names the cycle stage the evidence rule already derived:
 *
 *   the team uploads a version      → BALL = OWNER · WAITING_FOR_OWNER_FEEDBACK
 *   the Owner sends notes / feedback → BALL = TEAM  · WAITING_FOR_NEW_VERSION_FROM_TEAM
 *   the team uploads a new version  → BALL = OWNER again … and so on.
 *
 * Feedback on a version that was already superseded is ignored by the evidence rules (stale). Time never completes a
 * work: "stuck" is only the days since the last recorded event. Outside communication (WhatsApp / phone) is invisible.
 */
export type TeamBallStage = "WAITING_FOR_OWNER_FEEDBACK" | "WAITING_FOR_NEW_VERSION_FROM_TEAM" | "CLOSED" | "CONFLICTING_EVIDENCE" | "UNKNOWN";
export type EvidenceState = "WAITING_ON_OWNER" | "WAITING_ON_VICTOR" | "WAITING_ON_ENGINEER" | "COMPLETED" | "CANCELLED" | "CONFLICTING_EVIDENCE" | "UNKNOWN";

export interface TeamBallCycle {
  ball: "OWNER" | "TEAM" | "NONE" | "UNKNOWN";
  stage: TeamBallStage;
  whyHe: string;
  /** the recorded event that set the current stage */
  lastEvent: { kind: "TEAM_VERSION" | "OWNER_FEEDBACK" | "SENT_TO_TEAM" | "CLOSED"; at: string | null } | null;
  /** when the latest version was uploaded */
  latestVersionAt: string | null;
  /** the Owner's latest counted feedback (stale feedback on superseded versions excluded) */
  lastOwnerFeedbackAt: string | null;
  ownerFeedbackSinceLatestVersion: boolean;
  waitingForNewVersion: boolean;
  /** calendar days (Israel) since lastEvent — "how long the state has held", never a completion */
  daysInState: number | null;
  staleFeedbackIgnored: number;
}

const ilDay = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
const daysBetween = (fromIso: string | null, todayYmd: string) => {
  if (!fromIso || !Number.isFinite(Date.parse(fromIso))) return null;
  return Math.max(0, Math.round((Date.parse(`${todayYmd}T12:00:00Z`) - Date.parse(`${ilDay(fromIso)}T12:00:00Z`)) / 86_400_000));
};

export function teamBallCycle(input: { team: string; state: EvidenceState; latestVersionAt: string | null; lastOwnerFeedbackAt: string | null; sentAt?: string | null; staleFeedbackIgnored?: number; todayYmd: string }): TeamBallCycle {
  const { team, state, latestVersionAt: v, lastOwnerFeedbackAt: f } = input;
  const fbAfter = !!f && (!v || Date.parse(f) > Date.parse(v));
  const base = { latestVersionAt: v, lastOwnerFeedbackAt: f, ownerFeedbackSinceLatestVersion: fbAfter, staleFeedbackIgnored: input.staleFeedbackIgnored ?? 0 };
  if (state === "COMPLETED" || state === "CANCELLED") {
    return { ...base, ball: "NONE", stage: "CLOSED", whyHe: state === "COMPLETED" ? "העבודה הושלמה" : "העבודה בוטלה", lastEvent: { kind: "CLOSED", at: null }, waitingForNewVersion: false, daysInState: null };
  }
  if (state === "WAITING_ON_OWNER") {
    return { ...base, ball: "OWNER", stage: "WAITING_FOR_OWNER_FEEDBACK", whyHe: `${team} העלה גרסה${v ? "" : " (בלי חותמת זמן)"} ואין פידבק שלך אחריה — ממתינים לפידבק שלך`, lastEvent: { kind: "TEAM_VERSION", at: v }, waitingForNewVersion: false, daysInState: daysBetween(v, input.todayYmd) };
  }
  if (state === "WAITING_ON_VICTOR" || state === "WAITING_ON_ENGINEER") {
    const ev = f && fbAfter ? { kind: "OWNER_FEEDBACK" as const, at: f } : { kind: "SENT_TO_TEAM" as const, at: input.sentAt ?? null };
    return { ...base, ball: "TEAM", stage: "WAITING_FOR_NEW_VERSION_FROM_TEAM", whyHe: ev.kind === "OWNER_FEEDBACK" ? `שלחת הערות אחרי הגרסה האחרונה — ממתינים לגרסה חדשה מ-${team}` : `נשלח ל-${team} ועדיין לא הועלתה גרסה — ממתינים לגרסה`, lastEvent: ev, waitingForNewVersion: true, daysInState: daysBetween(ev.at, input.todayYmd) };
  }
  return { ...base, ball: "UNKNOWN", stage: state === "CONFLICTING_EVIDENCE" ? "CONFLICTING_EVIDENCE" : "UNKNOWN", whyHe: state === "CONFLICTING_EVIDENCE" ? "הראיות סותרות — מוצג, לא מוכרע" : "אין מספיק חותמות זמן כדי לקבוע", lastEvent: null, waitingForNewVersion: false, daysInState: null };
}
