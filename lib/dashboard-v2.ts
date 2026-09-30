// Dashboard V2 (/dashboard-v2) — pure, client-safe derivations. No fetch, no writes.
//
// Every rule here is REUSED, never restated:
//   - overdue / deadline parsing   → lib/project-deadline.ts
//   - proposal follow-up due       → lib/proposal-followups.ts (checkProposalFollowUps)
//   - money                        → lib/finance/stats.ts calcPeriodStats (the /finance formula), per currency
//   - releases                     → lib/dashboard-releases.ts summarizeUpcomingReleases
//   - COO cases / headline         → GET /api/coo/brief (tiers are the COO's implementation, not Owner priority)
// The Needs-Me order is a FIXED presentation order (badge group, then date) — never a score.

import { NOT_OVERDUE_STATUSES, isStrictYmd, israelTodayYmd } from "./project-deadline";
import { checkProposalFollowUps } from "./proposal-followups";
import { calcPeriodStats, type StatsTx } from "./finance";
import type { Proposal } from "@/components/clients/ProposalsSection";

export type NeedBadge = "החלטה" | "דחוף" | "פעולה" | "ממתין";
/** Fixed presentation order of the badge groups. */
export const NEED_BADGE_ORDER: readonly NeedBadge[] = ["החלטה", "דחוף", "פעולה", "ממתין"];
export const NEEDS_ME_VISIBLE = 5;
/** Owner decision 2026-09-30: an open task more than this many days overdue, with no update in as many days, is folded
 *  into ONE "משימות ישנות באיחור (N)" item (display aggregation only — the tasks themselves are never changed). */
export const STALE_TASK_DAYS = 14;
export const STALE_TASKS_KEY = "stale-tasks|TASK";

/** The business reason an item needs the Owner — the dedupe key is entity + reason. */
export type NeedReason = "DEADLINE" | "FOLLOWUP" | "TASK" | "OWNER_FEEDBACK" | "MONEY" | "RELEASE" | "QUESTION" | "OTHER";

export type OpenTarget =
  | { kind: "project"; id: string }
  | { kind: "client"; id: string }
  | { kind: "task"; id: string; title: string; dueDate: string | null }
  | { kind: "tasks"; tasks: { id: string; title: string; dueDate: string | null }[] }
  | { kind: "partner-actions" }
  | { kind: "partner-integrity" }
  | { kind: "href"; href: string }
  | { kind: "none" };

export interface RichPart { t: string; s?: true }

export interface NeedItem {
  key: string;
  entityKey: string;
  reason: NeedReason;
  badge: NeedBadge;
  title: string;
  context: RichPart[];
  /** YYYY-MM-DD the item is anchored to (for the in-group order); null = undated. */
  date: string | null;
  open: OpenTarget;
  /** Every source that surfaced this same entity + reason (dedupe evidence). */
  sources: string[];
}

// ── Input shapes (only the fields read here) ───────────────────────────────────
export interface CooEntityIn { type: string; id: string; name: string }
export interface CooSignalIn { type: string; role: string }
export interface CooCaseIn { id: string; entity: CooEntityIn; title: string; subtitle: string | null; tier: string; signals: CooSignalIn[]; summary: RichPart[] }
export interface PartnerActionIn { actionId: string; actionType: string; state: string; headlineHe: string; projectId?: string; projectName?: string; titleHe?: string; reasonHe?: string }
export interface IntegrityQuestionIn { questionId: string; subjectLabel: string; textHe: string }
export interface TaskIn { id: string; title?: string | null; status?: string | null; due_date?: string | null; start_time?: string | null; related_type?: string | null; related_id?: string | null; notes?: string | null; updated_at?: string | null }
export interface ProposalIn { id: string; title?: string | null; status?: string | null; amount?: number | null; currency?: string | null; followup_date?: string | null; client_id?: string | null; client_name?: string | null }

/** Tie-break between sources of the same entity + reason (most canonical first) — a display order, not a priority. */
const SOURCE_PRECEDENCE = ["partner-action", "integrity", "coo", "proposal", "task"];

const WAITING_OWNER = new Set(["STEVEN_WAITING_OWNER", "VICTOR_WAITING_OWNER", "VICTOR_DELIVERIES_WAITING_OWNER"]);

function reasonOfSignal(type: string): NeedReason {
  if (WAITING_OWNER.has(type)) return "OWNER_FEEDBACK";
  if (type === "PROPOSAL_FOLLOWUP_DUE") return "FOLLOWUP";
  if (type.startsWith("TASK")) return "TASK";
  if (type === "RELEASE_TARGET_APPROACHING") return "RELEASE";
  if (/DEADLINE|OVERDUE$|DUE_SOON/.test(type) && !type.startsWith("EXPECTED_INCOME")) return "DEADLINE";
  if (/PAYMENT|UNPAID|BALANCE|INCOME/.test(type)) return "MONEY";
  return "OTHER";
}

function openForEntity(e: CooEntityIn, proposals: readonly ProposalIn[]): OpenTarget {
  if (e.type === "project") return { kind: "project", id: e.id };
  if (e.type === "proposal") {
    const cid = proposals.find((p) => p.id === e.id)?.client_id;
    return cid ? { kind: "client", id: cid } : { kind: "href", href: "/clients" };
  }
  if (e.type === "show") return { kind: "href", href: "/shows" };
  if (e.type === "team") {
    const id = e.id.toLowerCase();
    if (id.includes("steven")) return { kind: "href", href: "/team/steven" };
    if (id.includes("victor")) return { kind: "href", href: "/team/victor" };
    return { kind: "href", href: "/team" };
  }
  return { kind: "none" };
}

/** A task created as a proposal follow-up carries a text marker in its notes (TEXT_MATCH, deterministic). */
const PROPOSAL_MARKER = /\[proposal_id:([0-9a-f-]{36})\]/i;

function addDaysYmd(ymd: string, n: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export interface NeedsMeInput {
  today?: string;
  cooCases: readonly CooCaseIn[] | null;
  partnerActions: readonly PartnerActionIn[] | null;
  integrityQuestions: readonly IntegrityQuestionIn[] | null;
  tasks: readonly TaskIn[] | null;
  proposals: readonly ProposalIn[] | null;
}

/**
 * The full "מה צריך ממני" list: deduplicated by entity + business reason, in the fixed badge order
 * (החלטה → דחוף → פעולה → ממתין), then by date (undated last), then title. A null source = not loaded.
 */
export function buildNeedsMe(input: NeedsMeInput): NeedItem[] {
  const today = input.today ?? israelTodayYmd();
  const proposals = input.proposals ?? [];
  const raw: NeedItem[] = [];
  const push = (it: Omit<NeedItem, "key" | "sources">, source: string) => {
    const entityKey = it.entityKey.toLowerCase();
    raw.push({ ...it, entityKey, key: `${entityKey}|${it.reason}`, sources: [source] });
  };

  // 1. Partner suggested actions waiting for the Owner's decision / execution.
  for (const a of input.partnerActions ?? []) {
    const isDeadline = a.actionType === "UPDATE_PROJECT_DEADLINE" && !!a.projectId;
    push({
      entityKey: isDeadline ? `project:${a.projectId}` : `partner-action:${a.actionId}`,
      reason: isDeadline ? "DEADLINE" : "MONEY",
      badge: "החלטה",
      title: isDeadline ? (a.projectName || "פרויקט") : (a.titleHe || "פעולה מוצעת"),
      context: [{ t: a.state === "AWAITING_EXECUTION" ? `אושר — ממתין לביצוע · ${a.headlineHe}` : a.headlineHe }],
      date: null,
      open: { kind: "partner-actions" },
    }, "partner-action");
  }

  // 2. Company Integrity questions ("צריך ממך").
  for (const q of input.integrityQuestions ?? []) {
    push({
      entityKey: `integrity:${q.questionId}`, reason: "QUESTION", badge: "החלטה",
      title: q.subjectLabel || "שאלה מסאני", context: [{ t: q.textHe }], date: null,
      open: { kind: "partner-integrity" },
    }, "integrity");
  }

  // 3. COO cases: P0 → דחוף; the ball is the Owner's (WAITING_OWNER) → ממתין. Company-level notices are skipped.
  for (const c of input.cooCases ?? []) {
    if (c.entity.type === "company") continue;
    const primary = c.signals.find((s) => s.role === "primary") ?? c.signals[0];
    const waiting = c.signals.some((s) => WAITING_OWNER.has(s.type));
    if (c.tier !== "P0" && !waiting) continue;
    const reason = waiting && c.tier !== "P0" ? "OWNER_FEEDBACK" : reasonOfSignal(primary?.type ?? "");
    push({
      entityKey: `${c.entity.type}:${c.entity.id}`, reason,
      badge: c.tier === "P0" ? "דחוף" : "ממתין",
      title: c.title || c.entity.name,
      context: c.summary.length ? c.summary : c.subtitle ? [{ t: c.subtitle }] : [],
      date: null,
      open: openForEntity(c.entity, proposals),
    }, "coo");
  }

  // 4. Open tasks due today (פעולה) or overdue (דחוף). Old overdue tasks with no recent update are folded (below).
  const staleCutoff = addDaysYmd(today, -STALE_TASK_DAYS);
  const staleTasks: TaskIn[] = [];
  for (const t of input.tasks ?? []) {
    if ((t.status ?? "פתוח") !== "פתוח" || !t.due_date || !isStrictYmd(t.due_date) || t.due_date > today) continue;
    const overdue = t.due_date < today;
    const marker = t.notes ? PROPOSAL_MARKER.exec(t.notes) : null;
    if (!marker && isStaleOverdueTask(t, staleCutoff)) { staleTasks.push(t); continue; }
    const entityKey = marker ? `proposal:${marker[1].toLowerCase()}` : `task:${t.id}`;
    push({
      entityKey, reason: marker ? "FOLLOWUP" : "TASK",
      badge: overdue ? "דחוף" : "פעולה",
      title: t.title || "משימה",
      context: [{ t: overdue ? `משימה באיחור · ${ymdShort(t.due_date)}` : `משימה להיום${t.start_time ? ` · ${t.start_time.slice(0, 5)}` : ""}` }],
      date: t.due_date,
      open: { kind: "task", id: t.id, title: t.title || "משימה", dueDate: t.due_date },
    }, "task");
  }

  // 5. Proposal follow-ups due (the app's own rule).
  const findings = checkProposalFollowUps(proposals.map((p) => ({
    ...p, title: p.title ?? "הצעה", amount: p.amount ?? 0, currency: p.currency ?? "₪",
  })) as unknown as Proposal[]);
  for (const f of findings) {
    const p = proposals.find((x) => x.id === f.proposalId);
    push({
      entityKey: `proposal:${f.proposalId.toLowerCase()}`, reason: "FOLLOWUP", badge: "פעולה",
      title: p?.client_name || f.title,
      context: [{ t: f.overdueDays > 0 ? `פולואפ להצעה · באיחור ${f.overdueDays} ימים` : "פולואפ להצעה · היום" }, ...(f.amount ? [{ t: " · " }, { t: `${f.currency}${f.amount.toLocaleString()}`, s: true as const }] : [])],
      date: f.followup_date,
      open: p?.client_id ? { kind: "client", id: p.client_id } : { kind: "href", href: "/clients" },
    }, "proposal");
  }

  // Dedupe: one item per entity + reason. The stronger badge wins; on a tie the more canonical source wins (a proposal
  // row beats a task that only names it in its notes). The earliest anchor date is kept; every source is evidence.
  const rank = (it: NeedItem) => NEED_BADGE_ORDER.indexOf(it.badge) * 10 + SOURCE_PRECEDENCE.indexOf(it.sources[0]);
  const groups = new Map<string, NeedItem[]>();
  for (const it of raw) groups.set(it.key, [...(groups.get(it.key) ?? []), it]);
  const byKey = new Map<string, NeedItem>();
  for (const [key, group] of groups) {
    const g = [...group].sort((x, y) => rank(x) - rank(y));
    const winner = g[0];
    const dates = g.map((x) => x.date).filter((d): d is string => !!d).sort();
    byKey.set(key, {
      ...winner,
      context: g.find((x) => x.context.length > 0)?.context ?? [],
      date: dates[0] ?? null,
      open: g.find((x) => x.open.kind !== "none")?.open ?? winner.open,
      sources: [...new Set(g.flatMap((x) => x.sources))],
    });
  }

  const sorted = [...byKey.values()].sort((a, b) =>
    NEED_BADGE_ORDER.indexOf(a.badge) - NEED_BADGE_ORDER.indexOf(b.badge)
    || (a.date ?? "9999-99-99").localeCompare(b.date ?? "9999-99-99")
    || a.title.localeCompare(b.title, "he"));

  // The folded old overdue tasks: ONE item, always last (never one of the first five by itself).
  if (staleTasks.length > 0) {
    const byDue = [...staleTasks].sort((a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? ""));
    sorted.push({
      key: STALE_TASKS_KEY, entityKey: "stale-tasks", reason: "TASK", badge: "דחוף",
      title: `משימות ישנות באיחור (${staleTasks.length})`,
      context: [{ t: `באיחור של יותר מ-${STALE_TASK_DAYS} ימים וללא עדכון מאז · הכי ישנה: ${ymdShort(byDue[0].due_date!)}` }],
      date: byDue[0].due_date ?? null,
      open: { kind: "tasks", tasks: byDue.map((t) => ({ id: t.id, title: t.title || "משימה", dueDate: t.due_date ?? null })) },
      sources: ["task"],
    });
  }
  return sorted;
}

/** Overdue by more than STALE_TASK_DAYS and not updated since the cutoff (a missing / unparseable update = not recent). */
function isStaleOverdueTask(t: TaskIn, cutoffYmd: string): boolean {
  if (!t.due_date || t.due_date >= cutoffYmd) return false;
  const ts = t.updated_at ? new Date(t.updated_at) : null;
  const updated = ts && !Number.isNaN(ts.getTime()) ? israelTodayYmd(ts) : null;
  return !updated || !isStrictYmd(updated) || updated < cutoffYmd;
}

// ── Timeline (today + 7 days) ──────────────────────────────────────────────────
export type TimelineKind = "session" | "shoot" | "rehearsal" | "show" | "meeting" | "deadline" | "task" | "event";

export interface TimelineItem {
  key: string;
  date: string;
  /** HH:MM, or null = all day / no time. */
  time: string | null;
  kind: TimelineKind;
  title: string;
  sub: string;
  open: OpenTarget;
}

export interface CalendarEventIn { id: string; title: string; type?: string; startTime: string; isAllDay?: boolean; location?: string; matchedProjectId?: string; context?: string }
export interface SessionIn { id: string; project_id?: string | null; show_id?: string | null; title?: string | null; date?: string | null; start_time?: string | null; status?: string | null; session_type?: string | null; location?: string | null; calendar_event_id?: string | null }
export interface ShowIn { id: string; name?: string | null; artist?: string | null; date?: string | null; start_time?: string | null; status?: string | null; location?: string | null; calendar_event_id?: string | null }
export interface ProjectIn { id: string; name: string; artist?: string | null; status: string; deadline?: string | null; isHidden?: boolean }

export const TIMELINE_DAYS = 7;

export interface TimelineInput {
  today?: string;
  calendar: readonly CalendarEventIn[] | null;
  sessions: readonly SessionIn[] | null;
  shows: readonly ShowIn[] | null;
  projects: readonly ProjectIn[];
  tasks: readonly TaskIn[] | null;
}

const SESSION_KIND: Record<string, TimelineKind> = { "צילום קליפ": "shoot", "חזרה": "rehearsal", "חזרה להופעה": "rehearsal" };
const CAL_KIND: Record<string, TimelineKind> = { "סשן": "session", "הופעה": "show", "חזרה": "rehearsal", "סאונדצ'ק": "show", "פגישה": "meeting" };

/**
 * Today + 7 days from the Redbloods records (sessions מתוכנן, shows not בוטל, project deadlines, open tasks) and the
 * Owner's Google Calendar. A calendar event whose id a session / show stores (the canonical link) is shown once — as
 * the Redbloods record. Sorted by date, then time (untimed first).
 */
export function buildTimeline(input: TimelineInput): TimelineItem[] {
  const today = input.today ?? israelTodayYmd();
  const end = addDaysYmd(today, TIMELINE_DAYS);
  const inWindow = (d: string | null | undefined): d is string => !!d && isStrictYmd(d) && d >= today && d <= end;
  const projName = (id: string | null | undefined) => (id ? input.projects.find((p) => p.id === id) : undefined);
  const items: TimelineItem[] = [];
  const linkedEventIds = new Set<string>();

  for (const s of input.sessions ?? []) {
    if (s.calendar_event_id) linkedEventIds.add(s.calendar_event_id);
    if (s.status !== "מתוכנן" || !inWindow(s.date)) continue;
    const p = projName(s.project_id);
    const type = s.session_type || "סשן";
    items.push({
      key: `session:${s.id}`, date: s.date, time: s.start_time ? s.start_time.slice(0, 5) : null,
      kind: SESSION_KIND[type] ?? "session",
      title: p ? [type, [p.artist, p.name].filter(Boolean).join(" — ")].join(" · ") : (s.title || type),
      sub: s.location || "",
      open: p ? { kind: "project", id: p.id } : s.show_id ? { kind: "href", href: "/shows" } : { kind: "href", href: "/tasks" },
    });
  }
  for (const sh of input.shows ?? []) {
    if (sh.calendar_event_id) linkedEventIds.add(sh.calendar_event_id);
    if (sh.status === "בוטל" || !inWindow(sh.date)) continue;
    items.push({
      key: `show:${sh.id}`, date: sh.date, time: sh.start_time ? sh.start_time.slice(0, 5) : null, kind: "show",
      title: `הופעה · ${sh.name || "הופעה"}`, sub: [sh.artist, sh.location].filter(Boolean).join(" · "),
      open: { kind: "href", href: "/shows" },
    });
  }
  for (const p of input.projects) {
    if (p.isHidden || NOT_OVERDUE_STATUSES.includes(p.status) || !inWindow(p.deadline)) continue;
    items.push({
      key: `deadline:${p.id}`, date: p.deadline, time: null, kind: "deadline",
      title: `דדליין · ${p.name}`, sub: p.artist || "", open: { kind: "project", id: p.id },
    });
  }
  for (const t of input.tasks ?? []) {
    if ((t.status ?? "פתוח") !== "פתוח" || !inWindow(t.due_date)) continue;
    items.push({
      key: `task:${t.id}`, date: t.due_date, time: t.start_time ? t.start_time.slice(0, 5) : null, kind: "task",
      title: t.title || "משימה", sub: "",
      open: { kind: "task", id: t.id, title: t.title || "משימה", dueDate: t.due_date },
    });
  }
  for (const ev of input.calendar ?? []) {
    if (linkedEventIds.has(ev.id)) continue;
    const date = ev.startTime.slice(0, 10);
    if (!inWindow(date)) continue;
    items.push({
      key: `cal:${ev.id}`, date, time: ev.isAllDay || ev.startTime.length <= 10 ? null : ev.startTime.slice(11, 16),
      kind: CAL_KIND[ev.type ?? ""] ?? "event",
      title: ev.title, sub: ev.location || "Google Calendar",
      open: ev.matchedProjectId ? { kind: "project", id: ev.matchedProjectId } : { kind: "none" },
    });
  }

  return items.sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? "").localeCompare(b.time ?? "") || a.title.localeCompare(b.title, "he"));
}

// ── Finance strip (the current month, the /finance formula) ────────────────────
export interface FinanceTxIn extends StatsTx { date?: string | null }
export interface FinanceMonthLine { currency: string; received: number; expected: number; payable: number }

/**
 * The /finance month window (getRange("month", 0) + inRange: local month start → month end, on `date`) and the SAME
 * calcPeriodStats. received = שולם / התקבל only; expected = the Finance "expected" statuses; payable = expected
 * expenses. בוטל counts nowhere. One line per currency (₪ first), never converted or added.
 */
export function financeMonth(txs: readonly FinanceTxIn[], now: Date = new Date()): FinanceMonthLine[] {
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
  const month = txs.filter((t) => { if (!t.date) return false; const d = new Date(t.date); return d >= from && d <= to; });
  const s = calcPeriodStats(month);
  const lines: FinanceMonthLine[] = [{ currency: "₪", received: s.incomeReceived, expected: s.incomeExpected, payable: s.expensesExpected }];
  for (const [cur, o] of Object.entries(s.other)) {
    if (o.incomeReceived || o.incomeExpected || o.expensesExpected) lines.push({ currency: cur, received: o.incomeReceived, expected: o.incomeExpected, payable: o.expensesExpected });
  }
  return lines;
}

// ── Releases ───────────────────────────────────────────────────────────────────
/** Display badge from the project type (a release is a label project). */
export function releaseBadge(projectType: string | null | undefined): string {
  if (projectType === "EP") return "EP";
  if (projectType === "אלבום") return "אלבום";
  if (projectType === "רידים") return "רידים";
  return "סינגל";
}

// ── Small display helpers ──────────────────────────────────────────────────────
export function ymdShort(ymd: string): string {
  return isStrictYmd(ymd) ? `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}` : ymd;
}

export function dayLabel(ymd: string, today: string = israelTodayYmd()): string {
  if (ymd === today) return "היום";
  if (ymd === addDaysYmd(today, 1)) return "מחר";
  const d = new Date(`${ymd}T12:00:00Z`);
  return `${d.toLocaleDateString("he-IL", { weekday: "long", timeZone: "UTC" })} ${ymdShort(ymd)}`;
}
