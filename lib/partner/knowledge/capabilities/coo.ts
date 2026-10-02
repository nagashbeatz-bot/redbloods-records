/**
 * Sunny COO V1 (2026-10-02) — operational readiness, project momentum, label-artist care, schedule health, money
 * readiness and the executive priorities. Owner-only, read-only, interaction time only: no write, no task, no alert,
 * no push, no calendar change, no background job. Composes the existing Deep Brain views (lib/partner/coo/*); adds no
 * business rule (money = projectMoney; overdue = project-deadline; ball = projectOperating / computeVictorBall).
 */
import type { KnowledgeCapability, KnowledgeItem } from "../types";
import { item, partner, record, result, sfact } from "./common";
import { buildCooView, prioritiesHe } from "../../coo/priorities";
import { cooCtx } from "../../coo/context";
import { readinessOf } from "../../coo/readiness";
import { artistCare, projectMomentum } from "../../coo/momentum";
import { moneyReadiness } from "../../coo/money";
import { INTERNAL_COO_HEURISTICS, type Readiness } from "../../coo/model";

const COVERAGE = [
  partner("מאושר = רשומה מפורשת. 'לא רואה' = אין רשומה שמוכיחה — זה לא אומר שזה חסר במציאות. תובנה = השערה שלי. המלצה = הצעה, לא מבצעת כלום."),
  partner("אין ספי זמן כמדיניות: שום דבר לא 'תקוע' רק כי עברו X ימים. 3–5 פריטים זו מגבלת הצגה, לא כלל עסקי. אין דירוג שנשמר."),
  partner("כסף לפי החישוב הקנוני של הפרויקט (התקבל = שולם / התקבל; צפוי ≠ התקבל; שילם ≥ מחיר מוסכם → אין חוב; יותר → זיכוי). אין יתרת מזומנים ב-Redbloods — 'יש כסף' לא נטען."),
  partner("לא משנה כלום: לא יומן, לא משימות, לא התראות, לא פוש. ניתוח בזמן שיחה בלבד."),
];
const OWNER_FIN = { externalRead: true, ownerOnly: true, sensitivity: "FINANCIAL" } as const;

const readinessItem = (r: Readiness, i: number): KnowledgeItem => item({
  id: `${r.key}:${i}`, entity: r.entity && /^(project|show|session|release|label-artist|client):/.test(r.entity) ? r.entity : null, label: record(`${r.titleHe}`), epistemic: "DERIVED", source: "PARTNER_KNOWLEDGE",
  fields: { kind: r.kind, date: r.date, time: r.time, daysTo: r.daysTo, state: r.state, stateHe: partner(r.stateHe), confirmed: r.confirmed.map(partner), notSeen: r.notSeen.map(partner), open: r.open.map(partner), blocked: r.blocked.map(partner),
    ownerAttention: r.ownerAttention.map(partner), insights: r.insights.map((x) => ({ he: partner(x), epistemic: "HYPOTHESIS" })), facts: r.facts.map((x) => ({ he: partner(x), epistemic: "DERIVED" })), recommendation: r.recommendationHe ? partner(r.recommendationHe) : null, narrative: partner(r.narrativeHe),
    checks: r.checks.map((c) => ({ dimension: c.dimension, label: partner(c.labelHe), state: c.state, required: c.required, he: partner(c.he), evidence: c.evidence.map((e) => ({ source: e.source, ref: e.ref, basis: e.he })) })), project: r.project, sources: r.sources },
});

export const coo: KnowledgeCapability = {
  id: "coo", domain: "COMPANY", titleHe: "סאני COO — מוכנות, תנועה, לו״ז, כסף",
  descriptionForModel: "Sunny as COO (Owner-only, read-only, interaction time). Modes: priorities (DEFAULT: what needs the Owner now, ≤5 — a display limit), readiness (events in the next 14 days: shoot / show / release / important session / meeting / client deadline; per dimension confirmed / not seen / open / blocked; param entity or production), momentum (active projects: last recorded progress, next step, scheduled?, who holds it, risk), artists (label roster care; DJ / team never), schedule (this week: real conflicts + patterns; busy alone is never a problem), money (param entity = project), entity. RULES: short, grounded, actionable; ✓ confirmed / ? 'אני לא רואה …' (never 'אין …') / → recommendation; inference is inference; no invented threshold, quota, cash balance or song↔clip link; never move / create / schedule / send / approve anything.",
  examplesHe: ["מה הכי חשוב לי לסגור עכשיו?", "אנחנו מוכנים לצילום ביום ראשון?", "מה קורה עם אמני הלייבל?", "הלו״ז שלי השבוע נראה טוב?", "יש משהו שאני מפספס?", "הפרויקט של אבי מתקדם?"],
  modes: {
    priorities: { descriptionForModel: "≤5 executive items + more count. Answer like: 'שלושה דברים שהייתי סוגרת עכשיו: 1. … 2. … 3. …' — concise first, details only when asked. After an outcome is discussed you may ask 'רוצה שנשמור מזה לקח עסקי?' (BUSINESS_LEARNING only via partner_propose_knowledge + his approval)." },
    readiness: { descriptionForModel: "Readiness board (or one entity / production). Speak per event: '✓ … / ? אני לא רואה … / → הייתי סוגרת …'. A data source that was not read = לא ידוע, never 'not ready'." },
    momentum: { descriptionForModel: "Active projects' momentum (param entity = one project)" },
    artists: { descriptionForModel: "Label artist care (param artist = one roster artist)" },
    schedule: { descriptionForModel: "This week's schedule health (analysis only)" },
    money: { descriptionForModel: "Money readiness of one project (param entity)" },
    entity: { descriptionForModel: "Enrichment for partner_entity (project / label-artist / show / session / release)" },
  }, defaultMode: "priorities",
  params: {
    entity: { kind: "entityKey", types: ["project", "show", "session", "release", "label-artist"], descriptionForModel: "readiness / momentum / money / entity: one entity" },
    artist: { kind: "entityKey", types: ["label-artist"], descriptionForModel: "artists: one roster artist" },
    production: { kind: "text", maxLength: 40, descriptionForModel: "readiness: one Red Films production id (uuid)" },
  },
  entityScope: { types: ["project", "label-artist", "show", "session", "release"], param: "entity", mode: "entity", limit: 6 },
  paging: { defaultLimit: 25, maxLimit: 50 }, recordTextLimit: 1200, access: OWNER_FIN,
  needs: ["STATE", "FINANCE", "OPERATIONS", "PROJECT_DETAIL"],
  optionalNeeds: ["LABEL_DETAIL", "SETTINGS", "CALENDAR", "BRAIN", "OWNER_KNOWLEDGE", "INTEGRITY"],
  read(src, q) {
    if (!src.state || src.state.status !== "OK") return result([], { completeness: "UNKNOWN", coverage: COVERAGE, missing: [{ fact: "company state", whyNeeded: "without the records nothing can be checked — unknown, never 'all fine'" }] });
    const c = cooCtx(src);
    const partial = !c.ops || !c.det || !c.financeReadable;
    const base = { coverage: COVERAGE, completeness: (partial ? "PARTIAL" : "COMPLETE") as "PARTIAL" | "COMPLETE" };
    const heur = sfact("HEURISTICS", "היוריסטיקות פנימיות (לא מדיניות שלך)", { ...INTERNAL_COO_HEURISTICS, note: "engineering windows only — never Owner policy, never 'stuck'" }, "DERIVED", "PARTNER_KNOWLEDGE");
    const entity = q.params.entity ?? null;

    if (q.mode === "readiness" || (q.mode === "entity" && entity && !entity.startsWith("label-artist:"))) {
      const list = q.params.production ? readinessOf(c, `video-production:${q.params.production}`) : entity ? readinessOf(c, entity) : buildCooView(src).readiness.events;
      const items = list.map(readinessItem);
      if (q.mode === "entity" && entity?.startsWith("project:")) {
        const m = projectMomentum(c, entity.slice(8));
        items.push(item({ id: `momentum:${entity}`, entity, label: partner(m.stateHe), epistemic: "DERIVED", source: "PARTNER_KNOWLEDGE", fields: { section: "momentum", he: partner(m.he), lastProgress: m.lastProgress, nextSteps: m.nextSteps.map((n) => ({ ...n, he: partner(n.he) })), scheduledNext: m.scheduledNext, waitingOn: m.waitingOn, risks: m.risks.map(partner) } }));
      }
      return result(items, { ...base, summary: [sfact("EVENTS", "אירועים שנבדקו", list.length, "DERIVED", "PARTNER_KNOWLEDGE"), sfact("BY_STATE", "לפי מצב", list.reduce<Record<string, number>>((m, r) => ({ ...m, [r.stateHe]: (m[r.stateHe] ?? 0) + 1 }), {}), "DERIVED", "PARTNER_KNOWLEDGE"), heur] });
    }
    if (q.mode === "momentum") {
      const list = entity?.startsWith("project:") ? [projectMomentum(c, entity.slice(8))] : buildCooView(src).momentum;
      return result(list.map((m) => item({ id: m.key, entity: m.key, label: record(m.name), epistemic: "DERIVED", source: "PROJECTS", fields: { state: m.state, stateHe: partner(m.stateHe), labelWork: m.labelWork, he: partner(m.he), lastProgress: m.lastProgress ? { ...m.lastProgress, he: partner(m.lastProgress.he) } : null, scheduledNext: m.scheduledNext, nextSteps: m.nextSteps.map((n) => ({ ...n, he: partner(n.he) })), waitingOn: m.waitingOn, deadline: m.deadline, release: m.release, risks: m.risks.map(partner), warning: m.warning } })),
        { ...base, summary: [sfact("BY_STATE", "תנועה לפי מצב", list.reduce<Record<string, number>>((x, m) => ({ ...x, [m.stateHe]: (x[m.stateHe] ?? 0) + 1 }), {}), "DERIVED", "PROJECTS"), sfact("RULE", "אין סף זמן", "nothing is 'stuck' because of age; warnings = no next step recorded / the Owner's ball / a near date without a scheduled step", "DERIVED", "PARTNER_KNOWLEDGE")] });
    }
    if (q.mode === "artists" || (q.mode === "entity" && entity?.startsWith("label-artist:"))) {
      const id = (q.params.artist ?? entity ?? "").replace(/^label-artist:/, "");
      const list = id ? [artistCare(c, id)].filter((x): x is NonNullable<typeof x> => !!x) : buildCooView(src).artists;
      return result(list.map((a) => item({ id: a.key, entity: a.key, label: record(a.name), epistemic: "DERIVED", source: "LABEL_ARTISTS", fields: { he: partner(a.he), attention: a.attention, facts: a.facts.map(partner), moving: a.moving, needsStep: a.needsStep, waitingOnOwner: a.waitingOnOwner, nextSession: a.nextSession, upcomingSessions: a.upcomingSessions,
        nextRelease: a.nextRelease ? { title: a.nextRelease.titleHe, date: a.nextRelease.date, state: a.nextRelease.state, stateHe: partner(a.nextRelease.stateHe), open: a.nextRelease.open.map(partner), notSeen: a.nextRelease.notSeen.map(partner), blocked: a.nextRelease.blocked.map(partner) } : null,
        projects: a.projects.map((p) => ({ key: p.key, name: p.name, link: p.link, collaboration: p.collaboration, state: p.state, he: partner(p.he) })),
        brain: a.brain ? { ...a.brain, liveInsights: a.brain.liveInsights.map((x) => ({ ...x, titleHe: record(x.titleHe) })), note: "Brain observations / insights are context; insights are Sunny's HYPOTHESIS, never fact; operational truth comes from Redbloods records" } : null } })),
        { ...base, summary: [sfact("ROSTER", "אמני הלייבל (טבלת אמני הלייבל; DJ / צוות לא נכללים)", c.roster.map((a) => a.name), "FACT", "LABEL_ARTISTS"), sfact("RULE", "אין מכסת סשנים", "no weekly-session quota exists — facts only", "DERIVED", "PARTNER_KNOWLEDGE")] });
    }
    if (q.mode === "schedule") {
      const v = buildCooView(src);
      const s = v.schedule;
      return result([
        ...s.findings.map((f, i) => item({ id: `finding:${i}`, label: partner(f.he), epistemic: "DERIVED", source: "CALENDAR", fields: { code: f.code, kind: f.kind, date: f.date, heuristic: f.heuristic, evidence: f.evidence } })),
        ...s.days.map((d) => item({ id: `day:${d.date}`, label: partner(d.date), epistemic: "FACT", source: "CALENDAR", fields: { date: d.date, busyMinutes: d.busyMinutes, items: d.items.map((x) => ({ ...x, title: record(x.title) })) } })),
      ], { ...base, summary: [sfact("SUMMARY", "תמונת השבוע", s.he, "DERIVED", "CALENDAR"), sfact("BALANCE", "פילוח (ספירה)", s.balance, "DERIVED", "CALENDAR"), sfact("CALENDAR", "סטטוס יומן", s.calendarStatus, "FACT", "CALENDAR"), sfact("DUE", "פולואפים / משימות שמגיעים השבוע", { followups: s.dueFollowups, tasks: s.dueTasks }, "FACT", "TASKS"), heur], coverage: [...COVERAGE, ...s.unchecked.map(partner)] });
    }
    if (q.mode === "money") {
      if (!entity?.startsWith("project:")) return result([], { ...base, missing: [{ fact: "project", whyNeeded: "money readiness is per project (param entity = project:<id>)" }] });
      const pid = entity.slice(8);
      const m = moneyReadiness(c.project(pid), { labelWork: c.isLabel(pid), financeReadable: c.financeReadable });
      return result(m.checks.map((x) => item({ id: x.id, entity, label: partner(x.labelHe), epistemic: "DERIVED", source: "FINANCE", fields: { state: x.state, he: partner(x.he), evidence: x.evidence } })), { ...base, summary: [sfact("VERDICT", "מצב הכסף (החישוב הקנוני)", m.verdict, "DERIVED", "FINANCE"), sfact("FACTS", "עובדות", m.facts, "DERIVED", "FINANCE"), sfact("RISK", "סיכון כספי שיכול לעכב", m.risk, "DERIVED", "FINANCE")] });
    }
    // priorities (default)
    const v = buildCooView(src);
    return result(v.priorities.map((p, i) => item({ id: `${i + 1}:${p.key}`, entity: p.entity && /^(project|show|session|release|label-artist|client):/.test(p.entity) ? p.entity : null, label: partner(p.he), epistemic: "DERIVED", source: "PARTNER_KNOWLEDGE", fields: { rank: i + 1, tier: p.tier, kind: p.kind, why: p.why.map(partner), daysTo: p.daysTo, labelWork: p.labelWork, recommendation: p.recommendationHe ? partner(p.recommendationHe) : null } })),
      { ...base, coverage: [...COVERAGE, ...v.unchecked.map(partner)], summary: [sfact("ANSWER", "תשובה קצרה", prioritiesHe(v), "DERIVED", "PARTNER_KNOWLEDGE"), sfact("MORE", "עוד פריטים (לפירוט לפי בקשה)", v.more, "DERIVED", "PARTNER_KNOWLEDGE"),
        sfact("CHECKED", "נבדקו", { events: v.readiness.events.length, activeProjects: v.momentum.length, artists: v.artists.length, scheduleDays: v.schedule.days.length }, "DERIVED", "PARTNER_KNOWLEDGE"), sfact("LIMIT", "מגבלת הצגה (לא כלל עסקי)", 5, "DERIVED", "PARTNER_KNOWLEDGE"), heur] });
  },
};
