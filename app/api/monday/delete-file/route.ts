import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const { assetId } = await req.json();
    if (!assetId || typeof assetId !== "number") {
      return NextResponse.json({ error: "assetId חסר או לא תקין" }, { status: 400 });
    }
    const { deleteFileAsset } = await import("@/lib/monday");
    await deleteFileAsset(assetId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[delete-file]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
