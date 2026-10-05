/**
 * Redbloods Partner — Gateway V1: "what matters now?" (partner_brief). Pure, deterministic.
 *
 * Not a second COO brain: it carries BUSINESS_MOTION (lib/partner/coo/motion — the ONE ranking, Phase 2 2026-10-05) as
 * computed, and otherwise only SELECTS from what Partner already produced — the Owner Action surface,
 * the Finance brief (its ≤2 Owner questions are already memory-preflighted), live Partner Cases, the
 * Finance month line and recent Outcomes — and says little (≤5 items). Everything known but not shown is
 * counted in `omitted`, never silently dropped.
 *
 * Case order has no priority model (Partner Cases deliberately carry none): classification
 * (RISK → ATTENTION → OPPORTUNITY → INFORMATION), then case type, then subject id — a reproducible listing,
 * not a judgement. A balance case the Owner already closed is superseded and never shown.
 */
import { caseSubjectKey, eventFreshness, envelope, gatewayKeyForSubject, ok, partner, partnerRecord, record, toPatterns, type GatewaySources } from "./core";
import { ownerClosedProjects } from "./entity-common";
import { GATEWAY_LIMITS, type BriefCategory, type BriefItem, type BriefMotion, type BriefResponse, type GatewayDrillDown, type GatewaySourceName } from "./types";
import { buildCooView } from "../coo/priorities";
import { motionSummary } from "../coo/motion";

const CLASS_ORDER = ["RISK", "ATTENTION", "OPPORTUNITY", "INFORMATION"];
const PER_CATEGORY: Record<BriefCategory, number> = { ACTION_READY: 2, OWNER_DECISION_NEEDED: 2, KNOWN_DECISION_RECONCILE: 2, ATTENTION: 1, MONEY: 1, RECENT_OUTCOME: 1 };
const CATEGORY_ORDER: BriefCategory[] = ["ACTION_READY", "OWNER_DECISION_NEEDED", "KNOWN_DECISION_RECONCILE", "ATTENTION", "MONEY", "RECENT_OUTCOME"];
/** Partner vocabulary for case types (display only). */
const CASE_TYPE_HE: Record<string, string> = {
  DELIVERY_WITHOUT_RECORDED_FOLLOWUP: "מסירות של Victor בלי המשך מתועד", MISSED_INTERNAL_DEADLINE: "דדליינים פנימיים של Victor שעברו",
  FINANCE_CONFIGURATION_MISSING: "פרויקטים פעילים בלי הגדרת מחיר", PROJECT_DEADLINE_PASSED: "דדליינים של פרויקטים שעברו",
  PROJECT_PAYMENT_OUTSTANDING: "יתרות תשלום פתוחות", PROJECT_OVERPAYMENT: "תשלומי יתר", PAYMENT_DUE_DATE_PASSED: "מועדי תשלום שעברו",
  PROPOSAL_FOLLOWUP_DUE: "הצעות מחיר שצריך לחזור אליהן", RELEASE_TARGET_DATE_PASSED: "תאריכי יעד לשחרור שעברו",
  SHOW_CLIENT_PAYMENT_OUTSTANDING: "הופעות שהלקוח עוד לא שילם", SHOW_PASSED_NOT_CLOSED: "הופעות שעברו ועדיין לא נסגרו", TASK_DUE_DATE_PASSED: "משימות שעבר מועדן", STEVEN_INTERNAL_DEADLINE_PASSED: "דדליינים פנימיים של Steven שעברו",
};
const BALANCE_CASES = new Set(["PROJECT_PAYMENT_OUTSTANDING", "PAYMENT_DUE_DATE_PASSED"]);

const open = (key: string | null): GatewayDrillDown | null => (key ? { tool: "partner_entity", args: { key }, label: partner("פתח") } : null);

export function getPartnerBriefCore(src: GatewaySources): BriefResponse {
  const env = envelope("partner_brief", {}, src, [["ACTIONS", src.actions], ["FINANCE", src.finance], ["CASES", src.cases], ["OUTCOMES", src.outcomes], ["MEMORY", src.memory], ...(src.integrity ? [["INTEGRITY", src.integrity] as [GatewaySourceName, typeof src.integrity]] : [])]);
  const byCat: Record<BriefCategory, BriefItem[]> = { ACTION_READY: [], OWNER_DECISION_NEEDED: [], KNOWN_DECISION_RECONCILE: [], ATTENTION: [], MONEY: [], RECENT_OUTCOME: [] };
  const missing: BriefResponse["missing"] = [];
  const f = ok(src.finance);

  // ACTION_READY — the live Owner Action surface (SHOW / AWAITING_EXECUTION only; read-only here)
  const subjectOfFinanceAction = new Map((f?.actions ?? []).filter((c) => c.id).map((c) => [c.id!, gatewayKeyForSubject(c.subject.type, c.subject.id)]));
  for (const i of ok(src.actions) ?? []) {
    const subject = i.actionType === "UPDATE_PROJECT_DEADLINE" ? `project:${i.projectId}` : subjectOfFinanceAction.get(i.actionId) ?? null;
    byCat.ACTION_READY.push({ category: "ACTION_READY", headline: partnerRecord(i.state === "AWAITING_EXECUTION" ? `אושר וממתין לביצוע: ${i.headlineHe}` : i.headlineHe), epistemic: "DERIVED", freshness: "LIVE", source: "ACTIONS", subject, drillDown: open(subject) });
  }
  if (!ok(src.actions)) missing.push({ fact: "suggested actions", whyNeeded: "the Action surface could not be read" });

  // OWNER_DECISION_NEEDED — the Finance brief's questions (≤2, memory-preflighted)
  if (f?.brief) {
    for (const q of f.brief.rehab.questions) {
      const iq = q.answer ? f.integrity.questions.find((x) => x.identity?.questionId === q.answer!.questionId) : f.integrity.questions.find((x) => x.textHe === q.textHe);
      const subject = iq ? gatewayKeyForSubject(iq.subject.type, iq.subject.id) : null;
      byCat.OWNER_DECISION_NEEDED.push({ category: "OWNER_DECISION_NEEDED", headline: partnerRecord(q.textHe), epistemic: "UNKNOWN", freshness: "LIVE", source: "FINANCE", subject, drillDown: open(subject) });
    }
  } else if (f && !f.answersAvailable) missing.push({ fact: "Owner answers", whyNeeded: "questions are hidden until Owner answers can be read (never re-ask blindly)" });
  // … and the Company Integrity definition questions surfaced right now (max 2, Owner-Context-preflighted by the register)
  const reg = ok(src.integrity);
  for (const q of reg?.questions ?? []) {
    byCat.OWNER_DECISION_NEEDED.push({ category: "OWNER_DECISION_NEEDED", headline: partnerRecord(q.textHe), epistemic: "UNKNOWN", freshness: "LIVE", source: "INTEGRITY",
      subject: q.subject.type === "label-artist" ? `label-artist:${q.subject.id}` : null, drillDown: { tool: "partner_query", args: { capability: "owner_needs" }, label: partner("מה Partner צריך ממך") } });
  }
  if (src.integrity && !reg) missing.push({ fact: "Company Integrity questions", whyNeeded: "the integrity register could not be read — open definition questions may exist" });

  // KNOWN_DECISION_RECONCILE — the decision gate: the Owner already answered / said it, the records do not show it yet. Never
  // asked again as a question; partner_entity carries the typed canonical action (it runs only after the Owner's approval).
  for (const r of f?.integrity.top.reconcile ?? []) {
    byCat.KNOWN_DECISION_RECONCILE.push({ category: "KNOWN_DECISION_RECONCILE", headline: partnerRecord(r.textHe), epistemic: "OWNER_DECISION", freshness: "LIVE", source: "FINANCE", subject: r.entityKey, drillDown: open(r.entityKey) });
  }

  // ATTENTION — live Partner Cases, minus balance cases the Owner closed
  const closed = ownerClosedProjects(src);
  const cases = (ok(src.cases) ?? [])
    .filter((c) => !(BALANCE_CASES.has(c.caseType) && c.subjectType === "project" && closed.has(c.subjectId)))
    .filter((c) => c.classification === "RISK" || c.classification === "ATTENTION")
    .sort((a, b) => CLASS_ORDER.indexOf(a.classification) - CLASS_ORDER.indexOf(b.classification) || a.caseType.localeCompare(b.caseType) || a.subjectId.localeCompare(b.subjectId));
  if (cases.length) {
    // ONE aggregate line (a count by case type) — never a single case picked as "the most important" without a priority model
    const byType = new Map<string, number>();
    for (const c of cases) byType.set(c.caseType, (byType.get(c.caseType) ?? 0) + 1);
    const top = [...byType.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 3);
    const risk = cases.filter((c) => c.classification === "RISK").length;
    byCat.ATTENTION.push({
      category: "ATTENTION", epistemic: "DERIVED", freshness: "LIVE", source: "CASES", subject: null, drillDown: null,
      headline: partner(`${cases.length} מקרים פתוחים (${risk} סיכון, ${cases.length - risk} תשומת לב). הנפוצים: ${top.map(([t, n]) => `${CASE_TYPE_HE[t] ?? t} (${n})`).join(", ")}.`),
    });
  }
  if (!ok(src.cases)) missing.push({ fact: "cases", whyNeeded: "the company state could not be read" });

  // BUSINESS_MOTION — the moves (the SAME object coo mode motion serves); with it, the raw cases count is context only
  const motion = motionOf(src);
  let casesContext: BriefResponse["casesContext"] = null;
  if (motion.status === "OK" && byCat.ATTENTION.length) { casesContext = { headline: byCat.ATTENTION[0].headline, count: cases.length }; byCat.ATTENTION = []; }

  // MONEY — the Finance brief's month line (coverage-qualified)
  if (f?.brief) {
    const b = f.brief;
    byCat.MONEY.push({ category: "MONEY", headline: partnerRecord([b.summary.lineHe, b.summary.otherCurrencyLineHe, b.coverage === "PARTIAL" ? b.summary.basisHe : null].filter(Boolean).join(" · ")), epistemic: "DERIVED", freshness: "LIVE", source: "FINANCE", subject: null, drillDown: null });
  } else if (!f) missing.push({ fact: "finance", whyNeeded: "the Finance Brain could not be read" });

  // RECENT_OUTCOME — the newest executed Action, only while recent
  for (const o of ok(src.outcomes) ?? []) {
    const fr = eventFreshness(o.executedAt, src.now);
    if (fr !== "RECENT") continue;
    const subject = o.actionType === "UPDATE_PROJECT_DEADLINE" ? `project:${o.projectId}` : null;
    byCat.RECENT_OUTCOME.push({ category: "RECENT_OUTCOME", headline: partnerRecord(`${o.headlineHe} — ${o.statusHe}`), epistemic: "FACT", freshness: fr, source: "OUTCOMES", subject, drillDown: open(subject) });
  }

  const items: BriefItem[] = [];
  const omitted: BriefResponse["omitted"] = {};
  for (const c of CATEGORY_ORDER) {
    const take = byCat[c].slice(0, Math.max(0, Math.min(PER_CATEGORY[c], GATEWAY_LIMITS.briefItems - items.length)));
    items.push(...take);
    if (byCat[c].length > take.length) omitted[c] = byCat[c].length - take.length;
  }
  const memory = ok(src.memory);
  return {
    ...env, items, omitted, patterns: toPatterns(memory, null),
    conflictsCount: memory ? memory.entities.reduce((n, m) => n + m.conflicts.length, 0) : 0,
    missing,
    ownerUpdates: ownerUpdatesOf(src),
    motion, casesContext,
  };
}

/** BUSINESS_MOTION for the brief — computed by the ONE module; a failure / missing state is UNAVAILABLE, never "nothing to do". */
export function motionOf(src: GatewaySources): BriefMotion {
  if (!ok(src.state)) return { status: "UNAVAILABLE", detail: src.state ? "company state unreadable" : "not loaded", note: partner("לא חישבתי את המהלכים (מצב החברה לא נקרא) — זה לא אומר שאין מה לקדם.") };
  try {
    return { status: "OK", ...motionSummary(buildCooView(src).motion), drillDown: { tool: "partner_query", args: { capability: "coo", mode: "motion" }, label: partner("כל המהלכים, השבוע, לולאות וצוואר הבקבוק") } };
  } catch {
    return { status: "UNAVAILABLE", detail: "motion failed", note: partner("לא הצלחתי לחשב את המהלכים כרגע — זה לא אומר שאין מה לקדם.") };
  }
}

/** A stable digest of the NEW set (same ids = same digest), so a conversation can tell "nothing new since". */
export function inboxDigest(ids: readonly string[]): string {
  let h = 5381;
  for (const c of [...ids].sort().join("|")) h = ((h << 5) + h + c.codePointAt(0)!) >>> 0;
  return `${ids.length}-${h.toString(36)}`;
}

/**
 * The Owner's unhandled updates for the brief: newest 10 (text ≤300 chars, RECORD — Owner decision 2026-10-01: never
 * "one more update" without its content), the count, `more` beyond the cap, a stable digest and a drill-down to the full list. Its own status — an unreadable inbox is UNAVAILABLE (never "no updates") and never
 * changes the rest of the brief. Read only: nothing is marked handled.
 */
export function ownerUpdatesOf(src: GatewaySources): BriefResponse["ownerUpdates"] {
  const inbox = src.ownerInbox;
  if (!inbox || inbox.status !== "OK") {
    return { status: "UNAVAILABLE", detail: inbox ? inbox.detail : "not loaded", note: partner("לא הצלחתי לקרוא את העדכונים שכתבת — זה לא אומר שאין עדכונים.") };
  }
  const fresh = inbox.value.filter((i) => i.status === "NEW").sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
  const n = GATEWAY_LIMITS.briefOwnerUpdates, max = GATEWAY_LIMITS.ownerUpdateChars;
  return {
    status: "OK", newCount: fresh.length, digest: inboxDigest(fresh.map((i) => i.id)),
    items: fresh.slice(0, n).map((i) => ({ id: i.id, writtenAt: i.createdAt, text: record(i.body.length > max ? `${i.body.slice(0, max - 1)}…` : i.body), epistemic: "OWNER_REPORTED" as const, status: "NEW" as const })),
    more: Math.max(0, fresh.length - n),
    // One Brain (2026-10-05): the brief does not read the company state — the per-update lifecycle (what happened since, its
    // home, NEEDS_OWNER / OVERTAKEN / closable) and the executive line come from owner_inbox mode understand
    drillDown: fresh.length ? { tool: "partner_query", args: { capability: "owner_inbox", mode: "understand" }, label: partner("מה קרה מאז כל עדכון ואיפה הבית שלו") } : null,
  };
}
