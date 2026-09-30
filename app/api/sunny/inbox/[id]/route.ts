import { NextResponse, type NextRequest } from "next/server";
import { requireOwner } from "@/lib/require-auth";
import { checkSameOriginJson, readSmallJson } from "@/lib/partner/actions/request-guard";
import { supabase } from "@/lib/supabase";
import { createOwnerInboxStore, type OwnerInboxClient } from "@/lib/owner-inbox-store";
import { markOwnerInboxItemProcessed } from "@/lib/writes/owner-inbox";

/**
 * PATCH /api/sunny/inbox/[id] — the Owner marks one "עדכון לסאני" item handled (NEW → PROCESSED, processed_via
 * DASHBOARD) with a typed outcome.
 *
 *   body: { outcome: LEARNED_KNOWLEDGE | ACTION_PLANNED | NO_ACTION_NEEDED | DISMISSED, outcomeRef?: string (≤120) }
 *
 * Owner-only, same-origin JSON, strict key whitelist. The ONLY write is the status transition through the approved
 * RPC (refused when the item is missing or already PROCESSED). It records what happened — it never turns the text
 * into a fact; knowledge / actions come only from the existing preview + Owner-approval flows. The text is never
 * edited or deleted.
 */
export const dynamic = "force-dynamic";

const ALLOWED_KEYS = ["outcome", "outcomeRef"];
const NO_STORE = { "Cache-Control": "no-store" };
const json = (b: unknown, status = 200) => NextResponse.json(b, { status, headers: NO_STORE });

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireOwner();
  if (denied) return denied;
  if (checkSameOriginJson(req.headers)) return json({ status: "FORBIDDEN_ORIGIN" }, 403);
  const input = await readSmallJson(req);
  if (typeof input !== "object" || input === null || Array.isArray(input)) return json({ status: "INVALID_INPUT", messageHe: "בקשה לא תקינה." }, 400);
  if (Object.keys(input).some((k) => !ALLOWED_KEYS.includes(k))) return json({ status: "INVALID_INPUT", messageHe: "שדות לא מוכרים בבקשה." }, 400);
  try {
    const { id } = await params;
    const store = createOwnerInboxStore(supabase as unknown as OwnerInboxClient);
    const body = input as { outcome?: unknown; outcomeRef?: unknown };
    const r = await markOwnerInboxItemProcessed(store, "DASHBOARD", { id, outcome: body.outcome, outcomeRef: body.outcomeRef });
    if (r.status === "PROCESSED") return json({ status: "PROCESSED", item: { id: r.item.id, status: r.item.status, processedAt: r.item.processedAt, outcome: r.item.outcome } });
    return json(r, r.status === "INVALID_INPUT" ? 400 : r.status === "CONFLICT" ? 409 : 500);
  } catch (err) {
    console.error("[sunny/inbox/id] failed:", err instanceof Error ? err.message : err);
    return json({ status: "FAILED", messageHe: "העדכון נכשל — שום דבר לא השתנה." }, 500);
  }
}
