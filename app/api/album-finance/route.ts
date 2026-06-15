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
    const { supabase } = await import("@/lib/supabase");
    const projectId = req.nextUrl.searchParams.get("projectId");
    if (!projectId) return NextResponse.json({ error: "missing projectId" }, { status: 400 });

    const body = await req.json() as Partial<AlbumFinanceData>;

    const { data: existing } = await supabase
      .from("settings")
      .select("value")
      .eq("key", `album_finance_${projectId}`)
      .maybeSingle();

    const merged: AlbumFinanceData = { ...EMPTY, ...(existing?.value ?? {}), ...body };

    const { error } = await supabase
      .from("settings")
      .upsert({ key: `album_finance_${projectId}`, value: merged }, { onConflict: "key" });

    if (error) throw new Error(error.message);
    return NextResponse.json(merged);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
