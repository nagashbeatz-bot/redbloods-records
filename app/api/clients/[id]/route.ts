import { NextRequest, NextResponse } from "next/server";
import { getClient, updateClient, deleteClient } from "@/lib/clients-store";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const body = await req.json();
    const { name, phone, email, type, status, notes } = body;
    if (!name?.trim()) {
      return NextResponse.json({ error: "שם הלקוח חסר" }, { status: 400 });
    }

    const newName = name.trim();

    // Get old name before updating so we can sync Monday.com projects
    const existing = await getClient(id);
    const oldName  = existing?.name?.trim() ?? "";

    // Update client in Supabase
    await updateClient(id, {
      name:   newName,
      phone:  phone?.trim()  || "",
      email:  email?.trim()  || "",
      type:   type           || "אחר",
      status: status         || "חדש",
      notes:  notes?.trim()  || "",
    });

    // If the name changed — update artist field on all matching Monday.com projects
    if (oldName && oldName !== newName) {
      try {
        const { fetchProjects, updateProjectField } = await import("@/lib/monday");
        const projects = await fetchProjects();

        // Find projects where the artist matches the old client name
        const toUpdate = projects.filter((p) =>
          p.artist
            .split(/[,،;]/)
            .map((a: string) => a.trim())
            .some((a: string) => a.toLowerCase() === oldName.toLowerCase())
        );

        // Update each matching project's artist — replace old name with new name
        await Promise.all(
          toUpdate.map((p) => {
            const updatedArtist = p.artist
              .split(/[,،;]/)
              .map((a: string) => a.trim())
              .map((a: string) =>
                a.toLowerCase() === oldName.toLowerCase() ? newName : a
              )
              .join(", ");
            return updateProjectField(p.id, "artist", updatedArtist);
          })
        );

        return NextResponse.json({ ok: true, syncedProjects: toUpdate.length });
      } catch (syncErr) {
        // Sync failure is non-fatal — client was updated, just log the error
        const syncMsg = syncErr instanceof Error ? syncErr.message : "sync error";
        console.error("[clients PATCH] Monday sync failed:", syncMsg);
        return NextResponse.json({ ok: true, syncWarning: syncMsg });
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[clients PATCH]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    await deleteClient(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[clients DELETE]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
