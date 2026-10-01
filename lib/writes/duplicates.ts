/**
 * Shared READ for pre-write duplicate awareness (POLISH FIX #1, 2026-09-27). SELECT only — never writes, deletes or merges.
 *
 * One focused, context-bound query per record kind (the row id is read only so the engine can leave out records created by earlier steps of the SAME plan): exact equality on the context (artist / project / show / budget
 * line / general) + type + currency + amount; at most 20 rows, newest first. The matching (date window, description
 * similarity) is pure: lib/partner/act/primitives/duplicates.ts. No global scan, no fuzzy amount, no AI.
 */
import { supabase } from "@/lib/supabase";
import type { DupQuery, DupRow } from "@/lib/partner/act/primitives/duplicates";

const LIMIT = 20;
const txt = (...xs: Array<string | null | undefined>) => xs.map((x) => (x ?? "").trim()).filter(Boolean).join(" · ");
function must<T>(r: { data: T[] | null; error: { message: string } | null }): T[] {
  if (r.error) throw new Error(r.error.message); // a read failure is never "no duplicates"
  return r.data ?? [];
}

export async function similarRecords(q: DupQuery): Promise<DupRow[]> {
  switch (q.kind) {
    case "LEDGER_ENTRY": {
      const rows = must(await supabase.from("artist_balance_entries").select("id, entry_date, amount, description, note").eq("artist_id", q.artistId).eq("entry_type", q.entryType).eq("amount", q.amount).order("entry_date", { ascending: false }).limit(LIMIT));
      return (rows as Array<{ id: string; entry_date: string | null; amount: number | string; description: string | null; note: string | null }>).map((r) => ({ id: String(r.id), date: r.entry_date, amount: Number(r.amount), currency: null, text: txt(r.description, r.note) }));
    }
    case "TRANSACTION": {
      let s = supabase.from("transactions").select("id, date, amount, currency, description, notes").eq("type", q.type).eq("amount", q.amount).eq("currency", q.currency);
      s = q.projectId ? s.eq("project_id", q.projectId) : s.is("project_id", null);
      const rows = must(await s.order("date", { ascending: false }).limit(LIMIT));
      return (rows as Array<{ id: string; date: string | null; amount: number; currency: string | null; description: string | null; notes: string | null }>).map((r) => ({ id: String(r.id), date: r.date, amount: Number(r.amount), currency: r.currency, text: txt(r.description, r.notes) }));
    }
    case "MEDIA_INCOME": {
      const rows = must(await supabase.from("label_media_income").select("id, received_date, created_at, gross_amount, report_period, source, notes, record_type, status").eq("label_artist_id", q.artistId).eq("gross_amount", q.grossAmount).order("created_at", { ascending: false }).limit(LIMIT));
      return (rows as Array<{ id: string; received_date: string | null; created_at: string; gross_amount: number; report_period: string; source: string; notes: string; record_type: string; status: string }>)
        .filter((r) => r.record_type !== "reversal" && r.status !== "בוטל")
        .map((r) => ({ id: String(r.id), date: r.received_date ?? r.created_at, amount: Number(r.gross_amount), currency: null, text: txt(r.report_period, r.notes) })); // the source ("Mobile1") is shared by most rows — never a similarity signal
    }
    case "RF_PAYMENT": {
      const rows = must(await supabase.from("red_films_budget_payments").select("id, payment_date, amount, currency, notes, payment_method").eq("budget_item_id", q.budgetLineId).eq("amount", q.amount).order("payment_date", { ascending: false }).limit(LIMIT));
      return (rows as Array<{ id: string; payment_date: string | null; amount: number; currency: string | null; notes: string | null; payment_method: string | null }>).map((r) => ({ id: String(r.id), date: r.payment_date, amount: Number(r.amount), currency: r.currency, text: txt(r.notes) })); // the payment method is shared by most rows — never a similarity signal
    }
  }
}
