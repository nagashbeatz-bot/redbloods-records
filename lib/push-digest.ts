import "server-only";
import { supabase } from "./supabase";
import { settingsClaimStore, pushAllowed } from "./push-claims";
import { classify, deliverOnce, ilHour, ilYmd, pushCronClaimKey, type DeliverOnceOutcome } from "./push-claims-pure";
import { buildOwnerDigest, NOT_DEADLINE_CANDIDATE_STATUSES, type DigestNotification, type DigestProject, type DigestSession, type DigestTxn } from "./push-digest-pure";
import { VICTOR_STUCK_PUSH_ENABLED, type VictorStuckSignal } from "./victor-stuck";
import type { PushPayload } from "./push";

/**
 * Server side of the Owner push digest shared by /api/push/cron (external scheduler) and the legacy /api/push/check.
 * Reads the day's facts, builds the notifications with the ONE pure builder (lib/push-digest-pure.ts), and sends each
 * one through a per-day delivery claim push_cron:<type>:<Israel day> — "sent" only after delivery, "failed" otherwise,
 * never twice a day (cron and check share the claim). The route passes its own sender so it stays the push module.
 * Production-only: outside production nothing is sent (the facts are still returned).
 */
export interface OwnerDigestRun {
  today: string; hour: number; pushAllowed: boolean;
  results: Array<{ type: string; outcome: DeliverOnceOutcome | "push_disabled" }>;
  sent: number;
  paymentTotals: Record<string, number>;
  victorStuck: { count: number; pushed: false; pushEnabled: boolean; note: string; works: VictorStuckSignal[] } | { error: string } | null;
}

export async function runOwnerDigest(opts: {
  withSummary: boolean;
  send: (p: PushPayload) => Promise<ReadonlyArray<{ status: string }>>;
  /** The cron passes the app's Victor stuck list (returned in its response, never pushed); the legacy check does not. */
  loadVictorStuck?: () => Promise<VictorStuckSignal[]>;
}): Promise<OwnerDigestRun> {
  const nowMs = Date.now();
  const today = ilYmd(nowMs);
  const hour = ilHour(nowMs);

  const { data: projects, error: pErr } = await supabase.from("projects").select("id, name, artist, status, deadline, is_hidden")
    .eq("is_hidden", false)
    .not("status", "in", `(${NOT_DEADLINE_CANDIDATE_STATUSES.join(",")})`);
  if (pErr) throw new Error(`projects read failed: ${pErr.message}`);
  const { data: sessions, error: sErr } = await supabase.from("sessions").select("id, start_time, projects(name, artist)").eq("date", today).eq("status", "מתוכנן");
  if (sErr) throw new Error(`sessions read failed: ${sErr.message}`);
  const { data: txns, error: tErr } = await supabase.from("transactions").select("id, amount, currency, projects(name)").eq("type", "income").eq("payment_status", "צפוי").lt("date", today);
  if (tErr) throw new Error(`transactions read failed: ${tErr.message}`);

  // Victor stuck — computed by the caller with the ONE rule (lib/victor-stuck.ts), NEVER pushed (Owner Q3).
  let victorStuck: OwnerDigestRun["victorStuck"] = null;
  if (opts.loadVictorStuck) {
    try {
      const list = await opts.loadVictorStuck();
      victorStuck = { count: list.length, pushed: false, pushEnabled: VICTOR_STUCK_PUSH_ENABLED, note: "Owner decision Q3 (2026-09-27): the Victor-stuck push is disabled — computed for Sunny / the dashboard only", works: list };
    } catch (e) {
      victorStuck = { error: e instanceof Error ? e.message : "victor read failed" };
    }
  }

  const { notifications, paymentTotals } = buildOwnerDigest({
    today, hour, withSummary: opts.withSummary,
    projects: (projects ?? []) as DigestProject[], sessions: (sessions ?? []) as unknown as DigestSession[], overdueIncome: (txns ?? []) as unknown as DigestTxn[],
  });

  const allowed = pushAllowed();
  const results: OwnerDigestRun["results"] = [];
  let sent = 0;
  for (const n of notifications) {
    if (!allowed) { results.push({ type: n.type, outcome: "push_disabled" }); continue; }
    const { outcome } = await deliverOnce(settingsClaimStore, pushCronClaimKey(n.type, today), "day", nowMs, async () => classify(await opts.send(payloadOf(n))));
    if (outcome === "sent") sent++;
    results.push({ type: n.type, outcome });
  }
  return { today, hour, pushAllowed: allowed, results, sent, paymentTotals, victorStuck };
}

function payloadOf(n: DigestNotification): PushPayload {
  const { type: _type, ...rest } = n;
  return rest;
}
