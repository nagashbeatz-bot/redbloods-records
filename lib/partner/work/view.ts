/**
 * Sunny FULL-BRAIN COMPLETION — Sessions / Tasks / Meetings / Albums / Delivery / Social (pure, read-only).
 *
 * Views over sources the Gateway already loads (company state, operations, project detail, finance raw, settings).
 * Every rule here is the APP's rule or a recorded fact; nothing is Owner policy:
 *   - a passed time never means "happened" (A3, Owner canon): a מתוכנן session whose END passed (overnight-aware) is
 *     "עבר — לא אושר" (passed, not confirmed); התקיים on a session that ended on / before AUTO_MARK_RETIRED_AT may
 *     have been auto-marked by the retired page-load writer (legacy), after it התקיים is an explicit Owner record;
 *   - a task linked by a notes marker / title text stays TEXT_MATCH — never promoted to a canonical link;
 *   - a meeting's client id is text (no FK) + a name snapshot;
 *   - album track statuses are manual and separate from the mix works;
 *   - "delivered" only from a delivery record marked delivered — never from project completion or final files;
 *   - social readiness = the app's own checker (implementation behaviour), never a release verdict.
 */
import type { GatewaySources } from "../gateway/core";
import { ok } from "../gateway/core";
import type { PartnerCompanyState } from "../eyes/types";
import type { OperationsRaw } from "../operations/types";
import type { ProjectDetailRaw } from "../projects/detail-types";
import type { FinanceRaw } from "../finance/types";
import { validateTx } from "../finance/core";
import { checkMissing } from "../../social-missing-checker";
import { getRecommendations } from "../../social-recommendations";
import type { SocialCampaign, SocialContentItem } from "../../types";
import { sessionEndLocal, sessionEndPassed, israelNowString, heldMeaning, HELD_MEANING_HE, AUTO_MARK_RETIRED_AT, AUTO_MARK_REINSTATED_AT } from "../../session-duration";
import { socialPhaseOf, isSocialItemOverdue } from "../../types";
import { computeFinalFilesFlags } from "../../steven-completed-pure";

export interface WorkSignal { code: string; kind: "CANONICAL_FACT" | "DERIVED_SIGNAL" | "UNKNOWN"; he: string; entity?: string; project?: string }
export interface WorkQuestion { questionHe: string; why: string; kind: string; entity?: string }

interface Ctx { st: PartnerCompanyState | null; ops: OperationsRaw | null; det: ProjectDetailRaw | null; fin: FinanceRaw | null; today: string }
function ctxOf(src: GatewaySources): Ctx {
  const st = ok(src.state) as PartnerCompanyState | null;
  const f = ok(src.finance);
  return { st, ops: ok(src.operations) as OperationsRaw | null, det: ok(src.projectDetail) as ProjectDetailRaw | null, fin: f ? f.raw : null, today: st?.todayIL ?? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(src.now) };
}
const projectName = (c: Ctx, id: string | null | undefined) => (id ? c.ops?.projectsMeta?.rows.find((p) => p.id === id)?.name ?? c.st?.domains.projects.data?.index[id]?.name ?? null : null);
const projectMeta = (c: Ctx, id: string | null | undefined) => (id ? c.ops?.projectsMeta?.rows.find((p) => p.id === id) ?? null : null);
const add = (m: Record<string, number>, k: string, v: number) => { m[k] = Math.round(((m[k] ?? 0) + v) * 100) / 100; };
const count = (xs: Array<string | null | undefined>) => xs.reduce<Record<string, number>>((m, x) => ({ ...m, [x ?? "—"]: (m[x ?? "—"] ?? 0) + 1 }), {});

// ═══════════════════════════════ SESSIONS ═══════════════════════════════
export const SESSION_KIND: Readonly<Record<string, string>> = { "סשן": "STUDIO_SESSION", "ניקוי מיקס": "MIX_CHANNEL_CLEANING", "חזרה": "REHEARSAL", "חזרה להופעה": "SHOW_REHEARSAL", "צילום קליפ": "CLIP_SHOOT" };
export const SESSION_STATUS_MEANING: Readonly<Record<string, string>> = {
  "מתוכנן": "scheduled (once its end passed and nobody confirmed: 'עבר — לא אושר' — passed ≠ happened)", "התקיים": `recorded as happened — WHO set it matters (statusSource): MANUAL = the Owner marked / confirmed it; AUTO_MARK = the server cron (since ${AUTO_MARK_REINSTATED_AT}) marked it because its end passed and nobody cancelled it — NOT the Owner's confirmation; no source = before tracking (ended on / before ${AUTO_MARK_RETIRED_AT}: possibly the retired page-load auto-mark, legacy; after it: an Owner record)`, "בוטל": "cancelled (its calendar event is NOT removed by a status change)",
  "נדחה": "postponed (a recorded outcome)", "לא הגיע": "no-show (a recorded outcome)", "בוצע": "rehearsal vocabulary 'done' (the only status the show split counts)",
};
export function buildSessionsView(src: GatewaySources) {
  const c = ctxOf(src);
  const rows = c.det?.sessions?.rows ?? [];
  const txBySession = new Map<string, Array<{ id: string; type: string | null; amount: number | null; currency: string | null; status: string | null; category: string | null }>>();
  for (const t of c.fin?.transactions ?? []) {
    const sid = t.linkedSessionId;
    if (!sid || sid.startsWith("victor_salary")) continue;
    const v = validateTx(t);
    txBySession.set(sid, [...(txBySession.get(sid) ?? []), { id: t.id, type: t.type, amount: v?.amount ?? null, currency: t.currency, status: t.status, category: t.category }]);
  }
  const ids = new Set(rows.map((r) => r.id));
  const shows = new Map(((ok(src.labelDetail) as { shows?: { rows?: Array<{ id: string; name?: string | null; date?: string | null }> } } | null)?.shows?.rows ?? []).map((s) => [s.id, s]));
  const nowIL = israelNowString(src.now);
  const sessions = rows.map((s) => {
    const datePassed = !!s.date && s.date < c.today;
    // End passed (overnight-aware; no times → the end of its day). Passed ≠ happened.
    const endLocal = s.date ? sessionEndLocal(s.date, s.startTime, s.endTime) ?? `${s.date}T23:59:59` : null;
    const endPassed = sessionEndPassed({ date: s.date, start_time: s.startTime, end_time: s.endTime }, nowIL); // THE shared rule (the drawers' 'עבר — לא אושר')
    const held = heldMeaning({ status: s.status, status_source: s.statusSource ?? null, date: s.date, start_time: s.startTime, end_time: s.endTime });
    const kind = SESSION_KIND[s.type ?? "סשן"] ?? "UNKNOWN_TYPE";
    return {
      key: `session:${s.id}`, id: s.id, type: s.type, kind, status: s.status, statusMeaning: SESSION_STATUS_MEANING[s.status ?? ""] ?? "unknown status", date: s.date, start: s.startTime, end: s.endTime, datePassed, endPassed, endLocal,
      statusSource: s.statusSource ?? null, statusChangedAt: s.statusChangedAt ?? null, heldMeaning: held, heldMeaningHe: held ? HELD_MEANING_HE[held] : null,
      happened: s.status === "התקיים" ? (held === "AUTO_MARK" ? "AUTO_MARKED_AS_HAPPENED (time passed, not cancelled — NOT the Owner's confirmation)" : held === "LEGACY_POSSIBLY_AUTO" ? "RECORDED_AS_HAPPENED (possibly auto-marked — legacy, before the auto-mark was retired)" : "RECORDED_AS_HAPPENED (the Owner's record)")
        : s.status === "בוצע" ? "RECORDED_AS_HAPPENED (explicit record)" : s.status === "בוטל" ? "CANCELLED" : s.status === "נדחה" ? "POSTPONED (recorded outcome)" : s.status === "לא הגיע" ? "NO_SHOW (recorded outcome)"
        : s.status === "מתוכנן" && endPassed ? "PASSED_NOT_CONFIRMED — עבר — לא אושר (end passed, not recorded; passed ≠ happened)" : s.status === "מתוכנן" ? "NOT_YET" : "UNKNOWN — unrecognized status",
      project: s.projectId ? { key: `project:${s.projectId}`, name: projectName(c, s.projectId) } : null, show: s.showId ? { key: `show:${s.showId}`, name: shows.get(s.showId)?.name ?? null, date: shows.get(s.showId)?.date ?? null } : null,
      title: s.title, location: s.location, photographer: s.photographer, cost: s.cost, costCurrency: s.cost ? "NOT_RECORDED (the linked transaction carries the currency)" : null, hasNotes: !!s.notes,
      calendar: s.hasCalendarEvent ? "EVENT_ID_STORED" : "NO_EVENT", finance: txBySession.get(s.id) ?? [], createdAt: s.createdAt,
    };
  }).sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  const signals: WorkSignal[] = [];
  const questions: WorkQuestion[] = [];
  for (const s of sessions) {
    const S = (code: string, kind: WorkSignal["kind"], he: string) => signals.push({ code, kind, he, entity: s.key, project: s.project?.key });
    const label = `${s.type ?? "סשן"} ${s.date ?? ""}${s.project?.name ? ` (${s.project.name})` : s.title ? ` (${s.title})` : ""}`;
    if (s.kind === "UNKNOWN_TYPE") S("SESSION_TYPE_UNKNOWN", "CANONICAL_FACT", `${label}: סוג סשן לא מוכר לאפליקציה`);
    if (s.endPassed && s.status === "מתוכנן") { S("SESSION_PASSED_STILL_PLANNED", "DERIVED_SIGNAL", `${label}: עבר — לא אושר (הסשן הסתיים והסטטוס עדיין 'מתוכנן') — לא ידוע אם התקיים`); questions.push({ kind: "SESSION_STATE", questionHe: `${label} — התקיים?`, why: "end passed; status not updated (passed ≠ happened)", entity: s.key }); }
    if (!s.endPassed && s.status === "מתוכנן") S("SESSION_UPCOMING", "CANONICAL_FACT", `${label}${s.start ? ` ${s.start.slice(0, 5)}` : ""}`);
    if (!s.endPassed && s.status === "מתוכנן" && s.calendar === "NO_EVENT") S("SESSION_NO_CALENDAR_EVENT", "CANONICAL_FACT", `${label}: אין אירוע יומן שמור`);
    if (s.status === "בוטל" && s.calendar === "EVENT_ID_STORED") S("SESSION_CANCELLED_EVENT_KEPT", "DERIVED_SIGNAL", `${label}: בוטל אבל אירוע היומן נשאר (שינוי סטטוס לא מוחק אירוע)`);
    if (s.kind === "SHOW_REHEARSAL" && s.status === "התקיים" && (s.cost ?? 0) > 0) S("REHEARSAL_STATUS_NOT_COUNTED", "DERIVED_SIGNAL", `${label}: חזרה בסטטוס 'התקיים' (מורשת — סימון אוטומטי לפני D6) — חלוקת ההופעה סופרת רק 'בוצע'`);
    if (!s.project && !s.show && !s.title) S("SESSION_UNLINKED", "CANONICAL_FACT", `${label}: סשן בלי פרויקט, הופעה או כותרת`);
  }
  const orphanTx = [...txBySession.entries()].filter(([sid]) => !ids.has(sid)).flatMap(([sid, txs]) => txs.map((t) => ({ sessionId: sid, ...t })));
  for (const t of orphanTx) signals.push({ code: "SESSION_EXPENSE_ORPHAN", kind: "CANONICAL_FACT", he: `עסקה (${t.category ?? "—"} ${t.currency ?? ""}${t.amount ?? "?"}, ${t.status ?? "—"}) מקושרת לסשן שכבר לא קיים` });
  const limits = (c.det?.projectSettings?.rows ?? []).filter((r) => r.kind === "SESSION_LIMIT").map((r) => ({ project: `project:${r.projectId}`, name: projectName(c, r.projectId), limit: Number((r.value as { limit?: unknown } | null)?.limit ?? NaN) || null, studioSessions: sessions.filter((s) => s.project?.key === `project:${r.projectId}` && s.type === "סשן").length }));
  return {
    counts: { total: sessions.length, byType: count(sessions.map((s) => s.type)), byStatus: count(sessions.map((s) => s.status)), upcoming: sessions.filter((s) => !s.endPassed && s.status === "מתוכנן").length, passedNotConfirmed: sessions.filter((s) => s.endPassed && s.status === "מתוכנן").length, withCalendarEvent: sessions.filter((s) => s.calendar === "EVENT_ID_STORED").length, withoutProject: sessions.filter((s) => !s.project).length, showRehearsals: sessions.filter((s) => s.kind === "SHOW_REHEARSAL").length, clipShoots: sessions.filter((s) => s.kind === "CLIP_SHOOT").length, note: "recorded counts; happened ≠ time passed (a passed מתוכנן is 'עבר — לא אושר', never counted as held)" },
    sessions, limits, orphanTransactions: orphanTx, signals, questions,
    unavailable: [...(c.det ? [] : ["PROJECT_DETAIL (sessions) — unknown, not none"]), ...(c.fin ? [] : ["FINANCE (session expenses)"]), "Google event details are read live by the calendar capability"],
  };
}

// ═══════════════════════════════ TASKS ═══════════════════════════════
export const TASK_ORIGIN_MARKERS = [
  { id: "PROPOSAL_FOLLOW_UP", test: (t: { notes: string | null }) => /\[proposal_id:[0-9a-f-]{36}\]/i.test(t.notes ?? ""), quality: "TEXT_MATCH", basis: "a [proposal_id:…] marker inside the task notes" },
  { id: "SHOW_QUOTE_FOLLOW_UP", test: (t: { notes: string | null }) => (t.notes ?? "").includes("[quote_followup]"), quality: "TEXT_MATCH", basis: "a [quote_followup] marker inside the task notes (+ the show id)" },
  { id: "VICTOR_DEADLINE", test: (t: { title: string | null }) => /^מעקב ויקטור/.test(t.title ?? ""), quality: "TEXT_MATCH", basis: "title convention (the canonical link is the Victor work's linked task id)" },
  { id: "MIX_FOLLOW_UP", test: (t: { title: string | null }) => /^מעקב מיקס/.test(t.title ?? ""), quality: "TEXT_MATCH", basis: "title convention 'מעקב מיקס — <project>' (the revert dialog pre-selects by this text)" },
  { id: "SHOW_NO_DJ", test: (t: { title: string | null }) => /^לסגור דיג/.test(t.title ?? ""), quality: "TEXT_MATCH", basis: "title convention 'לסגור דיג׳יי להופעה'" },
] as const;
export function buildTasksView(src: GatewaySources) {
  const c = ctxOf(src);
  const rows = c.det?.tasks?.rows ?? [];
  const clients = new Map((c.st?.domains.clients.data?.items ?? []).map((x) => [x.id, x.name]));
  const victorLinked = new Set((c.det?.victor?.rows ?? []).map((w) => w.linkedTaskId).filter(Boolean));
  const actionLinked = new Set((c.det?.actions?.rows ?? []).map((a) => a.linkedTaskId).filter(Boolean));
  const prods = new Map((c.ops?.redFilms?.rows ?? []).map((p) => [p.id, p]));
  const tasks = rows.map((t) => {
    const origin = TASK_ORIGIN_MARKERS.find((m) => m.test(t as never));
    const related = t.relatedType === "project" ? { key: t.relatedId ? `project:${t.relatedId}` : null, name: projectName(c, t.relatedId), quality: "CANONICAL_RELATION" }
      : t.relatedType === "client" ? { key: t.relatedId ? `client:${t.relatedId}` : null, name: t.relatedId ? clients.get(t.relatedId) ?? null : null, quality: "CANONICAL_RELATION" }
      : t.relatedType === "red_film_production" ? { key: t.relatedId ? `video-production:${t.relatedId}` : null, name: t.relatedId ? prods.get(t.relatedId)?.title ?? null : null, quality: "CANONICAL_RELATION" }
      : null;
    const overdue = t.status === "פתוח" && !!t.dueDate && t.dueDate < c.today;
    return {
      key: `task:${t.id}`, id: t.id, title: t.title, status: t.status, relatedType: t.relatedType, related, show: t.showId ? `show:${t.showId}` : null, dueDate: t.dueDate, overdue, start: t.startTime, end: t.endTime,
      googleTask: t.hasGoogleTask ? "MIRRORED" : "NOT_MIRRORED", origin: origin ? { id: origin.id, quality: origin.quality, basis: origin.basis } : null,
      canonicalBackLinks: [...(victorLinked.has(t.id) ? ["VICTOR_WORK"] : []), ...(actionLinked.has(t.id) ? ["PROJECT_ACTION"] : [])], hasNotes: !!t.notes, createdAt: t.createdAt, updatedAt: t.updatedAt,
    };
  }).sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"));
  const signals: WorkSignal[] = [];
  const ids = new Set(tasks.map((t) => t.id));
  for (const t of tasks) {
    const S = (code: string, kind: WorkSignal["kind"], he: string) => signals.push({ code, kind, he, entity: t.key, project: t.related?.key?.startsWith("project:") ? t.related.key : undefined });
    if (t.overdue) S("TASK_OVERDUE", "CANONICAL_FACT", `${t.title ?? "משימה"}: תאריך יעד ${t.dueDate} עבר והמשימה פתוחה`);
    if (t.status === "פתוח" && t.dueDate === c.today) S("TASK_DUE_TODAY", "CANONICAL_FACT", `${t.title ?? "משימה"}: להיום`);
    if (t.related && !t.related.name) S("TASK_RELATED_MISSING", "DERIVED_SIGNAL", `${t.title ?? "משימה"}: הישות המקושרת (${t.relatedType}) לא נמצאה`);
  }
  const danglingVictor = [...victorLinked].filter((id) => id && !ids.has(id as string)).length;
  const danglingAction = [...actionLinked].filter((id) => id && !ids.has(id as string)).length;
  if (danglingVictor + danglingAction) signals.push({ code: "TASK_LINK_DANGLING", kind: "CANONICAL_FACT", he: `${danglingVictor + danglingAction} קישורי משימה (ויקטור / מעקב שליחה) מצביעים על משימה שלא קיימת` });
  return {
    counts: { total: tasks.length, byStatus: count(tasks.map((t) => t.status)), byRelatedType: count(tasks.map((t) => t.relatedType)), open: tasks.filter((t) => t.status === "פתוח").length, overdue: tasks.filter((t) => t.overdue).length, mirroredToGoogle: tasks.filter((t) => t.googleTask === "MIRRORED").length, byOrigin: count(tasks.map((t) => t.origin?.id ?? "DIRECT")), note: "no assignee / priority exists — none is invented" },
    tasks, otherTaskLike: { projectActionFollowUps: (c.det?.actions?.rows ?? []).filter((a) => a.followupDate).length, proposalFollowUpDates: "proposal follow-up dates (client_view) + the proposal follow-up task" },
    signals, unavailable: [...(c.det ? [] : ["PROJECT_DETAIL (tasks) — unknown, not none"]), "Google Tasks themselves are not read (only the mirror id); completion in Google flows back only when the tasks page syncs"],
  };
}

// ═══════════════════════════════ MEETINGS ═══════════════════════════════
export function buildMeetingsView(src: GatewaySources) {
  const c = ctxOf(src);
  const clients = new Map((c.st?.domains.clients.data?.items ?? []).map((x) => [x.id, x.name]));
  const meetings = (c.det?.meetings?.rows ?? []).map((m) => {
    const datePassed = !!m.date && m.date < c.today;
    const currentName = m.clientId ? clients.get(m.clientId) ?? null : null;
    return {
      key: `meeting:${m.id}`, id: m.id, date: m.date, time: m.time, duration: m.duration, location: m.location, status: m.status, hasNotes: !!m.notes,
      happened: m.status === "התקיימה" ? "RECORDED_AS_HAPPENED" : m.status === "בוטלה" ? "CANCELLED" : datePassed ? "UNKNOWN — date passed, status not updated" : "NOT_YET",
      client: m.clientId ? { key: `client:${m.clientId}`, snapshotName: m.clientName, currentName, found: !!currentName, quality: "CANONICAL_RELATION (text id, no FK)" } : null,
      project: m.projectId ? { key: `project:${m.projectId}`, name: projectName(c, m.projectId) } : null, calendar: m.hasCalendarEvent ? "EVENT_ID_STORED" : "NO_EVENT", createdAt: m.createdAt,
    };
  }).sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  const signals: WorkSignal[] = [];
  for (const m of meetings) {
    const S = (code: string, kind: WorkSignal["kind"], he: string) => signals.push({ code, kind, he, entity: m.key, project: m.project?.key });
    const label = `פגישה ${m.date ?? ""}${m.client ? ` עם ${m.client.currentName ?? m.client.snapshotName ?? "?"}` : ""}`;
    if (m.happened.startsWith("UNKNOWN")) S("MEETING_PAST_STILL_SCHEDULED", "DERIVED_SIGNAL", `${label}: עדיין 'נקבעה' — לא ידוע אם התקיימה`);
    if (m.status === "בוטלה" && m.calendar === "EVENT_ID_STORED") S("MEETING_CANCELLED_EVENT_KEPT", "DERIVED_SIGNAL", `${label}: בוטלה אבל אירוע היומן לא נמחק (האפליקציה לא מסנכרנת)`);
    if (m.client && !m.client.found) S("MEETING_CLIENT_NOT_FOUND", "CANONICAL_FACT", `${label}: מזהה הלקוח לא קיים ברשימת הלקוחות`);
    if (m.client?.found && m.client.snapshotName && m.client.currentName && m.client.snapshotName.trim() !== m.client.currentName.trim()) S("MEETING_CLIENT_NAME_DRIFT", "CANONICAL_FACT", `${label}: השם שנשמר בפגישה ('${m.client.snapshotName}') שונה משם הלקוח היום`);
  }
  return { counts: { total: meetings.length, byStatus: count(meetings.map((m) => m.status)), withCalendarEvent: meetings.filter((m) => m.calendar === "EVENT_ID_STORED").length, withProject: meetings.filter((m) => m.project).length, note: "no meeting type / outcome / follow-up is recorded" }, meetings, signals, unavailable: c.det ? [] : ["PROJECT_DETAIL (meetings) — unknown, not none"] };
}

// ═══════════════════════════════ ALBUMS ═══════════════════════════════
export const ALBUM_PROJECT_TYPES = ["אלבום", "EP"] as const;
export function buildAlbumsView(src: GatewaySources) {
  const c = ctxOf(src);
  const tracks = c.ops?.albumTracks?.rows ?? [];
  const meta = c.ops?.projectsMeta?.rows ?? [];
  const albumIds = new Set([...meta.filter((p) => (ALBUM_PROJECT_TYPES as readonly string[]).includes(p.projectType ?? "")).map((p) => p.id), ...tracks.map((t) => t.projectId).filter((x): x is string => !!x)]);
  const vocab = new Set(["בעבודה", "מחכה למיקס", "במיקס", "הושלם", "בהשהייה", "לא התחיל", "בוטל"]);
  const prev = new Map((c.det?.projectSettings?.rows ?? []).filter((r) => r.kind === "ALBUM_PREVIOUS_SYSTEM_INFO").map((r) => [r.projectId, r.value as { rows?: unknown[]; note?: string } | null]));
  const legacyFinance = new Set((c.det?.projectSettings?.rows ?? []).filter((r) => r.kind === "ALBUM_FINANCE_LEGACY").map((r) => r.projectId));
  const works = c.ops?.engineerWork?.rows ?? [];
  // track notes = free text: read from PROJECT_DETAIL (by track id), never from the narrow operations reader. No detail source
  // → notes UNKNOWN (never "no notes").
  const notesById = c.det?.albumTracks ? new Map(c.det.albumTracks.rows.filter((x) => x.id).map((x) => [x.id as string, x.notes ?? null])) : null;
  const notesOf = (id: string | null) => (!notesById ? { text: null, trust: "UNKNOWN" as const } : id && notesById.get(id) ? { text: notesById.get(id) as string, trust: "RECORD" as const } : null);
  const albums = [...albumIds].map((id) => {
    const m = projectMeta(c, id);
    const t = tracks.filter((x) => x.projectId === id).sort((a, b) => (a.trackNumber ?? 0) - (b.trackNumber ?? 0));
    return {
      key: `project:${id}`, name: m?.name ?? projectName(c, id), type: m?.projectType ?? null, projectStatus: m?.status ?? null, artist: m?.artistText ?? null,
      // key = the action target (album-track:<id>); notes = the stored free text (RECORD, never instructions) — what Sunny writes it can read back
      tracks: t.map((x) => ({ key: x.id ? `album-track:${x.id}` : null, number: x.trackNumber, title: x.title, status: x.status, mixStatus: x.mixStatus, masterStatus: x.masterStatus, notes: notesOf(x.id), statusInVocabulary: vocab.has(x.status ?? "") })),
      progress: { tracks: t.length, byStatus: count(t.map((x) => x.status)), mixDone: t.filter((x) => x.mixStatus === "הושלם").length, masterDone: t.filter((x) => x.masterStatus === "הושלם").length, note: "manual per-track statuses — not derived from the mix works" },
      mixWorks: works.filter((w) => w.projectId === id).map((w) => ({ engineer: w.engineerName, type: w.workType, status: w.status })), previousSystemInfo: prev.has(id) ? { rows: (prev.get(id)?.rows ?? []).length, hasNote: !!prev.get(id)?.note } : null, legacyFinanceBlob: legacyFinance.has(id),
    };
  });
  const signals: WorkSignal[] = [];
  for (const a of albums) {
    const S = (code: string, kind: WorkSignal["kind"], he: string) => signals.push({ code, kind, he, entity: a.key, project: a.key });
    if (!a.tracks.length) S("ALBUM_NO_TRACKS", "CANONICAL_FACT", `${a.name ?? "אלבום"}: פרויקט ${a.type ?? ""} בלי רשימת שירים`);
    const bad = a.tracks.filter((t) => !t.statusInVocabulary);
    if (bad.length) S("ALBUM_TRACK_STATUS_OUT_OF_VOCAB", "CANONICAL_FACT", `${a.name ?? "אלבום"}: ${bad.length} שירים בסטטוס שלא קיים ברשימת הסטטוסים (${[...new Set(bad.map((t) => t.status))].join(", ")})`);
    if (a.mixWorks.length && a.tracks.length) S("ALBUM_TRACK_MIX_UNLINKED", "DERIVED_SIGNAL", `${a.name ?? "אלבום"}: יש ${a.mixWorks.length} עבודות מיקס, וסטטוס המיקס של כל שיר מתעדכן ידנית בנפרד — שני מקורות`);
  }
  return { counts: { albums: albums.length, tracks: tracks.length, byType: count(albums.map((a) => a.type)), note: "album = a project of type אלבום / EP (or any project with track rows)" }, albums, signals, unavailable: c.ops ? [] : ["OPERATIONS (album tracks) — unknown, not none"] };
}

// ═══════════════════════════════ DELIVERY ═══════════════════════════════
export const DELIVERY_EVIDENCE_LADDER = [
  { level: "DELIVERY_RECORDED", meaning: "the project's delivery record is CURRENTLY marked delivered (status delivered, with its date) — the strongest recorded evidence (still no recipient / confirmation)" },
  { level: "DELIVERED_BEFORE", meaning: "the record is not delivered now, but a past delivery date is kept (lastDeliveredAt) — historical evidence it was delivered once (status later changed or the folder was deleted)" },
  { level: "LINK_SENT_LOGGED", meaning: "a send-log entry with a link exists for the project (the delivery link can pre-fill it) — evidence something was sent, not what" },
  { level: "DELIVERY_READY", meaning: "a delivery folder + public link exist (status ready) — prepared, not delivered" },
  { level: "FINAL_FILES_EXIST", meaning: "final mix files were uploaded by the engineer — materials exist, not delivered" },
  { level: "PROJECT_COMPLETED", meaning: "project status הושלם — never proof of delivery" },
  { level: "NONE_RECORDED", meaning: "nothing recorded — outside delivery (WhatsApp / drive) is invisible" },
] as const;
export function buildDeliveryView(src: GatewaySources) {
  const c = ctxOf(src);
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const allDeliveries = c.det?.deliveries?.rows ?? [];
  // a delivery record whose key is not a project id (e.g. a leftover test key) is reported, never treated as a project
  const nonProjectRecords = allDeliveries.filter((d) => !UUID.test(d.projectId)).length;
  const deliveries = new Map(allDeliveries.filter((d) => UUID.test(d.projectId)).map((d) => [d.projectId, d]));
  const finals = c.det?.finalFiles?.rows ?? [];
  const actions = c.det?.actions?.rows ?? [];
  const requests = (c.det?.projectSettings?.rows ?? []).filter((r) => r.kind === "STEVEN_FINAL_FILES_REQUESTED_PROJECT");
  // B5: an OPEN final-files request = the app's own rule (computeFinalFilesFlags, like mix_view): requested and not yet
  // satisfied by a final file uploaded after the request time — never "a request row exists".
  const requestRows = requests.map((r) => ({ key: `steven_final_files_requested_project:${r.projectId}`, value: r.value }));
  const finalRows = finals.map((f) => ({ work_id: f.workId, project_id: f.projectId, created_at: f.createdAt }));
  const requestOpenOf = (projectId: string) => {
    const fl = computeFinalFilesFlags([{ id: `project:${projectId}`, projectId }], { finalRows, requestRows });
    return fl.finalFilesRequested.has(`project:${projectId}`) && !fl.hasCurrentFinalFiles.has(`project:${projectId}`);
  };
  const receivables = ok(src.finance)?.state.receivables ?? null;
  const meta = c.ops?.projectsMeta?.rows ?? [];
  const relevant = new Set([...deliveries.keys(), ...finals.map((f) => f.projectId).filter((x): x is string => !!x), ...meta.filter((p) => p.status === "הושלם").map((p) => p.id)]);
  const projects = [...relevant].map((id) => {
    const m = projectMeta(c, id);
    const d = deliveries.get(id) ?? null;
    const ff = finals.filter((f) => f.projectId === id);
    const sent = actions.filter((a) => a.projectId === id && a.hasLink && (a.actionType === "sent" || a.status === "pending_feedback"));
    const level = d?.status === "delivered" ? "DELIVERY_RECORDED" : d?.lastDeliveredAt ? "DELIVERED_BEFORE" : sent.length ? "LINK_SENT_LOGGED" : d?.status === "ready" ? "DELIVERY_READY" : ff.length ? "FINAL_FILES_EXIST" : m?.status === "הושלם" ? "PROJECT_COMPLETED" : "NONE_RECORDED";
    const recv = receivables ? receivables.filter((r) => r.projectId === id && r.collection.state !== "NOT_COLLECTIBLE" && r.collection.state !== "SETTLED").reduce<Record<string, number>>((acc, r) => { add(acc, r.currency, r.amount); return acc; }, {}) : null;
    return {
      key: `project:${id}`, name: m?.name ?? projectName(c, id), projectStatus: m?.status ?? null, businessType: m?.businessType ?? null,
      delivery: d ? { status: d.status, deliveredAt: d.status === "delivered" ? d.deliveredAt : null, lastDeliveredAt: d.lastDeliveredAt ?? null, hasPublicLink: d.hasLink, recipientRecorded: false, history: "only the last delivered date is kept (lastDeliveredAt); no recipient / per-send history" } : null,
      finalFiles: { count: ff.length, last: ff.map((f) => f.createdAt ?? "").sort().pop() || null, requested: requests.some((r) => r.projectId === id), requestOpen: requestOpenOf(id) },
      sendLog: sent.map((a) => ({ date: a.actionDate, recipientRole: a.recipientRole, status: a.status })), evidence: level, remainingToCollect: recv,
    };
  }).sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
  const signals: WorkSignal[] = [];
  for (const p of projects) {
    const S = (code: string, kind: WorkSignal["kind"], he: string) => signals.push({ code, kind, he, entity: p.key, project: p.key });
    if (p.projectStatus === "הושלם" && p.businessType === "לקוח" && p.evidence !== "DELIVERY_RECORDED" && p.evidence !== "DELIVERED_BEFORE" && p.evidence !== "LINK_SENT_LOGGED") S("COMPLETED_NO_DELIVERY_EVIDENCE", "DERIVED_SIGNAL", `${p.name ?? "פרויקט"}: הושלם ואין רישום מסירה (${p.evidence}) — לא יודע אם נמסר מחוץ למערכת`);
    if (p.delivery?.status === "ready") S("DELIVERY_READY_NOT_MARKED", "CANONICAL_FACT", `${p.name ?? "פרויקט"}: תיקיית מסירה + קישור מוכנים, לא סומן 'נמסר'`);
    if (p.evidence === "DELIVERY_RECORDED" && p.remainingToCollect && Object.values(p.remainingToCollect).some((v) => v > 0)) S("DELIVERED_BALANCE_OPEN", "DERIVED_SIGNAL", `${p.name ?? "פרויקט"}: סומן נמסר ועדיין יש יתרה לגבייה (${Object.entries(p.remainingToCollect).map(([k, v]) => `${k}${v}`).join(", ")})`);
  }
  return { counts: { projects: projects.length, byEvidence: count(projects.map((p) => p.evidence)), deliveryRecords: deliveries.size, nonProjectDeliveryRecords: nonProjectRecords, delivered: [...deliveries.values()].filter((d) => d.status === "delivered").length, finalFiles: finals.length, note: "'delivered' only from a delivery record — never from completion or final files" }, ladder: DELIVERY_EVIDENCE_LADDER, projects, signals, unavailable: [...(c.det ? [] : ["PROJECT_DETAIL (deliveries, final files, send log) — unknown, not none"]), "the delivery folder contents are not listed (Dropbox listing is not read)"] };
}

// ═══════════════════════════════ SOCIAL ═══════════════════════════════
export function buildSocialView(src: GatewaySources) {
  const c = ctxOf(src);
  const camps = c.ops?.campaigns?.rows ?? [];
  const dcamps = new Map((c.det?.campaigns?.rows ?? []).map((x) => [x.id, x]));
  const items = c.det?.contentItems?.rows ?? [];
  const files = c.det?.socialFiles?.rows ?? [];
  const promos = c.ops?.promotions?.rows ?? [];
  const campaigns = camps.map((k) => {
    const d = dcamps.get(k.id);
    const its = items.filter((i) => i.campaignId === k.id);
    // the app's own readiness checker + recommendations (implementation behaviour, not Owner policy)
    const asCampaign = { id: k.id, project_id: k.projectId, title: k.title, artist_name: k.artistName ?? "", release_date: k.releaseDate, status: k.status, marketing_angle: d?.marketingAngle ?? "", target_audience: d?.targetAudience ?? "", main_message: d?.mainMessage ?? "", platforms: d?.platforms ?? [], owner_id: d?.ownerUserId ?? null, notes: "", created_at: d?.createdAt ?? "", updated_at: d?.updatedAt ?? "" } as unknown as SocialCampaign;
    const asItems = its.map((i) => ({ id: i.id, campaign_id: i.campaignId, project_id: i.projectId, title: i.title ?? "", content_type: i.contentType ?? "", status: i.status ?? "", platform: i.platform, due_date: i.dueDate, publish_date: i.publishDate, owner_name: i.ownerName ?? "", asset_link: (i as { hasAssetLink?: boolean }).hasAssetLink ? "x" : "", dropbox_link: (i as { hasDropboxLink?: boolean }).hasDropboxLink ? "x" : "", posted_url: i.postedUrl ?? "" })) as unknown as SocialContentItem[];
    let appMissing: Array<{ label: string; severity: string }> = [];
    let appRecommendations: string[] = [];
    try { appMissing = checkMissing(asCampaign, asItems, c.today); appRecommendations = getRecommendations(asCampaign, asItems); } catch { /* the app rule could not run — reported below */ }
    return {
      key: `social-campaign:${k.id}`, title: k.title, status: k.status, artist: k.artistName, releaseDate: k.releaseDate, project: k.projectId ? { key: `project:${k.projectId}`, name: projectName(c, k.projectId) } : null, promotionBudget: k.promotionBudget,
      content: { total: its.length, byStatus: count(its.map((i) => i.status)), byType: count(its.map((i) => i.contentType)), byPlatform: count(its.map((i) => i.platform)), posted: its.filter((i) => !!i.postedUrl).length, byPhase: count(its.map((i) => socialPhaseOf(i.status))), ready: its.filter((i) => socialPhaseOf(i.status) === "READY").length, overdue: its.filter((i) => isSocialItemOverdue({ status: i.status, due_date: i.dueDate }, c.today)).length },
      files: files.filter((f) => f.campaignId === k.id).length, promotions: promos.filter((p) => p.campaignId === k.id).map((p) => ({ channel: p.channel, planned: p.plannedAmount, status: p.status, date: p.promoDate, financeExpenseLinked: p.hasTransaction })),
      appReadiness: { missing: appMissing, recommendations: appRecommendations, classification: "IMPLEMENTATION_BEHAVIOR — what the app's social checklist flags; never a verdict that a release cannot happen" },
    };
  });
  const signals: WorkSignal[] = [];
  for (const k of campaigns) {
    const S = (code: string, kind: WorkSignal["kind"], he: string) => signals.push({ code, kind, he, entity: k.key, project: k.project?.key });
    for (const m of k.appReadiness.missing) S("SOCIAL_APP_CHECKLIST_FLAG", "DERIVED_SIGNAL", `${k.title}: הצ'קליסט של האפליקציה — ${m.label} (${m.severity})`);
    if (k.content.overdue) S("SOCIAL_CONTENT_OVERDUE", "CANONICAL_FACT", `${k.title}: ${k.content.overdue} תכנים שתאריך היעד שלהם עבר ולא פורסמו`);
    if (k.releaseDate && k.project) {
      const rel = c.st?.domains.releasesFull.data?.items.find((r) => r.projectId === k.project!.key.slice(8));
      if (rel?.targetYmd && rel.targetYmd !== k.releaseDate) S("SOCIAL_RELEASE_DATE_DIFFERS", "CANONICAL_FACT", `${k.title}: תאריך הריליס בקמפיין (${k.releaseDate}) שונה מיעד הריליס (${rel.targetYmd}) — שני מקורות, לא מסונכרנים`);
    }
  }
  return { counts: { campaigns: campaigns.length, byStatus: count(campaigns.map((k) => k.status)), contentItems: items.length, files: files.length, promotions: promos.length, note: "status keys are English in storage; the page shows 5 Hebrew labels" }, campaigns, signals, unavailable: [...(c.ops ? [] : ["OPERATIONS (campaigns, promotions) — unknown, not none"]), ...(c.det ? [] : ["PROJECT_DETAIL (content items, files)"])] };
}
