/**
 * Redbloods Partner — READ-ONLY production finance data preflight (F2.16–F2.18 migration preconditions).
 *
 *   NODE_OPTIONS=--conditions=react-server npx tsx scripts/partner-finance-preflight.ts
 *
 * Fetch is guarded to GET/HEAD against the Supabase host only. Prints aggregate counts only:
 * transaction type / status / currency distributions, linked_session_id duplicates, Victor salary rows,
 * finance-setting coverage, Action Event / Owner Context shapes relevant to the proposed constraints.
 * Nothing is written.
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

type Row = Record<string, unknown>;
const tally = (rows: Row[], key: (r: Row) => string) => rows.reduce((m: Record<string, number>, r) => { const k = key(r); m[k] = (m[k] ?? 0) + 1; return m; }, {});

async function main() {
  const { supabase } = await import("../lib/supabase");
  const all = async (table: string, cols: string, like?: [string, string]) => {
    const out: Row[] = [];
    for (let from = 0; ; from += 1000) {
      let q = supabase.from(table).select(cols);
      if (like) q = q.like(like[0], like[1]);
      const { data, error } = await q.range(from, from + 999);
      if (error) throw new Error(`${table}: ${error.message}`);
      out.push(...((data ?? []) as unknown as Row[]));
      if (!data || data.length < 1000) break;
    }
    return out;
  };
  const tx = await all("transactions", "id,type,payment_status,currency,amount,date,project_id,scope,expense_scope,category,linked_session_id,artist");
  const settings = await all("settings", "key,value", ["key", "finance_%"]);
  const projects = await all("projects", "id,status,is_hidden");
  const vendor = await all("settings", "key,value", ["key", "vendor_victor%"]);
  const events = await all("partner_action_events", "id,action_id,action_type,subject_type,event_type,request_id");
  const ctx = await all("partner_owner_context", "id,question_type,case_id,subject_type");

  const linked = tx.filter((t) => t.linked_session_id);
  const byLinked = tally(linked, (t) => String(t.linked_session_id));
  const dupLinked = Object.entries(byLinked).filter(([, n]) => n > 1).map(([k, n]) => ({ linked_session_id: k.startsWith("victor_salary_") ? k : `<session:${k.slice(0, 8)}…>`, rows: n, statuses: tx.filter((t) => t.linked_session_id === k).map((t) => `${t.type}/${t.payment_status}`) }));
  const victor = tx.filter((t) => String(t.linked_session_id ?? "").startsWith("victor_salary_")).map((t) => ({ period: t.linked_session_id, type: t.type, status: t.payment_status, currency: t.currency, amount: t.amount, date: t.date, scope: t.scope, category: t.category }));
  const liveProjects = new Set(projects.map((p) => p.id));
  const settingValues = settings.map((s) => ({ key: String(s.key), v: (s.value ?? {}) as Row }));
  const settingKeys = [...new Set(settingValues.flatMap((s) => Object.keys(s.v)))].sort();

  console.log(JSON.stringify({
    transactions: {
      total: tx.length,
      typeCounts: tally(tx, (t) => JSON.stringify(t.type)),
      statusByType: tally(tx, (t) => `${t.type} | ${JSON.stringify(t.payment_status)}`),
      currencyCounts: tally(tx, (t) => JSON.stringify(t.currency)),
      scopeCounts: tally(tx, (t) => JSON.stringify(t.scope)),
      expenseScopeByType: tally(tx, (t) => `${t.type} | ${JSON.stringify(t.expense_scope)}`),
      nullDate: tx.filter((t) => !t.date).length,
      nonPositiveAmount: tx.filter((t) => !(Number(t.amount) > 0)).length,
      localizedTypeValues: tx.filter((t) => t.type !== "income" && t.type !== "expense").length,
      partialVariants: tally(tx.filter((t) => /חלק|partial/i.test(String(t.payment_status))), (t) => `${t.type} | ${t.payment_status}`),
      linkedSessionRows: linked.length,
      duplicateLinkedSessionIds: dupLinked,
    },
    victorSalaryTransactions: victor,
    victorSettingsKeys: vendor.map((v) => ({ key: v.key, valueKeys: v.value && typeof v.value === "object" ? Object.keys(v.value as Row).slice(0, 20) : typeof v.value })),
    financeSettings: {
      rows: settings.length,
      forLiveProjects: settingValues.filter((s) => liveProjects.has(s.key.slice("finance_".length))).length,
      orphans: settingValues.filter((s) => !liveProjects.has(s.key.slice("finance_".length))).length,
      withAgreedPrice: settingValues.filter((s) => Number(s.v.agreedPrice) > 0).length,
      valueKeys: settingKeys,
      liveProjects: projects.length,
    },
    actionEvents: { rows: events.length, actionTypes: tally(events, (e) => String(e.action_type)), subjectTypes: tally(events, (e) => String(e.subject_type)), eventTypes: tally(events, (e) => String(e.event_type)), duplicateRequestIds: Object.values(tally(events, (e) => String(e.request_id))).filter((n) => n > 1).length },
    ownerContext: { rows: ctx.length, questionTypes: tally(ctx, (c) => String(c.question_type)), subjectTypes: tally(ctx, (c) => String(c.subject_type)) },
    blockedWrites: blocked,
  }, null, 2));
}
main().catch((e) => { console.error(e); process.exit(1); });
