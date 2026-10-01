/**
 * Universal Action Layer — ENGINE RELIABILITY (2026-09-27) through the REAL service + DB-backed stores on fakes.
 *   Self-stale fix (the "יהלום" case: a plan's own creations never make a later step STALE; an external change still does),
 *   intra-plan duplicates (LIKELY_SAME → held with a server ack; SIMILAR → a preview warning), duplicateAck (never blind),
 *   one truthful row per step (STALE / NOT_RUN settled), aggregate status never EXECUTED on partial, createdKey,
 *   at-most-once (approve / execute refuse an executed plan; a replay of the same token returns the record),
 *   stuck-claim reconciliation (read-only verify, never re-executed), young claim = IN_PROGRESS, "מאשר" still enough.
 * Run with:   npx tsx scripts/test-sunny-act-reliability.tsx      Pure; never touches production.
 */
import fs from "node:fs";
import path from "node:path";
import { mkDeps, U, OWNER } from "./fixtures/act-harness";
import { approveAction, executeAction, planAction, planStatus, CLAIM_RECONCILE_AFTER_MS } from "../lib/partner/act/service";
import { executionKey, planHash } from "../lib/partner/act/plan";
import { issueApprovalToken, issueDuplicateAck, DUPLICATE_ACK_TTL_MS } from "../lib/partner/act/approval";
import { toPersistablePlan } from "../lib/partner/act/persist";
import { validateActInput, ACT_TOOL_DEFINITIONS } from "../lib/partner/act/mcp-tools";
import { ACT_TABLES } from "../lib/partner/act/store-supabase";
import { ACTION_REGISTRY } from "../lib/partner/act/registry";
import { executorFor, PRIMITIVES_BY_ID } from "../lib/partner/act/primitives";
import { DUP_ACTIONS, inPlanDuplicates } from "../lib/partner/act/primitives/duplicates";
import { SERVER_INSTRUCTIONS } from "../lib/integrations/partner-mcp/mcp";
import type { Plan } from "../lib/partner/act/types";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: unknown) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 700)}` : ""}`); } };
const read = (p: string) => fs.readFileSync(path.resolve(__dirname, "..", p), "utf8");

type Tx = { projectId: string | null; type: string; date: string | null; description: string; amount: number; currency: string; paymentStatus: string; notes: string };
const P = `project:${U(10)}`, DAY = "2026-09-25";
function mk() {
  const w = { tx: {} as Record<string, Tx>, projects: { [U(10)]: { name: "יהלום", notes: "", startDate: null, plannedHours: null, plannedDays: null, projectType: "שיר", parentProject: "", deadline: "2026-10-01" as string | null } } };
  const calls: string[] = []; let n = 700;
  let onCreate: ((t: Tx) => void) | null = null;
  const writers = {
    async readProjectMeta(id: string) { return w.projects[id] ? { name: w.projects[id].name, artist: "", status: "בעבודה", isHidden: false, businessType: "לקוח", projectType: "שיר", hasRelease: false } : null; },
    async readTransaction(id: string) { return w.tx[id] ? { ...w.tx[id] } : null; },
    async financeOwnerOf() { return null; },
    // task 4: the rule gives these rows a certain unit (the reliability checks are about execution, not classification)
    async suggestBusinessUnit() { return { unit: "RECORDS", reasonHe: "כלל" }; },
    // like lib/writes/duplicates.ts: the focused reader, WITH the row id
    async similarRecords(q: { kind: string; projectId?: string | null; type?: string; amount?: number; currency?: string }) {
      calls.push("similarRecords");
      return q.kind !== "TRANSACTION" ? [] : Object.entries(w.tx).filter(([, x]) => x.projectId === q.projectId && x.type === q.type && x.amount === q.amount && x.currency === q.currency).map(([id, x]) => ({ id, date: x.date, amount: x.amount, currency: x.currency, text: [x.description, x.notes].filter(Boolean).join(" · ") }));
    },
    async createTransaction(t: Tx) { calls.push("createTransaction"); const id = U(++n); w.tx[id] = { projectId: t.projectId, type: t.type, date: t.date, description: t.description, amount: t.amount, currency: t.currency, paymentStatus: t.paymentStatus, notes: t.notes }; onCreate?.(w.tx[id]); return id; },
    async readProject(id: string) { return w.projects[id] ? { ...w.projects[id] } : null; },
    async writeProject(id: string, p: { deadline?: string | null }) { calls.push("writeProject"); Object.assign(w.projects[id], p); },
  };
  return { w, calls, writers, setOnCreate: (f: ((t: Tx) => void) | null) => { onCreate = f; } };
}
const TX = (o: Record<string, unknown>) => ({ actionId: "ADD_TRANSACTION", args: { project: P, currency: "₪", date: DAY, ...o } });
const YAHALOM = [
  TX({ type: "income", amount: 3500, paymentStatus: "צפוי", description: "הופעה — יהלום" }),
  TX({ type: "expense", amount: 500, paymentStatus: "לא שולם", description: "יאיר צלם" }),
  TX({ type: "expense", amount: 500, paymentStatus: "לא שולם", description: "ציוד" }),
];
const creates = (c: string[]) => c.filter((x) => x === "createTransaction").length;
type Deps = ReturnType<typeof mkDeps>["d"];
const planSteps = (d: Deps, steps: unknown[], c = OWNER) => planAction({ intentHe: "הופעה + הוצאות", steps }, c, d);
async function approveExec(d: Deps, p: Record<string, unknown>, text = "מאשר") {
  const a = await approveAction({ planId: p.planId, planHash: p.planHash, confirmationText: text }, OWNER, d);
  const e = a.status === "APPROVED_PENDING_EXECUTION" ? await executeAction({ planId: p.planId, approvalToken: a.approvalToken, confirmationText: text }, OWNER, d) : null;
  return { a, e };
}
const rowsOf = (db: ReturnType<typeof mkDeps>["db"], planId: unknown) => db.rows(ACT_TABLES.executions).filter((x) => x.plan_id === planId).sort((x, y) => Number(x.step_index) - Number(y.step_index));
const storedPlan = (db: ReturnType<typeof mkDeps>["db"], planId: unknown) => db.rows(ACT_TABLES.plans).find((x) => x.plan_id === planId)!.plan as Plan;

(async () => {
  console.log("R1. The יהלום case — a compound plan never goes STALE on its own creations");
  {
    const h = mk(); const { d, db } = mkDeps(h.writers);
    const p = await planSteps(d, YAHALOM);
    ok("R1a. income 3500 + two 500 expenses on the same date with different text → ONE preview (SIMILAR, not held)", p.status === "PREVIEW" && (p.steps as unknown[]).length === 3, p);
    ok("R1b. …the preview warns 'שני שלבים דומים בתוכנית' (information, not a refusal)", JSON.stringify(p.preview).includes("שני שלבים דומים בתוכנית"), (p.preview as { duplicateWarningsHe: unknown }).duplicateWarningsHe);
    const r = await approveExec(d, p, "מאשר");
    ok("R1c. a plain \"מאשר\" → every step executes and is verified (no self-stale)", r.a.status === "APPROVED_PENDING_EXECUTION" && r.e?.status === "APPLIED_AS_EXPECTED" && creates(h.calls) === 3, r.e);
    const st = (r.e?.steps ?? []) as Array<{ status: string; createdKey?: string }>;
    const ids = Object.keys(h.w.tx);
    ok("R1d. each created record is returned as createdKey (transaction:<id>) in execute", st.map((x) => x.createdKey).join() === ids.map((x) => `transaction:${x}`).join() && Array.isArray(r.e?.created), st);
    const fr = r.e?.freshStates as Array<{ entity: string; fields?: Record<string, { value: unknown }> }>;
    ok("R1e. the fresh read reads each created record by its new key (not 'new')", fr.every((x, i) => x.entity === st[i].createdKey && x.fields?.amount !== undefined) && fr[2].fields?.description.value === "ציוד", fr);
    const rows = rowsOf(db, p.planId);
    ok("R1f. one executions row per step, all APPLIED, each outcome carries its createdKey", rows.length === 3 && rows.every((x) => x.status === "APPLIED_AS_EXPECTED") && rows.every((x, i) => (x.outcome as { createdKey?: string }).createdKey === st[i].createdKey));
    const s = await planStatus({ planId: p.planId }, OWNER, d);
    ok("R1g. plan status: EXECUTED + createdKey per step", s.status === "EXECUTED" && (s.steps as Array<{ createdKey?: string }>).every((x, i) => x.createdKey === st[i].createdKey), s.steps);
    // the proof of the old bug: without leaving out the plan's own creation, step 3's context changed (STALE)
    const plan = storedPlan(db, p.planId);
    const ex = executorFor(PRIMITIVES_BY_ID.get("ADD_TRANSACTION")!, d.writers);
    // (step 3's own new record is left out in both reads — the question is only step 2's record)
    const without = await ex.fingerprint(plan.steps[2], { excludeCreated: [ids[2]] });
    const withEx = await ex.fingerprint(plan.steps[2], { excludeCreated: [ids[1], ids[2]] });
    ok("R1h. root cause pinned: step 3's live context now contains step 2's record (old engine → STALE); leaving out THIS plan's creation restores the exact previewed fingerprint", without !== plan.steps[2].expectedFingerprint && withEx === plan.steps[2].expectedFingerprint);
  }
  {
    const h = mk(); const { d } = mkDeps(h.writers);
    const p = await planSteps(d, [TX({ type: "expense", amount: 500, paymentStatus: "לא שולם", description: "צלם — יאיר" }), TX({ type: "expense", amount: 500, paymentStatus: "לא שולם", description: "צלם — אביב", date: "2026-09-26" })]);
    ok("R1i. similar-text steps (LIKELY_SAME) are held at planning, not at execution", p.status === "POSSIBLE_DUPLICATE_IN_PLAN", p.status);
  }

  console.log("\nR2. External changes still → STALE (nothing runs / the rest stops) — with one truthful row per step");
  {
    const h = mk(); const { d, db } = mkDeps(h.writers);
    const p = await planSteps(d, YAHALOM);
    h.w.tx[U(900)] = { projectId: U(10), type: "expense", date: DAY, description: "משהו אחר", amount: 500, currency: "₪", paymentStatus: "שולם", notes: "" }; // recorded elsewhere meanwhile
    const r = await approveExec(d, p);
    ok("R2a. a record added by someone else between preview and execution → STALE and NOTHING runs", r.e?.status === "STALE" && creates(h.calls) === 0, r.e?.status);
    ok("R2b. every step has its ONE persisted row: STALE for the changed step, NOT_RUN for the rest", rowsOf(db, p.planId).map((x) => x.status).join() === "NOT_RUN,STALE,NOT_RUN", rowsOf(db, p.planId).map((x) => x.status));
    const s = await planStatus({ planId: p.planId }, OWNER, d);
    ok("R2c. plan status STALE (never EXECUTED)", s.status === "STALE", s.status);
    const again = await approveAction({ planId: p.planId, planHash: p.planHash, confirmationText: "מאשר" }, OWNER, d);
    ok("R2d. a stale plan is closed: a new approval is refused (a new plan is needed)", again.status === "ALREADY_EXECUTED" && again.planStatus === "STALE", again);
  }
  {
    const h = mk(); const { d, db } = mkDeps(h.writers);
    const p = await planSteps(d, YAHALOM);
    let n = 0;
    h.setOnCreate(() => { if (++n === 2) h.w.tx[U(901)] = { projectId: U(10), type: "expense", date: DAY, description: "הזמנה ממסך אחר", amount: 500, currency: "₪", paymentStatus: "שולם", notes: "" }; }); // an external insert DURING the run
    const r = await approveExec(d, p);
    const st = (r.e?.steps ?? []) as Array<{ status: string }>;
    ok("R2e. an external change DURING the run → the next step is STALE, nothing later runs (PARTIALLY_APPLIED)", r.e?.status === "PARTIALLY_APPLIED" && st.map((x) => x.status).join() === "APPLIED_AS_EXPECTED,APPLIED_AS_EXPECTED,STALE" && creates(h.calls) === 2, st);
    ok("R2f. rows: APPLIED, APPLIED, STALE — and the status is PARTIALLY_APPLIED, never EXECUTED", rowsOf(db, p.planId).map((x) => x.status).join() === "APPLIED_AS_EXPECTED,APPLIED_AS_EXPECTED,STALE" && (await planStatus({ planId: p.planId }, OWNER, d)).status === "PARTIALLY_APPLIED");
    const hist = await planStatus({ history: true }, OWNER, d);
    ok("R2g. history agrees (PARTIALLY_APPLIED, partiallyApplied, per-step outcome)", (hist.items as Array<{ outcome: string; partiallyApplied: boolean; steps: Array<{ outcome: string }> }>)[0].outcome === "PARTIALLY_APPLIED" && (hist.items as Array<{ partiallyApplied: boolean }>)[0].partiallyApplied && (hist.items as Array<{ steps: Array<{ outcome: string }> }>)[0].steps.map((x) => x.outcome).join() === "APPLIED_AS_EXPECTED,APPLIED_AS_EXPECTED,STALE");
  }

  console.log("\nR3. Duplicates inside one plan + duplicateAck");
  const SAME = [TX({ type: "expense", amount: 500, paymentStatus: "לא שולם", description: "יאיר צלם" }), TX({ type: "expense", amount: 500, paymentStatus: "לא שולם", description: "יאיר צלם" })];
  {
    const h = mk(); const { d, db } = mkDeps(h.writers);
    const p = await planSteps(d, SAME);
    ok("R3a. two LIKELY_SAME creates in one plan → POSSIBLE_DUPLICATE_IN_PLAN naming both steps, with a server ack; no plan stored", p.status === "POSSIBLE_DUPLICATE_IN_PLAN" && (p.steps as number[]).join() === "0,1" && /^dack1\.\d{13}\.[0-9a-f]{64}$/.test(String(p.duplicateAck)) && db.rows(ACT_TABLES.plans).length === 0 && creates(h.calls) === 0, p);
    const blind = await planSteps(d, [SAME[0], { ...SAME[1], args: { ...SAME[1].args, separateFromSimilar: true } }]);
    ok("R3b. separateFromSimilar without the ack → DUPLICATE_ACK_REQUIRED", blind.status === "DUPLICATE_ACK_REQUIRED" && blind.reason === "ACK_MISSING", blind);
    const good = await planSteps(d, [SAME[0], { ...SAME[1], args: { ...SAME[1].args, separateFromSimilar: true, duplicateAck: p.duplicateAck } }]);
    ok("R3c. after the Boss says 'two separate records' → re-plan with separateFromSimilar + the ack → PREVIEW that says so", good.status === "PREVIEW" && JSON.stringify(good.preview).includes("נרשם בנפרד"), good.status);
    const r = await approveExec(d, good);
    ok("R3d. both records are created once each", r.e?.status === "APPLIED_AS_EXPECTED" && creates(h.calls) === 2, r.e?.status);
    ok("R3e. the ack is stored only in its exact typed shape (persist allowlist)", JSON.stringify(storedPlan(db, good.planId)).includes(String(p.duplicateAck)));
  }
  {
    const h = mk(); const { d } = mkDeps(h.writers);
    h.w.tx[U(950)] = { projectId: U(10), type: "expense", date: "2026-09-24", description: "יאיר צלם", amount: 500, currency: "₪", paymentStatus: "שולם", notes: "" };
    const one = TX({ type: "expense", amount: 500, paymentStatus: "לא שולם", description: "יאיר צלם" });
    const plan1 = (args: Record<string, unknown>, c = OWNER) => planAction({ intentHe: "הוצאה", actionId: "ADD_TRANSACTION", args }, c, d);
    const held = await plan1(one.args);
    ok("R4a. a live LIKELY_SAME record → POSSIBLE_DUPLICATE with a duplicateAck + its expiry", held.status === "POSSIBLE_DUPLICATE" && /^dack1\./.test(String(held.duplicateAck)) && typeof held.duplicateAckExpiresAt === "string", held);
    const noAck = await plan1({ ...one.args, separateFromSimilar: true });
    ok("R4b. separateFromSimilar without ack → refused", noAck.status === "DUPLICATE_ACK_REQUIRED");
    const forged = await plan1({ ...one.args, separateFromSimilar: true, duplicateAck: `dack1.${Date.parse("2026-09-27T09:10:00Z")}.${"a".repeat(64)}` });
    ok("R4c. a forged ack → refused (ACK_MISMATCH)", forged.status === "DUPLICATE_ACK_REQUIRED" && forged.reason === "ACK_MISMATCH", forged);
    const malformed = await plan1({ ...one.args, separateFromSimilar: true, duplicateAck: "please-trust-me" });
    ok("R4d. a malformed ack never reaches planning (input validation)", malformed.status === "INVALID_INPUT" && String(malformed.code).startsWith("BAD_DUPLICATE_ACK"), malformed);
    const otherArgs = await plan1({ ...one.args, paymentStatus: "שולם", separateFromSimilar: true, duplicateAck: held.duplicateAck });
    ok("R4e. an ack for other arguments → refused", otherArgs.status === "DUPLICATE_ACK_REQUIRED" && otherArgs.reason === "ACK_MISMATCH", otherArgs.status);
    const otherClient = await plan1({ ...one.args, separateFromSimilar: true, duplicateAck: held.duplicateAck }, { ...OWNER, clientId: "client-2" });
    ok("R4f. an ack for another connector client → refused", otherClient.status === "DUPLICATE_ACK_REQUIRED", otherClient.status);
    const realNow = d.nowMs; d.nowMs = () => realNow() + DUPLICATE_ACK_TTL_MS + 1000;
    const expired = await plan1({ ...one.args, separateFromSimilar: true, duplicateAck: held.duplicateAck });
    d.nowMs = realNow;
    ok("R4g. an expired ack → refused (ACK_EXPIRED)", expired.status === "DUPLICATE_ACK_REQUIRED" && expired.reason === "ACK_EXPIRED", expired);
    const ackOtherAction = issueDuplicateAck(d.approvalSecret, { ownerId: OWNER.ownerId, clientId: OWNER.clientId, actionId: "ADD_LEDGER_ENTRY", args: one.args, similar: "x" }, d.nowMs()).duplicateAck;
    ok("R4h. an ack issued for another action → refused", (await plan1({ ...one.args, separateFromSimilar: true, duplicateAck: ackOtherAction })).status === "DUPLICATE_ACK_REQUIRED");
    h.w.tx[U(951)] = { projectId: U(10), type: "expense", date: "2026-09-23", description: "יאיר צלם — השלמה", amount: 500, currency: "₪", paymentStatus: "שולם", notes: "" };
    const newCand = await plan1({ ...one.args, separateFromSimilar: true, duplicateAck: held.duplicateAck });
    ok("R4i. a NEW similar record after the ack → the old ack is void (the Boss must see the new one)", newCand.status === "DUPLICATE_ACK_REQUIRED" && newCand.reason === "ACK_MISMATCH", newCand.status);
    const held2 = await plan1(one.args);
    const fine = await plan1({ ...one.args, separateFromSimilar: true, duplicateAck: held2.duplicateAck });
    ok("R4j. the fresh ack for the current candidates → PREVIEW (recorded as an additional one)", fine.status === "PREVIEW" && JSON.stringify(fine).includes("נרשמת כרשומה נוספת"), fine.status);
    ok("R4k. no write happened during any of this", creates(h.calls) === 0);
  }
  ok("R4l. every money CREATE carries both separateFromSimilar and duplicateAck (typed, optional)", DUP_ACTIONS.every((id) => ["separateFromSimilar", "duplicateAck"].every((n) => ACTION_REGISTRY.get(id)?.args.some((a) => a.name === n && !a.required))));
  ok("R4m. in-plan detection is pure over the typed args: same context + amount + near date; text decides LIKELY_SAME vs SIMILAR", inPlanDuplicates(YAHALOM).map((x) => `${x.step}:${x.other}:${x.level}`).join() === "2:1:SIMILAR" && inPlanDuplicates(SAME).map((x) => x.level).join() === "LIKELY_SAME" && inPlanDuplicates([YAHALOM[1], TX({ type: "expense", amount: 500, paymentStatus: "לא שולם", description: "יאיר צלם", project: `project:${U(11)}` })]).length === 0);

  console.log("\nR5. At most once: executed plans, replays");
  {
    const h = mk(); const { d } = mkDeps(h.writers);
    const p = await planSteps(d, YAHALOM);
    const r = await approveExec(d, p);
    const again = await approveAction({ planId: p.planId, planHash: p.planHash, confirmationText: "מאשר" }, OWNER, d);
    ok("R5a. an executed plan cannot be approved again (ALREADY_EXECUTED + planStatus)", again.status === "ALREADY_EXECUTED" && again.planStatus === "EXECUTED" && !("approvalToken" in again), again.status);
    const fresh = issueApprovalToken(d.approvalSecret, { planHash: String(p.planHash), ownerId: OWNER.ownerId, clientId: OWNER.clientId, nowMs: d.nowMs() });
    const ex2 = await executeAction({ planId: p.planId, approvalToken: fresh, confirmationText: "מאשר" }, OWNER, d);
    ok("R5b. …nor executed with a fresh token (ALREADY_EXECUTED) — nothing runs twice", ex2.status === "ALREADY_EXECUTED" && creates(h.calls) === 3, ex2.status);
    const replay = await executeAction({ planId: p.planId, approvalToken: r.a.approvalToken, confirmationText: "מאשר" }, OWNER, d);
    ok("R5c. a replay of the SAME token returns the recorded outcome (replayed), no write", replay.status === "APPLIED_AS_EXPECTED" && (replay.steps as Array<{ replayed: boolean }>).every((x) => x.replayed) && creates(h.calls) === 3, replay.status);
  }

  console.log("\nR6. Stuck claims: reconciled READ-ONLY, never re-executed; young claims = IN_PROGRESS");
  const DEADLINE = { project: P, deadline: "2026-10-20" };
  async function claimedPlan(o: { ageMs: number; landed: boolean }) {
    const h = mk(); const m = mkDeps(h.writers);
    const p = await planAction({ intentHe: "דדליין", actionId: "UPDATE_PROJECT_DEADLINE", args: DEADLINE }, OWNER, m.d);
    const a = await approveAction({ planId: p.planId, planHash: p.planHash, confirmationText: "מאשר" }, OWNER, m.d);
    const plan = storedPlan(m.db, p.planId);
    // a run that claimed step 0 and then died (process killed / redeploy) — before recording anything
    m.db.rows(ACT_TABLES.executions).push({ execution_key: executionKey(planHash(plan), plan.steps[0]), plan_id: p.planId, step_index: 0, action_id: "UPDATE_PROJECT_DEADLINE", action_version: plan.steps[0].actionVersion, status: "CLAIMED", outcome: { at: new Date(m.d.nowMs() - o.ageMs).toISOString() }, recorded_at: null });
    if (o.landed) h.w.projects[U(10)].deadline = "2026-10-20";
    return { h, m, p, a };
  }
  {
    const { h, m, p, a } = await claimedPlan({ ageMs: CLAIM_RECONCILE_AFTER_MS + 60_000, landed: true });
    const s = await planStatus({ planId: p.planId }, OWNER, m.d);
    const row = rowsOf(m.db, p.planId)[0];
    ok("R6a. an old CLAIMED step whose write landed → verified by a fresh read → APPLIED_AS_EXPECTED; status EXECUTED", s.status === "EXECUTED" && row.status === "APPLIED_AS_EXPECTED" && /interrupted/.test(String((row.outcome as { detail: string }).detail)), { s: s.status, row });
    ok("R6b. …without re-executing (no writer call) and with a VERIFIED audit event", !h.calls.includes("writeProject") && m.db.rows(ACT_TABLES.events).some((e) => e.event_type === "VERIFIED" && /reconciled/.test(String(e.detail))));
    const e = await executeAction({ planId: p.planId, approvalToken: a.approvalToken, confirmationText: "מאשר" }, OWNER, m.d);
    ok("R6c. executing it afterwards is refused (ALREADY_EXECUTED) — still no writer call", e.status === "ALREADY_EXECUTED" && !h.calls.includes("writeProject"), e.status);
  }
  {
    const { h, m, p } = await claimedPlan({ ageMs: CLAIM_RECONCILE_AFTER_MS + 60_000, landed: false });
    const s = await planStatus({ planId: p.planId }, OWNER, m.d);
    const row = rowsOf(m.db, p.planId)[0];
    ok("R6d. an old CLAIMED step whose write did NOT land → FAILED ('not applied'), status FAILED, never re-executed", s.status === "FAILED" && row.status === "FAILED" && /not applied/.test(String((row.outcome as { detail: string }).detail)) && !h.calls.includes("writeProject") && h.w.projects[U(10)].deadline === "2026-10-01", { s: s.status, row });
  }
  {
    const { h, m, p, a } = await claimedPlan({ ageMs: 20_000, landed: false });
    const s = await planStatus({ planId: p.planId }, OWNER, m.d);
    ok("R6e. a young CLAIMED step (MAIN still running, e.g. after a connector timeout) → IN_PROGRESS, nothing reconciled", s.status === "IN_PROGRESS" && rowsOf(m.db, p.planId)[0].status === "CLAIMED", s.status);
    const e = await executeAction({ planId: p.planId, approvalToken: a.approvalToken, confirmationText: "מאשר" }, OWNER, m.d);
    const ap = await approveAction({ planId: p.planId, planHash: p.planHash, confirmationText: "מאשר" }, OWNER, m.d);
    ok("R6f. …execute and approve both answer IN_PROGRESS — no double execution", e.status === "IN_PROGRESS" && ap.status === "IN_PROGRESS" && !h.calls.includes("writeProject"), [e.status, ap.status]);
  }
  {
    // a compound run that died after step 1 and inside step 2 (a CREATE, which cannot be verified without its id)
    const h = mk(); const m = mkDeps(h.writers);
    const p = await planSteps(m.d, YAHALOM);
    const plan = storedPlan(m.db, p.planId); const hash = planHash(plan);
    const old = new Date(m.d.nowMs() - CLAIM_RECONCILE_AFTER_MS - 60_000).toISOString();
    m.db.rows(ACT_TABLES.executions).push({ execution_key: executionKey(hash, plan.steps[0]), plan_id: p.planId, step_index: 0, action_id: "ADD_TRANSACTION", action_version: 1, status: "APPLIED_AS_EXPECTED", outcome: { index: 0, actionId: "ADD_TRANSACTION", status: "APPLIED_AS_EXPECTED", detail: "verified", replayed: false, at: old }, recorded_at: old });
    m.db.rows(ACT_TABLES.executions).push({ execution_key: executionKey(hash, plan.steps[1]), plan_id: p.planId, step_index: 1, action_id: "ADD_TRANSACTION", action_version: 1, status: "CLAIMED", outcome: { at: old }, recorded_at: null });
    const s = await planStatus({ planId: p.planId }, OWNER, m.d);
    const rows = rowsOf(m.db, p.planId);
    ok("R6g. an interrupted CREATE → FAILED 'OUTCOME_UNKNOWN' (never claimed as done, never re-run); the unreached step gets its NOT_RUN row; status PARTIALLY_APPLIED", s.status === "PARTIALLY_APPLIED" && rows.map((x) => x.status).join() === "APPLIED_AS_EXPECTED,FAILED,NOT_RUN" && /OUTCOME_UNKNOWN/.test(String((rows[1].outcome as { detail: string }).detail)) && creates(h.calls) === 0, { s: s.status, rows: rows.map((x) => x.status) });
  }
  {
    // a run between steps (step 1 recorded a moment ago, step 2 not yet claimed) is IN_PROGRESS, not "NOT_RUN"
    const h = mk(); const m = mkDeps(h.writers);
    const p = await planSteps(m.d, YAHALOM);
    const plan = storedPlan(m.db, p.planId);
    const at = (ms: number) => new Date(m.d.nowMs() - ms).toISOString();
    m.db.rows(ACT_TABLES.executions).push({ execution_key: executionKey(planHash(plan), plan.steps[0]), plan_id: p.planId, step_index: 0, action_id: "ADD_TRANSACTION", action_version: 1, status: "APPLIED_AS_EXPECTED", outcome: { index: 0, actionId: "ADD_TRANSACTION", status: "APPLIED_AS_EXPECTED", detail: "verified", replayed: false, at: at(5_000) }, recorded_at: at(5_000) });
    const s1 = await planStatus({ planId: p.planId }, OWNER, m.d);
    ok("R6h. a run between steps (recent row, later steps not yet written) → IN_PROGRESS with PENDING steps", s1.status === "IN_PROGRESS" && (s1.steps as Array<{ status: string }>).map((x) => x.status).join() === "APPLIED_AS_EXPECTED,PENDING,PENDING", s1.steps);
    (m.db.rows(ACT_TABLES.executions)[0].outcome as { at: string }).at = at(CLAIM_RECONCILE_AFTER_MS + 1000);
    const s2 = await planStatus({ planId: p.planId }, OWNER, m.d);
    ok("R6i. a legacy / long-dead partial run → PARTIALLY_APPLIED with derived NOT_RUN steps (never EXECUTED)", s2.status === "PARTIALLY_APPLIED" && (s2.steps as Array<{ status: string; derived?: boolean }>).slice(1).every((x) => x.status === "NOT_RUN" && x.derived), s2.steps);
  }
  {
    // legacy: a STALE plan from before per-step rows (only the STALE event)
    const h = mk(); const m = mkDeps(h.writers);
    const p = await planSteps(m.d, YAHALOM);
    m.db.rows(ACT_TABLES.events).push({ id: 999, plan_id: p.planId, plan_hash: p.planHash, event_type: "APPROVED", step_index: null, detail: "x", owner_id: OWNER.ownerId, client_id: OWNER.clientId, created_at: new Date().toISOString() });
    m.db.rows(ACT_TABLES.events).push({ id: 1000, plan_id: p.planId, plan_hash: p.planHash, event_type: "STALE", step_index: 1, detail: "x", owner_id: OWNER.ownerId, client_id: OWNER.clientId, created_at: new Date().toISOString() });
    const s = await planStatus({ planId: p.planId }, OWNER, m.d);
    ok("R6j. legacy plan with only a STALE event → STALE (steps derived NOT_RUN)", s.status === "STALE" && (s.steps as Array<{ status: string }>).every((x) => x.status === "NOT_RUN"), s);
  }

  console.log("\nR7. Contracts: persistence allowlist, tool input, connector guidance");
  {
    const h = mk(); const { d, db } = mkDeps(h.writers);
    const held = await planAction({ intentHe: "x", actionId: "ADD_TRANSACTION", args: SAME[0].args }, OWNER, d);
    ok("R7a. (no candidate) — a plain create needs no ack", held.status === "PREVIEW");
    const plan = storedPlan(db, held.planId);
    const withAck = (v: unknown): Plan => ({ ...plan, steps: [{ ...plan.steps[0], args: { ...plan.steps[0].args, separateFromSimilar: true, duplicateAck: v } }] });
    const good = `dack1.${Date.parse("2026-09-27T09:10:00Z")}.${"b".repeat(64)}`;
    ok("R7b. persistence accepts duplicateAck ONLY in its exact shape (dack1.<13 digits>.<64 hex>)", toPersistablePlan(withAck(good), ACTION_REGISTRY).ok && !toPersistablePlan(withAck(`${good}x`), ACTION_REGISTRY).ok && !toPersistablePlan(withAck("ak1.abcdefghijklmnopqrstu.xyz"), ACTION_REGISTRY).ok);
    ok("R7c. an opaque 64-hex blob anywhere else is still rejected", !toPersistablePlan({ ...plan, steps: [{ ...plan.steps[0], args: { ...plan.steps[0].args, description: "f".repeat(64) } }] }, ACTION_REGISTRY).ok);
    ok("R7d. MCP input: a well-formed ack passes, anything else is BAD_DUPLICATE_ACK", validateActInput("partner_plan_action", { intentHe: "x", actionId: "ADD_TRANSACTION", args: { ...SAME[0].args, separateFromSimilar: true, duplicateAck: good } }).ok && (validateActInput("partner_plan_action", { intentHe: "x", actionId: "ADD_TRANSACTION", args: { ...SAME[0].args, duplicateAck: "x".repeat(70) } }) as { code?: string }).code === "BAD_DUPLICATE_ACK:duplicateAck");
  }
  const planTool = ACT_TOOL_DEFINITIONS.find((x) => x.name === "partner_plan_action")!.description;
  const execTool = ACT_TOOL_DEFINITIONS.find((x) => x.name === "partner_execute_plan")!.description;
  ok("R7e. tool descriptions: separateFromSimilar only after the Boss's explicit answer + the refusal's duplicateAck; execute at most once, OUTCOME_UNKNOWN → status", /duplicateAck/.test(planTool) && /explicitly/.test(planTool) && /at most once/.test(execTool) && /partner_plan_status/.test(execTool));
  ok("R7f. connector instructions: surface the candidate, never set separateFromSimilar alone, never re-execute after OUTCOME_UNKNOWN", /duplicateAck/.test(SERVER_INSTRUCTIONS) && /never set separateFromSimilar on your own/.test(SERVER_INSTRUCTIONS) && /NEVER execute the plan again/.test(SERVER_INSTRUCTIONS));
  const mcpSrc = read("lib/integrations/partner-mcp/mcp.ts");
  ok("R7g. a relay timeout on execute → OUTCOME_UNKNOWN pointing at partner_plan_status (never a retry)", /status: "OUTCOME_UNKNOWN", planId:[^\n]*next: "partner_plan_status"/.test(mcpSrc));
  ok("R7h. the reader selects the row id (only to leave out the plan's own creations)", (read("lib/writes/duplicates.ts").match(/select\("id, /g) ?? []).length === 4); // the clip-payment reader retired with ADD_CLIP_PAYMENT (one clip model)

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
