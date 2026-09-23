/**
 * Partner derived Action Outcome — READ-ONLY production shadow verification (Phase F.1L).
 *
 *   NODE_OPTIONS=--conditions=react-server npx tsx scripts/partner-action-outcome-shadow.ts
 *
 * Fetch is guarded to GET/HEAD against the Supabase host only (any write, RPC or other host
 * throws). Reads the executed Action chains, derives their Outcome from the live canonical
 * project state, checks the old proposal is no longer surfaced, and reports the safety counts
 * before/after. Nothing is approved, executed, persisted, or advanced.
 */
import fs from "node:fs";
import path from "node:path";

const envText = fs.readFileSync(path.resolve(__dirname, "../.env.local"), "utf8");
for (const line of envText.split(/\r?\n/)) {
  const m = /^(SUPABASE_URL|SUPABASE_SECRET_KEY)=(.*)$/.exec(line.trim());
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) throw new Error("missing SUPABASE_* in .env.local");
const SB_HOST = new URL(process.env.SUPABASE_URL).host;
const blocked: string[] = [];
const realFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url);
  const method = (init?.method ?? (input as Request)?.method ?? "GET").toUpperCase();
  if (!((method === "GET" || method === "HEAD") && url.host === SB_HOST)) { blocked.push(`${method} ${url.host}${url.pathname}`); throw new Error(`READ-ONLY GUARD blocked ${method} ${url.host}${url.pathname}`); }
  return realFetch(input as RequestInfo, init);
}) as typeof fetch;

const PID = "10d23186-a5ab-4eed-a9a4-eeda221a34d5";
const FIRST_ACTION_ID = `UPDATE_PROJECT_DEADLINE:${PID}:de27b6d2-f35e-47c0-99e6-359db9d3d13c:2026-10-07`;

async function main() {
  const { supabase } = await import("../lib/supabase");
  const { loadPartnerBaseline } = await import("../lib/partner/baseline/store");
  const count = async (table: string) => {
    const { count: n, error } = await supabase.from(table).select("id", { count: "exact", head: true });
    if (error) throw new Error(`${table} count failed: ${error.message}`);
    return n;
  };
  const safety = async () => {
    const { data, error } = await supabase.from("projects").select("deadline,status,is_hidden,updated_at").eq("id", PID).single();
    if (error) throw new Error(`project read failed: ${error.message}`);
    return {
      partner_action_events: await count("partner_action_events"),
      partner_owner_context: await count("partner_owner_context"),
      partner_feedback: await count("partner_feedback"),
      project: data,
      baselineSavedAt: (await loadPartnerBaseline())?.savedAt ?? null,
    };
  };

  const before = await safety();
  const { listExecutedActionOutcomes } = await import("../lib/partner/actions/outcome-server");
  const { actionEventStore } = await import("../lib/partner/actions/event-store");
  const { listLiveProposals } = await import("../lib/partner/actions/live");
  const { getOwnerActionSurface } = await import("../lib/partner/actions/surface-server");
  const outcomes = await listExecutedActionOutcomes();
  const chain = await actionEventStore.getActionChain(FIRST_ACTION_ID);
  const proposals = await listLiveProposals();
  const surface = await getOwnerActionSurface();
  const after = await safety();

  console.log(JSON.stringify({
    outcomes,
    firstActionChain: chain.status === "OK" ? chain.chain.map((e) => ({ id: e.id, type: e.eventType, supersedes: e.supersedesEventId, createdAt: e.createdAt, hash: e.snapshotHash })) : chain,
    oldProposalDerivable: proposals.status === "OK" ? proposals.items.some((i) => i.action.id === FIRST_ACTION_ID) : proposals,
    livePartnerProposals: proposals.status === "OK" ? proposals.items.map((i) => ({ id: i.action.id, status: i.action.status })) : proposals,
    surface,
    before,
    after,
    blockedWrites: blocked,
  }, null, 2));
}
main().catch((e) => { console.error(e); process.exit(1); });
