/**
 * Sunny knowledge — FULL-BRAIN COMPLETION (Owner-only, read-only): Sessions / Tasks / Meetings / Albums / Delivery /
 * Social / Files (storage) / Reports / Sunny itself. Progressive: overview (counts + signals) → list (filter) → one
 * record (ref) → the domain contract (mode model). Pure views over sources the Gateway already loads.
 */
import type { KnowledgeCapability, KnowledgeItem, KnowledgeSourceNeed } from "../types";
import { buildSessionsView, buildTasksView, buildMeetingsView, buildAlbumsView, buildDeliveryView, buildSocialView, type WorkSignal, type WorkQuestion } from "../../work/view";
import { buildStorageView, buildReportsState, buildSunnySelfView } from "../../self/view";
import { WORK_DOMAINS } from "../../system/work-domains";
import { BACKGROUND_JOBS, ATTENTION_ENGINES, CODE_BUSINESS_GOALS, LEGACY_AI, REPORTS_MODEL, STORAGE_NAMESPACES, STORAGE_OPERATIONS, STORAGE_READ_DECISION, SUNNY_CONNECTOR_MODEL, SUNNY_CORE_MODEL } from "../../system/platform-domains";
import { byCount, item, partner, record, result, sfact, unavailable } from "./common";

const OWNER = { externalRead: true, ownerOnly: true, sensitivity: "FINANCIAL" } as const;
type Row = { id: string; label: string; recordText?: boolean; epistemic: KnowledgeItem["epistemic"]; entity?: string | null; fields: Record<string, unknown> };
const sigItems = (signals: WorkSignal[], questions: WorkQuestion[] = []): Row[] => [
  ...signals.map((s, i) => ({ id: `${s.code}:${i}`, label: s.he, recordText: true, epistemic: (s.kind === "UNKNOWN" ? "UNKNOWN" : s.kind === "CANONICAL_FACT" ? "FACT" : "DERIVED") as KnowledgeItem["epistemic"], entity: s.entity ?? null, fields: { code: s.code, project: s.project ?? null } })),
  ...questions.map((q, i) => ({ id: `q:${i}`, label: q.questionHe, recordText: true, epistemic: "UNKNOWN" as const, entity: q.entity ?? null, fields: { kind: q.kind, why: q.why } })),
];
const contractRows = (id: string): Row[] => {
  const d = WORK_DOMAINS.find((x) => x.id === id)!;
  const { internal: _i, ...served } = d; void _i;
  return Object.entries(served).map(([k, v]) => ({ id: k, label: k, epistemic: "FACT" as const, fields: v && typeof v === "object" && !Array.isArray(v) ? { ...(v as Record<string, unknown>) } : { value: v } }));
};
function emit(rows: Row[], o: { summary?: ReturnType<typeof sfact>[]; unavailableList?: string[]; coverage?: string[]; source?: KnowledgeItem["source"] }) {
  const un = o.unavailableList ?? [];
  return result(rows.map((r) => item({ id: r.id, entity: r.entity ?? null, label: r.recordText ? record(r.label) : partner(r.label), epistemic: r.epistemic, source: o.source ?? "PROJECT_DETAIL", fields: r.fields })),
    { summary: o.summary ?? [], coverage: [...(o.coverage ?? []).map((c) => partner(c)), ...un.map((u) => partner(u))], completeness: un.some((u) => /unknown, not none|unknown$/i.test(u)) ? "PARTIAL" : "COMPLETE" });
}
const ref = (q: { params: Readonly<Record<string, string>> }) => (q.params.ref ?? "").replace(/^[a-z-]+:/, "");
const need = (...n: KnowledgeSourceNeed[]) => n;

// ── generic work capability builder ──
function workCapability<V extends { counts: object; signals: WorkSignal[]; unavailable: string[] }, R extends { key: string }>(o: {
  id: string; domain: KnowledgeCapability["domain"]; contract: string; titleHe: string; description: string; examplesHe: string[]; needs: readonly KnowledgeSourceNeed[]; coverage: string[];
  build: (src: Parameters<KnowledgeCapability["read"]>[0]) => V; list: (v: V) => R[]; filters: readonly string[]; pick: (r: R, f: string) => boolean; label: (r: R) => string; questions?: (v: V) => WorkQuestion[];
}): KnowledgeCapability {
  return {
    id: o.id, domain: o.domain, titleHe: o.titleHe, descriptionForModel: o.description, examplesHe: o.examplesHe,
    modes: { overview: { descriptionForModel: "Counts + signals (+ open questions)" }, list: { descriptionForModel: "Records (param filter)" }, record: { descriptionForModel: "One record (param ref)" }, model: { descriptionForModel: "How Redbloods implements this domain (fields, vocabularies, relations, rules, side effects, security, production state, gaps)" } }, defaultMode: "overview",
    params: { filter: { kind: "enum", values: [...o.filters], descriptionForModel: "list: which records" }, ref: { kind: "text", maxLength: 80, descriptionForModel: "record: the record key or id" } },
    paging: { defaultLimit: 25, maxLimit: 50 }, recordTextLimit: 1200, access: OWNER, needs: o.needs,
    read(src, q) {
      if (q.mode === "model") return emit(contractRows(o.contract), { source: "SYSTEM_CONTRACTS", coverage: o.coverage });
      if (!src.state || src.state.status !== "OK") return unavailable("company state");
      const v = o.build(src);
      const rows = o.list(v);
      if (q.mode === "record") {
        const r = rows.find((x) => x.key.endsWith(`:${ref(q)}`) || x.key === q.params.ref);
        if (!r) return result([], { completeness: "UNKNOWN", missing: [{ fact: o.id, whyNeeded: "pass params.ref (a key from list)" }] });
        return emit([{ id: r.key, label: o.label(r), recordText: true, epistemic: "FACT", entity: r.key, fields: { ...(r as Record<string, unknown>) } }, ...sigItems(v.signals.filter((s) => s.entity === r.key))], { unavailableList: v.unavailable, coverage: o.coverage });
      }
      if (q.mode === "list") {
        const f = q.params.filter ?? o.filters[0];
        return emit(rows.filter((r) => o.pick(r, f)).map((r) => ({ id: r.key, label: o.label(r), recordText: true, epistemic: "FACT" as const, entity: r.key, fields: { ...(r as Record<string, unknown>) } })), { summary: [sfact("COUNTS", "ספירות", v.counts, "DERIVED", "PROJECT_DETAIL")], unavailableList: v.unavailable, coverage: o.coverage });
      }
      return emit(sigItems(v.signals, o.questions?.(v) ?? []), { summary: [sfact("COUNTS", "ספירות רשומות", v.counts, "DERIVED", "PROJECT_DETAIL"), sfact("SIGNALS", "אותות", byCount(v.signals.map((s) => s.code)), "DERIVED", "PROJECT_DETAIL")], unavailableList: v.unavailable, coverage: o.coverage });
    },
  };
}

export const sessionView = workCapability({
  id: "session_view", domain: "SESSIONS", contract: "SESSIONS", titleHe: "סשנים, חזרות וימי צילום — עומק",
  description: "Every session record: type (studio / mix cleaning / rehearsal / show rehearsal / clip shoot), status with its real meaning (התקיים may be auto-marked on app load — not proof), date passed vs happened, project / show, calendar event stored, linked expenses per currency, session limits, orphan expenses. Modes overview / list (filter) / record (ref) / model.",
  examplesHe: ["אילו סשנים יש השבוע?", "הסשן התקיים?", "כמה סשנים נשארו לפרויקט?", "אילו חזרות להופעה נקבעו?"],
  needs: need("STATE", "PROJECT_DETAIL", "OPERATIONS", "FINANCE", "LABEL_DETAIL"), coverage: ["תאריך שעבר ≠ התקיים. 'התקיים' יכול להיות סימון אוטומטי של האפליקציה.", "ביטול סשן לא מוחק את אירוע היומן; פרטי אירוע חיים — דרך יכולת היומן."],
  build: buildSessionsView, list: (v) => v.sessions, filters: ["upcoming", "all", "passed_still_planned", "cancelled", "show_rehearsals", "clip_shoots", "no_project", "with_expense"] as const,
  pick: (s, f) => ({ upcoming: !s.datePassed && s.status === "מתוכנן", all: true, passed_still_planned: s.datePassed && s.status === "מתוכנן", cancelled: s.status === "בוטל", show_rehearsals: s.kind === "SHOW_REHEARSAL", clip_shoots: s.kind === "CLIP_SHOOT", no_project: !s.project, with_expense: s.finance.length > 0 } as Record<string, boolean>)[f] ?? false,
  label: (s) => `${s.type ?? "סשן"} ${s.date ?? ""}${s.project?.name ? ` · ${s.project.name}` : s.title ? ` · ${s.title}` : ""}`, questions: (v) => v.questions,
});
export const taskView = workCapability({
  id: "task_view", domain: "COMPANY", contract: "TASKS", titleHe: "משימות — עומק",
  description: "Every task: status, related entity (canonical) and origin (proposal / quote / Victor / mix / no-DJ follow-ups — TEXT markers, never promoted), show, due date + overdue, Google Task mirror, canonical back-links from Victor works / send log. Modes overview / list (filter) / record (ref) / model. No assignee or priority exists.",
  examplesHe: ["מה המשימות הפתוחות?", "מה באיחור?", "איזה משימות מעקב הצעות יש?", "המשימה הזאת מסונכרנת לגוגל?"],
  needs: need("STATE", "PROJECT_DETAIL", "OPERATIONS"), coverage: ["קישור הצעה / הצעת הופעה / מיקס למשימה הוא לפי טקסט — לא מפתח.", "Google Tasks עצמן לא נקראות — רק מזהה המראה."],
  build: buildTasksView, list: (v) => v.tasks, filters: ["open", "overdue", "all", "done", "cancelled", "proposal_follow_ups", "mirrored_to_google", "general"] as const,
  pick: (t, f) => ({ open: t.status === "פתוח", overdue: t.overdue, all: true, done: t.status === "בוצע", cancelled: t.status === "בוטל", proposal_follow_ups: t.origin?.id === "PROPOSAL_FOLLOW_UP", mirrored_to_google: t.googleTask === "MIRRORED", general: t.relatedType === "general" } as Record<string, boolean>)[f] ?? false,
  label: (t) => t.title ?? "משימה",
});
export const meetingView = workCapability({
  id: "meeting_view", domain: "CLIENTS", contract: "MEETINGS", titleHe: "פגישות — עומק",
  description: "Every meeting: client (text id + booking-time name snapshot vs current name), project, date / time / duration / location, status with meaning (a past נקבעה = unknown whether it happened), calendar event stored (edits / cancels never sync to Google). Modes overview / list / record / model.",
  examplesHe: ["אילו פגישות יש?", "הפגישה התקיימה?", "פגישות עם לקוח X?"],
  needs: need("STATE", "PROJECT_DETAIL", "OPERATIONS"), coverage: ["פגישה שעברה ועדיין 'נקבעה' — לא ידוע אם התקיימה. אין תוצאה / מעקב לפגישה."],
  build: buildMeetingsView, list: (v) => v.meetings, filters: ["all", "upcoming", "past_still_scheduled", "held", "cancelled"] as const,
  pick: (m, f) => ({ all: true, upcoming: m.happened === "NOT_YET", past_still_scheduled: m.happened.startsWith("UNKNOWN"), held: m.status === "התקיימה", cancelled: m.status === "בוטלה" } as Record<string, boolean>)[f] ?? false,
  label: (m) => `פגישה ${m.date ?? ""}${m.client ? ` · ${m.client.currentName ?? m.client.snapshotName ?? ""}` : ""}`,
});
export const albumView = workCapability({
  id: "album_view", domain: "PROJECTS", contract: "ALBUMS", titleHe: "אלבומים / EP — עומק",
  description: "Every album / EP project: ordered track list with manual status + mix + master statuses (not derived from the mix works), out-of-vocabulary statuses, the project's engineer works side by side, previous-system info, legacy finance blob. Modes overview / list / record / model.",
  examplesHe: ["מה מצב האלבום?", "כמה שירים במיקס?", "איזה שירים באלבום?"],
  needs: need("STATE", "PROJECT_DETAIL", "OPERATIONS"), coverage: ["סטטוס מיקס/מאסטר של שיר באלבום ידני ונפרד מעבודות המיקס — שני מקורות."],
  build: buildAlbumsView, list: (v) => v.albums, filters: ["all", "with_tracks", "no_tracks"] as const,
  pick: (a, f) => ({ all: true, with_tracks: a.tracks.length > 0, no_tracks: a.tracks.length === 0 } as Record<string, boolean>)[f] ?? false,
  label: (a) => a.name ?? "אלבום",
});
export const deliveryView = workCapability({
  id: "delivery_view", domain: "PROJECTS", contract: "DELIVERY", titleHe: "מסירה ללקוח — עומק",
  description: "Per project: the delivery record (status / date / public link exists — no recipient, no history), final files (count / last / request open), send-log entries with a link, remaining money to collect, and the EVIDENCE level (DELIVERY_RECORDED > LINK_SENT_LOGGED > DELIVERY_READY > FINAL_FILES_EXIST > PROJECT_COMPLETED > NONE). 'Delivered' only from a delivery record. Modes overview / list / record / model.",
  examplesHe: ["מה נמסר?", "הפרויקט נמסר ללקוח?", "מה הושלם ולא נמסר?", "יש קבצים סופיים?"],
  needs: need("STATE", "PROJECT_DETAIL", "OPERATIONS", "FINANCE"), coverage: ["'נמסר' רק מרשומת מסירה — לא מסיום פרויקט ולא מקבצים סופיים. מסירה מחוץ למערכת לא נראית.", "תוכן תיקיית המסירה לא נקרא."],
  build: buildDeliveryView, list: (v) => v.projects, filters: ["all", "delivered", "ready_not_marked", "completed_no_evidence", "final_files", "balance_open"] as const,
  pick: (p, f) => ({ all: true, delivered: p.evidence === "DELIVERY_RECORDED", ready_not_marked: p.delivery?.status === "ready", completed_no_evidence: p.projectStatus === "הושלם" && !["DELIVERY_RECORDED", "LINK_SENT_LOGGED"].includes(p.evidence), final_files: p.finalFiles.count > 0, balance_open: !!p.remainingToCollect && Object.values(p.remainingToCollect).some((x) => x > 0) } as Record<string, boolean>)[f] ?? false,
  label: (p) => p.name ?? "פרויקט",
});
export const socialView = workCapability({
  id: "social_view", domain: "SALES", contract: "SOCIAL", titleHe: "סושיאל — עומק",
  description: "Every campaign (one per project): status, release date (vs the release target), content items by status / type / platform, posted, overdue, files, promotions (+ paid marketing expense link), and the APP's own readiness checklist + recommendations (implementation behaviour — never a verdict on a release). Modes overview / list / record / model.",
  examplesHe: ["מה מצב הקמפיין?", "מה חסר לסושיאל לפני הריליס?", "כמה תוכן פורסם?"],
  needs: need("STATE", "PROJECT_DETAIL", "OPERATIONS"), coverage: ["הצ'קליסט 'מה חסר' הוא ברירת מחדל של האפליקציה — לא מדיניות שלך, ולא קובע שריליס לא יכול לצאת."],
  build: buildSocialView, list: (v) => v.campaigns, filters: ["all", "active", "with_flags"] as const,
  pick: (k, f) => ({ all: true, active: k.status === "active", with_flags: k.appReadiness.missing.length > 0 } as Record<string, boolean>)[f] ?? false,
  label: (k) => k.title,
});

export const storageView: KnowledgeCapability = {
  id: "storage_view", domain: "COMPANY", titleHe: "קבצים ואחסון — מה קיים ואיפה",
  descriptionForModel: "Every file Redbloods has a DATABASE record for, by storage namespace (project files, instructions, mix versions + attachments, final files, delivery folders, Victor work, artist portal, beats, Red Films, social, covers): counts, sizes, last upload, public-link counts; per project (param ref) the file list — names / types / sizes / dates / uploader, never paths or links. mode model: namespaces, operations, the live-listing decision. Files that live only in storage are named as a gap.",
  examplesHe: ["אילו קבצים יש לפרויקט?", "יש קבצים סופיים?", "איפה נשמרים הסקיצות?", "מה סאני לא רואה בדרופבוקס?"],
  modes: { overview: { descriptionForModel: "Namespaces" }, project: { descriptionForModel: "One project's recorded files (param ref)" }, model: { descriptionForModel: "Storage architecture" } }, defaultMode: "overview",
  params: { ref: { kind: "text", maxLength: 80, descriptionForModel: "project: a project id" } }, paging: { defaultLimit: 25, maxLimit: 50 }, recordTextLimit: 600, access: OWNER, needs: need("STATE", "PROJECT_DETAIL", "OPERATIONS"),
  read(src, q) {
    if (q.mode === "model") return emit([...STORAGE_NAMESPACES.map((n) => { const { internal: _i, ...s } = n; void _i; return { id: n.id, label: n.meaningHe, epistemic: "FACT" as const, fields: { ...s } }; }), ...STORAGE_OPERATIONS.map((o) => ({ id: `op:${o.op}`, label: o.op, epistemic: "FACT" as const, fields: { ...o } })), { id: "live_listing", label: "קריאה חיה של האחסון", epistemic: "FACT", fields: { ...STORAGE_READ_DECISION } }], { source: "SYSTEM_CONTRACTS" });
    if (!src.state || src.state.status !== "OK") return unavailable("company state");
    const v = buildStorageView(src);
    if (q.mode === "project") {
      const p = v.byProject.find((x) => x.project === `project:${ref(q)}`);
      if (!p) return result([], { completeness: "UNKNOWN", missing: [{ fact: "project files", whyNeeded: "pass params.ref (a project id); no recorded file = none RECORDED (storage-only files are not listed)" }] });
      return emit(p.files.map((f, i) => ({ id: `f:${i}`, label: f.name ?? "קובץ", recordText: true, epistemic: "FACT" as const, entity: p.project, fields: { type: f.type, size: f.size, uploadedAt: f.uploadedAt, uploadedBy: f.uploadedBy, publicLink: f.publicLink } })), { unavailableList: v.unavailable });
    }
    return emit(v.namespaces.map((n) => ({ id: n.id, label: n.meaningHe, epistemic: "FACT" as const, fields: { ...n } })), { summary: [sfact("BACKENDS", "אחסון", v.backends, "FACT", "SYSTEM_CONTRACTS")], unavailableList: v.unavailable });
  },
};

export const reportsView: KnowledgeCapability = {
  id: "reports_view", domain: "COMPANY", titleHe: "דוחות, משימות רקע ומנועי תשומת לב",
  descriptionForModel: "The email reports (morning / evening automatic at the configured times, weekly manual only; one recipient; no history; static recommendations because AI is off), their money / date semantics compared with the Finance Brain and Sunny's morning brief (they can disagree), every background / scheduled job, every parallel attention engine with its classification, and the legacy in-app AI status. Modes overview / jobs / engines / model.",
  examplesHe: ["מתי נשלח דוח הבוקר?", "למה הדוח במייל מראה מספר אחר?", "אילו תהליכים רצים ברקע?", "מה ההבדל בין ההתראות לסאני?"],
  modes: { overview: { descriptionForModel: "Report schedule + semantics" }, jobs: { descriptionForModel: "Every background job" }, engines: { descriptionForModel: "Attention engines + legacy AI" }, model: { descriptionForModel: "The reports model" } }, defaultMode: "overview",
  params: {}, paging: { defaultLimit: 25, maxLimit: 50 }, access: OWNER, needs: need("SETTINGS"),
  read(src, q) {
    if (q.mode === "jobs") return emit(BACKGROUND_JOBS.map((j) => ({ id: j.id, label: j.does, epistemic: "FACT" as const, fields: { ...j } })), { source: "SYSTEM_CONTRACTS" });
    if (q.mode === "engines") return emit([...ATTENTION_ENGINES.map((e) => ({ id: e.id, label: e.what, epistemic: "FACT" as const, fields: { ...e } })), { id: "LEGACY_AI", label: "העוזר הישן באפליקציה", epistemic: "FACT", fields: { ...LEGACY_AI } }, { id: "CODE_BUSINESS_GOALS", label: "יעדים עסקיים שקבועים בקוד (לא מדיניות שלך)", epistemic: "FACT", fields: { goals: CODE_BUSINESS_GOALS.goals, semantics: CODE_BUSINESS_GOALS.semantics, consumers: CODE_BUSINESS_GOALS.consumers, classification: CODE_BUSINESS_GOALS.classification, vsOwnerPolicy: CODE_BUSINESS_GOALS.vsOwnerPolicy } }], { source: "SYSTEM_CONTRACTS" });
    if (q.mode === "model") { const { internal: _i, ...m } = REPORTS_MODEL; void _i; return emit(Object.entries(m).map(([k, val]) => ({ id: k, label: k, epistemic: "FACT" as const, fields: val && typeof val === "object" && !Array.isArray(val) ? { ...(val as unknown as Record<string, unknown>) } : { value: val } })), { source: "SYSTEM_CONTRACTS" }); }
    const r = buildReportsState(src);
    return emit([{ id: "schedule", label: "לוח זמנים של הדוחות", epistemic: r.schedule ? "FACT" : "UNKNOWN", fields: { ...(r.schedule ?? {}) } }, ...r.model.moneySemantics.map((m, i) => ({ id: `money:${i}`, label: m.report, epistemic: "FACT" as const, fields: { ...m } })), { id: "vs_sunny", label: "מול סיכום הבוקר של סאני", epistemic: "FACT", fields: { value: r.model.vsSunnyMorningBrief, dateSemantics: r.model.dateSemantics } }, { id: "types", label: "סוגי דוחות", epistemic: "FACT", fields: { types: r.model.types, recipients: r.model.recipients, history: r.model.history, ai: r.model.aiRecommendations, anomalies: r.model.anomalies } }], { source: "SETTINGS", unavailableList: r.unavailable });
  },
};

export const sunnySelf: KnowledgeCapability = {
  id: "sunny_self", domain: "PARTNER", titleHe: "סאני על עצמו — ידע, היסטוריה וגבולות",
  descriptionForModel: "What Sunny itself knows and remembers: Owner knowledge (taught facts, incl. withdrawals, latest), Owner answers to Sunny's questions (with status), action proposals + executed outcomes, open / deferred / learned integrity questions; what it CANNOT recall (no conversation text is ever stored; the connector audit is unreadable and hashes parameters). mode model: the Sunny core stores + the Claude connector (auth, scopes, tools, limits, audit, failure states, flags) — never tokens or secrets.",
  examplesHe: ["מה לימדתי אותך?", "מה עניתי לך קודם?", "מה ביצעת?", "מה אתה לא זוכר?", "איך אתה מחובר ל-Claude?"],
  modes: { overview: { descriptionForModel: "Knowledge / answers / actions / boundaries" }, model: { descriptionForModel: "Sunny core + connector model" } }, defaultMode: "overview",
  params: {}, paging: { defaultLimit: 25, maxLimit: 50 }, recordTextLimit: 600, access: OWNER, needs: need("OWNER_KNOWLEDGE", "MEMORY", "ACTIONS", "OUTCOMES", "INTEGRITY"),
  read(src, q) {
    if (q.mode === "model") return emit([{ id: "core", label: SUNNY_CORE_MODEL.meaningHe, epistemic: "FACT", fields: { ...SUNNY_CORE_MODEL } }, { id: "connector", label: SUNNY_CONNECTOR_MODEL.meaningHe, epistemic: "FACT", fields: { ...SUNNY_CONNECTOR_MODEL } }], { source: "SYSTEM_CONTRACTS" });
    const v = buildSunnySelfView(src);
    return emit([
      { id: "knowledge", label: "מה לימדת אותי", epistemic: v.knowledge ? "OWNER_DECISION" : "UNKNOWN", fields: { ...(v.knowledge ?? {}) } },
      { id: "answers", label: "מה ענית לי", epistemic: v.ownerAnswers ? "OWNER_DECISION" : "UNKNOWN", fields: { ...(v.ownerAnswers ?? {}) } },
      { id: "actions", label: "הצעות פעולה ותוצאות", epistemic: "FACT", fields: { actions: v.actions, outcomes: v.outcomes } },
      { id: "questions", label: "שאלות פתוחות / נדחו / נלמדו", epistemic: "FACT", fields: { ...(v.openQuestions ?? {}) } },
      { id: "boundaries", label: "מה אני לא זוכר", epistemic: "FACT", fields: { audit: v.audit, conversationMemory: v.conversationMemory, cannotAnswer: v.cannotAnswer, canAnswer: v.canAnswer } },
    ], { source: "OWNER_KNOWLEDGE", unavailableList: v.unavailable });
  },
};

export const FULL_BRAIN_CAPABILITIES = [sessionView, taskView, meetingView, albumView, deliveryView, socialView, storageView, reportsView, sunnySelf] as const;
