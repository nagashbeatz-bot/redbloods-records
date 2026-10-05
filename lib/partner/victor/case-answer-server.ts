import "server-only";

/**
 * Redbloods Partner — server binding of the Victor delivery CASE answer (Question memory stage 6, Owner Q1, 2026-10-05).
 * The same shape as lib/partner/integrity/server.ts: the live case (the investigation pipeline, read-only), the EXISTING
 * append-only Owner Context store (the ONLY write) and a brand-new read proving the answer is CURRENT and served on THIS
 * work. Used only by the connector bridge (lib/partner/bridge/server.ts); provenance is set there from the principal.
 */
import { livePartnerView } from "../actions/live";
import { createCompanyReadContext } from "../company/read-context";
import type { CaseAnswerDeps } from "../investigation/case-answer";
import { appendOwnerContext } from "../investigation/context-store";

export function victorCaseAnswerDeps(): CaseAnswerDeps {
  return {
    async loadCase(caseId) {
      const v = await livePartnerView.loadCaseView(caseId);
      return v.status === "OK" ? { status: "OK", caseRef: v.caseRef, contexts: v.contexts } : v;
    },
    appendOwnerContext,
    async verify(contextId, questionId, workId) {
      const ctx = createCompanyReadContext(); // a brand-new read: the row must come back from the database
      if (!(await ctx.ownerContexts())?.some((c) => c.id === contextId && c.questionId === questionId)) return false;
      const mem = await ctx.memory();
      if (!mem || mem.status !== "OK") return false;
      return mem.value.entities.some((e) => e.entity.key === `victor-work:${workId}` && e.ownerDecisions.some((d) => d.contextId === contextId && d.status === "ACTIVE"));
    },
    audit: (event, data) => console.info(`[partner-case-answer] ${event}`, JSON.stringify(data)),
  };
}
