/**
 * Shared project clip-deal writers — used by BOTH the /api/projects/[id]/clip routes and Sunny's typed primitives.
 * Route bodies moved here verbatim: the clip price (finance settings merge only), 'שלח קליפ' (find-or-create the
 * managed Red Films production, idempotent by lookup twice), and clip payments (the 50 / 50 seed of an open deal, or one
 * payment). Clip payments are INCOME transactions with expense scope קליפ.
 * B3 (Owner canon 2026-09-27): the client clip PRICE (A) is never the production's planned BUDGET (B) — the price →
 * budget sync is retired; a new managed production starts with budget 0 in the deal currency; its client_source comes
 * from the project's classification (lib/clip-rf-money-pure rfClientSourceFor), never a hard-coded "פנימי - לייבל".
 */
import { supabase } from "@/lib/supabase";
import { touchProject } from "@/lib/projects-store";
import { CLIP_SCOPE, CLIP_PAYMENT_STATUSES } from "@/lib/clip-finance";
import { SONG_WITH_CLIP_TYPE } from "@/lib/types";
import { mergeSettingsKey } from "@/lib/writes/settings-merge";
import { normalizeCurrency } from "@/lib/finance/currency";
import { rfClientSourceFor } from "@/lib/clip-rf-money-pure";

async function readFinanceSettings(projectId: string): Promise<Record<string, unknown>> {
  const { data } = await supabase.from("settings").select("value").eq("key", `finance_${projectId}`).maybeSingle();
  return (data?.value ?? {}) as Record<string, unknown>;
}

export async function clipDealOf(projectId: string): Promise<{ clipAgreedPrice: number; currency: string; paymentCount: number; managedProductionId: string | null }> {
  const { getManagedClipProductionId } = await import("@/lib/clip-production");
  const s = await readFinanceSettings(projectId);
  const { count, error } = await supabase.from("transactions").select("id", { count: "exact", head: true }).eq("project_id", projectId).eq("type", "income").eq("expense_scope", CLIP_SCOPE);
  if (error) throw new Error(error.message);
  return { clipAgreedPrice: Number(s.clipAgreedPrice ?? 0) || 0, currency: String(s.currency ?? "₪"), paymentCount: count ?? 0, managedProductionId: await getManagedClipProductionId(projectId) };
}

/** PATCH /api/projects/[id]/clip semantics. B3: the price only — the production's planned budget is never touched. */
export async function setClipPrice(projectId: string, price: number): Promise<void> {
  if (!Number.isFinite(price) || price < 0) throw new Error("מחיר לא תקין");
  // Compare-and-swap merge (lib/writes/settings-merge.ts): a concurrent finance-settings writer is never overwritten.
  await mergeSettingsKey(`finance_${projectId}`, { clipAgreedPrice: price });
}

/** POST /api/projects/[id]/clip/send semantics. */
export async function sendClipToRedFilms(projectId: string): Promise<{ kind: "not_found" } | { kind: "ok"; production: Record<string, unknown>; created: boolean }> {
  const { findLinkedClipProduction, setManagedClipProductionId } = await import("@/lib/clip-production");
  const existing = await findLinkedClipProduction(projectId);
  if (existing) return { kind: "ok", production: existing as unknown as Record<string, unknown>, created: false };
  const { data: project } = await supabase.from("projects").select("id, name, artist, project_business_type").eq("id", projectId).maybeSingle();
  if (!project) return { kind: "not_found" };
  const settings = await readFinanceSettings(projectId);
  const artist = (project.artist as string) ?? "";
  const title = (project.name as string) ?? "קליפ";
  let clientId: string | null = null;
  let clientName = "";
  if (artist) {
    const { data: client } = await supabase.from("clients").select("id, name").eq("name", artist).maybeSingle();
    if (client) { clientId = client.id as string; clientName = client.name as string; }
  }
  const stillNone = await findLinkedClipProduction(projectId);
  if (stillNone) return { kind: "ok", production: stillNone as unknown as Record<string, unknown>, created: false };
  const now = new Date().toISOString();
  const { data, error } = await supabase.from("red_films_productions").insert({
    title, production_type: CLIP_SCOPE, status: "רעיון", project_id: projectId, artist_name: artist, client_id: clientId, client_name: clientName,
    photographer_name: "", client_source: rfClientSourceFor({ businessType: (project.project_business_type as string | null) ?? null }), collection_status: "לא רלוונטי",
    // B3: planning starts at 0 — the client clip price is never the budget. The production carries the clip deal
    // currency (never a silent ₪ for a $ deal).
    general_budget: 0, currency: normalizeCurrency(typeof settings.currency === "string" ? settings.currency : null), created_at: now, updated_at: now,
  }).select().single();
  if (error) throw error;
  await setManagedClipProductionId(projectId, data.id as string);
  return { kind: "ok", production: { ...(data as Record<string, unknown>), budget_managed_by_project: true }, created: true };
}

function splitHalf(total: number): [number, number] { const first = Math.round(total / 2); return [first, Math.max(0, total - first)]; }
function addDays(iso: string, days: number): string { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); }
interface ClipPaymentInput { amount: number; date: string | null; category: string; payment_status: string; description: string; notes: string }
async function insertPayments(projectId: string, artist: string, currency: string, rows: ClipPaymentInput[]) {
  const { data, error } = await supabase.from("transactions").insert(rows.map((r) => ({
    project_id: projectId, scope: "project", type: "income", date: r.date || null, description: r.description, artist: artist || "", amount: r.amount, currency,
    payment_status: r.payment_status, payment_method: "", receipt_ref: "", notes: r.notes, category: r.category, linked_session_id: "", expense_scope: CLIP_SCOPE,
  }))).select();
  if (error) throw new Error(error.message);
  return data ?? [];
}
export class ClipInputError extends Error {}
const VALID_STATUSES = new Set<string>(CLIP_PAYMENT_STATUSES);

/** POST /api/projects/[id]/clip/payments semantics (seed = open the deal 50 / 50; otherwise one payment). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function addClipPayments(projectId: string, body: Record<string, any>): Promise<{ kind: "not_found" } | { kind: "ok"; payments: unknown[]; created: boolean }> {
  const { data: project } = await supabase.from("projects").select("id, name, artist, project_type").eq("id", projectId).maybeSingle();
  if (!project) return { kind: "not_found" };
  const settings = await readFinanceSettings(projectId);
  const currency = (settings.currency as string | undefined) ?? "₪";
  const artist = (project.artist as string) ?? "";
  const label = (project.name as string) ?? "";
  if (body.seed) {
    const price = Number(body.clipAgreedPrice ?? settings.clipAgreedPrice ?? 0);
    if (!Number.isFinite(price) || price <= 0) throw new ClipInputError("יש להזין מחיר שסוכם לקליפ");
    const { data: existing } = await supabase.from("transactions").select("*").eq("project_id", projectId).eq("type", "income").eq("expense_scope", CLIP_SCOPE);
    if ((existing ?? []).length > 0) return { kind: "ok", payments: existing ?? [], created: false };
    if ((project.project_type as string) === "שיר") await supabase.from("projects").update({ project_type: SONG_WITH_CLIP_TYPE, updated_at: new Date().toISOString() }).eq("id", projectId);
    const today = new Date().toISOString().slice(0, 10);
    const [first, second] = splitHalf(price);
    const created = await insertPayments(projectId, artist, currency, [
      { amount: first, date: today, category: "מקדמה", payment_status: "צפוי", description: `מקדמה לקליפ — ${label}`, notes: "" },
      { amount: second, date: addDays(today, 30), category: "תשלום סופי", payment_status: "צפוי", description: `יתרת תשלום לקליפ — ${label}`, notes: "" },
    ]);
    touchProject(projectId).catch(() => {});
    return { kind: "ok", payments: created, created: true };
  }
  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new ClipInputError("סכום לא תקין");
  const status = String(body.paymentStatus ?? "צפוי");
  if (!VALID_STATUSES.has(status)) throw new ClipInputError("סטטוס לא תקין");
  const category = String(body.category ?? "תשלום חלקי");
  const created = await insertPayments(projectId, artist, currency, [{ amount, date: body.date ? String(body.date) : null, category, payment_status: status, description: String(body.description || `${category} לקליפ — ${label}`), notes: String(body.notes ?? "") }]);
  touchProject(projectId).catch(() => {});
  return { kind: "ok", payments: created, created: true };
}
