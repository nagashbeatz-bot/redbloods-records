/**
 * Business unit — the server side of lib/business-unit.ts (task 4, Owner decisions 2026-09-28). Every writer that
 * creates a Finance row asks `unitColumnsForNewTransaction` for its two columns; nothing here guesses: the pure rule
 * decides, this module only loads the facts it needs (the show's artist on the Records roster, the project's stored
 * business type, a Red Films production for an external client, the units the Owner already decided in the project).
 *
 * A manual writer (Finance screen, Sunny) must end with a unit: `NeedsBusinessUnitError` (422) makes the person choose.
 * An automatic writer (show sync, mix, Victor, clip, Red Films, promotion) keeps NULL = "דורש סיווג" when no rule is certain.
 */
import { supabase } from "@/lib/supabase";
import { projectUnitContext, showArtistIsRecords } from "@/lib/business-unit-facts";
import {
  BUSINESS_UNITS, MANUAL_UNIT_WRITERS, inferBusinessUnit, isBusinessUnit, mayRecomputeUnit, unitColumns,
  type BusinessUnit, type UnitDecision, type UnitWriter,
} from "@/lib/business-unit";

export class NeedsBusinessUnitError extends Error {
  readonly code = "NEEDS_BUSINESS_UNIT" as const;
  readonly options = BUSINESS_UNITS;
  constructor(readonly reasonHe: string) { super(`יש לבחור יחידה עסקית (Studio / Records / Films / Corporate) — ${reasonHe}`); }
}

export interface NewTxUnitFacts {
  writer: UnitWriter;
  type: string;
  category?: string | null;
  expenseScope?: string | null;
  projectId?: string | null;
  showId?: string | null;
  ownerChoice?: string | null;
  excludeTxId?: string | null;
}

/** The decision for a row (loads the facts; the pure rule decides). */
export async function decideBusinessUnit(f: NewTxUnitFacts): Promise<UnitDecision> {
  const show = f.showId ? { artistIsRecords: await showArtistIsRecords(f.showId) } : null;
  const project = !show && f.projectId ? await projectUnitContext(f.projectId, f.excludeTxId) : null;
  return inferBusinessUnit({ writer: f.writer, type: f.type, category: f.category, expenseScope: f.expenseScope, show, project, ownerChoice: f.ownerChoice });
}

/**
 * The two columns for a NEW row. A manual writer that ends without a unit throws NeedsBusinessUnitError (the person
 * must choose); an automatic writer gets NULL ("דורש סיווג"). A choice equal to the rule's result is recorded as RULE.
 */
export async function unitColumnsForNewTransaction(f: NewTxUnitFacts): Promise<{ business_unit: BusinessUnit | null; business_unit_source: "RULE" | "OWNER_DECISION" | "HISTORICAL_APPROVED" | null }> {
  const byRule = await decideBusinessUnit({ ...f, ownerChoice: null });
  let d = byRule;
  if (f.ownerChoice != null && f.ownerChoice !== "") {
    if (!isBusinessUnit(f.ownerChoice)) throw new NeedsBusinessUnitError("יחידה לא מוכרת");
    d = byRule.unit === f.ownerChoice ? byRule : { unit: f.ownerChoice, source: "OWNER_DECISION", reasonHe: "בחירה מפורשת של הבעלים" };
  }
  if (!d.unit && MANUAL_UNIT_WRITERS.includes(f.writer)) throw new NeedsBusinessUnitError(d.reasonHe);
  return unitColumns(d);
}

/** Best-effort for automatic writers: a failed fact read never blocks the money write — the row stays "דורש סיווג". */
export async function unitColumnsOrUnclassified(f: NewTxUnitFacts): Promise<{ business_unit: BusinessUnit | null; business_unit_source: "RULE" | "OWNER_DECISION" | "HISTORICAL_APPROVED" | null }> {
  try { return await unitColumnsForNewTransaction(f); }
  catch (e) { console.warn(`[business-unit] ${f.writer}: left unclassified —`, e instanceof Error ? e.message : e); return { business_unit: null, business_unit_source: null }; }
}

/**
 * After a field change on an existing row (project / type / scope / category): re-derive ONLY a RULE / unclassified
 * unit. An OWNER_DECISION or HISTORICAL_APPROVED unit is never overwritten automatically.
 */
export async function recomputeUnitIfRule(txId: string): Promise<void> {
  const { data: t, error } = await supabase.from("transactions")
    .select("id, type, category, expense_scope, project_id, show_id, business_unit, business_unit_source").eq("id", txId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!t || !mayRecomputeUnit(t.business_unit_source as string | null)) return;
  const d = await decideBusinessUnit({ writer: "FINANCE_MANUAL", type: String(t.type ?? ""), category: t.category as string | null, expenseScope: t.expense_scope as string | null, projectId: t.project_id as string | null, showId: t.show_id as string | null, excludeTxId: txId });
  const cols = unitColumns(d);
  if (cols.business_unit === (t.business_unit ?? null) && cols.business_unit_source === (t.business_unit_source ?? null)) return;
  // compare-and-swap on the source: never overwrite a decision made meanwhile
  let q = supabase.from("transactions").update(cols).eq("id", txId);
  q = t.business_unit_source == null ? q.is("business_unit_source", null) : q.eq("business_unit_source", "RULE");
  const { error: uErr } = await q;
  if (uErr) throw new Error(uErr.message);
}

/** The Owner's explicit unit for an existing row (Finance screen / Sunny SET_TRANSACTION_UNIT): OWNER_DECISION. */
export async function setTransactionUnit(txId: string, unit: string): Promise<boolean> {
  if (!isBusinessUnit(unit)) throw new NeedsBusinessUnitError("יחידה לא מוכרת");
  const { data, error } = await supabase.from("transactions").update({ business_unit: unit, business_unit_source: "OWNER_DECISION" }).eq("id", txId).select("id");
  if (error) throw new Error(error.message);
  // the unit decides whether it is a Records expense at all → the artist's share follows (task 6)
  if ((data ?? []).length === 1) await (await import("@/lib/writes/artist-expense-share")).syncExpenseShareSafe(txId);
  return (data ?? []).length === 1;
}

/** The split RPC inserts the remainder row without a unit: it inherits the original row's unit + source. */
export async function copyUnitToSplitRows(originalId: string, rpcResult: unknown): Promise<void> {
  const ids = new Set<string>();
  const walk = (v: unknown) => { if (typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v) && v !== originalId) ids.add(v); else if (v && typeof v === "object") Object.values(v as Record<string, unknown>).forEach(walk); };
  walk(rpcResult);
  if (!ids.size) return;
  const { data: orig, error } = await supabase.from("transactions").select("business_unit, business_unit_source").eq("id", originalId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!orig?.business_unit) return;
  const { error: uErr } = await supabase.from("transactions").update({ business_unit: orig.business_unit, business_unit_source: orig.business_unit_source })
    .in("id", [...ids]).is("business_unit", null);
  if (uErr) throw new Error(uErr.message);
}
