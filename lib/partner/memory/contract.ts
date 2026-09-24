/**
 * Redbloods Partner — the Organizational Memory contract (permanent architecture rule). Pure data.
 *
 * Every Partner workflow that asks the Owner something must declare what it learns and how that knowledge
 * is reused. This registry is keyed by EVERY Owner-question type (Record<InvestigationQuestionType, …>), so
 * adding a question type without answering these ten questions does not compile — the rule is enforced by
 * architecture, not only documentation (see scripts/test-partner-memory.tsx).
 */
import type { InvestigationQuestionType } from "../investigation/types";
import type { MemoryEpistemic } from "./types";

export interface KnowledgeContract {
  /** 1. What does Partner learn? */
  learns: string;
  /** 2. Which entity owns the knowledge (entity key template)? */
  entity: string;
  /** 3. Epistemic type. */
  epistemic: MemoryEpistemic;
  /** 4. Current or historical? */
  temporality: "CURRENT_UNTIL_SUPERSEDED" | "HISTORICAL_EVENT";
  /** 5. How is it reused? */
  reuse: string;
  /** 6. What prevents a duplicate Owner question? */
  duplicateGuard: string;
  /** 7. What supersedes / invalidates it? */
  invalidatedBy: string;
  /** 8. Can it support a pattern candidate? */
  patternEvidence: string | null;
  /** 9. How does live state override it? */
  liveOverride: string;
  /** 10. Can an Action / Outcome be linked to it? */
  actionLink: string | null;
}

const OWNER_CONTEXT_GUARD = "exact question_id + case_facts_fingerprint: an ACTIVE matching answer suppresses the question (memory pre-flight); reload / new session / restart / deploy re-read the same Owner Context rows";
const FACTS_CHANGE = "an Owner revision (supersedes_id) or a change in the facts the question was asked about (new fingerprint → re-asked with the previous answer shown)";

export const PARTNER_KNOWLEDGE_CONTRACT: Readonly<Record<InvestigationQuestionType, KnowledgeContract>> = {
  WHY_DEADLINE_STILL_ACTIVE: { learns: "why a project's passed deadline is still set", entity: "project:<projectId>", epistemic: "OWNER_DECISION", temporality: "CURRENT_UNTIL_SUPERSEDED", reuse: "decision state → may trigger WHAT_IS_NEW_PROJECT_DEADLINE", duplicateGuard: OWNER_CONTEXT_GUARD, invalidatedBy: FACTS_CHANGE, patternEvidence: "repeated stale deadlines per project / reason", liveOverride: "a live deadline change closes the Case", actionLink: "UPDATE_PROJECT_DEADLINE (trigger context)" },
  IS_TASK_STILL_RELEVANT: { learns: "whether an overdue task still matters", entity: "task:<taskId>", epistemic: "OWNER_DECISION", temporality: "CURRENT_UNTIL_SUPERSEDED", reuse: "Case interpretation", duplicateGuard: OWNER_CONTEXT_GUARD, invalidatedBy: FACTS_CHANGE, patternEvidence: null, liveOverride: "task completion / deletion closes the Case", actionLink: null },
  WAS_DELIVERY_REVIEWED_OUTSIDE_SYSTEM: { learns: "whether a delivery was reviewed outside Redbloods", entity: "project:<projectId>", epistemic: "OWNER_DECISION", temporality: "CURRENT_UNTIL_SUPERSEDED", reuse: "Case interpretation", duplicateGuard: OWNER_CONTEXT_GUARD, invalidatedBy: FACTS_CHANGE, patternEvidence: "repeated off-system reviews", liveOverride: "a recorded review closes the Case", actionLink: null },
  IS_MISSING_FINANCE_CONFIG_INTENTIONAL: { learns: "whether a missing finance setting is intentional", entity: "project:<projectId>", epistemic: "OWNER_DECISION", temporality: "CURRENT_UNTIL_SUPERSEDED", reuse: "Case interpretation", duplicateGuard: OWNER_CONTEXT_GUARD, invalidatedBy: FACTS_CHANGE, patternEvidence: null, liveOverride: "a saved finance setting closes the Case", actionLink: null },
  WHY_INTERNAL_DEADLINE_PASSED: { learns: "why an internal deadline passed", entity: "project:<projectId>", epistemic: "OWNER_DECISION", temporality: "CURRENT_UNTIL_SUPERSEDED", reuse: "Case interpretation", duplicateGuard: OWNER_CONTEXT_GUARD, invalidatedBy: FACTS_CHANGE, patternEvidence: "repeated internal slips", liveOverride: "a new internal deadline closes the Case", actionLink: null },
  WHY_RELEASE_TARGET_PASSED: { learns: "why a release target passed", entity: "release:<releaseId>", epistemic: "OWNER_DECISION", temporality: "CURRENT_UNTIL_SUPERSEDED", reuse: "Case interpretation", duplicateGuard: OWNER_CONTEXT_GUARD, invalidatedBy: FACTS_CHANGE, patternEvidence: "repeated release slips", liveOverride: "a new target / release closes the Case", actionLink: null },
  WHAT_IS_NEW_PROJECT_DEADLINE: { learns: "the Owner's new deadline for a project", entity: "project:<projectId>", epistemic: "OWNER_DECISION", temporality: "CURRENT_UNTIL_SUPERSEDED", reuse: "UPDATE_PROJECT_DEADLINE proposal value", duplicateGuard: OWNER_CONTEXT_GUARD, invalidatedBy: FACTS_CHANGE + "; or its trigger answer is revised", patternEvidence: null, liveOverride: "the executed deadline becomes the live fact (Outcome APPLIED_AS_EXPECTED)", actionLink: "UPDATE_PROJECT_DEADLINE (value context) → EXECUTED → Outcome" },
  FINANCE_RECURRING_PAYMENT_STATUS: { learns: "whether a recurring payment (e.g. Victor salary) for ONE period was paid", entity: "recurring:VICTOR_SALARY:<YYYY-MM>", epistemic: "OWNER_DECISION", temporality: "CURRENT_UNTIL_SUPERSEDED", reuse: "missing-record wording; RECORD_PAID_EXPENSE readiness; payment-date question", duplicateGuard: OWNER_CONTEXT_GUARD + "; never copied to another period", invalidatedBy: FACTS_CHANGE, patternEvidence: "PAID_BUT_MISSING_FINANCE_RECORD observation per period", liveOverride: "a paid Finance transaction for the period answers it (KNOWN_CURRENT) and resolves the observation", actionLink: "RECORD_PAID_EXPENSE (status context)" },
  FINANCE_PAYMENT_DATE: { learns: "the exact date a confirmed payment was made", entity: "recurring:VICTOR_SALARY:<YYYY-MM>", epistemic: "OWNER_DECISION", temporality: "HISTORICAL_EVENT", reuse: "RECORD_PAID_EXPENSE facts.date", duplicateGuard: OWNER_CONTEXT_GUARD + "; fingerprint commits to the status answer it follows", invalidatedBy: "the status answer is revised, or the Owner revises the date", patternEvidence: "payment timing per period (observation only)", liveOverride: "a Finance transaction date for the period wins", actionLink: "RECORD_PAID_EXPENSE (date context)" },
  FINANCE_RECEIVABLE_TIMING: { learns: "when (or whether) a calculated balance will be collected", entity: "receivable:<PROJECT_BALANCE|CLIP_BALANCE>:<projectId>", epistemic: "OWNER_DECISION", temporality: "CURRENT_UNTIL_SUPERSEDED", reuse: "collection intent wording; PROJECT_CANCELLED_NO_FURTHER_PAYMENT closes the receivable (overlay)", duplicateGuard: OWNER_CONTEXT_GUARD, invalidatedBy: FACTS_CHANGE, patternEvidence: null, liveOverride: "received income / changed price changes the balance → re-asked with the previous answer", actionLink: "SET_RECEIVABLE_DUE_DATE (unsupported)" },
  FINANCE_COMPLETED_PROJECT_INCOME_STATUS: { learns: "what happened to income for a completed project", entity: "project:<projectId>", epistemic: "OWNER_DECISION", temporality: "CURRENT_UNTIL_SUPERSEDED", reuse: "integrity wording; RECORD_RECEIVED_INCOME readiness", duplicateGuard: OWNER_CONTEXT_GUARD, invalidatedBy: FACTS_CHANGE, patternEvidence: "completed-without-income per project", liveOverride: "a recorded income transaction closes the gap", actionLink: "RECORD_RECEIVED_INCOME (blocked)" },
  FINANCE_ORPHAN_SETTING_MEANING: { learns: "what an orphan price setting represents", entity: "finance-setting:<id>", epistemic: "OWNER_DECISION", temporality: "CURRENT_UNTIL_SUPERSEDED", reuse: "orphan queue closure / recovery wording", duplicateGuard: OWNER_CONTEXT_GUARD, invalidatedBy: FACTS_CHANGE, patternEvidence: null, liveOverride: "a live project for the id makes it no longer orphan", actionLink: null },
  FINANCE_EXPENSE_RECURRENCE: { learns: "whether a repeated expense is recurring", entity: "expense-pattern:<category|amount|currency>", epistemic: "OWNER_DECISION", temporality: "CURRENT_UNTIL_SUPERSEDED", reuse: "recurring-expense expectations (no forecast write)", duplicateGuard: OWNER_CONTEXT_GUARD, invalidatedBy: FACTS_CHANGE, patternEvidence: "the answer itself confirms / rejects the candidate", liveOverride: "new months change the candidate fingerprint", actionLink: null },
  INTEGRITY_LABEL_PROJECT_CLASSIFICATION: { learns: "whether the projects of a canonical label artist that are marked לקוח are label songs (a business definition)", entity: "label-artist:<labelArtistId>", epistemic: "OWNER_DECISION", temporality: "CURRENT_UNTIL_SUPERSEDED", reuse: "Company Integrity: the classification mismatch is shown as OWNER_DECIDED (canonical project_business_type is never changed by it)", duplicateGuard: OWNER_CONTEXT_GUARD, invalidatedBy: FACTS_CHANGE, patternEvidence: null, liveOverride: "a new / changed project of that artist changes the fingerprint → re-asked with the previous answer shown; the canonical field itself always stays the live fact", actionLink: null },
  INTEGRITY_CLIENT_IDENTITY: { learns: "whether client records sharing one name are the same person", entity: "client-name:<normalized name>", epistemic: "OWNER_DECISION", temporality: "CURRENT_UNTIL_SUPERSEDED", reuse: "Company Integrity: project ↔ client TEXT_MATCH ambiguity is explained, never auto-resolved into an id link", duplicateGuard: OWNER_CONTEXT_GUARD, invalidatedBy: FACTS_CHANGE, patternEvidence: null, liveOverride: "a change in the set of same-name client records changes the fingerprint → re-asked; no client row is ever merged or changed", actionLink: null },
  FINANCE_OVERDUE_REASON: { learns: "why an overdue payment is still open", entity: "receivable:EXPECTED_TX:<txId>", epistemic: "OWNER_DECISION", temporality: "CURRENT_UNTIL_SUPERSEDED", reuse: "overdue wording / follow-up priority", duplicateGuard: OWNER_CONTEXT_GUARD, invalidatedBy: FACTS_CHANGE, patternEvidence: "repeated reasons per client", liveOverride: "a received payment settles the receivable", actionLink: null },
};
