/**
 * Universal Action Layer — COMPOUND PLANS + ACTION HISTORY through the REAL service on fakes.
 *   Compound: one business event = 2–8 registered actions in ONE plan → one server-built preview of every step → ONE
 *   approval bound to the exact whole-plan hash → every step re-read before anything runs (STALE = nothing runs) →
 *   dependency order, each step at most once (replay returns the record) → truthful partial failure.
 *   History: Owner-scoped, read-only, newest first, filters + cursor pagination, detail by plan id; no token / secret.
 * Run with:   npx tsx scripts/test-sunny-act-compound.tsx      Pure; never touches production.
 */
import { mkDeps, U, OWNER, YES } from "./fixtures/act-harness";
import { approveAction, executeAction, planAction, planStatus, previewAction } from "../lib/partner/act/service";
import { linkRef } from "../lib/partner/act/primitives/core";
import { validateActInput, ACT_TOOL_DEFINITIONS } from "../lib/partner/act/mcp-tools";
import { handleInternalAct } from "../lib/partner/act/internal-handler";
import { INTERNAL_AUTH_HEADER } from "../lib/partner/calendar/internal-auth";
import { ACT_TABLES } from "../lib/partner/act/store-supabase";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: unknown) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 600)}` : ""}`); } };

const OLD = "https://example.com/old-take", NEW = "https://example.com/new-take", POSTED = "https://www.instagram.com/p/Cabc123/";
function mk(o: { failSocial?: boolean } = {}) {
  const w = { prod: { files_raw_link: OLD } as Record<string, string>, social: { asset_link: "", dropbox_link: "", posted_url: "" } as Record<string, string>, vrefs: [{ id: U(40), url: "https://youtu.be/abcdefghijk", title: "וייב", note: "" }] };
  const calls: string[] = [];
  const writers = {
    async productionLinks(id: string) { return id === U(7) ? { title: "קליפ", links: { rawFilesLink: linkRef(w.prod.files_raw_link), editFolderLink: null, version1Link: null, version2Link: null, finalVersionLink: null, addReferenceLink: null } } : null; },
    async setProductionLinks(_id: string, patch: Record<string, string | null>) { calls.push("setProductionLinks"); for (const [c, v] of Object.entries(patch)) w.prod[c] = v ?? ""; },
    async socialContentLinks(id: string) { return id === U(5) ? { title: "טיזר", links: { assetLink: linkRef(w.social.asset_link), storageLink: linkRef(w.social.dropbox_link), postedLink: linkRef(w.social.posted_url) } } : null; },
    async setSocialContentLinks(_id: string, patch: Record<string, string | null>) { if (o.failSocial) throw new Error("simulated writer failure"); calls.push("setSocialContentLinks"); const col: Record<string, string> = { assetLink: "asset_link", storageLink: "dropbox_link", postedLink: "posted_url" }; for (const [k, v] of Object.entries(patch)) w.social[col[k]] = v ?? ""; },
    async victorReferenceViews(id: string) { return id === U(9) ? w.vrefs.map((r) => ({ id: r.id, title: r.title, note: r.note, link: linkRef(r.url) })) : null; },
    async updateVictorReference(_w: string, id: string, p: { url?: string; title?: string; note?: string }) { calls.push("updateVictorReference"); Object.assign(w.vrefs.find((x) => x.id === id)!, p); },
    async removeVictorReference(_w: string, id: string) { calls.push("removeVictorReference"); w.vrefs = w.vrefs.filter((x) => x.id !== id); },
  };
  return { w, calls, writers };
}
const PR = `rf-production:${U(7)}`, SC = `social-content:${U(5)}`, VW = `victor-work:${U(9)}`;
const STEPS = [
  { actionId: "SET_PRODUCTION_LINKS", args: { production: PR, rawFilesLink: NEW } },
  { actionId: "SET_SOCIAL_CONTENT_LINKS", args: { content: SC, postedLink: POSTED } },
  { actionId: "UPDATE_VICTOR_REFERENCE", args: { victorWork: VW, referenceId: U(40), note: "רק הפזמון" } },
];
const plan = (d: Parameters<typeof planAction>[2], steps: unknown[] = STEPS, intentHe = "הקליפ עלה — מעדכנים את כל הקישורים") => planAction({ intentHe, steps }, OWNER, d);
async function approveExec(d: Parameters<typeof planAction>[2], p: Record<string, unknown>, text = YES) {
  const a = await approveAction({ planId: p.planId, planHash: p.planHash, confirmationText: text }, OWNER, d);
  const e = a.status === "APPROVED_PENDING_EXECUTION" ? await executeAction({ planId: p.planId, approvalToken: a.approvalToken, confirmationText: text }, OWNER, d) : null;
  return { a, e };
}

(async () => {
  console.log("Compound plan — one preview, one approval, the whole plan");
  {
    const h = mk(); const { d, db } = mkDeps(h.writers);
    const p = await plan(d);
    const st = (p as { steps?: Array<{ actionId: string; changes: unknown[] }> }).steps ?? [];
    ok("A1. three registered actions → ONE plan with ONE server-built preview of every step", p.status === "PREVIEW" && p.workflow === true && st.length === 3 && ((p.preview as { steps: unknown[] }).steps.length === 3) && db.rows(ACT_TABLES.plans).length === 1, p);
    ok("A2. the preview shows every step's entity + exact change + execution rule; nothing was written", st.every((x) => x.changes.length > 0) && typeof p.executionRuleHe === "string" && h.calls.length === 0);
    const r = await approveExec(d, p);
    ok("A3. one approval → every step executed in order and verified by a fresh read", r.e?.status === "APPLIED_AS_EXPECTED" && h.calls.join() === "setProductionLinks,setSocialContentLinks,updateVictorReference" && h.w.prod.files_raw_link === NEW && h.w.social.posted_url === POSTED && h.w.vrefs[0].note === "רק הפזמון", r.e);
    ok("A4. the fresh state of every step is returned", Array.isArray(r.e?.freshStates) && (r.e!.freshStates as unknown[]).length === 3);
    const again = await executeAction({ planId: p.planId, approvalToken: r.a.approvalToken, confirmationText: YES }, OWNER, d);
    ok("A5. a replay returns the recorded outcome — no step runs twice", h.calls.length === 3 && (again.steps as Array<{ replayed: boolean }> | undefined)?.every((x) => x.replayed) === true, again);
  }
  console.log("\nApproval binding");
  {
    const h = mk(); const { d, db } = mkDeps(h.writers);
    const p = await plan(d);
    const wrong = await approveAction({ planId: p.planId, planHash: "0".repeat(64), confirmationText: YES }, OWNER, d);
    ok("B1. an approval for another hash is refused (PLAN_CHANGED)", wrong.status === "PLAN_CHANGED");
    const a = await approveAction({ planId: p.planId, planHash: p.planHash, confirmationText: YES }, OWNER, d);
    const other = await plan(d, STEPS.slice(0, 2));
    const cross = await executeAction({ planId: other.planId, approvalToken: a.approvalToken, confirmationText: YES }, OWNER, d);
    ok("B2. an approval token never executes a different plan", cross.status !== "APPLIED_AS_EXPECTED" && h.calls.length === 0, cross.status);
    const row = db.rows(ACT_TABLES.plans).find((x) => x.plan_id === p.planId)! as { plan: { steps: unknown[] } };
    row.plan.steps = [...row.plan.steps, { ...(row.plan.steps[0] as object), index: 3 }];
    const tampered = await executeAction({ planId: p.planId, approvalToken: a.approvalToken, confirmationText: YES }, OWNER, d);
    ok("B3. a step added to the stored plan after approval → refused, nothing runs", tampered.status === "PLAN_UNREADABLE" && h.calls.length === 0, tampered.status);
  }
  {
    const h = mk(); const { d } = mkDeps(h.writers);
    const p = await plan(d, [STEPS[0], { actionId: "REMOVE_VICTOR_REFERENCE", args: { victorWork: VW, referenceId: U(40) } }]);
    ok("B4. a destructive step makes the whole plan C3 and lists its required value", p.status === "PREVIEW" && (p.preview as { confirmation: string }).confirmation === "C3_STRONG_APPROVAL" && (p.requiredConfirmationValues as string[]).includes("מחיקה"), p.preview);
    const noVal = await approveAction({ planId: p.planId, planHash: p.planHash, confirmationText: YES }, OWNER, d);
    ok("B5. approval without the destructive step's exact value is refused", noVal.status === "CONFIRMATION_VALUES_MISSING" && h.calls.length === 0);
    const r = await approveExec(d, p, "כן בוס, מחיקה");
    ok("B6. with the value → both steps applied", r.e?.status === "APPLIED_AS_EXPECTED" && h.w.vrefs.length === 0, r.e?.status);
  }
  console.log("\nStale + partial failure");
  {
    const h = mk(); const { d } = mkDeps(h.writers);
    const p = await plan(d);
    h.w.vrefs[0].title = "שונה בינתיים";
    const pv = await previewAction({ planId: p.planId }, OWNER, d);
    ok("C1. a re-preview re-reads EVERY step and flags the changed one", pv.status === "STALE" && (pv.stepsLive as Array<{ stale: boolean }>).map((x) => x.stale).join() === "false,false,true", pv.stepsLive);
    const r = await approveExec(d, p);
    ok("C2. state changed after the preview → STALE and NOTHING runs (not even the unchanged steps)", r.e?.status === "STALE" && h.calls.length === 0, r.e);
  }
  {
    const h = mk({ failSocial: true }); const { d } = mkDeps(h.writers);
    const p = await plan(d);
    const r = await approveExec(d, p);
    const steps = (r.e?.steps ?? []) as Array<{ status: string }>;
    const partial = r.e?.partial as { applied: number[]; failed: number[]; notRun: number[] } | null;
    ok("C3. step 2 fails → PARTIALLY_APPLIED: 1 applied, 2 failed, 3 did not run (never reported as done)", r.e?.status === "PARTIALLY_APPLIED" && steps.map((x) => x.status).join() === "APPLIED_AS_EXPECTED,FAILED,NOT_RUN" && partial?.applied.join() === "0" && partial?.failed.join() === "1" && partial?.notRun.join() === "2", r.e);
    ok("C4. the report says exactly what applied / failed / did not run, and there is no automatic rollback", /בוצע חלקית/.test(String(r.e?.messageHe)) && typeof (r.e?.partial as { rollbackHe?: string })?.rollbackHe === "string" && h.w.prod.files_raw_link === NEW && h.w.vrefs[0].note === "");
  }
  console.log("\nRefusals");
  {
    const h = mk(); const { d } = mkDeps(h.writers);
    const same = await plan(d, [STEPS[0], { actionId: "SET_PRODUCTION_LINKS", args: { production: PR, version1Link: NEW } }]);
    ok("D1. two steps on the same record → refused (each step must match what the Boss saw)", same.status === "SAME_ENTITY_TWICE");
    const one = await plan(d, [STEPS[0]]);
    const many = await plan(d, Array.from({ length: 9 }, () => STEPS[0]));
    ok("D2. 1 step or more than 8 → refused", one.status === "INVALID_INPUT" && many.status === "INVALID_INPUT");
    const both = await planAction({ intentHe: "x", actionId: STEPS[0].actionId, args: STEPS[0].args, steps: STEPS }, OWNER, d);
    ok("D3. actionId + steps together → refused", both.status === "INVALID_INPUT");
    ok("D4. an unknown / generic / nested step is refused with its index", validateActInput("partner_plan_action", { intentHe: "x", steps: [STEPS[0], { actionId: "SQL_WRITE", args: {} }] }).ok === false && (validateActInput("partner_plan_action", { intentHe: "x", steps: [STEPS[0], { actionId: "UPDATE_VICTOR_REFERENCE", args: { victorWork: VW, referenceId: U(40), sql: "x" } }] }) as { code: string }).code.startsWith("STEP_1:") && validateActInput("partner_plan_action", { intentHe: "x", steps: [STEPS[0], { actionId: "SET_PRODUCTION_LINKS", args: { production: PR }, extra: 1 }] }).ok === false);
    const missing = await plan(d, [STEPS[0], { actionId: "SET_SOCIAL_CONTENT_LINKS", args: { content: `social-content:${U(6)}`, postedLink: POSTED } }]);
    ok("D5. a step whose entity is missing refuses the whole plan and names the step", missing.status === "ENTITY_NOT_FOUND" && missing.step === 1 && h.calls.length === 0, missing);
  }
  console.log("\nAction history (Owner-scoped, read-only, paginated)");
  {
    const h = mk({ failSocial: true }); const { d, db } = mkDeps(h.writers);
    let t = Date.parse("2026-09-27T08:00:00Z"); d.nowMs = () => t;
    const p1 = await planAction({ intentHe: "קישור חומרי גלם", actionId: "SET_PRODUCTION_LINKS", args: { production: PR, rawFilesLink: NEW } }, OWNER, d); await approveExec(d, p1);
    t += 60_000; const p2 = await plan(d); await approveExec(d, p2); // partial (social fails)
    t += 60_000; const p3 = await planAction({ intentHe: "רק תצוגה", actionId: "UPDATE_VICTOR_REFERENCE", args: { victorWork: VW, referenceId: U(40), title: "חדש" } }, OWNER, d);
    db.rows(ACT_TABLES.plans).push({ ...db.rows(ACT_TABLES.plans)[0], plan_id: "pl_zzzzzzzzzzzzzzzzzzzz", owner_id: "someone-else", created_at: "2026-09-27T09:00:00.000Z" });
    const all = await planStatus({ history: true }, OWNER, d);
    const items = (all.items ?? []) as Array<{ planId: string; outcome: string; compound: boolean; partiallyApplied: boolean; approved: boolean; steps: unknown[] }>;
    ok("E1. newest first, only the Boss's own plans", all.status === "HISTORY" && items.map((x) => x.planId).join() === [p3.planId, p2.planId, p1.planId].join(), items.map((x) => x.planId));
    ok("E2. each item: intent, approval, outcome, compound flag, partial flag, steps with entity + fields + outcome", items[0].outcome === "NOT_EXECUTED" && !items[0].approved && items[1].compound && items[1].partiallyApplied && items[1].outcome === "EXECUTED_WITH_ISSUES" && items[2].outcome === "EXECUTED" && items[2].approved, items);
    const page1 = await planStatus({ history: true, limit: 1 }, OWNER, d);
    const page2 = await planStatus({ history: true, limit: 1, before: page1.nextBefore as string }, OWNER, d);
    ok("E3. cursor pagination (limit + nextBefore)", (page1.items as Array<{ planId: string }>)[0].planId === p3.planId && (page2.items as Array<{ planId: string }>)[0].planId === p2.planId && typeof page2.nextBefore === "string");
    const byAction = await planStatus({ history: true, actionId: "SET_SOCIAL_CONTENT_LINKS" }, OWNER, d);
    const byEntity = await planStatus({ history: true, entity: PR }, OWNER, d);
    const failed = await planStatus({ history: true, outcome: "EXECUTED_WITH_ISSUES" }, OWNER, d);
    const since = await planStatus({ history: true, since: "2026-09-27T08:00:30Z" }, OWNER, d);
    ok("E4. filters: action, entity, outcome, since", (byAction.items as unknown[]).length === 1 && (byEntity.items as unknown[]).length === 2 && (failed.items as Array<{ planId: string }>)[0]?.planId === p2.planId && (since.items as unknown[]).length === 2);
    const det = await planStatus({ planId: p2.planId }, OWNER, d);
    const dd = det.detail as { plannedSteps: Array<{ changes: unknown[] }>; approved: boolean };
    ok("E5. detail by plan id: intent, planned steps with before → after, approval + per-step outcome", det.status === "EXECUTED_WITH_ISSUES" && dd.approved && dd.plannedSteps.length === 3 && (det.steps as unknown[]).length === 2, det);
    const detOtherClient = await planStatus({ planId: p1.planId }, { ...OWNER, clientId: "client-after-reconnect" }, d);
    ok("E6. history detail is Owner-scoped (a reconnected client still sees the Boss's plans)", detOtherClient.status === "EXECUTED");
    const execOther = await executeAction({ planId: p3.planId, approvalToken: "ak1.xxxxxxxxxxxxxxxxxxxxxxxx.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", confirmationText: YES }, { ...OWNER, clientId: "client-after-reconnect" }, d);
    ok("E7. …but approve / execute stay bound to the client that planned", execOther.status === "PLAN_NOT_FOUND");
    const nonOwner = await planStatus({ history: true }, { ownerId: "someone-else", clientId: "c" }, d);
    ok("E8. a non-owner gets nothing", nonOwner.status === "NOT_OWNER");
    const txt = JSON.stringify([all, det]);
    ok("E9. history never carries an approval token, a confirmation text, a secret or a storage path", !/ak1\.|כן בוס|approvalToken|confirmationText|secret|\/Projects\//.test(txt));
    const counts = () => [ACT_TABLES.plans, ACT_TABLES.events, ACT_TABLES.executions, ACT_TABLES.approvals].map((x) => db.rows(x).length).join();
    const before = counts(); await planStatus({ history: true }, OWNER, d); await planStatus({ planId: p2.planId }, OWNER, d);
    ok("E10. history is read-only (no plan / event / execution / approval row added by reading it)", counts() === before);
    ok("E11. filters without history: true, or planId + history together → refused", validateActInput("partner_plan_status", { planId: p1.planId, history: true }).ok === false && validateActInput("partner_plan_status", { planId: p1.planId, limit: 5 }).ok === false && validateActInput("partner_plan_status", { history: true, limit: 500 }).ok === false && validateActInput("partner_plan_status", { history: true, outcome: "DONE" }).ok === false);
  }
  console.log("\nThe relay (MAIN internal endpoint) + tool schema");
  {
    const env = { PARTNER_ACT_ENABLED: "true", PARTNER_INTERNAL_ACT_SECRET: "s".repeat(40) };
    const call = (body: unknown) => handleInternalAct({ header: (n) => (n.toLowerCase() === INTERNAL_AUTH_HEADER.toLowerCase() ? env.PARTNER_INTERNAL_ACT_SECRET : null), bodyText: async () => JSON.stringify(body) }, env, async () => mkDeps(mk().writers).d);
    const withSteps = await call({ op: "plan", ownerId: OWNER.ownerId, clientId: OWNER.clientId, input: { intentHe: "x", steps: STEPS } });
    const withHistory = await call({ op: "status", ownerId: OWNER.ownerId, clientId: OWNER.clientId, input: { history: true, limit: 5 } });
    const extra = await call({ op: "status", ownerId: OWNER.ownerId, clientId: OWNER.clientId, input: { history: true, sql: "select" } });
    ok("F1. the relay accepts steps + history fields and nothing else", [withSteps.status, withHistory.status, extra.status].join() === "200,200,400" && (withSteps.body as { status?: string }).status === "PREVIEW" && (withHistory.body as { status?: string }).status === "HISTORY", [withSteps.status, withHistory.status, extra.status]);
    const planTool = ACT_TOOL_DEFINITIONS.find((x) => x.name === "partner_plan_action")!;
    ok("F2. the plan tool advertises steps (2–8, each { actionId, args } only) — still no SQL / route / path / URL field", JSON.stringify(planTool.inputSchema).includes('"steps"') && !/"(sql|route|path|url|body|headers)"/.test(JSON.stringify(planTool.inputSchema)));
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
