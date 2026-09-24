/**
 * Redbloods Partner ↔ Claude bridge — P1: the Owner answers an EXISTING surfaced Partner question through Claude.
 * Pure core (dependencies injected); lib/partner/bridge/server.ts binds them.
 *
 * The ONLY path from a connector to Owner Context:
 *   partner_answer_question {questionRef, answer} → THIS core → the EXISTING Integrity answer core
 *   (answerIntegrityQuestionCore: live re-derivation, question id + subject + fingerprint + offered code, append-only
 *   revision) → the EXISTING validated Owner Context store.
 * The connector input can only SELECT one of the live question's closed answer codes; it can never construct an
 * Owner Context row (question text / type / case / subject / fingerprint / supersedes all come from the live question;
 * provenance is set here from the authenticated principal, never from input).
 *
 * LEARNED requires: Owner re-verified, current question re-derived, facts unchanged, code offered, row persisted, and a
 * FRESH read (new request) showing the decision applied (OWNER_DECISION) with the question gone. Anything less is a
 * typed non-LEARNED status. Finance answers are NOT wired in P1 (refused).
 */
import { sha256Hex } from "../actions/canonical";
import { INTEGRITY_ANSWER_OPTIONS, isIntegrityQuestionType } from "../investigation/integrity-questions";
import type { OwnerContextProvenance } from "../investigation/types";
import { answerIntegrityQuestionCore, type IntegrityAnswerDeps } from "../integrity/answer";
import type { CompanyIntegrityRegister } from "../integrity/types";
import { decodeQuestionRef, encodeQuestionRef } from "./ref";

export type BridgeAnswerStatus =
  | "LEARNED" | "ALREADY_ANSWERED" | "STALE_QUESTION" | "NOT_CURRENT" | "INVALID_ANSWER" | "NOT_AUTHORIZED"
  | "NOT_VERIFIED" | "FINANCE_ANSWERING_DISABLED" | "UNAVAILABLE" | "FAILED";

export interface BridgeQuestionView { questionRef: string; subject: string | null; questionHe: string; options: Array<{ code: string; label: string }> }

export interface BridgeAnswerResult {
  status: BridgeAnswerStatus;
  /** Set only for LEARNED / ALREADY_ANSWERED: what Partner holds NOW (from a fresh read). */
  recorded: { subject: string | null; questionHe: string; answerHe: string; answerCode: string; epistemic: "OWNER_DECISION"; provenance: "OWNER_VIA_CLAUDE" | "OWNER_DASHBOARD"; answeredAt: string } | null;
  /** Fixed Partner wording Claude may relay. "למדתי" only on LEARNED. */
  ownerMessageHe: string;
  /** The questions Partner surfaces now (fresh read), so Claude never works from a stale list. */
  nextQuestions: BridgeQuestionView[];
  /** true only when an Owner Context row was written by THIS call (for audit / reporting). */
  persisted: boolean;
}

export interface BridgeActor { userId: string; clientId: string; tokenId: string }

export interface BridgeDeps {
  /** Re-verifies, at answer time, that this user id is the Redbloods Owner. Fail closed (false on any doubt). */
  isOwner(userId: string): Promise<boolean>;
  /** The existing Integrity answer dependencies, carrying the given provenance (shared ledger, same store). */
  integrityDeps(provenance: OwnerContextProvenance): IntegrityAnswerDeps;
  /** A brand-new read (new request context) of the register; null when it cannot be read. */
  freshRegister(): Promise<CompanyIntegrityRegister | null>;
}

const CODE_RE = /^[A-Z][A-Z0-9_]{1,40}$/;

/** Deterministic request id: a retry / double submit / second chat with the same answer to the same facts is the SAME request. */
export function bridgeRequestId(userId: string, questionId: string, answer: string, fingerprint: string): string {
  const h = sha256Hex(`partner-answer-v1|${userId}|${questionId}|${answer}|${fingerprint}`);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

export function questionViews(reg: CompanyIntegrityRegister | null): BridgeQuestionView[] {
  return (reg?.questions ?? []).map((q) => ({
    questionRef: encodeQuestionRef({ kind: "integrity", questionId: q.questionId, subjectId: q.subject.id, fingerprint: q.fingerprint }),
    subject: q.subject.label, questionHe: q.textHe, options: q.options.map((o) => ({ code: o.code, label: o.labelHe })),
  }));
}

function recordedFrom(reg: CompanyIntegrityRegister, questionId: string, contextId: string | null): BridgeAnswerResult["recorded"] {
  const l = reg.learned.find((x) => x.decision.questionId === questionId && x.status === "APPLIES" && (!contextId || x.decision.contextId === contextId));
  if (!l) return null;
  return { subject: l.subjectLabel, questionHe: l.askedHe, answerHe: l.decision.answerLabelHe, answerCode: l.decision.answerCode, epistemic: "OWNER_DECISION",
    provenance: l.decision.via === "CLAUDE" ? "OWNER_VIA_CLAUDE" : "OWNER_DASHBOARD", answeredAt: l.decision.answeredAt };
}

/** Fresh-read verification: the new row is applied, visible as OWNER_DECISION, and the question is gone for these facts. */
export function verifiedInRegister(reg: CompanyIntegrityRegister, questionId: string, contextId: string): boolean {
  const applied = reg.answeredQuestions.some((a) => a.questionId === questionId && a.contextId === contextId);
  const decision = reg.findings.some((f) => f.ownerDecision?.contextId === contextId && f.ownerDecision.epistemic === "OWNER_DECISION");
  const learned = reg.learned.some((l) => l.decision.contextId === contextId && l.status === "APPLIES");
  return applied && decision && learned && !reg.questions.some((q) => q.questionId === questionId);
}

const learnedMessage = (subject: string | null, questionType: string) =>
  questionType === "INTEGRITY_LABEL_PROJECT_CLASSIFICATION" && subject ? `למדתי. אשתמש בזה כשאני מנתח את הפרויקטים של ${subject}.` : "למדתי. שמרתי את זה כהחלטה שלך.";

export async function answerViaConnectorCore(deps: BridgeDeps, i: { questionRef: unknown; answer: unknown; actor: BridgeActor; attemptAuditId: string }): Promise<BridgeAnswerResult> {
  const out = (status: BridgeAnswerStatus, ownerMessageHe: string, reg: CompanyIntegrityRegister | null, recorded: BridgeAnswerResult["recorded"] = null, persisted = false): BridgeAnswerResult =>
    ({ status, recorded, ownerMessageHe, nextQuestions: questionViews(reg), persisted });
  const ref = decodeQuestionRef(i.questionRef);
  if (!ref) return out("NOT_CURRENT", "השאלה הזו לא מזוהה. בקש מ־Partner את השאלות הנוכחיות.", null);
  if (ref.kind === "finance") return out("FINANCE_ANSWERING_DISABLED", "תשובות לשאלות כספים עדיין נענות רק בלוח הבקרה של Redbloods.", null);
  const type = ref.questionId.slice(ref.questionId.lastIndexOf("::") + 2);
  if (!isIntegrityQuestionType(type)) return out("NOT_CURRENT", "השאלה הזו לא מזוהה. בקש מ־Partner את השאלות הנוכחיות.", null);
  if (typeof i.answer !== "string" || !CODE_RE.test(i.answer) || !INTEGRITY_ANSWER_OPTIONS[type].some((o) => o.code === i.answer)) {
    return out("INVALID_ANSWER", "זו לא אחת מהתשובות האפשריות לשאלה. שאל את הבעלים שוב עם האפשרויות של Partner.", await deps.freshRegister().catch(() => null));
  }
  let owner = false;
  try { owner = await deps.isOwner(i.actor.userId); } catch { owner = false; }
  if (!owner) return out("NOT_AUTHORIZED", "רק הבעלים של Redbloods יכול לענות על שאלות של Partner.", null);

  const provenance: OwnerContextProvenance = { source: "owner_via_claude", channel: "mcp", client_id: i.actor.clientId, token_id: i.actor.tokenId, attempt_audit_id: i.attemptAuditId };
  const r = await answerIntegrityQuestionCore(deps.integrityDeps(provenance), i.actor.userId, {
    questionId: ref.questionId, subjectId: ref.subjectId, answerCode: i.answer, seenQuestionFingerprint: ref.fingerprint,
    requestId: bridgeRequestId(i.actor.userId, ref.questionId, i.answer, ref.fingerprint),
  });
  const fresh = await deps.freshRegister().catch(() => null);
  switch (r.status) {
    case "ANSWER_SAVED": {
      if (r.learned && fresh && verifiedInRegister(fresh, ref.questionId, r.contextId)) {
        const rec = recordedFrom(fresh, ref.questionId, r.contextId);
        return out("LEARNED", learnedMessage(rec?.subject ?? null, type), fresh, rec, true);
      }
      return out("NOT_VERIFIED", "התשובה נשלחה, אבל עוד לא הצלחתי לוודא ש־Partner משתמש בה. אל תסתמך עליה עדיין — בדוק בלוח הבקרה.", fresh, null, true);
    }
    case "REPLAY":
      return out("ALREADY_ANSWERED", "התשובה הזו כבר רשומה אצל Partner.", fresh, fresh ? recordedFrom(fresh, ref.questionId, null) : null);
    case "STALE_QUESTION": {
      if (fresh?.answeredQuestions.some((a) => a.questionId === ref.questionId)) {
        return out("ALREADY_ANSWERED", "כבר יש תשובה לשאלה הזו עבור אותן עובדות. שינוי תשובה קיימת עוד לא נתמך.", fresh, recordedFrom(fresh, ref.questionId, null));
      }
      if (fresh?.questions.some((q) => q.questionId === ref.questionId)) return out("STALE_QUESTION", "הנתונים השתנו מאז שהשאלה הוצגה. הנה השאלה העדכנית.", fresh);
      return out("NOT_CURRENT", "Partner כבר לא שואל את השאלה הזו כרגע.", fresh);
    }
    case "INVALID_INPUT": return out("NOT_CURRENT", "השאלה הזו לא תואמת לשאלות הנוכחיות של Partner.", fresh);
    case "LIVE_READ_FAILED": return out("UNAVAILABLE", "לא הצלחתי לקרוא את המצב הנוכחי. לא נשמר דבר — נסה שוב בעוד רגע.", fresh);
    default: return out("FAILED", "התשובה לא נשמרה. לא נשמר דבר — אפשר לנסות שוב או לענות בלוח הבקרה.", fresh);
  }
}
