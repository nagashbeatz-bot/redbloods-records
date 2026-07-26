/**
 * Pure decision logic behind lib/victor-presence-notify.ts — no
 * "server-only"/Supabase/push imports, testable from a plain tsx script.
 */

// Mirrors lib/steven-notify.ts's visit cooldown exactly (same existing
// pattern this feature was asked to prefer).
export const VISIT_COOLDOWN_MS = 30 * 60 * 1000;

export type VisitClaimDecision = "insert" | "cas_update" | "skip";

/** Pure: given the last-recorded visit time (or null if none yet), what
 *  should the real claim attempt? "insert" — no row exists yet (first-ever
 *  visit). "cas_update" — the cooldown has elapsed, safe to claim afresh.
 *  "skip" — still within the cooldown window. */
export function decideVisitClaim(
  existingAtIso: string | null,
  nowMs: number,
  cooldownMs: number = VISIT_COOLDOWN_MS,
): VisitClaimDecision {
  if (!existingAtIso) return "insert";
  const age = nowMs - new Date(existingAtIso).getTime();
  return age >= cooldownMs ? "cas_update" : "skip";
}
