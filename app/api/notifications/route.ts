import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServer } from "@/lib/supabase-server";

/**
 * GET /api/notifications — the signed-in user's OWN notifications + unread count.
 *
 * Privacy: uses the user-scoped Supabase client (anon key + session cookies) so
 * Postgres RLS (recipient_user_id = auth.uid()) is the enforcement — NEVER the
 * service-role client. The user id comes only from the session; it is never read
 * from the query string or body. The .eq(recipient_user_id) below is defence in
 * depth (RLS already scopes every row); the value is the server-derived user.id.
 *
 * ?unread=true filters the LIST to read_at IS NULL. unreadCount always reflects
 * ALL of the user's unread rows — independent of that filter and of the 50 cap.
 *
 * ?limit=N / ?before=<ISO createdAt> — additive, optional cursor pagination
 * (Owner's "הצג עוד" in NotificationsBell.tsx). Omitting both keeps the exact
 * original behaviour: newest 50, no cursor. `before` is a strict `created_at <`
 * cutoff (not offset-based), so a notification arriving between page loads can
 * never shift/duplicate an already-fetched page. hasMore is computed by asking
 * for one extra row past `limit` and checking whether it came back — no extra
 * query.
 */
export async function GET(req: NextRequest) {
  const supabase = await createSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const params = new URL(req.url).searchParams;
  const unreadOnly = params.get("unread") === "true";
  const limitParam = Number(params.get("limit"));
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 50) : 50;
  const before = params.get("before");

  try {
    // ── List: newest first, capped at `limit` (default 50 — unchanged for any
    // caller that doesn't pass the new params), optionally unread-only /
    // before a cursor. Fetch one extra row to derive hasMore without a 2nd query. ──
    let listQuery = supabase
      .from("notifications")
      .select("id, title, body, url, tag, project_id, entity_type, entity_id, actor_name, recipient_role, created_at, read_at")
      .eq("recipient_user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(limit + 1);
    if (unreadOnly) listQuery = listQuery.is("read_at", null);
    if (before) listQuery = listQuery.lt("created_at", before);

    const { data: fetched, error: listErr } = await listQuery;
    if (listErr) {
      console.error("[notifications] GET list error:", listErr.message);
      return NextResponse.json({ error: "failed" }, { status: 500 });
    }
    const hasMore = (fetched ?? []).length > limit;
    const rows = hasMore ? (fetched ?? []).slice(0, limit) : (fetched ?? []);

    // ── unreadCount: ALL of the user's unread, independent of filter/limit ──
    const { count, error: countErr } = await supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("recipient_user_id", user.id)
      .is("read_at", null);
    if (countErr) {
      console.error("[notifications] GET count error:", countErr.message);
      return NextResponse.json({ error: "failed" }, { status: 500 });
    }

    const notifications = (rows ?? []).map((r) => ({
      id:            r.id,
      title:         r.title,
      body:          r.body,
      url:           r.url,
      tag:           r.tag,
      projectId:     r.project_id,
      entityType:    r.entity_type,
      entityId:      r.entity_id,
      actorName:     r.actor_name,
      recipientRole: r.recipient_role,
      createdAt:     r.created_at,
      readAt:        r.read_at,
    }));

    return NextResponse.json({ notifications, unreadCount: count ?? 0, hasMore });
  } catch (e) {
    console.error("[notifications] GET failed:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
