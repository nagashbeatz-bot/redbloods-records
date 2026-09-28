import "server-only";
/** Read-only inputs of lib/finance/unit-balance (transactions with their unit, the artist ledger, the Records roster, show statuses). */
import { supabase } from "@/lib/supabase";
import type { UnitArtist, UnitLedgerRow, UnitShow, UnitTx } from "./unit-balance";

export async function readUnitBalanceInputs(): Promise<{ transactions: UnitTx[]; ledger: UnitLedgerRow[]; roster: UnitArtist[]; shows: UnitShow[] }> {
  const [tx, led, roster, shows] = await Promise.all([
    supabase.from("transactions").select("id, type, amount, currency, payment_status, business_unit, category, linked_session_id, show_id, show_money_role, artist, date"),
    supabase.from("artist_balance_entries").select("id, artist_id, entry_type, amount, source_tx_id, source_show_id, note"),
    supabase.from("label_artists").select("id, name"),
    supabase.from("shows").select("id, status"),
  ]);
  for (const r of [tx, led, roster, shows]) if (r.error) throw new Error(r.error.message);
  return {
    transactions: (tx.data ?? []).map((t) => ({ id: String(t.id), type: t.type, amount: t.amount, currency: t.currency, paymentStatus: t.payment_status, businessUnit: t.business_unit ?? null, category: t.category, linkedSessionId: t.linked_session_id, showId: t.show_id, showMoneyRole: t.show_money_role, artist: t.artist, date: t.date })),
    ledger: (led.data ?? []).map((e) => ({ id: String(e.id), artistId: String(e.artist_id), entryType: e.entry_type, amount: e.amount, sourceTxId: e.source_tx_id ?? null, sourceShowId: e.source_show_id ?? null, note: e.note ?? null })),
    roster: (roster.data ?? []).map((a) => ({ id: String(a.id), name: String(a.name ?? "") })),
    shows: (shows.data ?? []).map((s) => ({ id: String(s.id), status: s.status ?? null })),
  };
}
