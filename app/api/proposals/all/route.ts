import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

/**
 * GET /api/proposals/all
 * Returns all proposals with client name joined.
 * Used by Dashboard stats and Insights page.
 */
export async function GET() {
  try {
    const { data, error } = await supabase
      .from("proposals")
      .select("*, clients(name, status)")
      .order("followup_date", { ascending: true, nullsFirst: false });

    if (error) throw new Error(error.message);

    // Flatten client name into each proposal
    const proposals = (data ?? []).map((p) => ({
      ...p,
      client_name:   (p.clients as { name: string; status: string } | null)?.name   ?? "",
      client_status: (p.clients as { name: string; status: string } | null)?.status ?? "",
      clients:       undefined,
    }));

    return NextResponse.json({ proposals });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
