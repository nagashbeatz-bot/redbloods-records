/**
 * Partner Finance Brain V1 — READ-ONLY production shadow verification.
 *
 *   NODE_OPTIONS=--conditions=react-server npx tsx scripts/partner-finance-shadow.ts
 *
 * Fetch is guarded to GET/HEAD against the Supabase host only (any write, RPC or other host throws).
 * Runs exactly what GET /api/partner/finance serves (same binding) and prints the derived finance
 * state summary + the Owner brief, plus unrelated production counts before/after. Nothing is written.
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

async function main() {
  const { supabase } = await import("../lib/supabase");
  const { loadPartnerBaseline } = await import("../lib/partner/baseline/store");
  const count = async (table: string) => {
    const { count: n, error } = await supabase.from(table).select("id", { count: "exact", head: true });
    if (error) throw new Error(`${table} count failed: ${error.message}`);
    return n;
  };
  const safety = async () => {
    const { data: p } = await supabase.from("projects").select("id,deadline,updated_at").order("id");
    return {
      transactions: await count("transactions"),
      partner_action_events: await count("partner_action_events"),
      partner_owner_context: await count("partner_owner_context"),
      partner_feedback: await count("partner_feedback"),
      baselineSavedAt: (await loadPartnerBaseline())?.savedAt ?? null,
      projectsDeadlineFingerprint: JSON.stringify(p ?? []).length + ":" + (p ?? []).map((x: { deadline: string | null }) => x.deadline ?? "-").join(",").length,
    };
  };
  const before = await safety();
  const { getFinanceBrief } = await import("../lib/partner/finance/server");
  const r = await getFinanceBrief();
  const after = await safety();
  if (r.status !== "OK") { console.log(JSON.stringify({ status: r.status, detail: r.detail, blocked }, null, 2)); process.exit(3); }
  const s = r.state;
  console.log(JSON.stringify({
    month: s.month,
    realized: { byCurrency: s.realized.byCurrency, ils: s.realized.ils, targetPosition: s.realized.targetPosition, distanceToFloor: s.realized.distanceToFloor, distanceToPreferred: s.realized.distanceToPreferred, historicalPartial: s.realized.historicalPartial },
    history: s.history.map((h) => ({ month: h.month, ilsNet: h.ils.net, other: Object.fromEntries(Object.entries(h.byCurrency).filter(([c]) => c !== "₪").map(([c, f]) => [c, f.net])), historicalPartial: h.historicalPartial })),
    coverage: s.coverage,
    pacing: s.pacing,
    receivables: s.receivables.map((x) => ({ source: x.source, priceKnown: x.priceKnown, projectStatus: x.projectStatus, amount: x.amount, currency: x.currency, dueDate: x.dueDate, state: x.collection.state, stage: x.collection.reminderStage, important: x.collection.important, basis: x.collection.importanceBasis, legacy: x.legacy, client: x.client, reason: x.reason })),
    credits: s.credits.map((c) => ({ amount: c.amount, currency: c.currency, kind: c.kind })),
    priceCoverage: s.priceCoverage,
    expected: s.expected.map((e) => ({ class: e.class, amount: e.amount, currency: e.currency, date: e.date, certainty: e.certainty })),
    openExpenses: { totals: s.openExpenses.totalsByCurrency, items: s.openExpenses.items.map((e) => ({ source: e.source, amount: e.amount, currency: e.currency, due: e.dueDate, overdueDays: e.overdueDays, legacy: e.legacy, category: e.category })), possibleOverlaps: s.openExpenses.possibleOverlaps.map((e) => ({ amount: e.amount, currency: e.currency })) },
    recurring: { known: s.recurring.known.map((k) => ({ workMonth: k.workMonth, due: k.dueDate, amount: k.amount, currency: k.currency, state: k.state })), candidates: s.recurring.candidates.map((c) => ({ category: c.category, amount: c.amount, currency: c.currency, months: c.months })), unknownClassificationThisMonth: s.recurring.unknownClassificationThisMonth },
    signals: s.signals.map((x) => ({ code: x.code, epistemic: x.epistemic, count: x.count, amounts: x.amounts, review: x.review })),
    opportunities: s.opportunities.map((o) => ({ kind: o.kind, code: o.code, count: o.count, amount: o.amount })),
    proposalPipeline: s.proposalPipeline,
    // F2.5–F2.7 integrity / rehabilitation (read-only)
    integrity: (() => {
      const i = r.integrity;
      const byType: Record<string, Record<string, number>> = {};
      for (const x of i.issues) { const t = (byType[x.issueType] ??= {}); t[`${x.severityBand}/${x.epistemicStatus}/${x.period}`] = (t[`${x.severityBand}/${x.epistemicStatus}/${x.period}`] ?? 0) + 1; }
      return {
        trust: i.trust, coverageReasonsHe: i.coverageReasonsHe, issuesByType: byType,
        projectPriceProfile: i.projects.reduce((m: Record<string, number>, p) => { const k = `${p.business}/${p.price}`; m[k] = (m[k] ?? 0) + 1; return m; }, {}),
        completedNoIncome: i.issues.filter((x) => x.issueType === "COMPLETED_WORK_NO_INCOME").map((x) => ({ project: x.subjectLabel, reasons: x.reasonCodes, period: x.period, severity: x.severityBand })),
        orphanQueue: i.orphanQueue.map((o) => ({ amount: o.amount, currency: o.currency, txRows: o.txRowsForId })),
        expenseClassification: i.expenseClassification.reduce((m: Record<string, number>, e) => { m[e.category] = (m[e.category] ?? 0) + 1; return m; }, {}),
        dueDateQueue: i.dueDateQueue.map((q) => ({ amount: q.amount, currency: q.currency, project: q.projectName })),
        overdueReasonGaps: i.overdueReasonGaps.length,
        questionsTotal: i.questions.length,
        top: { items: i.top.items, questions: i.top.questions.map((q) => ({ questionType: q.questionType, subject: q.subject, identity: q.identity, options: q.options.map((o) => o.code) })) },
        // F2.8–F2.10: Owner answers consumed (read-only here — nothing is answered by this script)
        ownerAnswers: i.ownerAnswers,
      };
    })(),
    brief: r.brief,
    before, after, unchanged: JSON.stringify(before) === JSON.stringify(after),
    blockedWrites: blocked,
  }, null, 2));
}
main().catch((e) => { console.error(e); process.exit(1); });
