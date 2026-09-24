/**
 * Sunny knowledge — OPERATIONS capabilities (Sunny Full Brain: safe read gaps closed). Pure views over the Eyes company
 * state (tasks) and the OPERATIONS source (lib/partner/operations/readers.ts). READ-ONLY.
 *
 * Every link is labelled with its quality: ID links (project_id, client_id, work_id…) are ID; artist names in free text
 * are TEXT_MATCH. Money stays per currency (no FX). Nothing here writes, schedules, notifies or executes.
 */
import { PORTAL_ARTISTS } from "../../../red-artists/portal-registry";
import type { KnowledgeCapability, KnowledgeReadResult, KnowledgeSources } from "../types";
import type { GatewayEntityType } from "../../gateway/types";
import { byCount, clientName, idOf, item, labelArtistName, ok, partner, projectName, record, result, sfact, state, unavailable } from "./common";
import type { Maybe } from "../../operations/readers";

const ops = (src: KnowledgeSources) => ok(src.operations);
const today = (src: KnowledgeSources) => state(src)?.todayIL ?? src.now.toISOString().slice(0, 10);
const sum = (xs: Array<number | null>) => xs.reduce<number>((a, x) => a + (x ?? 0), 0);
const cappedNote = (...secs: Array<Maybe<unknown>>) => (secs.some((x) => x?.capped) ? [partner("חלק מהרשומות לא נקרא (תקרת שורות) — הסכומים חלקיים.")] : []);
/** Section missing → UNKNOWN with an honest reason (never "none"). */
function need<T>(sec: Maybe<T>, what: string): sec is NonNullable<Maybe<T>> { return !!sec && Array.isArray(sec.rows) && !!what; }
const miss = (what: string): KnowledgeReadResult => unavailable(what);
const projectRef = (src: KnowledgeSources, id: string | null) => (id ? { entity: `project:${id}`, name: projectName(src, id) } : { entity: null, name: null });
const OWNER_FIN = { externalRead: true, ownerOnly: true, sensitivity: "FINANCIAL" } as const;
const STD = { externalRead: true, ownerOnly: false, sensitivity: "STANDARD" } as const;
const PROJECT_SCOPE = (mode: string, limit = 8) => ({ types: ["project"] as readonly GatewayEntityType[], param: "project", mode, limit });
const projectParam = { project: { kind: "entityKey" as const, types: ["project"] as const, descriptionForModel: "Only this project (use partner_resolve)" } };

// ── TASKS (canonical tasks; previously loaded into state but not queryable) ──
export const tasks: KnowledgeCapability = {
  id: "tasks", domain: "COMPANY", titleHe: "משימות",
  descriptionForModel: "Tasks from the canonical task list: title, status (פתוח / בוצע / בוטל), due date, what it relates to (project / client / Red Films production / general / a show). Follow-up tasks are created by proposals, shows (quote follow-up), Victor deadlines and Red Films; a Google Task may mirror a task (Google → local completion sync only). Overdue = open with a due date before today.",
  examplesHe: ["מה המשימות הפתוחות?", "מה באיחור?", "איזה משימות יש על הפרויקט?"],
  modes: { open: { descriptionForModel: "Open tasks, soonest due first" }, overdue: { descriptionForModel: "Open tasks past their due date" }, all: { descriptionForModel: "Every task" } }, defaultMode: "open",
  params: projectParam, entityScope: PROJECT_SCOPE("open"),
  paging: { defaultLimit: 20, maxLimit: 50 }, access: STD, needs: ["STATE"],
  read(src, q) {
    const t = state(src)?.domains.tasksFull.data;
    if (!t) return unavailable("tasks");
    const d = today(src);
    const pid = q.params.project ? idOf(q.params.project) : null;
    const rows = t.items.filter((x) => (q.mode === "all" || x.status === "פתוח") && (q.mode !== "overdue" || (!!x.dueYmd && x.dueYmd < d)) && (!pid || (x.relatedType === "project" && x.relatedId === pid)))
      .sort((a, b) => (a.dueYmd ?? "9999").localeCompare(b.dueYmd ?? "9999") || a.id.localeCompare(b.id));
    return result(rows.map((x) => item({
      id: x.id, entity: x.relatedType === "project" && x.relatedId ? `project:${x.relatedId}` : x.relatedType === "client" && x.relatedId ? `client:${x.relatedId}` : null,
      label: record(x.title), epistemic: "FACT", source: "TASKS", relationQuality: x.relatedId ? "ID" : undefined,
      fields: { status: x.status, due: x.dueYmd, overdue: x.status === "פתוח" && !!x.dueYmd && x.dueYmd < d, relatedType: x.relatedType },
    })), { summary: [sfact("BY_STATUS", "משימות לפי סטטוס", t.byStatus, "FACT", "TASKS")], coverage: [partner("הערות המשימה לא נקראות.")] });
  },
};

// ── RED FILMS (all productions + budgets; clips are productions of type קליפ) ──
export const redFilms: KnowledgeCapability = {
  id: "red_films", domain: "SALES", titleHe: "Red Films — הפקות",
  descriptionForModel: "Red Films video productions (clips, shoot days, social content, live shoots…): type, status, edit status, collection status, shoot / publish dates, linked project (ID), artist / client (text), client price and advance, general budget, and budget items planned / actual + payments recorded. IMPORTANT: Red Films budget payments are a separate ledger — they do NOT create Finance transactions (Finance does not see Red Films spend). A managed clip's budget follows the project's clip price (one-way). Amounts are in the production's (unstated, normally ₪) currency.",
  examplesHe: ["מה קורה ב-Red Films?", "איזה קליפים בהפקה?", "כמה הוצאנו על הקליפ של שליו?"],
  modes: { active: { descriptionForModel: "Not published / cancelled" }, all: { descriptionForModel: "Every production" } }, defaultMode: "active",
  params: { ...projectParam, type: { kind: "text", maxLength: 30, descriptionForModel: "Production type (e.g. קליפ, יום צילום)" } },
  entityScope: PROJECT_SCOPE("all", 5),
  paging: { defaultLimit: 15, maxLimit: 40 }, access: OWNER_FIN, needs: ["OPERATIONS", "STATE"],
  read(src, q) {
    const o = ops(src);
    if (!o || !need(o.redFilms, "red films")) return miss("Red Films productions");
    const pid = q.params.project ? idOf(q.params.project) : null;
    const rows = o.redFilms.rows.filter((p) => (q.mode === "all" || !["פורסם", "בוטל"].includes(p.status ?? "")) && (!pid || p.projectId === pid) && (!q.params.type || p.productionType === q.params.type))
      .sort((a, b) => (a.shootDate ?? "9999").localeCompare(b.shootDate ?? "9999") || a.id.localeCompare(b.id));
    const items = rows.map((p) => {
      const bi = o.budgetItems?.rows.filter((x) => x.productionId === p.id) ?? null;
      const bp = o.budgetPayments?.rows.filter((x) => x.productionId === p.id) ?? null;
      return item({
        id: p.id, entity: p.projectId ? `project:${p.projectId}` : null, label: record(p.title), epistemic: "FACT", source: "RED_FILMS", relationQuality: p.projectId ? "ID" : undefined,
        fields: {
          productionType: p.productionType, status: p.status, editStatus: p.editStatus, collectionStatus: p.collectionStatus, shootDate: p.shootDate, publishDate: p.publishDate,
          project: projectRef(src, p.projectId).name ? record(projectRef(src, p.projectId).name!) : null, artistText: p.artistName ? record(p.artistName) : null, clientSource: p.clientSource,
          clientPrice: p.clientPrice, advanceRequired: p.advanceRequired, advanceReceived: p.advanceReceived, generalBudget: p.generalBudget,
          budgetPlanned: bi ? sum(bi.map((x) => x.planned)) : null, budgetActual: bi ? sum(bi.map((x) => x.actual)) : null, budgetPaid: bp ? sum(bp.map((x) => x.amount)) : null, budgetItems: bi?.length ?? null,
        },
      });
    });
    return result(items, { summary: [sfact("BY_STATUS", "הפקות לפי סטטוס", byCount(o.redFilms.rows.map((p) => p.status ?? "—")), "FACT", "RED_FILMS"), sfact("BY_TYPE", "לפי סוג", byCount(o.redFilms.rows.map((p) => p.productionType ?? "—")), "FACT", "RED_FILMS")],
      completeness: o.budgetItems && o.budgetPayments ? "COMPLETE" : "PARTIAL",
      coverage: [partner("תשלומי תקציב של Red Films הם ספר נפרד — אינם מופיעים בכספים."), partner("שם האמן/הלקוח בהפקה הוא טקסט (TEXT_MATCH); הקישור לפרויקט הוא מזהה."), ...cappedNote(o.redFilms, o.budgetItems, o.budgetPayments)] });
  },
};

// ── CLIP PLANNING (clip_items: planning rows until promoted into a Finance expense) ──
export const clipPlanning: KnowledgeCapability = {
  id: "clip_planning", domain: "SALES", titleHe: "תכנון קליפ",
  descriptionForModel: "Clip planning rows per project (category, planned amount + currency, status). These are PLANNING ONLY — not money — until promoted, which creates a Finance expense (expense_scope קליפ) and removes the planning row.",
  examplesHe: ["מה מתוכנן לקליפ?", "כמה תכננו להוציא על הקליפ?"],
  modes: { current: { descriptionForModel: "Current planning rows (not cancelled)" } }, defaultMode: "current",
  params: projectParam, entityScope: PROJECT_SCOPE("current", 8),
  paging: { defaultLimit: 20, maxLimit: 50 }, access: OWNER_FIN, needs: ["OPERATIONS", "STATE"],
  read(src, q) {
    const o = ops(src);
    if (!o || !need(o.clipItems, "clip items")) return miss("clip planning");
    const pid = q.params.project ? idOf(q.params.project) : null;
    const rows = o.clipItems.rows.filter((c) => c.status !== "בוטל" && (!pid || c.projectId === pid));
    const perCur: Record<string, number> = {};
    for (const c of rows) perCur[c.currency ?? "₪"] = (perCur[c.currency ?? "₪"] ?? 0) + (c.amount ?? 0);
    return result(rows.map((c, i) => item({ id: `${c.projectId ?? "none"}:${i}`, entity: c.projectId ? `project:${c.projectId}` : null, label: partner(c.category ?? "פריט"), epistemic: "FACT", source: "CLIPS",
      fields: { project: c.projectId && projectName(src, c.projectId) ? record(projectName(src, c.projectId)!) : null, amount: c.amount, currency: c.currency ?? "₪", status: c.status, planningOnly: true } })),
      { summary: [sfact("PLANNED_BY_CURRENCY", "מתוכנן לפי מטבע (לא כסף בפועל)", perCur, "FACT", "CLIPS")], coverage: cappedNote(o.clipItems) });
  },
};

// ── MEETINGS ──
export const meetings: KnowledgeCapability = {
  id: "meetings", domain: "CLIENTS", titleHe: "פגישות",
  descriptionForModel: "Meetings (date, time, status נקבעה / התקיימה / בוטלה, linked client and project by ID, whether a Google Calendar event was created at booking). NOTE: changing or cancelling a meeting in Redbloods does not update its Google event; Google Calendar itself is not read by Sunny.",
  examplesHe: ["איזה פגישות יש השבוע?", "מתי נפגשנו עם הלקוח?"],
  modes: { upcoming: { descriptionForModel: "Today and later, not cancelled" }, recent: { descriptionForModel: "Before today" }, all: { descriptionForModel: "Every meeting" } }, defaultMode: "upcoming",
  params: { about: { kind: "entityKey", types: ["project", "client"], descriptionForModel: "Only meetings linked to this project / client" } },
  entityScope: { types: ["project", "client"], param: "about", mode: "all", limit: 5 },
  paging: { defaultLimit: 15, maxLimit: 40 }, access: STD, needs: ["OPERATIONS", "STATE"],
  read(src, q) {
    const o = ops(src);
    if (!o || !need(o.meetings, "meetings")) return miss("meetings");
    const d = today(src);
    const about = q.params.about ?? null;
    const rows = o.meetings.rows.filter((m) => (q.mode === "all" || (q.mode === "upcoming" ? (m.date ?? "") >= d && m.status !== "בוטלה" : (m.date ?? "9999") < d))
      && (!about || (about.startsWith("project:") ? m.projectId === idOf(about) : m.clientId === idOf(about))))
      .sort((a, b) => (q.mode === "recent" ? (b.date ?? "").localeCompare(a.date ?? "") : (a.date ?? "").localeCompare(b.date ?? "")) || (a.time ?? "").localeCompare(b.time ?? ""));
    return result(rows.map((m) => item({ id: m.id, entity: m.clientId ? `client:${m.clientId}` : m.projectId ? `project:${m.projectId}` : null, label: partner(`פגישה ${m.date ?? ""} ${m.time ?? ""}`.trim()), epistemic: "FACT", source: "MEETINGS", relationQuality: m.clientId || m.projectId ? "ID" : undefined,
      fields: { date: m.date, time: m.time, status: m.status, client: m.clientId && clientName(src, m.clientId) ? record(clientName(src, m.clientId)!) : null, project: m.projectId && projectName(src, m.projectId) ? record(projectName(src, m.projectId)!) : null, calendarEventAtBooking: m.hasCalendarEvent } })),
      { summary: [sfact("BY_STATUS", "פגישות לפי סטטוס", byCount(o.meetings.rows.map((m) => m.status ?? "—")), "FACT", "MEETINGS")], coverage: [partner("הערות ומיקום הפגישה לא נקראים. היומן של Google לא נקרא."), ...cappedNote(o.meetings)] });
  },
};

// ── PROJECT ACTIONS (sent / received / notes / approved — the per-project communication log) ──
export const projectActions: KnowledgeCapability = {
  id: "project_actions", domain: "PROJECTS", titleHe: "מעקב שליחות בפרויקט",
  descriptionForModel: "The per-project communication log: what was sent / received / approved (action type, content type, recipient ROLE — artist / sound engineer / producer / photographer…), status (pending_feedback, pending_version, got_notes, approved, closed, cancelled, followup), action and follow-up dates. Who is waiting for whom on a project. Recipient names / phones / links / notes are not read.",
  examplesHe: ["מה שלחנו לאמן ומחכים לתשובה?", "מי מחכה לגרסה?", "על מה צריך לעשות פולואפ?"],
  modes: { open: { descriptionForModel: "Not approved / closed / cancelled" }, all: { descriptionForModel: "Every action" } }, defaultMode: "open",
  params: projectParam, entityScope: PROJECT_SCOPE("open", 6),
  paging: { defaultLimit: 20, maxLimit: 50 }, access: STD, needs: ["OPERATIONS", "STATE"],
  read(src, q) {
    const o = ops(src);
    if (!o || !need(o.projectActions, "project actions")) return miss("project actions");
    const d = today(src);
    const pid = q.params.project ? idOf(q.params.project) : null;
    const rows = o.projectActions.rows.filter((a) => (q.mode === "all" || !["approved", "closed", "cancelled"].includes(a.status ?? "")) && (!pid || a.projectId === pid))
      .sort((a, b) => (a.followupDate ?? a.actionDate ?? "9999").localeCompare(b.followupDate ?? b.actionDate ?? "9999") || a.id.localeCompare(b.id));
    return result(rows.map((a) => item({ id: a.id, entity: a.projectId ? `project:${a.projectId}` : null, label: partner(`${a.actionType ?? "פעולה"} → ${a.recipientRole ?? "?"}`), epistemic: "FACT", source: "PROJECTS", relationQuality: a.projectId ? "ID" : undefined,
      fields: { project: a.projectId && projectName(src, a.projectId) ? record(projectName(src, a.projectId)!) : null, actionType: a.actionType, contentType: a.contentType, recipientRole: a.recipientRole, status: a.status, actionDate: a.actionDate, followupDate: a.followupDate, followupOverdue: !!a.followupDate && a.followupDate < d && !["approved", "closed", "cancelled"].includes(a.status ?? "") } })),
      { summary: [sfact("BY_STATUS", "לפי סטטוס", byCount(o.projectActions.rows.map((a) => a.status ?? "—")), "FACT", "PROJECTS")], coverage: [partner("הסטטוסים נאכפים רק בממשק (לא בשרת)."), ...cappedNote(o.projectActions)] });
  },
};

// ── BEATS (library + which artist portal sees which beat) ──
const SLUG_TO_NAME = Object.fromEntries(Object.entries(PORTAL_ARTISTS).map(([name, v]) => [v.slug, name]));
export const beats: KnowledgeCapability = {
  id: "beats", domain: "LABEL", titleHe: "ספריית ביטים",
  descriptionForModel: "The beat library (name, genre, musical key, status available) and which artist portal each beat is assigned to (assignment = the beat appears in that artist's 'ביטים פנויים' tab). Assigning a beat notifies the artist (a push the Owner triggers in Redbloods — Sunny cannot).",
  examplesHe: ["איזה ביטים פנויים יש?", "איזה ביטים שליו רואה?", "כמה ביטים יש לאבי?"],
  modes: { available: { descriptionForModel: "Available beats" }, all: { descriptionForModel: "Every beat" } }, defaultMode: "available",
  params: { artist: { kind: "entityKey", types: ["label-artist"], descriptionForModel: "Only beats assigned to this label artist's portal" } },
  entityScope: { types: ["label-artist"], param: "artist", mode: "available", limit: 8 },
  paging: { defaultLimit: 20, maxLimit: 50 }, access: STD, needs: ["OPERATIONS", "STATE"],
  read(src, q) {
    const o = ops(src);
    if (!o || !need(o.beats, "beats")) return miss("beats");
    const assign = o.beatAssignments?.rows ?? null;
    const artistName = q.params.artist ? labelArtistName(src, idOf(q.params.artist)) : null;
    const slug = artistName ? PORTAL_ARTISTS[artistName]?.slug ?? null : null;
    if (q.params.artist && !slug) return result([], { coverage: [partner("לאמן הזה אין פורטל — אין לו שיוך ביטים.")] });
    const rows = o.beats.rows.filter((b) => (q.mode === "all" || b.status === "available") && (!slug || !!assign?.some((a) => a.beatId === b.id && a.artistSlug === slug)))
      .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? "") || a.id.localeCompare(b.id));
    return result(rows.map((b) => item({ id: b.id, label: record(b.name), epistemic: "FACT", source: "BEATS",
      fields: { genre: b.genre, key: b.musicalKey, status: b.status, assignedTo: assign ? assign.filter((a) => a.beatId === b.id).map((a) => SLUG_TO_NAME[a.artistSlug] ?? a.artistSlug) : null } })),
      { summary: [sfact("BY_GENRE", "לפי ז'אנר", byCount(o.beats.rows.filter((b) => b.status === "available").map((b) => b.genre ?? "—")), "FACT", "BEATS")], completeness: assign ? "COMPLETE" : "PARTIAL", coverage: cappedNote(o.beats, o.beatAssignments) });
  },
};

// ── SOCIAL (campaigns, content pipeline, promotions) ──
const PUBLISHED = new Set(["published", "posted"]);
export const social: KnowledgeCapability = {
  id: "social", domain: "SALES", titleHe: "סושיאל וקמפיינים",
  descriptionForModel: "Release / marketing campaigns (one per project, ID link), their content pipeline (status counts: draft / in_progress / ready_to_post / published, plus legacy statuses; overdue = due before today and not published) and promotions (channel, planned amount, status; actual spend exists only as a Finance expense marked שיווק). Captions / hooks / links are not read.",
  examplesHe: ["מה מצב הקמפיין?", "איזה תוכן באיחור?", "כמה תקציב קידום יש?"],
  modes: { active: { descriptionForModel: "Campaigns not completed" }, all: { descriptionForModel: "Every campaign" } }, defaultMode: "active",
  params: projectParam, entityScope: PROJECT_SCOPE("all", 3),
  paging: { defaultLimit: 10, maxLimit: 30 }, access: OWNER_FIN, needs: ["OPERATIONS", "STATE"],
  read(src, q) {
    const o = ops(src);
    if (!o || !need(o.campaigns, "campaigns")) return miss("social campaigns");
    const d = today(src);
    const pid = q.params.project ? idOf(q.params.project) : null;
    const rows = o.campaigns.rows.filter((c) => (q.mode === "all" || c.status !== "completed") && (!pid || c.projectId === pid)).sort((a, b) => (a.releaseDate ?? "9999").localeCompare(b.releaseDate ?? "9999") || a.id.localeCompare(b.id));
    return result(rows.map((c) => {
      const content = o.contentItems?.rows.filter((x) => x.campaignId === c.id) ?? null;
      const promos = o.promotions?.rows.filter((x) => x.campaignId === c.id) ?? null;
      return item({ id: c.id, entity: c.projectId ? `project:${c.projectId}` : null, label: record(c.title), epistemic: "FACT", source: "SOCIAL", relationQuality: c.projectId ? "ID" : undefined,
        fields: { status: c.status, releaseDate: c.releaseDate, artistText: c.artistName ? record(c.artistName) : null, promotionBudget: c.promotionBudget,
          contentByStatus: content ? byCount(content.map((x) => x.status ?? "—")) : null, contentOverdue: content ? content.filter((x) => !!x.dueDate && x.dueDate < d && !PUBLISHED.has(x.status ?? "")).length : null,
          promotionsPlanned: promos ? sum(promos.map((x) => x.plannedAmount)) : null, promotionsWithSpend: promos ? promos.filter((x) => x.hasTransaction).length : null } });
    }), { completeness: o.contentItems && o.promotions ? "COMPLETE" : "PARTIAL",
      coverage: [partner("קיים פער בין סטטוסי התוכן החדשים לבין בודק החסרים הישן (משתמש בסטטוסים ישנים) — ראה system_awareness."), ...cappedNote(o.campaigns, o.contentItems, o.promotions)] });
  },
};

// ── ARTIST BALANCE CYCLES (closed 2-month snapshots) ──
export const balanceCycles: KnowledgeCapability = {
  id: "balance_cycles", domain: "LABEL", titleHe: "מחזורי מאזן אמנים",
  descriptionForModel: "Closed artist balance cycles (fixed 2-month windows from an anchor date): income, payments, expenses and the cycle's own ending balance (NO carry-over — each cycle's net only). The live ledger total can differ (entries back-dated into a closed window are not in any cycle). There are three different 'artist balance' calculations in Redbloods — see system_awareness ARTIST_BALANCES.",
  examplesHe: ["מתי נסגר המחזור האחרון של שליו?", "מה היה המאזן במחזור הקודם?"],
  modes: { closed: { descriptionForModel: "Closed cycles, newest first" } }, defaultMode: "closed",
  params: { artist: { kind: "entityKey", types: ["label-artist"], descriptionForModel: "Only this label artist" } },
  entityScope: { types: ["label-artist"], param: "artist", mode: "closed", limit: 4 },
  paging: { defaultLimit: 10, maxLimit: 40 }, access: OWNER_FIN, needs: ["OPERATIONS", "STATE"],
  read(src, q) {
    const o = ops(src);
    if (!o || !need(o.balanceCycles, "cycles")) return miss("balance cycles");
    const aid = q.params.artist ? idOf(q.params.artist) : null;
    const rows = o.balanceCycles.rows.filter((c) => !aid || c.artistId === aid).sort((a, b) => (b.closedAt ?? "").localeCompare(a.closedAt ?? "") || b.cycleIndex - a.cycleIndex);
    return result(rows.map((c) => item({ id: `${c.artistId}:${c.cycleIndex}`, entity: `label-artist:${c.artistId}`, label: partner(`מחזור ${c.cycleIndex + 1}: ${c.startDate ?? "?"} – ${c.endDate ?? "?"}`), epistemic: "FACT", source: "LABEL_ARTISTS", relationQuality: "ID",
      fields: { artist: labelArtistName(src, c.artistId) ? record(labelArtistName(src, c.artistId)!) : null, cycleIndex: c.cycleIndex, startDate: c.startDate, endDateExclusive: c.endDate, income: c.income, payments: c.payments, expenses: c.expenses, endingBalanceOfCycle: c.endingBalance, closedAt: c.closedAt } })),
      { coverage: [partner("יתרת מחזור היא נטו של המחזור בלבד — ללא יתרת פתיחה.")] });
  },
};

// ── ALBUMS (tracks with mix / master state) ──
export const albums: KnowledgeCapability = {
  id: "albums", domain: "PROJECTS", titleHe: "אלבומים ו-EP — שירים",
  descriptionForModel: "Album / EP track lists per project: track number, title, track status, mix status and master status (לא התחיל / בתהליך / הושלם). Note: the default track status 'טרום הקלטה' is not a project status.",
  examplesHe: ["כמה שירים באלבום מוכנים?", "מה חסר למאסטר באלבום?"],
  modes: { tracks: { descriptionForModel: "Tracks, by project then number" } }, defaultMode: "tracks",
  params: projectParam, entityScope: PROJECT_SCOPE("tracks", 10),
  paging: { defaultLimit: 30, maxLimit: 50 }, access: STD, needs: ["OPERATIONS", "STATE"],
  read(src, q) {
    const o = ops(src);
    if (!o || !need(o.albumTracks, "album tracks")) return miss("album tracks");
    const pid = q.params.project ? idOf(q.params.project) : null;
    const rows = o.albumTracks.rows.filter((t) => !pid || t.projectId === pid).sort((a, b) => (a.projectId ?? "").localeCompare(b.projectId ?? "") || (a.trackNumber ?? 0) - (b.trackNumber ?? 0));
    return result(rows.map((t) => item({ id: `${t.projectId}:${t.trackNumber}`, entity: t.projectId ? `project:${t.projectId}` : null, label: record(t.title), epistemic: "FACT", source: "PROJECTS", relationQuality: "ID",
      fields: { project: t.projectId && projectName(src, t.projectId) ? record(projectName(src, t.projectId)!) : null, trackNumber: t.trackNumber, status: t.status, mixStatus: t.mixStatus, masterStatus: t.masterStatus } })),
      { summary: [sfact("MIX_DONE", "שירים שהמיקס שלהם הושלם", rows.filter((t) => t.mixStatus === "הושלם").length, "FACT", "PROJECTS"), sfact("MASTER_DONE", "שירים שהמאסטר שלהם הושלם", rows.filter((t) => t.masterStatus === "הושלם").length, "FACT", "PROJECTS")] });
  },
};

// ── MIX PIPELINE (every sound engineer: Steven, Bill, external) ──
const paid = (w: { agreedPrice: number | null; amountPaid: number | null; paymentDate: string | null }) => (w.agreedPrice ?? 0) > 0 && (w.amountPaid ?? 0) >= (w.agreedPrice ?? 0) && !!w.paymentDate;
export const mixPipeline: KnowledgeCapability = {
  id: "mix_pipeline", domain: "TEAM", titleHe: "מיקס ומאסטר — כל המהנדסים",
  descriptionForModel: "Mix / master work of EVERY sound engineer (Steven and external engineers — the engineer is a free-text name): work type, status (לא נשלח / נשלח / בתהליך / חזר / אושר / בוטל), sent date, internal deadline, mix versions uploaded (+ latest), open review comments, final files delivered, price / paid (paid = agreed > 0, paid ≥ agreed and a payment date; per currency, no FX). Approving Steven's last open work on a project auto-completes the project.",
  examplesHe: ["מה מצב המיקסים?", "איזה מיקסים מחכים לתיקונים?", "למי אנחנו חייבים על מיקס?", "מה עם המהנדס החיצוני?"],
  modes: { open: { descriptionForModel: "Not approved / cancelled" }, unpaid: { descriptionForModel: "Approved but not fully paid" }, all: { descriptionForModel: "Every work" } }, defaultMode: "open",
  params: { ...projectParam, engineer: { kind: "text", maxLength: 40, descriptionForModel: "Engineer name as stored (e.g. Steven)" } },
  entityScope: PROJECT_SCOPE("all", 4),
  paging: { defaultLimit: 15, maxLimit: 40 }, access: OWNER_FIN, needs: ["OPERATIONS", "STATE"],
  read(src, q) {
    const o = ops(src);
    if (!o || !need(o.engineerWork, "engineer work")) return miss("sound engineer work");
    const pid = q.params.project ? idOf(q.params.project) : null;
    const rows = o.engineerWork.rows.filter((w) => (q.mode === "all" || (q.mode === "open" ? !["אושר", "בוטל"].includes(w.status ?? "") : w.status === "אושר" && !paid(w)))
      && (!pid || w.projectId === pid) && (!q.params.engineer || w.engineerName === q.params.engineer))
      .sort((a, b) => (a.internalDeadline ?? "9999").localeCompare(b.internalDeadline ?? "9999") || a.id.localeCompare(b.id));
    return result(rows.map((w) => {
      const vs = o.mixVersions?.rows.filter((v) => v.workId === w.id) ?? null;
      const vIds = new Set((vs ?? []).map((v) => v.id));
      const open = o.mixComments ? o.mixComments.rows.filter((c) => c.versionId && vIds.has(c.versionId) && c.status === "open").length : null;
      const finals = o.finalFiles ? o.finalFiles.rows.filter((f) => f.workId === w.id).length : null;
      return item({ id: w.id, entity: w.projectId ? `project:${w.projectId}` : null, label: record(w.workTitle ?? projectName(src, w.projectId) ?? "עבודה"), epistemic: "FACT", source: "TEAM_STEVEN", relationQuality: w.projectId ? "ID" : undefined,
        fields: { engineer: record(w.engineerName), workType: w.workType, status: w.status, sentDate: w.sentDate, internalDeadline: w.internalDeadline, versions: vs?.length ?? null,
          latestVersionAt: vs && vs.length ? vs.map((v) => v.createdAt ?? "").sort().at(-1) : null, openComments: open, finalFiles: finals, agreedPrice: w.agreedPrice, amountPaid: w.amountPaid, currency: w.currency ?? "₪", paid: paid(w) } });
    }), { summary: [sfact("BY_ENGINEER", "עבודות לפי מהנדס", byCount(o.engineerWork.rows.map((w) => w.engineerName || "—")), "FACT", "TEAM_STEVEN")],
      completeness: o.mixVersions && o.mixComments && o.finalFiles ? "COMPLETE" : "PARTIAL",
      coverage: [partner("תוכן ההערות והקבצים עצמם לא נקרא — רק ספירות ותאריכים."), partner("שני מנגנוני כספים לתשלום מהנדס עלולים לסתור זה את זה — ראה system_awareness."), ...cappedNote(o.engineerWork, o.mixVersions, o.mixComments, o.finalFiles)] });
  },
};

// ── DELIVERIES ──
export const deliveries: KnowledgeCapability = {
  id: "deliveries", domain: "PROJECTS", titleHe: "מסירות ללקוח",
  descriptionForModel: "Delivery status per project (a delivery Dropbox folder + share link is created manually from the project; status not_created / ready / delivered and delivered date). The folder path and link are never read.",
  examplesHe: ["מה נמסר ללקוחות?", "איזה פרויקטים הושלמו בלי מסירה?"],
  modes: { all: { descriptionForModel: "Every project with a delivery record" } }, defaultMode: "all",
  params: projectParam, entityScope: PROJECT_SCOPE("all", 1),
  paging: { defaultLimit: 20, maxLimit: 50 }, access: STD, needs: ["OPERATIONS", "STATE"],
  read(src, q) {
    const o = ops(src);
    if (!o || !need(o.deliveries, "deliveries")) return miss("deliveries");
    const pid = q.params.project ? idOf(q.params.project) : null;
    const rows = o.deliveries.rows.filter((x) => !pid || x.projectId === pid);
    return result(rows.map((x) => item({ id: x.projectId, entity: `project:${x.projectId}`, label: record(projectName(src, x.projectId) ?? "פרויקט"), epistemic: "FACT", source: "PROJECTS", relationQuality: "ID", fields: { deliveryStatus: x.status, deliveredAt: x.deliveredAt } })),
      { summary: [sfact("BY_STATUS", "מסירות לפי סטטוס", byCount(rows.map((x) => x.status ?? "—")), "FACT", "PROJECTS")] });
  },
};

// ── INTEGRATIONS (is Google Calendar / Dropbox connected — never the credentials) ──
export const integrations: KnowledgeCapability = {
  id: "integrations", domain: "COMPANY", titleHe: "חיבורים חיצוניים",
  descriptionForModel: "Whether Redbloods' external integrations are connected: Google Calendar (sessions / shows / meetings create events; Sunny does NOT read or write the calendar) and Dropbox (all project audio, mixes, finals, portals and Red Films files live there; Sunny reads file METADATA counts only, never contents or links). 'Connected' = a stored credential exists; it does not prove the token is still valid.",
  examplesHe: ["יש לך גישה ליומן?", "היומן מחובר?", "הדרופבוקס מחובר?"],
  modes: { current: { descriptionForModel: "Current connection state" } }, defaultMode: "current",
  params: {}, paging: { defaultLimit: 5, maxLimit: 5 }, access: STD, needs: ["OPERATIONS"],
  read(src) {
    const o = ops(src);
    if (!o) return miss("integrations");
    const i = o.integrations;
    return result([
      item({ id: "google_calendar", label: partner("Google Calendar"), epistemic: i.googleCalendarConnected === null ? "UNKNOWN" : "FACT", source: "OPERATIONS",
        fields: { connectedInRedbloods: i.googleCalendarConnected, sunnyCanRead: false, sunnyCanWrite: false, note: partner("סאני לא קורא ולא כותב ליומן. אירועים עתידיים לא ידועים לו מעבר לסשנים/הופעות/פגישות שב-Redbloods.") } }),
      item({ id: "dropbox", label: partner("Dropbox"), epistemic: i.dropboxConnected === null ? "UNKNOWN" : "FACT", source: "OPERATIONS",
        fields: { connectedInRedbloods: i.dropboxConnected, sunnyCanReadContents: false, sunnyCanWrite: false, note: partner("סאני רואה רק מטא-דאטה (כמה גרסאות/קבצים ומתי) — לא תוכן, לא קישורים.") } }),
    ], { coverage: [partner("'מחובר' = יש אישור שמור; זה לא מוכיח שהאישור עדיין בתוקף.")] });
  },
};

export const OPERATIONS_CAPABILITIES: readonly KnowledgeCapability[] = [tasks, redFilms, clipPlanning, meetings, projectActions, beats, social, balanceCycles, albums, mixPipeline, deliveries, integrations];
