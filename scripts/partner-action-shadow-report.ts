/**
 * Partner Action primitives — READ-ONLY production shadow verification (Phase F.1H).
 *
 *   NODE_OPTIONS=--conditions=react-server npx tsx scripts/partner-action-shadow-report.ts
 *
 * Fetch is guarded to GET/HEAD against the Supabase host only (any write,
 * RPC or other host throws). Uses the real live view + the real Action Event
 * store READ paths; never calls decideSuggestedAction / executeApprovedAction
 * and never the execution RPC. Nothing is approved, executed or persisted.
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
const B_ID = "de27b6d2-f35e-47c0-99e6-359db9d3d13c";
const ACTION_ID = `UPDATE_PROJECT_DEADLINE:${PID}:${B_ID}:2026-10-07`;

async function main() {
  const { supabase } = await import("../lib/supabase");
  const { loadPartnerBaseline } = await import("../lib/partner/baseline/store");
  const { livePartnerView } = await import("../lib/partner/actions/live");
  const { actionEventStore } = await import("../lib/partner/actions/event-store");
  const { buildActionSnapshot, hashActionSnapshot } = await import("../lib/partner/actions/snapshot");
  const { resolveActionSurfacing } = await import("../lib/partner/actions/surfacing");

  const count = async (table: string) => {
    const { count: n, error } = await supabase.from(table).select("id", { count: "exact", head: true });
    if (error) throw new Error(`${table} count failed: ${error.message}`);
    return n;
  };
  const deadline = async () => {
    const { data, error } = await supabase.from("projects").select("deadline,status,is_hidden,updated_at").eq("id", PID).single();
    if (error) throw new Error(`project read failed: ${error.message}`);
    return data;
  };
  const safety = async () => ({
    partner_action_events: await count("partner_action_events"),
    partner_owner_context: await count("partner_owner_context"),
    partner_feedback: await count("partner_feedback"),
    project: await deadline(),
    baselineSavedAt: (await loadPartnerBaseline())?.savedAt ?? null,
  });

  const before = await safety();
  const found = await livePartnerView.findAction(ACTION_ID);
  if (found.status !== "FOUND") { console.log(JSON.stringify({ lookup: found }, null, 2)); process.exit(3); }
  const snapshot = buildActionSnapshot(found.action, found.caseRef);
  const hash = hashActionSnapshot(snapshot);
  const chain = await actionEventStore.getActionChain(ACTION_ID);
  const events = chain.status === "OK" ? chain.chain : [];
  const surfacing = resolveActionSurfacing({ actionId: ACTION_ID, current: { status: found.action.status, snapshotHash: hash }, events, now: new Date() });
  // F.1I: exactly what GET /api/partner/actions serves (same binding, read-only).
  const { getOwnerActionSurface } = await import("../lib/partner/actions/surface-server");
  const surface = await getOwnerActionSurface();
  const after = await safety();

  console.log(JSON.stringify({
    actionId: found.action.id,
    actionType: found.action.actionType,
    status: found.action.status,
    proposedChange: found.action.proposedChange,
    explanationHe: found.action.explanationHe,
    sourceContextIds: found.action.sourceContextIds,
    caseFacts: snapshot.caseFacts,
    snapshotSha256: hash,
    chainRead: chain.status,
    chainLength: events.length,
    surfacing: surfacing.state,
    surfaceRoutePayload: surface.status === "OK" ? surface.response : surface,
    before,
    after,
    blockedWrites: blocked,
  }, null, 2));
  const unchanged = JSON.stringify(before) === JSON.stringify(after);
  if (blocked.length || !unchanged || chain.status !== "OK") process.exit(2);
}
main().catch((e) => { console.error(e); process.exit(1); });
