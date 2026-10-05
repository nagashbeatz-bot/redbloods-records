/**
 * Sunny — WHAT HAPPENED SINCE (One Brain stage 3, Owner-approved 2026-10-05). Pure, read-only, ONE shared evidence rule.
 *
 * "What happened since the Owner told me X?" is answered ONLY from MEANINGFUL, timestamped evidence the app records:
 *   PROGRESS  a canonical work event — a mix / master version, final files, a Victor upload / sent notes, a delivery,
 *             a held session the Owner recorded (AUTO_MARK = the end passed, never proof), a release stage / release;
 *   PLANNING  Sunny executed a re-planning action on the entity (deadline, schedule, task, calendar) — planning ≠ progress;
 *   RECORDING Sunny executed a record-keeping action (price, money, details) — recording ≠ progress;
 *   CONTEXT   the Owner taught knowledge / Sunny recorded an understanding about the entity after it.
 * NEVER evidence: a generic updated_at, a date passing, an auto-marked session, a push, the age of the note itself.
 * Evidence BEFORE the note never counts (a session on the same Israel day as the note is ambiguous → not counted).
 * Exact entity only: an event on another entity / project never counts. Actions come from the Action Layer history
 * (provenance) and are classified by ACTION_MEANING — an action that ran is never "the problem was solved".
 *
 * projectLastEventAt (lib/partner/projects/memory.ts) is the latest PROGRESS event of this same rule.
 */
import type { GatewaySources } from "../gateway/core";
import type { OperationsRaw } from "../operations/types";
import type { OwnerKnowledgeRecord } from "../owner-knowledge/store";
import type { InboxMemory } from "../../inbox-memory";
import { heldConfirmedByOwner } from "../../session-duration";

const ok = <T,>(a: { status: string; value?: T } | undefined): T | null => (a && a.status === "OK" ? (a as { value: T }).value : null);
const ilYmd = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
const ddmm = (iso: string) => { const y = ilYmd(iso); return `${y.slice(8, 10)}.${y.slice(5, 7)}`; };
const valid = (x: string | null | undefined): x is string => !!x && Number.isFinite(Date.parse(x));

export type SinceMeaning = "PROGRESS" | "PLANNING" | "RECORDING" | "CONTEXT";
export type SinceKind = "SESSION_SCHEDULED" | "MIX_VERSION" | "FINAL_FILES" | "VICTOR_UPLOAD" | "VICTOR_NOTES" | "DELIVERED" | "SESSION_HELD" | "RELEASE_STAGE" | "RELEASED" | "ACTION" | "OWNER_KNOWLEDGE" | "UNDERSTANDING";
export interface SinceEvent { at: string; kind: SinceKind; meaning: SinceMeaning; he: string; entity: string; source: string; /** the plan id of an ACTION event */ ref?: string }

/** The PROGRESS events of ONE project (every time, no cut-off) — the one rule projectLastEventAt and "since" share. */
export function projectProgressEvents(src: GatewaySources, projectId: string): SinceEvent[] {
  const st = ok(src.state);
  const ops = ok(src.operations) as OperationsRaw | null;
  const entity = `project:${projectId}`;
  const out: SinceEvent[] = [];
  const P = (at: string | null | undefined, kind: SinceKind, he: string, source: string) => { if (valid(at)) out.push({ at, kind, meaning: "PROGRESS", he, entity, source }); };
  const works = (ops?.engineerWork?.rows ?? []).filter((w) => w.projectId === projectId);
  const workIds = new Set(works.map((w) => w.id));
  const who = (id: string | null) => works.find((w) => w.id === id)?.engineerName ?? "המהנדס";
  for (const v of ops?.mixVersions?.rows ?? []) if (v.workId && workIds.has(v.workId)) P(v.createdAt, "MIX_VERSION", `${who(v.workId)} העלה גרסה`, "MIX_VERSIONS");
  for (const f of ops?.finalFiles?.rows ?? []) if (f.workId && workIds.has(f.workId)) P(f.createdAt, "FINAL_FILES", "הועלו קבצים סופיים", "FINAL_FILES");
  for (const w of st?.domains.victor.data?.active ?? []) if (w.projectId === projectId) { P(w.lastUploadAt, "VICTOR_UPLOAD", "ויקטור העלה גרסה", "TEAM_VICTOR"); P(w.lastNotesSentAt, "VICTOR_NOTES", "נשלחו הערות לויקטור", "TEAM_VICTOR"); }
  for (const d of ops?.deliveries?.rows ?? []) if (d.projectId === projectId) P(d.deliveredAt, "DELIVERED", "נמסר ללקוח", "DELIVERIES");
  // a held session counts only when the Owner recorded it (AUTO_MARK = the end passed, not proof — 2026-10-01)
  for (const s of st?.domains.sessions.data?.items ?? []) if (s.projectId === projectId && s.dateYmd && heldConfirmedByOwner({ status: s.status, status_source: s.statusSource ?? null, date: s.dateYmd, start_time: s.startTime ?? null, end_time: s.endTime ?? null })) P(`${s.dateYmd}T00:00:00Z`, "SESSION_HELD", `סשן התקיים (${s.dateYmd.slice(8, 10)}.${s.dateYmd.slice(5, 7)})`, "SESSIONS");
  for (const r of st?.domains.releasesFull.data?.items ?? []) if (r.projectId === projectId) {
    P(r.releasedAt, "RELEASED", "הריליס יצא", "RELEASES");
    const entered = (r as { stageEnteredAt?: string | null }).stageEnteredAt ?? null;
    if (entered && entered !== r.releasedAt) P(entered, "RELEASE_STAGE", `הריליס עבר לשלב ${(r as { stage?: string | null }).stage ?? "חדש"}`, "RELEASES");
  }
  return out.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

/**
 * The PLANNING events of ONE project from its own records (completeness pass 2.1, 2026-10-05): a session of THIS project
 * (sessions.project_id — the canonical relation) recorded at sessions.created_at = it was scheduled then. Scheduling is
 * PLANNING, never progress. A session whose creation time is not known gives no event — it is counted as timing-unknown.
 */
export function projectPlanningEvents(src: GatewaySources, projectId: string): { events: SinceEvent[]; timingUnknown: Array<{ id: string; dateYmd: string }> } {
  const st = ok(src.state);
  const events: SinceEvent[] = [];
  const timingUnknown: Array<{ id: string; dateYmd: string }> = [];
  for (const s of st?.domains.sessions.data?.items ?? []) {
    if (s.projectId !== projectId || s.status === "בוטל" || !s.dateYmd) continue;
    const created = (s as { createdAt?: string | null }).createdAt ?? null;
    if (valid(created)) events.push({ at: created, kind: "SESSION_SCHEDULED", meaning: "PLANNING", he: `נקבע סשן ל-${s.dateYmd.slice(8, 10)}.${s.dateYmd.slice(5, 7)}`, entity: `project:${projectId}`, source: "SESSIONS" });
    else timingUnknown.push({ id: s.id, dateYmd: s.dateYmd });
  }
  return { events, timingUnknown };
}

/** After the note: strictly later instant; a day-only event (a session) only on a LATER Israel day than the note. */
export function isAfter(e: { at: string; kind?: SinceKind }, sinceIso: string): boolean {
  if (!valid(e.at) || !valid(sinceIso)) return false;
  if (e.kind === "SESSION_HELD") return e.at.slice(0, 10) > ilYmd(sinceIso);
  return Date.parse(e.at) > Date.parse(sinceIso);
}

/**
 * Action meaning (the Action Layer's own action ids). PLANNING = re-planned (deadline / schedule / task / calendar);
 * RECORDING = record-keeping; PROGRESS only for a status / stage move the Boss approved (still not "solved").
 * Anything unlisted is RECORDING — never PROGRESS by default.
 */
export const ACTION_MEANING: Readonly<Record<string, SinceMeaning>> = {
  UPDATE_PROJECT_DEADLINE: "PLANNING", SCHEDULE_SESSION: "PLANNING", SCHEDULE_SESSION_WITH_INVITE: "PLANNING", UPDATE_SESSION: "PLANNING", CREATE_TASK: "PLANNING", UPDATE_TASK: "PLANNING",
  CREATE_CALENDAR_EVENT: "PLANNING", CREATE_CALENDAR_INVITE: "PLANNING", CREATE_GOOGLE_TASK: "PLANNING", UPDATE_RELEASE_DETAILS: "PLANNING", SET_PROPOSAL_FOLLOWUP: "PLANNING",
  UPDATE_PROJECT_STATUS: "PROGRESS", SET_PROJECT_STATUS: "PROGRESS", CHANGE_RELEASE_STAGE: "PROGRESS", SET_ENGINEER_WORK_STATUS: "PROGRESS", CLOSE_SHOW: "PROGRESS", SET_TASK_STATUS: "PROGRESS", SEND_VICTOR_VERSION_NOTES: "PROGRESS", NOTIFY_MIX_READY: "PROGRESS",
};
const ACTION_HE: Readonly<Record<SinceMeaning, string>> = { PLANNING: "תכנון מחדש (לא התקדמות)", RECORDING: "רישום (לא התקדמות)", PROGRESS: "שינוי מצב שאישרת", CONTEXT: "הקשר" };

/** The Action Layer history items the connector already reads (recentActions / partner_plan_status history). */
export interface ActionHistoryItem { planId: string; at: string | null; outcome: string; steps: ReadonlyArray<{ actionId: string; entity: string | null; outcome: string | null }>; /** OWNER_APPROVAL / STANDING_AUTHORIZATION — explicit approval evidence */ approvedBy?: string | null }
const MARKS = new Set(["MARK_OWNER_INBOX_ITEM", "LINK_INBOX_ENTITY", "RECORD_INBOX_INTERPRETATION", "RETRACT_INBOX_LINK", "RETRACT_INBOX_INTERPRETATION"]);
/** Executed (APPLIED_AS_EXPECTED) steps on exactly these entities after the note — inbox housekeeping never counts. */
export function actionsSince(items: readonly ActionHistoryItem[], entityKeys: readonly string[], sinceIso: string): SinceEvent[] {
  const keys = new Set(entityKeys);
  const out: SinceEvent[] = [];
  for (const it of items) {
    if (!it.at || !isAfter({ at: it.at }, sinceIso)) continue;
    for (const s of it.steps) {
      if (!s.entity || !keys.has(s.entity) || s.outcome !== "APPLIED_AS_EXPECTED" || MARKS.has(s.actionId)) continue;
      const meaning = ACTION_MEANING[s.actionId] ?? "RECORDING";
      out.push({ at: it.at, kind: "ACTION", meaning, he: `${s.actionId} — ${ACTION_HE[meaning]} (${ddmm(it.at)}, ${it.planId})`, entity: s.entity, source: "ACTIONS", ref: it.planId });
    }
  }
  return out;
}

/** Owner knowledge taught about exactly these entities after the note (CONTEXT — never progress). */
export function knowledgeSince(records: readonly OwnerKnowledgeRecord[], entityKeys: readonly string[], sinceIso: string): SinceEvent[] {
  const keys = new Set(entityKeys);
  return records.filter((k) => (keys.has(k.subjectKey) || k.identityKeys.some((x) => keys.has(x))) && isAfter({ at: k.createdAt }, sinceIso))
    .map((k) => ({ at: k.createdAt, kind: "OWNER_KNOWLEDGE" as const, meaning: "CONTEXT" as const, he: `לימדת אותי: ${k.meaningHe}`, entity: k.subjectKey, source: "OWNER_KNOWLEDGE" }));
}

/** Understandings Sunny recorded about these entities after the note, from OTHER updates (CONTEXT). */
export function understandingsSince(mem: InboxMemory | null, entityKeys: readonly string[], sinceIso: string, excludeItemId: string): SinceEvent[] {
  if (!mem) return [];
  const keys = new Set(entityKeys);
  return mem.interpretations.filter((x) => !x.retractedAt && x.itemId !== excludeItemId && keys.has(x.entityKey) && isAfter({ at: x.createdAt }, sinceIso))
    .map((x) => ({ at: x.createdAt, kind: "UNDERSTANDING" as const, meaning: "CONTEXT" as const, he: `עדכון מאוחר יותר: ${x.whatHappened}`, entity: x.entityKey, source: "INBOX_MEMORY" }));
}

export type SinceVerdict = "PROGRESSED" | "PLANNED_ONLY" | "RECORDED_ONLY" | "CONTEXT_ONLY" | "NOTHING_RECORDED" | "NOT_CHECKED";
export interface SinceSummary { verdict: SinceVerdict; progress: number; planning: number; recording: number; context: number; he: string; events: SinceEvent[]; actionsRead: boolean }

/** Every meaningful event on the entities after the note — ONE rule for every view (inbox, brief, entity, needs_me). */
export function whatHappenedSince(o: {
  src: GatewaySources; entityKeys: readonly string[]; sinceIso: string; itemId: string;
  /** the Action Layer history — absent = not read here (the connector adds it); never "no action happened" */
  actions?: readonly ActionHistoryItem[] | null;
}): SinceSummary {
  const stateRead = !!ok(o.src.state) && !!ok(o.src.operations);
  const projects = o.entityKeys.filter((k) => k.startsWith("project:")).map((k) => k.slice("project:".length));
  const planning = projects.map((id) => projectPlanningEvents(o.src, id));
  // a session of the project with no recorded creation time and a date after the note: it MAY have been scheduled since —
  // unknown, never invented (it makes an otherwise empty answer NOT_CHECKED)
  const timingUnknown = planning.flatMap((x) => x.timingUnknown).filter((x) => x.dateYmd > ilYmd(o.sinceIso)).length;
  const events: SinceEvent[] = [
    ...projects.flatMap((id) => projectProgressEvents(o.src, id).filter((e) => isAfter(e, o.sinceIso))),
    ...planning.flatMap((x) => x.events).filter((e) => isAfter(e, o.sinceIso)),
    ...(o.actions ? actionsSince(o.actions, o.entityKeys, o.sinceIso) : []),
    ...knowledgeSince((ok(o.src.ownerKnowledge) as OwnerKnowledgeRecord[] | null) ?? [], o.entityKeys, o.sinceIso),
    ...understandingsSince(ok(o.src.inboxMemory) as InboxMemory | null, o.entityKeys, o.sinceIso, o.itemId),
  ].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const sum = summarizeSince(events, stateRead, !!o.actions);
  return sum.verdict === "NOTHING_RECORDED" && timingUnknown > 0
    ? { ...sum, verdict: "NOT_CHECKED", he: `לא נבדק במלואו — יש ${timingUnknown} סשן/ים בפרויקט שזמן הקביעה שלהם לא רשום (לא ממציאה מתי נקבעו)` }
    : sum;
}

export function summarizeSince(events: SinceEvent[], stateRead: boolean, actionsRead: boolean): SinceSummary {
  const n = (m: SinceMeaning) => events.filter((e) => e.meaning === m).length;
  const progress = n("PROGRESS"), planning = n("PLANNING"), recording = n("RECORDING"), context = n("CONTEXT");
  const verdict: SinceVerdict = !stateRead ? "NOT_CHECKED" : progress ? "PROGRESSED" : planning ? "PLANNED_ONLY" : recording ? "RECORDED_ONLY" : context ? "CONTEXT_ONLY" : "NOTHING_RECORDED";
  const he = verdict === "NOT_CHECKED" ? "לא נבדק — מצב החברה לא נקרא (זה לא אומר שלא קרה כלום)"
    : verdict === "PROGRESSED" ? `מאז העדכון נרשמה התקדמות: ${events.filter((e) => e.meaning === "PROGRESS").map((e) => e.he).join("; ")}`
    : verdict === "PLANNED_ONLY" ? "מאז העדכון היה רק תכנון מחדש (למשל דדליין) — אין התקדמות רשומה בעבודה עצמה"
    : verdict === "RECORDED_ONLY" ? "מאז העדכון נרשמו פרטים (כסף / פרטים) — אין התקדמות רשומה בעבודה עצמה"
    : verdict === "CONTEXT_ONLY" ? "מאז העדכון נוסף רק הקשר (ידע / עדכון) — אין התקדמות רשומה"
    : `לא נרשמה התקדמות משמעותית מאז העדכון${actionsRead ? "" : " (פעולות של סאני לא נבדקו כאן)"}`;
  // counts over everything; the list is bounded (newest 8) — maximum knowledge, minimum context
  return { verdict, progress, planning, recording, context, he, events: events.slice(-8), actionsRead };
}
