/**
 * Tests — finance_transactions + finance_position breakdown (Owner mission 2026-10-11: "every amount Sunny states can be
 * broken down into its rows").
 *
 * Run with:   npx tsx scripts/test-finance-transactions.tsx
 *
 * NEVER touches production. Sources are built by the REAL Finance Brain (deriveFinanceView) over fixtures shaped like
 * the October 2026 production case (₪2,500 income, ₪1,500 expenses incl. a ₪1,000 general supplier row with no
 * project, $385 expenses) plus noise (expected, cancelled, undated, future, malformed rows) and the anonymous
 * production mirror. Proves:
 *   R. every realized month total (every month, every currency, income + expense) is reproduced EXACTLY by the rows the
 *      capability lists — also when the rows are paged one by one through the real cursor;
 *   C. counted = the Brain's own month evidence (no second rule), with the not-counted reason;
 *   T. rows with no project are reachable, with their Owner text (description / notes);
 *   A. Owner-only: a non-Owner audience is refused before any read;
 *   P. finance_position carries countedRows + a breakdown pointer (rows on demand, never inlined);
 *   X. ₪ and $ are never added together.
 */
import { PARTNER_KNOWLEDGE_REGISTRY } from "../lib/partner/knowledge/catalog";
import { queryKnowledgeCore } from "../lib/partner/knowledge/query";
import type { KnowledgeAudience, KnowledgeRequest, QueryResponse } from "../lib/partner/knowledge/types";
import type { GatewayFinance, GatewaySources } from "../lib/partner/gateway/core";
import { deriveFinanceView } from "../lib/partner/finance/view";
import { buildFinanceBrief } from "../lib/partner/finance/brief";
import type { FinanceRaw } from "../lib/partner/finance/types";
import { empty, project, productionMirror, tx } from "./fixtures/finance-mirror";

let pass = 0, fail = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log(`  ✓ ${name}`); pass++; } else { console.log(`  ✗ ${name}\n      expected ${e}\n      actual   ${a}`); fail++; }
}
const ok = (name: string, cond: boolean) => { if (cond) { console.log(`  ✓ ${name}`); pass++; } else { console.log(`  ✗ ${name}`); fail++; } };

const OWNER_EXT: KnowledgeAudience = { channel: "EXTERNAL", ownerAuthorized: true };
const STRANGER_EXT: KnowledgeAudience = { channel: "EXTERNAL", ownerAuthorized: false };
const INTERNAL_NO_OWNER: KnowledgeAudience = { channel: "INTERNAL", ownerAuthorized: false };
const NOW = new Date("2026-10-11T09:00:00Z");

// ── the October case ──
const song = project({ name: "שיר אוקטובר", artist: "אמן חוץ" });
const T = {
  inShow: tx({ id: "tx-in-1500", type: "income", amount: 1500, currency: "₪", status: "התקבל", date: "2026-10-03", projectId: song.id, scope: "project", category: "מקדמה" }),
  inGeneral: tx({ id: "tx-in-1000", type: "income", amount: 1000, currency: "₪", status: "שולם", date: "2026-10-05", category: "הכנסה כללית" }),
  alvin: tx({ id: "tx-alvin-1000", type: "expense", amount: 1000, currency: "₪", status: "שולם", date: "2026-10-04", category: "ספקים", businessUnit: "STUDIO", businessUnitSource: "RULE" }),
  five: tx({ id: "tx-exp-500", type: "expense", amount: 500, currency: "₪", status: "שולם", date: "2026-10-06", projectId: song.id, scope: "project", category: "הקלטות", businessUnit: "STUDIO", businessUnitSource: "RULE" }),
  usdA: tx({ id: "tx-usd-200", type: "expense", amount: 200, currency: "$", status: "שולם", date: "2026-10-02", category: "מיקס" }),
  usdB: tx({ id: "tx-usd-185", type: "expense", amount: 185, currency: "$", status: "שולם", date: "2026-10-07", category: "תוכנה" }),
  // noise — never counted
  expected: tx({ id: "tx-expected", type: "income", amount: 3000, currency: "₪", status: "צפוי", date: "2026-10-20" }),
  cancelled: tx({ id: "tx-cancelled", type: "expense", amount: 700, currency: "₪", status: "בוטל", date: "2026-10-08" }),
  undated: tx({ id: "tx-undated", type: "income", amount: 90, currency: "₪", status: "התקבל", date: null }),
  future: tx({ id: "tx-future", type: "expense", amount: 60, currency: "₪", status: "שולם", date: "2026-11-02" }),
  malformed: tx({ id: "tx-malformed", type: "expense", amount: "abc", currency: "₪", status: "שולם", date: "2026-10-09" }),
  // September (history) + a fractional pair (rounding)
  sep1: tx({ id: "tx-sep-1", type: "income", amount: 0.1, currency: "₪", status: "שולם", date: "2026-09-12" }),
  sep2: tx({ id: "tx-sep-2", type: "income", amount: 0.2, currency: "₪", status: "שולם", date: "2026-09-13" }),
  sep3: tx({ id: "tx-sep-3", type: "expense", amount: 1234.56, currency: "€", status: "שולם", date: "2026-09-14" }),
};
const octRaw = (): FinanceRaw => empty({ transactions: Object.values(T).map((x) => ({ ...x })), projects: [song] });

function sources(raw: FinanceRaw, now: Date, text = true): GatewaySources {
  const view = deriveFinanceView(raw, now, []);
  const finance: GatewayFinance = { state: view.state, integrity: view.integrity, actions: view.actions, raw, brief: buildFinanceBrief(view.state, view.integrity, { answersAvailable: true, actionNoteHe: view.actionNoteHe }), answersAvailable: true };
  const linked = raw.transactions.filter((x) => x.projectId).map((x) => ({ id: x.id, projectId: x.projectId!, type: x.type, date: x.date, description: x.id === "tx-exp-500" ? "חדר הקלטות — סשן שירה" : null, notes: null, paymentMethod: "העברה", artistText: null, hasReceipt: false, createdAt: x.createdAt }));
  const unlinked = raw.transactions.filter((x) => !x.projectId).map((x) => ({ id: x.id, type: x.type, date: x.date, description: x.id === "tx-alvin-1000" ? "תשלום לאלווין" : null, notes: x.id === "tx-alvin-1000" ? "עבודת עריכה" : null, paymentMethod: "ביט", artistText: null, hasReceipt: true, createdAt: x.createdAt }));
  return {
    now, finance: { status: "OK", value: finance }, identities: { cleantone: null },
    ...(text ? {
      projectDetail: { status: "OK", value: { transactionsText: { rows: linked, capped: false } } as never },
      clientDetail: { status: "OK", value: { clients: { rows: [], capped: false }, unlinkedTransactionsText: { rows: unlinked, capped: false } } as never },
    } : {}),
  } as GatewaySources;
}
const q = (src: GatewaySources, req: KnowledgeRequest, a: KnowledgeAudience = OWNER_EXT): QueryResponse => queryKnowledgeCore(PARTNER_KNOWLEDGE_REGISTRY, req, src, a);
const sumOf = (r: QueryResponse, code: string) => r.summary.find((s) => s.code === code)?.value;
const fieldsOf = (r: QueryResponse) => r.items.map((i) => i.fields as Record<string, unknown>);

/** Follow the real cursor page by page; returns every item. */
function allPages(src: GatewaySources, req: KnowledgeRequest): QueryResponse["items"] {
  const out: QueryResponse["items"] = [];
  let cursor: string | undefined;
  for (let guard = 0; guard < 500; guard++) {
    const r = q(src, { ...req, ...(cursor ? { cursor } : {}) });
    if (r.status !== "OK") throw new Error(`page status ${r.status}`);
    out.push(...r.items);
    if (!r.page?.nextCursor) return out;
    cursor = r.page.nextCursor;
  }
  throw new Error("paging did not end");
}
const round2 = (n: number) => Math.round(n * 100) / 100;

/** R: every realized month total, every currency, reproduced from the listed rows (paged with the given limit). */
function reconcileAll(label: string, raw: FinanceRaw, now: Date, limit: number) {
  const src = sources(raw, now);
  const st = (src.finance as { value: GatewayFinance }).value.state;
  const months = [st.realized, ...st.history];
  let checked = 0;
  for (const m of months) for (const [cur, flow] of Object.entries(m.byCurrency)) {
    const items = allPages(src, { capability: "finance_transactions", params: { month: m.month, currency: cur, counted: "yes" }, limit });
    const ids = items.map((i) => i.id);
    const inc = round2(items.filter((i) => i.fields.type === "income").reduce((s, i) => s + (i.fields.amount as number), 0));
    const exp = round2(items.filter((i) => i.fields.type === "expense").reduce((s, i) => s + (i.fields.amount as number), 0));
    const evidenceIds = m.evidence.filter((e) => e.sourceType === "transaction" && e.currency === cur).map((e) => `tx:${e.sourceId}`).sort();
    const good = Math.abs(inc - flow.cashIn) < 0.005 && Math.abs(exp - flow.cashOut) < 0.005 && new Set(ids).size === ids.length && JSON.stringify([...ids].sort()) === JSON.stringify(evidenceIds);
    if (!good) console.log(`      ${label} ${m.month} ${cur}: rows income ${inc} / expense ${exp} vs Brain ${flow.cashIn} / ${flow.cashOut}`);
    ok(`R ${label} ${m.month} ${cur} (limit ${limit}): rows = Brain total + exact evidence set`, good);
    const one = q(src, { capability: "finance_transactions", params: { month: m.month, currency: cur, counted: "yes" }, limit });
    ok(`R ${label} ${m.month} ${cur}: summary reconciles over ALL pages`, sumOf(one, "RECONCILES_WITH_MONTH_TOTAL") === true);
    checked++;
  }
  ok(`R ${label}: at least one month checked`, checked > 0);
}

console.log("\nR. every month total is reproduced exactly from its rows (paged)");
reconcileAll("october", octRaw(), NOW, 30);
reconcileAll("october", octRaw(), NOW, 1);
reconcileAll("october", octRaw(), NOW, 2);
reconcileAll("mirror", productionMirror(), new Date("2026-09-24T09:00:00Z"), 1);
reconcileAll("mirror", productionMirror(), new Date("2026-09-24T09:00:00Z"), 7);

console.log("\nO. the October production case");
{
  const src = sources(octRaw(), NOW);
  const inc = q(src, { capability: "finance_transactions", params: { month: "2026-10", type: "income", currency: "₪", counted: "yes" } });
  check("O1 where the ₪2,500 came from: exactly the two received rows", fieldsOf(inc).map((f) => [f.transactionId, f.amount]).sort(), [["tx-in-1000", 1000], ["tx-in-1500", 1500]]);
  check("O1 summary counted income ₪", (sumOf(inc, "COUNTED_TOTALS") as Record<string, Record<string, number>>).income, { "₪": 2500 });
  check("O1 Brain month total beside it", sumOf(inc, "FINANCE_BRAIN_MONTH_TOTAL"), { "₪": { income: 2500, expense: 1500 } });
  ok("O1 reconciles", sumOf(inc, "RECONCILES_WITH_MONTH_TOTAL") === true);
  const inShow = fieldsOf(inc).find((f) => f.transactionId === "tx-in-1500")!;
  check("O1 the project row names its project", (inShow.project as { key: string }).key, `project:${song.id}`);

  const exp = q(src, { capability: "finance_transactions", params: { month: "2026-10", type: "expense", currency: "₪", counted: "yes" } });
  check("O2 what makes up the ₪1,500: the supplier row + the ₪500 row", fieldsOf(exp).map((f) => [f.transactionId, f.amount]).sort(), [["tx-alvin-1000", 1000], ["tx-exp-500", 500]]);
  const alvin = fieldsOf(exp).find((f) => f.transactionId === "tx-alvin-1000")!;
  check("O2 the supplier row has no project", alvin.project, null);
  check("O2 its Owner text is read from the ledger, not from memory", [(alvin.description as { text: string }).text, (alvin.notes as { text: string }).text, alvin.textRead], ["תשלום לאלווין", "עבודת עריכה", true]);
  ok("O2 the cancelled ₪700 is not among the counted expenses", !fieldsOf(exp).some((f) => f.transactionId === "tx-cancelled"));

  const five = fieldsOf(exp).find((f) => f.amount === 500)!;
  check("O3 what the ₪500 is: category + description + project + unit", [five.category, (five.description as { text: string }).text, (five.project as { key: string }).key, five.businessUnit], ["הקלטות", "חדר הקלטות — סשן שירה", `project:${song.id}`, "STUDIO"]);

  const usd = q(src, { capability: "finance_transactions", params: { month: "2026-10", currency: "$", counted: "yes" } });
  check("O4 the $385: exactly the two $ rows", fieldsOf(usd).map((f) => [f.transactionId, f.amount]).sort(), [["tx-usd-185", 185], ["tx-usd-200", 200]]);
  check("O4 counted $ expense", (sumOf(usd, "COUNTED_TOTALS") as Record<string, Record<string, number>>).expense, { "$": 385 });
  ok("O4 reconciles", sumOf(usd, "RECONCILES_WITH_MONTH_TOTAL") === true);

  const about = q(src, { capability: "finance_transactions", params: { about: "אלווין" } });
  check("O5 a follow-up by supplier name finds the row (text search)", fieldsOf(about).map((f) => f.transactionId), ["tx-alvin-1000"]);
  const general = q(src, { capability: "finance_transactions", mode: "no_project", params: { month: "2026-10", type: "expense" } });
  ok("O6 rows with no project are listed", fieldsOf(general).some((f) => f.transactionId === "tx-alvin-1000") && fieldsOf(general).every((f) => f.project === null));
  const proj = q(src, { capability: "finance_transactions", params: { project: `project:${song.id}` } });
  check("O7 project filter = the project's rows", fieldsOf(proj).map((f) => f.transactionId).sort(), ["tx-exp-500", "tx-in-1500"]);
  ok("O8 every row drills into partner_entity transaction:<id>", q(src, { capability: "finance_transactions", limit: 30 }).items.every((i) => i.entity === `transaction:${(i.fields as { transactionId: string }).transactionId}`));
}

console.log("\nC. not counted — with the reason (explanation only)");
{
  const src = sources(octRaw(), NOW);
  const r = q(src, { capability: "finance_transactions", params: { counted: "no" }, limit: 30 });
  const why = Object.fromEntries(fieldsOf(r).map((f) => [f.transactionId as string, f.notCountedReason]).sort(([a], [b]) => String(a).localeCompare(String(b))));
  check("C1 reasons", why, { "tx-cancelled": "CANCELLED", "tx-expected": "NOT_REALIZED_STATUS", "tx-future": "MONTH_NOT_YET_REALIZED", "tx-malformed": "MALFORMED", "tx-undated": "NO_DATE" });
  ok("C2 a not-counted row has no counted month", fieldsOf(r).every((f) => f.countedInRealizedMonth === null));
  const all = q(src, { capability: "finance_transactions", params: { month: "2026-10" }, limit: 30 });
  ok("C3 without counted=yes the reconciliation still uses only counted rows", sumOf(all, "RECONCILES_WITH_MONTH_TOTAL") === true);
  check("C4 not-counted totals stay apart (never realized money)", (sumOf(all, "NOT_COUNTED_TOTALS") as Record<string, Record<string, number>>), { expense: { "₪": 700 }, income: { "₪": 3000 } });
  const bad = q(src, { capability: "finance_transactions", params: { month: "2026-13" } });
  check("C5 an invalid month filters nothing and says so", [bad.completeness, bad.items.length], ["UNKNOWN", 0]);
}

console.log("\nX. currencies are never added together");
{
  const src = sources(octRaw(), NOW);
  const r = q(src, { capability: "finance_transactions", params: { month: "2026-10", counted: "yes" }, limit: 30 });
  check("X1 counted totals per type, per currency", sumOf(r, "COUNTED_TOTALS"), { expense: { "$": 385, "₪": 1500 }, income: { "₪": 2500 } });
  const sep = q(src, { capability: "finance_transactions", params: { month: "2026-09", counted: "yes" } });
  check("X2 0.1 + 0.2 reconciles to the Brain (rounding)", (sumOf(sep, "COUNTED_TOTALS") as Record<string, Record<string, number>>).income, { "₪": 0.3 });
  ok("X3 September reconciles (₪ + €)", sumOf(sep, "RECONCILES_WITH_MONTH_TOTAL") === true);
}

console.log("\nT. text unavailable is reported, never 'none'");
{
  const src = sources(octRaw(), NOW, false);
  const r = q(src, { capability: "finance_transactions", params: { month: "2026-10", counted: "yes" }, limit: 30 });
  ok("T1 rows are still served from Finance", r.items.length === 6 && sumOf(r, "RECONCILES_WITH_MONTH_TOTAL") === true);
  ok("T2 textRead=false on every row", fieldsOf(r).every((f) => f.textRead === false));
  ok("T3 missing names the text sources", r.missing.some((m) => m.fact.includes("description")));
  const about = q(src, { capability: "finance_transactions", params: { about: "אלווין" } });
  check("T4 a text search without text is PARTIAL, not 'nothing found'", about.completeness, "PARTIAL");
}

console.log("\nA. Owner-only");
{
  const src = sources(octRaw(), NOW);
  check("A1 external non-Owner refused", q(src, { capability: "finance_transactions" }, STRANGER_EXT).status, "NOT_AUTHORIZED");
  check("A2 internal non-Owner refused", q(src, { capability: "finance_transactions" }, INTERNAL_NO_OWNER).status, "NOT_AUTHORIZED");
  ok("A3 refused before any read (no items)", q(src, { capability: "finance_transactions" }, STRANGER_EXT).items.length === 0);
  const cap = PARTNER_KNOWLEDGE_REGISTRY.get("finance_transactions")!;
  check("A4 declared FINANCIAL + ownerOnly", [cap.access.ownerOnly, cap.access.sensitivity], [true, "FINANCIAL"]);
  check("A5 finance_position also refused to a non-Owner", q(src, { capability: "finance_position" }, STRANGER_EXT).status, "NOT_AUTHORIZED");
  check("A6 unknown params are refused (no arbitrary filters)", q(src, { capability: "finance_transactions", params: { sql: "x" } }).status, "INVALID_REQUEST");
}

console.log("\nP. finance_position: a pointer per total, rows on demand");
{
  const src = sources(octRaw(), NOW);
  const r = q(src, { capability: "finance_position" });
  const ils = r.items.find((i) => i.id === "2026-10:₪")!.fields as Record<string, unknown>;
  const usd = r.items.find((i) => i.id === "2026-10:$")!.fields as Record<string, unknown>;
  check("P1 ₪ totals unchanged", [ils.actualIncome, ils.actualExpenses, ils.net], [2500, 1500, 1000]);
  check("P2 ₪ counted rows", ils.countedRows, { income: 2, expense: 2 });
  check("P3 $ counted rows", usd.countedRows, { income: 0, expense: 2 });
  check("P4 breakdown pointer", ils.breakdown, { capability: "finance_transactions", params: { month: "2026-10", currency: "₪", counted: "yes" } });
  ok("P5 no rows inlined in finance_position", r.items.length === 2 && !JSON.stringify(r.items).includes("tx-alvin-1000"));
  const h = q(src, { capability: "finance_position", mode: "history" });
  ok("P6 history months carry the pointer too", h.items.length > 0 && h.items.every((i) => (i.fields as { breakdown?: unknown }).breakdown));
}

console.log("\nB. a full page fits the connector budget (no silent trim past the cursor)");
{
  const long = "א".repeat(5000);
  const raw = empty({ transactions: Array.from({ length: 40 }, (_, i) => tx({ id: `big-${String(i).padStart(2, "0")}`, type: "expense", amount: 100 + i, status: "שולם", date: "2026-10-01", category: "ק".repeat(80), expenseScope: "ס".repeat(80) })) });
  const src = sources(raw, NOW);
  const cd = (src.clientDetail as unknown as { value: { unlinkedTransactionsText: { rows: Array<{ description: string | null; notes: string | null }> } } }).value;
  for (const r of cd.unlinkedTransactionsText.rows) { r.description = long; r.notes = long; }
  const cap = PARTNER_KNOWLEDGE_REGISTRY.get("finance_transactions")!;
  const r = q(src, { capability: "finance_transactions", limit: cap.paging.maxLimit });
  const size = JSON.stringify(r).length;
  ok(`B1 worst-case full page (${r.items.length} rows) = ${size} chars < 100,000`, r.items.length === cap.paging.maxLimit && size < 100_000);
  ok("B2 long text is capped (never the whole note)", fieldsOf(r).every((f) => (f.description as { text: string }).text.length <= 601));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
