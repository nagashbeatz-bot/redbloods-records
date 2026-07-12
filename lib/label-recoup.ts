import { round2 } from "./label-clips";
import type { ArtistRecoupSummary } from "./types";

/**
 * Unified per-artist "artist debt to label". Clips define the initial debt; the artist's
 * FULL received share (paid shows + signed received media artist-share) flows through the
 * debt first — reducing it, and only the excess becomes a balance owed to the artist.
 * Expected income (unpaid shows + צפוי media) projects the debt but never reduces it.
 *
 * The debt is derived from actualArtistIncome ONLY — NOT from the media recoup snapshots.
 * Media snapshots stay frozen (recouped/artistPayable untouched); here we read the full
 * artist_share_gross, so amounts beyond the debt correctly surface as artist credit.
 *
 * CRITICAL: every max/min cap runs HERE, per artist. Callers must NOT sum raw inputs
 * across artists and then compute — that would let one artist's credit offset another's
 * debt. Sum the RETURNED (already-capped) fields instead.
 *
 * Pure/stateless: writes nothing, mutates no snapshot, offsets no prior record.
 */
export interface ArtistRecoupInput {
  clipRecoupTarget: number;          // Σ artistRecoupTarget of active clips — the initial debt
  mediaArtistShareReceived: number;  // signed Σ artist_share_gross of received media (full share, uncapped)
  mediaExpectedArtistShare: number;  // Σ artist_share_gross of צפוי media income
  showsArtistPaid: number;           // artist share of PAID shows
  showsArtistExpected: number;       // artist share of not-yet-paid shows
}

export function computeArtistRecoup(input: ArtistRecoupInput): ArtistRecoupSummary {
  const clipRecoupTarget = round2(input.clipRecoupTarget);
  const mediaArtistShareReceived = round2(input.mediaArtistShareReceived);
  const mediaExpectedArtistShare = round2(input.mediaExpectedArtistShare);
  const showsArtistPaid = round2(input.showsArtistPaid);
  const showsArtistExpected = round2(input.showsArtistExpected);

  // All actual artist income (paid shows + full received media share) flows through the debt.
  const actualArtistIncome = round2(showsArtistPaid + mediaArtistShareReceived);
  // Amount actually applied to the debt — capped at the debt, never negative (reversals can
  // push actualArtistIncome below 0; recouped stays ≥ 0).
  const actualRecouped = round2(Math.min(clipRecoupTarget, Math.max(0, actualArtistIncome)));
  const actualRecoupBalance = round2(Math.max(0, clipRecoupTarget - actualArtistIncome));   // חוב נוכחי
  const artistCredit = round2(Math.max(0, actualArtistIncome - clipRecoupTarget));           // יתרה לזכות האמן

  const expectedArtistIncome = round2(showsArtistExpected + mediaExpectedArtistShare);
  const projectedRecoup = round2(Math.min(expectedArtistIncome, actualRecoupBalance));
  const projectedRecoupBalance = round2(Math.max(0, actualRecoupBalance - expectedArtistIncome));  // חוב צפוי

  // Signed form of the debt (negative = still owes the label; positive = credit).
  const artistActualBalance = round2(actualArtistIncome - clipRecoupTarget);

  return {
    clipRecoupTarget, mediaArtistShareReceived, showsArtistPaid,
    mediaExpectedArtistShare, showsArtistExpected,
    actualRecouped, expectedArtistIncome,
    actualRecoupBalance, projectedRecoup, projectedRecoupBalance, artistCredit,
    actualArtistIncome, artistActualBalance,
  };
}
