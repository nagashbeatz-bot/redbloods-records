import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, artist, status, deadline, notes, projectType, parentProject } = body;

    if (!name?.trim()) {
      return NextResponse.json({ error: "שם הפרויקט חסר" }, { status: 400 });
    }

    if (!process.env.MONDAY_API_TOKEN) {
      return NextResponse.json({ error: "MONDAY_API_TOKEN not configured" }, { status: 500 });
    }

    const { createProject } = await import("@/lib/monday");
    const newId = await createProject({ name, artist, status, deadline, notes, projectType, parentProject });

    return NextResponse.json({ ok: true, id: newId });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
