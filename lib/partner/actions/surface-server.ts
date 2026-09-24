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
import { loadFinanceLive } from "../finance/server";

export function getOwnerActionSurface(): Promise<ActionSurfaceResult> {
  return buildActionSurface({
    listProposals: listLiveProposals,
    getActionChain: (actionId) => actionEventStore.getActionChain(actionId),
    // F2.31: finance Suggested Actions (read-only here: candidates + chain reads; no decision / RPC capability)
    listFinanceCandidates: async () => {
      const l = await loadFinanceLive(new Date());
      if (l.status !== "OK") return { status: "READ_FAILED", detail: l.detail };
      if (!l.answersAvailable) return { status: "READ_FAILED", detail: "owner answers unreadable" };
      return { status: "OK", candidates: l.actions };
    },
    getFinanceActionChain: (actionId) => actionEventStore.getFinanceActionChain(actionId),
    now: () => new Date(),
    log: (event, data) => console.warn(`[partner-action-surface] ${event}`, JSON.stringify(data)),
  });
}
