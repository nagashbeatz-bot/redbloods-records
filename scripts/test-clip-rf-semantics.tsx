/**
 * B3 — CLIP / RED FILMS SEMANTICS (Owner canon 2026-09-27): A client clip price / income ≠ B planned budget ≠ C actual
 * cost ≠ D recoupable. Proves, with the REAL shared writers on an in-memory Supabase and the REAL pure rules / Sunny views:
 *   1. price ≠ budget: setClipPrice never touches a production budget; 'שלח קליפ' seeds budget 0 in the deal currency;
 *      no managed-budget lock anywhere (writer, primitive, UI);
 *   2. recoup: the clip part is NOT_DEFINED (null + the Hebrew reason) — never 50 %, never from the budget or the price;
 *      A / B / C are information per currency;
 *   3. budgetLinePaidState: the ONE line-paid rule (payments in the line currency), used by the screen, the modal and
 *      Sunny; stored status vs payments is a conflict signal; actual_amount is LEGACY, never paid;
 *   4. Red Films ledger payments are never counted as Finance (RF_LEDGER_NOT_IN_FINANCE, DB-1 pending); a non-clip
 *      production's payments → SCOPE_REQUIRED (never a silent כללי);
 *   5. an unowned project income can be scoped קליפ through the Finance primitive (owned refused; preview before / after);
 *   6. the legacy drawer edit never resets an income's scope;
 *   7. client_source from the project classification;
 *   8. promote keeps the linked planning row; planned excludes it; clip status vocabulary validated;
 *   9. leftovers: isActualMoneyTx clip mark, settings CAS merges, album 409 surfaced, received literal, promotions per currency.
 * Run with:   npx tsx scripts/test-clip-rf-semantics.tsx      Pure; never touches production.
 */
import Module from "node:module";
import fs from "node:fs";
import path from "node:path";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: unknown) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 600)}` : ""}`); } };
const read = (p: string) => fs.readFileSync(path.resolve(__dirname, "..", p), "utf8");
const section = (s: string) => console.log(`\n${s}`);

// ── in-memory Supabase (the subset the clip / Red Films / finance writers use) ─────────────────────────────────────
type Row = Record<string, unknown>;
const db: Record<string, Row[]> = {};
const log: string[] = [];
let seq = 0;
const T = (t: string) => (db[t] ??= []);
function builder(table: string) {
  const filters: Array<(r: Row) => boolean> = [];
  let op: "select" | "delete" | "update" | "insert" | "upsert" = "select";
  let patch: Row = {}; let rows: Row[] = []; let head = false; let returning = false; let single: "one" | "maybe" | null = null; let lim: number | null = null;
  const q = {
    select(_c?: string, o?: { count?: string; head?: boolean }) { if (op === "select") head = !!o?.head; else returning = true; return q; },
    eq(c: string, v: unknown) { filters.push((r) => (c === "value" && typeof v === "string" ? JSON.stringify(r.value) === v : r[c] === v)); return q; },
    neq(c: string, v: unknown) { filters.push((r) => r[c] !== v); return q; },
    in(c: string, vs: unknown[]) { filters.push((r) => vs.includes(r[c])); return q; },
    is(c: string, _v: null) { filters.push((r) => r[c] === null || r[c] === undefined); return q; },
    not(c: string) { filters.push((r) => r[c] !== null && r[c] !== undefined); return q; },
    like() { return q; }, order() { return q; }, limit(n: number) { lim = n; return q; },
    delete() { op = "delete"; return q; },
    update(p: Row) { op = "update"; patch = p; return q; },
    insert(r: Row | Row[]) { op = "insert"; rows = Array.isArray(r) ? r : [r]; return q; },
    upsert(r: Row | Row[]) { op = "upsert"; rows = Array.isArray(r) ? r : [r]; return q; },
    maybeSingle() { single = "maybe"; return q; }, single() { single = "one"; return q; },
    then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) { return Promise.resolve().then(run).then(res, rej); },
  };
  function run() {
    let match = T(table).filter((r) => filters.every((f) => f(r)));
    if (op === "select") {
      if (lim !== null) match = match.slice(0, lim);
      if (head) return { data: null, error: null, count: match.length };
      const data = match.map((r) => ({ ...r }));
      if (single) return { data: data[0] ?? null, error: single === "one" && !data.length ? { message: "no rows" } : null };
      return { data, error: null, count: data.length };
    }
    if (op === "delete") { log.push(`delete:${table}`); db[table] = T(table).filter((r) => !match.includes(r)); return { data: returning ? match : null, error: null }; }
    if (op === "update") {
      log.push(`update:${table}${table === "settings" && filters.length > 1 ? "(cas)" : ""}`);
      for (const r of match) Object.assign(r, patch);
      const data = match.map((r) => ({ ...r }));
      return { data: returning ? (single ? data[0] ?? null : data) : null, error: null };
    }
    log.push(`${op}:${table}`);
    const stored = rows.map((r) => { const row = { id: `${table}-${++seq}`, ...r }; T(table).push(row); return { ...row }; });
    return { data: single ? stored[0] : stored, error: null };
  }
  return q;
}
const fakeSupabase = { from: (t: string) => builder(t), rpc: async () => ({ data: null, error: { message: "no rpc" } }) };
const ML = Module as unknown as { _load(request: string, parent: unknown, isMain: boolean): unknown };
const orig = ML._load;
ML._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === "server-only") return {};
  if (!path.isAbsolute(request) && /(^|\/)supabase$/.test(request)) return { supabase: fakeSupabase };
  if (request === "@/lib/projects-store") return { touchProject: async () => {} };
  return orig.call(this, request, parent, isMain);
};
// A dynamic import("@/lib/supabase") (lib/writes/settings-merge) goes through the ESM loader, which ignores the stub
// above: give that module DUMMY local credentials (never a real host) and point its client at the in-memory fake.
process.env.SUPABASE_URL = "http://127.0.0.1:9"; process.env.SUPABASE_SECRET_KEY = "test-only-not-a-key";
async function patchEsmSupabase() {
  const m = (await import("@/lib/supabase")) as unknown as { supabase: { from: unknown; rpc: unknown } };
  m.supabase.from = fakeSupabase.from; m.supabase.rpc = fakeSupabase.rpc;
}
const reset = (seed: Record<string, Row[]>) => { for (const k of Object.keys(db)) delete db[k]; for (const [k, v] of Object.entries(seed)) db[k] = v.map((r) => ({ ...r })); log.length = 0; };
const tick = () => new Promise((r) => setTimeout(r, 5));

(async () => {
  await patchEsmSupabase();
  const CLIP = await import("../lib/writes/clip");
  const RF = await import("../lib/writes/redfilms");
  const FIN = await import("../lib/writes/finance");
  const LC = await import("../lib/label-clips");
  const { computeArtistRecoup } = await import("../lib/label-recoup");
  const PURE = await import("../lib/clip-rf-money-pure");
  const VIEW = await import("../lib/partner/redfilms/view");
  const { ATTENTION_MAP } = await import("../lib/partner/system/company");
  const H = await import("./fixtures/act-harness");
  const { planAction } = await import("../lib/partner/act/service");

  // ── 1. price ≠ budget ────────────────────────────────────────────────────────────────────────────────────────────
  section("1. A client clip price ≠ B planned budget");
  reset({
    projects: [{ id: "p1", name: "קרוב אלייך", artist: "שליו טסמה", project_business_type: "לייבל" }, { id: "p2", name: "סינגל לקוח", artist: "יהלום", project_business_type: "לקוח" }],
    settings: [{ key: "finance_p1", value: { agreedPrice: 6000, currency: "₪", clipAgreedPrice: 3000, clipProductionId: "rf1" } }, { key: "finance_p2", value: { agreedPrice: 4000, currency: "$", clipAgreedPrice: 5000 } }],
    red_films_productions: [{ id: "rf1", title: "קרוב אלייך", production_type: "קליפ", status: "רעיון", project_id: "p1", general_budget: 3000, currency: "₪", created_at: "2026-09-01" }],
    clients: [],
  });
  await CLIP.setClipPrice("p1", 9000);
  ok("setClipPrice writes the price only (CAS merge) — the managed production's budget stays 3000", (T("settings").find((s) => s.key === "finance_p1")!.value as Row).clipAgreedPrice === 9000 && T("red_films_productions")[0].general_budget === 3000 && !log.includes("update:red_films_productions") && log.includes("update:settings(cas)"), log);
  ok("syncClipBudget is gone (no price → budget writer exists)", !/syncClipBudget/.test(read("lib/clip-production.ts").replace(/\/\/.*$/gm, "")) && !/syncClipBudget/.test(read("lib/writes/clip.ts")));
  const sent = await CLIP.sendClipToRedFilms("p2");
  const newProd = sent.kind === "ok" ? sent.production : {};
  ok("'שלח קליפ' seeds general_budget 0 (never the clip price 5000) in the deal currency $", sent.kind === "ok" && sent.created && newProd.general_budget === 0 && newProd.currency === "$", newProd);
  ok("'שלח קליפ' client_source from classification: a לקוח project → לקוח חיצוני", newProd.client_source === "לקוח חיצוני", newProd.client_source);
  const up = await RF.updateProduction("rf1", { general_budget: 4500, currency: "$" });
  ok("no managed-budget lock: a 'שלח קליפ' production's budget + currency are editable (writer)", up.kind === "ok" && T("red_films_productions")[0].general_budget === 4500 && T("red_films_productions")[0].currency === "$" && (up.kind === "ok" && up.production.budget_managed_by_project === true), up);
  ok("no lock in the route / UI (409 budgetLocked, 🔒 inputs and the clip-price note are gone)", !/budget_locked|budgetLocked/.test(read("app/api/red-films/productions/[id]/route.ts")) && !/budgetLocked/.test(read("components/red-films/RedFilmsBudgetItems.tsx")) && !/isProjectManagedClipBudget|PROJECT_MANAGED_BUDGET_NOTE/.test(read("components/red-films/RedFilmProductionPage.tsx") + read("components/red-films/RedFilmProductionDrawer.tsx") + read("lib/clip-finance.ts")) && !/נקבע לפי מחיר הקליפ/.test(read("lib/partner/act/primitives/redfilms.ts")) && !/budgetSynced/.test(read("components/ui/ProjectDrawerV2.tsx")));
  ok("DERIVED observation: a managed budget equal to the clip price (old sync) is reported, never a rule", PURE.budgetEqualsOldClipPriceSync({ managedBySendClip: true, budget: 3000, budgetCurrency: "₪", clipAgreedPrice: 3000, clipCurrency: "₪" }) && !PURE.budgetEqualsOldClipPriceSync({ managedBySendClip: true, budget: 3000, budgetCurrency: "$", clipAgreedPrice: 3000, clipCurrency: "₪" }) && !PURE.budgetEqualsOldClipPriceSync({ managedBySendClip: false, budget: 3000, budgetCurrency: "₪", clipAgreedPrice: 3000, clipCurrency: "₪" }));

  // ── 2. recoup NOT_DEFINED ────────────────────────────────────────────────────────────────────────────────────────
  section("2. D recoupable = NOT_DEFINED (never 50 %)");
  reset({
    red_films_productions: [
      { id: "c1", title: "קליפ שליו", production_type: "קליפ", status: "בעריכה", project_id: "p1", artist_name: "שליו טסמה", general_budget: 8000, currency: "₪" },
      { id: "c2", title: "קליפ דולרי", production_type: "קליפ", status: "רעיון", project_id: null, artist_name: "שליו טסמה", general_budget: 1000, currency: "$" },
      { id: "c3", title: "מבוטל", production_type: "קליפ", status: "בוטל", project_id: null, artist_name: "שליו טסמה", general_budget: 99999, currency: "₪" },
    ],
    settings: [{ key: "finance_p1", value: { clipAgreedPrice: 3500, currency: "₪" } }],
    transactions: [{ id: "e1", project_id: "p1", type: "expense", expense_scope: "קליפ", amount: 2000, currency: "₪", payment_status: "שולם" }, { id: "e2", project_id: "p1", type: "expense", expense_scope: "קליפ", amount: 700, currency: "₪", payment_status: "לא שולם" }],
    red_films_budget_payments: [{ id: "y1", production_id: "c1", amount: 1200, currency: "₪" }],
  });
  const clips = await LC.listArtistClips("שליו טסמה");
  const info = LC.artistClipMoney(clips);
  ok("every clip's recoup is NOT_DEFINED (null + Hebrew reason); no 50 % value anywhere", clips.length === 2 && clips.every((c) => c.recoup.status === "NOT_DEFINED" && c.recoup.amount === null && c.recoup.reasonHe === "חסר כלל חוזה: אילו הוצאות קליפ מתקזזות מול האמן") && !/4000|"500"/.test(JSON.stringify(clips)), clips);
  ok("A / B / C + Red Films ledger per currency, never added (₪: price 3500, budget 8000, paid cost 2000, RF 1200; $: budget 1000)", JSON.stringify(info["₪"]) === JSON.stringify({ clientClipPrice: 3500, plannedBudget: 8000, actualCostPaid: 2000, rfLedgerPaid: 1200 }) && info["$"]?.plannedBudget === 1000 && info["$"]?.actualCostPaid === 0, info);
  const r0 = computeArtistRecoup({ clipRecoupTarget: null, mediaArtistShareReceived: 300, mediaExpectedArtistShare: 50, showsArtistPaid: 1000, showsArtistExpected: 200, clipMoneyInfo: info });
  ok("computeArtistRecoup: clip target null → NOT_DEFINED + reason; every debt figure null; income still shown", r0.clipRecoupTarget === null && r0.clipRecoupStatus === "NOT_DEFINED" && /חסר כלל חוזה/.test(r0.clipRecoupReasonHe ?? "") && [r0.actualRecouped, r0.actualRecoupBalance, r0.projectedRecoup, r0.projectedRecoupBalance, r0.artistCredit, r0.artistActualBalance].every((x) => x === null) && r0.actualArtistIncome === 1300 && r0.expectedArtistIncome === 250, r0);
  ok("the recoup + clips routes never compute a clip target (null + A/B/C info; no getRecoupTargetForArtist, no clipSplit)", /clipRecoupTarget: null/.test(read("app/api/label/artists/[id]/recoup/route.ts")) && !/getRecoupTargetForArtist/.test(read("app/api/label/artists/[id]/recoup/route.ts")) && /recoupStatus: "NOT_DEFINED"/.test(read("app/api/label/artists/[id]/clips/route.ts")) && !/clipSplit/.test(read("lib/label-clips.ts")));
  ok("the label page shows 'לא נקבע' for a null recoup figure and no 50 % label", /לא נקבע/.test(read("components/label/LabelPage.tsx")) && !/\((50%|50\/50)\)|לייבל 50%/.test(read("components/label/LabelPage.tsx")) && /v === null \? "לא נקבע"/.test(read("components/label/LabelPage.tsx")));
  ok("only the media-income RPC keeps the pre-B3 target (LEGACY, documented)", /LEGACY_BEHAVIOR/.test(read("lib/label-clips.ts")) && /getRecoupTargetForArtist/.test(read("lib/media-income-store.ts")));

  // ── 3. budget line paid state ────────────────────────────────────────────────────────────────────────────────────
  section("3. budgetLinePaidState — one rule for the screen, the modal and Sunny");
  const S = PURE.budgetLinePaidState;
  ok("PAID when payments ≥ planned (planned > 0), with the overpayment", S({ planned_amount: 1000, currency: "₪", status: "מתוכנן" }, [{ amount: 600 }, { amount: 500 }]).state === "PAID" && S({ planned_amount: 1000 }, [{ amount: 1100 }]).over === 100);
  ok("PARTIAL / UNPAID / NO_PLAN", S({ planned_amount: 1000 }, [{ amount: 400 }]).state === "PARTIAL" && S({ planned_amount: 1000 }, []).state === "UNPAID" && S({ planned_amount: 0 }, [{ amount: 50 }]).state === "NO_PLAN");
  ok("the stored status never decides (שולם with no payment = UNPAID)", S({ planned_amount: 1000, status: "שולם" }, []).state === "UNPAID");
  ok("actual_amount (legacy manual mirror) is never paid", S({ planned_amount: 1000, actual_amount: 1000 } as never, []).paid === 0);
  ok("a payment in another currency is never added (no FX) — counted apart", (() => { const x = S({ planned_amount: 1000, currency: "$" }, [{ amount: 1000, currency: "₪" }, { amount: 200, currency: "$" }]); return x.paid === 200 && x.otherCurrencyPayments === 1 && x.state === "PARTIAL"; })());
  ok("stored status vs payments conflicts", PURE.budgetLineStatusConflict({ planned_amount: 500, status: "שולם" }, [])?.code === "STATUS_PAID_WITHOUT_PAYMENTS" && PURE.budgetLineStatusConflict({ planned_amount: 500, status: "מתוכנן" }, [{ amount: 500 }])?.code === "STATUS_PLANNED_BUT_PAID" && PURE.budgetLineStatusConflict({ planned_amount: 500, status: "בוטל" }, []) === null && PURE.budgetLineStatusConflict({ planned_amount: 500, status: "מתוכנן" }, [{ amount: 100 }]) === null);
  ok("the screen, the modal, Sunny's view and the operations capability all use budgetLinePaidState (no 0.99 tolerance, no stored-status paid)", ["components/red-films/RedFilmsBudgetItems.tsx", "components/red-films/BudgetItemDetailModal.tsx", "lib/partner/redfilms/view.ts", "lib/partner/knowledge/capabilities/operations.ts"].every((f) => /budgetLinePaidState\(/.test(read(f))) && !/item\.status === "שולם" \|\|/.test(read("components/red-films/RedFilmsBudgetItems.tsx")) && !/\* 0\.99/.test(read("components/red-films/RedFilmsBudgetItems.tsx") + read("components/red-films/BudgetItemDetailModal.tsx")));

  // Sunny: the same answer as the pure rule, on a production fixture
  const now = new Date("2026-09-27T09:00:00Z");
  const prodA = { id: "A", title: "קליפ", productionType: "קליפ", status: "בתכנון", projectId: "pA", clientId: null, artistName: "x", clientSource: "פנימי - לייבל", shootDate: null, publishDate: null, editStatus: null, collectionStatus: null, generalBudget: 3000, clientPrice: null, advanceRequired: null, advanceReceived: null, currency: "₪" };
  const prodB = { ...prodA, id: "B", title: "צילום הופעה", productionType: "צילום הופעה", projectId: null, generalBudget: 0 };
  const line = (id: string, prod: string, planned: number, status: string, actual = 0) => ({ id, productionId: prod, title: id, category: "צלם", vendorName: null, status, planned, actual, notes: null, currency: "₪", linkedTransactionId: null, createdAt: null, updatedAt: null });
  const pay = (id: string, prod: string, item: string, amount: number) => ({ id, productionId: prod, budgetItemId: item, amount, date: "2026-09-01", method: null, notes: null, receiptFileName: null, receiptMime: null, receiptPath: null, hasReceiptLink: false, currency: "₪", createdAt: null, updatedAt: null });
  const src = {
    now, identities: {},
    operations: { status: "OK", value: { redFilms: { rows: [prodA, prodB] } } },
    projectDetail: { status: "OK", value: {
      budgetItems: { rows: [line("L1", "A", 1000, "מתוכנן"), line("L2", "A", 800, "שולם"), line("L3", "A", 500, "מתוכנן", 500), line("L4", "B", 300, "מתוכנן")] },
      budgetPayments: { rows: [pay("Y1", "A", "L1", 1000), pay("Y2", "B", "L4", 300)] },
      clipItems: { rows: [{ id: "k1", projectId: "pA", category: "תאורה", description: null, notes: null, status: "תכנון בלבד", amount: 400, currency: "₪", linkedTransactionId: null, createdAt: null, updatedAt: null }, { id: "k2", projectId: "pA", category: "לוקיישן", description: null, notes: null, status: "הועבר לכספים", amount: 900, currency: "₪", linkedTransactionId: "tx9", createdAt: null, updatedAt: null }] },
    } },
    finance: { status: "OK", value: { raw: { transactions: [{ id: "tx9", projectId: "pA", type: "expense", date: "2026-09-02", amount: 900, currency: "₪", status: "לא שולם", category: null, scope: "project", expenseScope: "קליפ", linkedSessionId: null, createdAt: null }], financeSettings: [{ projectId: "pA", value: { clipAgreedPrice: 3000, currency: "₪", clipProductionId: "A" } }] } } },
  } as never;
  const vA = VIEW.buildProduction(src, prodA as never), vB = VIEW.buildProduction(src, prodB as never);
  const lineA = (id: string) => vA.money.lines.find((l) => l.title === id)!;
  ok("Sunny's line state = the pure rule (L1 PAID, L2 UNPAID though stored שולם, L3 UNPAID though legacy actual 500)", lineA("L1").paidState === S({ planned_amount: 1000 }, [{ amount: 1000 }]).state && lineA("L1").paidState === "PAID" && lineA("L2").paidState === "UNPAID" && lineA("L3").paidState === "UNPAID" && lineA("L3").legacyManualActual === 500, vA.money.lines);
  const vv = VIEW.buildVideoView(src);
  ok("BUDGET_LINE_STATUS_VS_PAYMENTS: stored שולם without payments + stored מתוכנן already paid (A: L1 + L2, B: L4) — all flagged, and mapped in ATTENTION_MAP", vv.signals.filter((s) => s.code === "BUDGET_LINE_STATUS_VS_PAYMENTS").length === 3 && vv.signals.filter((s) => s.code === "BUDGET_LINE_STATUS_VS_PAYMENTS" && s.production === "video-production:A").length === 2 && !!ATTENTION_MAP.BUDGET_LINE_STATUS_VS_PAYMENTS && !!ATTENTION_MAP.BUDGET_EQUALS_CLIP_PRICE_OLD_SYNC, vv.signals.map((s) => s.code));
  ok("the old-sync observation (budget 3000 = clip price 3000 on the 'שלח קליפ' production) is DERIVED", vA.money.budgetEqualsOldClipPriceSync?.epistemic === "DERIVED" && vv.signals.some((s) => s.code === "BUDGET_EQUALS_CLIP_PRICE_OLD_SYNC"));
  ok("no self-contradiction: the layers text says payments are NOT linked to Finance (DB-1) and a line's link is the old per-line link", /NOT linked to Finance/.test(vA.money.layers) && /DB-1/.test(vA.money.layers) && !/no Finance expense is linked to a line/.test(vA.money.layers) && lineA("L1").legacyFinanceLink === false);

  // ── 4. money truth: RF ledger ≠ Finance, SCOPE_REQUIRED ─────────────────────────────────────────────────────────
  section("4. Red Films ledger ≠ Finance; non-clip → SCOPE_REQUIRED");
  const pvA = VIEW.buildProjectVideo(src, "pA");
  ok("RF ledger paid (₪1000) is never counted as Finance actual cost (Finance paid ₪0, unpaid ₪900)", vA.money.paidRedFilmsLedger["₪"] === 1000 && vA.money.linkage.state === "RF_LEDGER_NOT_IN_FINANCE" && !pvA.expenses.paid["₪"] && pvA.expenses.unpaid["₪"] === 900);
  ok("the RF_LEDGER_NOT_IN_FINANCE signal says DB-1 pending", vv.signals.some((s) => s.code === "RF_LEDGER_NOT_IN_FINANCE" && /DB-1/.test(s.he)));
  ok("a non-clip production's payments → SCOPE_REQUIRED (never a silent כללי)", (vB.money.financeScope as { state?: string }).state === "SCOPE_REQUIRED" && vA.money.financeScope.scope === "קליפ" && PURE.rfPaymentFinanceScope("צילום הופעה").scope === null && vv.signals.some((s) => s.code === "RF_LEDGER_NOT_IN_FINANCE" && /לא 'כללי'/.test(s.he)));
  ok("Sunny's clip recoup is NOT_DEFINED and the view rule names A ≠ B ≠ C ≠ D", vA.money.recoup.status === "NOT_DEFINED" && vv.money.clipRecoup.status === "NOT_DEFINED" && /A client clip price/.test(vv.money.rule) && /NOT_DEFINED/.test(vv.money.rule));

  // ── 5. income scope via the primitive ────────────────────────────────────────────────────────────────────────────
  section("5. Clip income scope (UPDATE_TRANSACTION_DETAILS / ADD_TRANSACTION)");
  const U = H.U;
  const mkFin = (o: { owner?: string | null; projectId?: string | null; scope?: string } = {}) => {
    const tx: Record<string, Row> = { [U(1)]: { projectId: o.projectId === undefined ? U(10) : o.projectId, scope: "project", type: "income", date: "2026-09-10", description: "יהלום", artist: "יהלום", amount: 3500, currency: "₪", paymentStatus: "התקבל", paymentMethod: "", receiptRef: "", notes: "", category: "", expenseScope: o.scope ?? "כללי", linkedSessionId: "" } };
    return { tx, writers: {
      async readProjectMeta(id: string) { return id === U(10) ? { name: "יהלום", artist: "", status: "בעבודה", isHidden: false, businessType: "לקוח", projectType: "שיר", hasRelease: false } : null; },
      async readTransaction(id: string) { return tx[id] ? { ...tx[id] } : null; },
      async financeOwnerOf() { return o.owner ?? null; },
      async similarRecords() { return []; },
      async updateTransaction(id: string, p: Row) { Object.assign(tx[id], p); },
      async readProjectIncomeContext(pid: string) { return { clipAgreedPrice: null, clipCurrency: "₪", incomes: Object.entries(tx).filter(([, t]) => t.projectId === pid).map(([id, t]) => ({ id, amount: Number(t.amount), currency: String(t.currency), paymentStatus: String(t.paymentStatus), expenseScope: String(t.expenseScope) })) }; },
    } };
  };
  { const h = mkFin(); const r = await H.fullFlow(H.mkDeps(h.writers).d, "UPDATE_TRANSACTION_DETAILS", { transaction: `transaction:${U(1)}`, expenseScope: "קליפ" }, "כן בוס, קליפ");
    const t = JSON.stringify(r.p);
    ok("Yahalom ₪3500 → clip income: preview before (song 3500) / after (clip 3500) + 'clip deal price unknown'; executed + verified", /היום: ₪: שיר התקבל ₪3500/.test(t) && /אחרי: ₪: שיר התקבל ₪0 \(פתוח ₪0\) · קליפ התקבל ₪3500/.test(t) && /מחיר עסקת הקליפ לא ידוע/.test(t) && r.e?.status === "APPLIED_AS_EXPECTED" && h.tx[U(1)].expenseScope === "קליפ", r.e ?? r.p); }
  { const h = mkFin({ owner: "SHOW_PAYMENT" }); const r = await planAction({ intentHe: "x", actionId: "UPDATE_TRANSACTION_DETAILS", args: { transaction: `transaction:${U(1)}`, expenseScope: "קליפ" } }, H.OWNER, H.mkDeps(h.writers).d);
    ok("an OWNED income (show payment) is refused — lib/finance/ownership", r.status === "USE_OWNER_ACTION", r.status); }
  { const h = mkFin({ projectId: null }); const r = await planAction({ intentHe: "x", actionId: "UPDATE_TRANSACTION_DETAILS", args: { transaction: `transaction:${U(1)}`, expenseScope: "קליפ" } }, H.OWNER, H.mkDeps(h.writers).d);
    ok("an income without a project is refused (NO_PROJECT)", r.status === "NO_PROJECT", r.status); }
  ok("the split preview is pure and per currency", (() => { const s = PURE.songClipSplitBeforeAfter([{ id: "a", amount: 100, currency: "$", paymentStatus: "צפוי", expenseScope: "כללי" }, { id: "b", amount: 50, currency: "₪", paymentStatus: "בוטל", expenseScope: "כללי" }], "a", "קליפ"); return s.before["$"].song.open === 100 && s.after["$"].clip.open === 100 && !s.before["₪"]; })());
  reset({ transactions: [] });
  await FIN.createTransactionRecord({ projectId: "p1", scope: "project", type: "income", amount: 3500, currency: "₪", paymentStatus: "התקבל", expenseScope: "קליפ" });
  await FIN.createTransactionRecord({ scope: "general", type: "income", amount: 10, currency: "₪", expenseScope: "קליפ" });
  await FIN.createTransactionRecord({ projectId: "p1", scope: "project", type: "income", amount: 10, currency: "₪", expenseScope: "שיווק" });
  ok("the writer: project income may be קליפ; general income / any other income scope stays כללי", JSON.stringify(T("transactions").map((t) => t.expense_scope)) === JSON.stringify(["קליפ", "כללי", "כללי"]), T("transactions").map((t) => t.expense_scope));

  // ── 6. legacy drawer never resets an income's scope ─────────────────────────────────────────────────────────────
  section("6. Legacy ProjectDrawer edit never resets clip income scope");
  ok("txEditScopePatch: income → no scope sent; expense → its scope (default כללי)", JSON.stringify(PURE.txEditScopePatch("income", "קליפ")) === "{}" && JSON.stringify(PURE.txEditScopePatch("income", "")) === "{}" && PURE.txEditScopePatch("expense", "")?.expenseScope === "כללי" && PURE.txEditScopePatch("expense", "קליפ")?.expenseScope === "קליפ");
  const drawer = read("components/ui/ProjectDrawer.tsx");
  ok("the drawer's edit body uses txEditScopePatch (the old ': \"כללי\"' income reset is gone)", /\.\.\.txEditScopePatch\(editTxDraft\.type, editTxDraft\.expenseScope\)/.test(drawer) && !/expenseScope:\s+editTxDraft\.type === "expense" \? \(editTxDraft\.expenseScope \|\| "כללי"\) : "כללי"/.test(drawer));

  // ── 7. client_source from classification ────────────────────────────────────────────────────────────────────────
  section("7. Red Films client_source from the project classification");
  ok("pure mapping: לייבל → פנימי - לייבל, לקוח → לקוח חיצוני, none → the screens' default", PURE.rfClientSourceFor({ businessType: "לייבל" }) === "פנימי - לייבל" && PURE.rfClientSourceFor({ businessType: "לקוח" }) === "לקוח חיצוני" && PURE.rfClientSourceFor(null) === "פנימי - לייבל" && PURE.rfClientSourceFor({ businessType: "" }) === "פנימי - לייבל");
  ok("the vocabulary is pinned to the Red Films screens", PURE.RF_CLIENT_SOURCES.every((s) => read("components/red-films/RedFilmsStatusBadge.tsx").includes(`"${s}"`)));
  reset({ projects: [{ id: "pc", project_business_type: "לקוח" }, { id: "pl", project_business_type: "לייבל" }], red_films_productions: [] });
  const c1 = await RF.createProduction({ title: "א", project_id: "pc" }), c2 = await RF.createProduction({ title: "ב", project_id: "pl" }), c3 = await RF.createProduction({ title: "ג" }), c4 = await RF.createProduction({ title: "ד", project_id: "pc", client_source: "פרויקט שיווקי" });
  ok("createProduction: client → לקוח חיצוני, label → פנימי - לייבל, no project → default, explicit valid value kept", c1.client_source === "לקוח חיצוני" && c2.client_source === "פנימי - לייבל" && c3.client_source === "פנימי - לייבל" && c4.client_source === "פרויקט שיווקי");
  ok("no writer hard-codes client_source \"פנימי - לייבל\" any more", !/client_source: "פנימי - לייבל"/.test(read("lib/writes/clip.ts") + read("lib/writes/redfilms.ts")));

  // ── 8. promote keeps the linked row; planned excludes it; status vocabulary ─────────────────────────────────────
  section("8. Promote provenance + clip status vocabulary");
  reset({ clip_items: [{ id: "k1", project_id: "p1", category: "תאורה", description: "פנסים", amount: 600, currency: "₪", status: "תכנון בלבד", notes: "", linked_transaction_id: null }], transactions: [] });
  const pr = await RF.promoteClipItem("k1", "2026-09-26");
  const kept = T("clip_items")[0];
  ok("promote creates ONE unpaid קליפ expense and KEEPS the row — הועבר לכספים, linked to the expense", pr.kind === "ok" && T("transactions").length === 1 && T("transactions")[0].expense_scope === "קליפ" && T("transactions")[0].payment_status === "לא שולם" && !!kept && kept.status === "הועבר לכספים" && kept.linked_transaction_id === T("transactions")[0].id && !log.includes("delete:clip_items"), { pr, kept, log });
  ok("a second promote creates nothing (already_promoted)", (await RF.promoteClipItem("k1", "2026-09-26")).kind === "already_promoted" && T("transactions").length === 1);
  ok("planned = unlinked rows only (the ONE rule); promoted rows are provenance", !PURE.isClipItemPlanned(kept) && PURE.isClipItemPromoted(kept) && PURE.isClipItemPlanned({ status: "תכנון בלבד", linked_transaction_id: null }) && !PURE.isClipItemPlanned({ status: "בוטל" }) && !PURE.isClipItemPlanned({ status: "שולם", linked_transaction_id: "t" }));
  ok("Sunny's project video counts only the unlinked row as planned (₪400, not ₪1300) and marks the linked row promoted", pvA.planning.plannedByCurrency["₪"] === 400 && pvA.planning.rows.some((r) => r.promoted && r.transferred));
  ok("the drawer strip, the operations capability, the project view and Sunny all use isClipItemPlanned", /isClipItemPlanned\(/.test(drawer) && /isClipItemPlanned\(/.test(read("lib/partner/knowledge/capabilities/operations.ts")) && /isClipItemPlanned\(/.test(read("lib/partner/projects/view.ts")) && /isClipItemPlanned\(/.test(read("lib/partner/redfilms/view.ts")) && /data\.clipItem/.test(drawer));
  let bad = "";
  try { await RF.updateClipItem("k1", { status: "משהו" }); } catch (e) { bad = e instanceof RF.RfInputError ? e.message : "other"; }
  await RF.updateClipItem("k1", { notes: "x" });
  ok("updateClipItem validates status against the drawer vocabulary (400 from the route); other edits pass", /סטטוס לא תקין/.test(bad) && /RfInputError\) return NextResponse\.json\(\{ error: err\.message \}, \{ status: 400 \}\)/.test(read("app/api/clip-items/[id]/route.ts")));
  ok("CLIP_ITEM_STATUSES = the drawer's status colours (pinned)", PURE.CLIP_ITEM_STATUSES.every((s) => new RegExp(`"${s}":\\s+"#`).test(drawer)));
  ok("a promoted clip expense can be corrected in Finance (amount / currency / description / category) but never deleted there", (() => { return true; })() && (await import("../lib/finance/ownership")).transactionEditVerdict("CLIP_ROW", ["amount", "currency"]).ok === true && (await import("../lib/finance/ownership")).transactionEditVerdict("CLIP_ROW", "delete").ok === false);

  // ── 9. leftovers ─────────────────────────────────────────────────────────────────────────────────────────────────
  section("9. Leftovers from earlier phases");
  reset({ transactions: [{ id: "t1", project_id: "p1", type: "expense", payment_status: "לא שולם" }, { id: "t2", project_id: "p1", type: "expense", payment_status: "לא שולם" }], clip_items: [{ id: "a", linked_transaction_id: "t1", status: "הועבר לכספים" }, { id: "b", linked_transaction_id: "t2", status: "הועבר לכספים" }] });
  await FIN.updateTransactionRecord("t1", { paymentStatus: "התקבל" });
  await FIN.updateTransactionRecord("t2", { paymentStatus: "שולם" });
  await tick();
  ok("the clip row is marked שולם only for ACTUAL money (an expense 'התקבל' is not paid — isActualMoneyTx)", T("clip_items")[0].status === "הועבר לכספים" && T("clip_items")[1].status === "שולם");
  reset({ settings: [{ key: "finance_p1", value: { clipAgreedPrice: 3000, clipProductionId: "rf1", agreedPrice: 5 } }] });
  await FIN.setFinanceSettings("p1", { agreedPrice: 7000, currency: "$" });
  ok("setFinanceSettings merges with compare-and-swap (the clip price / marker survive)", JSON.stringify(T("settings")[0].value) === JSON.stringify({ clipAgreedPrice: 3000, clipProductionId: "rf1", agreedPrice: 7000, currency: "$" }) && log.includes("update:settings(cas)"), T("settings")[0].value);
  ok("proposal conversion writes finance_<id> through mergeSettingsKey (never a blind upsert)", /mergeSettingsKey\(`finance_\$\{project\.id\}`/.test(read("lib/writes/proposals.ts")) && !/from\("settings"\)\.upsert\(\{ key: `finance_\$\{project\.id\}`/.test(read("lib/writes/proposals.ts")));
  ok("Finance page: the received count uses isReceivedStatus (no literal set)", /isReceivedStatus\(t\.payment_status\)/.test(read("components/finance/FinancePage.tsx")) && !/\["שולם", "התקבל"\]\.includes/.test(read("components/finance/FinancePage.tsx")));
  ok("social promotions: planned totals per currency (only ₪ compared with the ₪ budget)", /plannedByCur/.test(read("components/social/SocialPromotions.tsx")) && /plannedTotal  = plannedByCur\["₪"\]/.test(read("components/social/SocialPromotions.tsx")));
  const af = read("components/album/AlbumFinanceTab.tsx"), ao = read("components/album/AlbumOverviewTab.tsx");
  ok("album finance / overview: a refused transaction PATCH / DELETE (owned-row 409) is surfaced with the server message", (af.match(/if \(!res\.ok\) \{ const d = await res\.json\(\)\.catch\(\(\) => \(\{\}\)\); setTxErr\(d\.error/g) ?? []).length === 2 && (ao.match(/if \(!res\.ok\) \{ const d = await res\.json\(\)\.catch\(\(\) => \(\{\}\)\); setModalTxErr\(d\.error/g) ?? []).length === 2 && /\{txErr\}/.test(af) && /\{modalTxErr\}/.test(ao));
  ok("the unused RECEIVED literal set is gone from the finance primitives", !/const RECEIVED = new Set/.test(read("lib/partner/act/primitives/finance.ts")));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
