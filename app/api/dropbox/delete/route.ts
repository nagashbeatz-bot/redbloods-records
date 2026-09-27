import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/require-auth";

export async function POST(req: NextRequest) {
  const denied = await requireOwner(); if (denied) return denied; // in-route Owner check (the central gate is the first layer)
  try {
    const { dropboxPath, projectId } = await req.json();
    if (!dropboxPath || typeof dropboxPath !== "string") {
      return NextResponse.json({ error: "dropboxPath נדרש" }, { status: 400 });
    }
    if (!projectId || typeof projectId !== "string") {
      return NextResponse.json({ error: "projectId נדרש" }, { status: 400 });
    }
    // Shared writer (lib/writes/files) — HARDENED: the path must be this project's own file / folder; then the
    // artist library is un-linked FIRST (abort on failure), the bytes are deleted, and the record is dropped.
    const { deleteProjectFileByPath, FilePathError } = await import("@/lib/writes/files");
    try {
      await deleteProjectFileByPath(projectId, dropboxPath);
    } catch (e) {
      if (e instanceof FilePathError) return NextResponse.json({ error: e.message }, { status: 403 });
      throw e;
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[dropbox/delete]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
