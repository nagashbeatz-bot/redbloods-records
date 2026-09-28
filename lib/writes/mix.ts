/**
 * Shared mix / mastering writers used by BOTH the sound-engineer routes and Sunny's typed primitives. The existing
 * stores (lib/sound-engineer-store, lib/mix-*-store, lib/riddim-work) stay the writers; this module adds the pieces that
 * lived inline in routes (comment / version delete with their stored files) and two narrow flows:
 *
 *  • reconcileEngineerExpense — THE ONE writer of an engineer work's linked Finance expense (integrity fix A2,
 *    2026-09-27; it replaced the two retired writers "syncTransaction" and the Steven ₪ payment sync). Paid rows are
 *    protected, the work currency is kept, no silent 3.25 conversion.
 *  • recordEngineerPayment — paid / unpaid for every engineer through the store update (which runs the one writer).
 *  • deleteEngineerWorkClean — HARDENED (2026-09-27): deleting a work no longer leaves its UNPAID linked expense behind
 *    (the dangling-finance-link finding); a PAID expense is history and is always kept (its link just ends).
 *
 * Stored Dropbox paths are read from the records themselves; no caller ever supplies a path.
 */
import { supabase } from "@/lib/supabase";
import { inferBusinessUnit, unitColumns } from "@/lib/business-unit";
import { decideEngineerExpense, engineerExpenseMode, type ReconcileDecision, type ReconcileTx, type ReconcileWork } from "@/lib/mix-payment-pure";

async function deleteDropboxPaths(paths: string[]): Promise<void> {
  if (!paths.length) return;
  try {
    const { getDropboxToken } = await import("@/lib/dropbox-token");
    const token = await getDropboxToken();
    await Promise.all(paths.map((p) => fetch("https://api.dropboxapi.com/2/files/delete_v2", {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ path: p }),
    }).catch((e) => console.error("[mix] dropbox cleanup failed:", p, e))));
  } catch (e) {
    console.error("[mix] dropbox token error during cleanup:", e);
  }
}

/** DELETE /api/sound-engineer/comments/[commentId] semantics: the comment's attachment files (best effort), then the comment. */
export async function deleteMixCommentWithAttachments(commentId: string): Promise<void> {
  const { listAttachmentsForCommentInternal } = await import("@/lib/mix-comment-attachments-store");
  const { deleteMixComment } = await import("@/lib/mix-comments-store");
  const attachments = await listAttachmentsForCommentInternal(commentId);
  await deleteDropboxPaths(attachments.map((a) => a.dropboxPath).filter(Boolean) as string[]);
  await deleteMixComment(commentId);
}

/** DELETE /api/sound-engineer/versions/[versionId] semantics: the version's stored file (best effort), then the row. */
export async function deleteMixVersionWithFile(versionId: string): Promise<void> {
  const { getMixVersion, deleteMixVersion } = await import("@/lib/mix-versions-store");
  const v = await getMixVersion(versionId);
  if (v?.dropboxPath) await deleteDropboxPaths([v.dropboxPath]);
  await deleteMixVersion(versionId);
}

/**
 * Paid / unpaid for EVERY engineer (Steven included) — one call: the store update runs the ONE Finance writer
 * (reconcileEngineerExpense) server-side. Un-pay is refused while the linked expense is "שולם" (UNPAY_BLOCKED_HE).
 */
export async function recordEngineerPayment(workId: string, paid: boolean, paymentDate: string | null): Promise<void> {
  const { getSoundEngineerWork, updateSoundEngineerWork } = await import("@/lib/sound-engineer-store");
  const w = await getSoundEngineerWork(workId);
  if (!w) throw new Error("work not found");
  await updateSoundEngineerWork(workId, { amountPaid: paid ? w.agreedPrice : 0, paymentDate: paid ? paymentDate : null });
}

export interface EngineerExpenseOutcome {
  kind: ReconcileDecision["kind"];
  txId: string | null;
  /** A disagreement left in place (paid row protected) — reported, never resolved here. */
  conflictHe: string | null;
  messageHe: string;
}

/**
 * THE ONE WRITER of an engineer work's linked Finance expense (sound_engineer_work.linked_transaction_id). Every path
 * goes through it: store create / update (price, payment, engineer / type edits), recordEngineerPayment, the
 * payment-expense route, the drawer's "sync" button and Sunny's force-sync primitive.
 *
 * Rules (lib/mix-payment-pure.ts decideEngineerExpense):
 *  • a linked row whose payment_status is "שולם" is NEVER overwritten or deleted (amount / currency / status / date
 *    untouched); a disagreement is returned as a conflict for Sunny / the UI to report;
 *  • the expense is recorded in the WORK'S OWN currency and amount — no silent 3.25 conversion (the ₪ estimate is notes
 *    text only). This changes NEW Steven payment rows from "₪650" to "$200" (Owner direction, 2026-09-27); historical
 *    rows are untouched;
 *  • an existing date is never nulled; "not paid" never deletes a שולם / חלקי row;
 *  • Steven (and callers that skip the price sync): no expected row — the expense exists once the work is paid;
 *    other engineers on a project: an expected row that follows the price in the work currency;
 *  • `force` (explicit sync) refuses a standalone work.
 */
export async function reconcileEngineerExpense(workId: string, opts: { reason: string; force?: boolean; skipPriceSync?: boolean }): Promise<EngineerExpenseOutcome> {
  const { data: w, error: wErr } = await supabase
    .from("sound_engineer_work")
    .select("id, project_id, engineer_name, work_type, work_title, agreed_price, currency, amount_paid, payment_date, linked_transaction_id, status")
    .eq("id", workId)
    .maybeSingle();
  if (wErr) throw new Error(wErr.message);
  if (!w) throw new Error("עבודה לא נמצאה");
  const work: ReconcileWork = {
    id: String(w.id), projectId: (w.project_id as string | null) ?? null, engineerName: String(w.engineer_name ?? ""), workType: String(w.work_type ?? "מיקס"),
    workTitle: (w.work_title as string | null) ?? null, currency: String(w.currency ?? "$"),
    agreedPrice: Number(w.agreed_price ?? 0), amountPaid: Number(w.amount_paid ?? 0), paymentDate: (w.payment_date as string | null) ?? null,
    status: (w.status as string | null) ?? null,
  };
  const linkedId = (w.linked_transaction_id as string | null) ?? null;
  let linked: ReconcileTx | null = null;
  if (linkedId) {
    const { data: t, error: tErr } = await supabase.from("transactions").select("id, payment_status, amount, currency, date").eq("id", linkedId).maybeSingle();
    if (tErr) throw new Error(tErr.message); // fail closed: never decide on an unreadable paid row
    if (t) linked = { id: String(t.id), paymentStatus: (t.payment_status as string | null) ?? null, amount: t.amount == null ? null : Number(t.amount), currency: (t.currency as string | null) ?? null, date: (t.date as string | null) ?? null };
  }
  let artist = "", projectName = "", businessType: string | null = null;
  if (work.projectId) {
    const { data: p } = await supabase.from("projects").select("name, artist, project_business_type").eq("id", work.projectId).maybeSingle();
    projectName = String(p?.name ?? ""); artist = String(p?.artist ?? ""); businessType = (p?.project_business_type as string | null) ?? null;
  }
  const d = decideEngineerExpense(work, linked, { mode: engineerExpenseMode(work.engineerName, opts.skipPriceSync), artist, projectName, force: opts.force });
  const setLink = async (id: string | null) => {
    const { error } = await supabase.from("sound_engineer_work").update({ linked_transaction_id: id }).eq("id", workId);
    if (error) throw new Error(error.message);
  };
  switch (d.kind) {
    case "REFUSED":
      return { kind: d.kind, txId: linkedId, conflictHe: null, messageHe: d.reasonHe };
    case "NONE":
      if (linkedId && !linked) await setLink(null); // a dangling link to a row that no longer exists
      return { kind: d.kind, txId: linked?.id ?? null, conflictHe: null, messageHe: d.reasonHe };
    case "PROTECTED_PAID":
      if (d.conflictHe) console.warn(`[mix] reconcile (${opts.reason}) work ${workId}: paid expense ${d.txId} protected — ${d.conflictHe}`);
      return { kind: d.kind, txId: d.txId, conflictHe: d.conflictHe, messageHe: "שורה ששולמה לא נדרסת — ההוצאה בכספים נשארה כפי שהיא" };
    case "REMOVE_UNPAID": {
      // conditional delete: only while the row is still NOT paid (never deletes paid money, even in a race)
      const { error } = await supabase.from("transactions").delete().eq("id", d.txId).neq("payment_status", "שולם").neq("payment_status", "חלקי");
      if (error) throw new Error(error.message);
      const { data: still } = await supabase.from("transactions").select("id").eq("id", d.txId).maybeSingle();
      if (still) return { kind: "PROTECTED_PAID", txId: d.txId, conflictHe: "השורה סומנה בינתיים כשולמה — נשארה", messageHe: "שורה ששולמה לא נדרסת" };
      await setLink(null);
      return { kind: d.kind, txId: null, conflictHe: null, messageHe: "הוצאה שלא שולמה הוסרה (אין הוצאה עד שמסמנים שולם)" };
    }
    case "UPDATE": {
      // conditional update: never rewrites a row that became "שולם" meanwhile
      const { data: upd, error } = await supabase.from("transactions").update(d.fields).eq("id", d.txId).neq("payment_status", "שולם").select("id");
      if (error) throw new Error(error.message);
      if (!upd || upd.length === 0) return { kind: "PROTECTED_PAID", txId: d.txId, conflictHe: "השורה סומנה בינתיים כשולמה — לא נדרסה", messageHe: "שורה ששולמה לא נדרסת" };
      return { kind: d.kind, txId: d.txId, conflictHe: null, messageHe: "ההוצאה המקושרת עודכנה (במטבע העבודה)" };
    }
    case "INSERT": {
      // business unit (Owner decision 2026-09-28): the unit of the PROJECT the work belongs to — a Records (לייבל) project
      // → RECORDS (100 % Records, 0 % artist), a client project → STUDIO; no project → "דורש סיווג"
      const { data: ins, error } = await supabase.from("transactions").insert({ ...d.fields, ...unitColumns(inferBusinessUnit({ writer: "MIX", type: "expense", project: work.projectId ? { businessType } : null })) }).select("id").single();
      if (error) throw new Error(error.message);
      const newId = String(ins?.id ?? "");
      await setLink(newId);
      return { kind: d.kind, txId: newId, conflictHe: null, messageHe: "נרשמה הוצאה מקושרת (במטבע העבודה)" };
    }
  }
}

/** The linked expense row of a work (id + status), if any. */
export async function engineerWorkExpense(workId: string): Promise<{ id: string; status: string; amount: number; currency: string } | null> {
  const { data: w } = await supabase.from("sound_engineer_work").select("linked_transaction_id").eq("id", workId).maybeSingle();
  const txId = (w as { linked_transaction_id?: string | null } | null)?.linked_transaction_id;
  if (!txId) return null;
  const { data: t } = await supabase.from("transactions").select("id, payment_status, amount, currency").eq("id", txId).maybeSingle();
  return t ? { id: String(t.id), status: String(t.payment_status ?? ""), amount: Number(t.amount) || 0, currency: String(t.currency ?? "") } : null;
}

/** HARDENED delete: the work, and its linked expense only when that expense is NOT paid (a paid one is kept as history). */
export async function deleteEngineerWorkClean(workId: string): Promise<{ removedExpense: boolean }> {
  const { deleteSoundEngineerWork } = await import("@/lib/sound-engineer-store");
  const exp = await engineerWorkExpense(workId);
  await deleteSoundEngineerWork(workId);
  if (exp && exp.status !== "שולם") {
    const { error } = await supabase.from("transactions").delete().eq("id", exp.id);
    if (error) throw new Error(`the work was deleted but its unpaid expense was not: ${error.message}`);
    return { removedExpense: true };
  }
  return { removedExpense: false };
}

/** DELETE /api/sound-engineer/comments/[commentId]/attachments/[attachmentId] semantics: the stored file best-effort
 *  (a failure is logged, not fatal), then the row. The attachment must belong to that comment. */
export async function deleteCommentAttachment(commentId: string, attachmentId: string): Promise<"ok" | "not_found"> {
  const { getAttachmentInternal, deleteAttachment } = await import("@/lib/mix-comment-attachments-store");
  const a = await getAttachmentInternal(attachmentId);
  if (!a || a.commentId !== commentId) return "not_found" as const;
  try {
    const { getDropboxToken } = await import("@/lib/dropbox-token");
    const token = await getDropboxToken();
    await fetch("https://api.dropboxapi.com/2/files/delete_v2", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ path: a.dropboxPath }) });
  } catch (e) {
    console.error("[comments/attachments DELETE] storage cleanup failed:", e);
  }
  await deleteAttachment(attachmentId);
  return "ok";
}
/** Sunny: metadata of one attachment (never the path). */
export async function readCommentAttachment(attachmentId: string): Promise<{ commentId: string; fileName: string } | null> {
  const { getAttachmentInternal } = await import("@/lib/mix-comment-attachments-store");
  const a = await getAttachmentInternal(attachmentId);
  return a ? { commentId: a.commentId, fileName: a.fileName } : null;
}
