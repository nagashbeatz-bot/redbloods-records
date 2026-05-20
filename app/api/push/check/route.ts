/**
 * POST /api/push/check
 * Called once per app load. Throttled to 30 min server-side.
 * Uses same concise notification format as /api/push/cron.
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendPushToAll } from "@/lib/push";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
);

const THROTTLE_MINUTES = 30;

async function getLastSent(): Promise<Date | null> {
  const { data } = await supabase
    .from("settings")
    .select("value")
    .eq("key", "push_last_check")
    .single();
  if (!data?.value) return null;
  return new Date(data.value as string);
}

async function setLastSent() {
  await supabase.from("settings").upsert(
    { key: "push_last_check", value: new Date().toISOString() },
    { onConflict: "key" },
  );
}

export async function POST(req: NextRequest) {
  try {
    const last = await getLastSent();
    const now  = new Date();
    if (last && (now.getTime() - last.getTime()) / 60000 < THROTTLE_MINUTES) {
      return NextResponse.json({ skipped: true });
    }

    const today = now.toISOString().split("T")[0];
    const notifications: Array<{ title: string; body: string; url: string; tag: string }> = [];

    const { data: projects } = await supabase
      .from("projects")
      .select("id, name, artist, status, deadline")
      .neq("status", "הושלם")
      .neq("status", "בהשהייה");

    const all = projects ?? [];

    // ── Overdue ───────────────────────────────────────────────────────────────
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

    // ── Due soon ──────────────────────────────────────────────────────────────
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

    // ── Sessions today ────────────────────────────────────────────────────────
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

    // ── Overdue payments ──────────────────────────────────────────────────────
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

    await setLastSent();

    let sent = 0;
    for (const n of notifications) {
      await sendPushToAll(n);
      sent++;
    }

    return NextResponse.json({ ok: true, notifications: sent });
  } catch (e) {
    console.error("push check error:", e);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
