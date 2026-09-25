/**
 * Sunny knowledge — LABEL ARTISTS DEEP BRAIN (Owner-only, read-only). Pure views over sources the Gateway already
 * loads (lib/partner/label/view.ts). Progressive: roster → one artist → one section.
 */
import type { KnowledgeCapability, KnowledgeItem } from "../types";
import { artistPortfolio, buildArtistView, type ArtistView } from "../../label/view";
import { ARTIST_SIGNAL_MODEL } from "../../system/label-artists";
import { byCount, idOf, item, partner, record, result, sfact, unavailable } from "./common";

const OWNER_FIN = { externalRead: true, ownerOnly: true, sensitivity: "FINANCIAL" } as const;
const NEEDS = ["STATE", "FINANCE", "OPERATIONS", "OWNER_KNOWLEDGE", "INTEGRITY", "CASES", "ACTIONS", "OUTCOMES", "PROJECT_DETAIL", "LABEL_DETAIL"] as const;
export const ARTIST_SECTIONS = ["summary", "identity", "projects", "releases", "next_steps", "beats", "shows", "money", "sessions", "calendar", "tasks", "meetings", "visual_content", "availability", "presence", "portal", "owner_knowledge", "signals", "questions", "history"] as const;
const COVERAGE = [
  partner("ריליס = הקישור הקנוני היחיד אמן↔פרויקט; שאר הפרויקטים לפי שם (TEXT_MATCH). עבודת לייבל נקבעת לפי סוג עסקי / ריליס / הסיווג שלך."),
  partner("מאזן אמן, מחזורים, הכנסות מדיה וכסף הופעות הם רשומות נפרדות — לא מחוברים; לא נשמר בהם מטבע (המסכים מציגים ₪). כסף לקוח של אותו אדם אינו כסף אמן."),
  partner("אין ציון, אין קצב ריליסים מחייב ואין סף חוסר פעילות — רק ראיות ותאריכים. 'אין פעילות רשומה' ≠ שיפוט של האמן."),
  partner("CLEANTONE מנגן ברוב ההופעות — לא בכולן; DJ לא משובץ אוטומטית."),
];

function rows(v: ArtistView, s: string): Array<{ id: string; label: string; recordText?: boolean; epistemic: KnowledgeItem["epistemic"]; fields: Record<string, unknown> }> {
  switch (s) {
    case "identity": return [{ id: "identity", label: v.identity.name, recordText: true, epistemic: "FACT", fields: { ...v.identity } }];
    case "projects": return v.projects.map((p) => ({ id: p.id, label: p.name, recordText: true, epistemic: p.quality === "CANONICAL_RELATION" ? "FACT" : "DERIVED", fields: { ...p } }));
    case "releases": return [...v.releases.map((r) => ({ id: r.key, label: r.projectName ?? r.key, recordText: true, epistemic: "FACT" as const, fields: { ...r } })), { id: "cadence", label: "ראיות קצב", epistemic: "FACT", fields: { ...v.cadence } }];
    case "next_steps": return v.nextSteps.map((n, i) => ({ id: `step:${i}`, label: n.step, recordText: true, epistemic: "DERIVED", fields: { evidence: n.evidence, entity: n.entity ?? null } }));
    case "beats": return v.beats.map((b, i) => ({ id: `beat:${i}`, label: b.name, recordText: true, epistemic: "FACT", fields: { ...b } }));
    case "shows": return v.shows.map((x) => ({ id: x.key, label: x.name ?? `הופעה ${x.date ?? ""}`, recordText: true, epistemic: "FACT", fields: { ...x } }));
    case "money": return [{ id: "ledger", label: "מאזן אמן", epistemic: "DERIVED", fields: { currencyRule: v.money.currencyRule, ledger: v.money.ledger } }, { id: "cycles", label: "מחזורים", epistemic: "DERIVED", fields: { ...v.money.cycles } }, { id: "media", label: "הכנסות מדיה", epistemic: "FACT", fields: { ...v.money.mediaIncome } }, { id: "recoup", label: "החזר השקעה", epistemic: "FACT", fields: { note: v.money.recoup } }, { id: "label_work_projects", label: "כסף בפרויקטי לייבל", epistemic: "DERIVED", fields: { byCurrency: v.money.labelWorkProjects, clientWork: v.money.clientWork } }];
    case "sessions": return v.sessions.map((x, i) => ({ id: `session:${i}`, label: `${x.type ?? "סשן"} ${x.date ?? ""}`, epistemic: "FACT", fields: { ...x } }));
    case "calendar": return [{ id: "calendar", label: "יומן", epistemic: "DERIVED", fields: { ...v.calendar } }];
    case "tasks": return v.tasks.map((t, i) => ({ id: `task:${i}`, label: t.title ?? "משימה", recordText: true, epistemic: "FACT", fields: { ...t } }));
    case "meetings": return v.meetings.map((m, i) => ({ id: `meeting:${i}`, label: `פגישה ${m.date ?? ""}`, epistemic: "FACT", fields: { ...m } }));
    case "visual_content": return [...v.redFilms.map((r, i) => ({ id: `rf:${i}`, label: r.title, recordText: true, epistemic: "FACT" as const, fields: { kind: "RED_FILMS", ...r } })), ...v.social.map((k, i) => ({ id: `social:${i}`, label: k.title, recordText: true, epistemic: "FACT" as const, fields: { kind: "SOCIAL", ...k } })), ...v.projects.filter((p) => p.clipPlanning).map((p) => ({ id: `clip:${p.id}`, label: p.name, recordText: true, epistemic: "FACT" as const, fields: { kind: "CLIP_PLANNING", ...p.clipPlanning } }))];
    case "availability": return [{ id: "availability", label: "זמינות", epistemic: "FACT", fields: { ...v.availability } }];
    case "presence": return [{ id: "presence", label: "כניסה לפורטל", epistemic: "FACT", fields: { ...v.presence } }];
    case "portal": return [{ id: "portal", label: "פורטל", epistemic: "FACT", fields: { ...v.portal, notifications: v.notifications } }];
    case "owner_knowledge": return v.ownerKnowledge.map((k, i) => ({ id: `k:${i}`, label: k.meaning, recordText: true, epistemic: "OWNER_REPORTED", fields: { ...k } }));
    case "signals": return v.signals.map((x, i) => ({ id: `${x.code}:${i}`, label: x.he, recordText: true, epistemic: x.kind === "UNKNOWN" ? "UNKNOWN" : x.kind === "CANONICAL_FACT" ? "FACT" : "DERIVED", fields: { code: x.code, kind: x.kind, entity: x.entity ?? null } }));
    case "questions": return v.questions.map((x, i) => ({ id: `q:${i}`, label: x.questionHe, epistemic: "UNKNOWN", fields: { kind: x.kind, why: x.why } }));
    case "history": return v.history.map((h, i) => ({ id: `h:${i}`, label: h.event, recordText: true, epistemic: "FACT", fields: { at: h.at, kind: h.kind } }));
    default: return [];
  }
}

export const artistView: KnowledgeCapability = {
  id: "artist_view", domain: "LABEL", titleHe: "תמונת אמן לייבל מחוברת",
  descriptionForModel: "EVERYTHING Redbloods records about ONE label artist across the company. Default section summary (identity, counts, money by record, signals, next steps, questions). Sections: identity (roster, portal / login, client record = separate role, label DJ), projects (release link canonical vs name match, label vs client work, deadline class, ball holder, Victor, engineers + open comments, sessions, delivery), releases (+ cadence evidence), next_steps (evidence per project / release / show), beats, shows (price / DJ fee / artist fee / DJ + confirmation / rehearsals / sent markers), money (ledger, cycles, media income + recoup snapshots, label-work project money — separate, no currency stored), sessions, calendar, tasks, meetings, visual_content (Red Films / clip planning / social), availability, presence, portal, owner_knowledge, signals, questions, history.",
  examplesHe: ["מה קורה עם שליו?", "מה קורה עם אבי?", "מה הדבר הבא שצריך לקרות עם האמן?", "מה המאזן של שליו?", "מתי הריליס הבא?", "איזה ביטים יש לו?"],
  modes: { view: { descriptionForModel: "One label artist (param artist; optional section)" } }, defaultMode: "view",
  params: {
    artist: { kind: "entityKey", types: ["label-artist"], descriptionForModel: "The label artist (partner_resolve)" },
    section: { kind: "enum", values: [...ARTIST_SECTIONS], descriptionForModel: "Which part to deepen (default summary)" },
  },
  entityScope: { types: ["label-artist"], param: "artist", mode: "view", limit: 1 },
  paging: { defaultLimit: 25, maxLimit: 50 }, recordTextLimit: 2000, access: OWNER_FIN, needs: NEEDS, optionalNeeds: ["CALENDAR", "SETTINGS"],
  read(src, q) {
    if (!q.params.artist) return result([], { completeness: "UNKNOWN", missing: [{ fact: "artist", whyNeeded: "pass params.artist (partner_resolve gives the key)" }] });
    if (!src.state || src.state.status !== "OK") return unavailable("label artists");
    const v = buildArtistView(src, idOf(q.params.artist));
    if (!v) return result([], { completeness: "UNKNOWN", missing: [{ fact: "artist", whyNeeded: "no such label artist in the live data" }] });
    const s = q.params.section ?? "summary";
    const summary = [sfact("ARTIST", "אמן", { key: v.key, name: v.identity.name, status: v.identity.status, portal: v.identity.portal.slug }, "FACT", "LABEL_ARTISTS"),
      sfact("COUNTS", "כמויות", { projects: v.projects.length, openProjects: v.projects.filter((p) => p.open).length, releases: v.releases.length, activeReleases: v.releases.filter((r) => r.active).length, shows: v.shows.length, sessions: v.sessions.length, beats: v.beats.length }, "FACT", "LABEL_ARTISTS"),
      sfact("NEXT_RELEASE", "הריליס הבא", v.nextRelease ? { name: v.nextRelease.projectName, stage: v.nextRelease.stage, target: v.nextRelease.targetDate } : null, "FACT", "RELEASES"),
      sfact("LEDGER_BALANCE", "מאזן אמן (בלי מטבע שמור)", v.money.ledger?.allTime ?? "UNKNOWN", "DERIVED", "LABEL_ARTISTS"),
      sfact("SIGNALS", "אותות", byCount(v.signals.map((x) => x.code)), "DERIVED", "LABEL_ARTISTS"), sfact("LAST_RECORDED_ACTIVITY", "פעילות רשומה אחרונה", v.lastRecordedActivity, "DERIVED", "LABEL_ARTISTS")];
    const out = s === "summary" ? [...rows(v, "next_steps"), ...rows(v, "signals"), ...rows(v, "questions"), { id: "sections", label: "חלקים זמינים", epistemic: "FACT" as const, fields: { sections: ARTIST_SECTIONS.filter((x) => x !== "summary") } }] : rows(v, s);
    return result(out.map((r) => item({ id: `${s}:${r.id}`, entity: v.key, label: r.recordText ? record(r.label) : partner(r.label), epistemic: r.epistemic, source: "LABEL_ARTISTS", fields: { section: s, ...r.fields } })),
      { summary, completeness: v.unavailable.length ? "PARTIAL" : "COMPLETE", coverage: [...COVERAGE, ...v.unavailable.map((u) => partner(u))], missing: out.length ? [] : [{ fact: s, whyNeeded: "Redbloods holds nothing for this artist in this section" }] });
  },
};

export const artistPortfolioCap: KnowledgeCapability = {
  id: "artist_portfolio", domain: "LABEL", titleHe: "אמני הלייבל — תמונת מצב",
  descriptionForModel: "The label roster side by side with FACTS, never a ranking or score: status, portal / login, open projects (label work), work at Victor / engineers, active releases + next release, releases done, upcoming sessions / shows, ledger balance (no currency stored), closed cycles, media records, last portal entry, last recorded activity, signal codes, open questions. Mode signal filters by one signal code.",
  examplesHe: ["מה המצב עם אמני הלייבל?", "למי יש ריליס מתוכנן?", "מי לא התקדם?", "אצל מי יש עבודה אצל ויקטור?"],
  modes: { roster: { descriptionForModel: "Every roster artist" }, signal: { descriptionForModel: "Artists with param signal" } }, defaultMode: "roster",
  params: { signal: { kind: "enum", values: ARTIST_SIGNAL_MODEL.map((s) => s.code), descriptionForModel: "signal: the signal code" } },
  paging: { defaultLimit: 20, maxLimit: 50 }, access: OWNER_FIN, needs: NEEDS, optionalNeeds: ["CALENDAR", "SETTINGS"],
  read(src, q) {
    if (!src.state || src.state.status !== "OK") return unavailable("label artists");
    const all = artistPortfolio(src);
    const rowsOut = q.mode === "signal" ? all.filter((r) => !q.params.signal || r.signals.includes(q.params.signal)) : all;
    return result(rowsOut.map((r) => item({ id: r.key, entity: r.key, label: record(r.name), epistemic: "DERIVED", source: "LABEL_ARTISTS", fields: { ...r } })),
      { summary: [sfact("ROSTER", "סגל", all.length, "FACT", "LABEL_ARTISTS"), sfact("BY_SIGNAL", "אמנים לפי אות", byCount(all.flatMap((r) => r.signals)), "DERIVED", "LABEL_ARTISTS")], coverage: [...COVERAGE, partner("מסודר לפי שם — לא דירוג אמנים.")] });
  },
};
