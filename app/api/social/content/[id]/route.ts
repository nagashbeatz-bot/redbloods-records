import { NextRequest, NextResponse } from "next/server";
import { getContentItem } from "@/lib/social-store";
import { deleteSocialContentWithFiles, SocialInputError, updateSocialContent } from "@/lib/writes/social";

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
    const item = await updateSocialContent(id, body); // shared writer — validated fields only
    return NextResponse.json({ item });
  } catch (e) {
    if (e instanceof SocialInputError) return NextResponse.json({ error: e.message }, { status: 400 });
    console.error("[social/content/id] PATCH error:", e);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    // shared writer: stored files best-effort, then the row (DB cascade also deletes social_content_files rows)
    await deleteSocialContentWithFiles(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
