/**
 * GET /api/agent/snapshot?secret=CRON_SECRET&format=text
 * Returns full business snapshot — JSON or formatted Hebrew text
 */
import { NextRequest, NextResponse } from "next/server";
import { buildSnapshot, formatSnapshotAsText } from "@/lib/agent/snapshot";

export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get("secret");
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const snapshot = await buildSnapshot();
    const format   = req.nextUrl.searchParams.get("format");

    if (format === "text") {
      const text = formatSnapshotAsText(snapshot);
      return new Response(text, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
    }

    return NextResponse.json({ snapshot });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[agent/snapshot]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
