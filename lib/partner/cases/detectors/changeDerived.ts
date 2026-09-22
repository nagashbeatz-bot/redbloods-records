/**
 * Redbloods Partner — Case Engine (Phase E.1). CHANGE-derived detectors.
 *
 * Takes an ALREADY-COMPUTED PartnerChange[] (from the latest Change
 * Awareness run) — never loads a baseline, never calls
 * comparePartnerChangeSnapshots itself (Owner instruction §38). These Cases
 * exist only "for the current Change Awareness batch" (§56) — they are not
 * persisted and will not recur unless the same underlying change happens
 * again in a future comparison.
 */
import type { PartnerChange } from "../../changes/types";
import type { PartnerCompanyState } from "../../eyes/types";
import type { PartnerCase } from "../types";

const CONFIRMED_SHOW_STATUSES = new Set(["אושרה", "בוצע"]);

export function detectChangeDerivedCases(
  state: PartnerCompanyState,
  changes: PartnerChange[],
  changeContext: { previousCapturedAt: string | null; currentCapturedAt: string } | null,
): PartnerCase[] {
  const out: PartnerCase[] = [];

  // ── MONEY_RECEIVED — reuses the DERIVED receivedSemantic change D.1 already computes ──
  for (const c of changes) {
    if (c.domain !== "transactions" || c.field !== "receivedSemantic" || c.after !== "RECEIVED") continue;
    out.push({
      id: `money_received:${c.entityId}`,
      caseType: "MONEY_RECEIVED",
      subjectType: "transaction",
      subjectId: c.entityId,
      classification: "OPPORTUNITY",
      status: "OPEN",
      createdFrom: "CHANGE",
      facts: [{ domain: "transactions", entityId: c.entityId, field: "receivedSemantic", value: "RECEIVED", label: "receivedSemantic" }],
      derivedFacts: [],
      hypotheses: [],
      ownerRulesApplied: [],
      workingPrinciplesApplied: [],
      unknowns: [],
      dataQuality: { notes: [] },
      interventionStyle: "GENTLE",
      summaryHe: "התקבל תשלום חדש בפרויקט.",
      changeContext,
    });
  }

  // ── NEW_SHOW_RECORDED — a new show row appeared. Classification depends only on its
  // CURRENTLY STORED status (a real field), never on the mere fact of appearing (§24, §27:
  // "does not overstate" — a lead-stage show is NOT reported as "booked"). ──
  const showsById = new Map((state.domains.shows.data?.items ?? []).map((s) => [s.id, s]));
  for (const c of changes) {
    if (c.domain !== "shows" || c.kind !== "ENTITY_APPEARED") continue;
    const show = showsById.get(c.entityId);
    const confirmed = !!show && CONFIRMED_SHOW_STATUSES.has(show.status);
    out.push({
      id: `new_show_recorded:${c.entityId}`,
      caseType: "NEW_SHOW_RECORDED",
      subjectType: "show",
      subjectId: c.entityId,
      classification: confirmed ? "OPPORTUNITY" : "INFORMATION",
      status: "OPEN",
      createdFrom: "CHANGE",
      facts: show ? [{ domain: "shows", entityId: c.entityId, field: "status", value: show.status, label: "status" }] : [],
      derivedFacts: [],
      hypotheses: [],
      ownerRulesApplied: [],
      workingPrinciplesApplied: [],
      unknowns: show ? [] : ["פרטי ההופעה לא זמינים כרגע — הסטטוס אינו ידוע."],
      dataQuality: { notes: [] },
      interventionStyle: "GENTLE",
      summaryHe: "נרשמה הופעה חדשה.",
      changeContext,
    });
  }

  // ── PROPOSAL_STATUS_CHANGED — pure fact, no won/lost inference (§25) ──
  for (const c of changes) {
    if (c.domain !== "proposals" || c.field !== "status") continue;
    out.push({
      id: `proposal_status_changed:${c.entityId}`,
      caseType: "PROPOSAL_STATUS_CHANGED",
      subjectType: "proposal",
      subjectId: c.entityId,
      classification: "INFORMATION",
      status: "OPEN",
      createdFrom: "CHANGE",
      facts: [{ domain: "proposals", entityId: c.entityId, field: "status", value: c.after, label: "status" }],
      derivedFacts: [],
      hypotheses: [],
      ownerRulesApplied: [],
      workingPrinciplesApplied: [],
      unknowns: [],
      dataQuality: { notes: [] },
      interventionStyle: "GENTLE",
      summaryHe: `סטטוס הצעת מחיר השתנה מ-${String(c.before)} ל-${String(c.after)}.`,
      changeContext,
    });
  }

  // ── RELEASE_TARGET_DATE_CHANGED — informational only, never re-derives risk here (§20) ──
  for (const c of changes) {
    if (c.domain !== "releases" || c.field !== "targetYmd") continue;
    out.push({
      id: `release_target_date_changed:${c.entityId}`,
      caseType: "RELEASE_TARGET_DATE_CHANGED",
      subjectType: "release",
      subjectId: c.entityId,
      classification: "INFORMATION",
      status: "OPEN",
      createdFrom: "CHANGE",
      facts: [{ domain: "releases", entityId: c.entityId, field: "targetYmd", value: c.after, label: "release_target_date" }],
      derivedFacts: [],
      hypotheses: [],
      ownerRulesApplied: ["PROTECT_LABEL_RELEASES"],
      workingPrinciplesApplied: [],
      unknowns: [],
      dataQuality: { notes: [] },
      interventionStyle: "GENTLE",
      summaryHe: "תאריך היעד לריליס השתנה.",
      changeContext,
    });
  }

  return out;
}
