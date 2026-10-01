/**
 * Sunny — NEEDS ME ("מה צריך ממני היום"). Owner decision 2026-10-01 (Q1–Q5). Pure, READ-ONLY, deterministic: the
 * canonical sources supply facts / signals; this module decides — with the app's OWN rules, never a second one — what
 * truly needs the Owner TODAY. Served once (capability needs_me) to Dashboard V2 AND to Sunny: one list, one rule.
 *
 * For every candidate it asks: is the ball really the Owner's? is an action / decision needed now? today or backlog?
 * did the Owner's processed updates (Sunny's interpretations) or recent records change it? handled / moved to someone
 * else? the exact next action? the evidence? The ball comes ONLY from the records:
 *   Victor work   → computeVictorBall (lib/partner/victor/view buildWork handoff.state)
 *   mix / master  → engineerHandoff (lib/partner/mix/view buildMixWork handoff.state)
 *   send log      → project_view's own signals (OWNER_FEEDBACK_DUE / WAITING_FEEDBACK / WAITING_VERSION)
 * A task inherits the ball of what it is linked to (the Victor work by vendor_project_work.linked_task_id, the send-log
 * entry by project_actions.linked_task_id, the project by related_type=project). The Owner's processed update
 * (sunny_inbox_interpretations, HYPOTHESIS) only ENRICHES an item; it never sets the ball and never creates an item by
 * itself. A NEW (unprocessed) update never enters. A contradiction is SHOWN (records win), never hidden.
 *
 * Owner rules (2026-10-01): Q1 an own task is "today" when due today or overdue ≤ 3 days, older = Backlog — unless the
 * ball is the Owner's and someone waits (the ball beats the age). Q2 integrity questions live on their own line (only a
 * question that blocks an action may enter — none does today). Q3 someone waiting on the Owner stays while the ball is
 * his, with "מחכה לך N ימים". Q4 money whose ball is the client's never enters; only the Owner's own dated action does.
 * Q5 a contradiction between an update and the records is shown, records win, nothing is changed.
 * At most 5 items, never filled. No write, no push, no task, no status change.
 */
import type { GatewaySources } from "../gateway/core";
import type { ProjectDetailRaw, DetailTask } from "../projects/detail-types";
import type { LabelDetailRaw } from "../label/detail-types";
import type { ActionSurfaceItemDto } from "../actions/surface-dto";
import type { OpsProjectAction } from "../operations/types";
import type { CompanyIntegrityRegister } from "../integrity/types";
import { buildWork as buildVictorWork } from "../victor/view";
import { buildMixWork } from "../mix/view";
import { buildProjectView } from "../projects/view";
import { buildShowView } from "../shows/view";
import { projectBasisOf } from "../projects/memory";
import { ATTENTION_MAP } from "../system/company";
import { isClosedStatus } from "../../steven-mix-reminder-pure";
import { checkProposalFollowUps } from "../../proposal-followups";
import { isStrictYmd } from "../../project-deadline";
import { BALL_WITH_HE, freshnessOf, FRESHNESS_HE, headOf, type BallWith, type Freshness, type InboxMemory } from "../../inbox-memory";

const ok = <T,>(a: { status: string; value?: T } | undefined): T | null => (a && a.status === "OK" ? (a as { value: T }).value : null);

/** Owner decision Q1 (2026-10-01): an own task overdue by more than this many days is Backlog (the ball beats the age). */
export const OWNER_TASK_GRACE_DAYS = 3;
/** Owner decision: at most five items, never filled. */
export const NEEDS_ME_MAX = 5;
/** A scheduled event enters when it is today or tomorrow. */
export const SCHEDULED_WINDOW_DAYS = 1;

/**
 * Owner decision 2026-10-01 (precedence, never a score shown to anyone): 1 NEW_TODAY — something new since yesterday
 * that needs his response (a version / received entry since yesterday, or his own processed update since yesterday);
 * 2 SCHEDULED — an event today / tomorrow; 3 WAITING_ON_YOU (+ APPROVAL) — someone actively waiting; 4 YOUR_TASK — his
 * own task / follow-up (today, ≤ 3 days late); 5 LONG_WAITS — the aggregated long-running Victor waits. Fresh actionable
 * beats stale repeated backlog. Inside a group: the most recent event first.
 */
export type NeedsGroup = "NEW_TODAY" | "SCHEDULED" | "WAITING_ON_YOU" | "APPROVAL" | "YOUR_TASK" | "LONG_WAITS";
/** Fixed presentation order (never a score). */
export const NEEDS_GROUP_ORDER: readonly NeedsGroup[] = ["NEW_TODAY", "SCHEDULED", "WAITING_ON_YOU", "APPROVAL", "YOUR_TASK", "LONG_WAITS"];
export const NEEDS_GROUP_HE: Record<NeedsGroup, string> = { NEW_TODAY: "חדש", SCHEDULED: "מתוזמן", WAITING_ON_YOU: "מחכים לך", APPROVAL: "אישור", YOUR_TASK: "משימה שלך", LONG_WAITS: "ממתין זמן רב" };
/** A display window for "received a version recently" inside the Victor aggregate (a count shown, never a rule). */
export const RECENT_VERSION_DAYS = 7;

export type NeedsOpen =
  | { kind: "project"; id: string }
  | { kind: "client"; id: string }
  | { kind: "task"; id: string; title: string; dueDate: string | null }
  | { kind: "partner-actions" }
  | { kind: "href"; href: string }
  | { kind: "none" }
  /** the aggregated item opens its member list (each member opens its own record) */
  | { kind: "list"; title: string; entries: Array<{ key: string; title: string; reasonHe: string; open: NeedsOpen }> };

export type NeedsEpistemic = "FACT" | "DERIVED" | "OWNER_REPORTED" | "HYPOTHESIS";
export interface NeedsEvidence { code: string; he: string; source: string; epistemic: NeedsEpistemic; at: string | null }
export interface NeedsBall { holder: "OWNER"; waitingParty: string | null; sinceAt: string | null; ruleHe: string }
export interface NeedsInbox {
  interpretationId: string; itemId: string; recordedAt: string; whatHappened: string; ballWith: BallWith;
  /** the hypothesis next step — only when the understanding is CURRENT (canonical wins) */
  nextStep: string | null; freshness: Freshness; freshnessHe: string;
  /** set when the update's ball contradicts the records ("כתבת ש… — לפי הרשומות כרגע …"); records win */
  conflictHe: string | null;
}
export interface NeedsItem {
  key: string; entityKey: string; projectId: string | null; group: NeedsGroup; title: string;
  whyToday: string; waitingDays: number | null; ball: NeedsBall; evidence: NeedsEvidence[];
  nextAction: { he: string; actionId: string | null };
  fromInbox: NeedsInbox | null; date: string | null; open: NeedsOpen;
}
export type EntryBall = "OWNER" | "EXTERNAL" | "UNKNOWN" | "NONE";
export interface NeedsEntry { key: string; entityKey: string; title: string; reasonCode: string; reasonHe: string; ball: EntryBall; party: string | null; date: string | null; open: NeedsOpen }
export interface NeedsUnchecked { source: string; he: string }
export interface NeedsMe {
  today: string;
  /** at most NEEDS_ME_MAX, in the fixed group order */
  items: NeedsItem[];
  /** qualified for today beyond the five (shown as a count, never mixed into the five) */
  moreToday: NeedsItem[];
  backlog: NeedsEntry[];
  /** "לא הוכרע": unknown / conflicting ball, an update that contradicts the records */
  undecided: NeedsEntry[];
  /** "לא נבדק": a source that could not be read — unknown, never "nothing" */
  unchecked: NeedsUnchecked[];
  /** checked and left out, with the reason (Sunny answers "למה X לא מופיע?") */
  excluded: NeedsEntry[];
  integrity: { count: number | null; blocking: number; questions: Array<{ questionId: string; subject: string; textHe: string }>; ruleHe: string };
  checked: number;
  inbox: { read: boolean; interpretations: number; enriched: number; conflicts: number };
}

// ── helpers ──
const ilYmd = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const daysBetween = (fromYmd: string, toYmd: string) => Math.round((Date.parse(`${toYmd}T12:00:00Z`) - Date.parse(`${fromYmd.slice(0, 10)}T12:00:00Z`)) / 86_400_000);
const addDays = (ymd: string, n: number) => { const d = new Date(`${ymd}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const fmt = (iso: string | null | undefined) => (iso && iso.length >= 10 ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}` : "?");
const dayWord = (n: number) => (n === 1 ? "יום אחד" : `${n} ימים`);
const PROPOSAL_MARKER = /\[proposal_id:([0-9a-f-]{36})\]/i;
const projectOpen = (pid: string | null, fallback: NeedsOpen = { kind: "none" }): NeedsOpen => (pid ? { kind: "project", id: pid } : fallback);
/** the ATTENTION_MAP side of a signal code (the company contract) — never a second rule */
const sideOf = (code: string): EntryBall => {
  const s = ATTENTION_MAP[code]?.side;
  return s === "OWNER" ? "OWNER" : s === "EXTERNAL" ? "EXTERNAL" : s === "UNKNOWN" ? "UNKNOWN" : "NONE";
};

interface ProjectBall { owner: string[]; external: string[]; unknown: string[]; kinds: Set<"VICTOR" | "ENGINEER" | "EXTERNAL"> }

/** The evidence ball of a project in canonicalBallOf's vocabulary (for freshnessOf). project_view's own projection reads
 *  the engineer STATUS (AT_ENGINEER / ENGINEER_RETURNED_WORK); the evidence rules (engineerHandoff / computeVictorBall)
 *  read uploads vs feedback — when they disagree the evidence wins here (registered conflict, lib/partner/system). */
function evidenceBallOf(b: ProjectBall | undefined): "OWNER" | "VICTOR" | "ENGINEER" | "EXTERNAL" | "MIXED" | "NONE" {
  if (!b) return "NONE";
  if (b.owner.length && (b.external.length || b.unknown.length)) return "MIXED";
  if (b.owner.length) return "OWNER";
  if (b.unknown.length) return "MIXED";
  if (!b.kinds.size) return "NONE";
  return b.kinds.size > 1 ? "MIXED" : [...b.kinds][0];
}

export function buildNeedsMe(src: GatewaySources): NeedsMe {
  const st = ok(src.state);
  const det = ok(src.projectDetail) as ProjectDetailRaw | null;
  const ld = ok(src.labelDetail) as LabelDetailRaw | null;
  const mem = ok(src.inboxMemory) as InboxMemory | null;
  const actions = ok(src.actions) as ActionSurfaceItemDto[] | null;
  const integrity = ok(src.integrity) as CompanyIntegrityRegister | null;
  const today = st?.todayIL ?? ilYmd(src.now);
  const projIdx = st?.domains.projects.data?.index ?? {};
  const pname = (pid: string | null | undefined) => (pid ? projIdx[pid]?.name ?? null : null);

  const items: NeedsItem[] = [];
  const backlog: NeedsEntry[] = [];
  const undecided: NeedsEntry[] = [];
  const excluded: NeedsEntry[] = [];
  const unchecked: NeedsUnchecked[] = [];
  let checked = 0;
  const balls = new Map<string, ProjectBall>();
  const mark = (pid: string | null | undefined, side: "owner" | "external" | "unknown", party: string, kind: "VICTOR" | "ENGINEER" | "EXTERNAL" = "EXTERNAL") => {
    if (!pid) return;
    const b = balls.get(pid) ?? { owner: [], external: [], unknown: [], kinds: new Set() };
    if (!b[side].includes(party)) b[side].push(party);
    if (side === "external") b.kinds.add(kind);
    balls.set(pid, b);
  };
  const ownerItemOf = (pid: string) => items.find((i) => i.projectId === pid && i.group === "WAITING_ON_YOU") ?? null;

  if (!st) unchecked.push({ source: "STATE", he: "מצב החברה לא נקרא — שום דבר כאן לא אומר \"אין\"" });
  if (!det) unchecked.push({ source: "PROJECT_DETAIL", he: "עבודות ויקטור / מיקס, יומן השליחות והמשימות לא נבדקו — לא ידוע, לא \"אין\"" });

  // ── 1. Victor works (computeVictorBall) ──
  const victorByTask = new Map<string, { key: string; state: string; title: string; projectId: string | null }>();
  for (const row of (det?.victor?.rows ?? []).filter((w) => (!w.vendorName || w.vendorName === "victor") && w.status === "פעיל")) {
    checked++;
    const w = buildVictorWork(src, row);
    const pid = row.projectId ?? null;
    const name = w.project?.name ?? w.title;
    if (row.linkedTaskId) victorByTask.set(row.linkedTaskId, { key: w.key, state: w.handoff.state, title: name, projectId: pid });
    const open = projectOpen(pid, { kind: "href", href: "/team/victor" });
    if (w.handoff.state === "WAITING_ON_OWNER") {
      mark(pid, "owner", "ויקטור");
      const since = w.handoff.lastUploadAt ?? null;
      const n = w.handoff.daysSinceLastUpload;
      const drafts = w.feedback.draftsNotSent;
      items.push({
        key: `${w.key}|OWNER_FEEDBACK`, entityKey: w.key, projectId: pid, group: "WAITING_ON_YOU",
        title: `${name} — ויקטור מחכה להערות שלך`,
        whyToday: `ויקטור העלה גרסה ${since ? `ב-${fmt(since)}` : "(בלי חותמת זמן)"} ואין הערות שלך אחריה${n !== null ? ` — מחכה לך ${dayWord(n)}` : ""}`,
        waitingDays: n,
        ball: { holder: "OWNER", waitingParty: "ויקטור", sinceAt: since, ruleHe: "computeVictorBall — ההעלאה האחרונה של ויקטור מול ההערות האחרונות שלך" },
        evidence: [
          { code: "VICTOR_WAITING_OWNER", he: w.handoff.cycle.whyHe, source: "TEAM_VICTOR", epistemic: "DERIVED", at: since },
          ...(drafts ? [{ code: "DRAFT_NOTES_NOT_SENT", he: `${drafts} טיוטות הערות שכתבת ולא נשלחו`, source: "TEAM_VICTOR", epistemic: "FACT" as const, at: null }] : []),
        ],
        nextAction: { he: drafts ? "לשלוח לויקטור את טיוטת ההערות שכבר כתבת" : "לשמוע את הגרסה האחרונה ולשלוח לויקטור הערות", actionId: null },
        fromInbox: null, date: since ? since.slice(0, 10) : null, open,
      });
    } else if (w.handoff.state === "WAITING_ON_VICTOR") {
      mark(pid, "external", "ויקטור", "VICTOR");
      excluded.push({ key: `${w.key}|BALL`, entityKey: w.key, title: name, reasonCode: "BALL_AT_VICTOR", reasonHe: `הכדור אצל ויקטור — ${w.handoff.cycle.whyHe}`, ball: "EXTERNAL", party: "ויקטור", date: null, open });
    } else {
      mark(pid, "unknown", "ויקטור");
      undecided.push({ key: `${w.key}|BALL`, entityKey: w.key, title: name, reasonCode: w.handoff.state === "CONFLICTING_EVIDENCE" ? "BALL_CONFLICTING" : "BALL_UNKNOWN",
        reasonHe: w.handoff.state === "CONFLICTING_EVIDENCE" ? `ויקטור: הראיות סותרות (יומן השליחה מול ההעלאות / ההערות) — לא מוכרע` : `ויקטור: ${w.handoff.appRule.basis}`, ball: "UNKNOWN", party: "ויקטור", date: null, open });
    }
  }

  // ── 2. Mix / master works (engineerHandoff) ──
  for (const row of (det?.engineerWork?.rows ?? []).filter((w) => !isClosedStatus(w.status ?? "לא נשלח"))) {
    checked++;
    const m = buildMixWork(src, row);
    const pid = row.projectId ?? null;
    const name = pname(pid) ?? m.title;
    const who = m.engineer;
    const open = projectOpen(pid, m.isSteven ? { kind: "href", href: "/team/steven" } : { kind: "none" });
    if (m.handoff.state === "WAITING_ON_OWNER") {
      mark(pid, "owner", who);
      const since = m.handoff.lastUploadAt ?? null;
      const n = m.handoff.daysSinceLastUpload;
      items.push({
        key: `${m.key}|OWNER_FEEDBACK`, entityKey: m.key, projectId: pid, group: "WAITING_ON_YOU",
        title: `${name} — ${m.workType} של ${who} מחכה לפידבק שלך`,
        whyToday: `${who} העלה גרסה ${since ? `ב-${fmt(since)}` : ""} ואין פידבק שלך אחריה${n !== null ? ` — מחכה לך ${dayWord(n)}` : ""}`,
        waitingDays: n,
        ball: { holder: "OWNER", waitingParty: who, sinceAt: since, ruleHe: "engineerHandoff — הגרסה האחרונה מול הפידבק האחרון שלך (הערות על גרסה שכבר הוחלפה לא נספרות)" },
        evidence: [{ code: "WAITING_ON_OWNER", he: m.handoff.cycle.whyHe, source: "TEAM_STEVEN", epistemic: "DERIVED", at: since }],
        nextAction: { he: `לשמוע את הגרסה ולשלוח ל-${who} הערות (או לאשר)`, actionId: null },
        fromInbox: null, date: since ? since.slice(0, 10) : null, open,
      });
    } else if (m.handoff.state === "WAITING_ON_ENGINEER") {
      mark(pid, "external", who, "ENGINEER");
      excluded.push({ key: `${m.key}|BALL`, entityKey: m.key, title: name, reasonCode: "BALL_AT_ENGINEER", reasonHe: `הכדור אצל ${who} — ${m.handoff.cycle.whyHe}`, ball: "EXTERNAL", party: who, date: null, open });
    } else if (m.handoff.state === "CONFLICTING_EVIDENCE") {
      mark(pid, "unknown", who);
      undecided.push({ key: `${m.key}|BALL`, entityKey: m.key, title: name, reasonCode: "BALL_CONFLICTING", reasonHe: `${who}: הראיות סותרות — ${m.handoff.basis}`, ball: "UNKNOWN", party: who, date: null, open });
    } else {
      // engineerHandoff UNKNOWN = no version, no feedback, no send evidence: nobody is recorded as waiting
      excluded.push({ key: `${m.key}|BALL`, entityKey: m.key, title: name, reasonCode: "NOT_SENT_YET", reasonHe: `${who}: עוד לא נשלח — אין ראיה שמישהו מחכה`, ball: "NONE", party: who, date: null, open });
    }
  }

  // ── 3. Send log (project_view's own signals), only for projects with an open send-log entry ──
  // the SAME rows project_view reads (operations.projectActions)
  const sendLog = (ok(src.operations) as { projectActions?: { rows: OpsProjectAction[] } } | null)?.projectActions?.rows ?? null;
  const sendProjects = [...new Set((sendLog ?? []).filter((a) => a.projectId && (a.status === "pending_feedback" || a.status === "pending_version")).map((a) => a.projectId as string))]
    .filter((pid) => !!projIdx[pid]);
  for (const pid of sendProjects) {
    checked++;
    const codes = new Set(buildProjectView(src, pid).signals.map((s) => s.code));
    const name = pname(pid) ?? "פרויקט";
    // the send log says BOTH "waiting on you" and "waiting on others" for the same project = MIXED → not decided here
    const mixedLog = codes.has("OWNER_FEEDBACK_DUE") && (codes.has("WAITING_FEEDBACK") || codes.has("WAITING_VERSION"));
    if (mixedLog) {
      mark(pid, "unknown", "יומן שליחות");
      undecided.push({ key: `project:${pid}|SEND_LOG_MIXED`, entityKey: `project:${pid}`, title: name, reasonCode: "SEND_LOG_MIXED",
        reasonHe: "יומן השליחות מראה גם גרסה שמחכה לפידבק שלך וגם המתנה לאחרים — לא מוכרע אצל מי הכדור (אולי טופל מחוץ למערכת)", ball: "UNKNOWN", party: null, date: null, open: projectOpen(pid) });
      continue;
    }
    if (codes.has("OWNER_FEEDBACK_DUE")) {
      mark(pid, "owner", "יומן שליחות");
      const at = (sendLog ?? []).filter((a) => a.projectId === pid && a.status === "pending_feedback" && a.actionType === "received").map((a) => a.actionDate).filter((x): x is string => !!x).sort().pop() ?? null;
      const n = at && isStrictYmd(at.slice(0, 10)) ? daysBetween(at, today) : null;
      const existing = ownerItemOf(pid);
      const ev: NeedsEvidence = { code: "OWNER_FEEDBACK_DUE", he: "התקבלה גרסה ומחכים לפידבק שלך (יומן שליחות; אין פידבק רשום אחריה)", source: "PROJECT_ACTIONS", epistemic: "DERIVED", at };
      if (existing) existing.evidence.push(ev);
      else items.push({
        key: `project:${pid}|OWNER_FEEDBACK`, entityKey: `project:${pid}`, projectId: pid, group: "WAITING_ON_YOU",
        title: `${name} — התקבלה גרסה שמחכה לפידבק שלך`,
        whyToday: `נרשמה קבלת גרסה ${at ? `ב-${fmt(at)} ` : ""}ואין פידבק רשום אחריה${n !== null ? ` — מחכה לך ${dayWord(n)}` : ""}`,
        waitingDays: n,
        ball: { holder: "OWNER", waitingParty: null, sinceAt: at, ruleHe: "יומן השליחות (sendEntryCurrent) — רישום 'התקבל' פתוח בלי פידבק אחריו" },
        evidence: [ev], nextAction: { he: "לשמוע את הגרסה שהתקבלה ולתת פידבק", actionId: null }, fromInbox: null, date: at ? at.slice(0, 10) : null, open: projectOpen(pid),
      });
    }
    for (const code of ["WAITING_FEEDBACK", "WAITING_VERSION"]) if (codes.has(code)) {
      mark(pid, "external", code === "WAITING_FEEDBACK" ? "הנמען" : "מי שצריך לשלוח גרסה");
      excluded.push({ key: `project:${pid}|${code}`, entityKey: `project:${pid}`, title: name, reasonCode: code === "WAITING_FEEDBACK" ? "WAITING_ON_RECIPIENT" : "WAITING_FOR_VERSION",
        reasonHe: code === "WAITING_FEEDBACK" ? "נשלח משהו ומחכים לתגובת הנמען — הכדור לא אצלך" : "מחכים לגרסה חדשה — הכדור לא אצלך", ball: "EXTERNAL", party: null, date: null, open: projectOpen(pid) });
    }
  }

  // ── 4. Shows today / tomorrow (the show view's own signals; only Owner-side scheduled signals) ──
  if (!ld) unchecked.push({ source: "LABEL_DETAIL", he: "הופעות היום / מחר לא נבדקו — לא ידוע, לא \"אין\"" });
  const showEnd = addDays(today, SCHEDULED_WINDOW_DAYS);
  for (const s of (ld?.shows?.rows ?? []).filter((x) => x.status !== "בוטל" && isStrictYmd(x.date ?? "") && (x.date as string) >= today && (x.date as string) <= showEnd)) {
    checked++;
    const v = buildShowView(src, s.id);
    if (!v) continue;
    const own = v.signals.filter((g) => sideOf(g.code) === "OWNER" && (ATTENTION_MAP[g.code]?.dims ?? []).includes("SCHEDULED_EVENT"));
    const when = s.date === today ? "היום" : "מחר";
    if (own.length) items.push({
      key: `show:${s.id}|SCHEDULED`, entityKey: `show:${s.id}`, projectId: null, group: "SCHEDULED",
      title: `${s.name ?? "הופעה"} — הופעה ${when}`,
      whyToday: `ההופעה ${when} (${fmt(s.date)}) ו${own.map((g) => g.he).join(" · ")}`,
      waitingDays: null,
      ball: { holder: "OWNER", waitingParty: null, sinceAt: null, ruleHe: "אותות ההופעה (show_view) שהצד שלהם הוא שלך ושייכים לאירוע מתוזמן" },
      evidence: own.map((g) => ({ code: g.code, he: g.he, source: "SHOWS", epistemic: g.kind === "CANONICAL_FACT" ? "FACT" as const : "DERIVED" as const, at: null })),
      nextAction: { he: own.some((g) => g.code === "NO_DJ" || g.code === "SHOW_WITHOUT_DJ") ? "לסגור DJ להופעה (או לרשום שאין צורך)" : "לסגור את מה שחסר להופעה", actionId: null },
      fromInbox: null, date: s.date ?? null, open: { kind: "href", href: "/shows" },
    });
    else excluded.push({ key: `show:${s.id}|SCHEDULED`, entityKey: `show:${s.id}`, title: s.name ?? "הופעה", reasonCode: "SCHEDULED_NOTHING_MISSING", reasonHe: `הופעה ${when} — לא חסר ממך שום דבר רשום`, ball: "NONE", party: null, date: s.date ?? null, open: { kind: "href", href: "/shows" } });
  }

  // ── 5. Proposal follow-ups (the app's own rule; Q1 grace) ──
  const proposals = st?.domains.proposalsFull.data?.items ?? null;
  if (!proposals) unchecked.push({ source: "PROPOSALS", he: "פולואפים להצעות לא נבדקו — לא ידוע, לא \"אין\"" });
  const followups = new Map<string, { title: string; clientId: string | null; overdue: number; date: string; amount: number; currency: string }>();
  for (const f of checkProposalFollowUps((proposals ?? []).map((p) => ({ id: p.id, title: p.title, amount: p.amount, currency: p.currency, status: p.status, followup_date: p.followupYmd, client_id: p.clientId, client_name: p.clientName })) as never)) {
    const p = (proposals ?? []).find((x) => x.id === f.proposalId);
    followups.set(f.proposalId.toLowerCase(), { title: p?.clientName || f.title, clientId: p?.clientId ?? null, overdue: f.overdueDays, date: f.followup_date, amount: f.amount, currency: f.currency });
  }
  const followupTasks = new Map<string, DetailTask[]>();

  // ── 6. Tasks (open, due today or before) — each inherits the ball of what it is linked to ──
  const actionByTask = new Map((det?.actions?.rows ?? []).filter((a) => a.linkedTaskId && a.projectId).map((a) => [a.linkedTaskId as string, a.projectId as string] as const));
  const ownTask = (t: DetailTask, overdue: number) => {
    const title = t.title || "משימה";
    const open: NeedsOpen = { kind: "task", id: t.id, title, dueDate: t.dueDate };
    if (overdue <= OWNER_TASK_GRACE_DAYS) items.push({
      key: `task:${t.id}|TASK`, entityKey: `task:${t.id}`, projectId: null, group: "YOUR_TASK", title,
      whyToday: overdue <= 0 ? `משימה שלך להיום${t.startTime ? ` · ${t.startTime.slice(0, 5)}` : ""}` : `משימה שלך — באיחור ${dayWord(overdue)} (עד ${OWNER_TASK_GRACE_DAYS} ימים נחשב "היום")`,
      waitingDays: null,
      ball: { holder: "OWNER", waitingParty: null, sinceAt: null, ruleHe: "משימה פתוחה שלך שלא מקושרת לעבודה של מישהו אחר" },
      evidence: [{ code: overdue > 0 ? "TASK_OVERDUE" : "TASK_DUE_TODAY", he: `יעד ${fmt(t.dueDate)}`, source: "TASKS", epistemic: "FACT", at: t.dueDate }],
      nextAction: { he: "לבצע ולסמן בוצע — או לדחות לתאריך חדש", actionId: null }, fromInbox: null, date: t.dueDate, open,
    });
    else backlog.push({ key: `task:${t.id}|TASK`, entityKey: `task:${t.id}`, title, reasonCode: "OWN_TASK_OVERDUE_OLD", reasonHe: `באיחור ${dayWord(overdue)} (מעל ${OWNER_TASK_GRACE_DAYS}) ואין ראיה שמישהו מחכה לך עכשיו`, ball: "OWNER", party: null, date: t.dueDate, open });
  };
  for (const t of (det?.tasks?.rows ?? []).filter((x) => (x.status ?? "פתוח") === "פתוח" && isStrictYmd(x.dueDate ?? "") && (x.dueDate as string) <= today)) {
    checked++;
    const overdue = daysBetween(t.dueDate as string, today);
    const title = t.title || "משימה";
    const open: NeedsOpen = { kind: "task", id: t.id, title, dueDate: t.dueDate };
    const taskEv: NeedsEvidence = { code: "LINKED_TASK", he: `משימה "${title}" ${overdue > 0 ? `באיחור ${dayWord(overdue)}` : "להיום"}`, source: "TASKS", epistemic: "FACT", at: t.dueDate };

    // 6a. the auto "מעקב ויקטור" task follows its Victor work's ball (canonical link linked_task_id)
    const vw = victorByTask.get(t.id);
    if (vw) {
      if (vw.state === "WAITING_ON_OWNER") { const it = items.find((i) => i.entityKey === vw.key); if (it) { it.evidence.push(taskEv); continue; } }
      if (vw.state === "WAITING_ON_VICTOR") { excluded.push({ key: `task:${t.id}|TASK`, entityKey: `task:${t.id}`, title, reasonCode: "AUTO_TASK_BALL_AT_VICTOR", reasonHe: `משימת מעקב אוטומטית של ויקטור (${vw.title}) — הכדור אצל ויקטור, לא אצלך. איחור לבדו לא מכניס אותה`, ball: "EXTERNAL", party: "ויקטור", date: t.dueDate, open }); continue; }
      undecided.push({ key: `task:${t.id}|TASK`, entityKey: `task:${t.id}`, title, reasonCode: "AUTO_TASK_BALL_UNKNOWN", reasonHe: `משימת מעקב אוטומטית של ויקטור (${vw.title}) — הכדור בעבודה לא הוכרע`, ball: "UNKNOWN", party: "ויקטור", date: t.dueDate, open });
      continue;
    }
    // 6b. a proposal follow-up task (text marker / the follow-up title) joins its proposal
    const marker = t.notes ? PROPOSAL_MARKER.exec(t.notes)?.[1]?.toLowerCase() ?? null : null;
    if (marker && followups.has(marker)) { followupTasks.set(marker, [...(followupTasks.get(marker) ?? []), t]); continue; }
    // 6c. a task linked to a project (directly, or through its send-log entry) inherits the project's ball
    const pid = t.relatedType === "project" && t.relatedId ? t.relatedId : actionByTask.get(t.id) ?? null;
    const b = pid ? balls.get(pid) : undefined;
    if (pid && b) {
      if (b.owner.length) { const it = ownerItemOf(pid); if (it) { it.evidence.push(taskEv); continue; } }
      if (b.unknown.length && !b.owner.length) { undecided.push({ key: `task:${t.id}|TASK`, entityKey: `task:${t.id}`, title, reasonCode: "PROJECT_BALL_UNKNOWN", reasonHe: `מקושרת ל-${pname(pid) ?? "פרויקט"} — הכדור שם לא הוכרע (${b.unknown.join(", ")})`, ball: "UNKNOWN", party: b.unknown.join(", "), date: t.dueDate, open }); continue; }
      if (b.external.length && !b.owner.length) {
        // the Owner's rule: a task whose project ball is with someone else enters only on its own due day
        if (overdue <= 0) { ownTask(t, overdue); continue; }
        excluded.push({ key: `task:${t.id}|TASK`, entityKey: `task:${t.id}`, title, reasonCode: "PROJECT_BALL_EXTERNAL", reasonHe: `מקושרת ל-${pname(pid) ?? "פרויקט"} — הכדור אצל ${b.external.join(", ")}, לא אצלך`, ball: "EXTERNAL", party: b.external.join(", "), date: t.dueDate, open });
        continue;
      }
    }
    ownTask(t, overdue);
  }
  if (!det?.tasks) unchecked.push({ source: "TASKS", he: "המשימות לא נבדקו — לא ידוע, לא \"אין\"" });

  for (const [id, f] of followups) {
    checked++;
    const tasks = followupTasks.get(id) ?? [];
    const open: NeedsOpen = f.clientId ? { kind: "client", id: f.clientId } : { kind: "href", href: "/clients" };
    const evidence: NeedsEvidence[] = [{ code: "PROPOSAL_FOLLOWUP_DUE", he: `תאריך הפולואפ ${fmt(f.date)}`, source: "PROPOSALS", epistemic: "FACT", at: f.date },
      ...tasks.map((t) => ({ code: "FOLLOWUP_TASK", he: `משימת פולואפ "${t.title ?? ""}"`, source: "TASKS", epistemic: "FACT" as const, at: t.dueDate }))];
    if (f.overdue <= OWNER_TASK_GRACE_DAYS) items.push({
      key: `proposal:${id}|FOLLOWUP`, entityKey: `proposal:${id}`, projectId: null, group: "YOUR_TASK",
      title: `פולואפ להצעה — ${f.title}`,
      whyToday: f.overdue <= 0 ? "מועד הפולואפ להצעה הוא היום" : `מועד הפולואפ עבר לפני ${dayWord(f.overdue)} (עד ${OWNER_TASK_GRACE_DAYS} ימים נחשב "היום")`,
      waitingDays: null,
      ball: { holder: "OWNER", waitingParty: null, sinceAt: null, ruleHe: "checkProposalFollowUps — הצעה פעילה שמועד הפולואפ שלה הגיע" },
      evidence, nextAction: { he: `לעשות פולואפ ל-${f.title} על ההצעה`, actionId: null }, fromInbox: null, date: f.date, open,
    });
    else backlog.push({ key: `proposal:${id}|FOLLOWUP`, entityKey: `proposal:${id}`, title: `פולואפ להצעה — ${f.title}`, reasonCode: "FOLLOWUP_OLD", reasonHe: `מועד הפולואפ עבר לפני ${dayWord(f.overdue)} (מעל ${OWNER_TASK_GRACE_DAYS})`, ball: "OWNER", party: null, date: f.date, open });
  }

  // ── 7. Partner suggested actions (only the Owner approves) ──
  if (!actions) unchecked.push({ source: "ACTIONS", he: "הצעות הפעולה של סאני לא נבדקו — לא ידוע, לא \"אין\"" });
  for (const a of actions ?? []) {
    checked++;
    const awaiting = a.state === "AWAITING_EXECUTION";
    const isDeadline = a.actionType === "UPDATE_PROJECT_DEADLINE";
    const pid = isDeadline ? a.projectId : null;
    items.push({
      key: `partner-action:${a.actionId}|APPROVAL`, entityKey: pid ? `project:${pid}` : `partner-action:${a.actionId}`, projectId: pid ?? null, group: "APPROVAL",
      title: isDeadline ? `${a.projectName} — עדכון דדליין` : a.titleHe,
      whyToday: awaiting ? "אישרת — ממתין לביצוע שלך" : "הצעה של סאני שמחכה להחלטה שלך (רק אתה מאשר)",
      waitingDays: null,
      ball: { holder: "OWNER", waitingParty: null, sinceAt: null, ruleHe: "הצעת פעולה של Partner — כל ביצוע דורש את האישור שלך" },
      evidence: [{ code: awaiting ? "ACTION_AWAITING_EXECUTION" : "ACTION_AWAITING_DECISION", he: a.headlineHe, source: "PARTNER_ACTIONS", epistemic: "DERIVED", at: null }],
      nextAction: { he: awaiting ? "לבצע את הפעולה שאישרת" : "לאשר / לשנות / לדחות", actionId: a.actionId }, fromInbox: null, date: null, open: { kind: "partner-actions" },
    });
  }

  // ── 8. The Owner's PROCESSED updates (interpretations) — enrich only; records set the ball; contradictions shown ──
  let enriched = 0, conflicts = 0, interpretations = 0;
  if (!mem) unchecked.push({ source: "OWNER_INBOX", he: "העדכונים שעובדו (זיכרון סאני) לא נקראו — ההעשרה מהם חסרה" });
  const heads = mem ? [...new Set(mem.interpretations.filter((x) => !x.retractedAt && x.entityKey.startsWith("project:")).map((x) => x.entityKey))].map((k) => headOf(mem.interpretations, k)).filter((x): x is NonNullable<typeof x> => !!x) : [];
  for (const h of heads) {
    interpretations++;
    const pid = h.entityKey.slice("project:".length);
    const b = balls.get(pid);
    const live = projectBasisOf(src, pid);
    // the SAME freshness rule (freshnessOf), measured against the evidence ball the items use
    const freshness = freshnessOf(h, live ? { ...live, ball: evidenceBallOf(b) } : null);
    const it = ownerItemOf(pid) ?? items.find((i) => i.projectId === pid) ?? null;
    const recordsSide: "OWNER" | "EXTERNAL" | "UNKNOWN" | "NONE" = b?.owner.length ? "OWNER" : b?.unknown.length ? "UNKNOWN" : b?.external.length ? "EXTERNAL" : "NONE";
    const said = BALL_WITH_HE[h.ballWith] ?? h.ballWith;
    const recordsHe = recordsSide === "OWNER" ? "אצלך" : recordsSide === "EXTERNAL" ? `אצל ${b!.external.join(", ")}` : recordsSide === "UNKNOWN" ? "לא מוכרע" : "אין ראיה לכדור";
    const updateOwner = h.ballWith === "OWNER";
    const contradicts = h.ballWith !== "UNKNOWN" && recordsSide !== "NONE" && recordsSide !== "UNKNOWN" && (updateOwner ? recordsSide !== "OWNER" : recordsSide === "OWNER");
    const conflictHe = contradicts ? `לפי מה שכתבת (הבנתי ב-${fmt(h.createdAt)}) הכדור ${said} — אבל לפי הרשומות כרגע הוא ${recordsHe}. הרשומות קובעות; לא שיניתי כלום.` : null;
    if (contradicts) conflicts++;
    const inbox: NeedsInbox = { interpretationId: h.id, itemId: h.itemId, recordedAt: h.createdAt, whatHappened: h.whatHappened, ballWith: h.ballWith,
      nextStep: freshness === "CURRENT" ? h.inferredNextStep : null, freshness, freshnessHe: FRESHNESS_HE[freshness], conflictHe };
    if (it) {
      it.fromInbox = inbox;
      it.evidence.push({ code: "OWNER_UPDATE", he: h.whatHappened, source: "OWNER_INBOX", epistemic: "HYPOTHESIS", at: h.createdAt });
      // a CURRENT understanding words the next step (marked as the Owner's update) — the records still decide the ball
      if (inbox.nextStep && freshness === "CURRENT" && !contradicts) it.nextAction = { he: `${inbox.nextStep} (לפי העדכון שלך)`, actionId: it.nextAction.actionId };
      enriched++;
      continue;
    }
    if (freshness === "OUTDATED_BY_CANONICAL") continue; // history: the records moved on after it
    const name = pname(pid) ?? "פרויקט";
    if (contradicts) undecided.push({ key: `project:${pid}|INBOX_VS_RECORDS`, entityKey: `project:${pid}`, title: name, reasonCode: "INBOX_VS_RECORDS", reasonHe: conflictHe!, ball: recordsSide, party: b?.external.join(", ") || null, date: null, open: projectOpen(pid) });
    else if (updateOwner && recordsSide === "NONE") undecided.push({ key: `project:${pid}|INBOX_ONLY`, entityKey: `project:${pid}`, title: name, reasonCode: "INBOX_ONLY",
      reasonHe: `לפי מה שכתבת הכדור אצלך${h.inferredNextStep && freshness === "CURRENT" ? ` (${h.inferredNextStep})` : ""} — אבל אין ברשומות ראיה לכך, ולכן זה לא נכנס לבד`, ball: "NONE", party: null, date: null, open: projectOpen(pid) });
  }

  // ── 9. Integrity questions: their own line (Q2). No question type today blocks an action. ──
  const qs = integrity?.questions ?? null;
  const integrityOut = {
    count: qs ? qs.length : null, blocking: 0,
    questions: (qs ?? []).map((q) => ({ questionId: q.questionId, subject: q.subject.label ?? "", textHe: q.textHe })),
    ruleHe: "שאלות סאני מוצגות בשורה נפרדת. רק שאלה שחוסמת בפועל פעולה / החלטה שלך נכנסת לרשימה — אף סוג שאלה היום לא חוסם.",
  };
  if (!integrity) unchecked.push({ source: "INTEGRITY", he: "שאלות סאני לא נקראו" });

  // ── precedence (Owner decision 2026-10-01): something NEW since yesterday first ──
  const recentFrom = addDays(today, -1);
  const dayOf = (iso: string | null | undefined) => (iso && Number.isFinite(Date.parse(iso)) ? ilYmd(new Date(iso)) : null);
  for (const i of items) {
    if (i.group !== "WAITING_ON_YOU") continue;
    const eventDay = dayOf(i.ball.sinceAt);
    const updateDay = i.fromInbox?.freshness === "CURRENT" ? dayOf(i.fromInbox.recordedAt) : null;
    if ((eventDay && eventDay >= recentFrom) || (updateDay && updateDay >= recentFrom)) {
      i.group = "NEW_TODAY";
      i.evidence.push({ code: "NEW_SINCE_YESTERDAY", he: eventDay && eventDay >= recentFrom ? `האירוע שהעביר אליך את הכדור קרה ${eventDay === today ? "היום" : "אתמול"}` : `כתבת עליו עדכון ${updateDay === today ? "היום" : "אתמול"}`, source: "PARTNER_KNOWLEDGE", epistemic: "DERIVED", at: null });
    }
  }

  // ── Victor aggregation (Owner decision B): several Victor works waiting on the Owner = ONE item; a work whose version
  //    arrived since yesterday was already lifted to NEW_TODAY above. Display only — the balls are unchanged. ──
  const victorWaits = items.filter((i) => i.group === "WAITING_ON_YOU" && i.entityKey.startsWith("victor-work:"));
  if (victorWaits.length >= 2) {
    const members = [...victorWaits].sort((a, b) => (b.waitingDays ?? -1) - (a.waitingDays ?? -1));
    const oldest = members[0];
    const recentCut = addDays(today, -RECENT_VERSION_DAYS);
    const recent = members.filter((m) => (dayOf(m.ball.sinceAt) ?? "") >= recentCut).length;
    const tasks = members.reduce((n, m) => n + m.evidence.filter((e) => e.code === "LINKED_TASK").length, 0);
    for (const m of members) items.splice(items.indexOf(m), 1);
    items.push({
      key: "vendor:VICTOR|OWNER_FEEDBACK_AGGREGATE", entityKey: "vendor:VICTOR", projectId: null, group: "LONG_WAITS",
      title: `ויקטור מחכה לפידבק שלך ב-${members.length} עבודות`,
      whyToday: `הישנה (${oldest.title.split(" — ")[0]}) מחכה ${dayWord(oldest.waitingDays ?? 0)}${recent ? ` · ${recent} קיבלו גרסה ב-${RECENT_VERSION_DAYS} הימים האחרונים` : ""}${tasks ? ` · ${tasks} משימות מעקב מקושרות` : ""}`,
      waitingDays: oldest.waitingDays,
      ball: { holder: "OWNER", waitingParty: "ויקטור", sinceAt: oldest.ball.sinceAt, ruleHe: "computeVictorBall לכל עבודה (ההעלאה האחרונה מול ההערות האחרונות) — מאוחד לתצוגה בלבד; הכדור בכל עבודה לא שונה" },
      evidence: members.map((m) => ({ code: "VICTOR_WAITING_OWNER", he: `${m.title.split(" — ")[0]} — ${m.waitingDays !== null ? `מחכה ${dayWord(m.waitingDays)}` : "בלי חותמת זמן"}`, source: "TEAM_VICTOR", epistemic: "DERIVED" as const, at: m.ball.sinceAt })),
      nextAction: { he: "לעבור על הגרסאות ולשלוח לויקטור הערות (מה שכבר נענה מחוץ למערכת — כדאי לרשום)", actionId: null },
      fromInbox: null, date: oldest.date,
      open: { kind: "list", title: `ויקטור מחכה לפידבק שלך (${members.length})`, entries: members.map((m) => ({ key: m.key, title: m.title.split(" — ")[0], reasonHe: m.whyToday, open: m.open })) },
    });
  }

  // ── order: the fixed group order; inside a group the most recent event first (approvals: approved-awaiting first;
  //    own tasks: due today first; scheduled: the soonest first) ──
  const ts = (i: NeedsItem) => (i.ball.sinceAt && Number.isFinite(Date.parse(i.ball.sinceAt)) ? Date.parse(i.ball.sinceAt) : -1);
  const sorted = [...items].sort((a, b) =>
    NEEDS_GROUP_ORDER.indexOf(a.group) - NEEDS_GROUP_ORDER.indexOf(b.group)
    || (a.group === "APPROVAL" ? Number(b.whyToday.startsWith("אישרת")) - Number(a.whyToday.startsWith("אישרת")) : 0)
    || (a.group === "SCHEDULED" ? (a.date ?? "9999").localeCompare(b.date ?? "9999") : 0)
    || (a.group === "YOUR_TASK" ? (b.date ?? "").localeCompare(a.date ?? "") : 0)
    || ts(b) - ts(a)
    || a.title.localeCompare(b.title, "he"));
  const byDate = (x: NeedsEntry, y: NeedsEntry) => (x.date ?? "9999").localeCompare(y.date ?? "9999") || x.title.localeCompare(y.title, "he");
  return {
    today, items: sorted.slice(0, NEEDS_ME_MAX), moreToday: sorted.slice(NEEDS_ME_MAX),
    backlog: backlog.sort(byDate), undecided, unchecked, excluded: excluded.sort(byDate), integrity: integrityOut, checked,
    inbox: { read: !!mem, interpretations, enriched, conflicts },
  };
}
