import "server-only";

/**
 * Redbloods Partner — Company Integrity server bindings: the Owner's "צריך ממך" surface (read) and the Owner answer
 * (the ONLY write: one append-only partner_owner_context revision).
 *
 * Owner-only: every call re-checks the session with requireOwner(); the actor comes from the authenticated session
 * (audit log), never from the input. Every call builds its own FRESH CompanyReadContext — nothing is cached across
 * requests, so an answer is proven by re-reading it from the database. Used only by GET /api/partner/integrity and
 * POST /api/partner/integrity/answer. No project / client / label / release / session / finance write exists here.
 */
import { getAuthUser, requireOwner } from "@/lib/require-auth";
import { appendOwnerContext } from "../investigation/context-store";
import { createCompanyReadContext } from "../company/read-context";
import { answerIntegrityQuestionCore, createIntegrityRequestLedger, registerAppliesContext, type IntegrityAnswerDeps, type IntegrityAnswerResult } from "./answer";
import { toIntegritySurfaceDto, type IntegritySurfaceDto } from "./dto";

export type OwnerAuthFailure = { status: "UNAUTHORIZED" } | { status: "FORBIDDEN" };

async function ownerOrFailure(): Promise<{ userId: string } | OwnerAuthFailure> {
  const denied = await requireOwner();
  if (denied) return { status: denied.status === 401 ? "UNAUTHORIZED" : "FORBIDDEN" };
  const user = await getAuthUser();
  if (!user?.id) return { status: "UNAUTHORIZED" };
  return { userId: user.id };
}

const deps: IntegrityAnswerDeps = {
  async loadLive() {
    const ctx = createCompanyReadContext();
    const contexts = await ctx.ownerContexts();
    // Never answer blindly: without the Owner's earlier answers the server cannot tell a revision from a first answer.
    if (contexts === null) return { ok: false, detail: "owner answers unreadable" };
    const register = await ctx.integrity();
    if (register.sources.find((s) => s.source === "company-state (Partner Eyes)")?.status !== "OK") return { ok: false, detail: "company state unavailable" };
    return { ok: true, register, activeContexts: contexts };
  },
  appendOwnerContext,
  async verify(contextId, questionId) {
    const ctx = createCompanyReadContext(); // a brand-new read: the row must come back from the database
    const contexts = await ctx.ownerContexts();
    if (!contexts?.some((c) => c.id === contextId)) return false;
    return registerAppliesContext(await ctx.integrity(), contextId, questionId);
  },
  ledger: createIntegrityRequestLedger(),
  audit: (event, data) => console.info(`[partner-integrity] ${event}`, JSON.stringify(data)),
};

export async function answerIntegrityQuestion(input: unknown): Promise<IntegrityAnswerResult | OwnerAuthFailure> {
  const who = await ownerOrFailure();
  if ("status" in who) return who;
  return answerIntegrityQuestionCore(deps, who.userId, input);
}

export type IntegritySurfaceResult = { status: "OK"; surface: IntegritySurfaceDto } | { status: "UNAVAILABLE"; detail: string } | OwnerAuthFailure;

export async function getIntegritySurface(): Promise<IntegritySurfaceResult> {
  const who = await ownerOrFailure();
  if ("status" in who) return who;
  const ctx = createCompanyReadContext();
  const register = await ctx.integrity();
  if (register.sources.find((s) => s.source === "company-state (Partner Eyes)")?.status !== "OK") return { status: "UNAVAILABLE", detail: "company state unavailable" };
  return { status: "OK", surface: toIntegritySurfaceDto(register) };
}
