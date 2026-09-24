/**
 * Redbloods Partner — the ONE composition of the Finance view (F2.11). Pure, deterministic, no I/O.
 *
 *   facts (raw) + the Owner's ACTIVE finance answers → state + integrity
 *
 * 1. The Finance Brain runs on the canonical facts alone and integrity evaluates every answer against the
 *    questions those facts produce (fingerprint match). An outdated answer therefore never closes anything.
 * 2. Receivables whose CURRENT answer commercially closes them (PROJECT_CANCELLED_NO_FURTHER_PAYMENT) are
 *    passed back to the Brain as an Owner overlay: they become NOT_COLLECTIBLE (no active receivable,
 *    collection queue, due date, reminder or expected income) with ownerClosure = CANONICAL_DATA_NOT_RECONCILED.
 * 3. Integrity is re-derived on the overlaid state (the closed balance is an Owner-decision line, not a gap).
 *
 * 4. F2.11–F2.15: the Finance Action readiness model runs on the final view. The ONE missing fact of a
 *    repair the Owner already confirmed (e.g. Victor's exact payment date) is asked first — a ready repair
 *    outranks a vague historical question. Nothing here writes or executes anything.
 *
 * 5. Organizational Memory V1 (HARD RULE): every surfaced question passes the memory pre-flight
 *    (live state → active Owner Context → history → conflicts); a still-applicable known answer is never
 *    asked again. The verdicts are returned (preflight) for audit / shadow tooling.
 *
 * Realized money is identical in every pass — the overlay never touches transactions.
 */
import { FINANCE_RECEIVABLE_CLOSING_ANSWERS } from "../investigation/finance-questions";
import { buildFinanceBrain } from "./core";
import { deriveFinanceActions, financeActionNoteHe, type FinanceActionCandidate } from "./actions";
import { buildFinanceIntegrity, MAX_SURFACED_QUESTIONS, type PartnerFinanceIntegrityState } from "./integrity";
import type { FinanceOwnerAnswer } from "./owner-answers";
import { resolveKnownAnswerBeforeAsking, type KnownAnswer } from "../memory/preflight";
import type { FinanceRaw, PartnerFinanceState } from "./types";

export interface FinanceView {
  state: PartnerFinanceState;
  integrity: PartnerFinanceIntegrityState;
  /** Receivable id → closing answer code (current answers only). */
  ownerClosedReceivables: Map<string, string>;
  /** Readiness of every finance repair the Owner has answered (never executable in this phase). */
  actions: FinanceActionCandidate[];
  /** One Owner-facing line about the most important repair (business language), or null. */
  actionNoteHe: string | null;
  /** Memory pre-flight verdict for every answerable question considered (questionId → verdict). */
  preflight: Array<{ questionId: string; questionType: string; verdict: KnownAnswer }>;
}

export function deriveFinanceView(raw: FinanceRaw, now: Date, answers: readonly FinanceOwnerAnswer[] = []): FinanceView {
  const state0 = buildFinanceBrain(raw, now);
  const integrity0 = buildFinanceIntegrity(raw, state0, now, answers);
  const closed = new Map<string, string>();
  for (const i of integrity0.issues) {
    const q = i.recommendedOwnerQuestion;
    if (!i.ownerAnswer || !q || i.subjectType !== "receivable") continue;
    if ((FINANCE_RECEIVABLE_CLOSING_ANSWERS[q.questionType as keyof typeof FINANCE_RECEIVABLE_CLOSING_ANSWERS] ?? []).includes(i.ownerAnswer.answerCode)) closed.set(i.subjectId, i.ownerAnswer.answerCode);
  }
  let state = state0, integrity = integrity0;
  if (closed.size) {
    state = buildFinanceBrain(raw, now, { ownerClosedReceivables: closed });
    integrity = buildFinanceIntegrity(raw, state, now, answers);
    // The closing answers are applied through the overlay (their questions no longer exist on the overlaid facts).
    integrity.ownerAnswers.applied += closed.size;
  }
  const actions = deriveFinanceActions(raw, state, integrity, answers);
  if (actions.questions.length) {
    // A missing fact of a confirmed repair is asked first; still at most MAX_SURFACED_QUESTIONS, one per type.
    const merged = [...actions.questions, ...integrity.top.questions];
    const top = merged.filter((q, i) => merged.findIndex((x) => x.questionType === q.questionType) === i).slice(0, MAX_SURFACED_QUESTIONS);
    integrity = { ...integrity, questions: [...actions.questions, ...integrity.questions], top: { ...integrity.top, questions: top } };
  }
  // Memory pre-flight: never surface a question whose answer is already known and still applicable.
  const preflight: FinanceView["preflight"] = [];
  const verdictOf = new Map<string, KnownAnswer>();
  for (const q of integrity.questions) {
    if (!q.identity || verdictOf.has(q.identity.questionId)) continue;
    const v = resolveKnownAnswerBeforeAsking(q, { raw, answers });
    verdictOf.set(q.identity.questionId, v);
    preflight.push({ questionId: q.identity.questionId, questionType: q.questionType, verdict: v });
  }
  // Questions never generated because an ACTIVE Owner answer already covers them — recorded as prevented by memory.
  for (const a of answers) {
    if (verdictOf.has(a.questionId)) continue;
    const v: KnownAnswer = { status: "KNOWN_OWNER_DECISION", suppress: true, source: "OWNER_CONTEXT", detail: `context ${a.contextId}: ${a.answerCode}${a.answerValueYmd ? ` ${a.answerValueYmd}` : ""}` };
    verdictOf.set(a.questionId, v);
    preflight.push({ questionId: a.questionId, questionType: a.questionType, verdict: v });
  }
  const allowed = (q: (typeof integrity.questions)[number]) => !q.identity || !verdictOf.get(q.identity.questionId)?.suppress;
  if (integrity.questions.some((q) => !allowed(q))) {
    const kept = integrity.questions.filter(allowed);
    const top = integrity.top.questions.filter(allowed);
    for (const q of kept) if (top.length < MAX_SURFACED_QUESTIONS && !top.some((x) => x.questionType === q.questionType)) top.push(q);
    integrity = { ...integrity, questions: kept, top: { ...integrity.top, questions: top } };
  }
  const noteCandidate = actions.candidates.find((c) => financeActionNoteHe(c) !== null);
  return { state, integrity, ownerClosedReceivables: closed, actions: actions.candidates, actionNoteHe: financeActionNoteHe(noteCandidate), preflight };
}
