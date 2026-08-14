import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/require-auth";
import type { AlbumPrevInfo } from "@/lib/types";

/**
 * "מידע קודם" — manual historical per-song data (imported from Monday) for a
 * single album/EP. Stored in the existing `settings` table (jsonb) under
 * album_prev_info_<projectId> — NO new table, NO schema change. Completely
 * isolated: never creates transactions, never read by canonical Finance /
 * Dashboard / Insights / Agent. Owner-only.
 */

const EMPTY: AlbumPrevInfo = { rows: [], note: "" };
const key = (projectId: string) => `album_prev_info_${projectId}`;

export async function GET(req: NextRequest) {
  const denied = await requireOwner(); if (denied) return denied;
  try {
    const { supabase } = await import("@/lib/supabase");
    const projectId = req.nextUrl.searchParams.get("projectId");
    if (!projectId) return NextResponse.json(EMPTY);

    const { data } = await supabase
      .from("settings")
      .select("value")
      .eq("key", key(projectId))
      .maybeSingle();

    return NextResponse.json((data?.value as AlbumPrevInfo) ?? EMPTY);
  } catch {
    return NextResponse.json(EMPTY);
  }
}

export async function PATCH(req: NextRequest) {
  const denied = await requireOwner(); if (denied) return denied;
  try {
    const { supabase } = await import("@/lib/supabase");
    const projectId = req.nextUrl.searchParams.get("projectId");
    if (!projectId) return NextResponse.json({ error: "missing projectId" }, { status: 400 });

    const body = (await req.json()) as Partial<AlbumPrevInfo>;

    // Normalize rows — coerce the numeric fields, keep only the stored fields
    // (total/balance are derived on the client and never persisted).
    const rows: AlbumPrevInfo["rows"] = Array.isArray(body.rows)
      ? body.rows.map((r) => ({
          id: String(r?.id ?? crypto.randomUUID()),
          name: typeof r?.name === "string" ? r.name : "",
          costWithoutMix: Number(r?.costWithoutMix) || 0,
          mixMaster: Number(r?.mixMaster) || 0,
          paid: Number(r?.paid) || 0,
        }))
      : [];

    const value: AlbumPrevInfo = {
      rows,
      note: typeof body.note === "string" ? body.note : "",
      updatedAt: new Date().toISOString(),
    };

    const { error } = await supabase
      .from("settings")
      .upsert({ key: key(projectId), value }, { onConflict: "key" });

    if (error) throw new Error(error.message);
    return NextResponse.json(value);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
