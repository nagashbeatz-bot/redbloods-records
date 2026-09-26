/**
 * SUNNY UNIVERSAL ACTION LAYER — next-step interfaces (Wave 0: models + pure derivation; no scoring, no execution).
 *
 * NEXT_STEP_ENGINE        what could move this record forward (a PROPOSAL only — every step still needs the Boss).
 * NEXT_EXPECTED_EVENT     what Redbloods expects to happen next in a lifecycle, and from whom.
 * HANDOFF_MODEL           whose move it is (reuses the app's own ball rules; never a second rule).
 * WORKFLOW_CONTINUITY     the chain of business events a workflow passes through, so nothing is dropped.
 * LABEL_OPERATING_MODEL   label artists are protected investment; no invented cadence / readiness / thresholds.
 * PROCESS_IMPROVEMENT_SIGNALS  recurring friction the Boss may want fixed (from hardening findings) — never auto-fixed.
 * Stale ≠ urgent; quality before speed; the order shown is never a priority.
 */
import { LIFECYCLES } from "./transitions";
import { NEEDS_HARDENING } from "./registry";
import { WORKFLOW_EVENT_MAP } from "./business-events";

export type BallHolder = "BOSS" | "ARTIST" | "CLIENT" | "VICTOR" | "STEVEN" | "ENGINEER" | "DJ" | "RED_FILMS" | "SYSTEM" | "UNKNOWN";
export interface Handoff { workflow: string; stateOrSignal: string; ball: BallHolder; evidenceEn: string; canonicalRule: string | null }
export const HANDOFF_MODEL: readonly Handoff[] = [
  { workflow: "VICTOR_WORK", stateOrSignal: "computed", ball: "UNKNOWN", evidenceEn: "uploads vs sent notes (the app's computeVictorBall); a disagreeing send log is CONFLICTING_EVIDENCE", canonicalRule: "computeVictorBall" },
  { workflow: "MIX_WORK", stateOrSignal: "נשלח / בתהליך", ball: "STEVEN", evidenceEn: "sent and no newer version since the notes", canonicalRule: "mix evidence ball (newest upload vs notes)" },
  { workflow: "MIX_WORK", stateOrSignal: "חזר", ball: "BOSS", evidenceEn: "a new version waits for the Boss's review", canonicalRule: "mix evidence ball" },
  { workflow: "PROPOSAL", stateOrSignal: "הצעה נשלחה / ממתין לתשובה", ball: "CLIENT", evidenceEn: "no recorded answer; a due follow-up means 'no recorded follow-up', never 'the Boss did not follow up'", canonicalRule: "proposal follow-up" },
  { workflow: "PROPOSAL", stateOrSignal: "צריך פולואפ", ball: "BOSS", evidenceEn: "the follow-up date passed", canonicalRule: "proposal follow-up" },
  { workflow: "SHOW", stateOrSignal: "ממתין לאישור DJ", ball: "DJ", evidenceEn: "DJ confirmation pending", canonicalRule: "dj_confirmation_status" },
  { workflow: "SHOW", stateOrSignal: "ממתין לתשובה", ball: "CLIENT", evidenceEn: "quote sent, no answer recorded", canonicalRule: null },
  { workflow: "PROJECT_SEND_LOG", stateOrSignal: "open send-log entry", ball: "UNKNOWN", evidenceEn: "the send log says who waits for whom", canonicalRule: "project_actions" },
  { workflow: "RED_FILMS", stateOrSignal: "נשלחה גרסה", ball: "BOSS", evidenceEn: "a version was sent for review", canonicalRule: null },
  { workflow: "LABEL_RELEASE", stateOrSignal: "blocker / responsible", ball: "UNKNOWN", evidenceEn: "the release's responsible / blocker fields (free text)", canonicalRule: null },
];

export interface ExpectedEvent { lifecycle: string; fromState: string; expectedEn: string; terminal: boolean }
/** Derived from the transition model: every non-terminal state expects a next event; terminal states expect none. */
export const NEXT_EXPECTED_EVENT: readonly ExpectedEvent[] = LIFECYCLES.flatMap((l) =>
  l.kind === "DERIVED" ? [] : l.states.map((s) => ({ lifecycle: l.id, fromState: s, terminal: l.terminal.includes(s), expectedEn: l.terminal.includes(s) ? "none (terminal)" : `a move set by ${l.setBy.join(" / ") || "the owning workflow"}` })));

export interface ContinuityLink { event: string; actions: readonly string[] }
export const WORKFLOW_CONTINUITY: readonly ContinuityLink[] = Object.entries(WORKFLOW_EVENT_MAP).map(([event, m]) => ({ event, actions: m.kind === "ACTIONS" ? m.actions : [] }));

export const LABEL_OPERATING_MODEL = {
  principleHe: "אמני לייבל = השקעה מוגנת. אין קצב ריליס, מוכנות או סף חוסר-פעילות מומצאים. מאזן, מחזורים, הכנסות מדיה, כסף הופעות וכסף לקוחות נשארים נפרדים.",
  never: ["invent release cadence", "invent readiness", "invent inactivity thresholds", "invent payout / recoup policy", "combine currencies", "rank artists"],
  djDefaultHe: "DJ CLEANTONE: 500₪ להופעה = ברירת מחדל תפעולית שמוצגת בתצוגה ואפשר לשנות. לא כל DJ מקבל 500, וקלינטון לא בכל הופעה (רוב ≠ כולם). לעולם לא לשבץ את CLEANTONE אוטומטית.",
} as const;

export interface ProcessSignal { id: string; actionId: string; frictionEn: string; kind: "NEEDS_HARDENING" }
export const PROCESS_IMPROVEMENT_SIGNALS: readonly ProcessSignal[] = Object.entries(NEEDS_HARDENING).map(([actionId, frictionEn]) => ({ id: `PI_${actionId.replace(/\W/g, "_")}`, actionId, frictionEn, kind: "NEEDS_HARDENING" }));

export interface NextStepProposal { lifecycle: string; state: string; ball: BallHolder; candidateActions: readonly string[]; needsBossApproval: true; noteHe: string }
/** NEXT_STEP_ENGINE (pure): given a lifecycle + current state, the candidate actions — proposals only, never executed. */
export function nextStepsFor(lifecycleId: string, state: string): NextStepProposal | null {
  const l = LIFECYCLES.find((x) => x.id === lifecycleId);
  if (!l || !l.states.includes(state)) return null;
  const terminal = l.terminal.includes(state);
  const h = HANDOFF_MODEL.find((x) => x.stateOrSignal.split(" / ").includes(state));
  return {
    lifecycle: l.id, state, ball: h?.ball ?? "UNKNOWN", needsBossApproval: true,
    candidateActions: terminal ? [] : [...new Set([...l.setBy, ...l.special.filter((s) => !s.from || s.from === state).map((s) => s.via)])],
    noteHe: terminal ? "מצב סופי — אין צעד הבא" : "הצעה בלבד, בוס. כל צעד מחכה לאישור שלך.",
  };
}
