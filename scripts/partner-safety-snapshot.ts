/**
 * Redbloods Partner — READ-ONLY production safety snapshot (row counts + SHA-256 of full table contents).
 *
 *   NODE_OPTIONS=--conditions=react-server npx tsx scripts/partner-safety-snapshot.ts
 *
 * Fetch is guarded to GET/HEAD against the Supabase host only (any write, RPC or other host throws).
 * Prints counts + content hashes of transactions, finance settings, projects, sound_engineer_work,
 * partner_action_events, partner_owner_context, partner_feedback and the Partner baseline, plus the
 * Finance Brain realized totals. Nothing is written.
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

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

async function main() {
  const { supabase } = await import("../lib/supabase");
  const table = async (name: string, order: string, like?: [string, string]) => {
    const rows: unknown[] = [];
    for (let from = 0; ; from += 1000) {
      let q = supabase.from(name).select("*");
      if (like) q = q.like(like[0], like[1]);
      const { data, error } = await q.order(order, { ascending: true }).range(from, from + 999);
      if (error) throw new Error(`${name}: ${error.message}`);
      rows.push(...(data ?? []));
      if (!data || data.length < 1000) break;
    }
    return { rows: rows.length, sha256: createHash("sha256").update(JSON.stringify(rows)).digest("hex").slice(0, 16) };
  };
  const out: Record<string, unknown> = {
    transactions: await table("transactions", "id"),
    finance_settings: await table("settings", "key", ["key", "finance_%"]),
    projects: await table("projects", "id"),
    sound_engineer_work: await table("sound_engineer_work", "id"),
    partner_action_events: await table("partner_action_events", "id"),
    partner_owner_context: await table("partner_owner_context", "id"),
    partner_feedback: await table("partner_feedback", "id"),
    baseline: await table("settings", "key", ["key", "partner_%"]),
    victor_settings: await table("settings", "key", ["key", "vendor_victor%"]),
  };
  const { getFinanceBrief } = await import("../lib/partner/finance/server");
  const r = await getFinanceBrief();
  if (r.status === "OK") out.realized = { ils: r.state.realized.ils, byCurrency: r.state.realized.byCurrency, knownMonthEndPositionIls: r.state.pacing.knownMonthEndPositionIls, openExpenses: r.state.openExpenses.totalsByCurrency };
  out.blockedWrites = blocked;
  console.log(JSON.stringify(out, null, 2));
}
main().catch((e) => { console.error(e); process.exit(1); });
