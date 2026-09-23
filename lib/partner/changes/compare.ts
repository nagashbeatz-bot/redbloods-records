/**
 * Redbloods Partner — Change Engine (Phase D.1). Public comparison entrypoint.
 *
 * PURE. comparePartnerChangeSnapshots(previous, current) is the whole "NOTICE"
 * step: no I/O, no persistence (that's D.2/D.3), no Cases/Recommendations
 * (Phase E). Canonical change source = Eyes facts (via the snapshot's own
 * per-domain entity maps), never Dossiers — one transaction change must never
 * fan out into duplicate "project finance changed" / "client finance
 * changed" / "artist finance changed" events (Owner instruction §6, §62).
 */
import type { FieldSpec } from "./diff";
import { diffEntityDomain, diffNestedAdditions, sortChanges } from "./diff";
import {
  CHANGE_SNAPSHOT_SCHEMA_VERSION,
  type ChangeComparisonResult, type ChangeDiagnostic, type ClientSnapshotEntity, type ClipSnapshotEntity,
  type LabelArtistSnapshotEntity, type PartnerChange, type PartnerChangeSnapshot, type ProjectFinanceSettingSnapshotEntity,
  type ProjectSnapshotEntity, type ProposalSnapshotEntity, type ReleaseSnapshotEntity, type SessionSnapshotEntity,
  type ShowSnapshotEntity, type BalanceLedgerSnapshotEntity, type StevenSnapshotEntity, type TaskSnapshotEntity,
  type TransactionSnapshotEntity, type VictorSnapshotEntity,
} from "./types";

const RECEIVED_STATUSES = new Set(["שולם", "התקבל"]);

const PROJECT_FIELDS: FieldSpec<ProjectSnapshotEntity>[] = [
  { field: "status", kind: "STATUS_CHANGED", get: (e) => e.status, label: "status" },
  { field: "deadlineYmd", kind: "DATE_CHANGED", get: (e) => e.deadlineYmd, label: "deadline" },
  { field: "businessType", kind: "FIELD_CHANGED", get: (e) => e.businessType, label: "businessType" },
  { field: "name", kind: "FIELD_CHANGED", get: (e) => e.name, label: "name" },
];
const CLIENT_FIELDS: FieldSpec<ClientSnapshotEntity>[] = [
  { field: "status", kind: "STATUS_CHANGED", get: (e) => e.status, label: "status" },
  { field: "type", kind: "FIELD_CHANGED", get: (e) => e.type, label: "type" },
  { field: "name", kind: "FIELD_CHANGED", get: (e) => e.name, label: "name" },
];
const PROPOSAL_FIELDS: FieldSpec<ProposalSnapshotEntity>[] = [
  { field: "status", kind: "STATUS_CHANGED", get: (e) => e.status, label: "status" },
  { field: "amount", kind: "AMOUNT_CHANGED", get: (e) => e.amount, label: "amount" },
  { field: "currency", kind: "FIELD_CHANGED", get: (e) => e.currency, label: "currency" },
  { field: "followupYmd", kind: "DATE_CHANGED", get: (e) => e.followupYmd, label: "followup date" },
  { field: "clientId", kind: "RELATION_CHANGED", get: (e) => e.clientId, label: "client_id" },
  { field: "linkedProjectId", kind: "RELATION_CHANGED", get: (e) => e.linkedProjectId, label: "linked_project_id" },
];
const TRANSACTION_FIELDS: FieldSpec<TransactionSnapshotEntity>[] = [
  { field: "status", kind: "STATUS_CHANGED", get: (e) => e.status, label: "payment_status" },
  { field: "amount", kind: "AMOUNT_CHANGED", get: (e) => e.amount, label: "amount" },
  { field: "currency", kind: "FIELD_CHANGED", get: (e) => e.currency, label: "currency" },
  { field: "dateYmd", kind: "DATE_CHANGED", get: (e) => e.dateYmd, label: "date" },
  { field: "projectId", kind: "RELATION_CHANGED", get: (e) => e.projectId, label: "project_id" },
  { field: "expenseScope", kind: "FIELD_CHANGED", get: (e) => e.expenseScope, label: "expense_scope" },
  { field: "category", kind: "FIELD_CHANGED", get: (e) => e.category, label: "category" },
  { field: "type", kind: "FIELD_CHANGED", get: (e) => e.type, label: "type" },
];
const TASK_FIELDS: FieldSpec<TaskSnapshotEntity>[] = [
  { field: "status", kind: "STATUS_CHANGED", get: (e) => e.status, label: "status" },
  { field: "dueYmd", kind: "DATE_CHANGED", get: (e) => e.dueYmd, label: "due date" },
  { field: "related", kind: "RELATION_CHANGED", get: (e) => `${e.relatedType}:${e.relatedId ?? ""}`, label: "related entity" },
];
const RELEASE_FIELDS: FieldSpec<ReleaseSnapshotEntity>[] = [
  { field: "stage", kind: "STATUS_CHANGED", get: (e) => e.stage, label: "release_stage" },
  { field: "targetYmd", kind: "DATE_CHANGED", get: (e) => e.targetYmd, label: "release_target_date" },
  { field: "labelArtistId", kind: "RELATION_CHANGED", get: (e) => e.labelArtistId, label: "label_artist_id" },
];
const SESSION_FIELDS: FieldSpec<SessionSnapshotEntity>[] = [
  { field: "status", kind: "STATUS_CHANGED", get: (e) => e.status, label: "status" },
  { field: "dateYmd", kind: "DATE_CHANGED", get: (e) => e.dateYmd, label: "date" },
  { field: "sessionType", kind: "FIELD_CHANGED", get: (e) => e.sessionType, label: "session_type" },
  { field: "projectId", kind: "RELATION_CHANGED", get: (e) => e.projectId, label: "project_id" },
  { field: "showId", kind: "RELATION_CHANGED", get: (e) => e.showId, label: "show_id" },
];
const SHOW_FIELDS: FieldSpec<ShowSnapshotEntity>[] = [
  { field: "status", kind: "STATUS_CHANGED", get: (e) => e.status, label: "status" },
  { field: "paymentStatus", kind: "STATUS_CHANGED", get: (e) => e.paymentStatus, label: "payment_status" },
  { field: "dateYmd", kind: "DATE_CHANGED", get: (e) => e.dateYmd, label: "date" },
  { field: "djClientId", kind: "RELATION_CHANGED", get: (e) => e.djClientId, label: "dj_client_id" },
  { field: "djConfirmationStatus", kind: "STATUS_CHANGED", get: (e) => e.djConfirmationStatus, label: "dj_confirmation_status" },
  { field: "artistClientId", kind: "RELATION_CHANGED", get: (e) => e.artistClientId, label: "artist_client_id" },
  { field: "bookerClientId", kind: "RELATION_CHANGED", get: (e) => e.bookerClientId, label: "booker_client_id" },
];
const VICTOR_FIELDS: FieldSpec<VictorSnapshotEntity>[] = [
  { field: "workState", kind: "STATUS_CHANGED", get: (e) => e.workState, label: "work_state" },
  { field: "internalDeadline", kind: "DATE_CHANGED", get: (e) => e.internalDeadline, label: "internal_deadline" },
  { field: "projectId", kind: "RELATION_CHANGED", get: (e) => e.projectId, label: "project_id" },
];
const STEVEN_FIELDS: FieldSpec<StevenSnapshotEntity>[] = [
  { field: "status", kind: "STATUS_CHANGED", get: (e) => e.status, label: "status" },
  { field: "hasMixVersion", kind: "FIELD_CHANGED", get: (e) => e.hasMixVersion, label: "hasMixVersion" },
  { field: "lastUploadAt", kind: "DATE_CHANGED", get: (e) => e.lastUploadAt, label: "lastUploadAt" },
  { field: "projectId", kind: "RELATION_CHANGED", get: (e) => e.projectId, label: "project_id" },
];
const CLIP_FIELDS: FieldSpec<ClipSnapshotEntity>[] = [
  { field: "status", kind: "STATUS_CHANGED", get: (e) => e.status, label: "status" },
  { field: "projectId", kind: "RELATION_CHANGED", get: (e) => e.projectId, label: "project_id" },
  { field: "artistName", kind: "FIELD_CHANGED", get: (e) => e.artistName, label: "artist_name" },
];
const LABEL_ARTIST_FIELDS: FieldSpec<LabelArtistSnapshotEntity>[] = [
  { field: "status", kind: "STATUS_CHANGED", get: (e) => e.status, label: "status" },
  { field: "name", kind: "FIELD_CHANGED", get: (e) => e.name, label: "name" },
];
const BALANCE_LEDGER_FIELDS: FieldSpec<BalanceLedgerSnapshotEntity>[] = [
  { field: "amount", kind: "AMOUNT_CHANGED", get: (e) => e.amount, label: "amount" },
  { field: "entryType", kind: "FIELD_CHANGED", get: (e) => e.entryType, label: "entry_type" },
  { field: "entryDate", kind: "DATE_CHANGED", get: (e) => e.entryDate, label: "entry_date" },
  { field: "artistId", kind: "RELATION_CHANGED", get: (e) => e.artistId, label: "artist_id" },
];
const PROJECT_FINANCE_FIELDS: FieldSpec<ProjectFinanceSettingSnapshotEntity>[] = [
  { field: "agreedPrice", kind: "AMOUNT_CHANGED", get: (e) => e.agreedPrice, label: "agreedPrice" },
  { field: "currency", kind: "FIELD_CHANGED", get: (e) => e.currency, label: "currency" },
];

export function comparePartnerChangeSnapshots(
  previous: PartnerChangeSnapshot | null, current: PartnerChangeSnapshot,
): ChangeComparisonResult {
  const base = { previousCapturedAt: previous?.capturedAt ?? null, currentCapturedAt: current.capturedAt };

  if (!previous) {
    return { ...base, changes: [], comparable: false, diagnostics: [{ code: "NO_BASELINE", domain: null, message: "No previous snapshot supplied — nothing to compare against. This is expected on the very first observation." }] };
  }
  if (previous.schemaVersion !== CHANGE_SNAPSHOT_SCHEMA_VERSION || current.schemaVersion !== CHANGE_SNAPSHOT_SCHEMA_VERSION || previous.schemaVersion !== current.schemaVersion) {
    return {
      ...base, changes: [], comparable: false,
      diagnostics: [{ code: "INCOMPATIBLE_SCHEMA", domain: null, message: `Snapshot schema mismatch (previous=${previous.schemaVersion}, current=${current.schemaVersion}, engine expects ${CHANGE_SNAPSHOT_SCHEMA_VERSION}) — refusing to compare rather than risk misreading a shape change as a business change.` }],
    };
  }

  const window = { from: previous.capturedAt, to: current.capturedAt };
  const diagnostics: ChangeDiagnostic[] = [];
  const changes: PartnerChange[] = [];
  const collect = (r: { changes: PartnerChange[]; diagnostics: ChangeDiagnostic[] }) => { changes.push(...r.changes); diagnostics.push(...r.diagnostics); };

  collect(diffEntityDomain("projects", "project", previous.projects, current.projects, PROJECT_FIELDS, window));
  collect(diffEntityDomain("clients", "client", previous.clients, current.clients, CLIENT_FIELDS, window));
  collect(diffEntityDomain("proposals", "proposal", previous.proposals, current.proposals, PROPOSAL_FIELDS, window));
  collect(diffEntityDomain("tasks", "task", previous.tasks, current.tasks, TASK_FIELDS, window));
  collect(diffEntityDomain("releases", "release", previous.releases, current.releases, RELEASE_FIELDS, window));
  collect(diffEntityDomain("sessions", "session", previous.sessions, current.sessions, SESSION_FIELDS, window));
  collect(diffEntityDomain("shows", "show", previous.shows, current.shows, SHOW_FIELDS, window));
  collect(diffEntityDomain("clips", "clip", previous.clips, current.clips, CLIP_FIELDS, window));
  collect(diffEntityDomain("labelArtists", "labelArtist", previous.labelArtists, current.labelArtists, LABEL_ARTIST_FIELDS, window));
  collect(diffEntityDomain("balanceLedger", "balanceLedgerEntry", previous.balanceLedger, current.balanceLedger, BALANCE_LEDGER_FIELDS, window));
  collect(diffEntityDomain("projectFinanceSettings", "projectFinanceSetting", previous.projectFinanceSettings, current.projectFinanceSettings, PROJECT_FINANCE_FIELDS, window));
  collect(diffEntityDomain("steven", "stevenWork", previous.steven, current.steven, STEVEN_FIELDS, window));

  // ── transactions: structural diff + one DERIVED semantic when the received/not-received line is crossed ──
  const txResult = diffEntityDomain("transactions", "transaction", previous.transactions, current.transactions, TRANSACTION_FIELDS, window);
  collect(txResult);
  if (previous.transactions.status === "AVAILABLE" && current.transactions.status === "AVAILABLE" && previous.transactions.scopeDescription === current.transactions.scopeDescription) {
    const commonIds = Object.keys(previous.transactions.entities).filter((id) => id in current.transactions.entities);
    for (const id of commonIds) {
      const p = previous.transactions.entities[id], c = current.transactions.entities[id];
      if (p.status === c.status) continue;
      // "Received" is an INCOME concept only (canonical: income שולם|התקבל). An expense turning שולם is money
      // paid OUT — it must never be reported as money received (expense paid = שולם only).
      if (p.type !== "income" || c.type !== "income") continue;
      const wasReceived = RECEIVED_STATUSES.has(p.status), isReceived = RECEIVED_STATUSES.has(c.status);
      if (wasReceived === isReceived) continue;
      changes.push({
        id: `transactions:transaction:${id}:STATUS_CHANGED:receivedSemantic`,
        domain: "transactions", entityType: "transaction", entityId: id, kind: "STATUS_CHANGED", field: "receivedSemantic",
        before: wasReceived ? "RECEIVED" : "NOT_RECEIVED", after: isReceived ? "RECEIVED" : "NOT_RECEIVED",
        observedBetween: window, sourceOccurredAt: null, epistemicType: "DERIVED",
        evidence: [`payment_status ${p.status} -> ${c.status} crosses the received/not-received line (finance semantics: income שולם/התקבל = received)`],
      });
    }
  }

  // ── victor: structural diff + nested-artifact additions (uploads, sent version reviews) — additions only, append-only assumption ──
  const victorResult = diffEntityDomain("victor", "victorWork", previous.victor, current.victor, VICTOR_FIELDS, window);
  collect(victorResult);
  if (previous.victor.status === "AVAILABLE" && current.victor.status === "AVAILABLE" && previous.victor.scopeDescription === current.victor.scopeDescription) {
    const commonIds = Object.keys(previous.victor.entities).filter((id) => id in current.victor.entities);
    for (const id of commonIds) {
      const p = previous.victor.entities[id], c = current.victor.entities[id];
      changes.push(...diffNestedAdditions(
        "victor", "victorWork", id, "upload", p.uploads, c.uploads, (u) => u, window,
        (u) => ({ after: u, sourceOccurredAt: u, evidence: [`Victor delivery uploaded at ${u}`] }),
      ));
      changes.push(...diffNestedAdditions(
        "victor", "victorWork", id, "reviewSent", p.reviewEvents, c.reviewEvents, (r) => r.versionKey, window,
        (r) => ({ after: r.sentAt, sourceOccurredAt: r.sentAt, evidence: [`Owner sent a revision for version "${r.versionKey}" at ${r.sentAt}`] }),
      ));
    }
  }

  return { ...base, changes: sortChanges(changes), diagnostics, comparable: true };
}
