import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getDropboxToken } from "@/lib/dropbox-token";
import { createDeliveryFolder, deleteDeliveryFolder, DeliveryInputError, setDeliveryStatus } from "@/lib/writes/delivery";

// ─── Helpers ──────────────────────────────────────────────────────────────────

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
  const { projectId, artist, projectName } = await req.json();
  if (!projectId || !projectName) {
    return NextResponse.json({ error: "projectId and projectName required" }, { status: 400 });
  }
  try {
    // shared writer (lib/writes/delivery): frozen folder wins, public share link, status "ready"
    const { folderPath, deliveryLink } = await createDeliveryFolder(projectId, artist ?? "", projectName);
    return NextResponse.json({ ok: true, folderPath, deliveryLink, deliveryStatus: "ready", files: [] });
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
  try {
    const merged = await setDeliveryStatus(projectId, updates); // shared writer — only status + delivered date (hardened)
    return NextResponse.json({ ok: true, value: merged });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "שגיאה" }, { status: e instanceof DeliveryInputError ? 400 : 500 });
  }
}

// ─── DELETE /api/delivery?projectId=xxx ───────────────────────────────────────

export async function DELETE(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get("projectId");
  if (!projectId) {
    return NextResponse.json({ error: "projectId required" }, { status: 400 });
  }
  try {
    await deleteDeliveryFolder(projectId); // shared writer (lib/writes/delivery)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "שגיאה במחיקה" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
