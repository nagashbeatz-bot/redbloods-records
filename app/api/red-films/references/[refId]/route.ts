/**
 * PATCH  /api/red-films/references/[refId]  — עדכון tag בלבד
 * DELETE /api/red-films/references/[refId]  — מחיקה מ-Dropbox ו-DB
 */
import { NextRequest, NextResponse } from "next/server";
import { deleteRfReference, setRfReferenceTag } from "@/lib/writes/redfilms";
import { supabase } from "@/lib/supabase";

type Ctx = { params: Promise<{ refId: string }> };

// ── PATCH — update tag only ───────────────────────────────────────────────
export async function PATCH(req: NextRequest, ctx: Ctx) {
  try {
    const { refId } = await ctx.params;
    const body = await req.json().catch(() => ({}));
    const data = await setRfReferenceTag(refId, body.tag); // shared writer (lib/writes/redfilms)
    return NextResponse.json({ reference: data });
  } catch (e) {
    console.error("[PATCH /api/red-films/references/[refId]]", e);
    return NextResponse.json({ error: "שגיאת שרת" }, { status: 500 });
  }
}

// ── DELETE ────────────────────────────────────────────────────────────────
export async function DELETE(_req: NextRequest, ctx: Ctx) {
  try {
    const { refId } = await ctx.params;

    // Fetch the row first so we have the dropbox_path
    const r = await deleteRfReference(refId); // shared writer (lib/writes/redfilms)
    if (r.kind === "bad") return NextResponse.json({ error: r.error }, { status: r.status });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[DELETE /api/red-films/references/[refId]]", e);
    return NextResponse.json({ error: "שגיאת שרת" }, { status: 500 });
  }
}
