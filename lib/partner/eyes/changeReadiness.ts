/**
 * Redbloods Partner — Change Readiness Matrix (Phase C.3).
 *
 * This is DATA READINESS metadata, not Change Awareness itself. It answers
 * one question per domain: "if we saved two PartnerCompanyState snapshots,
 * could we reliably tell what was created / updated / transitioned status —
 * without misreading a filter's edge (a closed proposal, a completed task,
 * a released record) as a deletion?"
 *
 * Explicitly NOT here (Phase D, not started, needs Owner approval):
 *   - no snapshot storage, no persistence, no comparison
 *   - no diffing, no event system, no delta engine
 *   - no "since last visit" reasoning
 *
 * The facts below (stableIdField / hasCreatedAt / hasUpdatedAt / businessDateField
 * / statusField) come from the schema audit done in this same phase (a live,
 * read-only column-name check against every table involved — see the Phase
 * C.3 report) cross-checked against how each domain is actually built in
 * company-state.ts / coo-adapter.ts. They are static per domain (the SHAPE of
 * the data doesn't change snapshot to snapshot) — only `scope`/coverage-derived
 * fields are read live from the domain state passed in.
 */
import type { ChangeReadinessEntry, HistoryScope, PartnerCompanyState } from "./types";

type Domains = PartnerCompanyState["domains"];

interface StaticFacts {
  scope: HistoryScope;
  stableIdField: string | null;
  hasCreatedAt: boolean;
  hasUpdatedAt: boolean;
  businessDateField: string | null;
  statusField: string | null;
  extraWarnings: string[];
}

// One row per domain key actually present on PartnerCompanyState.domains — audited facts.
const FACTS: Record<keyof Domains, StaticFacts> = {
  projects: {
    scope: "CURRENT_SUBSET", stableIdField: "projects.id", hasCreatedAt: true, hasUpdatedAt: true,
    businessDateField: "projects.deadline", statusField: "projects.status",
    extraWarnings: ["scope = is_hidden=false only — a project leaving Eyes could mean it became hidden, not that it was deleted."],
  },
  clients: {
    scope: "CURRENT_SUBSET", stableIdField: "clients.id", hasCreatedAt: true, hasUpdatedAt: false,
    businessDateField: null, statusField: "clients.status",
    extraWarnings: ["clients has no updated_at column (confirmed against the live schema) — a field-level edit to an existing client row is not detectable from timestamps alone, only its presence/absence and its own status field."],
  },
  proposals: {
    scope: "CURRENT_SUBSET", stableIdField: "proposals.id", hasCreatedAt: true, hasUpdatedAt: true,
    businessDateField: "proposals.followup_date", statusField: "proposals.status",
    extraWarnings: ["This is lib/coo's own status-filtered read (drops נסגר/לא נסגר) — use the proposalsFull domain for change-readiness, not this one; a proposal closing would otherwise look like a deletion here."],
  },
  finance: {
    scope: "DERIVED_AGGREGATE", stableIdField: null, hasCreatedAt: false, hasUpdatedAt: false,
    businessDateField: null, statusField: null,
    extraWarnings: ["An aggregate (FinanceFact), not raw rows — no per-row id to diff. Use the transactions domain for row-level change detection."],
  },
  receivables: {
    scope: "DERIVED_AGGREGATE", stableIdField: "receivables.projectId (derived key, not a table row id)", hasCreatedAt: false, hasUpdatedAt: false,
    businessDateField: null, statusField: null,
    extraWarnings: ["Derived per-project balance (finance_<projectId> settings + transactions), not a raw table — recomputed each read, not a row with its own history."],
  },
  sessions: {
    scope: "FULL_HISTORY", stableIdField: "sessions.id", hasCreatedAt: true, hasUpdatedAt: false,
    businessDateField: "sessions.date", statusField: "sessions.status",
    extraWarnings: ["sessions has no updated_at column (confirmed against the live schema) — a status/time edit to an existing session is not detectable from timestamps, only from the status field's own value changing between snapshots."],
  },
  releases: {
    scope: "CURRENT_SUBSET", stableIdField: "project_release_details.project_id (also the FK/PK)", hasCreatedAt: true, hasUpdatedAt: true,
    businessDateField: "project_release_details.release_target_date", statusField: "project_release_details.release_stage",
    extraWarnings: ["This is lib/coo's own active-stage/visible-label-only read — use the releasesFull domain for change-readiness; a release becoming יצא/released would otherwise look like a deletion here."],
  },
  shows: {
    scope: "FULL_HISTORY", stableIdField: "shows.id", hasCreatedAt: true, hasUpdatedAt: true,
    businessDateField: "shows.date", statusField: "shows.status",
    extraWarnings: [],
  },
  victor: {
    scope: "CURRENT_SUBSET", stableIdField: "vendor_project_work.id", hasCreatedAt: true, hasUpdatedAt: true,
    businessDateField: "vendor_project_work.sent_date / internal_deadline", statusField: "vendor_project_work.status / work_state",
    extraWarnings: ["totalWorks (count) is genuinely full history (getVictorWork() has no status filter), but per-row DETAIL here is active-status only — a work completing would disappear from the detailed set even though the count stays right."],
  },
  steven: {
    scope: "CURRENT_SUBSET", stableIdField: "sound_engineer_work.id", hasCreatedAt: true, hasUpdatedAt: true,
    businessDateField: "sound_engineer_work.sent_date / internal_deadline", statusField: "sound_engineer_work.status",
    extraWarnings: ["totalWorks (count) is genuinely full history (listSoundEngineerWork() has no status filter), but per-row DETAIL here is open-only — same shape as Victor."],
  },
  tasks: {
    scope: "CURRENT_SUBSET", stableIdField: "tasks.id", hasCreatedAt: true, hasUpdatedAt: true,
    businessDateField: "tasks.due_date", statusField: "tasks.status",
    extraWarnings: ["open-only (status=\"פתוח\", explicit lib/coo filter) — use the tasksFull domain for change-readiness; a task closing would otherwise look like a deletion here."],
  },
  labelArtists: {
    scope: "CURRENT_SUBSET", stableIdField: "label_artists.id", hasCreatedAt: true, hasUpdatedAt: true,
    businessDateField: null, statusField: "label_artists.status",
    extraWarnings: [],
  },
  clips: {
    scope: "FULL_HISTORY", stableIdField: "red_films_productions.id", hasCreatedAt: true, hasUpdatedAt: true,
    businessDateField: null, statusField: "red_films_productions.status",
    extraWarnings: [],
  },
  suppliers: {
    scope: "NOT_APPLICABLE", stableIdField: null, hasCreatedAt: false, hasUpdatedAt: false,
    businessDateField: null, statusField: null,
    extraWarnings: ["No dedicated suppliers/vendors table exists — see the domain's own warnings."],
  },
  proposalsFull: {
    scope: "FULL_HISTORY", stableIdField: "proposals.id", hasCreatedAt: true, hasUpdatedAt: true,
    businessDateField: "proposals.followup_date / sent_date", statusField: "proposals.status",
    extraWarnings: [],
  },
  releasesFull: {
    scope: "FULL_HISTORY", stableIdField: "project_release_details.project_id (also the FK/PK)", hasCreatedAt: true, hasUpdatedAt: true,
    businessDateField: "project_release_details.release_target_date", statusField: "project_release_details.release_stage",
    extraWarnings: ["project_id doubles as the release's own id AND its FK to projects — a project can only ever have one release row (1:1), never a release history of its own."],
  },
  transactions: {
    scope: "FULL_HISTORY", stableIdField: "transactions.id", hasCreatedAt: true, hasUpdatedAt: false,
    businessDateField: "transactions.date", statusField: "transactions.payment_status",
    extraWarnings: ["transactions has no updated_at column (confirmed against the live schema) — an amount/status edit to an EXISTING transaction row is not detectable from timestamps alone, only from the payment_status field's own value changing between snapshots (createdAt alone can't date the edit)."],
  },
  tasksFull: {
    scope: "FULL_HISTORY", stableIdField: "tasks.id", hasCreatedAt: true, hasUpdatedAt: true,
    businessDateField: "tasks.due_date", statusField: "tasks.status",
    extraWarnings: [],
  },
};

export function buildChangeReadinessMatrix(domains: Domains): ChangeReadinessEntry[] {
  const out: ChangeReadinessEntry[] = [];
  for (const key of Object.keys(FACTS) as Array<keyof Domains>) {
    const f = FACTS[key];
    const d = domains[key];
    const hasUsableStableId = f.stableIdField !== null;
    const historyKnown = f.scope === "FULL_HISTORY" || f.scope === "CURRENT_SUBSET";
    const supportsCreateDetection = hasUsableStableId && historyKnown && d.status === "AVAILABLE";
    const supportsUpdateDetection = hasUsableStableId && f.hasUpdatedAt && d.status === "AVAILABLE";
    const supportsStatusTransitionDetection = hasUsableStableId && f.statusField !== null && f.hasUpdatedAt && d.status === "AVAILABLE";
    out.push({
      domain: key,
      scope: f.scope,
      scopeDescription: d.scopeDescription,
      stableIdField: f.stableIdField,
      hasCreatedAt: f.hasCreatedAt,
      hasUpdatedAt: f.hasUpdatedAt,
      businessDateField: f.businessDateField,
      statusField: f.statusField,
      supportsCreateDetection,
      supportsUpdateDetection,
      supportsStatusTransitionDetection,
      warnings: [...f.extraWarnings, ...(d.status !== "AVAILABLE" ? [`domain status is ${d.status}, not AVAILABLE in this snapshot — no detection is possible right now regardless of shape.`] : [])],
    });
  }
  return out;
}
