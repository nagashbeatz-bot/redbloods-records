import { NextRequest, NextResponse } from "next/server";
import { splitIncome } from "@/lib/writes/finance";
import { requireOwner } from "@/lib/require-auth";

// POST /api/transactions/[id]/split
// Atomically splits an EXPECTED income transaction into a received part + a remaining
// expected balance, via the split_income_transaction RPC (single DB transaction,
// row-locked, guarded against double-split). Owner-only.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const unauth = await requireOwner(); if (unauth) return unauth;
  const { id } = await params;

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "גוף הבקשה חסר" }, { status: 400 });

  const paid = Number(body.paidAmount);
  if (!Number.isFinite(paid) || paid <= 0) {
    return NextResponse.json({ error: "סכום ששולם חייב להיות גדול מ-0" }, { status: 400 });
  }
  const receivedDate  = typeof body.receivedDate === "string" && body.receivedDate ? body.receivedDate : null;
  const paymentMethod = typeof body.paymentMethod === "string" ? body.paymentMethod : "";

  // Shared writer (lib/writes/finance) — the same atomic RPC Sunny's SPLIT_INCOME uses.
  const r = await splitIncome(id, paid, receivedDate, paymentMethod);
  if (r.status === "error") {
    // Map the RPC's custom SQLSTATEs to HTTP status codes.
    const status = r.code === "TX404" ? 404 : r.code === "TX409" ? 409 : r.code === "TX400" ? 400 : 500;
    return NextResponse.json({ error: r.message }, { status });
  }
  const data = r.result;
  return NextResponse.json({ ok: true, ...(data as Record<string, unknown>) });
}
