/**
 * Sunny's view of the unit balance (task 5) — the Finance Brain's raw read adapted to the ONE pure module
 * (lib/finance/unit-balance). No money rule here: the numbers are exactly the Finance screen's.
 */
import { computeUnitBalance, reconcileArtistPayments, type UnitBalance, type ArtistPaymentReconciliation, type UnitLedgerRow, type UnitTx } from "../../finance/unit-balance";
import { reconcileExpenseShares, type ShareReconciliation } from "../../records-expense-share";
import type { FinanceRaw } from "./types";

export function unitInputsFromFinanceRaw(raw: FinanceRaw): { transactions: UnitTx[]; ledger: UnitLedgerRow[]; roster: Array<{ id: string; name: string }>; shows: Array<{ id: string; status: string | null }> } {
  return {
    transactions: raw.transactions.map((t) => ({ id: t.id, type: t.type, amount: t.amount, currency: t.currency, paymentStatus: t.status, businessUnit: t.businessUnit ?? null, category: t.category, linkedSessionId: t.linkedSessionId, showId: t.showId ?? null, showMoneyRole: t.showMoneyRole ?? null, date: t.date })),
    ledger: raw.ledger.map((l, i) => ({ id: l.id ?? `${l.artistId}#${i}`, artistId: l.artistId, entryType: l.entryType, amount: l.amount, sourceTxId: l.sourceTxId, sourceShowId: l.sourceShowId ?? null, note: l.note ?? null })),
    roster: raw.labelArtists,
    shows: raw.shows.map((s) => ({ id: s.id, status: s.status })),
  };
}
/** Task 6 (2026-09-28): every Records expense vs the artists' ledger share — the ONE rule (lib/records-expense-share). */
export function expenseSharesFromFinanceRaw(raw: FinanceRaw): ShareReconciliation {
  const artistText = new Map(raw.projects.map((p) => [p.id, p.artist]));
  return reconcileExpenseShares({
    transactions: raw.transactions.map((t) => ({ id: t.id, type: t.type, amount: t.amount, currency: t.currency, paymentStatus: t.status, businessUnit: t.businessUnit ?? null, category: t.category, expenseScope: t.expenseScope, showId: t.showId ?? null, showMoneyRole: t.showMoneyRole ?? null, projectId: t.projectId })),
    projectArtistText: (id) => artistText.get(id) ?? null,
    ledger: raw.ledger.map((l, i) => ({ id: l.id ?? `${l.artistId}#${i}`, artistId: l.artistId, entryType: l.entryType, amount: l.amount, sourceTxId: l.sourceTxId, note: l.note ?? null, sourceExpenseTxId: l.sourceExpenseTxId ?? null })),
  });
}
export function unitBalanceFromFinanceRaw(raw: FinanceRaw): { balance: UnitBalance; reconciliation: ArtistPaymentReconciliation } {
  const inputs = unitInputsFromFinanceRaw(raw);
  return { balance: computeUnitBalance(inputs), reconciliation: reconcileArtistPayments(inputs) };
}
