import { NextRequest, NextResponse } from "next/server";
import type { AlbumFinanceData } from "@/lib/types";

const EMPTY: AlbumFinanceData = { agreed: 0, currency: "₪", notes: "", payments: [], expenses: [] };

export async function GET(req: NextRequest) {
  try {
    const { supabase } = await import("@/lib/supabase");
    const projectId = req.nextUrl.searchParams.get("projectId");
    if (!projectId) return NextResponse.json(EMPTY);

    const { data } = await supabase
      .from("settings")
      .select("value")
      .eq("key", `album_finance_${projectId}`)
      .maybeSingle();

    return NextResponse.json(data?.value ?? EMPTY);
  } catch {
    return NextResponse.json(EMPTY);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const projectId = req.nextUrl.searchParams.get("projectId");
    if (!projectId) return NextResponse.json({ error: "missing projectId" }, { status: 400 });
    const body = await req.json() as Record<string, unknown>;
    // shared writer (lib/writes/worklog) — HARDENED: only the five known keys, typed
    const { patchAlbumFinance, AlbumInputError } = await import("@/lib/writes/worklog");
    try {
      return NextResponse.json(await patchAlbumFinance(projectId, body));
    } catch (e) {
      if (e instanceof AlbumInputError) return NextResponse.json({ error: e.message }, { status: 400 });
      throw e;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
