/**
 * Redbloods Partner ↔ Claude bridge — the opaque question reference (P1). Pure, no crypto, no I/O.
 *
 * A questionRef travels with every question Partner surfaces to a connector (partner_query owner_needs / integrity
 * questions, partner_entity openQuestions). It packs what the answer core needs to re-identify the question —
 * kind, question id, subject id, facts fingerprint — so the model never handles ids, fingerprints or request ids.
 *
 * It is NOT trusted and NOT a capability: the server re-derives the LIVE surfaced question and compares every field;
 * a forged, stale or foreign ref can only produce NOT_CURRENT / STALE_QUESTION, never a write of its own contents.
 */
export const QUESTION_REF_PREFIX = "pq1.";
export const QUESTION_REF_RE = /^pq1\.[A-Za-z0-9_-]{16,600}$/;

export type QuestionRefKind = "integrity" | "finance";
export interface QuestionRef { kind: QuestionRefKind; questionId: string; subjectId: string; fingerprint: string }

const KIND_CODE: Record<QuestionRefKind, string> = { integrity: "i", finance: "f" };
const HEX64 = /^[0-9a-f]{64}$/;
const CONTROL = /[\u0000-\u001f\u007f]/;

function b64urlEncode(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecode(s: string): string | null {
  try {
    const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
    return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  } catch { return null; }
}

export function encodeQuestionRef(r: QuestionRef): string {
  return QUESTION_REF_PREFIX + b64urlEncode(JSON.stringify([KIND_CODE[r.kind], r.questionId, r.subjectId, r.fingerprint]));
}

/** Strict decode: exact shape, bounded, printable; anything else → null (never a partial ref). */
export function decodeQuestionRef(ref: unknown): QuestionRef | null {
  if (typeof ref !== "string" || !QUESTION_REF_RE.test(ref)) return null;
  const json = b64urlDecode(ref.slice(QUESTION_REF_PREFIX.length));
  if (json === null) return null;
  let v: unknown;
  try { v = JSON.parse(json); } catch { return null; }
  if (!Array.isArray(v) || v.length !== 4 || !v.every((x) => typeof x === "string")) return null;
  const [k, q, s, f] = v as string[];
  const kind = k === "i" ? "integrity" : k === "f" ? "finance" : null;
  if (!kind || !q || q.length > 300 || CONTROL.test(q) || !s || s.length > 120 || CONTROL.test(s) || !HEX64.test(f)) return null;
  return { kind, questionId: q, subjectId: s, fingerprint: f };
}
