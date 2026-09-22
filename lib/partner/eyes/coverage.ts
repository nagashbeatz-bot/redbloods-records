/**
 * Pure classification helpers shared by coo-adapter.ts and the Partner-only
 * domain builders. No I/O, no business reasoning — just a mechanical,
 * testable mapping from raw facts (did the read succeed? how many rows are
 * usable out of how many total? what kind of relation is this?) to the
 * DataStatus / Coverage / Reliability / RelationQuality enums.
 */
import type { SourceStatus } from "../../coo/types";
import type { Coverage, DataStatus, Reliability, RelationQuality } from "./types";

export function statusFromSource(source: SourceStatus | undefined): DataStatus {
  if (!source) return "UNAVAILABLE";
  if (source.status === "failed") return "UNKNOWN";
  if (source.status === "skipped") return "UNAVAILABLE";
  return "AVAILABLE";
}

/** Coverage from a lib/coo-style (usable, total) pair. null in either → the read failed, not "0 of 0". */
export function coverageFromCounts(usable: number | null, total: number | null): Coverage {
  if (usable === null || total === null) return "FAILED";
  if (total === 0) return "NONE";
  if (usable <= 0) return "NONE";
  if (usable >= total) return "FULL";
  return "PARTIAL";
}

/** Coverage for a domain with no partial-coverage concept: we either have the rows or we don't. */
export function coverageFromStatus(status: DataStatus): Coverage {
  if (status === "AVAILABLE") return "FULL";
  if (status === "PARTIAL") return "PARTIAL";
  if (status === "UNKNOWN") return "FAILED";
  return "NONE";
}

/**
 * Classifies a relation from how many of `total` rows carry a real id vs none.
 * Deliberately conservative: anything short of ALL rows carrying the id still
 * reads as TEXT_MATCH overall — callers must add a warning stating the exact
 * split so nothing here silently overstates reliability for a partially-linked set.
 */
export function classifyRelationQuality(withId: number, total: number): RelationQuality {
  if (total === 0) return "UNKNOWN";
  if (withId === 0) return "TEXT_MATCH";
  if (withId >= total) return "ID";
  return "TEXT_MATCH";
}

export function reliabilityFrom(coverage: Coverage, relation: RelationQuality): Reliability {
  if (coverage === "FAILED") return "UNKNOWN";
  if (coverage === "NONE") return "LOW";
  if (relation === "NONE" || relation === "UNKNOWN") return "LOW";
  if (relation === "TEXT_MATCH") return coverage === "FULL" ? "MEDIUM" : "LOW";
  return coverage === "FULL" ? "HIGH" : "MEDIUM"; // ID or COMPOSITE
}
