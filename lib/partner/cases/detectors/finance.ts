/**
 * Redbloods Partner — Case Engine (Phase E.1). Finance detectors.
 *
 * Uses ONLY lib/coo's own already-derived receivables figures (agreedPrice,
 * received, cancelled, balance) — never recomputes finance semantics.
 * Received statuses (שולם/התקבל) vs not-received (צפוי/לא שולם/בוטל) and the
 * "missing price ≠ 0" rule are entirely lib/coo's, reused verbatim via
 * receivables.rows. balance = agreedPrice − received − cancelled
 * (lib/payment-status.ts:collectibleBalance, the same formula every other
 * caller in this codebase uses) — `cancelled` is included in every Case's
 * facts precisely because it can make `balance` diverge from a naive
 * agreedPrice−received subtraction (found during the Phase E.1 false-positive
 * review: a Case exposing only agreedPrice/received left a project reading
 * "agreedPrice equals received" while balance still showed an overpayment,
 * with no evidence explaining why — cancelled income is that explanation).
 */
import type { PartnerCompanyState } from "../../eyes/types";
import type { PartnerCase } from "../types";

export function detectProjectFinanceCases(state: PartnerCompanyState): PartnerCase[] {
  const out: PartnerCase[] = [];

  const receivables = state.domains.receivables;
  if (receivables.status === "AVAILABLE" && receivables.data) {
    for (const r of receivables.data.rows) {
      if (r.balance > 0) {
        out.push({
          id: `project_payment_outstanding:${r.projectId}`,
          caseType: "PROJECT_PAYMENT_OUTSTANDING",
          subjectType: "project",
          subjectId: r.projectId,
          classification: "ATTENTION",
          status: "OPEN",
          createdFrom: "STATE",
          facts: [
            { domain: "receivables", entityId: r.projectId, field: "agreedPrice", value: r.agreedPrice, label: "agreedPrice" },
            { domain: "receivables", entityId: r.projectId, field: "received", value: r.received, label: "received" },
            { domain: "receivables", entityId: r.projectId, field: "cancelled", value: r.cancelled, label: "cancelled" },
            { domain: "receivables", entityId: r.projectId, field: "currency", value: r.currency, label: "currency" },
          ],
          derivedFacts: [{ id: "balance", label: "יתרה", value: r.balance, basis: "agreedPrice − received − cancelled (לפי lib/payment-status.ts:collectibleBalance)" }],
          hypotheses: [],
          ownerRulesApplied: [],
          workingPrinciplesApplied: [],
          unknowns: [],
          dataQuality: { notes: ["מבוסס על eyes:receivables — פרויקטים עם מחיר מוסכם, לא-exception בלבד."] },
          interventionStyle: "GENTLE",
          summaryHe: `יתרת תשלום פתוחה בפרויקט: ${r.currency}${r.balance}.`,
          changeContext: null,
        });
      } else if (r.balance < 0) {
        out.push({
          id: `project_overpayment:${r.projectId}`,
          caseType: "PROJECT_OVERPAYMENT",
          subjectType: "project",
          subjectId: r.projectId,
          classification: "INFORMATION",
          status: "OPEN",
          createdFrom: "STATE",
          facts: [
            { domain: "receivables", entityId: r.projectId, field: "agreedPrice", value: r.agreedPrice, label: "agreedPrice" },
            { domain: "receivables", entityId: r.projectId, field: "received", value: r.received, label: "received" },
            { domain: "receivables", entityId: r.projectId, field: "cancelled", value: r.cancelled, label: "cancelled" },
          ],
          derivedFacts: [{ id: "balance", label: "יתרה (שלילית)", value: r.balance, basis: "agreedPrice − received − cancelled (לפי lib/payment-status.ts:collectibleBalance)" }],
          hypotheses: [],
          ownerRulesApplied: [],
          workingPrinciplesApplied: [],
          unknowns: [],
          dataQuality: { notes: [] },
          interventionStyle: "GENTLE",
          summaryHe: "התקבל תשלום גבוה מהמוסכם בפרויקט (יתרה שלילית).",
          changeContext: null,
        });
      }
      // balance === 0: fully paid — no Case.
    }
  }

  // Missing finance config — only for currently OPEN (active) projects; a completed/cancelled
  // project genuinely not needing a price is not a gap. hasFinanceSetting is a stored FACT
  // (lib/coo/facts.ts) — never re-derived here.
  const projects = state.domains.projects;
  if (projects.status === "AVAILABLE" && projects.data) {
    for (const p of projects.data.open) {
      if (p.hasFinanceSetting) continue;
      out.push({
        id: `finance_configuration_missing:${p.id}`,
        caseType: "FINANCE_CONFIGURATION_MISSING",
        subjectType: "project",
        subjectId: p.id,
        classification: "INFORMATION",
        status: "NEEDS_CONTEXT",
        createdFrom: "STATE",
        facts: [{ domain: "projects", entityId: p.id, field: "hasFinanceSetting", value: false, label: "hasFinanceSetting" }],
        derivedFacts: [],
        hypotheses: [],
        ownerRulesApplied: [],
        workingPrinciplesApplied: [],
        unknowns: ["האם למחיר הפרויקט יש סיבה מכוונת להישאר לא מוגדר — לא ידוע."],
        dataQuality: { notes: [] },
        interventionStyle: "GENTLE",
        summaryHe: "לא הוגדרה הגדרת תמחור (finance setting) לפרויקט פעיל.",
        changeContext: null,
      });
    }
  }

  return out;
}
