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
 * Classifies the KIND of relation from how many of `total` rows carry a real id.
 *
 * Quality and coverage are deliberately kept separate (Phase B.1 correction — an
 * earlier version of this function downgraded ID to TEXT_MATCH whenever coverage
 * was partial, which understated a real relation instead of describing it
 * honestly as "ID, but PARTIAL coverage"):
 *   - quality answers "when the link IS present, is it a real id or a name guess?"
 *   - coverage (via coverageFromCounts, attached separately by the caller)
 *     answers "how many rows actually have it?"
 * So: ANY row carrying a real id makes this "ID" — never re-derive quality from
 * the fraction. A caller with zero id-linked rows falls back to "TEXT_MATCH" only
 * when it knows a genuine text-match path exists; otherwise use "NONE" directly.
 */
export function classifyRelationQuality(withId: number, total: number): RelationQuality {
  if (total === 0) return "UNKNOWN";
  if (withId > 0) return "ID";
  return "TEXT_MATCH";
}

/**
 * "NONE" and "UNKNOWN" relation quality are NOT the same case (Phase B.1 fix — found by
 * running scripts/partner-eyes-report.ts against production: a root/anchor entity like
 * Projects, which has no outbound relation to describe at all, was reading reliability
 * LOW purely because relations[] is empty, even with FULL data coverage).
 *   - NONE    = no relation applies here (e.g. an anchor entity, or Suppliers which
 *               doesn't exist) — reliability should follow the domain's OWN coverage only.
 *   - UNKNOWN = a relation SHOULD exist but couldn't be classified — genuinely uncertain,
 *               stays LOW regardless of coverage.
 */
export function reliabilityFrom(coverage: Coverage, relation: RelationQuality): Reliability {
  if (coverage === "FAILED") return "UNKNOWN";
  if (coverage === "NONE") return "LOW";
  if (relation === "NONE") return coverage === "FULL" ? "HIGH" : "MEDIUM";
  if (relation === "UNKNOWN") return "LOW";
  if (relation === "TEXT_MATCH") return coverage === "FULL" ? "MEDIUM" : "LOW";
  return coverage === "FULL" ? "HIGH" : "MEDIUM"; // ID or COMPOSITE
}
