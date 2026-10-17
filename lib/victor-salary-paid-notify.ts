import "server-only";
import { supabase } from "./supabase";
import { settingsClaimStore, pushAllowed } from "./push-claims";
import { classify, deliverOnce, ilYmd, type DeliverOnceOutcome } from "./push-claims-pure";
import {
  VICTOR_PUSH_LANG_KEY,
  VICTOR_SALARY_PAID_CLAIM_VERSION,
  buildVictorSalaryOwnerAck,
  buildVictorSalaryPush,
  isSalaryRealPaidTransition,
  normalizeVictorPushLang,
  victorSalaryEligibility,
  victorSalaryPaidClaimKey,
  type VictorSalarySkipReason,
} from "./victor-salary-paid-notify-pure";

/**
 * "Your salary was paid" — ONE shared notification point (P_VICTOR_SALARY_PAID, Owner spec 2026-10-17) for every writer
 * that can move a Victor salary month's Finance row to שולם:
 *   • a Finance edit of the row (updateTransactionRecord, lib/writes/finance — the Finance page + Sunny SET_TRANSACTION_STATUS)
 *   • "send to Finance" from Victor's card / Sunny RECORD_VICTOR_SALARY_MONTH with historic paid (recordVictorSalaryMonth)
 *   • the approved RECORD_PAID_EXPENSE execution (executeApprovedAction, lib/partner/actions/action-service)
 * Each writer calls it AFTER its own write succeeded, with the row's status BEFORE the write (null = a new row).
 * The salary modal's status override is an Owner statement in settings, not a Finance row, and never calls this.
 *
 * Order (the money is already committed and is NEVER touched here):
 *   1. a real transition, and a fresh read: a salary expense row that is שולם now, due not more than 45 days ago;
 *   2. pushAllowed() — checked BEFORE any claim, so a dev run never leaves a stuck claim;
 *   3. ONE delivery claim per salary month (settings victor_salary_paid_pushed_<YYYY-MM>, INSERT-first / compare-and-swap);
 *      "sent" only after a classified delivery success, else a durable "failed" (a later real transition may retry);
 *   4. ONLY when Victor's push was delivered: the Owner's ack (its failure is logged, never re-sends to Victor).
 * Never throws.
 */

export type VictorSalaryNotifyResult =
  | { kind: "skipped"; reason: VictorSalarySkipReason | "not_a_transition" | "push_not_allowed" | "row_not_found" }
  | { kind: "attempted"; victor: DeliverOnceOutcome; ownerAck: "sent" | "failed" | "not_attempted"; warning?: string };

export async function notifyVictorSalaryPaid(input: { txId: string; before: string | null | undefined }): Promise<VictorSalaryNotifyResult> {
  try {
    if (!input.txId || !isSalaryRealPaidTransition(input.before, "שולם")) return { kind: "skipped", reason: "not_a_transition" };
    const { data: tx, error } = await supabase.from("transactions").select("id, type, payment_status, linked_session_id").eq("id", input.txId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!tx) return { kind: "skipped", reason: "row_not_found" };
    const row = tx as { id: string; type: string | null; payment_status: string | null; linked_session_id: string | null };
    const el = victorSalaryEligibility({ linkedSessionId: row.linked_session_id, type: row.type, status: row.payment_status, todayYmd: ilYmd(Date.now()) });
    if (!el.ok) return { kind: "skipped", reason: el.reason };
    if (!pushAllowed()) return { kind: "skipped", reason: "push_not_allowed" }; // localhost / non-prod: never a send, never a claim

    const { data: langRow } = await supabase.from("settings").select("value").eq("key", VICTOR_PUSH_LANG_KEY).maybeSingle();
    const lang = normalizeVictorPushLang((langRow?.value as { lang?: unknown } | null)?.lang);
    const msg = buildVictorSalaryPush(el.workMonth, lang);
    const { sendPushToRoles } = await import("./push");
    const eventId = victorSalaryPaidClaimKey(el.workMonth);

    const { outcome } = await deliverOnce(settingsClaimStore, eventId, VICTOR_SALARY_PAID_CLAIM_VERSION, Date.now(), async () =>
      classify(await sendPushToRoles(["victor"], { title: msg.title, body: msg.body, url: "/team/victor", tag: `victor-salary-${el.workMonth}`, eventId })),
    );
    if (outcome === "already_sent" || outcome === "in_progress") return { kind: "attempted", victor: outcome, ownerAck: "not_attempted" };
    if (outcome !== "sent") {
      console.error(`[victor-salary-paid-notify] Victor was NOT notified (${outcome}) for salary ${el.workMonth} — the payment stays שולם, no Owner ack`);
      const warning = outcome === "no_subscription"
        ? "המשכורת סומנה שולמה, אבל לויקטור אין מכשיר רשום להתראות — לא נשלח Push."
        : "המשכורת סומנה שולמה, אבל ה-Push לויקטור לא נשלח (שגיאת שליחה). התשלום לא בוטל.";
      return { kind: "attempted", victor: outcome, ownerAck: "not_attempted", warning };
    }

    const ack = buildVictorSalaryOwnerAck(el.workMonth);
    let ownerAck: "sent" | "failed" = "failed";
    try {
      ownerAck = classify(await sendPushToRoles(["owner"], { title: ack.title, body: ack.body, url: "/team/victor", tag: `victor-salary-owner-${el.workMonth}`, eventId: `${eventId}_owner` })) === "sent" ? "sent" : "failed";
    } catch (e) {
      console.error("[victor-salary-paid-notify] owner ack push threw:", e instanceof Error ? e.message : e);
    }
    if (ownerAck === "failed") return { kind: "attempted", victor: "sent", ownerAck, warning: "ויקטור קיבל את ההתראה, אבל האישור אליך לא נשלח." };
    return { kind: "attempted", victor: "sent", ownerAck };
  } catch (e) {
    console.error("[victor-salary-paid-notify] failed (the payment is unaffected):", e instanceof Error ? e.message : e);
    return { kind: "attempted", victor: "send_failed", ownerAck: "not_attempted", warning: "המשכורת סומנה שולמה, אבל שליחת ה-Push לויקטור נכשלה. התשלום לא בוטל." };
  }
}

/** Victor's portal ping carries his chosen UI language; the server keeps it so his pushes speak it. Victor session only. */
export async function rememberVictorPushLang(raw: unknown): Promise<void> {
  if (raw !== "en" && raw !== "ru") return;
  const { data } = await supabase.from("settings").select("value").eq("key", VICTOR_PUSH_LANG_KEY).maybeSingle();
  if ((data?.value as { lang?: unknown } | null)?.lang === raw) return; // unchanged → no write
  await supabase.from("settings").upsert({ key: VICTOR_PUSH_LANG_KEY, value: { lang: raw, at: new Date().toISOString() } }, { onConflict: "key" });
}
