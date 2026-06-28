import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getDropboxToken } from "@/lib/dropbox-token";
import { addFileToProject } from "@/lib/projects-store";
import { buildIntake, type IntakeEntry, type IntakeItem } from "@/lib/file-intake";

// ── Dropbox call helper — captures status + raw body, supports a path-root header.
async function dbx(token: string, endpoint: string, body: unknown, pathRoot?: string) {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  if (pathRoot) headers["Dropbox-API-Path-Root"] = pathRoot;
  const res = await fetch(`https://api.dropboxapi.com/2/${endpoint}`, {
    method: "POST", headers, body: JSON.stringify(body),
  });
  const raw  = await res.text();
  let json: unknown = {};
  try { json = raw ? JSON.parse(raw) : {}; } catch { /* keep raw */ }
  return { ok: res.ok, status: res.status, json, raw };
}

/** Extract a best-effort Dropbox error tag from the parsed body. */
function dbxTag(json: unknown): string {
  const j = (json ?? {}) as { error?: Record<string, unknown> };
  const err = (j.error ?? {}) as Record<string, unknown>;
  const sub = (k: string) => (err[k] as Record<string, unknown> | undefined)?.[".tag"] as string | undefined;
  return (err[".tag"] as string | undefined) ?? sub("shared_link") ?? sub("path") ?? sub("reason") ?? sub("path_lookup") ?? "unknown";
}

/** Current account root info → lets us set Dropbox-API-Path-Root for team spaces. */
async function getRootInfo(token: string): Promise<{ tag: string; root?: string; home?: string } | null> {
  try {
    const r = await dbx(token, "users/get_current_account", null);
    if (!r.ok) return null;
    const ri = (r.json as { root_info?: { [".tag"]?: string; root_namespace_id?: string; home_namespace_id?: string } }).root_info;
    if (!ri) return null;
    return { tag: ri[".tag"] ?? "user", root: ri.root_namespace_id, home: ri.home_namespace_id };
  } catch { return null; }
}

// ── Path helpers ──────────────────────────────────────────────────────────────
function normPath(s: string): string {
  return ("/" + s.replace(/^\/+/, "").replace(/\/+$/, "")).replace(/\/{2,}/g, "/");
}
/** Candidate account paths to try for a home URL: full, double-decoded, and
 *  each of those without its first segment (in case it's a root/workspace name). */
function homeCandidates(decoded: string): string[] {
  const set = new Set<string>();
  const a = normPath(decoded); set.add(a);
  try { const d = decodeURIComponent(decoded); if (d !== decoded) set.add(normPath(d)); } catch { /* ignore */ }
  for (const p of [...set]) {
    const seg = p.replace(/^\//, "").split("/");
    if (seg.length > 1) set.add(normPath(seg.slice(1).join("/")));
  }
  return [...set].filter((p) => p && p !== "/");
}

const SCOPE_HINT = "נדרשים scopes: files.metadata.read · files.content.write · sharing.read. אם השגיאה היא missing_scope / no_permission / 401 → צריך re-auth ב-/setup/dropbox.";

// ── POST /api/dropbox/intake ──────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const action = body.action as "scan" | "move";
    const token = await getDropboxToken();

    // Account root (for team-space path-root). Non-fatal if unavailable.
    const rootInfo = await getRootInfo(token);
    const pathRoot = rootInfo?.tag === "team" && rootInfo.root
      ? JSON.stringify({ ".tag": "root", root: rootInfo.root })
      : undefined;

    // ── SCAN ──────────────────────────────────────────────────────────────────
    if (action === "scan") {
      const url = (body.url as string ?? "").trim();
      if (!url) return NextResponse.json({ error: "חסר לינק לתיקייה" }, { status: 400 });

      const homeMatch = url.match(/dropbox\.com\/home(\/[^?#]*)/i);
      const isHome = !!homeMatch;
      const decodedHome = isHome ? decodeURIComponent(homeMatch![1]) : null;
      console.log("[intake/scan] url-type:", isHome ? "home" : "shared", "rootInfo:", JSON.stringify(rootInfo), "pathRoot?", !!pathRoot);
      if (isHome) console.log("[intake/scan] decoded home path:", decodedHome);

      type Attempt = { label: string; status: number; ok: boolean; tag?: string; raw?: string };
      const attempts: Attempt[] = [];
      let success: { json: unknown } | null = null;
      let usedPathRoot: string | undefined;
      let usedRootPath = "";
      let mode: "path" | "shared_link" = isHome ? "path" : "shared_link";

      const tryCall = async (args: Record<string, unknown>, pr: string | undefined, label: string) => {
        const r = await dbx(token, "files/list_folder", args, pr);
        attempts.push({ label, status: r.status, ok: r.ok, tag: r.ok ? undefined : dbxTag(r.json), raw: r.ok ? undefined : r.raw.slice(0, 2000) });
        console.log(`[intake/scan] attempt "${label}" → ${r.status} ${r.ok ? "OK" : dbxTag(r.json)}`);
        if (!r.ok) console.log(`[intake/scan]   raw: ${r.raw.slice(0, 600)}`);
        return r;
      };

      if (isHome) {
        const cands = homeCandidates(decodedHome!);
        // Try team-root first (if any), then default namespace; each × candidates.
        const roots: (string | undefined)[] = pathRoot ? [pathRoot, undefined] : [undefined];
        outer: for (const pr of roots) {
          for (const p of cands) {
            const r = await tryCall({ path: p, recursive: true, include_media_info: false, include_deleted: false }, pr, `path=${p} root=${pr ? "team" : "default"}`);
            if (r.ok) { success = r; usedPathRoot = pr; usedRootPath = p; break outer; }
          }
        }
      } else {
        const roots: (string | undefined)[] = pathRoot ? [undefined, pathRoot] : [undefined];
        for (const pr of roots) {
          const r = await tryCall({ path: "", recursive: true, include_media_info: false, include_deleted: false, include_has_explicit_shared_members: false, shared_link: { url } }, pr, `shared_link root=${pr ? "team" : "default"}`);
          if (r.ok) { success = r; usedPathRoot = pr; break; }
        }
      }

      if (!success) {
        return NextResponse.json({
          error: "אין גישה לתיקייה — ראה פרטי אבחון.",
          diagnostic: { mode, pastedUrl: url, decodedHomePath: decodedHome, rootInfo, attempts, scopesHint: SCOPE_HINT },
        }, { status: 400 });
      }

      // Page through, categorize.
      const entries: IntakeEntry[] = [];
      let entriesTotal = 0, entriesWithPath = 0;
      let firstSample: unknown = null;
      const collect = (j: { entries?: { [".tag"]?: string; name?: string; path_lower?: string; path_display?: string; size?: number }[] }) => {
        (j.entries ?? []).forEach((e) => {
          if (e[".tag"] !== "file" || !e.name) return;
          entriesTotal++;
          if (firstSample === null) firstSample = e;
          const p = e.path_lower || e.path_display;
          if (p) { entriesWithPath++; entries.push({ path: p, name: e.name, size: e.size }); }
        });
      };
      collect(success.json as Parameters<typeof collect>[0]);
      let cont = success.json as { has_more?: boolean; cursor?: string };
      let guard = 0;
      while (cont.has_more && cont.cursor && guard < 50) {
        guard++;
        const r = await dbx(token, "files/list_folder/continue", { cursor: cont.cursor }, usedPathRoot);
        if (!r.ok) break;
        collect(r.json as Parameters<typeof collect>[0]);
        cont = r.json as { has_more?: boolean; cursor?: string };
      }

      console.log(`[intake/scan] SUCCESS mode=${mode} rootPath="${usedRootPath}" total=${entriesTotal} withPath=${entriesWithPath}`);
      console.log("[intake/scan] sample paths:", entries.slice(0, 3).map((e) => e.path));

      if (entriesTotal === 0) return NextResponse.json({ error: "התיקייה ריקה — לא נמצאו קבצים" }, { status: 400 });
      if (entriesWithPath === 0) {
        return NextResponse.json({
          error: "Dropbox החזיר קבצים אך ללא path להעברה.",
          diagnostic: { mode, sampleEntry: firstSample },
        }, { status: 400 });
      }

      const projectName = (body.projectName as string) || "PROJECT";
      const items = buildIntake(entries, projectName, mode === "path" ? usedRootPath : "");
      // Echo back which path-root the scan used → move reuses it.
      return NextResponse.json({ ok: true, count: items.length, mode, usedTeamRoot: !!usedPathRoot, items });
    }

    // ── MOVE ──────────────────────────────────────────────────────────────────
    if (action === "move") {
      const projectId = body.projectId as string;
      const items = (body.items as IntakeItem[]) ?? [];
      if (!projectId || items.length === 0) {
        return NextResponse.json({ error: "חסר פרויקט או קבצים" }, { status: 400 });
      }

      const { data: proj } = await supabase.from("projects").select("name, artist").eq("id", projectId).single();
      if (!proj) return NextResponse.json({ error: "פרויקט לא נמצא" }, { status: 404 });
      const target = deliveryPath((proj as { artist: string }).artist, (proj as { name: string }).name);

      // Same path-root the account uses (team space → root namespace).
      await dbx(token, "files/create_folder_v2", { path: target, autorename: false }, pathRoot);

      const results: { name: string; ok: boolean; error?: string }[] = [];
      let moved = 0;
      for (const it of items) {
        try {
          const to = `${target}/${it.targetName}`;
          const mv = await dbx(token, "files/move_v2", { from_path: it.path, to_path: to, autorename: true }, pathRoot);
          if (!mv.ok) {
            results.push({ name: it.targetName, ok: false, error: dbxTag(mv.json) + (mv.raw ? ` — ${mv.raw.slice(0, 200)}` : "") });
            continue;
          }
          const md = (mv.json as { metadata?: { path_display?: string; name?: string } }).metadata;
          const finalPath = md?.path_display ?? to;
          const finalName = md?.name ?? it.targetName;
          await addFileToProject(projectId, {
            name: finalName, url: `/api/dropbox/stream?path=${encodeURIComponent(finalPath)}`,
            dropboxPath: finalPath, category: it.category,
          });
          moved++;
          results.push({ name: finalName, ok: true });
        } catch (e) {
          results.push({ name: it.targetName, ok: false, error: e instanceof Error ? e.message : "שגיאה" });
        }
      }
      return NextResponse.json({ ok: moved === items.length, moved, total: items.length, results });
    }

    return NextResponse.json({ error: "פעולה לא מוכרת" }, { status: 400 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[dropbox/intake]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// ── delivery path (same convention as /api/delivery) ──────────────────────────
function sanitize(s: string): string {
  return s.replace(/[\\:*?"<>|]/g, "-").replace(/\s+/g, " ").trim().slice(0, 80);
}
function formatArtist(artist: string): string {
  const names = (artist || "").split(/[,،;]/).map((s) => s.trim()).filter(Boolean);
  if (names.length === 0) return "Unknown";
  if (names.length <= 2) return names.join(", ");
  return `${names[0]} + Others`;
}
function deliveryPath(artist: string, projectName: string): string {
  return `/${sanitize(formatArtist(artist || "Unknown"))} - ${sanitize(projectName)}/05_Delivery`;
}
