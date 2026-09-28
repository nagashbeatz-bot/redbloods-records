/**
 * Final Finance / Records / artist settlement hardening (Owner decisions 2026-09-28). Pure rules + the real writers on an
 * in-memory database (no production, no network, no push): mix / master unit by project, Steven expense on completion,
 * Victor retainer, the income rule (distribution / YouTube / ACUM / NagashBeatz), the legacy artist-fee "paid" guard and
 * the concurrency convergence of artist payments and two-artist expense shares.
 * Run with:   npx tsx scripts/test-finance-hardening.tsx
 */
import Module from "node:module";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: unknown) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 600)}` : ""}`); } };
const read = (p: string) => fs.readFileSync(path.resolve(__dirname, "..", p), "utf8");

type Row = Record<string, unknown>;
const DB: Record<string, Row[]> = {};
const t = (name: string) => (DB[name] ??= []);
let clock = 0;
const stamp = () => new Date(Date.UTC(2026, 8, 28, 12, 0, clock++)).toISOString();
function from(table: string) {
  const filters: Array<(r: Row) => boolean> = [];
  let mode: "select" | "update" | "insert" = "select", patch: Row | null = null, ins: Row | null = null, one = false, lim: number | null = null;
  const run = () => {
    if (mode === "insert") {
      if (table === "artist_balance_entries" && ins!.source_tx_id && t(table).some((r) => r.source_tx_id === ins!.source_tx_id)) return { data: null, error: { message: "duplicate", code: "23505" } };
      const r = { id: randomUUID(), created_at: stamp(), ...ins }; t(table).push(r); return { data: one ? { ...r } : [{ ...r }], error: null };
    }
    let rows = t(table).filter((r) => filters.every((f) => f(r)));
    if (mode === "update") for (const r of rows) Object.assign(r, patch);
    if (lim !== null) rows = rows.slice(0, lim);
    const data = rows.map((r) => ({ ...r }));
    return { data: one ? data[0] ?? null : data, error: null };
  };
  const c: Record<string, unknown> = {
    select() { return c; },
    eq(k: string, v: unknown) { filters.push((r) => r[k] === v); return c; },
    in(k: string, vs: unknown[]) { filters.push((r) => vs.includes(r[k])); return c; },
    is(k: string, v: unknown) { filters.push((r) => (r[k] ?? null) === v); return c; },
    like(k: string, pat: string) { const re = new RegExp("^" + pat.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*") + "$", "s"); filters.push((r) => re.test(String(r[k] ?? ""))); return c; },
    limit(n: number) { lim = n; return c; },
    single() { one = true; return Promise.resolve(run()); },
    maybeSingle() { one = true; return Promise.resolve(run()); },
    then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) { return Promise.resolve(run()).then(res, rej); },
  };
  return { select: () => c, insert(r: Row) { mode = "insert"; ins = r; return c; }, update(p: Row) { mode = "update"; patch = p; return c; } };
}
const ML = Module as unknown as { _load(request: string, parent: unknown, isMain: boolean): unknown };
const orig = ML._load;
ML._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === "server-only") return {};
  if (/(^|\/)supabase$/.test(request)) return { supabase: { from } };
  return orig.call(this, request, parent, isMain);
};

const SHALEV = "8806fe5e-1238-4228-8078-b3db3ccc9b46", AVI = "b3499c72-069d-46c9-9c31-52b1db27c51f";

(async () => {
  const BU = await import("../lib/business-unit");
  const MP = await import("../lib/mix-payment-pure");
  const R = await import("../lib/records-expense-share");
  const OW = await import("../lib/finance/ownership");
  const AP = await import("../lib/writes/artist-payments");
  const ES = await import("../lib/writes/artist-expense-share");

  console.log("D. Mix / master — the PROJECT's business, 100 % business / 0 % artist");
  const mixUnit = (bt: string | null) => BU.inferBusinessUnit({ writer: "MIX", type: "expense", project: bt === undefined ? null : bt === null ? null : { businessType: bt } }).unit;
  ok("6. Records (label) project mix / master → RECORDS", mixUnit("לייבל") === "RECORDS");
  ok("7. Studio client project mix / master → STUDIO", mixUnit("לקוח") === "STUDIO");
  ok("   no project → 'דורש סיווג' (never guessed as Studio)", BU.inferBusinessUnit({ writer: "MIX", type: "expense" }).unit === null);
  ok("   a manual Finance mix expense follows the same rule (category מיקס / מאסטר)", BU.inferBusinessUnit({ writer: "FINANCE_MANUAL", type: "expense", category: "מיקס / מאסטר", project: { businessType: "לייבל" } }).unit === "RECORDS");
  const mixShare = R.expenseShareOf({ id: "m", type: "expense", amount: 650, currency: "₪", paymentStatus: "שולם", businessUnit: "RECORDS", category: "מיקס / מאסטר", expenseScope: "כללי", projectId: "p" }, { artistText: "שליו טסמה" });
  ok("6b. a RECORDS mix expense creates NO artist share (0 % artist)", mixShare.status === "NOT_APPLICABLE" && mixShare.reason === "MIX_MASTER");
  ok("   the mix writer passes the project's business type to the rule", /project_business_type/.test(read("lib/writes/mix.ts")) && /inferBusinessUnit\(\{ writer: "MIX", type: "expense", project:/.test(read("lib/writes/mix.ts")));

  console.log("\nE. Steven — per completed project, at the price set in advance");
  const W = (o: Partial<import("../lib/mix-payment-pure").ReconcileWork> = {}) => ({ id: "w", projectId: "p", engineerName: "Steven", workType: "מיקס + מאסטר", currency: "$", agreedPrice: 200, amountPaid: 0, paymentDate: null, status: "בתהליך", ...o });
  const CTX = { artist: "שליו טסמה", projectName: "שיר" };
  const mode = MP.engineerExpenseMode("Steven", true);
  ok("   Steven is EXPECTED_ON_COMPLETION even when the page sends skipFinanceSync", mode === "EXPECTED_ON_COMPLETION" && MP.engineerExpenseMode("Bill", true) === "PAYMENT_ONLY");
  ok("   open work → no expense", MP.decideEngineerExpense(W(), null, { mode, ...CTX }).kind === "NONE");
  const done = MP.decideEngineerExpense(W({ status: "אושר" }), null, { mode, ...CTX });
  ok("8/9. completed (אושר) → ONE expected expense 'לא שולם' at the work's own price ($200), no date", done.kind === "INSERT" && done.fields.payment_status === "לא שולם" && done.fields.amount === 200 && done.fields.currency === "$" && done.fields.date === null, done);
  const retry = MP.decideEngineerExpense(W({ status: "אושר" }), { id: "tx1", paymentStatus: "לא שולם", amount: 200, currency: "$", date: null }, { mode, ...CTX });
  ok("10. 'הושלם' again with the row linked → the SAME row (UPDATE), never a second insert", retry.kind === "UPDATE" && retry.txId === "tx1");
  const paid = MP.decideEngineerExpense(W({ status: "אושר", amountPaid: 200, paymentDate: "2026-10-01" }), { id: "tx1", paymentStatus: "לא שולם", amount: 200, currency: "$", date: null }, { mode, ...CTX });
  ok("11. paying Steven → the SAME row becomes 'שולם' with the payment date", paid.kind === "UPDATE" && paid.txId === "tx1" && paid.fields.payment_status === "שולם" && paid.fields.date === "2026-10-01");
  const noPrice = MP.decideEngineerExpense(W({ status: "אושר", agreedPrice: 0 }), null, { mode, ...CTX });
  ok("   completed without a price → no row, no guessed / default price", noPrice.kind === "NONE" && /לא מנחשים/.test(noPrice.kind === "NONE" ? noPrice.reasonHe : ""));
  ok("   a re-opened work keeps its expected row (never auto-deleted)", MP.decideEngineerExpense(W({ status: "בתהליך" }), { id: "tx1", paymentStatus: "לא שולם", amount: 200, currency: "$", date: null }, { mode, ...CTX }).kind === "NONE");
  ok("   the completion transition runs the one expense writer (idempotent via linked_transaction_id)", /reason: "work completed"/.test(read("lib/sound-engineer-store.ts")));
  const stevenUnit = BU.inferBusinessUnit({ writer: "MIX", type: "expense", project: { businessType: "לייבל" } });
  ok("8b. Steven on a Records project → RECORDS; on a client project → STUDIO", stevenUnit.unit === "RECORDS" && mixUnit("לקוח") === "STUDIO");

  console.log("\nF. Victor — the monthly retainer, 100 % STUDIO");
  ok("13. Victor retainer → STUDIO (writer VICTOR), whatever he worked on", BU.inferBusinessUnit({ writer: "VICTOR", type: "expense", project: { businessType: "לייבל" } }).unit === "STUDIO");
  const vw = read("lib/writes/victor.ts");
  ok("12. completing a Victor project writes no Finance expense (ownerPatchVictorWork never inserts a transaction)", !/ownerPatchVictorWork[\s\S]{0,2500}from\("transactions"\)\.insert/.test(vw.split("export async function recordVictorSalaryMonth")[0]));

  console.log("\nC / H / J. Records expenses — any real type, by the credits");
  const ex = (amount: number, scope: string, artistText: string) => R.expenseShareOf({ id: randomUUID(), type: "expense", amount, currency: "₪", paymentStatus: "שולם", businessUnit: "RECORDS", category: "", expenseScope: scope, projectId: "p" }, { artistText });
  const amt = (s: ReturnType<typeof ex>, id: string) => (s.status === "DEFINED" ? s.artists.find((a) => a.artistId === id)?.amount ?? 0 : null);
  ok("1. Shalev normal expense 1,000 → 500 / 500", amt(ex(1000, "שיווק", "שליו טסמה"), SHALEV) === 500);
  ok("2. Avi → 50 / 50", amt(ex(1000, "שיווק", "אבי מולה"), AVI) === 500);
  ok("3. Shalev + Avi 4,000 → 2,000 / 1,000 / 1,000", amt(ex(4000, "קליפ", "שליו טסמה, אבי מולה"), SHALEV) === 1000 && amt(ex(4000, "קליפ", "שליו טסמה, אבי מולה"), AVI) === 1000);
  ok("4/5. NagashBeatz (alone / with Shalev) → 100 % Records", (ex(1000, "קליפ", "נגש ביטס") as { recordsAmount: number }).recordsAmount === 1000 && (ex(1000, "קליפ", "נגש ביטס, שליו טסמה") as { artists: unknown[] }).artists.length === 0);
  ok("14. Records clip → RECORDS cash in full + the artist's share", amt(ex(3000, "קליפ", "שליו טסמה"), SHALEV) === 1500);
  ok("16/17/18. visual content / marketing / distribution cost → the same share", ["צילום", "שיווק", "הפצה", "כללי"].every((s) => amt(ex(600, s, "שליו טסמה"), SHALEV) === 300));
  ok("15. an external client clip → FILMS (with its external Red Films production)", BU.inferBusinessUnit({ writer: "CLIP_PAYMENT", type: "income", expenseScope: "קליפ", project: { businessType: "לקוח", hasExternalClipProduction: true } }).unit === "FILMS");
  ok("24. show expenses (DJ / rehearsal / show scope) never get the general 50 / 50 again", R.expenseShareOf({ id: "s", type: "expense", amount: 500, currency: "₪", paymentStatus: "שולם", businessUnit: "RECORDS", category: "שכר דיג'יי", expenseScope: "הופעה", projectId: null }, null).status === "NOT_APPLICABLE");

  console.log("\nK / L / M / N. Income — distribution 50 / 50, YouTube + ACUM 100 % Records");
  const inc = (kind: "DISTRIBUTION" | "YOUTUBE" | "ACUM", who: string) => R.incomeShareOf(kind, who);
  const d1 = inc("DISTRIBUTION", "שליו טסמה");
  ok("19. distribution income Shalev 2,000 → entitlement 1,000 (50 %), Records 1,000", d1.status === "DEFINED" && d1.recordsPct === 50 && d1.artists[0].pct === 50 && d1.artists[0].artistId === SHALEV);
  const d2 = inc("DISTRIBUTION", "שליו טסמה, אבי מולה");
  ok("20. distribution income Shalev + Avi → 25 % each", d2.status === "DEFINED" && d2.artists.every((a) => a.pct === 25) && d2.recordsPct === 50);
  ok("21. distribution with NagashBeatz present (or NagashBeatz alone) → 100 % Records", (inc("DISTRIBUTION", "נגש ביטס, שליו טסמה") as { recordsPct: number }).recordsPct === 100 && (inc("DISTRIBUTION", "נגש ביטס") as { recordsPct: number }).recordsPct === 100);
  ok("22. YouTube income (even a Shalev clip) → 100 % Records, no entitlement", (inc("YOUTUBE", "שליו טסמה") as { recordsPct: number; artists: unknown[] }).recordsPct === 100 && (inc("YOUTUBE", "שליו טסמה") as { artists: unknown[] }).artists.length === 0);
  ok("23. ACUM income → 100 % Records", (inc("ACUM", "שליו טסמה") as { recordsPct: number }).recordsPct === 100);
  ok("   the source text decides the kind (YouTube / אקו\"ם / anything else = distribution)", R.incomeKindOfSource("YouTube AdSense") === "YOUTUBE" && R.incomeKindOfSource("אקו\"ם") === "ACUM" && R.incomeKindOfSource("Mobile1") === "DISTRIBUTION");
  ok("   a media record's Records part by the rule (Mobile1 765.5 → 382.75; YouTube 500 → 500)", R.mediaLabelShareByRule("Mobile1", "שליו טסמה", 765.5) === 382.75 && R.mediaLabelShareByRule("YouTube", "שליו טסמה", 500) === 500);
  ok("   the media totals + the entry preview use the rule (the RPC's stored 50 / 50 stays history)", /mediaLabelShareByRule/.test(read("lib/media-income-store.ts")) && /mediaLabelShareByRule/.test(read("components/label/MediaModals.tsx")));

  console.log("\nQ. 'אמן ✓' = the money really went to the artist — one path");
  ok("   a legacy show ARTIST_FEE row can never be marked paid in Finance (the entitlement is not a payment)", !OW.transactionEditVerdict("ARTIST_FEE", ["paymentStatus"], "שולם").ok && OW.transactionEditVerdict("ARTIST_FEE", ["paymentStatus"], "בוטל").ok && OW.transactionEditVerdict("DJ_FEE", ["paymentStatus"], "שולם").ok);
  ok("   the Finance route + Sunny pass the next status to the same rule", /op\.paymentStatus/.test(read("lib/writes/finance.ts")) && /op\.paymentStatus/.test(read("lib/partner/act/primitives/finance.ts")));

  console.log("\nP / R. Real artist payments — once, partial allowed, race converges");
  t("label_artists").push({ id: SHALEV, name: "שליו טסמה" });
  const part = await AP.recordArtistPayment({ artistId: SHALEV, amount: 1000, date: "2026-10-01", idempotencyKey: "pay-1" });
  const payRows = () => t("transactions").filter((r) => r.linked_session_id === "artist_payment:pay-1");
  ok("25/26. a partial payment 1,000 (of a 2,500 balance) → ONE Finance expense + ONE ledger payment", part.kind === "ok" && payRows().length === 1 && t("artist_balance_entries").filter((r) => r.entry_type === "תשלומים" && r.source_tx_id === payRows()[0].id).length === 1);
  const again = await AP.recordArtistPayment({ artistId: SHALEV, amount: 1000, date: "2026-10-01", idempotencyKey: "pay-1" });
  ok("27. retry → the same rows (reused)", again.kind === "ok" && again.reused && payRows().length === 1);
  // a simultaneous second first-attempt: simulate the duplicate insert, then let each attempt converge
  const dup = { id: randomUUID(), created_at: stamp(), linked_session_id: "artist_payment:pay-1", payment_status: "שולם", notes: "", type: "expense", amount: 1000 };
  t("transactions").push(dup);
  const winner = await AP.convergeDuplicatePayment("artist_payment:pay-1", dup.id);
  ok("28. race: the later duplicate cancels ITSELF (בוטל + note, kept) and the earliest row wins", winner === payRows()[0].id && dup.payment_status === "בוטל" && /כפילות מקבילה/.test(String(dup.notes)) && t("transactions").some((r) => r.id === dup.id));
  const winnerKeep = await AP.convergeDuplicatePayment("artist_payment:pay-1", payRows()[0].id as string);
  ok("   the winner's own convergence changes nothing", winnerKeep === payRows()[0].id && payRows()[0].payment_status === "שולם");
  // a cancelled payment of the same key never absorbs a new real payment
  Object.assign(payRows()[0], { payment_status: "בוטל" });
  DB.artist_balance_entries = t("artist_balance_entries").filter((r) => r.source_tx_id !== payRows()[0].id);
  const re = await AP.recordArtistPayment({ artistId: SHALEV, amount: 1000, date: "2026-10-01", idempotencyKey: "pay-1", allowDuplicate: true });
  ok("   after the payment was cancelled, the same key records a NEW live payment (not the cancelled row)", re.kind === "ok" && !re.reused && payRows().filter((r) => r.payment_status === "שולם").length === 1);

  console.log("\nS. Two-artist expense share — retry / race never doubles a share");
  t("projects").push({ id: "duo", artist: "שליו טסמה, אבי מולה" });
  const tx = randomUUID();
  t("transactions").push({ id: tx, type: "expense", amount: 4000, currency: "₪", payment_status: "שולם", business_unit: "RECORDS", category: "", expense_scope: "קליפ", show_id: null, show_money_role: null, project_id: "duo", date: "2026-10-02", description: "קליפ" });
  await ES.syncExpenseShare(tx); await ES.syncExpenseShare(tx);
  const rows = (id: string) => t("artist_balance_entries").filter((r) => r.artist_id === id && String(r.note ?? "").includes(`tx:${tx}]`) || (r.artist_id === id && r.source_tx_id === tx));
  ok("29. retry → Shalev 1,000 + Avi 1,000, one row each", rows(SHALEV).length === 1 && rows(AVI).length === 1 && rows(AVI)[0].amount === 1000);
  const avi2 = { id: randomUUID(), created_at: stamp(), artist_id: AVI, entry_type: "הוצאות", amount: 1000, entry_date: "2026-10-02", description: "", note: `${R.expenseShareMarker(tx)} x`, source_tx_id: null };
  t("artist_balance_entries").push(avi2);
  const w2 = await ES.convergeDuplicateShare(tx, AVI, avi2.id);
  ok("   race: the later marker row is set to 0 with a note (kept); the earliest wins", w2 === rows(AVI)[0].id && avi2.amount === 0 && /כפילות מקבילה/.test(avi2.note));
  await ES.syncExpenseShare(tx);
  ok("   the next sync never revives the cancelled duplicate (still one active Avi row)", rows(AVI).filter((r) => Number(r.amount) !== 0).length === 1 && avi2.amount === 0);
  const rec = R.reconcileExpenseShares({ transactions: [{ id: tx, type: "expense", amount: 4000, currency: "₪", paymentStatus: "שולם", businessUnit: "RECORDS", category: "", expenseScope: "קליפ", projectId: "duo" }], projectArtistText: () => "שליו טסמה, אבי מולה", ledger: t("artist_balance_entries").map((r) => ({ id: String(r.id), artistId: String(r.artist_id), entryType: String(r.entry_type), amount: r.amount, sourceTxId: (r.source_tx_id as string) ?? null, note: (r.note as string) ?? null })) });
  ok("   the reconciliation does not count the cancelled duplicate", rec.findings.length === 0, rec.findings);

  console.log("\nU. Historical overrides remain");
  ok("30/32. ACUM 100 % Shalev, Principe YouTube 100 % Records, ISSA 250, Principe clip = the 2,480 row — unchanged", R.EXPENSE_SHARE_EXCEPTIONS["d4f6ca0f-98a6-4d3d-945d-d749fda5c6af"]?.kind === "ARTIST_100" && R.EXPENSE_SHARE_EXCEPTIONS["71356ad5-a483-4d9d-a667-a9b570c71272"]?.kind === "RECORDS_100" && R.EXPENSE_SHARE_EXCEPTIONS["8da01d3c-3750-4596-888a-ee2d4faf3335"]?.kind === "ARTIST_50" && R.EXPENSE_SHARE_EXCEPTIONS["87c05b43-070a-4a5a-b6e6-c52ac1bb5c85"]?.kind === "RECORDED_LUMP");
  ok("31. Balagan: a Records artist as a guest of an external host → no automatic share", R.expenseShareOf({ id: "b", type: "expense", amount: 100, currency: "₪", paymentStatus: "שולם", businessUnit: "RECORDS", expenseScope: "קליפ", projectId: "p" }, { artistText: "טל צגאי, אבי מולה" }).status === "UNDEFINED");
  const UB = await import("../lib/finance/unit-balance");
  ok("33. Pacha / Summer Time stay the explained exception (no ledger payment is ever made for them)", !!UB.EXPLAINED_ARTIST_PAYMENTS["e012d6d4-8dcf-42c7-925d-364964af18c2"] && !!UB.EXPLAINED_ARTIST_PAYMENTS["937031f5-9e22-4fce-91f7-77a2596f3503"]);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
