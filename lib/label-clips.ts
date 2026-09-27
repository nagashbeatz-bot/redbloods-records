import "server-only";
import { supabase } from "./supabase";
import { parseArtistNames } from "./clients-store";
import { CLIP_SCOPE } from "./clip-finance";
import { isExpenseFullyPaidStatus } from "./finance/classify";
import { normalizeCurrency } from "./finance/currency";
import { clipMoneyByCurrency, clipRecoupContribution, type ClipMoneyByCurrency, type ClipRecoupContribution } from "./clip-rf-money-pure";
import { allocatePaidCost, allocationTotalsByCurrency, isCollabText, type Allocation } from "./label-agreements";

/** Round to 2 decimals (money-safe). */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * B3 (Owner canon 2026-09-27): A client clip price ≠ B planned budget ≠ C actual cost ≠ D recoupable. The old per-clip
 * "50 % of the BUDGET" split is RETIRED for every reader. Owner decision 2026-09-27 (lib/label-agreements — the ONE rule):
 * for שליו טסמה / אבי מולה a clip is 50 % label / 50 % artist of C (the ACTUAL PAID cost, per currency); the artist's half
 * is funded by the label and enters the accounting with the artist (D). Any other artist, or a collaboration production,
 * is NOT_DEFINED. A / B / C stay INFORMATION — never added together; the allocation never changes the Finance cash out.
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
  /** The agreement allocation of C, one entry per currency (DEFINED only for שליו / אבי, solo productions). */
  allocation: Allocation[];
  /** D — the artist's ₪ share funded by the label (DEFINED for שליו / אבי), else NOT_DEFINED with the reason. */
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
  const [settingsRes, txRes, payRes] = await Promise.all([
    projectIds.length ? supabase.from("settings").select("key, value").in("key", projectIds.map((id) => `finance_${id}`)) : Promise.resolve({ data: [], error: null }),
    projectIds.length ? supabase.from("transactions").select("project_id, amount, currency, payment_status").eq("type", "expense").eq("expense_scope", CLIP_SCOPE).in("project_id", projectIds) : Promise.resolve({ data: [], error: null }),
    supabase.from("red_films_budget_payments").select("production_id, amount, currency, linked_transaction_id").in("production_id", prodIds),
  ]);
  for (const r of [settingsRes, txRes, payRes]) if (r.error) throw new Error(r.error.message);
  const setting = new Map(((settingsRes.data ?? []) as Array<{ key: string; value: Record<string, unknown> | null }>).map((s) => [s.key.slice("finance_".length), s.value ?? {}]));
  const byCur = (rows: Array<{ amount: unknown; currency: unknown }>) => rows.reduce<Record<string, number>>((m, r) => { const c = normalizeCurrency(r.currency as string | null); m[c] = round2((m[c] ?? 0) + (Number(r.amount) || 0)); return m; }, {});
  const txs = (txRes.data ?? []) as Array<{ project_id: string; amount: unknown; currency: unknown; payment_status: string | null }>;
  // DB-1: a linked payment IS its Finance expense (in C when paid) — only the unlinked ones are the separate ledger amount
  const pays = ((payRes.data ?? []) as Array<{ production_id: string; amount: unknown; currency: unknown; linked_transaction_id?: string | null }>).filter((x) => !x.linked_transaction_id);
  return prods.map((p) => {
    const s = p.project_id ? setting.get(p.project_id) ?? null : null;
    const price = s ? Number(s.clipAgreedPrice) : NaN;
    const actualCostPaid = p.project_id ? byCur(txs.filter((t) => t.project_id === p.project_id && isExpenseFullyPaidStatus(t.payment_status))) : {};
    // a collaboration production is never attributed to one artist (COLLAB_NOT_ATTRIBUTED)
    const who = isCollabText(p.artist_name) ? { name: p.artist_name } : { id: artistId ?? null, name: artistName };
    const allocation = Object.entries(actualCostPaid).map(([currency, amount]) => allocatePaidCost({ artist: who, category: "CLIP", amount, currency, paid: true }));
    // D in ₪ (the ledger / media are ₪-only): an agreement artist with no paid ₪ cost yet → DEFINED 0; otherwise the reason
    const ils = allocation.find((a) => a.currency === "₪") ?? allocatePaidCost({ artist: who, category: "CLIP", amount: 0, currency: "₪", paid: true });
    return {
      id: p.id, title: p.title, status: p.status, projectId: p.project_id,
      plannedBudget: round2(Number(p.general_budget) || 0), currency: normalizeCurrency(p.currency),
      clientClipPrice: Number.isFinite(price) && price > 0 ? price : null, clientClipCurrency: s && Number.isFinite(price) && price > 0 ? normalizeCurrency(typeof s.currency === "string" ? s.currency : null) : null,
      actualCostPaid,
      rfLedgerPaid: byCur(pays.filter((x) => x.production_id === p.id)),
      allocation, recoup: clipRecoupContribution(ils), artistLink: "TEXT_MATCH" as const,
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

/** The agreement allocation of an artist's clips PER CURRENCY: cash out, label share, artist share, artist share funded by the label (+ NOT_DEFINED cash out kept apart). */
export function artistClipAllocation(clips: readonly ArtistClip[]) {
  return allocationTotalsByCurrency(clips.flatMap((c) => c.allocation));
}

/**
 * The media-income RPC's p_recoup_target (the DB computes the media recoup snapshot against it). Owner decision
 * 2026-09-27: the artist's clip share funded by the label = 50 % of the ACTUAL PAID ₪ clip cost, ONLY for שליו טסמה /
 * אבי מולה (lib/label-agreements). Any other artist has no agreement → 0 (nothing is withheld from the artist's media
 * share by an undefined rule). The media ledger stores no currency, so only ₪ counts. Replaces the retired pre-B3 rule
 * (the artist half of the planned budgets).
 */
export async function getRecoupTargetForArtist(artistName: string, artistId?: string | null): Promise<number> {
  const clips = await listArtistClips(artistName, artistId);
  return round2(artistClipAllocation(clips).defined["₪"]?.artistShareFundedByLabel ?? 0);
}
