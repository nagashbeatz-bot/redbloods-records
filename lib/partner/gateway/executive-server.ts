import "server-only";
/**
 * The server binding of the Owner's executive read (lib/partner/gateway/executive.ts): the three capabilities are read
 * through the SAME queryPartnerKnowledge the chat uses, over ONE company read context (each source loaded once).
 */
import { createCompanyReadContext } from "../company/read-context";
import type { KnowledgeAudience } from "../knowledge/types";
import { queryPartnerKnowledge } from "./server";
import { EXECUTIVE_LIMIT, EXECUTIVE_PARTS, readExecutiveParts, type OwnerExecutive } from "./executive";

export async function readOwnerExecutive(history: Parameters<typeof readExecutiveParts>[0], audience: KnowledgeAudience): Promise<OwnerExecutive> {
  const ctx = createCompanyReadContext();
  return readExecutiveParts(history, async (part) => (await queryPartnerKnowledge({ ...EXECUTIVE_PARTS[part], limit: EXECUTIVE_LIMIT }, audience, ctx)) as unknown as Record<string, unknown>, ctx.now);
}
