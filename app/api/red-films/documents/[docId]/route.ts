/**
 * DELETE /api/red-films/documents/[docId]
 * Deletes document from Dropbox and removes the row from DB.
 */
import { NextRequest, NextResponse } from "next/server";
import { deleteRfDocument } from "@/lib/writes/redfilms";
import { supabase } from "@/lib/supabase";

type Ctx = { params: Promise<{ docId: string }> };

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  try {
    const { docId } = await ctx.params;

    const r = await deleteRfDocument(docId); // shared writer (lib/writes/redfilms)
    if (r.kind === "bad") return NextResponse.json({ error: r.error }, { status: r.status });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[DELETE /api/red-films/documents/[docId]]", e);
    return NextResponse.json({ error: "שגיאת שרת" }, { status: 500 });
  }
}
