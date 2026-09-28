/**
 * Business unit (task 4, Owner decisions 2026-09-28): the ONE pure rule (lib/business-unit.ts) + the server helper
 * (lib/writes/business-unit.ts) on an in-memory database. No production, no network, no push.
 * Run with:   npx tsx scripts/test-business-unit.tsx
 */
import Module from "node:module";
import fs from "node:fs";
import path from "node:path";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: unknown) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 600)}` : ""}`); } };
const read = (p: string) => fs.readFileSync(path.resolve(__dirname, "..", p), "utf8");
const section = (s: string) => console.log(`\n${s}`);

// ── in-memory database ──
type Row = Record<string, unknown>;
const db: Record<string, Row[]> = {};
function table(name: string) {
  const filters: Array<(r: Row) => boolean> = [];
  let op: { kind: "select" } | { kind: "update"; patch: Row } = { kind: "select" };
  const rows = () => (db[name] ?? []).filter((r) => filters.every((f) => f(r)));
  const run = () => { const hit = rows(); if (op.kind === "update") for (const r of hit) Object.assign(r, (op as { patch: Row }).patch); return hit.map((r) => ({ ...r })); };
  const q = {
    select() { return q; },
    update(patch: Row) { op = { kind: "update", patch }; return q; },
    eq(k: string, v: unknown) { filters.push((r) => r[k] === v); return q; },
    in(k: string, vs: unknown[]) { filters.push((r) => vs.includes(r[k])); return q; },
    is(k: string, v: unknown) { filters.push((r) => (r[k] ?? null) === v); return q; },
    async maybeSingle() { return { data: run()[0] ?? null, error: null }; },
    async single() { const d = run()[0]; return d ? { data: d, error: null } : { data: null, error: { message: "not found" } }; },
    then(res: (v: { data: Row[]; error: null }) => unknown) { return Promise.resolve({ data: run(), error: null }).then(res); },
  };
  return q;
}
const ML = Module as unknown as { _load(request: string, parent: unknown, isMain: boolean): unknown };
const orig = ML._load;
ML._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === "server-only") return {};
  if (/(^|\/)supabase$/.test(request)) return { supabase: { from: (n: string) => table(n) } };
  return orig.call(this, request, parent, isMain);
};

async function main() {
  const B = await import("../lib/business-unit");
  const W = await import("../lib/writes/business-unit");
  const infer = B.inferBusinessUnit;

  section("1. precedence (the approved order)");
  ok("1. an explicit Owner choice wins (OWNER_DECISION)", infer({ writer: "SHOW_SYNC", type: "income", show: { artistIsRecords: true }, ownerChoice: "STUDIO" }).unit === "STUDIO" && infer({ writer: "SHOW_SYNC", type: "income", ownerChoice: "STUDIO" }).source === "OWNER_DECISION");
  ok("   an unknown choice is never stored", infer({ writer: "FINANCE_MANUAL", type: "income", ownerChoice: "HQ" }).unit === null);
  ok("2. Victor's salary → STUDIO; a mix / master cost → STUDIO (even on a Records song)", infer({ writer: "VICTOR", type: "expense" }).unit === "STUDIO" && infer({ writer: "MIX", type: "expense", project: { businessType: "לייבל" } }).unit === "STUDIO" && infer({ writer: "FINANCE_MANUAL", type: "expense", category: "מיקס / מאסטר", project: { businessType: "לייבל" } }).unit === "STUDIO");
  ok("3. a show of a Records roster artist → RECORDS; a collab / other artist → NULL (never a guess)", infer({ writer: "SHOW_SYNC", type: "income", show: { artistIsRecords: true } }).unit === "RECORDS" && infer({ writer: "SHOW_SYNC", type: "income", show: { artistIsRecords: false } }).unit === null);
  ok("4. label project → RECORDS (income, clip cost, promotion)", ["income", "expense"].every((type) => infer({ writer: "FINANCE_MANUAL", type, expenseScope: "קליפ", project: { businessType: "לייבל" } }).unit === "RECORDS") && infer({ writer: "PROMOTION", type: "expense", expenseScope: "שיווק", project: { businessType: "לייבל" } }).unit === "RECORDS");
  ok("   client project: song income → STUDIO; session cost → STUDIO; other expense → NULL", infer({ writer: "FINANCE_MANUAL", type: "income", expenseScope: "כללי", project: { businessType: "לקוח" } }).unit === "STUDIO" && infer({ writer: "FINANCE_MANUAL", type: "expense", expenseScope: "סשן", project: { businessType: "לקוח" } }).unit === "STUDIO" && infer({ writer: "PROMOTION", type: "expense", expenseScope: "שיווק", project: { businessType: "לקוח" } }).unit === null);
  ok("   client clip money → FILMS only with an external-client Red Films production; otherwise NULL", infer({ writer: "CLIP_PAYMENT", type: "income", expenseScope: "קליפ", project: { businessType: "לקוח", hasExternalClipProduction: true } }).unit === "FILMS" && infer({ writer: "CLIP_PAYMENT", type: "income", expenseScope: "קליפ", project: { businessType: "לקוח", hasExternalClipProduction: false } }).unit === null);
  ok("5. no show / project / rule → NULL (דורש סיווג)", infer({ writer: "FINANCE_MANUAL", type: "expense" }).unit === null && /דורש סיווג/.test(infer({ writer: "FINANCE_MANUAL", type: "expense" }).reasonHe) && infer({ writer: "FINANCE_MANUAL", type: "income", project: { businessType: null } }).unit === null);
  const allInputs = ["FINANCE_MANUAL", "SUNNY", "SHOW_SYNC", "MIX", "VICTOR", "CLIP_PAYMENT", "CLIP_PROMOTE", "RF_PAYMENT", "PROMOTION", "SPLIT"].flatMap((writer) => ["income", "expense"].flatMap((type) => [null, "לקוח", "לייבל"].flatMap((bt) => ["כללי", "קליפ", "סשן", "שיווק"].map((scope) => infer({ writer: writer as never, type, expenseScope: scope, project: bt === null ? null : { businessType: bt, hasExternalClipProduction: true } })))));
  ok("CORPORATE is never inferred (only an explicit choice) — over every writer × type × project × scope", allInputs.every((d) => d.unit !== "CORPORATE") && infer({ writer: "FINANCE_MANUAL", type: "expense", ownerChoice: "CORPORATE" }).unit === "CORPORATE");

  section("2. בלאגן: the Owner's STUDIO decision is never overturned by the client-clip rule");
  const balagan = { businessType: "לקוח", hasExternalClipProduction: true, ownerDecidedUnits: ["STUDIO"] as const };
  ok("a new clip row on a project where the Owner decided STUDIO → NULL (not FILMS, not an inherited STUDIO)", infer({ writer: "CLIP_PAYMENT", type: "income", expenseScope: "קליפ", project: { ...balagan, ownerDecidedUnits: ["STUDIO"] } }).unit === null);
  ok("   and without a Red Films production it is NULL anyway (never FILMS by guess)", infer({ writer: "FINANCE_MANUAL", type: "income", expenseScope: "קליפ", project: { businessType: "לקוח", ownerDecidedUnits: ["STUDIO"] } }).unit === null);
  ok("   an agreeing rule still classifies (song income = STUDIO, as decided)", infer({ writer: "FINANCE_MANUAL", type: "income", expenseScope: "כללי", project: { ...balagan, ownerDecidedUnits: ["STUDIO"] } }).unit === "STUDIO");

  section("3. provenance: RULE / OWNER_DECISION / HISTORICAL_APPROVED");
  ok("only RULE / unclassified may be re-derived automatically", B.mayRecomputeUnit("RULE") && B.mayRecomputeUnit(null) && !B.mayRecomputeUnit("OWNER_DECISION") && !B.mayRecomputeUnit("HISTORICAL_APPROVED"));
  ok("NULL unit ⇒ NULL source (the table's CHECK)", JSON.stringify(B.unitColumns({ unit: null, source: null, reasonHe: "" })) === JSON.stringify({ business_unit: null, business_unit_source: null }));
  ok("the vocabularies are exactly the approved ones", B.BUSINESS_UNITS.join() === "STUDIO,RECORDS,FILMS,CORPORATE" && B.BUSINESS_UNIT_SOURCES.join() === "RULE,OWNER_DECISION,HISTORICAL_APPROVED");

  section("4. the server helper (facts from the database)");
  db.projects = [{ id: "pL", project_business_type: "לייבל" }, { id: "pC", project_business_type: "לקוח" }, { id: "pB", project_business_type: "לקוח" }];
  db.red_films_productions = [{ id: "rf1", project_id: "pB", client_source: "לקוח חיצוני", status: "בעריכה" }];
  db.shows = [{ id: "sR", artist: "שליו טסמה" }, { id: "sX", artist: "שליו טסמה, טל צגאי" }];
  db.label_artists = [{ id: "a1", name: "שליו טסמה" }];
  db.transactions = [
    { id: "tB1", project_id: "pB", type: "income", category: "", expense_scope: "קליפ", show_id: null, business_unit: "STUDIO", business_unit_source: "OWNER_DECISION" },
    { id: "tR", project_id: "pC", type: "income", category: "", expense_scope: "כללי", show_id: null, business_unit: "STUDIO", business_unit_source: "RULE" },
    { id: "tH", project_id: "pC", type: "income", category: "", expense_scope: "כללי", show_id: null, business_unit: "RECORDS", business_unit_source: "HISTORICAL_APPROVED" },
    { id: "split-orig", project_id: "pS", type: "income", business_unit: "STUDIO", business_unit_source: "OWNER_DECISION" },
    { id: "00000000-0000-4000-8000-000000000123", project_id: "pS", type: "income", business_unit: null, business_unit_source: null },
  ];
  ok("a show of a roster artist → RECORDS; a collab show → unclassified (automatic writer)", (await W.unitColumnsOrUnclassified({ writer: "SHOW_SYNC", type: "income", showId: "sR" })).business_unit === "RECORDS" && (await W.unitColumnsOrUnclassified({ writer: "SHOW_SYNC", type: "income", showId: "sX" })).business_unit === null);
  let threw = ""; try { await W.unitColumnsForNewTransaction({ writer: "FINANCE_MANUAL", type: "expense" }); } catch (e) { threw = e instanceof W.NeedsBusinessUnitError ? e.code : "other"; }
  ok("a MANUAL create without a certain unit is refused (NEEDS_BUSINESS_UNIT — the person chooses)", threw === "NEEDS_BUSINESS_UNIT");
  ok("an AUTOMATIC create without a certain unit stays unclassified (NULL, never a guess)", JSON.stringify(await W.unitColumnsOrUnclassified({ writer: "PROMOTION", type: "expense", expenseScope: "שיווק", projectId: "pC" })) === JSON.stringify({ business_unit: null, business_unit_source: null }));
  ok("a manual choice equal to the rule is RULE; a different choice is OWNER_DECISION", (await W.unitColumnsForNewTransaction({ writer: "FINANCE_MANUAL", type: "income", projectId: "pL", ownerChoice: "RECORDS" })).business_unit_source === "RULE" && (await W.unitColumnsForNewTransaction({ writer: "FINANCE_MANUAL", type: "income", projectId: "pL", ownerChoice: "STUDIO" })).business_unit_source === "OWNER_DECISION");
  threw = ""; try { await W.unitColumnsForNewTransaction({ writer: "FINANCE_MANUAL", type: "income", expenseScope: "קליפ", projectId: "pB" }); } catch (e) { threw = e instanceof W.NeedsBusinessUnitError ? e.reasonHe : "other"; }
  ok("בלאגן-like project (Owner decided STUDIO, external RF production): a new clip income asks the Owner (not FILMS)", /הוחלט Studio/.test(threw), threw);
  ok("with the Owner's explicit choice it is recorded", (await W.unitColumnsForNewTransaction({ writer: "FINANCE_MANUAL", type: "income", expenseScope: "קליפ", projectId: "pB", ownerChoice: "STUDIO" })).business_unit === "STUDIO");

  section("5. existing rows: decisions are never overwritten");
  db.projects.find((p) => p.id === "pC")!.project_business_type = "לייבל";
  await W.recomputeUnitIfRule("tR"); await W.recomputeUnitIfRule("tH");
  ok("a RULE row is re-derived after a change (client → label: STUDIO → RECORDS)", db.transactions.find((t) => t.id === "tR")!.business_unit === "RECORDS");
  ok("a HISTORICAL_APPROVED row is untouched", db.transactions.find((t) => t.id === "tH")!.business_unit === "RECORDS" && db.transactions.find((t) => t.id === "tH")!.business_unit_source === "HISTORICAL_APPROVED");
  await W.recomputeUnitIfRule("tB1");
  ok("an OWNER_DECISION row is untouched", db.transactions.find((t) => t.id === "tB1")!.business_unit === "STUDIO" && db.transactions.find((t) => t.id === "tB1")!.business_unit_source === "OWNER_DECISION");
  ok("the Owner's explicit unit is OWNER_DECISION", (await W.setTransactionUnit("tR", "FILMS")) && db.transactions.find((t) => t.id === "tR")!.business_unit === "FILMS" && db.transactions.find((t) => t.id === "tR")!.business_unit_source === "OWNER_DECISION");
  await W.copyUnitToSplitRows("split-orig", { originalId: "split-orig", remainingId: "00000000-0000-4000-8000-000000000123" });
  ok("a split remainder inherits the original's unit + source (the RPC writes none)", db.transactions.find((t) => t.id === "00000000-0000-4000-8000-000000000123")!.business_unit === "STUDIO" && db.transactions.find((t) => t.id === "00000000-0000-4000-8000-000000000123")!.business_unit_source === "OWNER_DECISION");

  section("6. every writer that creates a Finance row sets the unit (one rule)");
  const writers: Array<[string, RegExp]> = [
    ["lib/writes/finance.ts", /unitColumnsForNewTransaction\(/],
    ["lib/shows-finance-sync.ts", /unitColumnsOrUnclassified\(\{ writer: "SHOW_SYNC"/],
    ["lib/writes/mix.ts", /inferBusinessUnit\(\{ writer: "MIX"/],
    ["lib/writes/victor.ts", /inferBusinessUnit\(\{ writer: "VICTOR"/],
    ["lib/writes/clip.ts", /writer: "CLIP_PAYMENT"/],
    ["lib/writes/redfilms.ts", /writer: "CLIP_PROMOTE"/],
    ["lib/social-promotions-store.ts", /writer: "PROMOTION"/],
    ["lib/writes/rf-finance-link.ts", /unitWriter: "RF_PAYMENT"/],
    ["lib/writes/artist-payments.ts", /inferBusinessUnit\(\{ writer: "ARTIST_PAYMENT"/],
  ];
  ok("each insert site names its writer", writers.every(([f, re]) => re.test(read(f))), writers.filter(([f, re]) => !re.test(read(f))).map(([f]) => f));
  const inserts = ["lib/writes/finance.ts", "lib/shows-finance-sync.ts", "lib/writes/mix.ts", "lib/writes/victor.ts", "lib/writes/clip.ts", "lib/writes/redfilms.ts", "lib/social-promotions-store.ts", "lib/writes/artist-payments.ts"];
  const all = fs.readdirSync(path.resolve(__dirname, "../lib"), { recursive: true } as never) as unknown as string[];
  const insertFiles = all.filter((f) => /\.ts$/.test(f) && !/partner[\\/]/.test(String(f))).map((f) => `lib/${String(f).replace(/\\/g, "/")}`).filter((f) => /from\("transactions"\)[\s\S]{0,80}\.insert\(/.test(read(f)));
  ok("no other module inserts Finance rows (a new writer must set the unit)", insertFiles.every((f) => inserts.includes(f)), insertFiles);
  ok("the Finance route refuses a manual create without a unit with 422 + the four options", /NeedsBusinessUnitError\) return NextResponse\.json\(\{ error: err\.message, code: err\.code, reasonHe: err\.reasonHe, options: err\.options \}, \{ status: 422 \}\)/.test(read("app/api/transactions/route.ts")));
  const createSites = ["components/finance/QuickTxModal.tsx", "components/clients/ClientDrawer.tsx", "components/project/ScheduleModal.tsx", "components/quick-actions/QuickActionsModal.tsx", "components/ui/ProjectDrawer.tsx", "components/ui/ProjectDrawerV2.tsx", "components/finance/FinancePage.tsx"];
  ok("every screen that creates a transaction asks for a unit when needed (postTransactionWithUnit)", createSites.every((f) => { const s = read(f); const posts = (s.match(/fetch\("\/api\/transactions", withBusinessUnit\(\{[\s\S]*?method:\s*"POST"/g) ?? []).length + (s.match(/fetch\("\/api\/transactions", withBusinessUnit\(\{\s*method: "POST"/g) ?? []).length; return /postTransactionWithUnit\(\(u\) => fetch\("\/api\/transactions"/.test(s) && posts > 0; }));
  ok("the artist ledger is never touched by the unit (no ledger write in the unit modules)", !/artist_balance_entries/.test(read("lib/business-unit.ts") + read("lib/writes/business-unit.ts") + read("lib/business-unit-facts.ts")));

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
