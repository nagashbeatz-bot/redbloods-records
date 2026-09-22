/**
 * Partner Eyes — one-off READ-ONLY snapshot report against the real database.
 *
 *   NODE_OPTIONS=--conditions=react-server npx tsx scripts/partner-eyes-report.ts
 *
 * Safety (identical scaffold to scripts/coo-shadow-run.ts, enforced before any
 * lib/coo or lib/partner module is imported):
 *   - only SUPABASE_URL + SUPABASE_SECRET_KEY are read from .env.local (no push / cron / mail / LLM keys);
 *   - global fetch is replaced by a guard: only GET/HEAD to the Supabase host are let through,
 *     anything else (POST/PATCH/PUT/DELETE, or any other host) is BLOCKED and counted;
 *   - no Next server, no instrumentation, no cron, no agent/check, no LLM.
 * Prints domain-level metadata and counts ONLY — never raw rows, secrets,
 * tokens, Dropbox URLs, or contact info (emails/phones).
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
function countOf(data: unknown): number | string {
  if (data === null || data === undefined) return "—";
  if (Array.isArray(data)) return data.length;
  if (typeof data === "object") {
    const d = data as Record<string, unknown>;
    if (typeof d.total === "number") return d.total;
    if (Array.isArray(d.open)) return d.open.length;
    if (Array.isArray(d.active)) return d.active.length;
    if (Array.isArray(d.items)) return d.items.length;
    if (Array.isArray(d.rows)) return d.rows.length;
    if (Array.isArray((d as { shown?: unknown[] }).shown)) return (d as { shown: unknown[] }).shown.length;
  }
  return "?";
}

async function main() {
  const { buildPartnerCompanyState } = await import("../lib/partner/eyes/build");
  const snapshot = await buildPartnerCompanyState();

  console.log(`Partner Eyes snapshot — ${snapshot.capturedAt} (Israel date ${snapshot.todayIL})`);
  console.log(`eyes schema: ${snapshot.schemaVersion} | coo schema: ${snapshot.cooSchemaVersion}\n`);

  // Domain / Rows / Coverage / Reliability / Relation type / Relation coverage / Warnings
  const rows: Array<[string, string | number, string, string, string, string, string]> = [];
  for (const [key, d] of Object.entries(snapshot.domains)) {
    const relType = d.relations.length ? d.relations.map((r) => `${r.toDomain}:${r.quality}`).join(", ") : "—";
    const relCoverage = d.relations.length ? d.relations.map((r) => r.coverage ?? "—").join(", ") : "—";
    rows.push([key, countOf(d.data), d.coverage, d.reliability, relType, relCoverage, String(d.warnings.length)]);
  }
  const header = ["Domain", "Rows", "Coverage", "Reliability", "Relation type", "Relation coverage", "Warnings"];
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i]).length)));
  const line = (cols: string[]) => cols.map((c, i) => c.padEnd(widths[i])).join("  ");
  console.log(line(header));
  console.log(widths.map((w) => "-".repeat(w)).join("  "));
  for (const r of rows) console.log(line(r.map(String)));

  // ── Special call-outs (Phase B.1 §7) ──────────────────────────────────────
  console.log("\n── Agent Alerts: raw vs COO-visible ──");
  const aa = snapshot.domains.agentAlerts.data;
  if (aa) {
    console.log(`  total (all statuses, Partner Eyes): ${aa.total}`);
    console.log(`  byStatus: ${Object.entries(aa.byStatus).map(([k, v]) => `${k}=${v}`).join(", ")}`);
    console.log(`  shown by COO's brief (status="new" + allowlist + recent): ${aa.cooVisible.shownByBrief ?? "—"}`);
    console.log(`  withEntityKey: ${aa.withEntityKey} | withRelatedProject: ${aa.withRelatedProject}`);
  } else console.log("  (unavailable)");

  console.log("\n── Clips: real project_id coverage ──");
  const clips = snapshot.domains.clips.data;
  if (clips) console.log(`  ${clips.withProjectId}/${clips.total} carry project_id (relation quality ID, coverage measured — never downgraded for partial coverage)`);
  else console.log("  (unavailable)");

  console.log("\n── Shows: DJ id/confirmation coverage ──");
  const showsRel = snapshot.domains.shows.relations.find((r) => r.via === "shows.dj_client_id");
  console.log(`  ${showsRel ? `${showsRel.notes ?? ""}` : "(no dj relation reported)"}`);

  console.log("\n── Victor: project relation coverage ──");
  const victorRel = snapshot.domains.victor.relations[0];
  console.log(`  ${victorRel?.notes ?? "—"} | coverage=${victorRel?.coverage ?? "—"}`);

  console.log("\nWarnings detail:");
  for (const [key, d] of Object.entries(snapshot.domains)) {
    if (d.warnings.length === 0) continue;
    console.log(`\n[${key}]`);
    for (const w of d.warnings) console.log(`  - ${w}`);
  }

  console.log("\nUnderlying COO source statuses:");
  for (const s of snapshot.cooSources) {
    console.log(`  ${s.source.padEnd(18)} ${s.status.padEnd(8)} rows=${s.rowCount ?? "—"}${s.error ? ` error=${s.error}` : ""}`);
  }
  console.log(`\nblocked requests during this run: ${blocked.length}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error("[partner-eyes-report] failed:", e instanceof Error ? e.message : e); process.exit(1); });
