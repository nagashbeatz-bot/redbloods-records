/**
 * Redbloods Partner — public entrypoint for the Charter (Phase A / v0).
 *
 * Deterministic, in-memory, read-only. No network, no DB, no LLM.
 * Not wired into any route or the priority engine yet — see AGENTS.md context
 * (PHASE A) for why: this block is foundation only.
 */
export * from "./types";
export { CHARTER_ITEMS, validateCharter } from "./charter";

import { CHARTER_ITEMS } from "./charter";
import type { CharterDomain, CharterItem } from "./types";

/** Owner-approved rules (OWNER_RULE only — see getOwnerGoals for OWNER_GOAL). */
export function getOwnerRules(): CharterItem[] {
  return CHARTER_ITEMS.filter((i) => i.status === "OWNER_RULE");
}

/** Owner-approved goals (targets like revenue growth), kept separate from behavioral rules. */
export function getOwnerGoals(): CharterItem[] {
  return CHARTER_ITEMS.filter((i) => i.status === "OWNER_GOAL");
}

/** Not yet owner-approved. Never to be presented as "the owner said...". */
export function getWorkingPrinciples(): CharterItem[] {
  return CHARTER_ITEMS.filter((i) => i.status === "WORKING_PRINCIPLE");
}

export function getCharterRule(id: string): CharterItem | null {
  return CHARTER_ITEMS.find((i) => i.id === id) ?? null;
}

export function getCharterByDomain(domain: CharterDomain): CharterItem[] {
  return CHARTER_ITEMS.filter((i) => i.domain === domain);
}

/** True only for an id that exists and carries owner approval (OWNER_RULE or OWNER_GOAL). */
export function isOwnerApproved(id: string): boolean {
  const item = getCharterRule(id);
  return !!item && (item.status === "OWNER_RULE" || item.status === "OWNER_GOAL");
}
