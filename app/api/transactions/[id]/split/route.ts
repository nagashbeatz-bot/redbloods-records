import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { touchProject } from "@/lib/projects-store";
import { requireOwner } from "@/lib/require-auth";

// POST /api/transactions/[id]/split
// Atomically splits an EXPECTED income transaction into a received part + a remaining
// expected balance, via the split_income_transaction RPC (single DB transaction,
// row-locked, guarded against double-split). Owner-only.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const unauth = await requireOwner(); if (unauth) return unauth;
  const { id } = await params;

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "גוף הבקשה חסר" }, { status: 400 });

  const paid = Number(body.paidAmount);
  if (!Number.isFinite(paid) || paid <= 0) {
    return NextResponse.json({ error: "סכום ששולם חייב להיות גדול מ-0" }, { status: 400 });
  }
  const receivedDate  = typeof body.receivedDate === "string" && body.receivedDate ? body.receivedDate : null;
  const paymentMethod = typeof body.paymentMethod === "string" ? body.paymentMethod : "";

  const { data, error } = await supabase.rpc("split_income_transaction", {
    p_id: id,
    p_paid: paid,
    p_received_date: receivedDate,
    p_payment_method: paymentMethod,
  });

  if (error) {
    // Map the RPC's custom SQLSTATEs to HTTP status codes.
    const code = error.code;
    const status = code === "TX404" ? 404 : code === "TX409" ? 409 : code === "TX400" ? 400 : 500;
    return NextResponse.json({ error: error.message }, { status });
  }

  // Bump the project's updated_at (parity with the other transaction mutations).
  const { data: tx } = await supabase.from("transactions").select("project_id").eq("id", id).maybeSingle();
  const pid = (tx as { project_id?: string | null } | null)?.project_id;
  if (pid) touchProject(pid).catch(() => {});

  return NextResponse.json({ ok: true, ...(data as Record<string, unknown>) });
}
