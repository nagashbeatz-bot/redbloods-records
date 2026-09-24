/**
 * Redbloods Partner — Company Integrity Register assembly. Pure, deterministic (now injected).
 *
 * Runs every detector over one consistent read, then applies the Owner's ACTIVE Owner Context answers:
 *   - an answer for the SAME questionId and the SAME facts fingerprint suppresses the question forever
 *     (UNKNOWN included — "לא יודע" for unchanged facts is not re-asked);
 *   - an answer for CHANGED facts is shown as the previous answer and the question is asked again;
 *   - at most MAX_INTEGRITY_QUESTIONS questions are surfaced (highest priority first), the rest are counted.
 * Findings are derived live, never persisted, never written anywhere.
 */
import { questionIdFor, answerOptionsFor } from "../investigation/questions";
import { INTEGRITY_CASE_PREFIX } from "../investigation/integrity-questions";
import type { PartnerOwnerContext } from "../investigation/types";
import { DETECTORS, fingerprintOf, type FindingDraft, type IntegrityInput } from "./detectors";
import { OWNER_COMPANY_DEFINITIONS } from "./definitions";
import {
  INTEGRITY_SCHEMA_VERSION, MAX_INTEGRITY_QUESTIONS,
  type CompanyIntegrityRegister, type IntegrityFinding, type IntegrityQuestion, type IntegritySourceStatus, type IntegrityStance,
} from "./types";

export interface IntegrityRegisterInput extends IntegrityInput {
  /** ACTIVE (CURRENT_APPLICABLE) Owner Context answers; null = unreadable (then NO question is surfaced — fail closed). */
  ownerContexts: readonly PartnerOwnerContext[] | null;
}

const SEVERITY_RANK = { HIGH: 0, MEDIUM: 1, LOW: 2 } as const;

/** The deterministic Case id of an integrity question (the Owner Context case_id). */
export const integrityCaseId = (questionType: string, subjectId: string) => `${INTEGRITY_CASE_PREFIX}${questionType}:${subjectId}`;

function buildQuestion(d: FindingDraft): IntegrityQuestion {
  const q = d.question!;
  const caseId = integrityCaseId(q.type, q.subjectId);
  const options = answerOptionsFor(q.type).map((o) => ({ code: o.code, labelHe: o.labelHe }));
  return {
    questionId: questionIdFor(caseId, q.type), caseId, questionType: q.type,
    subject: { type: q.subjectType, id: q.subjectId, label: q.subjectLabel },
    textHe: q.textHe, whyHe: q.whyHe, options,
    fingerprint: fingerprintOf({ v: INTEGRITY_SCHEMA_VERSION, type: q.type, subject: [q.subjectType, q.subjectId], facts: q.facts, options: options.map((o) => o.code) }),
    priority: q.priority, previousAnswer: null,
  };
}

/** Applies an ACTIVE Owner answer (same facts) to its finding: the Owner decided it; nothing canonical changes. */
function applyAnswer(f: IntegrityFinding, q: IntegrityQuestion, answerCode: string): IntegrityFinding {
  const label = q.options.find((o) => o.code === answerCode)?.labelHe ?? answerCode;
  const evidence = [...f.evidence, { source: "Owner Context (partner_owner_context)", fact: "the Owner's answer for these exact facts", value: { questionId: q.questionId, answerCode } }];
  if (answerCode === "UNKNOWN") {
    return { ...f, evidence, ownerInputRequired: false, interpretationHe: `${f.interpretationHe} הבעלים ענה "לא יודע כרגע" — לא נשאל שוב כל עוד העובדות לא משתנות.` };
  }
  const mixed = answerCode === "MIXED";
  return {
    ...f, evidence, stance: "OWNER_DECIDED", epistemic: "OWNER_DECISION", ownerInputRequired: false,
    severity: mixed ? f.severity : "LOW",
    interpretationHe: `הבעלים הגדיר: "${label}". ${mixed ? "ההחלטה לכל פרויקט נשארת פתוחה; " : ""}הנתונים הקנוניים לא שונו — ההגדרה חלה רק כל עוד העובדות האלה לא משתנות.`,
  };
}

export function buildCompanyIntegrityRegister(input: IntegrityRegisterInput): CompanyIntegrityRegister {
  const observedAt = input.now.toISOString();
  const drafts = DETECTORS.flatMap((d) => d(input));
  const answersAvailable = input.ownerContexts !== null;
  const active = input.ownerContexts ?? [];

  const findings: IntegrityFinding[] = [];
  const candidates: IntegrityQuestion[] = [];
  const answered: CompanyIntegrityRegister["answeredQuestions"] = [];

  for (const d of drafts) {
    const { question: _q, ...rest } = d;
    let finding: IntegrityFinding = { ...rest, questionId: null, observedAt, freshness: "LIVE" };
    if (d.question) {
      const q = buildQuestion(d);
      const forQuestion = active.filter((c) => c.questionId === q.questionId);
      const same = forQuestion.find((c) => c.caseFactsFingerprint === q.fingerprint);
      if (same) {
        finding = applyAnswer(finding, q, same.answerCode);
        answered.push({ questionId: q.questionId, answerCode: same.answerCode, contextId: same.id });
      } else if (answersAvailable) {
        const prev = [...forQuestion].sort((a, b) => b.answeredAt.localeCompare(a.answeredAt))[0];
        const withPrev = { ...q, previousAnswer: prev ? { contextId: prev.id, answerCode: prev.answerCode } : null };
        candidates.push(withPrev);
        finding = { ...finding, stance: "NEEDS_OWNER", ownerInputRequired: true, questionId: q.questionId };
      } else {
        // Owner answers unreadable: never ask (the question might already be answered) — the ambiguity stays visible.
        finding = { ...finding, ownerInputRequired: true };
      }
    }
    findings.push(finding);
  }

  findings.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || a.type.localeCompare(b.type) || a.subject.key.localeCompare(b.subject.key));
  candidates.sort((a, b) => b.priority - a.priority || a.questionId.localeCompare(b.questionId));
  const questions = candidates.slice(0, MAX_INTEGRITY_QUESTIONS);
  const surfaced = new Set(questions.map((q) => q.questionId));
  // A deferred question's finding still needs the Owner — but it is not "asked" now: point only surfaced ones at a question.
  for (const f of findings) if (f.questionId && !surfaced.has(f.questionId)) f.questionId = null;

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
    sources, findings, questions, deferredQuestions: candidates.length - questions.length, answeredQuestions: answered, summary,
  };
}
