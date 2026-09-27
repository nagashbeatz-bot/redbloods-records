import { NextResponse } from "next/server";
import { createArtistClients, missingArtistClients } from "@/lib/writes/backfills";

/**
 * GET /api/projects/sync-artists
 *
 * One-shot backfill: reads every project's artist field and upserts
 * all missing artists into the clients table (type = "אמן").
 */
export async function GET() {
  try {
    // shared writer (lib/writes/backfills): names created meanwhile are skipped (no duplicate client)
    const { all, missing } = await missingArtistClients();
    if (all === 0) return NextResponse.json({ ok: true, synced: 0, message: "אין אמנים לסנכרן" });
    const synced = await createArtistClients(missing);
    return NextResponse.json({ ok: true, total: all, existed: all - missing.length, synced, names: missing });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[sync-artists]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
