/**
 * Redbloods Partner — Gateway V1 READ-ONLY shadow run (developer tool).
 *
 *   NODE_OPTIONS=--conditions=react-server npx tsx scripts/partner-gateway-shadow.ts [--json]
 *
 * Asks the internal Gateway the Owner's questions against the live data and prints a human-readable summary
 * of what a client (e.g. Claude) would receive. Fetch is guarded to GET/HEAD against the Supabase host only
 * (any write, RPC or other host throws and is reported). Nothing is written.
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

const JSON_OUT = process.argv.includes("--json");
const t = (g: { text: string } | null | undefined) => g?.text ?? "";

async function main() {
  const { getPartnerBrief, getPartnerEntity, resolvePartnerEntity, createGatewayReadContext } = await import("../lib/partner/gateway/server");
  type Entity = Awaited<ReturnType<typeof getPartnerEntity>>;
  const ctx = createGatewayReadContext(); // one request-scoped read shared by the whole shadow run
  const dump: Record<string, unknown> = {};

  const showResolve = async (q: string) => {
    const r = await resolvePartnerEntity(q, ctx);
    dump[`resolve:${q}`] = r;
    console.log(`\n── resolve("${q}") → ${r.status}${r.truncated ? ` (+${r.truncated} more)` : ""}`);
    for (const c of r.candidates) console.log(`   ${c.confidence.padEnd(6)} ${c.matchReason.padEnd(18)} ${c.key}  "${t(c.label)}"  [${c.identityGroup.basis}]  ${t(c.detail)}`);
    for (const m of r.missing) console.log(`   missing: ${m.fact} — ${m.whyNeeded}`);
    return r;
  };
  const showEntity = async (key: string): Promise<Entity> => {
    const e = await getPartnerEntity(key, ctx);
    dump[`entity:${key}`] = e;
    console.log(`\n══ entity(${key}) → ${e.status} · ${t(e.entity?.label)} · freshness ${e.freshness}`);
    for (const f of e.facts) console.log(`   FACT ${f.code} [${f.epistemic}/${f.freshness}] ${JSON.stringify(f.value)?.slice(0, 220)}`);
    for (const r of e.relationships.slice(0, 12)) console.log(`   REL  ${r.relation} → ${r.to ?? "—"} "${t(r.toLabel)}" [${r.quality}]${r.note ? ` (${t(r.note)})` : ""}`);
    if (e.relationships.length > 12) console.log(`   REL  … +${e.relationships.length - 12}`);
    for (const d of e.ownerDecisions) console.log(`   OWNER ${d.questionType}=${d.answerCode}${d.answerDate ? ` (${d.answerDate})` : ""} ${d.status} @${d.entity}`);
    for (const o of e.observations) console.log(`   OBS  ${o.issueType} current=${o.current} contested=${o.contested} resolution=${o.resolution} overriddenByLive=${o.overriddenByLive} @${o.entity}`);
    for (const r of e.resolutions) console.log(`   RESOLVED ${r.code} ${r.resolvedIssue} @${r.entity}`);
    for (const c of e.conflicts) console.log(`   CONFLICT ${c.code} @${c.entity} ${c.values.map((v) => `${v.source}=${v.value}`).join(", ")}`);
    for (const p of e.patterns.candidates) console.log(`   PATTERN ${p.status} ${p.signature} ${p.evidenceQuality} clean=[${p.instances.join(",")}] contested=[${p.contestedInstances.join(",")}]`);
    for (const p of e.patterns.confirmed) console.log(`   PATTERN CONFIRMED ${p.signature}`);
    for (const a of e.actionHistory) console.log(`   ACTION ${a.actionType} ${a.events.map((x) => x.type).join("→")} head=${a.head} [${a.freshness}]`);
    for (const o of e.recentOutcomes) console.log(`   OUTCOME ${o.actionType} ${o.state} "${t(o.status)}" [${o.freshness}]`);
    for (const i of e.openIssues) console.log(`   ISSUE ${i.code} ${i.status} "${t(i.summary)}"`);
    for (const q of e.openQuestions) console.log(`   QUESTION ${q.questionType} "${t(q.text)}"`);
    for (const s of e.suggestedActions) console.log(`   SUGGESTED ${s.actionType} ${s.readiness} "${t(s.summary)}"`);
    for (const m of e.missing) console.log(`   missing: ${m.fact} — ${m.whyNeeded}`);
    if (Object.keys(e.truncated).length) console.log(`   truncated: ${JSON.stringify(e.truncated)}`);
    return e;
  };

  console.log("REDBLOODS PARTNER — GATEWAY V1 SHADOW (read-only)");
  // 1. Victor
  const v = await showResolve("Victor");
  await showResolve("ויקטור");
  if (v.candidates[0]) await showEntity(v.candidates[0].key);
  // 2. "ומה קרה באוגוסט?" — explicit Victor period entity
  await showEntity("recurring:VICTOR_SALARY:2026-08");
  // 3. קרוב אלייך
  const k = await showResolve("קרוב אלייך");
  if (k.status === "RESOLVED") await showEntity(k.candidates[0].key);
  // 4. מראות
  const m = await showResolve("מראות");
  if (m.status === "RESOLVED") await showEntity(m.candidates[0].key);
  // 5. a label artist (the first canonical one by name, not hardcoded)
  const la = await showResolve("שליו טסמה");
  const laKey = la.candidates.find((c) => c.type === "label-artist")?.key;
  if (laKey) await showEntity(laKey);
  await showResolve("שליו");
  await showResolve("אבי");
  await showResolve("ההופעה של שליו");
  // 6. Clinton
  const c1 = await showResolve("קלינטון");
  await showResolve("Clinton");
  const dj = c1.candidates.find((c) => c.type === "dj")?.key;
  if (dj) await showEntity(dj);
  // 7. Steven
  await showResolve("סטיבן");
  const s = await showResolve("Steven");
  if (s.candidates[0]) await showEntity(s.candidates[0].key);
  // unknown
  await showResolve("זה שם שלא קיים 123");
  // 8. company brief
  const b = await getPartnerBrief(ctx);
  dump.brief = b;
  console.log(`\n══ brief → ${b.items.length} items · freshness ${b.freshness} · omitted ${JSON.stringify(b.omitted)} · conflicts ${b.conflictsCount}`);
  for (const i of b.items) console.log(`   ${i.category.padEnd(22)} [${i.epistemic}/${i.freshness}/${i.source}] ${t(i.headline)}${i.subject ? `  → ${i.subject}` : ""}`);
  for (const p of b.patterns.candidates) console.log(`   PATTERN ${p.status} ${p.signature} ${p.evidenceQuality}`);
  for (const x of b.missing) console.log(`   missing: ${x.fact} — ${x.whyNeeded}`);
  for (const x of b.sources) if (x.status !== "OK") console.log(`   source ${x.source} ${x.status}`);

  console.log(`\nblockedWrites: ${JSON.stringify(blocked)}`);
  if (JSON_OUT) fs.writeFileSync(process.env.GATEWAY_SHADOW_JSON ?? "gateway-shadow.json", JSON.stringify(dump, null, 1));
}
main().catch((e) => { console.error(e); process.exit(1); });
