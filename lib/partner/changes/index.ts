/**
 * Redbloods Partner — Change Engine (Phase D.1). Public entrypoint.
 *
 * SEE → REMEMBER → NOTICE. Pure, deterministic, no I/O in this module at all.
 * No Cases/Recommendations/Priority (Phase E, not started) — see
 * lib/partner/changes/types.ts's module doc for the full epistemic model.
 */
export * from "./types";
export { buildPartnerChangeSnapshot } from "./snapshot";
export { comparePartnerChangeSnapshots } from "./compare";
export { diffEntityDomain, diffNestedAdditions, sortChanges } from "./diff";
export type { FieldSpec, DomainDiffResult } from "./diff";
