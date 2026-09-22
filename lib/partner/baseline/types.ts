/**
 * Redbloods Partner — Baseline persistence (Phase D.2). Shared types.
 *
 * A StoredPartnerBaseline is the LAST KNOWN-GOOD PartnerChangeSnapshot,
 * persisted so Change Awareness survives requests, process restarts, and
 * Railway deploys (in-process memory is not durable — Owner instruction
 * §45). Only ONE baseline is kept (the current good one) — no unlimited
 * snapshot history, no event store (Owner instruction §53).
 */
import type { PartnerChangeSnapshot } from "../changes/types";

export interface StoredPartnerBaseline {
  /** Mirrors PartnerChangeSnapshot.schemaVersion at save time — lets a loader detect a stale-format baseline before trusting it, without importing the comparator. */
  schemaVersion: string;
  /** The full canonical snapshot this baseline represents. */
  snapshot: PartnerChangeSnapshot;
  /** When THIS baseline record was persisted (distinct from snapshot.capturedAt, which is when the underlying data was read). */
  savedAt: string;
}
