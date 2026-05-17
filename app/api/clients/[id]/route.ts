import { NextRequest, NextResponse } from "next/server";
import { getClient, updateClient, deleteClient } from "@/lib/clients-store";
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

    const newName = name.trim();

    // Get old name before updating so we can sync projects
    const existing = await getClient(id);
    const oldName  = existing?.name?.trim() ?? "";
    console.log(`[clients PATCH] id=${id} existing client: ${existing ? `"${existing.name}"` : "null"} → newName="${newName}"`);

    // Update client in Supabase
    await updateClient(id, {
      name:   newName,
      phone:  phone?.trim()  || "",
      email:  email?.trim()  || "",
      type:   type           || "אחר",
      status: status         || "חדש",
      notes:  notes?.trim()  || "",
    });

    // If the name changed — update artist field on all matching projects in Supabase
    console.log(`[clients PATCH] name change detected: "${oldName}" → "${newName}"`);
    if (oldName && oldName !== newName) {
      try {
        // Fetch all projects from Supabase where artist contains oldName
        const { data: allProjects, error: fetchErr } = await supabase
          .from("projects")
          .select("id, name, artist");

        if (fetchErr) throw new Error(fetchErr.message);

        const projects = (allProjects || []) as { id: string; name: string; artist: string }[];
        console.log(`[clients PATCH] fetched ${projects.length} projects from Supabase`);

        // Find projects where artist matches old name
        const toUpdate = projects.filter((p) => {
          if (!p.artist) return false;
          return p.artist
            .split(/[,،;]/)
            .map((a) => a.trim())
            .some((a) => a.toLowerCase() === oldName.toLowerCase());
        });

        console.log(
          `[clients PATCH] projects with artist="${oldName}": ${toUpdate.length}`,
          toUpdate.map((p) => ({ id: p.id, name: p.name, artist: p.artist }))
        );

        // Update each project's artist field
        const results = await Promise.allSettled(
          toUpdate.map(async (p) => {
            const updatedArtist = p.artist
              .split(/[,،;]/)
              .map((a) => a.trim())
              .map((a) => a.toLowerCase() === oldName.toLowerCase() ? newName : a)
              .join(", ");

            console.log(`[clients PATCH] updating project ${p.id} artist: "${p.artist}" → "${updatedArtist}"`);

            const { error } = await supabase
              .from("projects")
              .update({ artist: updatedArtist, updated_at: new Date().toISOString() })
              .eq("id", p.id);

            if (error) throw new Error(error.message);
          })
        );

        const failed = results.filter((r) => r.status === "rejected");
        if (failed.length > 0) {
          const failMsg = (failed[0] as PromiseRejectedResult).reason?.message || "unknown";
          console.error(`[clients PATCH] ${failed.length} project update(s) failed:`, failMsg);
          return NextResponse.json({ ok: true, syncedProjects: toUpdate.length - failed.length, syncWarning: failMsg });
        }

        console.log(`[clients PATCH] synced ${toUpdate.length} project(s) successfully`);
        return NextResponse.json({ ok: true, syncedProjects: toUpdate.length });
      } catch (syncErr) {
        const syncMsg = syncErr instanceof Error ? syncErr.message : "sync error";
        console.error("[clients PATCH] Supabase projects sync failed:", syncMsg);
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
