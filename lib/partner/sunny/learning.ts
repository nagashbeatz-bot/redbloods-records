/**
 * Sunny — CLOSED-LOOP OUTCOME LEARNING (One Brain stage 9, Owner-approved 2026-10-05). Pure, derived, read-only.
 *
 *   SITUATION → SUNNY'S PLAN → THE BOSS'S DECISION → ACTION → LATER EVIDENCE → OUTCOME → LESSON (HYPOTHESIS)
 *
 * Every executed step of the Action Layer history is assessed against LATER meaningful evidence on the SAME entity (the
 * ONE "since" rule — lib/partner/sunny/since.ts). Attribution is never causal by default:
 *   CORRELATED            progress followed the action on that entity (it preceded it — nothing more is claimed)
 *   LIKELY_HELPFUL        the progress is the very kind the action enables (a scheduled session → a held session …)
 *   INSUFFICIENT_EVIDENCE too early (inside the window), progress only elsewhere, or a record-keeping action
 *   DID_NOT_RESOLVE       the window passed and nothing moved on that entity
 *   CONTRADICTED          the same re-planning was needed again with no progress in between
 * Lessons and Owner-preference signals are HYPOTHESES (the approved pattern levels). They never change a rule, a policy
 * or a record: an Owner-confirmed lesson goes ONLY through partner_propose_knowledge (BUSINESS_LEARNING) with his approval.
 * The 14-day window is an engineering heuristic, never Owner policy.
 */
import { ACTION_MEANING, type ActionHistoryItem, type SinceEvent } from "./since";
import { patternLevel, type Occurrence, type PatternLevel } from "./patterns";

const DAY = 86_400_000;
export const LEARNING_HEURISTICS = { windowDays: 14, note: "engineering window only — never Owner policy" } as const;
export type OutcomeLevel = "CORRELATED" | "LIKELY_HELPFUL" | "INSUFFICIENT_EVIDENCE" | "DID_NOT_RESOLVE" | "CONTRADICTED";
/** the progress kinds an action directly enables (semantic link) — anything else is at most CORRELATED */
const ENABLES: Readonly<Record<string, readonly string[]>> = {
  SCHEDULE_SESSION: ["SESSION_HELD"], SCHEDULE_SESSION_WITH_INVITE: ["SESSION_HELD"],
  SEND_VICTOR_VERSION_NOTES: ["VICTOR_UPLOAD"], NOTIFY_MIX_READY: ["MIX_VERSION", "FINAL_FILES"], CHANGE_RELEASE_STAGE: ["RELEASE_STAGE", "RELEASED"],
};

export interface OutcomeAssessment { planId: string; actionId: string; entity: string; at: string; meaning: string; level: OutcomeLevel; heuristic: true; evidenceHe: string; laterEvents: string[] }
export interface Lesson { code: string; level: PatternLevel; epistemic: "HYPOTHESIS"; he: string; cases: string[]; toKnowledgeHe: string; showToOwner: boolean }

/** progressByEntity: the PROGRESS events (since.ts projectProgressEvents) of each entity the capability read. */
export function assessOutcomes(history: readonly ActionHistoryItem[], progressByEntity: Readonly<Record<string, readonly SinceEvent[]>>, nowMs: number): { assessments: OutcomeAssessment[]; lessons: Lesson[]; preferences: Lesson[] } {
  const steps = history.filter((h) => h.at).flatMap((h) => h.steps.filter((s) => s.entity && s.outcome === "APPLIED_AS_EXPECTED").map((s) => ({ planId: h.planId, actionId: s.actionId, entity: s.entity as string, at: h.at as string })))
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const assessments: OutcomeAssessment[] = [];
  for (const s of steps) {
    const meaning = ACTION_MEANING[s.actionId] ?? "RECORDING";
    if (meaning === "RECORDING" || !(s.entity in progressByEntity)) continue; // record-keeping is not a recommendation to judge; unread entity → not assessed
    const t0 = Date.parse(s.at), end = t0 + LEARNING_HEURISTICS.windowDays * DAY;
    const later = (progressByEntity[s.entity] ?? []).filter((e) => Date.parse(e.at) > t0);
    const inWindow = later.filter((e) => Date.parse(e.at) <= end);
    const again = steps.find((x) => x !== s && x.entity === s.entity && x.actionId === s.actionId && Date.parse(x.at) > t0);
    const progressBeforeAgain = again ? later.filter((e) => Date.parse(e.at) < Date.parse(again.at)).length : null;
    const enabled = (ENABLES[s.actionId] ?? []).some((k) => inWindow.some((e) => e.kind === k));
    const otherMoved = Object.entries(progressByEntity).some(([k, ev]) => k !== s.entity && ev.some((e) => Date.parse(e.at) > t0 && Date.parse(e.at) <= end));
    const level: OutcomeLevel = again && progressBeforeAgain === 0 ? "CONTRADICTED"
      : enabled ? "LIKELY_HELPFUL"
      : inWindow.length ? "CORRELATED"
      : nowMs < end ? "INSUFFICIENT_EVIDENCE"
      : "DID_NOT_RESOLVE";
    const evidenceHe = level === "CONTRADICTED" ? `אותה פעולה נדרשה שוב (${again!.at.slice(0, 10)}) בלי התקדמות רשומה ביניהן`
      : level === "LIKELY_HELPFUL" ? "אחרי הפעולה קרה בדיוק הסוג שהיא מאפשרת (קשר סביר — לא הוכחה)"
      : level === "CORRELATED" ? "אחרי הפעולה נרשמה התקדמות — היא קדמה לה; לא נטען שהיא גרמה לה"
      : level === "INSUFFICIENT_EVIDENCE" ? (otherMoved ? "עוד מוקדם — והתקדמות נרשמה רק ברשומות אחרות (לא נספרת)" : "עוד מוקדם לדעת (בתוך חלון הבדיקה)")
      : `עברו ${LEARNING_HEURISTICS.windowDays} ימים ולא נרשמה התקדמות ברשומה הזו`;
    assessments.push({ planId: s.planId, actionId: s.actionId, entity: s.entity, at: s.at, meaning, level, heuristic: true, evidenceHe, laterEvents: inWindow.slice(0, 3).map((e) => e.he) });
  }
  // LESSON: the same kind of plan repeatedly did not move the work (approved pattern levels; occurrences = the assessments)
  const lessons: Lesson[] = [];
  const byAction = new Map<string, OutcomeAssessment[]>();
  for (const a of assessments.filter((x) => x.level === "DID_NOT_RESOLVE" || x.level === "CONTRADICTED")) byAction.set(a.actionId, [...(byAction.get(a.actionId) ?? []), a]);
  for (const [actionId, list] of byAction) {
    const occ: Occurrence[] = list.map((a) => ({ sourceId: `${a.planId}:${a.entity}`, at: a.at, entity: a.entity, he: a.evidenceHe }));
    const helped = assessments.filter((x) => x.actionId === actionId && (x.level === "CORRELATED" || x.level === "LIKELY_HELPFUL")).length;
    const lv = patternLevel({ occurrences: occ, nowMs, contradicting: helped, consequence: list.some((a) => a.level === "CONTRADICTED") });
    if (!lv) continue;
    const planning = (ACTION_MEANING[actionId] ?? "") === "PLANNING";
    lessons.push({ code: `NO_MOVEMENT_AFTER_${actionId}`, level: lv.level, epistemic: "HYPOTHESIS", cases: lv.counted.map((o) => o.entity),
      he: `ב-${lv.counted.length} מקרים ${actionId} לא לווה בהתקדמות רשומה${planning ? " — במקרים דומים כדאי לבדוק blocker / צעד הבא / אצל מי הכדור, לא רק את התאריך" : ""} (השערה; ${helped} מקרים כן התקדמו)`,
      toKnowledgeHe: "אם הבוס מאשר שזה נכון אצלנו — להציע BUSINESS_LEARNING דרך partner_propose_knowledge (באישורו), לעולם לא כלל אוטומטי",
      showToOwner: lv.level === "REPEATED" || lv.level === "STRONG" });
  }
  // OWNER PREFERENCE: plans Sunny proposed that the Boss never approved, by action (history records NOT_EXECUTED plans)
  const preferences: Lesson[] = [];
  const declined = new Map<string, Occurrence[]>();
  for (const h of history) if (h.outcome === "NOT_EXECUTED" || h.outcome === "EXPIRED_NOT_EXECUTED") for (const s of h.steps) if (s.entity) declined.set(s.actionId, [...(declined.get(s.actionId) ?? []), { sourceId: `${h.planId}:${s.entity}`, at: h.at ?? new Date(nowMs).toISOString(), entity: s.entity, he: "הוצע ולא אושר" }]);
  for (const [actionId, occ] of declined) {
    const lv = patternLevel({ occurrences: occ, nowMs, contradicting: 0, consequence: false });
    if (!lv || lv.level === "OBSERVATION") continue;
    preferences.push({ code: `OWNER_DOES_NOT_APPROVE_${actionId}`, level: lv.level, epistemic: "HYPOTHESIS", cases: lv.counted.map((o) => o.entity),
      he: `ב-${lv.counted.length} מקרים הצעתי ${actionId} והבוס לא אישר — אולי כדאי להציע אחרת (השערה, לא כלל)`,
      toKnowledgeHe: "לפני שזה משנה משהו: לשאול את הבוס 'שמתי לב ש… — להפוך לכלל עבודה?' ורק באישורו דרך partner_propose_knowledge",
      showToOwner: lv.level === "REPEATED" || lv.level === "STRONG" });
  }
  return { assessments, lessons, preferences };
}
