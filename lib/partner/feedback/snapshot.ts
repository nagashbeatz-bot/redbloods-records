/**
 * Redbloods Partner — Structured Owner Feedback (Phase F.1). Case snapshot +
 * evidence fingerprint. Pure, no I/O.
 *
 * Deliberately does NOT store the full facts/derivedFacts array (Owner
 * instruction §18: "do not store everything blindly") — only a compact
 * deterministic fingerprint, so a later reader can tell whether the SAME
 * caseId's evidentiary state has since changed, without duplicating the
 * Case payload.
 */
import type { PartnerCase } from "../cases/types";
import type { PartnerCaseFeedbackSnapshot } from "./types";

/**
 * Deterministic, order-independent FNV-1a style string hash — NOT
 * cryptographic, not meant to be (no security property needed here; this is
 * a change-detection fingerprint, not an auth token). Pure, no Node built-in
 * (keeps this module free of any "crypto"/"node:*" import, matching every
 * other pure lib/partner module).
 */
function stableHash(input: string): string {
  let h1 = 0xdeadbeef ^ input.length;
  let h2 = 0x41c6ce57 ^ input.length;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h1 >>> 0).toString(16).padStart(8, "0") + (h2 >>> 0).toString(16).padStart(8, "0");
}

/** Stable stringify — object keys sorted so field-declaration order in a detector never changes the fingerprint. Arrays keep their own order (facts/derivedFacts order IS meaningful — a detector reordering them would be a real shape change). */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`).join(",")}}`;
}

/**
 * Fingerprints exactly what a Case's evidence CLAIMS — facts, derivedFacts,
 * classification, hypotheses, unknowns. Deliberately excludes changeContext
 * (capturedAt timestamps churn on every run without the underlying evidence
 * changing) and dataQuality.notes (prose, not evidence).
 */
export function fingerprintCaseEvidence(c: PartnerCase): string {
  return stableHash(stableStringify({
    facts: c.facts,
    derivedFacts: c.derivedFacts,
    classification: c.classification,
    status: c.status,
    hypotheses: c.hypotheses,
    unknowns: c.unknowns,
    ownerRulesApplied: c.ownerRulesApplied,
  }));
}

/**
 * Fingerprints ONLY the Case's direct facts (field reads such as a deadline
 * date, a status, a lastUploadAt) — deliberately excluding derivedFacts,
 * which churn daily ("days late" grows by one every day without anything
 * having happened). Used by the investigation layer to tell whether an
 * Owner answer still describes the same underlying situation (F.1D).
 */
export function fingerprintCaseFacts(c: PartnerCase): string {
  return stableHash(stableStringify(c.facts));
}

/** Builds the minimal, immutable snapshot a CASE_INSTANCE/HYPOTHESIS-scoped feedback record must carry. `capturedAt` is normally the feedback's own createdAt — passed in, never Date.now() read here (deterministic, testable). */
export function buildCaseFeedbackSnapshot(c: PartnerCase, capturedAt: string): PartnerCaseFeedbackSnapshot {
  return {
    caseId: c.id,
    caseType: c.caseType,
    subjectType: c.subjectType,
    subjectId: c.subjectId,
    classification: c.classification,
    status: c.status,
    createdFrom: c.createdFrom,
    caseSchemaVersion: c.schemaVersion,
    evidenceFingerprint: fingerprintCaseEvidence(c),
    capturedAt,
  };
}
