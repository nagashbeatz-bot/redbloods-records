/**
 * Shared Red Films + clip-planning writers — used by BOTH the routes and Sunny's typed primitives. Route bodies moved
 * here verbatim (same allowed-field lists, defaults and validations), with two HARDENINGS (2026-09-27):
 *   • updateProduction: a cancel (status בוטל) now saves the production FIRST and only then cancels its future tasks /
 *     Google Tasks (they used to be cancelled even when the save then failed);
 *   • promoteClipItem: the clip row is CLAIMED (deleted only while it has no linked expense) before the expense is
 *     created, so a double click can never create two expenses; if the expense insert fails the row is restored.
 * Money here is planning unless it is a Finance transaction: production budget / budget lines / clip rows are planning,
 * Red Films payments are their own ledger, only a Finance expense with scope קליפ is actual spend.
 */
import { supabase } from "@/lib/supabase";
import { touchProject } from "@/lib/projects-store";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = Record<string, any>;
export class RfInputError extends Error {}

export async function createProduction(body: Body): Promise<Record<string, unknown>> {
  const title = body.title;
  if (!title || typeof title !== "string" || !title.trim()) throw new RfInputError("שם ההפקה חובה");
  const now = new Date().toISOString();
  const { data, error } = await supabase.from("red_films_productions").insert({
    title: title.trim(), production_type: body.production_type ?? "קליפ", status: "רעיון", project_id: body.project_id ?? null,
    artist_name: body.artist_name ?? "", client_id: body.client_id ?? null, client_name: body.client_name ?? "", photographer_name: body.photographer_name ?? "",
    client_source: "פנימי - לייבל", collection_status: "לא רלוונטי", created_at: now, updated_at: now,
  }).select().single();
  if (error) throw error;
  return data as Record<string, unknown>;
}

export const PRODUCTION_ALLOWED_FIELDS = new Set([
  "title", "production_type", "status", "project_id", "client_id", "artist_name", "client_name", "client_source",
  "photographer_name", "director_name", "editor_name", "shoot_date", "locations", "concept_summary", "concept_vibe", "ref_links",
  "script_start", "script_middle", "script_end", "director_notes", "photographer_notes", "general_budget", "client_price",
  "advance_required", "advance_received", "collection_status", "files_raw_link", "files_edit_folder", "version_1_link",
  "version_2_link", "final_version_link", "fix_notes", "edit_status", "publish_date", "published_where", "notes",
]);

export type UpdateProductionResult = { kind: "ok"; production: Record<string, unknown>; budgetLocked: boolean } | { kind: "budget_locked" } | { kind: "empty" } | { kind: "not_found" };

/** PATCH semantics; HARDENED ordering for a cancel (save first, then the task cleanup). */
export async function updateProduction(id: string, body: Body): Promise<UpdateProductionResult> {
  const { isManagedClipProduction } = await import("@/lib/clip-production");
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const [key, val] of Object.entries(body)) if (PRODUCTION_ALLOWED_FIELDS.has(key)) patch[key] = val;
  let budgetLocked = false;
  if ("general_budget" in patch) {
    const { data: current } = await supabase.from("red_films_productions").select("id, project_id").eq("id", id).maybeSingle();
    if (current && await isManagedClipProduction(current as { id: string; project_id?: string | null })) { delete patch.general_budget; budgetLocked = true; }
  }
  if (Object.keys(patch).length === 1) return budgetLocked ? { kind: "budget_locked" } : { kind: "empty" };

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
  const stillManaged = await isManagedClipProduction(data as { id: string; project_id?: string | null });
  return { kind: "ok", production: { ...(data as Record<string, unknown>), budget_managed_by_project: stillManaged }, budgetLocked };
}

export async function createBudgetLine(productionId: string, body: Body): Promise<Record<string, unknown>> {
  const now = new Date().toISOString();
  const { data, error } = await supabase.from("red_films_budget_items").insert({
    production_id: productionId, title: body.title ?? "", category: body.category ?? "אחר", planned_amount: Number(body.planned_amount) || 0,
    actual_amount: Number(body.actual_amount) || 0, vendor_name: body.vendor_name ?? "", status: body.status ?? "מתוכנן", notes: body.notes ?? "", created_at: now, updated_at: now,
  }).select().single();
  if (error) throw error;
  return data as Record<string, unknown>;
}
const BUDGET_ALLOWED = new Set(["title", "category", "planned_amount", "actual_amount", "vendor_name", "status", "notes"]);
export async function updateBudgetLine(itemId: string, body: Body): Promise<Record<string, unknown>> {
  const fields: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const [k, v] of Object.entries(body)) if (BUDGET_ALLOWED.has(k)) fields[k] = v;
  const { data, error } = await supabase.from("red_films_budget_items").update(fields).eq("id", itemId).select().single();
  if (error) throw error;
  return data as Record<string, unknown>;
}
export async function deleteBudgetLine(itemId: string): Promise<void> {
  const { error } = await supabase.from("red_films_budget_items").delete().eq("id", itemId);
  if (error) throw error;
}

/** The payment-row insert of POST /budget-items/[itemId]/payments (a receipt, when uploaded by the route, is passed in). */
export async function insertBudgetPayment(itemId: string, p: { amount: number; paymentDate: string; paymentMethod: string; notes: string; receipt?: { fileName: string; mimeType: string; dropboxPath: string; dropboxUrl: string } }): Promise<{ kind: "not_found" } | { kind: "ok"; payment: Record<string, unknown> }> {
  if (!(p.amount > 0)) throw new RfInputError("סכום חייב להיות גדול מ-0");
  const { data: item, error: itemErr } = await supabase.from("red_films_budget_items").select("id, production_id, title").eq("id", itemId).maybeSingle();
  if (itemErr) throw itemErr;
  if (!item) return { kind: "not_found" };
  const now = new Date().toISOString();
  const { data, error } = await supabase.from("red_films_budget_payments").insert({
    production_id: item.production_id as string, budget_item_id: itemId, amount: p.amount, payment_date: p.paymentDate, payment_method: p.paymentMethod, notes: p.notes,
    receipt_file_name: p.receipt?.fileName ?? "", receipt_mime_type: p.receipt?.mimeType ?? "", receipt_dropbox_path: p.receipt?.dropboxPath ?? "", receipt_dropbox_url: p.receipt?.dropboxUrl ?? "",
    created_at: now, updated_at: now,
  }).select().single();
  if (error) throw error;
  return { kind: "ok", payment: data as Record<string, unknown> };
}
const PAYMENT_ALLOWED = new Set(["amount", "payment_date", "payment_method", "notes", "receipt_file_name", "receipt_mime_type", "receipt_dropbox_path", "receipt_dropbox_url"]);
export async function updateBudgetPayment(paymentId: string, body: Body): Promise<Record<string, unknown>> {
  const fields: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const [k, v] of Object.entries(body)) if (PAYMENT_ALLOWED.has(k)) fields[k] = v;
  const { data, error } = await supabase.from("red_films_budget_payments").update(fields).eq("id", paymentId).select().single();
  if (error) throw error;
  return data as Record<string, unknown>;
}
export async function deleteBudgetPayment(paymentId: string): Promise<void> {
  const { error } = await supabase.from("red_films_budget_payments").delete().eq("id", paymentId);
  if (error) throw error;
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
export async function updateClipItem(id: string, body: Body): Promise<Record<string, unknown>> {
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

/** 'העבר לכספים': the clip row becomes ONE unpaid Finance expense (scope קליפ) and the row is removed. HARDENED claim. */
export async function promoteClipItem(id: string, date: string): Promise<{ kind: "not_found" } | { kind: "already_promoted"; transactionId: string } | { kind: "ok"; transaction: Record<string, unknown> }> {
  const { data: item, error: fetchErr } = await supabase.from("clip_items").select("*").eq("id", id).maybeSingle();
  if (fetchErr || !item) return { kind: "not_found" };
  if (item.linked_transaction_id) return { kind: "already_promoted", transactionId: String(item.linked_transaction_id) };
  // Claim: remove the row only while it is still unpromoted — a concurrent second click deletes nothing and stops here.
  const { data: claimed, error: claimErr } = await supabase.from("clip_items").delete().eq("id", id).is("linked_transaction_id", null).select("id");
  if (claimErr) throw new Error(claimErr.message);
  if (!claimed || claimed.length === 0) return { kind: "not_found" };
  const { data: tx, error: txErr } = await supabase.from("transactions").insert({
    project_id: item.project_id, scope: "project", type: "expense", date: date || null, description: item.description || item.category || "הוצאת קליפ", artist: "",
    amount: item.amount, currency: item.currency, payment_status: "לא שולם", payment_method: "", receipt_ref: "", notes: item.notes || "", category: item.category || "קליפ",
    linked_session_id: "", expense_scope: "קליפ",
  }).select().single();
  if (txErr || !tx) {
    const { id: _drop, ...rest } = item as Record<string, unknown>; void _drop;
    await supabase.from("clip_items").insert({ id, ...rest }); // restore the planning row
    throw new Error(txErr?.message ?? "failed to create transaction");
  }
  touchProject(item.project_id as string).catch(() => {});
  return { kind: "ok", transaction: tx as Record<string, unknown> };
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

const EQUIPMENT_ALLOWED_FIELDS = new Set(["name", "category", "quantity", "acquired_date", "purchase_price", "purchased_from", "serial_number", "notes", "added_by", "status"]);
/** PATCH /api/red-films/equipment/[id] semantics (validation verbatim; status drives removed_at). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function updateEquipment(id: string, body: Record<string, any>): Promise<{ kind: "bad"; status: number; error: string } | { kind: "ok"; item: Record<string, unknown> }> {
  const ALLOWED_FIELDS = EQUIPMENT_ALLOWED_FIELDS;

    const patch: Record<string, unknown> = {};
    for (const key of Object.keys(body)) {
      if (!ALLOWED_FIELDS.has(key)) continue;
      patch[key] = body[key];
    }

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

/** POST /api/red-films/productions/bulk-permanent-delete semantics: ONLY cancelled productions; reference images (+ files),
 *  budget lines, tasks (+ Google Tasks) and the productions are removed; the rest are skipped. */
export async function deleteCancelledProductions(ids: unknown[]): Promise<{ kind: "bad"; status: number; error: string } | { kind: "ok"; deleted: number; skipped: number }> {
    const productionIds = ids.filter((id): id is string => typeof id === "string");
    if (productionIds.length === 0) {
      return { kind: "bad" as const, status: 400, error: "ids לא תקינים" };
    }

    // ── 1. Guard: only allow "בוטל" productions ────────────────────────────────
    const { data: productions, error: fetchErr } = await supabase
      .from("red_films_productions")
      .select("id, status")
      .in("id", productionIds);

    if (fetchErr) throw fetchErr;

    const allowedIds = (productions ?? [])
      .filter(p => p.status === "בוטל")
      .map(p => p.id);

    if (allowedIds.length === 0) {
      return { kind: "bad" as const, status: 400, error: "אין הפקות מבוטלות למחיקה" };
    }

    const skipped = productionIds.length - allowedIds.length;

    // ── 2. Reference images — delete from Dropbox (non-fatal) + DB ────────────
    const { data: refImages } = await supabase
      .from("red_films_reference_images")
      .select("id, dropbox_path")
      .in("production_id", allowedIds);

    if (refImages && refImages.length > 0) {
      try {
        const { getDropboxToken } = await import("@/lib/dropbox-token");
        const token = await getDropboxToken();
        await Promise.all(
          refImages.map(r =>
            fetch("https://api.dropboxapi.com/2/files/delete_v2", {
              method: "POST",
              headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
              body: JSON.stringify({ path: r.dropbox_path }),
            }).catch(() => { /* non-fatal */ })
          )
        );
      } catch { /* non-fatal — DB rows will still be deleted */ }

      await supabase
        .from("red_films_reference_images")
        .delete()
        .in("production_id", allowedIds);
    }

    // ── 3. Budget items ────────────────────────────────────────────────────────
    await supabase
      .from("red_films_budget_items")
      .delete()
      .in("production_id", allowedIds);

    // ── 4. Tasks (all — production is gone permanently) ────────────────────────
    // Google Tasks cleanup: future tasks should already be cancelled when moved to trash.
    // We attempt cleanup for any remaining calendar_event_ids before deleting from DB.
    try {
      const { data: tasksWithGoogle } = await supabase
        .from("tasks")
        .select("id, calendar_event_id")
        .eq("related_type", "red_film_production")
        .in("related_id", allowedIds)
        .not("calendar_event_id", "is", null);

      if (tasksWithGoogle && tasksWithGoogle.length > 0) {
        const { isConnected, deleteGoogleTask } = await import("@/lib/google-calendar");
        if (await isConnected()) {
          await Promise.all(
            tasksWithGoogle.map(t =>
              t.calendar_event_id
                ? deleteGoogleTask(t.calendar_event_id).catch(() => { /* non-fatal */ })
                : Promise.resolve()
            )
          );
        }
      }
    } catch { /* non-fatal */ }

    await supabase
      .from("tasks")
      .delete()
      .eq("related_type", "red_film_production")
      .in("related_id", allowedIds);

    // ── 5. Delete productions ──────────────────────────────────────────────────
    const { error: delErr } = await supabase
      .from("red_films_productions")
      .delete()
      .in("id", allowedIds);

    if (delErr) throw delErr;

  return { kind: "ok", deleted: allowedIds.length, skipped };
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
