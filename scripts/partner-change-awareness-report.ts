/**
 * Partner Change Awareness — runtime (Phase D.3) production report.
 *
 *   NODE_OPTIONS=--conditions=react-server npx tsx scripts/partner-change-awareness-report.ts
 *
 * UNLIKE every other Partner report script, this one is NOT read-only: it
 * calls the real runPartnerChangeAwareness() (lib/partner/baseline/build.ts),
 * which — after loading whatever baseline currently exists — WILL upsert a
 * new baseline row into the `settings` table under the key
 * "partner_change_baseline" (the exact same read/upsert pattern already used
 * ~159 times across this codebase for Victor settings, Dropbox tokens,
 * finance settings, etc. — see lib/partner/baseline/store.ts). One key, one
 * row, always replaced — never grows, never touches any other table.
 *
 * Safety scaffold: only SUPABASE_URL + SUPABASE_SECRET_KEY read from
 * .env.local; fetch is guarded to the Supabase host only (GET/HEAD/POST/
 * PATCH all allowed — a stricter guard would block the upsert itself, which
 * is the one intentional write this script makes); no Next server, no
 * instrumentation, no cron, no LLM.
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

const seen: { method: string; url: string }[] = [];
const realFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url);
  const method = (init?.method ?? (input as Request)?.method ?? "GET").toUpperCase();
  if (url.host !== SB_HOST) throw new Error(`GUARD blocked ${method} to non-Supabase host ${url.host}${url.pathname}`);
  seen.push({ method, url: `${url.host}${url.pathname}` });
  return realFetch(input as RequestInfo, init);
}) as typeof fetch;

async function main() {
  const { runPartnerChangeAwareness } = await import("../lib/partner/baseline/build");

  console.log("Running the REAL Change Awareness runtime against production (WILL write one settings row) ...\n");
  const result = await runPartnerChangeAwareness();

  console.log(`runAt: ${result.runAt}`);
  console.log(`baselineLoaded (a previous baseline existed): ${result.baselineLoaded}`);
  console.log(`previousCapturedAt: ${result.previousCapturedAt ?? "(none)"}`);
  console.log(`currentCapturedAt: ${result.currentCapturedAt}`);
  console.log(`baselineAdvanced (a new baseline was just saved): ${result.baselineAdvanced}`);
  console.log(`comparable: ${result.comparable}`);
  console.log(`changes: ${result.changes.length}`);

  if (result.diagnostics.length) {
    console.log("\ndiagnostics:");
    for (const d of result.diagnostics) console.log(`  [${d.code}] ${d.domain ?? "(snapshot-level)"}: ${d.message}`);
  }

  if (result.changes.length) {
    console.log("\nchanges (structural summary only — domain/entity/kind/field, never full row contents):");
    const byDomain: Record<string, number> = {};
    for (const c of result.changes) byDomain[c.domain] = (byDomain[c.domain] ?? 0) + 1;
    for (const [d, n] of Object.entries(byDomain)) console.log(`  ${d}: ${n}`);
    console.log("\n  first 15 changes:");
    for (const c of result.changes.slice(0, 15)) {
      console.log(`    [${c.kind}] ${c.domain}.${c.entityType}#${c.entityId}${c.field ? `.${c.field}` : ""}: ${JSON.stringify(c.before)} -> ${JSON.stringify(c.after)} (${c.epistemicType})`);
    }
  }

  console.log(`\nSupabase requests made this run: ${seen.length} (expected: 1 load + several domain reads + 1 upsert)`);
}

main().then(() => process.exit(0)).catch((e) => { console.error("[partner-change-awareness-report] failed:", e instanceof Error ? e.message : e); process.exit(1); });
