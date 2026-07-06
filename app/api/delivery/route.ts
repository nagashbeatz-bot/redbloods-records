import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getDropboxToken } from "@/lib/dropbox-token";
import { deliveryFolder } from "@/lib/project-paths";

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function createDropboxFolder(token: string, path: string): Promise<void> {
  const res = await fetch("https://api.dropboxapi.com/2/files/create_folder_v2", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ path, autorename: false }),
  });
  if (res.ok) return;

  const err = (await res.json()) as Record<string, unknown>;
  const errObj  = err.error as Record<string, unknown> | undefined;
  const pathErr = errObj?.path as Record<string, unknown> | undefined;
  // "conflict" means it already exists — that's fine
  if (errObj?.[".tag"] === "path" && pathErr?.[".tag"] === "conflict") return;
  throw new Error((err.error_summary as string) ?? "Failed to create Dropbox folder");
}

async function createDropboxShareLink(token: string, path: string): Promise<string> {
  const res = await fetch(
    "https://api.dropboxapi.com/2/sharing/create_shared_link_with_settings",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ path, settings: { requested_visibility: "public" } }),
    }
  );

  if (res.ok) {
    const data = (await res.json()) as { url: string };
    return data.url;
  }

  const err    = (await res.json()) as Record<string, unknown>;
  const errObj = err.error as Record<string, unknown> | undefined;
  if (errObj?.[".tag"] === "shared_link_already_exists") {
    const inner = errObj.shared_link_already_exists as Record<string, unknown> | undefined;
    const url   = (inner?.metadata as Record<string, string> | undefined)?.url;
    if (url) return url;
  }
  throw new Error((err.error_summary as string) ?? "Failed to create share link");
}

async function listDropboxFolder(
  token: string,
  path: string
): Promise<Array<{ name: string; path: string }>> {
  const res = await fetch("https://api.dropboxapi.com/2/files/list_folder", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ path, recursive: false }),
  });
  if (!res.ok) return [];
  const data = (await res.json()) as {
    entries: Array<{ ".tag": string; name: string; path_display: string }>;
  };
  return (data.entries ?? [])
    .filter((e) => e[".tag"] === "file")
    .map((e) => ({ name: e.name, path: e.path_display }));
}

// ─── GET /api/delivery?projectId=xxx  OR  ?all=1 ─────────────────────────────

export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get("projectId");
  const all       = req.nextUrl.searchParams.get("all");

  // Return all delivery states (for ClientDrawer)
  if (all === "1") {
    const { data, error } = await supabase
      .from("settings")
      .select("key, value")
      .like("key", "delivery_%");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const deliveries = (data ?? []).map((row) => {
      const pid = (row.key as string).replace("delivery_", "");
      const val = (row.value ?? {}) as Record<string, unknown>;
      return {
        projectId:      pid,
        folderPath:     (val.folderPath     as string)      ?? "",
        deliveryLink:   (val.deliveryLink   as string)      ?? "",
        deliveryStatus: (val.deliveryStatus as string)      ?? "not_created",
        deliveredAt:    (val.deliveredAt    as string|null) ?? null,
      };
    });
    return NextResponse.json({ deliveries });
  }

  if (!projectId) {
    return NextResponse.json({ error: "projectId required" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("settings")
    .select("value")
    .eq("key", `delivery_${projectId}`)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const val           = (data?.value ?? {}) as Record<string, unknown>;
  const folderPath    = (val.folderPath    as string)      ?? "";
  const deliveryLink  = (val.deliveryLink  as string)      ?? "";
  const deliveryStatus= (val.deliveryStatus as string)     ?? "not_created";
  const deliveredAt   = (val.deliveredAt   as string|null) ?? null;

  // Live file list from Dropbox (if folder exists)
  let files: Array<{ name: string; path: string }> = [];
  if (folderPath) {
    try {
      const token = await getDropboxToken();
      files = await listDropboxFolder(token, folderPath);
    } catch { /* token not configured — skip file listing */ }
  }

  return NextResponse.json({
    delivery: { folderPath, deliveryLink, deliveryStatus, deliveredAt, files },
  });
}

// ─── POST /api/delivery — create delivery folder ──────────────────────────────
// Body: { projectId, artist, projectName }

export async function POST(req: NextRequest) {
  let token: string;
  try {
    token = await getDropboxToken();
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Dropbox לא מחובר" }, { status: 500 });
  }

  const { projectId, artist, projectName } = await req.json();
  if (!projectId || !projectName) {
    return NextResponse.json({ error: "projectId and projectName required" }, { status: 400 });
  }

  // Frozen folder (projects.dropbox_folder) wins so a rename never relocates the
  // Delivery folder; falls back to the body's name only when not yet frozen.
  const { getProject } = await import("@/lib/projects-store");
  const frozen = (await getProject(projectId))?.dropboxFolder ?? null;
  const folderPath = deliveryFolder(artist ?? "", projectName, projectId, frozen);

  try {
    await createDropboxFolder(token, folderPath);
    const deliveryLink = await createDropboxShareLink(token, folderPath);

    await supabase.from("settings").upsert(
      {
        key: `delivery_${projectId}`,
        value: {
          folderPath,
          deliveryLink,
          deliveryStatus: "ready",
          deliveredAt:    null,
        },
      },
      { onConflict: "key" }
    );

    return NextResponse.json({
      ok: true, folderPath, deliveryLink, deliveryStatus: "ready", files: [],
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[delivery POST]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// ─── PATCH /api/delivery — update delivery status ─────────────────────────────
// Body: { projectId, deliveryStatus?, deliveredAt? }

export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const { projectId, ...updates } = body;
  if (!projectId) {
    return NextResponse.json({ error: "projectId required" }, { status: 400 });
  }

  const { data: existing } = await supabase
    .from("settings")
    .select("value")
    .eq("key", `delivery_${projectId}`)
    .maybeSingle();

  const current = (existing?.value ?? {}) as Record<string, unknown>;
  const merged  = { ...current, ...updates };

  const { error } = await supabase
    .from("settings")
    .upsert({ key: `delivery_${projectId}`, value: merged }, { onConflict: "key" });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, value: merged });
}

// ─── DELETE /api/delivery?projectId=xxx ───────────────────────────────────────

export async function DELETE(req: NextRequest) {
  let token: string;
  try {
    token = await getDropboxToken();
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Dropbox לא מחובר" }, { status: 500 });
  }

  const projectId = req.nextUrl.searchParams.get("projectId");
  if (!projectId) {
    return NextResponse.json({ error: "projectId required" }, { status: 400 });
  }

  // Get current folder path
  const { data } = await supabase
    .from("settings")
    .select("value")
    .eq("key", `delivery_${projectId}`)
    .maybeSingle();

  const val        = (data?.value ?? {}) as Record<string, unknown>;
  const folderPath = (val.folderPath as string) ?? "";

  // Delete from Dropbox (if folder was created)
  if (folderPath) {
    const delRes = await fetch("https://api.dropboxapi.com/2/files/delete_v2", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ path: folderPath }),
    });

    if (!delRes.ok) {
      let errJson: Record<string, unknown> = {};
      try { errJson = await delRes.json(); } catch {}
      const errObj = errJson.error as Record<string, unknown> | undefined;
      const tag    = errObj?.[".tag"] as string | undefined;
      // "path_lookup" means folder doesn't exist — that's fine (already deleted)
      if (tag !== "path_lookup") {
        const errPath = errObj?.path_lookup as Record<string, unknown> | undefined;
        if (errPath?.[".tag"] !== "not_found") {
          console.error("[delivery DELETE] Dropbox error:", errJson);
          return NextResponse.json({ error: "שגיאה במחיקה מ-Dropbox" }, { status: 500 });
        }
      }
    }
  }

  // Reset settings to not_created
  const { error } = await supabase.from("settings").upsert(
    { key: `delivery_${projectId}`, value: { deliveryStatus: "not_created" } },
    { onConflict: "key" }
  );

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
