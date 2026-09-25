/**
 * Sunny System Awareness — WHOLE-SYSTEM INTEGRATION V1 (the company model).
 *
 * ONE Sunny over the whole company. This contract does NOT duplicate the domain contracts. It composes them:
 *   - the cross-domain graph and its relationship quality;
 *   - concept-specific source precedence;
 *   - the epistemic model;
 *   - attention semantics: every domain signal mapped to a nature + factual dimensions (no score);
 *   - the deterministic question planner;
 *   - end-to-end company workflows;
 *   - root-cause gap roots;
 *   - the future-primitive map;
 *   - repo-wide and production-wide coverage;
 *   - the knowledge-depth reconciliation;
 *   - what this mission discovered that earlier missions missed.
 * Pure data; served through company_view mode model. Semantic only: module paths and table names are internal
 * (test guards).
 */

export const COMPANY_BASELINE_VERSION = "2026.09.25-company-1";

// ── attention semantics ────────────────────────────────────────────────────────────────────────────────────────────
export type AttentionDimension = "TIME_SENSITIVE" | "MONEY_RELEVANT" | "OWNER_BLOCKING" | "EXTERNAL_PARTY_WAITING" | "CLIENT_COMMITMENT" | "LABEL_CONTINUITY" | "RELEASE_CONTEXT" | "SCHEDULED_EVENT" | "DATA_CONFLICT" | "SYSTEM_GAP";
export const ATTENTION_DIMENSIONS: readonly AttentionDimension[] = ["OWNER_BLOCKING", "CLIENT_COMMITMENT", "MONEY_RELEVANT", "TIME_SENSITIVE", "EXTERNAL_PARTY_WAITING", "SCHEDULED_EVENT", "LABEL_CONTINUITY", "RELEASE_CONTEXT", "DATA_CONFLICT", "SYSTEM_GAP"];
/** NEEDS_ATTENTION ≠ PROBLEM. INVESTMENT = a business decision (label spend), never a problem by itself. */
export type AttentionNature = "NEEDS_ATTENTION" | "PROBLEM" | "INVESTMENT" | "CONFLICT" | "CONTEXT" | "SYSTEM_GAP";
/** Whose next recorded move it appears to be — from evidence, never blame. */
export type AttentionSide = "OWNER" | "EXTERNAL" | "NONE" | "UNKNOWN";
type A = { nature: AttentionNature; dims: AttentionDimension[]; side: AttentionSide };
const a = (nature: AttentionNature, side: AttentionSide, ...dims: AttentionDimension[]): A => ({ nature, dims, side });

/** Every signal code any domain view emits → its company meaning. The whole-system test fails on an unmapped code. */
export const ATTENTION_MAP: Readonly<Record<string, A>> = {
  // handoff (Victor + Mix)
  WAITING_ON_OWNER: a("NEEDS_ATTENTION", "OWNER", "OWNER_BLOCKING"),
  VICTOR_WAITING_OWNER: a("NEEDS_ATTENTION", "OWNER", "OWNER_BLOCKING"),
  WAITING_FEEDBACK: a("NEEDS_ATTENTION", "OWNER", "OWNER_BLOCKING"),
  ENGINEER_RETURNED_WORK: a("NEEDS_ATTENTION", "OWNER", "OWNER_BLOCKING"),
  WAITING_ON_VICTOR: a("CONTEXT", "EXTERNAL", "EXTERNAL_PARTY_WAITING"),
  WAITING_ON_ENGINEER: a("CONTEXT", "EXTERNAL", "EXTERNAL_PARTY_WAITING"),
  WAITING_VERSION: a("CONTEXT", "EXTERNAL", "EXTERNAL_PARTY_WAITING"),
  WAITING_PRODUCTION: a("CONTEXT", "EXTERNAL", "EXTERNAL_PARTY_WAITING", "LABEL_CONTINUITY"),
  WAITING_MIX: a("CONTEXT", "EXTERNAL", "EXTERNAL_PARTY_WAITING", "LABEL_CONTINUITY"),
  AT_VICTOR: a("CONTEXT", "EXTERNAL", "EXTERNAL_PARTY_WAITING"),
  AT_ENGINEER: a("CONTEXT", "EXTERNAL", "EXTERNAL_PARTY_WAITING"),
  HANDOFF_UNKNOWN: a("CONTEXT", "UNKNOWN"),
  HANDOFF_CONFLICT: a("CONFLICT", "UNKNOWN", "DATA_CONFLICT"),
  INTERNAL_DEADLINE_PASSED: a("NEEDS_ATTENTION", "UNKNOWN", "TIME_SENSITIVE"),
  DRAFT_NOTES_NOT_SENT: a("NEEDS_ATTENTION", "OWNER", "OWNER_BLOCKING"),
  OPEN_COMMENTS: a("CONTEXT", "UNKNOWN"),
  // completion / files / vendor money
  COMPLETED_OPEN_COMMENTS: a("CONFLICT", "NONE", "DATA_CONFLICT"),
  COMPLETED_NO_FINAL_FILES: a("NEEDS_ATTENTION", "UNKNOWN", "DATA_CONFLICT"),
  FINAL_FILES_REQUEST_OPEN: a("CONTEXT", "EXTERNAL", "EXTERNAL_PARTY_WAITING"),
  COMPLETED_UNPAID: a("NEEDS_ATTENTION", "OWNER", "MONEY_RELEVANT"),
  PAYMENT_FINANCE_CONFLICT: a("CONFLICT", "NONE", "MONEY_RELEVANT", "DATA_CONFLICT"),
  EXPENSE_SCOPE_GENERAL: a("SYSTEM_GAP", "NONE", "SYSTEM_GAP"),
  ORPHAN_MIX_EXPENSE: a("CONFLICT", "OWNER", "MONEY_RELEVANT", "DATA_CONFLICT"),
  COMPLETED_NO_MIX_EVIDENCE: a("CONTEXT", "UNKNOWN"),
  MIX_STAGE_NO_ENGINEER: a("NEEDS_ATTENTION", "OWNER", "OWNER_BLOCKING"),
  PRODUCTION_DONE_NO_MIX: a("CONTEXT", "UNKNOWN", "LABEL_CONTINUITY"),
  NO_PROJECT_LINK: a("SYSTEM_GAP", "NONE", "SYSTEM_GAP"),
  NO_FILE_ENTRIES: a("CONTEXT", "UNKNOWN"),
  OPEN_PROJECT_CLOSED: a("CONFLICT", "NONE", "DATA_CONFLICT"),
  LABEL_WORK: a("CONTEXT", "NONE", "LABEL_CONTINUITY"),
  // video
  PRODUCTION_WITHOUT_PROJECT: a("SYSTEM_GAP", "NONE", "SYSTEM_GAP"),
  SHOOT_DATE_PASSED_NOT_SHOT: a("NEEDS_ATTENTION", "OWNER", "DATA_CONFLICT"),
  SHOOT_SESSION_HAPPENED_STATUS_STALE: a("CONFLICT", "OWNER", "DATA_CONFLICT"),
  PRODUCTION_STATUS_VS_PROJECT: a("CONFLICT", "OWNER", "DATA_CONFLICT"),
  CLIENT_SOURCE_MISLABELLED: a("SYSTEM_GAP", "NONE", "SYSTEM_GAP"),
  PLANNED_NOT_SPENT: a("INVESTMENT", "NONE"),
  RF_LEDGER_NOT_IN_FINANCE: a("CONFLICT", "OWNER", "MONEY_RELEVANT", "DATA_CONFLICT"),
  LINE_ACTUAL_VS_PAYMENTS: a("CONFLICT", "NONE", "DATA_CONFLICT"),
  MISSING_RECORDED_PREP: a("CONTEXT", "UNKNOWN"),
  DUPLICATE_PRODUCTIONS: a("SYSTEM_GAP", "NONE", "DATA_CONFLICT"),
  PROJECT_VIDEO_NO_PRODUCTION: a("CONTEXT", "UNKNOWN"),
  CLIP_ROW_PROMOTED_MISSING_TX: a("CONFLICT", "OWNER", "MONEY_RELEVANT", "DATA_CONFLICT"),
  CLIP_EXPENSE_UNPAID: a("NEEDS_ATTENTION", "OWNER", "MONEY_RELEVANT"),
  CLIP_EXPENSE_RECEIVED_STATUS: a("CONFLICT", "NONE", "MONEY_RELEVANT", "DATA_CONFLICT"),
  CLIP_DEAL_OPEN: a("NEEDS_ATTENTION", "EXTERNAL", "MONEY_RELEVANT"),
  CLIP_PLAN_VS_EXPENSE: a("CONFLICT", "NONE", "DATA_CONFLICT"),
  PUBLISHED_CONTENT_VS_PRODUCTION: a("CONFLICT", "NONE", "DATA_CONFLICT"),
  CLIP_IN_PRODUCTION: a("CONTEXT", "NONE"),
  // release / label continuity
  RELEASE_CONTEXT: a("CONTEXT", "NONE", "RELEASE_CONTEXT"),
  RELEASE_PLANNED: a("CONTEXT", "NONE", "RELEASE_CONTEXT", "LABEL_CONTINUITY"),
  RELEASED: a("CONTEXT", "NONE", "RELEASE_CONTEXT"),
  READY_FOR_RELEASE: a("CONTEXT", "NONE", "RELEASE_CONTEXT"),
  RELEASE_BLOCKER: a("NEEDS_ATTENTION", "UNKNOWN", "RELEASE_CONTEXT"),
  RELEASE_TARGET_PASSED: a("NEEDS_ATTENTION", "OWNER", "RELEASE_CONTEXT", "TIME_SENSITIVE"),
  LABEL_PROJECT_WITHOUT_RELEASE: a("NEEDS_ATTENTION", "OWNER", "LABEL_CONTINUITY"),
  NO_RELEASE_RECORDED: a("CONTEXT", "OWNER", "LABEL_CONTINUITY"),
  NO_UPCOMING_RECORDED_WORK: a("CONTEXT", "OWNER", "LABEL_CONTINUITY"),
  ACTIVE_WORK: a("CONTEXT", "NONE", "LABEL_CONTINUITY"),
  LABEL_CLASSIFICATION_UNCLEAR: a("NEEDS_ATTENTION", "OWNER", "DATA_CONFLICT"),
  // artist accounting / shows
  LEDGER_BALANCE: a("CONTEXT", "NONE", "MONEY_RELEVANT"),
  CYCLE_NOT_SET: a("SYSTEM_GAP", "OWNER", "SYSTEM_GAP"),
  SHOW_DONE_UNPAID: a("NEEDS_ATTENTION", "EXTERNAL", "MONEY_RELEVANT"),
  SHOW_WITHOUT_DJ: a("NEEDS_ATTENTION", "OWNER", "SCHEDULED_EVENT"),
  UPCOMING_SESSION: a("CONTEXT", "NONE", "SCHEDULED_EVENT"),
  UPCOMING_SHOW: a("CONTEXT", "NONE", "SCHEDULED_EVENT"),
  AVAILABILITY_THIS_WEEK: a("CONTEXT", "NONE", "SCHEDULED_EVENT"),
  IDENTITY_DUAL_ROLE: a("CONTEXT", "NONE"),
  IDENTITY_COLLABORATION: a("CONTEXT", "NONE"),
  COLLABORATION: a("CONTEXT", "NONE"),
  UPCOMING: a("CONTEXT", "NONE", "SCHEDULED_EVENT"),
  PIPELINE: a("CONTEXT", "OWNER", "MONEY_RELEVANT"),
  PRICE_MISSING: a("NEEDS_ATTENTION", "OWNER", "MONEY_RELEVANT"),
  UPCOMING_UNPAID: a("NEEDS_ATTENTION", "EXTERNAL", "MONEY_RELEVANT", "SCHEDULED_EVENT"),
  DONE_UNPAID: a("NEEDS_ATTENTION", "EXTERNAL", "MONEY_RELEVANT"),
  DONE_WITHOUT_LEDGER: a("CONFLICT", "OWNER", "MONEY_RELEVANT", "DATA_CONFLICT"),
  ARTIST_ROW_UNPAID_AFTER_DONE: a("NEEDS_ATTENTION", "OWNER", "MONEY_RELEVANT"),
  LEDGER_KEPT_AFTER_CANCEL: a("CONFLICT", "OWNER", "MONEY_RELEVANT", "DATA_CONFLICT"),
  DATE_PASSED_NOT_CLOSED: a("NEEDS_ATTENTION", "OWNER", "DATA_CONFLICT"),
  NO_DJ: a("NEEDS_ATTENTION", "OWNER", "SCHEDULED_EVENT"),
  DJ_AWAITING_CONFIRMATION: a("CONTEXT", "EXTERNAL", "EXTERNAL_PARTY_WAITING", "SCHEDULED_EVENT"),
  DJ_CONFIRMED: a("CONTEXT", "NONE", "SCHEDULED_EVENT"),
  DJ_CONFIRMED_BEFORE_CHANGE: a("CONFLICT", "EXTERNAL", "DATA_CONFLICT"),
  DJ_FEE_WITHOUT_DJ: a("CONFLICT", "OWNER", "MONEY_RELEVANT", "DATA_CONFLICT"),
  DJ_NOT_NOTIFIED: a("CONTEXT", "OWNER", "SCHEDULED_EVENT"),
  ARTIST_NOT_NOTIFIED: a("CONTEXT", "OWNER", "SCHEDULED_EVENT"),
  ARTIST_NOTIFIED_OUTDATED: a("CONTEXT", "OWNER", "SCHEDULED_EVENT"),
  NO_CALENDAR_EVENT: a("CONTEXT", "OWNER", "SCHEDULED_EVENT"),
  OPEN_SHOW_TASKS: a("CONTEXT", "OWNER", "SCHEDULED_EVENT"),
  REHEARSALS_RECORDED: a("CONTEXT", "NONE", "SCHEDULED_EVENT"),
  // clients / sales / projects
  ACTIVE_CLIENT_PROJECT: a("CONTEXT", "NONE", "CLIENT_COMMITMENT"),
  CLIENT_DEADLINE_APPROACHING: a("NEEDS_ATTENTION", "OWNER", "CLIENT_COMMITMENT", "TIME_SENSITIVE"),
  HISTORICAL_DEADLINE_DEBT: a("CONTEXT", "OWNER"),
  DEADLINE_PASSED: a("NEEDS_ATTENTION", "OWNER", "CLIENT_COMMITMENT", "TIME_SENSITIVE"),
  NO_DEADLINE: a("CONTEXT", "NONE"),
  DEAL_TERMS_UNKNOWN: a("SYSTEM_GAP", "OWNER", "MONEY_RELEVANT", "SYSTEM_GAP"),
  FOLLOW_UP_DUE: a("NEEDS_ATTENTION", "OWNER", "MONEY_RELEVANT", "TIME_SENSITIVE"),
  OPEN_PROPOSAL: a("CONTEXT", "EXTERNAL", "MONEY_RELEVANT"),
  OPEN_PROPOSAL_NO_FOLLOW_UP: a("NEEDS_ATTENTION", "OWNER", "MONEY_RELEVANT"),
  PROPOSAL_AMOUNT_DIFFERS_FROM_PRICE: a("CONFLICT", "NONE", "MONEY_RELEVANT", "DATA_CONFLICT"),
  PROPOSAL_CLOSED_WITHOUT_PROJECT: a("CONFLICT", "NONE", "DATA_CONFLICT"),
  PROPOSAL_CONVERTED: a("CONTEXT", "NONE"),
  RETURN_LATER: a("CONTEXT", "OWNER", "TIME_SENSITIVE"),
  UNKNOWN_PROPOSAL_STATUS: a("CONFLICT", "NONE", "DATA_CONFLICT"),
  MEETING_STATUS_NOT_UPDATED: a("CONTEXT", "OWNER", "DATA_CONFLICT"),
  MEETING_UPCOMING: a("CONTEXT", "NONE", "SCHEDULED_EVENT"),
  NO_RECENT_RECORDED_ACTIVITY: a("CONTEXT", "UNKNOWN"),
  PAYMENT_EVIDENCE_MISSING: a("NEEDS_ATTENTION", "OWNER", "MONEY_RELEVANT", "CLIENT_COMMITMENT"),
  RECEIVABLE_EXISTS: a("NEEDS_ATTENTION", "EXTERNAL", "MONEY_RELEVANT"),
  OUTSTANDING_CLIENT_MONEY: a("NEEDS_ATTENTION", "EXTERNAL", "MONEY_RELEVANT"),
  OVERPAYMENT: a("CONFLICT", "NONE", "MONEY_RELEVANT", "DATA_CONFLICT"),
  PRICE_UNKNOWN: a("SYSTEM_GAP", "OWNER", "MONEY_RELEVANT"),
  COMPLETED_DELIVERY_OPEN: a("NEEDS_ATTENTION", "OWNER", "CLIENT_COMMITMENT"),
  NO_SESSIONS: a("CONTEXT", "NONE"),
  STALE: a("CONTEXT", "UNKNOWN"),
  HIDDEN_PROJECT: a("CONTEXT", "NONE"),
  // sessions / tasks / meetings / albums / delivery / social (Full-Brain Completion)
  SESSION_TYPE_UNKNOWN: a("SYSTEM_GAP", "NONE", "SYSTEM_GAP"),
  SESSION_PASSED_STILL_PLANNED: a("NEEDS_ATTENTION", "OWNER", "DATA_CONFLICT"),
  SESSION_UPCOMING: a("CONTEXT", "NONE", "SCHEDULED_EVENT"),
  SESSION_NO_CALENDAR_EVENT: a("CONTEXT", "OWNER", "SCHEDULED_EVENT"),
  SESSION_CANCELLED_EVENT_KEPT: a("CONFLICT", "NONE", "DATA_CONFLICT", "SCHEDULED_EVENT"),
  REHEARSAL_STATUS_NOT_COUNTED: a("CONFLICT", "OWNER", "MONEY_RELEVANT", "DATA_CONFLICT"),
  SESSION_UNLINKED: a("SYSTEM_GAP", "NONE", "SYSTEM_GAP"),
  SESSION_EXPENSE_ORPHAN: a("CONFLICT", "OWNER", "MONEY_RELEVANT", "DATA_CONFLICT"),
  TASK_OVERDUE: a("NEEDS_ATTENTION", "OWNER", "TIME_SENSITIVE"),
  TASK_DUE_TODAY: a("NEEDS_ATTENTION", "OWNER", "TIME_SENSITIVE"),
  TASK_RELATED_MISSING: a("SYSTEM_GAP", "NONE", "SYSTEM_GAP"),
  TASK_LINK_DANGLING: a("SYSTEM_GAP", "NONE", "DATA_CONFLICT"),
  MEETING_PAST_STILL_SCHEDULED: a("CONTEXT", "OWNER", "DATA_CONFLICT"),
  MEETING_CANCELLED_EVENT_KEPT: a("CONFLICT", "NONE", "DATA_CONFLICT"),
  MEETING_CLIENT_NOT_FOUND: a("SYSTEM_GAP", "NONE", "SYSTEM_GAP"),
  MEETING_CLIENT_NAME_DRIFT: a("CONTEXT", "NONE"),
  ALBUM_NO_TRACKS: a("CONTEXT", "OWNER"),
  ALBUM_TRACK_STATUS_OUT_OF_VOCAB: a("SYSTEM_GAP", "NONE", "SYSTEM_GAP"),
  ALBUM_TRACK_MIX_UNLINKED: a("SYSTEM_GAP", "NONE", "DATA_CONFLICT"),
  COMPLETED_NO_DELIVERY_EVIDENCE: a("NEEDS_ATTENTION", "OWNER", "CLIENT_COMMITMENT"),
  DELIVERY_READY_NOT_MARKED: a("NEEDS_ATTENTION", "OWNER", "CLIENT_COMMITMENT"),
  DELIVERED_BALANCE_OPEN: a("NEEDS_ATTENTION", "EXTERNAL", "MONEY_RELEVANT"),
  SOCIAL_APP_CHECKLIST_FLAG: a("CONTEXT", "OWNER", "RELEASE_CONTEXT"),
  SOCIAL_CONTENT_OVERDUE: a("CONTEXT", "OWNER", "RELEASE_CONTEXT"),
  SOCIAL_RELEASE_DATE_DIFFERS: a("CONFLICT", "NONE", "DATA_CONFLICT", "RELEASE_CONTEXT"),
};

// ── cross-domain graph (semantic; never a fake DB link) ───────────────────────────────────────────────────────────
export type RelQuality = "CANONICAL_RELATION" | "OWNER_CONFIRMED_RELATION" | "DERIVED_RELATION" | "TEXT_MATCH" | "AMBIGUOUS" | "UNKNOWN";
export interface GraphEdge { from: string; to: string; quality: RelQuality; via: string; note?: string }
export const COMPANY_NODES = ["PROJECT", "CLIENT", "PROPOSAL", "LABEL_ARTIST", "RELEASE", "SHOW", "DJ", "SESSION", "MEETING", "TASK", "FINANCE_TRANSACTION", "ARTIST_LEDGER", "BALANCE_CYCLE", "MEDIA_INCOME", "VICTOR_WORK", "MIX_WORK", "MIX_VERSION", "MIX_COMMENT", "FINAL_FILE", "RED_FILMS_PRODUCTION", "CLIP_DEAL", "CLIP_ITEM", "SHOOT_SESSION", "SOCIAL", "CALENDAR_EVENT", "OWNER_KNOWLEDGE", "OWNER_CONTEXT", "SUNNY_ACTION", "SUNNY_OUTCOME", "NOTIFICATION", "AGENT_ALERT", "BEAT", "DELIVERY", "PORTAL_USER"] as const;
const E = (from: string, to: string, quality: RelQuality, via: string, note?: string): GraphEdge => ({ from, to, quality, via, ...(note ? { note } : {}) });
export const COMPANY_GRAPH: readonly GraphEdge[] = [
  E("PROPOSAL", "CLIENT", "CANONICAL_RELATION", "client_view"), E("PROPOSAL", "PROJECT", "CANONICAL_RELATION", "client_view", "the proposal chain (converted proposals)"),
  E("PROJECT", "CLIENT", "TEXT_MATCH", "client_view", "project ↔ client is a name match outside the proposal chain"),
  E("PROJECT", "LABEL_ARTIST", "TEXT_MATCH", "artist_view", "artist credits are text; the roster is matched by name"),
  E("RELEASE", "PROJECT", "CANONICAL_RELATION", "artist_view"), E("RELEASE", "LABEL_ARTIST", "CANONICAL_RELATION", "artist_view"),
  E("SHOW", "LABEL_ARTIST", "CANONICAL_RELATION", "show_view", "artist client id"), E("SHOW", "DJ", "CANONICAL_RELATION", "show_view", "per show; the label DJ is OWNER_CONFIRMED knowledge, never auto-assigned"),
  E("SHOW", "ARTIST_LEDGER", "CANONICAL_RELATION", "show_view", "show → ledger rows (sync paths)"), E("SHOW", "FINANCE_TRANSACTION", "CANONICAL_RELATION", "show_view"),
  E("ARTIST_LEDGER", "LABEL_ARTIST", "CANONICAL_RELATION", "artist_view"), E("BALANCE_CYCLE", "LABEL_ARTIST", "CANONICAL_RELATION", "artist_view"), E("MEDIA_INCOME", "LABEL_ARTIST", "CANONICAL_RELATION", "artist_view"),
  E("SESSION", "PROJECT", "CANONICAL_RELATION", "project_view"), E("SESSION", "CALENDAR_EVENT", "CANONICAL_RELATION", "calendar", "stored event id"),
  E("MEETING", "CLIENT", "CANONICAL_RELATION", "client_view"), E("MEETING", "PROJECT", "CANONICAL_RELATION", "project_view"), E("MEETING", "CALENDAR_EVENT", "CANONICAL_RELATION", "calendar"),
  E("TASK", "PROJECT", "CANONICAL_RELATION", "project_view", "related type + id"), E("TASK", "RED_FILMS_PRODUCTION", "CANONICAL_RELATION", "video_view"), E("TASK", "SHOW", "CANONICAL_RELATION", "show_view"),
  E("FINANCE_TRANSACTION", "PROJECT", "CANONICAL_RELATION", "finance / project_view"), E("FINANCE_TRANSACTION", "SESSION", "CANONICAL_RELATION", "video_view", "linked session (shoot expense)"),
  E("VICTOR_WORK", "PROJECT", "CANONICAL_RELATION", "victor_view", "nullable — most works have no project"), E("VICTOR_WORK", "TASK", "CANONICAL_RELATION", "victor_view"),
  E("MIX_WORK", "PROJECT", "CANONICAL_RELATION", "mix_view"), E("MIX_VERSION", "MIX_WORK", "CANONICAL_RELATION", "mix_view"), E("MIX_COMMENT", "MIX_VERSION", "CANONICAL_RELATION", "mix_view"),
  E("FINAL_FILE", "MIX_WORK", "CANONICAL_RELATION", "mix_view"), E("FINAL_FILE", "PROJECT", "CANONICAL_RELATION", "mix_view"), E("MIX_WORK", "FINANCE_TRANSACTION", "CANONICAL_RELATION", "mix_view", "one linked expense, two writers"),
  E("VICTOR_WORK", "MIX_WORK", "UNKNOWN", "—", "no production → mix handoff record; only same-project evidence"),
  E("RED_FILMS_PRODUCTION", "PROJECT", "CANONICAL_RELATION", "video_view"), E("RED_FILMS_PRODUCTION", "CLIENT", "TEXT_MATCH", "video_view", "artist name → client, stored as an id"),
  E("CLIP_DEAL", "PROJECT", "CANONICAL_RELATION", "video_view"), E("CLIP_ITEM", "PROJECT", "CANONICAL_RELATION", "video_view"), E("CLIP_ITEM", "FINANCE_TRANSACTION", "CANONICAL_RELATION", "video_view", "older rows only; today the row is deleted on transfer"),
  E("SHOOT_SESSION", "PROJECT", "CANONICAL_RELATION", "video_view"), E("SHOOT_SESSION", "RED_FILMS_PRODUCTION", "DERIVED_RELATION", "video_view", "same project only — not linked"),
  E("RED_FILMS_PRODUCTION", "ARTIST_LEDGER", "TEXT_MATCH", "artist_view", "the recoup matches the artist by name on the planned budget"),
  E("SOCIAL", "PROJECT", "CANONICAL_RELATION", "project_view"), E("SOCIAL", "RED_FILMS_PRODUCTION", "DERIVED_RELATION", "video_view", "same project only"),
  E("DELIVERY", "PROJECT", "CANONICAL_RELATION", "deliveries"), E("BEAT", "LABEL_ARTIST", "CANONICAL_RELATION", "artist_view"),
  E("OWNER_KNOWLEDGE", "PROJECT", "OWNER_CONFIRMED_RELATION", "owner_knowledge"), E("OWNER_KNOWLEDGE", "LABEL_ARTIST", "OWNER_CONFIRMED_RELATION", "owner_knowledge"), E("OWNER_KNOWLEDGE", "DJ", "OWNER_CONFIRMED_RELATION", "owner_knowledge"),
  E("OWNER_CONTEXT", "FINANCE_TRANSACTION", "OWNER_CONFIRMED_RELATION", "finance"), E("SUNNY_ACTION", "PROJECT", "CANONICAL_RELATION", "actions"), E("SUNNY_OUTCOME", "SUNNY_ACTION", "CANONICAL_RELATION", "outcomes"),
  E("NOTIFICATION", "PROJECT", "CANONICAL_RELATION", "project_view", "weekly deleted — not durable history"), E("AGENT_ALERT", "PROJECT", "CANONICAL_RELATION", "project_view"),
  E("PORTAL_USER", "LABEL_ARTIST", "CANONICAL_RELATION", "people"), E("CALENDAR_EVENT", "PROJECT", "DERIVED_RELATION", "calendar", "unlinked events are INFERRED only; personal events are never business facts"),
];

// ── source precedence (per concept — never one universal rule) ───────────────────────────────────────────────────
export const SOURCE_PRECEDENCE: ReadonlyArray<{ concept: string; canonical: string; secondary: string; onConflict: string }> = [
  { concept: "actual business money", canonical: "Finance transactions (שולם / התקבל income; שולם expense)", secondary: "work-level paid flags, Red Films ledger, salary overrides, Owner context", onConflict: "CONFLICTING_SOURCES — show both; Finance is canonical for realized money; never merge" },
  { concept: "project state", canonical: "the project record", secondary: "production / mix / video / release states", onConflict: "show each state; never force one lifecycle" },
  { concept: "live calendar event details", canonical: "Google Calendar (live read)", secondary: "stored event ids on records", onConflict: "an unreadable calendar = UNKNOWN, never empty" },
  { concept: "policy / meaning", canonical: "Owner-confirmed rules (operating model)", secondary: "system contracts (implementation behavior)", onConflict: "Owner policy outranks an implementation assumption; the gap is reported" },
  { concept: "real-world facts the tables lack", canonical: "typed Owner knowledge (P2, active, not superseded / withdrawn)", secondary: "—", onConflict: "live canonical entity state wins for that entity; knowledge stays context" },
  { concept: "who holds the next move", canonical: "the domain evidence rule (uploads vs feedback times; send logs)", secondary: "statuses, send logs", onConflict: "CONFLICTING_EVIDENCE — ask, never blame; outside communication is invisible" },
  { concept: "artist accounting", canonical: "UNDECIDED — ledger, cycles, media recoup and clip recoup are separate views", secondary: "—", onConflict: "OWNER_DECISION_REQUIRED; never sum" },
  { concept: "vendor payment", canonical: "Finance expense שולם", secondary: "work paid fields, salary overrides, Red Films payments", onConflict: "CONFLICTING_SOURCES" },
];

export const EPISTEMIC_MODEL = ["FACT", "DERIVED", "OWNER_DECISION", "OWNER_REPORTED", "OWNER_POLICY_CANDIDATE", "HYPOTHESIS", "GENERAL_KNOWLEDGE", "OBSERVATION", "PATTERN_CANDIDATE", "UNKNOWN"] as const;

// ── deterministic question planner ────────────────────────────────────────────────────────────────────────────────
export type CompanySection = "executive" | "attention" | "cashflow" | "client_work" | "sales" | "label" | "releases" | "shows" | "production" | "mix" | "video" | "calendar" | "team" | "decisions" | "conflicts" | "gaps" | "changes" | "outcomes" | "delivery" | "friction" | "morning_brief";
export const QUESTION_PLANNER: ReadonlyArray<{ id: string; patterns: string[]; sections: CompanySection[] }> = [
  { id: "WHAT_NOW", patterns: ["מה אני צריך לעשות", "מה לעשות עכשיו", "מה לעשות היום", "what should i do"], sections: ["calendar", "attention", "client_work", "cashflow", "releases", "decisions"] },
  { id: "COMPANY_STATE", patterns: ["מה מצב החברה", "מה קורה בחברה", "company state"], sections: ["executive", "cashflow", "client_work", "sales", "label", "releases", "team", "conflicts"] },
  { id: "STUCK", patterns: ["מה תקוע", "תקוע"], sections: ["attention", "conflicts", "decisions", "gaps"] },
  { id: "MONEY", patterns: ["מה עם הכסף", "איפה כסף תקוע", "כסף", "תזרים", "cashflow"], sections: ["cashflow", "conflicts"] },
  { id: "LABEL", patterns: ["מה עם הלייבל", "לייבל", "אמני לייבל"], sections: ["label", "releases", "mix", "production", "video", "shows"] },
  { id: "WAITING_ON_ME", patterns: ["מה מחכה לי"], sections: ["attention", "decisions"] },
  { id: "WAITING_ON_OTHERS", patterns: ["מה מחכה לאנשים אחרים", "מחכה לאחרים"], sections: ["team", "attention"] },
  { id: "RELEASES", patterns: ["ריליס", "ריליסים"], sections: ["releases"] },
  { id: "CONFLICTS", patterns: ["סותרים", "סתירות", "conflict"], sections: ["conflicts"] },
  { id: "UNKNOWN", patterns: ["מה המערכת לא יודעת", "לא יודע", "unknown"], sections: ["gaps"] },
  { id: "IMPROVE", patterns: ["מה כדאי לשפר", "לשפר במערכת", "improve"], sections: ["friction", "gaps"] },
  { id: "CALENDAR", patterns: ["יומן", "התחייבויות קרובות", "calendar"], sections: ["calendar"] },
  { id: "DELIVERY", patterns: ["מסירה", "delivery"], sections: ["delivery"] },
];

// ── end-to-end company workflows ───────────────────────────────────────────────────────────────────────────────────
export interface WorkflowStage { stage: string; recorded: "RECORDED" | "PARTIAL" | "NOT_RECORDED"; automation: "AUTOMATIC" | "MANUAL" | "NONE"; readVia: string; note?: string }
const W = (stage: string, recorded: WorkflowStage["recorded"], automation: WorkflowStage["automation"], readVia: string, note?: string): WorkflowStage => ({ stage, recorded, automation, readVia, ...(note ? { note } : {}) });
export const COMPANY_WORKFLOWS: Readonly<Record<string, readonly WorkflowStage[]>> = {
  CLIENT_PROJECT: [W("lead / opportunity", "PARTIAL", "MANUAL", "client_view", "a client record; no lead entity"), W("proposal", "RECORDED", "MANUAL", "client_view"), W("conversion", "RECORDED", "MANUAL", "client_view", "the proposal chain"), W("project", "RECORDED", "MANUAL", "project_view"),
    W("deal terms", "PARTIAL", "MANUAL", "project_view:money", "agreed price only; terms / schedule not modelled"), W("advance", "PARTIAL", "MANUAL", "operating_model", "evidence = a received income; absence ≠ unpaid"), W("production (Victor / studio sessions)", "RECORDED", "MANUAL", "victor_view / project_view"),
    W("mix / master", "RECORDED", "MANUAL", "mix_view", "handoff from production not recorded"), W("video (if any)", "RECORDED", "MANUAL", "video_view"), W("delivery", "PARTIAL", "MANUAL", "deliveries", "a delivery folder + status; not linked to final files"),
    W("remaining payment", "RECORDED", "MANUAL", "finance_receivables"), W("completion", "RECORDED", "MANUAL", "project_view", "status הושלם (Steven's last work can set it)")],
  LABEL_SONG: [W("label artist", "RECORDED", "MANUAL", "artist_view"), W("project", "RECORDED", "MANUAL", "artist_view", "artist credits are text"), W("production", "RECORDED", "MANUAL", "victor_view"), W("mix", "RECORDED", "MANUAL", "mix_view"),
    W("release planning", "PARTIAL", "MANUAL", "artist_view", "release row, stage, target; no readiness / cadence policy"), W("video / content (optional)", "PARTIAL", "MANUAL", "video_view"), W("release", "PARTIAL", "MANUAL", "artist_view", "released date; no stage history"),
    W("shows / media", "RECORDED", "MANUAL", "show_view / artist_view"), W("artist accounting / recoup", "PARTIAL", "MANUAL", "artist_view:money", "several unreconciled views")],
  SHOW: [W("opportunity / quote", "RECORDED", "MANUAL", "show_view", "pipeline statuses + quote follow-up"), W("confirmation", "RECORDED", "MANUAL", "show_view"), W("DJ", "RECORDED", "MANUAL", "show_view", "per show; DJ confirms in his portal"),
    W("rehearsals", "RECORDED", "MANUAL", "show_view"), W("calendar", "RECORDED", "AUTOMATIC", "calendar"), W("notifications", "RECORDED", "MANUAL", "show_view"), W("performance", "PARTIAL", "MANUAL", "show_view", "status בוצע"),
    W("client payment", "RECORDED", "AUTOMATIC", "show_view", "finance sync"), W("artist / DJ / label accounting", "PARTIAL", "AUTOMATIC", "show_view", "ledger sync paths with known inconsistencies"), W("close", "PARTIAL", "MANUAL", "show_view")],
  VIDEO: [W("clip deal / production", "RECORDED", "MANUAL", "video_view", "two systems"), W("planning / budget", "RECORDED", "MANUAL", "video_view"), W("crew", "PARTIAL", "MANUAL", "video_view", "free-text names"), W("shoot", "RECORDED", "MANUAL", "video_view", "session + production date, not linked"),
    W("expenses", "PARTIAL", "MANUAL", "video_view", "Red Films ledger vs Finance"), W("edit / review / final", "PARTIAL", "MANUAL", "video_view", "links + edit status"), W("publication / release context", "PARTIAL", "MANUAL", "video_view")],
  VENDOR: [W("assignment", "RECORDED", "MANUAL", "victor_view / mix_view"), W("work", "RECORDED", "MANUAL", "victor_view / mix_view"), W("handoff", "PARTIAL", "MANUAL", "victor_view / mix_view", "evidence rules; outside communication invisible"), W("feedback", "RECORDED", "MANUAL", "victor_view / mix_view"),
    W("completion", "RECORDED", "MANUAL", "victor_view / mix_view", "no approval record"), W("final materials", "PARTIAL", "MANUAL", "mix_view", "final files (mix only)"), W("payment", "PARTIAL", "MANUAL", "victor_view:money / mix_view:money", "salary vs per-work; several writers"), W("outcome", "NOT_RECORDED", "NONE", "—")],
};

// ── root-cause gap roots (dedupe — each domain gap belongs to exactly one root) ───────────────────────────────────
export type GapRoot = "IDENTITY" | "HISTORY" | "MONEY" | "WORKFLOW" | "FILES_STORAGE" | "COMMUNICATION" | "APPROVAL" | "DELIVERY" | "INTEGRATION" | "SECURITY" | "ACTION_PRIMITIVE" | "OWNER_POLICY";
export const GAP_ROOTS: Readonly<Record<GapRoot, { problemHe: string; productFix: string }>> = {
  IDENTITY: { problemHe: "אנשים וישויות מזוהים לפי שם (אמן, לקוח, מהנדס, צוות) — אין מזהה אחד", productFix: "person / engineer / crew records and id links instead of names" },
  HISTORY: { problemHe: "אין היסטוריית שינויים (סטטוסים, שלבים, תשלומים) — רק מצב נוכחי וזמן עדכון", productFix: "a change log per entity" },
  MONEY: { problemHe: "כסף רשום בכמה מקומות שלא מסונכרנים (כספים, פנקס Red Films, דגלי תשלום, overrides, כמה תצוגות חשבון אמן)", productFix: "one canonical money writer per concept" },
  WORKFLOW: { problemHe: "מעברים בין שלבים לא נרשמים (הפקה → מיקס, סיום צילום, מסירה)", productFix: "explicit handoff / transition records" },
  FILES_STORAGE: { problemHe: "האחסון עצמו לא נקרא — רק רישומים וקישורים", productFix: "an Owner-approved read-only storage listing" },
  COMMUNICATION: { problemHe: "תקשורת מחוץ למערכת (וואטסאפ, טלפון) לא נרשמת", productFix: "a light 'contact logged' action" },
  APPROVAL: { problemHe: "אין רשומות אישור (מיקס, גרסת וידאו)", productFix: "approval events" },
  DELIVERY: { problemHe: "מסירה ללקוח ופרסום לא מקושרים לקבצים הסופיים", productFix: "a delivery record linked to final files / publication" },
  INTEGRATION: { problemHe: "חיבורים חיצוניים עם יכולות חלקיות (יומן, דרופבוקס)", productFix: "approved read primitives" },
  SECURITY: { problemHe: "ממצאי אבטחה פתוחים (proxy בלבד, קישורים ציבוריים, callback, RLS)", productFix: "separate approved remediation missions" },
  ACTION_PRIMITIVE: { problemHe: "רוב הפעולות העסקיות עוד לא זמינות לסאני כפעולה מאושרת", productFix: "typed primitives with preview + approval" },
  OWNER_POLICY: { problemHe: "החלטות מדיניות שרק הבעלים יכול לקבוע (חשבון אמן, קצב ריליסים, מוכנות, תעריפים)", productFix: "an Owner decision recorded as policy" },
};
/** Deterministic gap → root assignment (class first, id overrides). The test proves every registered gap has a root. */
export function gapRootOf(g: { id: string; class: string; appRemediation?: string }): GapRoot {
  const id = g.id;
  if (/SECUR|PORTAL_FILE|PROXY|RLS|OAUTH/.test(id) || g.appRemediation === "SECURITY_FIX") return "SECURITY";
  if (/STORAGE|DROPBOX|LISTING|FILES_NOT/.test(id)) return "FILES_STORAGE";
  if (/DELIVERY|PUBLICATION/.test(id)) return "DELIVERY";
  if (/APPROVAL/.test(id)) return "APPROVAL";
  if (/OUTSIDE|COMMUNICATION|NOTES_SENT/.test(id)) return "COMMUNICATION";
  if (/HISTORY|STALE_STATUS|NOT_RECORDED_HISTORY/.test(id)) return "HISTORY";
  if (/CALENDAR|INTEGRATION|GOOGLE/.test(id)) return "INTEGRATION";
  if (/ACTIONS_NOT_EXECUTABLE|PRIMITIVE/.test(id) || g.class === "FUTURE_PRIMITIVE_REQUIRED") return "ACTION_PRIMITIVE";
  if (g.class === "AMBIGUOUS_IDENTITY" || /IDENTITY|NAME|CREW|CLIENT_ID|ENGINEER_IDENTITY|TEXT_MATCH|ROSTER/.test(id)) return "IDENTITY";
  if (g.class === "OWNER_DECISION_REQUIRED" || g.appRemediation === "OWNER_DECISION") return "OWNER_POLICY";
  if (/MONEY|PAY|SALARY|LEDGER|FINANCE|EXPENSE|CURRENCY|RECOUP|PRICE|BALANCE|WRITER|CLIP_PROMOTE|INCOME/.test(id) || g.class === "CONFLICTING_SOURCES") return "MONEY";
  if (g.class === "DATA_NOT_RECORDED") return "HISTORY";
  return "WORKFLOW";
}

// ── future Sunny "hands" (NOT implemented) ─────────────────────────────────────────────────────────────────────────
export type PrimitiveRisk = "LOW" | "NORMAL" | "FINANCIAL" | "EXTERNAL_COMMUNICATION" | "DESTRUCTIVE" | "SECURITY_SENSITIVE";
export const FUTURE_PRIMITIVES: ReadonlyArray<{ id: string; workflow: string; risk: PrimitiveRisk; note: string }> = [
  { id: "LOG_OUTSIDE_CONTACT", workflow: "any handoff", risk: "LOW", note: "record that a WhatsApp / call happened — closes the biggest blind spot" },
  { id: "CREATE_TASK", workflow: "project / show / production", risk: "LOW", note: "tasks already exist with canonical relations" },
  { id: "UPDATE_PROJECT_STATUS", workflow: "project", risk: "NORMAL", note: "side effects: Steven / Victor completion interplay" },
  { id: "CREATE_PROJECT", workflow: "client project / label song", risk: "NORMAL", note: "" },
  { id: "CREATE_PROPOSAL / PROPOSAL_FOLLOW_UP", workflow: "sales", risk: "NORMAL", note: "" },
  { id: "CREATE_SESSION / SCHEDULE_SHOOT", workflow: "sessions / video", risk: "EXTERNAL_COMMUNICATION", note: "creates a Google Calendar event" },
  { id: "CREATE_SHOW / ASSIGN_SHOW_DJ", workflow: "show", risk: "EXTERNAL_COMMUNICATION", note: "DJ / artist notifications, calendar" },
  { id: "ASSIGN_MIX_ENGINEER / SEND_MIX_JOB / SEND_MIX_NOTES", workflow: "mix", risk: "EXTERNAL_COMMUNICATION", note: "pushes Steven" },
  { id: "SEND_TO_VICTOR / SEND_VICTOR_NOTES", workflow: "production", risk: "EXTERNAL_COMMUNICATION", note: "pushes Victor" },
  { id: "RECORD_CLIENT_PAYMENT / RECORD_ENGINEER_PAYMENT / RECORD_VIDEO_EXPENSE", workflow: "money", risk: "FINANCIAL", note: "one canonical writer per concept first" },
  { id: "CREATE_CLIP_ITEM / PROMOTE_CLIP_PLAN", workflow: "video", risk: "FINANCIAL", note: "promote deletes the plan today" },
  { id: "DELETE_* (work / version / production / file)", workflow: "any", risk: "DESTRUCTIVE", note: "typed confirmation; never bulk" },
  { id: "ROLE / ACCESS changes", workflow: "platform", risk: "SECURITY_SENSITIVE", note: "Owner-only, never delegated" },
];
export const EXECUTABLE_TODAY = ["UPDATE_PROJECT_DEADLINE (Owner-approved in the dashboard)", "RECORD_PAID_EXPENSE (Victor salary month, Owner-approved in the dashboard)"] as const;
export const APPROVAL_MODEL = ["read = no approval", "durable Owner knowledge: preview → explicit confirmation → commit", "business mutation: suggest → preview → explicit approval → execute → fresh re-read → outcome", "financial: strong confirmation", "destructive: strongest confirmation; never implicit / bulk"] as const;

// ── repo → Sunny coverage (every non-partner lib module) ─────────────────────────────────────────────────────────────
export type ModuleClass = "DOMAIN_OWNED" | "CROSS_DOMAIN" | "INFRASTRUCTURE" | "SECRET_SECURITY" | "LEGACY" | "UI_ONLY";
export const REPO_COVERAGE: ReadonlyArray<{ pattern: string; cls: ModuleClass; domain: string; note: string }> = [
  { pattern: "^lib/(vendor-|victor-)", cls: "DOMAIN_OWNED", domain: "VICTOR", note: "Victor store / scope / notify / salary / i18n" },
  { pattern: "^lib/(sound-engineer|mix-|final-file|steven-|riddim-|owner-steven)", cls: "DOMAIN_OWNED", domain: "MIX_PIPELINE / STEVEN", note: "" },
  { pattern: "^lib/(clip-|label-clips)", cls: "DOMAIN_OWNED", domain: "CLIPS / RED_FILMS", note: "" },
  { pattern: "^lib/production-layout", cls: "UI_ONLY", domain: "RED_FILMS", note: "production page section order" },
  { pattern: "^lib/(label-|artist-balance|media-income|beat|release-store|red-artists/)", cls: "DOMAIN_OWNED", domain: "LABEL_ARTISTS / ARTIST_PORTALS", note: "" },
  { pattern: "^lib/(release-candidates|dashboard-releases|release-calendar)", cls: "CROSS_DOMAIN", domain: "RELEASES", note: "the 'add release' candidate rule (label-credited, releasable type, no release row) — reused by the company label review" },
  { pattern: "^lib/(show|shows-|dj-)", cls: "DOMAIN_OWNED", domain: "SHOWS / LABEL_DJ", note: "" },
  { pattern: "^lib/(shalev-|avi-|cleantone-)", cls: "DOMAIN_OWNED", domain: "ARTIST_PORTALS", note: "portal reminders / presence" },
  { pattern: "^lib/(clients-store)", cls: "DOMAIN_OWNED", domain: "CLIENTS", note: "" },
  { pattern: "^lib/(projects-|project-|payment-status)", cls: "DOMAIN_OWNED", domain: "PROJECTS", note: "" },
  { pattern: "^lib/(sessions-store|session-|schedule-rules)", cls: "DOMAIN_OWNED", domain: "SESSIONS", note: "schedule-rules hard-codes Sun–Thu 10:00–23:00 booking slots — implementation, not Owner hours" },
  { pattern: "^lib/tasks-store", cls: "DOMAIN_OWNED", domain: "TASKS", note: "" },
  { pattern: "^lib/(social-)", cls: "DOMAIN_OWNED", domain: "SOCIAL", note: "incl. the social readiness checker / recommendations (display rules)" },
  { pattern: "^lib/(google-calendar|calendar-utils)", cls: "DOMAIN_OWNED", domain: "GOOGLE_CALENDAR", note: "" },
  { pattern: "^lib/finance/", cls: "DOMAIN_OWNED", domain: "FINANCE", note: "" },
  { pattern: "^lib/coo/", cls: "CROSS_DOMAIN", domain: "COMPANY_OVERVIEW", note: "the older COO brief / cases / signals with P0–P3 tiers — an implementation attention engine, not Owner priority" },
  { pattern: "^lib/proposal-followups", cls: "DOMAIN_OWNED", domain: "CLIENTS", note: "pure proposal follow-up checks used by the client drawer" },
  { pattern: "^lib/(agent/|reports/)", cls: "LEGACY", domain: "AGENT_ALERTS / REPORTS", note: "the old rule-based agent-alert engine (its rule pipeline switched off; holiday + week-strength run) and the morning / evening / weekly report emails (deterministic recommendations). The in-app AI assistant was removed on 2026-09-25." },
  { pattern: "^lib/(week-strength|owner-notification|owner-notifications-cleanup|push|app-badge|health)", cls: "CROSS_DOMAIN", domain: "PUSH_NOTIFICATIONS / COMPANY_OVERVIEW", note: "weekly-strength alert, bell categories + Friday cleanup, push, badge, dashboard health rules" },
  { pattern: "^lib/(dropbox-|file-intake|download-file|audio-|project-file)", cls: "INFRASTRUCTURE", domain: "FILES_DROPBOX", note: "" },
  { pattern: "^lib/(roles|require-auth|beat-scope|safe-redirect|maintenance)", cls: "SECRET_SECURITY", domain: "PLATFORM_ACCESS", note: "" },
  { pattern: "^lib/(supabase|use-|utils|mock-data|types|shows-types|action-types|feature-flags|integrations/)", cls: "INFRASTRUCTURE", domain: "PLATFORM", note: "" },
];

/** Every production table → how Sunny reaches it (internal; the test pins the list). */
export const TABLE_COVERAGE: Readonly<Record<string, string>> = {
  agent_alerts: "project_view (project alerts) + company_view (company-level alerts)", album_tracks: "albums", artist_balance_cycles: "artist_view", artist_balance_entries: "artist_view", beat_artist_assignments: "artist_view", beats: "artist_view",
  business_memory: "LEGACY_ORPHANED_STORAGE_PENDING_APPROVED_DROP (the retired assistant's memory; 0 rows; no code reads or writes it)", clients: "client_view", clip_items: "video_view", final_files: "mix_view", label_artists: "artist_view", label_media_income: "artist_view", meetings: "client_view / project_view",
  mix_comment_attachments: "mix_view", mix_comments: "mix_view", mix_target_notes: "mix_view", mix_targets: "mix_view", mix_versions: "mix_view", notifications: "project_view (weekly deleted)",
  partner_action_events: "actions / outcomes", partner_feedback: "Sunny feedback store", partner_gateway_audit: "INFRASTRUCTURE (Sunny's own audit)", partner_mcp_auth_codes: "SECRET", partner_mcp_clients: "SECRET", partner_mcp_tokens: "SECRET",
  partner_owner_context: "finance (Owner context)", partner_owner_knowledge: "owner_knowledge", project_actions: "project_view (send log)", project_release_details: "artist_view", projects: "project_view", proposals: "client_view", push_subscriptions: "SECRET (people: roles / counts only)",
  red_films_budget_items: "video_view", red_films_budget_payments: "video_view", red_films_crew: "video_view", red_films_documents: "video_view", red_films_equipment: "video_view", red_films_productions: "video_view", red_films_reference_images: "video_view",
  red_films_reference_links: "video_view", red_films_scenes: "video_view", sessions: "project_view / video_view", settings: "system_settings (registered families)", shows: "show_view", social_campaigns: "project_view", social_content_files: "project_view", social_content_items: "project_view",
  social_promotions: "social", sound_engineer_work: "mix_view", tasks: "project_view / video_view", transactions: "finance", vendor_project_work: "victor_view",
};

/** Knowledge-depth reconciliation performed by this mission (evidence, not assertion). */
export const DEPTH_RECONCILIATION: ReadonlyArray<{ domain: string; from: string; to: string; proof: string }> = [
  { domain: "ARTIST_BALANCES", from: "PENDING_DEEP_MISSION", to: "DEEP_BRAIN_V1", proof: "ledger + cycles schema pinned and served by the Label Artists Deep Brain (artist_view money)" },
  { domain: "MEDIA_INCOME", from: "PENDING_DEEP_MISSION", to: "DEEP_BRAIN_V1", proof: "media income schema pinned and served by the Label Artists Deep Brain" },
  { domain: "RELEASES", from: "PENDING_DEEP_MISSION", to: "DEEP_BRAIN_V1", proof: "release details schema pinned and served by the Label Artists Deep Brain; release context joined by the company view" },
  { domain: "BEATS", from: "PENDING_DEEP_MISSION", to: "DEEP_BRAIN_V1", proof: "beats + assignments schema pinned by the Label Artists Deep Brain" },
  { domain: "COMPANY_OVERVIEW", from: "SYSTEM_AWARENESS_ONLY", to: "DEEP_BRAIN_V1", proof: "this mission: company_view composes every Deep Brain; test-sunny-company" },
  { domain: "SESSIONS", from: "PENDING_DEEP_MISSION", to: "DEEP_BRAIN_V1", proof: "Full-Brain: session contract (every column, vocabularies pinned to the code, every route, rules) + session_view + test-sunny-full-brain" },
  { domain: "TASKS", from: "PENDING_DEEP_MISSION", to: "DEEP_BRAIN_V1", proof: "Full-Brain: task contract (TEXT markers kept TEXT_MATCH, Google mirror semantics) + task_view + test" },
  { domain: "MEETINGS", from: "PENDING_DEEP_MISSION", to: "DEEP_BRAIN_V1", proof: "Full-Brain: meeting contract (text client id re-verified in production) + meeting_view + test" },
  { domain: "ALBUMS", from: "PENDING_DEEP_MISSION", to: "DEEP_BRAIN_V1", proof: "Full-Brain: album contract (track statuses vs mix works kept apart) + album_view + test" },
  { domain: "DELIVERY", from: "PENDING_DEEP_MISSION", to: "DEEP_BRAIN_V1", proof: "Full-Brain: delivery contract + evidence ladder + delivery_view + test" },
  { domain: "SOCIAL", from: "PENDING_DEEP_MISSION", to: "DEEP_BRAIN_V1", proof: "Full-Brain: social contract + the app's checker evaluated as implementation behaviour + social_view + test" },
  { domain: "FILES_DROPBOX", from: "PENDING_DEEP_MISSION", to: "DEEP_BRAIN_V1", proof: "Full-Brain: every storage namespace + operation + the live-listing decision + storage_view (every recorded file) + test; storage-only files registered as FS_STORAGE_ONLY_FILES" },
  { domain: "REPORTS", from: "PENDING_DEEP_MISSION", to: "DEEP_BRAIN_V1", proof: "Full-Brain: reports model (schedule, money / date semantics vs the Finance Brain), every background job, every attention engine + reports_view + test" },
  { domain: "SUNNY_CORE", from: "PENDING_DEEP_MISSION", to: "DEEP_BRAIN_V1", proof: "Full-Brain: Sunny core stores + what Sunny can / cannot recall + sunny_self + test" },
  { domain: "SUNNY_CONNECTOR", from: "PENDING_DEEP_MISSION", to: "DEEP_BRAIN_V1", proof: "Full-Brain: connector model (auth, scopes, tools, limits, audit, failure states, flags; no secrets) + sunny_self model + test" },
];
export const STILL_PENDING: readonly string[] = [];

// ── what this mission found that earlier missions missed ────────────────────────────────────────────────────────────
export interface Discovery { id: string; what: string; where: string; why: string; domains: string[]; sunnyReads: string; gap: string | null; ownerInput: boolean }
export const DISCOVERIES: readonly Discovery[] = [
  { id: "AGENT_ALERT_TYPES", what: "The agent alert engine has 16 alert types (overdue / due-soon deadlines, session needs update, stale session, payment overdue, balance missing due date, project without pricing, proposal follow-up due, Victor stuck / below pace, inactivity, monthly goals behind, completed without delivery, upcoming holiday, week understaffed) — a parallel attention engine; and 160 of 180 alerts in production carry their project ONLY in the entity key (the project id column is empty), so Sunny saw almost none of them; 37 are open (status new), the rest handled", where: "agent rules + week-strength + holiday check; open alerts in production", why: "the Owner sees these alerts in the app; Sunny must not contradict or duplicate them", domains: ["AGENT_ALERTS", "COMPANY_OVERVIEW"], sunnyReads: "company_view attention (open company-level alerts)", gap: "CO_AGENT_ALERTS_PARALLEL", ownerInput: false },
  { id: "LEGACY_AI_AGENT", what: "A second, older in-app AI assistant existed beside Sunny (own prompt, context builder, OpenAI / Groq router, AI budget log, memory route) — RETIRED and REMOVED from the product on 2026-09-25 by Owner decision; only its orphaned storage remains (memory table 0 rows, AI budget / log settings keys) pending an approved drop", where: "removed", why: "one organizational brain: Sunny", domains: ["SUNNY_CORE", "AGENT_ALERTS"], sunnyReads: "system knowledge (history)", gap: "CO_LEGACY_AI_BRAIN", ownerInput: false },
  { id: "DAILY_REPORT_EMAILS", what: "Morning / evening report emails (Resend) with AI recommendations, scheduled by the server, configurable times — an existing 'morning brief' outside Sunny", where: "reports (data, weekly, ai, email, runtime config)", why: "a future Sunny morning brief must not duplicate or contradict it", domains: ["REPORTS", "COMPANY_OVERVIEW"], sunnyReads: "system knowledge", gap: "CO_TWO_MORNING_BRIEFS", ownerInput: true },
  { id: "DASHBOARD_HEALTH_RULES", what: "Dashboard health rules (active project without deadline, overdue active / in-mix project, finance health) — a third attention engine", where: "health + HealthAlert", why: "the Owner sees them; Sunny's attention must stay consistent", domains: ["PROJECTS", "FINANCE"], sunnyReads: "equivalent facts via project_view / finance", gap: null, ownerInput: false },
  { id: "RELEASE_CANDIDATE_RULE", what: "The app's own 'add release' rule: a releasable-type project crediting a label artist with no release row is a release candidate", where: "release-candidates", why: "the canonical definition of 'label project without release' — the company label review reuses it", domains: ["RELEASES", "LABEL_ARTISTS"], sunnyReads: "company_view label (reused rule)", gap: null, ownerInput: false },
  { id: "SOCIAL_READINESS_RULES", what: "Social campaign readiness checks + recommendations (essential content missing, no content near release, content past due, ready content without a file link)", where: "social missing checker / recommendations", why: "an existing definition of social readiness; SOCIAL has no Deep Brain", domains: ["SOCIAL", "RELEASES"], sunnyReads: "not yet (SOCIAL pending)", gap: "CO_SOCIAL_NOT_DEEP", ownerInput: false },
  { id: "WORKING_HOURS_IN_CODE", what: "The session-booking picker hard-codes Sun–Thu 10:00–23:00 slots with 30-minute buffers, while the Owner model says there are no fixed work hours", where: "schedule-rules", why: "an implementation assumption that contradicts Owner policy", domains: ["SESSIONS", "GOOGLE_CALENDAR"], sunnyReads: "system knowledge", gap: "CO_WORK_HOURS_CONFLICT", ownerInput: true },
  { id: "NOTIFICATION_HISTORY_WEEKLY_DELETE", what: "Every Friday 06:00 the Owner's whole notification bell is deleted", where: "owner notifications cleanup (server tick)", why: "notifications can never be used as durable history / change evidence", domains: ["PUSH_NOTIFICATIONS", "COMPANY_OVERVIEW"], sunnyReads: "only what remains this week", gap: "already registered (notifications deleted weekly)", ownerInput: false },
  { id: "PORTAL_MUSIC_LINK", what: "Projects uploads can be linked into a portal artist's 'המוזיקה שלי' library for an explicit artist list only", where: "red-artists project link", why: "a project → portal relationship limited to named artists", domains: ["ARTIST_PORTALS", "PROJECTS"], sunnyReads: "people / artist_view", gap: null, ownerInput: false },
  { id: "SUNNY_AUDIT_TRAIL", what: "Sunny's own gateway audit (every connector query) exists and is not read by Sunny", where: "partner gateway audit", why: "Sunny cannot yet answer 'what did I look at / answer before'", domains: ["SUNNY_CORE"], sunnyReads: "no", gap: "CO_SUNNY_OWN_AUDIT", ownerInput: false },
  { id: "DEPTH_STALE_MARKERS", what: "Four domains fully covered by the Label Deep Brain were still marked pending (artist balances, media income, releases, beats)", where: "system awareness depth map", why: "Sunny under-stated its own knowledge", domains: ["ARTIST_BALANCES", "MEDIA_INCOME", "RELEASES", "BEATS"], sunnyReads: "reconciled", gap: null, ownerInput: false },
  { id: "CODE_BUSINESS_GOALS", what: "Business goals hard-coded in the old agent code (₪20,000 GROSS monthly income, 8 sessions / week, 4 completions / month, Victor 12) — no settings rows, so the code defaults drive the 'goal behind' alerts and the weekly report", where: "old agent goals", why: "a second, unconfirmed goal system that measures gross where the Owner measures net", domains: ["REPORTS", "AGENT_ALERTS", "FINANCE"], sunnyReads: "reports_view engines", gap: "RP_CODE_GOALS_VS_OWNER_TARGET", ownerInput: true },
  { id: "AUDIT_INSERT_ONLY", what: "Sunny's connector audit is insert-only for the service role and stores input HASHES — Sunny can never read back what it queried", where: "connector audit grant", why: "'what did you check before' is unanswerable by design", domains: ["SUNNY_CONNECTOR"], sunnyReads: "sunny_self (the boundary itself)", gap: "CO_SUNNY_OWN_AUDIT", ownerInput: true },
  { id: "STORAGE_ONLY_PORTAL", what: "The artist portal 'המוזיקה שלי' lives only in a storage manifest (versions, ratings, next release / next work) — no database record at all", where: "artist portal storage", why: "an artist's plans for the next song are invisible to Sunny", domains: ["FILES_DROPBOX", "ARTIST_PORTALS"], sunnyReads: "no", gap: "FS_STORAGE_ONLY_FILES", ownerInput: true },
  { id: "REHEARSAL_AUTOMARK_MONEY", what: "The app-wide session auto-mark writes התקיים on show rehearsals while the show split counts only בוצע — held rehearsals can drop out of the artist / label split", where: "sessions auto-mark + show split", why: "a silent money effect", domains: ["SESSIONS", "SHOWS", "FINANCE"], sunnyReads: "session_view", gap: "WK_REHEARSAL_STATUS_CONFLICT", ownerInput: true },
];

export const COMPANY_RULES = [
  "ONE Sunny: every answer composes the domain views; nothing is copied into Sunny tables.",
  "No score, no ranking of people / artists / projects, no capacity limit, no fixed hours, no readiness / cadence / turnaround / collection policy unless the Owner confirmed it.",
  "Default answer = 3–5 observations chosen by a fixed group order (Owner-blocking → client commitment → money → time → others → label continuity → release → conflicts → system) — an order of presentation, never a priority judgement; everything else by drill-down.",
  "Label = protected growth track: label spend is INVESTMENT, never a problem by itself; cashflow vs label is surfaced as a tension, never decided.",
  "Cashflow = top operational priority, not absolute. Realized = received − paid (₪ target 20k floor / 30k preferred); forecast apart; currencies never added.",
  "Outside communication is invisible: 'I don't see this recorded in Redbloods', never 'you didn't'.",
  "A failed source = PARTIAL (named), never empty; UNKNOWN is a valid answer.",
  "Personal calendar events are schedule context, never business facts.",
] as const;
