/**
 * LABEL ARTIST AGREEMENTS — the ONE rule layer for "who carries which cost / which share" between a label artist and
 * the label (Owner decision 2026-09-27, FINAL). Pure: no I/O, safe for client components, server code, Sunny and tests.
 *
 * SCOPE: the rules below apply ONLY to שליו טסמה and אבי מולה (their stable label_artists ids). No other artist — roster
 * or not, present or future — inherits them: every other artist is NOT_DEFINED (never inferred, never "like Shalev").
 *
 *   Production / Mix / Master  100 % label, 0 % artist   (a real Redbloods cost that creates NO artist balance)
 *   Clip                        50 % label, 50 % artist   (of the ACTUAL PAID cost — never the planned budget / the price)
 *   Show                        50 / 50 of the NET show profit: revenue − direct show expenses (the app's own
 *                               computeShowSplit: DJ fee + counted rehearsals are the recorded direct expenses)
 *   Anything else               NOT_DEFINED (promotion, artwork, PR photos, distribution, any other category)
 *
 * THREE DIFFERENT QUESTIONS, never merged (B, Owner 2026-09-27):
 *   cashOut                   what Redbloods actually paid (Finance cash truth — unchanged by any allocation)
 *   labelShare                the label's ECONOMIC share of that cost
 *   artistShare               the artist's economic share of that cost
 *   artistShareFundedByLabel  the part of the artist's share Redbloods paid for the artist — it enters the accounting with
 *                             the artist and future artist income MAY be offset against it through the accounting
 *                             mechanism (the artist ledger); it is never "label investment".
 *
 * Currencies are never added or converted: every total is per currency.
 */
import { OWNER_LABEL_REGISTERED_ROSTER, projectArtistTokens } from "./project-classification";
import { computeShowSplit } from "./shows-types";

export const AGREEMENT_RULES_VERSION = "2026-09-27";

/** Cost categories the Owner defined. Mix and master are recorded in one Finance scope ("מיקס / מאסטר"). */
export type AgreementCostCategory = "PRODUCTION" | "MIX_MASTER" | "CLIP";
export interface CostRule { labelPct: number; artistPct: number; basisHe: string }
export const AGREEMENT_COST_RULES: Readonly<Record<AgreementCostCategory, CostRule>> = {
  PRODUCTION: { labelPct: 100, artistPct: 0, basisHe: "הפקה מוזיקלית — 100% על חשבון הלייבל" },
  MIX_MASTER: { labelPct: 100, artistPct: 0, basisHe: "מיקס / מאסטר — 100% על חשבון הלייבל" },
  CLIP: { labelPct: 50, artistPct: 50, basisHe: "קליפ — 50% לייבל / 50% אמן מהעלות ששולמה בפועל" },
};
export const AGREEMENT_SHOW_RULE = { artistPct: 50, labelPct: 50, basisHe: "הופעה — 50/50 מהרווח הנקי: הכנסה פחות הוצאות ישירות (DJ + חזרות שנספרות)" } as const;

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

/** Finance expense_scope → agreement category. Only the scopes the Owner's rules name; everything else is null (NOT_DEFINED). */
export function costCategoryOfScope(expenseScope: string | null | undefined): AgreementCostCategory | null {
  if (expenseScope === "קליפ") return "CLIP";
  if (expenseScope === "מיקס / מאסטר") return "MIX_MASTER";
  return null; // no Finance scope marks music production; שיווק / סשן / נסיעות / ציוד / כללי / אחר have no rule
}

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export type Allocation =
  | { status: "DEFINED"; category: AgreementCostCategory; currency: string; cashOut: number; labelShare: number; artistShare: number; artistShareFundedByLabel: number; basisHe: string }
  | { status: "NOT_DEFINED"; reason: NotDefinedReason; reasonHe: string; currency: string; cashOut: number };

/**
 * Allocate ONE actually-paid cost that Redbloods paid. `cashOut` is always the paid amount (Finance truth); the shares are
 * the agreement's split. The label always funds the artist's share when Redbloods paid the whole cost.
 */
export function allocatePaidCost(input: { artist: { id?: string | null; name?: string | null }; category: AgreementCostCategory | null; amount: number; currency: string; paid: boolean }): Allocation {
  const amount = r2(Number(input.amount) || 0);
  const currency = input.currency || "₪";
  const nd = (reason: NotDefinedReason): Allocation => ({ status: "NOT_DEFINED", reason, reasonHe: NOT_DEFINED_HE[reason], currency, cashOut: input.paid ? amount : 0 });
  if (!input.paid) return nd("NOT_PAID");
  if (isCollabText(input.artist.name) && !input.artist.id) return nd("COLLAB_NOT_ATTRIBUTED");
  if (!agreementArtistOf(input.artist)) return nd("NO_AGREEMENT");
  if (!input.category) return nd("CATEGORY_NOT_DEFINED");
  const rule = AGREEMENT_COST_RULES[input.category];
  const artistShare = r2((amount * rule.artistPct) / 100);
  const labelShare = r2(amount - artistShare);
  return { status: "DEFINED", category: input.category, currency, cashOut: amount, labelShare, artistShare, artistShareFundedByLabel: artistShare, basisHe: rule.basisHe };
}

export interface AllocationTotals { cashOut: number; labelShare: number; artistShare: number; artistShareFundedByLabel: number }
/** Per-currency totals of DEFINED allocations + the NOT_DEFINED cash out kept apart (never added into a share). */
export function allocationTotalsByCurrency(allocs: readonly Allocation[]): { defined: Record<string, AllocationTotals>; notDefined: Record<string, { cashOut: number; reasons: NotDefinedReason[] }> } {
  const defined: Record<string, AllocationTotals> = {};
  const notDefined: Record<string, { cashOut: number; reasons: NotDefinedReason[] }> = {};
  for (const a of allocs) {
    if (a.status === "DEFINED") {
      const t = (defined[a.currency] ??= { cashOut: 0, labelShare: 0, artistShare: 0, artistShareFundedByLabel: 0 });
      t.cashOut = r2(t.cashOut + a.cashOut); t.labelShare = r2(t.labelShare + a.labelShare); t.artistShare = r2(t.artistShare + a.artistShare); t.artistShareFundedByLabel = r2(t.artistShareFundedByLabel + a.artistShareFundedByLabel);
    } else if (a.cashOut > 0) {
      const t = (notDefined[a.currency] ??= { cashOut: 0, reasons: [] });
      t.cashOut = r2(t.cashOut + a.cashOut); if (!t.reasons.includes(a.reason)) t.reasons.push(a.reason);
    }
  }
  return { defined, notDefined };
}

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

/**
 * The artist-funded balance against the artist's own income share (A4) — one currency, per artist, a DERIVED preview
 * of what the accounting mechanism may offset. It records nothing; the ledger stays the accounting record.
 *   remainingFunded = the funded share not yet covered by the artist's income share
 *   artistCredit    = the artist's income share above the funded share
 */
export function fundedBalancePreview(fundedByLabel: number, artistIncomeShare: number): { fundedByLabel: number; artistIncomeShare: number; remainingFunded: number; artistCredit: number } {
  const f = r2(Math.max(0, fundedByLabel)), i = r2(Math.max(0, artistIncomeShare));
  return { fundedByLabel: f, artistIncomeShare: i, remainingFunded: r2(Math.max(0, f - i)), artistCredit: r2(Math.max(0, i - f)) };
}
