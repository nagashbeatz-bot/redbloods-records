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
import { CASE_SCHEMA_VERSION } from "../types";

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
      schemaVersion: CASE_SCHEMA_VERSION,
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
      schemaVersion: CASE_SCHEMA_VERSION,
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

  // ── PROPOSAL_STATUS_CHANGED / PROPOSAL_CLOSED_WON (Phase E.2) ──
  // "נסגר" definitely means a won/converted deal — the ONLY code path that ever
  // sets it is app/api/proposals/[id]/convert/route.ts, which creates a real
  // project and stamps linked_project_id in the SAME write (audited, not
  // guessed). Every other status transition stays the pure, no-inference
  // PROPOSAL_STATUS_CHANGED Case (§25) — one Case per change, never both.
  const proposalsById = new Map((state.domains.proposalsFull.data?.items ?? []).map((p) => [p.id, p]));
  for (const c of changes) {
    if (c.domain !== "proposals" || c.field !== "status") continue;
    if (c.after === "נסגר") {
      const proposal = proposalsById.get(c.entityId);
      out.push({
        id: `proposal_closed_won:${c.entityId}`,
        caseType: "PROPOSAL_CLOSED_WON",
        subjectType: "proposal",
        subjectId: c.entityId,
        classification: "OPPORTUNITY",
        status: "OPEN",
        createdFrom: "CHANGE",
        schemaVersion: CASE_SCHEMA_VERSION,
        facts: [
          { domain: "proposals", entityId: c.entityId, field: "status", value: "נסגר", label: "status" },
          ...(proposal?.linkedProjectId ? [{ domain: "proposals", entityId: c.entityId, field: "linkedProjectId", value: proposal.linkedProjectId, label: "linkedProjectId" }] : []),
        ],
        derivedFacts: [],
        hypotheses: [],
        ownerRulesApplied: [],
        workingPrinciplesApplied: [],
        unknowns: proposal?.linkedProjectId ? [] : ["ההצעה סומנה 'נסגר' ללא linked_project_id רשום — ייתכן שסומן ידנית ולא דרך זרימת ההמרה הסטנדרטית."],
        dataQuality: { notes: ["'נסגר' מאומת כ-won/converted רק דרך app/api/proposals/[id]/convert/route.ts — נתיב הקוד היחיד שכותב סטטוס זה."] },
        interventionStyle: "GENTLE",
        summaryHe: "הצעת מחיר נסגרה בהצלחה.",
        changeContext,
      });
      continue;
    }
    out.push({
      id: `proposal_status_changed:${c.entityId}`,
      caseType: "PROPOSAL_STATUS_CHANGED",
      subjectType: "proposal",
      subjectId: c.entityId,
      classification: "INFORMATION",
      status: "OPEN",
      createdFrom: "CHANGE",
      schemaVersion: CASE_SCHEMA_VERSION,
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
  // Phase E.2: direction (earlier/later) is objective string-date comparison,
  // never framed as risk from a delay alone (Owner instruction §11). Owner
  // Rule PROTECT_LABEL_RELEASES is attached only when the release's own
  // labelArtistId is ID-confirmed (project_release_details.label_artist_id) —
  // releasesFull carries rows for every project with a release stage, not
  // only label ones, so an unconditional attach would have been a false
  // attribution (Owner instruction §12, audited and fixed here).
  const releasesById = new Map((state.domains.releasesFull.data?.items ?? []).map((r) => [r.projectId, r]));
  for (const c of changes) {
    if (c.domain !== "releases" || c.field !== "targetYmd") continue;
    const before = typeof c.before === "string" ? c.before : null;
    const after = typeof c.after === "string" ? c.after : null;
    const direction = before && after ? (after > before ? "MOVED_LATER" : after < before ? "MOVED_EARLIER" : "UNCHANGED") : "UNKNOWN";
    const release = releasesById.get(c.entityId);
    const labelConfirmed = !!release?.labelArtistId;
    out.push({
      id: `release_target_date_changed:${c.entityId}`,
      caseType: "RELEASE_TARGET_DATE_CHANGED",
      subjectType: "release",
      subjectId: c.entityId,
      classification: "INFORMATION",
      status: "OPEN",
      createdFrom: "CHANGE",
      schemaVersion: CASE_SCHEMA_VERSION,
      facts: [
        { domain: "releases", entityId: c.entityId, field: "targetYmd", value: c.after, label: "release_target_date" },
        ...(release?.labelArtistId ? [{ domain: "releases", entityId: c.entityId, field: "labelArtistId", value: release.labelArtistId, label: "labelArtistId" }] : []),
      ],
      derivedFacts: [{ id: "direction", label: "כיוון השינוי", value: direction, basis: before && after ? `before=${before} vs after=${after}` : "תאריך before/after לא זמין כמחרוזת" }],
      hypotheses: [],
      ownerRulesApplied: labelConfirmed ? ["PROTECT_LABEL_RELEASES"] : [],
      workingPrinciplesApplied: [],
      unknowns: labelConfirmed ? [] : ["labelArtistId אינו מאומת עבור release זה — ייתכן שאינו ריליס לייבל."],
      dataQuality: { notes: [] },
      interventionStyle: "GENTLE",
      summaryHe: "תאריך היעד לריליס השתנה.",
      changeContext,
    });
  }

  return out;
}
