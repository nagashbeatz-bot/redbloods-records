/**
 * Redbloods Partner — Change Engine (Phase D.1). Canonical snapshot builder.
 *
 * PURE. Takes an already-computed PartnerCompanyState (never refetches, never
 * touches Supabase) and produces a PartnerChangeSnapshot: a minimal,
 * privacy-stripped, deterministically-keyed record set — the ONLY thing
 * comparePartnerChangeSnapshots() ever looks at. Two snapshots built from the
 * same state are byte-identical (JSON.stringify equal) — see
 * scripts/test-partner-changes.ts.
 *
 * Privacy: every entity type below carries ONLY stable id + comparable
 * business fields. No notes, phone, email, Dropbox/file URLs, tokens, or free
 * text — see lib/partner/changes/types.ts's per-entity interfaces and the
 * static privacy test.
 */
import type { PartnerCompanyState } from "../eyes/types";
import {
  CHANGE_SNAPSHOT_SCHEMA_VERSION,
  type BalanceLedgerSnapshotEntity, type ClientSnapshotEntity, type ClipSnapshotEntity, type LabelArtistSnapshotEntity,
  type PartnerChangeSnapshot, type ProjectFinanceSettingSnapshotEntity, type ProjectSnapshotEntity, type ProposalSnapshotEntity,
  type ReleaseSnapshotEntity, type SessionSnapshotEntity, type ShowSnapshotEntity, type SnapshotDomainState,
  type StevenSnapshotEntity, type TaskSnapshotEntity, type TransactionSnapshotEntity, type VictorSnapshotEntity,
} from "./types";

function emptyEnvelope<T>(
  d: { status: PartnerCompanyState["domains"]["projects"]["status"]; coverage: PartnerCompanyState["domains"]["projects"]["coverage"]; scopeDescription: string },
): SnapshotDomainState<T> {
  return { status: d.status, coverage: d.coverage, scopeDescription: d.scopeDescription, entities: {} };
}

function keyBy<T>(items: T[], keyOf: (t: T) => string): Record<string, T> {
  const out: Record<string, T> = {};
  for (const item of items) out[keyOf(item)] = item;
  return out;
}

export function buildPartnerChangeSnapshot(state: PartnerCompanyState): PartnerChangeSnapshot {
  // ── projects ──────────────────────────────────────────────────────────────
  const projectsDomain = state.domains.projects;
  const projects: SnapshotDomainState<ProjectSnapshotEntity> = projectsDomain.data
    ? {
        status: projectsDomain.status, coverage: projectsDomain.coverage, scopeDescription: projectsDomain.scopeDescription,
        entities: Object.fromEntries(Object.entries(projectsDomain.data.index).map(([id, entry]) => {
          const full = projectsDomain.data!.open.find((p) => p.id === id);
          return [id, {
            id, name: entry.name, status: entry.status, businessType: entry.businessType, artistText: entry.artistText,
            deadlineYmd: full?.deadline.ymd ?? null, active: full?.active ?? null,
          }];
        })),
      }
    : emptyEnvelope(projectsDomain);

  // ── clients ───────────────────────────────────────────────────────────────
  const clientsDomain = state.domains.clients;
  const clients: SnapshotDomainState<ClientSnapshotEntity> = clientsDomain.data
    ? { status: clientsDomain.status, coverage: clientsDomain.coverage, scopeDescription: clientsDomain.scopeDescription,
        entities: keyBy(clientsDomain.data.items.map((c) => ({ id: c.id, name: c.name, type: c.type, status: c.status })), (e) => e.id) }
    : emptyEnvelope(clientsDomain);

  // ── proposals (full history) ─────────────────────────────────────────────
  const proposalsDomain = state.domains.proposalsFull;
  const proposals: SnapshotDomainState<ProposalSnapshotEntity> = proposalsDomain.data
    ? { status: proposalsDomain.status, coverage: proposalsDomain.coverage, scopeDescription: proposalsDomain.scopeDescription,
        entities: keyBy(proposalsDomain.data.items.map((p) => ({
          id: p.id, clientId: p.clientId, linkedProjectId: p.linkedProjectId, status: p.status,
          amount: p.amount, currency: p.currency, followupYmd: p.followupYmd,
        })), (e) => e.id) }
    : emptyEnvelope(proposalsDomain);

  // ── transactions (full history) ──────────────────────────────────────────
  const txDomain = state.domains.transactions;
  const transactions: SnapshotDomainState<TransactionSnapshotEntity> = txDomain.data
    ? { status: txDomain.status, coverage: txDomain.coverage, scopeDescription: txDomain.scopeDescription,
        entities: keyBy(txDomain.data.items.map((t) => ({
          id: t.id, projectId: t.projectId, type: t.type, amount: t.amount, currency: t.currency,
          status: t.status, dateYmd: t.dateYmd, expenseScope: t.expenseScope, category: t.category,
        })), (e) => e.id) }
    : emptyEnvelope(txDomain);

  // ── tasks (full history) ─────────────────────────────────────────────────
  const tasksDomain = state.domains.tasksFull;
  const tasks: SnapshotDomainState<TaskSnapshotEntity> = tasksDomain.data
    ? { status: tasksDomain.status, coverage: tasksDomain.coverage, scopeDescription: tasksDomain.scopeDescription,
        entities: keyBy(tasksDomain.data.items.map((t) => ({
          id: t.id, status: t.status, dueYmd: t.dueYmd, relatedType: t.relatedType, relatedId: t.relatedId,
        })), (e) => e.id) }
    : emptyEnvelope(tasksDomain);

  // ── releases (full history) ──────────────────────────────────────────────
  const releasesDomain = state.domains.releasesFull;
  const releases: SnapshotDomainState<ReleaseSnapshotEntity> = releasesDomain.data
    ? { status: releasesDomain.status, coverage: releasesDomain.coverage, scopeDescription: releasesDomain.scopeDescription,
        entities: keyBy(releasesDomain.data.items.map((r) => ({
          projectId: r.projectId, labelArtistId: r.labelArtistId, stage: r.stage, targetYmd: r.targetYmd,
        })), (e) => e.projectId) }
    : emptyEnvelope(releasesDomain);

  // ── sessions (full history) ──────────────────────────────────────────────
  const sessionsDomain = state.domains.sessions;
  const sessions: SnapshotDomainState<SessionSnapshotEntity> = sessionsDomain.data
    ? { status: sessionsDomain.status, coverage: sessionsDomain.coverage, scopeDescription: sessionsDomain.scopeDescription,
        entities: keyBy(sessionsDomain.data.items.map((s) => ({
          id: s.id, projectId: s.projectId, showId: s.showId, dateYmd: s.dateYmd, status: s.status, sessionType: s.sessionType,
        })), (e) => e.id) }
    : emptyEnvelope(sessionsDomain);

  // ── shows (full history) ─────────────────────────────────────────────────
  const showsDomain = state.domains.shows;
  const shows: SnapshotDomainState<ShowSnapshotEntity> = showsDomain.data
    ? { status: showsDomain.status, coverage: showsDomain.coverage, scopeDescription: showsDomain.scopeDescription,
        entities: keyBy(showsDomain.data.items.map((s) => ({
          id: s.id, status: s.status, paymentStatus: s.paymentStatus, dateYmd: s.dateYmd,
          djClientId: s.djClientId, djConfirmationStatus: s.djConfirmationStatus, artistClientId: s.artistClientId, bookerClientId: s.bookerClientId,
        })), (e) => e.id) }
    : emptyEnvelope(showsDomain);

  // ── victor (CURRENT_SUBSET: active-status detail only — see Change Readiness Matrix) ──
  const victorDomain = state.domains.victor;
  const victor: SnapshotDomainState<VictorSnapshotEntity> = victorDomain.data
    ? { status: victorDomain.status, coverage: victorDomain.coverage, scopeDescription: victorDomain.scopeDescription,
        entities: keyBy(victorDomain.data.active.map((w) => ({
          id: w.id, projectId: w.projectId, workState: w.workState, internalDeadline: w.internalDeadline,
          uploads: [...w.uploads].sort(),
          reviewEvents: [...w.reviewEvents].sort((a, b) => a.versionKey < b.versionKey ? -1 : a.versionKey > b.versionKey ? 1 : 0),
        })), (e) => e.id) }
    : emptyEnvelope(victorDomain);

  // ── steven (CURRENT_SUBSET: open-status detail only) ─────────────────────
  const stevenDomain = state.domains.steven;
  const steven: SnapshotDomainState<StevenSnapshotEntity> = stevenDomain.data
    ? { status: stevenDomain.status, coverage: stevenDomain.coverage, scopeDescription: stevenDomain.scopeDescription,
        entities: keyBy(stevenDomain.data.open.map((w) => ({
          id: w.id, projectId: w.projectId, status: w.status, hasMixVersion: w.hasMixVersion, lastUploadAt: w.lastUploadAt,
        })), (e) => e.id) }
    : emptyEnvelope(stevenDomain);

  // ── clips (full history) ─────────────────────────────────────────────────
  const clipsDomain = state.domains.clips;
  const clips: SnapshotDomainState<ClipSnapshotEntity> = clipsDomain.data
    ? { status: clipsDomain.status, coverage: clipsDomain.coverage, scopeDescription: clipsDomain.scopeDescription,
        entities: keyBy(clipsDomain.data.items.map((c) => ({ id: c.id, status: c.status, projectId: c.projectId, artistName: c.artistName })), (e) => e.id) }
    : emptyEnvelope(clipsDomain);

  // ── label artists ─────────────────────────────────────────────────────────
  const labelArtistsDomain = state.domains.labelArtists;
  const labelArtists: SnapshotDomainState<LabelArtistSnapshotEntity> = labelArtistsDomain.data
    ? { status: labelArtistsDomain.status, coverage: labelArtistsDomain.coverage, scopeDescription: labelArtistsDomain.scopeDescription,
        entities: keyBy(labelArtistsDomain.data.items.map((a) => ({ id: a.id, name: a.name, status: a.status })), (e) => e.id) }
    : emptyEnvelope(labelArtistsDomain);

  // ── balance ledger (individual entries, from the labelArtists domain's raw rows) ──
  const balanceLedger: SnapshotDomainState<BalanceLedgerSnapshotEntity> = labelArtistsDomain.data
    ? { status: labelArtistsDomain.status, coverage: labelArtistsDomain.coverage, scopeDescription: "artist_balance_entries — individual ledger rows (see eyes:labelArtists.ledgerEntries)",
        entities: keyBy(labelArtistsDomain.data.ledgerEntries.map((e) => ({ id: e.id, artistId: e.artistId, entryType: e.entryType, amount: e.amount, entryDate: e.entryDate })), (e) => e.id) }
    : emptyEnvelope(labelArtistsDomain);

  // ── project finance settings (via eyes:receivables — priced, non-exception projects only) ──
  const receivablesDomain = state.domains.receivables;
  const projectFinanceSettings: SnapshotDomainState<ProjectFinanceSettingSnapshotEntity> = receivablesDomain.data
    ? { status: receivablesDomain.status, coverage: receivablesDomain.coverage,
        scopeDescription: "priced, non-exception projects only (via eyes:receivables) — exception/unpriced projects not tracked for finance-setting changes",
        entities: keyBy(receivablesDomain.data.rows.map((r) => ({ projectId: r.projectId, agreedPrice: r.agreedPrice, currency: r.currency })), (e) => e.projectId) }
    : emptyEnvelope(receivablesDomain);

  return {
    schemaVersion: CHANGE_SNAPSHOT_SCHEMA_VERSION,
    capturedAt: state.capturedAt,
    projects, clients, proposals, transactions, tasks, releases, sessions, shows,
    victor, steven, clips, labelArtists, balanceLedger, projectFinanceSettings,
  };
}
