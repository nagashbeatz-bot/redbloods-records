import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/require-auth";
import { getLabelArtist } from "@/lib/label-artists-store";
import { listArtistBalanceEntries } from "@/lib/artist-balance-store";
import { getBalanceCycleState, cycleClosingLine } from "@/lib/artist-balance-cycles-store";
import { sendPushToRoles } from "@/lib/push";

export const dynamic = "force-dynamic";

/**
 * Manual "send a financial-cycle reminder" — OWNER-ONLY, immediate, one-off (no
 * cron, no scheduling, no idempotency claim — reuses the existing push
 * infrastructure exactly as lib/victor-work-notify.ts does, just with its own
 * copy). Body: { toOwner?: boolean; toArtist?: boolean } — at least one true.
 *
 * The three named portal artists (Shalev / Avi / DJ CLEANTONE) are the only ones
 * with a push-able role today; any other label_artists row has no login/role at
 * all, so "toArtist" is reported as skipped rather than failing the whole request.
 */

// Mirrors the hardcoded portal-name constants already used throughout
// components/red-artists/ArtistPortalPage.tsx (SHALEV_ARTIST / AVI_PORTAL_NAME /
// CLEANTONE_ARTIST_NAME) — kept in lockstep by name, not imported (that file is
// "use client" and isn't meant to be imported from a route handler).
function artistPushRole(artistName: string): string | null {
  if (artistName === "שליו טסמה") return "shalev";
  if (artistName === "אבי מולה") return "avi";
  if (artistName === "DJ CLEANTONE") return "cleantone";
  return null;
}

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const denied = await requireOwner();
  if (denied) return denied;
  try {
    const { id } = await context.params;
    const artist = await getLabelArtist(id);
    if (!artist) return NextResponse.json({ error: "האמן לא נמצא" }, { status: 404 });

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const toOwner = body?.toOwner === true;
    const toArtist = body?.toArtist === true;
    if (!toOwner && !toArtist) {
      return NextResponse.json({ error: "יש לבחור לפחות נמען אחד" }, { status: 400 });
    }

    const entries = await listArtistBalanceEntries(id);
    const state = await getBalanceCycleState(id, entries);
    if (!state.anchorDate || !state.current) {
      return NextResponse.json({ error: "לא הוגדר מחזור כספי עבור אמן זה" }, { status: 400 });
    }
    const c = state.current;
    const closingLine = cycleClosingLine(c.daysUntilClose);
    const dateRange = `${c.startDate.split("-").reverse().join(".")} - ${c.endDate.split("-").reverse().join(".")}`;
    const firstName = artist.name.split(" ")[0];

    let ownerSent = false, artistSent = false, artistSkipped: string | undefined;

    if (toOwner) {
      const results = await sendPushToRoles(["owner"], {
        title: `המחזור הכספי של ${firstName} ${closingLine}`,
        body: dateRange,
        url: `/label/artists/${id}?tab=balance`,
        tag: `financial-cycle-reminder-owner-${id}-${c.index}`,
      });
      ownerSent = results.some((r) => r.status === "fulfilled");
    }

    if (toArtist) {
      const role = artistPushRole(artist.name);
      if (!role) {
        artistSkipped = "לא נמצא ערוץ התראות עבור אמן זה";
      } else {
        const results = await sendPushToRoles([role], {
          title: `המחזור הכספי שלך מול Redbloods ${closingLine}`,
          body: dateRange,
          url: "/red-artists?tab=balance",
          tag: `financial-cycle-reminder-artist-${id}-${c.index}`,
        });
        artistSent = results.some((r) => r.status === "fulfilled");
      }
    }

    return NextResponse.json({ ok: true, ownerSent, artistSent, artistSkipped });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[label/artists/[id]/balance/cycles/remind POST]", msg);
    return NextResponse.json({ error: "שגיאת שרת" }, { status: 500 });
  }
}
