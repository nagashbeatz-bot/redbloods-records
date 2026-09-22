/**
 * Redbloods Partner — Case Engine (Phase E.1). Project deadline detector.
 *
 * `open` (lib/coo's own set) already excludes completed/cancelled projects —
 * §22's "not reliably completed/cancelled" is satisfied structurally by
 * using this array, not re-checked here. Hidden projects are outside
 * Partner's scope entirely (is_hidden=false only) — no conclusion is ever
 * drawn about them (§22).
 */
import type { PartnerCompanyState } from "../../eyes/types";
import type { PartnerCase } from "../types";

export function detectProjectDeadlineCases(state: PartnerCompanyState, todayYmd: string): PartnerCase[] {
  const domain = state.domains.projects;
  if (domain.status !== "AVAILABLE" || !domain.data) return [];

  const out: PartnerCase[] = [];
  for (const p of domain.data.open) {
    const deadlineYmd = p.deadline.ymd;
    if (!deadlineYmd) continue;
    if (deadlineYmd >= todayYmd) continue;
    const daysLate = p.deadline.daysTo !== null ? -p.deadline.daysTo : null;

    out.push({
      id: `project_deadline_passed:${p.id}`,
      caseType: "PROJECT_DEADLINE_PASSED",
      subjectType: "project",
      subjectId: p.id,
      classification: "RISK",
      status: "OPEN",
      createdFrom: "STATE",
      facts: [
        { domain: "projects", entityId: p.id, field: "deadline", value: deadlineYmd, label: "deadline" },
        { domain: "projects", entityId: p.id, field: "status", value: p.status, label: "status" },
      ],
      derivedFacts: daysLate !== null ? [{ id: "days_late", label: "ימים באיחור", value: daysLate, basis: `${todayYmd} − ${deadlineYmd}` }] : [],
      hypotheses: [],
      ownerRulesApplied: [],
      workingPrinciplesApplied: [],
      unknowns: [],
      dataQuality: { notes: ["Projects scope excludes hidden projects (is_hidden=false only) — no conclusion drawn about hidden ones."] },
      interventionStyle: "GENTLE",
      summaryHe: `הדדליין של הפרויקט עבר${daysLate !== null ? ` ב-${daysLate} ימים` : ""}.`,
      changeContext: null,
    });
  }
  return out;
}
