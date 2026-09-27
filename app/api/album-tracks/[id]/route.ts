import { NextRequest, NextResponse } from "next/server";
import { deleteAlbumTrack, updateAlbumTrack } from "@/lib/writes/worklog";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json() as Record<string, unknown>;

  let data: Record<string, unknown> | null;
  try { data = await updateAlbumTrack(id, body); } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "שגיאה" }, { status: 500 }); }
  if (!data) return NextResponse.json({ error: "אין שדות לעדכון" }, { status: 400 });
  return NextResponse.json(data);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try { await deleteAlbumTrack(id); } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "שגיאה" }, { status: 500 }); }
  return NextResponse.json({ ok: true });
}
