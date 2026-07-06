import "server-only";

import { createClient } from "@supabase/supabase-js";
import { sendPushToRoles } from "@/lib/push";

/**
 * "New mix job" push — sent to owner + Steven ONLY when the owner taps the green
 * "Send to Steven" button (manual). NEVER auto-fired: not on page load, refresh,
 * upload, or work edit — the only caller is the owner-gated notify-mix-ready
 * route on an explicit click.
 *
 * Dedup in the existing `settings` table (NO schema / table / agent_alerts):
 * key steven_mix_ready_pushed_{workId}. First click for a work that was already
 * sent returns { alreadySent } (no push) so the UI can confirm "send again?";
 * a resend actually sends. Localhost silenced by pushAllowed().
 */

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
);

function pushAllowed(): boolean {
  return process.env.NODE_ENV === "production" || process.env.ALLOW_SERVER_PUSH === "true";
}

const key = (workId: string) => `steven_mix_ready_pushed_${workId}`;

export interface MixReadyResult { ok: boolean; alreadySent?: boolean; sent?: boolean; skipped?: boolean }

/** displayName is resolved SERVER-SIDE (never trusted from the client). */
export async function notifyStevenMixReady(
  work: { id: string; displayName: string },
  opts: { resend?: boolean } = {},
): Promise<MixReadyResult> {
  if (!work.id) return { ok: false };
  // Localhost / dev: no real push, and do NOT mark as sent.
  if (!pushAllowed()) return { ok: true, skipped: true };

  const k = key(work.id);
  const { data } = await supabase.from("settings").select("value").eq("key", k).maybeSingle();
  const alreadySent = !!data;
  if (alreadySent && !opts.resend) return { ok: true, alreadySent: true };

  const name = (work.displayName ?? "").trim();
  const body = name
    ? `${name} · Files and notes are ready for you.`
    : `Files and notes are ready for you.`;

  await sendPushToRoles(["owner", "steven"], {
    title: "New mix job",
    body,
    url: "/team/steven",
    tag: `steven-mix-ready-${work.id}`,
  });

  await supabase.from("settings").upsert({ key: k, value: { at: new Date().toISOString() } }, { onConflict: "key" });
  return { ok: true, sent: true };
}
