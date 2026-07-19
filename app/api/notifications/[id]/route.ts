import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServer } from "@/lib/supabase-server";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * PATCH /api/notifications/[id] — mark ONE of the caller's notifications as read.
 *
 * No body. Only read_at is ever written. Idempotent:
 *   • missing OR another user's row → 404 (never reveals which — no ownership leak)
 *   • already read                  → 200, existing readAt kept (no re-stamp)
 *   • unread                        → read_at = now(), 200
 *
 * User-scoped client (session cookies) so RLS (recipient_user_id = auth.uid()) is
 * the final guard — never service-role. The .eq(recipient_user_id) is defence in
 * depth using the server-derived user.id; the client never supplies a user id.
 */
export async function PATCH(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }

  const supabase = await createSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    // RLS scopes this to the caller — a foreign/nonexistent id returns no row.
    const { data: existing, error: selErr } = await supabase
      .from("notifications")
      .select("id, read_at")
      .eq("id", id)
      .eq("recipient_user_id", user.id)
      .maybeSingle();
    if (selErr) {
      console.error("[notifications/:id] PATCH select error:", selErr.message);
      return NextResponse.json({ error: "failed" }, { status: 500 });
    }
    if (!existing) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    if (existing.read_at) {
      // Already read → idempotent no-op, keep the original timestamp.
      return NextResponse.json({ ok: true, id: existing.id, readAt: existing.read_at });
    }

    const readAt = new Date().toISOString();
    const { data: updated, error: updErr } = await supabase
      .from("notifications")
      .update({ read_at: readAt })
      .eq("id", id)
      .eq("recipient_user_id", user.id)
      .is("read_at", null)
      .select("id, read_at")
      .maybeSingle();
    if (updErr) {
      console.error("[notifications/:id] PATCH update error:", updErr.message);
      return NextResponse.json({ error: "failed" }, { status: 500 });
    }
    // updated may be null if a concurrent request marked it read first — still a
    // success (it IS read now); return the timestamp we attempted.
    return NextResponse.json({
      ok: true,
      id: updated?.id ?? id,
      readAt: updated?.read_at ?? readAt,
    });
  } catch (e) {
    console.error("[notifications/:id] PATCH failed:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
