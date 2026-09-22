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
 * This is deliberately NOT r.balance. r.balance is
 * lib/payment-status.ts:collectibleBalance = agreedPrice − received −
 * cancelled — an app-wide "how much is still collectible" figure (it nets
 * out cancelled because a cancelled charge no longer needs collecting). That
 * is a different business question from "is this project fully paid", and
 * conflating them produced a real false positive in production: a project
 * with agreedPrice === received (fully paid) but a cancelled transaction
 * still showed PROJECT_OVERPAYMENT because balance went negative. `balance`
 * is kept below as a clearly-labelled legacy/traceability fact only — it is
 * never the input to this detector's classification. Do NOT "fix" this by
 * changing collectibleBalance itself — it is correct for its own callers
 * (ProjectDrawer, Finance, Dashboard, Insights, etc.); this detector simply
 * needs a different formula.
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
