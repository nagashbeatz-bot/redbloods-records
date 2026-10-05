/**
 * One Brain (2026-10-05) — the PURE transforms a read result gets once Sunny's own Action Layer history is known.
 * The connector only FETCHES the history (its act relay) and hands it here through the Gateway it already uses
 * (deps.gateway.withActionHistory) — so the connector imports no Sunny module and holds no rule of its own.
 *   inbox     owner_inbox understand / deep: every update's lifecycle re-decided WITH the actions (decideInboxLifecycle)
 *   learning  coo mode learning: the later evidence per record + the history → assessOutcomes
 * history null = not readable here → said so (never "nothing was done" / "nothing worked"). No write, no store.
 */
import { decideInboxLifecycle, inboxExecutiveSummary, type InboxLifecycle } from "./inbox-lifecycle";
import { assessOutcomes } from "./learning";
import type { ActionHistoryItem, SinceEvent } from "./since";

export type HistoryDerivation = "inbox" | "learning";

export function deriveWithActionHistory(kind: HistoryDerivation, payload: Record<string, unknown>, history: readonly ActionHistoryItem[] | null, nowMs: number): Record<string, unknown> {
  const summary = Array.isArray(payload.summary) ? (payload.summary as Array<{ code?: string; value?: unknown }>) : [];
  if (kind === "learning") {
    const progress = ((summary.find((x) => x.code === "PROGRESS_BY_ENTITY")?.value as { progress?: Record<string, SinceEvent[]> } | undefined)?.progress) ?? {};
    const rest = summary.filter((x) => x.code !== "PROGRESS_BY_ENTITY" && (!history || x.code !== "LEARNING_STATUS"));
    if (!history) return { ...payload, summary: rest, learning: { status: "NOT_READ", noteHe: "לא קראתי את היסטוריית הפעולות — לא נבדק (זה לא אומר שכלום לא עבד)" } };
    // preference evidence = ONLY the Boss's explicit moves the history records (his own approval); an un-executed plan is no signal
    const feedback = history.filter((h) => h.approvedBy === "OWNER_APPROVAL" && h.at).flatMap((h) => h.steps.map((st) => ({ kind: "APPROVED" as const, actionId: st.actionId, entity: st.entity, at: h.at as string, ref: h.planId })));
    const r = assessOutcomes(history, progress, nowMs, feedback);
    return { ...payload, summary: rest,
      items: r.assessments.slice(-25).map((x) => ({ id: `${x.planId}:${x.entity}`, entity: null, label: { text: `${x.actionId} — ${x.level}`, trust: "PARTNER" }, epistemic: "DERIVED", freshness: "LIVE", source: "ACTIONS", fields: x })),
      learning: { status: "READ", plans: history.length, lessons: r.lessons, preferences: r.preferences,
        preferenceEvidence: { recorded: ["APPROVED"], notRecorded: ["REJECTED", "CHANGED", "CORRECTED"], noteHe: "העדפה נלמדת רק מראיה מפורשת שלך (אישור / דחייה / שינוי / תיקון / אמירה). ״לא בוצע״ = אין סיגנל. דחייה ושינוי לא נשמרים היום בהיסטוריה — לכן כרגע אין השערות העדפה." }, ruleHe: "תוצאה ≠ סיבה: CORRELATED רק קדם; שיעור הוא השערה — הופך לכלל רק באישור הבוס (BUSINESS_LEARNING)" } };
  }
  const items = Array.isArray(payload.items) ? (payload.items as Array<{ fields?: { lifecycle?: InboxLifecycle | null } }>) : [];
  if (!items.some((i) => i.fields?.lifecycle)) return payload;
  if (!history) return { ...payload, inboxActions: { status: "NOT_READ", noteHe: "לא קראתי את הפעולות שסאני ביצעה — 'מה קרה מאז' כאן לא כולל אותן (זה לא אומר שלא בוצע כלום)" } };
  const next = items.map((i) => (i.fields?.lifecycle ? { ...i, fields: { ...i.fields, lifecycle: decideInboxLifecycle(i.fields.lifecycle, history) } } : i));
  const lives = next.map((i) => i.fields?.lifecycle).filter((x): x is InboxLifecycle => !!x);
  return { ...payload, items: next, summary: summary.map((x) => (x.code === "EXECUTIVE" ? { ...x, value: { ...(x.value as Record<string, unknown>), ...inboxExecutiveSummary(lives) } } : x)), inboxActions: { status: "READ", plans: history.length } };
}
