import "server-only";

/**
 * Redbloods Partner — Owner Action primitives, server binding (Phase F.1H).
 *
 *   decideSuggestedAction(input)   APPROVE / NOT_NOW / REJECT (CHANGE_VALUE → Owner Context flow)
 *   executeApprovedAction(input)   revalidate + the approved DB RPC only
 *
 * Owner-only: every call re-checks the session with requireOwner(); the actor
 * id comes from the authenticated session, never from the input. No route,
 * UI, cron, agent or background executor calls these in this phase.
 */
import { getAuthUser, requireOwner } from "@/lib/require-auth";
import { actionEventStore } from "./event-store";
import { livePartnerView } from "./live";
import { decideSuggestedActionCore, executeApprovedActionCore, type ActionServiceDeps, type DecideResult, type ExecuteResult, type OwnerActor } from "./service";

export type OwnerAuthFailure = { status: "UNAUTHORIZED" } | { status: "FORBIDDEN" };

async function resolveOwnerActor(): Promise<{ ok: true; actor: OwnerActor } | { ok: false; result: OwnerAuthFailure }> {
  const denied = await requireOwner();
  if (denied) return { ok: false, result: { status: denied.status === 401 ? "UNAUTHORIZED" : "FORBIDDEN" } };
  const user = await getAuthUser();
  if (!user?.id) return { ok: false, result: { status: "UNAUTHORIZED" } };
  return { ok: true, actor: { userId: user.id } };
}

const deps: ActionServiceDeps = {
  now: () => new Date(),
  store: actionEventStore,
  live: livePartnerView,
  audit: (event, data) => console.info(`[partner-action] ${event}`, JSON.stringify(data)),
};

export async function decideSuggestedAction(input: unknown): Promise<DecideResult | OwnerAuthFailure> {
  const a = await resolveOwnerActor();
  if (!a.ok) return a.result;
  return decideSuggestedActionCore(deps, a.actor, input);
}

export async function executeApprovedAction(input: unknown): Promise<ExecuteResult | OwnerAuthFailure> {
  const a = await resolveOwnerActor();
  if (!a.ok) return a.result;
  return executeApprovedActionCore(deps, a.actor, input);
}
