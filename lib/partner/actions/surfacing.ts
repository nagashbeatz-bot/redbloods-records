/**
 * Redbloods Partner — Suggested Action surfacing resolver (Phase F.1H). Pure.
 *
 * Decides what the Owner should see for ONE deterministic actionId, from the
 * currently derived proposal and its persisted Action Event chain. Mutates
 * nothing. Reads only stored data (e.g. NOT_NOW uses the stored defer_until,
 * never a code constant).
 *
 *   no events            → SHOW (when currently PROPOSED)
 *   NOT_NOW              → HIDDEN until defer_until, then SHOW if still PROPOSED
 *   REJECTED             → SUPPRESSED (this exact actionId)
 *   APPROVED             → AWAITING_EXECUTION
 *   EXECUTED             → DONE (never proposed again)
 *   STALE_AT_EXECUTION   → SHOW only if the SAME actionId + SAME snapshot hash is PROPOSED again
 *   invalid chain        → BLOCKED (fail closed; nothing is shown)
 */
import { orderActionChain, type PartnerActionEvent } from "./events";

export type SurfacingState = "SHOW" | "HIDDEN" | "SUPPRESSED" | "AWAITING_EXECUTION" | "DONE" | "NOT_PROPOSED" | "BLOCKED";

export interface SurfacingInput {
  actionId: string;
  /** The action as derived NOW (null = not derivable). */
  current: { status: "PROPOSED" | "NOT_ELIGIBLE" | "STALE"; snapshotHash: string | null } | null;
  events: readonly PartnerActionEvent[];
  now: Date;
}

export interface SurfacingResult {
  state: SurfacingState;
  reason: string;
  headEventId: string | null;
  headEventType: PartnerActionEvent["eventType"] | null;
  /** HIDDEN only: when it may surface again (the stored defer_until). */
  hiddenUntil: string | null;
}

export function resolveActionSurfacing(input: SurfacingInput): SurfacingResult {
  const ordered = orderActionChain(input.actionId, input.events);
  if (ordered.status !== "OK") return { state: "BLOCKED", reason: `invalid action chain: ${ordered.reasons.join("; ")}`, headEventId: null, headEventType: null, hiddenUntil: null };
  const head = ordered.head;
  const base = { headEventId: head?.id ?? null, headEventType: head?.eventType ?? null, hiddenUntil: null };
  const proposed = input.current?.status === "PROPOSED";

  if (!head) return proposed ? { ...base, state: "SHOW", reason: "no decision recorded" } : { ...base, state: "NOT_PROPOSED", reason: "not currently proposed" };
  switch (head.eventType) {
    case "EXECUTED": return { ...base, state: "DONE", reason: "executed" };
    case "APPROVED": return { ...base, state: "AWAITING_EXECUTION", reason: "approved, not yet executed" };
    case "REJECTED": return { ...base, state: "SUPPRESSED", reason: "the Owner rejected this exact action" };
    case "NOT_NOW": {
      const until = head.deferUntil;
      if (until !== null && input.now.getTime() < Date.parse(until)) return { ...base, state: "HIDDEN", reason: "deferred by the Owner", hiddenUntil: until };
      return proposed ? { ...base, state: "SHOW", reason: "deferral elapsed" } : { ...base, state: "NOT_PROPOSED", reason: "deferral elapsed but no longer proposed" };
    }
    case "STALE_AT_EXECUTION":
      return proposed && input.current?.snapshotHash === head.snapshotHash
        ? { ...base, state: "SHOW", reason: "the identical proposal is valid again" }
        : { ...base, state: "NOT_PROPOSED", reason: "stale at execution" };
  }
}
