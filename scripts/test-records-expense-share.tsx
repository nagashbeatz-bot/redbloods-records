/**
 * Records ↔ artist expense share (Owner decision 2026-09-28, task 6): the ONE rule (lib/records-expense-share), its
 * writer (lib/writes/artist-expense-share) on an in-memory database, the Owner rule for project classification
 * (lib/project-classification), the label page de-duplication and the wiring. No production, no network, no push.
 * Run with:   npx tsx scripts/test-records-expense-share.tsx
 */
import Module from "node:module";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: unknown) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 700)}` : ""}`); } };
const read = (p: string) => fs.readFileSync(path.resolve(__dirname, "..", p), "utf8");

type Row = Record<string, unknown>;
const DB: Record<string, Row[]> = {};
const t = (name: string) => (DB[name] ??= []);
const failNext: Record<string, string | null> = {};
function from(table: string) {
  const filters: Array<(r: Row) => boolean> = [];
  let mode: "select" | "update" | "delete" | "insert" = "select", patch: Row | null = null, ins: Row | null = null, one: "single" | "maybe" | null = null, lim: number | null = null;
  const run = () => {
    if (mode === "insert") {
      if (failNext[table]) { const m = failNext[table]; failNext[table] = null; return { data: null, error: { message: m, code: "XX000" }, count: null }; }
      if (table === "artist_balance_entries" && ins!.source_tx_id && t(table).some((r) => r.source_tx_id === ins!.source_tx_id)) return { data: null, error: { message: "duplicate key", code: "23505" }, count: null };
      // the DB key (2026-09-28): artist_balance_entries_expense_share_uk (source_expense_tx_id, artist_id)
      if (table === "artist_balance_entries" && ins!.source_expense_tx_id && t(table).some((r) => r.source_expense_tx_id === ins!.source_expense_tx_id && r.artist_id === ins!.artist_id)) return { data: null, error: { message: "duplicate key", code: "23505" }, count: null };
      const r = { id: randomUUID(), ...ins }; t(table).push(r); return { data: one ? { ...r } : [{ ...r }], error: null, count: null };
    }
    let rows = t(table).filter((r) => filters.every((f) => f(r)));
    if (mode === "update") { for (const r of rows) Object.assign(r, patch); }
    if (mode === "delete") { DB[table] = t(table).filter((r) => !rows.includes(r)); }
    if (lim !== null) rows = rows.slice(0, lim);
    const data = rows.map((r) => ({ ...r }));
    return { data: one ? data[0] ?? null : data, error: null, count: data.length };
  };
  const c: Record<string, unknown> = {
    select() { return c; },
    eq(k: string, v: unknown) { filters.push((r) => r[k] === v); return c; },
    in(k: string, vs: unknown[]) { filters.push((r) => vs.includes(r[k])); return c; },
    is(k: string, v: unknown) { filters.push((r) => (r[k] ?? null) === v); return c; },
    like(k: string, pat: string) { const re = new RegExp("^" + pat.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*") + "$", "s"); filters.push((r) => re.test(String(r[k] ?? ""))); return c; },
    limit(n: number) { lim = n; return c; },
    single() { one = "single"; return Promise.resolve(run()); },
    maybeSingle() { one = "maybe"; return Promise.resolve(run()); },
    then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) { return Promise.resolve(run()).then(res, rej); },
  };
  return { select: () => c, insert(r: Row) { mode = "insert"; ins = r; return c; }, update(p: Row) { mode = "update"; patch = p; return c; }, delete() { mode = "delete"; return c; } };
}
const ML = Module as unknown as { _load(request: string, parent: unknown, isMain: boolean): unknown };
const orig = ML._load;
ML._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === "server-only") return {};
  if (/(^|\/)supabase$/.test(request)) return { supabase: { from } };
  return orig.call(this, request, parent, isMain);
};

const SHALEV = "8806fe5e-1238-4228-8078-b3db3ccc9b46", AVI = "b3499c72-069d-46c9-9c31-52b1db27c51f";
const BALAGAN = "92d7c2cf-c521-4cf4-90ac-9cb9afd86f9a";

(async () => {
  const R = await import("../lib/records-expense-share");
  const PC = await import("../lib/project-classification");
  const W = await import("../lib/writes/artist-expense-share");
  const ex = (amount: number, o: Record<string, unknown> = {}) => ({ id: randomUUID(), type: "expense", amount, currency: "₪", paymentStatus: "שולם", businessUnit: "RECORDS", expenseScope: "קליפ", category: "", projectId: "p", ...o });
  const share = (amount: number, artistText: string | null, o: Record<string, unknown> = {}) => R.expenseShareOf(ex(amount, o), artistText === null ? null : { artistText });
  const amt = (s: ReturnType<typeof share>, id: string) => (s.status === "DEFINED" ? s.artists.find((a) => a.artistId === id)?.amount ?? 0 : null);

  console.log("The rule (lib/records-expense-share)");
  const s1 = share(1000, "שליו טסמה");
  ok("1. Shalev alone, 1,000 → Records 500 / Shalev 500", s1.status === "DEFINED" && s1.recordsAmount === 500 && amt(s1, SHALEV) === 500 && s1.kind === "SINGLE_RECORDS_ARTIST", s1);
  const s2 = share(1000, "אבי מולה");
  ok("2. Avi alone, 1,000 → Records 500 / Avi 500", s2.status === "DEFINED" && s2.recordsAmount === 500 && amt(s2, AVI) === 500, s2);
  const s3 = share(4000, "שליו טסמה, אבי מולה");
  ok("3. Shalev + Avi, 4,000 → Records 2,000 / Shalev 1,000 / Avi 1,000", s3.status === "DEFINED" && s3.recordsAmount === 2000 && amt(s3, SHALEV) === 1000 && amt(s3, AVI) === 1000 && s3.kind === "TWO_RECORDS_ARTISTS", s3);
  const s4 = share(4000, "נגש ביטס, שליו טסמה");
  ok("4. NagashBeatz + Shalev, 4,000 → Records 4,000 / Shalev 0", s4.status === "DEFINED" && s4.kind === "NAGASHBEATZ" && s4.recordsAmount === 4000 && s4.artists.length === 0, s4);
  const s5 = share(3000, "אבי מולה, נגש ביטס, שליו טסמה");
  const s5b = share(3000, "NagashBeatz, אבי מולה");
  ok("5. NagashBeatz + Avi + Shalev (any order / brand spelling) → 100 % Records", s5.status === "DEFINED" && s5.recordsAmount === 3000 && s5.artists.length === 0 && s5b.status === "DEFINED" && s5b.kind === "NAGASHBEATZ");
  const s6 = share(1000, "טל צגאי, אבי מולה");
  const s6b = share(1000, "אבי מולה, טל צגאי");
  ok("6. external host + Avi guest (either order) → no automatic split (UNDEFINED EXTERNAL_PARTY)", s6.status === "UNDEFINED" && s6.reason === "EXTERNAL_PARTY" && s6b.status === "UNDEFINED", { s6, s6b });
  const s15 = share(700, null);
  const s15b = share(700, "");
  const s15c = share(700, "אמן חיצוני");
  ok("15. unknown ownership (no project / no credits / no Records artist) → UNDEFINED, never a guessed charge", s15.status === "UNDEFINED" && s15.reason === "NO_ARTIST_CONTEXT" && s15b.status === "UNDEFINED" && s15c.status === "UNDEFINED" && s15c.reason === "NO_RECORDS_ARTIST");
  ok("   the artists together never carry more than 50 % by default", [s1, s2, s3].every((s) => s.status === "DEFINED" && s.artists.reduce((x, a) => x + a.amount, 0) <= s.amount / 2 + 0.001));
  const acum = R.expenseShareOf({ ...ex(400, { expenseScope: "כללי", projectId: null }), id: "d4f6ca0f-98a6-4d3d-945d-d749fda5c6af" }, null);
  ok("8. ACUM 400 → 100 % Shalev (Owner exception, wins over the rule)", acum.status === "DEFINED" && acum.basis === "OWNER_EXCEPTION" && amt(acum, SHALEV) === 400 && acum.recordsAmount === 0, acum);
  const yt = ["71356ad5-a483-4d9d-a667-a9b570c71272", "baef9740-6ec7-4b0a-beed-b28c41e242c9", "fc12a6f8-69e5-4be8-a803-fa530385ecf6"].map((id) => R.expenseShareOf({ ...ex(100, { expenseScope: "שיווק" }), id }, { artistText: "שליו טסמה" }));
  ok("9. Principe YouTube 3 × 100 → 100 % Records, no Shalev part (Owner exception)", yt.every((s) => s.status === "DEFINED" && s.recordsAmount === 100 && s.artists.length === 0 && s.basis === "OWNER_EXCEPTION"), yt);
  const lump = R.expenseShareOf({ ...ex(1200), id: "87c05b43-070a-4a5a-b6e6-c52ac1bb5c85" }, { artistText: "שליו טסמה" });
  ok("   Principe clip rows → recorded once in the Owner's ₪2,480 row (no per-row share, no double count)", lump.status === "RECORDED_ELSEWHERE" && lump.ledgerEntryId === "14c924ec-277b-42d6-8a74-d0170271a569");
  const s10 = share(4000, "שליו טסמה");
  ok("10. Records clip expense → the Finance amount stays the full 4,000; the artist gets only 2,000", s10.status === "DEFINED" && s10.amount === 4000 && amt(s10, SHALEV) === 2000);
  ok("16. business_unit and the share are independent: a non-RECORDS expense is NOT an artist expense; the rule never returns a unit", share(1000, "שליו טסמה", { businessUnit: "STUDIO" }).status === "NOT_APPLICABLE" && [s1, s3, s4, s6].every((x) => !/"(unit|businessUnit|business_unit)"/.test(JSON.stringify(x))) && !/business_unit/.test(read("lib/writes/artist-expense-share.ts").replace(/select\("[^"]*"\)/g, "").replace(/businessUnit: tx\.business_unit/g, "")));
  ok("   not artist expenses: show money (DJ / rehearsal), a payment to an artist, mix / master", share(500, "שליו טסמה", { expenseScope: "הופעה", category: "שכר דיג'יי" }).status === "NOT_APPLICABLE" && share(500, "שליו טסמה", { showId: "s1" }).status === "NOT_APPLICABLE" && share(500, "שליו טסמה", { category: "שכר אמן", expenseScope: "כללי" }).status === "NOT_APPLICABLE" && share(500, "שליו טסמה", { expenseScope: "מיקס / מאסטר" }).status === "NOT_APPLICABLE");
  ok("   a non-₪ expense is never converted into the ₪ ledger (UNDEFINED NOT_ILS)", share(100, "שליו טסמה", { currency: "$" }).status === "UNDEFINED");

  console.log("\nThe Owner rule for classification (lib/project-classification)");
  const map = PC.rosterIdByNameOf([{ id: SHALEV, name: "שליו טסמה" }, { id: AVI, name: "אבי מולה" }, { id: "nb", name: "נגש ביטס" }]);
  ok("7a. Balagan (טל צגאי, אבי מולה) → no Owner rule (guest at an external host) → no MISMATCH_OWNER_RULE while stored לקוח", PC.ownerRuleClassification("טל צגאי, אבי מולה", map) === null && PC.classificationSignal({ businessType: "לקוח", artistText: "טל צגאי, אבי מולה" }, map) === null);
  ok("   Records artist(s) alone / together → לייבל; NagashBeatz (Dancehall School, פשע, פפארצי) → לייבל", PC.ownerRuleClassification("שליו טסמה", map) === "לייבל" && PC.ownerRuleClassification("שליו טסמה, אבי מולה", map) === "לייבל" && PC.ownerRuleClassification("נגש ביטס", map) === "לייבל" && PC.ownerRuleClassification("נגש ביטס, שליו טסמה, ליל גטי, חיים טסאו", map) === "לייבל");
  ok("   a client that only came through the NagashBeatz brand (not credited) → no rule", PC.ownerRuleClassification("לקוח חיצוני", map) === null && PC.businessTypeForNewProject("לקוח חיצוני", map) === "לקוח");
  ok("   a stored לקוח Records-only project still raises the mismatch signal (Owner-clicked fix only)", PC.classificationSignal({ businessType: "לקוח", artistText: "שליו טסמה" }, map)?.code === "MISMATCH_OWNER_RULE");

  console.log("\nThe writer (lib/writes/artist-expense-share) — idempotent, never deletes");
  t("projects").push({ id: "p-shalev", artist: "שליו טסמה" }, { id: "p-duo", artist: "שליו טסמה, אבי מולה" }, { id: BALAGAN, artist: "טל צגאי, אבי מולה" }, { id: "p-nb", artist: "נגש ביטס, שליו טסמה" });
  const tx = (id: string, o: Row) => { t("transactions").push({ id, type: "expense", amount: 1000, currency: "₪", payment_status: "שולם", business_unit: "RECORDS", category: "קידום", expense_scope: "שיווק", show_id: null, show_money_role: null, project_id: "p-shalev", date: "2026-10-01", description: "קידום", ...o }); return id; };
  const shareRows = (txId: string) => t("artist_balance_entries").filter((r) => r.source_expense_tx_id === txId || r.source_tx_id === txId || String(r.note ?? "").includes(`tx:${txId}]`));
  const promo = tx(randomUUID(), {});
  const w1 = await W.syncExpenseShare(promo);
  ok("12a. a new paid Records promotion 1,000 (Shalev) → ONE ledger expense 500, linked by the DB key source_expense_tx_id (no note marker); Finance untouched", w1.status === "DEFINED" && shareRows(promo).length === 1 && shareRows(promo)[0].amount === 500 && shareRows(promo)[0].entry_type === "הוצאות" && shareRows(promo)[0].source_expense_tx_id === promo && !String(shareRows(promo)[0].note).includes("tx:") && t("transactions").find((r) => r.id === promo)!.amount === 1000, { w1, rows: shareRows(promo) });
  await W.syncExpenseShare(promo); await W.syncExpenseShare(promo);
  ok("14. the same transaction processed again (×2) → still ONE ledger row", shareRows(promo).length === 1 && shareRows(promo)[0].amount === 500);
  Object.assign(t("transactions").find((r) => r.id === promo)!, { amount: 800 });
  const w2 = await W.syncExpenseShare(promo);
  ok("12. edit the expense 1,000 → 800 → the SAME row becomes 400 (no new row)", shareRows(promo).length === 1 && shareRows(promo)[0].amount === 400 && w2.rows[0].action === "UPDATED");
  const rowId = shareRows(promo)[0].id;
  Object.assign(t("transactions").find((r) => r.id === promo)!, { payment_status: "בוטל" });
  await W.syncExpenseShare(promo);
  const cancelled = shareRows(promo)[0];
  ok("13. cancelled expense → the row stops counting: KEPT (same id), amount 0, the note says why + what it was", shareRows(promo).length === 1 && cancelled.id === rowId && cancelled.amount === 0 && /\[חלק הוצאה לא פעיל\]/.test(String(cancelled.note)) && /היה ₪400/.test(String(cancelled.note)));
  Object.assign(t("transactions").find((r) => r.id === promo)!, { payment_status: "שולם" });
  await W.syncExpenseShare(promo);
  ok("   paid again → the SAME row is active again (400), the inactive note cleared", shareRows(promo).length === 1 && shareRows(promo)[0].id === rowId && shareRows(promo)[0].amount === 400 && !/לא פעיל/.test(String(shareRows(promo)[0].note)));
  DB.transactions = t("transactions").filter((r) => r.id !== promo);
  const gone = await W.syncExpenseShare(promo);
  ok("   a deleted Finance expense → its share row kept at 0 (never deleted)", gone.status === "TX_MISSING" && shareRows(promo).length === 1 && shareRows(promo)[0].amount === 0);
  const duo = tx(randomUUID(), { amount: 4000, project_id: "p-duo", expense_scope: "קליפ" });
  await W.syncExpenseShare(duo); await W.syncExpenseShare(duo);
  ok("3w. Shalev + Avi clip 4,000 → two rows (Shalev 1,000 + Avi 1,000), BOTH keyed by source_expense_tx_id — once each after two syncs", shareRows(duo).length === 2 && shareRows(duo).find((r) => r.artist_id === SHALEV)?.amount === 1000 && shareRows(duo).find((r) => r.artist_id === AVI)?.amount === 1000 && shareRows(duo).every((r) => r.source_expense_tx_id === duo));
  const bal = tx(randomUUID(), { project_id: BALAGAN });
  await W.syncExpenseShare(bal);
  ok("7. a Records expense on Balagan (external host + Avi) → NO automatic Avi share written", shareRows(bal).length === 0);
  const nb = tx(randomUUID(), { project_id: "p-nb" });
  await W.syncExpenseShare(nb);
  ok("4w. NagashBeatz project expense → no artist row", shareRows(nb).length === 0);
  const noProj = tx(randomUUID(), { project_id: null });
  await W.syncExpenseShare(noProj);
  ok("15w. no project → nothing written (no guessed charge)", shareRows(noProj).length === 0);
  const expected = tx(randomUUID(), { payment_status: "צפוי" });
  await W.syncExpenseShare(expected);
  ok("   an expected (unpaid) expense → nothing written until it is paid", shareRows(expected).length === 0);
  // the Owner's own row linked by source_tx_id (ACUM) is adopted, never duplicated
  const ACUM = "d4f6ca0f-98a6-4d3d-945d-d749fda5c6af";
  tx(ACUM, { amount: 400, project_id: null, expense_scope: "כללי", category: "רישום זכויות", date: "2026-09-27" });
  t("artist_balance_entries").push({ id: "f157", artist_id: SHALEV, entry_type: "הוצאות", amount: 400, entry_date: "2026-09-27", description: "רישום לאקו\"ם", note: "", source_tx_id: ACUM, source_expense_tx_id: ACUM }); // as backfilled in production
  const wa = await W.syncExpenseShare(ACUM);
  ok("8w. ACUM: the Owner's existing 400 row is adopted (UNCHANGED) — no second row", wa.rows.length === 1 && wa.rows[0].action === "UNCHANGED" && shareRows(ACUM).length === 1);
  // a failed ledger insert never touches Finance; the next sync completes it
  const flaky = tx(randomUUID(), {});
  failNext.artist_balance_entries = "network down";
  const bad = await W.syncExpenseShareSafe(flaky);
  ok("   ledger write fails → the Finance row stays, the safe sync returns null (logged; the reconciliation reports it)", bad === null && t("transactions").some((r) => r.id === flaky) && shareRows(flaky).length === 0);
  await W.syncExpenseShareSafe(flaky);
  ok("   the next sync completes it (one row)", shareRows(flaky).length === 1 && shareRows(flaky)[0].amount === 500);
  // the project credits change → the shares follow (Shalev → Shalev + Avi)
  const moved = tx(randomUUID(), { project_id: "p-move", amount: 2000 });
  t("projects").push({ id: "p-move", artist: "שליו טסמה" });
  await W.syncExpenseShare(moved);
  Object.assign(t("projects").find((r) => r.id === "p-move")!, { artist: "שליו טסמה, אבי מולה" });
  await W.syncProjectExpenseShares("p-move");
  ok("   credits change (Shalev → Shalev + Avi) → Shalev's row 1,000 → 500, Avi 500 added", shareRows(moved).find((r) => r.artist_id === SHALEV)?.amount === 500 && shareRows(moved).find((r) => r.artist_id === AVI)?.amount === 500 && shareRows(moved).length === 2);

  console.log("\nReconciliation (Finance ↔ ledger)");
  const txs = t("transactions").map((r) => ({ id: String(r.id), type: String(r.type), amount: r.amount, currency: String(r.currency), paymentStatus: String(r.payment_status), businessUnit: r.business_unit as string, category: r.category as string, expenseScope: r.expense_scope as string, showId: null, showMoneyRole: null, projectId: (r.project_id as string) ?? null }));
  const artistText = (id: string) => (t("projects").find((p) => p.id === id)?.artist as string) ?? null;
  const ledger: import("../lib/records-expense-share").ShareLedgerRow[] = t("artist_balance_entries").map((r) => ({ id: String(r.id), artistId: String(r.artist_id), entryType: String(r.entry_type), amount: r.amount, sourceTxId: (r.source_tx_id as string) ?? null, note: (r.note as string) ?? null, sourceExpenseTxId: (r.source_expense_tx_id as string) ?? null }));
  const rec = R.reconcileExpenseShares({ transactions: txs, projectArtistText: artistText, ledger });
  ok("   in step → no MISSING / MISMATCH / DUPLICATE; the Balagan + no-project expenses are UNDEFINED (for the Owner)", !rec.findings.some((f) => f.code !== "SHARE_UNDEFINED") && rec.findings.filter((f) => f.code === "SHARE_UNDEFINED").length === 2, rec.findings);
  ledger.push({ id: "dup", artistId: SHALEV, entryType: "הוצאות", amount: 1000, sourceTxId: null, note: `[חלק הוצאה tx:${duo}]` });
  const rec2 = R.reconcileExpenseShares({ transactions: txs, projectArtistText: artistText, ledger });
  ok("   a duplicate share row is detected", rec2.findings.some((f) => f.code === "SHARE_DUPLICATE" && f.transactionId === duo));

  console.log("\nClip double count (11) + the label page");
  const lc = read("lib/label-clips.ts"), lp = read("components/label/LabelPage.tsx");
  ok("11. the label clip money never reads clip_items (planning); a promoted item is its Finance transaction, counted once when paid", !/clip_items/.test(lc) && /isExpenseFullyPaidStatus/.test(lc));
  ok("11b. each Finance transaction is counted once: per artist (uniqueShareTransactions) and across artists (the page sums by txId; a production shared by two artists is kept once)", /uniqueShareTransactions/.test(lc) && /byTx\.get\(x\.txId\)/.test(lp) && /byProd\.get\(c\.id\)/.test(lp) && !/x\.cashOut \+= a\.cashOut/.test(lp));
  ok("   the split on the label page / Sunny is the ONE rule (expenseShareOf), not a second 50 / 50", /expenseShareOf\(/.test(lc) && /expenseShareOf\(/.test(read("lib/partner/label/view.ts")) && !/allocatePaidCost/.test(lc + read("lib/partner/label/view.ts") + read("lib/label-agreements.ts")));

  console.log("\nWiring — every Records expense writer syncs the share");
  const fin = read("lib/writes/finance.ts");
  ok("   Finance create / edit / delete, the unit choice, Red Films payments, promotions, clip promote, a project credit change", (fin.match(/syncExpenseShareSafe\(/g) ?? []).length >= 3 && /syncExpenseShareSafe/.test(read("lib/writes/business-unit.ts")) && /syncShare: false/.test(read("lib/writes/rf-finance-link.ts")) && /syncExpenseShareSafe/.test(read("lib/writes/rf-finance-link.ts")) && (read("lib/social-promotions-store.ts").match(/syncExpenseShareSafe/g) ?? []).length >= 3 && /syncExpenseShareSafe/.test(read("lib/writes/redfilms.ts")) && /syncProjectExpenseShares/.test(read("lib/writes/projects.ts")) && (read("app/api/projects/[id]/route.ts").match(/syncProjectExpenseShares/g) ?? []).length === 2);
  ok("   the writer never deletes a ledger row and never writes Finance", !/\.delete\(\)/.test(read("lib/writes/artist-expense-share.ts")) && !/from\("transactions"\)\.(update|insert|delete)/.test(read("lib/writes/artist-expense-share.ts")));
  ok("19. no Push anywhere in the share rule / writer", !/sendPush|lib\/push|web-push/.test(read("lib/records-expense-share.ts") + read("lib/writes/artist-expense-share.ts")));
  ok("20. cycles untouched (the writer never reads / writes artist_balance_cycles)", !/artist_balance_cycles/.test(read("lib/writes/artist-expense-share.ts") + read("lib/records-expense-share.ts")));
  ok("18. Pacha / Summer Time (1,000 + 810) are not in the expense-share exceptions (artist payments, task 5 — untouched)", !Object.keys(R.EXPENSE_SHARE_EXCEPTIONS).some((k) => k.startsWith("e012d6d4") || k.startsWith("937031f5")));

  console.log("\nSunny (capability expense_shares — the same rule, no second formula)");
  const { expenseShares } = await import("../lib/partner/knowledge/capabilities/finance");
  const rule = (artists: string) => (expenseShares.read({} as never, { capability: "expense_shares", mode: "rule", params: { artists } } as never) as { items: Array<{ fields: Record<string, unknown> }> }).items[0].fields;
  ok("   'מי משלם על קליפ של שליו?' → 50 / 50", rule("שליו טסמה").recordsPct === 50 && (rule("שליו טסמה").artists as Array<{ pct: number }>)[0].pct === 50);
  ok("   'שליו ואבי ביחד?' → 50 Records / 25 / 25", rule("שליו טסמה, אבי מולה").recordsPct === 50 && (rule("שליו טסמה, אבי מולה").artists as Array<{ pct: number }>).every((a) => a.pct === 25));
  ok("   'NagashBeatz ושליו?' → 100 % Records", rule("נגש ביטס, שליו טסמה").recordsPct === 100 && (rule("נגש ביטס, שליו טסמה").artists as unknown[]).length === 0);
  ok("   'אבי מתארח אצל טל צגאי?' → no automatic split (UNDEFINED, needs an agreement)", rule("טל צגאי, אבי מולה").status === "UNDEFINED" && rule("טל צגאי, אבי מולה").reason === "EXTERNAL_PARTY");
  ok("   the capability reads the ONE module and is registered (catalog + FINANCE domain)", /expenseShareOf|projectSettlementRule/.test(read("lib/partner/knowledge/capabilities/finance.ts")) && /expenseShares/.test(read("lib/partner/knowledge/catalog.ts")) && /"expense_shares"/.test(read("lib/partner/system/registry.ts")));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
