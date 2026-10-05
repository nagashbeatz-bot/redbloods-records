/**
 * Sunny COO — BUSINESS_MOTION (Owner mission 2026-10-05, Phase 2). Pure, read-only, interaction time only.
 *
 * ONE derived reasoning layer over what ONE SUNNY already knows. It turns the existing derived views into the few
 * concrete business moves that would push Redbloods forward NOW. It is NOT a truth store, NOT a second priority
 * engine (coo priorities = motion.today; partner_brief carries motion — neither ranks on its own), never writes, never
 * schedules, never pushes, never changes a canonical value (a stale send-log ball stays exactly as the records say — a
 * newer completion is shown as a CONFLICT between an old signal and the current state, never resolved).
 *
 * Inputs (composed, never re-read): readiness, momentum, roster care, schedule + calendar availability, needs_me,
 * the Owner-inbox lifecycle, owner knowledge (blockers), derived patterns, the Finance Brain (realized, receivables,
 * proposal pipeline), the gap registry (the goal conflict), the project views (money, stage, completion).
 * The connector adds the Action-Layer history (applyMotionLearning): a planning move that already ran and did not move
 * the work is not proposed again by default.
 *
 * Levels (display, never a score): MUST — a near commitment / release / a blocker that risks it;
 * SHOULD — one move advances a lot (close a loop, protected label with a clear move + capacity, Owner-only unblock,
 * commercial gap); WATCH — real but not today; INFO — context only. The greeting shows ≤3 MUST/SHOULD + one week line.
 * Owner decisions 2026-10-05: capacity is an OPPORTUNITY signal only (no work hours, no obligation, never schedules);
 * protected label = Shalev + Avi (OWNER_LABEL_ARTIST_IDS), promoted ONE level only, MUST only with a near commitment;
 * no cadence; goals that conflict are never a priority driver; a deadline's content is never invented.
 */
import type { GatewaySources } from "../gateway/core";
import { ok } from "../gateway/core";
import type { CooCtx } from "./context";
import type { ReadinessBoard } from "./readiness";
import type { ArtistCare, ProjectMomentum } from "./momentum";
import type { ScheduleHealth } from "./schedule";
import { addDaysYmd, daysBetween, heDate, isYmd, ymdOf, INTERNAL_COO_HEURISTICS } from "./model";
import { completionEvidence, stageBehind, engineerWorksOf, STAGE_UNCERTAINTY_HE, WAITING_FOR_MIX } from "./stage";
import { availability, dayList } from "../calendar/availability";
import { engineerHandoff } from "../mix/handoff";
import { inboxTriageOf } from "../sunny/inbox-lifecycle-base";
import type { InboxDisplayState, InboxLifecycle } from "../sunny/inbox-lifecycle";
import { ALMOST_RE, derivePatterns, type DerivedPattern } from "../sunny/patterns";
import { projectProgressEvents, type SinceEvent } from "../sunny/since";
import { activeKnowledge, type OwnerKnowledgeRecord } from "../owner-knowledge/store";
import { KNOWLEDGE_GAPS } from "../system/gaps";
import { OWNER_LABEL_ARTIST_IDS } from "../../project-classification";
import { normalizeName } from "../gateway/resolve";
import type { PartnerFinanceState } from "../finance/types";
import type { OutcomeAssessment } from "../sunny/learning";
import { buildFinancialForward, type FinancialForward, type Obligation } from "./financial-forward";

/** INTERNAL engineering windows — never Owner policy, never "stuck", never served as a rule (each use says heuristic). */
export const MOTION_HEURISTICS = {
  /** a commitment this close and not ready is MUST */
  mustDays: 7,
  /** a day with at most this many occupied calendar minutes and no Redbloods event counts as "relatively open" */
  openDayMaxBusyMinutes: 120,
  /** this many relatively open days in the coming week = "a relatively open week" (an opportunity, never an obligation) */
  openWeekMinDays: 3,
  /** a deadline that passed within this many days is "recently overdue" (older ones = one aggregate WATCH line) */
  recentOverdueDays: 14,
  /** greeting / today display limits (presentation, not business rules) */
  greetingMoves: 3,
  todayMax: 5,
  note: "engineering windows only — never Owner policy, never 'stuck', never a work-hours rule",
} as const;

export type MotionLevel = "MUST" | "SHOULD" | "WATCH" | "INFO";
export const MOTION_LEVEL_HE: Record<MotionLevel, string> = { MUST: "חייב עכשיו", SHOULD: "כדאי השבוע", WATCH: "לשים עין", INFO: "הקשר" };
const LEVEL_ORDER: MotionLevel[] = ["MUST", "SHOULD", "WATCH", "INFO"];
const lv = (l: MotionLevel) => LEVEL_ORDER.indexOf(l);
const maxLevel = (a: MotionLevel, b: MotionLevel): MotionLevel => (lv(a) <= lv(b) ? a : b);
const raise = (l: MotionLevel): MotionLevel => (l === "INFO" ? "WATCH" : l === "WATCH" ? "SHOULD" : l);

export type MotionCode =
  | "COMMITMENT_NOT_READY" | "STAGE_VS_DEADLINE" | "LONG_OVERDUE_DEADLINES" | "SCHEDULE_CONFLICT"
  | "COMPLETION_NOT_RECORDED" | "ONE_MOVE_TO_MIX" | "OWNER_ONE_ACTION" | "OWNER_REPORTED_NEAR"
  | "OWNER_BOTTLENECK_EXTRACT" | "OWNER_APPROVAL_WAITING" | "OWNER_BALL" | "OWNER_SAID_WAITING"
  | "LABEL_NEEDS_MOTION" | "REVENUE_PIPELINE_EMPTY" | "PRICE_MISSING"
  | "STATUS_BEHIND_ACTIVITY" | "SHOOT_AUTO_MARKED" | "FOLLOW_UP_AFTER_CONDITION" | "OWNER_UPDATE_LINKED"
  | "STALE_SIGNAL_CONFLICT" | "NO_NEXT_STEP" | "FIN_OBLIGATION" | "FIN_DUPLICATE";

export type MotionSection = "AT_RISK" | "CLOSE_LOOPS" | "OWNER_BOTTLENECK" | "LABEL" | "MONEY" | "OTHER";
const SECTION_OF: Record<MotionCode, MotionSection> = {
  COMMITMENT_NOT_READY: "AT_RISK", STAGE_VS_DEADLINE: "AT_RISK", LONG_OVERDUE_DEADLINES: "AT_RISK", SCHEDULE_CONFLICT: "AT_RISK",
  COMPLETION_NOT_RECORDED: "CLOSE_LOOPS", ONE_MOVE_TO_MIX: "CLOSE_LOOPS", OWNER_ONE_ACTION: "CLOSE_LOOPS", OWNER_REPORTED_NEAR: "CLOSE_LOOPS",
  OWNER_BOTTLENECK_EXTRACT: "OWNER_BOTTLENECK", OWNER_APPROVAL_WAITING: "OWNER_BOTTLENECK", OWNER_BALL: "OWNER_BOTTLENECK", OWNER_SAID_WAITING: "OWNER_BOTTLENECK",
  LABEL_NEEDS_MOTION: "LABEL", REVENUE_PIPELINE_EMPTY: "MONEY", PRICE_MISSING: "MONEY",
  STATUS_BEHIND_ACTIVITY: "OTHER", SHOOT_AUTO_MARKED: "OTHER", FOLLOW_UP_AFTER_CONDITION: "OTHER", OWNER_UPDATE_LINKED: "OTHER", STALE_SIGNAL_CONFLICT: "OTHER", NO_NEXT_STEP: "OTHER",
  FIN_OBLIGATION: "MONEY", FIN_DUPLICATE: "MONEY",
};

/** Every action id a move may name — each MUST be a registered Partner action (scripts/test-sunny-motion pins it). */
export const MOTION_ACTION_IDS = [
  "UPDATE_PROJECT_STATUS", "SET_DELIVERY_STATUS", "CREATE_ENGINEER_WORK", "SEND_MIX_NOTES", "SET_ENGINEER_WORK_STATUS",
  "SEND_VICTOR_VERSION_NOTES", "SCHEDULE_SESSION", "SET_AGREED_PRICE", "UPDATE_PRODUCTION_DETAILS", "UPDATE_RELEASE_DETAILS",
  "UPDATE_PROJECT_DEADLINE", "UPDATE_SESSION", "UPDATE_CALENDAR_EVENT",
  "RECORD_ENGINEER_PAYMENT", "RECORD_VICTOR_SALARY_MONTH", "ADD_LEDGER_ENTRY", "CLOSE_BALANCE_CYCLE",
] as const;
export type MotionActionId = (typeof MOTION_ACTION_IDS)[number];

export interface MotionMove { he: string; actionIds: MotionActionId[]; canAct: boolean; approval: "OWNER_APPROVAL" }
export interface MotionEvidence { source: string; ref: string | null; he: string; epistemic: "FACT" | "DERIVED" | "OWNER_REPORTED" | "HYPOTHESIS" }
export interface MotionItem {
  key: string;
  /** the primary entity (project / label-artist / release …) or null for a company-level line */
  entity: string | null;
  entities: string[];
  level: MotionLevel;
  codes: MotionCode[];
  sections: MotionSection[];
  titleHe: string;
  reasonsHe: string[];
  evidence: MotionEvidence[];
  move: MotionMove | null;
  /** HYPOTHESIS when the item rests on an inference (an Owner note, a holiday that passed, a pattern) */
  epistemic: "DERIVED" | "HYPOTHESIS";
  daysTo: number | null;
  labelWork: boolean;
  labelProtected: boolean;
  heuristic: boolean;
  /** set by applyMotionLearning when an earlier planning move did not move the work */
  learning?: { changed: boolean; he: string; planIds: string[] } | null;
  /** a money item from FINANCIAL_FORWARD (shown in the greeting's ONE money line, never as an operational move) */
  financial?: boolean;
  he: string;
}

export type CapacityState = "OPEN" | "NORMAL" | "BUSY" | "UNKNOWN";
export interface MotionWeek {
  start: string; end: string;
  calendarStatus: string;
  capacity: CapacityState;
  openDays: string[];
  heavyToday: boolean;
  recordedEvents: number;
  dueThisWeek: string[];
  label: string | null;
  money: string | null;
  external: number;
  opportunity: { he: string; candidates: string[]; epistemic: "HYPOTHESIS" } | null;
  lineHe: string;
}

export interface BusinessMotion {
  today: string;
  /** MUST + SHOULD, ranked (≤ todayMax) — what coo priorities serves */
  todayItems: MotionItem[];
  /** the greeting: the first ≤3 of todayItems (1 on a heavy day) */
  greeting: MotionItem[];
  more: number;
  atRisk: MotionItem[];
  closeLoops: MotionItem[];
  ownerBottleneck: { extracted: string[]; victorWaiting: number; restCount: number; mixWaiting: number; lineHe: string | null };
  label: MotionItem[];
  revenue: { state: "PIPELINE_EMPTY" | "PIPELINE_OPEN" | "UNKNOWN"; goalConflict: boolean; lineHe: string | null; unpricedActive: number };
  week: MotionWeek;
  inbox: MotionInbox;
  watch: MotionItem[];
  /** every item (WATCH / INFO included) — on request only, never in the greeting */
  all: MotionItem[];
  patterns: Array<{ code: string; level: string; he: string }>;
  /** the later recorded progress per entity of the moves (the ONE since rule) — the connector's learning input */
  progress: Record<string, SinceEvent[]>;
  learning: { status: "NOT_READ" | "READ"; changed: number; noteHe: string };
  unchecked: string[];
  heuristics: typeof MOTION_HEURISTICS;
  /** FINANCIAL_FORWARD (an input — never a second engine): the compact money picture */
  financial: { status: string; lineHe: string; coverageHe: string; surprises: string[]; datedSurprises: string[]; undatedSurprises: string[]; decided: string[]; duplicates: string[]; unitsHe: string | null; windows: FinancialForward["windows"]; commercialGap: boolean } | null;
  answerHe: string;
}

export interface MotionInput { readiness: ReadinessBoard; momentum: readonly ProjectMomentum[]; artists: readonly ArtistCare[]; schedule: ScheduleHealth }

// ───────────────────────────── helpers ─────────────────────────────

const MOVES = {
  completion: (): MotionMove => mv("לאשר שהעבודה הסתיימה, לסמן הושלם ולוודא מסירה ללקוח", ["UPDATE_PROJECT_STATUS", "SET_DELIVERY_STATUS"]),
  toMix: (): MotionMove => mv("לפתוח עבודת מיקס (לשלוח למהנדס)", ["CREATE_ENGINEER_WORK"]),
  stage: (overdue: boolean): MotionMove => mv(overdue ? "לבדוק מה נשאר עד המסירה ולקבוע את הצעד הקונקרטי הבא (למשל לפתוח מיקס) — ואם צריך, לעדכן את הדדליין" : "לבדוק מה נשאר עד המסירה ולקבוע עכשיו את הצעד הבא (למשל לפתוח מיקס)", overdue ? ["CREATE_ENGINEER_WORK", "UPDATE_PROJECT_DEADLINE"] : ["CREATE_ENGINEER_WORK"]),
  mixListen: (): MotionMove => mv("להאזין לגרסה האחרונה ולשלוח הערות — או לאשר", ["SEND_MIX_NOTES", "SET_ENGINEER_WORK_STATUS"]),
  victorNotes: (): MotionMove => mv("לשלוח לויקטור הערות על הגרסה האחרונה", ["SEND_VICTOR_VERSION_NOTES"]),
  session: (what: string): MotionMove => mv(`לקבוע סשן${what ? ` ל${what}` : ""}`, ["SCHEDULE_SESSION"]),
  price: (names: string[]): MotionMove => mv(`לסגור תמחור${names.length ? ` ל-${names.slice(0, 3).join(", ")}` : ""}`, ["SET_AGREED_PRICE"]),
  shoot: (): MotionMove => mv("אם הצילום התקיים — לעדכן את ההפקה (צולם / עריכה)", ["UPDATE_PRODUCTION_DETAILS"]),
  status: (): MotionMove => mv("לעדכן את סטטוס הפרויקט לפי מה שקורה בפועל", ["UPDATE_PROJECT_STATUS"]),
  release: (): MotionMove => mv("להחליט: להשלים את מה שפתוח לריליס, או לשקול מחדש את התאריך (אני לא משנה תאריך לבד)", ["SEND_VICTOR_VERSION_NOTES", "UPDATE_RELEASE_DETAILS"]),
  conflict: (): MotionMove => mv("להחליט מה מזיזים (אני לא משנה כלום ביומן לבד)", ["UPDATE_SESSION", "UPDATE_CALENDAR_EVENT"]),
  followUp: (): MotionMove => ({ he: "לחזור לזה עכשיו (מחוץ ל-Redbloods) — ולעדכן אותי מה נקבע", actionIds: [], canAct: false, approval: "OWNER_APPROVAL" }),
};
// ── Zero Inbox in motion (Owner decision 2026-10-05): ROUTE, never hide. An update is "absorbed" only when a move USES
// it as evidence (A) or its PROPOSED MOVE covers every business topic the update names (B) — same project alone never is.
export type UpdateTopic = "MIX" | "SESSION" | "FEEDBACK" | "DELIVERY";
const TOPIC_RE: ReadonlyArray<[UpdateTopic, RegExp]> = [
  ["MIX", /מיקס|למקס|מקסס|מאסטר|\bmix|\bmaster/i],
  ["SESSION", /סשן|הקלט|להקליט|וורס|פזמון/],
  ["FEEDBACK", /פידבק|הערות|גרסה|גירסה/],
  ["DELIVERY", /מסירה|למסור|נמסר|הושלם/],
];
export const TOPIC_ACTIONS: Readonly<Record<UpdateTopic, readonly string[]>> = {
  MIX: ["CREATE_ENGINEER_WORK", "SEND_MIX_NOTES", "SET_ENGINEER_WORK_STATUS"],
  SESSION: ["SCHEDULE_SESSION"],
  FEEDBACK: ["SEND_VICTOR_VERSION_NOTES", "SEND_MIX_NOTES"],
  DELIVERY: ["UPDATE_PROJECT_STATUS", "SET_DELIVERY_STATUS"],
};
export function updateTopics(body: string): UpdateTopic[] { return TOPIC_RE.filter(([, re]) => re.test(body)).map(([t]) => t); }

export interface MotionInboxEntry { lifecycle: InboxLifecycle; absorbedBy: string | null }
export interface MotionInbox {
  read: boolean; lineHe: string | null;
  needsOwner: number; unread: number; unrouted: number; technicalOpen: number; absorbed: number; closable: number;
  counts: Record<InboxDisplayState, number>;
  entries: MotionInboxEntry[];
}
export function motionInboxEntry(lifecycle: InboxLifecycle, absorbedBy: string | null): MotionInboxEntry { return { lifecycle, absorbedBy }; }
/** The ONE executive inbox line (motion + the connector's history re-derivation): counts only, never the update list. */
export function motionInboxOf(read: boolean, entries: readonly MotionInboxEntry[]): MotionInbox {
  const counts = { NEEDS_OWNER: 0, UNREAD: 0, UNDERSTOOD_OPEN: 0, REFLECTED: 0, OVERTAKEN: 0 } as Record<InboxDisplayState, number>;
  for (const e of entries) counts[e.lifecycle.state]++;
  const needsOwner = counts.NEEDS_OWNER;
  const technicalOpen = entries.filter((e) => e.lifecycle.technical && e.lifecycle.state === "UNREAD" && !e.absorbedBy).length;
  const unrouted = entries.filter((e) => !e.lifecycle.technical && e.lifecycle.state === "UNREAD" && !e.absorbedBy).length;
  const rest = entries.length - needsOwner - technicalOpen - unrouted; // absorbed / UNDERSTOOD_OPEN / REFLECTED / OVERTAKEN
  const parts = [
    needsOwner ? (needsOwner === 1 ? "עדכון אחד צריך ממך הבהרה" : `${needsOwner} עדכונים צריכים ממך הבהרה`) : null,
    unrouted ? (needsOwner ? (unrouted === 1 ? "ועוד אחד עדיין צריך ניתוב" : `ועוד ${unrouted} עדיין צריכים ניתוב`) : (unrouted === 1 ? "עדכון אחד עדיין צריך ניתוב" : `${unrouted} עדכונים עדיין צריכים ניתוב`)) : null,
    technicalOpen ? (technicalOpen === 1 ? "עדכון טכני אחד עדיין פתוח" : `${technicalOpen} עדכונים טכניים עדיין פתוחים`) : null,
  ].filter(Boolean);
  return { read, needsOwner, unread: counts.UNREAD, unrouted, technicalOpen, absorbed: entries.filter((e) => e.absorbedBy).length, closable: entries.filter((e) => e.lifecycle.closable).length, counts, entries: [...entries],
    lineHe: !read ? "לא קראתי את העדכונים שכתבת — לא אומרת שאין" : parts.length ? `מהתיבה: ${parts.join(", ")}${rest > 0 ? "; השאר כבר משוקפים בעבודה" : ""}` : null };
}

function mv(he: string, actionIds: MotionActionId[]): MotionMove { return { he, actionIds, canAct: actionIds.length > 0, approval: "OWNER_APPROVAL" }; }

function mergeMoves(a: MotionMove | null, b: MotionMove | null): MotionMove | null {
  if (!a) return b;
  if (!b || a.he === b.he) return a;
  const actionIds = [...new Set([...a.actionIds, ...b.actionIds])].slice(0, 4);
  return { he: `${a.he}; ${b.he}`, actionIds, canAct: actionIds.length > 0, approval: "OWNER_APPROVAL" };
}

function lineOf(i: Pick<MotionItem, "titleHe" | "reasonsHe" | "move">): string {
  return `${i.titleHe}: ${i.reasonsHe.slice(0, 2).join("; ")}${i.move ? ` → ${i.move.he}` : ""}`;
}

interface Draft { key: string; entity: string | null; level: MotionLevel; code: MotionCode; titleHe: string; reasonHe: string; evidence?: MotionEvidence[]; move?: MotionMove | null; epistemic?: "DERIVED" | "HYPOTHESIS"; daysTo?: number | null; labelWork?: boolean; labelProtected?: boolean; heuristic?: boolean; entities?: string[] }

function toItem(d: Draft): MotionItem {
  const it: MotionItem = { key: d.key, entity: d.entity, entities: d.entities ?? (d.entity ? [d.entity] : []), level: d.level, codes: [d.code], sections: [SECTION_OF[d.code]], titleHe: d.titleHe, reasonsHe: [d.reasonHe], evidence: d.evidence ?? [], move: d.move ?? null, epistemic: d.epistemic ?? "DERIVED", daysTo: d.daysTo ?? null, labelWork: !!d.labelWork, labelProtected: !!d.labelProtected, heuristic: !!d.heuristic, he: "" };
  it.he = lineOf(it);
  return it;
}

/** One item per primary entity: several gaps on one project = ONE move (a package), never three unrelated alerts. */
function mergeInto(map: Map<string, MotionItem>, d: Draft) {
  const k = d.entity ?? d.key;
  const prev = map.get(k);
  if (!prev) { map.set(k, toItem(d)); return; }
  if (!prev.codes.includes(d.code)) prev.codes.push(d.code);
  const s = SECTION_OF[d.code];
  if (!prev.sections.includes(s)) prev.sections.push(s);
  // an INFO note never adds noise to a stronger item; a stronger gap leads the reasons
  if (!prev.reasonsHe.includes(d.reasonHe) && !(d.level === "INFO" && prev.level !== "INFO")) {
    if (lv(d.level) < lv(prev.level)) prev.reasonsHe.unshift(d.reasonHe); else prev.reasonsHe.push(d.reasonHe);
  }
  prev.evidence.push(...(d.evidence ?? []));
  prev.level = maxLevel(prev.level, d.level);
  // the stronger code's move leads; a second gap adds its move (a package)
  prev.move = lv(d.level) < lv(prev.level) ? mergeMoves(d.move ?? null, prev.move) : mergeMoves(prev.move, d.move ?? null);
  if (d.epistemic === "HYPOTHESIS" && prev.codes.length === 1) prev.epistemic = "HYPOTHESIS";
  if (d.daysTo !== undefined && d.daysTo !== null && (prev.daysTo === null || d.daysTo < prev.daysTo)) prev.daysTo = d.daysTo;
  prev.labelWork ||= !!d.labelWork; prev.labelProtected ||= !!d.labelProtected; prev.heuristic ||= !!d.heuristic;
  for (const e of d.entities ?? []) if (!prev.entities.includes(e)) prev.entities.push(e);
  prev.he = lineOf(prev);
}

const SECTION_RANK: MotionSection[] = ["AT_RISK", "LABEL", "CLOSE_LOOPS", "OWNER_BOTTLENECK", "MONEY", "OTHER"];
function rankItems(items: MotionItem[]): MotionItem[] {
  const best = (i: MotionItem) => Math.min(...i.sections.map((s) => SECTION_RANK.indexOf(s)));
  // inside a level: what is still ahead comes first (nearest first), then what already passed (most recent first) — a long-passed
  // date is likely stale, not the most urgent; undated last
  const dk = (d: number | null) => (d === null ? 10_000 : d >= 0 ? d : 1_000 - d);
  return [...items].sort((a, b) => lv(a.level) - lv(b.level)
    || dk(a.daysTo) - dk(b.daysTo)
    || Number(b.labelProtected) - Number(a.labelProtected)
    || best(a) - best(b)
    || a.titleHe.localeCompare(b.titleHe, "he"));
}

const ilDay = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));

// ───────────────────────────── the build ─────────────────────────────

export function buildMotion(src: GatewaySources, c: CooCtx, input: MotionInput): BusinessMotion {
  const today = c.today;
  const H = MOTION_HEURISTICS;
  const map = new Map<string, MotionItem>();
  const unchecked: string[] = [...input.readiness.unchecked];
  const name = (pid: string) => c.projectName(pid) ?? "פרויקט";
  const protectedIds = OWNER_LABEL_ARTIST_IDS;
  const projectsOfArtist = new Map<string, Set<string>>();
  for (const a of input.artists) projectsOfArtist.set(a.key, new Set(a.projects.map((p) => p.key)));
  const protectedProject = (pk: string) => input.artists.some((a) => protectedIds.has(a.key.slice("label-artist:".length)) && projectsOfArtist.get(a.key)?.has(pk));
  const completed = new Set<string>();

  // ── WEEK: capacity (an opportunity signal only — never work hours, never an obligation, never scheduling) ──
  const end = addDaysYmd(today, INTERNAL_COO_HEURISTICS.scheduleDays - 1);
  const days = dayList(today, end);
  const recordedByDay = new Map(input.schedule.days.map((d) => [d.date, d.items.filter((i) => i.source === "REDBLOODS").length]));
  let capacity: CapacityState = "UNKNOWN";
  const openDays: string[] = [];
  let heavyToday = false;
  if (c.calReadable && c.cal) {
    const av = availability(c.cal.events, days, c.cal.status as Parameters<typeof availability>[2]);
    for (const d of av) {
      if (d.status !== "KNOWN" || d.occupiedMinutes === null) continue;
      const allDayBlock = d.allDay.some((x) => x.blocksTime);
      if (d.date === today && d.occupiedMinutes >= INTERNAL_COO_HEURISTICS.heavyDayBusyMinutes) heavyToday = true;
      if (!allDayBlock && d.occupiedMinutes <= H.openDayMaxBusyMinutes && (recordedByDay.get(d.date) ?? 0) === 0) openDays.push(d.date);
    }
    const heavy = input.schedule.days.filter((d) => d.heavy === true).length;
    capacity = av.some((d) => d.status !== "KNOWN") ? "UNKNOWN" : openDays.length >= H.openWeekMinDays ? "OPEN" : heavy >= INTERNAL_COO_HEURISTICS.heavyStretchDays ? "BUSY" : "NORMAL";
  } else unchecked.push(`היומן לא נקרא (${c.calStatus}) — לא אומרת שהשבוע פנוי`);


  // ── CLOSE LOOPS 1: done in the records, not recorded as done (payment alone never counts) ──
  for (const p of c.st?.domains.projects.data?.open ?? []) {
    const comp = completionEvidence(c, p.id);
    if (!comp?.complete) continue;
    const pk = `project:${p.id}`;
    completed.add(pk);
    const m = input.momentum.find((x) => x.key === pk);
    const dl = m?.deadlineDaysTo ?? null;
    const stale = m && m.state === "WAITING_EXTERNAL" ? `יש סתירה בין סימן ישן (${m.waitingOn.length ? "רשומה ביומן השליחות / מחזיק כדור קודם" : "מצב קודם"}) למצב הנוכחי — הרשומות הקנוניות לא שונו` : null;
    mergeInto(map, { key: `completion:${pk}`, entity: pk, level: "SHOULD", code: "COMPLETION_NOT_RECORDED", titleHe: name(p.id), reasonHe: comp.he!, daysTo: dl, labelWork: c.isLabel(p.id), labelProtected: protectedProject(pk),
      evidence: [{ source: "MIX", ref: pk, he: "engineer work אושר + final files (תשלום לבד לא נספר)", epistemic: "FACT" }], move: MOVES.completion() });
    if (stale) mergeInto(map, { key: `stale:${pk}`, entity: pk, level: "INFO", code: "STALE_SIGNAL_CONFLICT", titleHe: name(p.id), reasonHe: stale });
  }

  // ── commitments (readiness board): release / show / shoot / client deadline / session / meeting not ready ──
  for (const r of input.readiness.events) {
    if (r.state === "READY") continue;
    const pk = r.project;
    if (pk && completed.has(pk)) continue; // the work is done — an old signal is not a current risk
    const commitment = r.kind === "SHOOT" || r.kind === "SHOW" || r.kind === "RELEASE" || r.kind === "DEADLINE";
    const d = r.daysTo;
    const level: MotionLevel = r.state === "UNKNOWN" ? "WATCH" : r.state === "BLOCKED" ? "MUST" : commitment ? (d !== null && d <= H.mustDays ? "MUST" : "SHOULD") : d !== null && d <= 2 ? "SHOULD" : "WATCH";
    const stageCheck = r.checks.find((x) => x.id === "deps.stage" && x.state === "OPEN");
    const open = r.checks.filter((x) => x.state === "BLOCKED" || x.state === "OPEN" || (x.required && x.state === "NOT_SEEN")).map((x) => x.he);
    const pid = pk?.slice(8) ?? null;
    const isLabel = !!pid && c.isLabel(pid);
    mergeInto(map, { key: r.key, entity: pk ?? r.entity, level, code: stageCheck ? "STAGE_VS_DEADLINE" : "COMMITMENT_NOT_READY", titleHe: r.titleHe,
      reasonHe: `${r.kind === "RELEASE" ? "ריליס" : r.kind === "DEADLINE" ? "דדליין ללקוח" : r.kind === "SHOW" ? "הופעה" : r.kind === "SHOOT" ? "צילום" : r.kind === "SESSION" ? "סשן" : "פגישה"} ${d === 0 ? "היום" : d === 1 ? "מחר" : `בעוד ${d} ימים`} (${heDate(r.date)}) — ${r.stateHe}${open.length ? `: ${open.slice(0, 2).join(" ")}` : ""}`,
      daysTo: d, labelWork: isLabel, labelProtected: !!pk && protectedProject(pk),
      evidence: [{ source: "READINESS", ref: r.key, he: r.stateHe, epistemic: "DERIVED" }],
      move: stageCheck ? MOVES.stage(false) : r.kind === "RELEASE" ? MOVES.release() : r.kind === "DEADLINE" ? MOVES.stage(false) : null });
  }

  // ── recently overdue client deadlines (the board looks forward only) + one aggregate for long-overdue dates ──
  const longOverdue: string[] = [];
  for (const p of c.st?.domains.projects.data?.open ?? []) {
    const pk = `project:${p.id}`;
    const dl = p.deadline?.ymd ?? null;
    if (!isYmd(dl) || completed.has(pk)) continue;
    const d = daysBetween(today, dl);
    if (d >= 0) continue;
    const st = stageBehind(c, p.id);
    if (!st.status || ["הושלם", "בוטל", "בהשהייה"].includes(st.status)) continue;
    if (-d <= H.recentOverdueDays) {
      if (!st.behind && !engineerWorksOf(c, p.id).length) continue;
      mergeInto(map, { key: `overdue:${pk}`, entity: pk, level: "MUST", code: "STAGE_VS_DEADLINE", titleHe: name(p.id), heuristic: true, daysTo: d, labelWork: c.isLabel(p.id), labelProtected: protectedProject(pk),
        reasonHe: `הדדליין עבר לפני ${-d} ימים (${heDate(dl)})${st.behind ? ` — ${st.he}; השלב לא נראה מתקדם מספיק (${STAGE_UNCERTAINTY_HE})` : ""}`,
        evidence: [{ source: "PROJECTS", ref: pk, he: "deadline passed (lib/project-deadline semantics: a valid date before today)", epistemic: "FACT" }], move: MOVES.stage(true) });
    } else longOverdue.push(name(p.id));
  }
  if (longOverdue.length) mergeInto(map, { key: "long-overdue", entity: null, level: "WATCH", code: "LONG_OVERDUE_DEADLINES", titleHe: "דדליינים ישנים", heuristic: true,
    reasonHe: `${longOverdue.length} פרויקטים פתוחים עם דדליין שעבר לפני יותר מ-${H.recentOverdueDays} ימים (${longOverdue.slice(0, 3).join(", ")}${longOverdue.length > 3 ? "…" : ""}) — כנראה התאריך כבר לא משקף את התוכנית`, move: null });

  // ── CLOSE LOOPS 2: waiting for the mix, no engineer work open — one move moves the whole work ──
  for (const p of c.st?.domains.projects.data?.open ?? []) {
    if (p.status !== WAITING_FOR_MIX) continue;
    const pk = `project:${p.id}`;
    if (completed.has(pk) || engineerWorksOf(c, p.id).some((w) => !["אושר", "בוטל"].includes(w.status ?? ""))) continue;
    const v = c.project(p.id);
    const priced = (v.money?.price.agreed ?? null) !== null || !!v.money?.price.exception;
    const paid = (v.money?.song?.received ?? 0) > 0;
    const label = c.isLabel(p.id);
    mergeInto(map, { key: `tomix:${pk}`, entity: pk, level: priced || paid || label ? "SHOULD" : "WATCH", code: "ONE_MOVE_TO_MIX", titleHe: name(p.id), labelWork: label, labelProtected: protectedProject(pk),
      reasonHe: `מחכה למיקס ואין עבודת מיקס פתוחה${paid ? " (הלקוח כבר שילם)" : !priced ? " (וגם אין מחיר רשום)" : ""}`,
      evidence: [{ source: "PROJECTS", ref: pk, he: "status מחכה למיקס, no open engineer work", epistemic: "FACT" }], move: MOVES.toMix() });
  }

  // ── CLOSE LOOPS 3 / OWNER BOTTLENECK: a mix version waiting only for the Owner (engineerHandoff — the app's own rule) ──
  let mixWaiting = 0;
  for (const w of c.ops?.engineerWork?.rows ?? []) {
    if (!w.projectId || ["אושר", "בוטל"].includes(w.status ?? "")) continue;
    const pk = `project:${w.projectId}`;
    const ps = c.project(w.projectId).identity?.status ?? null;
    if (completed.has(pk) || !ps || ["הושלם", "בוטל", "בהשהייה"].includes(ps)) continue; // only a live project carries a move
    let h: ReturnType<typeof engineerHandoff> | null = null;
    try { h = engineerHandoff(src, { id: w.id, projectId: w.projectId, engineerName: w.engineerName, status: w.status, sentDate: w.sentDate }); } catch { h = null; }
    if (!h || h.state !== "WAITING_ON_OWNER") continue;
    mixWaiting++;
    mergeInto(map, { key: `mix-owner:${w.id}`, entity: pk, level: "SHOULD", code: "OWNER_ONE_ACTION", titleHe: name(w.projectId), labelWork: c.isLabel(w.projectId), labelProtected: protectedProject(pk),
      reasonHe: `${w.engineerName ?? "המהנדס"} העלה גרסה ואין פידבק שלך אחריה — רק אתה פותח את זה`,
      evidence: [{ source: "MIX", ref: `mix-work:${w.id}`, he: "engineerHandoff WAITING_ON_OWNER", epistemic: "DERIVED" }], move: MOVES.mixListen() });
  }

  // ── OWNER BOTTLENECK: Victor — extract only what business priority demands; the rest = ONE line ──
  const victorOwner = (c.st?.domains.victor.data?.active ?? []).filter((w) => w.ball?.holder === "owner");
  const extracted: string[] = [];
  for (const w of victorOwner) {
    if (!w.projectId) continue;
    const pk = `project:${w.projectId}`;
    const m = input.momentum.find((x) => x.key === pk);
    const relDays = m?.release?.daysTo ?? null;
    const dlDays = m?.deadlineDaysTo ?? null;
    const prot = protectedProject(pk);
    const nearRelease = relDays !== null && relDays >= 0 && relDays <= INTERNAL_COO_HEURISTICS.horizonDays;
    const nearDeadline = dlDays !== null && dlDays <= H.mustDays;
    if (!prot && !nearRelease && !nearDeadline) continue;
    extracted.push(`victor-work:${w.id}`);
    // a release / deadline this close → MUST; a release in the horizon → SHOULD; protected label alone → promoted ONE level only with capacity
    const level: MotionLevel = (relDays !== null && relDays >= 0 && relDays <= H.mustDays) || nearDeadline ? "MUST" : nearRelease ? "SHOULD" : capacity === "OPEN" ? "SHOULD" : "WATCH";
    const since = ymdOf(w.lastUploadAt);
    mergeInto(map, { key: `victor-owner:${w.id}`, entity: pk, level, code: "OWNER_BOTTLENECK_EXTRACT", titleHe: name(w.projectId), labelWork: c.isLabel(w.projectId), labelProtected: prot, daysTo: nearRelease ? relDays : nearDeadline ? dlDays : null,
      reasonHe: `ויקטור העלה גרסה${since ? ` ב-${heDate(since)}` : ""} ומחכה לפידבק שלך${nearRelease ? ` — והריליס ב-${heDate(m!.release!.target)}` : nearDeadline ? (dlDays! < 0 ? " — והדדליין כבר עבר" : " — והדדליין קרוב") : " — אמן לייבל מוגן"}`,
      evidence: [{ source: "TEAM_VICTOR", ref: `victor-work:${w.id}`, he: "computeVictorBall: owner", epistemic: "DERIVED" }], move: MOVES.victorNotes() });
  }
  const restCount = victorOwner.length - extracted.length;
  const ownerBottleneck = {
    extracted, victorWaiting: victorOwner.length, restCount, mixWaiting,
    lineHe: victorOwner.length ? `ויקטור: ${victorOwner.length} גרסאות מחכות לפידבק שלך${extracted.length ? ` (${extracted.length} מהן הוצאתי למעלה כי הן קשורות לריליס / לייבל / דדליין)` : ""}${restCount ? ` — לשאר ${restCount} הייתי קובעת בלוק האזנה מרוכז אחד, לא ${restCount} משימות` : ""}.` : null,
  };

  // ── needs_me: a partner action awaiting approval / a scheduled show missing something (the SAME curated list) ──
  {
    const nm = c.needsMe();
    if (!nm) unchecked.push("needs_me לא נקרא — אישורים / הופעות של היום לא נבדקו כאן (לא ידוע, לא ריק)");
    for (const n of nm?.items ?? []) {
      if (n.group !== "APPROVAL" && n.group !== "SCHEDULED") continue;
      const pk = n.open.kind === "project" ? `project:${n.open.id}` : null;
      mergeInto(map, { key: `needs:${n.key}`, entity: pk ?? n.entityKey, level: "MUST", code: "OWNER_APPROVAL_WAITING", titleHe: n.title, reasonHe: n.whyToday,
        evidence: [{ source: "NEEDS_ME", ref: n.key, he: n.group, epistemic: "DERIVED" }], move: null });
    }
  }

  // ── shoot sessions auto-marked: a passed date / AUTO_MARK never proves the shoot happened ──
  const SHOT_OR_LATER = new Set(["צולם", "חומרי גלם הועלו", "בעריכה", "נשלחה גרסה", "תיקונים", "מאושר", "פורסם"]);
  for (const p of c.ops?.redFilms?.rows ?? []) {
    if (!p.projectId || p.status === "בוטל" || SHOT_OR_LATER.has(p.status ?? "") || !isYmd(p.shootDate) || p.shootDate >= today) continue;
    const s = (c.det?.sessions?.rows ?? []).find((x) => x.projectId === p.projectId && x.date === p.shootDate && x.type === "צילום קליפ");
    const auto = s?.statusSource === "AUTO_MARK";
    mergeInto(map, { key: `shoot:${p.id}`, entity: `project:${p.projectId}`, level: "WATCH", code: "SHOOT_AUTO_MARKED", titleHe: name(p.projectId), epistemic: "HYPOTHESIS",
      reasonHe: `תאריך הצילום (${heDate(p.shootDate)}) עבר וההפקה עדיין "${p.status ?? "?"}"${auto ? " — הסשן סומן 'התקיים' אוטומטית, וזה לא הוכחה שצולם" : ""}`,
      evidence: [{ source: "RED_FILMS", ref: `video-production:${p.id}`, he: "shoot date passed, production status before 'צולם'", epistemic: "FACT" }], move: MOVES.shoot() });
  }

  // ── sessions held on a project still 'לא התחיל' + active client work with no price → a package, not separate alerts ──
  for (const m of input.momentum) {
    const pid = m.key.slice(8);
    if (completed.has(m.key)) continue;
    if (m.status === "לא התחיל" && m.lastProgress?.source === "SESSIONS") mergeInto(map, { key: `status:${m.key}`, entity: m.key, level: "WATCH", code: "STATUS_BEHIND_ACTIVITY", titleHe: m.name,
      reasonHe: `התקיימו סשנים (אחרון ${heDate(m.lastProgress.date)}) והסטטוס עדיין "לא התחיל"`, move: MOVES.status() });
    const v = c.project(pid);
    if (!c.isLabel(pid) && v.identity?.businessType === "לקוח" && v.money && v.money.price.agreed === null && !v.money.price.exception && m.lastProgress)
      mergeInto(map, { key: `price:${m.key}`, entity: m.key, level: "WATCH", code: "PRICE_MISSING", titleHe: m.name, reasonHe: "העבודה מתקדמת ואין מחיר מוסכם רשום", move: MOVES.price([]) });
    if (m.state === "NO_NEXT_STEP" && m.labelWork && !protectedProject(m.key)) mergeInto(map, { key: `nonext:${m.key}`, entity: m.key, level: "WATCH", code: "NO_NEXT_STEP", titleHe: m.name, labelWork: true, reasonHe: "אין צעד הבא רשום או סשן המשך", move: MOVES.session("") });
    else if (m.state === "NO_NEXT_STEP") mergeInto(map, { key: `nonext:${m.key}`, entity: m.key, level: "INFO", code: "NO_NEXT_STEP", titleHe: m.name, reasonHe: "אין צעד הבא רשום", move: MOVES.session("") });
    if (m.state === "OWNER_BALL" && !map.get(m.key)?.codes.some((x) => x === "OWNER_ONE_ACTION" || x === "OWNER_BOTTLENECK_EXTRACT")) mergeInto(map, { key: `ownerball:${m.key}`, entity: m.key, level: "WATCH", code: "OWNER_BALL", titleHe: m.name, labelWork: m.labelWork, reasonHe: "לפי הרשומות משהו כאן מחכה לך", move: null });
    // the Owner SAID it waits on him while the records do not show it (Owner decision 2026-10-05): his statement, never "לפי הרשומות"
    if (m.ownerSaid) mergeInto(map, { key: `ownersaid:${m.key}`, entity: m.key, level: "WATCH", code: "OWNER_SAID_WAITING", titleHe: m.name, labelWork: m.labelWork, epistemic: "HYPOTHESIS",
      reasonHe: m.ownerSaid.he, evidence: [{ source: "OWNER_KNOWLEDGE", ref: m.key, he: m.ownerSaid.he, epistemic: "OWNER_REPORTED" }], move: null });
  }

  // ── schedule conflicts (real, two blocking timed commitments) ──
  for (const f of input.schedule.findings) {
    if (f.kind !== "CONFLICT") continue;
    const d = f.date ? daysBetween(today, f.date) : null;
    mergeInto(map, { key: `conflict:${f.evidence.join("|")}`, entity: null, level: d !== null && d <= 2 ? "MUST" : "SHOULD", code: "SCHEDULE_CONFLICT", titleHe: "חפיפה ביומן", reasonHe: f.he, daysTo: d, move: MOVES.conflict() });
  }

  // ── the Owner's own words: an exactly LINKED new update raises its record one level; "עוד 2 תיקונים" = near (hypothesis) ──
  const tri = inboxTriageOf(src);
  // absorbed (rule A) = a move USES the update as evidence; same project alone is never enough (Owner, 2026-10-05)
  const absorbed = new Map<string, string>(); // update id → the move key that carries it
  for (const { item, lifecycle } of tri.items) {
    if (lifecycle.entitySource !== "LINKED") continue;
    for (const k of lifecycle.entityKeys.filter((x) => x.startsWith("project:"))) {
      const quote = `כתבת (${heDate(ymdOf(item.createdAt))}): «${item.body.slice(0, 70)}»`;
      if (ALMOST_RE.test(item.body)) mergeInto(map, { key: `near:${item.id}:${k}`, entity: k, level: "SHOULD", code: "OWNER_REPORTED_NEAR", titleHe: name(k.slice(8)), epistemic: "HYPOTHESIS",
        reasonHe: `${quote} — לפי מה שכתבת נשאר מעט (השערה, לא סטטוס)`, evidence: [{ source: "OWNER_INBOX", ref: `owner-inbox:${item.id}`, he: "OWNER_REPORTED", epistemic: "OWNER_REPORTED" }], move: null });
      const prev = map.get(k);
      if (!prev) continue;
      if (!prev.codes.includes("OWNER_UPDATE_LINKED")) {
        prev.level = raise(prev.level);
        prev.codes.push("OWNER_UPDATE_LINKED");
        prev.reasonsHe.push(quote);
        prev.he = lineOf(prev);
      }
      if (!prev.evidence.some((e) => e.ref === `owner-inbox:${item.id}`)) prev.evidence.push({ source: "OWNER_INBOX", ref: `owner-inbox:${item.id}`, he: "an exactly linked NEW update — raises the record one level", epistemic: "OWNER_REPORTED" });
      absorbed.set(item.id, prev.key);
    }
  }

  // ── "after X" in an Owner blocker + X visibly passed in the calendar (holiday events) → follow-up HYPOTHESIS ──
  const okn = ok(src.ownerKnowledge) as OwnerKnowledgeRecord[] | null;
  const knowledge = okn ? activeKnowledge(okn, today) : [];
  const holidays = c.calReadable ? (c.cal?.events ?? []).filter((e) => e.holidayCalendar && e.allDay && e.title) : [];
  for (const k of knowledge) {
    if (k.kind !== "PROJECT_BLOCKER" || !k.subjectKey.startsWith("project:")) continue;
    const detail = String((k.value as { detail?: unknown }).detail ?? "");
    const m = /אחרי\s+([֐-׿]{2,})/.exec(detail);
    if (!m) continue;
    const word = normalizeName(m[1]);
    const learned = ymdOf(k.createdAt) ?? "0000-00-00";
    const passed = holidays.filter((e) => normalizeName(e.title ?? "").split(" ").includes(word) && e.end <= today && e.start >= learned).sort((a, b) => b.end.localeCompare(a.end))[0];
    if (!passed) continue;
    mergeInto(map, { key: `after:${k.id}`, entity: k.subjectKey, level: "SHOULD", code: "FOLLOW_UP_AFTER_CONDITION", titleHe: name(k.subjectKey.slice(8)), epistemic: "HYPOTHESIS",
      reasonHe: `אמרת (${heDate(learned)}): «${detail.slice(0, 80)}» — לפי היומן ${m[1]} כבר עבר (${heDate(addDaysYmd(passed.end, -1))}); כנראה זה הזמן לחזור לזה (השערה)`,
      evidence: [{ source: "OWNER_KNOWLEDGE", ref: k.id, he: "OWNER_REPORTED blocker", epistemic: "OWNER_REPORTED" }, { source: "CALENDAR", ref: passed.id, he: "holiday calendar event ended", epistemic: "FACT" }], move: MOVES.followUp() });
  }

  // ── LABEL: protected artists (Shalev, Avi) — promoted ONE level only, MUST only with a near commitment; no cadence ──
  const labelItems: MotionItem[] = [];
  for (const a of input.artists) {
    const isProtected = protectedIds.has(a.key.slice("label-artist:".length));
    if (!a.projects.length || a.upcomingSessions > 0) continue;
    // projects already carried by a MUST item stay there (one move per record); the rest feed the artist's motion
    const busy = (k: string) => { const x = map.get(k); return !!x && (x.level === "MUST" || x.sections.includes("CLOSE_LOOPS") || x.sections.includes("AT_RISK")); };
    // label motion = the artist's LABEL projects only (a guest spot on a client project is that client's work)
    const free = a.projects.filter((p) => p.labelWork && (p.state === "NO_NEXT_STEP" || p.state === "OWNER_BALL") && !busy(p.key));
    if (!free.length) continue;
    const base: MotionLevel = "WATCH";
    const level: MotionLevel = isProtected && capacity === "OPEN" ? raise(base) : base;
    const blocker = knowledge.find((k) => k.kind === "PROJECT_BLOCKER" && free.some((p) => p.key === k.subjectKey));
    const owner = free.filter((p) => p.state === "OWNER_BALL").map((p) => p.name);
    const nostep = free.filter((p) => p.state === "NO_NEXT_STEP").map((p) => p.name);
    const lastShow = lastShowOf(c, a.name);
    const reason = [owner.length ? `מחכה לך: ${owner.join(", ")}` : null, nostep.length ? `בלי צעד הבא: ${nostep.slice(0, 3).join(", ")}` : null, "אין סשן מתוכנן",
      blocker ? `אמרת: «${String((blocker.value as { detail?: unknown }).detail ?? blocker.meaningHe).slice(0, 70)}»` : null, lastShow ? `הופעה אחרונה ${heDate(lastShow)} (פעילות, לא תנועה במוזיקה)` : null].filter(Boolean).join(" · ");
    const focus = free.find((p) => p.key === blocker?.subjectKey) ?? free.find((p) => p.state === "OWNER_BALL") ?? free[0];
    const victorFirst = focus.state === "OWNER_BALL" && (c.st?.domains.victor.data?.active ?? []).some((w) => `project:${w.projectId}` === focus.key && w.ball?.holder === "owner");
    const move = victorFirst ? mergeMoves(MOVES.victorNotes(), MOVES.session(focus.name)) : MOVES.session(focus.name);
    const item = toItem({ key: `label:${a.key}`, entity: a.key, level, code: "LABEL_NEEDS_MOTION", titleHe: a.name, reasonHe: reason, labelWork: true, labelProtected: isProtected, move, entities: [a.key, ...free.map((p) => p.key)],
      evidence: [{ source: "LABEL_ARTISTS", ref: a.key, he: "rosterCare: no upcoming session + projects without a next step / waiting on the Owner (no cadence rule)", epistemic: "DERIVED" }] });
    // absorb the artist's non-MUST project items (one move per artist, not one per alert)
    for (const p of free) {
      const prev = map.get(p.key);
      if (!prev) continue;
      map.delete(p.key);
      for (const r of prev.reasonsHe) if (!item.reasonsHe.includes(r) && !/^אין צעד הבא רשום/.test(r)) item.reasonsHe.push(r);
      for (const cd of prev.codes) if (!item.codes.includes(cd)) item.codes.push(cd);
      for (const s of prev.sections) if (!item.sections.includes(s)) item.sections.push(s);
      if (lv(prev.level) < lv(item.level)) { item.level = prev.level; item.move = mergeMoves(prev.move, item.move); }
    }
    item.he = lineOf(item);
    map.set(item.key, item);
    labelItems.push(item);
  }

  // ── MONEY / PIPELINE: commercial gap (never a goal that conflicts as the driver) ──
  const fin = (ok(src.finance) as { state?: PartnerFinanceState } | null)?.state ?? null;
  const goalConflict = KNOWLEDGE_GAPS.some((g) => (g.id === "RP_FINANCE_TARGETS_CONFLICT" || g.id === "RP_CODE_GOALS_VS_OWNER_TARGET") && g.status === "CONFLICT_REQUIRES_OWNER_DECISION");
  const unpriced = (c.st?.domains.projects.data?.open ?? []).filter((p) => {
    if (c.isLabel(p.id) || ["הושלם", "בוטל", "בהשהייה"].includes(p.status)) return false;
    const v = c.project(p.id);
    return v.identity?.businessType === "לקוח" && !!v.money && v.money.price.agreed === null && !v.money.price.exception;
  });
  const progressed = unpriced.filter((p) => input.momentum.find((m) => m.key === `project:${p.id}`)?.lastProgress);
  let revenue: BusinessMotion["revenue"] = { state: "UNKNOWN", goalConflict, lineHe: null, unpricedActive: unpriced.length };
  if (fin?.realized && Array.isArray(fin.receivables)) {
    const recv = fin.receivables.filter((r) => !["SETTLED", "NOT_COLLECTIBLE"].includes(r.collection?.state ?? "")).length;
    const proposals = fin.proposalPipeline?.openCount ?? 0;
    const shows14 = (c.st?.domains.shows.data?.items ?? []).filter((s) => s.status !== "בוטל" && s.dealType !== "UNPAID_COLLAB" && isYmd(s.dateYmd) && s.dateYmd >= today && daysBetween(today, s.dateYmd) <= INTERNAL_COO_HEURISTICS.horizonDays).length;
    const net = fin.realized.ils?.net ?? null;
    const empty = recv === 0 && proposals === 0 && shows14 === 0;
    const netHe = typeof net === "number" ? `נטו רשום החודש ₪${Math.round(net).toLocaleString("en-US")}` : null;
    const goalHe = goalConflict ? "יש לי יעדים שונים ברשומות (ברוטו בקוד מול נטו שלך) — אני לא משתמשת בהם לקביעת עדיפות עד שתכריע" : null;
    revenue = { state: empty ? "PIPELINE_EMPTY" : "PIPELINE_OPEN", goalConflict, unpricedActive: unpriced.length,
      lineHe: [empty ? "אין כרגע כסף פתוח לגבייה, אין הצעות פתוחות ואין הופעות ב-14 הימים הקרובים" : `פתוח: ${recv} לגבייה · ${proposals} הצעות · ${shows14} הופעות ב-14 יום`, netHe, unpriced.length ? `${unpriced.length} פרויקטי לקוח פעילים בלי מחיר` : null, goalHe].filter(Boolean).join(" · ") };
    if (empty || progressed.length) {
      const names = (progressed.length ? progressed : unpriced).map((p) => p.name);
      mergeInto(map, { key: "revenue", entity: null, level: empty ? "SHOULD" : "WATCH", code: empty ? "REVENUE_PIPELINE_EMPTY" : "PRICE_MISSING", titleHe: "כסף נכנס", entities: (progressed.length ? progressed : unpriced).slice(0, 5).map((p) => `project:${p.id}`),
        reasonHe: revenue.lineHe!, evidence: [{ source: "FINANCE", ref: null, he: "Finance Brain: receivables / proposal pipeline / shows / price coverage", epistemic: "DERIVED" }],
        move: names.length ? MOVES.price(names) : null });
    }
  } else unchecked.push("מצב הכספים לא נקרא — הצנרת המסחרית לא נבדקה");
  // the per-project price items are now carried by the revenue line (one commercial move, not N alerts)
  for (const [k, it] of map) if (it.codes.length === 1 && it.codes[0] === "PRICE_MISSING" && it.entity) map.delete(k);

  // ── FINANCIAL_FORWARD (an input): obligations the Owner is not prepared for enter as moves; prepared ones stay quiet ──
  let ff: FinancialForward | null = null;
  try { ff = buildFinancialForward(src, c); } catch { unchecked.push("התמונה הכספית קדימה לא חושבה — לא ידוע, לא ריק"); }
  const finMove = (o: Obligation): MotionMove | null => o.kind === "VENDOR_PAYABLE" ? mv(o.questionHe ?? "לקבוע מתי משלמים", ["RECORD_ENGINEER_PAYMENT"])
    : o.kind === "RECURRING" ? mv(o.questionHe ?? "לתכנן את התשלום", ["RECORD_VICTOR_SALARY_MONTH"])
    : o.kind === "SETTLEMENT" ? mv(o.questionHe ?? "להחליט על ההתחשבנות", ["ADD_LEDGER_ENTRY", "CLOSE_BALANCE_CYCLE"])
    : o.questionHe ? mv(o.questionHe, []) : null;
  for (const o of ff?.obligations ?? []) {
    if (o.level !== "MUST" && o.level !== "SHOULD") continue;
    const key = `fin:${o.key}`;
    map.set(key, { ...toItem({ key, entity: o.entity, level: o.level, code: "FIN_OBLIGATION", titleHe: o.titleHe, reasonHe: o.he.slice(o.titleHe.length + 2).replace(/ → [^→]*$/, ""), daysTo: o.daysTo, heuristic: false,
      evidence: [{ source: "FINANCE", ref: o.key, he: `${o.strength} · ${o.timing} · ${o.provenance}`, epistemic: o.dynamic ? "DERIVED" : "FACT" }], move: finMove(o), labelProtected: false }), financial: true });
  }
  for (const d of ff?.duplicates ?? []) mergeInto(map, { key: `fin-dup:${d.key}`, entity: d.canonical.startsWith("project:") ? d.canonical : null, level: "WATCH", code: "FIN_DUPLICATE", titleHe: "רשומה כפולה אפשרית", reasonHe: d.he, move: null });

  // ── one client = one move: several projects of the SAME client that each need the mix → ONE package ──
  const groups = new Map<string, MotionItem[]>();
  for (const it of map.values()) {
    if (!it.entity?.startsWith("project:") || !it.codes.every((cd) => ["ONE_MOVE_TO_MIX", "STAGE_VS_DEADLINE", "OWNER_UPDATE_LINKED", "PRICE_MISSING", "STATUS_BEHIND_ACTIVITY", "NO_NEXT_STEP", "OWNER_BALL"].includes(cd)) || !it.codes.some((cd) => cd === "ONE_MOVE_TO_MIX" || cd === "STAGE_VS_DEADLINE")) continue;
    const artist = c.project(it.entity.slice(8)).identity?.artistText ?? "";
    const credits = artist.split(/[,،;]/).map((x) => normalizeName(x)).filter(Boolean);
    if (credits.length !== 1) continue;
    groups.set(credits[0], [...(groups.get(credits[0]) ?? []), it]);
  }
  for (const [, its] of groups) {
    if (its.length < 2) continue;
    const artistName = c.project(its[0].entity!.slice(8)).identity?.artistText ?? "";
    const level = its.reduce<MotionLevel>((l, i) => maxLevel(l, i.level), "INFO");
    const g: MotionItem = { key: `client:${its.map((i) => i.entity).join("+")}`, entity: its[0].entity, entities: its.flatMap((i) => i.entities), level, codes: [...new Set(its.flatMap((i) => i.codes))], sections: [...new Set(its.flatMap((i) => i.sections))],
      titleHe: `${artistName}: ${its.map((i) => i.titleHe).join(" + ")}`, reasonsHe: its.map((i) => `${i.titleHe} — ${i.reasonsHe[0]}`), evidence: its.flatMap((i) => i.evidence),
      move: mv(`לשלוח את ${its.length === 2 ? "שניהם" : `כל ה-${its.length}`} למיקס יחד (מהלך אחד ללקוח אחד)`, ["CREATE_ENGINEER_WORK"]), epistemic: "DERIVED", daysTo: its.reduce<number | null>((d, i) => (i.daysTo !== null && (d === null || i.daysTo < d) ? i.daysTo : d), null),
      labelWork: its.some((i) => i.labelWork), labelProtected: its.some((i) => i.labelProtected), heuristic: its.some((i) => i.heuristic), he: "" };
    g.he = lineOf(g);
    for (const i of its) map.delete(i.entity!);
    map.set(g.key, g);
  }

  // ── rank + sections ──
  const all = rankItems([...map.values()]);
  const act = all.filter((i) => i.level === "MUST" || i.level === "SHOULD");
  const todayItems = act.slice(0, H.todayMax);
  const greeting = act.filter((i) => !i.financial).slice(0, heavyToday ? 1 : H.greetingMoves);
  const atRisk = all.filter((i) => i.sections.includes("AT_RISK")).slice(0, 8);
  const closeLoops = all.filter((i) => i.sections.includes("CLOSE_LOOPS")).slice(0, 8);
  const watch = all.filter((i) => i.level === "WATCH").slice(0, 10);

  // the capacity opportunity: only when the week is relatively open AND real work needs it
  const NEED: MotionCode[] = ["LABEL_NEEDS_MOTION", "ONE_MOVE_TO_MIX", "OWNER_ONE_ACTION", "OWNER_BOTTLENECK_EXTRACT", "STAGE_VS_DEADLINE", "COMMITMENT_NOT_READY", "COMPLETION_NOT_RECORDED"];
  // what would USE the open time — moves beyond the greeting first (label sessions, opening a mix, closing loops), else the greeting ones
  const needy = capacity === "OPEN" ? all.filter((i) => (i.level === "MUST" || i.level === "SHOULD") && i.codes.some((cd) => NEED.includes(cd))) : [];
  const gk = new Set(greeting.map((g) => g.key));
  // a protected label artist (Shalev / Avi) with a concrete move is always represented in the open week (no cadence — only its existing move)
  const inWeekLine = new Set(labelItems.filter((i) => i.labelProtected).map((i) => i.key)); // named with their move in the week line itself
  const protectedMoves = needy.filter((i) => i.labelProtected && i.move && !gk.has(i.key) && !inWeekLine.has(i.key));
  const pool = needy.filter((i) => !inWeekLine.has(i.key));
  const candidates = [...new Set([...protectedMoves, ...pool.filter((i) => !gk.has(i.key)), ...pool.filter((i) => gk.has(i.key))])].slice(0, Math.max(3, protectedMoves.length));
  const finPressure = !!ff && ff.commercialGap && ff.surprises.length > 0;
  const opportunity = candidates.length ? { he: `השבוע יחסית פתוח ביומן (${openDays.length} ימים כמעט פנויים) — הייתי מנצלת חלון ל: ${candidates.map((i) => (i.move ? `${i.titleHe} → ${i.move.he}` : i.titleHe)).join(" · ")}${finPressure ? "; ובמקביל — הצנרת חלשה מול ההתחייבויות הרשומות, אז חלק מהחלון כדאי לתמחור / גבייה" : ""} (הצעה בלבד — לא קובעת כלום ביומן, ולא כל זמן פנוי הוא זמן עבודה)`, candidates: candidates.map((i) => i.key), epistemic: "HYPOTHESIS" as const } : null;
  const recordedEvents = input.schedule.days.reduce((n, d) => n + d.items.filter((i) => i.source === "REDBLOODS").length, 0);
  const dueThisWeek = input.readiness.events.filter((r) => r.daysTo !== null && r.daysTo <= 6 && (r.kind === "RELEASE" || r.kind === "DEADLINE" || r.kind === "SHOW" || r.kind === "SHOOT")).map((r) => `${r.kind === "RELEASE" ? "ריליס" : r.kind === "DEADLINE" ? "דדליין" : r.kind === "SHOW" ? "הופעה" : "צילום"} ${r.titleHe} ${heDate(r.date)}`);
  const protectedItems = labelItems.filter((i) => i.labelProtected);
  const protectedLabel = protectedItems.map((i) => i.titleHe);
  const protectedLabelHe = protectedItems.map((i) => (i.move ? `${i.titleHe} → ${i.move.he}` : `${i.titleHe} בלי סשן`)).join(" · ");
  const external = input.momentum.filter((m) => m.state === "WAITING_EXTERNAL" && !completed.has(m.key)).length;
  const capHe = capacity === "OPEN" ? `${openDays.length} ימים כמעט פנויים ביומן` : capacity === "BUSY" ? "שבוע עמוס ביומן" : capacity === "NORMAL" ? "שבוע רגיל ביומן" : "היומן לא נקרא — לא יודעת כמה השבוע פנוי";
  const week: MotionWeek = {
    start: today, end, calendarStatus: c.calStatus, capacity, openDays, heavyToday, recordedEvents, dueThisWeek,
    label: protectedLabel.length ? `לייבל: ל${protectedLabel.join(" ול")} אין סשן מתוכנן ויש עבודה שמחכה לצעד` : null,
    money: revenue.state === "PIPELINE_EMPTY" ? "כסף: הצנרת ריקה (אין גבייה פתוחה / הצעות / הופעות קרובות)" : null,
    external, opportunity,
    lineHe: [`(${heDate(today)}–${heDate(end)}) ${capHe}${recordedEvents ? `, ${recordedEvents === 1 ? "אירוע אחד רשום" : `${recordedEvents} אירועים רשומים`} ב-Redbloods` : ", בלי סשנים / הופעות / צילומים רשומים"}`,
      dueThisWeek.length ? dueThisWeek.slice(0, 3).join(", ") : null, protectedItems.length ? `לייבל: ${protectedLabelHe}` : null,
      revenue.state === "PIPELINE_EMPTY" ? "הצנרת המסחרית ריקה" : null, external ? (external === 1 ? "עבודה אחת אצל אחרים" : `${external} עבודות אצל אחרים`) : null].filter(Boolean).join(" · "),
  };

  // absorbed (rule B) = a move on the update's exact entity whose PROPOSED MOVE covers every business topic the update
  // names (mix / session / feedback / delivery). LIKELY stays a hypothesis: the move gets a "כנראה" reason, nothing is linked.
  for (const { item, lifecycle } of tri.items) {
    if (absorbed.has(item.id) || lifecycle.state === "NEEDS_OWNER" || lifecycle.entitySource === "NONE" || lifecycle.technical) continue;
    const topics = updateTopics(item.body);
    if (!topics.length) continue;
    const it = [...map.values()].find((m) => m.move && lifecycle.entityKeys.some((k) => m.entity === k || m.entities.includes(k)) && topics.every((t) => m.move!.actionIds.some((a) => TOPIC_ACTIONS[t].includes(a))));
    if (!it) continue;
    const likely = lifecycle.entitySource !== "LINKED";
    if (!it.evidence.some((e) => e.ref === `owner-inbox:${item.id}`)) {
      it.evidence.push({ source: "OWNER_INBOX", ref: `owner-inbox:${item.id}`, he: likely ? "a LIKELY update (not linked) whose meaning this move covers — a hypothesis" : "a linked update whose meaning this move covers", epistemic: likely ? "HYPOTHESIS" : "OWNER_REPORTED" });
      it.reasonsHe.splice(1, 0, `${likely ? "כנראה זה גם מה שכתבת" : "זה גם מה שכתבת"} (${heDate(ymdOf(item.createdAt))}): «${item.body.slice(0, 50)}»`);
      it.he = lineOf(it);
    }
    absorbed.set(item.id, it.key);
  }

  // the move that finally carries the update (a client package may have merged the record it first raised)
  // — and only a move Sunny actually SERVES counts (an INFO move nobody sees would hide the update again)
  const served = new Set([...todayItems, ...greeting, ...atRisk, ...closeLoops, ...labelItems, ...watch].map((i) => i.key));
  const carrier = (id: string) => {
    if (!absorbed.has(id)) return null;
    const k = all.find((i) => i.evidence.some((e) => e.ref === `owner-inbox:${id}`))?.key ?? absorbed.get(id)!;
    return served.has(k) ? k : null;
  };
  const inbox = motionInboxOf(tri.read, tri.items.map(({ lifecycle }) => motionInboxEntry(lifecycle, carrier(lifecycle.itemId))));

  let pats: DerivedPattern[] = [];
  try { pats = derivePatterns(src).filter((p) => p.showToOwner); } catch { pats = []; }

  // the later recorded progress per move entity (the ONE since rule) — the connector's learning input
  const progress: Record<string, SinceEvent[]> = {};
  for (const i of all.filter((x) => x.level !== "INFO")) for (const e of i.entities) if (e.startsWith("project:") && !progress[e]) {
    try { progress[e] = projectProgressEvents(src, e.slice(8)).slice(-5); } catch { /* unreadable → no progress claimed */ }
  }

  const m: BusinessMotion = {
    today, todayItems, greeting, more: Math.max(0, act.length - todayItems.length), atRisk, closeLoops, ownerBottleneck, label: labelItems, revenue, week, inbox, watch, all,
    patterns: pats.map((p) => ({ code: p.code, level: p.level, he: p.hypothesisHe })), progress,
    financial: ff ? { status: ff.status, lineHe: ff.lineHe, coverageHe: ff.coverageHe, surprises: ff.surprises.map((o) => o.he), datedSurprises: ff.surprises.filter((o) => o.date).map((o) => o.he), undatedSurprises: ff.surprises.filter((o) => !o.date).map((o) => o.he), decided: ff.obligations.filter((o) => o.preparedness === "DECIDED" && o.decision).map((o) => `${o.titleHe} ${o.he.slice(o.titleHe.length + 2).split(" · ")[0]} — ${o.decision!.he}`), duplicates: ff.duplicates.map((d) => d.he), unitsHe: ff.unitsHe, windows: ff.windows, commercialGap: ff.commercialGap } : null,
    learning: { status: "NOT_READ", changed: 0, noteHe: "היסטוריית הפעולות לא נקראה כאן — ההמלצות לא נבדקו מול מה שכבר נוסה (זה לא אומר שכלום לא נוסה)" },
    unchecked: [...new Set(unchecked)], heuristics: MOTION_HEURISTICS, answerHe: "",
  };
  m.answerHe = motionAnswerHe(m);
  return m;
}

function lastShowOf(c: CooCtx, artistName: string): string | null {
  const clients = new Map((c.st?.domains.clients.data?.items ?? []).map((x) => [x.id, x.name]));
  const n = normalizeName(artistName);
  return (c.st?.domains.shows.data?.items ?? []).filter((s) => s.status === "בוצע" && isYmd(s.dateYmd) && s.dateYmd <= c.today && s.artistClientId && normalizeName(clients.get(s.artistClientId) ?? "") === n)
    .map((s) => s.dateYmd!).sort().at(-1) ?? null;
}

/** The executive Hebrew answer: ≤3 moves + the week line + the inbox line — never a dump, never "במה נתחיל?". */
export interface MotionAnswerInput { greeting: ReadonlyArray<{ he: string; titleHe?: string; move?: { he: string; canAct?: boolean } | null }>; week: Pick<MotionWeek, "lineHe" | "heavyToday" | "opportunity">; ownerBottleneck: { lineHe: string | null }; inbox: { lineHe: string | null }; more: number;
  financial?: { surprises: string[]; datedSurprises?: string[]; undatedSurprises?: string[]; decided?: string[]; coverageHe: string } | null }

/** Money in the greeting: dated and undated are never under one heading (an undated payable is never "due" on a date). */
function moneyLineHe(f: { surprises: string[]; datedSurprises?: string[]; undatedSurprises?: string[]; decided?: string[]; coverageHe: string }): string {
  const dated = f.datedSurprises ?? f.surprises, undated = f.undatedSurprises ?? [], decided = f.decided ?? [];
  // what he already decided is said as his decision (when / on what condition) — never asked again
  const parts = [dated.length ? `עם תאריך: ${dated.slice(0, 2).join(" · ")}` : null, undated.length ? `בלי תאריך: ${undated.slice(0, 1).join(" · ")}` : null, decided.length ? `כבר החלטת: ${decided.slice(0, 2).join(" · ")}` : null].filter(Boolean);
  return `מבחינת כסף — ${parts.join(" | ")} (${f.coverageHe})`;
}

/** The COO leads: motion already ranked the first move — recommend it; only its EXECUTION needs the Boss's approval. */
function leadHe(first: MotionAnswerInput["greeting"][number] | undefined): string | null {
  if (!first || !first.titleHe) return null;
  return `אני הייתי מתחילה ב${first.titleHe}${first.move ? ` — ${first.move.he}` : ""}.${first.move?.canAct ? " אם תאשר, אכין את זה לאישור שלך." : ""}`;
}

export function motionAnswerHe(m: MotionAnswerInput): string {
  const n = m.greeting.length;
  const head = n === 0 ? "לא רואה כרגע מהלך שחייב אותך היום." : n === 1 ? (m.week.heavyToday ? "היום עמוס ביומן — מהלך אחד שהייתי עושה:" : "המהלך שהייתי עושה עכשיו:") : `${n === 2 ? "שני" : "שלושת"} המהלכים שהייתי עושה עכשיו:`;
  const lines = m.greeting.map((i, k) => `${k + 1}. ${i.he}`);
  const extra = [
    `השבוע: ${m.week.lineHe}`,
    // ONE money line — only what could surprise him (MUST / SHOULD, not prepared); never an accounting dump
    m.financial && (m.financial.surprises.length || m.financial.decided?.length) ? moneyLineHe(m.financial) : null,
    m.week.opportunity ? m.week.opportunity.he : null,
    m.ownerBottleneck.lineHe,
    m.inbox.lineHe,
    m.more ? `(ועוד ${m.more} מהלכים שכדאי השבוע — אפשר לפרט.)` : null,
    leadHe(m.greeting[0]),
  ].filter(Boolean);
  return [head, ...lines, ...extra].join("\n");
}

/** The shape learning needs from an item (a full MotionItem or the compact one partner_brief / coo carry). */
export interface LearnableItem { key: string; entities: string[]; codes: string[]; titleHe: string; reasonsHe: string[]; move: MotionMove | null; he: string; learning?: MotionItem["learning"] }

/**
 * Closed loop, level 2 (derived only — never policy): a planning move that ALREADY ran on the same record and did not
 * move the work (DID_NOT_RESOLVE / CONTRADICTED with no progress after) is not proposed again by default — the move
 * becomes "check the blocker / the next concrete move". INSUFFICIENT_EVIDENCE and un-executed plans change nothing.
 */
export function learnItem<T extends LearnableItem>(i: T, assessments: readonly OutcomeAssessment[]): T {
  const tried = assessments.filter((a) => a.meaning === "PLANNING" && (a.level === "DID_NOT_RESOLVE" || a.level === "CONTRADICTED") && i.entities.includes(a.entity));
  if (!tried.length || !i.move) return i;
  const planning = i.move.actionIds.includes("UPDATE_PROJECT_DEADLINE") || i.codes.includes("STAGE_VS_DEADLINE");
  if (!planning) return i;
  const actionIds = i.move.actionIds.filter((x) => x !== "UPDATE_PROJECT_DEADLINE");
  const learningHe = `תכנון מחדש כבר נוסה כאן (${tried.map((a) => heDate(ymdOf(a.at))).join(", ")}) וזה לא הזיז את העבודה`;
  const move: MotionMove = { he: "לבדוק מה באמת חוסם ולקבוע מהלך קונקרטי אחד — לא להזיז שוב את התאריך", actionIds, canAct: actionIds.length > 0, approval: "OWNER_APPROVAL" };
  const reasonsHe = [...i.reasonsHe, `${learningHe} (השערה מתוך התוצאות, לא כלל)`];
  return { ...i, move, reasonsHe, learning: { changed: true, he: learningHe, planIds: tried.map((a) => a.planId) }, he: lineOf({ titleHe: i.titleHe, reasonsHe, move }) };
}

export function applyMotionLearning(m: BusinessMotion, assessments: readonly OutcomeAssessment[]): BusinessMotion {
  const all = m.all.map((i) => learnItem(i, assessments));
  const byKey = new Map(all.map((i) => [i.key, i]));
  const re = (xs: MotionItem[]) => xs.map((i) => byKey.get(i.key) ?? learnItem(i, assessments));
  const changed = all.filter((i) => i.learning?.changed).length;
  const out: BusinessMotion = { ...m, all, todayItems: re(m.todayItems), greeting: re(m.greeting), atRisk: re(m.atRisk), closeLoops: re(m.closeLoops), label: re(m.label), watch: re(m.watch),
    learning: learningNote(changed) };
  out.answerHe = motionAnswerHe(out);
  return out;
}
export const learningNote = (changed: number): BusinessMotion["learning"] => ({ status: "READ", changed,
  noteHe: changed ? `${changed} המלצות שונו כי מהלך תכנון כבר נוסה ולא הזיז את העבודה (השערה)` : "בדקתי מול מה שכבר בוצע — אין המלצה שחוזרת על מהלך שלא עבד" });

/** The priorities answer ("N דברים שהייתי סוגרת עכשיו") over motion items — prioritiesHe and the connector share it. */
export function prioritiesAnswerHe(items: ReadonlyArray<{ he: string }>, more: number): string {
  const n = items.length;
  const head = n === 1 ? "דבר אחד שהייתי סוגרת עכשיו:" : `${n === 2 ? "שני" : n === 3 ? "שלושה" : n === 4 ? "ארבעה" : "חמישה"} דברים שהייתי סוגרת עכשיו:`;
  return [head, ...items.map((p, i) => `${i + 1}. ${p.he}`), ...(more ? [`(ויש עוד ${more} — אפשר לפרט.)`] : [])].join("\n");
}

/** The compact motion object (the connector applies the Action-Layer learning to it; partner_brief carries the same object). */
export function motionSummary(m: BusinessMotion) {
  const slim = (i: MotionItem) => ({ key: i.key, entity: i.entity, entities: i.entities, level: i.level, codes: i.codes, he: i.he, titleHe: i.titleHe, reasonsHe: i.reasonsHe.slice(0, 4), move: i.move, daysTo: i.daysTo, labelProtected: i.labelProtected, epistemic: i.epistemic, learning: i.learning ?? null });
  return { today: m.today, answerHe: m.answerHe, greeting: m.greeting.map(slim), todayItems: m.todayItems.map(slim), more: m.more, atRisk: m.atRisk.map(slim), closeLoops: m.closeLoops.map(slim), label: m.label.map(slim), watch: m.watch.map(slim),
    ownerBottleneck: m.ownerBottleneck, revenue: m.revenue, week: m.week, inbox: m.inbox, patterns: m.patterns, financial: m.financial, progress: m.progress, learning: m.learning, unchecked: m.unchecked, heuristics: m.heuristics };
}
