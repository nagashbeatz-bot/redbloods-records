import { NextResponse, type NextRequest } from "next/server";
import { requireOwner } from "@/lib/require-auth";
import { checkSameOriginJson, readSmallJson } from "@/lib/partner/actions/request-guard";

/**
 * /api/partner/approvals — the Owner's screen for Sunny's Brain (T2 approval queue). Owner-only.
 *
 *   GET  — pending requests (exact payload + the hash shown), authorizations with state, open insights / recommendations.
 *          Read with the service client AFTER requireOwner; nothing is written on load. Not installed → NOT_INSTALLED.
 *   POST — { op: "decide", requestId, decision: APPROVED | REJECTED, seenHash, reasonHe? }
 *          { op: "revoke", authorizationId, reasonHe }
 *          { op: "transition", targetKind, targetId, toStatus, reasonHe? }   (ENDORSED / REJECTED / ACCEPTED …)
 *          same-origin JSON only; the RPC runs with the Owner's OWN Supabase session (cookies → his JWT), so the DATABASE
 *          proves him (auth.uid() ∈ owner_approval_principals). requireOwner here is defence in depth, never the proof:
 *          the service role has no EXECUTE on these functions, and nothing here passes a user id, actor or basis.
 */
export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: NO_STORE });

export async function GET() {
  const denied = await requireOwner(); if (denied) return denied;
  const [{ supabase }, { readBrainSnapshot }, { buildOwnerApprovalsView }] = await Promise.all([import("@/lib/supabase"), import("@/lib/brain-store"), import("@/lib/partner/brain/owner-view")]);
  const r = await readBrainSnapshot(supabase as never);
  if (r.status === "NOT_INSTALLED") return json({ status: "NOT_INSTALLED" });
  if (r.status !== "OK") return json({ status: "READ_FAILED" }, 503);
  return json(buildOwnerApprovalsView(r.value, new Date()));
}

const OPS: Record<string, readonly string[]> = {
  decide: ["op", "requestId", "decision", "seenHash", "reasonHe"],
  revoke: ["op", "authorizationId", "reasonHe"],
  transition: ["op", "targetKind", "targetId", "toStatus", "reasonHe"],
};

export async function POST(req: NextRequest) {
  if (checkSameOriginJson(req.headers)) return json({ status: "FORBIDDEN_ORIGIN" }, 403);
  const denied = await requireOwner(); if (denied) return denied;
  const body = await readSmallJson(req);
  if (!body || typeof body !== "object" || Array.isArray(body)) return json({ status: "INVALID", errors: ["body"] }, 400);
  const b = body as Record<string, unknown>;
  const allowed = typeof b.op === "string" ? OPS[b.op] : undefined;
  if (!allowed) return json({ status: "INVALID", errors: ["op: decide | revoke | transition"] }, 400);
  const extra = Object.keys(b).filter((k) => !allowed.includes(k));
  if (extra.length) return json({ status: "INVALID", errors: extra.map((k) => `"${k}" cannot be supplied`) }, 400);
  const [{ createSupabaseServer }, W] = await Promise.all([import("@/lib/supabase-server"), import("@/lib/writes/brain")]);
  const session = (await createSupabaseServer()) as never;   // the Owner's OWN session — the DB proves him
  let r;
  if (b.op === "decide") {
    // a pending authorization whose start date already passed is approved from today (a narrowing; the DB refuses wider)
    let startToday: { payload: Record<string, unknown>; todayIL: string } | null = null;
    if (b.decision === "APPROVED" && typeof b.requestId === "string") {
      const [{ supabase }, { readBrainSnapshot }] = await Promise.all([import("@/lib/supabase"), import("@/lib/brain-store")]);
      const snap = await readBrainSnapshot(supabase as never);
      const q = snap.status === "OK" ? snap.value.approvals?.requests.find((x) => x.id === b.requestId) : undefined;
      const { ilTodayOf } = await import("@/lib/partner/brain/owner-view");
      if (q && q.kind === "TRACKING_AUTHORIZATION" && q.payloadHash === b.seenHash) startToday = { payload: q.payload, todayIL: ilTodayOf(new Date()) };
    }
    r = await W.ownerDecide(session, { requestId: b.requestId, decision: b.decision, seenHash: b.seenHash, reasonHe: b.reasonHe, startToday });
  } else if (b.op === "revoke") r = await W.ownerRevoke(session, { authorizationId: b.authorizationId, reasonHe: b.reasonHe });
  else r = await W.ownerTransition(session, { transition: { targetKind: b.targetKind, targetId: b.targetId, toStatus: b.toStatus, ...(b.reasonHe !== undefined ? { reasonHe: b.reasonHe } : {}) } });
  const status = r.status === "OK" ? 200 : r.status === "INVALID" ? 400 : r.status === "REFUSED" ? (r.code === "OWNER_SESSION_REQUIRED" ? 403 : 409) : r.status === "NOT_INSTALLED" ? 503 : 500;
  return json(r, status);
}
