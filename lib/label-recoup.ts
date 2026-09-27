import type { ArtistRecoupSummary } from "./types";
import { CLIP_RECOUP_NOT_DEFINED_HE } from "./clip-rf-money-pure";

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Unified per-artist "artist debt to label". The CLIP part of the debt (D) comes ONLY from the specific artist
 * agreement (lib/label-agreements, Owner decision 2026-09-27): for שליו טסמה / אבי מולה the target is the artist's share
 * funded by the label (50 % of the ACTUAL PAID ₪ clip cost); for any other artist callers pass clipRecoupTarget = null
 * (NOT_DEFINED) and every debt figure is null with the Hebrew reason — never 50 % of the budget, never the price.
 * The artist's income figures (paid shows + signed received media artist-share; expected shows + צפוי media) are
 * computed as before and stay visible.
 *
 * When a target IS defined (a future recorded agreement rule), the artist's FULL received share flows through the debt
 * first — reducing it, and only the excess becomes a balance owed to the artist. Expected income projects the debt but
 * never reduces it. The debt is derived from actualArtistIncome ONLY — NOT from the media recoup snapshots.
 *
 * CRITICAL: every max/min cap runs HERE, per artist. Callers must NOT sum raw inputs across artists and then compute —
 * that would let one artist's credit offset another's debt. Sum the RETURNED (already-capped) fields instead, and a null
 * in any artist makes the roll-up null.
 *
 * Pure/stateless: writes nothing, mutates no snapshot, offsets no prior record.
 */
export interface ArtistRecoupInput {
  /** D — the artist's clip share funded by the label (שליו / אבי); null = NOT_DEFINED (every other artist). */
  clipRecoupTarget: number | null;
  mediaArtistShareReceived: number;  // signed Σ artist_share_gross of received media (full share, uncapped)
  mediaExpectedArtistShare: number;  // Σ artist_share_gross of צפוי media income
  showsArtistPaid: number;           // artist share of PAID shows
  showsArtistExpected: number;       // artist share of not-yet-paid shows
  /** A / B / C per currency — information only (lib/label-clips artistClipMoney). */
  clipMoneyInfo?: ArtistRecoupSummary["clipMoneyInfo"];
}

export function computeArtistRecoup(input: ArtistRecoupInput): ArtistRecoupSummary {
  const mediaArtistShareReceived = round2(input.mediaArtistShareReceived);
  const mediaExpectedArtistShare = round2(input.mediaExpectedArtistShare);
  const showsArtistPaid = round2(input.showsArtistPaid);
  const showsArtistExpected = round2(input.showsArtistExpected);

  // All actual artist income (paid shows + full received media share).
  const actualArtistIncome = round2(showsArtistPaid + mediaArtistShareReceived);
  const expectedArtistIncome = round2(showsArtistExpected + mediaExpectedArtistShare);
  const base = { mediaArtistShareReceived, showsArtistPaid, mediaExpectedArtistShare, showsArtistExpected, actualArtistIncome, expectedArtistIncome, clipMoneyInfo: input.clipMoneyInfo ?? {} };

  if (input.clipRecoupTarget === null || !Number.isFinite(input.clipRecoupTarget)) {
    return {
      ...base, clipRecoupTarget: null, clipRecoupStatus: "NOT_DEFINED", clipRecoupReasonHe: CLIP_RECOUP_NOT_DEFINED_HE,
      actualRecouped: null, actualRecoupBalance: null, projectedRecoup: null, projectedRecoupBalance: null, artistCredit: null, artistActualBalance: null,
    };
  }

  const clipRecoupTarget = round2(input.clipRecoupTarget);
  // Amount actually applied to the debt — capped at the debt, never negative (reversals can
  // push actualArtistIncome below 0; recouped stays ≥ 0).
  const actualRecouped = round2(Math.min(clipRecoupTarget, Math.max(0, actualArtistIncome)));
  const actualRecoupBalance = round2(Math.max(0, clipRecoupTarget - actualArtistIncome));   // חוב נוכחי
  const artistCredit = round2(Math.max(0, actualArtistIncome - clipRecoupTarget));           // יתרה לזכות האמן
  const projectedRecoup = round2(Math.min(expectedArtistIncome, actualRecoupBalance));
  const projectedRecoupBalance = round2(Math.max(0, actualRecoupBalance - expectedArtistIncome));  // חוב צפוי
  // Signed form of the debt (negative = still owes the label; positive = credit).
  const artistActualBalance = round2(actualArtistIncome - clipRecoupTarget);

  return {
    ...base, clipRecoupTarget, clipRecoupStatus: "DEFINED", clipRecoupReasonHe: null,
    actualRecouped, actualRecoupBalance, projectedRecoup, projectedRecoupBalance, artistCredit, artistActualBalance,
  };
}
