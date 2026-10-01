/**
 * Sunny — the Owner's approval words for the two MCP writes that are not action plans (pure, deterministic).
 *
 * partner_propose_knowledge (commit) and partner_answer_question used to write after a token / a question ref alone:
 * "only after the Owner confirmed" lived in the instructions, so a model could commit in the same turn it previewed.
 * Since 2026-10-01 (T1, Owner-approved) the server requires the Owner's words as `confirmationText` and judges them
 * with the SAME classifier the Universal Action Layer uses (lib/partner/act/approval-text.ts): an approval word, no
 * negation / hold, no change (a value or currency the read-back does not contain → APPROVAL_WITH_CHANGES).
 *
 * Honest limit: the text is relayed by the model; the server classifies the words, it cannot prove a human typed them
 * (the same boundary as the Action Layer — recorded in SECURITY_GAPS as SG_MCP_APPROVAL_TEXT_RELAYED). Only the Owner's
 * own Redbloods session is human proof. The standing-authorization phrase is never an approval here.
 */
import { classifyApprovalText } from "./act/approval-text";
import { mentionsStanding } from "./act/standing";

export const MAX_CONFIRMATION_CHARS = 500;

export type OwnerApprovalVerdict =
  | { ok: true }
  | { ok: false; code: "APPROVAL_MISSING" | "NOT_AN_APPROVAL" | "APPROVAL_WITH_CHANGES"; messageHe: string };

/**
 * @param text        the Owner's words, verbatim, as relayed by the model
 * @param readBack    every value the Owner was shown (labels, field values, amounts, dates) — repeating them is fine
 */
export function ownerApprovalVerdict(text: unknown, readBack: ReadonlyArray<string | number>): OwnerApprovalVerdict {
  const t = typeof text === "string" ? text.trim() : "";
  if (!t || t.length > MAX_CONFIRMATION_CHARS) return { ok: false, code: "APPROVAL_MISSING", messageHe: "צריך את מילות האישור של הבעלים כלשונן (confirmationText). לא נשמר דבר." };
  if (mentionsStanding(t)) return { ok: false, code: "NOT_AN_APPROVAL", messageHe: "הרשאה קבועה לא חלה כאן — צריך את האישור של הבעלים עצמו. לא נשמר דבר." };
  const v = classifyApprovalText(t, readBack.map(String));
  if (v.ok) return { ok: true };
  return v.code === "APPROVAL_WITH_CHANGES"
    ? { ok: false, code: "APPROVAL_WITH_CHANGES", messageHe: "הבעלים שינה משהו — זה לא אישור. צריך להציג שוב את הנוסח המעודכן ולקבל אישור. לא נשמר דבר." }
    : { ok: false, code: "NOT_AN_APPROVAL", messageHe: "לא זוהה אישור מפורש של הבעלים. לא נשמר דבר." };
}
