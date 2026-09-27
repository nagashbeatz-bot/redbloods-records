import "server-only";
import { supabase } from "./supabase";
import { parseArtistNames } from "./clients-store";
import { CLIP_SCOPE } from "./clip-finance";
import { isExpenseFullyPaidStatus } from "./finance/classify";
import { normalizeCurrency } from "./finance/currency";
import { clipMoneyByCurrency, clipRecoupContribution, type ClipMoneyByCurrency, type ClipRecoupContribution } from "./clip-rf-money-pure";

/** Round to 2 decimals (money-safe). */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * B3 (Owner canon 2026-09-27): A client clip price ≠ B planned budget ≠ C actual cost ≠ D recoupable. The old per-clip
 * "50 % of the budget is recouped from the artist" split is RETIRED for every reader (recoup route, clips route, label
 * page, Sunny): the clip contribution to recoup is NOT_DEFINED until the artist agreement rule is recorded. A / B / C are
 * returned per currency as INFORMATION only — never added together, never a recoup, never an investment rule.
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
  /** Red Films ledger payments of the production, PER CURRENCY — real money, not linked to Finance (DB-1 pending). */
  rfLedgerPaid: Record<string, number>;
  /** D — always NOT_DEFINED (null + reason) until the artist agreement rule exists. */
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
export async function listArtistClips(artistName: string): Promise<ArtistClip[]> {
  const prods = await activeClipProductionsFor(artistName);
  if (!prods.length) return [];
  const projectIds = [...new Set(prods.map((p) => p.project_id).filter((x): x is string => !!x))];
  const prodIds = prods.map((p) => p.id);
  const [settingsRes, txRes, payRes] = await Promise.all([
    projectIds.length ? supabase.from("settings").select("key, value").in("key", projectIds.map((id) => `finance_${id}`)) : Promise.resolve({ data: [], error: null }),
    projectIds.length ? supabase.from("transactions").select("project_id, amount, currency, payment_status").eq("type", "expense").eq("expense_scope", CLIP_SCOPE).in("project_id", projectIds) : Promise.resolve({ data: [], error: null }),
    supabase.from("red_films_budget_payments").select("production_id, amount, currency").in("production_id", prodIds),
  ]);
  for (const r of [settingsRes, txRes, payRes]) if (r.error) throw new Error(r.error.message);
  const setting = new Map(((settingsRes.data ?? []) as Array<{ key: string; value: Record<string, unknown> | null }>).map((s) => [s.key.slice("finance_".length), s.value ?? {}]));
  const byCur = (rows: Array<{ amount: unknown; currency: unknown }>) => rows.reduce<Record<string, number>>((m, r) => { const c = normalizeCurrency(r.currency as string | null); m[c] = round2((m[c] ?? 0) + (Number(r.amount) || 0)); return m; }, {});
  const txs = (txRes.data ?? []) as Array<{ project_id: string; amount: unknown; currency: unknown; payment_status: string | null }>;
  const pays = (payRes.data ?? []) as Array<{ production_id: string; amount: unknown; currency: unknown }>;
  return prods.map((p) => {
    const s = p.project_id ? setting.get(p.project_id) ?? null : null;
    const price = s ? Number(s.clipAgreedPrice) : NaN;
    return {
      id: p.id, title: p.title, status: p.status, projectId: p.project_id,
      plannedBudget: round2(Number(p.general_budget) || 0), currency: normalizeCurrency(p.currency),
      clientClipPrice: Number.isFinite(price) && price > 0 ? price : null, clientClipCurrency: s && Number.isFinite(price) && price > 0 ? normalizeCurrency(typeof s.currency === "string" ? s.currency : null) : null,
      actualCostPaid: p.project_id ? byCur(txs.filter((t) => t.project_id === p.project_id && isExpenseFullyPaidStatus(t.payment_status))) : {},
      rfLedgerPaid: byCur(pays.filter((x) => x.production_id === p.id)),
      recoup: clipRecoupContribution(), artistLink: "TEXT_MATCH" as const,
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

/**
 * LEGACY_BEHAVIOR — used ONLY by lib/media-income-store.ts to feed the media-income RPC's p_recoup_target (the media
 * recoup snapshots are DB-computed and were left unchanged by B3). It is the pre-B3 rule (artist half of the active clip
 * budgets, by name) and is NOT the artist's recoup: every other reader shows the clip recoup as NOT_DEFINED. Registered
 * as a conflict for the Owner (the artist agreement rule decides what, if anything, is recouped).
 */
export async function getRecoupTargetForArtist(artistName: string): Promise<number> {
  const prods = await activeClipProductionsFor(artistName);
  return round2(prods.reduce((s, p) => { const b = round2(Number(p.general_budget) || 0); return s + round2(b - round2(b / 2)); }, 0));
}
