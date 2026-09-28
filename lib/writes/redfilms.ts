/**
 * Shared Red Films + clip-planning writers — used by BOTH the routes and Sunny's typed primitives. Route bodies moved
 * here verbatim (same allowed-field lists, defaults and validations), with two HARDENINGS (2026-09-27):
 *   • updateProduction: a cancel (status בוטל) now saves the production FIRST and only then cancels its future tasks /
 *     Google Tasks (they used to be cancelled even when the save then failed);
 *   • promoteClipItem: the clip row is CLAIMED (status → הועבר לכספים only while it has no linked expense) before the
 *     expense is created, so a double click can never create two expenses; if the expense insert fails the claim is
 *     released. B3 (2026-09-27): the planning row is KEPT and linked (linked_transaction_id) — plan → actual provenance.
 * Money here is planning unless it is a Finance transaction: production budget / budget lines / clip rows are planning,
 * a Red Films payment is REAL money that left the company → exactly ONE linked Finance expense (DB-1 live 2026-09-27:
 * red_films_budget_payments.linked_transaction_id, lib/writes/rf-finance-link — a new payment links automatically, an
 * edit propagates, a delete removes its expense; a non-clip production → SCOPE_REQUIRED, left unlinked and reported);
 * only a Finance expense with scope קליפ is actual spend. B3: no budget lock — a production created by 'שלח קליפ' owns its planning budget
 * like every other production (the clip price is never the budget). client_source of a new production comes from the
 * project's classification (lib/clip-rf-money-pure rfClientSourceFor).
 */
import { supabase } from "@/lib/supabase";
import { unitColumnsOrUnclassified } from "@/lib/writes/business-unit";
import { touchProject } from "@/lib/projects-store";
import { CLIP_ITEM_PROMOTED_STATUS, CLIP_ITEM_STATUSES, isClipItemStatus, rfClientSourceFor, RF_CLIENT_SOURCES } from "@/lib/clip-rf-money-pure";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = Record<string, any>;
export class RfInputError extends Error {}
/** Red Films money has ONE currency per row (₪ / $ / €) — never converted, never added across currencies. */
export const RF_CURRENCIES: readonly string[] = ["₪", "$", "€"];
function rfCurrency(v: unknown, fallback: string): string {
  if (v === undefined || v === null || v === "") return fallback;
  if (typeof v !== "string" || !RF_CURRENCIES.includes(v)) throw new RfInputError("מטבע לא נתמך (₪ / $ / €)");
  return v;
}

/** The client_source of a NEW production: an explicit valid value, else derived from the linked project's classification. */
export async function rfClientSourceForNew(projectId: string | null | undefined, explicit?: unknown): Promise<string> {
  if (typeof explicit === "string" && (RF_CLIENT_SOURCES as readonly string[]).includes(explicit)) return explicit;
  if (!projectId) return rfClientSourceFor(null);
  const { data } = await supabase.from("projects").select("project_business_type").eq("id", projectId).maybeSingle();
  return rfClientSourceFor(data ? { businessType: (data as { project_business_type?: string | null }).project_business_type ?? null } : null);
}

export async function createProduction(body: Body): Promise<Record<string, unknown>> {
  const title = body.title;
  if (!title || typeof title !== "string" || !title.trim()) throw new RfInputError("שם ההפקה חובה");
  const clientSource = await rfClientSourceForNew(body.project_id ?? null, body.client_source);
  const now = new Date().toISOString();
  const { data, error } = await supabase.from("red_films_productions").insert({
    title: title.trim(), production_type: body.production_type ?? "קליפ", status: "רעיון", project_id: body.project_id ?? null,
    artist_name: body.artist_name ?? "", client_id: body.client_id ?? null, client_name: body.client_name ?? "", photographer_name: body.photographer_name ?? "",
    client_source: clientSource, collection_status: "לא רלוונטי", currency: rfCurrency(body.currency, "₪"), created_at: now, updated_at: now,
  }).select().single();
  if (error) throw error;
  return data as Record<string, unknown>;
}

export const PRODUCTION_ALLOWED_FIELDS = new Set([
  "title", "production_type", "status", "project_id", "client_id", "artist_name", "client_name", "client_source",
  "photographer_name", "director_name", "editor_name", "shoot_date", "locations", "concept_summary", "concept_vibe", "ref_links",
  "script_start", "script_middle", "script_end", "director_notes", "photographer_notes", "general_budget", "client_price",
  "advance_required", "advance_received", "collection_status", "files_raw_link", "files_edit_folder", "version_1_link",
  "version_2_link", "final_version_link", "fix_notes", "edit_status", "publish_date", "published_where", "notes", "currency",
]);

export type UpdateProductionResult = { kind: "ok"; production: Record<string, unknown> } | { kind: "empty" } | { kind: "not_found" };

/** PATCH semantics; HARDENED ordering for a cancel (save first, then the task cleanup). B3: no managed-budget lock. */
export async function updateProduction(id: string, body: Body): Promise<UpdateProductionResult> {
  const { isManagedClipProduction } = await import("@/lib/clip-production");
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const [key, val] of Object.entries(body)) if (PRODUCTION_ALLOWED_FIELDS.has(key)) patch[key] = val;
  if ("currency" in patch) patch.currency = rfCurrency(patch.currency, "₪");
  if (Object.keys(patch).length === 1) return { kind: "empty" };

  const { data, error } = await supabase.from("red_films_productions").update(patch).eq("id", id).select().single();
  if (error) throw error;
  if (!data) return { kind: "not_found" };

  if (body.status === "בוטל") {
    try {
      const today = new Date().toISOString().split("T")[0];
      const { data: allTasks } = await supabase.from("tasks").select("id, due_date, calendar_event_id, status").eq("related_type", "red_film_production").eq("related_id", id);
      if (allTasks && allTasks.length > 0) {
        let googleClient: { isConnected: () => Promise<boolean>; deleteGoogleTask: (id: string) => Promise<void> } | null = null;
        let googleConnected = false;
        try { googleClient = await import("@/lib/google-calendar"); googleConnected = await googleClient.isConnected(); } catch { /* ignore */ }
        for (const t of allTasks) {
          const isFuture = t.due_date != null && t.due_date >= today;
          const isPast = t.due_date != null && t.due_date < today;
          const noDate = t.due_date == null;
          if (isPast) continue; // past tasks — untouched
          if (isFuture) {
            await supabase.from("tasks").update({ status: "בוטל", updated_at: new Date().toISOString() }).eq("id", t.id);
            if (t.calendar_event_id && googleConnected && googleClient) { try { await googleClient.deleteGoogleTask(t.calendar_event_id); } catch { /* ignore */ } }
          } else if (noDate && !t.calendar_event_id) {
            await supabase.from("tasks").update({ status: "בוטל", updated_at: new Date().toISOString() }).eq("id", t.id);
          }
        }
      }
    } catch (gErr) {
      console.warn("[production → בוטל] tasks cleanup failed (ignored):", gErr);
    }
  }
  // provenance flag only (created by the project's 'שלח קליפ'); it locks nothing
  const createdBySendClip = await isManagedClipProduction(data as { id: string; project_id?: string | null });
  return { kind: "ok", production: { ...(data as Record<string, unknown>), budget_managed_by_project: createdBySendClip } };
}

export async function createBudgetLine(productionId: string, body: Body): Promise<Record<string, unknown>> {
  const now = new Date().toISOString();
  const { data: prod } = await supabase.from("red_films_productions").select("currency").eq("id", productionId).maybeSingle();
  const currency = rfCurrency(body.currency, String((prod as { currency?: string } | null)?.currency ?? "₪"));
  const { data, error } = await supabase.from("red_films_budget_items").insert({
    production_id: productionId, title: body.title ?? "", category: body.category ?? "אחר", planned_amount: Number(body.planned_amount) || 0,
    actual_amount: Number(body.actual_amount) || 0, vendor_name: body.vendor_name ?? "", status: body.status ?? "מתוכנן", notes: body.notes ?? "", currency, created_at: now, updated_at: now,
  }).select().single();
  if (error) throw error;
  return data as Record<string, unknown>;
}
const BUDGET_ALLOWED = new Set(["title", "category", "planned_amount", "actual_amount", "vendor_name", "status", "notes", "currency"]);
export async function updateBudgetLine(itemId: string, body: Body): Promise<Record<string, unknown>> {
  const fields: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const [k, v] of Object.entries(body)) if (BUDGET_ALLOWED.has(k)) fields[k] = v;
  if ("currency" in fields) {
    fields.currency = rfCurrency(fields.currency, "₪");
    // a line's payments are in the line's currency — relabelling them would be a silent FX
    const { data: cur } = await supabase.from("red_films_budget_items").select("currency").eq("id", itemId).maybeSingle();
    const { count } = await supabase.from("red_films_budget_payments").select("id", { count: "exact", head: true }).eq("budget_item_id", itemId);
    if ((count ?? 0) > 0 && (cur as { currency?: string } | null)?.currency !== fields.currency) throw new RfInputError("לשורה יש תשלומים — אי אפשר לשנות את המטבע שלה (אין המרה)");
  }
  const { data, error } = await supabase.from("red_films_budget_items").update(fields).eq("id", itemId).select().single();
  if (error) throw error;
  return data as Record<string, unknown>;
}
export async function deleteBudgetLine(itemId: string): Promise<void> {
  const { error } = await supabase.from("red_films_budget_items").delete().eq("id", itemId);
  if (error) throw error;
}

/** The payment-row insert of POST /budget-items/[itemId]/payments (a receipt, when uploaded by the route, is passed in). */
/** The Finance-link outcome reported with a new payment (DB-1): LINKED, or why it stayed unlinked. */
export type RfNewPaymentLink = { state: "LINKED"; transactionId: string } | { state: "SCOPE_REQUIRED" | "PROJECT_REQUIRED" | "POSSIBLE_DUPLICATE" | "LINK_FAILED"; he: string };
export async function insertBudgetPayment(itemId: string, p: { amount: number; paymentDate: string; paymentMethod: string; notes: string; currency?: string; receipt?: { fileName: string; mimeType: string; dropboxPath: string; dropboxUrl: string } }): Promise<{ kind: "not_found" } | { kind: "ok"; payment: Record<string, unknown>; financeLink: RfNewPaymentLink }> {
  if (!(p.amount > 0)) throw new RfInputError("סכום חייב להיות גדול מ-0");
  const { data: item, error: itemErr } = await supabase.from("red_films_budget_items").select("id, production_id, title, currency").eq("id", itemId).maybeSingle();
  if (itemErr) throw itemErr;
  if (!item) return { kind: "not_found" };
  // a payment is in its budget line's currency (never another one — no FX)
  const lineCurrency = String((item as { currency?: string }).currency ?? "₪");
  if (p.currency !== undefined && p.currency !== "" && p.currency !== lineCurrency) throw new RfInputError(`שורת התקציב ב-${lineCurrency} — תשלום במטבע אחר לא נרשם עליה (אין המרה)`);
  const now = new Date().toISOString();
  const { data, error } = await supabase.from("red_films_budget_payments").insert({
    production_id: item.production_id as string, budget_item_id: itemId, amount: p.amount, payment_date: p.paymentDate, payment_method: p.paymentMethod, notes: p.notes,
    receipt_file_name: p.receipt?.fileName ?? "", receipt_mime_type: p.receipt?.mimeType ?? "", receipt_dropbox_path: p.receipt?.dropboxPath ?? "", receipt_dropbox_url: p.receipt?.dropboxUrl ?? "",
    currency: lineCurrency, created_at: now, updated_at: now,
  }).select().single();
  if (error) throw error;
  // DB-1: the new payment becomes its ONE Finance expense (same writer as LINK_RF_PAYMENT_TO_FINANCE). The payment is
  // real money and stays recorded even when the link cannot be made — the reason is reported, never hidden.
  const paymentId = String((data as { id: unknown }).id);
  let financeLink: RfNewPaymentLink;
  try {
    const { linkRfPaymentToFinance } = await import("@/lib/writes/rf-finance-link");
    const r = await linkRfPaymentToFinance(paymentId);
    financeLink = r.kind === "LINKED" || r.kind === "ALREADY_LINKED" ? { state: "LINKED", transactionId: r.transactionId }
      : r.kind === "SCOPE_REQUIRED" || r.kind === "PROJECT_REQUIRED" ? { state: r.kind, he: r.he }
      : r.kind === "POSSIBLE_DUPLICATE" ? { state: "POSSIBLE_DUPLICATE", he: `בכספים כבר קיימת הוצאה דומה (${r.candidates.map((c) => `${c.date ?? "—"} · ${c.currency ?? ""}${c.amount}`).join(", ")}) — התשלום נשמר ולא קושר; הבוס מחליט (LINK_RF_PAYMENT_TO_FINANCE)` }
      : { state: "LINK_FAILED", he: "התשלום לא נמצא לקישור" };
  } catch (e) {
    financeLink = { state: "LINK_FAILED", he: `התשלום נשמר, הקישור לכספים נכשל: ${e instanceof Error ? e.message : "שגיאה"}` };
  }
  const { data: fresh } = await supabase.from("red_films_budget_payments").select("*").eq("id", paymentId).maybeSingle();
  return { kind: "ok", payment: (fresh ?? data) as Record<string, unknown>, financeLink };
}
const PAYMENT_ALLOWED = new Set(["amount", "payment_date", "payment_method", "notes", "receipt_file_name", "receipt_mime_type", "receipt_dropbox_path", "receipt_dropbox_url"]);
export async function updateBudgetPayment(paymentId: string, body: Body): Promise<Record<string, unknown>> {
  const fields: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const [k, v] of Object.entries(body)) if (PAYMENT_ALLOWED.has(k)) fields[k] = v;
  const { data, error } = await supabase.from("red_films_budget_payments").update(fields).eq("id", paymentId).select().single();
  if (error) throw error;
  // DB-1: the linked Finance expense follows the payment (amount / date / method / currency) — the payment owns it
  const { propagateRfPaymentToFinance } = await import("@/lib/writes/rf-finance-link");
  try { await propagateRfPaymentToFinance(data as Record<string, unknown>); }
  catch (e) { throw new Error(`התשלום עודכן, אבל הוצאת הכספים המקושרת לא עודכנה: ${e instanceof Error ? e.message : "שגיאה"}`); }
  return data as Record<string, unknown>;
}
/** How many payments a budget line has (its currency cannot change once it has any — no FX). */
export async function countBudgetLinePayments(itemId: string): Promise<number> {
  const { count, error } = await supabase.from("red_films_budget_payments").select("id", { count: "exact", head: true }).eq("budget_item_id", itemId);
  if (error) throw error;
  return count ?? 0;
}
/** Delete a payment AND its linked Finance expense (DB-1: one money fact, deleted together; the payment first, then its
 *  owned expense — a failure there is reported with the expense id, never hidden). */
export async function deleteBudgetPayment(paymentId: string): Promise<{ deletedTransactionId: string | null }> {
  const { data: pay, error: readErr } = await supabase.from("red_films_budget_payments").select("id, linked_transaction_id").eq("id", paymentId).maybeSingle();
  if (readErr) throw readErr;
  const txId = ((pay as { linked_transaction_id?: string | null } | null)?.linked_transaction_id) ?? null;
  const { error } = await supabase.from("red_films_budget_payments").delete().eq("id", paymentId);
  if (error) throw error;
  if (txId) {
    const { deleteTransactionRecord } = await import("@/lib/writes/finance");
    try { await deleteTransactionRecord(txId); }
    catch (e) { throw new Error(`התשלום נמחק, אבל הוצאת הכספים המקושרת (${txId}) לא נמחקה: ${e instanceof Error ? e.message : "שגיאה"}`); }
  }
  return { deletedTransactionId: txId };
}

// ── clip planning rows (project clip deal) ──
export async function createClipItem(body: Body): Promise<Record<string, unknown>> {
  if (!body.projectId) throw new RfInputError("projectId required");
  const { data, error } = await supabase.from("clip_items").insert({
    project_id: body.projectId, category: body.category || "", description: body.description || "", amount: Number(body.amount) || 0, currency: body.currency || "₪", status: "תכנון בלבד", notes: body.notes || "",
  }).select().single();
  if (error) throw new Error(error.message);
  return data as Record<string, unknown>;
}
/** clip_items.status is validated against the drawer's vocabulary (lib/clip-rf-money-pure CLIP_ITEM_STATUSES). */
export async function updateClipItem(id: string, body: Body): Promise<Record<string, unknown>> {
  if (body.status !== undefined && !isClipItemStatus(body.status)) throw new RfInputError(`סטטוס לא תקין (${CLIP_ITEM_STATUSES.join(" / ")})`);
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.category !== undefined) patch.category = body.category;
  if (body.description !== undefined) patch.description = body.description;
  if (body.amount !== undefined) patch.amount = Number(body.amount);
  if (body.currency !== undefined) patch.currency = body.currency;
  if (body.status !== undefined) patch.status = body.status;
  if (body.notes !== undefined) patch.notes = body.notes;
  const { data, error } = await supabase.from("clip_items").update(patch).eq("id", id).select().single();
  if (error) throw new Error(error.message);
  return data as Record<string, unknown>;
}
export async function deleteClipItem(id: string): Promise<void> {
  const { error } = await supabase.from("clip_items").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/**
 * 'העבר לכספים': the clip row becomes ONE unpaid Finance expense (scope קליפ). HARDENED claim. B3 (2026-09-27): the
 * planning row is KEPT, marked הועבר לכספים and linked to the expense (linked_transaction_id) — plan → actual
 * provenance. Readers count only UNLINKED rows as planned (lib/clip-rf-money-pure isClipItemPlanned).
 */
export async function promoteClipItem(id: string, date: string): Promise<{ kind: "not_found" } | { kind: "already_promoted"; transactionId: string } | { kind: "ok"; transaction: Record<string, unknown>; clipItem: Record<string, unknown> }> {
  const { data: item, error: fetchErr } = await supabase.from("clip_items").select("*").eq("id", id).maybeSingle();
  if (fetchErr || !item) return { kind: "not_found" };
  if (item.linked_transaction_id) return { kind: "already_promoted", transactionId: String(item.linked_transaction_id) };
  if (item.status === "בוטל" || item.status === CLIP_ITEM_PROMOTED_STATUS) return { kind: "not_found" };
  // Claim: mark the row only while it is still unpromoted (same status, no link) — a concurrent second click claims
  // nothing and stops here.
  const prevStatus = String(item.status ?? "תכנון בלבד");
  const { data: claimed, error: claimErr } = await supabase.from("clip_items").update({ status: CLIP_ITEM_PROMOTED_STATUS, updated_at: new Date().toISOString() })
    .eq("id", id).is("linked_transaction_id", null).eq("status", prevStatus).select("id");
  if (claimErr) throw new Error(claimErr.message);
  if (!claimed || claimed.length === 0) return { kind: "not_found" };
  // business unit (task 4): a real clip cost of a Records project → RECORDS; of a client project → FILMS only with an
  // external-client Red Films production; otherwise "דורש סיווג"
  const unit = await unitColumnsOrUnclassified({ writer: "CLIP_PROMOTE", type: "expense", expenseScope: "קליפ", projectId: item.project_id as string | null });
  const { data: tx, error: txErr } = await supabase.from("transactions").insert({
    ...unit,
    project_id: item.project_id, scope: "project", type: "expense", date: date || null, description: item.description || item.category || "הוצאת קליפ", artist: "",
    amount: item.amount, currency: item.currency, payment_status: "לא שולם", payment_method: "", receipt_ref: "", notes: item.notes || "", category: item.category || "קליפ",
    linked_session_id: "", expense_scope: "קליפ",
  }).select().single();
  if (txErr || !tx) {
    // release the claim (the row goes back to its planning status)
    await supabase.from("clip_items").update({ status: prevStatus, updated_at: new Date().toISOString() }).eq("id", id).is("linked_transaction_id", null);
    throw new Error(txErr?.message ?? "failed to create transaction");
  }
  const txId = String((tx as { id: unknown }).id);
  const { data: linked, error: linkErr } = await supabase.from("clip_items").update({ linked_transaction_id: txId, updated_at: new Date().toISOString() }).eq("id", id).select().single();
  if (linkErr) throw new Error(`the expense was created (${txId}) but the planning row was not linked: ${linkErr.message}`);
  touchProject(item.project_id as string).catch(() => {});
  return { kind: "ok", transaction: tx as Record<string, unknown>, clipItem: linked as Record<string, unknown> };
}

// ── narrow readers for the typed primitives ──
const one = async (table: string, id: string) => {
  const { data, error } = await supabase.from(table).select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return (data ?? null) as Record<string, unknown> | null;
};
export async function readProductionRow(id: string) { return one("red_films_productions", id); }
export async function readBudgetLineRow(id: string) { return one("red_films_budget_items", id); }
export async function readBudgetPaymentRow(id: string) { return one("red_films_budget_payments", id); }
export async function readClipItemRow(id: string) { return one("clip_items", id); }
export async function isManagedProduction(id: string, projectId: string | null): Promise<boolean> {
  const { isManagedClipProduction } = await import("@/lib/clip-production");
  return isManagedClipProduction({ id, project_id: projectId });
}
export async function countProductionsTitled(title: string): Promise<number> {
  const { count, error } = await supabase.from("red_films_productions").select("id", { count: "exact", head: true }).eq("title", title);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

/** POST /api/red-films/equipment semantics (validation verbatim). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function createEquipment(body: Record<string, any>): Promise<{ kind: "bad"; status: number; error: string } | { kind: "ok"; item: Record<string, unknown> }> {
    const { name, category } = body;

    if (!name || typeof name !== "string" || !name.trim()) {
      return { kind: "bad" as const, status: 400, error: "שם הציוד חובה" };
    }
    if (!category || typeof category !== "string" || !category.trim()) {
      return { kind: "bad" as const, status: 400, error: "קטגוריה חובה" };
    }
    const quantity = Number(body.quantity ?? 1);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return { kind: "bad" as const, status: 400, error: "כמות חייבת להיות גדולה מ-0" };
    }
    let purchasePrice: number | null = null;
    if (body.purchase_price !== undefined && body.purchase_price !== null && body.purchase_price !== "") {
      purchasePrice = Number(body.purchase_price);
      if (!Number.isFinite(purchasePrice) || purchasePrice < 0) {
        return { kind: "bad" as const, status: 400, error: "מחיר קנייה לא תקין" };
      }
    }

    const now = new Date().toISOString();
    const insertRow: Record<string, unknown> = {
      name: name.trim(),
      category: category.trim(),
      quantity,
      purchase_price: purchasePrice,
      purchased_from: body.purchased_from?.trim() || null,
      serial_number: body.serial_number?.trim() || null,
      notes: body.notes?.trim() || null,
      added_by: body.added_by?.trim() || "NagashBeatz",
      currency: typeof body.currency === "string" && RF_CURRENCIES.includes(body.currency) ? body.currency : "₪",
      created_at: now,
      updated_at: now,
    };
    if (body.acquired_date) insertRow.acquired_date = body.acquired_date;

    const { data, error } = await supabase
      .from("red_films_equipment")
      .insert(insertRow)
      .select()
      .single();

    if (error) throw error;
  return { kind: "ok", item: data as Record<string, unknown> };
}

const EQUIPMENT_ALLOWED_FIELDS = new Set(["name", "category", "quantity", "acquired_date", "purchase_price", "purchased_from", "serial_number", "notes", "added_by", "status", "currency"]);
/** PATCH /api/red-films/equipment/[id] semantics (validation verbatim; status drives removed_at). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function updateEquipment(id: string, body: Record<string, any>): Promise<{ kind: "bad"; status: number; error: string } | { kind: "ok"; item: Record<string, unknown> }> {
  const ALLOWED_FIELDS = EQUIPMENT_ALLOWED_FIELDS;

    const patch: Record<string, unknown> = {};
    for (const key of Object.keys(body)) {
      if (!ALLOWED_FIELDS.has(key)) continue;
      patch[key] = body[key];
    }

    if ("currency" in patch && (typeof patch.currency !== "string" || !RF_CURRENCIES.includes(patch.currency))) return { kind: "bad" as const, status: 400, error: "מטבע לא נתמך (₪ / $ / €)" };
    if ("name" in patch) {
      const name = String(patch.name ?? "").trim();
      if (!name) return { kind: "bad" as const, status: 400, error: "שם הציוד חובה" };
      patch.name = name;
    }
    if ("category" in patch) {
      const category = String(patch.category ?? "").trim();
      if (!category) return { kind: "bad" as const, status: 400, error: "קטגוריה חובה" };
      patch.category = category;
    }
    if ("quantity" in patch) {
      const quantity = Number(patch.quantity);
      if (!Number.isFinite(quantity) || quantity <= 0) {
        return { kind: "bad" as const, status: 400, error: "כמות חייבת להיות גדולה מ-0" };
      }
      patch.quantity = quantity;
    }
    if ("purchase_price" in patch) {
      if (patch.purchase_price === "" || patch.purchase_price === null || patch.purchase_price === undefined) {
        patch.purchase_price = null;
      } else {
        const price = Number(patch.purchase_price);
        if (!Number.isFinite(price) || price < 0) {
          return { kind: "bad" as const, status: 400, error: "מחיר קנייה לא תקין" };
        }
        patch.purchase_price = price;
      }
    }
    if ("status" in patch) {
      if (patch.status !== "קיים" && patch.status !== "הוסר מהמלאי") {
        return { kind: "bad" as const, status: 400, error: "סטטוס לא תקין" };
      }
      // Status is the sole driver of removed_at — set/reset together, always,
      // regardless of what else is in this same patch.
      patch.removed_at = patch.status === "הוסר מהמלאי" ? new Date().toISOString() : null;
    }

    patch.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from("red_films_equipment")
      .update(patch)
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;
    if (!data) return { kind: "bad" as const, status: 404, error: "לא נמצא" };
  return { kind: "ok", item: data as Record<string, unknown> };
}

/** DELETE /api/red-films/documents/[docId] semantics: the stored file (best effort), then the row. */
export async function deleteRfDocument(docId: string): Promise<{ kind: "bad"; status: number; error: string } | { kind: "ok" }> {
    const { data: row, error: fetchErr } = await supabase
      .from("red_films_documents")
      .select("dropbox_path")
      .eq("id", docId)
      .maybeSingle();

    if (fetchErr) throw fetchErr;
    if (!row) return { kind: "bad" as const, status: 404, error: "לא נמצא" };

    // ── 1. Delete from Dropbox (non-fatal) ────────────────────────────────────
    try {
      const { getDropboxToken } = await import("@/lib/dropbox-token");
      const token = await getDropboxToken();
      await fetch("https://api.dropboxapi.com/2/files/delete_v2", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ path: row.dropbox_path }),
      });
    } catch { /* non-fatal */ }

    // ── 2. Delete from DB ─────────────────────────────────────────────────────
    const { error: delErr } = await supabase
      .from("red_films_documents")
      .delete()
      .eq("id", docId);

    if (delErr) throw delErr;

  return { kind: "ok" };
}

/** DELETE /api/red-films/references/[refId] semantics: the stored image (best effort), then the row. */
export async function deleteRfReference(refId: string): Promise<{ kind: "bad"; status: number; error: string } | { kind: "ok" }> {
    const { data: row, error: fetchErr } = await supabase
      .from("red_films_reference_images")
      .select("dropbox_path")
      .eq("id", refId)
      .maybeSingle();

    if (fetchErr) throw fetchErr;
    if (!row) return { kind: "bad" as const, status: 404, error: "לא נמצא" };

    // ── 1. Delete from Dropbox (non-fatal if already gone) ────────────────────
    try {
      const { getDropboxToken } = await import("@/lib/dropbox-token");
      const token = await getDropboxToken();
      await fetch("https://api.dropboxapi.com/2/files/delete_v2", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ path: row.dropbox_path }),
      });
    } catch { /* non-fatal — row will still be deleted from DB */ }

    // ── 2. Delete from DB ─────────────────────────────────────────────────────
    const { error: delErr } = await supabase
      .from("red_films_reference_images")
      .delete()
      .eq("id", refId);

    if (delErr) throw delErr;

  return { kind: "ok" };
}
/** PATCH /api/red-films/references/[refId] semantics: the tag (blank → כללי). */
export async function setRfReferenceTag(refId: string, rawTag: string): Promise<Record<string, unknown>> {
  const tag = (rawTag ?? "כללי").trim() || "כללי";
  const { data, error } = await supabase.from("red_films_reference_images").update({ tag, updated_at: new Date().toISOString() }).eq("id", refId).select().single();
  if (error) throw error;
  return data as Record<string, unknown>;
}

/** Red Films permanent-delete PREFLIGHT (READ-ONLY, integrity fix A5 2026-09-27). Per requested production: status (must
 *  be בוטל), Red Films PAYMENTS (count + sum per currency — real money: HAS_PAYMENTS refuses the whole delete), budget
 *  lines (+ how many carry a linked Finance transaction — the transaction stays), documents / reference images (+ their
 *  stored files), reference links, scenes, crew, tasks (+ Google Tasks), the storage folder (kept) and every
 *  finance_<project>.clipProductionId marker that points at it. */
export interface RfDeletePreflight {
  requested: number; found: number; missing: string[];
  cancelledIds: string[]; notCancelled: Array<{ id: string; title: string; status: string }>; titles: string;
  payments: number; paymentsByCurrency: Record<string, number>; productionsWithPayments: string[];
  budgetLines: number; budgetLinesWithTransaction: number; documents: number; referenceImages: number; referenceLinks: number; scenes: number; crew: number;
  tasks: number; googleTasks: number; storageFiles: number; foldersKept: number; clipMarkers: number;
}
const RF_CHILD_TABLES = ["red_films_reference_images", "red_films_documents", "red_films_reference_links", "red_films_scenes", "red_films_crew", "red_films_budget_items"] as const;
async function rfRows(table: string, cols: string, ids: string[]): Promise<Array<Record<string, unknown>>> {
  if (!ids.length) return [];
  const { data, error } = await supabase.from(table).select(cols).in("production_id", ids);
  if (error) throw new Error(`${table}: ${error.message}`);
  return (data ?? []) as unknown as Array<Record<string, unknown>>;
}
async function clipMarkersFor(ids: string[]): Promise<Array<{ key: string; value: Record<string, unknown> }>> {
  if (!ids.length) return [];
  const { data, error } = await supabase.from("settings").select("key, value").like("key", "finance_%").in("value->>clipProductionId", ids);
  if (error) throw new Error(`settings: ${error.message}`);
  return ((data ?? []) as Array<{ key: string; value: Record<string, unknown> | null }>).filter((r) => r.value && ids.includes(String(r.value.clipProductionId))).map((r) => ({ key: r.key, value: r.value as Record<string, unknown> }));
}
export async function redFilmsDeletePreflight(rawIds: unknown[]): Promise<RfDeletePreflight> {
  const ids = [...new Set(rawIds.filter((id): id is string => typeof id === "string" && !!id))];
  let rows: Array<{ id: string; title: string | null; status: string | null; dropbox_folder_path: string | null }> = [];
  if (ids.length) {
    const { data: prods, error } = await supabase.from("red_films_productions").select("id, title, status, dropbox_folder_path").in("id", ids);
    if (error) throw new Error(`red_films_productions: ${error.message}`);
    rows = (prods ?? []) as typeof rows;
  }
  const cancelled = rows.filter((p) => p.status === "בוטל");
  const cIds = cancelled.map((p) => p.id);
  const pays = await rfRows("red_films_budget_payments", "id, production_id, amount, currency", cIds);
  const byCur: Record<string, number> = {};
  for (const p of pays) { const c = String(p.currency ?? "₪"); byCur[c] = (byCur[c] ?? 0) + (Number(p.amount) || 0); }
  const [refs, docs, links, scenes, crew, lines] = await Promise.all(RF_CHILD_TABLES.map((t) => rfRows(t, t === "red_films_budget_items" ? "id, linked_transaction_id" : t === "red_films_reference_images" || t === "red_films_documents" ? "id, dropbox_path" : "id", cIds)));
  let tasks: Array<{ id: string; calendar_event_id: string | null }> = [];
  if (cIds.length) {
    const { data: t, error: te } = await supabase.from("tasks").select("id, calendar_event_id").eq("related_type", "red_film_production").in("related_id", cIds);
    if (te) throw new Error(`tasks: ${te.message}`);
    tasks = (t ?? []) as typeof tasks;
  }
  return {
    requested: ids.length, found: rows.length, missing: ids.filter((i) => !rows.some((r) => r.id === i)),
    cancelledIds: cIds, notCancelled: rows.filter((p) => p.status !== "בוטל").map((p) => ({ id: p.id, title: p.title ?? "", status: p.status ?? "" })),
    titles: cancelled.map((p) => p.title ?? "").sort().join(", "),
    payments: pays.length, paymentsByCurrency: byCur, productionsWithPayments: [...new Set(pays.map((p) => String(p.production_id)))],
    budgetLines: lines.length, budgetLinesWithTransaction: lines.filter((l) => !!l.linked_transaction_id).length,
    documents: docs.length, referenceImages: refs.length, referenceLinks: links.length, scenes: scenes.length, crew: crew.length,
    tasks: tasks.length, googleTasks: tasks.filter((t) => !!t.calendar_event_id).length,
    storageFiles: [...refs, ...docs].filter((r) => !!r.dropbox_path).length, foldersKept: cancelled.filter((p) => !!p.dropbox_folder_path).length,
    clipMarkers: (await clipMarkersFor(cIds)).length,
  };
}
export const rfPaymentsText = (byCur: Record<string, number>) => Object.entries(byCur).map(([c, n]) => `${c}${Number(n).toLocaleString("en-US")}`).join(" + ");

/** Clear finance_<project>.clipProductionId ONLY when it still equals the deleted production (compare-and-swap on the
 *  whole stored value; one retry on a concurrent change). Returns true when a marker was cleared. */
export async function clearClipMarkerIfEqual(key: string, productionId: string): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data, error } = await supabase.from("settings").select("value").eq("key", key).maybeSingle();
    if (error) throw new Error(`settings ${key}: ${error.message}`);
    const existing = (data?.value ?? null) as Record<string, unknown> | null;
    if (!existing || existing.clipProductionId !== productionId) return false; // not ours (any more) — never touched
    const next = { ...existing }; delete next.clipProductionId;
    const { data: upd, error: ue } = await supabase.from("settings").update({ value: next }).eq("key", key).eq("value", JSON.stringify(existing)).select("key");
    if (ue) throw new Error(`settings ${key}: ${ue.message}`);
    if ((upd ?? []).length === 1) return true;
  }
  throw new Error(`settings ${key}: the clip marker changed concurrently — not cleared`);
}

/** Integration modules for the permanent delete (overridable ONLY by the fake-backed test scripts/test-deletes-ownership.tsx). */
export const RF_DELETE_IO = {
  dropbox: () => import("@/lib/dropbox-token"),
  google: () => import("@/lib/google-calendar"),
};
export type RfDeleteResult =
  | { kind: "bad"; status: number; error: string; code?: string }
  | { kind: "ok"; deleted: number; skipped: number; storageFailures: number; googleTaskFailures: number; clearedMarkers: number; warningHe: string | null };

/** POST /api/red-films/productions/bulk-permanent-delete semantics (HARDENED A5 2026-09-27): ONLY cancelled productions;
 *  preflight first (payments → HAS_PAYMENTS refusal, zero writes); then DB rows (every step's error checked — a failure
 *  stops BEFORE the productions are deleted): reference images, documents, reference links, scenes, crew, budget lines,
 *  tasks, clip markers (CAS), the productions; verified by a re-read; stored files + Google Tasks LAST, failures reported. */
export async function deleteCancelledProductions(ids: unknown[]): Promise<RfDeleteResult> {
  const productionIds = ids.filter((id): id is string => typeof id === "string");
  if (productionIds.length === 0) return { kind: "bad", status: 400, error: "ids לא תקינים" };

  // ── 0. Preflight (read-only) ──────────────────────────────────────────────
  const pre = await redFilmsDeletePreflight(productionIds);
  const allowedIds = pre.cancelledIds;
  if (allowedIds.length === 0) return { kind: "bad", status: 400, error: "אין הפקות מבוטלות למחיקה" };
  if (pre.payments > 0) {
    return { kind: "bad", status: 409, code: "HAS_PAYMENTS", error: `אי אפשר למחוק לצמיתות: ל-${pre.productionsWithPayments.length} מההפקות יש ${pre.payments} תשלומי Red Films (${rfPaymentsText(pre.paymentsByCurrency)}) — כסף אמיתי לא נמחק. קודם מטפלים בתשלומים (או משאירים את ההפקה בארכיון המבוטלות)` };
  }
  const skipped = productionIds.length - allowedIds.length;

  // collect external targets (read-only)
  const storagePaths = [
    ...(await rfRows("red_films_reference_images", "dropbox_path", allowedIds)),
    ...(await rfRows("red_films_documents", "dropbox_path", allowedIds)),
  ].map((r) => r.dropbox_path).filter((p): p is string => typeof p === "string" && !!p);
  const { data: gt, error: gte } = await supabase.from("tasks").select("id, calendar_event_id").eq("related_type", "red_film_production").in("related_id", allowedIds).not("calendar_event_id", "is", null);
  if (gte) throw new Error(`tasks: ${gte.message}`);
  const googleIds = ((gt ?? []) as Array<{ calendar_event_id: string | null }>).map((t) => t.calendar_event_id).filter((x): x is string => !!x);

  // ── 1. DB rows — every error checked; a failure stops BEFORE the productions ──
  const step = async (label: string, run: () => PromiseLike<{ error: { message: string } | null }>) => {
    const { error } = await run();
    if (error) throw new Error(`${label}: ${error.message} — ההפקות לא נמחקו (אפשר לנסות שוב)`);
  };
  for (const t of RF_CHILD_TABLES) await step(t, () => supabase.from(t).delete().in("production_id", allowedIds));
  await step("tasks", () => supabase.from("tasks").delete().eq("related_type", "red_film_production").in("related_id", allowedIds));
  let clearedMarkers = 0;
  for (const m of await clipMarkersFor(allowedIds)) if (await clearClipMarkerIfEqual(m.key, String(m.value.clipProductionId))) clearedMarkers++;
  await step("red_films_productions", () => supabase.from("red_films_productions").delete().in("id", allowedIds));
  // verify: the productions are really gone
  const { data: still, error: ve } = await supabase.from("red_films_productions").select("id").in("id", allowedIds);
  if (ve) throw new Error(`verify: ${ve.message}`);
  if ((still ?? []).length) throw new Error(`${(still ?? []).length} הפקות עדיין קיימות אחרי המחיקה`);

  // ── 2. External — stored files + Google Tasks, AFTER the DB, failures reported ──
  let storageFailures = 0;
  if (storagePaths.length) {
    try {
      const { getDropboxToken } = await RF_DELETE_IO.dropbox();
      const token = await getDropboxToken();
      const res = await Promise.all(storagePaths.map((path) =>
        fetch("https://api.dropboxapi.com/2/files/delete_v2", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ path }) })
          .then(async (r) => r.ok || /not_found/.test(await r.text().catch(() => "")), () => false)));
      storageFailures = res.filter((x) => !x).length;
    } catch { storageFailures = storagePaths.length; }
  }
  let googleTaskFailures = 0;
  if (googleIds.length) {
    try {
      const { isConnected, deleteGoogleTask } = await RF_DELETE_IO.google();
      if (await isConnected()) googleTaskFailures = (await Promise.allSettled(googleIds.map((g) => deleteGoogleTask(g)))).filter((x) => x.status === "rejected").length;
      else googleTaskFailures = googleIds.length;
    } catch { googleTaskFailures = googleIds.length; }
  }
  const warn = [storageFailures ? `${storageFailures} קבצים לא נמחקו מהאחסון` : "", googleTaskFailures ? `${googleTaskFailures} משימות Google לא נמחקו` : ""].filter(Boolean).join("; ");
  return { kind: "ok", deleted: allowedIds.length, skipped, storageFailures, googleTaskFailures, clearedMarkers, warningHe: warn ? `ההפקות נמחקו, אבל: ${warn}` : null };
}
export async function readEquipmentRow(id: string) { return one("red_films_equipment", id); }
export async function readDocumentRow(id: string) { return one("red_films_documents", id); }
export async function readReferenceRow(id: string) { return one("red_films_reference_images", id); }
export async function productionsByIds(ids: string[]): Promise<Array<{ id: string; title: string; status: string }>> {
  if (!ids.length) return [];
  const { data, error } = await supabase.from("red_films_productions").select("id, title, status").in("id", ids);
  if (error) throw new Error(error.message);
  return ((data ?? []) as Array<{ id: string; title: string | null; status: string | null }>).map((p) => ({ id: p.id, title: p.title ?? "", status: p.status ?? "" }));
}
export async function countEquipmentNamed(name: string): Promise<number> {
  const { count, error } = await supabase.from("red_films_equipment").select("id", { count: "exact", head: true }).eq("name", name);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

/** POST /api/red-films/productions/[id]/dropbox-folder semantics: /Red Films/Productions/<id> (+ references, documents),
 *  a PUBLIC folder link, both saved on the production. */
export async function createProductionFolder(productionId: string): Promise<{ basePath: string; folderUrl: string }> {
  const { createDropboxFolder, getOrCreateFolderShareLink } = await import("@/lib/dropbox-folder");
  const { getDropboxToken } = await import("@/lib/dropbox-token");
  const token = await getDropboxToken();
  const basePath = `/Red Films/Productions/${productionId}`;
  await createDropboxFolder(token, basePath);
  await createDropboxFolder(token, `${basePath}/references`);
  await createDropboxFolder(token, `${basePath}/documents`);
  const folderUrl = await getOrCreateFolderShareLink(token, basePath);
  const { error } = await supabase.from("red_films_productions").update({ dropbox_folder_path: basePath, dropbox_folder_url: folderUrl, updated_at: new Date().toISOString() }).eq("id", productionId);
  if (error) throw error;
  return { basePath, folderUrl };
}
export async function productionFolderState(productionId: string): Promise<{ hasFolder: boolean } | null> {
  const { data, error } = await supabase.from("red_films_productions").select("dropbox_folder_path").eq("id", productionId).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? { hasFolder: !!data.dropbox_folder_path } : null;
}

/** The screen's YouTube id rule (components/red-films/RedFilmsYouTubeRefs.tsx extractVideoId) — the same accepted shapes. */
export function youtubeVideoId(url: string): string | null {
  if (!url.trim()) return null;
  try {
    const u = new URL(url.trim());
    if (u.hostname.includes("youtube.com") && u.searchParams.get("v")) return u.searchParams.get("v");
    if (u.hostname === "youtu.be") return u.pathname.slice(1).split("?")[0] || null;
    const m = u.pathname.match(/\/(shorts|embed|v)\/([^/?&]+)/);
    if (m) return m[2];
  } catch {
    const m = url.trim().match(/^[a-zA-Z0-9_-]{11}$/);
    if (m) return url.trim();
  }
  return null;
}
/** POST /api/red-films/productions/[id]/reference-links semantics (url + video id required; thumbnail default). */
export async function addVideoReference(productionId: string, input: { url: string; video_id: string; title?: string; thumbnail_url?: string; provider?: string; notes?: string }) {
  const { data, error } = await supabase.from("red_films_reference_links").insert({
    production_id: productionId, url: input.url, video_id: input.video_id, provider: input.provider ?? "youtube", title: input.title ?? "",
    thumbnail_url: input.thumbnail_url ?? `https://img.youtube.com/vi/${input.video_id}/hqdefault.jpg`, notes: input.notes ?? "",
  }).select().single();
  if (error) throw new Error(error.message);
  return data as Record<string, unknown>;
}
export async function videoReferenceCount(productionId: string): Promise<number> {
  const { count, error } = await supabase.from("red_films_reference_links").select("id", { count: "exact", head: true }).eq("production_id", productionId);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

/** PATCH /api/red-films/reference-links/[linkId] — HARDENED (2026-09-27): only title / notes change (it used to write the
 *  whole request body into the row: url / video id / provider / thumbnail / production could be overwritten). */
export async function updateVideoReference(linkId: string, body: Record<string, unknown>): Promise<Record<string, unknown> | "empty"> {
  const patch: Record<string, unknown> = {};
  for (const k of ["title", "notes"]) if (typeof body[k] === "string") patch[k] = body[k];
  if (!Object.keys(patch).length) return "empty";
  const { data, error } = await supabase.from("red_films_reference_links").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", linkId).select().single();
  if (error) throw new Error(error.message);
  return data as Record<string, unknown>;
}
export async function deleteVideoReference(linkId: string): Promise<void> {
  const { error } = await supabase.from("red_films_reference_links").delete().eq("id", linkId);
  if (error) throw new Error(error.message);
}
/** Sunny's read: title / notes / provider + whether a link exists (the link itself never leaves). */
export async function readVideoReference(linkId: string): Promise<{ productionId: string; title: string; notes: string; provider: string } | null> {
  const { data, error } = await supabase.from("red_films_reference_links").select("production_id, title, notes, provider").eq("id", linkId).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? { productionId: String(data.production_id), title: String(data.title ?? ""), notes: String(data.notes ?? ""), provider: String(data.provider ?? "") } : null;
}
