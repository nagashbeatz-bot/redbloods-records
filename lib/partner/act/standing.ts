/**
 * SUNNY UNIVERSAL ACTION LAYER — STANDING AUTHORIZATION (Owner decision 2026-09-30). Pure.
 *
 * The ONE exception to "every write needs the Boss's explicit approval of the exact preview": Sunny may approve, with the
 * fixed phrase below instead of the Boss's words, a plan made ONLY of Owner-inbox housekeeping — marking a "עדכון לסאני"
 * item handled AFTER the handling itself is complete. It never approves a business action: a plan with ANY other step
 * is not eligible and needs the Boss's normal approval. The list is locked to one primitive (a test pins it).
 *
 * Everything else is unchanged: the plan hash binding, expiry, one-time nonce, the fresh re-read / stale check and the
 * exact verification. The approval kind is carried inside the HMAC-bound token and re-checked by the engine, and it is
 * recorded distinctly (the APPROVED event's detail) so plan_status / history always say who approved: the Owner or the
 * standing authorization.
 */
export const STANDING_AUTHORIZATIONS: readonly string[] = ["MARK_OWNER_INBOX_ITEM"];
/** The exact text Sunny relays as the approval of an eligible plan (never the Boss's words). */
export const STANDING_PHRASE = "STANDING:OWNER_INBOX_HOUSEKEEPING";
export const STANDING_EVENT_DETAIL = "STANDING_AUTHORIZATION:OWNER_INBOX_HOUSEKEEPING (Owner decision 2026-09-30)";
export const OWNER_EVENT_DETAIL = "OWNER_APPROVAL: owner approval verified";
export type ApprovedBy = "OWNER_APPROVAL" | "STANDING_AUTHORIZATION";

/** Eligible only when EVERY step is a standing-authorized primitive (a mixed plan never is). */
export function standingEligible(plan: { steps: ReadonlyArray<{ actionId: string }> }): boolean {
  return plan.steps.length > 0 && plan.steps.every((s) => STANDING_AUTHORIZATIONS.includes(s.actionId));
}
/** Any text that tries to use the standing phrase (even inside other words) — only the exact phrase on an eligible plan counts. */
export const mentionsStanding = (text: string) => /STANDING\s*:/i.test(text);

/** Who approved, from the recorded APPROVED event detail (a pre-2026-09-30 detail is the Owner's approval). */
export function approvedByOf(detail: string | null | undefined): ApprovedBy | null {
  if (typeof detail !== "string") return null;
  return detail.startsWith("STANDING_AUTHORIZATION") ? "STANDING_AUTHORIZATION" : "OWNER_APPROVAL";
}
