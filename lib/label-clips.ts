import "server-only";
import { supabase } from "./supabase";
import { parseArtistNames } from "./clients-store";
import { CLIP_SCOPE } from "./clip-finance";
import { isExpenseFullyPaidStatus } from "./finance/classify";
import { normalizeCurrency } from "./finance/currency";
import { clipMoneyByCurrency, clipRecoupContribution, type ClipMoneyByCurrency, type ClipRecoupContribution } from "./clip-rf-money-pure";
import { agreementArtistOf, AGREEMENT_CYCLE_ACCOUNTING_HE } from "./label-agreements";
import { expenseShareOf, EXPENSE_SHARE_EXCEPTIONS, UNDEFINED_HE } from "./records-expense-share";
import type { LabelAgreementAllocationLine, LabelAgreementTotals, LabelClipShareTx } from "./types";

/** Round to 2 decimals (money-safe). */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * B3 (Owner canon 2026-09-27): A client clip price ≠ B planned budget ≠ C actual cost ≠ D recoupable. The old per-clip
 * "50 % of the BUDGET" split is RETIRED for every reader. The split of C (the ACTUAL PAID cost) between Records and the
 * artists is the ONE rule lib/records-expense-share (Owner decision 2026-09-28, task 6) — per Finance TRANSACTION and by
 * the project's credits: one Records artist 50 / 50, Shalev + Avi 50 / 25 / 25, NagashBeatz 100 % Records, a Records
 * artist next to an external party UNDEFINED; Owner exceptions win. There is no recoup (D stays NOT_DEFINED). A / B / C
 * stay INFORMATION — never added together; the split never changes the Finance cash out.
 * No double count: every Finance transaction appears ONCE per artist (several productions on one project share it), and
 * `shareTransactions` carries the transaction id so a roll-up across artists counts its cash once (a clip_item is
 * planning only — its promoted expense is the Finance transaction, counted once when paid).
 *
 * Artist ↔ production is a TEXT_MATCH on the production's artist_name (lib/label-identity documents the id-first rule;
 * productions carry no label-artist id).
 */
export interface ArtistClip {
  id: string; title: string; status: string; projectId: string | null;
  /** B — the production's planned budget, in `currency` (planning, not money). */
  plannedBudget: number;
  currency: string;
  /** A — the project's client clip price (finance_<project>.clipAgreedPrice) + its deal currency; null when none recorded. */
  clientClipPrice: number | null;
  clientClipCurrency: string | null;
  /** C — Finance expenses with scope קליפ on the linked project, paid (שולם) only, PER CURRENCY. Empty without a project. */
  actualCostPaid: Record<string, number>;
  /** Red Films ledger payments of the production NOT linked to Finance, PER CURRENCY (DB-1: a linked payment is its Finance expense, already in actualCostPaid — never counted twice). */
  rfLedgerPaid: Record<string, number>;
  /** The Records / artist split of C, one entry per currency (lib/records-expense-share over this project's transactions). */
  allocation: LabelAgreementAllocationLine[];
  /** The Finance transactions behind C with their split (the same transaction may sit under several productions of one project). */
  shareTransactions: LabelClipShareTx[];
  /** D — no recoup mechanism: NOT_DEFINED with the reason (שליו / אבי: the clip share is a cycle expense; others: no agreement). */
  recoup: ClipRecoupContribution;
  artistLink: "TEXT_MATCH";
}

type ProdRow = { id: string; title: string; status: string; project_id: string | null; artist_name: string | null; production_type: string | null; general_budget: number | null; currency: string | null };

async function activeClipProductionsFor(artistName: string): Promise<ProdRow[]> {
  const { data, error } = await supabase
    .from("red_films_productions")
    .select("id, title, status, project_id, artist_name, production_type, general_budget, currency");
  if (error) throw new Error(error.message);
  return ((data ?? []) as ProdRow[]).filter((p) => p.production_type === CLIP_SCOPE && p.status !== "בוטל" && parseArtistNames(p.artist_name || "").includes(artistName));
}

/** Active clip productions for an artist (production_type="קליפ", not cancelled), matched by name — with A / B / C. */
export async function listArtistClips(artistName: string, artistId?: string | null): Promise<ArtistClip[]> {
  const prods = await activeClipProductionsFor(artistName);
  if (!prods.length) return [];
  const projectIds = [...new Set(prods.map((p) => p.project_id).filter((x): x is string => !!x))];
  const prodIds = prods.map((p) => p.id);
  const lumpIds = [...new Set(Object.values(EXPENSE_SHARE_EXCEPTIONS).flatMap((e) => (e.kind === "RECORDED_LUMP" ? [e.ledgerEntryId] : [])))];
  const [settingsRes, txRes, payRes, projRes, lumpRes] = await Promise.all([
    projectIds.length ? supabase.from("settings").select("key, value").in("key", projectIds.map((id) => `finance_${id}`)) : Promise.resolve({ data: [], error: null }),
    projectIds.length ? supabase.from("transactions").select("id, project_id, amount, currency, payment_status, business_unit, category, expense_scope, show_id, show_money_role").eq("type", "expense").eq("expense_scope", CLIP_SCOPE).in("project_id", projectIds) : Promise.resolve({ data: [], error: null }),
    supabase.from("red_films_budget_payments").select("production_id, amount, currency, linked_transaction_id").in("production_id", prodIds),
    projectIds.length ? supabase.from("projects").select("id, artist").in("id", projectIds) : Promise.resolve({ data: [], error: null }),
    lumpIds.length ? supabase.from("artist_balance_entries").select("id, artist_id, amount").in("id", lumpIds) : Promise.resolve({ data: [], error: null }),
  ]);
  for (const r of [settingsRes, txRes, payRes, projRes, lumpRes]) if (r.error) throw new Error(r.error.message);
  const artistTextOf = new Map(((projRes.data ?? []) as Array<{ id: string; artist: string | null }>).map((p) => [p.id, p.artist ?? null]));
  const lumps = new Map(((lumpRes.data ?? []) as Array<{ id: string; artist_id: string; amount: unknown }>).map((l) => [l.id, { artistId: l.artist_id, amount: Number(l.amount) || 0 }]));
  const setting = new Map(((settingsRes.data ?? []) as Array<{ key: string; value: Record<string, unknown> | null }>).map((s) => [s.key.slice("finance_".length), s.value ?? {}]));
  const byCur = (rows: Array<{ amount: unknown; currency: unknown }>) => rows.reduce<Record<string, number>>((m, r) => { const c = normalizeCurrency(r.currency as string | null); m[c] = round2((m[c] ?? 0) + (Number(r.amount) || 0)); return m; }, {});
  const txs = (txRes.data ?? []) as Array<{ id: string; project_id: string; amount: unknown; currency: unknown; payment_status: string | null; business_unit: string | null; category: string | null; expense_scope: string | null; show_id: string | null; show_money_role: string | null }>;
  const paidTx = txs.filter((t) => isExpenseFullyPaidStatus(t.payment_status));
  // an Owner-recorded lump (e.g. Principe's ₪2,480) is spread over its transactions in proportion — it is ONE record
  const lumpGroupTotal = new Map<string, number>();
  for (const t of paidTx) { const e = EXPENSE_SHARE_EXCEPTIONS[t.id]; if (e?.kind === "RECORDED_LUMP") lumpGroupTotal.set(e.ledgerEntryId, round2((lumpGroupTotal.get(e.ledgerEntryId) ?? 0) + (Number(t.amount) || 0))); }
  const selfId = artistId ?? agreementArtistOf({ name: artistName })?.id ?? null; // the artist's roster id (id first)
  const shareOf = (t: (typeof txs)[number]): LabelClipShareTx => {
    const s = expenseShareOf({ id: t.id, type: "expense", amount: t.amount, currency: t.currency as string | null, paymentStatus: t.payment_status, businessUnit: t.business_unit, category: t.category, expenseScope: t.expense_scope, showId: t.show_id, showMoneyRole: t.show_money_role, projectId: t.project_id }, { artistText: artistTextOf.get(t.project_id) ?? null });
    const cashOut = round2(Number(t.amount) || 0), currency = normalizeCurrency(t.currency as string | null);
    if (s.status === "DEFINED") {
      const mine = s.artists.find((a) => a.artistId === selfId)?.amount ?? 0;
      return { txId: t.id, currency, cashOut, status: "DEFINED", recordsShare: s.recordsAmount, artistShare: round2(mine), artistsShareTotal: round2(cashOut - s.recordsAmount), basisHe: s.basisHe };
    }
    if (s.status === "RECORDED_ELSEWHERE") {
      const lump = lumps.get(s.ledgerEntryId); const total = lumpGroupTotal.get(s.ledgerEntryId) ?? 0;
      const part = lump && total > 0 ? round2((lump.amount * cashOut) / total) : 0;
      return { txId: t.id, currency, cashOut, status: "DEFINED", recordsShare: round2(cashOut - part), artistShare: lump && lump.artistId === selfId ? part : 0, artistsShareTotal: part, basisHe: s.reasonHe };
    }
    return { txId: t.id, currency, cashOut, status: "NOT_DEFINED", recordsShare: null, artistShare: null, artistsShareTotal: null, basisHe: s.status === "UNDEFINED" ? s.reasonHe : UNDEFINED_HE.NO_ARTIST_CONTEXT };
  };
  // DB-1: a linked payment IS its Finance expense (in C when paid) — only the unlinked ones are the separate ledger amount
  const pays = ((payRes.data ?? []) as Array<{ production_id: string; amount: unknown; currency: unknown; linked_transaction_id?: string | null }>).filter((x) => !x.linked_transaction_id);
  return prods.map((p) => {
    const s = p.project_id ? setting.get(p.project_id) ?? null : null;
    const price = s ? Number(s.clipAgreedPrice) : NaN;
    const mineTx = p.project_id ? paidTx.filter((t) => t.project_id === p.project_id) : [];
    const actualCostPaid = byCur(mineTx);
    const shareTransactions = mineTx.map(shareOf);
    const allocation = allocationLines(shareTransactions);
    // D: there is no recoup — the artist's clip share is an artist EXPENSE in the bi-monthly cycle; otherwise the reason
    const recoupReason = agreementArtistOf({ id: artistId ?? null, name: artistName }) ? AGREEMENT_CYCLE_ACCOUNTING_HE : null;
    return {
      id: p.id, title: p.title, status: p.status, projectId: p.project_id,
      plannedBudget: round2(Number(p.general_budget) || 0), currency: normalizeCurrency(p.currency),
      clientClipPrice: Number.isFinite(price) && price > 0 ? price : null, clientClipCurrency: s && Number.isFinite(price) && price > 0 ? normalizeCurrency(typeof s.currency === "string" ? s.currency : null) : null,
      actualCostPaid,
      rfLedgerPaid: byCur(pays.filter((x) => x.production_id === p.id)),
      allocation, shareTransactions, recoup: clipRecoupContribution(recoupReason), artistLink: "TEXT_MATCH" as const,
    };
  });
}

/** A / B / C (+ Red Films ledger) PER CURRENCY over an artist's clips — information, never a recoup. */
export function artistClipMoney(clips: readonly ArtistClip[]): Record<string, ClipMoneyByCurrency> {
  return clipMoneyByCurrency({
    clientClipPrices: clips.filter((c) => c.clientClipPrice !== null).map((c) => ({ amount: c.clientClipPrice, currency: c.clientClipCurrency })),
    plannedBudgets: clips.map((c) => ({ amount: c.plannedBudget, currency: c.currency })),
    actualCostsPaid: clips.flatMap((c) => Object.entries(c.actualCostPaid).map(([currency, amount]) => ({ amount, currency }))),
    rfLedgerPaid: clips.flatMap((c) => Object.entries(c.rfLedgerPaid).map(([currency, amount]) => ({ amount, currency }))),
  });
}

/** The artist's clip transactions, each ONCE (several productions of one project share its transactions). */
export function uniqueShareTransactions(clips: readonly ArtistClip[]): LabelClipShareTx[] {
  const seen = new Map<string, LabelClipShareTx>();
  for (const c of clips) for (const t of c.shareTransactions) if (!seen.has(t.txId)) seen.set(t.txId, t);
  return [...seen.values()];
}

/** Per-currency lines of a set of split transactions (DEFINED: cash / Records / this artist; NOT_DEFINED: cash + reason). */
function allocationLines(txs: readonly LabelClipShareTx[]): LabelAgreementAllocationLine[] {
  const t = shareTotals(txs);
  return [
    ...Object.entries(t.defined).map(([currency, v]) => ({ status: "DEFINED" as const, currency, cashOut: v.cashOut, labelShare: v.labelShare, artistShare: v.artistShare, artistShareFundedByLabel: v.artistShareFundedByLabel, basisHe: "חלוקה לפי חוק Records / אמנים" })),
    ...Object.entries(t.notDefined).map(([currency, v]) => ({ status: "NOT_DEFINED" as const, currency, cashOut: v.cashOut, reasonHe: v.reasons.join(" · ") })),
  ];
}

/** Totals PER CURRENCY of split transactions — each transaction counted once. The artist share is THIS artist's. */
export function shareTotals(txs: readonly LabelClipShareTx[]): LabelAgreementTotals {
  const out: LabelAgreementTotals = { defined: {}, notDefined: {} };
  for (const t of txs) {
    if (t.status === "DEFINED") {
      const x = (out.defined[t.currency] ??= { cashOut: 0, labelShare: 0, artistShare: 0, artistShareFundedByLabel: 0 });
      x.cashOut = round2(x.cashOut + t.cashOut); x.labelShare = round2(x.labelShare + (t.recordsShare ?? 0));
      x.artistShare = round2(x.artistShare + (t.artistShare ?? 0)); x.artistShareFundedByLabel = round2(x.artistShareFundedByLabel + (t.artistShare ?? 0));
    } else {
      const x = (out.notDefined[t.currency] ??= { cashOut: 0, reasons: [] });
      x.cashOut = round2(x.cashOut + t.cashOut); if (!x.reasons.includes(t.basisHe)) x.reasons.push(t.basisHe);
    }
  }
  return out;
}

/** The split of an artist's clips PER CURRENCY: cash out, Records share, this artist's share (+ NOT_DEFINED cash kept apart). */
export function artistClipAllocation(clips: readonly ArtistClip[]): LabelAgreementTotals {
  return shareTotals(uniqueShareTransactions(clips));
}

