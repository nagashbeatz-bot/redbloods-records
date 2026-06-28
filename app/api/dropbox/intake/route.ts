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

    // ── SCAN: list the shared folder DIRECTLY via shared_link (no internal path
    // required) → categorize. Each file's own path_lower/path_display is kept so
    // MOVE can use the entry path (not the folder path). ────────────────────────
    if (action === "scan") {
      const url = (body.url as string ?? "").trim();
      if (!url) return NextResponse.json({ error: "חסר לינק לתיקייה" }, { status: 400 });

      // ── Temporary safe scan logging (no token, no sensitive data) ──
      const isSharedLink = /dropbox\.com\/(scl\/fo|sh|s)\//i.test(url) || /dropbox\.com\//i.test(url);
      console.log("[intake/scan] sharedLink?", isSharedLink);

      // Optional metadata — diagnostics only, NOT required for the flow.
      let rootName = "";
      try {
        const meta = await dbx(token, "sharing/get_shared_link_metadata", { url });
        console.log("[intake/scan] metadata returned?", meta.ok);
        if (meta.ok) {
          const m = meta.json as { [".tag"]?: string; path_lower?: string; path_display?: string; name?: string };
          console.log("[intake/scan] metadata tag:", m[".tag"], "hasPath(lower/display)?", !!(m.path_lower || m.path_display));
          rootName = m.name ?? "";
        }
      } catch { /* non-fatal */ }

      // List via shared_link directly.
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

      let resp = await dbx(token, "files/list_folder", {
        path: "", recursive: true,
        include_media_info: false, include_deleted: false, include_has_explicit_shared_members: false,
        shared_link: { url },
      });
      if (!resp.ok) {
        const summary = (resp.json as { error_summary?: string }).error_summary;
        console.log("[intake/scan] list_folder failed:", summary);
        return NextResponse.json({ error: "אין גישה לתיקייה — ודא שזה לינק תקין לתיקיית Dropbox", detail: summary }, { status: 400 });
      }
      collect(resp.json);
      let guard = 0;
      while ((resp.json as { has_more?: boolean }).has_more && guard < 50) {
        guard++;
        resp = await dbx(token, "files/list_folder/continue", { cursor: (resp.json as { cursor: string }).cursor });
        if (!resp.ok) break;
        collect(resp.json);
      }

      console.log(`[intake/scan] entries total=${entriesTotal} withMovablePath=${entriesWithPath}`);
      console.log("[intake/scan] sample paths:", entries.slice(0, 3).map((e) => e.path));

      if (entriesTotal === 0) {
        return NextResponse.json({ error: "התיקייה ריקה — לא נמצאו קבצים" }, { status: 400 });
      }
      if (entriesWithPath === 0) {
        // Per request: surface a diagnostic with the entry shape, no workaround.
        console.log("[intake/scan] no entry path_lower/path_display — sample entry:", JSON.stringify(firstSample));
        return NextResponse.json({
          error: "Dropbox החזיר קבצים אך ללא path_lower/path_display שניתן להזיז דרך ה-shared link הזה.",
          diagnostic: { entriesTotal, sampleEntry: firstSample },
        }, { status: 400 });
      }

      // rootPath "" → each entry's path (relative to the shared root) is used as-is
      // for Stems detection, e.g. "/stems/lead vocal.wav".
      const projectName = (body.projectName as string) || "PROJECT";
      const items = buildIntake(entries, projectName, "");
      return NextResponse.json({ ok: true, count: items.length, rootName, items });
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
