import { NextRequest, NextResponse } from "next/server";
import { deleteTransactionRecord, updateTransactionRecord } from "@/lib/writes/finance";

// PATCH /api/transactions/[id]  → update a transaction (shared writer lib/writes/finance: field-level; a paid status
// marks a linked clip row שולם)
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  try {
    const data = await updateTransactionRecord(id, body);
    return NextResponse.json({ transaction: data });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "שגיאת שרת" }, { status: 500 });
  }
}

// DELETE /api/transactions/[id]  (shared writer)
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    await deleteTransactionRecord(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "שגיאת שרת" }, { status: 500 });
  }
}
