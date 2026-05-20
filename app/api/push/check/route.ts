/**
 * POST /api/push/check
 * Called once per app load. Checks for urgent items and sends push
 * notifications. Uses a "last sent" key in the settings KV table to
 * avoid spamming — at most one batch per 30 minutes.
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
    // Throttle: max once per THROTTLE_MINUTES
    const last = await getLastSent();
    const now = new Date();
    if (last) {
      const diffMin = (now.getTime() - last.getTime()) / 60000;
      if (diffMin < THROTTLE_MINUTES) {
        return NextResponse.json({ skipped: true, nextInMin: Math.ceil(THROTTLE_MINUTES - diffMin) });
      }
    }

    // Load projects
    const { data: projects } = await supabase
      .from("projects")
      .select("id, name, artist, status, deadline")
      .neq("status", "הושלם")
      .neq("status", "בהשהייה");

    if (!projects?.length) {
      return NextResponse.json({ ok: true, notifications: 0 });
    }

    const today = now.toISOString().split("T")[0];
    const notifications: Array<{ title: string; body: string; url: string; tag: string }> = [];

    // ── 1. Overdue projects ──────────────────────────────────────────────────
    const overdue = projects.filter(
      (p) => p.deadline && p.deadline < today,
    );
    if (overdue.length === 1) {
      const p = overdue[0];
      notifications.push({
        title: "⚠ פרויקט עבר דדליין",
        body: `${p.name}${p.artist ? ` — ${p.artist}` : ""} עבר את התאריך`,
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

    // ── 2. Due in 1–3 days ───────────────────────────────────────────────────
    const soon = projects.filter((p) => {
      if (!p.deadline || p.deadline <= today) return false;
      const diff = Math.round(
        (new Date(p.deadline).getTime() - now.getTime()) / 86400000,
      );
      return diff >= 1 && diff <= 3;
    });
    for (const p of soon) {
      const diff = Math.round(
        (new Date(p.deadline!).getTime() - now.getTime()) / 86400000,
      );
      notifications.push({
        title: "⏳ דדליין מתקרב",
        body: `${p.name} — עוד ${diff === 1 ? "יום אחד" : `${diff} ימים`}`,
        url: "/dashboard",
        tag: `soon-${p.id}`,
      });
    }

    // ── 3. Sessions today ────────────────────────────────────────────────────
    const { data: sessions } = await supabase
      .from("sessions")
      .select("id, project_id, date, start_time, projects(name, artist)")
      .eq("date", today)
      .eq("status", "מתוכנן");

    for (const s of sessions ?? []) {
      const proj = Array.isArray(s.projects) ? s.projects[0] : s.projects;
      const name = proj?.name ?? "סשן";
      const artist = proj?.artist ? ` עם ${proj.artist}` : "";
      const time = s.start_time ? ` בשעה ${s.start_time.slice(0, 5)}` : "";
      notifications.push({
        title: "🎵 סשן היום",
        body: `${name}${artist}${time}`,
        url: "/setup/calendar",
        tag: `session-${s.id}`,
      });
    }

    // ── 4. Overdue payments ──────────────────────────────────────────────────
    const { data: txns } = await supabase
      .from("transactions")
      .select("id, project_id, amount, currency, date, projects(name)")
      .eq("type", "income")
      .eq("payment_status", "צפוי")
      .lt("date", today);

    if (txns?.length) {
      const total = txns.reduce((s, t) => s + (t.amount ?? 0), 0);
      const currency = txns[0]?.currency ?? "₪";
      notifications.push({
        title: "💸 תשלום בפיגור",
        body: `${txns.length} תשלום${txns.length > 1 ? "ים" : ""} — סה״כ ${total.toLocaleString("he-IL")} ${currency}`,
        url: "/finance",
        tag: "payments",
      });
    }

    // ── Send all ─────────────────────────────────────────────────────────────
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
