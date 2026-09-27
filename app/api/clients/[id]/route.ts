import { NextRequest, NextResponse } from "next/server";
import { getClient } from "@/lib/clients-store";
import { deleteClientRecord, saveClient } from "@/lib/writes/clients";
import { supabase } from "@/lib/supabase";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/clients/[id] — returns client + any projects that reference their name
export async function GET(_req: NextRequest, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const client = await getClient(id);
    if (!client) return NextResponse.json({ error: "לא נמצא" }, { status: 404 });

    const { data: allProjects } = await supabase
      .from("projects")
      .select("id, name, artist");

    const linkedProjects = ((allProjects ?? []) as { id: string; name: string; artist: string }[])
      .filter((p) =>
        (p.artist || "")
          .split(/[,،;]/)
          .map((a) => a.trim())
          .some((a) => a.toLowerCase() === client.name.toLowerCase())
      )
      .map((p) => ({ id: p.id, name: p.name }));

    return NextResponse.json({ client, linkedProjects });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const body = await req.json();
    const { name, phone, email, type, status, notes } = body;
    if (!name?.trim()) {
      return NextResponse.json({ error: "שם הלקוח חסר" }, { status: 400 });
    }
    // Shared writer (lib/writes/clients): full-record save + the project-artist rename cascade — exactly as before.
    const r = await saveClient(id, { name, phone, email, type, status, notes });
    return NextResponse.json({ ok: true, ...r });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[clients PATCH]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    await deleteClientRecord(id); // shared writer: proposals (+ their follow-up tasks) first
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[clients DELETE]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
