/**
 * needs_me (Owner decision 2026-10-01) — "מה צריך ממני היום", Sunny-curated: ONE deterministic list served to Dashboard
 * V2 (GET /api/partner/knowledge, Owner session) AND to Sunny (partner_query). The rules live in
 * lib/partner/needs-me/curate.ts (the app's own ball rules, no second rule). Read-only: no write, no task, no push.
 */
import type { KnowledgeCapability, KnowledgeItem } from "../types";
import { item, ok, partner, record, result, sfact } from "./common";
import { buildNeedsMe, NEEDS_GROUP_HE, NEEDS_ME_MAX, OWNER_TASK_GRACE_DAYS, type NeedsEntry, type NeedsItem } from "../../needs-me/curate";

export const NEEDS_ME_SECTIONS = ["today", "more_today", "backlog", "undecided", "unchecked", "excluded", "integrity"] as const;
export type NeedsMeSection = (typeof NEEDS_ME_SECTIONS)[number];

const todayItem = (n: NeedsItem, section: NeedsMeSection): KnowledgeItem => item({
  id: `${section}:${n.key}`, entity: n.entityKey.startsWith("task:") || n.entityKey.startsWith("partner-action:") || n.entityKey.startsWith("proposal:") || n.entityKey.startsWith("victor-work:") || n.entityKey.startsWith("mix-work:") ? null : n.entityKey,
  label: n.group === "YOUR_TASK" ? record(n.title) : partner(n.title), epistemic: "DERIVED", source: "PARTNER_KNOWLEDGE",
  fields: {
    section, key: n.key, entityKey: n.entityKey, group: n.group, groupHe: partner(NEEDS_GROUP_HE[n.group]),
    whyToday: partner(n.whyToday), waitingDays: n.waitingDays, ball: n.ball,
    evidence: n.evidence.map((e) => ({ ...e, he: e.epistemic === "OWNER_REPORTED" || e.epistemic === "HYPOTHESIS" || e.source === "TASKS" ? record(e.he) : partner(e.he) })),
    nextAction: { he: n.fromInbox?.nextStep && n.nextAction.he.includes(n.fromInbox.nextStep) ? record(n.nextAction.he) : partner(n.nextAction.he), actionId: n.nextAction.actionId },
    fromInbox: n.fromInbox ? { ...n.fromInbox, whatHappened: record(n.fromInbox.whatHappened), nextStep: n.fromInbox.nextStep ? record(n.fromInbox.nextStep) : null, conflictHe: n.fromInbox.conflictHe ? partner(n.fromInbox.conflictHe) : null, epistemic: "HYPOTHESIS" } : null,
    date: n.date, open: n.open,
  },
});
const entryItem = (e: NeedsEntry, section: NeedsMeSection): KnowledgeItem => item({
  id: `${section}:${e.key}`, entity: null, label: record(e.title), epistemic: "DERIVED", source: "PARTNER_KNOWLEDGE",
  fields: { section, key: e.key, entityKey: e.entityKey, reasonCode: e.reasonCode, reasonHe: partner(e.reasonHe), ball: e.ball, party: e.party, date: e.date, open: e.open },
});

export const needsMe: KnowledgeCapability = {
  id: "needs_me", domain: "COMPANY", titleHe: "מה צריך ממני היום",
  descriptionForModel: `What truly needs the Owner TODAY — Sunny-curated, the SAME list Dashboard V2 shows. ≤${NEEDS_ME_MAX} items, never filled. Enters only when the RECORDS put the ball with the Owner (Victor computeVictorBall, mix engineerHandoff, send log), a show today / tomorrow misses something of his, a partner action awaits him, or his own task / follow-up is due (overdue ≤${OWNER_TASK_GRACE_DAYS} days, else backlog; the Owner's ball beats age). A task inherits the ball of what it is linked to. Client-held money never enters. Processed Owner updates only enrich; records win; contradictions are shown. Order: new since yesterday → scheduled → waiting → own task → aggregated Victor waits (one item). Each item: whyToday, ball, evidence, nextAction. Modes: board, excluded (why X is not there), all.`,
  examplesHe: ["מה צריך ממני היום?", "מה מחכה לי?", "למה המשימה של ויקטור לא מופיעה?", "מה בבקלוג?"],
  modes: {
    board: { descriptionForModel: "The Owner's list: today (≤5) + more_today + backlog + undecided + unchecked; integrity is a summary line" },
    excluded: { descriptionForModel: "What was checked and left out, each with the reason (ball elsewhere, nothing missing, not sent yet …)" },
    all: { descriptionForModel: "Every section including excluded and the integrity questions" },
  }, defaultMode: "board",
  params: {},
  paging: { defaultLimit: 50, maxLimit: 50 }, recordTextLimit: 300,
  access: { externalRead: true, ownerOnly: true, sensitivity: "PERSONAL" },
  needs: ["STATE", "OPERATIONS", "PROJECT_DETAIL", "LABEL_DETAIL", "SETTINGS", "OWNER_INBOX", "ACTIONS", "INTEGRITY"],
  optionalNeeds: ["OWNER_KNOWLEDGE"],
  read(src, q) {
    if (!ok(src.state)) return { ...result([], { completeness: "UNKNOWN" }), missing: [{ fact: "company state", whyNeeded: "without the records the ball cannot be checked — nothing here means \"nothing needs you\"" }] };
    const n = buildNeedsMe(src);
    const items: KnowledgeItem[] = [];
    if (q.mode !== "excluded") {
      items.push(...n.items.map((x) => todayItem(x, "today")), ...n.moreToday.map((x) => todayItem(x, "more_today")),
        ...n.backlog.map((x) => entryItem(x, "backlog")), ...n.undecided.map((x) => entryItem(x, "undecided")),
        ...n.unchecked.map((u) => item({ id: `unchecked:${u.source}`, label: partner(u.he), epistemic: "UNKNOWN", source: "PARTNER_KNOWLEDGE", fields: { section: "unchecked", source: u.source } })));
    }
    if (q.mode === "excluded" || q.mode === "all") items.push(...n.excluded.map((x) => entryItem(x, "excluded")));
    if (q.mode === "all") items.push(...n.integrity.questions.map((x) => item({ id: `integrity:${x.questionId}`, label: record(x.textHe), epistemic: "DERIVED", source: "INTEGRITY", fields: { section: "integrity", subject: record(x.subject) } })));
    return result(items, {
      summary: [
        sfact("TODAY", "מה צריך ממך היום", n.items.length, "DERIVED", "PARTNER_KNOWLEDGE"),
        sfact("MORE_TODAY", "עוד להיום מעבר לחמישה", n.moreToday.length, "DERIVED", "PARTNER_KNOWLEDGE"),
        sfact("BACKLOG", "Backlog — לא היום", n.backlog.length, "DERIVED", "PARTNER_KNOWLEDGE"),
        sfact("UNDECIDED", "לא הוכרע", n.undecided.length, "DERIVED", "PARTNER_KNOWLEDGE"),
        sfact("UNCHECKED", "לא נבדק", n.unchecked.map((u) => u.source), "UNKNOWN", "PARTNER_KNOWLEDGE"),
        sfact("EXCLUDED", "נבדק ונפסל (mode excluded)", n.excluded.length, "DERIVED", "PARTNER_KNOWLEDGE"),
        sfact("CHECKED", "נבדקו", n.checked, "DERIVED", "PARTNER_KNOWLEDGE"),
        sfact("INTEGRITY", "שאלות סאני (שורה נפרדת)", { count: n.integrity.count, blocking: n.integrity.blocking }, "DERIVED", "INTEGRITY"),
        sfact("INBOX", "עדכונים שעובדו (הבנות)", n.inbox, "HYPOTHESIS", "OWNER_INBOX"),
        sfact("TODAY_YMD", "היום (שעון ישראל)", n.today, "FACT", "PARTNER_KNOWLEDGE"),
      ],
      completeness: n.unchecked.length ? "PARTIAL" : "COMPLETE",
      coverage: [
        partner(`עד ${NEEDS_ME_MAX} פריטים, לא ממלאים בכוח. הכדור נקבע רק מהרשומות; עדכון שעובד מעשיר בלבד, וסתירה מוצגת — הרשומות גוברות.`),
        ...n.unchecked.map((u) => partner(u.he)),
      ],
    });
  },
};
