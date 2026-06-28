import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

async function dbx(token: string, endpoint: string, body: unknown, pathRoot?: string) {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  if (pathRoot) headers["Dropbox-API-Path-Root"] = pathRoot;
  const res = await fetch(`https://api.dropboxapi.com/2/${endpoint}`, { method: "POST", headers, body: JSON.stringify(body) });
  const raw = await res.text();
  let json: unknown = {};
  try { json = raw ? JSON.parse(raw) : {}; } catch { /* keep raw */ }
  return { ok: res.ok, status: res.status, json, raw };
}
async function topFolders(token: string, pathRoot?: string): Promise<string[] | { error: string }> {
  const r = await dbx(token, "files/list_folder", { path: "", recursive: false }, pathRoot);
  if (!r.ok) return { error: r.raw.slice(0, 300) };
  return ((r.json as { entries?: { [".tag"]?: string; name?: string }[] }).entries ?? [])
    .filter((e) => e[".tag"] === "folder").map((e) => e.name as string).slice(0, 80);
}

/** GET /api/dropbox/status — { connected }. With ?account=1 also returns the
 *  connected account identity + visible top-level folders (no secrets). */
export async function GET(req: NextRequest) {
  const { data } = await supabase
    .from("settings")
    .select("value")
    .eq("key", "dropbox_tokens")
    .maybeSingle();

  const hasRefreshToken = !!(data?.value as Record<string, unknown> | undefined)?.refresh_token;
  const wantAccount = req.nextUrl.searchParams.get("account") === "1";
  if (!hasRefreshToken || !wantAccount) return NextResponse.json({ connected: hasRefreshToken });

  try {
    const { getDropboxToken } = await import("@/lib/dropbox-token");
    const token = await getDropboxToken();
    const acc = await dbx(token, "users/get_current_account", null);
    const a = (acc.json ?? {}) as {
      email?: string; account_id?: string; name?: { display_name?: string };
      team?: { name?: string }; root_info?: { [".tag"]?: string; root_namespace_id?: string; home_namespace_id?: string };
    };
    const ri = a.root_info;
    const pathRoot = ri?.[".tag"] === "team" && ri.root_namespace_id ? JSON.stringify({ ".tag": "root", root: ri.root_namespace_id }) : undefined;
    const def  = await topFolders(token, undefined);
    const team = pathRoot ? await topFolders(token, pathRoot) : null;
    return NextResponse.json({
      connected: true,
      account: {
        email: a.email ?? null, name: a.name?.display_name ?? null, account_id: a.account_id ?? null,
        team: a.team?.name ?? null, root_info: ri ?? null,
        topFolders: { default: def, teamRoot: team },
      },
    });
  } catch (e) {
    return NextResponse.json({ connected: true, accountError: e instanceof Error ? e.message : "שגיאה" });
  }
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
