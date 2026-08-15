/**
 * POST /api/projects/[id]/clip/payments — create clip-deal income transaction(s)
 *
 * Every clip payment is a REAL transactions row (type="income", scope="project",
 * expense_scope="קליפ") — the same rows the Finance page renders. There is no
 * parallel payments table. Editing / deleting a payment goes through the normal
 * /api/transactions/[id] endpoints, so status logic stays in one place.
 *
 * Body:
 *   { seed: true }  → open a clip deal: two default payments (מקדמה + יתרה,
 *                     50/50 of the agreed price). No-ops if clip payments
 *                     already exist, so a double click can't duplicate them.
 *   otherwise       → one payment: { amount, date, category, paymentStatus, notes }
 */
import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { requireOwner } from "@/lib/require-auth";
import { touchProject } from "@/lib/projects-store";
import { CLIP_SCOPE, CLIP_PAYMENT_STATUSES } from "@/lib/clip-finance";
import { SONG_WITH_CLIP_TYPE } from "@/lib/types";

type Ctx = { params: Promise<{ id: string }> };

const VALID_STATUSES = new Set<string>(CLIP_PAYMENT_STATUSES);

/** Round to whole shekels for the 50/50 split; the remainder lands on payment 2. */
function splitHalf(total: number): [number, number] {
  const first = Math.round(total / 2);
  return [first, Math.max(0, total - first)];
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

interface ClipPaymentInput {
  amount: number;
  date: string | null;
  category: string;
  payment_status: string;
  description: string;
  notes: string;
}

async function insertPayments(projectId: string, artist: string, currency: string, rows: ClipPaymentInput[]) {
  const { data, error } = await supabase
    .from("transactions")
    .insert(rows.map((r) => ({
      project_id:        projectId,
      scope:             "project",
      type:              "income",
      date:              r.date || null,
      description:       r.description,
      artist:            artist || "",
      amount:            r.amount,
      currency,
      payment_status:    r.payment_status,
      payment_method:    "",
      receipt_ref:       "",
      notes:             r.notes,
      category:          r.category,
      linked_session_id: "",
      // The marker that keeps this money in the CLIP deal and out of the song's balance.
      expense_scope:     CLIP_SCOPE,
    })))
    .select();
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const unauth = await requireOwner(); if (unauth) return unauth;
  try {
    const { id } = await ctx.params;
    const body = await req.json().catch(() => ({}));

    const { data: project } = await supabase
      .from("projects")
      .select("id, name, artist, project_type")
      .eq("id", id)
      .maybeSingle();
    if (!project) return NextResponse.json({ error: "פרויקט לא נמצא" }, { status: 404 });

    const { data: settingRow } = await supabase
      .from("settings").select("value").eq("key", `finance_${id}`).maybeSingle();
    const settings = (settingRow?.value ?? {}) as Record<string, unknown>;
    const currency = (settings.currency as string | undefined) ?? "₪";

    const artist = (project.artist as string) ?? "";
    const label  = (project.name   as string) ?? "";

    // ── Seed: open the clip deal with the default two payments ──────────────
    if (body.seed) {
      const price = Number(body.clipAgreedPrice ?? settings.clipAgreedPrice ?? 0);
      if (!Number.isFinite(price) || price <= 0) {
        return NextResponse.json({ error: "יש להזין מחיר שסוכם לקליפ" }, { status: 400 });
      }

      // Idempotent: if the deal already has payments, return them untouched.
      const { data: existing } = await supabase
        .from("transactions")
        .select("*")
        .eq("project_id", id)
        .eq("type", "income")
        .eq("expense_scope", CLIP_SCOPE);
      if ((existing ?? []).length > 0) {
        return NextResponse.json({ payments: existing, created: false });
      }

      // Opening a clip deal on a plain song makes the project a combined one.
      // ONLY from "שיר" — a project already typed "קליפ", "שיר + קליפ", EP,
      // אלבום, רידים, לימודים or אחר is left exactly as the owner set it.
      if ((project.project_type as string) === "שיר") {
        await supabase
          .from("projects")
          .update({ project_type: SONG_WITH_CLIP_TYPE, updated_at: new Date().toISOString() })
          .eq("id", id);
      }

      const today = new Date().toISOString().slice(0, 10);
      const [first, second] = splitHalf(price);
      const created = await insertPayments(id, artist, currency, [
        {
          amount: first, date: today, category: "מקדמה", payment_status: "צפוי",
          description: `מקדמה לקליפ — ${label}`, notes: "",
        },
        {
          amount: second, date: addDays(today, 30), category: "תשלום סופי", payment_status: "צפוי",
          description: `יתרת תשלום לקליפ — ${label}`, notes: "",
        },
      ]);
      touchProject(id).catch(() => {});
      return NextResponse.json({ payments: created, created: true }, { status: 201 });
    }

    // ── Single extra payment ────────────────────────────────────────────────
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ error: "סכום לא תקין" }, { status: 400 });
    }
    const status = String(body.paymentStatus ?? "צפוי");
    if (!VALID_STATUSES.has(status)) {
      return NextResponse.json({ error: "סטטוס לא תקין" }, { status: 400 });
    }
    const category = String(body.category ?? "תשלום חלקי");
    const created = await insertPayments(id, artist, currency, [{
      amount,
      date: body.date ? String(body.date) : null,
      category,
      payment_status: status,
      description: String(body.description || `${category} לקליפ — ${label}`),
      notes: String(body.notes ?? ""),
    }]);
    touchProject(id).catch(() => {});
    return NextResponse.json({ payments: created, created: true }, { status: 201 });
  } catch (e) {
    console.error("[POST /api/projects/[id]/clip/payments]", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "שגיאת שרת" }, { status: 500 });
  }
}
