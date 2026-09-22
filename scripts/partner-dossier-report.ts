/**
 * Project Dossier — one-off READ-ONLY structural QA report against the real database.
 *
 *   NODE_OPTIONS=--conditions=react-server npx tsx scripts/partner-dossier-report.ts
 *
 * Safety (identical scaffold to scripts/coo-shadow-run.ts / partner-eyes-report.ts,
 * enforced before any lib/coo or lib/partner module is imported):
 *   - only SUPABASE_URL + SUPABASE_SECRET_KEY are read from .env.local;
 *   - global fetch is replaced by a guard: only GET/HEAD to the Supabase host are let through;
 *   - no Next server, no instrumentation, no cron, no LLM.
 * Prints STRUCTURAL counts only — never notes, phones, emails, file/Dropbox
 * URLs, or any other private free text.
 */
import fs from "node:fs";
import path from "node:path";

// ── 1. env: only the two Supabase variables ─────────────────────────────────
const envText = fs.readFileSync(path.resolve(__dirname, "../.env.local"), "utf8");
for (const line of envText.split(/\r?\n/)) {
  const m = /^(SUPABASE_URL|SUPABASE_SECRET_KEY)=(.*)$/.exec(line.trim());
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) throw new Error("missing SUPABASE_* in .env.local");
const SB_HOST = new URL(process.env.SUPABASE_URL).host;

// ── 2. read-only fetch guard (audit trail + hard block) ─────────────────────
const blocked: { method: string; url: string }[] = [];
const realFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url);
  const method = (init?.method ?? (input as Request)?.method ?? "GET").toUpperCase();
  const safe = (method === "GET" || method === "HEAD") && url.host === SB_HOST;
  if (!safe) { blocked.push({ method, url: `${url.host}${url.pathname}` }); throw new Error(`READ-ONLY GUARD blocked ${method} ${url.host}${url.pathname}`); }
  return realFetch(input as RequestInfo, init);
}) as typeof fetch;

// ── 3. run ──────────────────────────────────────────────────────────────────
function count<T extends string>(items: T[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const i of items) out[i] = (out[i] ?? 0) + 1;
  return out;
}
function fmt(rec: Record<string, number>): string {
  return Object.entries(rec).map(([k, v]) => `${k}=${v}`).join(", ") || "(none)";
}

async function main() {
  const { buildPartnerCompanyState } = await import("../lib/partner/eyes/build");
  const { buildAllProjectDossiers } = await import("../lib/partner/dossiers/project");

  const state = await buildPartnerCompanyState();
  const dossiers = [...buildAllProjectDossiers(state).values()];

  console.log(`Project Dossier report — ${state.capturedAt} (Israel date ${state.todayIL})`);
  console.log(`eyes schema: ${state.schemaVersion} | dossier schema: ${dossiers[0]?.dossierSchemaVersion ?? "n/a"}\n`);

  const projectsInScope = Object.keys(state.domains.projects.data?.index ?? {}).length;
  console.log(`Projects in Partner Eyes scope: ${projectsInScope}`);
  console.log(`Dossiers built: ${dossiers.length}`);
  const indexOnly = dossiers.filter((d) => d.identity.identitySource === "INDEX_ONLY").length;
  console.log(`  of which INDEX_ONLY (closed projects, limited identity): ${indexOnly}\n`);

  console.log("Client relation:");
  console.log(`  ${fmt(count(dossiers.map((d) => d.client.status)))}`);
  const clientIdCount = dossiers.filter((d) => d.client.relation?.quality === "ID").length;
  console.log(`  (sanity: quality=ID count is ${clientIdCount} — MUST be 0, no client_id exists on projects)\n`);

  console.log("Finance:");
  console.log(`  configStatus: ${fmt(count(dossiers.map((d) => d.finance.configStatus)))}`);
  console.log(`  balanceKind:  ${fmt(count(dossiers.map((d) => d.finance.balanceKind)))}`);
  const withTxDetail = dossiers.filter((d) => d.finance.transactionDetail !== "NOT_AVAILABLE_IN_EYES").length;
  console.log(`  transactionDetail available (Phase C.3): ${withTxDetail}/${dossiers.length}\n`);

  console.log("Proposals (Phase C.3 — full history via eyes:proposalsFull):");
  const withProposals = dossiers.filter((d) => d.proposals.items.length > 0).length;
  console.log(`  dossiers with >=1 linked proposal: ${withProposals}/${dossiers.length} (total: ${dossiers.reduce((s, d) => s + d.proposals.items.length, 0)})\n`);

  console.log("Tasks — full history (Phase C.3):");
  const withTaskHistory = dossiers.filter((d) => d.tasks.history.items.length > 0).length;
  console.log(`  dossiers with >=1 historical task: ${withTaskHistory}/${dossiers.length} (total: ${dossiers.reduce((s, d) => s + d.tasks.history.items.length, 0)}, vs open-only: ${dossiers.reduce((s, d) => s + d.tasks.count, 0)})\n`);

  console.log("Sessions:");
  const withSessions = dossiers.filter((d) => d.sessions.count > 0).length;
  console.log(`  dossiers with >=1 linked session: ${withSessions}/${dossiers.length}`);
  console.log(`  total linked sessions across all dossiers: ${dossiers.reduce((s, d) => s + d.sessions.count, 0)}\n`);

  console.log("Releases:");
  console.log(`  status: ${fmt(count(dossiers.map((d) => d.release.status)))}\n`);

  console.log("Label Artist:");
  console.log(`  status: ${fmt(count(dossiers.map((d) => d.labelArtist.status)))}\n`);

  console.log("Victor:");
  const victorLinked = dossiers.filter((d) => d.victor.linkedWorks.length > 0).length;
  console.log(`  dossiers with >=1 project-linked (active) work: ${victorLinked}/${dossiers.length}`);
  console.log(`  total linked works: ${dossiers.reduce((s, d) => s + d.victor.linkedWorks.length, 0)}\n`);

  console.log("Steven:");
  const stevenLinked = dossiers.filter((d) => d.steven.linkedWorks.length > 0).length;
  console.log(`  dossiers with >=1 project-linked (open) work: ${stevenLinked}/${dossiers.length}`);
  console.log(`  total linked works: ${dossiers.reduce((s, d) => s + d.steven.linkedWorks.length, 0)}\n`);

  console.log("Tasks:");
  const tasksLinked = dossiers.filter((d) => d.tasks.count > 0).length;
  console.log(`  dossiers with >=1 open linked task: ${tasksLinked}/${dossiers.length}`);
  console.log(`  total open linked tasks: ${dossiers.reduce((s, d) => s + d.tasks.count, 0)}\n`);

  console.log("Clips:");
  const clipsLinked = dossiers.filter((d) => d.clips.linked.length > 0).length;
  console.log(`  dossiers with >=1 ID-linked clip: ${clipsLinked}/${dossiers.length}`);
  console.log(`  total ID-linked clips: ${dossiers.reduce((s, d) => s + d.clips.linked.length, 0)}`);
  console.log(`  total unlinked TEXT_MATCH candidates (never auto-confirmed): ${dossiers.reduce((s, d) => s + d.clips.unlinkedCandidates.length, 0)}\n`);

  const allConflicts = dossiers.flatMap((d) => d.dataQuality.conflicts);
  console.log(`Data conflicts: ${allConflicts.length}`);
  if (allConflicts.length) console.log(`  by code: ${fmt(count(allConflicts.map((c) => c.code)))}\n`);
  else console.log();

  const allWeak = dossiers.flatMap((d) => d.dataQuality.weakRelations);
  console.log(`Weak relations (total occurrences across all dossiers): ${allWeak.length}`);
  console.log(`  by kind: ${fmt(count(allWeak))}\n`);

  console.log(`blocked requests during this run: ${blocked.length}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error("[partner-dossier-report] failed:", e instanceof Error ? e.message : e); process.exit(1); });
