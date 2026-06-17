import { NextRequest, NextResponse } from "next/server";
import { getContentItem, updateContentItem, deleteContentItem } from "@/lib/social-store";
import { listFiles } from "@/lib/social-files-store";
import { getDropboxToken } from "@/lib/dropbox-token";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const item = await getContentItem(id);
    if (!item) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ item });
  } catch (e) {
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await req.json();
    const item = await updateContentItem(id, body);
    return NextResponse.json({ item });
  } catch (e) {
    console.error("[social/content/id] PATCH error:", e);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;

    // Delete associated Dropbox files before removing the DB record
    const files = await listFiles(id);
    if (files.length > 0) {
      try {
        const token = await getDropboxToken();
        await Promise.all(
          files
            .filter((f) => f.dropbox_path)
            .map((f) =>
              fetch("https://api.dropboxapi.com/2/files/delete_v2", {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${token}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({ path: f.dropbox_path }),
              }).catch(() => {})
            )
        );
      } catch {
        // Token error or Dropbox unavailable — continue with DB deletion
      }
    }

    // DB cascade also deletes social_content_files rows
    await deleteContentItem(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
