/**
 * GET /api/push/cron?secret=CRON_SECRET
 * Called by Railway Cron on a schedule (e.g. every morning, noon, evening).
 * Sends push notifications for all urgent items — no throttle.
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendPushToAll } from "@/lib/push";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
);

export async function GET(req: NextRequest) {
  // ── Auth: require secret token ──────────────────────────────────────────────
  const secret = req.nextUrl.searchParams.get("secret");
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const now = new Date();
    const today = now.toISOString().split("T")[0];
    const notifications: Array<{ title: string; body: string; url: string; tag: string }> = [];

    // ── 1. Overdue projects ───────────────────────────────────────────────────
    const { data: projects } = await supabase
      .from("projects")
      .select("id, name, artist, status, deadline")
      .neq("status", "הושלם")
      .neq("status", "בהשהייה");

    const overdue = (projects ?? []).filter(
      (p) => p.deadline && p.deadline < today,
    );
    if (overdue.length === 1) {
      notifications.push({
        title: "⚠ פרויקט עבר דדליין",
        body: `${overdue[0].name}${overdue[0].artist ? ` — ${overdue[0].artist}` : ""} עבר את התאריך`,
        url: "/dashboard",
        tag: "overdue",
      });
    } else if (overdue.length > 1) {
      notifications.push({
        title: `⚠ ${overdue.length} פרויקטים עברו דדליין`,
        body: overdue.map((p) => p.name).join(", "),
        url: "/dashboard",
        tag: "overdue",
      });
    }

    // ── 2. Due in 1–3 days ────────────────────────────────────────────────────
    const soon = (projects ?? []).filter((p) => {
      if (!p.deadline || p.deadline <= today) return false;
      const diff = Math.round(
        (new Date(p.deadline).getTime() - now.getTime()) / 86400000,
      );
      return diff >= 1 && diff <= 3;
    });
    if (soon.length > 0) {
      const names = soon.map((p) => {
        const diff = Math.round((new Date(p.deadline!).getTime() - now.getTime()) / 86400000);
        return `${p.name} (${diff === 1 ? "מחר" : `עוד ${diff} ימים`})`;
      });
      notifications.push({
        title: `⏳ ${soon.length} דדליין${soon.length > 1 ? "ים" : ""} מתקרב${soon.length > 1 ? "ים" : ""}`,
        body: names.join(" · "),
        url: "/dashboard",
        tag: "due-soon",
      });
    }

    // ── 3. Sessions today ─────────────────────────────────────────────────────
    const { data: sessions } = await supabase
      .from("sessions")
      .select("id, start_time, projects(name, artist)")
      .eq("date", today)
      .eq("status", "מתוכנן");

    for (const s of sessions ?? []) {
      const proj = Array.isArray(s.projects) ? s.projects[0] : s.projects;
      const name   = proj?.name   ?? "סשן";
      const artist = proj?.artist ? ` עם ${proj.artist}` : "";
      const time   = s.start_time ? ` בשעה ${s.start_time.slice(0, 5)}` : "";
      notifications.push({
        title: "🎵 סשן היום",
        body: `${name}${artist}${time}`,
        url: "/setup/calendar",
        tag: `session-${s.id}`,
      });
    }

    // ── 4. Overdue payments ───────────────────────────────────────────────────
    const { data: txns } = await supabase
      .from("transactions")
      .select("id, amount, currency, projects(name)")
      .eq("type", "income")
      .eq("payment_status", "צפוי")
      .lt("date", today);

    if (txns?.length) {
      const total    = txns.reduce((s, t) => s + (t.amount ?? 0), 0);
      const currency = txns[0]?.currency ?? "₪";
      notifications.push({
        title: "💸 תשלום בפיגור",
        body: `${txns.length} תשלום${txns.length > 1 ? "ים" : ""} — ${total.toLocaleString("he-IL")} ${currency}`,
        url: "/finance",
        tag: "payments",
      });
    }

    // ── Send ──────────────────────────────────────────────────────────────────
    let sent = 0;
    for (const n of notifications) {
      await sendPushToAll(n);
      sent++;
    }

    return NextResponse.json({ ok: true, sent, time: now.toISOString() });
  } catch (e) {
    console.error("cron error:", e);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
