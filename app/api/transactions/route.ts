import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// GET /api/transactions?projectId=xxx   → transactions + finance settings for one project
// GET /api/transactions?all=1           → all transactions + all finance settings
export async function GET(req: NextRequest) {
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
      project_id:     row.key.replace("finance_", ""),
      agreedPrice:    (row.value as { agreedPrice?: number })?.agreedPrice    ?? 0,
      currency:       (row.value as { currency?: string })?.currency          ?? "₪",
      financialNotes: (row.value as { financialNotes?: string })?.financialNotes ?? "",
    }));

    return NextResponse.json({ transactions: txRes.data, settings });
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

  return NextResponse.json({
    transactions: txRes.data,
    agreedPrice, currency, financialNotes,
    financeException, financeExceptionReason, financeExceptionDate,
  });
}

// POST /api/transactions  → create a new transaction
export async function POST(req: NextRequest) {
  const body = await req.json();
  const {
    projectId, scope, type, date, description, artist, amount,
    currency, paymentStatus, paymentMethod, receiptRef, notes, category,
    linkedSessionId,
  } = body;

  const txScope = scope ?? "project";

  if (!type) {
    return NextResponse.json({ error: "type required" }, { status: 400 });
  }
  if (txScope === "project" && !projectId) {
    return NextResponse.json({ error: "projectId required for project-scoped transactions" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("transactions")
    .insert({
      project_id:        txScope === "general" ? null : (projectId || null),
      scope:             txScope,
      type,
      date:              date              || null,
      description:       description       || "",
      artist:            artist            || "",
      amount:            Number(amount)    || 0,
      currency:          currency          || "₪",
      payment_status:    paymentStatus     || "צפוי",
      payment_method:    paymentMethod     || "",
      receipt_ref:       receiptRef        || "",
      notes:             notes             || "",
      category:          category          || "",
      linked_session_id: linkedSessionId   || "",
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ transaction: data });
}

// PATCH /api/transactions?projectId=xxx&type=settings  → update finance settings
export async function PATCH(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get("projectId");
  const type      = req.nextUrl.searchParams.get("type");

  if (type !== "settings" || !projectId) {
    return NextResponse.json({ error: "projectId and type=settings required" }, { status: 400 });
  }

  const { agreedPrice, currency, financialNotes } = await req.json();

  // Read existing value first so we can merge
  const { data: existing } = await supabase
    .from("settings")
    .select("value")
    .eq("key", `finance_${projectId}`)
    .maybeSingle();

  const existing_val = (existing?.value ?? {}) as Record<string, unknown>;
  const merged = {
    ...existing_val,
    ...(agreedPrice    !== undefined ? { agreedPrice:    Number(agreedPrice)    } : {}),
    ...(currency       !== undefined ? { currency                               } : {}),
    ...(financialNotes !== undefined ? { financialNotes                         } : {}),
  };

  const { error } = await supabase
    .from("settings")
    .upsert({ key: `finance_${projectId}`, value: merged }, { onConflict: "key" });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, value: merged });
}
