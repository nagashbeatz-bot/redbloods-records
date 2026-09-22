/**
 * Redbloods Partner — Change Engine (Phase D.1). Generic, domain-agnostic diff
 * primitives. PURE. Every domain in compare.ts is wired through these two
 * functions — no domain hand-rolls its own appeared/disappeared/field-changed
 * logic, so the safety rules (source failure, scope change, coverage change,
 * missing stable id) are enforced in exactly one place.
 */
import type {
  ChangeDiagnostic, ChangeDomain, ChangeKind, ChangeValue, ObservedWindow, PartnerChange, SnapshotDomainState,
} from "./types";

export interface FieldSpec<E> {
  field: string;
  kind: Extract<ChangeKind, "STATUS_CHANGED" | "DATE_CHANGED" | "AMOUNT_CHANGED" | "RELATION_CHANGED" | "FIELD_CHANGED">;
  get: (e: E) => ChangeValue;
  /** Human-readable label used only inside `evidence` strings — never a full free-text field from the source row. */
  label: string;
}

function makeChangeId(domain: ChangeDomain, entityType: string, entityId: string, kind: ChangeKind, field: string | null): string {
  return `${domain}:${entityType}:${entityId}:${kind}:${field ?? "-"}`;
}

function change(
  domain: ChangeDomain, entityType: string, entityId: string, kind: ChangeKind, field: string | null,
  before: ChangeValue, after: ChangeValue, window: ObservedWindow, evidence: string[],
  opts?: { sourceOccurredAt?: string | null; epistemicType?: "FACT" | "DERIVED" },
): PartnerChange {
  return {
    id: makeChangeId(domain, entityType, entityId, kind, field),
    domain, entityType, entityId, kind, field, before, after,
    observedBetween: window,
    sourceOccurredAt: opts?.sourceOccurredAt ?? null,
    epistemicType: opts?.epistemicType ?? "FACT",
    evidence,
  };
}

/** Strips any entity whose own key is the empty string — a structurally broken stable id, never diffed, always reported. */
function sanitizeEntities<E>(entities: Record<string, E>): { clean: Record<string, E>; hadMissingId: boolean } {
  if (!("" in entities)) return { clean: entities, hadMissingId: false };
  const clean = { ...entities };
  delete clean[""];
  return { clean, hadMissingId: true };
}

export interface DomainDiffResult { changes: PartnerChange[]; diagnostics: ChangeDiagnostic[] }

/**
 * Diffs one domain's entity map between two snapshots, applying source-failure
 * / scope-change / coverage-change / missing-id safety BEFORE any entity-level
 * comparison (Owner instructions §12-15). Field diffs only ever run over the
 * intersection of ids present in both snapshots — appeared/disappeared is
 * skipped entirely whenever it would be unsafe to trust (coverage changed) or
 * meaningless (scope changed, a source just failed/recovered).
 */
export function diffEntityDomain<E>(
  domain: ChangeDomain, entityType: string,
  prev: SnapshotDomainState<E>, curr: SnapshotDomainState<E>,
  fields: FieldSpec<E>[], window: ObservedWindow,
): DomainDiffResult {
  const diagnostics: ChangeDiagnostic[] = [];
  const prevAvailable = prev.status === "AVAILABLE";
  const currAvailable = curr.status === "AVAILABLE";

  if (prevAvailable && !currAvailable) {
    diagnostics.push({ code: "SOURCE_FAILED_CURRENT", domain, message: `${domain}: previous snapshot had usable data (status=${prev.status}), current does not (status=${curr.status}) — appeared/disappeared/field diffs suppressed for this domain this run.` });
    return { changes: [], diagnostics };
  }
  if (!prevAvailable && currAvailable) {
    diagnostics.push({ code: "SOURCE_RECOVERED_NO_BASELINE", domain, message: `${domain}: previous snapshot had no usable data (status=${prev.status}), current does — no reliable baseline to diff against, so no appeared/disappeared/field diffs are reported for this domain this run (never reported as N new entities).` });
    return { changes: [], diagnostics };
  }
  if (!prevAvailable && !currAvailable) {
    return { changes: [], diagnostics }; // nothing usable in either — nothing to say, no diagnostic needed
  }
  if (prev.scopeDescription !== curr.scopeDescription) {
    diagnostics.push({ code: "SCOPE_CHANGED", domain, message: `${domain}: scope changed between snapshots ("${prev.scopeDescription}" → "${curr.scopeDescription}") — not safe to compare normally, all diffs suppressed for this domain this run.` });
    return { changes: [], diagnostics };
  }

  const coverageChanged = prev.coverage !== curr.coverage;
  if (coverageChanged) {
    diagnostics.push({ code: "COVERAGE_CHANGED", domain, message: `${domain}: coverage changed (${prev.coverage} → ${curr.coverage}) — appeared/disappeared suppressed this run; entities present in BOTH snapshots are still field-diffed.` });
  }

  const { clean: prevEntities, hadMissingId: prevMissing } = sanitizeEntities(prev.entities);
  const { clean: currEntities, hadMissingId: currMissing } = sanitizeEntities(curr.entities);
  if (prevMissing || currMissing) {
    diagnostics.push({ code: "MISSING_STABLE_ID", domain, message: `${domain}: at least one entity had an empty stable id in ${prevMissing && currMissing ? "both snapshots" : prevMissing ? "the previous snapshot" : "the current snapshot"} — excluded from diffing, never guessed at.` });
  }

  const prevIds = Object.keys(prevEntities);
  const currIds = Object.keys(currEntities);
  const prevIdSet = new Set(prevIds);
  const currIdSet = new Set(currIds);
  const changes: PartnerChange[] = [];

  if (!coverageChanged) {
    for (const id of currIds) {
      if (!prevIdSet.has(id)) changes.push(change(domain, entityType, id, "ENTITY_APPEARED", null, null, null, window, [`${entityType} now present`]));
    }
    for (const id of prevIds) {
      if (!currIdSet.has(id)) changes.push(change(domain, entityType, id, "ENTITY_DISAPPEARED", null, null, null, window, [`${entityType} no longer present in this domain's current scope — NOT necessarily deleted (see domain scope)`]));
    }
  }

  const commonIds = prevIds.filter((id) => currIdSet.has(id));
  for (const id of commonIds) {
    const p = prevEntities[id], c = currEntities[id];
    for (const spec of fields) {
      const before = spec.get(p), after = spec.get(c);
      if (before === after) continue;
      changes.push(change(domain, entityType, id, spec.kind, spec.field, before, after, window, [`${spec.label}: ${String(before)} -> ${String(after)}`]));
    }
  }

  return { changes, diagnostics };
}

/**
 * Nested-artifact ADDITIONS ONLY (Owner instruction §32: "if removals cannot
 * be safely detected: support additions only and document limitation" — these
 * arrays are append-only in normal product use; a shrink is never reported as
 * a removal here, it would need real evidence this engine doesn't have).
 * `identity` must come from a stable source fact already used elsewhere for
 * the same purpose (e.g. files_sent[].uploadedAt, the exact evidence
 * Hardening-1's ball logic already keys on) — never a filename or URL.
 */
export function diffNestedAdditions<N>(
  domain: ChangeDomain, entityType: string, parentEntityId: string, fieldPrefix: string,
  prevItems: N[], currItems: N[], identity: (n: N) => string, window: ObservedWindow,
  build: (n: N, id: string) => { after: ChangeValue; sourceOccurredAt: string | null; evidence: string[] },
): PartnerChange[] {
  const prevIds = new Set(prevItems.map(identity));
  const added = currItems.filter((n) => !prevIds.has(identity(n)));
  return added.map((n) => {
    const id = identity(n);
    const b = build(n, id);
    return change(domain, entityType, parentEntityId, "NESTED_ITEM_ADDED", `${fieldPrefix}[${id}]`, null, b.after, window, b.evidence, { sourceOccurredAt: b.sourceOccurredAt });
  });
}

export function sortChanges(changes: PartnerChange[]): PartnerChange[] {
  return [...changes].sort((a, b) => {
    if (a.domain !== b.domain) return a.domain < b.domain ? -1 : 1;
    if (a.entityId !== b.entityId) return a.entityId < b.entityId ? -1 : 1;
    if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
    const af = a.field ?? "", bf = b.field ?? "";
    if (af !== bf) return af < bf ? -1 : 1;
    return 0;
  });
}
