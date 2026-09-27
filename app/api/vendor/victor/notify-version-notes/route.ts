import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/require-auth";
import { sendVictorVersionNotes } from "@/lib/writes/victor";
import type { VersionReview } from "@/lib/types";

/**
 * POST /api/vendor/victor/notify-version-notes   body: { workId, versionKey }
 *
 * OWNER ONLY. Fired ONLY by the "שלח לויקטור" button on a single version's notes —
 * never automatically (not on load, refresh, draft save, work edit or upload).
 * Also excluded from Victor's proxy allowlist (lib/roles.ts) so Victor is blocked
 * before this route even runs; requireOwner is the second layer.
 *
 * Sends the currently-SAVED notes of ONE version (the owner saves the draft first;
 * this route never trusts client-supplied note text). On a successful push it
 * snapshots the notes into `sentNotes` and stamps `sentAt` on that version's
 * review (version_reviews jsonb — NO schema change), which is exactly what makes
 * the notes visible to Victor and drives the "נשלח לויקטור · date" / "שינויים
 * שלא נשלחו" status. If Victor has no device the DB is left untouched and the
 * caller surfaces the reason. Sends push only: no status / work_state / deadline
 * change, and never touches the brief ("קרא אותי קודם").
 *
 * Two pushes leave here, to two different audiences: Victor's (English, no
 * project identity) and the owner's own confirmation (Hebrew, with the project
 * name). The owner's is sent only after Victor's succeeded — see
 * lib/victor-version-notes-notify.ts.
 */
export async function POST(req: NextRequest) {
  const denied = await requireOwner(); if (denied) return denied;
  try {
    const body       = (await req.json().catch(() => ({}))) as { workId?: string; versionKey?: string };
    const workId     = (body.workId ?? "").trim();
    const versionKey = (body.versionKey ?? "").trim();
    if (!workId || !versionKey) {
      return NextResponse.json({ ok: false, error: "workId/versionKey חסר" }, { status: 400 });
    }

    // Shared writer (lib/writes/victor) — the same one Sunny's SEND_VICTOR_VERSION_NOTES uses.
    const r = await sendVictorVersionNotes(workId, versionKey);
    if (!r.ok) {
      if (r.reason === "not_found") return NextResponse.json({ ok: false, error: "עבודה לא נמצאה" }, { status: 404 });
      if (r.reason === "forbidden") return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
      if (r.reason === "no_title") return NextResponse.json({ ok: false, error: "לא ניתן לשלוח — חסר שם עבודה לוויקטור" }, { status: 400 });
      if (r.reason === "no_notes") return NextResponse.json({ ok: false, error: "אין הערות לשליחה בגרסה זו" }, { status: 400 });
      const MSG: Record<string, string> = {
        "no-victor-subscription": "ויקטור עדיין לא הפעיל התראות במכשיר שלו",
        "victor-send-failed":     "השליחה לויקטור נכשלה — נסה שוב",
        "push-disabled":          "שליחת Push מושבתת בסביבה זו",
      };
      return NextResponse.json({ ok: false, error: MSG[r.reason] ?? r.reason }, { status: 409 });
    }
    return NextResponse.json({ ok: true, review: r.review, victorSent: r.victorSent });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[vendor/victor/notify-version-notes]", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
