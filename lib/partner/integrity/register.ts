/**
 * Redbloods Partner — Company Integrity Register assembly. Pure, deterministic (now injected).
 *
 * Runs every detector over one consistent read, then applies the Owner's ACTIVE Owner Context answers
 * (organizational memory — the Owner is never asked twice for the same thing):
 *   - an answer for the SAME questionId and the SAME facts fingerprint is applied (OWNER_DECISION, never FACT) and the
 *     question is never re-asked (UNKNOWN included — "עוד לא החלטתי" for unchanged facts is not nagged);
 *   - MIXED on a label classification is a fact-set-independent DEFINITION ("this artist has both kinds of work"):
 *     it keeps applying when projects are added, and no per-project questions are generated from it;
 *   - any other answer for CHANGED facts is kept as history (FACTS_CHANGED) and the ambiguity is surfaced again,
 *     showing the previous answer — never reused blindly;
 *   - when live canonical data no longer shows the ambiguity, live facts win (NO_LONGER_AMBIGUOUS, history kept);
 *   - question minimization: only an ambiguity that affects a CURRENT business conclusion (active work) is asked;
 *   - at most MAX_INTEGRITY_QUESTIONS questions are surfaced (highest priority first), the rest are counted.
 * Findings are derived live, never persisted, never written anywhere. Canonical rows are never changed.
 */
import { questionIdFor, answerOptionsFor } from "../investigation/questions";
import { INTEGRITY_CASE_PREFIX, isIntegrityQuestionType } from "../investigation/integrity-questions";
import type { PartnerOwnerContext } from "../investigation/types";
import { DETECTORS, fingerprintOf, type FindingDraft, type IntegrityInput } from "./detectors";
import { OWNER_COMPANY_DEFINITIONS } from "./definitions";
import {
  INTEGRITY_SCHEMA_VERSION, MAX_INTEGRITY_QUESTIONS,
  type CompanyIntegrityRegister, type IntegrityFinding, type IntegrityLearnedDecision, type IntegrityOwnerDecision,
  type IntegrityQuestion, type IntegritySourceStatus, type IntegrityStance,
} from "./types";

export interface IntegrityRegisterInput extends IntegrityInput {
  /** ACTIVE (CURRENT_APPLICABLE) Owner Context answers; null = unreadable (then NO question is surfaced — fail closed). */
  ownerContexts: readonly PartnerOwnerContext[] | null;
}

const SEVERITY_RANK = { HIGH: 0, MEDIUM: 1, LOW: 2 } as const;

/** The deterministic Case id of an integrity question (the Owner Context case_id). */
export const integrityCaseId = (questionType: string, subjectId: string) => `${INTEGRITY_CASE_PREFIX}${questionType}:${subjectId}`;

const optionLabel = (questionType: IntegrityQuestion["questionType"], code: string) => answerOptionsFor(questionType).find((o) => o.code === code)?.labelHe ?? code;

function buildQuestion(d: FindingDraft): IntegrityQuestion {
  const q = d.question!;
  const caseId = integrityCaseId(q.type, q.subjectId);
  const options = answerOptionsFor(q.type).map((o) => ({ code: o.code, labelHe: o.labelHe }));
  return {
    questionId: questionIdFor(caseId, q.type), caseId, questionType: q.type,
    subject: { type: q.subjectType, id: q.subjectId, label: q.subjectLabel },
    textHe: q.textHe, whyHe: q.whyHe, evidenceHe: q.evidenceHe, options,
    // The facts only — wording / labels can be improved without re-asking the Owner.
    fingerprint: fingerprintOf({ v: INTEGRITY_SCHEMA_VERSION, type: q.type, subject: [q.subjectType, q.subjectId], facts: q.facts, options: options.map((o) => o.code) }),
    priority: q.priority, previousAnswer: null,
  };
}

function decisionOf(c: PartnerOwnerContext, questionType: IntegrityQuestion["questionType"], basis: IntegrityOwnerDecision["basis"]): IntegrityOwnerDecision {
  return { epistemic: "OWNER_DECISION", contextId: c.id, questionId: c.questionId, questionType, answerCode: c.answerCode, answerLabelHe: optionLabel(questionType, c.answerCode), answeredAt: c.answeredAt, basis,
    via: c.provenance?.source === "owner_via_claude" || c.provenance?.source === "owner_via_sunny" ? "CLAUDE" : "DASHBOARD" };
}

/** How Partner reads the ambiguity once the Owner decided. Canonical rows are never changed by it. */
export function decisionInterpretationHe(questionType: IntegrityQuestion["questionType"], answerCode: string, label: string | null): string {
  const who = label ?? "האמן";
  if (questionType === "INTEGRITY_LABEL_PROJECT_CLASSIFICATION") {
    switch (answerCode) {
      case "LABEL_SONGS": return `הבעלים קבע: הפרויקטים של ${who} שמסומנים 'לקוח' הם עבודת לייבל. כך אני מתייחס אליהם — הסימון במערכת לא שונה.`;
      case "CLIENT_WORK": return `הבעלים קבע: אלה עבודות לקוח, למרות ש${who} חתום בלייבל. הסימון 'לקוח' תואם את כוונת הבעלים.`;
      case "MIXED": return `הבעלים קבע: ל${who} יש גם עבודות לייבל וגם עבודות לקוח. אני לא מסווג פרויקטים בעצמי, ואשאל על פרויקט מסוים רק כשזה ישנה החלטה.`;
      default: return `הבעלים עוד לא החליט איך להתייחס לפרויקטים של ${who}. לא אשאל שוב כל עוד העובדות לא משתנות.`;
    }
  }
  switch (answerCode) {
    case "SAME_PERSON": return `הבעלים קבע: הרשומות בשם "${label ?? ""}" הן אותו אדם (רשומה כפולה). לא איחדתי שום רשומה.`;
    case "DIFFERENT_PEOPLE": return `הבעלים קבע: אלה אנשים שונים עם אותו שם — הקישור לפי שם נשאר עמום עד שיהיה קישור מפורש.`;
    default: return `הבעלים עוד לא החליט אם הרשומות בשם "${label ?? ""}" הן אותו אדם. לא אשאל שוב כל עוד העובדות לא משתנות.`;
  }
}

/** Applies an ACTIVE Owner answer to its finding: the Owner decided it; nothing canonical changes. */
function applyAnswer(f: IntegrityFinding, decision: IntegrityOwnerDecision, label: string | null): IntegrityFinding {
  const evidence = [...f.evidence, { source: "Owner Context (partner_owner_context)", fact: decision.basis === "EXACT_FACTS" ? "the Owner's answer for these exact facts" : "the Owner's standing definition for this subject", value: { answerCode: decision.answerCode, answeredAt: decision.answeredAt } }];
  const text = decisionInterpretationHe(decision.questionType, decision.answerCode, label);
  if (decision.answerCode === "UNKNOWN") return { ...f, evidence, ownerDecision: decision, ownerInputRequired: false, interpretationHe: `${f.interpretationHe} ${text}` };
  const mixed = decision.answerCode === "MIXED";
  return { ...f, evidence, ownerDecision: decision, stance: "OWNER_DECIDED", epistemic: "OWNER_DECISION", ownerInputRequired: false, severity: mixed ? f.severity : "LOW", interpretationHe: text };
}

export function buildCompanyIntegrityRegister(input: IntegrityRegisterInput): CompanyIntegrityRegister {
  const observedAt = input.now.toISOString();
  const drafts = DETECTORS.flatMap((d) => d(input));
  const answersAvailable = input.ownerContexts !== null;
  const active = (input.ownerContexts ?? []).filter((c) => isIntegrityQuestionType(c.questionType));

  const findings: IntegrityFinding[] = [];
  const candidates: IntegrityQuestion[] = [];
  const answered: CompanyIntegrityRegister["answeredQuestions"] = [];
  const learned: IntegrityLearnedDecision[] = [];
  const seenQuestionIds = new Set<string>();

  for (const d of drafts) {
    const { question: dq, ...rest } = d;
    let finding: IntegrityFinding = { ...rest, questionId: null, ownerDecision: null, observedAt, freshness: "LIVE" };
    if (dq) {
      const q = buildQuestion(d);
      seenQuestionIds.add(q.questionId);
      const latest = active.filter((c) => c.questionId === q.questionId).sort((a, b) => b.answeredAt.localeCompare(a.answeredAt) || b.id.localeCompare(a.id))[0];
      const learn = (decision: IntegrityOwnerDecision, c: PartnerOwnerContext, status: IntegrityLearnedDecision["status"], interpretationHe: string) =>
        learned.push({ entityKey: `${q.subject.type}:${q.subject.id}`, subjectLabel: q.subject.label, decision, askedHe: c.questionTextHe, status, interpretationHe });

      if (latest && latest.caseFactsFingerprint === q.fingerprint) {
        const decision = decisionOf(latest, q.questionType, "EXACT_FACTS");
        finding = applyAnswer(finding, decision, q.subject.label);
        answered.push({ questionId: q.questionId, answerCode: latest.answerCode, contextId: latest.id });
        learn(decision, latest, "APPLIES", finding.interpretationHe);
      } else if (latest && latest.answerCode === "MIXED" && q.questionType === "INTEGRITY_LABEL_PROJECT_CLASSIFICATION") {
        // A standing definition about the artist: new / changed projects do not make it wrong, and never trigger per-project questions.
        const decision = decisionOf(latest, q.questionType, "DEFINITION");
        finding = applyAnswer(finding, decision, q.subject.label);
        answered.push({ questionId: q.questionId, answerCode: latest.answerCode, contextId: latest.id });
        learn(decision, latest, "APPLIES", `${finding.interpretationHe} (הפרויקטים השתנו מאז התשובה — ההגדרה עדיין חלה.)`);
      } else {
        if (latest) {
          const prev = decisionOf(latest, q.questionType, "EXACT_FACTS");
          learn(prev, latest, "FACTS_CHANGED", `הנתונים השתנו מאז שהבעלים ענה "${prev.answerLabelHe}" — התשובה נשמרת כהיסטוריה ולא מופעלת אוטומטית על העובדות החדשות.`);
        }
        const withPrev: IntegrityQuestion = latest
          ? { ...q, previousAnswer: { contextId: latest.id, answerCode: latest.answerCode, answerLabelHe: optionLabel(q.questionType, latest.answerCode), answeredAt: latest.answeredAt } }
          : q;
        if (!dq.affectsCurrentConclusion) {
          finding = { ...finding, ownerInputRequired: false, interpretationHe: `${finding.interpretationHe} זה לא משפיע כרגע על עבודה פעילה — לא אשאל על זה עכשיו.` };
        } else if (answersAvailable) {
          candidates.push(withPrev);
          finding = { ...finding, stance: "NEEDS_OWNER", ownerInputRequired: true, questionId: q.questionId };
        } else {
          // Owner answers unreadable: never ask (the question might already be answered) — the ambiguity stays visible.
          finding = { ...finding, ownerInputRequired: true };
        }
      }
    }
    findings.push(finding);
  }

  // Live facts win: an active answer whose ambiguity no longer exists in canonical data stays history only.
  const labelOf = (subjectType: string, subjectId: string) =>
    subjectType === "label-artist" ? input.state?.domains.labelArtists.data?.items.find((a) => a.id === subjectId)?.name ?? null : null;
  for (const c of active) {
    if (seenQuestionIds.has(c.questionId) || !isIntegrityQuestionType(c.questionType)) continue;
    learned.push({
      entityKey: `${c.subjectType}:${c.subjectId}`, subjectLabel: labelOf(c.subjectType, c.subjectId), decision: decisionOf(c, c.questionType, "EXACT_FACTS"),
      askedHe: c.questionTextHe, status: "NO_LONGER_AMBIGUOUS",
      interpretationHe: "הנתונים החיים כבר לא מראים את אי-ההתאמה — אני הולך לפי הנתונים. התשובה נשמרת כהיסטוריה.",
    });
  }

  findings.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || a.type.localeCompare(b.type) || a.subject.key.localeCompare(b.subject.key));
  candidates.sort((a, b) => b.priority - a.priority || a.questionId.localeCompare(b.questionId));
  const questions = candidates.slice(0, MAX_INTEGRITY_QUESTIONS);
  const surfaced = new Set(questions.map((q) => q.questionId));
  // A deferred question's finding still needs the Owner — but it is not "asked" now: point only surfaced ones at a question.
  for (const f of findings) if (f.questionId && !surfaced.has(f.questionId)) f.questionId = null;
  learned.sort((a, b) => a.entityKey.localeCompare(b.entityKey) || a.decision.questionId.localeCompare(b.decision.questionId));

  const summary: Record<IntegrityStance, number> = { KNOWN: 0, DERIVED: 0, OWNER_DECIDED: 0, CONFLICT: 0, UNKNOWN: 0, NEEDS_OWNER: 0 };
  for (const f of findings) summary[f.stance]++;

  const sources: IntegritySourceStatus[] = [
    { source: "company-state (Partner Eyes)", status: input.state ? "OK" : "UNAVAILABLE" },
    { source: "finance-raw (Finance Brain read)", status: input.finance ? "OK" : "UNAVAILABLE" },
    { source: "organizational-memory", status: input.memory ? "OK" : "UNAVAILABLE" },
    { source: "owner-context", status: answersAvailable ? "OK" : "UNAVAILABLE" },
    { source: "integrity-extras (red_films_productions, meetings)", status: input.extras?.redFilmsProductions && input.extras.meetings ? "OK" : "UNAVAILABLE" },
  ];

  return {
    schemaVersion: INTEGRITY_SCHEMA_VERSION, observedAt,
    definitionsApplied: OWNER_COMPANY_DEFINITIONS.map((d) => d.id),
    sources, findings, questions, deferredQuestions: candidates.length - questions.length, answeredQuestions: answered, learned, summary,
  };
}

/**
 * How Partner interprets a roster artist's projects right now: live facts first, then the Owner's active decision.
 * Never a per-project classification Partner made up.
 */
export function labelProjectInterpretation(register: CompanyIntegrityRegister, labelArtistId: string):
  | { basis: "LIVE_FACTS"; textHe: string }
  | { basis: "OWNER_DECISION"; decision: IntegrityOwnerDecision; textHe: string }
  | { basis: "UNRESOLVED"; textHe: string } {
  const f = register.findings.find((x) => x.type === "LABEL_PROJECT_CLASSIFICATION_MISMATCH" && x.subject.key === `label-artist:${labelArtistId}`);
  if (!f) return { basis: "LIVE_FACTS", textHe: "הסימון של הפרויקטים תואם את רשימת אמני הלייבל — אני הולך לפי הנתונים." };
  if (f.ownerDecision && f.ownerDecision.answerCode !== "UNKNOWN") return { basis: "OWNER_DECISION", decision: f.ownerDecision, textHe: f.interpretationHe };
  return { basis: "UNRESOLVED", textHe: f.interpretationHe };
}
