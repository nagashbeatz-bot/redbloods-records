import { NextRequest, NextResponse } from "next/server";
import { assertTransactionEditable, deleteTransactionRecord, FinanceInputError, TransactionOwnedError, updateTransactionRecord } from "@/lib/writes/finance";
import { NeedsBusinessUnitError } from "@/lib/writes/business-unit";

// PATCH /api/transactions/[id]  → update a transaction (shared writer lib/writes/finance: field-level; a paid status
// marks a linked clip row שולם)
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  try {
    // ownership guard (lib/finance/ownership): an owned row's money / identity never changes here (409, Hebrew)
    await assertTransactionEditable(id, body ?? {});
    const data = await updateTransactionRecord(id, body);
    return NextResponse.json({ transaction: data });
  } catch (err) {
    if (err instanceof TransactionOwnedError) return NextResponse.json({ error: err.message, code: err.verdict.code, owner: err.verdict.owner, forbidden: err.verdict.forbidden }, { status: 409 });
    if (err instanceof NeedsBusinessUnitError) return NextResponse.json({ error: err.message, code: err.code, reasonHe: err.reasonHe, options: err.options }, { status: 422 });
    if (err instanceof FinanceInputError) return NextResponse.json({ error: err.message }, { status: 400 });
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
    await assertTransactionEditable(id, "delete"); // an owned row is never deleted from Finance (409)
    await deleteTransactionRecord(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof TransactionOwnedError) return NextResponse.json({ error: err.message, code: err.verdict.code, owner: err.verdict.owner }, { status: 409 });
    return NextResponse.json({ error: err instanceof Error ? err.message : "שגיאת שרת" }, { status: 500 });
  }
}
