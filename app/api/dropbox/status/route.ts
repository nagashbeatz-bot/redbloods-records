import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

/** GET /api/dropbox/status — returns { connected: bool } */
export async function GET() {
  const { data } = await supabase
    .from("settings")
    .select("value")
    .eq("key", "dropbox_tokens")
    .maybeSingle();

  const hasRefreshToken = !!(data?.value as Record<string, unknown> | undefined)?.refresh_token;
  return NextResponse.json({ connected: hasRefreshToken });
}

/** DELETE /api/dropbox/status — revokes and removes stored tokens */
export async function DELETE() {
  try {
    // Load token to revoke it with Dropbox
    const { data } = await supabase
      .from("settings")
      .select("value")
      .eq("key", "dropbox_tokens")
      .maybeSingle();

    const tokens = data?.value as Record<string, unknown> | undefined;
    const accessToken = tokens?.access_token as string | undefined;

    // Revoke the token via Dropbox API (best-effort)
    if (accessToken) {
      await fetch("https://api.dropboxapi.com/2/auth/token/revoke", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
      }).catch(() => {});
    }
  } catch { /* ignore */ }

  // Remove from Supabase
  await supabase.from("settings").delete().eq("key", "dropbox_tokens");

  return NextResponse.json({ ok: true });
}
