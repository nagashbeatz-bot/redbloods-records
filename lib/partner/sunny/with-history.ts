/**
 * One Brain (2026-10-05) — the PURE transforms a read result gets once Sunny's own Action Layer history is known.
 * The connector only FETCHES the history (its act relay) and hands it here through the Gateway it already uses
 * (deps.gateway.withActionHistory) — so the connector imports no Sunny module and holds no rule of its own.
 *   inbox     owner_inbox understand / deep: every update's lifecycle re-decided WITH the actions (decideInboxLifecycle)
 *   learning  coo mode learning: the later evidence per record + the history → assessOutcomes
 *   motion    BUSINESS_MOTION (coo priorities / motion, partner_brief): a planning move that already ran and did not move
 *             the work is not proposed again by default (learnItem) — derived only, never policy
 * history null = not readable here → said so (never "nothing was done" / "nothing worked"). No write, no store.
 */
import { decideInboxLifecycle, inboxExecutiveSummary, type InboxLifecycle } from "./inbox-lifecycle";
import { assessOutcomes } from "./learning";
import type { ActionHistoryItem, SinceEvent } from "./since";
import { learnItem, learningNote, motionAnswerHe, motionInboxEntry, motionInboxOf, prioritiesAnswerHe, type LearnableItem, type MotionAnswerInput, type MotionInbox } from "../coo/motion";

export type HistoryDerivation = "inbox" | "learning" | "motion";

// ── ONE history read for every surface (Owner decision 2026-10-05, Dashboard parity Phase A2) ──────────────────────
// The connector (chat) and Redbloods MAIN (the Owner's executive dashboard) ask the action service the SAME request,
// map its answer with the SAME function and pick the derivation with the SAME selector — so the dashboard and the chat
// can never apply a different history or a different lifecycle to the same records.

/** The exact owner-scoped history request (partner_plan_status history) — newest first, the latest 50 plans. */
export const ACTION_HISTORY_REQUEST: Readonly<{ history: true; limit: number }> = Object.freeze({ history: true, limit: 50 });

/** Which history transform a read result gets. null = none (the read is served as is). */
export function historyDerivationFor(q: { tool: string; capability?: string | null; mode?: string | null }): HistoryDerivation | null {
  if (q.tool === "partner_brief") return "motion";
  if (q.tool !== "partner_query") return null;
  if (q.capability === "owner_inbox" && (q.mode === "understand" || q.mode === "deep")) return "inbox";
  if (q.capability === "coo" && q.mode === "learning") return "learning";
  if (q.capability === "coo" && (!q.mode || q.mode === "priorities" || q.mode === "motion")) return "motion";
  return null;
}

/** The action service's history answer → the items the transforms read. null = not readable (never "nothing was done"). */
export function actionHistoryItemsOf(h: Record<string, unknown> | null | undefined): ActionHistoryItem[] | null {
  if (!h || h.status !== "HISTORY" || !Array.isArray(h.items)) return null;
  return (h.items as Array<Record<string, unknown>>).map((x) => ({
    planId: String(x.planId ?? ""), at: (x.executedAt ?? x.createdAt ?? null) as string | null, outcome: String(x.outcome ?? ""), approvedBy: (x.approvedBy ?? null) as string | null,
    steps: ((x.steps as Array<Record<string, unknown>> | undefined) ?? []).map((st) => ({ actionId: String(st.actionId ?? ""), entity: (st.entity ?? null) as string | null, outcome: (st.outcome ?? null) as string | null })),
  }));
}

type SlimMotion = Record<string, unknown> & { progress?: Record<string, SinceEvent[]>; more?: number; answerHe?: string };
const MOTION_LISTS = ["greeting", "todayItems", "atRisk", "closeLoops", "label", "watch"] as const;

/** BUSINESS_MOTION (2026-10-05 Phase 2): the SAME learnItem over the compact motion partner_brief / coo carry. */
function motionWithHistory(m: SlimMotion, history: readonly ActionHistoryItem[] | null, nowMs: number): SlimMotion {
  const { progress, ...rest } = m;
  if (!history) return { ...rest, learning: { status: "NOT_READ", changed: 0, noteHe: "לא קראתי את היסטוריית הפעולות — ההמלצות לא נבדקו מול מה שכבר נוסה (זה לא אומר שכלום לא נוסה)" } };
  const { assessments } = assessOutcomes(history, progress ?? {}, nowMs);
  const out: SlimMotion = { ...rest };
  for (const l of MOTION_LISTS) {
    const xs = Array.isArray(m[l]) ? (m[l] as LearnableItem[]) : null;
    if (!xs) continue;
    out[l] = xs.map((i) => learnItem(i, assessments));
  }
  const changed = new Set(MOTION_LISTS.flatMap((l) => ((out[l] as LearnableItem[] | undefined) ?? []).filter((i) => i.learning?.changed).map((i) => i.key))).size;
  out.learning = learningNote(changed);
  // the inbox line: every update re-decided WITH the SAME history and the SAME decideInboxLifecycle owner_inbox uses
  const ib = m.inbox as MotionInbox | undefined;
  if (ib && Array.isArray(ib.entries)) out.inbox = motionInboxOf(ib.read, ib.entries.map((e) => motionInboxEntry(decideInboxLifecycle(e.lifecycle, history), e.absorbedBy)));
  out.answerHe = motionAnswerHe(out as unknown as MotionAnswerInput);
  return out;
}

export function deriveWithActionHistory(kind: HistoryDerivation, payload: Record<string, unknown>, history: readonly ActionHistoryItem[] | null, nowMs: number): Record<string, unknown> {
  const summary = Array.isArray(payload.summary) ? (payload.summary as Array<{ code?: string; value?: unknown }>) : [];
  if (kind === "motion") {
    // partner_brief carries motion at the top level; coo priorities / motion in the MOTION summary fact
    if (payload.motion && typeof payload.motion === "object" && (payload.motion as { status?: string }).status !== "UNAVAILABLE") return { ...payload, motion: motionWithHistory(payload.motion as SlimMotion, history, nowMs) };
    const fact = summary.find((x) => x.code === "MOTION");
    if (!fact || !fact.value || typeof fact.value !== "object") return payload;
    const m = motionWithHistory(fact.value as SlimMotion, history, nowMs);
    const today = (m.todayItems as LearnableItem[] | undefined) ?? [];
    const byKey = new Map([...MOTION_LISTS.flatMap((l) => ((m[l] as LearnableItem[] | undefined) ?? []))].map((i) => [i.key, i]));
    const items = Array.isArray(payload.items) ? (payload.items as Array<{ label?: unknown; fields?: Record<string, unknown> }>).map((it) => {
      const k = it.fields?.key as string | undefined; const n = k ? byKey.get(k) : undefined;
      if (!n || !n.learning?.changed) return it;
      return { ...it, label: { text: n.he, trust: "PARTNER" }, fields: { ...it.fields, move: n.move ? { ...n.move, he: { text: n.move.he, trust: "PARTNER" } } : null, reasons: n.reasonsHe.map((r) => ({ text: r, trust: "PARTNER" })), learning: n.learning } };
    }) : payload.items;
    const answer = summary.find((x) => x.code === "ANSWER");
    const isPriorities = typeof answer?.value === "string" && /דברים שהייתי סוגרת עכשיו|דבר אחד שהייתי סוגרת עכשיו/.test(answer.value);
    return { ...payload, items, summary: summary.map((x) => (x.code === "MOTION" ? { ...x, value: m } : x.code === "ANSWER" ? { ...x, value: isPriorities ? prioritiesAnswerHe(today, Number(m.more ?? 0)) : m.answerHe } : x)) };
  }
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
  const next = items.map((i) => {
    if (!i.fields?.lifecycle) return i;
    const l = decideInboxLifecycle(i.fields.lifecycle, history);
    // the partner_entity shape also carries the flattened view — refreshed from the SAME decision (never two answers)
    const f = i.fields as Record<string, unknown>;
    const flat = "state" in f ? { state: l.state, stateHe: { text: l.stateHe, trust: "PARTNER" }, since: l.since.verdict, sinceHe: { text: l.since.he, trust: "PARTNER" }, homes: l.homes.map((h) => h.kind), nextHe: { text: l.nextHe, trust: "PARTNER" } } : {};
    return { ...i, fields: { ...i.fields, ...flat, lifecycle: l } };
  });
  const lives = next.map((i) => i.fields?.lifecycle).filter((x): x is InboxLifecycle => !!x);
  return { ...payload, items: next, summary: summary.map((x) => (x.code === "EXECUTIVE" ? { ...x, value: { ...(x.value as Record<string, unknown>), ...inboxExecutiveSummary(lives) } } : x)), inboxActions: { status: "READ", plans: history.length } };
}
