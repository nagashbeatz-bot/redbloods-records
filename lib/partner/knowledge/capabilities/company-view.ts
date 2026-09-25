/**
 * Sunny knowledge — WHOLE-SYSTEM INTEGRATION V1: company_view (Owner-only, read-only). ONE organizational brain:
 * progressive disclosure over the company view (lib/partner/company/view.ts) and the company contract
 * (lib/partner/system/company.ts). Overview first (3–5 observations), then drill-down by topic / group / side.
 */
import type { KnowledgeCapability, KnowledgeItem } from "../types";
import { buildCompanyView, type CompanyObservation, type CompanyView } from "../../company/view";
import * as CO from "../../system/company";
import { byCount, item, partner, record, result, sfact } from "./common";

const OWNER_FIN = { externalRead: true, ownerOnly: true, sensitivity: "FINANCIAL" } as const;
const NEEDS = ["STATE", "FINANCE", "OPERATIONS", "OWNER_KNOWLEDGE", "PROJECT_DETAIL", "CLIENT_DETAIL", "LABEL_DETAIL", "SETTINGS", "INTEGRITY", "CASES", "ACTIONS", "OUTCOMES"] as const;
const COVERAGE = [
  partner("סאני אחד על כל החברה: לקוחות, הצעות, פרויקטים, כסף, לייבל, ריליסים, הופעות, הפקה, מיקס, וידאו, יומן, צוות, החלטות, סתירות ופערים — מחובר, לא מועתק."),
  partner("אין ציון ואין דירוג. תשומת לב ≠ בעיה. הסדר קבוע (חוסם אותך → התחייבות ללקוח → כסף → זמן → ממתין לאחרים → אירוע → לייבל → ריליס → סתירה → מערכת) — סדר הצגה, לא עדיפות."),
  partner("כסף: ממומש ≠ צפוי ≠ פוטנציאלי; לפי מטבע, בלי המרה. פנקס Red Films לא בכספים. הלייבל הוא השקעה מוגנת, לא בעיה."),
  partner("תקשורת מחוץ ל-Redbloods לא נראית: 'לא רואה את זה רשום', אף פעם 'לא עשית'. מקור שנכשל = לא ידוע, לא ריק."),
];
export const COMPANY_TOPICS = ["executive", "attention", "cashflow", "client_work", "sales", "label", "releases", "shows", "production", "mix", "video", "calendar", "team", "decisions", "conflicts", "gaps", "changes", "outcomes", "delivery", "friction", "security", "actions", "morning_brief",
  "attention_map", "graph", "precedence", "planner", "workflows", "gap_roots", "primitives", "approval", "repo_coverage", "table_coverage", "depth", "discoveries", "rules"] as const;
const MODEL_TOPICS = new Set(["attention_map", "graph", "precedence", "planner", "workflows", "gap_roots", "primitives", "approval", "repo_coverage", "table_coverage", "depth", "discoveries", "rules"]);
const GROUPS = [...CO.ATTENTION_DIMENSIONS, "CONTEXT"] as const;

type Row = { id: string; label: string; recordText?: boolean; epistemic: KnowledgeItem["epistemic"]; entity?: string | null; source?: KnowledgeItem["source"]; fields: Record<string, unknown> };
const obsRow = (o: CompanyObservation, i: number): Row => ({ id: `${o.code}:${i}`, label: o.he, recordText: true, epistemic: o.epistemic, entity: o.entity, source: "PROJECTS", fields: { code: o.code, nature: o.nature, group: o.group, dims: o.dims, whoseMove: o.side, domain: o.domain, alsoSeenIn: o.alsoSeenIn, project: o.project } });
const obj = (id: string, label: string, v: unknown, epistemic: KnowledgeItem["epistemic"] = "DERIVED", source: KnowledgeItem["source"] = "PROJECTS"): Row => ({ id, label, epistemic, source, fields: v && typeof v === "object" && !Array.isArray(v) ? { ...(v as Record<string, unknown>) } : { value: v } });

function topicRows(v: CompanyView, t: string, group?: string, side?: string): Row[] {
  switch (t) {
    case "attention": return v.attention.filter((o) => (!group || o.group === group) && (!side || o.side === side)).map(obsRow);
    case "cashflow": return v.cashflow ? [obj("realized", "ממומש החודש (₪ מול יעד)", v.cashflow.realized, "DERIVED", "FINANCE"), obj("collectible", "לגבייה לפי מצב גבייה ומטבע", v.cashflow.collectible, "DERIVED", "FINANCE"), obj("expected", "צפוי (לפי סוג, מטבע)", v.cashflow.expected, "DERIVED", "FINANCE"), obj("potential", "פוטנציאלי (הצעות)", v.cashflow.potential, "DERIVED", "FINANCE"), obj("openExpenses", "הוצאות פתוחות", { byCurrency: v.cashflow.openExpenses, count: v.cashflow.openExpenseCount }, "DERIVED", "FINANCE"), obj("vendors", "ספקים", v.cashflow.vendors, "DERIVED", "FINANCE"), obj("video", "וידאו (פנקס נפרד)", v.cashflow.video, "DERIVED", "FINANCE"), obj("advance", "פרויקטים בלי מקדמה רשומה", { projects: v.cashflow.advanceEvidenceMissing }, "DERIVED", "FINANCE"), obj("signals", "אותות כספים", { signals: v.cashflow.financeSignals, reliableFrom: v.cashflow.reliableFrom }, "DERIVED", "FINANCE"), obj("tension", "תזרים מול לייבל", v.cashflow.tension, "OWNER_DECISION", "FINANCE")] : [{ id: "finance", label: "כספים לא נקראו — מצב הכסף לא ידוע (לא אפס)", epistemic: "UNKNOWN", fields: {} }];
    case "client_work": return [...v.clientWork.projects.map((p, i) => ({ id: `p:${i}`, label: p.name ?? "פרויקט", recordText: true, epistemic: "FACT" as const, entity: p.project, fields: { ...p } })), obj("deadlines", "דדליינים (מודל הבעלים)", v.clientWork.deadlines)];
    case "sales": return [...v.sales.openProposals.map((p, i) => ({ id: `prop:${i}`, label: `${p.client}: ${p.title ?? "הצעה"}`, recordText: true, epistemic: "FACT" as const, entity: p.key, fields: { amount: p.amount, currency: p.currency, meaning: "POTENTIAL" } })), obj("followups", "מעקבים", { due: v.sales.followUpsDue, note: v.sales.potentialNote })];
    case "label": return [...v.label.artists.map((a) => ({ id: a.key, label: a.name, recordText: true, epistemic: "FACT" as const, entity: a.key, source: "LABEL_ARTISTS" as const, fields: { ...a } })), ...(v.label.releaseCandidates ?? []).map((x, i) => ({ id: `cand:${i}`, label: `מועמד לריליס: ${x.name}`, recordText: true, epistemic: "DERIVED" as const, entity: x.project, source: "RELEASES" as const, fields: { ...x, rule: v.label.rule } }))];
    case "releases": return [...v.releases.upcoming.map((r, i) => ({ id: `up:${i}`, label: r.name ?? "ריליס", recordText: true, epistemic: "FACT" as const, entity: r.project, source: "RELEASES" as const, fields: { ...r, state: "UPCOMING_TARGET" } })), ...v.releases.targetPassed.map((r, i) => ({ id: `passed:${i}`, label: r.name ?? "ריליס", recordText: true, epistemic: "FACT" as const, entity: r.project, source: "RELEASES" as const, fields: { ...r, state: "TARGET_PASSED_NOT_RELEASED" } })), obj("counts", "ספירות", { noTarget: v.releases.noTarget, releasedLast90: v.releases.releasedLast90 }, "DERIVED", "RELEASES")];
    case "shows": return v.shows.map((s) => ({ id: s.key, label: `${s.name ?? "הופעה"} ${s.date ?? ""}`, recordText: true, epistemic: "FACT" as const, entity: s.key, source: "SHOWS" as const, fields: { ...s } }));
    case "production": return v.production ? [obj("victor", "הפקה (ויקטור)", v.production.counts, "DERIVED", "TEAM_VICTOR")] : [{ id: "victor", label: "לא ידוע", epistemic: "UNKNOWN", fields: {} }];
    case "mix": return v.mix ? [obj("mix", "מיקס / מאסטר", { ...v.mix.counts, ...v.mix.money }, "DERIVED", "TEAM_STEVEN")] : [{ id: "mix", label: "לא ידוע", epistemic: "UNKNOWN", fields: {} }];
    case "video": return v.video ? [obj("counts", "וידאו", v.video.counts, "DERIVED", "RED_FILMS"), obj("money", "שכבות כסף וידאו", v.video.money, "DERIVED", "RED_FILMS")] : [{ id: "video", label: "לא ידוע", epistemic: "UNKNOWN", fields: {} }];
    case "calendar": return [obj("status", `יומן: ${v.calendar.status}`, { counts: v.calendar.counts, rule: v.calendar.rule }, "FACT", "CALENDAR"), ...(v.calendar.today ?? []).map((e, i) => ({ id: `today:${i}`, label: e.title ?? "אירוע אישי / אחר (לא עובדה עסקית)", recordText: true, epistemic: e.businessFact === "CANONICAL" ? "FACT" as const : "OBSERVATION" as const, source: "CALENDAR" as const, fields: { day: "today", ...e } })), ...(v.calendar.next7 ?? []).map((e, i) => ({ id: `next:${i}`, label: e.title ?? "אירוע אישי / אחר (לא עובדה עסקית)", recordText: true, epistemic: e.businessFact === "CANONICAL" ? "FACT" as const : "OBSERVATION" as const, source: "CALENDAR" as const, fields: { day: "next7", ...e } }))];
    case "team": return [obj("team", "מי מחזיק את הצעד הבא (לפי ראיות)", v.team)];
    case "decisions": return v.decisions.map((d) => ({ id: d.id, label: d.questionHe, recordText: true, epistemic: d.liveState === "NO_LONGER_OBSERVED" ? "DERIVED" as const : "UNKNOWN" as const, fields: { kind: d.kind, why: d.why, domain: d.domain, origin: d.origin, liveState: d.liveState ?? "OPEN", evidence: d.evidenceHe ?? null, answerable: d.answerable } }));
    case "conflicts": return [...v.conflicts.data.map(obsRow), ...v.conflicts.registered.map((g) => ({ id: g.id, label: g.description, epistemic: "FACT" as const, source: "SYSTEM_CONTRACTS" as const, fields: { domain: g.domain, kind: "REGISTERED_CONFLICT" } })), ...v.conflicts.implementationVsPolicy.map((x) => ({ id: x.id, label: x.he, epistemic: "FACT" as const, source: "SYSTEM_CONTRACTS" as const, fields: { kind: "IMPLEMENTATION_VS_OWNER_POLICY" } }))];
    case "gaps": return [...v.gaps.byRoot.map((g) => ({ id: g.root, label: g.problemHe, epistemic: "FACT" as const, source: "SYSTEM_CONTRACTS" as const, fields: { ...g } })), obj("pending", "תחומים שעוד מחכים למשימת עומק", { domains: v.gaps.pendingDeepDomains, total: v.gaps.total, liveSystemGapSignals: v.gaps.liveSystemGapSignals }, "FACT", "SYSTEM_CONTRACTS")];
    case "changes": return [obj("changes", "מה השתנה (רק מתי — מה בדיוק לא נרשם)", v.changes)];
    case "outcomes": return v.outcomes.map((o, i) => ({ id: `o:${i}`, label: o.headlineHe, recordText: true, epistemic: "FACT" as const, source: "OUTCOMES" as const, fields: { ...o } }));
    case "delivery": return [obj("delivery", "מסירה", v.delivery)];
    case "friction": return [...v.friction.recurringSignals.map((r) => ({ id: r.code, label: `${r.code} × ${r.occurrences}`, epistemic: "PATTERN_CANDIDATE" as const, fields: { ...r } })), ...v.friction.repeatedQuestions.map((r, i) => ({ id: `rq:${i}`, label: r.suggestionHe || r.questionType, epistemic: "PATTERN_CANDIDATE" as const, fields: { ...r } }))];
    case "security": return [obj("security", "מפת אבטחה (דיווח בלבד)", v.security, "FACT", "SYSTEM_CONTRACTS")];
    case "actions": return [obj("actions", "מה סאני יכול לעשות היום ומה בעתיד", v.actionMap, "FACT", "ACTIONS")];
    case "morning_brief": return [obj("brief", "סיכום בוקר (לפי בקשה — בלי פוש)", { date: v.morningBrief.date, calendarStatus: v.morningBrief.calendarStatus, money: v.morningBrief.money, decision: v.morningBrief.decision, note: v.morningBrief.note }), ...(v.morningBrief.today ?? []).map((e, i) => ({ id: `today:${i}`, label: e.title ?? "אירוע אישי / אחר", recordText: true, epistemic: "OBSERVATION" as const, source: "CALENDAR" as const, fields: { ...e } })), ...v.morningBrief.attention.map(obsRow)];
    default: return [obj("executive", "מצב החברה", { ...v.executive, headline: undefined }), ...v.executive.headline.map(obsRow)];
  }
}

function modelRows(t: string): Row[] {
  const S: KnowledgeItem["source"] = "SYSTEM_CONTRACTS";
  const r = (id: string, label: string, fields: Record<string, unknown>): Row => ({ id, label, epistemic: "FACT", source: S, fields });
  switch (t) {
    case "attention_map": return Object.entries(CO.ATTENTION_MAP).map(([code, m]) => r(code, code, { ...m }));
    case "graph": return CO.COMPANY_GRAPH.map((e, i) => r(`edge:${i}`, `${e.from} → ${e.to}`, { ...e }));
    case "precedence": return CO.SOURCE_PRECEDENCE.map((p) => r(p.concept, p.concept, { ...p }));
    case "planner": return CO.QUESTION_PLANNER.map((q) => r(q.id, q.patterns[0], { ...q }));
    case "workflows": return Object.entries(CO.COMPANY_WORKFLOWS).map(([id, st]) => r(id, id, { stages: st }));
    case "gap_roots": return Object.entries(CO.GAP_ROOTS).map(([id, g]) => r(id, g.problemHe, { ...g }));
    case "primitives": return CO.FUTURE_PRIMITIVES.map((p) => r(p.id, p.id, { ...p, implemented: false }));
    case "approval": return [r("approval", "מודל אישור", { steps: CO.APPROVAL_MODEL, executableToday: CO.EXECUTABLE_TODAY })];
    case "repo_coverage": return CO.REPO_COVERAGE.map((m, i) => r(`module-group:${i}`, m.domain, { class: m.cls, domain: m.domain, note: m.note }));
    case "table_coverage": return [r("tables", "כיסוי טבלאות (לפי ערוץ קריאה)", { total: Object.keys(CO.TABLE_COVERAGE).length, byReach: byCount(Object.values(CO.TABLE_COVERAGE).map((x) => x.split(" ")[0])) })];
    case "depth": return [...CO.DEPTH_RECONCILIATION.map((d) => r(d.domain, d.domain, { ...d })), r("pending", "עדיין מחכים", { domains: CO.STILL_PENDING })];
    case "discoveries": return CO.DISCOVERIES.map((d) => r(d.id, d.what, { ...d }));
    default: return CO.COMPANY_RULES.map((x, i) => r(`rule:${i}`, x, {}));
  }
}

/** Deterministic planner: which sections answer the question (pattern match; no LLM, no score). */
export function planQuestion(q: string): { id: string; sections: readonly string[] } {
  const t = (q ?? "").trim().toLowerCase();
  for (const p of CO.QUESTION_PLANNER) if (p.patterns.some((x) => t.includes(x.toLowerCase()))) return { id: p.id, sections: p.sections };
  return { id: "COMPANY_STATE", sections: ["executive", "attention"] };
}

export const companyView: KnowledgeCapability = {
  id: "company_view", domain: "COMPANY", titleHe: "סאני — כל החברה, מחובר",
  descriptionForModel: "ONE connected picture of the whole company (Owner-only, read-only), composed from every Deep Brain; never a score or ranking. Modes: overview (start here: 3–5 observations in a fixed presentation order + executive counts), attention (params group / side), review (param topic, e.g. cashflow / client_work / sales / label / releases / shows / production / mix / video / calendar / team / conflicts / changes / outcomes / delivery / friction / security / actions), decisions (open Owner questions + known decisions re-evaluated live; Sunny never answers them), gaps (root-cause map), morning_brief (on request, no push), plan (param question: the Owner's words → the sections that answer), model (param topic: the company model contract).",
  examplesHe: ["מה אני צריך לעשות עכשיו?", "מה מצב החברה?", "מה תקוע?", "איפה כסף תקוע?", "מה עם הלייבל?", "מה מחכה לי?", "מה מחכה לאנשים אחרים?", "מה סותר?", "מה המערכת לא יודעת?", "תן לי סיכום בוקר"],
  modes: { overview: { descriptionForModel: "Executive state + 3–5 observations" }, attention: { descriptionForModel: "All attention observations (optional group / side)" }, review: { descriptionForModel: "One company review (param topic)" }, decisions: { descriptionForModel: "Owner decision queue" }, gaps: { descriptionForModel: "Root-cause gap map" }, morning_brief: { descriptionForModel: "Morning brief on request" }, plan: { descriptionForModel: "Plan + answer a free question (param question)" }, model: { descriptionForModel: "The company model contract (param topic)" } }, defaultMode: "overview",
  params: {
    topic: { kind: "enum", values: [...COMPANY_TOPICS], descriptionForModel: "review / model: which topic" },
    question: { kind: "text", maxLength: 120, descriptionForModel: "plan: the Owner's question in their words" },
    group: { kind: "enum", values: [...GROUPS], descriptionForModel: "attention: one presentation group (a dimension)" },
    side: { kind: "enum", values: ["OWNER", "EXTERNAL", "NONE", "UNKNOWN"], descriptionForModel: "attention: whose recorded move it appears to be" },
  },
  paging: { defaultLimit: 25, maxLimit: 50 }, recordTextLimit: 1200, access: OWNER_FIN, needs: NEEDS, optionalNeeds: ["CALENDAR"],
  read(src, q) {
    if (q.mode === "model") {
      const t = q.params.topic && MODEL_TOPICS.has(q.params.topic) ? q.params.topic : "rules";
      return result(modelRows(t).map((r) => item({ id: r.id, label: partner(r.label), epistemic: r.epistemic, source: r.source ?? "SYSTEM_CONTRACTS", fields: r.fields })), { summary: [sfact("COMPANY_BASELINE", "גרסת מודל החברה", CO.COMPANY_BASELINE_VERSION, "FACT", "SYSTEM_CONTRACTS")], coverage: COVERAGE, completeness: "COMPLETE" });
    }
    if (!src.state || src.state.status !== "OK") return result([], { completeness: "UNKNOWN", coverage: COVERAGE, missing: [{ fact: "company state", whyNeeded: "the company picture cannot be composed without it — unknown, not empty" }] });
    const v = buildCompanyView(src);
    const base = { coverage: [...COVERAGE, ...v.partial.map((p) => partner(p))], completeness: (v.partial.length ? "PARTIAL" : "COMPLETE") as "PARTIAL" | "COMPLETE" };
    const summary = [sfact("EXECUTIVE", "מצב החברה", { ...v.executive, headline: v.executive.headline.length }, "DERIVED", "PROJECTS"), sfact("SOURCES", "מקורות", v.sourceState, "FACT", "PROJECTS")];
    const emit = (rows: Row[], extra: ReturnType<typeof sfact>[] = []) => result(rows.map((r) => item({ id: r.id, entity: r.entity ?? null, label: r.recordText ? record(r.label) : partner(r.label), epistemic: r.epistemic, source: r.source ?? "PROJECTS", fields: r.fields })), { ...base, summary: [...summary, ...extra] });
    if (q.mode === "attention") return emit(topicRows(v, "attention", q.params.group, q.params.side), [sfact("BY_GROUP", "לפי קבוצה (סדר הצגה, לא עדיפות)", v.executive.attentionByGroup, "DERIVED", "PROJECTS")]);
    if (q.mode === "review") return emit(topicRows(v, q.params.topic && !MODEL_TOPICS.has(q.params.topic) ? q.params.topic : "executive"));
    if (q.mode === "decisions") return emit(topicRows(v, "decisions"), [sfact("DECISIONS", "החלטות", byCount(v.decisions.map((d) => d.liveState ?? "OPEN")), "DERIVED", "PROJECTS")]);
    if (q.mode === "gaps") return emit(topicRows(v, "gaps"));
    if (q.mode === "morning_brief") return emit(topicRows(v, "morning_brief"));
    if (q.mode === "plan") {
      const plan = planQuestion(q.params.question ?? "");
      const rows = plan.sections.flatMap((s) => topicRows(v, s).slice(0, s === "attention" ? 8 : 6).map((r) => ({ ...r, id: `${s}:${r.id}`, fields: { section: s, ...r.fields } })));
      return emit(rows, [sfact("PLAN", "תוכנית תשובה", { question: plan.id, sections: plan.sections }, "DERIVED", "SYSTEM_CONTRACTS")]);
    }
    return emit(topicRows(v, "executive"), [sfact("BY_GROUP", "תשומת לב לפי קבוצה", v.executive.attentionByGroup, "DERIVED", "PROJECTS")]);
  },
};
