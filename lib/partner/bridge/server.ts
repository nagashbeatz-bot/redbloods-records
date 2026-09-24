import "server-only";

/**
 * Redbloods Partner ↔ Claude bridge — server binding (P1). Used ONLY by the MCP connector's partner_answer_question.
 *
 *   isOwner        — re-verifies at answer time that the token's user is STILL the Redbloods Owner (auth user → email →
 *                    roleForEmail); a GET to the auth admin API; fail closed.
 *   integrityDeps  — the EXISTING Integrity answer dependencies (same store, live loader, verify, shared replay ledger)
 *                    with provenance owner_via_claude. No new write path: this module imports no Owner Context store.
 *   freshRegister  — a brand-new CompanyReadContext (a new request) for post-write verification + the next questions.
 */
import { supabase } from "@/lib/supabase";
import { roleForEmail } from "@/lib/roles";
import { createCompanyReadContext } from "../company/read-context";
import { integrityAnswerDeps } from "../integrity/server";
import { answerViaConnectorCore, type BridgeActor, type BridgeAnswerResult, type BridgeDeps } from "./answer";

const deps: BridgeDeps = {
  async isOwner(userId) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) return false;
    const { data, error } = await supabase.auth.admin.getUserById(userId);
    if (error || !data?.user?.email) return false;
    return roleForEmail(data.user.email) === "owner";
  },
  integrityDeps: (provenance) => integrityAnswerDeps(provenance),
  async freshRegister() {
    const ctx = createCompanyReadContext();
    if ((await ctx.ownerContexts()) === null) return null;
    return ctx.integrity();
  },
};

export function answerViaConnector(i: { questionRef: unknown; answer: unknown; actor: BridgeActor; attemptAuditId: string }): Promise<BridgeAnswerResult> {
  return answerViaConnectorCore(deps, i);
}
