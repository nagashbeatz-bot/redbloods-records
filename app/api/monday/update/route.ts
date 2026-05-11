import { NextRequest, NextResponse } from "next/server";
import type { UpdatableField } from "@/lib/types";

const ALLOWED_FIELDS: UpdatableField[] = [
  "status",
  "deadline",
  "notes",
  "projectType",
  "parentProject",
  "name",
  "artist",
];

export async function POST(req: NextRequest) {
  try {
    const { projectId, field, value } = await req.json();

    if (!projectId || !field || value === undefined) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }

    if (!ALLOWED_FIELDS.includes(field as UpdatableField)) {
      return NextResponse.json({ error: `Invalid field: ${field}` }, { status: 400 });
    }

    if (!process.env.MONDAY_API_TOKEN) {
      return NextResponse.json({ ok: true, note: "No Monday token — update skipped" });
    }

    const { updateProjectField } = await import("@/lib/monday");
    await updateProjectField(projectId, field as UpdatableField, value);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
