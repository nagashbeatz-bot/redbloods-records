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

  // Owner-decision check (Phase B.2): agent_alerts must never appear as a Partner domain.
  const hasAgentAlerts = Object.prototype.hasOwnProperty.call(snapshot.domains, "agentAlerts");
  console.log(`Agent Alerts domain present: ${hasAgentAlerts ? "YES — VIOLATION, must not appear" : "NO (correct — excluded by Owner decision)"}\n`);

  // Domain / Rows / Scope / Coverage / Reliability / Relation type / Relation coverage / Warnings
  const rows: Array<[string, string | number, string, string, string, string, string, string]> = [];
  for (const [key, d] of Object.entries(snapshot.domains)) {
    const relType = d.relations.length ? d.relations.map((r) => `${r.toDomain}:${r.quality}`).join(", ") : "—";
    const relCoverage = d.relations.length ? d.relations.map((r) => r.coverage ?? "—").join(", ") : "—";
    rows.push([key, countOf(d.data), d.scopeDescription, d.coverage, d.reliability, relType, relCoverage, String(d.warnings.length)]);
  }
  const header = ["Domain", "Rows", "Scope", "Coverage", "Reliability", "Relation type", "Relation coverage", "Warnings"];
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i]).length)));
  const line = (cols: string[]) => cols.map((c, i) => c.padEnd(widths[i])).join("  ");
  console.log(line(header));
  console.log(widths.map((w) => "-".repeat(w)).join("  "));
  for (const r of rows) console.log(line(r.map(String)));

  console.log("\n── Current vs historical counts (where both are known) ──");
  for (const [key, d] of Object.entries(snapshot.domains)) {
    if (d.currentOperationalCount == null && d.totalHistoricalCount == null) continue;
    console.log(`  ${key.padEnd(14)} current=${d.currentOperationalCount ?? "—"}  total=${d.totalHistoricalCount ?? "—"}`);
  }

  // ── Special call-outs (Phase B.1 §7 / B.2 §51) ────────────────────────────
  console.log("\n── Sessions: full history vs COO's forward window ──");
  const sessions = snapshot.domains.sessions.data;
  if (sessions) console.log(`  ${sessions.total} total (all history) | COO forward-window: ${sessions.cooVisible.count ?? "—"} | withProject: ${sessions.withProject}`);
  else console.log("  (unavailable)");

  console.log("\n── Releases: label_artist_id coverage ──");
  const relRel = snapshot.domains.releases.relations.find((r) => r.via.includes("label_artist_id"));
  console.log(`  ${relRel?.notes ?? "—"} | coverage=${relRel?.coverage ?? "—"}`);

  console.log("\n── Shows: full history + DJ id/confirmation coverage ──");
  const shows = snapshot.domains.shows.data;
  if (shows) console.log(`  ${shows.total} total (all history) | COO operational subset: upcoming=${shows.cooVisible.upcoming ?? "—"}, doneUnpaid=${shows.cooVisible.doneUnpaid ?? "—"} | withDjClientId: ${shows.withDjClientId}`);
  else console.log("  (unavailable)");

  console.log("\n── Tasks: scope ──");
  console.log(`  ${snapshot.domains.tasks.scopeDescription}`);

  console.log("\n── Clips: real project_id coverage ──");
  const clips = snapshot.domains.clips.data;
  if (clips) console.log(`  ${clips.withProjectId}/${clips.total} carry project_id (relation quality ID, coverage measured — never downgraded for partial coverage)`);
  else console.log("  (unavailable)");

  console.log("\n── Victor: project relation coverage + current/historical split ──");
  const victorRel = snapshot.domains.victor.relations[0];
  console.log(`  ${victorRel?.notes ?? "—"} | coverage=${victorRel?.coverage ?? "—"}`);
  console.log(`  active (current)=${snapshot.domains.victor.currentOperationalCount ?? "—"} | totalWorks (all history)=${snapshot.domains.victor.totalHistoricalCount ?? "—"}`);

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

  // ── Phase C.3: Change Readiness Matrix ────────────────────────────────────
  console.log("\n\n══ CHANGE READINESS MATRIX (Phase C.3 — data readiness only, no diffing/snapshots) ══\n");
  const crHeader = ["Domain", "Scope", "StableId", "CreatedAt", "UpdatedAt", "BizDate", "Status", "FullHist", "Create?", "Update?", "StatusTx?", "Warn"];
  const crRows = snapshot.changeReadiness.map((e) => [
    e.domain, e.scope, e.stableIdField ? "YES" : "NO", e.hasCreatedAt ? "YES" : "NO", e.hasUpdatedAt ? "YES" : "NO",
    e.businessDateField ? "YES" : "NO", e.statusField ? "YES" : "NO", e.scope === "FULL_HISTORY" ? "YES" : "NO",
    e.supportsCreateDetection ? "YES" : "NO", e.supportsUpdateDetection ? "YES" : "NO", e.supportsStatusTransitionDetection ? "YES" : "NO",
    String(e.warnings.length),
  ]);
  const crWidths = crHeader.map((h, i) => Math.max(h.length, ...crRows.map((r) => String(r[i]).length)));
  const crLine = (cols: string[]) => cols.map((c, i) => c.padEnd(crWidths[i])).join("  ");
  console.log(crLine(crHeader));
  console.log(crWidths.map((w) => "-".repeat(w)).join("  "));
  for (const r of crRows) console.log(crLine(r.map(String)));

  console.log("\nChange readiness warnings detail:");
  for (const e of snapshot.changeReadiness) {
    if (e.warnings.length === 0) continue;
    console.log(`\n[${e.domain}] stableId=${e.stableIdField ?? "—"} businessDate=${e.businessDateField ?? "—"} status=${e.statusField ?? "—"}`);
    for (const w of e.warnings) console.log(`  - ${w}`);
  }

  // ── Phase C.3: Production data report (structural counts / coverage only — no private text) ──
  console.log("\n\n══ PRODUCTION DATA REPORT (Phase C.3 §81) ══\n");

  const pf = snapshot.domains.proposalsFull.data;
  console.log("Proposals (full history):");
  console.log(pf
    ? `  total=${pf.total} | client_id coverage=${pf.withClientId}/${pf.total} | linked_project_id coverage=${pf.withLinkedProjectId}/${pf.total}`
    : "  (unavailable)");
  if (pf) console.log(`  status breakdown: ${fmtRec(pf.byStatus)}`);

  const tf = snapshot.domains.transactions.data;
  console.log("\nTransactions (full history):");
  console.log(tf ? `  total=${tf.total} | project_id coverage=${tf.withProjectId}/${tf.total}` : "  (unavailable)");
  if (tf) {
    console.log(`  status breakdown: ${fmtRec(tf.byStatus)}`);
    console.log(`  currency breakdown (counts only): ${fmtRec(tf.byCurrency)}`);
  }

  const tkf = snapshot.domains.tasksFull.data;
  console.log("\nTasks (full history):");
  console.log(tkf ? `  total=${tkf.total} | open (COO-visible)=${tkf.cooVisible.openCount ?? "—"}` : "  (unavailable)");
  if (tkf) console.log(`  status breakdown: ${fmtRec(tkf.byStatus)}`);

  const rf = snapshot.domains.releasesFull.data;
  console.log("\nReleases (full history):");
  console.log(rf
    ? `  total=${rf.total} | label_artist_id coverage=${rf.withLabelArtistId}/${rf.total} | active-stage (COO-visible)=${rf.cooVisible.count ?? "—"}`
    : "  (unavailable)");
  if (rf) console.log(`  stage breakdown: ${fmtRec(rf.byStage)}`);

  const victor = snapshot.domains.victor.data;
  console.log("\nVictor:");
  console.log(victor ? `  total=${victor.totalWorks} | active detail=${victor.active.length} | timestamps: createdAt/updatedAt/returnedDate now on each active work` : "  (unavailable)");

  const steven = snapshot.domains.steven.data;
  console.log("\nSteven:");
  console.log(steven ? `  total=${steven.totalWorks} | open detail=${steven.open.length} | timestamps: createdAt/updatedAt now on each open work` : "  (unavailable)");

  console.log(`\n\nblocked requests during this run: ${blocked.length}`);
}

function fmtRec(rec: Record<string, number>): string {
  return Object.entries(rec).map(([k, v]) => `${k}=${v}`).join(", ") || "(none)";
}

main().then(() => process.exit(0)).catch((e) => { console.error("[partner-eyes-report] failed:", e instanceof Error ? e.message : e); process.exit(1); });
