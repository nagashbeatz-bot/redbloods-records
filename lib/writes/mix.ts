/**
 * Shared mix / mastering writers used by BOTH the sound-engineer routes and Sunny's typed primitives. The existing
 * stores (lib/sound-engineer-store, lib/mix-*-store, lib/riddim-work) stay the writers; this module adds the pieces that
 * lived inline in routes (comment / version delete with their stored files) and two narrow flows:
 *
 *  • recordEngineerPayment — exactly the Steven page for a Steven work (skipFinanceSync + the id-linked payment expense
 *    reconcile) and the drawer path for any other engineer (the auto-synced linked expense). The app's own rules only;
 *    the "two finance writers" conflict is reported in the mix contract, never resolved here.
 *  • deleteEngineerWorkClean — HARDENED (2026-09-27): deleting a work no longer leaves its UNPAID linked expense behind
 *    (the dangling-finance-link finding); a PAID expense is history and is always kept (its link just ends).
 *
 * Stored Dropbox paths are read from the records themselves; no caller ever supplies a path.
 */
import { supabase } from "@/lib/supabase";

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

/** Paid / unpaid exactly like the app: Steven → the Steven page's two calls; others → the drawer's auto-synced expense. */
export async function recordEngineerPayment(workId: string, paid: boolean, paymentDate: string | null): Promise<void> {
  const { getSoundEngineerWork, updateSoundEngineerWork, syncStevenPaymentExpense } = await import("@/lib/sound-engineer-store");
  const w = await getSoundEngineerWork(workId);
  if (!w) throw new Error("work not found");
  if (w.engineerName === "Steven") {
    await updateSoundEngineerWork(workId, { skipFinanceSync: true, amountPaid: paid ? w.agreedPrice : 0, paymentDate: paid ? paymentDate : null });
    await syncStevenPaymentExpense(workId);
  } else {
    await updateSoundEngineerWork(workId, { amountPaid: paid ? w.agreedPrice : 0, paymentDate: paid ? paymentDate : null });
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
