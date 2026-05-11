import { NextRequest, NextResponse } from "next/server";

// GET /api/monday/column — returns whether optional columns exist on the board
export async function GET() {
  if (!process.env.MONDAY_API_TOKEN) {
    return NextResponse.json({ projectType: false, parentProject: false });
  }
  const { getOptionalColumnsStatus } = await import("@/lib/monday");
  const status = await getOptionalColumnsStatus();
  return NextResponse.json(status);
}

export async function POST(req: NextRequest) {
  try {
    const { title, columnType } = await req.json();

    if (!title || typeof title !== "string" || title.trim().length === 0) {
      return NextResponse.json({ error: "Missing column title" }, { status: 400 });
    }

    if (!process.env.MONDAY_API_TOKEN) {
      return NextResponse.json({ ok: true, note: "No Monday token — column add skipped" });
    }

    const { addBoardColumn } = await import("@/lib/monday");
    const result = await addBoardColumn(title.trim(), columnType || "text");

    return NextResponse.json({ ok: true, column: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
