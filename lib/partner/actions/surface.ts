/**
 * Redbloods Partner — Action surface, CORE (Phase F.1I; F.1J adds the
 * approved-awaiting state).
 *
 * Lists the Suggested Actions the Owner should see right now: every
 * currently derived action is run through the real surfacing resolver
 * against its persisted Action Event chain.
 *   SHOW                 → a fresh proposal card (decision controls in the UI)
 *   AWAITING_EXECUTION   → a calm "approved, waiting for execution" card (never a fresh proposal)
 *   HIDDEN / SUPPRESSED / DONE / NOT_PROPOSED → not shown
 *   BLOCKED / unreadable chains → fail closed: not shown, logged server-side without exposing internals.
 *
 * Dependencies are injected. The core is READ-ONLY by construction: its only
 * store dependency is getActionChain.
 */
import { ilYmd } from "../../coo/dates";
import type { PartnerCase } from "../cases/types";
import { answerOptionsFor } from "../investigation/questions";
import type { ActionChainReadResult } from "./event-persistence";
import { buildActionSnapshot, hashActionSnapshot } from "./snapshot";
import { resolveActionSurfacing, type SurfacingState } from "./surfacing";
import { ACTION_SURFACE_DTO_VERSION, CHANGE_VALUE_ANSWER_CODES, toActionCardDto, type ActionSurfaceResponse, type ChangeValueOption, type PartnerActionCardDto } from "./surface-dto";
import type { PartnerSuggestedAction } from "./types";

export interface ActionSurfaceDeps {
  listProposals(): Promise<{ status: "OK"; items: Array<{ action: PartnerSuggestedAction; caseRef: PartnerCase; subjectLabelHe: string | null }> } | { status: "READ_FAILED"; detail: string }>;
  /** READ-ONLY chain read (the only store capability the surface gets). */
  getActionChain(actionId: string): Promise<ActionChainReadResult>;
  now(): Date;
  log(event: string, data: Record<string, unknown>): void;
}

export type ActionSurfaceResult = { status: "OK"; response: ActionSurfaceResponse; states: Record<string, SurfacingState> } | { status: "UNAVAILABLE" };

/** "שנה תאריך" choices = the date-bearing answers of the existing WHAT_IS_NEW_PROJECT_DEADLINE question, with its own labels. */
export function changeValueOptions(): ChangeValueOption[] {
  return answerOptionsFor("WHAT_IS_NEW_PROJECT_DEADLINE")
    .filter((o) => (CHANGE_VALUE_ANSWER_CODES as readonly string[]).includes(o.code))
    .map((o) => ({ code: o.code as ChangeValueOption["code"], labelHe: o.labelHe }));
}

export async function buildActionSurface(deps: ActionSurfaceDeps): Promise<ActionSurfaceResult> {
  const list = await deps.listProposals();
  if (list.status !== "OK") { deps.log("partner_action_surface_unavailable", { detail: list.detail }); return { status: "UNAVAILABLE" }; }
  const now = deps.now();
  const options = changeValueOptions();
  const minChangeDate = ilYmd(now);
  const states: Record<string, SurfacingState> = {};
  const items: PartnerActionCardDto[] = [];
  for (const { action, caseRef, subjectLabelHe } of list.items) {
    let hash: string | null = null;
    if (action.status === "PROPOSED") {
      try { hash = hashActionSnapshot(buildActionSnapshot(action, caseRef)); } catch { states[action.id] = "BLOCKED"; deps.log("partner_action_surface_blocked", { actionId: action.id, reason: "snapshot" }); continue; }
    }
    const chain = await deps.getActionChain(action.id);
    if (chain.status !== "OK") { states[action.id] = "BLOCKED"; deps.log("partner_action_surface_blocked", { actionId: action.id, reason: chain.status }); continue; }
    const s = resolveActionSurfacing({ actionId: action.id, current: { status: action.status, snapshotHash: hash }, events: chain.chain, now });
    states[action.id] = s.state;
    if (s.state === "BLOCKED") { deps.log("partner_action_surface_blocked", { actionId: action.id, reason: "chain" }); continue; }
    if ((s.state === "SHOW" || s.state === "AWAITING_EXECUTION") && action.status === "PROPOSED" && hash) {
      items.push(toActionCardDto(action, subjectLabelHe, { state: s.state, snapshotHash: hash, headEventId: s.headEventId, changeValueOptions: options, minChangeDate }));
    }
  }
  items.sort((a, b) => a.actionId.localeCompare(b.actionId));
  return { status: "OK", response: { v: ACTION_SURFACE_DTO_VERSION, items }, states };
}
