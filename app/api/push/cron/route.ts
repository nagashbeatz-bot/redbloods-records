/**
 * GET /api/push/cron?secret=CRON_SECRET
 * Called by Railway Cron on a schedule. Sends push notifications — no throttle.
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendPushToAll } from "@/lib/push";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
);

export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get("secret");
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const now   = new Date();
    const today = now.toISOString().split("T")[0];
    const hour  = now.getUTCHours() + 3; // Israel UTC+3
    const notifications: Array<{ title: string; body: string; url: string; tag: string }> = [];

    // ── Load projects ─────────────────────────────────────────────────────────
    const { data: projects } = await supabase
      .from("projects")
      .select("id, name, artist, status, deadline")
      .neq("status", "הושלם")
      .neq("status", "בהשהייה");

    const all = projects ?? [];

    // ── 1. Overdue ────────────────────────────────────────────────────────────
    const overdue = all.filter((p) => p.deadline && p.deadline < today);
    if (overdue.length === 1) {
      notifications.push({
        title: `⚠ דדליין עבר — ${overdue[0].name}`,
        body: "פתח כדי לראות את הפרויקט ולסדר עדיפויות",
        url: "/dashboard",
        tag: "overdue",
      });
    } else if (overdue.length > 1) {
      notifications.push({
        title: `⚠ דדליין עבר — ${overdue.length} פרויקטים`,
        body: "פתח כדי לראות את הפרויקטים ולסדר עדיפויות",
        url: "/dashboard",
        tag: "overdue",
      });
    }

    // ── 2. Due soon (1–3 days) ────────────────────────────────────────────────
    const soon = all.filter((p) => {
      if (!p.deadline || p.deadline <= today) return false;
      const diff = Math.round((new Date(p.deadline).getTime() - now.getTime()) / 86400000);
      return diff >= 1 && diff <= 3;
    });
    if (soon.length === 1) {
      const diff = Math.round((new Date(soon[0].deadline!).getTime() - now.getTime()) / 86400000);
      notifications.push({
        title: `⏳ דדליין מתקרב: ${soon[0].name}`,
        body: `עוד ${diff === 1 ? "יום אחד" : `${diff} ימים`} — כדאי לבדוק סטטוס`,
        url: "/dashboard",
        tag: "due-soon",
      });
    } else if (soon.length > 1) {
      notifications.push({
        title: `⏳ ${soon.length} דדליינים מתקרבים`,
        body: "פתח כדי לראות מה צריך טיפול השבוע",
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
      const proj   = Array.isArray(s.projects) ? s.projects[0] : s.projects;
      const name   = proj?.name   ?? "סשן";
      const artist = proj?.artist ?? "";
      const time   = s.start_time ? `ב־${s.start_time.slice(0, 5)}` : "היום";
      notifications.push({
        title: `🎵 סשן ${time}`,
        body: artist ? `${artist} — ${name}` : name,
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

    if (txns?.length === 1) {
      const t    = txns[0];
      const proj = Array.isArray(t.projects) ? t.projects[0] : t.projects;
      notifications.push({
        title: "💸 תשלום בפיגור",
        body: `${(t.amount ?? 0).toLocaleString("he-IL")}${t.currency ?? "₪"} — ${proj?.name ?? ""}`,
        url: "/finance",
        tag: "payments",
      });
    } else if ((txns?.length ?? 0) > 1) {
      const total    = (txns ?? []).reduce((s, t) => s + (t.amount ?? 0), 0);
      const currency = txns![0]?.currency ?? "₪";
      notifications.push({
        title: `💸 ${txns!.length} תשלומים בפיגור`,
        body: `סה״כ ${total.toLocaleString("he-IL")}${currency} — פתח כדי לעדכן מה התקבל`,
        url: "/finance",
        tag: "payments",
      });
    }

    // ── 5. Victor stuck ───────────────────────────────────────────────────────
    const { data: stuck } = await supabase
      .from("vendor_project_work")
      .select("id, project_id, sent_date, status, projects(name)")
      .eq("vendor_name", "victor")
      .in("status", ["נשלח לויקטור", "בעבודה אצל ויקטור", "מחכה לקבצים"]);

    const stuckAfterDays = 5;
    const stuckRows = (stuck ?? []).filter((w) => {
      if (!w.sent_date) return false;
      const days = Math.floor((now.getTime() - new Date(w.sent_date).getTime()) / 86400000);
      return days >= stuckAfterDays;
    });

    if (stuckRows.length === 1) {
      const proj = Array.isArray(stuckRows[0].projects) ? stuckRows[0].projects[0] : stuckRows[0].projects;
      notifications.push({
        title: "👥 ויקטור — פרויקט תקוע",
        body: `${proj?.name ?? "פרויקט"} — פעיל מעל ${stuckAfterDays} ימים`,
        url: "/team",
        tag: "victor-stuck",
      });
    } else if (stuckRows.length > 1) {
      notifications.push({
        title: `👥 ויקטור — ${stuckRows.length} פרויקטים תקועים`,
        body: `פתח כדי לבדוק מה צריך טיפול`,
        url: "/team",
        tag: "victor-stuck",
      });
    }

    // ── 6. Morning / Evening summary ──────────────────────────────────────────
    const totalIssues = overdue.length + soon.length + (txns?.length ?? 0) + stuckRows.length;

    if (hour >= 8 && hour < 10 && totalIssues > 0) {
      // Morning — send summary first, then individual alerts
      notifications.unshift({
        title: `בוקר טוב ☀️ — יש ${totalIssues} דבר${totalIssues > 1 ? "ים" : ""} לטיפול`,
        body: [
          overdue.length   ? `${overdue.length} עברו דדליין` : "",
          soon.length      ? `${soon.length} מתקרבים` : "",
          txns?.length     ? `${txns.length} תשלומים` : "",
          stuckRows.length ? `${stuckRows.length} תקועים אצל ויקטור` : "",
        ].filter(Boolean).join(" · "),
        url: "/dashboard",
        tag: "morning-summary",
      });
    } else if (hour >= 19 && hour < 21) {
      notifications.unshift({
        title: "סיכום יום 🌙",
        body: totalIssues > 0
          ? `נשארו ${totalIssues} דבר${totalIssues > 1 ? "ים" : ""} — פתח לראות מה נשאר למחר`
          : "כל הדברים מטופלים — עבודה טובה 🎵",
        url: "/dashboard",
        tag: "evening-summary",
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
