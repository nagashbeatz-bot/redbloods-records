/**
 * "Your salary was paid" push to Victor (P_VICTOR_SALARY_PAID, Owner spec 2026-10-17): when a salary month's Finance row
 * (linked_session_id victor_salary_<YYYY-MM>) REALLY moves to שולם, Victor gets ONE push per month in his portal language
 * (en default / ru), the month only (no amount); the Owner gets an ack only after Victor's push was delivered. A month due
 * more than 45 days ago never pushes. ONE shared notifier (lib/victor-salary-paid-notify) behind the three writers: a Finance
 * edit (updateTransactionRecord), recordVictorSalaryMonth (historic paid), an executed RECORD_PAID_EXPENSE.
 * The REAL lib/writes/finance + lib/writes/victor + lib/push + the notifier run on an in-memory database with web-push and
 * the claim store doubled (no production, no network, no real push).
 * Run with:   npx tsx scripts/test-victor-salary-paid-push.tsx
 */
import Module from "node:module";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { memoryClaimStore } from "./fixtures/claim-store";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: unknown) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 600)}` : ""}`); } };
const read = (p: string) => fs.readFileSync(path.resolve(__dirname, "..", p), "utf8");

// ── an in-memory PostgREST-ish fake (only what these writers use) ────────────────────────────────────────────────
type Row = Record<string, unknown>;
const DB: Record<string, Row[]> = {};
const t = (name: string) => (DB[name] ??= []);
function from(table: string) {
  const filters: Array<(r: Row) => boolean> = [];
  let mode: "select" | "update" | "delete" | "insert" | "upsert" = "select", patch: Row | null = null, ins: Row | null = null, one = false, lim: number | null = null;
  const run = () => {
    if (mode === "insert") { const r = { id: randomUUID(), ...ins }; t(table).push(r); return { data: one ? { ...r } : [{ ...r }], error: null }; }
    if (mode === "upsert") { const ex = t(table).find((r) => r.key === ins!.key); if (ex) Object.assign(ex, ins); else t(table).push({ ...ins }); return { data: null, error: null }; }
    let rows = t(table).filter((r) => filters.every((f) => f(r)));
    if (mode === "update") for (const r of rows) Object.assign(r, patch);
    if (mode === "delete") DB[table] = t(table).filter((r) => !rows.includes(r));
    if (lim !== null) rows = rows.slice(0, lim);
    const data = rows.map((r) => ({ ...r }));
    return { data: one ? data[0] ?? null : data, error: null, count: data.length };
  };
  const c: Record<string, unknown> = {
    select() { return c; },
    eq(k: string, v: unknown) { filters.push((r) => r[k] === v); return c; },
    neq(k: string, v: unknown) { filters.push((r) => r[k] !== v); return c; },
    in(k: string, vs: unknown[]) { filters.push((r) => vs.includes(r[k])); return c; },
    like(k: string, p: string) { const parts = p.split("%"); filters.push((r) => { const v = String(r[k] ?? ""); let at = 0; return parts.every((s, i) => { if (i === 0) { if (!v.startsWith(s)) return false; at = s.length; return true; } const j = v.indexOf(s, at); if (j < 0) return false; at = j + s.length; return i < parts.length - 1 || s === "" || v.endsWith(s); }); }); return c; },
    is(k: string, v: unknown) { filters.push((r) => (v === null ? r[k] == null : r[k] === v)); return c; },
    order() { return c; },
    limit(n: number) { lim = n; return c; },
    single() { one = true; return Promise.resolve(run()); },
    maybeSingle() { one = true; return Promise.resolve(run()); },
    then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) { return Promise.resolve(run()).then(res, rej); },
  };
  return {
    select: () => c,
    insert(r: Row) { mode = "insert"; ins = { created_at: new Date().toISOString(), ...r }; return c; },
    upsert(r: Row) { mode = "upsert"; ins = r; return c; },
    update(p: Row) { mode = "update"; patch = p; return c; },
    delete() { mode = "delete"; return c; },
  };
}

type Mode = "ok" | "fail" | "none";
type PushCall = { role: string; payload: { title: string; body: string; url?: string; tag?: string } };
const PUSH: { calls: PushCall[]; victor: Mode; owner: Mode; allowed: boolean } = { calls: [], victor: "ok", owner: "ok", allowed: true };
const CLAIMS = memoryClaimStore();
const ML = Module as unknown as { _load(request: string, parent: unknown, isMain: boolean): unknown };
const orig = ML._load;
ML._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === "server-only") return {};
  if (/(^|\/)supabase$/.test(request)) return { supabase: { from } };
  if (/(^|[\\/])push-claims(\.[cm]?[jt]s)?$/.test(request)) return { settingsClaimStore: CLAIMS, pushAllowed: () => PUSH.allowed };
  if (request === "@supabase/supabase-js") return { createClient: () => ({ from }) };
  if (request === "web-push") return {
    setVapidDetails() { /* */ },
    sendNotification(sub: { endpoint: string }, json: string) {
      const role = String((t("push_subscriptions").find((r) => r.endpoint === sub.endpoint) as Row).role);
      PUSH.calls.push({ role, payload: JSON.parse(json) });
      return (role === "victor" ? PUSH.victor : PUSH.owner) === "fail" ? Promise.reject({ statusCode: 500 }) : Promise.resolve({ statusCode: 201 });
    },
  };
  return orig.call(this, request, parent, isMain);
};
const reset = (o: Partial<typeof PUSH> = {}) => {
  PUSH.calls = []; PUSH.victor = "ok"; PUSH.owner = "ok"; PUSH.allowed = true; Object.assign(PUSH, o);
  CLAIMS.data.clear(); CLAIMS.writes.length = 0;
  DB["push_subscriptions"] = [
    ...((PUSH.victor as Mode) === "none" ? [] : [{ id: "s1", endpoint: "ep-victor", p256dh: "k", auth: "a", role: "victor", user_id: "u-victor" }]),
    ...((PUSH.owner as Mode) === "none" ? [] : [{ id: "s2", endpoint: "ep-owner", p256dh: "k", auth: "a", role: "owner", user_id: "u-owner" }]),
  ];
  DB["notifications"] = []; DB["transactions"] = []; DB["settings"] = [];
};
const toVictor = () => PUSH.calls.filter((c) => c.role === "victor");
const toOwner = () => PUSH.calls.filter((c) => c.role === "owner");

(async () => {
  const Pure = await import("../lib/victor-salary-paid-notify-pure");
  const N = await import("../lib/victor-salary-paid-notify");
  const V = await import("../lib/writes/victor");
  const F = await import("../lib/writes/finance");
  const { ilYmd } = await import("../lib/push-claims-pure");
  const today = ilYmd(Date.now());
  const ym = (back: number) => { const d = new Date(Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1 - back, 1)); return d.toISOString().slice(0, 7); };
  const FRESH = ym(1); // due the 10th of this month → never more than ~21 days late
  const OLD = ym(6);
  const salaryRow = (workMonth: string, status: string): Row => { const r = { id: randomUUID(), type: "expense", scope: "general", project_id: null, amount: 550, currency: "$", payment_status: status, linked_session_id: `victor_salary_${workMonth}`, category: "צוות", expense_scope: "כללי", notes: "", date: `${workMonth}-28` }; t("transactions").push(r); return r; };
  const claim = (m: string) => CLAIMS.data.get(`victor_salary_paid_pushed_${m}`) as { status?: string } | undefined;
  const financePay = async (id: string) => { try { await F.updateTransactionRecord(id, { paymentStatus: "שולם" } as never); } catch { /* later share / unit syncs on the fake — the push runs before them */ } };

  console.log("Pure rules (lib/victor-salary-paid-notify-pure)");
  ok("a real transition: not paid → שולם; a new row (before null) counts", Pure.isSalaryRealPaidTransition("לא שולם", "שולם") && Pure.isSalaryRealPaidTransition(null, "שולם"));
  ok("a re-save of a שולם row is not a transition", !Pure.isSalaryRealPaidTransition("שולם", "שולם"));
  ok("the month comes only from the canonical key", Pure.salaryMonthOfLinkedId("victor_salary_2026-09") === "2026-09" && Pure.salaryMonthOfLinkedId("victor_salary_2026-13") === null && Pure.salaryMonthOfLinkedId("x") === null);
  const el = (m: string, todayYmd: string) => Pure.victorSalaryEligibility({ linkedSessionId: `victor_salary_${m}`, type: "expense", status: "שולם", todayYmd });
  ok("45-day window: September (due 10.10) is eligible on 24.11 (45 days late)", el("2026-09", "2026-11-24").ok);
  ok("45-day window: September is historical on 25.11 (46 days late)", (el("2026-09", "2026-11-25") as { reason?: string }).reason === "historical_month");
  ok("an income / not-paid row is never eligible", !Pure.victorSalaryEligibility({ linkedSessionId: "victor_salary_2026-09", type: "income", status: "שולם", todayYmd: "2026-10-12" }).ok && !Pure.victorSalaryEligibility({ linkedSessionId: "victor_salary_2026-09", type: "expense", status: "לא שולם", todayYmd: "2026-10-12" }).ok);
  const en = Pure.buildVictorSalaryPush("2026-09", "en"), ru = Pure.buildVictorSalaryPush("2026-09", "ru");
  ok("English message names the month only", en.body === "Your salary for September 2026 has been paid. Thank you!", en);
  ok("Russian message", /сентябрь 2026/.test(ru.body) && /выплачена/.test(ru.body), ru);
  ok("no amount / currency in Victor's message", !/\d{3}|\$|₪/.test(en.body.replace("2026", "")) && !/\d{3}|\$|₪/.test(ru.body.replace("2026", "")));
  ok("Owner ack wording", Pure.buildVictorSalaryOwnerAck("2026-09").body === "ויקטור קיבל עדכון שהמשכורת לספטמבר 2026 שולמה.");
  ok("the language is en unless exactly ru", Pure.normalizeVictorPushLang("ru") === "ru" && Pure.normalizeVictorPushLang("he") === "en" && Pure.normalizeVictorPushLang(undefined) === "en");

  console.log("Preview line (Sunny's action layer says exactly what will happen)");
  const pv = (before: string | null, todayYmd = "2026-10-17") => Pure.victorSalaryPushPreviewHe({ linkedSessionId: "victor_salary_2026-09", type: "expense", before, todayYmd });
  ok("P1. unpaid → paid within 45 days: 'יישלח Push לויקטור'", /^יישלח Push לויקטור/.test(pv("לא שולם") ?? ""), pv("לא שולם"));
  ok("P2. already paid: 'לא יישלח Push'", /^לא יישלח Push/.test(pv("שולם") ?? ""));
  ok("P3. due more than 45 days ago: 'לא יישלח Push לויקטור'", /^לא יישלח Push לויקטור/.test(pv("לא שולם", "2026-12-01") ?? ""));
  ok("P4. not a salary row: no line", Pure.victorSalaryPushPreviewHe({ linkedSessionId: "", type: "expense", before: null, todayYmd: "2026-10-17" }) === null);
  const finPrim = read("lib/partner/act/primitives/finance.ts"), vicPrim = read("lib/partner/act/primitives/victor.ts");
  ok("P5. SET_TRANSACTION_STATUS no longer promises 'no Push' unconditionally; its warnings name the push", !/"לא יישלח Push או הודעה"\],\s*\},\s*\{\s*\/\/ task 4/.test(finPrim) && /\.\.\.statusPushWarnings\(c, a\)/.test(finPrim));
  ok("P6. RECORD_VICTOR_SALARY_MONTH no longer says 'לא יישלח Push' unconditionally", !/לא מחוברים; לא יישלח Push"/.test(vicPrim) && /victorSalaryPushPreviewHe\(/.test(vicPrim));

  console.log("1. Finance edit → paid: one push to Victor + the Owner ack");
  reset();
  const r1 = salaryRow(FRESH, "לא שולם");
  await financePay(String(r1.id));
  ok("1a. Victor got exactly one push", toVictor().length === 1, PUSH.calls);
  ok("1b. it opens /team/victor", toVictor()[0]?.payload.url === "/team/victor");
  ok("1c. the Owner got the ack after delivery", toOwner().length === 1 && /ויקטור קיבל עדכון/.test(toOwner()[0].payload.body));
  ok("1d. the month claim is sent", claim(FRESH)?.status === "sent", claim(FRESH));

  console.log("2. a re-save of the same paid row → no push");
  PUSH.calls = [];
  await financePay(String(r1.id));
  ok("2a. nothing sent", PUSH.calls.length === 0, PUSH.calls);

  console.log("3. un-pay → pay again → no second push");
  try { await F.updateTransactionRecord(String(r1.id), { paymentStatus: "לא שולם" } as never); } catch { /* */ }
  await financePay(String(r1.id));
  ok("3a. nothing sent the second time", PUSH.calls.length === 0, PUSH.calls);

  console.log("4. a back-filled month due more than 45 days ago → no push, no claim");
  reset();
  const r4 = salaryRow(OLD, "לא שולם");
  await financePay(String(r4.id));
  ok("4a. nothing sent", PUSH.calls.length === 0);
  ok("4b. no claim written", !claim(OLD));
  reset();
  const h = await V.recordVictorSalaryMonth({ workMonth: OLD, amount: 550, currency: "$", historicPaid: true });
  ok("4c. 'send to Finance' with historic paid of an old month → no push", h.kind === "ok" && PUSH.calls.length === 0);

  console.log("5. Victor without a device → no sent claim, no Owner ack");
  reset({ victor: "none" });
  const r5 = salaryRow(FRESH, "שולם"); // the writer already committed שולם
  const out5 = await N.notifyVictorSalaryPaid({ txId: String(r5.id), before: "לא שולם" });
  ok("5a. no Owner ack", toOwner().length === 0, PUSH.calls);
  ok("5b. the claim is failed (never sent), so a later real transition may retry", claim(FRESH)?.status === "failed", claim(FRESH));
  ok("5c. the result carries a warning", out5.kind === "attempted" && !!out5.warning);
  ok("5d. the payment stays שולם (the notifier never writes money)", t("transactions").find((r) => r.id === r5.id)?.payment_status === "שולם");

  console.log("6. RECORD_PAID_EXPENSE (a new שולם row) / recordVictorSalaryMonth historic paid → the same push");
  reset();
  const r6 = salaryRow(FRESH, "שולם"); // what the approved finance RPC inserts
  await N.notifyVictorSalaryPaid({ txId: String(r6.id), before: null });
  ok("6a. a newly inserted paid row pushes once", toVictor().length === 1 && toOwner().length === 1, PUSH.calls);
  reset();
  const h6 = await V.recordVictorSalaryMonth({ workMonth: FRESH, amount: 550, currency: "$", historicPaid: true });
  ok("6b. recordVictorSalaryMonth(historicPaid) pushes once", h6.kind === "ok" && toVictor().length === 1, PUSH.calls);
  reset();
  await V.recordVictorSalaryMonth({ workMonth: FRESH, amount: 550, currency: "$" });
  ok("6c. recordVictorSalaryMonth without historic paid (לא שולם) → no push", PUSH.calls.length === 0);
  const svc = read("lib/partner/actions/action-service.ts");
  ok("6d. executeApprovedAction notifies only after an EXECUTED finance result, with before null", /r\.status === "EXECUTED"[\s\S]{0,200}notifyVictorSalaryPaid\(\{ txId: r\.transactionId, before: null \}\)/.test(svc));

  console.log("7. the language Victor chose in his portal");
  reset();
  await N.rememberVictorPushLang("ru");
  const r7 = salaryRow(FRESH, "לא שולם");
  await financePay(String(r7.id));
  ok("7a. Russian push", /выплачена/.test(toVictor()[0]?.payload.body ?? ""), toVictor());
  await N.rememberVictorPushLang("he");
  ok("7b. Hebrew is not a Victor language — ignored (stays ru)", (t("settings").find((r) => r.key === "victor_push_lang")?.value as { lang?: string })?.lang === "ru");
  reset();
  const r7b = salaryRow(FRESH, "לא שולם");
  await financePay(String(r7b.id));
  ok("7c. no language recorded → English", /has been paid/.test(toVictor()[0]?.payload.body ?? ""), toVictor());

  console.log("8. guards");
  reset({ allowed: false });
  const r8 = salaryRow(FRESH, "לא שולם");
  await financePay(String(r8.id));
  ok("8a. non-production: nothing sent, no claim", PUSH.calls.length === 0 && !claim(FRESH));
  reset({ owner: "fail" });
  const r8b = salaryRow(FRESH, "לא שולם");
  await financePay(String(r8b.id));
  ok("8b. an Owner-ack failure never re-sends to Victor; the claim stays sent", toVictor().length === 1 && claim(FRESH)?.status === "sent");
  reset();
  const other = { id: randomUUID(), type: "expense", payment_status: "לא שולם", linked_session_id: "", amount: 100, currency: "₪", scope: "general", project_id: null, category: "צוות", expense_scope: "כללי", notes: "" };
  t("transactions").push(other);
  await financePay(other.id);
  ok("8c. a non-salary expense never pushes Victor", PUSH.calls.length === 0);

  const walk = (d: string): string[] => fs.readdirSync(path.resolve(__dirname, "..", d), { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(`${d}/${e.name}`) : /\.(ts|tsx)$/.test(e.name) ? [`${d}/${e.name}`] : []);
  const callers = [...walk("lib"), ...walk("app"), ...walk("components")].filter((f) => /notifyVictorSalaryPaid\(/.test(read(f)) && f !== "lib/victor-salary-paid-notify.ts").sort();
  ok("8d. notifyVictorSalaryPaid( is called only from the three writers", callers.join(",") === ["lib/partner/actions/action-service.ts", "lib/writes/finance.ts", "lib/writes/victor.ts"].join(","), callers);
  const ping = read("app/api/vendor/victor/ping/route.ts");
  ok("8e. the language is remembered only for a victor session (after the role check)", ping.indexOf('!== "victor"') > 0 && ping.indexOf('!== "victor"') < ping.indexOf("rememberVictorPushLang"));
  ok("8f. the salary modal's settings override never notifies", !/victor-salary-paid-notify/.test(read("app/api/vendor/victor/salary/route.ts")));
  const people = read("lib/partner/system/people.ts");
  ok("8g. PUSH_CONTRACTS has P_VICTOR_SALARY_PAID (victor + owner, the module, the month claim)", /id: "P_VICTOR_SALARY_PAID"/.test(people) && /lib\/victor-salary-paid-notify\.ts/.test(people) && /victor_salary_paid_pushed_/.test(people));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
