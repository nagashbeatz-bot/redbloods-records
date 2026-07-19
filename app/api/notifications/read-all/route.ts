import { NextResponse } from "next/server";
import { createSupabaseServer } from "@/lib/supabase-server";

/**
 * PATCH /api/notifications/read-all — mark ALL of the caller's unread notifications
 * as read. No body. User-scoped client (session cookies) so RLS scopes the update
 * to the caller's rows — never service-role. Only rows with read_at IS NULL are
 * touched, and only read_at is written. "0 updated" is a normal success (not 404).
 *
 * Note: this static segment takes precedence over the [id] dynamic route, so
 * /api/notifications/read-all never resolves to the [id] handler.
 */
export async function PATCH() {
  const supabase = await createSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const readAt = new Date().toISOString();
  try {
    const { data, error } = await supabase
      .from("notifications")
      .update({ read_at: readAt })
      .eq("recipient_user_id", user.id)
      .is("read_at", null)
      .select("id");
    if (error) {
      console.error("[notifications/read-all] PATCH error:", error.message);
      return NextResponse.json({ error: "failed" }, { status: 500 });
    }
    return NextResponse.json({ ok: true, updated: (data ?? []).length, readAt });
  } catch (e) {
    console.error("[notifications/read-all] PATCH failed:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
