/**
 * POST /api/push/check — LEGACY (no page calls it; never re-add it to a page load).
 * Owner-only, throttled to 30 min server-side. Parity with /api/push/cron (2026-09-27): the same digest builder and
 * per-day claims (lib/push-digest.ts) — production-only, Israel day, hidden / closed / cancelled / paused projects
 * never overdue, overdue income per currency, each type at most once per Israel day across cron + check, "sent" only
 * after delivery. No summaries and no Victor-stuck push (Owner decision Q3).
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendPushToAll } from "@/lib/push";
import { requireOwner } from "@/lib/require-auth";
import { runOwnerDigest } from "@/lib/push-digest";

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

export async function POST(_req: NextRequest) {
  // Owner-only — a Victor/unknown session can never trigger a push send.
  const denied = await requireOwner(); if (denied) return denied;
  try {
    const last = await getLastSent();
    const now  = new Date();
    if (last && (now.getTime() - last.getTime()) / 60000 < THROTTLE_MINUTES) {
      return NextResponse.json({ skipped: true });
    }
    await setLastSent();
    const run = await runOwnerDigest({ withSummary: false, send: (p) => sendPushToAll(p) });
    return NextResponse.json({ ok: true, notifications: run.sent, pushAllowed: run.pushAllowed, results: run.results });
  } catch (e) {
    console.error("push check error:", e);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
