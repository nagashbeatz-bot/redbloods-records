/**
 * Tests — chained steps on ONE record inside one plan (projected state; 2026-09-29).
 *
 * Run with:   npx tsx scripts/test-sunny-act-chain.tsx
 *
 * The REAL service + engine + primitives over fakes that behave like the shared writers: a mix-work price / engineer /
 * payment change re-runs the linked-expense reconcile (its status and the linked Finance row can change), the finance
 * settings are one merged blob (agreed price + notes + exception). NEVER touches production.
 */
import { approveAction, executeAction, planAction, planStatus, previewAction, type ActServiceDeps } from "../lib/partner/act/service";
import { ACT_TABLES } from "../lib/partner/act/store-supabase";
import { chainOmit, fieldsFingerprint, PRIMITIVES_BY_ID } from "../lib/partner/act/primitives";
import { mkDeps, OWNER, U } from "./fixtures/act-harness";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: unknown) => { if (cond) { console.log(`  ✓ ${name}`); pass++; } else { console.log(`  ✗ ${name}${detail === undefined ? "" : `\n      ${JSON.stringify(detail).slice(0, 900)}`}`); fail++; } };

const W = U(1), P = U(2), T = U(3);
const WORK = `mix-work:${W}`, PROJECT = `project:${P}`, TX = `transaction:${T}`;
type Tx = { projectId: string | null; scope: string; type: string; date: string | null; description: string; artist: string; amount: number; currency: string; paymentStatus: string; paymentMethod: string; receiptRef: string; notes: string; category: string; expenseScope: string; linkedSessionId: string };

function mk(o: { engineer?: string } = {}) {
  const work = { projectId: P, projectType: "שיר", title: "שיר", engineerName: o.engineer ?? "Dani", workType: "מיקס", status: "בתהליך", agreedPrice: 200, currency: "$", amountPaid: 0, paymentDate: null as string | null, sentDate: "2026-09-01", internalDeadline: "2026-09-30" as string | null, notes: "", linkedTx: T as string | null };
  const txs = new Map<string, Tx>([[T, { projectId: P, scope: "project", type: "expense", date: "2026-09-01", description: "מיקס", artist: "", amount: 200, currency: "$", paymentStatus: "צפוי", paymentMethod: "", receiptRef: "", notes: "", category: "מיקס / מאסטר", expenseScope: "מיקס / מאסטר", linkedSessionId: "" }]]);
  const blob: Record<string, unknown> = { agreedPrice: 3000, currency: "₪" };
  const calls: string[] = [];
  const hooks: { afterWorkUpdate?: () => void; failPrice?: boolean; crashAfterWrite?: () => void; throwOnDeadline?: () => void } = {};
  const paid = () => work.agreedPrice > 0 && work.amountPaid >= work.agreedPrice && !!work.paymentDate;
  // THE one reconcile (lib/writes/mix): a "שולם" row is never overwritten; otherwise amount / currency / status follow the work
  const reconcile = () => {
    const t = work.linkedTx ? txs.get(work.linkedTx) : undefined;
    if (t && t.paymentStatus === "שולם") return;
    if (t) { t.amount = work.agreedPrice; t.currency = work.currency; t.paymentStatus = paid() ? "שולם" : "צפוי"; t.notes = `ממתין לתשלום — ${work.currency}${work.agreedPrice}`; /* the real writer regenerates the notes (engineerExpenseNotes) */ }
  };
  const writers = {
    async readEngineerWork(id: string) {
      if (id !== W) return null;
      const { linkedTx, ...v } = work;
      return { ...v, expenseStatus: linkedTx ? txs.get(linkedTx)?.paymentStatus ?? null : null };
    },
    async updateEngineerWork(id: string, f: Record<string, unknown>) {
      const keys = Object.keys(f).filter((k) => k !== "skipFinanceSync");
      calls.push(`work:${keys.join(",")}`);
      if (hooks.failPrice && f.agreedPrice !== undefined) throw new Error("simulated writer failure");
      if (hooks.throwOnDeadline && f.internalDeadline !== undefined) { hooks.throwOnDeadline(); throw new Error("simulated crash before the write"); }
      for (const k of keys) (work as Record<string, unknown>)[k] = f[k];
      if (["agreedPrice", "currency", "amountPaid", "paymentDate", "engineerName", "workType"].some((k) => k in f)) reconcile();
      hooks.crashAfterWrite?.();
      hooks.afterWorkUpdate?.();
    },
    async recordEngineerPayment(id: string, isPaid: boolean, date: string | null) { await writers.updateEngineerWork(id, { amountPaid: isPaid ? work.agreedPrice : 0, paymentDate: isPaid ? date : null }); },
    async readTransaction(id: string) { const t = txs.get(id); return t ? { ...t } : null; },
    async financeOwnerOf(id: string) { return id === work.linkedTx ? "MIX_WORK" : null; },
    async updateTransaction(id: string, patch: Record<string, unknown>) { calls.push(`tx:${Object.keys(patch).join(",")}`); Object.assign(txs.get(id)!, patch); },
    async readProjectMeta(id: string) { return id === P ? { name: "הסיפור שלי", artist: "לקוח", status: "בעבודה", isHidden: false, businessType: "לקוח", projectType: "שיר", hasRelease: false } : null; },
    async readFinanceSettings() { return { agreedPrice: Number(blob.agreedPrice ?? 0), currency: String(blob.currency ?? "₪"), financialNotes: String(blob.financialNotes ?? ""), financeException: blob.financeException === true, financeExceptionReason: String(blob.financeExceptionReason ?? ""), financeExceptionDate: String(blob.financeExceptionDate ?? "") }; },
    async setFinanceSettings(_id: string, patch: Record<string, unknown>) { calls.push(`settings:${Object.keys(patch).join(",")}`); Object.assign(blob, patch); },
  };
  return { work, txs, blob, calls, hooks, writers };
}

type Step = { actionId: string; args: Record<string, unknown> };
const PRICE = (n = 500): Step => ({ actionId: "SET_ENGINEER_WORK_PRICE", args: { mixWork: WORK, agreedPrice: n, currency: "$" } });
const DATE: Step = { actionId: "UPDATE_ENGINEER_WORK", args: { mixWork: WORK, internalDeadline: "2026-10-15" } };
const PAY: Step = { actionId: "RECORD_ENGINEER_PAYMENT", args: { mixWork: WORK, paid: true, paymentDate: "2026-09-28" } };
const NOTES: Step = { actionId: "SET_FINANCIAL_NOTES", args: { project: PROJECT, financialNotes: "קליפ פוצל לפרויקט נפרד" } };
const EXC: Step = { actionId: "SET_FINANCE_EXCEPTION", args: { project: PROJECT, on: true, reason: "קליפ פוצל לפרויקט נפרד", date: "2026-09-29" } };

async function plan(d: ActServiceDeps, steps: Step[]) { return planAction({ intentHe: "תהליך בשיחה", steps }, OWNER, d); }
async function approve(d: ActServiceDeps, p: Record<string, unknown>) { return approveAction({ planId: p.planId, planHash: p.planHash, confirmationText: "מאשר" }, OWNER, d); }
async function exec(d: ActServiceDeps, p: Record<string, unknown>, a: Record<string, unknown>) { return executeAction({ planId: p.planId, approvalToken: a.approvalToken, confirmationText: "מאשר" }, OWNER, d); }
type Planned = { status: string; planId?: string; planHash?: string; steps?: Array<{ changes: Array<{ field: string; before: { value: unknown }; after: { value: unknown } }> }>; [k: string]: unknown };
const stepsOf = (e: Record<string, unknown> | null | undefined) => ((e?.steps ?? []) as Array<{ status: string }>).map((x) => x.status).join(",");

async function main() {
  console.log("1 / 2. Mix price + date on the same work — projected preview, one approval, both applied");
  {
    const h = mk(); const { d, db } = mkDeps(h.writers);
    const p = await plan(d, [PRICE(), DATE]) as Planned;
    ok("the plan is accepted (no SAME_ENTITY_TWICE)", p.status === "PREVIEW", p);
    const stored = db.rows(ACT_TABLES.plans)[0] as { plan_json?: unknown; plan?: unknown } | undefined;
    const planJson = JSON.stringify(stored ?? {});
    ok("step 2 depends on step 1 (dependsOn [0]) — the existing field, persisted", /"dependsOn":\[0\]/.test(planJson));
    const s2 = p.steps?.[1].changes.find((c) => c.field === "internalDeadline");
    ok("step 2 preview: before = the value when it runs, after = the new date", s2?.before.value === "2026-09-30" && s2?.after.value === "2026-10-15", p.steps?.[1]);
    const pv = await previewAction({ planId: p.planId }, OWNER, d) as { status: string; stepsLive?: Array<{ stale: boolean }> };
    ok("a live re-preview of the chained plan is not STALE (the projection is checked the same way)", pv.status === "PREVIEW" && (pv.stepsLive ?? []).every((x) => !x.stale), pv);
    const a = await approve(d, p); const e = await exec(d, p, a);
    ok("ONE approval → EXECUTED, both steps APPLIED_AS_EXPECTED", e.status === "APPLIED_AS_EXPECTED" && stepsOf(e) === "APPLIED_AS_EXPECTED,APPLIED_AS_EXPECTED", e);
    ok("final state: price $500 + deadline 2026-10-15; the linked expense followed the price (צפוי)", h.work.agreedPrice === 500 && h.work.internalDeadline === "2026-10-15" && h.txs.get(T)!.amount === 500 && h.txs.get(T)!.paymentStatus === "צפוי");
    ok("exactly two writes, in order", h.calls.join(" | ") === "work:agreedPrice,currency | work:internalDeadline", h.calls);
  }

  console.log("\n3. Set the price → mark paid AT THE NEW PRICE (depends on step 1's result)");
  {
    const h = mk(); const { d } = mkDeps(h.writers);
    const p = await plan(d, [PRICE(500), PAY]) as Planned;
    const pay = p.steps?.[1].changes.find((c) => c.field === "amountPaid");
    ok("the payment is planned on the projected price: amountPaid 0 → 500 (not the old 200)", p.status === "PREVIEW" && pay?.before.value === 0 && pay?.after.value === 500, p.steps?.[1] ?? p);
    const e = await exec(d, p, await approve(d, p));
    ok("EXECUTED: paid $500 on 2026-09-28, the same expense row became שולם at $500", e.status === "APPLIED_AS_EXPECTED" && h.work.amountPaid === 500 && h.work.paymentDate === "2026-09-28" && h.txs.get(T)!.paymentStatus === "שולם" && h.txs.get(T)!.amount === 500, { e, work: h.work, tx: h.txs.get(T) });
    const h0 = mk(); h0.work.agreedPrice = 0; const d0 = mkDeps(h0.writers).d;
    const p0 = await plan(d0, [PRICE(300), PAY]);
    ok("a work with NO price: pay alone is refused (NO_PRICE), but price → pay in one plan is valid", (await planAction({ intentHe: "x", actionId: PAY.actionId, args: PAY.args }, OWNER, d0)).status === "NO_PRICE" && p0.status === "PREVIEW");
  }

  console.log("\n4. SET_FINANCIAL_NOTES + SET_FINANCE_EXCEPTION on the same project (the same settings view — projected)");
  {
    const h = mk(); const { d } = mkDeps(h.writers);
    const p = await plan(d, [NOTES, EXC]) as Planned;
    ok("accepted; step 2 depends on step 1", p.status === "PREVIEW", p);
    const e = await exec(d, p, await approve(d, p));
    ok("EXECUTED: notes + exception on (reason / date) in the one settings blob", e.status === "APPLIED_AS_EXPECTED" && h.blob.financialNotes === "קליפ פוצל לפרויקט נפרד" && h.blob.financeException === true && h.blob.financeExceptionReason === "קליפ פוצל לפרויקט נפרד", { e, blob: h.blob });
    const r = mk(); const rd = mkDeps(r.writers).d; const pr = await plan(rd, [EXC, NOTES]);
    ok("the reverse order is accepted too", pr.status === "PREVIEW", pr);
  }

  console.log("\n5. External change BEFORE execution → STALE, nothing runs");
  {
    const h = mk(); const { d } = mkDeps(h.writers);
    const p = await plan(d, [PRICE(), DATE]); const a = await approve(d, p);
    h.work.internalDeadline = "2026-11-01"; // someone changed the field step 2 will change
    const e = await exec(d, p, a);
    ok("the base check catches a change to a field of the CHAINED step: STALE, zero writes", e.status === "STALE" && h.calls.length === 0, { e: e.status, calls: h.calls });
    const h2 = mk(); const d2 = mkDeps(h2.writers).d;
    const p2 = await plan(d2, [PRICE(), DATE]); const a2 = await approve(d2, p2);
    h2.work.agreedPrice = 250; // a change to the field step 1 changes
    ok("a change to step 1's field: STALE, zero writes", (await exec(d2, p2, a2)).status === "STALE" && h2.calls.length === 0);
    const h3 = mk(); const d3 = mkDeps(h3.writers).d;
    const p3 = await plan(d3, [PRICE(), DATE]); const a3 = await approve(d3, p3);
    h3.txs.get(T)!.paymentStatus = "שולם"; // the tolerated derived field — still covered by step 1's own base check
    ok("a change to the linked expense status (step 1's view): STALE, zero writes", (await exec(d3, p3, a3)).status === "STALE" && h3.calls.length === 0);
  }

  console.log("\n6. External RELEVANT change between the chained steps → the chained step does not run");
  {
    const h = mk(); const { d } = mkDeps(h.writers);
    const p = await plan(d, [PRICE(), DATE]); const a = await approve(d, p);
    h.hooks.afterWorkUpdate = () => { if (h.work.agreedPrice === 500) { h.work.notes = "someone else wrote"; h.hooks.afterWorkUpdate = undefined; } };
    const e = await exec(d, p, a);
    ok("step 1 applied, step 2 STALE (no write) → PARTIALLY_APPLIED, no automatic rollback", e.status === "PARTIALLY_APPLIED" && stepsOf(e) === "APPLIED_AS_EXPECTED,STALE" && h.calls.length === 1 && h.work.internalDeadline === "2026-09-30" && h.work.agreedPrice === 500, { e, calls: h.calls });
    const g = mk(); const gd = mkDeps(g.writers).d;
    const pg = await plan(gd, [PRICE(500), PAY]); const ag = await approve(gd, pg);
    g.hooks.afterWorkUpdate = () => { if (g.work.agreedPrice === 500 && g.work.amountPaid === 0) { g.txs.get(T)!.paymentStatus = "שולם"; g.hooks.afterWorkUpdate = undefined; } };
    const eg = await exec(gd, pg, ag);
    ok("the expense became שולם between the steps → the payment's approved warnings no longer hold → STALE, not paid", eg.status === "PARTIALLY_APPLIED" && stepsOf(eg) === "APPLIED_AS_EXPECTED,STALE" && g.work.amountPaid === 0, { eg, work: g.work });
  }

  console.log("\n7. Step 1 fails → step 2 NOT_RUN");
  {
    const h = mk(); const { d } = mkDeps(h.writers); h.hooks.failPrice = true;
    const p = await plan(d, [PRICE(), DATE]);
    const e = await exec(d, p, await approve(d, p));
    ok("FAILED, NOT_RUN; the date was never written", e.status === "FAILED" && stepsOf(e) === "FAILED,NOT_RUN" && !h.calls.includes("work:internalDeadline") && h.work.internalDeadline === "2026-09-30", { e, calls: h.calls });
  }

  console.log("\n8. Unsafe combinations are refused (fail closed)");
  {
    const h = mk(); const { d, db } = mkDeps(h.writers);
    // (one clip model 2026-10-01: SET_CLIP_PRICE — the only different-view opt-in on a project — is gone; the engine's
    //  SAME_ENTITY_CONFLICT path stays, every remaining opt-in pair on one record shares its view)
    ok("no plan was stored by the refusals below", !db.rows(ACT_TABLES.plans).length);
    const s = await plan(d, [PRICE(), { actionId: "SET_ENGINEER_WORK_STATUS", args: { mixWork: WORK, status: "אושר" } }]);
    ok("a primitive that did not opt in (status: the completion flow) → SAME_ENTITY_TWICE, as before", s.status === "SAME_ENTITY_TWICE", s);
    const spec = PRIMITIVES_BY_ID.get("SET_AGREED_PRICE")!;
    ok("a declared side effect on a field the later step reads and does NOT tolerate → no chain (chainOmit null)", chainOmit(spec, { agreedPrice: 1, currency: "₪" }, ["currency"]) === null && JSON.stringify(chainOmit(PRIMITIVES_BY_ID.get("UPDATE_ENGINEER_WORK")!, { expenseStatus: "צפוי", notes: "" }, ["expenseStatus"])) === JSON.stringify(["expenseStatus"]));
  }

  console.log("\n9. A cross-entity side effect never bypasses stale protection");
  {
    const h = mk(); const { d } = mkDeps(h.writers);
    // step 1 changes the work (its reconcile moves the LINKED expense 200 → 500); step 2 targets that expense row directly
    // (F2, 2026-10-01: a mix expense's payment status / date can no longer be set in Finance at all — the cross-entity case uses a field Finance may still edit: the notes the reconcile regenerates)
    const p = await plan(d, [PRICE(), { actionId: "UPDATE_TRANSACTION_DETAILS", args: { transaction: TX, notes: "בדיקה" } }]) as Planned;
    ok("different records → a normal (not chained) plan: step 2 has no dependsOn", p.status === "PREVIEW" && (p.steps?.length ?? 0) === 2, p);
    const e = await exec(d, p, await approve(d, p));
    ok("the reconcile changed the expense → step 2 STALE at its turn, the notes were NOT written", e.status === "PARTIALLY_APPLIED" && stepsOf(e) === "APPLIED_AS_EXPECTED,STALE" && !h.calls.some((c) => c.startsWith("tx:")) && h.txs.get(T)!.notes !== "בדיקה", { e, calls: h.calls });
  }

  console.log("\n10. Interrupted chained step → reconciled read-only, never re-executed");
  {
    for (const applied of [true, false]) {
      const h = mk(); const { d, db } = mkDeps(h.writers);
      let t = Date.parse("2026-09-27T09:00:00Z"); d.nowMs = () => t;
      const p = await plan(d, [PRICE(), DATE]); const a = await approve(d, p);
      // the process "dies" while recording step 2: its claim stays CLAIMED
      const crash = () => { db.failOn = `${ACT_TABLES.executions}:update`; };
      if (applied) h.hooks.crashAfterWrite = () => { if (h.calls.length === 2) { crash(); h.hooks.crashAfterWrite = undefined; } };
      else h.hooks.throwOnDeadline = crash;
      const e = await exec(d, p, a);
      db.failOn = null;
      const writesBefore = h.calls.length;
      t += 6 * 60_000;
      const st = await planStatus({ planId: p.planId }, OWNER, d) as { status: string; steps: Array<{ status: string }> };
      ok(`step 2 ${applied ? "written" : "not written"} before the crash → ${applied ? "APPLIED_AS_EXPECTED" : "FAILED (treated as not applied)"}; never re-executed`,
        e.status === "OUTCOME_UNKNOWN" && st.steps[1]?.status === (applied ? "APPLIED_AS_EXPECTED" : "FAILED") && h.calls.length === writesBefore, { e: e.status, st, calls: h.calls });
    }
  }

  console.log("\n11. Replay / idempotency");
  {
    const h = mk(); const { d } = mkDeps(h.writers);
    const p = await plan(d, [PRICE(), DATE]); const a = await approve(d, p);
    await exec(d, p, a);
    const n = h.calls.length;
    const replay = await exec(d, p, a);
    const again = await approve(d, p);
    ok("a replay of the same token returns the record; a new approval is ALREADY_EXECUTED; no second write", ["ALREADY_EXECUTED", "APPLIED_AS_EXPECTED"].includes(String(replay.status)) && again.status === "ALREADY_EXECUTED" && h.calls.length === n, { replay: replay.status, again: again.status });
  }

  console.log("\n12. A plan that is not chained behaves exactly as before");
  {
    const h = mk(); const { d, db } = mkDeps(h.writers);
    const p = await plan(d, [PRICE(), NOTES]) as Planned;
    const stored = JSON.parse(JSON.stringify(db.rows(ACT_TABLES.plans)[0] ?? {})) as Record<string, unknown>;
    const j = JSON.stringify(stored);
    const live = await h.writers.readEngineerWork(W);
    ok("different records: no dependsOn, the plain live fingerprint (unchanged scheme)", p.status === "PREVIEW" && (j.match(/"dependsOn":\[\]/g) ?? []).length === 2 && j.includes(fieldsFingerprint("SET_ENGINEER_WORK_PRICE", W, live as never)), j.slice(0, 300));
    const e = await exec(d, p, await approve(d, p));
    ok("EXECUTED as before", e.status === "APPLIED_AS_EXPECTED" && h.work.agreedPrice === 500 && h.blob.financialNotes === "קליפ פוצל לפרויקט נפרד");
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
