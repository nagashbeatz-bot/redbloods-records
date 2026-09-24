/**
 * Redbloods Partner — Investigation questions (Phase F.1C). Pure,
 * deterministic, no I/O.
 *
 * A question is generated ONLY when:
 *   1. the Case's facts already establish the condition, AND
 *   2. the business meaning / cause is still genuinely UNKNOWN, AND
 *   3. an Owner answer would materially improve future reasoning.
 * Every other Case gets an explicit NoQuestionReason — never a silent skip,
 * and never a generic "can you provide more context?".
 *
 * Wording rules (Owner instruction §10, §21): short, specific, grounded in
 * the Case's own numbers, neutral. A question may point at a gap, never at
 * a person — the Owner, Victor or Steven are never described as at fault.
 * STEVEN_INTERNAL_DEADLINE_PASSED explicitly states that the Partner does
 * not know who holds the next action (Steven's ball is not exposed to
 * Partner), so it never asks "why is Steven late?".
 */
import type { PartnerCase } from "../cases/types";
import { fingerprintCaseFacts } from "../feedback/snapshot";
import { formatYmdHe } from "./answer-value";
import { FINANCE_ANSWER_OPTIONS, isFinanceQuestionType } from "./finance-questions";
import { INTEGRITY_ANSWER_OPTIONS, isIntegrityQuestionType } from "./integrity-questions";
import {
  INVESTIGATION_OWNER_RULE, INVESTIGATION_SCHEMA_VERSION,
  type InvestigationAnswerOption, type InvestigationDecision, type InvestigationQuestionType,
  type NoQuestionReason, type PartnerInvestigationQuestion, type PartnerOwnerContext, type QuestionOrigin,
} from "./types";

// ── answer options (the OTHER option is appended to every Case question list; finance lists are complete as-is) ──

const OTHER: InvestigationAnswerOption = {
  code: "OTHER", labelHe: "אחר (אפשר להוסיף הערה)",
  remainingUnknownHe: "הסיבה נמסרה כ\"אחר\" ולא סווגה — ההערה נשמרת כפי שהיא ואינה מפוענחת.",
};

const byOwner = "(לפי הבעלים)";

export const ANSWER_OPTIONS: Record<InvestigationQuestionType, readonly InvestigationAnswerOption[]> = {
  WHY_DEADLINE_STILL_ACTIVE: [
    { code: "DEADLINE_NOT_UPDATED", labelHe: "הדדליין פשוט לא עודכן", derivedHe: `הדדליין השמור אינו משקף את התכנון הנוכחי ${byOwner}.`, hypothesisHe: "ייתכן שזה מצביע על פער בתהליך תחזוקת הדדליינים של פרויקטים.", remainingUnknownHe: "מהו הדדליין הנכון כעת — לא ידוע." },
    { code: "INTENTIONALLY_DELAYED", labelHe: "נדחה בכוונה", derivedHe: `הדחייה מכוונת ${byOwner}.`, remainingUnknownHe: "יעד מעודכן — לא ידוע." },
    { code: "CLIENT_DELAY", labelHe: "עיכוב מצד הלקוח", derivedHe: `העיכוב מיוחס ללקוח ${byOwner} — context, לא עובדה מאומתת.` },
    { code: "ARTIST_DELAY", labelHe: "עיכוב מצד האמן", derivedHe: `העיכוב מיוחס לאמן ${byOwner} — context, לא עובדה מאומתת.` },
    { code: "QUALITY_WORK_CONTINUED", labelHe: "העבודה נמשכה כדי לשפר איכות", derivedHe: `העבודה נמשכה אחרי הדדליין מסיבות איכות ${byOwner}.` },
    { code: "EXTERNAL_DEPENDENCY", labelHe: "תלות בגורם חיצוני", derivedHe: `הפרויקט תלוי בגורם חיצוני ${byOwner}.` },
    { code: "PROJECT_WAS_PAUSED", labelHe: "הפרויקט היה מושהה", derivedHe: `הפרויקט היה מושהה בחלק מהזמן ${byOwner}.` },
    { code: "DEADLINE_NO_LONGER_RELEVANT", labelHe: "הדדליין כבר לא רלוונטי", derivedHe: `הדדליין השמור אינו רלוונטי עוד ${byOwner}.` },
  ],
  IS_TASK_STILL_RELEVANT: [
    { code: "STILL_RELEVANT", labelHe: "עדיין רלוונטית, טרם בוצעה", derivedHe: `המשימה עדיין רלוונטית ${byOwner}.`, remainingUnknownHe: "מועד ביצוע מעודכן — לא ידוע." },
    { code: "ALREADY_DONE_NOT_MARKED", labelHe: "בוצעה, אבל לא סומנה במערכת", derivedHe: `המשימה בוצעה ולא סומנה כסגורה במערכת ${byOwner}.`, hypothesisHe: "ייתכן שיש פער בסגירת משימות במערכת אחרי ביצוע." },
    { code: "NO_LONGER_RELEVANT", labelHe: "כבר לא רלוונטית", derivedHe: `המשימה אינה רלוונטית עוד ${byOwner}.` },
    { code: "DUE_DATE_NOT_UPDATED", labelHe: "רלוונטית, התאריך לא עודכן", derivedHe: `תאריך היעד השמור אינו משקף את התכנון הנוכחי ${byOwner}.`, hypothesisHe: "ייתכן שיש פער בתחזוקת תאריכי יעד של משימות.", remainingUnknownHe: "תאריך יעד מעודכן — לא ידוע." },
    { code: "WAITING_ON_SOMEONE_ELSE", labelHe: "ממתינה למישהו אחר", derivedHe: `המשימה ממתינה לגורם אחר ${byOwner}.`, remainingUnknownHe: "למי היא ממתינה — לא ידוע." },
  ],
  WAS_DELIVERY_REVIEWED_OUTSIDE_SYSTEM: [
    { code: "REVIEWED_OUTSIDE_SYSTEM", labelHe: "נבדקה/טופלה מחוץ למערכת", derivedHe: `המסירה נבדקה מחוץ למערכת ${byOwner}; התיעוד במערכת חסר.`, hypothesisHe: "ייתכן שחלק מהבדיקות של מסירות אינן מתועדות במערכת." },
    { code: "NOT_REVIEWED_YET", labelHe: "עוד לא נבדקה", derivedHe: `המסירה טרם נבדקה ${byOwner}.` },
    { code: "NO_REVIEW_NEEDED", labelHe: "לא נדרשת בדיקה למסירה הזו", derivedHe: `המסירה אינה דורשת בדיקה ${byOwner}.` },
    { code: "WAITING_ON_SOMETHING_ELSE", labelHe: "ממתינה לדבר אחר", derivedHe: `הטיפול במסירה ממתין לגורם אחר ${byOwner}.`, remainingUnknownHe: "למה היא ממתינה — לא ידוע." },
  ],
  IS_MISSING_FINANCE_CONFIG_INTENTIONAL: [
    { code: "INTENTIONALLY_UNPRICED", labelHe: "מכוון — לפרויקט אין מחיר", derivedHe: `היעדר התמחור מכוון ${byOwner}.` },
    { code: "PRICE_NOT_AGREED_YET", labelHe: "המחיר עוד לא סוכם", derivedHe: `המחיר טרם סוכם ${byOwner}.`, remainingUnknownHe: "מתי יסוכם המחיר — לא ידוע." },
    { code: "FORGOT_TO_CONFIGURE", labelHe: "לא הוגדר — פספוס", derivedHe: `התמחור לא הוגדר בטעות ${byOwner}.`, hypothesisHe: "ייתכן שיש פער בתהליך הגדרת התמחור בפתיחת פרויקט." },
    { code: "PRICED_ELSEWHERE", labelHe: "התמחור מנוהל במקום אחר", derivedHe: `התמחור מנוהל מחוץ להגדרות הפרויקט ${byOwner}.` },
  ],
  WHY_INTERNAL_DEADLINE_PASSED: [
    { code: "DEADLINE_NOT_UPDATED", labelHe: "הדדליין פשוט לא עודכן", derivedHe: `הדדליין הפנימי השמור אינו משקף את התכנון הנוכחי ${byOwner}.`, hypothesisHe: "ייתכן שיש פער בתחזוקת דדליינים פנימיים.", remainingUnknownHe: "מהו הדדליין הפנימי הנכון כעת — לא ידוע." },
    { code: "WORK_DONE_NOT_CLOSED", labelHe: "העבודה הושלמה, לא נסגרה במערכת", derivedHe: `העבודה הושלמה ולא נסגרה במערכת ${byOwner}.`, hypothesisHe: "ייתכן שיש פער בסגירת עבודות במערכת אחרי השלמה." },
    { code: "WAITING_ON_OWNER", labelHe: "הפעולה הבאה אצלי", derivedHe: `הפעולה הבאה אצל הבעלים ${byOwner}.` },
    { code: "WAITING_ON_COLLABORATOR", labelHe: "הפעולה הבאה אצל שותף העבודה", derivedHe: `הפעולה הבאה אצל שותף העבודה ${byOwner}.` },
    { code: "WAITING_ON_CLIENT_OR_ARTIST", labelHe: "ממתין ללקוח/אמן", derivedHe: `העבודה ממתינה ללקוח או לאמן ${byOwner}.` },
    { code: "SCOPE_CHANGED", labelHe: "היקף העבודה השתנה", derivedHe: `היקף העבודה השתנה אחרי קביעת הדדליין ${byOwner}.` },
    { code: "INTENTIONALLY_EXTENDED", labelHe: "הוארך בכוונה", derivedHe: `הדדליין הוארך בכוונה ${byOwner}.`, remainingUnknownHe: "דדליין מעודכן — לא ידוע." },
  ],
  // F.1E v2 follow-up. Relative answers are resolved to a concrete date by the server at answer time (answer-value.ts).
  WHAT_IS_NEW_PROJECT_DEADLINE: [
    { code: "IN_ONE_WEEK", labelHe: "עוד שבוע", derivedHe: `נקבע דדליין חדש לפרויקט ${byOwner}.` },
    { code: "IN_TWO_WEEKS", labelHe: "עוד שבועיים", derivedHe: `נקבע דדליין חדש לפרויקט ${byOwner}.` },
    { code: "END_OF_MONTH", labelHe: "סוף החודש", derivedHe: `נקבע דדליין חדש לפרויקט ${byOwner}.` },
    { code: "SPECIFIC_DATE", labelHe: "לבחור תאריך", derivedHe: `נקבע דדליין חדש לפרויקט ${byOwner}.` },
    { code: "NOT_KNOWN_YET", labelHe: "עדיין לא יודע", derivedHe: `עדיין לא נקבע דדליין חדש ${byOwner}.`, remainingUnknownHe: "מהו הדדליין החדש — לא ידוע." },
  ],
  WHY_RELEASE_TARGET_PASSED: [
    { code: "TARGET_NOT_UPDATED", labelHe: "היעד פשוט לא עודכן", derivedHe: `תאריך היעד השמור אינו משקף את התכנון הנוכחי ${byOwner}.`, hypothesisHe: "ייתכן שיש פער בתחזוקת תאריכי יעד של ריליסים." },
    { code: "POSTPONED_INTENTIONALLY", labelHe: "נדחה בכוונה", derivedHe: `הריליס נדחה בכוונה ${byOwner}.`, remainingUnknownHe: "יעד מעודכן — לא ידוע." },
    { code: "CONTENT_NOT_READY", labelHe: "התוכן עוד לא מוכן", derivedHe: `תוכן הריליס עוד לא מוכן ${byOwner}.` },
    { code: "EXTERNAL_DEPENDENCY", labelHe: "תלות בגורם חיצוני", derivedHe: `הריליס תלוי בגורם חיצוני ${byOwner}.` },
    { code: "ALREADY_RELEASED_NOT_RECORDED", labelHe: "כבר יצא, לא עודכן במערכת", derivedHe: `הריליס כבר יצא ולא עודכן במערכת ${byOwner}.`, hypothesisHe: "ייתכן שיש פער בעדכון שלב הריליס אחרי פרסום." },
  ],
  // F2.8–F2.10: the Finance Owner questions (single source: finance-questions.ts).
  ...FINANCE_ANSWER_OPTIONS,
  // Company Integrity Register: definition questions (single source: integrity-questions.ts).
  ...INTEGRITY_ANSWER_OPTIONS,
};

export function answerOptionsFor(type: InvestigationQuestionType): InvestigationAnswerOption[] {
  return isFinanceQuestionType(type) || isIntegrityQuestionType(type) ? [...ANSWER_OPTIONS[type]] : [...ANSWER_OPTIONS[type], OTHER];
}

// ── Case types that are FACT-COMPLETE in v1 (§6): the condition AND its meaning are computed facts ──

const FACT_COMPLETE_TYPES: Record<string, string> = {
  PROJECT_PAYMENT_OUTSTANDING: "היתרה מחושבת מהנתונים (מחיר מוסכם − התקבל). אין אי-ודאות לגבי העובדה; שאלת \"למה לא נגבה\" אינה חלק מ-v1.",
  PROJECT_OVERPAYMENT: "העודף מחושב מהנתונים (התקבל − מחיר מוסכם). אין אי-ודאות לגבי העובדה.",
  PAYMENT_DUE_DATE_PASSED: "תאריך התשלום והיתרה הם עובדות מחושבות; שאלת \"למה לא נגבה\" אינה חלק מ-v1.",
  SHOW_CLIENT_PAYMENT_OUTSTANDING: "סטטוס התשלום והסכום של ההופעה הם עובדות; שאלת גבייה אינה חלק מ-v1.",
  MONEY_RECEIVED: "אירוע כספי שהתרחש — עובדה, אין אי-ודאות עסקית לחקור.",
  NEW_SHOW_RECORDED: "אירוע שנרשם — עובדה, אין אי-ודאות עסקית לחקור.",
  PROPOSAL_STATUS_CHANGED: "שינוי סטטוס שנרשם — עובדה.",
  PROPOSAL_CLOSED_WON: "הצעה שנסגרה — עובדה.",
  RELEASE_TARGET_DATE_CHANGED: "שינוי תאריך שנרשם — עובדה.",
};

/** Mirrors lib/coo/config.ts closedProjectStatuses — a closed project has no active deadline to investigate. */
const CLOSED_PROJECT_STATUSES = ["הושלם", "בוטל"];

// ── helpers ──

const fact = (c: PartnerCase, field: string) => c.facts.find((f) => f.field === field || f.label === field)?.value ?? null;
const derived = (c: PartnerCase, id: string) => c.derivedFacts.find((d) => d.id === id)?.value ?? null;
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** "היום" / "אתמול" / "לפני N ימים" — never an awkward "לפני 1 ימים". */
export function daysAgoHe(n: number): string {
  if (n <= 0) return "היום";
  if (n === 1) return "אתמול";
  return `לפני ${n} ימים`;
}

function presentRefs(c: PartnerCase, refs: string[]): string[] {
  return refs.filter((r) => c.facts.some((f) => f.field === r || f.label === r) || c.derivedFacts.some((d) => d.id === r));
}

export function questionIdFor(caseId: string, type: InvestigationQuestionType): string {
  return `${caseId}::${type}`;
}

function makeQuestion(c: PartnerCase, type: InvestigationQuestionType, questionTextHe: string, reasonHe: string, refs: string[], origin: QuestionOrigin = { kind: "CASE" }): PartnerInvestigationQuestion {
  return {
    id: questionIdFor(c.id, type),
    schemaVersion: INVESTIGATION_SCHEMA_VERSION,
    caseId: c.id,
    caseType: c.caseType,
    subjectType: c.subjectType,
    subjectId: c.subjectId,
    questionType: type,
    origin,
    caseFactsFingerprint: fingerprintCaseFacts(c),
    questionTextHe,
    reasonHe,
    factsReferenced: presentRefs(c, refs),
    answerOptions: answerOptionsFor(type),
    allowsFreeText: true,
    ownerRuleApplied: INVESTIGATION_OWNER_RULE,
    status: "OPEN",
  };
}

const none = (c: PartnerCase, reason: NoQuestionReason, explanationHe: string): InvestigationDecision =>
  ({ caseId: c.id, caseType: c.caseType, question: null, noQuestionReason: reason, explanationHe });
const ask = (c: PartnerCase, q: PartnerInvestigationQuestion): InvestigationDecision =>
  ({ caseId: c.id, caseType: c.caseType, question: q, noQuestionReason: null, explanationHe: q.reasonHe });

// ── per-type question builders ──

function projectDeadline(c: PartnerCase): InvestigationDecision {
  const status = fact(c, "status");
  if (typeof status === "string" && CLOSED_PROJECT_STATUSES.includes(status)) {
    return none(c, "CONDITION_NOT_ACTIVE", `הפרויקט במצב "${status}" — אין דדליין פעיל לחקור.`);
  }
  const late = num(derived(c, "days_late"));
  const sinceUpdate = num(derived(c, "days_since_update"));
  const activity = derived(c, "activity_after_deadline");
  const passed = late !== null ? `הדדליין של הפרויקט עבר ${daysAgoHe(late)}` : "הדדליין של הפרויקט עבר";
  const middle = activity === true && sinceUpdate !== null
    ? `, אבל הפרויקט עדיין פעיל ועודכן ${daysAgoHe(sinceUpdate)}`
    : activity === false
      ? ", הפרויקט עדיין פתוח ולא עודכן מאז"
      : " והפרויקט עדיין פתוח";
  return ask(c, makeQuestion(c, "WHY_DEADLINE_STILL_ACTIVE",
    `${passed}${middle}. מה הסיבה שהדדליין הישן עדיין מוגדר?`,
    "הדדליין עבר (עובדה) והפרויקט עדיין פתוח — הסיבה העסקית לכך שהדדליין הישן עדיין מוגדר אינה ידועה.",
    ["deadline", "status", "days_late", "days_since_update", "activity_after_deadline"]));
}

function taskDue(c: PartnerCase): InvestigationDecision {
  const overdue = num(derived(c, "days_overdue"));
  const when = overdue !== null ? `עבר ${daysAgoHe(overdue)}` : "עבר";
  return ask(c, makeQuestion(c, "IS_TASK_STILL_RELEVANT",
    `המשימה עדיין פתוחה ותאריך היעד שלה ${when}. האם היא עדיין רלוונטית?`,
    "תאריך היעד עבר (עובדה) — לא ידוע אם המשימה עדיין רלוונטית, בוצעה ולא סומנה, או שהתאריך פשוט לא עודכן.",
    ["dueYmd", "days_overdue"]));
}

function delivery(c: PartnerCase): InvestigationDecision {
  const since = num(derived(c, "days_since_delivery"));
  const when = since !== null ? ` ${daysAgoHe(since)}` : "";
  return ask(c, makeQuestion(c, "WAS_DELIVERY_REVIEWED_OUTSIDE_SYSTEM",
    `Victor העלה מסירה${when}, ומאז לא נרשם follow-up במערכת. האם המסירה נבדקה או טופלה מחוץ למערכת?`,
    "המסירה רשומה (עובדה) ואין follow-up מתועד — לא ידוע אם הבעלים בדק אותה מחוץ למערכת.",
    ["lastUploadAt", "ball.code", "days_since_delivery", "has_any_historical_review"]));
}

function financeConfig(c: PartnerCase): InvestigationDecision {
  return ask(c, makeQuestion(c, "IS_MISSING_FINANCE_CONFIG_INTENTIONAL",
    "לפרויקט פעיל לא מוגדר תמחור. האם זה מכוון?",
    "היעדר ההגדרה הוא עובדה — לא ידוע אם הוא מכוון או פספוס.",
    ["hasFinanceSetting"]));
}

function victorInternalDeadline(c: PartnerCase): InvestigationDecision {
  const late = num(derived(c, "days_late"));
  const after = derived(c, "delivery_after_deadline");
  const passed = late !== null ? `הדדליין הפנימי של העבודה עבר ${daysAgoHe(late)}` : "הדדליין הפנימי של העבודה עבר";
  const uploads = after === true ? ", ונרשמו העלאות אחרי הדדליין" : after === false ? ", ולא נרשמו העלאות אחרי הדדליין" : "";
  return ask(c, makeQuestion(c, "WHY_INTERNAL_DEADLINE_PASSED",
    `${passed} והעבודה עדיין פתוחה${uploads}. מה גרם לכך שהיא עדיין פתוחה?`,
    "הדדליין עבר והעבודה פתוחה (עובדות) — הסיבה, ואצל מי הפעולה הבאה, אינן ידועות מה-Case.",
    ["internalDeadline", "workState", "days_late", "delivery_after_deadline"]));
}

function stevenInternalDeadline(c: PartnerCase): InvestigationDecision {
  const late = num(derived(c, "days_late"));
  const passed = late !== null ? `הדדליין הפנימי של העבודה עם Steven עבר ${daysAgoHe(late)}` : "הדדליין הפנימי של העבודה עם Steven עבר";
  return ask(c, makeQuestion(c, "WHY_INTERNAL_DEADLINE_PASSED",
    `${passed} והעבודה עדיין פתוחה. ל-Partner אין מידע אצל מי הפעולה הבאה. מה מצב העבודה?`,
    "הדדליין עבר (עובדה) — אצל מי הפעולה הבאה (Steven או הבעלים) לא ידוע, ולכן אין להסיק מי מעכב.",
    ["internalDeadline", "status", "days_late"]));
}

function releaseTarget(c: PartnerCase): InvestigationDecision {
  const late = num(derived(c, "days_late"));
  const stage = fact(c, "stage") ?? fact(c, "release_stage");
  const passed = late !== null ? `תאריך היעד של הריליס עבר ${daysAgoHe(late)}` : "תאריך היעד של הריליס עבר";
  const stageText = typeof stage === "string" ? ` (שלב נוכחי: ${stage})` : "";
  return ask(c, makeQuestion(c, "WHY_RELEASE_TARGET_PASSED",
    `${passed}${stageText}. מה הסיבה שהיעד הישן עדיין מוגדר?`,
    "תאריך היעד עבר והריליס לא בשלב \"יצא\" (עובדות) — הסיבה אינה ידועה.",
    ["targetYmd", "release_target_date", "stage", "release_stage", "days_late"]));
}

const BUILDERS: Record<string, (c: PartnerCase) => InvestigationDecision> = {
  PROJECT_DEADLINE_PASSED: projectDeadline,
  TASK_DUE_DATE_PASSED: taskDue,
  DELIVERY_WITHOUT_RECORDED_FOLLOWUP: delivery,
  FINANCE_CONFIGURATION_MISSING: financeConfig,
  MISSED_INTERNAL_DEADLINE: victorInternalDeadline,
  STEVEN_INTERNAL_DEADLINE_PASSED: stevenInternalDeadline,
  RELEASE_TARGET_DATE_PASSED: releaseTarget,
};

/** Decides, for ONE Case, whether the Partner should ask — and if so, exactly what. Deterministic. */
export function decideInvestigation(c: PartnerCase): InvestigationDecision {
  if (c.status === "RESOLVED_BY_STATE") return none(c, "CONDITION_NOT_ACTIVE", "ה-Case כבר נפתר לפי המצב הנוכחי.");
  const factComplete = FACT_COMPLETE_TYPES[c.caseType];
  if (factComplete) return none(c, "FACT_COMPLETE", factComplete);
  const build = BUILDERS[c.caseType];
  if (!build) return none(c, "NOT_IN_V1_TAXONOMY", `לסוג ${c.caseType} אין שאלת חקירה ב-v1.`);
  return build(c);
}

/** All decisions, sorted by caseId (input-order independent). */
export function decideInvestigations(cases: readonly PartnerCase[]): InvestigationDecision[] {
  return cases.map(decideInvestigation).sort((a, b) => a.caseId.localeCompare(b.caseId));
}

/** Just the questions, sorted by id. */
export function buildInvestigationQuestions(cases: readonly PartnerCase[]): PartnerInvestigationQuestion[] {
  return decideInvestigations(cases).flatMap((d) => (d.question ? [d.question] : [])).sort((a, b) => a.id.localeCompare(b.id));
}

// ── Follow-up questions (F.1E v2) — triggered by one exact Owner Context, never by the Case alone ──

export interface FollowUpRule {
  /** The answered question that may trigger the follow-up. */
  fromQuestionType: InvestigationQuestionType;
  /** Answers that trigger it. Anything else (incl. OTHER) does not — other causes may need tailored flows later. */
  fromAnswerCodes: readonly string[];
  followUp: InvestigationQuestionType;
}

/**
 * v1 (Owner decision 2026-09-23): a new-deadline question follows only
 * DEADLINE_NOT_UPDATED and INTENTIONALLY_DELAYED — in both, the stored deadline
 * no longer represents the plan (NOT_KNOWN_YET is a valid answer).
 * DEADLINE_NO_LONGER_RELEVANT, CLIENT_DELAY, ARTIST_DELAY, QUALITY_WORK_CONTINUED,
 * EXTERNAL_DEPENDENCY, PROJECT_WAS_PAUSED and OTHER deliberately do not.
 */
export const FOLLOW_UP_RULES: readonly FollowUpRule[] = [
  { fromQuestionType: "WHY_DEADLINE_STILL_ACTIVE", fromAnswerCodes: ["DEADLINE_NOT_UPDATED", "INTENTIONALLY_DELAYED"], followUp: "WHAT_IS_NEW_PROJECT_DEADLINE" },
];

/** Question types that exist only as follow-ups (always carry a trigger; never generated from a Case alone). */
export const FOLLOW_UP_QUESTION_TYPES: ReadonlySet<InvestigationQuestionType> = new Set(FOLLOW_UP_RULES.map((r) => r.followUp));

export function isFollowUpQuestionType(t: InvestigationQuestionType): boolean {
  return FOLLOW_UP_QUESTION_TYPES.has(t);
}

/** True when an answer (questionType, answerCode) triggers `followUp` under FOLLOW_UP_RULES. */
export function triggersFollowUp(questionType: string, answerCode: string, followUp: InvestigationQuestionType): boolean {
  return FOLLOW_UP_RULES.some((r) => r.followUp === followUp && r.fromQuestionType === questionType && r.fromAnswerCodes.includes(answerCode));
}

function followUpText(c: PartnerCase, type: InvestigationQuestionType): { text: string; reason: string; refs: string[] } {
  // Only one follow-up type exists in v1.
  void type;
  const deadline = fact(c, "deadline");
  const shown = typeof deadline === "string" && /^\d{4}-\d{2}-\d{2}$/.test(deadline) ? ` (${formatYmdHe(deadline)})` : "";
  return {
    text: `הדדליין השמור${shown} כבר לא משקף את התכנון. מה הדדליין החדש לפרויקט?`,
    reason: "הבעלים ציין שהדדליין השמור אינו משקף את התכנון — הדדליין החדש אינו ידוע.",
    refs: ["deadline", "status"],
  };
}

/**
 * Follow-up questions for ONE Case, from the Owner Contexts that currently
 * apply to it (the caller passes APPLICABLE contexts — see
 * context-applicability.ts). Deterministic.
 *
 * `existingFollowUpTriggers` (questionId → triggerContextId) lets an
 * already-answered, still-applicable follow-up keep pointing at its ORIGINAL
 * trigger, so the question and its answer stay in the same slot even after a
 * note-only revision of the trigger (semantic continuity).
 */
export function buildFollowUpQuestions(
  c: PartnerCase,
  applicableContexts: readonly PartnerOwnerContext[],
  existingFollowUpTriggers: Readonly<Record<string, string>> = {},
): PartnerInvestigationQuestion[] {
  const out: PartnerInvestigationQuestion[] = [];
  for (const rule of FOLLOW_UP_RULES) {
    const trigger = applicableContexts
      .filter((x) => x.caseId === c.id && x.questionType === rule.fromQuestionType && rule.fromAnswerCodes.includes(x.answerCode))
      .sort((a, b) => a.id.localeCompare(b.id))[0];
    if (!trigger) continue;
    const qid = questionIdFor(c.id, rule.followUp);
    const triggerContextId = existingFollowUpTriggers[qid] ?? trigger.id;
    const { text, reason, refs } = followUpText(c, rule.followUp);
    out.push(makeQuestion(c, rule.followUp, text, reason, refs, {
      kind: "OWNER_CONTEXT", triggerContextId, triggerQuestionId: trigger.questionId, triggerAnswerCode: trigger.answerCode,
    }));
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}
