/**
 * Owner Inbox — the DERIVED lifecycle of one update (One Brain stages 4–5, Owner-approved 2026-10-05). Pure, read-only.
 * ZERO INBOX: an update is an input, not a store. It leaves the active inbox as soon as its information has a DURABLE HOME
 * (an exact interpretation / Owner knowledge / an executed plan on the exact entity after the note / an explicit
 * NO_ACTION_NEEDED or DISMISSED) — PROCESSED means "the message has a home", never "the work is done"; the business thread
 * lives on in the records / project_memory / needs_me.
 *
 * Display states (computed on every read, never stored — no second truth):
 *   NEEDS_OWNER      no exact-enough entity (UNRESOLVED / AMBIGUOUS / NONE and no link) or a contradiction → ONE question
 *   UNREAD           an entity is known (link or LIKELY) but the information has no home yet
 *   UNDERSTOOD_OPEN  it has a home; the business work it talks about is still open → may leave the inbox
 *   REFLECTED        it has a home and the records show nothing left open → may leave the inbox
 *   OVERTAKEN        meaningful newer evidence happened (or its understanding is OUTDATED_BY_CANONICAL) → tell the Boss
 *                    what changed and ask whether the note is exhausted — never closed silently
 * Age NEVER changes a state. A technical / system item (the app itself) is closed only by the Owner's "עובד" — a commit,
 * a deploy or a baseline change is weak evidence at most. Canonical state beats an interpretation.
 */
import type { SinceEvent, SinceSummary } from "./since";
import { actionsSince, summarizeSince, type ActionHistoryItem } from "./since";

export type InboxDisplayState = "NEEDS_OWNER" | "UNREAD" | "UNDERSTOOD_OPEN" | "REFLECTED" | "OVERTAKEN";
export const INBOX_STATE_HE: Readonly<Record<InboxDisplayState, string>> = {
  NEEDS_OWNER: "חסר לי פרט — שאלה אחת",
  UNREAD: "הבנתי למה זה שייך, עוד אין לזה בית",
  UNDERSTOOD_OPEN: "נקלט ויש לזה בית — העניין העסקי עדיין פתוח (ממשיך ברשומות)",
  REFLECTED: "כבר משתקף במקום אחר — אפשר לסגור את הפתק",
  OVERTAKEN: "קרה משהו מאז — כדאי לבדוק אם הפתק עדיין רלוונטי",
};

export interface InboxHome { kind: "INTERPRETATION" | "OWNER_KNOWLEDGE" | "PLAN"; ref: string; he: string; at: string | null }
/** Everything the capability can compute WITHOUT the Action Layer history (serializable — the connector adds actions). */
export interface InboxLifecycleBase {
  itemId: string; writtenAt: string;
  entityKeys: string[]; entitySource: "LINKED" | "LIKELY" | "NONE";
  technical: boolean; contradiction: boolean;
  /** the item's own current interpretation and its freshness (null = none) */
  understanding: { id: string; freshness: string } | null;
  /** knowledge on the exact entity learned AT / AFTER the note (a home) */
  knowledgeHomes: InboxHome[];
  /** knowledge on the exact entity learned BEFORE the note — maybe the note repeats it (a hint, never a home by itself) */
  relatedEarlier: Array<{ id: string; he: string; at: string }>;
  businessOpen: boolean | null;
  since: SinceSummary;
  /** a canonical record already answers the note (e.g. the money it doubts was received) — OVERTAKEN, never reopened */
  overtakenByCanonical?: string | null;
}
export interface InboxLifecycle extends InboxLifecycleBase {
  state: InboxDisplayState; stateHe: string; homes: InboxHome[];
  /** may leave the active inbox now (with the Boss's approval of the exact close) */
  closable: boolean;
  proposedClose: { outcome: "LEARNED_KNOWLEDGE" | "ACTION_PLANNED" | "NO_ACTION_NEEDED"; outcomeRef: string | null; whyHe: string } | null;
  nextHe: string;
}

// a re-planning / an approved state move on the exact entity after the note can be its home; a mere record-keeping
// action (price, money, details) never closes an update about the work itself
const PLAN_HOME_MEANINGS = new Set(["PLANNING", "PROGRESS"]);

/** The ONE decision (capability and connector call it): state + homes + a proposed close, from the base + any actions. */
export function decideInboxLifecycle(base: InboxLifecycleBase, actions?: readonly ActionHistoryItem[] | null): InboxLifecycle {
  let since = base.since;
  const planHomes: InboxHome[] = [];
  if (actions && base.entityKeys.length) {
    const acts = actionsSince(actions, base.entityKeys, base.writtenAt);
    const merged: SinceEvent[] = [...base.since.events.filter((e) => e.kind !== "ACTION"), ...acts].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    since = summarizeSince(merged, base.since.verdict !== "NOT_CHECKED", true);
    for (const e of acts) if (PLAN_HOME_MEANINGS.has(e.meaning)) {
      const planId = e.ref;
      if (planId && !planHomes.some((h) => h.ref === planId)) planHomes.push({ kind: "PLAN", ref: planId, he: e.he, at: e.at });
    }
  }
  const homes: InboxHome[] = [
    ...(base.understanding && base.understanding.freshness === "CURRENT" ? [{ kind: "INTERPRETATION" as const, ref: base.understanding.id, he: "ההבנה שרשמתי לעדכון הזה (עדכנית)", at: null }] : []),
    ...base.knowledgeHomes, ...planHomes,
  ];
  const linked = base.entitySource === "LINKED";
  const overtaken = !!base.overtakenByCanonical || (base.understanding?.freshness === "OUTDATED_BY_CANONICAL") || (!homes.length && since.progress > 0);
  const state: InboxDisplayState = base.entitySource === "NONE" || base.contradiction ? "NEEDS_OWNER"
    : overtaken ? "OVERTAKEN"
    : homes.length ? (base.businessOpen === false ? "REFLECTED" : "UNDERSTOOD_OPEN")
    : "UNREAD";
  // a close is proposed only with an exact LINK, a real home, no contradiction — and never for a technical item
  const home = homes.find((h) => h.kind === "PLAN") ?? homes.find((h) => h.kind === "OWNER_KNOWLEDGE") ?? homes.find((h) => h.kind === "INTERPRETATION") ?? null;
  const closable = linked && !base.technical && !base.contradiction && (state === "UNDERSTOOD_OPEN" || state === "REFLECTED") && !!home;
  const proposedClose = !closable || !home ? null
    : home.kind === "PLAN" ? { outcome: "ACTION_PLANNED" as const, outcomeRef: home.ref, whyHe: `בוצעה אחרי העדכון פעולה על אותה רשומה (${home.ref}) — הפעולה עצמה לא אומרת שהבעיה נפתרה; החוט ממשיך ברשומות` }
    : home.kind === "OWNER_KNOWLEDGE" ? { outcome: "LEARNED_KNOWLEDGE" as const, outcomeRef: home.ref, whyHe: "המידע נשמר כידע על אותה רשומה" }
    : { outcome: "NO_ACTION_NEEDED" as const, outcomeRef: null, whyHe: "ההבנה נרשמה על הרשומה המדויקת ועדכנית; ההמשך חי ב-project_memory" };
  const nextHe = base.technical ? "עניין טכני במערכת: לשאול את הבוס מה בדיוק לא עובד / אם זה עובד עכשיו — נסגר רק כשהוא אומר שזה עובד (deploy הוא לא הוכחה)"
    : state === "NEEDS_OWNER" ? (base.contradiction ? "יש סתירה — להציג לבוס את שתי האפשרויות ולשאול" : "לשאול שאלה אחת: למי / לאיזה פרויקט זה שייך")
    : state === "OVERTAKEN" ? (base.overtakenByCanonical ? `${base.overtakenByCanonical} — לא לפתוח מחדש ולא לשאול שוב אם התקבל; להציע לסגור את הפתק` : `לספר לבוס מה קרה מאז (${since.he}) ולשאול אם העדכון מיצה את עצמו`)
    : state === "UNREAD" ? (linked ? "לרשום הבנה על הרשומה המקושרת (מה קרה / מה פתוח / הצעד הבא) ואז להציע סגירה" : "להציע את הישות (LIKELY) + למה, לשאול 'נכון?', לקשר ולרשום הבנה")
    : closable ? "להציע סגירה של הפתק (יש לו בית) — העניין העסקי ממשיך ברשומות"
    : "לקשר את העדכון לרשומה המדויקת לפני סגירה";
  return { ...base, since, state, stateHe: INBOX_STATE_HE[state], homes, closable, proposedClose, nextHe };
}

/** Executive counts for the Boss (need-to-know, never a dump). */
export function inboxExecutiveSummary(items: readonly Pick<InboxLifecycle, "state" | "closable" | "technical" | "since">[]): { counts: Record<InboxDisplayState, number>; closable: number; technical: number; progressedSince: number; he: string } {
  const counts = { NEEDS_OWNER: 0, UNREAD: 0, UNDERSTOOD_OPEN: 0, REFLECTED: 0, OVERTAKEN: 0 } as Record<InboxDisplayState, number>;
  for (const i of items) counts[i.state]++;
  const closable = items.filter((i) => i.closable).length, technical = items.filter((i) => i.technical).length;
  const progressedSince = items.filter((i) => i.since.verdict === "PROGRESSED").length;
  const parts = [
    progressedSince ? `${progressedSince} התקדמו מאז שכתבת` : null,
    counts.OVERTAKEN ? `${counts.OVERTAKEN} כנראה כבר לא מתארים את המצב (קרה משהו מאז)` : null,
    closable ? `${closable} כבר נקלטו ואפשר לסגור את הפתק` : null,
    counts.UNREAD ? `${counts.UNREAD} עוד צריכים בית (הבנה / ידע / פעולה)` : null,
    counts.NEEDS_OWNER ? `${counts.NEEDS_OWNER} צריכים ממך הבהרה אחת` : null,
    technical ? `${technical} טכניים (נסגרים רק כשאתה אומר שזה עובד)` : null,
  ].filter(Boolean);
  return { counts, closable, technical, progressedSince, he: items.length ? `עברתי על ${items.length} העדכונים: ${parts.join(" · ")}` : "אין עדכונים פתוחים" };
}

