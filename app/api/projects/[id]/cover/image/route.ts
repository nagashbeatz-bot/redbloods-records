import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/require-auth";
import { coverImageResponse } from "@/lib/project-cover-store";

/**
 * GET /api/projects/[id]/cover/image — 302 to a short-lived Dropbox link for the
 * project's custom cover. OWNER ONLY. Artist portals use their own read-only,
 * release-scoped routes (…/project-cover), never this one.
 */
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const denied = await requireOwner(); if (denied) return denied;
  const { id } = await ctx.params;
  return coverImageResponse(id);
}
