/**
 * Sunny Brain — the Owner approvals screen's view model. Pure (the route reads the snapshot; this shapes it).
 * Pending requests carry their EXACT payload + payload hash (what the Owner approves is what was shown).
 */
import { brainState, type BrainSnapshot } from "./model";

export const ilTodayOf = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

export function buildOwnerApprovalsView(s: BrainSnapshot, now: Date) {
  const today = ilTodayOf(now), st = brainState(s, today, now.toISOString());
  const requests = (s.approvals?.requests ?? []).map((q) => ({ id: q.id, kind: q.kind, summaryHe: q.summaryHe, riskHe: q.riskHe, payload: q.payload, payloadHash: q.payloadHash, requestedVia: q.requestedVia, createdAt: q.createdAt, expiresAt: q.expiresAt, state: st.approvalState(q), decision: st.decisionOf(q.id) }));
  return {
    status: "OK" as const, t2Installed: s.approvals !== null, todayIL: today,
    pending: requests.filter((q) => q.state === "PENDING"),
    decided: requests.filter((q) => q.state !== "PENDING").slice(0, 30),
    authorizations: s.authorizations.map((a) => ({ ...a, state: st.authorizationState(a) })),
    records: s.records.map((x) => ({ id: x.id, recordType: x.recordType, titleHe: x.titleHe, body: x.body, area: x.area, entityKeys: x.entityKeys, confidence: x.confidence, reviewAt: x.reviewAt, createdAt: x.createdAt, status: st.recordStatus(x.id) }))
      .filter((x) => x.status === "OPEN" || x.status === "ENDORSED" || x.status === "ACCEPTED").slice(0, 50),
    counts: { resources: s.resources.length, observations: s.observations.filter((o) => st.observationValid(o.id)).length },
  };
}
