/**
 * Partner Change Engine — one-off READ-ONLY report against the real database
 * (Phase D.1).
 *
 *   NODE_OPTIONS=--conditions=react-server npx tsx scripts/partner-change-report.ts
 *
 * Safety (identical scaffold to scripts/partner-eyes-report.ts):
 *   - only SUPABASE_URL + SUPABASE_SECRET_KEY are read from .env.local;
 *   - global fetch is replaced by a guard: only GET/HEAD to the Supabase host are let through;
 *   - no Next server, no instrumentation, no cron, no LLM.
 * Writes NOTHING anywhere — no snapshot persistence (that's D.2/D.3, not
 * exercised by this script). Prints structural counts only.
 *
 * What this script proves, against REAL production data:
 *   1. a snapshot builds from the real, current PartnerCompanyState;
 *   2. comparing it to ITSELF yields zero changes (determinism, not a mock);
 *   3. an in-memory CLONE with controlled synthetic mutations produces
 *      exactly the expected changes (never written back anywhere);
 *   4. approximate serialized snapshot size, for the D.2 storage decision.
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

const blocked: { method: string; url: string }[] = [];
const realFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url);
  const method = (init?.method ?? (input as Request)?.method ?? "GET").toUpperCase();
  const safe = (method === "GET" || method === "HEAD") && url.host === SB_HOST;
  if (!safe) { blocked.push({ method, url: `${url.host}${url.pathname}` }); throw new Error(`READ-ONLY GUARD blocked ${method} ${url.host}${url.pathname}`); }
  return realFetch(input as RequestInfo, init);
}) as typeof fetch;

async function main() {
  const { buildPartnerCompanyState } = await import("../lib/partner/eyes/build");
  const { buildPartnerChangeSnapshot } = await import("../lib/partner/changes/snapshot");
  const { comparePartnerChangeSnapshots } = await import("../lib/partner/changes/compare");
  const { CHANGE_SNAPSHOT_SCHEMA_VERSION } = await import("../lib/partner/changes/types");

  console.log("── 1. Build current production state (read-only) ──");
  const state = await buildPartnerCompanyState();
  console.log(`  capturedAt=${state.capturedAt} eyes schema=${state.schemaVersion}`);

  console.log("\n── 2. Build canonical change snapshot ──");
  const snapshot = buildPartnerChangeSnapshot(state);
  console.log(`  changeSnapshotSchemaVersion=${snapshot.schemaVersion} (expected ${CHANGE_SNAPSHOT_SCHEMA_VERSION})`);

  console.log("\n── 3. Validate: stable id presence + entity counts per domain ──");
  const domains = Object.entries(snapshot).filter(([k]) => !["schemaVersion", "capturedAt"].includes(k)) as [string, { status: string; coverage: string; scopeDescription: string; entities: Record<string, unknown> }][];
  let totalEntities = 0, missingIdDomains = 0;
  for (const [key, d] of domains) {
    const count = Object.keys(d.entities).length;
    totalEntities += count;
    const hasEmptyKey = "" in d.entities;
    if (hasEmptyKey) missingIdDomains++;
    console.log(`  ${key.padEnd(24)} status=${d.status.padEnd(11)} coverage=${d.coverage.padEnd(8)} entities=${String(count).padEnd(5)}${hasEmptyKey ? "  ** MISSING STABLE ID **" : ""}`);
  }
  console.log(`  total entities across all domains: ${totalEntities}`);
  console.log(`  domains with a missing stable id: ${missingIdDomains} (should be 0 in healthy production data)`);

  console.log("\n── 4. Compare snapshot to itself (determinism proof, not a mock) ──");
  const selfResult = comparePartnerChangeSnapshots(snapshot, snapshot);
  console.log(`  changes=${selfResult.changes.length} (must be 0) | diagnostics=${selfResult.diagnostics.length} | comparable=${selfResult.comparable}`);
  if (selfResult.changes.length !== 0) {
    console.error("  ** UNEXPECTED: comparing a snapshot to itself produced changes — this would be a real bug **");
    for (const c of selfResult.changes.slice(0, 10)) console.error(`    ${c.domain} ${c.entityId} ${c.kind} ${c.field}`);
  }

  console.log("\n── 5. In-memory clone with synthetic mutations (verify expected changes; nothing written anywhere) ──");
  const mutated = structuredClone(snapshot);
  mutated.capturedAt = new Date(new Date(snapshot.capturedAt).getTime() + 60_000).toISOString();
  let mutationsApplied = 0;
  const firstProjectId = Object.keys(mutated.projects.entities)[0];
  if (firstProjectId) { mutated.projects.entities[firstProjectId] = { ...mutated.projects.entities[firstProjectId], status: "__TEST_SYNTHETIC_STATUS__" }; mutationsApplied++; }
  const firstClientId = Object.keys(mutated.clients.entities)[0];
  if (firstClientId) { mutated.clients.entities[firstClientId] = { ...mutated.clients.entities[firstClientId], status: "__TEST_SYNTHETIC_STATUS__" }; mutationsApplied++; }
  const newTaskId = "__TEST_SYNTHETIC_TASK__";
  mutated.tasks.entities[newTaskId] = { id: newTaskId, status: "פתוח", dueYmd: null, relatedType: "project", relatedId: firstProjectId ?? null };
  mutationsApplied++;

  const mutResult = comparePartnerChangeSnapshots(snapshot, mutated);
  console.log(`  synthetic mutations applied: ${mutationsApplied} | changes detected: ${mutResult.changes.length} (expect >= ${mutationsApplied})`);
  const foundSynthetic = mutResult.changes.filter((c) => c.after === "__TEST_SYNTHETIC_STATUS__" || c.entityId === newTaskId);
  console.log(`  synthetic changes correctly identified: ${foundSynthetic.length}/${mutationsApplied}`);
  ["projects", "clients", "tasks"].forEach((d) => {
    console.log(`    ${d} entity count real=${Object.keys((snapshot as unknown as Record<string, { entities: Record<string, unknown> }>)[d].entities).length} clone-after-mutation=${Object.keys((mutated as unknown as Record<string, { entities: Record<string, unknown> }>)[d].entities).length}`);
  });
  console.log("  (the clone is discarded here — nothing was written back to `snapshot`, the database, or any file)");

  console.log("\n── 6. Approximate serialized snapshot size (for the D.2 storage decision) ──");
  const json = JSON.stringify(snapshot);
  const bytes = Buffer.byteLength(json, "utf8");
  console.log(`  ${bytes.toLocaleString()} bytes (${(bytes / 1024).toFixed(1)} KB) — record counts only printed above, never raw contents`);

  console.log(`\nblocked requests during this run: ${blocked.length}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error("[partner-change-report] failed:", e instanceof Error ? e.message : e); process.exit(1); });
