import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/require-auth";
import { notifyVictorNewWork } from "@/lib/victor-work-notify";

/**
 * POST /api/vendor/victor/notify-work   body: { workId }
 *
 * OWNER ONLY. Fired ONLY by the "שלח עבודה לויקטור" button in a work's drawer —
 * never automatically (not on load, refresh, work creation, status change or
 * upload). Also excluded from Victor's proxy allowlist (lib/roles.ts) so Victor
 * is blocked before this route even runs; requireOwner is the second layer.
 *
 * Takes ONLY the workId: the server reloads the row and builds both notification
 * texts itself, so the client can never spoof them. The name is read strictly
 * from vendor_project_work.title, with NO fallback — never work.projectName
 * (which resolves to projects.name first), projects.name, artist or
 * dropbox_folder. Victor is deliberately never shown those, so any fallback
 * would leak Artist/Project data into his notification. Missing title → 400 and
 * nothing is sent.
 *
 * Sends push only: no agent_alert, no status / work_state / deadline change.
 */
export async function POST(req: NextRequest) {
  const denied = await requireOwner(); if (denied) return denied;
  try {
    const body   = (await req.json().catch(() => ({}))) as { workId?: string };
    const workId = (body.workId ?? "").trim();
    if (!workId) return NextResponse.json({ ok: false, error: "workId חסר" }, { status: 400 });

    const { supabase } = await import("@/lib/supabase");
    const { data: row } = await supabase
      .from("vendor_project_work")
      .select("id, title, vendor_name, project_id")
      .eq("id", workId)
      .maybeSingle();

    if (!row) return NextResponse.json({ ok: false, error: "עבודה לא נמצאה" }, { status: 404 });
    // Ownership: only Victor's work rows may be sent from here.
    if ((row.vendor_name as string) !== "victor") {
      return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
    }

    // The ONLY source of truth for the name.
    const title = ((row.title as string | null) ?? "").trim();
    if (!title) {
      return NextResponse.json(
        { ok: false, error: "לא ניתן לשלוח — חסר שם עבודה לוויקטור" },
        { status: 400 },
      );
    }

    // project_id links the work to a canonical project (null for standalone work);
    // passed to the OWNER confirmation only — never to Victor's notification.
    const projectId = (row.project_id as string | null) ?? null;
    const result = await notifyVictorNewWork(workId, title, projectId);
    if (!result.ok) {
      const MSG: Record<typeof result.reason, string> = {
        "no-victor-subscription": "ויקטור עדיין לא הפעיל התראות במכשיר שלו",
        "victor-send-failed":     "השליחה לויקטור נכשלה — נסה שוב",
        "push-disabled":          "שליחת Push מושבתת בסביבה זו",
      };
      return NextResponse.json({ ok: false, error: MSG[result.reason] }, { status: 409 });
    }

    return NextResponse.json({ ok: true, victorSent: result.victorSent, ownerSent: result.ownerSent });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[vendor/victor/notify-work]", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
