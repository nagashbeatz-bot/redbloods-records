/**
 * Redbloods Partner — Eyes / Company State (Phase B) public entrypoint.
 *
 * Snapshot only: no signals, no cases, no recommendations, no reasoning
 * about the business. See lib/partner/eyes/types.ts for the epistemic
 * model (DataStatus / Coverage / Reliability / RelationQuality).
 */
export * from "./types";
export { assemblePartnerCompanyState } from "./company-state";
export { adaptCooCompanyState } from "./coo-adapter";
export type { CooAdaptedDomains } from "./coo-adapter";
export { readPartnerEyesRaw } from "./readers";
export { buildPartnerCompanyState } from "./build";
export {
  statusFromSource, coverageFromCounts, coverageFromStatus, classifyRelationQuality, reliabilityFrom,
} from "./coverage";
