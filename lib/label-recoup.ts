import { round2 } from "./label-clips";
import type { ArtistRecoupSummary } from "./types";

/**
 * Unified per-artist recoup. Clips define the target; media (actual recouped, frozen
 * snapshots) and paid shows reduce it; expected media + unpaid shows project the rest.
 *
 * CRITICAL: every max/min cap runs HERE, per artist. Callers must NOT sum raw inputs
 * across artists and then compute recoup — that would let one artist's credit offset
 * another's balance. Sum the RETURNED (already-capped) fields instead.
 *
 * Pure/stateless: writes nothing, mutates no snapshot, offsets no prior record.
 */
export interface ArtistRecoupInput {
  clipRecoupTarget: number;          // Σ artistRecoupTarget of active clips
  mediaActualRecouped: number;       // signed recoupedTotal (frozen media snapshots)
  mediaArtistShareReceived: number;  // signed Σ artist_share_gross of received media (full share, uncapped)
  mediaExpectedArtistShare: number;  // Σ artist_share_gross of צפוי media income
  showsArtistPaid: number;           // artist share of PAID shows
  showsArtistExpected: number;       // artist share of not-yet-paid shows
}

export function computeArtistRecoup(input: ArtistRecoupInput): ArtistRecoupSummary {
  const clipRecoupTarget = round2(input.clipRecoupTarget);
  const mediaActualRecouped = round2(input.mediaActualRecouped);
  const mediaArtistShareReceived = round2(input.mediaArtistShareReceived);
  const mediaExpectedArtistShare = round2(input.mediaExpectedArtistShare);
  const showsArtistPaid = round2(input.showsArtistPaid);
  const showsArtistExpected = round2(input.showsArtistExpected);

  const actualRecouped = round2(mediaActualRecouped + showsArtistPaid);
  const expectedArtistIncome = round2(showsArtistExpected + mediaExpectedArtistShare);
  const actualRecoupBalance = Math.max(0, round2(clipRecoupTarget - actualRecouped));
  const projectedRecoup = round2(Math.min(expectedArtistIncome, actualRecoupBalance));
  const projectedRecoupBalance = round2(actualRecoupBalance - projectedRecoup);
  const artistCredit = Math.max(0, round2(actualRecouped - clipRecoupTarget));

  // Signed artist balance — the headline. Uses FULL received artist share (uncapped),
  // not the recoup-capped figure, so amounts beyond the target surface as a positive
  // balance owed to the artist. No cap: negative = still in debt to the label.
  const actualArtistIncome = round2(showsArtistPaid + mediaArtistShareReceived);
  const artistActualBalance = round2(actualArtistIncome - clipRecoupTarget);

  return {
    clipRecoupTarget, mediaActualRecouped, mediaArtistShareReceived, showsArtistPaid,
    mediaExpectedArtistShare, showsArtistExpected,
    actualRecouped, expectedArtistIncome,
    actualRecoupBalance, projectedRecoup, projectedRecoupBalance, artistCredit,
    actualArtistIncome, artistActualBalance,
  };
}
