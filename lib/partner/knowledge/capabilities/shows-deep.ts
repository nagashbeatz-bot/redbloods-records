/**
 * Sunny knowledge — SHOWS + DJ DEEP BRAIN (Owner-only, read-only). Pure views over sources the Gateway already loads
 * (lib/partner/shows/view.ts). Progressive: shows → one show → one section. The "new show" event reuses the Owner
 * operating model's show workflow (never writes).
 */
import type { KnowledgeCapability, KnowledgeItem } from "../types";
import { buildShowView, showPortfolio, type ShowView } from "../../shows/view";
import { showWorkflow } from "../../sunny/operating";
import { SHOW_SIGNAL_MODEL } from "../../system/shows";
import { byCount, idOf, item, partner, record, result, sfact, unavailable } from "./common";

const OWNER_FIN = { externalRead: true, ownerOnly: true, sensitivity: "FINANCIAL" } as const;
const NEEDS = ["STATE", "FINANCE", "OPERATIONS", "OWNER_KNOWLEDGE", "PROJECT_DETAIL", "LABEL_DETAIL"] as const;
export const SHOW_SECTIONS = ["summary", "identity", "artist", "dj", "money", "ledger", "rehearsals", "calendar", "tasks", "notifications", "portal", "signals", "questions", "history"] as const;
const COVERAGE = [
  partner("כסף ההופעה לפי הכללים של המערכת עצמה: נטו = מחיר − DJ − חזרות שנספרות; לאמן חצי. להופעה אין מטבע שמור (המערכת רושמת ₪)."),
  partner("DJ לא משובץ אוטומטית: CLEANTONE מנגן ברוב ההופעות, לא בכולן. אישור קיים רק ל-CLEANTONE."),
  partner("אין 'מוכנות להופעה' במערכת — רק ראיות (DJ, אישור, הודעות, חזרות, יומן, תשלום, משימות)."),
  partner("קבצי הופעה נשמרים בתיקיית האמן — סאני לא רואה אותם (פער), לא 'אין קבצים'."),
];

function rows(v: ShowView, s: string): Array<{ id: string; label: string; recordText?: boolean; epistemic: KnowledgeItem["epistemic"]; fields: Record<string, unknown> }> {
  switch (s) {
    case "identity": return [{ id: "identity", label: v.identity.name ?? "הופעה", recordText: true, epistemic: "FACT", fields: { ...v.identity, booker: v.booker } }];
    case "artist": return [{ id: "artist", label: v.artist.text ?? "—", recordText: true, epistemic: "FACT", fields: { ...v.artist } }];
    case "dj": return [{ id: "dj", label: v.dj?.displayName ?? "אין DJ", recordText: true, epistemic: v.dj ? "FACT" : "UNKNOWN", fields: { dj: v.dj } }];
    case "money": return [{ id: "money", label: "כסף ההופעה", epistemic: "DERIVED", fields: { ...v.money } }];
    case "ledger": return v.ledger.map((l, i) => ({ id: `l:${i}`, label: `${l.type} ${l.amount}`, epistemic: "FACT" as const, fields: { ...l } }));
    case "rehearsals": return v.rehearsals.map((r, i) => ({ id: `r:${i}`, label: `חזרה ${r.date ?? ""}`, epistemic: "FACT" as const, fields: { ...r } }));
    case "calendar": return [{ id: "calendar", label: "יומן", epistemic: "DERIVED", fields: { ...v.calendar } }];
    case "tasks": return v.tasks.map((t, i) => ({ id: `t:${i}`, label: t.title ?? "משימה", recordText: true, epistemic: "FACT" as const, fields: { ...t } }));
    case "notifications": return [{ id: "notifications", label: "הודעות לאמן / ל-DJ", epistemic: "FACT", fields: { ...v.notifications } }];
    case "portal": return [{ id: "portal", label: "פורטלים", epistemic: "FACT", fields: { ...v.portal, performanceFiles: v.performanceFiles } }];
    case "signals": return v.signals.map((x, i) => ({ id: `${x.code}:${i}`, label: x.he, recordText: true, epistemic: x.kind === "UNKNOWN" ? "UNKNOWN" : x.kind === "CANONICAL_FACT" ? "FACT" : "DERIVED", fields: { code: x.code, kind: x.kind } }));
    case "questions": return v.questions.map((q, i) => ({ id: `q:${i}`, label: q.questionHe, epistemic: "UNKNOWN" as const, fields: { kind: q.kind, why: q.why } }));
    case "history": return v.history.map((h, i) => ({ id: `h:${i}`, label: h.event, epistemic: "FACT" as const, fields: { at: h.at, kind: h.kind } }));
    default: return [];
  }
}

export const showView: KnowledgeCapability = {
  id: "show_view", domain: "SHOWS", titleHe: "תמונת הופעה מחוברת",
  descriptionForModel: "EVERYTHING Redbloods records about ONE show. Default summary (identity, money split, signals, questions). Sections: identity (+ booker), artist (client id canonical; roster by artist text = ledger rule; collaboration), dj (client, label DJ, CLEANTONE confirmation), money (price, advance, client payment, DJ fee, counted rehearsals, split artist / label by the app's own rule, the 3 linked finance rows with status + currency), ledger (artist ledger rows from booking / close), rehearsals (cost, counted or not + why), calendar (stored event + that day's Owner occupancy), tasks (no-DJ / quote follow-up), notifications (artist / DJ sent markers: SENT / NOT_SENT / FAILED / outdated), portal, signals, questions, history.",
  examplesHe: ["מה קורה עם ההופעה הזו?", "ה-DJ אישר?", "האמן קיבל הודעה?", "כמה האמן מקבל מההופעה?", "יש חזרה?", "מה עוד חסר להופעה?"],
  modes: { view: { descriptionForModel: "One show (param show; optional section)" } }, defaultMode: "view",
  params: { show: { kind: "entityKey", types: ["show"], descriptionForModel: "The show (partner_resolve / show_portfolio)" }, section: { kind: "enum", values: [...SHOW_SECTIONS], descriptionForModel: "Which part (default summary)" } },
  entityScope: { types: ["show"], param: "show", mode: "view", limit: 1 },
  paging: { defaultLimit: 25, maxLimit: 50 }, recordTextLimit: 2000, access: OWNER_FIN, needs: NEEDS, optionalNeeds: ["CALENDAR", "SETTINGS"],
  read(src, q) {
    if (!q.params.show) return result([], { completeness: "UNKNOWN", missing: [{ fact: "show", whyNeeded: "pass params.show" }] });
    if (!src.labelDetail || src.labelDetail.status !== "OK") return unavailable("shows");
    const v = buildShowView(src, idOf(q.params.show));
    if (!v) return result([], { completeness: "UNKNOWN", missing: [{ fact: "show", whyNeeded: "no such show in the live data" }] });
    const s = q.params.section ?? "summary";
    const out = s === "summary" ? [...rows(v, "signals"), ...rows(v, "questions"), { id: "sections", label: "חלקים זמינים", epistemic: "FACT" as const, fields: { sections: SHOW_SECTIONS.filter((x) => x !== "summary") } }] : rows(v, s);
    return result(out.map((r) => item({ id: `${s}:${r.id}`, entity: v.key, label: r.recordText ? record(r.label) : partner(r.label), epistemic: r.epistemic, source: "SHOWS", fields: { section: s, ...r.fields } })),
      { summary: [sfact("SHOW", "הופעה", { key: v.key, ...v.identity, notes: undefined }, "FACT", "SHOWS"), sfact("SPLIT", "חלוקה", v.money.split, "DERIVED", "SHOWS"), sfact("DJ", "DJ", v.dj ? { name: v.dj.displayName, confirmation: v.dj.confirmation } : null, "FACT", "SHOWS"), sfact("SIGNALS", "אותות", byCount(v.signals.map((x) => x.code)), "DERIVED", "SHOWS")],
        completeness: v.unavailable.length ? "PARTIAL" : "COMPLETE", coverage: [...COVERAGE, ...v.unavailable.map((u) => partner(u))], missing: out.length ? [] : [{ fact: s, whyNeeded: "Redbloods holds nothing for this show in this section" }] });
  },
};

export const showPortfolioCap: KnowledgeCapability = {
  id: "show_portfolio", domain: "SHOWS", titleHe: "הופעות — תמונת מצב",
  descriptionForModel: "Shows side by side with FACTS, never a ranking: date, status, artist, DJ + confirmation, price, client payment, artist fee / label profit (app split), rehearsals, artist / DJ sent markers, ledger rows, signals, open questions. Modes: upcoming (confirmed, future), all (newest first), signal (param signal), event ('נכנסה הופעה ל<artist> ב-<date>': params artist + date — existing show check, what is known, what to ask, downstream effects; nothing is created).",
  examplesHe: ["אילו הופעות קרובות?", "אילו הופעות לא שולמו?", "באילו הופעות אין DJ?", "נכנסה הופעה לשליו ב-15.10"],
  modes: { upcoming: { descriptionForModel: "Confirmed future shows" }, all: { descriptionForModel: "Every show" }, signal: { descriptionForModel: "Shows with param signal" }, event: { descriptionForModel: "New-show event (params artist + date)" } }, defaultMode: "upcoming",
  params: { signal: { kind: "enum", values: SHOW_SIGNAL_MODEL.map((x) => x.code), descriptionForModel: "signal code" }, artist: { kind: "entityKey", types: ["label-artist", "client"], descriptionForModel: "event: the artist" }, date: { kind: "ymd", descriptionForModel: "event: the show date" } },
  paging: { defaultLimit: 25, maxLimit: 50 }, access: OWNER_FIN, needs: NEEDS, optionalNeeds: ["CALENDAR", "SETTINGS"],
  read(src, q) {
    if (q.mode === "event") {
      if (!q.params.artist) return result([], { completeness: "UNKNOWN", missing: [{ fact: "artist", whyNeeded: "pass params.artist (partner_resolve; ask when ambiguous)" }] });
      const w = showWorkflow(src, q.params.artist, q.params.date ?? null);
      if (!w.resolved) return result(w.questions.map((x, i) => item({ id: `ask:${i}`, label: partner(x.questionHe), epistemic: "UNKNOWN", source: "SHOWS", fields: { why: x.why } })), { completeness: "UNKNOWN" });
      return result([...w.known.map((k) => item({ id: `known:${k.item}`, label: partner(k.item), epistemic: "FACT", source: "SHOWS", fields: { value: k.value, knownFrom: k.source } })), ...w.questions.map((x, i) => item({ id: `ask:${i}`, label: partner(x.questionHe), epistemic: "UNKNOWN", source: "SHOWS", fields: { why: x.why } })),
        item({ id: "downstream", label: partner("מה יקרה במערכת"), epistemic: "FACT", source: "SHOWS", fields: { downstream: w.downstream, notifications: w.notifications, actions: w.actions, calendarOnDate: w.calendarOnDate } })],
        { summary: [sfact("EVENT", "אירוע", { workflow: w.workflow, artist: w.artist, date: w.date, existingShow: w.existingShow, mutations: "none — proposed only" }, "DERIVED", "SHOWS")], coverage: COVERAGE });
    }
    if (!src.labelDetail || src.labelDetail.status !== "OK") return unavailable("shows");
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).format(src.now);
    const all = showPortfolio(src);
    const rowsOut = q.mode === "upcoming" ? all.filter((r) => ["אושרה", "נסגר"].includes(r.status ?? "") && (r.date ?? "") >= today).reverse() : q.mode === "signal" ? all.filter((r) => !q.params.signal || r.signals.includes(q.params.signal)) : all;
    return result(rowsOut.map((r) => item({ id: r.key, entity: r.key, label: record(`${r.name ?? "הופעה"} · ${r.date ?? ""}`), epistemic: "DERIVED", source: "SHOWS", fields: { ...r } })),
      { summary: [sfact("TOTAL", "הופעות", all.length, "FACT", "SHOWS"), sfact("BY_STATUS", "לפי סטטוס", byCount(all.map((r) => r.status ?? "—")), "FACT", "SHOWS"), sfact("BY_SIGNAL", "לפי אות", byCount(all.flatMap((r) => r.signals)), "DERIVED", "SHOWS")], coverage: [...COVERAGE, partner("מסודר לפי תאריך — לא דירוג.")] });
  },
};
