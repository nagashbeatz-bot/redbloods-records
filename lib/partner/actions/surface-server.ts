import "server-only";

/**
 * Redbloods Partner — read-only Action surface, server binding (Phase F.1I).
 * Binds the surface core to the live view and ONLY the chain-read of the
 * Action Event store. It exposes no decision, append, Owner Context write or
 * execution capability. Used by GET /api/partner/actions (Owner-only).
 */
import { actionEventStore } from "./event-store";
import { listLiveProposals } from "./live";
import { buildActionSurface, type ActionSurfaceResult } from "./surface";

export function getOwnerActionSurface(): Promise<ActionSurfaceResult> {
  return buildActionSurface({
    listProposals: listLiveProposals,
    getActionChain: (actionId) => actionEventStore.getActionChain(actionId),
    now: () => new Date(),
    log: (event, data) => console.warn(`[partner-action-surface] ${event}`, JSON.stringify(data)),
  });
}
