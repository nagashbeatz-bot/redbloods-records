import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getDropboxToken } from "@/lib/dropbox-token";
import { addFileToProject } from "@/lib/projects-store";
import { buildIntake, type IntakeEntry, type IntakeItem } from "@/lib/file-intake";

// ── Dropbox helpers ───────────────────────────────────────────────────────────
async function dbx(token: string, endpoint: string, body: unknown) {
  const res = await fetch(`https://api.dropboxapi.com/2/${endpoint}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, json };
}

function sanitize(s: string): string {
  return s.replace(/[\\:*?"<>|]/g, "-").replace(/\s+/g, " ").trim().slice(0, 80);
}
function formatArtist(artist: string): string {
  const names = (artist || "").split(/[,،;]/).map((s) => s.trim()).filter(Boolean);
  if (names.length === 0) return "Unknown";
  if (names.length <= 2) return names.join(", ");
  return `${names[0]} + Others`;
}
/** Official project delivery folder (same convention as /api/delivery). */
function deliveryPath(artist: string, projectName: string): string {
  return `/${sanitize(formatArtist(artist || "Unknown"))} - ${sanitize(projectName)}/05_Delivery`;
}

// ── POST /api/dropbox/intake ──────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const action = body.action as "scan" | "move";
    const token = await getDropboxToken();

    // ── SCAN: resolve the shared link → list ONLY that folder → categorize ────
    if (action === "scan") {
      const url = (body.url as string ?? "").trim();
      if (!url) return NextResponse.json({ error: "חסר לינק לתיקייה" }, { status: 400 });

      // Resolve the shared link to a path in our account.
      const meta = await dbx(token, "sharing/get_shared_link_metadata", { url });
      if (!meta.ok) {
        return NextResponse.json({ error: "לא ניתן לפענח את הלינק — ודא שזה לינק תקין של תיקיית Dropbox שלנו" }, { status: 400 });
      }
      const m = meta.json as { [".tag"]?: string; path_lower?: string; name?: string };
      if (m[".tag"] !== "folder") {
        return NextResponse.json({ error: "הלינק חייב להצביע על תיקייה (לא קובץ בודד)" }, { status: 400 });
      }
      const rootPath = m.path_lower;
      if (!rootPath) {
        return NextResponse.json({ error: "לא נמצא נתיב לתיקייה — ייתכן שהיא לא בתוך ה-Dropbox שלנו" }, { status: 400 });
      }

      // List the folder (recursive), paging through cursors.
      const entries: IntakeEntry[] = [];
      let resp = await dbx(token, "files/list_folder", { path: rootPath, recursive: true, limit: 2000 });
      if (!resp.ok) return NextResponse.json({ error: "אין גישה לתיקייה / שגיאת Dropbox" }, { status: 400 });
      const collect = (j: { entries?: { [".tag"]?: string; name?: string; path_lower?: string; size?: number }[] }) => {
        (j.entries ?? []).forEach((e) => {
          if (e[".tag"] === "file" && e.path_lower && e.name) {
            entries.push({ path: e.path_lower, name: e.name, size: e.size });
          }
        });
      };
      collect(resp.json);
      let guard = 0;
      while ((resp.json as { has_more?: boolean }).has_more && guard < 50) {
        guard++;
        resp = await dbx(token, "files/list_folder/continue", { cursor: (resp.json as { cursor: string }).cursor });
        if (!resp.ok) break;
        collect(resp.json);
      }

      if (entries.length === 0) {
        return NextResponse.json({ error: "התיקייה ריקה — לא נמצאו קבצים" }, { status: 400 });
      }

      const projectName = (body.projectName as string) || "PROJECT";
      const items = buildIntake(entries, projectName, rootPath);
      return NextResponse.json({ ok: true, count: items.length, rootName: m.name ?? "", items });
    }

    // ── MOVE: move each previewed file into the project delivery folder ────────
    if (action === "move") {
      const projectId = body.projectId as string;
      const items = (body.items as IntakeItem[]) ?? [];
      if (!projectId || items.length === 0) {
        return NextResponse.json({ error: "חסר פרויקט או קבצים" }, { status: 400 });
      }

      const { data: proj } = await supabase.from("projects").select("name, artist").eq("id", projectId).single();
      if (!proj) return NextResponse.json({ error: "פרויקט לא נמצא" }, { status: 404 });
      const target = deliveryPath((proj as { artist: string }).artist, (proj as { name: string }).name);

      // Ensure destination folder exists (ignore conflict).
      await dbx(token, "files/create_folder_v2", { path: target, autorename: false });

      const results: { name: string; ok: boolean; error?: string }[] = [];
      let moved = 0;
      for (const it of items) {
        try {
          const to = `${target}/${it.targetName}`;
          const mv = await dbx(token, "files/move_v2", { from_path: it.path, to_path: to, autorename: true });
          if (!mv.ok) {
            results.push({ name: it.targetName, ok: false, error: (mv.json as { error_summary?: string }).error_summary ?? "move failed" });
            continue;
          }
          const md = (mv.json as { metadata?: { path_display?: string; name?: string } }).metadata;
          const finalPath = md?.path_display ?? to;
          const finalName = md?.name ?? it.targetName;
          // Only record in the project AFTER a successful move.
          await addFileToProject(projectId, {
            name:        finalName,
            url:         `/api/dropbox/stream?path=${encodeURIComponent(finalPath)}`,
            dropboxPath: finalPath,
            category:    it.category,
          });
          moved++;
          results.push({ name: finalName, ok: true });
        } catch (e) {
          results.push({ name: it.targetName, ok: false, error: e instanceof Error ? e.message : "שגיאה" });
        }
      }

      const allOk = moved === items.length;
      return NextResponse.json({ ok: allOk, moved, total: items.length, results });
    }

    return NextResponse.json({ error: "פעולה לא מוכרת" }, { status: 400 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[dropbox/intake]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
