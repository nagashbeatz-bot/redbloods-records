/**
 * Redbloods Partner — Case Engine (Phase E.2). Objective business-risk
 * detectors added across Proposals, Payment due dates, Shows, Tasks and
 * Steven — each backed by a reliable, ID-based field already exposed by
 * Partner Eyes, never a re-derived/guessed condition.
 *
 * E.2 principle (Owner instruction): more coverage, but only where evidence
 * is strong — no invented thresholds, no severity from age alone, no
 * inference beyond what the field itself proves.
 */
import { diffDays, parseYmd } from "../../../coo/dates";
import type { PartnerCompanyState } from "../../eyes/types";
import type { PartnerCase } from "../types";

const PROPOSAL_TERMINAL_STATUSES = new Set(["נסגר", "לא נסגר"]);

/**
 * PROPOSAL_FOLLOWUP_DUE — a proposal's own follow-up date has arrived or
 * passed while the proposal is still in a non-terminal status. Terminal set
 * ("נסגר"/"לא נסגר") is not guessed — it is the SAME set already used
 * production-wide (components/clients/ProposalsSection.tsx, InsightsPage.tsx,
 * lib/coo/facts.ts, lib/agent/rules.ts, lib/agent/context-builder.ts,
 * lib/mai/operational-rules.ts) for exactly this open/closed distinction.
 */
export function detectProposalFollowupCases(state: PartnerCompanyState, todayYmd: string): PartnerCase[] {
  const domain = state.domains.proposalsFull;
  if (domain.status !== "AVAILABLE" || !domain.data) return [];

  const out: PartnerCase[] = [];
  for (const p of domain.data.items) {
    if (PROPOSAL_TERMINAL_STATUSES.has(p.status)) continue;
    const followupYmd = parseYmd(p.followupYmd);
    if (!followupYmd) continue;
    if (followupYmd > todayYmd) continue; // future — not yet due
    const daysPast = diffDays(followupYmd, todayYmd);

    out.push({
      id: `proposal_followup_due:${p.id}`,
      caseType: "PROPOSAL_FOLLOWUP_DUE",
      subjectType: "proposal",
      subjectId: p.id,
      classification: "ATTENTION",
      status: "OPEN",
      createdFrom: "STATE",
      facts: [
        { domain: "proposalsFull", entityId: p.id, field: "status", value: p.status, label: "status" },
        { domain: "proposalsFull", entityId: p.id, field: "followupYmd", value: followupYmd, label: "followupYmd" },
      ],
      derivedFacts: [{ id: "days_past", label: "ימים מאז תאריך הפולואפ", value: daysPast, basis: `${todayYmd} − ${followupYmd}` }],
      hypotheses: [],
      ownerRulesApplied: [],
      workingPrinciplesApplied: [],
      unknowns: [],
      dataQuality: { notes: ["מבוסס על proposalsFull (כל ההיסטוריה, ללא סינון סטטוס) — terminal set זהה לזה שכבר בשימוש בקוד production."] },
      interventionStyle: "GENTLE",
      // Fact only — never "client is ignoring us" (Owner instruction §5).
      summaryHe: "תאריך הפולואפ להצעת המחיר הגיע/עבר.",
      changeContext: null,
    });
  }
  return out;
}

/**
 * PAYMENT_DUE_DATE_PASSED — distinct from PROJECT_PAYMENT_OUTSTANDING
 * (Owner instruction §7-8): that Case means "debt exists"; this one means
 * "a SPECIFIC scheduled collection date for that debt has passed". Requires
 * BOTH: a real actual-outstanding balance (r.balance > 0 — canonical,
 * post-Finance-Unification, never nets cancelled) AND an expected ("צפוי")
 * income transaction whose own date has passed (lib/coo's own
 * finance.expectedOverdue, reused verbatim — never re-derived here). Currency
 * must match the project's own priced currency (R5) — a dated-expected row in
 * a different currency proves nothing about this project's own debt.
 */
export function detectPaymentDueDateCases(state: PartnerCompanyState): PartnerCase[] {
  const financeDomain = state.domains.finance;
  const receivablesDomain = state.domains.receivables;
  if (financeDomain.status !== "AVAILABLE" || !financeDomain.data) return [];
  if (receivablesDomain.status !== "AVAILABLE" || !receivablesDomain.data) return [];

  const rowsByProject = new Map(receivablesDomain.data.rows.map((r) => [r.projectId, r]));
  // One Case per project — if several overdue expected rows exist, use the
  // single MOST overdue one as the representative fact (never double-counted).
  const mostOverdueByProject = new Map<string, (typeof financeDomain.data.expectedOverdue)[number]>();
  for (const e of financeDomain.data.expectedOverdue) {
    if (e.clip || !e.projectId) continue; // clip income never measured against agreedPrice
    const row = rowsByProject.get(e.projectId);
    if (!row || row.currency !== e.currency) continue; // R5 — currency must match the project's own price
    if (row.balance <= 0) continue; // no real actual outstanding (canonical, post-unification)
    const prev = mostOverdueByProject.get(e.projectId);
    if (!prev || e.daysOverdue > prev.daysOverdue) mostOverdueByProject.set(e.projectId, e);
  }

  const out: PartnerCase[] = [];
  for (const [projectId, e] of mostOverdueByProject) {
    const row = rowsByProject.get(projectId)!;
    out.push({
      id: `payment_due_date_passed:${projectId}`,
      caseType: "PAYMENT_DUE_DATE_PASSED",
      subjectType: "project",
      subjectId: projectId,
      classification: "RISK",
      status: "OPEN",
      createdFrom: "STATE",
      facts: [
        { domain: "finance", entityId: e.txId, field: "dateYmd", value: e.dateYmd, label: "expectedIncome.dateYmd" },
        { domain: "finance", entityId: e.txId, field: "amount", value: e.amount, label: "expectedIncome.amount" },
        { domain: "finance", entityId: e.txId, field: "currency", value: e.currency, label: "currency" },
        { domain: "receivables", entityId: projectId, field: "agreedPrice", value: row.agreedPrice, label: "agreedPrice" },
        { domain: "receivables", entityId: projectId, field: "received", value: row.received, label: "received" },
      ],
      derivedFacts: [
        { id: "days_overdue", label: "ימים מאז תאריך התשלום הצפוי", value: e.daysOverdue, basis: `today − expectedIncome.dateYmd (${e.dateYmd})` },
        { id: "actual_outstanding", label: "יתרה בפועל", value: row.balance, basis: "agreedPrice − received (כלל קנוני)" },
      ],
      hypotheses: [],
      ownerRulesApplied: [],
      workingPrinciplesApplied: [],
      unknowns: [],
      dataQuality: { notes: ["מבוסס על lib/coo:finance.expectedOverdue (תנועת הכנסה 'צפוי' עם תאריך שעבר), לא נגזר כאן מחדש."] },
      interventionStyle: "GENTLE",
      summaryHe: `תאריך תשלום צפוי עבר ב-${e.daysOverdue} ימים, והיתרה בפועל עדיין פתוחה.`,
      changeContext: null,
    });
  }
  return out;
}

/**
 * SHOW_CLIENT_PAYMENT_OUTSTANDING — the show has objectively already happened
 * ("בוצע") and the CLIENT's own payment_status is not "שולם" (received) and
 * not "בוטל" (cancelled). Never touches dj_fee/artist_fee/payout fields —
 * those are not exposed to Partner (audited: ShowSummary carries only the
 * client-facing price/paymentStatus; DJ/artist payout Cases are deferred,
 * see the E.2 report).
 */
export function detectShowClientPaymentCases(state: PartnerCompanyState): PartnerCase[] {
  const domain = state.domains.shows;
  if (domain.status !== "AVAILABLE" || !domain.data) return [];

  const out: PartnerCase[] = [];
  for (const s of domain.data.items) {
    if (s.status !== "בוצע") continue; // objectively already happened — not "confirmed", not "upcoming"
    if (s.paymentStatus === "שולם" || s.paymentStatus === "בוטל") continue;
    if (!(s.price > 0)) continue; // no known amount — nothing objective to claim

    out.push({
      id: `show_client_payment_outstanding:${s.id}`,
      caseType: "SHOW_CLIENT_PAYMENT_OUTSTANDING",
      subjectType: "show",
      subjectId: s.id,
      classification: "ATTENTION",
      status: "OPEN",
      createdFrom: "STATE",
      facts: [
        { domain: "shows", entityId: s.id, field: "status", value: s.status, label: "status" },
        { domain: "shows", entityId: s.id, field: "paymentStatus", value: s.paymentStatus, label: "paymentStatus" },
        { domain: "shows", entityId: s.id, field: "price", value: s.price, label: "price (client-owed)" },
      ],
      derivedFacts: [],
      hypotheses: [],
      ownerRulesApplied: [],
      workingPrinciplesApplied: [],
      unknowns: ["מצב תשלום ל-DJ/אמן (payout) אינו נבדק כאן — שדות אלה אינם חשופים ל-Partner."],
      dataQuality: { notes: ["paymentStatus הוא תשלום הלקוח בלבד (show_price) — לא payout ל-DJ/אמן."] },
      interventionStyle: "GENTLE",
      summaryHe: "ההופעה בוצעה ותשלום הלקוח עדיין לא נרשם כהתקבל.",
      changeContext: null,
    });
  }
  return out;
}

/**
 * TASK_DUE_DATE_PASSED — an open task's own due_date has passed. Skips tasks
 * auto-created from a Victor internal deadline (`derivedFrom !== null`) —
 * that is the SAME underlying business fact MISSED_INTERNAL_DEADLINE already
 * reports; creating a second Case here would duplicate human meaning (Owner
 * instruction §18). Uses state.domains.tasks (open-only, current TaskFact —
 * NOT tasksFull) precisely because it is the one domain that still carries
 * `derivedFrom` and `daysOverdue`.
 */
export function detectTaskDueDateCases(state: PartnerCompanyState): PartnerCase[] {
  const domain = state.domains.tasks;
  if (domain.status !== "AVAILABLE" || !domain.data) return [];

  const out: PartnerCase[] = [];
  for (const t of domain.data.items) {
    if (t.derivedFrom !== null) continue; // auto-generated from a canonical source Case — never duplicated
    if (t.daysOverdue === null || t.daysOverdue <= 0) continue;

    out.push({
      id: `task_due_date_passed:${t.id}`,
      caseType: "TASK_DUE_DATE_PASSED",
      subjectType: "task",
      subjectId: t.id,
      classification: "RISK",
      status: "OPEN",
      createdFrom: "STATE",
      facts: [
        { domain: "tasks", entityId: t.id, field: "dueYmd", value: t.dueYmd, label: "dueYmd" },
        { domain: "tasks", entityId: t.id, field: "relatedType", value: t.relatedType, label: "relatedType" },
        { domain: "tasks", entityId: t.id, field: "projectId", value: t.projectId, label: "projectId" },
      ],
      derivedFacts: [{ id: "days_overdue", label: "ימים באיחור", value: t.daysOverdue, basis: "today − dueYmd" }],
      hypotheses: [],
      ownerRulesApplied: [],
      workingPrinciplesApplied: [],
      unknowns: [],
      dataQuality: { notes: ["משימות שנוצרו אוטומטית מדדליין פנימי של Victor מסוננות החוצה — אותה עובדה עסקית כבר מדווחת ב-MISSED_INTERNAL_DEADLINE."] },
      interventionStyle: "GENTLE",
      summaryHe: `תאריך היעד של המשימה עבר ב-${t.daysOverdue} ימים.`,
      changeContext: null,
    });
  }
  return out;
}

/**
 * STEVEN_INTERNAL_DEADLINE_PASSED — symmetric to Victor's
 * MISSED_INTERNAL_DEADLINE, same OWNER_RULE (INTERNAL_DEADLINES_MATTER isn't
 * Victor-specific in the Charter — it applies to internal deadlines in
 * general). Steven's `internalDeadline`/`daysToInternal` are already-derived,
 * reliable fields (lib/coo/facts.ts) — reused verbatim, never re-derived.
 * Steven's "ball" (who owes the next action) stays UNKNOWN — this Case never
 * claims "Steven owes delivery" or "owner owes review" (Owner instruction §16).
 */
export function detectStevenInternalDeadlineCases(state: PartnerCompanyState): PartnerCase[] {
  const domain = state.domains.steven;
  if (domain.status !== "AVAILABLE" || !domain.data) return [];

  const out: PartnerCase[] = [];
  for (const w of domain.data.open) {
    if (w.internalDeadline === null || w.daysToInternal === null) continue;
    if (w.daysToInternal >= 0) continue; // future or today — not yet passed
    const daysLate = -w.daysToInternal;

    out.push({
      id: `steven_internal_deadline_passed:${w.id}`,
      caseType: "STEVEN_INTERNAL_DEADLINE_PASSED",
      subjectType: "stevenWork",
      subjectId: w.id,
      classification: "RISK",
      status: "OPEN",
      createdFrom: "STATE",
      facts: [
        { domain: "steven", entityId: w.id, field: "internalDeadline", value: w.internalDeadline, label: "internalDeadline" },
        { domain: "steven", entityId: w.id, field: "status", value: w.status, label: "status" },
        { domain: "steven", entityId: w.id, field: "projectId", value: w.projectId, label: "projectId" },
      ],
      derivedFacts: [{ id: "days_late", label: "ימים באיחור", value: daysLate, basis: `internalDeadline (${w.internalDeadline}) − today` }],
      hypotheses: [],
      ownerRulesApplied: ["INTERNAL_DEADLINES_MATTER"],
      workingPrinciplesApplied: [],
      unknowns: ["מי אחראי לפעולה הבאה (Steven או הבעלים) — לא ידוע, ה-ball של Steven אינו נחשף ל-Partner."],
      dataQuality: { notes: ["Steven work detail הוא open-only (CURRENT_SUBSET) — לא היסטוריה מלאה."] },
      interventionStyle: "GENTLE",
      // Never "Steven failed" — only the passed deadline, mirroring Victor's wording rule.
      summaryHe: `דדליין פנימי (Steven) עבר ב-${daysLate} ימים.`,
      changeContext: null,
    });
  }
  return out;
}
