/**
 * Redbloods COO — Phase 1a configuration.
 *
 * EVERYTHING in here is PROVISIONAL. None of these numbers is a business truth:
 * the owner explicitly asked that thresholds (the 7-day "due soon", the 30-day
 * release window, workload limits, promotion/demotion between tiers) live in one
 * clear, separate place and be tuned together after a shadow run on production.
 *
 * Nothing here is stored in the DB. Changing a value is a code change.
 * An LLM never sets or changes anything in this file (Phase 1b would not either).
 */
import type { Tier } from "./types";

export type Cond = {
  daysOverdueGte?: number;   // overdue by at least N days
  daysToLte?: number;        // due in at most N days (0 = today)
  countGte?: number;         // aggregate count
  stuckGte?: number;         // aggregate: number of stuck items
  blockerPresent?: true;     // release has a blocker text
  past?: true;               // date already passed
  live?: true;               // the project shows live activity (see liveness.ts)
};

export interface TierRule {
  base: Tier;
  /** Overrides `base` by the entity's status (e.g. project status). */
  byStatus?: Record<string, Tier>;
  /** First matching entry that improves the tier wins, applied in order. */
  escalate?: Array<{ when: Cond; to: Tier }>;
  /** After escalation: an older / weaker fact moves the tier DOWN by N (never below P3) — a slope instead of a cliff. */
  demote?: Array<{ when: Cond; by: number }>;
  /** After escalation: the tier never goes above this for these statuses (e.g. a project that has not started). */
  capByStatus?: Record<string, Tier>;
}

export const COO_CONFIG = {
  version: "1a-provisional-4",
  provisional: true,

  // ── project statuses ──
  closedProjectStatuses: ["הושלם", "בוטל"] as string[],
  inactiveProjectStatuses: ["הושלם", "בוטל", "בהשהייה"] as string[],

  // ── windows (days) — PROVISIONAL ──
  dueSoonDays: 7,
  staleProjectDays: 30,          // "project not updated for N days" note on a case
  /** An active project (or an internal deadline of a Steven/Victor work) whose date passed this many days ago is STALE: metadata to refresh, not an alarm. No live activity rescues a project deadline; an internal deadline is kept (at P2, age never raises it) only with fresh upload evidence. */
  staleDeadlineDays: 30,
  releaseWindowDays: 30,
  weekWindowDays: 7,
  sessionWindowDays: 7,
  showUnpaidUpcomingDays: 14,
  monthsBack: 1,                 // current + previous month for money lines

  // ── "live activity" — a project somebody is working on now vs. one that only carries old metadata ──
  // A boolean list of signs, not a score. `updated_at` also moves on file uploads, so it says "live" but never proves that an old deadline is still valid.
  liveness: {
    updatedWithinDays: 14,     // project.updated_at this recent
    taskRecentDays: 14,        // a linked open task due within the last N days (or in the future)
  },

  // ── workload watch levels — PROVISIONAL ──
  stevenOpenWatch: 3,
  victorActiveWatch: 10,         // show the Victor backlog notice from this many active works
  victorAgeEdges: [7, 30, 60] as number[], // age buckets (days since sent): 0–7, 8–30, 31–60, 61+

  // The engineer name Steven's works are stored under (sound_engineer_work.engineer_name). Same value as
  // STEVEN_ENGINEER in lib/steven-scope.ts, which is a portal module and is deliberately not imported here.
  stevenEngineerName: "Steven",

  // Steven: closed = approved / cancelled. Mirrors isClosedStatus in lib/steven-mix-reminder-pure.ts
  // (not imported: that module pulls in portal code; scripts/test-coo.ts asserts they stay equal).
  stevenClosedStatuses: ["אושר", "בוטל"] as string[],

  // ── Victor: who holds the ball comes ONLY from timestamps (see victor-ball.ts), never from work_state ──
  victorBall: {
    tieSeconds: 60,            // upload/notes closer than this cannot be ordered → unknown (PROVISIONAL)
    ownerWaitingOldDays: 10,   // "waiting for the owner 10+ days" line in the brief
  },

  // ── statuses whose "ball is with the owner" (meaning to be confirmed with the owner) ──
  stevenOwnerBallStatuses: ["חזר"] as string[],
  // Steven statuses that say the work is still in his hands (used when an older mix version exists and we must decide if it was delivered).
  stevenBallWithHimStatuses: ["בתהליך"] as string[],

  // ── existing agent_alerts: secondary source only ──
  alerts: {
    allowTypes: ["week_understaffed", "upcoming_holiday"] as string[],
    maxAgeDays: 7,
  },

  // ── tier rules per signal type — PROVISIONAL ──
  tiers: {
    // Overdue project deadline. Slope, not a cliff: 1–13 days live=P0 / not live=P1; 14–29 days one tier lower; 30+ days = STALE (no signal here).
    PROJECT_OVERDUE:            { base: "P1", escalate: [{ when: { live: true }, to: "P0" }], demote: [{ when: { daysOverdueGte: 14 }, by: 1 }], capByStatus: { "לא התחיל": "P2" } },
    PROJECT_DUE_SOON:           { base: "P2", escalate: [{ when: { daysToLte: 3 }, to: "P1" }, { when: { daysToLte: 0 }, to: "P0" }], capByStatus: { "לא התחיל": "P2" } },
    STALE_PROJECT_DEADLINE:     { base: "P3" },                 // a notice: metadata to refresh, never P0/P1
    STALE_INTERNAL_DEADLINE:    { base: "P3" },
    TASK_OVERDUE:               { base: "P2" },
    TASKS_BACKLOG:              { base: "P3", escalate: [{ when: { countGte: 10 }, to: "P2" }] },
    STEVEN_WORKLOAD:            { base: "P3", escalate: [{ when: { countGte: 5 }, to: "P2" }] },
    // Steven: an open work whose internal deadline passed = P0; due within 2 days = P1; otherwise P2.
    // (a delivered / ambiguous work is capped in signals.ts; 15–29 days passed = one tier lower; 30+ = stale unless fresh upload)
    STEVEN_WORK_DEADLINE:       { base: "P2", escalate: [{ when: { daysToLte: 2 }, to: "P1" }, { when: { daysOverdueGte: 1 }, to: "P0" }], demote: [{ when: { daysOverdueGte: 15 }, by: 1 }] },
    STEVEN_UNPAID_APPROVED:     { base: "P2" },
    STEVEN_WAITING_OWNER:       { base: "P1" },
    // Victor: managerial info only (P2). P0/P1 need stronger evidence than a day count.
    VICTOR_WORKLOAD:            { base: "P2" },
    // Deliveries waiting for the owner: one managerial notice (never a card). Per project it is only a SUPPORTING signal
    // on a project that already has a case, or has a release in the window; it never creates a case and never P0.
    VICTOR_DELIVERIES_WAITING_OWNER: { base: "P2" },
    VICTOR_WAITING_OWNER:       { base: "P2", escalate: [{ when: { daysToLte: 14 }, to: "P1" }] },
    // P1 only while relatively fresh (1–14 days), the work is active and the ball is with Victor. Never P0.
    VICTOR_WORK_DEADLINE:       { base: "P2", escalate: [{ when: { daysOverdueGte: 1 }, to: "P1" }], demote: [{ when: { daysOverdueGte: 15 }, by: 1 }] },
    VICTOR_DEPENDENCY:          { base: "P1" },
    PROPOSAL_FOLLOWUP_DUE:      { base: "P1" },
    PROJECT_PAYMENT_BALANCE:    { base: "P2", byStatus: { "מחכה למיקס": "P1", "במיקס": "P1", "הושלם": "P1" } },
    BALANCE_NO_DUE_DATE:        { base: "P2" },
    EXPECTED_INCOME_OVERDUE:    { base: "P1" },                 // money alone is never P0
    SHOW_UNPAID_UPCOMING:       { base: "P2", escalate: [{ when: { daysToLte: 3 }, to: "P1" }] },
    SHOW_DONE_UNPAID:           { base: "P2", escalate: [{ when: { daysOverdueGte: 14 }, to: "P1" }] },
    NO_UPCOMING_SHOWS:          { base: "P3" },
    // A real release row with a target: priority follows proximity — it is NOT capped by the low global release coverage.
    RELEASE_TARGET_APPROACHING: { base: "P2", escalate: [{ when: { daysToLte: 14 }, to: "P1" }, { when: { blockerPresent: true }, to: "P1" }, { when: { daysToLte: 3 }, to: "P0" }, { when: { past: true }, to: "P0" }] },
    EXTERNAL_ALERT:             { base: "P3" },
  } satisfies Record<string, TierRule>,

  // ── ordering INSIDE a tier: lower class first, then facts (never "oldest first" alone) ──
  sortClass: { liveOverdue: 1, deadlineNear: 2, dependency: 3, release: 4, financial: 5, other: 6 },
  /** Which class each signal type belongs to. PROJECT_OVERDUE is "liveOverdue" only when the project shows live activity. */
  signalClass: {
    PROJECT_OVERDUE: "other", PROJECT_DUE_SOON: "deadlineNear", STALE_PROJECT_DEADLINE: "other", STALE_INTERNAL_DEADLINE: "other",
    TASK_OVERDUE: "other", TASKS_BACKLOG: "other",
    STEVEN_WORKLOAD: "other", STEVEN_WORK_DEADLINE: "deadlineNear", STEVEN_UNPAID_APPROVED: "financial", STEVEN_WAITING_OWNER: "dependency",
    VICTOR_WORKLOAD: "other", VICTOR_DELIVERIES_WAITING_OWNER: "dependency", VICTOR_WAITING_OWNER: "dependency", VICTOR_WORK_DEADLINE: "deadlineNear", VICTOR_DEPENDENCY: "dependency",
    PROPOSAL_FOLLOWUP_DUE: "dependency",
    PROJECT_PAYMENT_BALANCE: "financial", BALANCE_NO_DUE_DATE: "financial", EXPECTED_INCOME_OVERDUE: "financial",
    SHOW_UNPAID_UPCOMING: "financial", SHOW_DONE_UNPAID: "financial", NO_UPCOMING_SHOWS: "other",
    RELEASE_TARGET_APPROACHING: "release", EXTERNAL_ALERT: "other",
  } as Record<string, keyof typeof SORT_CLASS_KEYS>,

  // ── case-level promotion / demotion — PROVISIONAL ──
  caseRules: {
    /** A Case with 2+ independent PRIMARY signals moves up this many tiers (floor P0). */
    multiPrimaryPromoteBy: 1,
    /** Promotion for several independent primaries can make a "strong P1" but never a P0: P0 is rare and needs its own evidence. */
    promoteNotAbove: "P1" as Tier,
    /** These all describe the SAME thing (a date on the project / its work). They count as ONE independent primary when promoting a case. */
    deadlineFamily: ["PROJECT_OVERDUE", "PROJECT_DUE_SOON", "STEVEN_WORK_DEADLINE", "VICTOR_WORK_DEADLINE"] as string[],
    /** A Case made only of supporting signals never ranks above this tier. */
    supportingOnlyCap: "P2" as Tier,
    /** A signal whose OWN inputs are incomplete never ranks above this tier. This is about the case's own data quality — global coverage (e.g. "4 of 37 projects have a price") is shown but never lowers a tier. */
    lowCoverageCap: "P2" as Tier,
  },

  // ── what the Morning Brief shows — PROVISIONAL ──
  display: {
    maxCases: 5,               // cards shown from P0/P1 (the rest → "עוד N")
    minCasesShown: 3,          // if fewer than this in P0/P1, fill from P2
    weekItemsShown: 6,
    tiersCountedInHeadline: ["P0", "P1"] as Tier[],
  },
};

// (type helper for signalClass keys)
const SORT_CLASS_KEYS = { liveOverdue: 0, deadlineNear: 0, dependency: 0, release: 0, financial: 0, other: 0 } as const;

export type CooConfig = typeof COO_CONFIG;
