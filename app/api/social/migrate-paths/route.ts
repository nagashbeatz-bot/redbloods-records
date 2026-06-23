import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { listFilesByCampaign, updateSocialFilePath } from "@/lib/social-files-store";
import { getCampaign } from "@/lib/social-store";
import { createDropboxFolder } from "@/lib/dropbox-folder";

const ADMIN_SECRET = process.env.MIGRATE_SECRET ?? "";

function campaignFolderName(title: string, campaignId: string): string {
  return (
    title
      .trim()
      .replace(/[<>:"/\\|?*]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 60) || `campaign-${campaignId}`
  );
}

function buildNewPath(campaignFolder: string, fileName: string): string {
  return `/Social/${campaignFolder}/Media/${fileName}`;
}

function isAlreadyCorrect(currentPath: string, campaignFolder: string): boolean {
  return currentPath.startsWith(`/Social/${campaignFolder}/Media/`);
}

// GET — dry run: ?secret=xxx
export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get("secret") ?? "";
  if (ADMIN_SECRET && secret !== ADMIN_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 403 });
  }

  // שלוף את כל campaign IDs הייחודיים
  const { supabase } = await import("@/lib/supabase");
  const { data: rows, error } = await supabase
    .from("social_content_files")
    .select("id, campaign_id, dropbox_path, file_name")
    .not("campaign_id", "is", null);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const campaignIds = Array.from(new Set((rows ?? []).map((r: { campaign_id: string }) => r.campaign_id)));

  const results = [];
  let totalNeedsMove = 0;
  let totalAlreadyCorrect = 0;

  for (const campaignId of campaignIds) {
    const campaign = await getCampaign(campaignId);
    const folder = campaignFolderName(campaign?.title ?? "", campaignId);
    const campaignFiles = (rows ?? []).filter((r: { campaign_id: string }) => r.campaign_id === campaignId);

    const fileDetails = campaignFiles.map((f: { id: string; dropbox_path: string; file_name: string }) => {
      const fileName = f.dropbox_path.split("/").pop() ?? f.file_name;
      const newPath = buildNewPath(folder, fileName);
      const needsMove = !isAlreadyCorrect(f.dropbox_path, folder);
      if (needsMove) totalNeedsMove++;
      else totalAlreadyCorrect++;
      return { id: f.id, fileName, currentPath: f.dropbox_path, newPath, needsMove };
    });

    results.push({
      campaignId,
      campaignTitle: campaign?.title ?? "(unknown)",
      campaignFolder: folder,
      files: fileDetails,
    });
  }

  return NextResponse.json({
    dryRun: true,
    campaigns: results,
    summary: { total: (rows ?? []).length, needsMove: totalNeedsMove, alreadyCorrect: totalAlreadyCorrect },
  });
}

// POST — migration אמיתי: body { secret: "..." }
export async function POST(req: NextRequest) {
  let body: { secret?: string } = {};
  try { body = await req.json(); } catch {}
  const secret = body.secret ?? "";
  if (ADMIN_SECRET && secret !== ADMIN_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 403 });
  }

  const { getDropboxToken } = await import("@/lib/dropbox-token");
  const token = await getDropboxToken();

  const { supabase } = await import("@/lib/supabase");
  const { data: rows, error } = await supabase
    .from("social_content_files")
    .select("id, campaign_id, dropbox_path, file_name")
    .not("campaign_id", "is", null);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const campaignIds = Array.from(new Set((rows ?? []).map((r: { campaign_id: string }) => r.campaign_id)));

  let moved = 0;
  let skipped = 0;
  const errors: { id: string; error: string }[] = [];
  const details: { id: string; from: string; to: string; status: string }[] = [];

  for (const campaignId of campaignIds) {
    const campaign = await getCampaign(campaignId);
    const folder = campaignFolderName(campaign?.title ?? "", campaignId);
    const campaignFiles = (rows ?? []).filter((r: { campaign_id: string }) => r.campaign_id === campaignId);

    // צור תיקיות (idempotent)
    try {
      await createDropboxFolder(token, `/Social/${folder}`);
      await createDropboxFolder(token, `/Social/${folder}/Media`);
    } catch {}

    for (const f of campaignFiles as { id: string; dropbox_path: string; file_name: string }[]) {
      const fileName = f.dropbox_path.split("/").pop() ?? f.file_name;
      const newPath = buildNewPath(folder, fileName);

      if (isAlreadyCorrect(f.dropbox_path, folder)) {
        skipped++;
        details.push({ id: f.id, from: f.dropbox_path, to: newPath, status: "already_correct" });
        continue;
      }

      // Dropbox move_v2
      try {
        const moveRes = await fetch("https://api.dropboxapi.com/2/files/move_v2", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from_path: f.dropbox_path,
            to_path: newPath,
            autorename: true,
            allow_shared_folder: false,
            allow_ownership_transfer: false,
          }),
        });

        if (!moveRes.ok) {
          const errBody = await moveRes.json().catch(() => ({})) as { error_summary?: string };
          throw new Error(errBody.error_summary ?? "move failed");
        }

        const moveData = (await moveRes.json()) as { metadata: { path_display: string } };
        const actualNewPath = moveData.metadata.path_display;

        // עדכון DB
        await updateSocialFilePath(f.id, actualNewPath);
        moved++;
        details.push({ id: f.id, from: f.dropbox_path, to: actualNewPath, status: "moved" });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "unknown error";
        errors.push({ id: f.id, error: msg });
        details.push({ id: f.id, from: f.dropbox_path, to: newPath, status: `error: ${msg}` });
      }
    }
  }

  return NextResponse.json({
    dryRun: false,
    moved,
    skipped,
    errors,
    details,
    summary: { total: (rows ?? []).length, moved, skipped, failed: errors.length },
  });
}
