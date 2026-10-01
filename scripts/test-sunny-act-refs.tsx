/**
 * Tests — `$step<k>.created` references to a record created earlier in the same plan (2026-09-29).
 *
 * Run with:   npx tsx scripts/test-sunny-act-refs.tsx
 *
 * The REAL service + engine + primitives over fakes that behave like the shared writers (project create, finance
 * settings blob per project, transactions). NEVER touches production.
 */
import { approveAction, executeAction, planAction, planStatus, previewAction, type ActServiceDeps } from "../lib/partner/act/service";
import { ACT_TABLES } from "../lib/partner/act/store-supabase";
import { validatePlan } from "../lib/partner/act/plan";
import { ACTION_REGISTRY } from "../lib/partner/act/registry";
import { refSentinelId } from "../lib/partner/act/refs";
import type { Plan } from "../lib/partner/act/types";
import { mkDeps, OWNER, U } from "./fixtures/act-harness";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: unknown) => { if (cond) { console.log(`  ✓ ${name}`); pass++; } else { console.log(`  ✗ ${name}${detail === undefined ? "" : `\n      ${JSON.stringify(detail).slice(0, 900)}`}`); fail++; } };

const P = U(1), TXID = U(2), TX2 = U(3);
const PROJECT = `project:${P}`, TX = `transaction:${TXID}`;
type Tx = { projectId: string | null; scope: string; type: string; date: string | null; description: string; artist: string; amount: number; currency: string; paymentStatus: string; paymentMethod: string; receiptRef: string; notes: string; category: string; expenseScope: string; linkedSessionId: string };
type Meta = { name: string; artist: string; status: string; isHidden: boolean; businessType: string; projectType: string; hasRelease: boolean };

function mk() {
  const projects = new Map<string, Meta>([[P, { name: "בלאגן — שיר", artist: "בלאגן", status: "בעבודה", isHidden: false, businessType: "לקוח", projectType: "שיר", hasRelease: false }]]);
  const blobs = new Map<string, Record<string, unknown>>([[P, { agreedPrice: 5000, currency: "₪" }]]);
  const tx = (id: string, amount: number): [string, Tx] => [id, { projectId: P, scope: "project", type: "income", date: "2026-09-10", description: "מקדמה קליפ", artist: "בלאגן", amount, currency: "₪", paymentStatus: "התקבל", paymentMethod: "", receiptRef: "", notes: "", category: "", expenseScope: "קליפ", linkedSessionId: "" }];
  const txs = new Map<string, Tx>([tx(TXID, 1500), tx(TX2, 1500)]);
  const calls: string[] = [];
  let seq = 900;
  const hooks: { failCreate?: boolean; afterCreate?: () => void; afterMove?: () => void } = {};
  const writers = {
    async countProjectsNamed(name: string) { return [...projects.values()].filter((p) => p.name === name).length; },
    async newProjectBusinessType() { return "לקוח"; },
    async createClientProject(f: { name: string; artist?: string; status?: string; projectType?: string }) {
      calls.push("project:create");
      if (hooks.failCreate) throw new Error("simulated create failure");
      const id = U(++seq);
      projects.set(id, { name: f.name, artist: f.artist ?? "", status: f.status ?? "לא התחיל", isHidden: false, businessType: "לקוח", projectType: f.projectType ?? "", hasRelease: false });
      hooks.afterCreate?.();
      return id;
    },
    async readProjectMeta(id: string) { const p = projects.get(id); return p ? { ...p } : null; },
    async readTransaction(id: string) { const t = txs.get(id); return t ? { ...t } : null; },
    async financeOwnerOf() { return null; },
    async updateTransaction(id: string, patch: Record<string, unknown>) {
      calls.push(`tx:${id === TXID ? "1" : "2"}:${Object.keys(patch).join(",")}`);
      const t = txs.get(id)!;
      if ("project_id" in patch) t.projectId = patch.project_id as string | null;
      if ("scope" in patch) t.scope = String(patch.scope);
      hooks.afterMove?.();
    },
    async readFinanceSettings(id: string) { const b = blobs.get(id) ?? {}; return { agreedPrice: Number(b.agreedPrice ?? 0), currency: String(b.currency ?? "₪"), financialNotes: String(b.financialNotes ?? ""), financeException: b.financeException === true, financeExceptionReason: String(b.financeExceptionReason ?? ""), financeExceptionDate: String(b.financeExceptionDate ?? "") }; },
    async setFinanceSettings(id: string, patch: Record<string, unknown>) { calls.push(`settings:${id === P ? "P" : "new"}`); blobs.set(id, { ...(blobs.get(id) ?? {}), ...patch }); },
  };
  const created = () => [...projects.keys()].filter((k) => k !== P);
  return { projects, blobs, txs, calls, hooks, writers, created };
}

type Step = { actionId: string; args: Record<string, unknown> };
const CREATE: Step = { actionId: "CREATE_PROJECT", args: { name: "קליפ — בלאגן", artist: "בלאגן", projectType: "קליפ" } };
const MOVE = (k = 0, t = TX): Step => ({ actionId: "MOVE_TRANSACTION", args: { transaction: t, toProject: `$step${k}.created` } });
const plan = (d: ActServiceDeps, steps: Step[]) => planAction({ intentHe: "פיצול קליפ", steps }, OWNER, d);
const approve = (d: ActServiceDeps, p: Record<string, unknown>) => approveAction({ planId: p.planId, planHash: p.planHash, confirmationText: "מאשר" }, OWNER, d);
const exec = (d: ActServiceDeps, p: Record<string, unknown>, a: Record<string, unknown>) => executeAction({ planId: p.planId, approvalToken: a.approvalToken, confirmationText: "מאשר" }, OWNER, d);
const stepsOf = (e: Record<string, unknown>) => ((e.steps ?? []) as Array<{ status: string }>).map((x) => x.status).join(",");
const codeOf = (r: Record<string, unknown>) => (r.codes as string[] | undefined)?.[0];

async function main() {
  console.log("1 / 2. CREATE_PROJECT → MOVE_TRANSACTION toProject=$step0.created");
  {
    const h = mk(); const { d, db } = mkDeps(h.writers);
    const p = await plan(d, [CREATE, MOVE()]) as unknown as Record<string, unknown> & { steps: Array<{ changes: Array<{ field: string; after: { value: unknown } }> }>; preview: { duplicateWarningsHe: string[]; requiredConfirmationValues: string[] } };
    ok("one plan, one preview", p.status === "PREVIEW", p);
    const all = JSON.stringify(p);
    ok("2. the preview names the future project in words", p.preview.duplicateWarningsHe.some((w) => w.includes('הפרויקט שייווצר בשלב 1: "קליפ — בלאגן"')) && p.preview.requiredConfirmationValues.some((v) => v.includes('הפרויקט שייווצר בשלב 1: "קליפ — בלאגן"')), p.preview);
    ok("2. the approved change is the reference itself (projectId → $step0.created), never a stand-in id", p.steps[1].changes.find((c) => c.field === "projectId")?.after.value === "$step0.created" && !all.includes(refSentinelId(0)), p.steps[1]);
    const stored = JSON.stringify(db.rows(ACT_TABLES.plans)[0]);
    ok("the stored plan keeps the reference (hash-bound) + dependsOn [0]; the transaction keeps its own fingerprint", stored.includes('"toProject":"$step0.created"') && /"dependsOn":\[0\]/.test(stored) && /"expectedFingerprint":"[0-9a-f]{64}"/.test(stored.slice(stored.indexOf("MOVE_TRANSACTION"))));
    const pv = await previewAction({ planId: p.planId }, OWNER, d) as { status: string; stepsLive?: Array<{ stale: boolean; liveChanges: Array<{ field: string; after: { value: unknown } }> }> };
    ok("a live re-preview is not STALE and still shows the reference", pv.status === "PREVIEW" && (pv.stepsLive ?? []).every((x) => !x.stale) && pv.stepsLive?.[1].liveChanges.find((c) => c.field === "projectId")?.after.value === "$step0.created", pv);
    const e = await exec(d, p, await approve(d, p));
    const newId = h.created()[0];
    ok("1. EXECUTED: the project exists and the transaction moved to IT (the id from step 0's createdKey)", e.status === "APPLIED_AS_EXPECTED" && h.created().length === 1 && h.txs.get(TXID)!.projectId === newId && (e.created as Array<{ createdKey: string }>)[0].createdKey === `project:${newId}`, { e, created: h.created(), tx: h.txs.get(TXID) });
  }

  console.log("\n3. The create fails → the dependent step does not run");
  {
    const h = mk(); h.hooks.failCreate = true; const { d } = mkDeps(h.writers);
    const p = await plan(d, [CREATE, MOVE()]);
    const e = await exec(d, p, await approve(d, p));
    ok("FAILED, NOT_RUN; the transaction was not touched; no id guessed", e.status === "FAILED" && stepsOf(e) === "FAILED,NOT_RUN" && !h.calls.some((c) => c.startsWith("tx:")) && h.txs.get(TXID)!.projectId === P, { e, calls: h.calls });
  }

  console.log("\n4–9. Invalid references → INVALID_PLAN, nothing stored");
  {
    const cases: Array<[string, Step[], string]> = [
      ["4. forward reference", [MOVE(1), CREATE], "REF_FORWARD"],
      ["5. self reference", [CREATE, MOVE(1)], "REF_SELF"],
      ["6. a reference to a step that is not a CREATE", [{ actionId: "SET_FINANCIAL_NOTES", args: { project: PROJECT, financialNotes: "x", mode: "REPLACE" } }, MOVE(0)], "REF_NOT_A_CREATE"],
      ["8. a reference in an argument that is not an entityKey", [CREATE, { actionId: "SET_FINANCIAL_NOTES", args: { project: PROJECT, financialNotes: "$step0.created", mode: "REPLACE" } }], "REF_NOT_ENTITY_KEY"],
      ["9. an arbitrary field ($step0.id)", [CREATE, { actionId: "MOVE_TRANSACTION", args: { transaction: TX, toProject: "$step0.id" } }], "REF_SYNTAX"],
      ["9. a path ($step0.created.name)", [CREATE, { actionId: "MOVE_TRANSACTION", args: { transaction: TX, toProject: "$step0.created.name" } }], "REF_SYNTAX"],
      ["9. a sloppy form ($STEP 0.created)", [CREATE, { actionId: "MOVE_TRANSACTION", args: { transaction: TX, toProject: "$STEP 0.created" } }], "REF_SYNTAX"],
      ["an entityKey argument the primitive did not declare as reference-capable", [CREATE, { actionId: "MOVE_TRANSACTION", args: { transaction: "$step0.created", toProject: PROJECT } }], "REF_ARG_NOT_SUPPORTED"],
    ];
    for (const [name, steps, code] of cases) {
      const h = mk(); const { d, db } = mkDeps(h.writers);
      const r = await plan(d, steps);
      ok(`${name} → INVALID_PLAN ${code}`, r.status === "INVALID_PLAN" && codeOf(r) === code && !db.rows(ACT_TABLES.plans).length && !h.calls.length, r);
    }
    const hm = mk(); const { d: dm } = mkDeps(hm.writers);
    // 7. kind mismatch: the created record is a project, the argument accepts only a transaction → refused as a kind mismatch
    const { FINANCE_PRIMITIVES } = await import("../lib/partner/act/primitives/finance");
    const mv = FINANCE_PRIMITIVES.find((x) => x.actionId === "MOVE_TRANSACTION")! as { refArgs?: Record<string, readonly string[]> };
    const saved = mv.refArgs; mv.refArgs = { toProject: ["client"] };
    const km = await plan(dm, [CREATE, MOVE(0)]);
    mv.refArgs = saved;
    ok("7. kind mismatch (created project, argument accepts another kind) → INVALID_PLAN REF_KIND_MISMATCH", km.status === "INVALID_PLAN" && codeOf(km) === "REF_KIND_MISMATCH", km);
    const nested = await plan(dm, [CREATE, { actionId: "MOVE_TRANSACTION", args: { transaction: TX, toProject: { ref: "$step0.created" } } }]);
    ok("9. a nested value is refused by the argument validator before planning (INVALID_INPUT NESTED_ARGUMENT, nothing stored)", nested.status === "INVALID_INPUT" && String(nested.code).includes("NESTED_ARGUMENT"), nested);
    const single = await planAction({ intentHe: "x", actionId: "MOVE_TRANSACTION", args: { transaction: TX, toProject: "$step0.created" } }, OWNER, dm);
    ok("a single action cannot reference anything → INVALID_PLAN REF_WITHOUT_WORKFLOW", single.status === "INVALID_PLAN" && codeOf(single) === "REF_WITHOUT_WORKFLOW", single);
  }

  console.log("\n10. The transaction changed before execution → STALE, nothing runs (no project created)");
  {
    const h = mk(); const { d } = mkDeps(h.writers);
    const p = await plan(d, [CREATE, MOVE()]); const a = await approve(d, p);
    h.txs.get(TXID)!.amount = 1600;
    const e = await exec(d, p, a);
    ok("STALE before anything runs: no create, no move", e.status === "STALE" && h.created().length === 0 && !h.calls.length, { e: e.status, calls: h.calls });
  }

  console.log("\n11. Crash after the create, before the dependent step → the same createdKey, never a second project");
  {
    const h = mk(); const { d, db } = mkDeps(h.writers);
    let t = Date.parse("2026-09-27T09:00:00Z"); d.nowMs = () => t;
    const p = await plan(d, [CREATE, MOVE()]); const a = await approve(d, p);
    // the create is recorded; the process "dies" when the move tries to claim its step (armed by the move's first read)
    let armed = false;
    h.hooks.afterCreate = () => { armed = true; };
    const readTx = h.writers.readTransaction;
    h.writers.readTransaction = async (id: string) => { if (armed) db.failOn = `${ACT_TABLES.executions}:insert`; return readTx(id); };
    const e = await exec(d, p, a);
    db.failOn = null;
    t += 6 * 60_000;
    const st = await planStatus({ planId: p.planId }, OWNER, d) as { status: string; steps: Array<{ status: string; createdKey?: string }> };
    const retry = await exec(d, p, a);
    const again = await approve(d, p);
    ok("the record shows step 0 APPLIED with its createdKey, step 1 not run; a replay / new approval never creates again", h.created().length === 1 && st.steps[0]?.status === "APPLIED_AS_EXPECTED" && st.steps[0]?.createdKey === `project:${h.created()[0]}` && ["NOT_RUN", "PENDING"].includes(String(st.steps[1]?.status)) && ["ALREADY_EXECUTED", "IN_PROGRESS"].includes(String(retry.status)) && ["ALREADY_EXECUTED", "IN_PROGRESS"].includes(String(again.status)) && h.txs.get(TXID)!.projectId === P,
      { e: e.status, st, retry: retry.status, again: again.status, created: h.created().length });
  }

  console.log("\n12. Replay after success → no second project");
  {
    const h = mk(); const { d } = mkDeps(h.writers);
    const p = await plan(d, [CREATE, MOVE()]); const a = await approve(d, p);
    await exec(d, p, a);
    const replay = await exec(d, p, a); const again = await approve(d, p);
    ok("a replayed token / a new approval: ALREADY_EXECUTED, exactly one project, one move", h.created().length === 1 && h.calls.filter((c) => c === "project:create").length === 1 && h.calls.filter((c) => c.startsWith("tx:")).length === 1 && again.status === "ALREADY_EXECUTED" && ["ALREADY_EXECUTED", "APPLIED_AS_EXPECTED"].includes(String(replay.status)), { replay: replay.status, again: again.status, calls: h.calls });
  }

  console.log("\n13. Crash after the dependent write → reconciled read-only by the recorded createdKey, never re-executed");
  {
    const h = mk(); const { d, db } = mkDeps(h.writers);
    let t = Date.parse("2026-09-27T09:00:00Z"); d.nowMs = () => t;
    const p = await plan(d, [CREATE, MOVE()]); const a = await approve(d, p);
    h.hooks.afterMove = () => { db.failOn = `${ACT_TABLES.executions}:update`; };
    const e = await exec(d, p, a);
    db.failOn = null;
    const writes = h.calls.length;
    t += 6 * 60_000;
    const st = await planStatus({ planId: p.planId }, OWNER, d) as { status: string; steps: Array<{ status: string }> };
    ok("step 1 → APPLIED_AS_EXPECTED by a fresh read (the transaction is on the created project); nothing re-run", e.status === "OUTCOME_UNKNOWN" && st.steps[1]?.status === "APPLIED_AS_EXPECTED" && st.status === "EXECUTED" && h.calls.length === writes && h.created().length === 1, { e: e.status, st, calls: h.calls });
  }

  console.log("\n14. Plan hash / tampering");
  {
    const h = mk(); const { d, db } = mkDeps(h.writers);
    const p = await plan(d, [CREATE, MOVE()]);
    const row = db.rows(ACT_TABLES.plans)[0] as { plan: Plan };
    (row.plan.steps[1].args as Record<string, unknown>).toProject = PROJECT; // retarget the move to an existing project
    const a = await approve(d, p);
    ok("a stored plan whose reference was changed no longer matches its hash → refused (nothing approved / run)", a.status === "PLAN_UNREADABLE" && !h.calls.length, a);
    const h2 = mk(); const d2 = mkDeps(h2.writers);
    const p2 = await plan(d2.d, [CREATE, MOVE()]);
    const stored = JSON.parse(JSON.stringify((d2.db.rows(ACT_TABLES.plans)[0] as { plan: Plan }).plan)) as Plan;
    const forged = { ...stored, steps: [stored.steps[1], stored.steps[0]].map((s, i) => ({ ...s, index: i })) } as Plan;
    const probs = validatePlan(forged, ACTION_REGISTRY).map((x) => x.code);
    ok("the engine's plan validation rejects a reference that is not to an earlier CREATE", probs.some((c) => c.startsWith("REF_")), probs);
    const noDep = { ...stored, steps: stored.steps.map((s, i) => (i === 1 ? { ...s, dependsOn: [] } : s)) } as Plan;
    ok("…and a reference that is not declared in dependsOn", validatePlan(noDep, ACTION_REGISTRY).some((x) => x.code === "REF_NOT_A_DEPENDENCY"));
    void p2;
  }

  console.log("\n15. Plans without references behave exactly as before");
  {
    const h = mk(); const { d, db } = mkDeps(h.writers);
    const p = await plan(d, [CREATE, { actionId: "MOVE_TRANSACTION", args: { transaction: TX, toProject: PROJECT } }]);
    const stored = JSON.stringify(db.rows(ACT_TABLES.plans)[0]);
    ok("an existing target: no dependsOn, a normal fingerprint", p.status === "NO_CHANGE_NEEDED" || (p.status === "PREVIEW" && (stored.match(/"dependsOn":\[\]/g) ?? []).length === 2), { p: p.status });
    const p2 = await plan(d, [{ actionId: "SET_FINANCIAL_NOTES", args: { project: PROJECT, financialNotes: "הערה", mode: "REPLACE" } }, { actionId: "MOVE_TRANSACTION", args: { transaction: TX, toGeneral: true } }]);
    const e2 = await exec(d, p2, await approve(d, p2));
    ok("a plain two-record plan executes as before", e2.status === "APPLIED_AS_EXPECTED" && h.txs.get(TXID)!.projectId === null && h.blobs.get(P)!.financialNotes === "הערה", e2);
  }

  console.log("\n16. With chained steps (stage 2): moving a clip out of its song into its own project in ONE plan (one clip model)");
  {
    const h = mk(); const { d } = mkDeps(h.writers);
    const steps: Step[] = [
      { actionId: "SET_FINANCIAL_NOTES", args: { project: PROJECT, financialNotes: "הקליפ עבר לפרויקט נפרד", mode: "REPLACE" } },
      { actionId: "SET_FINANCE_EXCEPTION", args: { project: PROJECT, on: true, reason: "הקליפ פוצל לפרויקט נפרד", date: "2026-09-29" } },
      CREATE,
      MOVE(2, TX), MOVE(2, `transaction:${TX2}`),
      { actionId: "SET_AGREED_PRICE", args: { project: "$step2.created", agreedPrice: 3000, currency: "₪" } },
    ];
    const p = await plan(d, steps) as unknown as Record<string, unknown> & { steps: Array<{ entity: { key: string; labelHe: { text: string } }; changes: Array<{ field: string; before: { value: unknown }; after: { value: unknown } }> }> };
    const own = p.steps?.[5];
    ok("planned: the new clip project's agreed-price step shows the created record and its 'before' of a fresh project (₪0)", p.status === "PREVIEW" && own?.entity.labelHe.text.includes('הפרויקט שייווצר בשלב 3: "קליפ — בלאגן"') && own?.changes.find((c) => c.field === "agreedPrice")?.before.value === 0 && own?.changes.find((c) => c.field === "agreedPrice")?.after.value === 3000, own ?? p);
    const e = await exec(d, p, await approve(d, p));
    const nid = h.created()[0];
    ok("ONE approval → EXECUTED: the song's notes + exception, new clip project, both payments moved, its ONE agreed price 3000", e.status === "APPLIED_AS_EXPECTED" && h.blobs.get(P)!.financialNotes === "הקליפ עבר לפרויקט נפרד" && h.blobs.get(P)!.financeException === true && h.txs.get(TXID)!.projectId === nid && h.txs.get(TX2)!.projectId === nid && h.blobs.get(nid)?.agreedPrice === 3000, { e: stepsOf(e), blobs: [...h.blobs], calls: h.calls });
    const two = await plan(mkDeps(mk().writers).d, [CREATE, { actionId: "SET_FINANCIAL_NOTES", args: { project: "$step0.created", financialNotes: "x", mode: "REPLACE" } }, { actionId: "SET_AGREED_PRICE", args: { project: "$step0.created", agreedPrice: 1, currency: "₪" } }]);
    ok("two steps on the SAME created record are not chained yet → SAME_ENTITY_TWICE (separate plan after the create)", two.status === "SAME_ENTITY_TWICE", two);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
