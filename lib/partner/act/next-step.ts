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
import { ACTION_REGISTRY, NEEDS_HARDENING } from "./registry";
import { COVERAGE_MAP } from "./coverage-map";
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

// ── STAGE CARD: one record's stage → what happened, what is expected, from whom, and what Sunny can do now ─────────────
/** Owner-decided meanings of specific states (never a second rule — the app's own rules stay the source). */
export const STATE_MEANINGS: Readonly<Record<string, string>> = {
  "RF_PRODUCTION_STATUS:מאושר": "D7 (Owner decision 2026-09-27): the Owner approved the CURRENT production stage to proceed to the next stage — not client approval, not payment, not the final version, not delivery, not the whole production",
  "RF_EDIT_STATUS:מאושר": "D7: the Owner approved the current EDIT stage to proceed (e.g. to publishing) — not client approval, not payment, not delivery",
  "REHEARSAL_OPERATIONAL:בוצע": "D6: the rehearsal happened — its cost counts toward the show split",
  "REHEARSAL_OPERATIONAL:מתוכנן": "D6: planned — does not count toward the show split (even if paid) until the Owner marks it בוצע",
  "REHEARSAL_OPERATIONAL:בוטל": "D6: cancelled — does not count toward the show split",
  "REHEARSAL_OPERATIONAL:התקיים": "D6 legacy: written by the old page-load auto-mark, not by the Owner — keeps the pre-D6 rule (counts only if paid) until the Owner confirms בוצע / בוטל",
};
export interface StageCard {
  lifecycle: string; currentStage: string; meaningEn: string | null; terminal: boolean;
  lastRecordedEvent: { at: string | null; basis: string };
  nextExpectedEvent: string; expectedFrom: BallHolder; evidence: readonly string[];
  confidence: "RECORDED_STATE_DERIVED_NEXT" | "UNKNOWN";
  ownerAction: readonly string[]; sunnyAction: readonly string[]; blockingUnknowns: readonly string[];
}
/** Executable primitives behind a census id (the id itself when it is a primitive; its COVERAGE_MAP primitives otherwise). */
function executableBehind(id: string): string[] {
  const c = ACTION_REGISTRY.get(id);
  const direct = c && c.availabilityDetail === "EXECUTABLE" && c.internal.source === "lib/partner/act/primitives" ? [id] : [];
  const via = (COVERAGE_MAP[id]?.by ?? []).filter((x) => ACTION_REGISTRY.get(x)?.availabilityDetail === "EXECUTABLE");
  return [...new Set([...direct, ...via])];
}
/**
 * STAGE_CARD (pure): the state comes from a live domain view (project_view, show_view, mix_view, video_view …); this
 * adds the lifecycle meaning, the expected next event, whose move it is, and the typed actions Sunny can plan now
 * (each still needs the Boss's approval). Nothing is invented: an unrecorded timestamp / holder is a blocking unknown.
 */
export function stageCard(lifecycleId: string, state: string, lastEventAt: string | null = null): StageCard | null {
  const l = LIFECYCLES.find((x) => x.id === lifecycleId);
  if (!l || !l.states.includes(state)) return null;
  const terminal = l.terminal.includes(state);
  const h = HANDOFF_MODEL.find((x) => x.stateOrSignal.split(" / ").includes(state));
  const exp = NEXT_EXPECTED_EVENT.find((e) => e.lifecycle === l.id && e.fromState === state);
  const candidates = terminal ? [] : [...new Set([...l.setBy, ...l.special.filter((s) => !s.from || s.from === state).map((s) => s.via)])];
  const sunnyAction = [...new Set(candidates.flatMap(executableBehind))].sort();
  const ball: BallHolder = h?.ball ?? "UNKNOWN";
  const meaningEn = STATE_MEANINGS[`${l.id}:${state}`] ?? null;
  const blocking: string[] = [];
  if (!terminal && ball === "UNKNOWN") blocking.push("whose move it is is not recorded for this state — read the record's own evidence (send log, versions, notes) before assuming");
  if (!lastEventAt) blocking.push("no recorded timestamp for the last event — a passed date never proves it happened");
  if (meaningEn?.startsWith("D6 legacy")) blocking.push("the Owner has not confirmed whether this rehearsal happened (בוצע) or not (בוטל)");
  return {
    lifecycle: l.id, currentStage: state, meaningEn, terminal,
    lastRecordedEvent: { at: lastEventAt, basis: lastEventAt ? "recorded timestamp" : "not recorded" },
    nextExpectedEvent: exp?.expectedEn ?? "unknown", expectedFrom: terminal ? "SYSTEM" : ball,
    evidence: [h ? `${h.workflow}: ${h.evidenceEn}` : "no handoff rule for this state", `lifecycle ${l.id} (${l.kind})`],
    confidence: "RECORDED_STATE_DERIVED_NEXT",
    ownerAction: terminal ? [] : ball === "BOSS" ? ["the move is the Boss's (review / decide)", "approve any plan Sunny proposes"] : ["approve any plan Sunny proposes"],
    sunnyAction, blockingUnknowns: blocking,
  };
}
