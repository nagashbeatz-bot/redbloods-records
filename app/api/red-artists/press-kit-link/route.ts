import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/require-auth";
import { getOrCreatePressKitLink } from "@/lib/red-artists/portal-files";
import { SHALEV_SLUG } from "@/lib/red-artists/portal-config";

/**
 * POST /api/red-artists/press-kit-link
 *
 * OWNER ONLY. Returns a Dropbox shared link for Shalev's OWN server-owned
 * press-kit folder so "פתח תיקייה" can open it. The folder is created first
 * (idempotent) — sharing a non-existent folder fails. No client path, no DB.
 */
export async function POST() {
  const denied = await requireOwner(); if (denied) return denied;
  try {
    const shareLink = await getOrCreatePressKitLink(SHALEV_SLUG);
    if (shareLink) return NextResponse.json({ ok: true, shareLink });
    return NextResponse.json({ ok: false, error: "לא ניתן לפתוח את התיקייה כרגע" }, { status: 500 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[red-artists/press-kit-link]", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
