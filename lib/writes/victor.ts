/**
 * Shared Victor writers — used by BOTH the Victor routes (Owner side; the Victor-role checks stay in the routes and in
 * lib/victor-scope) and Sunny's typed primitives. Route logic moved here verbatim:
 *   • ownerPatchVictorWork: the update + the "work completed" push on a real → הושלם transition + the internal-deadline
 *     follow-up task / Google Task (create or move);
 *   • notifyVictorWork / sendVictorVersionNotes: the Owner's two send buttons (server-built content);
 *   • recordVictorSalaryMonth: the salary month's expense row (duplicate-guarded by the salary key; a cancelled row is
 *     reused). A salary month is paid only when that row is שולם.
 * HARDENED (2026-09-27, Universal Actions):
 *   • removeVictorWork deletes the work's follow-up task (and its Google Task) before the work — the "task stays behind"
 *     finding; the Dropbox folder is never touched here.
 *   • saveVictorReviewDraft writes ONE version's review (read-merge-write with an updated_at claim), instead of the whole
 *     JSON column blindly.
 */
import { supabase } from "@/lib/supabase";
import type { VersionReview } from "@/lib/types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = Record<string, any>;
const MISSING = "not_found" as const;

export async function ownerPatchVictorWork(id: string, body: Body): Promise<void> {
  const { updateVictorWork, getVictorWorkById } = await import("@/lib/vendor-store");
  const existingWork = await getVictorWorkById(id);
  await updateVictorWork(id, body);

  if ("status" in body && existingWork && existingWork.status !== "הושלם" && body.status === "הושלם") {
    try {
      const updatedWork = await getVictorWorkById(id);
      if (updatedWork) {
        const { notifyVictorWorkCompleted } = await import("@/lib/victor-completed-notify");
        const displayName = (updatedWork.title && updatedWork.title.trim()) ? updatedWork.title : updatedWork.projectName;
        await notifyVictorWorkCompleted({ id: updatedWork.id, displayName, fromUpdatedAt: existingWork.updatedAt });
      }
    } catch (e) {
      console.error("[vendor/victor/work] completed-notify failed (non-fatal):", e);
    }
  }

  const internalDeadline: string | null = "internalDeadline" in body ? (body.internalDeadline as string | null) : null;
  if (!("internalDeadline" in body) || !internalDeadline) return;

  const { createTask, patchTask, getTask } = await import("@/lib/tasks-store");
  const { createGoogleTask, updateGoogleTaskDue, isConnected } = await import("@/lib/google-calendar");
  if (!existingWork?.linkedTaskId) {
    const title = `מעקב ויקטור — ${existingWork?.projectName ?? id}`;
    const task = await createTask({ title, related_type: "project", related_id: existingWork?.projectId ?? null, due_date: internalDeadline, status: "פתוח" });
    try {
      if (await isConnected()) {
        const { id: googleId } = await createGoogleTask(title, internalDeadline);
        await patchTask(task.id, { calendar_event_id: googleId });
      }
    } catch { /* Google Tasks is best-effort — the Redbloods task exists */ }
    await updateVictorWork(id, { linkedTaskId: task.id });
  } else {
    const existingTask = await getTask(existingWork.linkedTaskId);
    if (existingTask) {
      await patchTask(existingTask.id, { due_date: internalDeadline });
      try {
        if (existingTask.calendar_event_id && (await isConnected())) await updateGoogleTaskDue(existingTask.calendar_event_id, internalDeadline);
      } catch { /* best-effort */ }
    }
  }
}

/** HARDENED remove: the follow-up task (+ its Google Task) first, then the work. The Dropbox folder stays. */
export async function removeVictorWork(id: string): Promise<{ removedTask: boolean }> {
  const { getVictorWorkById, deleteVictorWork } = await import("@/lib/vendor-store");
  const w = await getVictorWorkById(id);
  let removedTask = false;
  if (w?.linkedTaskId) {
    const { deleteTaskRecord } = await import("@/lib/writes/tasks");
    removedTask = (await deleteTaskRecord(w.linkedTaskId)) === "ok";
  }
  await deleteVictorWork(id);
  return { removedTask };
}

export type SendResult = { ok: true; victorSent?: unknown; ownerSent?: unknown } | { ok: false; reason: string };

/** The Owner's 'send to Victor' push (server-built; needs a Victor-facing title). */
export async function notifyVictorWork(workId: string): Promise<SendResult> {
  const { data: row } = await supabase.from("vendor_project_work").select("id, title, vendor_name, project_id").eq("id", workId).maybeSingle();
  if (!row) return { ok: false, reason: "not_found" };
  if ((row.vendor_name as string) !== "victor") return { ok: false, reason: "forbidden" };
  const title = ((row.title as string | null) ?? "").trim();
  if (!title) return { ok: false, reason: "no_title" };
  const { notifyVictorNewWork } = await import("@/lib/victor-work-notify");
  const r = await notifyVictorNewWork(workId, title, (row.project_id as string | null) ?? null);
  return r.ok ? { ok: true, victorSent: r.victorSent, ownerSent: r.ownerSent } : { ok: false, reason: r.reason };
}

/** The Owner's 'send notes' on one version: push, then the review is marked sent (sentNotes / sentAt, draft false). */
export async function sendVictorVersionNotes(workId: string, versionKey: string): Promise<SendResult & { review?: VersionReview }> {
  const { getVictorWorkById, updateVictorWork } = await import("@/lib/vendor-store");
  const work = await getVictorWorkById(workId);
  if (!work) return { ok: false, reason: "not_found" };
  if (work.vendorName !== "victor") return { ok: false, reason: "forbidden" };
  const title = (work.title ?? "").trim();
  if (!title) return { ok: false, reason: "no_title" };
  const reviews = { ...(work.versionReviews ?? {}) };
  const review = reviews[versionKey];
  const notes = (review?.notes ?? "").trim();
  if (!review || !notes) return { ok: false, reason: "no_notes" };
  const ownerLabel = (work.projectName ?? "").trim() || title;
  const { notifyVictorVersionNotes } = await import("@/lib/victor-version-notes-notify");
  const result = await notifyVictorVersionNotes(workId, title, versionKey, ownerLabel);
  if (!result.ok) return { ok: false, reason: result.reason };
  const updated: VersionReview = { ...review, notes, sentNotes: notes, sentAt: new Date().toISOString(), draft: false };
  reviews[versionKey] = updated;
  await updateVictorWork(workId, { versionReviews: reviews });
  return { ok: true, review: updated, victorSent: result.victorSent };
}

/** Save ONE version's review draft (per-version, claimed by updated_at so a concurrent save is refused, not lost). */
export async function saveVictorReviewDraft(workId: string, versionKey: string, notes: string): Promise<"ok" | "not_found" | "conflict"> {
  const { data: row, error } = await supabase.from("vendor_project_work").select("version_reviews, updated_at, vendor_name").eq("id", workId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!row || row.vendor_name !== "victor") return MISSING;
  const reviews = { ...((row.version_reviews ?? {}) as Record<string, VersionReview>) };
  reviews[versionKey] = { ...(reviews[versionKey] ?? {}), notes, draft: true } as VersionReview;
  const { data: upd, error: uErr } = await supabase.from("vendor_project_work").update({ version_reviews: reviews, updated_at: new Date().toISOString() }).eq("id", workId).eq("updated_at", row.updated_at).select("id");
  if (uErr) throw new Error(uErr.message);
  return (upd ?? []).length ? "ok" : "conflict";
}

/** POST /api/vendor/victor/salary semantics. */
export async function recordVictorSalaryMonth(p: { workMonth: string; amount: number; currency: string; historicPaid?: boolean; paidDate?: string }): Promise<{ kind: "ok" | "duplicate"; transaction: Record<string, unknown> } | { kind: "error"; message: string }> {
  const { salaryLinkedId, salaryDueDate, salaryTransactionDescription } = await import("@/lib/vendor-store");
  const { workMonth, amount, currency, historicPaid = false, paidDate } = p;
  const linkedId = salaryLinkedId(workMonth);
  const dueDate = salaryDueDate(workMonth);
  const { data: existing } = await supabase.from("transactions").select("id, payment_status").eq("linked_session_id", linkedId).maybeSingle();
  if (existing) {
    const ex = existing as { id: string; payment_status: string };
    if (ex.payment_status !== "בוטל") return { kind: "duplicate", transaction: existing as Record<string, unknown> };
    const { data: updated, error: updateErr } = await supabase.from("transactions").update({
      payment_status: historicPaid ? "שולם" : "לא שולם", amount, currency, date: paidDate ?? dueDate, notes: historicPaid ? "סומן כשולם היסטורית מתוך כרטיס Victor" : "",
    }).eq("id", ex.id).select().single();
    if (updateErr) return { kind: "error", message: updateErr.message };
    return { kind: "ok", transaction: updated as Record<string, unknown> };
  }
  const { data, error } = await supabase.from("transactions").insert({
    scope: "general", type: "expense", project_id: null, artist: "Victor", description: salaryTransactionDescription(workMonth), amount, currency,
    payment_status: historicPaid ? "שולם" : "לא שולם", category: "צוות", date: paidDate ?? dueDate, linked_session_id: linkedId,
    notes: historicPaid ? "סומן כשולם היסטורית מתוך כרטיס Victor" : "", payment_method: "", receipt_ref: "", expense_scope: "כללי",
  }).select().single();
  if (error) {
    const conflict = error.code === "23505" && /\btransactions_victor_salary_period_uk\b/.test(`${error.message ?? ""} ${error.details ?? ""}`);
    if (conflict) {
      const { data: winner } = await supabase.from("transactions").select("id, payment_status").eq("linked_session_id", linkedId).maybeSingle();
      const w = winner as { id: string; payment_status: string } | null;
      if (w && w.payment_status !== "בוטל") return { kind: "duplicate", transaction: w as unknown as Record<string, unknown> };
    }
    return { kind: "error", message: error.message };
  }
  return { kind: "ok", transaction: data as Record<string, unknown> };
}

/** The salary month's finance row (paid only when שולם). */
export async function victorSalaryRow(workMonth: string): Promise<{ id: string; status: string; amount: number; currency: string } | null> {
  const { salaryLinkedId } = await import("@/lib/vendor-store");
  const { data } = await supabase.from("transactions").select("id, payment_status, amount, currency").eq("linked_session_id", salaryLinkedId(workMonth)).maybeSingle();
  return data ? { id: String(data.id), status: String(data.payment_status ?? ""), amount: Number(data.amount) || 0, currency: String(data.currency ?? "") } : null;
}

/** The Owner's statements about one salary month (settings): amount / status overrides + the legacy monthly mark.
 *  null = no statement recorded (the legacy getter's "צפוי" default is NOT treated as a statement). */
export async function victorMonthStatements(workMonth: string): Promise<{ amountOverride: number | null; statusOverride: string | null; legacyMark: string | null }> {
  const keys = ["vendor_victor_salary_overrides", "vendor_victor_salary_status_overrides", `vendor_victor_payment_${workMonth.replace("-", "_")}`];
  const { data, error } = await supabase.from("settings").select("key, value").in("key", keys);
  if (error) throw new Error(error.message);
  const by = new Map(((data ?? []) as Array<{ key: string; value: Record<string, unknown> | null }>).map((r) => [r.key, r.value ?? {}]));
  const a = by.get(keys[0])?.[workMonth];
  const st = by.get(keys[1])?.[workMonth];
  const lg = by.get(keys[2])?.status;
  return { amountOverride: typeof a === "number" ? a : null, statusOverride: typeof st === "string" ? st : null, legacyMark: typeof lg === "string" ? lg : null };
}
