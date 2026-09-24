import "server-only";

/**
 * Redbloods Partner — live Partner view for Action decisions (Phase F.1H).
 * READ-ONLY: rebuilds the company state, the Cases (same pipeline as the
 * shadow reports) and the Owner Context history, then re-derives Suggested
 * Actions. The baseline is only loaded, never saved. Nothing is written.
 */
import { loadPartnerBaseline } from "../baseline/store";
import { buildPartnerCases } from "../cases/engine";
import type { PartnerCase } from "../cases/types";
import { comparePartnerChangeSnapshots } from "../changes/compare";
import { buildPartnerChangeSnapshot } from "../changes/snapshot";
import { buildPartnerCompanyState } from "../eyes/build";
import type { PartnerCompanyState } from "../eyes/types";
import { getContextsForCase, listOwnerContexts } from "../investigation/context-store";
import type { PersistedOwnerContext } from "../investigation/context-row";
import { deriveCaseDecisionState } from "../investigation/decision-state";
import type { ActionLiveView, LiveActionLookup, LiveCaseView } from "./service";
import { deriveSuggestedActions } from "./suggested";
import type { PartnerSuggestedAction } from "./types";

export interface LiveCases { cases: PartnerCase[]; labels: Map<string, string> }

/** state: an already-built company state of the SAME request (Gateway request-scoped read) — reused, never re-read. */
export async function buildLiveCases(shared?: PartnerCompanyState): Promise<LiveCases> {
  const baseline = await loadPartnerBaseline();
  const state = shared ?? await buildPartnerCompanyState();
  let changes: ReturnType<typeof comparePartnerChangeSnapshots>["changes"] = [];
  let changeContext: { previousCapturedAt: string | null; currentCapturedAt: string } | null = null;
  if (baseline) {
    const cmp = comparePartnerChangeSnapshots(baseline.snapshot, buildPartnerChangeSnapshot(state));
    changes = cmp.changes;
    changeContext = { previousCapturedAt: cmp.previousCapturedAt, currentCapturedAt: cmp.currentCapturedAt };
  }
  const cases = buildPartnerCases({ state, today: state.todayIL, changes, changeContext });
  const labels = new Map<string, string>((state.domains.projects.data?.open ?? []).map((p: { id: string; name: string }) => [p.id, p.name]));
  return { cases, labels };
}

async function caseContexts(caseId: string): Promise<{ ok: true; contexts: PersistedOwnerContext[] } | { ok: false; detail: string }> {
  const h = await getContextsForCase(caseId);
  if (h.status === "OK") return { ok: true, contexts: h.contexts };
  if (h.status === "NO_CONTEXT") return { ok: true, contexts: [] };
  return { ok: false, detail: h.status === "READ_FAILED" ? h.error.message : `owner context unreadable (${h.status})` };
}

function deriveFor(c: PartnerCase, contexts: PersistedOwnerContext[], labels: Map<string, string>): PartnerSuggestedAction[] {
  const ds = deriveCaseDecisionState(c, contexts);
  return deriveSuggestedActions({ case: c, decisionState: ds, subjectLabelHe: c.subjectType === "project" ? labels.get(c.subjectId) ?? null : null }).actions;
}

export interface LiveProposal { action: PartnerSuggestedAction; caseRef: PartnerCase; subjectLabelHe: string | null }
export type LiveProposalList = { status: "OK"; items: LiveProposal[] } | { status: "READ_FAILED"; detail: string };

/**
 * Every Suggested Action derivable right now (any status), across all live Cases that have Owner Context.
 * ONE full Owner Context read, grouped by Case. Read-only (F.1I surface).
 */
export async function listLiveProposals(opts: { state?: PartnerCompanyState } = {}): Promise<LiveProposalList> {
  let live: LiveCases;
  try { live = await buildLiveCases(opts.state); } catch (e) { return { status: "READ_FAILED", detail: `live Partner state unreadable: ${(e as Error).message}` }; }
  const h = await listOwnerContexts();
  if (h.status !== "OK" && h.status !== "NO_CONTEXT") return { status: "READ_FAILED", detail: h.status === "READ_FAILED" ? h.error.message : `owner context unreadable (${h.status})` };
  const all = h.status === "OK" ? h.contexts : [];
  const items: LiveProposal[] = [];
  for (const c of live.cases) {
    const ctx = all.filter((x) => x.caseId === c.id);
    if (!ctx.length) continue;
    const label = c.subjectType === "project" ? live.labels.get(c.subjectId) ?? null : null;
    for (const action of deriveFor(c, ctx, live.labels)) items.push({ action, caseRef: c, subjectLabelHe: label });
  }
  return { status: "OK", items };
}

export const livePartnerView: ActionLiveView = {
  async findAction(actionId: string): Promise<LiveActionLookup> {
    const subjectId = actionId.split(":")[1] ?? "";
    let live: LiveCases;
    try { live = await buildLiveCases(); } catch (e) { return { status: "READ_FAILED", detail: `live Partner state unreadable: ${(e as Error).message}` }; }
    for (const c of live.cases.filter((x) => x.subjectId === subjectId)) {
      const ctx = await caseContexts(c.id);
      if (!ctx.ok) return { status: "READ_FAILED", detail: ctx.detail };
      const action = deriveFor(c, ctx.contexts, live.labels).find((a) => a.id === actionId);
      if (action) return { status: "FOUND", action, caseRef: c };
    }
    return { status: "NOT_DERIVABLE" };
  },

  async loadCaseView(caseId: string): Promise<LiveCaseView> {
    let live: LiveCases;
    try { live = await buildLiveCases(); } catch (e) { return { status: "READ_FAILED", detail: `live Partner state unreadable: ${(e as Error).message}` }; }
    const ctx = await caseContexts(caseId);
    if (!ctx.ok) return { status: "READ_FAILED", detail: ctx.detail };
    const caseRef = live.cases.find((c) => c.id === caseId) ?? null;
    return { status: "OK", caseRef, contexts: ctx.contexts, derived: caseRef ? deriveFor(caseRef, ctx.contexts, live.labels) : [] };
  },
};
