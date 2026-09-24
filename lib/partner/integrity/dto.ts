/**
 * Redbloods Partner — Company Integrity "צריך ממך" surface DTO (v1). Pure; no imports (client-safe).
 *
 * The Owner sees display text only (subject name, the ambiguity, names + statuses, the answer choices). The three
 * echo fields (questionId, subjectId, fingerprint) travel with each question so the answer POST can prove it answers
 * EXACTLY the question that was rendered — they are never displayed. No table names, schema names or raw evidence.
 * parseIntegritySurfaceResponse is strict: anything unexpected → not rendered (fail closed).
 */
export const INTEGRITY_SURFACE_VERSION = "partner-integrity-surface-v1";

export interface IntegrityQuestionDto {
  questionId: string;
  subjectId: string;
  fingerprint: string;
  subjectLabel: string;
  textHe: string;
  whyHe: string;
  evidenceHe: string[];
  options: Array<{ code: string; labelHe: string }>;
  previousAnswerHe: string | null;
}

export interface IntegrityLearnedDto { subjectLabel: string; answerLabelHe: string; statusHe: string }

export interface IntegritySurfaceDto {
  version: typeof INTEGRITY_SURFACE_VERSION;
  questions: IntegrityQuestionDto[];
  deferredCount: number;
  learned: IntegrityLearnedDto[];
}

interface RegisterLike {
  questions: Array<{ questionId: string; subject: { id: string; label: string | null }; fingerprint: string; textHe: string; whyHe: string; evidenceHe: string[]; options: Array<{ code: string; labelHe: string }>; previousAnswer: { answerLabelHe: string; answeredAt: string } | null }>;
  deferredQuestions: number;
  learned: Array<{ subjectLabel: string | null; decision: { answerLabelHe: string }; status: "APPLIES" | "FACTS_CHANGED" | "NO_LONGER_AMBIGUOUS" }>;
}

const STATUS_HE = { APPLIES: "בשימוש", FACTS_CHANGED: "הנתונים השתנו מאז — נשמר כהיסטוריה", NO_LONGER_AMBIGUOUS: "הנתונים כבר ברורים — נשמר כהיסטוריה" } as const;
const ymdHe = (iso: string) => { const d = iso.slice(0, 10).split("-"); return d.length === 3 ? `${d[2]}.${d[1]}.${d[0]}` : iso; };

export function toIntegritySurfaceDto(r: RegisterLike): IntegritySurfaceDto {
  return {
    version: INTEGRITY_SURFACE_VERSION,
    questions: r.questions.map((q) => ({
      questionId: q.questionId, subjectId: q.subject.id, fingerprint: q.fingerprint, subjectLabel: q.subject.label ?? "",
      textHe: q.textHe, whyHe: q.whyHe, evidenceHe: [...q.evidenceHe], options: q.options.map((o) => ({ code: o.code, labelHe: o.labelHe })),
      previousAnswerHe: q.previousAnswer ? `בפעם הקודמת (${ymdHe(q.previousAnswer.answeredAt)}) ענית: "${q.previousAnswer.answerLabelHe}". מאז הנתונים השתנו, אז אני שואל שוב.` : null,
    })),
    deferredCount: r.deferredQuestions,
    learned: r.learned.filter((l) => l.status !== "NO_LONGER_AMBIGUOUS" || l.subjectLabel).map((l) => ({ subjectLabel: l.subjectLabel ?? "", answerLabelHe: l.decision.answerLabelHe, statusHe: STATUS_HE[l.status] })),
  };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const exactKeys = (o: Record<string, unknown>, keys: string[]) => Object.keys(o).length === keys.length && keys.every((k) => k in o);
const str = (v: unknown, max = 2000) => typeof v === "string" && v.length <= max;
const HEX64 = /^[0-9a-f]{64}$/;
const CODE = /^[A-Z][A-Z0-9_]{1,60}$/;

function isQuestion(q: unknown): q is IntegrityQuestionDto {
  if (!isObj(q) || !exactKeys(q, ["questionId", "subjectId", "fingerprint", "subjectLabel", "textHe", "whyHe", "evidenceHe", "options", "previousAnswerHe"])) return false;
  if (!str(q.questionId, 300) || !str(q.subjectId, 120) || typeof q.fingerprint !== "string" || !HEX64.test(q.fingerprint)) return false;
  if (!str(q.subjectLabel, 200) || !str(q.textHe) || !str(q.whyHe)) return false;
  if (!Array.isArray(q.evidenceHe) || q.evidenceHe.length > 12 || !q.evidenceHe.every((e) => str(e, 300))) return false;
  if (!Array.isArray(q.options) || q.options.length < 2 || q.options.length > 6) return false;
  if (!q.options.every((o) => isObj(o) && exactKeys(o, ["code", "labelHe"]) && typeof o.code === "string" && CODE.test(o.code) && str(o.labelHe, 200))) return false;
  return q.previousAnswerHe === null || str(q.previousAnswerHe, 500);
}

export function parseIntegritySurfaceResponse(json: unknown): { ok: true; surface: IntegritySurfaceDto } | { ok: false } {
  if (!isObj(json) || !exactKeys(json, ["version", "questions", "deferredCount", "learned"]) || json.version !== INTEGRITY_SURFACE_VERSION) return { ok: false };
  if (!Array.isArray(json.questions) || json.questions.length > 2 || !json.questions.every(isQuestion)) return { ok: false };
  if (typeof json.deferredCount !== "number" || !Number.isInteger(json.deferredCount) || json.deferredCount < 0) return { ok: false };
  if (!Array.isArray(json.learned) || json.learned.length > 50 || !json.learned.every((l) => isObj(l) && exactKeys(l, ["subjectLabel", "answerLabelHe", "statusHe"]) && str(l.subjectLabel, 200) && str(l.answerLabelHe, 200) && str(l.statusHe, 200))) return { ok: false };
  return { ok: true, surface: json as unknown as IntegritySurfaceDto };
}
