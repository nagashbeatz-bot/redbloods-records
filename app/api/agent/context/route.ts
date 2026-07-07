/**
 * GET /api/agent/context
 * Returns full business snapshot as Hebrew text — no secret required.
 * Client-facing version of /api/agent/snapshot for copy-to-clipboard use.
 */
import { NextResponse } from "next/server";
import { buildSnapshot, formatSnapshotAsText } from "@/lib/agent/snapshot";
import { MAI_AI_ENABLED } from "@/lib/feature-flags";

export async function GET() {
  // Kill-switch — no AI context snapshot while the agent is disabled.
  if (!MAI_AI_ENABLED) return NextResponse.json({ disabled: true }, { status: 503 });
  try {
    const snapshot = await buildSnapshot();
    const text     = formatSnapshotAsText(snapshot);
    return new Response(text, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[agent/context]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
