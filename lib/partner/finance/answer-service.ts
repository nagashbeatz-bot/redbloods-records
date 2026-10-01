import "server-only";

/**
 * Redbloods Partner — Finance Owner answer, server binding (F2.8–F2.10).
 *
 * Owner-only: every call re-checks the session with requireOwner(); the actor comes from the authenticated
 * session (audit log), never from the input. The ONLY write is appendOwnerContext — one append-only
 * partner_owner_context revision — after the core re-derived the live finance state and verified the exact
 * question the Owner saw. Used only by POST /api/partner/finance/answer.
 */
import { getAuthUser, requireOwner } from "@/lib/require-auth";
import { appendOwnerContext } from "../investigation/context-store";
import { answerFinanceQuestionCore, createRequestLedger, type FinanceAnswerDeps, type FinanceAnswerResult } from "./answer";
import type { OwnerContextProvenance } from "../investigation/types";
import { loadFinanceLive, type FinanceLiveResult } from "./server";

/** A brand-new live read, for post-write verification and the next questions (bridge). */
export const loadFinanceFresh = (): Promise<FinanceLiveResult> => loadFinanceLive();

export type OwnerAuthFailure = { status: "UNAUTHORIZED" } | { status: "FORBIDDEN" };

const deps: FinanceAnswerDeps = {
  async loadLive() {
    const live = await loadFinanceLive();
    if (live.status !== "OK") return { ok: false, detail: live.detail };
    // Never answer blindly: without the Owner's earlier answers the server cannot tell a revision from a first answer.
    if (!live.answersAvailable) return { ok: false, detail: `owner answers unreadable: ${live.answersDetail ?? "unknown"}` };
    return { ok: true, integrity: live.integrity, answers: live.answers };
  },
  appendOwnerContext,
  ledger: createRequestLedger(),
  audit: (event, data) => console.info(`[partner-finance] ${event}`, JSON.stringify(data)),
};

/** The SAME dependencies (store, live loader, replay ledger) for another channel: only the provenance differs (owner_via_claude from the connector bridge). */
export function financeAnswerDeps(provenance?: OwnerContextProvenance): FinanceAnswerDeps {
  return provenance ? { ...deps, provenance } : deps;
}

export async function answerFinanceQuestion(input: unknown): Promise<FinanceAnswerResult | OwnerAuthFailure> {
  const denied = await requireOwner();
  if (denied) return { status: denied.status === 401 ? "UNAUTHORIZED" : "FORBIDDEN" };
  const user = await getAuthUser();
  if (!user?.id) return { status: "UNAUTHORIZED" };
  return answerFinanceQuestionCore(deps, user.id, input);
}
