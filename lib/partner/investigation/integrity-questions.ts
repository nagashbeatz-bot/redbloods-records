/**
 * Redbloods Partner — Company Integrity Owner questions taxonomy. Pure constants, no imports.
 *
 * Asked ONLY when a business DEFINITION cannot be determined safely from canonical data (never an operational
 * status question). Persisted (POST /api/partner/integrity/answer) as ordinary Owner Context rows through
 * the existing append-only primitive (partner_owner_context; no schema change: question_type / subject_type /
 * case_type are text, the app-level taxonomy below is what the strict row parser accepts).
 *
 * Owner answers are OWNER KNOWLEDGE only: they never change project_business_type, a client, a label artist or
 * any other canonical row. An inconsistency the Owner has explained stays visible (as OWNER_DECIDED) until it is
 * reconciled separately.
 */
export const INTEGRITY_QUESTION_TYPES = [
  // "The projects of <label artist> that are marked לקוח — are they label songs?" (per canonical roster artist)
  "INTEGRITY_LABEL_PROJECT_CLASSIFICATION",
  // "Two client records share the name <X> — the same person or different people?" (per ambiguous name group)
  "INTEGRITY_CLIENT_IDENTITY",
] as const;
export type IntegrityQuestionType = (typeof INTEGRITY_QUESTION_TYPES)[number];

export interface IntegrityAnswerOption { code: string; labelHe: string }

export const INTEGRITY_ANSWER_OPTIONS: Record<IntegrityQuestionType, readonly IntegrityAnswerOption[]> = {
  INTEGRITY_LABEL_PROJECT_CLASSIFICATION: [
    { code: "LABEL_SONGS", labelHe: "הפרויקטים האלה הם עבודת לייבל" },
    { code: "CLIENT_WORK", labelHe: "אלה עבודות לקוח, למרות שהאמן חתום בלייבל" },
    { code: "MIXED", labelHe: "יש גם עבודות לייבל וגם עבודות לקוח — צריך להבדיל בין הפרויקטים" },
    { code: "UNKNOWN", labelHe: "עוד לא החלטתי / צריך לבדוק" },
  ],
  INTEGRITY_CLIENT_IDENTITY: [
    { code: "SAME_PERSON", labelHe: "אותו אדם — רשומה כפולה" },
    { code: "DIFFERENT_PEOPLE", labelHe: "אנשים שונים עם אותו שם" },
    { code: "UNKNOWN", labelHe: "עוד לא החלטתי / צריך לבדוק" },
  ],
};

export const isIntegrityQuestionType = (t: unknown): t is IntegrityQuestionType =>
  typeof t === "string" && (INTEGRITY_QUESTION_TYPES as readonly string[]).includes(t);

/** Owner Context case ids of integrity questions all start with this prefix (never a Partner Case / finance id). */
export const INTEGRITY_CASE_PREFIX = "integrity:";
