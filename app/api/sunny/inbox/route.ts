import { NextResponse, type NextRequest } from "next/server";
import { requireOwner } from "@/lib/require-auth";
import { checkSameOriginJson, readSmallJson } from "@/lib/partner/actions/request-guard";
import { supabase } from "@/lib/supabase";
import { createOwnerInboxStore, type OwnerInboxClient } from "@/lib/owner-inbox-store";
import { submitOwnerInboxUpdate } from "@/lib/writes/owner-inbox";

/**
 * POST /api/sunny/inbox — "עדכון לסאני" (Dashboard V2): the Owner's short free-text update for Sunny.
 *
 *   body: { body: string (1–1000), requestKey: uuid }
 *
 * Owner-only (requireOwner on top of proxy.ts default-deny), same-origin JSON, small body, strict key whitelist.
 * The ONLY write is one sunny_owner_inbox row through the approved RPC (idempotent by requestKey). The text is stored
 * as OWNER_REPORTED evidence — it never changes a project, client, show, finance row or any canonical record, and it
 * is never a fact by itself. No push, no calendar.
 */
export const dynamic = "force-dynamic";

const ALLOWED_KEYS = ["body", "requestKey"];
const NO_STORE = { "Cache-Control": "no-store" };
const json = (b: unknown, status = 200) => NextResponse.json(b, { status, headers: NO_STORE });

export async function POST(req: NextRequest) {
  const denied = await requireOwner();
  if (denied) return denied;
  if (checkSameOriginJson(req.headers)) return json({ status: "FORBIDDEN_ORIGIN" }, 403);
  const input = await readSmallJson(req);
  if (typeof input !== "object" || input === null || Array.isArray(input)) return json({ status: "INVALID_INPUT", messageHe: "בקשה לא תקינה." }, 400);
  const unknownKeys = Object.keys(input).filter((k) => !ALLOWED_KEYS.includes(k));
  if (unknownKeys.length) return json({ status: "INVALID_INPUT", messageHe: "שדות לא מוכרים בבקשה." }, 400);
  try {
    const store = createOwnerInboxStore(supabase as unknown as OwnerInboxClient);
    const r = await submitOwnerInboxUpdate(store, input as { body: unknown; requestKey: unknown });
    if (r.status === "SAVED") return json({ status: "SAVED", item: { id: r.item.id, createdAt: r.item.createdAt, status: r.item.status } });
    return json(r, r.status === "INVALID_INPUT" ? 400 : r.status === "CONFLICT" ? 409 : 500);
  } catch (err) {
    console.error("[sunny/inbox] failed:", err instanceof Error ? err.message : err);
    return json({ status: "FAILED", messageHe: "השמירה נכשלה — שום דבר לא נשמר." }, 500);
  }
}
