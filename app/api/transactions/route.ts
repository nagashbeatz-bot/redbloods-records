import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { createTransactionRecord, FinanceInputError, financeOwnersFor, setFinanceSettings } from "@/lib/writes/finance";
import { NeedsBusinessUnitError } from "@/lib/writes/business-unit";
import { ownerUi } from "@/lib/finance/ownership";

/** Adds `owner` (null or { owner, labelHe, whereHe, allowed, canDelete:false }) to each row — computed server-side in ONE batch. */
async function withOwners(rows: Array<Record<string, unknown>> | null) {
  const list = (rows ?? []) as Array<{ id: string; show_id?: string | null; show_money_role?: string | null; linked_session_id?: string | null } & Record<string, unknown>>;
  const owners = await financeOwnersFor(list);
  return list.map((t) => ({ ...t, owner: ownerUi(owners.get(t.id) ?? null) }));
}
import { requireOwner } from "@/lib/require-auth";

// GET /api/transactions?projectId=xxx   → transactions + finance settings for one project
// GET /api/transactions?all=1           → all transactions + all finance settings
export async function GET(req: NextRequest) {
  const unauth = await requireOwner(); if (unauth) return unauth;
  const projectId = req.nextUrl.searchParams.get("projectId");
  const all       = req.nextUrl.searchParams.get("all");

  if (all === "1") {
    // Return all transactions + all finance settings
    const [txRes, settingsRes] = await Promise.all([
      supabase.from("transactions").select("*").order("date", { ascending: false }),
      supabase.from("settings").select("key,value").like("key", "finance_%"),
    ]);
    if (txRes.error)       return NextResponse.json({ error: txRes.error.message },       { status: 500 });
    if (settingsRes.error) return NextResponse.json({ error: settingsRes.error.message }, { status: 500 });

    // Parse settings into { projectId, agreedPrice, currency, financialNotes }
    const settings = (settingsRes.data ?? []).map((row) => ({
      project_id:       row.key.replace("finance_", ""),
      agreedPrice:      (row.value as { agreedPrice?: number })?.agreedPrice    ?? 0,
      currency:         (row.value as { currency?: string })?.currency          ?? "₪",
      financialNotes:   (row.value as { financialNotes?: string })?.financialNotes ?? "",
      financeException: (row.value as { financeException?: boolean })?.financeException ?? false,
      // Clip-deal price — separate from agreedPrice (the song deal). See lib/clip-finance.ts.
      clipAgreedPrice:  (row.value as { clipAgreedPrice?: number })?.clipAgreedPrice ?? 0,
    }));

    return NextResponse.json({ transactions: await withOwners(txRes.data), settings });
  }

  if (!projectId) {
    return NextResponse.json({ error: "projectId required" }, { status: 400 });
  }

  const [txRes, settingsRes] = await Promise.all([
    supabase.from("transactions").select("*").eq("project_id", projectId).order("date", { ascending: false }),
    supabase.from("settings").select("value").eq("key", `finance_${projectId}`).maybeSingle(),
  ]);

  if (txRes.error) return NextResponse.json({ error: txRes.error.message }, { status: 500 });

  const val                = (settingsRes.data?.value ?? {}) as Record<string, unknown>;
  const agreedPrice        = (val.agreedPrice        as number  | undefined) ?? 0;
  const currency           = (val.currency           as string  | undefined) ?? "₪";
  const financialNotes     = (val.financialNotes     as string  | undefined) ?? "";
  const financeException   = (val.financeException   as boolean | undefined) ?? false;
  const financeExceptionReason = (val.financeExceptionReason as string | undefined) ?? "";
  const financeExceptionDate   = (val.financeExceptionDate   as string | undefined) ?? "";
  // Clip-deal price — the price agreed with the artist for the CLIP, kept apart
  // from agreedPrice (the song deal) so clip money never inflates the song.
  const clipAgreedPrice        = (val.clipAgreedPrice        as number  | undefined) ?? 0;

  return NextResponse.json({
    transactions: await withOwners(txRes.data),
    agreedPrice, currency, financialNotes,
    financeException, financeExceptionReason, financeExceptionDate,
    clipAgreedPrice,
  });
}

// POST /api/transactions  → create a new transaction (shared writer lib/writes/finance — also Sunny's ADD_TRANSACTION)
export async function POST(req: NextRequest) {
  const unauth = await requireOwner(); if (unauth) return unauth;
  const body = await req.json();
  const {
    projectId, scope, type, date, description, artist, amount,
    currency, paymentStatus, paymentMethod, receiptRef, notes, category,
    linkedSessionId, expenseScope, businessUnit,
  } = body;
  try {
    // business unit (task 4): the rule decides; without a certain unit the person must choose (422 → the screen asks)
    const data = await createTransactionRecord({ projectId, scope, type, date, description, artist, amount, currency, paymentStatus, paymentMethod, receiptRef, notes, category, linkedSessionId, expenseScope, businessUnit, unitWriter: "FINANCE_MANUAL" });
    return NextResponse.json({ transaction: data });
  } catch (err) {
    if (err instanceof NeedsBusinessUnitError) return NextResponse.json({ error: err.message, code: err.code, reasonHe: err.reasonHe, options: err.options }, { status: 422 });
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    return NextResponse.json({ error: msg }, { status: err instanceof FinanceInputError ? 400 : 500 });
  }
}

// PATCH /api/transactions?projectId=xxx&type=settings  → update finance settings (merged; shared writer)
export async function PATCH(req: NextRequest) {
  const unauth = await requireOwner(); if (unauth) return unauth;
  const projectId = req.nextUrl.searchParams.get("projectId");
  const type      = req.nextUrl.searchParams.get("type");

  if (type !== "settings" || !projectId) {
    return NextResponse.json({ error: "projectId and type=settings required" }, { status: 400 });
  }

  const {
    agreedPrice, currency, financialNotes,
    financeException, financeExceptionReason, financeExceptionDate,
  } = await req.json();
  try {
    const merged = await setFinanceSettings(projectId, { agreedPrice, currency, financialNotes, financeException, financeExceptionReason, financeExceptionDate });
    return NextResponse.json({ ok: true, value: merged });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "שגיאת שרת" }, { status: 500 });
  }
}
