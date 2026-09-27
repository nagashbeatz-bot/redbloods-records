/**
 * Shared writer for the Delivery INTAKE (moved verbatim from POST /api/dropbox/intake, 2026-09-27 — file channel):
 * scan a client's folder link (shared link or the account's /home link), classify the files (lib/file-intake), move
 * them into the project's canonical Delivery folder (add + autorename — nothing is overwritten) and optionally delete
 * the emptied "FINAL DELIVERABLES" source. The route (Owner-checked) and Sunny's IMPORT_DELIVERY_FROM_LINK both call
 * runIntake; Sunny never sees a path — only names / categories — and plans the move of exactly what the scan listed.
 */
export type IntakeResult = { status: number; json: any }; // eslint-disable-line @typescript-eslint/no-explicit-any
import { supabase } from "@/lib/supabase";
import { getDropboxToken } from "@/lib/dropbox-token";
import { addFileToProject } from "@/lib/projects-store";
import { buildIntake, type IntakeEntry, type IntakeItem } from "@/lib/file-intake";
import { deliveryFolder } from "@/lib/project-paths";

// ── Dropbox call helper — status + raw body, optional path-root header. ────────
async function dbx(token: string, endpoint: string, body: unknown, pathRoot?: string) {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  if (pathRoot) headers["Dropbox-API-Path-Root"] = pathRoot;
  const res = await fetch(`https://api.dropboxapi.com/2/${endpoint}`, { method: "POST", headers, body: JSON.stringify(body) });
  const raw = await res.text();
  let json: unknown = {};
  try { json = raw ? JSON.parse(raw) : {}; } catch { /* keep raw */ }
  return { ok: res.ok, status: res.status, json, raw };
}

function dbxTag(json: unknown): string {
  const j = (json ?? {}) as { error?: Record<string, unknown> };
  const err = (j.error ?? {}) as Record<string, unknown>;
  const sub = (k: string) => (err[k] as Record<string, unknown> | undefined)?.[".tag"] as string | undefined;
  return (err[".tag"] as string | undefined) ?? sub("shared_link") ?? sub("path") ?? sub("reason") ?? sub("path_lookup") ?? "unknown";
}

async function getRootInfo(token: string): Promise<{ tag: string; root?: string; home?: string } | null> {
  try {
    const r = await dbx(token, "users/get_current_account", null);
    if (!r.ok) return null;
    const ri = (r.json as { root_info?: { [".tag"]?: string; root_namespace_id?: string; home_namespace_id?: string } }).root_info;
    if (!ri) return null;
    return { tag: ri[".tag"] ?? "user", root: ri.root_namespace_id, home: ri.home_namespace_id };
  } catch { return null; }
}

/** Top-level folder names the token can see at a root (no files, no secrets). */
async function listTopLevel(token: string, pathRoot?: string): Promise<{ ok: boolean; folders?: string[]; status?: number; tag?: string; raw?: string }> {
  const r = await dbx(token, "files/list_folder", { path: "", recursive: false, include_media_info: false, include_deleted: false }, pathRoot);
  if (!r.ok) return { ok: false, status: r.status, tag: dbxTag(r.json), raw: r.raw.slice(0, 600) };
  const names = ((r.json as { entries?: { [".tag"]?: string; name?: string }[] }).entries ?? [])
    .filter((e) => e[".tag"] === "folder").map((e) => e.name as string).slice(0, 80);
  return { ok: true, folders: names };
}

function normPath(s: string): string {
  return ("/" + s.replace(/^\/+/, "").replace(/\/+$/, "")).replace(/\/{2,}/g, "/");
}
function homeCandidates(decoded: string): string[] {
  const set = new Set<string>();
  set.add(normPath(decoded));
  try { const d = decodeURIComponent(decoded); if (d !== decoded) set.add(normPath(d)); } catch { /* ignore */ }
  for (const p of [...set]) {
    const seg = p.replace(/^\//, "").split("/");
    if (seg.length > 1) set.add(normPath(seg.slice(1).join("/")));
  }
  return [...set].filter((p) => p && p !== "/");
}

type Collected = { entries: IntakeEntry[]; total: number; withPath: number; firstSample: unknown };
function makeCollector(c: Collected) {
  return (j: { entries?: { [".tag"]?: string; name?: string; path_lower?: string; path_display?: string; size?: number }[] }, queue?: string[]) => {
    (j.entries ?? []).forEach((e) => {
      if (e[".tag"] === "folder") { if (queue && e.path_lower) queue.push(e.path_lower); return; }
      if (e[".tag"] !== "file" || !e.name) return;
      c.total++;
      if (c.firstSample === null) c.firstSample = e;
      const p = e.path_lower || e.path_display;
      if (p) { c.withPath++; c.entries.push({ path: p, name: e.name, size: e.size }); }
    });
  };
}

const SCOPE_HINT = "נדרשים scopes: files.metadata.read · files.content.write · sharing.read. אם missing_scope / no_permission / 401 → re-auth ב-/setup/dropbox.";

// ── POST /api/dropbox/intake ──────────────────────────────────────────────────
export async function runIntake(body: Record<string, unknown>): Promise<IntakeResult> {
  try {
    const action = body.action as "scan" | "move" | "diag" | "delete-source";
    const token = await getDropboxToken();

    const rootInfo = await getRootInfo(token);
    const pathRoot = rootInfo?.tag === "team" && rootInfo.root ? JSON.stringify({ ".tag": "root", root: rootInfo.root }) : undefined;

    // ── DIAG: show what the token can see (top-level folders). ─────────────────
    if (action === "diag") {
      const defaultRoot = await listTopLevel(token, undefined);
      const teamRoot    = pathRoot ? await listTopLevel(token, pathRoot) : null;
      console.log("[intake/diag] rootInfo:", JSON.stringify(rootInfo), "default:", JSON.stringify(defaultRoot), "team:", JSON.stringify(teamRoot));
      return ({ status: 200, json: { ok: true, rootInfo, defaultRoot, teamRoot, scopesHint: SCOPE_HINT } });
    }

    // ── SCAN ──────────────────────────────────────────────────────────────────
    if (action === "scan") {
      const url = (body.url as string ?? "").trim();
      if (!url) return ({ status: 400, json: { error: "חסר לינק לתיקייה" } });

      const homeMatch = url.match(/dropbox\.com\/home(\/[^?#]*)/i);
      const isHome = !!homeMatch;
      const decodedHome = isHome ? decodeURIComponent(homeMatch![1]) : null;
      console.log("[intake/scan] type:", isHome ? "home" : "shared", "rootInfo:", JSON.stringify(rootInfo), "pathRoot?", !!pathRoot, isHome ? `home:${decodedHome}` : "");

      type Attempt = { label: string; status: number; ok: boolean; tag?: string; raw?: string };
      const attempts: Attempt[] = [];
      const c: Collected = { entries: [], total: 0, withPath: 0, firstSample: null };
      const collect = makeCollector(c);
      let usedPathRoot: string | undefined;
      let usedRootPath = "";
      const mode: "path" | "shared_link" = isHome ? "path" : "shared_link";

      if (isHome) {
        // ── Account-path mode (recursive supported) ──
        const cands = homeCandidates(decodedHome!);
        const roots: (string | undefined)[] = pathRoot ? [pathRoot, undefined] : [undefined];
        let ok = false;
        outer: for (const pr of roots) {
          for (const p of cands) {
            const r = await dbx(token, "files/list_folder", { path: p, recursive: true, include_media_info: false, include_deleted: false }, pr);
            attempts.push({ label: `path=${p} root=${pr ? "team" : "default"}`, status: r.status, ok: r.ok, tag: r.ok ? undefined : dbxTag(r.json), raw: r.ok ? undefined : r.raw.slice(0, 1200) });
            console.log(`[intake/scan] path "${p}" root=${pr ? "team" : "default"} → ${r.status} ${r.ok ? "OK" : dbxTag(r.json)}`);
            if (r.ok) {
              collect(r.json as Parameters<typeof collect>[0]);
              let cont = r.json as { has_more?: boolean; cursor?: string }; let g = 0;
              while (cont.has_more && cont.cursor && g < 50) { g++; const cr = await dbx(token, "files/list_folder/continue", { cursor: cont.cursor }, pr); if (!cr.ok) break; collect(cr.json as Parameters<typeof collect>[0]); cont = cr.json as { has_more?: boolean; cursor?: string }; }
              ok = true; usedPathRoot = pr; usedRootPath = p; break outer;
            }
          }
        }
        if (!ok) {
          // Active diagnostic: what folders does the token actually see at root?
          const defaultRoot = await listTopLevel(token, undefined);
          const teamRoot    = pathRoot ? await listTopLevel(token, pathRoot) : null;
          return ({ status: 400, json: {
            error: "הנתיב לא נמצא (path/not_found). בדוק את ה-root listing באבחון — ייתכן שה-Dropbox מחובר לחשבון אחר, או שהאפליקציה היא App-Folder ולא Full Dropbox.",
            diagnostic: { mode, pastedUrl: url, decodedHomePath: decodedHome, triedPaths: cands, rootInfo, attempts, rootListing: { defaultRoot, teamRoot }, scopesHint: SCOPE_HINT },
          } });
        }
      } else {
        // ── Shared-link mode: recursive NOT supported → manual BFS ──
        // Resolve the shared folder's ACCOUNT path so entry paths become
        // absolute (and therefore movable). Available now that the folder lives
        // inside our app folder.
        let sharedRoot = "";
        try {
          const meta = await dbx(token, "sharing/get_shared_link_metadata", { url });
          if (meta.ok) sharedRoot = (meta.json as { path_lower?: string }).path_lower ?? "";
          console.log("[intake/scan] shared metadata path_lower:", sharedRoot || "(none)");
        } catch { /* non-fatal */ }

        const roots: (string | undefined)[] = pathRoot ? [undefined, pathRoot] : [undefined];
        let chosen: string | undefined;
        // Pick a root that can list the top level ("").
        let topOk = false;
        for (const pr of roots) {
          const r = await dbx(token, "files/list_folder", { path: "", recursive: false, include_media_info: false, include_deleted: false, include_has_explicit_shared_members: false, shared_link: { url } }, pr);
          attempts.push({ label: `shared top root=${pr ? "team" : "default"}`, status: r.status, ok: r.ok, tag: r.ok ? undefined : dbxTag(r.json), raw: r.ok ? undefined : r.raw.slice(0, 1200) });
          console.log(`[intake/scan] shared top root=${pr ? "team" : "default"} → ${r.status} ${r.ok ? "OK" : dbxTag(r.json)}`);
          if (r.ok) {
            chosen = pr; topOk = true; usedPathRoot = pr;
            const queue: string[] = [];
            collect(r.json as Parameters<typeof collect>[0], queue);
            let cont = r.json as { has_more?: boolean; cursor?: string }; let g = 0;
            while (cont.has_more && cont.cursor && g < 50) { g++; const cr = await dbx(token, "files/list_folder/continue", { cursor: cont.cursor }, pr); if (!cr.ok) break; collect(cr.json as Parameters<typeof collect>[0], queue); cont = cr.json as { has_more?: boolean; cursor?: string }; }
            // BFS into subfolders (recursive:false per call). When listing via a
            // shared_link, `path` must be RELATIVE to the link root — entries'
            // path_lower can come back absolute (under the account), so strip the
            // shared folder's account path first or the sub-listing 404s silently.
            const srLower = sharedRoot.toLowerCase();
            const relForLink = (p: string) => (srLower && p.toLowerCase().startsWith(srLower) ? (p.slice(srLower.length) || "") : p);
            const seen = new Set<string>([""]); let folders = 0;
            while (queue.length && folders < 300) {
              const p = queue.shift()!; if (seen.has(p)) continue; seen.add(p); folders++;
              const sr = await dbx(token, "files/list_folder", { path: relForLink(p), recursive: false, shared_link: { url } }, pr);
              if (!sr.ok) { attempts.push({ label: `shared sub "${p}"`, status: sr.status, ok: false, tag: dbxTag(sr.json), raw: sr.raw.slice(0, 400) }); continue; }
              collect(sr.json as Parameters<typeof collect>[0], queue);
              let sc = sr.json as { has_more?: boolean; cursor?: string }; let sg = 0;
              while (sc.has_more && sc.cursor && sg < 50) { sg++; const cr = await dbx(token, "files/list_folder/continue", { cursor: sc.cursor }, pr); if (!cr.ok) break; collect(cr.json as Parameters<typeof collect>[0], queue); sc = cr.json as { has_more?: boolean; cursor?: string }; }
            }
            break;
          }
        }
        if (!topOk) {
          return ({ status: 400, json: {
            error: "אין גישה ל-shared link — ראה אבחון.",
            diagnostic: { mode, pastedUrl: url, rootInfo, attempts, scopesHint: SCOPE_HINT },
          } });
        }
        void chosen;
        // Make entry paths absolute under the shared folder's account path so move works.
        if (sharedRoot) {
          const sr = sharedRoot.toLowerCase();
          c.entries = c.entries.map((e) => ({ ...e, path: e.path.toLowerCase().startsWith(sr) ? e.path : normPath(sharedRoot + e.path) }));
          usedRootPath = sharedRoot;
        }
      }

      console.log(`[intake/scan] SUCCESS mode=${mode} rootPath="${usedRootPath}" total=${c.total} withPath=${c.withPath}`);
      console.log("[intake/scan] sample paths:", c.entries.slice(0, 3).map((e) => e.path));

      if (c.total === 0) return ({ status: 400, json: { error: "התיקייה ריקה — לא נמצאו קבצים" } });
      if (c.withPath === 0) {
        return ({ status: 400, json: { error: "Dropbox החזיר קבצים אך ללא path להעברה.", diagnostic: { mode, sampleEntry: c.firstSample } } });
      }

      const projectName = (body.projectName as string) || "PROJECT";
      const items = buildIntake(c.entries, projectName, usedRootPath);
      // sourcePath = the scanned folder's account path (e.g. the FINAL DELIVERABLES
      // folder). Returned so the modal can optionally delete it after a full move.
      return ({ status: 200, json: { ok: true, count: items.length, mode, usedTeamRoot: !!usedPathRoot, items, sourcePath: usedRootPath } });
    }

    // ── DELETE-SOURCE ───────────────────────────────────────────────────────────
    // Owner deletes the original FINAL DELIVERABLES source folder AFTER a fully
    // successful intake. Hard safety: only a folder whose own name is exactly
    // "FINAL DELIVERABLES" (never a parent), and only when it holds no remaining
    // files (the intake already moved them out).
    if (action === "delete-source") {
      const raw = (body.sourcePath as string ?? "").trim();
      const sourcePath = raw.replace(/\/+$/, "");
      if (!sourcePath || !sourcePath.startsWith("/")) {
        return ({ status: 400, json: { error: "missing/invalid sourcePath" } });
      }
      const base = sourcePath.slice(sourcePath.lastIndexOf("/") + 1).trim().toLowerCase();
      if (base !== "final deliverables") {
        // Never delete Mix 5 / DELIVERABLES / Steven / any parent folder.
        console.log(`[intake/delete-source] REFUSED — not FINAL DELIVERABLES: ${sourcePath}`);
        return ({ status: 400, json: { error: "not_final_deliverables" } });
      }

      // List recursively — block if ANY file remains (un-intaked content).
      let entries: { [".tag"]?: string }[] = [];
      const ls = await dbx(token, "files/list_folder", { path: sourcePath, recursive: true, include_deleted: false }, pathRoot);
      if (!ls.ok) {
        return ({ status: 400, json: { error: `list failed: ${dbxTag(ls.json)}` } });
      }
      entries = (ls.json as { entries?: { [".tag"]?: string }[] }).entries ?? [];
      let cont = ls.json as { has_more?: boolean; cursor?: string }; let g = 0;
      while (cont.has_more && cont.cursor && g < 50) {
        g++;
        const cr = await dbx(token, "files/list_folder/continue", { cursor: cont.cursor }, pathRoot);
        if (!cr.ok) break;
        entries.push(...((cr.json as { entries?: { [".tag"]?: string }[] }).entries ?? []));
        cont = cr.json as { has_more?: boolean; cursor?: string };
      }
      if (entries.some((e) => e[".tag"] === "file")) {
        return ({ status: 200, json: { ok: false, hasFiles: true } });
      }

      const del = await dbx(token, "files/delete_v2", { path: sourcePath }, pathRoot);
      if (!del.ok) {
        console.log(`[intake/delete-source] delete failed tag=${dbxTag(del.json)} path=${sourcePath} raw=${del.raw.slice(0, 300)}`);
        return ({ status: 400, json: { error: `delete failed: ${dbxTag(del.json)}` } });
      }
      console.log(`[intake/delete-source] deleted ${sourcePath}`);
      return ({ status: 200, json: { ok: true } });
    }

    // ── MOVE ──────────────────────────────────────────────────────────────────
    if (action === "move") {
      const projectId = body.projectId as string;
      const items = (body.items as IntakeItem[]) ?? [];
      if (!projectId || items.length === 0) return ({ status: 400, json: { error: "חסר פרויקט או קבצים" } });

      const { data: proj } = await supabase.from("projects").select("name, artist, dropbox_folder").eq("id", projectId).single();
      if (!proj) return ({ status: 404, json: { error: "פרויקט לא נמצא" } });
      // Canonical target — same place manual delivery uploads go. The frozen
      // dropbox_folder wins so a rename never relocates the Delivery folder:
      // /Projects/{primaryArtist}/{projectName}/Delivery (+ /ערוצים for stems).
      const target = deliveryFolder((proj as { artist: string }).artist, (proj as { name: string }).name, projectId, (proj as { dropbox_folder: string | null }).dropbox_folder);

      await dbx(token, "files/create_folder_v2", { path: target, autorename: false }, pathRoot);
      // Pre-create any sub-folders (e.g. ערוצים). If it already exists, Dropbox
      // returns a conflict we ignore — files are merged into it and per-file
      // move uses autorename, so nothing is ever overwritten.
      const subdirs = new Set(items.map((it) => it.targetDir).filter(Boolean));
      for (const sd of subdirs) {
        await dbx(token, "files/create_folder_v2", { path: `${target}/${sd}`, autorename: false }, pathRoot);
      }

      const results: { name: string; ok: boolean; error?: string }[] = [];
      let moved = 0;
      for (const it of items) {
        try {
          const to = it.targetDir ? `${target}/${it.targetDir}/${it.targetName}` : `${target}/${it.targetName}`;
          const mv = await dbx(token, "files/move_v2", { from_path: it.path, to_path: to, autorename: true }, pathRoot);
          if (!mv.ok) {
            console.log(`[intake/move] FAILED tag=${dbxTag(mv.json)} from=${it.path} to=${to} raw=${mv.raw.slice(0, 400)}`);
            results.push({ name: it.targetName, ok: false, error: `${dbxTag(mv.json)} | from_path=${it.path} | ${mv.raw.slice(0, 500)}` });
            continue;
          }
          const md = (mv.json as { metadata?: { path_display?: string; name?: string } }).metadata;
          const finalPath = md?.path_display ?? to;
          const finalName = md?.name ?? it.targetName;
          await addFileToProject(projectId, { name: finalName, url: `/api/dropbox/stream?path=${encodeURIComponent(finalPath)}`, dropboxPath: finalPath, category: it.category });
          moved++;
          results.push({ name: finalName, ok: true });
        } catch (e) {
          results.push({ name: it.targetName, ok: false, error: e instanceof Error ? e.message : "שגיאה" });
        }
      }
      // `deliveryPath` lets the modal offer "open folder / copy client link" via
      // the existing /api/dropbox/folder-link endpoint.
      return ({ status: 200, json: { ok: moved === items.length, moved, total: items.length, results, deliveryPath: target } });
    }

    return ({ status: 400, json: { error: "פעולה לא מוכרת" } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[dropbox/intake]", msg);
    return ({ status: 500, json: { error: msg } });
  }
}

// ── Sunny's view of an intake: names + categories only (the paths stay inside this module) ──
type ScanOk = { ok: true; files: Array<{ name: string; category: string; folder: string }>; digest: string; items: IntakeItem[]; sourcePath: string };
async function scan(url: string, projectName: string): Promise<ScanOk | { ok: false; error: string }> {
  const r = await runIntake({ action: "scan", url, projectName });
  if (r.status !== 200 || !r.json?.ok) return { ok: false, error: String(r.json?.error ?? "scan failed") };
  const items = (r.json.items ?? []) as IntakeItem[];
  const files = items.map((it) => ({ name: String(it.targetName), category: String(it.category ?? ""), folder: String(it.targetDir ?? "") }));
  const { createHash } = await import("node:crypto");
  const digest = createHash("sha256").update(JSON.stringify(items.map((it) => [it.path, it.targetName, it.targetDir, it.category]))).digest("hex").slice(0, 16);
  return { ok: true, files, digest, items, sourcePath: String(r.json.sourcePath ?? "") };
}
export async function previewIntakeLink(url: string, projectName: string) {
  const s = await scan(url, projectName);
  return s.ok ? { ok: true as const, files: s.files, digest: s.digest } : s;
}
/** Scan again (the plan fingerprinted the digest), move exactly those files, optionally delete the emptied FINAL DELIVERABLES source. */
export async function importIntakeLink(projectId: string, url: string, projectName: string, deleteEmptySource: boolean): Promise<{ moved: number; total: number; sourceDeleted: boolean }> {
  const s = await scan(url, projectName);
  if (!s.ok) throw new Error(s.error);
  const mv = await runIntake({ action: "move", projectId, items: s.items });
  if (mv.status !== 200) throw new Error(String(mv.json?.error ?? "move failed"));
  let sourceDeleted = false;
  if (deleteEmptySource && mv.json?.ok && s.sourcePath) {
    const del = await runIntake({ action: "delete-source", sourcePath: s.sourcePath });
    sourceDeleted = del.status === 200 && del.json?.ok === true;
  }
  return { moved: Number(mv.json?.moved ?? 0), total: Number(mv.json?.total ?? 0), sourceDeleted };
}
