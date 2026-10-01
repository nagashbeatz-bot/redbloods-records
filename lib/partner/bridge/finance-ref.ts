/**
 * Redbloods Partner ↔ Claude bridge — Finance question answering through the connector (pure, no I/O).
 *
 * ONE switch decides whether a Finance question may be answered through Claude: PARTNER_MCP_ANSWER_FINANCE, honoured only
 * on the MCP-only deployment that already has the answer switch on. The same predicate gates what the readers expose
 * (questionRef + option codes + answerable) and what the bridge accepts, so a question is never presented as answerable
 * through a connection that would refuse it.
 *
 * The connector input is only { questionRef, answer }, so an answer that needs a typed date (EXACT_DATE) can never be
 * submitted through it: that option is not offered here and is refused by the bridge (it stays a dashboard answer).
 * An answer is Owner Context only — it never writes a transaction, a price or any finance record.
 */
import type { KnowledgeAudience } from "../knowledge/types";
import type { OwnerQuestion } from "../finance/integrity";
import { encodeQuestionRef } from "./ref";

type Env = Record<string, string | undefined>;

/** Answer switch + MCP-only + finance switch. Default false: an unset / any other value leaves Finance answering off. */
export function financeAnswerSwitch(env: Env): boolean {
  return env.PARTNER_MCP_ANSWER_ENABLED === "true" && env.REDBLOODS_MCP_ONLY === "true" && env.PARTNER_MCP_ANSWER_FINANCE === "true";
}

/** May THIS reader audience see Finance questions as answerable through Claude? (external connector only) */
export function financeAnswerAvailableFor(audience: KnowledgeAudience | undefined, env: Env = process.env): boolean {
  return audience?.channel === "EXTERNAL" && financeAnswerSwitch(env);
}

export interface FinanceAnswerOffer { questionRef: string; options: Array<{ code: string; labelHe: string }> }

/** The ref + the option codes a connector may submit for this live Finance question; null when it cannot be answered here. */
export function financeAnswerOffer(q: OwnerQuestion): FinanceAnswerOffer | null {
  const id = q.identity;
  if (!id) return null;
  const options = q.options.filter((o) => o.code !== id.exactDateCode).map((o) => ({ code: o.code, labelHe: o.labelHe }));
  if (!options.length) return null;
  return { questionRef: encodeQuestionRef({ kind: "finance", questionId: id.questionId, subjectId: q.subject.id, fingerprint: id.fingerprint }), options };
}
