/**
 * Redbloods Partner — Case Engine (Phase E.1). Victor detectors.
 *
 * Both detectors read ONLY state.domains.victor.data.active — the SAME
 * CURRENT_SUBSET (active-status only) Partner Eyes already exposes. A work
 * that completed or was cancelled is not in this array at all, so neither
 * detector can ever fire on it (§15: "entity is still relevant/current").
 * Data quality gate (§33-34): if the domain itself failed to read, produce
 * no Cases at all — never guess from missing data.
 */
import { diffDays, parseYmd } from "../../../coo/dates";
import type { PartnerCompanyState } from "../../eyes/types";
import type { PartnerCase } from "../types";

export function detectVictorInternalDeadlineCases(state: PartnerCompanyState, todayYmd: string): PartnerCase[] {
  const domain = state.domains.victor;
  if (domain.status !== "AVAILABLE" || !domain.data) return [];

  const out: PartnerCase[] = [];
  for (const w of domain.data.active) {
    const deadlineYmd = parseYmd(w.internalDeadline);
    if (!deadlineYmd) continue;
    if (deadlineYmd >= todayYmd) continue; // future or today — not yet passed
    const daysLate = diffDays(deadlineYmd, todayYmd);

    // Phase E.2 context (§14): objective delivery-vs-deadline combination, no
    // blame wording. "unknown" when there is no recorded upload at all — never
    // guessed as "not delivered" (could have been handled outside Redbloods).
    const uploadYmds = w.uploads.map((u) => parseYmd(u)).filter((y): y is string => y !== null);
    const deliveryAfterDeadline: boolean | "unknown" =
      uploadYmds.length === 0 ? "unknown" : uploadYmds.some((y) => y > deadlineYmd);

    out.push({
      id: `missed_internal_deadline:${w.id}`,
      caseType: "MISSED_INTERNAL_DEADLINE",
      subjectType: "victorWork",
      subjectId: w.id,
      classification: "RISK",
      status: "OPEN",
      createdFrom: "STATE",
      facts: [
        { domain: "victor", entityId: w.id, field: "internalDeadline", value: deadlineYmd, label: "internalDeadline" },
        { domain: "victor", entityId: w.id, field: "workState", value: w.workState, label: "workState" },
        { domain: "victor", entityId: w.id, field: "projectId", value: w.projectId, label: "projectId" },
      ],
      derivedFacts: [
        { id: "days_late", label: "ימים באיחור", value: daysLate, basis: `${todayYmd} − ${deadlineYmd}` },
        { id: "delivery_after_deadline", label: "האם קיימת עדות למסירה אחרי הדדליין", value: deliveryAfterDeadline, basis: uploadYmds.length === 0 ? "אין uploads רשומים כלל" : `uploads: ${uploadYmds.join(", ")}` },
      ],
      hypotheses: [],
      ownerRulesApplied: ["INTERNAL_DEADLINES_MATTER"],
      workingPrinciplesApplied: [],
      unknowns: [],
      dataQuality: { notes: ["Victor per-row detail is CURRENT_SUBSET (active-status only) — see the Change Readiness Matrix. This is never presented as full history."] },
      interventionStyle: "GENTLE",
      // Wording is engine-level and deliberately narrow (§15): a passed deadline is the ONLY claim.
      // Never "Victor failed to deliver" — that would need delivery evidence this detector doesn't check.
      summaryHe: `דדליין פנימי עבר ב-${daysLate} ימים.`,
      changeContext: null,
    });
  }
  return out;
}

export function detectVictorUnfollowedDeliveryCases(state: PartnerCompanyState): PartnerCase[] {
  const domain = state.domains.victor;
  if (domain.status !== "AVAILABLE" || !domain.data) return [];

  const out: PartnerCase[] = [];
  for (const w of domain.data.active) {
    // Hardening-1 evidence, reused verbatim (never reimplemented): ball.holder === "owner" means
    // the latest RECORDED action is Victor's upload, with no later recorded owner notes.
    if (w.ball.holder !== "owner" || !w.lastUploadAt) continue;

    out.push({
      id: `victor_delivery_no_followup:${w.id}`,
      caseType: "DELIVERY_WITHOUT_RECORDED_FOLLOWUP",
      subjectType: "victorWork",
      subjectId: w.id,
      classification: "ATTENTION",
      status: "OPEN",
      createdFrom: "STATE",
      facts: [
        { domain: "victor", entityId: w.id, field: "lastUploadAt", value: w.lastUploadAt, label: "lastUploadAt" },
        { domain: "victor", entityId: w.id, field: "ball.code", value: w.ball.code, label: "ball.code" },
        { domain: "victor", entityId: w.id, field: "projectId", value: w.projectId, label: "projectId" },
      ],
      // Phase E.2 context (§15) — calibration context, never age-based severity.
      derivedFacts: [
        { id: "days_since_delivery", label: "ימים מאז המסירה", value: w.waitingOwnerDays, basis: "today − lastUploadAt (Israel calendar days)" },
        { id: "has_any_historical_review", label: "האם היה אי-פעם review מתועד", value: w.reviewEvents.length > 0, basis: `reviewEvents.length = ${w.reviewEvents.length}` },
        { id: "project_linked", label: "מקושר לפרויקט", value: w.projectId !== null, basis: "projectId" },
      ],
      hypotheses: [
        { id: "may_be_pending_review", statement: "ייתכן שהמסירה עדיין ממתינה לבדיקת הבעלים.", evidenceIds: [] },
      ],
      ownerRulesApplied: [],
      workingPrinciplesApplied: [],
      unknowns: ["האם הבעלים כבר בדק את המסירה מחוץ למערכת — לא ידוע."],
      dataQuality: { notes: ["ball.holder הוא 'latest recorded action' בלבד — לא הוכחה שהבעלים חוסם. ראה lib/coo/victor-ball.ts."] },
      interventionStyle: "GENTLE",
      // Never "Owner is blocking" / "Owner must review" (§16) — only the recorded fact.
      summaryHe: "נרשמה מסירה מ-Victor ללא follow-up מתועד אחריה.",
      changeContext: null,
    });
  }
  return out;
}
