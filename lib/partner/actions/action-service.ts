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
import { appendOwnerContext } from "../investigation/context-store";
import { changeSuggestedActionValueCore, type ChangeValueResult } from "./change-value";
import { actionEventStore } from "./event-store";
import { livePartnerView } from "./live";
import { decideSuggestedActionCore, executeApprovedActionCore, type ActionServiceDeps, type DecideResult, type ExecuteResult, type OwnerActor } from "./service";
import { LOWER_UUID_RE } from "./events";
import { loadFinanceLive } from "../finance/server";
import { decideFinanceActionCore, executeFinanceActionCore, isFinanceActionId, type FinanceActionServiceDeps, type FinanceDecideResult, type FinanceExecuteResult } from "../finance/action-core";

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

/** F2.31: the finance action flow (RECORD_PAID_EXPENSE only) — same store, live finance derivation, its own narrow RPC. */
const financeDeps: FinanceActionServiceDeps = {
  now: () => new Date(),
  store: actionEventStore,
  live: {
    async loadCandidates() {
      const l = await loadFinanceLive(new Date());
      if (l.status !== "OK") return { status: "READ_FAILED", detail: l.detail };
      if (!l.answersAvailable) return { status: "READ_FAILED", detail: "owner answers unreadable" };
      return { status: "OK", candidates: l.actions };
    },
  },
  audit: deps.audit,
};

export async function decideSuggestedAction(input: unknown): Promise<DecideResult | FinanceDecideResult | OwnerAuthFailure> {
  const a = await resolveOwnerActor();
  if (!a.ok) return a.result;
  // F2.31: dispatch by the action identity — a finance action id never reaches the deadline core and vice versa.
  if (typeof input === "object" && input !== null && isFinanceActionId((input as Record<string, unknown>).actionId)) return decideFinanceActionCore(financeDeps, a.actor, input);
  return decideSuggestedActionCore(deps, a.actor, input);
}

/**
 * "שנה תאריך" (F.1J): NOT an Action Event — an append-only Owner Context revision of the
 * existing WHAT_IS_NEW_PROJECT_DEADLINE answer, after explicit Owner input. Never touches the project.
 */
export async function changeSuggestedActionValue(input: unknown): Promise<ChangeValueResult | OwnerAuthFailure> {
  const a = await resolveOwnerActor();
  if (!a.ok) return a.result;
  return changeSuggestedActionValueCore({ live: livePartnerView, appendOwnerContext, audit: deps.audit }, input);
}

export async function executeApprovedAction(input: unknown): Promise<ExecuteResult | FinanceExecuteResult | OwnerAuthFailure> {
  const a = await resolveOwnerActor();
  if (!a.ok) return a.result;
  // F2.31: the persisted APPROVED event decides the executor. A finance approval → the finance RPC; anything else →
  // the unchanged deadline core (which never sees finance rows). A failed finance lookup fails closed.
  const id = typeof input === "object" && input !== null ? (input as Record<string, unknown>).approvalEventId : undefined;
  if (typeof id === "string" && LOWER_UUID_RE.test(id)) {
    const fin = await actionEventStore.getFinanceEventById(id);
    if (fin.status === "READ_FAILED") return { kind: "FINANCE", status: "RETRYABLE", detail: fin.detail, sqlstate: null };
    if (fin.status === "INVALID_STORED_EVENT") return { kind: "FINANCE", status: "INVARIANT_VIOLATION", detail: fin.errors.join("; ") };
    if (fin.status === "FOUND") return executeFinanceActionCore(financeDeps, a.actor, input);
  }
  return executeApprovedActionCore(deps, a.actor, input);
}
