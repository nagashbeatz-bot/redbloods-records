/**
 * Client + Label Artist Dossier — one-off READ-ONLY structural QA report
 * against the real database.
 *
 *   NODE_OPTIONS=--conditions=react-server npx tsx scripts/partner-entity-dossier-report.ts
 *
 * Safety (identical scaffold to the other Partner shadow-run scripts): only
 * SUPABASE_URL + SUPABASE_SECRET_KEY are read from .env.local; fetch is
 * guarded to GET/HEAD against the Supabase host only; no LLM, no Next server.
 * Prints STRUCTURAL counts only — never notes, phones, emails, file/Dropbox
 * URLs, or other private free text.
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
  const { buildAllClientDossiers } = await import("../lib/partner/dossiers/client");
  const { buildAllLabelArtistDossiers } = await import("../lib/partner/dossiers/labelArtist");

  const state = await buildPartnerCompanyState();
  const clients = [...buildAllClientDossiers(state).values()];
  const artists = [...buildAllLabelArtistDossiers(state).values()];

  console.log(`Entity Dossier report — ${state.capturedAt} (Israel date ${state.todayIL})`);
  console.log(`eyes schema: ${state.schemaVersion} | client schema: ${clients[0]?.dossierSchemaVersion ?? "n/a"} | artist schema: ${artists[0]?.dossierSchemaVersion ?? "n/a"}\n`);

  console.log("═══ CLIENTS ═══");
  console.log(`count in Eyes scope: ${state.domains.clients.data?.total ?? 0}`);
  console.log(`dossiers built: ${clients.length}\n`);

  const withMatched = clients.filter((c) => c.matchedProjects.length > 0).length;
  const withAmbiguous = clients.filter((c) => c.ambiguousProjectCandidates.length > 0).length;
  console.log(`Projects (TEXT_MATCH only — no client_id exists):`);
  console.log(`  clients with >=1 matched project: ${withMatched}/${clients.length} (total matched links: ${clients.reduce((s, c) => s + c.matchedProjects.length, 0)})`);
  console.log(`  clients with >=1 ambiguous candidate: ${withAmbiguous}/${clients.length} (total ambiguous links: ${clients.reduce((s, c) => s + c.ambiguousProjectCandidates.length, 0)})\n`);

  const withProposals = clients.filter((c) => c.proposals.items.length > 0).length;
  const withLegacyTextMatch = clients.filter((c) => c.proposals.legacyTextMatched.length > 0).length;
  console.log(`Proposals (Phase C.3 — ID via client_id, full history, eyes:proposalsFull):`);
  console.log(`  clients with >=1 ID-linked proposal: ${withProposals}/${clients.length} (total: ${clients.reduce((s, c) => s + c.proposals.items.length, 0)})`);
  console.log(`  clients with >=1 legacy TEXT_MATCH-only proposal (client_id=null rows): ${withLegacyTextMatch}/${clients.length} (total: ${clients.reduce((s, c) => s + c.proposals.legacyTextMatched.length, 0)})\n`);

  const perf = clients.filter((c) => c.performerShows.items.length > 0).length;
  const booker = clients.filter((c) => c.bookerShows.items.length > 0).length;
  const dj = clients.filter((c) => c.djShows.items.length > 0).length;
  console.log(`Show ID links (Phase C.2 finding: artist_client_id / booker_client_id, not just dj_client_id):`);
  console.log(`  performerShows (artist_client_id): ${perf}/${clients.length} clients, ${clients.reduce((s, c) => s + c.performerShows.items.length, 0)} shows`);
  console.log(`  bookerShows (booker_client_id):     ${booker}/${clients.length} clients, ${clients.reduce((s, c) => s + c.bookerShows.items.length, 0)} shows`);
  console.log(`  djShows (dj_client_id):             ${dj}/${clients.length} clients, ${clients.reduce((s, c) => s + c.djShows.items.length, 0)} shows\n`);

  const withFinance = clients.filter((c) => c.finance.byCurrency.length > 0).length;
  console.log(`Finance-context coverage (derived via TEXT_MATCH-linked projects only):`);
  console.log(`  clients with >=1 currency bucket: ${withFinance}/${clients.length}\n`);

  console.log("═══ LABEL ARTISTS ═══");
  console.log(`count in Eyes scope: ${state.domains.labelArtists.data?.total ?? 0}`);
  console.log(`dossiers built: ${artists.length}\n`);

  const idLinked = artists.filter((a) => a.projects.idLinked.length > 0).length;
  const textMatched = artists.filter((a) => a.projects.textMatched.length > 0).length;
  const ambiguousText = artists.filter((a) => a.projects.ambiguousTextMatched.length > 0).length;
  console.log(`Projects:`);
  console.log(`  ID-linked (release.label_artist_id): ${idLinked}/${artists.length} artists, ${artists.reduce((s, a) => s + a.projects.idLinked.length, 0)} projects`);
  console.log(`  TEXT_MATCH-only:                     ${textMatched}/${artists.length} artists, ${artists.reduce((s, a) => s + a.projects.textMatched.length, 0)} projects`);
  console.log(`  ambiguous TEXT_MATCH:                ${ambiguousText}/${artists.length} artists, ${artists.reduce((s, a) => s + a.projects.ambiguousTextMatched.length, 0)} projects\n`);

  console.log(`Releases (Phase C.3 — genuinely lifetime count now, eyes:releasesFull, every stage):`);
  console.log(`  total release rows across all artists: ${artists.reduce((s, a) => s + a.releases.visibleReleaseCount, 0)}\n`);

  console.log(`Show relation coverage:`);
  console.log(`  ${artists.length}/${artists.length} artists: NO_DIRECT_RELATION_MODELED (no label_artist_id on shows — see report)\n`);

  const withLedger = artists.filter((a) => a.balanceLedger.hasEntries).length;
  console.log(`Balance ledger coverage:`);
  console.log(`  artists with >=1 entry: ${withLedger}/${artists.length}\n`);

  const allConflicts = [...clients.flatMap((c) => c.dataQuality.conflicts), ...artists.flatMap((a) => a.dataQuality.conflicts)];
  const uniqueConflicts = new Map(allConflicts.map((c) => [c.description, c]));
  console.log(`Data conflicts (deduplicated across both dossier types): ${uniqueConflicts.size}`);
  if (uniqueConflicts.size) console.log(`  by code: ${fmt(count([...uniqueConflicts.values()].map((c) => c.code)))}`);
  console.log();

  const allWeak = [...clients.flatMap((c) => c.dataQuality.weakRelations), ...artists.flatMap((a) => a.dataQuality.weakRelations)];
  console.log(`Weak relations (total occurrences): ${allWeak.length}`);
  console.log(`  by kind: ${fmt(count(allWeak))}\n`);

  console.log(`blocked requests during this run: ${blocked.length}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error("[partner-entity-dossier-report] failed:", e instanceof Error ? e.message : e); process.exit(1); });
