/**
 * Redbloods Partner — read-only Action surface, CORE (Phase F.1I).
 *
 * Lists the Suggested Actions the Owner should see right now: every
 * currently derived action is run through the real surfacing resolver
 * against its persisted Action Event chain, and ONLY `SHOW` is surfaced.
 * HIDDEN / SUPPRESSED / AWAITING_EXECUTION / DONE / NOT_PROPOSED are not
 * shown; BLOCKED (malformed chain) and unreadable chains fail closed — not
 * shown, logged server-side without exposing internals.
 *
 * Dependencies are injected. The core is READ-ONLY by construction: its only
 * store dependency is getActionChain — it has no access to decisions,
 * appends, Owner Context writes or the execution RPC.
 */
import type { PartnerCase } from "../cases/types";
import type { ActionChainReadResult } from "./event-persistence";
import { buildActionSnapshot, hashActionSnapshot } from "./snapshot";
import { resolveActionSurfacing, type SurfacingState } from "./surfacing";
import { ACTION_SURFACE_DTO_VERSION, toActionCardDto, type ActionSurfaceResponse } from "./surface-dto";
import type { PartnerSuggestedAction } from "./types";

export interface ActionSurfaceDeps {
  listProposals(): Promise<{ status: "OK"; items: Array<{ action: PartnerSuggestedAction; caseRef: PartnerCase; subjectLabelHe: string | null }> } | { status: "READ_FAILED"; detail: string }>;
  /** READ-ONLY chain read (the only store capability the surface gets). */
  getActionChain(actionId: string): Promise<ActionChainReadResult>;
  now(): Date;
  log(event: string, data: Record<string, unknown>): void;
}

export type ActionSurfaceResult = { status: "OK"; response: ActionSurfaceResponse; states: Record<string, SurfacingState> } | { status: "UNAVAILABLE" };

export async function buildActionSurface(deps: ActionSurfaceDeps): Promise<ActionSurfaceResult> {
  const list = await deps.listProposals();
  if (list.status !== "OK") { deps.log("partner_action_surface_unavailable", { detail: list.detail }); return { status: "UNAVAILABLE" }; }
  const states: Record<string, SurfacingState> = {};
  const items = [];
  for (const { action, caseRef, subjectLabelHe } of list.items) {
    let hash: string | null = null;
    if (action.status === "PROPOSED") {
      try { hash = hashActionSnapshot(buildActionSnapshot(action, caseRef)); } catch { states[action.id] = "BLOCKED"; deps.log("partner_action_surface_blocked", { actionId: action.id, reason: "snapshot" }); continue; }
    }
    const chain = await deps.getActionChain(action.id);
    if (chain.status !== "OK") { states[action.id] = "BLOCKED"; deps.log("partner_action_surface_blocked", { actionId: action.id, reason: chain.status }); continue; }
    const s = resolveActionSurfacing({ actionId: action.id, current: { status: action.status, snapshotHash: hash }, events: chain.chain, now: deps.now() });
    states[action.id] = s.state;
    if (s.state === "BLOCKED") { deps.log("partner_action_surface_blocked", { actionId: action.id, reason: "chain" }); continue; }
    if (s.state === "SHOW" && action.status === "PROPOSED") items.push(toActionCardDto(action, subjectLabelHe));
  }
  items.sort((a, b) => a.actionId.localeCompare(b.actionId));
  return { status: "OK", response: { v: ACTION_SURFACE_DTO_VERSION, items }, states };
}
