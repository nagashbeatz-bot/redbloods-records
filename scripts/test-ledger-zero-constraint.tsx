/**
 * The artist-ledger amount CHECK (Owner-approved DB change 2026-09-28: artist_balance_entries_amount_check
 * CHECK (amount > 0) → CHECK (amount >= 0)) and the expense-share writer on a fake that ENFORCES that constraint the way
 * production does (23514) — so a fake can never allow what the database refuses.
 *   amount > 0  = an active charge / entitlement
 *   amount = 0  = ONLY a kept history row (zeroed / cancelled / removed) with its reason; never deleted
 *   amount < 0  = refused
 * A share write that fails (the old constraint, or any other DB error) is REPORTED (ShareSyncError → the route answers
 * with the message, Sunny's step fails) — never swallowed into a fake success.
 * Run with:   npx tsx scripts/test-ledger-zero-constraint.tsx
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
/** the production constraint on artist_balance_entries.amount: "REAL" = since 2026-09-28 (>= 0), "OLD" = before (> 0) */
let LEDGER_CHECK: "REAL" | "OLD" = "REAL";
/** a one-shot non-constraint failure of the next ledger UPDATE (e.g. a dropped connection) */
let failNextLedgerUpdate: string | null = null;
const CHECK_ERR = { code: "23514", message: 'new row for relation "artist_balance_entries" violates check constraint "artist_balance_entries_amount_check"' };
const violates = (amount: unknown) => { const n = Number(amount); return !Number.isFinite(n) || (LEDGER_CHECK === "REAL" ? n < 0 : n <= 0); };

function from(table: string) {
  const filters: Array<(r: Row) => boolean> = [];
  let mode: "select" | "update" | "insert" | "delete" = "select", patch: Row | null = null, ins: Row | null = null, one = false, lim: number | null = null;
  const run = () => {
    if (mode === "insert") {
      if (table === "artist_balance_entries") {
        if (violates(ins!.amount)) return { data: null, error: CHECK_ERR };
        if (ins!.source_expense_tx_id && t(table).some((r) => r.source_expense_tx_id === ins!.source_expense_tx_id && r.artist_id === ins!.artist_id)) return { data: null, error: { message: "duplicate", code: "23505" } };
      }
      const r = { id: randomUUID(), ...ins }; t(table).push(r); return { data: one ? { ...r } : [{ ...r }], error: null };
    }
    let rows = t(table).filter((r) => filters.every((f) => f(r)));
    if (mode === "update") {
      if (table === "artist_balance_entries") {
        if (failNextLedgerUpdate) { const m = failNextLedgerUpdate; failNextLedgerUpdate = null; return { data: null, error: { message: m, code: "08006" } }; }
        if ("amount" in patch! && violates(patch!.amount)) return { data: null, error: CHECK_ERR }; // the whole statement is refused
      }
      for (const r of rows) Object.assign(r, patch);
    }
    if (mode === "delete") { DB[table] = t(table).filter((r) => !rows.includes(r)); }
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
  return { select: () => c, insert(r: Row) { mode = "insert"; ins = r; return c; }, update(p: Row) { mode = "update"; patch = p; return c; }, delete() { mode = "delete"; return c; } };
}
const ML = Module as unknown as { _load(request: string, parent: unknown, isMain: boolean): unknown };
const orig = ML._load;
ML._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === "server-only") return {};
  if (/(^|\/)supabase$/.test(request)) return { supabase: { from } };
  if (/(^|\/)projects-store$/.test(request)) return { touchProject: async () => {} };
  return orig.call(this, request, parent, isMain);
};

const SHALEV = "8806fe5e-1238-4228-8078-b3db3ccc9b46", AVI = "b3499c72-069d-46c9-9c31-52b1db27c51f";

(async () => {
  const W = await import("../lib/writes/artist-expense-share");
  const F = await import("../lib/writes/finance");
  t("projects").push({ id: "p-shalev", artist: "שליו טסמה" }, { id: "p-duo", artist: "שליו טסמה, אבי מולה" });
  const tx = (o: Row = {}) => { const id = randomUUID(); t("transactions").push({ id, type: "expense", amount: 1000, currency: "₪", payment_status: "שולם", business_unit: "RECORDS", business_unit_source: "OWNER_DECISION", category: "קידום", expense_scope: "שיווק", show_id: null, show_money_role: null, project_id: "p-shalev", date: "2026-10-01", description: "קידום", ...o }); return id; };
  const rowsOf = (txId: string) => t("artist_balance_entries").filter((r) => r.source_expense_tx_id === txId);
  const txRow = (id: string) => t("transactions").find((r) => r.id === id);

  console.log("The fake enforces the production constraint");
  const neg = await (from("artist_balance_entries").insert({ artist_id: SHALEV, entry_type: "הוצאות", amount: -1 }) as unknown as { single(): Promise<{ error: unknown }> }).single();
  ok("a negative ledger amount is refused (23514) — as in production", (neg.error as { code?: string } | null)?.code === "23514");
  LEDGER_CHECK = "OLD";
  const zeroOld = await (from("artist_balance_entries").insert({ artist_id: SHALEV, entry_type: "הוצאות", amount: 0 }) as unknown as { single(): Promise<{ error: unknown }> }).single();
  LEDGER_CHECK = "REAL";
  ok("under the OLD constraint (> 0) a 0 row is refused — the exact production failure Stage 0 found", (zeroOld.error as { code?: string } | null)?.code === "23514");

  console.log("\nWith the real constraint (>= 0): a share that stops counting is KEPT at 0 with its reason");
  const a = tx();
  await F.updateTransactionRecord(a, { notes: "x" }); // any Finance save syncs the share
  const rowA = rowsOf(a)[0];
  ok("paid Records expense 1,000 (Shalev) → one ledger row of 500", rowsOf(a).length === 1 && rowA?.amount === 500, rowsOf(a));
  await F.updateTransactionRecord(a, { paymentStatus: "בוטל" });
  ok("Finance cancel → the SAME row, amount 0, reason in the note; never deleted", rowsOf(a).length === 1 && rowsOf(a)[0].id === rowA.id && rowsOf(a)[0].amount === 0 && /^\[חלק הוצאה לא פעיל\] ההוצאה לא שולמה \/ בוטלה \(בוטל\) \(היה ₪500\)/.test(String(rowsOf(a)[0].note)), rowsOf(a)[0]);
  const b = tx();
  await W.syncExpenseShare(b);
  const rowB = rowsOf(b)[0];
  await F.deleteTransactionRecord(b);
  ok("Finance delete → the row kept at 0 (reason: ההוצאה נמחקה מהכספים)", !txRow(b) && rowsOf(b).length === 1 && rowsOf(b)[0].id === rowB.id && rowsOf(b)[0].amount === 0 && /ההוצאה נמחקה מהכספים/.test(String(rowsOf(b)[0].note)));
  const c = tx({ project_id: "p-duo", amount: 4000 });
  await W.syncExpenseShare(c);
  ok("Shalev + Avi 4,000 → 1,000 + 1,000", rowsOf(c).length === 2 && rowsOf(c).every((r) => r.amount === 1000));
  t("projects").find((p) => p.id === "p-duo")!.artist = "שליו טסמה";
  const n = await W.syncProjectExpenseShares("p-duo");
  const avi = rowsOf(c).find((r) => r.artist_id === AVI)!, sh = rowsOf(c).find((r) => r.artist_id === SHALEV)!;
  ok("artist credit changed (Avi removed) → Avi's row kept at 0 with the reason; Shalev re-priced 2,000", n >= 1 && avi.amount === 0 && /החוק כבר לא מחייב את האמן הזה/.test(String(avi.note)) && sh.amount === 2000, { avi, sh });
  ok("zero rows are only history rows: every 0 row carries the inactive prefix + what it was", t("artist_balance_entries").filter((r) => r.amount === 0).every((r) => /^\[חלק הוצאה לא פעיל\].*\(היה ₪\d/.test(String(r.note))));

  console.log("\nA failed share write is REPORTED — never a fake success");
  const d = tx();
  await W.syncExpenseShare(d);
  LEDGER_CHECK = "OLD";
  let err: unknown = null;
  try { await F.updateTransactionRecord(d, { paymentStatus: "בוטל" }); } catch (e) { err = e; }
  ok("the DB refuses the zeroing (old constraint) → the Finance writer THROWS ShareSyncError (the route answers 500 with it)", err instanceof W.ShareSyncError && (err as InstanceType<typeof W.ShareSyncError>).txIds[0] === d && /23514|check constraint/.test((err as Error).message), (err as Error | null)?.message);
  ok("   the message says what is true: the change was saved, the artist's share was NOT updated, save again", /השינוי נשמר, אבל עדכון חלק האמן ביומן האמן נכשל/.test((err as Error).message) && /לשמור שוב/.test((err as Error).message));
  ok("   (the truth underneath: Finance is בוטל, the share still charges 500 — visible to the reconciliation as a mismatch)", txRow(d)!.payment_status === "בוטל" && rowsOf(d)[0].amount === 500);
  let delErr: unknown = null;
  try { await F.deleteTransactionRecord(d); } catch (e) { delErr = e; }
  ok("a delete whose share zeroing fails also throws (never { ok: true })", delErr instanceof W.ShareSyncError);
  LEDGER_CHECK = "REAL";
  await W.syncExpenseShareOrFail(d);
  ok("retry once the DB allows it → converges (the row goes to 0, same row, no duplicate)", rowsOf(d).length === 1 && rowsOf(d)[0].amount === 0);
  const e2 = tx();
  await W.syncExpenseShare(e2);
  txRow(e2)!.payment_status = "בוטל";
  failNextLedgerUpdate = "connection terminated unexpectedly";
  let otherErr: unknown = null;
  try { await W.syncExpenseShareOrFail(e2); } catch (e) { otherErr = e; }
  ok("any other write failure (not the constraint) is reported the same way", otherErr instanceof W.ShareSyncError && /connection terminated/.test((otherErr as Error).message));
  // project credit change: every expense is attempted, then ONE error lists the failures
  t("projects").push({ id: "p-two", artist: "שליו טסמה, אבי מולה" });
  const p1 = tx({ project_id: "p-two", amount: 2000 }), p2 = tx({ project_id: "p-two", amount: 2000 });
  await W.syncExpenseShare(p1); await W.syncExpenseShare(p2);
  t("projects").find((p) => p.id === "p-two")!.artist = "שליו טסמה";
  LEDGER_CHECK = "OLD";
  let projErr: unknown = null;
  try { await W.syncProjectExpenseShares("p-two"); } catch (e) { projErr = e; }
  LEDGER_CHECK = "REAL";
  ok("credit change with failing writes → ONE ShareSyncError naming both expenses (every expense was attempted)", projErr instanceof W.ShareSyncError && (projErr as InstanceType<typeof W.ShareSyncError>).txIds.length === 2 && (projErr as InstanceType<typeof W.ShareSyncError>).txIds.includes(p1) && (projErr as InstanceType<typeof W.ShareSyncError>).txIds.includes(p2));

  console.log("\nWiring: nothing swallows a share failure any more");
  const files = ["lib/writes/finance.ts", "lib/writes/business-unit.ts", "lib/writes/redfilms.ts", "lib/writes/rf-finance-link.ts", "lib/social-promotions-store.ts", "lib/writes/projects.ts", "app/api/projects/[id]/route.ts"];
  const all = files.map(read).join("\n");
  ok("no syncExpenseShareSafe left; every writer calls syncExpenseShareOrFail / syncProjectExpenseShares", !/syncExpenseShareSafe/.test(all + read("lib/writes/artist-expense-share.ts")) && (all.match(/syncExpenseShareOrFail\(/g) ?? []).length >= 9);
  ok("no .catch(() => 0) on the project credit re-sync (route + shared writer)", !/syncProjectExpenseShares\(id\)\.catch/.test(all) && (all.match(/syncProjectExpenseShares\(id\);/g) ?? []).length === 3);
  ok("a new Red Films payment whose share fails is reported as LINKED + shareSyncErrorHe (never 'not linked')", /e instanceof ShareSyncError \? \{ state: "LINKED", transactionId: e\.txIds\[0\], shareSyncErrorHe: e\.message \}/.test(read("lib/writes/redfilms.ts")));
  ok("the Finance routes answer a thrown error with its message (500), not { ok: true }", /return NextResponse\.json\(\{ error: err instanceof Error \? err\.message : "שגיאת שרת" \}, \{ status: 500 \}\)/.test(read("app/api/transactions/[id]/route.ts")));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
