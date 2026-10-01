/**
 * Final Hardening Block (Owner-approved 2026-09-29, A1–A9): every money write the operation depends on either happens or
 * FAILS the operation — never logged-and-continued, never "success". The real writers run on an in-memory database that
 * behaves like production where it matters: an injected error, 0 rows updated, Postgres NULL semantics for
 * .not(… in …) / .or(…), unique keys (settings.key, projects.id, the show entitlement) and the ledger CHECK amount >= 0.
 * No production, no network, no push.
 * Run with:   npx tsx scripts/test-final-hardening.tsx
 */
import Module from "node:module";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: unknown) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 700)}` : ""}`); } };
const read = (p: string) => fs.readFileSync(path.resolve(__dirname, "..", p), "utf8");
const threw = async (f: () => Promise<unknown>) => { try { await f(); return null; } catch (e) { return e as Error; } };

type Row = Record<string, unknown>;
let DB: Record<string, Row[]> = {};
const t = (name: string) => (DB[name] ??= []);
/** fail the NEXT matching operation: `${table}:${op}` → message (op = select / insert / update / delete) */
const failNext: Record<string, string> = {};
const UNIQUE: Record<string, (a: Row, b: Row) => boolean> = {
  settings: (a, b) => a.key === b.key,
  projects: (a, b) => a.id === b.id,
  transactions: (a, b) => a.id === b.id,
  artist_balance_entries: (a, b) => !!a.source_show_id && a.source_show_id === b.source_show_id && a.artist_id === b.artist_id && ["הכנסות", "הכנסות צפויות"].includes(String(a.entry_type)) && ["הכנסות", "הכנסות צפויות"].includes(String(b.entry_type)),
};
function from(table: string) {
  const filters: Array<(r: Row) => boolean> = [];
  let mode: "select" | "update" | "insert" | "delete" = "select", patch: Row | null = null, ins: Row | Row[] | null = null, one = false, lim: number | null = null, head = false;
  const run = () => {
    const key = `${table}:${mode}`;
    if (failNext[key]) { const m = failNext[key]; delete failNext[key]; return { data: null, error: { message: m, code: "XX000" }, count: null }; }
    if (mode === "insert") {
      const rows: Row[] = (Array.isArray(ins) ? ins : [ins!]).map((r: Row) => ({ id: randomUUID(), created_at: new Date().toISOString(), ...r }));
      for (const r of rows) {
        if (table === "artist_balance_entries" && !(Number(r.amount) >= 0)) return { data: null, error: { message: "check amount", code: "23514" }, count: null };
        const u = UNIQUE[table];
        if (u && t(table).some((x) => u(x, r))) return { data: null, error: { message: "duplicate key", code: "23505" }, count: null };
      }
      t(table).push(...rows);
      return { data: one ? { ...rows[0] } : rows.map((r) => ({ ...r })), error: null, count: null };
    }
    let rows = t(table).filter((r) => filters.every((f) => f(r)));
    if (mode === "update") {
      if (table === "artist_balance_entries" && patch && "amount" in patch && !(Number(patch.amount) >= 0)) return { data: null, error: { message: "check amount", code: "23514" }, count: null };
      for (const r of rows) Object.assign(r, patch);
    }
    if (mode === "delete") DB[table] = t(table).filter((r) => !rows.includes(r));
    if (lim !== null) rows = rows.slice(0, lim);
    const data = rows.map((r) => ({ ...r }));
    if (head) return { data: null, error: null, count: data.length };
    return { data: one ? data[0] ?? null : data, error: null, count: data.length };
  };
  const c: Record<string, unknown> = {
    select(_c?: string, o?: { head?: boolean }) { if (o?.head) head = true; return c; },
    // a jsonb column compared with its JSON text (the settings compare-and-swap) — like PostgREST
    eq(k: string, v: unknown) { filters.push((r) => (r[k] !== null && typeof r[k] === "object" && typeof v === "string" ? JSON.stringify(r[k]) === v : r[k] === v)); return c; },
    neq(k: string, v: unknown) { filters.push((r) => r[k] !== null && r[k] !== undefined && r[k] !== v); return c; },
    in(k: string, vs: unknown[]) { filters.push((r) => vs.includes(r[k])); return c; },
    is(k: string, v: unknown) { filters.push((r) => (r[k] ?? null) === v); return c; },
    not(k: string, op: string, val: string) { if (op !== "in") throw new Error(`fake not.${op}`); const list = String(val).replace(/^\(|\)$/g, "").split(",").map((x) => x.trim().replace(/^"|"$/g, "")); filters.push((r) => r[k] !== null && r[k] !== undefined && !list.includes(String(r[k]))); return c; },
    or(expr: string) { const parts = expr.split(",").map((p) => { const [col, op, ...rest] = p.split("."); return { col, op, v: rest.join(".") }; }); filters.push((r) => parts.some(({ col, op, v }) => (op === "is" && v === "null" ? r[col] === null || r[col] === undefined : op === "eq" ? String(r[col]) === v : op === "neq" ? r[col] !== null && r[col] !== undefined && String(r[col]) !== v : false))); return c; },
    like(k: string, pat: string) { const re = new RegExp("^" + pat.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*") + "$", "s"); filters.push((r) => re.test(String(r[k] ?? ""))); return c; },
    order() { return c; },
    limit(n: number) { lim = n; return c; },
    // like PostgREST: .single() on no row is an ERROR (PGRST116); .maybeSingle() is data null
    single() { one = true; const r = run() as { data: unknown; error: unknown }; return Promise.resolve(!r.error && r.data === null && mode === "select" ? { data: null, error: { message: "JSON object requested, multiple (or no) rows returned", code: "PGRST116" } } : r); },
    maybeSingle() { one = true; return Promise.resolve(run()); },
    then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) { return Promise.resolve(run()).then(res, rej); },
  };
  return { select: (cols?: string, o?: { head?: boolean }) => (c.select as (a?: string, b?: { head?: boolean }) => unknown)(cols, o) && c, insert(r: Row | Row[]) { mode = "insert"; ins = r; return c; }, update(p: Row) { mode = "update"; patch = p; return c; }, delete() { mode = "delete"; return c; }, upsert() { throw new Error("fake: upsert is not a hardened write"); } };
}
const ML = Module as unknown as { _load(request: string, parent: unknown, isMain: boolean): unknown };
const orig = ML._load;
ML._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === "server-only") return {};
  if (/(^|\/)supabase$/.test(request)) return { supabase: { from, rpc: async () => ({ data: null, error: { message: "no rpc" } }) } };
  if (/(^|\/)projects-store$/.test(request)) return {
    touchProject: async () => {}, ensureProjectStartDate: async () => {},
    getProject: async (id: string) => (t("projects").find((p) => p.id === id) ?? null),
    createProject: async (f: Row) => { const r = await (from("projects").insert({ ...f, id: f.id ?? randomUUID() }) as unknown as { select(): { single(): Promise<{ data: Row | null; error: { message: string } | null }> } }).select().single(); if (r.error) throw new Error(r.error.message); return r.data; },
  };
  if (/(^|\/)project-classification-server$/.test(request)) return { newProjectBusinessType: async () => ({ businessType: "לקוח" }) };
  if (/(^|\/)clients-store$/.test(request)) return { upsertArtistsFromProject: async () => {} };
  if (/(^|\/)tasks-store$/.test(request)) return { listTasks: async () => [], patchTask: async () => {}, deleteTask: async () => {} };
  if (/(^|\/)shows-store$/.test(request)) return { getShow: async (id: string) => (t("shows").find((s) => s.id === id) ?? null) };
  if (/(^|\/)google-calendar$/.test(request)) return { isConnected: async () => false };
  // never a push from a test (the sessions module imports the Shalev session push)
  if (/(^|\/)push$/.test(request) || /session-push|shalev-session/.test(request)) return new Proxy({}, { get: () => async () => ({ kind: "skipped" }) });
  if (/(^|\/)sound-engineer-store$/.test(request)) return { deleteSoundEngineerWork: async (id: string) => { DB.sound_engineer_work = t("sound_engineer_work").filter((w) => w.id !== id); } };
  return orig.call(this, request, parent, isMain);
};

const SHALEV = "8806fe5e-1238-4228-8078-b3db3ccc9b46";
const PACHA_TX = "e012d6d4-8dcf-42c7-925d-364964af18c2";
const show = (o: Row = {}) => ({ id: randomUUID(), name: "הופעה", artist: "שליו טסמה", date: "2026-10-10", start_time: null, location: "", contact_person: "", phone: "", status: "נסגר", payment_status: "לא שולם", show_price: 2000, dj_fee: 0, advance_payment: 0, notes: "", artist_client_id: null, booker_client_id: null, booker_name: "", calendar_event_id: null, dj_client_id: null, dj_name: "", linked_income_transaction_id: null, linked_dj_expense_transaction_id: null, artist_fee: 0, linked_artist_expense_transaction_id: null, dj_confirmation_status: null, dj_confirmed_at: null, currency: "₪", deal_type: "PAID", ...o });

(async () => {
  const SFS = await import("../lib/shows-finance-sync");
  const ES = await import("../lib/artist-entitlement-sync");
  const TXV = await import("../lib/finance/tx-patch-validation");
  const reset = () => { DB = { label_artists: [{ id: SHALEV, name: "שליו טסמה" }], shows: [], transactions: [], sessions: [], artist_balance_entries: [], settings: [], projects: [], proposals: [], sound_engineer_work: [], clip_items: [] }; for (const k of Object.keys(failNext)) delete failNext[k]; };

  console.log("A1 — a show's money write that fails FAILS the operation");
  reset();
  const s1 = show(); t("shows").push(s1);
  await SFS.syncShowFinance(s1 as never);
  const exp = t("transactions").find((r) => r.show_id === s1.id && r.show_money_role === "SHOW_BALANCE_EXPECTED");
  ok("baseline: a confirmed show → ONE expected-balance row, linked on the show", !!exp && t("shows")[0].linked_income_transaction_id === exp!.id);
  failNext["transactions:update"] = "connection lost";
  const e1 = await threw(() => SFS.insertShowPayment(t("shows")[0] as never, { amount: 2000, date: "2026-10-11" }));
  ok("insertShowPayment (the whole remainder): the patch fails → THROWS ShowFinanceSyncError — no id returned, nothing 'received'", e1 instanceof SFS.ShowFinanceSyncError && exp!.payment_status === "צפוי" && exp!.show_money_role === "SHOW_BALANCE_EXPECTED", e1?.message);
  DB.transactions = t("transactions").filter((r) => r.id !== exp!.id); // the expected row vanished meanwhile
  const s1b = { ...t("shows")[0] };
  const money = await SFS.showMoneyForShow(s1b as never);
  ok("   (after the row vanished the sync sees no expected row)", money.expected === null);
  reset();
  const s2 = show(); t("shows").push(s2);
  await SFS.syncShowFinance(s2 as never);
  const exp2 = t("transactions")[0];
  const e0 = await threw(async () => { DB.transactions = []; return SFS.insertShowPayment({ ...s2, linked_income_transaction_id: exp2.id } as never, { amount: 500, date: "2026-10-11" }).then(async (id) => { failNext["transactions:insert"] = "x"; return id; }); });
  ok("insertShowPayment (partial): a real row is written and its id returned only when it exists", e0 === null && t("transactions").some((r) => r.show_money_role === "SHOW_PAYMENT" && r.amount === 500));
  reset();
  const s3 = show(); t("shows").push(s3);
  failNext["transactions:insert"] = "insert refused";
  const e3 = await threw(() => SFS.syncShowFinance(s3 as never));
  ok("syncShowFinance: a failed insert THROWS (it used to log and return an empty report)", e3 instanceof SFS.ShowFinanceSyncError && t("transactions").length === 0, e3?.message);
  reset();
  const s4 = show({ dj_fee: 500, dj_name: "רועי" }); t("shows").push(s4);
  failNext["shows:update"] = "link write failed";
  const e4 = await threw(() => SFS.syncShowFinance(s4 as never));
  ok("a failed linked_* write on the show THROWS (never a lost link → a second row on the next sync)", e4 instanceof SFS.ShowFinanceSyncError && /קישור/.test(String(e4?.message)), e4?.message);
  reset();
  const s5 = show({ status: "ממתין לתשובה" }); t("shows").push(s5);
  t("transactions").push({ id: "exp", show_id: s5.id, show_money_role: "SHOW_BALANCE_EXPECTED", payment_status: "צפוי", type: "income" }, { id: "dj-part", show_id: s5.id, show_money_role: "DJ_FEE", payment_status: "חלקי", type: "expense" }, { id: "dj-paid", show_id: s5.id, show_money_role: "DJ_FEE", payment_status: "שולם", type: "expense" });
  const n5 = await SFS.deleteShowFinance(s5 as never);
  ok("deleteShowFinance: only the still-expected row goes; a paid AND a partly paid (חלקי) fee stay", n5 === 1 && t("transactions").map((r) => r.id).sort().join() === "dj-paid,dj-part");
  failNext["transactions:delete"] = "delete failed";
  t("transactions").push({ id: "exp2", show_id: s5.id, show_money_role: "SHOW_BALANCE_EXPECTED", payment_status: "צפוי", type: "income" });
  const e5 = await threw(() => SFS.deleteShowFinance(s5 as never));
  ok("deleteShowFinance: a failed delete THROWS (never 'removed' while the expected money is still there)", e5 instanceof SFS.ShowFinanceSyncError && t("transactions").some((r) => r.id === "exp2"));
  failNext["transactions:select"] = "read failed";
  ok("deleteShowFinance: a failed read THROWS (never 'nothing to remove')", (await threw(() => SFS.deleteShowFinance(s5 as never))) instanceof SFS.ShowFinanceSyncError);

  console.log("\nA2 — an unknown rehearsal cost is never 0");
  reset();
  failNext["sessions:select"] = "timeout";
  const e6 = await threw(() => SFS.getRehearsalCountedForShow("x"));
  ok("getRehearsalCountedForShow: a failed read THROWS RehearsalCountUnknownError (it returned 0)", e6 instanceof SFS.RehearsalCountUnknownError, e6?.message);
  failNext["transactions:select"] = "timeout";
  t("sessions").push({ id: "r1", show_id: "x", session_type: "חזרה להופעה", status: "בוצע", cost: 300 });
  ok("…also when the rehearsal payment read fails", (await threw(() => SFS.getRehearsalCountedForShow("x"))) instanceof SFS.RehearsalCountUnknownError);
  failNext["sessions:select"] = "timeout";
  ok("getRehearsalCountedMap: a failed read THROWS (a list never shows a split from a fake 0)", (await threw(() => SFS.getRehearsalCountedMap(["x"]))) instanceof SFS.RehearsalCountUnknownError);
  reset();
  const s7 = show({ status: "בוצע", show_price: 3000 }); t("shows").push(s7);
  t("sessions").push({ id: "r7", show_id: s7.id, session_type: "חזרה להופעה", status: "בוצע", cost: 400 });
  failNext["sessions:select"] = "timeout";
  const e7 = await threw(() => SFS.syncShowFinance(s7 as never));
  ok("syncShowFinance of a performed show with an unreadable rehearsal cost → THROWS and writes NO entitlement", e7 instanceof SFS.RehearsalCountUnknownError && t("artist_balance_entries").length === 0, e7?.message);
  ok("the close / fee-paid paths use the throwing reader (no artist payment from a fake 0)", /getRehearsalCountedForShow\(fresh\.id\)/.test(read("lib/writes/shows.ts")) && /showAgreementSplit\(show, await getRehearsalCountedForShow\(show\.id\)\)/.test(read("lib/writes/shows.ts")) && !/return 0;\s*\n\s*\}\s*\n\}/.test(read("lib/shows-finance-sync.ts").slice(read("lib/shows-finance-sync.ts").indexOf("export async function getRehearsalCountedForShow"), read("lib/shows-finance-sync.ts").indexOf("export async function syncRehearsalFinance"))));

  console.log("\nA3 — rehearsal / currency / Victor settings writes are never swallowed");
  reset();
  failNext["transactions:select"] = "read failed";
  const e8 = await threw(() => SFS.syncRehearsalFinance({ id: "rx", date: "2026-10-01", cost: 300 }, { id: "sx", name: "הופעה", artist: "שליו טסמה" }, "לא שולם"));
  ok("syncRehearsalFinance: a failed read of the existing row THROWS — never a second rehearsal expense", e8 instanceof SFS.ShowFinanceSyncError && t("transactions").length === 0);
  ok("sessions: the rehearsal finance sync error is kept and REPORTED after the other steps (create / update / delete)", (read("lib/writes/sessions.ts").match(/throw sessionFinanceError\(/g) ?? []).length === 3 && !/rehearsal finance sync error:", e\);\n\s*\}\n\s*\}/.test(read("lib/writes/sessions.ts")));
  ok("shows: the currency propagation is checked (a failed row update fails the save)", /if \(c1\.error\) throw new ShowFinanceSyncError/.test(read("lib/writes/shows.ts")) && /if \(c2\.error\) throw new ShowFinanceSyncError/.test(read("lib/writes/shows.ts")));
  reset();
  t("settings").push({ key: "vendor_victor_salary_overrides", value: { "2026-06": 500 } });
  const VS = await import("../lib/vendor-store");
  await VS.setSalaryAmountOverride("2026-09", 550);
  ok("Victor override: merged (compare-and-swap) — the other months are kept", JSON.stringify(t("settings")[0].value) === JSON.stringify({ "2026-06": 500, "2026-09": 550 }));
  failNext["settings:select"] = "read failed";
  const e9 = await threw(() => VS.setSalaryStatusOverride("2026-09", "שולם"));
  ok("Victor status override: a failed read THROWS — it never overwrites the stored months with only the new one", e9 !== null && JSON.stringify(t("settings")[0].value) === JSON.stringify({ "2026-06": 500, "2026-09": 550 }));
  failNext["settings:update"] = "write failed";
  ok("Victor settings: a failed write THROWS (the route answers the error, never 'saved')", (await threw(() => VS.setSalaryAmountOverride("2026-10", 550))) !== null);

  console.log("\nA4 — deleting an engineer work never deletes money that went out");
  const MIX = await import("../lib/writes/mix");
  for (const [status, kept] of [["חלקי", true], ["שולם", true], ["לא שולם", false]] as const) {
    reset();
    t("sound_engineer_work").push({ id: "w", linked_transaction_id: "tx" });
    t("transactions").push({ id: "tx", payment_status: status, amount: 200, currency: "$" });
    const r = await MIX.deleteEngineerWorkClean("w");
    ok(`expense "${status}" → ${kept ? "KEPT as history" : "removed"} (work deleted)`, t("sound_engineer_work").length === 0 && (t("transactions").length === 1) === kept && r.removedExpense === !kept);
  }
  reset();
  failNext["sound_engineer_work:select"] = "read failed";
  t("sound_engineer_work").push({ id: "w", linked_transaction_id: "tx" });
  t("transactions").push({ id: "tx", payment_status: "חלקי" });
  ok("a failed read of the work's expense THROWS before anything is deleted", (await threw(() => MIX.deleteEngineerWorkClean("w"))) !== null && t("sound_engineer_work").length === 1 && t("transactions").length === 1);
  ok("the send-log cascade uses the same hardened delete", /deleteEngineerWorkClean\(linkedWorkId\)/.test(read("lib/writes/worklog.ts")));

  console.log("\nA5 — one proposal → exactly one project (retry / double click / failure in the middle)");
  const PR = await import("../lib/writes/proposals");
  reset();
  t("proposals").push({ id: "p1", title: "שיר", amount: 0, currency: "₪", notes: "", client_id: null, linked_project_id: null, status: "נשלח", updated_at: "u0", clients: { name: "לקוח" } });
  failNext["proposals:update"] = "link failed";
  const first = await threw(() => PR.convertProposal("p1"));
  ok("the link fails after the project was created → the call FAILS (it used to report ok with an unlinked proposal)", first !== null && t("projects").length === 1 && t("proposals")[0].linked_project_id === null, first?.message);
  const second = await PR.convertProposal("p1");
  ok("the retry finishes the SAME conversion — still ONE project, now linked", second.status === "ok" && t("projects").length === 1 && t("proposals")[0].linked_project_id === t("projects")[0].id && t("proposals")[0].status === "נסגר");
  const third = await PR.convertProposal("p1");
  ok("a further click → already_converted, no new project", third.status === "already_converted" && t("projects").length === 1);
  reset();
  t("proposals").push({ id: "p2", title: "שיר", amount: 0, currency: "₪", notes: "", client_id: null, linked_project_id: null, status: "נשלח", updated_at: "u0", clients: { name: "לקוח" } });
  const [a, b] = await Promise.all([PR.convertProposal("p2"), PR.convertProposal("p2")]);
  ok("two concurrent converts → ONE project (the reservation + the projects key), both answer with it", t("projects").length === 1 && [a, b].every((r) => r.status === "ok" || r.status === "already_converted"), [a.status, b.status, t("projects").length]);
  reset();
  t("proposals").push({ id: "p3", title: "שיר", amount: 0, currency: "₪", notes: "", client_id: null, linked_project_id: null, status: "נשלח", updated_at: "u0", clients: { name: "לקוח" } });
  failNext["projects:insert"] = "crash";
  ok("a crash while creating the project → the call fails, no project", (await threw(() => PR.convertProposal("p3"))) !== null && t("projects").length === 0);
  const retry3 = await PR.convertProposal("p3");
  ok("…the retry creates it with the RESERVED id (the same one) — one project", retry3.status === "ok" && t("projects").length === 1 && t("projects")[0].id === (t("settings").find((s) => s.key === "proposal_conversion:p3")!.value as { projectId: string }).projectId);

  console.log("\nA6 — deleting a session / rehearsal: no orphan expense, never deleting paid money");
  const SES = await import("../lib/writes/sessions");
  reset();
  t("sessions").push({ id: "s-paid", show_id: null, session_type: "סשן", calendar_event_id: null, project_id: null });
  t("transactions").push({ id: "e-paid", linked_session_id: "s-paid", payment_status: "חלקי", amount: 180, currency: "₪", notes: "" });
  const e10 = await threw(() => SES.deleteSession("s-paid"));
  ok("a (partly) paid session expense → the delete is REFUSED (409); nothing changes", e10?.name === "SessionHasPaidExpenseError" && t("sessions").length === 1 && t("transactions")[0].payment_status === "חלקי");
  reset();
  t("sessions").push({ id: "s-unpaid", show_id: null, session_type: "סשן", calendar_event_id: null, project_id: null });
  t("transactions").push({ id: "e-unpaid", linked_session_id: "s-unpaid", payment_status: "לא שולם", amount: 180, currency: "₪", notes: "" });
  const r10 = await SES.deleteSession("s-unpaid");
  ok("an unpaid session expense → marked 'בוטל' with a note and KEPT (not deleted, not an orphan that counts)", t("sessions").length === 0 && t("transactions").length === 1 && t("transactions")[0].payment_status === "בוטל" && /הסשן נמחק/.test(String(t("transactions")[0].notes)) && r10.cancelledExpenses === 1);
  reset();
  t("sessions").push({ id: "s-x", show_id: null, session_type: "סשן", calendar_event_id: null, project_id: null });
  t("transactions").push({ id: "e-x", linked_session_id: "s-x", payment_status: "לא שולם", amount: 100, currency: "₪", notes: "" });
  failNext["transactions:update"] = "write failed";
  ok("a failed cancel of the expense → the session is NOT deleted", (await threw(() => SES.deleteSession("s-x"))) !== null && t("sessions").length === 1);
  ok("the delete route answers a paid expense with 409", /SessionHasPaidExpenseError" \? 409 : 500/.test(read("app/api/sessions/[id]/route.ts")));

  console.log("\nA7 — shows ↔ the artist ledger");
  reset();
  const s11 = show({ status: "בוצע", show_price: 2400, dj_fee: 400, dj_name: "רועי" }); t("shows").push(s11);
  await SFS.syncShowFinance(s11 as never);
  const ent = () => t("artist_balance_entries").filter((r) => r.source_show_id === s11.id);
  ok("a plain edit to בוצע realizes the entitlement ((2400 − 400) / 2 = 1000) — ONE realized row", ent().length === 1 && ent()[0].entry_type === "הכנסות" && ent()[0].amount === 1000, ent());
  const id11 = ent()[0].id;
  Object.assign(t("shows")[0], { show_price: 3000 });
  await SFS.syncShowFinance(t("shows")[0] as never);
  ok("a price change after realization → the SAME row re-priced (1300), no second row", ent().length === 1 && ent()[0].id === id11 && ent()[0].amount === 1300);
  Object.assign(t("shows")[0], { status: "בוטל" });
  await SFS.syncShowFinance(t("shows")[0] as never);
  ok("cancelled after realization → the SAME row kept at 0 with the reason + what it was (history, no double count)", ent().length === 1 && ent()[0].amount === 0 && /\[זכאות לא פעילה\].*היה ₪1300/.test(String(ent()[0].note)));
  reset();
  const pacha = show({ status: "בוצע", show_price: 2500, dj_fee: 500, linked_artist_expense_transaction_id: PACHA_TX }); t("shows").push(pacha);
  await SFS.syncShowFinance(pacha as never);
  ok("Pacha / Summer Time (paid OUTSIDE the ledger, the approved exception) → the sync writes NO entitlement (Shalev's balance cannot move)", t("artist_balance_entries").length === 0);
  await SFS.deleteShowFinance(pacha as never);
  ok("…and a delete / revert never marks anything for them either", t("artist_balance_entries").length === 0);

  console.log("\nA8 — a transaction edit that changes its financial meaning is validated");
  const cur = { type: "expense", paymentStatus: "לא שולם", scope: "project", projectId: "p", expenseScope: "כללי", currency: "₪", amount: 100, linkedSessionId: "" };
  ok("an expense cannot become 'התקבל' (not an expense status)", !!TXV.validateTxPatch(cur, { paymentStatus: "התקבל" }));
  ok("an unknown type / currency / scope is refused", !!TXV.validateTxPatch(cur, { type: "transfer" }) && !!TXV.validateTxPatch(cur, { currency: "GBP" }) && !!TXV.validateTxPatch(cur, { scope: "x" }));
  ok("a type change validates the status the row will have (expense 'לא שולם' → income is refused)", !!TXV.validateTxPatch(cur, { type: "income" }) && TXV.validateTxPatch(cur, { type: "income", paymentStatus: "צפוי" }) === null);
  ok("song ↔ clip money on an income: only כללי / קליפ and only on a project row", TXV.validateTxPatch({ ...cur, type: "income", paymentStatus: "צפוי" }, { expenseScope: "קליפ" }) === null && !!TXV.validateTxPatch({ ...cur, type: "income", paymentStatus: "צפוי", scope: "general", projectId: null }, { expenseScope: "קליפ" }) && !!TXV.validateTxPatch({ ...cur, type: "income", paymentStatus: "צפוי" }, { expenseScope: "שיווק" }));
  ok("a project row needs a project; a negative / non-numeric amount is refused", !!TXV.validateTxPatch(cur, { project_id: null }) && !!TXV.validateTxPatch(cur, { amount: -1 }) && !!TXV.validateTxPatch(cur, { amount: "abc" }));
  ok("an owner marker can be neither added nor removed by a free edit", !!TXV.validateTxPatch(cur, { linkedSessionId: "media_income:x" }) && !!TXV.validateTxPatch({ ...cur, linkedSessionId: "artist_payment:k" }, { linkedSessionId: "" }));
  ok("re-sending the stored values is never refused (only real changes are validated)", TXV.validateTxPatch({ ...cur, expenseScope: "משהו ישן" }, { expenseScope: "משהו ישן", paymentStatus: "לא שולם", currency: "₪", amount: 100 }) === null);
  ok("the shared writer runs it before writing (Finance route + Sunny)", /const invalid = validateTxPatch\(/.test(read("lib/writes/finance.ts")) && /if \(invalid\) throw new FinanceInputError\(invalid\)/.test(read("lib/writes/finance.ts")));

  console.log("\nA9 — clip");
  const CLIP = await import("../lib/writes/clip");
  reset();
  t("projects").push({ id: "pc", name: "קליפ", artist: "x", project_type: "קליפ" });
  t("settings").push({ key: "finance_pc", value: { agreedPrice: 3000, currency: "$" } });
  ok("one clip model (2026-10-01): the clip writer has no seed / clip payments (no second deal to seed)", !("addClipPayments" in CLIP) && !("setClipPrice" in CLIP));
  failNext["settings:select"] = "read failed";
  const eSet = await threw(() => CLIP.sendClipToRedFilms("pc"));
  ok("'שלח קליפ': a failed read of the finance settings THROWS — never a default currency, no production created", eSet !== null && t("red_films_productions").length === 0, eSet?.message);
  ok("the clip row mirror is awaited, checked and runs both ways", /await syncClipItemPaidMirror\(id,/.test(read("lib/writes/finance.ts")) && /status: paid \? "שולם" : "הועבר לכספים"/.test(read("lib/writes/finance.ts")) && !/clip_items"\)\.update\(\{ status: "שולם"[^\n]*\.then\(\(\) => \{\}, \(\) => \{\}\)/.test(read("lib/writes/finance.ts")));

  console.log("\nA10 — Sunny's contracts say what production says (verified 2026-09-29)");
  const { KNOWLEDGE_GAPS } = await import("../lib/partner/system/gaps");
  const gap = (id: string) => KNOWLEDGE_GAPS.find((g) => g.id === id)!;
  const MX = (await import("../lib/partner/act/matrix")).COVERAGE_MATRIX as ReadonlyArray<{ domain: string; klass: string }>;
  for (const [gid, dom] of [["CLI_ACTIONS_NOT_EXECUTABLE", "CLIENT"], ["LBL_ARTIST_ACTIONS_NOT_EXECUTABLE", "LABEL"], ["SHW_ACTIONS_NOT_EXECUTABLE", "SHOW"], ["VIC_ACTIONS_NOT_EXECUTABLE", "VICTOR"]] as const) {
    const rows = MX.filter((r) => r.domain === dom);
    ok(`${gid} CLOSED only while the matrix proves it: every ${dom} operation is EXECUTABLE or a security exclusion`, gap(gid).status === "CLOSED_NOW" && rows.length > 0 && rows.every((r) => r.klass === "EXECUTABLE" || r.klass === "INTENTIONALLY_SECURITY_EXCLUDED"));
  }
  ok("Victor salary: closed — Finance Jan–Aug $550 שולם and the overrides agree (no 'awaits approval', no June 500)", gap("VIC_SALARY_SOURCES_CONFLICT").status === "CLOSED_NOW" && !/awaits the Owner's approval/.test(gap("VIC_SALARY_SOURCES_CONFLICT").description) && !/override של סכום 500/.test(read("lib/partner/system/victor.ts")) && !/the Finance reconciliation awaits approval/.test(read("lib/partner/system/victor.ts")));
  ok("Red Films ↔ Finance: all 10 payments linked; only the non-clip scope RULE remains (partially closed, not a data gap)", /all 10 payments \(₪4,955\) are linked/.test(gap("RF_LEDGER_NOT_FINANCE").description) && gap("RF_LEDGER_NOT_FINANCE").status === "PARTIALLY_CLOSED" && !/DB-1 ממתין לאישורך/.test(read("lib/partner/system/registry.ts")) && !/not yet linked to Finance \(DB-1 awaits approval\)/.test(read("AGENTS.md")));
  // A11 (Owner decisions + approved historical corrections, production verified 2026-09-29)
  ok("A11 Steven: every completed unpaid work has its expected expense — incl. the EP $550 (810c9449, STUDIO / OWNER_DECISION / לא שולם) → CLOSED", gap("STEVEN_COMPLETED_WITHOUT_EXPENSE_HISTORY").status === "CLOSED_NOW" && /810c9449: STUDIO \/ OWNER_DECISION \/ לא שולם/.test(gap("STEVEN_COMPLETED_WITHOUT_EXPENSE_HISTORY").description) && !/STILL OPEN/.test(gap("STEVEN_COMPLETED_WITHOUT_EXPENSE_HISTORY").description));
  ok("A11 mix orphans: the ₪590 is the real 'My Life' payment (linked, שולם); the ₪650 sync copy בוטל → CLOSED, never shown as an open problem", gap("MIX_ORPHAN_EXPENSES").status === "CONFLICT_REQUIRES_OWNER_DECISION" ? false : gap("MIX_ORPHAN_EXPENSES").status === "CLOSED_NOW" && /a975dfac/.test(gap("MIX_ORPHAN_EXPENSES").description) && /7fc4dfba\) is kept as history, בוטל/.test(gap("MIX_ORPHAN_EXPENSES").description) && !/STILL OPEN/.test(gap("MIX_ORPHAN_EXPENSES").description) && !/₪590 ששולמה בלי עבודה מקושרת/.test(read("lib/partner/system/mix.ts")));
  ok("A11 Studio $: $150 + $200 + $550 = $900 expected, all recorded → CLOSED", gap("STUDIO_UNPAID_MIX_EXPENSE_USD").status === "CLOSED_NOW" && /\$150 \+ \$200 \+ \$550 = \$900/.test(gap("STUDIO_UNPAID_MIX_EXPENSE_USD").description) && !/\$1,500/.test(gap("STUDIO_UNPAID_MIX_EXPENSE_USD").description) && !/לעבודה העצמאית של \$550 אין הוצאה/.test(read("lib/partner/system/mix.ts")));
  ok("A11 meetings: no '2 past meetings still נקבעה' any more — one meeting, התקיימה, with its event; the outcome-field gaps stay open (a real model gap)", !/2 הפגישות שרשומות עברו ועדיין/.test(read("lib/partner/system/clients.ts")) && !/both production meetings are past and still/.test(gap("WK_MEETING_OUTCOME_NOT_RECORDED").description) && !/^2 production meetings are past/.test(gap("CLI_MEETING_OUTCOME_NOT_RECORDED").ownerImpact) && gap("WK_MEETING_OUTCOME_NOT_RECORDED").status === "DATA_NOT_RECORDED" && gap("CLI_MEETING_OUTCOME_NOT_RECORDED").status === "DATA_NOT_RECORDED" && /התקיימה/.test(gap("WK_MEETING_OUTCOME_NOT_RECORDED").description));
  ok("Media ↔ Finance: new incomes linked by the model; Mobile1 legacy by decision (not called a schema gap any more)", gap("LBL_MEDIA_FINANCE_LINK").status === "PARTIALLY_CLOSED" && gap("LBL_MEDIA_FINANCE_LINK").appRemediation === "NONE" && /BY OWNER DECISION/.test(gap("LBL_MEDIA_FINANCE_LINK").description));
  ok("mix writers: ONE writer (the linked expense is no longer a two-writer CONFLICT)", /F\(W, "linked_transaction_id", "CANONICAL", "The ONE Finance expense linked to this work, written by ONE writer/.test(read("lib/partner/system/mix.ts")));
  ok("meeting ↔ calendar: edit / delete follow (IMPLEMENTATION_BEHAVIOR); the status-cancel residue stays named", /R\("MEETING_EVENT_STALE", "IMPLEMENTATION_BEHAVIOR"/.test(read("lib/partner/system/registry.ts")) && /R\("MEETING_EVENT_NOT_SYNCED", "IMPLEMENTATION_BEHAVIOR"/.test(read("lib/partner/system/work-domains.ts")) && /MEETING_CANCELLED_EVENT_KEPT/.test(read("lib/partner/system/work-domains.ts")) && /updateCalendarEvent\(data\.calendar_event_id/.test(read("lib/writes/meetings.ts")) && /deleteCalendarEvent\(m\.calendar_event_id\)/.test(read("lib/writes/meetings.ts")));
  ok("Avi 01.08 (Luna): the ledger has the realized 750 + the payment 750 — the 'no ledger row' finding is gone", !/אין לה שורת מאזן/.test(read("lib/partner/system/shows.ts")) && /לונה, 01\.08/.test(read("lib/partner/system/shows.ts")));

  console.log("\nNo swallowed money write is left in the hardened files");
  const sfs = read("lib/shows-finance-sync.ts");
  ok("shows-finance-sync: no console.error-and-continue on a money write", !/console\.error\("\[shows-finance-sync\]/.test(sfs) && !/catch \(e\) \{\s*console\.error/.test(sfs));
  ok("patchTransaction checks the error AND that exactly one row changed", /if \(!data \|\| data\.length !== 1\) throw new ShowFinanceSyncError\("עדכון שורת כספים"/.test(sfs));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
