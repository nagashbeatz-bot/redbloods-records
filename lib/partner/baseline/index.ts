/**
 * Redbloods Partner — Baseline persistence + Change Awareness runtime
 * (Phase D.2/D.3). Public entrypoint.
 */
export type { StoredPartnerBaseline } from "./types";
export { loadPartnerBaseline, savePartnerBaseline } from "./store";
export { runPartnerChangeAwareness as runPartnerChangeAwarenessPure, type BaselineIO, type ChangeAwarenessRunResult } from "./lifecycle";
export { runPartnerChangeAwareness } from "./build";
