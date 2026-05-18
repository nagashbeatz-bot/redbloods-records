import { NextResponse } from "next/server";

/**
 * PATCH /api/vendor/victor/work/[id]  — update a work record
 * DELETE /api/vendor/victor/work/[id] — delete a work record
 */

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json();
    const { updateVictorWork } = await import("@/lib/vendor-store");
    await updateVictorWork(id, body);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { deleteVictorWork } = await import("@/lib/vendor-store");
    await deleteVictorWork(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
