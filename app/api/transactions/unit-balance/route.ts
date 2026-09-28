import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/require-auth";
import { readUnitBalanceInputs } from "@/lib/finance/unit-balance-reader";
import { computeUnitBalance, reconcileArtistPayments } from "@/lib/finance/unit-balance";

export const dynamic = "force-dynamic";

// GET /api/transactions/unit-balance → the ONE money position per business unit (lib/finance/unit-balance) — Owner-only,
// read-only: Cash / expected per unit and currency, Records artist liabilities / available to invest / future entitlements,
// and the artist-payment reconciliation (Finance ↔ ledger).
export async function GET() {
  const unauth = await requireOwner(); if (unauth) return unauth;
  try {
    const inputs = await readUnitBalanceInputs();
    return NextResponse.json({ ok: true, balance: computeUnitBalance(inputs), reconciliation: reconcileArtistPayments(inputs) });
  } catch (err) {
    console.error("[transactions/unit-balance GET]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "שגיאת שרת" }, { status: 500 });
  }
}
