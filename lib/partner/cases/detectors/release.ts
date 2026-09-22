/**
 * Redbloods Partner — Case Engine (Phase E.1, E.2 hardening). Release timing detector.
 *
 * Deliberately conservative (§20-21): the ONLY signal used is an objective,
 * already-passed target date. No invented "at risk within N days" formula,
 * no arbitrary 7/14-day threshold — those would be un-approved Owner Rules.
 *
 * Phase E.2: PROTECT_LABEL_RELEASES is attached only when r.labelArtistId is
 * ID-confirmed. releasesFull is full history over project_release_details —
 * it carries a row for every project that ever entered a release stage, not
 * only label-artist ones (audited: labelArtistId can be null), so attaching
 * the rule unconditionally would have been a false Owner Rule attribution.
 * The Case still fires either way — only the rule attribution changes.
 */
import { diffDays } from "../../../coo/dates";
import type { PartnerCompanyState } from "../../eyes/types";
import type { PartnerCase } from "../types";

export function detectReleaseTimingCases(state: PartnerCompanyState, todayYmd: string): PartnerCase[] {
  const domain = state.domains.releasesFull;
  if (domain.status !== "AVAILABLE" || !domain.data) return [];

  const out: PartnerCase[] = [];
  for (const r of domain.data.items) {
    if (!r.targetYmd) continue;
    if (r.targetYmd >= todayYmd) continue; // not passed yet
    if (r.stage === "יצא") continue; // already released — a passed target is moot, not a current concern
    const daysLate = diffDays(r.targetYmd, todayYmd);
    const labelConfirmed = !!r.labelArtistId;

    out.push({
      id: `release_target_date_passed:${r.projectId}`,
      caseType: "RELEASE_TARGET_DATE_PASSED",
      subjectType: "release",
      subjectId: r.projectId,
      classification: "RISK",
      status: "OPEN",
      createdFrom: "STATE",
      facts: [
        { domain: "releasesFull", entityId: r.projectId, field: "targetYmd", value: r.targetYmd, label: "release_target_date" },
        { domain: "releasesFull", entityId: r.projectId, field: "stage", value: r.stage, label: "release_stage" },
        ...(r.labelArtistId ? [{ domain: "releasesFull", entityId: r.projectId, field: "labelArtistId", value: r.labelArtistId, label: "labelArtistId" }] : []),
      ],
      derivedFacts: [{ id: "days_late", label: "ימים אחרי היעד", value: daysLate, basis: `${todayYmd} − ${r.targetYmd}` }],
      hypotheses: [],
      ownerRulesApplied: labelConfirmed ? ["PROTECT_LABEL_RELEASES"] : [],
      workingPrinciplesApplied: [],
      unknowns: labelConfirmed ? [] : ["labelArtistId אינו מאומת עבור release זה — ייתכן שאינו ריליס לייבל."],
      dataQuality: { notes: [] },
      interventionStyle: "GENTLE",
      // Never "release is at risk" from a threshold — only the objective, already-passed fact.
      summaryHe: `תאריך היעד לריליס עבר ב-${daysLate} ימים.`,
      changeContext: null,
    });
  }
  return out;
}
