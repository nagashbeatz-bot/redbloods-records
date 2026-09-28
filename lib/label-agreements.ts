/**
 * LABEL ARTIST AGREEMENTS — the ONE rule layer for "who carries which cost / which share" between a label artist and
 * the label (Owner decision 2026-09-27, FINAL). Pure: no I/O, safe for client components, server code, Sunny and tests.
 *
 * SCOPE: the rules below apply ONLY to שליו טסמה and אבי מולה (their stable label_artists ids). No other artist — roster
 * or not, present or future — inherits them: every other artist is NOT_DEFINED (never inferred, never "like Shalev").
 *
 *   Production / Mix / Master  100 % label, 0 % artist   (a real Redbloods cost that creates NO artist balance)
 *   Show                        50 / 50 of the NET show profit: revenue − direct show expenses (the app's own
 *                               computeShowSplit: DJ fee + counted rehearsals are the recorded direct expenses)
 *   Media income                50 / 50 of the income (artist / label) — INCOME, never a repayment of a specific clip
 *   Every other REAL Records expense (clip, promotion, photo, distribution, PR, vendor …) — Owner decision 2026-09-28
 *   (task 6), superseding the 2026-09-27 "clip only, anything else NOT_DEFINED": the ONE rule lib/records-expense-share
 *   (by the project's credits: one Records artist 50 / 50, Shalev + Avi 50 / 25 / 25, NagashBeatz 100 % Records, a
 *   Records artist next to an external party UNDEFINED; Owner exceptions win). This file no longer allocates expenses.
 *
 * ACCOUNTING = the BI-MONTHLY CYCLE (Owner model 2026-09-27): the artist ledger holds the artist's income (show share,
 * media share), expenses (e.g. the clip share the Owner recorded) and payments; at each cycle end the whole picture meets
 * in the CYCLE BALANCE (the app's own cycles, lib/artist-balance-cycles-store). There is NO recoup mechanism: no media
 * income repays a specific clip unless an explicit Owner link says so (none is recorded). The ledger amount the Owner
 * recorded is the accounting record (it may differ slightly from the derived share — that is not a conflict).
 *
 * THREE DIFFERENT QUESTIONS, never merged (B, Owner 2026-09-27):
 *   cashOut                   what Redbloods actually paid (Finance cash truth — unchanged by any allocation)
 *   labelShare                the label's ECONOMIC share of that cost
 *   artistShare               the artist's economic share of that cost
 *   artistShareFundedByLabel  the part of the artist's share Redbloods paid for the artist — an artist EXPENSE in the
 *                             cycle accounting (the ledger), never "label investment" and never tied to a specific income.
 *
 * Currencies are never added or converted: every total is per currency.
 */
import { OWNER_LABEL_REGISTERED_ROSTER, projectArtistTokens } from "./project-classification";
import { computeShowSplit } from "./shows-types";

export const AGREEMENT_RULES_VERSION = "2026-09-27";

/** Cost categories that are 100 % label (no artist share). Every other Records expense: lib/records-expense-share. */
export type AgreementCostCategory = "PRODUCTION" | "MIX_MASTER";
export interface CostRule { labelPct: number; artistPct: number; basisHe: string }
export const AGREEMENT_COST_RULES: Readonly<Record<AgreementCostCategory, CostRule>> = {
  PRODUCTION: { labelPct: 100, artistPct: 0, basisHe: "הפקה מוזיקלית — 100% על חשבון הלייבל" },
  MIX_MASTER: { labelPct: 100, artistPct: 0, basisHe: "מיקס / מאסטר — 100% על חשבון הלייבל" },
};
export const AGREEMENT_SHOW_RULE = { artistPct: 50, labelPct: 50, basisHe: "הופעה — 50/50 מהרווח הנקי: הכנסה פחות הוצאות ישירות (DJ + חזרות שנספרות)" } as const;
export const AGREEMENT_MEDIA_RULE = { artistPct: 50, labelPct: 50, basisHe: "הכנסות מדיה — 50% אמן / 50% לייבל מההכנסה; הכנסה, לא החזר של קליפ מסוים" } as const;
/** The accounting model, stated once (served by Sunny and shown where a clip "recoup" used to be). */
export const AGREEMENT_CYCLE_ACCOUNTING_HE = "אין קיזוז ייעודי לקליפ: חלק האמן בקליפ הוא הוצאה במאזן האמן, וההתחשבנות מתבצעת במחזור של חודשיים — הכנסות (הופעות, מדיה), הוצאות ותשלומים נפגשים ביתרת המחזור.";
/**
 * The media-income RPC's p_recoup_target. Owner model 2026-09-27: media income is a 50 / 50 INCOME split and never repays
 * a specific clip, so nothing is withheld from the artist's media share — the target is 0 for every artist. Snapshots
 * stored before keep their recorded values (history; never read as a clip repayment).
 */
export const MEDIA_RECOUP_TARGET = 0;

export type MediaAgreementSplit =
  | { status: "DEFINED"; gross: number; artistShare: number; labelShare: number; clipRepayment: 0; basisHe: string }
  | { status: "NOT_DEFINED"; reason: NotDefinedReason; reasonHe: string; gross: number };
/**
 * Media income under the agreement: 50 / 50 of the income (the label share = gross / 2 rounded, the artist gets the rest —
 * the same split the media screen previews). INCOME only: clipRepayment is always 0 — media never repays a clip.
 */
export function mediaAgreementSplit(artist: { id?: string | null; name?: string | null }, gross: number): MediaAgreementSplit {
  const g = r2(Number(gross) || 0);
  if (isCollabText(artist.name) && !artist.id) return { status: "NOT_DEFINED", reason: "COLLAB_NOT_ATTRIBUTED", reasonHe: NOT_DEFINED_HE.COLLAB_NOT_ATTRIBUTED, gross: g };
  if (!agreementArtistOf(artist)) return { status: "NOT_DEFINED", reason: "NO_AGREEMENT", reasonHe: NOT_DEFINED_HE.NO_AGREEMENT, gross: g };
  const labelShare = r2(g / 2);
  return { status: "DEFINED", gross: g, artistShare: r2(g - labelShare), labelShare, clipRepayment: 0, basisHe: AGREEMENT_MEDIA_RULE.basisHe };
}

/** The artists the agreement covers — the registered roster ids (Shalev, Avi). Nobody else. */
export const AGREEMENT_ARTISTS: ReadonlyArray<{ id: string; name: string }> = OWNER_LABEL_REGISTERED_ROSTER;
const BY_ID = new Map(AGREEMENT_ARTISTS.map((a) => [a.id, a]));
const BY_NAME = new Map(AGREEMENT_ARTISTS.map((a) => [a.name, a]));

export type NotDefinedReason = "NO_AGREEMENT" | "CATEGORY_NOT_DEFINED" | "COLLAB_NOT_ATTRIBUTED" | "NOT_PAID";
export const NOT_DEFINED_HE: Readonly<Record<NotDefinedReason, string>> = {
  NO_AGREEMENT: "אין חוק התחשבנות רשום לאמן הזה — חוקי שליו / אבי לא חלים עליו",
  CATEGORY_NOT_DEFINED: "אין חוק בעלים לסוג ההוצאה הזה — החלוקה לא מוגדרת (לא מנחשים)",
  COLLAB_NOT_ATTRIBUTED: "שיתוף של כמה אמנים — אין חוק לייחוס החלוקה",
  NOT_PAID: "רק עלות ששולמה בפועל נכנסת לחלוקה",
};

/** An agreement artist by id (preferred) or by an EXACT single-artist name. A collaboration text is never attributed. */
export function agreementArtistOf(ref: { id?: string | null; name?: string | null }): { id: string; name: string } | null {
  if (ref.id && BY_ID.has(ref.id)) return BY_ID.get(ref.id)!;
  if (ref.id) return null;
  const tokens = projectArtistTokens(ref.name);
  if (tokens.length !== 1) return null;
  return BY_NAME.get(tokens[0]) ?? null;
}
export const isCollabText = (name: string | null | undefined) => projectArtistTokens(name).length > 1;

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export type ShowAgreementSplit =
  | ({ status: "DEFINED"; artist: { id: string; name: string }; directExpenses: number } & ReturnType<typeof computeShowSplit>)
  | { status: "NOT_DEFINED"; reason: NotDefinedReason; reasonHe: string };

/**
 * A show's artist / label split under the agreement — the app's OWN computeShowSplit (net = price − DJ − counted
 * rehearsals; 50 / 50 of the net, never of the gross) for an agreement artist; NOT_DEFINED for anyone else or a collab.
 */
export function showAgreementSplit(show: { artist?: string | null; show_price?: number | null; dj_fee?: number | null }, rehearsalCounted = 0): ShowAgreementSplit {
  if (isCollabText(show.artist)) return { status: "NOT_DEFINED", reason: "COLLAB_NOT_ATTRIBUTED", reasonHe: NOT_DEFINED_HE.COLLAB_NOT_ATTRIBUTED };
  const artist = agreementArtistOf({ name: show.artist ?? null });
  if (!artist) return { status: "NOT_DEFINED", reason: "NO_AGREEMENT", reasonHe: NOT_DEFINED_HE.NO_AGREEMENT };
  const split = computeShowSplit({ show_price: show.show_price ?? 0, dj_fee: show.dj_fee ?? 0 }, rehearsalCounted);
  return { status: "DEFINED", artist, directExpenses: r2(split.djFee + split.rehearsalCosts), ...split };
}

