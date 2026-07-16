import { NextRequest, NextResponse } from "next/server";
import { requireVictorAccess, getAuthRole } from "@/lib/require-auth";
import { saveSubscription } from "@/lib/push";

/**
 * POST /api/vendor/victor/push-subscribe — Victor registers his device for Web
 * Push. Lives under /api/vendor/victor/* (already inside Victor's proxy
 * allowlist) and is gated by requireVictorAccess. Saves with role="victor" so
 * these devices receive ONLY Victor-facing notices and NEVER the owner-internal
 * ones (sendPushToAll → role "owner").
 *
 * requireVictorAccess also admits the OWNER, so the concrete role is re-checked:
 * an owner session reaching this endpoint (e.g. while viewing Victor's page) is
 * rejected, so an owner device can never be mislabelled "victor" and start
 * receiving Victor's pushes. Owner subscribes via /api/push/subscribe ("owner").
 *
 * Mirrors app/api/supplier/steven/push-subscribe/route.ts, and matches the
 * payload validation + structured logging of the red-artists (shalev) route:
 * a malformed body is rejected with 400 BEFORE saveSubscription, and every
 * outcome is logged as saved | invalid | rejected | save failed. Logs record
 * only whether an endpoint was present — never the endpoint URL and never the
 * p256dh/auth key material.
 */
export async function POST(req: NextRequest) {
  const denied = await requireVictorAccess(); if (denied) return denied; // 401/403 for non owner/victor
  // Only a real Victor session may create a "victor" device.
  const role = await getAuthRole();
  if (role !== "victor") {
    console.warn(`[vendor/victor/push-subscribe] role=${role ?? "none"} → rejected (victor sessions only)`);
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  let hasEndpoint = false;
  try {
    const sub = await req.json();
    hasEndpoint = !!sub?.endpoint;
    // Reject a malformed body before touching the DB — saveSubscription would
    // throw on missing keys and surface as an opaque 500.
    if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
      console.warn(`[vendor/victor/push-subscribe] role=victor endpoint=${hasEndpoint} → invalid subscription`);
      return NextResponse.json({ ok: false, error: "פרטי המנוי אינם תקינים" }, { status: 400 });
    }
    await saveSubscription(sub, "victor"); // throws if the DB rejected the row
    console.info(`[vendor/victor/push-subscribe] role=victor endpoint=true → saved`);
    return NextResponse.json({ ok: true });
  } catch (e) {
    // Log the REAL reason server-side; return a SAFE message (no DB internals).
    console.error(
      `[vendor/victor/push-subscribe] role=victor endpoint=${hasEndpoint} → save failed:`,
      e instanceof Error ? e.message : e,
    );
    return NextResponse.json({ ok: false, error: "שמירת המנוי נכשלה" }, { status: 500 });
  }
}
