/**
 * Redbloods Partner — Case Engine (Phase E.1). Finance detectors.
 *
 * Uses ONLY lib/coo's own already-derived receivables figures (agreedPrice,
 * received, cancelled, balance) — never recomputes finance semantics from
 * transactions. Received statuses (שולם/התקבל) vs not-received (צפוי/לא
 * שולם/בוטל) and the "missing price ≠ 0" rule are entirely lib/coo's, reused
 * verbatim via receivables.rows.
 *
 * CANONICAL DECISION RULE (Owner finance rule, Phase E.1 hardening):
 * outstanding/overpayment is decided from agreedPrice vs received ONLY —
 *   agreedPrice − received > 0  → PROJECT_PAYMENT_OUTSTANDING
 *   agreedPrice − received < 0  → PROJECT_OVERPAYMENT
 *   agreedPrice − received == 0 → fully paid, no Case
 * `cancelled` (בוטל) is NEVER money received and must NEVER move a project
 * across these three outcomes.
 *
 * This detector deliberately never reads r.balance — it computes outstanding/
 * overpayment itself from r.agreedPrice/r.received. At the time this was
 * written, r.balance (lib/coo/facts.ts) was built from the app-wide
 * `collectibleBalance` helper, which subtracted cancelled income and produced
 * a real production false positive here (agreedPrice === received but a
 * cancelled transaction still showed PROJECT_OVERPAYMENT).
 *
 * Finance Semantics Unification (2026-09-22, follow-up Owner decision):
 * `collectibleBalance` was removed app-wide and split into two explicit
 * concepts in lib/payment-status.ts — actual payment position (agreedPrice
 * vs paidIncome only) and a separate, narrower "collection intent" concept
 * used only where a surface's own purpose calls for it. r.balance now uses
 * the actual-payment-position formula too, so it is no longer distinct from
 * this detector's own `outstanding`/`overpayment` — the `balance_legacy` fact
 * below is kept only for continuity/traceability, not because it still
 * differs.
 */
import type { PartnerCompanyState } from "../../eyes/types";
import type { PartnerCase } from "../types";

export function detectProjectFinanceCases(state: PartnerCompanyState): PartnerCase[] {
  const out: PartnerCase[] = [];

  const receivables = state.domains.receivables;
  if (receivables.status === "AVAILABLE" && receivables.data) {
    for (const r of receivables.data.rows) {
      // Canonical Owner rule: agreedPrice vs received ONLY. `cancelled` never
      // participates in this comparison — see module doc.
      const outstanding = r.agreedPrice - r.received;
      const legacyBalanceFact = { domain: "receivables", entityId: r.projectId, field: "balance_legacy", value: r.balance, label: "balance (שדה legacy — כולל cancelled, למעקב בלבד, אינו קלט להחלטה)" };

      if (outstanding > 0) {
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
            { domain: "receivables", entityId: r.projectId, field: "received", value: r.received, label: "received (paidIncome — רק שולם/התקבל)" },
            { domain: "receivables", entityId: r.projectId, field: "cancelled", value: r.cancelled, label: "cancelled (בוטל — אינו כסף שהתקבל, אינו משפיע על היתרה)" },
            { domain: "receivables", entityId: r.projectId, field: "currency", value: r.currency, label: "currency" },
            legacyBalanceFact,
          ],
          derivedFacts: [{ id: "outstanding", label: "יתרה לתשלום", value: outstanding, basis: "agreedPrice − received (כלל Owner הקנוני — cancelled לא נכלל)" }],
          hypotheses: [],
          ownerRulesApplied: [],
          workingPrinciplesApplied: [],
          unknowns: [],
          dataQuality: { notes: ["מבוסס על eyes:receivables — פרויקטים עם מחיר מוסכם, לא-exception בלבד."] },
          interventionStyle: "GENTLE",
          summaryHe: `יתרת תשלום פתוחה בפרויקט: ${r.currency}${outstanding}.`,
          changeContext: null,
        });
      } else if (outstanding < 0) {
        const overpayment = -outstanding;
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
            { domain: "receivables", entityId: r.projectId, field: "received", value: r.received, label: "received (paidIncome — רק שולם/התקבל)" },
            { domain: "receivables", entityId: r.projectId, field: "cancelled", value: r.cancelled, label: "cancelled (בוטל — אינו כסף שהתקבל, אינו משפיע על היתרה)" },
            legacyBalanceFact,
          ],
          derivedFacts: [{ id: "overpayment", label: "תשלום עודף", value: overpayment, basis: "received − agreedPrice (כלל Owner הקנוני — cancelled לא נכלל)" }],
          hypotheses: [],
          ownerRulesApplied: [],
          workingPrinciplesApplied: [],
          unknowns: [],
          dataQuality: { notes: [] },
          interventionStyle: "GENTLE",
          summaryHe: "התקבל תשלום גבוה מהמוסכם בפרויקט.",
          changeContext: null,
        });
      }
      // outstanding === 0: fully paid (agreedPrice === received) — no Case, regardless of cancelled.
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
