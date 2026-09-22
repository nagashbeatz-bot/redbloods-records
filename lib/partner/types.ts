/**
 * Redbloods Partner — Charter v0 shared types.
 *
 * The Charter is a typed, tested, traceable source of truth for how the owner
 * runs Redbloods and the goals he has already approved. No DB, no network,
 * no LLM — a plain in-memory config module, same spirit as lib/coo/config.ts.
 *
 * This is a NEW foundation (lib/partner), separate from lib/coo. Phase 1a
 * (lib/coo) is untouched by this file and stays the only thing wired into
 * the Dashboard today.
 *
 * Epistemic Contract (FACT / DERIVED / OWNER_DECISION / HYPOTHESIS /
 * GENERAL_KNOWLEDGE / UNKNOWN): a Charter item's `status` says how much
 * weight it carries. A HYPOTHESIS about how the owner manages never becomes
 * an OWNER_RULE by itself — only an explicit owner confirmation (a new
 * `source`) can do that, and this module never invents one.
 */

/** Business area a Charter item speaks to. Free to grow; keep it small and honest. */
export type CharterDomain =
  | "growth"
  | "label"
  | "quality"
  | "victor"
  | "deadlines"
  | "partner_behavior"
  | "investigation"
  | "revenue";

/** What kind of statement this is, independent of whether the owner has approved it yet. */
export type CharterKind = "GOAL" | "CONSTRAINT" | "HEURISTIC" | "BEHAVIOR" | "PROCESS";

/**
 * Approval status:
 *  - OWNER_RULE / OWNER_GOAL: the owner explicitly confirmed this (source must be OWNER_CONFIRMED).
 *  - WORKING_PRINCIPLE: sounds right today, not yet approved — never presented as "the owner said...".
 *  - UNKNOWN: placeholder for an item whose status is still undecided.
 */
export type CharterStatus = "OWNER_RULE" | "OWNER_GOAL" | "WORKING_PRINCIPLE" | "UNKNOWN";

export type CharterSession = "CHARTER_1" | "CHARTER_2";

/** Provenance: type-safe, never a vague string. */
export type CharterSource =
  | { type: "OWNER_CONFIRMED"; session: CharterSession }
  | { type: "SYSTEM_WORKING_HYPOTHESIS" };

export interface CharterItem {
  /** Stable, unique, UPPER_SNAKE_CASE. */
  id: string;
  domain: CharterDomain;
  kind: CharterKind;
  /** Short Hebrew label. */
  title: string;
  /** Full explanation of the rule/goal/principle, in Hebrew. */
  principle: string;
  status: CharterStatus;
  source: CharterSource;
  /** Whether this item can be knowingly overridden in a specific case. */
  canOverride: boolean;
  /** Required (non-empty) when canOverride is true; must be null otherwise. */
  overrideRule: string | null;
  /** Free-text context: examples, related sessions, open questions. Not evidence. */
  notes: string | null;
}
