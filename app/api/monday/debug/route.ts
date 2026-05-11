import { NextResponse } from "next/server";

// GET /api/monday/debug — shows board columns with types (for diagnostics)
export async function GET() {
  if (!process.env.MONDAY_API_TOKEN) {
    return NextResponse.json({ error: "No Monday token" }, { status: 400 });
  }
  try {
    const { debugColumnMap } = await import("@/lib/monday");
    const result = await debugColumnMap();
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
