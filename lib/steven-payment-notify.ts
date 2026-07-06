import "server-only";

import { createClient } from "@supabase/supabase-js";
import { sendPushToRoles } from "@/lib/push";

/**
 * "Payment confirmed" push — sent to BOTH owner and Steven the moment a Steven
 * work first becomes Paid. Called ONLY from updateSoundEngineerWork on a real
 * !wasPaid && nowPaid transition (never on refresh / page load / re-save).
 *
 * Best-effort: must NEVER throw into the payment update path.
 * Localhost is silenced by pushAllowed() (production / ALLOW_SERVER_PUSH only).
 * Dedup lives in the existing `settings` key/value table (NO schema, NO new
 * table, NO agent_alerts): key steven_payment_pushed_{workId} = { paymentDate }.
 * The same confirmation (same workId + paymentDate) never double-sends.
 */

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
);

/** Never send real push from local/dev — only production (or an explicit opt-in). */
function pushAllowed(): boolean {
  return process.env.NODE_ENV === "production" || process.env.ALLOW_SERVER_PUSH === "true";
}

const key = (workId: string) => `steven_payment_pushed_${workId}`;

export async function notifyStevenPaymentPaid(work: {
  id: string;
  projectName: string;
  currency: string;
  agreedPrice: number;
  paymentDate: string | null;
}): Promise<void> {
  if (!pushAllowed() || !work.id) return;
  try {
    const k = key(work.id);
    const stamp = work.paymentDate ?? "paid";

    // Dedup: skip if we already pushed for this exact confirmation.
    const { data } = await supabase.from("settings").select("value").eq("key", k).maybeSingle();
    const prev = (data?.value as { paymentDate?: string } | null)?.paymentDate ?? null;
    if (prev === stamp) return;

    const name = (work.projectName ?? "").trim() || "a project";
    const body = work.agreedPrice > 0
      ? `${name} · ${work.currency}${work.agreedPrice} paid. Thank you for the work!`
      : `${name} · Paid. Thank you for the work!`;

    await sendPushToRoles(["owner", "steven"], {
      title: "Payment sent",
      body,
      url: "/team/steven",
      // Shared tag → the browser/iOS collapses any rare duplicate into one.
      tag: `steven-payment-${work.id}`,
    });

    await supabase.from("settings").upsert({ key: k, value: { paymentDate: stamp } }, { onConflict: "key" });
  } catch (e) {
    console.error("[steven-payment-notify] failed:", e);
  }
}
