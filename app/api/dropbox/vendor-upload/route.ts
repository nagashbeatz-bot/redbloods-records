import { NextRequest, NextResponse } from "next/server";
import { requireVictorAccess, getAuthRole } from "@/lib/require-auth";
import { isWorkId } from "@/lib/victor-scope";
import { uploadVictorWorkFile } from "@/lib/writes/uploads";

export const maxDuration = 300;

/**
 * POST /api/dropbox/vendor-upload
 * Uploads a file to a vendor-specific Dropbox subfolder.
 * Saves the file reference to vendor_project_work.files_sent.
 *
 * FormData: { file, workId, dropboxFolder, subFolder }
 *   workId        ג€” vendor_project_work.id
 *   dropboxFolder ג€” e.g. "Victor/Shalev - HaMida"
 *   subFolder     ג€” "01_From_Redbloods" | "03_Approved"
 */

export async function POST(req: NextRequest) {
  const denied = await requireVictorAccess(); if (denied) return denied;
  try {
    const formData    = await req.formData();
    const file        = formData.get("file")         as File   | null;
    const workId      = formData.get("workId")       as string | null;
    const subFolder   = (formData.get("subFolder") as string | null) ?? "01_From_Redbloods";
    // Optional version tag (e.g. "V3") — one upload batch shares one label so the
    // UI can group a round together. Additive only: absent → behaves as before.
    const versionLabel = (formData.get("versionLabel") as string | null) || undefined;
    // The client's own upfront file count for this upload run (files.length at
    // the moment it started) — drives the immediate-vs-coalesced push decision
    // in queueVictorUploadNotice. Missing/invalid → treated as a solo file.
    const runTotalRaw = Number(formData.get("total") ?? "1");
    const runTotal    = Number.isFinite(runTotalRaw) && runTotalRaw > 0 ? runTotalRaw : 1;

    if (!file || !workId) {
      return NextResponse.json({ error: "׳—׳¡׳¨׳™׳ ׳₪׳¨׳׳˜׳¨׳™׳: file, workId, dropboxFolder" }, { status: 400 });
    }
    if (!isWorkId(workId)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    const role: "owner" | "victor" = (await getAuthRole()) === "owner" ? "owner" : "victor";

    // Shared writer (lib/writes/uploads): the base folder is resolved SERVER-SIDE from the workId, the destination is
    // derived by lib/victor-scope (inside the work folder only, a plain bucket, a sanitized name — anything else 403),
    // the committed path is re-checked, only Victor's work rows accept files, idempotent append, and the batched Owner
    // push ONLY when Victor uploaded.
    const r = await uploadVictorWorkFile(workId, file, { subFolder, role, versionLabel, runTotal });
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    const { fileForVictor } = await import("@/lib/vendor-store");
    // Victor gets the path-free file object (opaque fileRef, no storage path, no share link); the Owner the full entry.
    return NextResponse.json({ ok: true, file: role === "victor" ? { ...fileForVictor(r.newFile), deletable: true } : r.newFile });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "׳©׳’׳™׳׳× ׳©׳¨׳×";
    console.error("[dropbox/vendor-upload]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
