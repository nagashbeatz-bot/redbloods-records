import "server-only";
import { supabase } from "@/lib/supabase";
import { VICTOR_MONTH_RE, naturalMonthRef, workMonthOf } from "@/lib/victor-segments";

/**
 * "העבר לחודש אחר" (Owner-only, 2026-10-17): changes ONLY the work's month attribution (vendor_project_work.attributed_month)
 * — never the sent date, completion, deadline, status, files, notes or money, and sends no push. Moving back to the
 * natural month (by sent date) clears the attribution. Compare-and-swap on the attribution itself: a concurrent move is
 * refused, never overwritten. A completed work moves with its count (the one month rule, lib/victor-segments).
 */
export async function moveVictorWorkMonth(workId: string, toMonth: string): Promise<
  | { kind: "ok"; from: string; to: string; attributedMonth: string | null }
  | { kind: "no_change"; month: string }
  | { kind: "not_found" } | { kind: "invalid" } | { kind: "conflict" }> {
  if (typeof toMonth !== "string" || !VICTOR_MONTH_RE.test(toMonth)) return { kind: "invalid" };
  const { data: row, error } = await supabase.from("vendor_project_work").select("id, vendor_name, sent_date, created_at, attributed_month").eq("id", workId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!row || row.vendor_name !== "victor") return { kind: "not_found" };
  const cur = { sentDate: (row.sent_date as string | null) ?? null, createdAt: String(row.created_at ?? ""), attributedMonth: (row.attributed_month as string | null) ?? null };
  const from = workMonthOf(cur);
  if (from === toMonth) return { kind: "no_change", month: from };
  const next = naturalMonthRef(cur).slice(0, 7) === toMonth ? null : toMonth;
  const q = supabase.from("vendor_project_work").update({ attributed_month: next }).eq("id", workId);
  const { data: upd, error: uErr } = await (cur.attributedMonth === null ? q.is("attributed_month", null) : q.eq("attributed_month", cur.attributedMonth)).select("id");
  if (uErr) throw new Error(uErr.message);
  if (!(upd ?? []).length) return { kind: "conflict" };
  return { kind: "ok", from, to: toMonth, attributedMonth: next };
}
