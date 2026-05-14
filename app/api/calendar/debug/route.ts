import { NextResponse } from "next/server";

/**
 * GET /api/calendar/debug
 * Diagnostic endpoint — shows Supabase connection status and token state.
 * Remove or restrict this route after debugging.
 */
export async function GET() {
  const info: Record<string, unknown> = {
    env: {
      SUPABASE_URL:        process.env.SUPABASE_URL ? "✓ set" : "✗ MISSING",
      SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY ? "✓ set" : "✗ MISSING",
      GOOGLE_CLIENT_ID:    process.env.GOOGLE_CLIENT_ID ? "✓ set" : "✗ MISSING",
      GOOGLE_CLIENT_SECRET:process.env.GOOGLE_CLIENT_SECRET ? "✓ set" : "✗ MISSING",
    },
  };

  // Test Supabase connection
  try {
    const { supabase } = await import("@/lib/supabase");

    // Try to read from settings table
    const { data, error } = await supabase
      .from("settings")
      .select("key, updated_at")
      .limit(10);

    if (error) {
      info.supabase = { status: "error", message: error.message, code: error.code };
    } else {
      info.supabase = { status: "ok", rows: data };
    }

    // Try to read the token specifically
    const { data: tokenRow, error: tokenErr } = await supabase
      .from("settings")
      .select("key, updated_at")
      .eq("key", "google_calendar_token")
      .single();

    if (tokenErr) {
      info.token = { status: tokenErr.code === "PGRST116" ? "not found" : "error", code: tokenErr.code, message: tokenErr.message };
    } else {
      info.token = { status: "found", updated_at: tokenRow?.updated_at };
    }
  } catch (err) {
    info.supabase = { status: "exception", message: err instanceof Error ? err.message : String(err) };
  }

  return NextResponse.json(info, { status: 200 });
}
