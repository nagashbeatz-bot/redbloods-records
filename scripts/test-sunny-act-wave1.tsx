/**
 * SUNNY UNIVERSAL ACTION LAYER — WAVE 1: the first real Owner-approved actions, end to end, on fakes.
 *
 * Proves the REAL code paths (the Supabase stores over a PostgREST-faithful fake, the MAIN service, the internal
 * endpoint gate, the MCP adapter gate, the 13 primitives over fake shared writers):
 *   A DB stores · B authorization · C approval · D stale · E execution · F idempotency · partial failure ·
 *   G every primitive (happy / invalid args / missing entity / wrong entity type / stale / no approval / exact verify) ·
 *   H regressions (no push / calendar / tasks / files / finance path; the UI routes still use the same writers).
 * Run with:   npx tsx scripts/test-sunny-act-wave1.tsx      Pure; never touches production.
 */
import fs from "node:fs";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseActStores, ACT_TABLES, ActStoreError } from "../lib/partner/act/store-supabase";
import { planAction, previewAction, approveAction, executeAction, planStatus, type ActServiceDeps } from "../lib/partner/act/service";
import { handleInternalAct, approvalKeyFrom, ACT_OPS } from "../lib/partner/act/internal-handler";
import { WAVE1_PRIMITIVES, PRIMITIVES_BY_ID, type WriterDeps } from "../lib/partner/act/primitives";
import { ACTION_REGISTRY, ACTION_REGISTRY_VERSION, WAVE1_CANDIDATES } from "../lib/partner/act/registry";
import { executePlan, type PrimitiveExecutor } from "../lib/partner/act/engine";
import { issueApprovalToken } from "../lib/partner/act/approval";
import { planHash } from "../lib/partner/act/plan";
import { internalActUrl, callInternalAct } from "../lib/partner/act/remote";
import type { ActionContract, Plan, PlanStep } from "../lib/partner/act/types";
import { handleMcpHttp, type McpDeps } from "../lib/integrations/partner-mcp/mcp";
import { readMcpConfig, scopeString } from "../lib/integrations/partner-mcp/config";
import { grantedScope } from "../lib/integrations/partner-mcp/oauth";
import { isAllowedMcpOnlyFetch } from "../lib/integrations/partner-mcp/mcp-only";
import { SlidingWindowLimiter } from "../lib/integrations/partner-mcp/rate-limit";

const ROOT = path.resolve(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: unknown) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 500)}` : ""}`); } };
const section = (t: string) => console.log(`\n${t}`);

// ── a PostgREST-faithful fake (PK / unique → 23505, eq filters, order, maybeSingle, update … select) ────────────────
type Row = Record<string, unknown>;
const KEYS: Record<string, string[][]> = {
  [ACT_TABLES.plans]: [["plan_id"], ["plan_hash"]], [ACT_TABLES.approvals]: [["nonce"]],
  [ACT_TABLES.executions]: [["execution_key"], ["plan_id", "step_index"]], [ACT_TABLES.events]: [["id"]],
};
class FakeDb {
  tables: Record<string, Row[]> = {};
  failOn: string | null = null;
  seq = 0;
  rows(t: string) { return (this.tables[t] ??= []); }
  client(): SupabaseClient {
    const db = this;
    const res = (data: unknown, error: { code?: string; message: string } | null) => Promise.resolve({ data, error });
    const from = (t: string) => {
      const filters: Array<[string, string, unknown]> = [];
      let orderCol: string | null = null, asc = true, mode: "select" | "update" = "select", patch: Row | null = null;
      const match = (r: Row) => filters.every(([op, c, v]) => op === "eq" ? r[c] === v : r[c] !== v);
      const run = () => {
        if (db.failOn === t || db.failOn === `${t}:${mode}`) return res(null, { message: "simulated database failure" });
        let rs = db.rows(t).filter(match);
        if (mode === "update") { for (const r of rs) Object.assign(r, patch); }
        if (orderCol) rs = [...rs].sort((a, b) => ((a[orderCol!] as number) < (b[orderCol!] as number) ? -1 : 1) * (asc ? 1 : -1));
        return res(rs.map((r) => ({ ...r })), null);
      };
      const chain = {
        eq(c: string, v: unknown) { filters.push(["eq", c, v]); return chain; },
        neq(c: string, v: unknown) { filters.push(["neq", c, v]); return chain; },
        order(c: string, o?: { ascending?: boolean }) { orderCol = c; asc = o?.ascending !== false; return chain; },
        select() { return chain; },
        maybeSingle() { return run().then((r) => ({ data: (r.data as Row[] | null)?.[0] ?? null, error: r.error })); },
        then(onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) { return run().then(onF, onR); },
      };
      return {
        insert(row: Row) {
          if (db.failOn === t || db.failOn === `${t}:insert`) return res(null, { message: "simulated database failure" });
          const r: Row = { ...row, ...(t === ACT_TABLES.events ? { id: ++db.seq, created_at: new Date().toISOString() } : {}) };
          for (const key of KEYS[t] ?? []) if (db.rows(t).some((x) => key.every((k) => x[k] === r[k]))) return res(null, { code: "23505", message: "duplicate key" });
          db.rows(t).push(JSON.parse(JSON.stringify(r)));
          return res(null, null);
        },
        select() { mode = "select"; return chain; },
        update(p: Row) { mode = "update"; patch = p; return chain; },
      };
    };
    return { from } as unknown as SupabaseClient;
  }
}

// ── a fake Redbloods world behind the shared-writer interface ───────────────────────────────────────────────────────
const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
interface World {
  projects: Record<string, { name: string; notes: string; startDate: string | null; plannedHours: number | null; plannedDays: number | null; projectType: string; parentProject: string; deadline: string | null }>;
  releases: Record<string, { releaseStage: string; releaseTargetDate: string | null; nextAction: string; blocker: string; responsible: string; updatedAt: string }>;
  works: Record<string, { title: string }>;
  versions: Record<string, { workId: string; label: string; status: string; createdAt: string }>;
  comments: Record<string, { versionId: string; text: string; status: string; createdAt: string }>;
  artists: Record<string, { name: string; notes: string; status: string }>;
  victor: Record<string, { title: string; vendorName: string; workState: string | null; outcome: string | null; notes: string; status: string; internalDeadline: string | null }>;
}
const freshWorld = (): World => ({
  projects: { [U(1)]: { name: "קרוב אלייך", notes: "הערה קיימת", startDate: "2026-09-01", plannedHours: 10, plannedDays: 2, projectType: "שיר", parentProject: "", deadline: "2026-10-01" } },
  releases: { [U(1)]: { releaseStage: "מיקס", releaseTargetDate: "2026-11-01", nextAction: "", blocker: "", responsible: "", updatedAt: "2026-09-20T10:00:00.000Z" } },
  works: { [U(20)]: { title: "מיקס — קרוב אלייך" } },
  versions: { [U(30)]: { workId: U(20), label: "V1", status: "בבדיקה", createdAt: "2026-09-10T10:00:00Z" }, [U(31)]: { workId: U(20), label: "V2", status: "בבדיקה", createdAt: "2026-09-15T10:00:00Z" } },
  comments: { [U(40)]: { versionId: U(30), text: "להוריד את הבס", status: "resolved", createdAt: "2026-09-11T10:00:00Z" }, [U(41)]: { versionId: U(31), text: "הווקאל נמוך בפזמון", status: "open", createdAt: "2026-09-16T10:00:00Z" } },
  artists: { [U(50)]: { name: "שליו", notes: "", status: "פעיל" } },
  victor: { [U(60)]: { title: "ביט חדש", vendorName: "victor", workState: "נשלח לויקטור", outcome: null, notes: "", status: "פעיל", internalDeadline: null }, [U(61)]: { title: "עבודה של מישהו אחר", vendorName: "other", workState: null, outcome: null, notes: "", status: "פעיל", internalDeadline: null } },
});
function fakeWriters(w: World, calls: string[], o: { silentFail?: boolean } = {}): WriterDeps {
  const put = <T extends object>(obj: T, patch: Partial<T>) => { if (!o.silentFail) Object.assign(obj, patch); };
  return {
    async readProject(id) { const p = w.projects[id]; return p ? { ...p } : null; },
    async writeProject(id, patch) {
      calls.push(`updateProject:${Object.keys(patch).sort().join(",")}`);
      const p = w.projects[id]; if (!p) throw new Error("no project");
      put(p, { ...("notes" in patch ? { notes: patch.notes! } : {}), ...("start_date" in patch ? { startDate: patch.start_date! } : {}), ...("planned_hours" in patch ? { plannedHours: patch.planned_hours! } : {}), ...("planned_days" in patch ? { plannedDays: patch.planned_days! } : {}), ...("project_type" in patch ? { projectType: patch.project_type! } : {}), ...("parent_project" in patch ? { parentProject: patch.parent_project! } : {}), ...("deadline" in patch ? { deadline: patch.deadline! } : {}) });
    },
    async readRelease(pid) { const r = w.releases[pid]; return r ? { projectName: w.projects[pid]?.name ?? "", ...r } : null; },
    async writeRelease(pid, expected, patch) {
      calls.push(`updateReleaseDetails:${Object.keys(patch).sort().join(",")}`);
      const r = w.releases[pid]; if (!r) return "not_found"; if (r.updatedAt !== expected) return "conflict";
      put(r, { ...patch, updatedAt: new Date(Date.parse(r.updatedAt) + 1000).toISOString() } as Partial<typeof r>); return "ok";
    },
    async readMixWork(id) { return w.works[id] ? { ...w.works[id] } : null; },
    async listMixVersions(wid) { return Object.entries(w.versions).filter(([, v]) => v.workId === wid).map(([id, v]) => ({ id, label: v.label, status: v.status, createdAt: v.createdAt })); },
    async listMixComments(wid) { return Object.entries(w.comments).filter(([, c]) => w.versions[c.versionId]?.workId === wid).map(([id, c]) => ({ id, versionId: c.versionId, versionLabel: w.versions[c.versionId].label, text: c.text, status: c.status, timestampSeconds: null, createdAt: c.createdAt })); },
    async readMixComment(id) { const c = w.comments[id]; if (!c) return null; const v = w.versions[c.versionId]; return { workId: v.workId, versionLabel: v.label, text: c.text, status: c.status }; },
    async writeMixCommentStatus(id, status) { calls.push(`updateMixCommentStatus:${status}`); put(w.comments[id], { status }); },
    async readMixVersion(id) { const v = w.versions[id]; return v ? { workId: v.workId, label: v.label, status: v.status } : null; },
    async writeMixVersion(id, patch) { calls.push(`updateMixVersion:${Object.keys(patch).sort().join(",")}`); put(w.versions[id], patch); },
    async readLabelArtist(id) { const a = w.artists[id]; return a ? { ...a } : null; },
    async writeLabelArtist(id, patch) { calls.push(`updateLabelArtist:${Object.keys(patch).sort().join(",")}`); if (!w.artists[id]) return "not_found"; put(w.artists[id], patch); return "ok"; },
    async readVictorWork(id) { const v = w.victor[id]; return v ? { title: v.title, vendorName: v.vendorName, workState: v.workState, outcome: v.outcome, notes: v.notes } : null; },
    async writeVictorWork(id, patch) { calls.push(`updateVictorWork:${Object.keys(patch).sort().join(",")}`); put(w.victor[id], patch); },
  };
}

const OWNER = { ownerId: "owner-user-1", clientId: "client-1" };
const SECRET = approvalKeyFrom("s".repeat(40));
let clock = Date.parse("2026-09-27T09:00:00Z");
let planSeq = 0;
function mkDeps(o: { world?: World; calls?: string[]; db?: FakeDb; owner?: boolean; silentFail?: boolean; registry?: ReadonlyMap<string, ActionContract> } = {}) {
  const world = o.world ?? freshWorld(), calls = o.calls ?? [], db = o.db ?? new FakeDb();
  const d: ActServiceDeps = {
    nowMs: () => clock, approvalSecret: SECRET, registry: o.registry ?? ACTION_REGISTRY, registryVersion: ACTION_REGISTRY_VERSION,
    stores: supabaseActStores(db.client()), writers: fakeWriters(world, calls, { silentFail: o.silentFail }),
    isOwner: async (u) => (o.owner ?? true) && u === OWNER.ownerId, knownSecrets: ["S3RVER-SECRET-VALUE-XYZ"],
    newPlanId: () => `pl_${String(++planSeq).padStart(18, "t")}`,
  };
  return { d, world, calls, db };
}
const YES = "כן בוס, מאשר";
async function fullFlow(d: ActServiceDeps, actionId: string, args: Record<string, unknown>) {
  const p = await planAction({ intentHe: "בקשה בשיחה", actionId, args }, OWNER, d);
  if (p.status !== "PREVIEW") return { p, a: null, e: null };
  const a = await approveAction({ planId: p.planId, planHash: p.planHash, confirmationText: YES }, OWNER, d);
  const e = await executeAction({ planId: p.planId, approvalToken: a.approvalToken, confirmationText: YES }, OWNER, d);
  return { p, a, e };
}

(async () => {
  // ── A. DB stores ──
  section("A. Database stores (fail closed, allowlist-only)");
  {
    const { d, db } = mkDeps();
    const r = await planAction({ intentHe: "תוסיפי הערה לפרויקט", actionId: "UPDATE_PROJECT_NOTES", args: { project: `project:${U(1)}`, notes: "הזמר צריך להקליט מחדש את הפזמון", mode: "APPEND" } }, OWNER, d);
    const row = db.rows(ACT_TABLES.plans)[0];
    ok("A1. a plan persists (one row, hash-bound, allowlisted JSON, no token / confirmation)", r.status === "PREVIEW" && db.rows(ACT_TABLES.plans).length === 1 && row.plan_hash === r.planHash && planHash(row.plan as Plan) === row.plan_hash && !JSON.stringify(row).includes("ak1.") && !JSON.stringify(row).includes(YES));
    ok("A1b. PLAN_CREATED + PREVIEWED events appended", db.rows(ACT_TABLES.events).map((e) => e.event_type).join() === "PLAN_CREATED,PREVIEWED");
    const a = await approveAction({ planId: r.planId, planHash: r.planHash, confirmationText: YES }, OWNER, d);
    ok("A1c. approving stores nothing (token returned to the caller only)", a.status === "APPROVED_PENDING_EXECUTION" && db.rows(ACT_TABLES.approvals).length === 0);
    const e = await executeAction({ planId: r.planId, approvalToken: a.approvalToken, confirmationText: YES }, OWNER, d);
    ok("A2. the approval nonce persists exactly once (no token, no confirmation text)", e.status === "APPLIED_AS_EXPECTED" && db.rows(ACT_TABLES.approvals).length === 1 && !JSON.stringify(db.rows(ACT_TABLES.approvals)).includes("ak1.") && !JSON.stringify(db.tables).includes(YES));
    const ex = db.rows(ACT_TABLES.executions);
    ok("A3. the execution row: claimed then recorded (status + sanitized outcome)", ex.length === 1 && ex[0].status === "APPLIED_AS_EXPECTED" && !!ex[0].recorded_at && (ex[0].outcome as { status: string }).status === "APPLIED_AS_EXPECTED");
    ok("A4. events append in order (… APPROVED, VERIFIED, STEP_EXECUTED)", db.rows(ACT_TABLES.events).map((x) => x.event_type).join() === "PLAN_CREATED,PREVIEWED,APPROVED,VERIFIED,STEP_EXECUTED");
    const st = supabaseActStores(new FakeDb().client());
    ok("A3b. a claim is atomic: the second claim of the same key is refused", (await st.idem.claim("a".repeat(64), { planId: "pl_x", stepIndex: 0, actionId: "X", actionVersion: 1 })) === true && (await st.idem.claim("a".repeat(64), { planId: "pl_x", stepIndex: 0, actionId: "X", actionVersion: 1 })) === false);
    const both = await Promise.all([st.idem.claim("b".repeat(64), { planId: "pl_y", stepIndex: 0, actionId: "X", actionVersion: 1 }), st.idem.claim("b".repeat(64), { planId: "pl_y", stepIndex: 0, actionId: "X", actionVersion: 1 })]);
    ok("A3c. concurrent claims → exactly one wins", both.filter(Boolean).length === 1);
    ok("A3d. a nonce is consumed once", (await st.nonces.consume({ nonce: "n".repeat(20), planId: "pl_x", planHash: "0".repeat(64), ownerId: "o", clientId: "c", expMs: clock })) === true && (await st.nonces.consume({ nonce: "n".repeat(20), planId: "pl_x", planHash: "0".repeat(64), ownerId: "o", clientId: "c", expMs: clock })) === false);
  }
  {
    const { d, db, calls } = mkDeps();
    db.failOn = ACT_TABLES.plans;
    let threw = false;
    try { await planAction({ intentHe: "x", actionId: "UPDATE_PROJECT_NOTES", args: { project: `project:${U(1)}`, notes: "abc", mode: "REPLACE" } }, OWNER, d); } catch (e) { threw = e instanceof ActStoreError; }
    ok("A5. a failed plan write fails closed (store error surfaces; nothing written anywhere)", threw && calls.length === 0 && !db.rows(ACT_TABLES.events).length);
    const h = await handleInternalAct({ header: () => "s".repeat(40), bodyText: async () => JSON.stringify({ op: "plan", ownerId: OWNER.ownerId, clientId: OWNER.clientId, input: { intentHe: "x", actionId: "UPDATE_PROJECT_NOTES", args: { project: `project:${U(1)}`, notes: "abc", mode: "REPLACE" } } }) }, { PARTNER_ACT_ENABLED: "true", PARTNER_INTERNAL_ACT_SECRET: "s".repeat(40) }, async () => d);
    ok("A5b. through the endpoint a store failure is FAILED_CLOSED (never 'done')", (h.body as { status: string }).status === "FAILED_CLOSED" && calls.length === 0);
    const { d: d2, db: db2, calls: c2, world: w2 } = mkDeps();
    const p = await planAction({ intentHe: "x", actionId: "UPDATE_PROJECT_NOTES", args: { project: `project:${U(1)}`, notes: "abc", mode: "REPLACE" } }, OWNER, d2);
    const a = await approveAction({ planId: p.planId, planHash: p.planHash, confirmationText: YES }, OWNER, d2);
    db2.failOn = `${ACT_TABLES.executions}:insert`;
    const e = await executeAction({ planId: p.planId, approvalToken: a.approvalToken, confirmationText: YES }, OWNER, d2);
    ok("A5c. if the execution claim cannot be written, NOTHING is executed (OUTCOME_UNKNOWN, no write)", e.status === "OUTCOME_UNKNOWN" && c2.length === 0 && w2.projects[U(1)].notes === "הערה קיימת");
  }
  {
    const { d, db } = mkDeps();
    const r = await planAction({ intentHe: "x", actionId: "UPDATE_PROJECT_NOTES", args: { project: `project:${U(1)}`, notes: "Authorization: Bearer abcdefghijklmnopqrstuv", mode: "REPLACE" } }, OWNER, d);
    ok("A6. a forbidden value never reaches the database (refused before persistence)", r.status !== "PREVIEW" && db.rows(ACT_TABLES.plans).length === 0);
    const r2 = await planAction({ intentHe: "x", actionId: "UPDATE_PROJECT_NOTES", args: { project: `project:${U(1)}`, notes: "הערה עם https://example.com/x", mode: "REPLACE" } }, OWNER, d);
    ok("A6b. a URL in a note is refused (a known Wave 1 limit, stated to the Boss)", r2.status !== "PREVIEW" && db.rows(ACT_TABLES.plans).length === 0);
    let threw = false;
    try { await supabaseActStores(db.client()).plans.save({ planId: "pl_" + "z".repeat(18), ownerId: "o", clientId: "c", intentHe: "x", steps: [], riskClass: "SAFE_REVERSIBLE", confirmation: "C1_APPROVAL", effects: [], createdAt: new Date(clock).toISOString(), expiresAt: new Date(clock + 60000).toISOString() } as Plan, ACTION_REGISTRY, "v"); } catch (e) { threw = e instanceof ActStoreError; }
    ok("A6c. the store itself refuses a non-persistable plan (defense in depth)", threw && db.rows(ACT_TABLES.plans).length === 0);
    const w = freshWorld(); w.projects[U(1)].notes = "קישור ישן https://dropbox.com/x ועוד טקסט";
    const m = mkDeps({ world: w });
    const r3 = await planAction({ intentHe: "x", actionId: "UPDATE_PROJECT_NOTES", args: { project: `project:${U(1)}`, notes: "שורה חדשה", mode: "APPEND" } }, OWNER, m.d);
    ok("A6d. an EXISTING note with a link is never persisted — the plan stores a neutral description; the preview shows it live", r3.status === "PREVIEW" && !JSON.stringify(m.db.tables).includes("dropbox.com") && JSON.stringify(r3.changes).includes("dropbox.com"));
  }

  // ── B. Authorization ──
  section("B. Authorization (endpoint + connector)");
  {
    const { d } = mkDeps();
    const body = (o: Record<string, unknown>) => async () => JSON.stringify(o);
    const good = { op: "status", ownerId: OWNER.ownerId, clientId: OWNER.clientId, input: { planId: "pl_" + "q".repeat(18) } };
    const H = (env: Record<string, string>, hdr: string | null, b = good) => handleInternalAct({ header: () => hdr, bodyText: body(b) }, env, async () => d);
    const ENV = { PARTNER_ACT_ENABLED: "true", PARTNER_INTERNAL_ACT_SECRET: "s".repeat(40) };
    ok("B8. act switch OFF → 404 (nothing read)", (await H({ PARTNER_INTERNAL_ACT_SECRET: "s".repeat(40) }, "s".repeat(40))).status === 404);
    ok("B8b. on the MCP-only connector itself → 404", (await H({ ...ENV, REDBLOODS_MCP_ONLY: "true" }, "s".repeat(40))).status === 404);
    ok("B8c. secret not configured → 503", (await H({ PARTNER_ACT_ENABLED: "true" }, "s".repeat(40))).status === 503);
    ok("B8d. missing / wrong secret → 401", (await H(ENV, null)).status === 401 && (await H(ENV, "x".repeat(40))).status === 401);
    ok("B8e. unknown op / extra keys / generic payload → 400", (await H(ENV, "s".repeat(40), { ...good, op: "sql" })).status === 400 && (await H(ENV, "s".repeat(40), { ...good, route: "/api/x" } as typeof good)).status === 400 && (await H(ENV, "s".repeat(40), { ...good, input: { planId: "pl_" + "q".repeat(18), body: {} } } as typeof good)).status === 400);
    ok("B8f. exactly five operations", ACT_OPS.join() === "plan,preview,approve,execute,status");
    const notOwner = mkDeps({ owner: false });
    ok("B9. a non-Owner (live check) is refused", (await planAction({ intentHe: "x", actionId: "UPDATE_PROJECT_NOTES", args: { project: `project:${U(1)}`, notes: "a", mode: "REPLACE" } }, OWNER, notOwner.d)).status === "NOT_OWNER");
    const m = mkDeps();
    const p = await planAction({ intentHe: "x", actionId: "UPDATE_PROJECT_DEADLINE", args: { project: `project:${U(1)}`, deadline: "2026-10-10" } }, OWNER, m.d);
    const other = { ownerId: OWNER.ownerId, clientId: "client-2" };
    ok("B10. another connector client cannot see / approve / execute the plan", (await previewAction({ planId: p.planId }, other, m.d)).status === "PLAN_NOT_FOUND" && (await approveAction({ planId: p.planId, planHash: p.planHash, confirmationText: YES }, other, m.d)).status === "PLAN_NOT_FOUND");
    const tok = issueApprovalToken(SECRET, { planHash: String(p.planHash), ownerId: OWNER.ownerId, clientId: OWNER.clientId, nowMs: clock - 11 * 60_000 });
    const ex = await executeAction({ planId: p.planId, approvalToken: tok, confirmationText: YES }, OWNER, m.d);
    ok("B11. an expired approval → refused, no write", ex.status === "REFUSED" && ex.refusal === "TOKEN_EXPIRED" && m.calls.length === 0);
    const a = await approveAction({ planId: p.planId, planHash: p.planHash, confirmationText: YES }, OWNER, m.d);
    const e1 = await executeAction({ planId: p.planId, approvalToken: a.approvalToken, confirmationText: YES }, OWNER, m.d);
    const e2 = await executeAction({ planId: p.planId, approvalToken: a.approvalToken, confirmationText: YES }, OWNER, m.d);
    ok("B12. replaying the same approval never writes twice (recorded outcome returned)", e1.status === "APPLIED_AS_EXPECTED" && e2.status === "APPLIED_AS_EXPECTED" && (e2.steps as Array<{ replayed: boolean }>)[0].replayed && m.calls.length === 1);

    // connector gate
    const base = { PARTNER_MCP_ENABLED: "true", PARTNER_MCP_BASE_URL: "https://c.example", PARTNER_MCP_SECRET: "m".repeat(64), REDBLOODS_MCP_ONLY: "true", PARTNER_MCP_ANSWER_ENABLED: "true", PARTNER_MCP_KNOWLEDGE_ENABLED: "true" };
    const offCfg = readMcpConfig(base), onCfg = readMcpConfig({ ...base, PARTNER_MCP_ACT_ENABLED: "true", PARTNER_MAIN_BASE_URL: "https://main.example", PARTNER_INTERNAL_ACT_SECRET: "s".repeat(40) });
    ok("B7. act switch requires the flag + MCP-only + MAIN URL + a ≥32-char secret", offCfg.ok && !offCfg.config.actEnabled && onCfg.ok && onCfg.config.actEnabled && !(readMcpConfig({ ...base, PARTNER_MCP_ACT_ENABLED: "true", PARTNER_MAIN_BASE_URL: "https://main.example", PARTNER_INTERNAL_ACT_SECRET: "short" }) as { config: { actEnabled: boolean } }).config.actEnabled);
    const on = (onCfg as { config: McpDeps["config"] }).config, off = (offCfg as { config: McpDeps["config"] }).config;
    ok("B7b. partner:act is advertised / granted only when on (and a read-only request stays read-only)", !scopeString({ answer: off.answerEnabled, knowledge: off.knowledgeEnabled, act: off.actEnabled }).includes("partner:act") && grantedScope(on, null).endsWith("partner:act") && grantedScope(on, "partner:read") === "partner:read" && !grantedScope(off, "partner:read partner:act").includes("partner:act"));
    const relayed: string[] = [];
    const mcpDeps = (cfg: McpDeps["config"], scope: string, withAct: boolean): McpDeps => ({
      config: cfg, authenticate: async () => ({ ok: true, principal: { tokenId: "t1", clientId: OWNER.clientId, userId: OWNER.ownerId, scope } }),
      gateway: { brief: async () => ({}), resolve: async () => ({}), entity: async () => ({}), query: async () => ({ status: "OK" }), capabilityIndex: () => [] },
      limiter: new SlidingWindowLimiter([{ windowMs: 60_000, max: 1000 }]), audit: async () => undefined, auditRejected: async () => undefined, nowMs: () => Date.now(),
      ...(withAct ? { act: { limiter: new SlidingWindowLimiter([{ windowMs: 60_000, max: 1000 }]), call: async (op: string) => { relayed.push(op); return { status: "PREVIEW" }; } } } : {}),
    });
    const rpc = async (dps: McpDeps, method: string, params?: unknown) => JSON.parse((await handleMcpHttp({ method: "POST", header: (n) => (n === "authorization" ? "Bearer x" : null), bodyText: async () => JSON.stringify({ jsonrpc: "2.0", id: 1, method, ...(params ? { params } : {}) }) }, dps)).body ?? "{}");
    const toolsOf = async (dps: McpDeps) => ((await rpc(dps, "tools/list")).result?.tools ?? []).map((t: { name: string }) => t.name);
    ok("B7c. switch OFF → no action tool listed, and calling one = Unknown tool (nothing relayed)", !(await toolsOf(mcpDeps(off, "partner:read partner:answer partner:knowledge partner:act", false))).some((n: string) => n.includes("action") || n.includes("plan")) && (await rpc(mcpDeps(off, "partner:read partner:act", false), "tools/call", { name: "partner_plan_action", arguments: {} })).error?.message === "Unknown tool" && relayed.length === 0);
    ok("B7d. switch ON but the token lacks partner:act → tools not listed", !(await toolsOf(mcpDeps(on, "partner:read partner:answer partner:knowledge", true))).includes("partner_plan_action"));
    const noScopeCall = await handleMcpHttp({ method: "POST", header: (n) => (n === "authorization" ? "Bearer x" : null), bodyText: async () => JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "partner_plan_status", arguments: { planId: "pl_" + "q".repeat(18) } } }) }, mcpDeps(on, "partner:read", true));
    ok("B7e. …and calling one → HTTP 403 insufficient_scope (step-up), nothing relayed", noScopeCall.status === 403 && relayed.length === 0);
    const onTools: string[] = await toolsOf(mcpDeps(on, "partner:read partner:act", true));
    ok("B7f. switch ON + partner:act → exactly the five action tools listed", ["partner_plan_action", "partner_preview_action", "partner_approve_action", "partner_execute_plan", "partner_plan_status"].every((n) => onTools.includes(n)) && onTools.filter((n) => /_action$|_plan$|_status$/.test(n)).length === 5, onTools);
    const bad = await rpc(mcpDeps(on, "partner:read partner:act", true), "tools/call", { name: "partner_plan_action", arguments: { intentHe: "x", actionId: "UPDATE_PROJECT_NOTES", args: { sql: "drop table projects" } } });
    ok("B7g. a generic-writer argument is refused at the connector (never relayed)", !!bad.error && relayed.length === 0);
    await rpc(mcpDeps(on, "partner:read partner:act", true), "tools/call", { name: "partner_plan_status", arguments: { planId: "pl_" + "q".repeat(18) } });
    ok("B7h. a valid call is relayed to MAIN as one typed op", relayed.join() === "status");
    ok("B7i. the MCP-only fetch guard allows ONLY a POST to the exact MAIN act URL (when configured)", isAllowedMcpOnlyFetch(new URL("https://main.example/api/partner/internal/act"), "POST", "db.example", { internalActUrls: ["https://main.example/api/partner/internal/act"] }) && !isAllowedMcpOnlyFetch(new URL("https://main.example/api/partner/internal/act"), "POST", "db.example", {}) && !isAllowedMcpOnlyFetch(new URL("https://main.example/api/projects/1"), "POST", "db.example", { internalActUrls: ["https://main.example/api/partner/internal/act"] }) && !isAllowedMcpOnlyFetch(new URL("https://main.example/api/partner/internal/act"), "DELETE", "db.example", { internalActUrls: ["https://main.example/api/partner/internal/act"] }));
    ok("B7j. the relay URL derives only from PARTNER_MAIN_BASE_URL (https)", internalActUrl({ PARTNER_MAIN_BASE_URL: "https://main.example" }) === "https://main.example/api/partner/internal/act" && internalActUrl({ PARTNER_MAIN_BASE_URL: "http://evil.example" }) === null);
    const r = await callInternalAct("execute", OWNER, {}, { PARTNER_MAIN_BASE_URL: "https://main.example", PARTNER_INTERNAL_ACT_SECRET: "s".repeat(40) }, (async () => { throw new Error("network"); }) as unknown as typeof fetch);
    ok("B7k. a lost execute response is OUTCOME_UNKNOWN, never success", r.status === "OUTCOME_UNKNOWN");
  }

  // ── C. Approval ──
  section("C. Approval (real, not ceremonial)");
  {
    const m = mkDeps();
    const p = await planAction({ intentHe: "x", actionId: "UPDATE_PROJECT_DEADLINE", args: { project: `project:${U(1)}`, deadline: "2026-10-10" } }, OWNER, m.d);
    ok("C-preview. the preview names the entity, current → new, what will NOT happen, and asks", p.status === "PREVIEW" && JSON.stringify(p.entity).includes("קרוב אלייך") && JSON.stringify(p.changes).includes("2026-10-01") && JSON.stringify(p.changes).includes("2026-10-10") && (p.disclosuresHe as string[]).some((x) => x.includes("Push")) && String(p.askHe).includes("לאשר"));
    ok("C13. no approval → no mutation", (await executeAction({ planId: p.planId, approvalToken: "", confirmationText: "" }, OWNER, m.d)).status === "REFUSED" && m.calls.length === 0);
    ok("C13b. an empty approval text is not an approval", (await approveAction({ planId: p.planId, planHash: p.planHash, confirmationText: "  " }, OWNER, m.d)).status === "APPROVAL_MISSING");
    ok("C14. approving a different plan hash than the stored plan → refused", (await approveAction({ planId: p.planId, planHash: "0".repeat(64), confirmationText: YES }, OWNER, m.d)).status === "PLAN_CHANGED");
    const stored = m.db.rows(ACT_TABLES.plans)[0];
    const tampered = JSON.parse(JSON.stringify(stored.plan)); tampered.steps[0].args.deadline = "2027-01-01"; stored.plan = tampered;
    const a = await approveAction({ planId: p.planId, planHash: p.planHash, confirmationText: YES }, OWNER, m.d).catch(() => ({ status: "THREW" }));
    ok("C15. arguments modified in storage after the preview → refused (hash mismatch), no write", a.status !== "APPROVED_PENDING_EXECUTION" && m.calls.length === 0);
    const m2 = mkDeps();
    const p2 = await planAction({ intentHe: "x", actionId: "UPDATE_PROJECT_DEADLINE", args: { project: `project:${U(1)}`, deadline: "2026-10-10" } }, OWNER, m2.d);
    const a2 = await approveAction({ planId: p2.planId, planHash: p2.planHash, confirmationText: YES }, OWNER, m2.d);
    const t = JSON.parse(JSON.stringify(m2.db.rows(ACT_TABLES.plans)[0].plan)); t.steps[0].entities = [`project:${U(2)}`]; m2.db.rows(ACT_TABLES.plans)[0].plan = t;
    const e2 = await executeAction({ planId: p2.planId, approvalToken: a2.approvalToken, confirmationText: YES }, OWNER, m2.d);
    ok("C16. entity modified after approval → refused, no write", e2.status !== "APPLIED_AS_EXPECTED" && m2.calls.length === 0);
    const m3 = mkDeps();
    const p3 = await planAction({ intentHe: "x", actionId: "UPDATE_PROJECT_DEADLINE", args: { project: `project:${U(1)}`, deadline: "2026-10-10" } }, OWNER, m3.d);
    const a3 = await approveAction({ planId: p3.planId, planHash: p3.planHash, confirmationText: YES }, OWNER, m3.d);
    const t3 = JSON.parse(JSON.stringify(m3.db.rows(ACT_TABLES.plans)[0].plan)); t3.effects = ["PUSH"]; m3.db.rows(ACT_TABLES.plans)[0].plan = t3;
    const e3 = await executeAction({ planId: p3.planId, approvalToken: a3.approvalToken, confirmationText: YES }, OWNER, m3.d);
    ok("C17. side effects modified after approval → refused, no write", e3.status !== "APPLIED_AS_EXPECTED" && m3.calls.length === 0);
  }

  // ── D. Stale ──
  section("D. Stale state (real DB-backed flow)");
  {
    const m = mkDeps();
    const p = await planAction({ intentHe: "x", actionId: "UPDATE_PROJECT_DEADLINE", args: { project: `project:${U(1)}`, deadline: "2026-10-10" } }, OWNER, m.d);
    m.world.projects[U(1)].deadline = "2026-10-05"; // someone changed it in the app meanwhile
    const pv = await previewAction({ planId: p.planId }, OWNER, m.d);
    ok("D18a. a re-preview tells the Boss the state changed", pv.status === "STALE" && String(pv.messageHe).includes("השתנה"));
    const a = await approveAction({ planId: p.planId, planHash: p.planHash, confirmationText: YES }, OWNER, m.d);
    const e = await executeAction({ planId: p.planId, approvalToken: a.approvalToken, confirmationText: YES }, OWNER, m.d);
    ok("D18. execute after the live state changed → STALE", e.status === "STALE" && String(e.messageHe).includes("תצוגה חדשה"));
    ok("D19. no write on stale; the other change is untouched", m.calls.length === 0 && m.world.projects[U(1)].deadline === "2026-10-05" && m.db.rows(ACT_TABLES.executions).length === 0 && m.db.rows(ACT_TABLES.events).some((x) => x.event_type === "STALE"));
  }

  // ── E. Execution ──
  section("E. Execution");
  {
    const m = mkDeps();
    const { e } = await fullFlow(m.d, "UPDATE_PROJECT_DEADLINE", { project: `project:${U(1)}`, deadline: "2026-10-10" });
    ok("E20. a registered primitive executes through the shared writer only", e?.status === "APPLIED_AS_EXPECTED" && m.calls.join() === "updateProject:deadline" && m.world.projects[U(1)].deadline === "2026-10-10");
    ok("E22. the result carries a fresh read of the live state + 'בוצע בוס'", JSON.stringify(e?.freshState).includes("2026-10-10") && String(e?.messageHe).includes("בוצע בוס"));
    const inv = await planAction({ intentHe: "x", actionId: "PROJECT.EDIT_NOTES", args: {} }, OWNER, m.d);
    ok("E21. a non-executable / unregistered action refuses (no plan, no executor)", inv.status === "INVALID_INPUT" || inv.status === "NOT_AVAILABLE");
    ok("E21b. a NEEDS_HARDENING Wave 1 candidate is refused as not available", (await planAction({ intentHe: "x", actionId: "UPDATE_CLIENT_CONTACT", args: {} }, OWNER, m.d)).status === "NOT_AVAILABLE");
    ok("E21c. finance / security actions cannot be planned through Claude", (await planAction({ intentHe: "x", actionId: "RECORD_PAID_EXPENSE", args: {} }, OWNER, m.d)).status !== "PREVIEW" && (await planAction({ intentHe: "x", actionId: "SUNNY.CONNECTOR_OAUTH", args: {} }, OWNER, m.d)).status !== "PREVIEW");
    const s = mkDeps({ silentFail: true });
    const { e: se } = await fullFlow(s.d, "UPDATE_PROJECT_DEADLINE", { project: `project:${U(1)}`, deadline: "2026-10-10" });
    ok("E23. a write the fresh read cannot confirm is FAILED — never reported as success", se?.status === "FAILED" && !String(se?.messageHe).includes("בוצע בוס"), se);
    const st = await planStatus({ planId: (await planAction({ intentHe: "x", actionId: "UPDATE_PROJECT_NOTES", args: { project: `project:${U(1)}`, notes: "x", mode: "REPLACE" } }, OWNER, m.d)).planId }, OWNER, m.d);
    ok("E-status. an unexecuted plan reports NOT_EXECUTED", st.status === "NOT_EXECUTED");
    const rsE = (await fullFlow(mkDeps().d, "CHANGE_RELEASE_STAGE", { project: `project:${U(1)}`, releaseStage: "מאסטר" })).e;
    ok("E-next. after success the next step is DERIVED, only a proposal, and never executed", rsE?.status === "APPLIED_AS_EXPECTED" && (rsE?.nextStep as { epistemic?: string; needsBossApproval?: boolean } | null)?.epistemic === "DERIVED" && (rsE?.nextStep as { needsBossApproval?: boolean }).needsBossApproval === true);
    const rs = await fullFlow(mkDeps().d, "UPDATE_MIX_VERSION_STATUS_OR_LABEL", { mixWork: `mix-work:${U(20)}`, which: "LATEST", status: "מוכן" });
    ok("E-next2. a derived next step is labelled DERIVED and needs the Boss", (rs.e?.nextStep as { epistemic?: string; needsBossApproval?: boolean } | null)?.epistemic === "DERIVED" && (rs.e?.nextStep as { needsBossApproval?: boolean }).needsBossApproval === true);
  }

  // ── F. Idempotency ──
  section("F. Idempotency (real persistence)");
  {
    const m = mkDeps();
    const p = await planAction({ intentHe: "x", actionId: "UPDATE_PROJECT_NOTES", args: { project: `project:${U(1)}`, notes: "שורה", mode: "APPEND" } }, OWNER, m.d);
    const a = await approveAction({ planId: p.planId, planHash: p.planHash, confirmationText: YES }, OWNER, m.d);
    const [x, y] = await Promise.all([executeAction({ planId: p.planId, approvalToken: a.approvalToken, confirmationText: YES }, OWNER, m.d), executeAction({ planId: p.planId, approvalToken: a.approvalToken, confirmationText: YES }, OWNER, m.d)]);
    ok("F25. a simulated network retry (two concurrent executes) mutates once", m.calls.length === 1 && [x.status, y.status].includes("APPLIED_AS_EXPECTED") && m.world.projects[U(1)].notes === "הערה קיימת\nשורה");
    const a2 = await approveAction({ planId: p.planId, planHash: p.planHash, confirmationText: YES }, OWNER, m.d);
    const z = await executeAction({ planId: p.planId, approvalToken: a2.approvalToken, confirmationText: YES }, OWNER, m.d);
    ok("F24. a connector retry with a NEW approval of the same plan returns the recorded outcome, never a second write", z.status === "APPLIED_AS_EXPECTED" && (z.steps as Array<{ replayed: boolean }>)[0].replayed && m.calls.length === 1 && m.world.projects[U(1)].notes === "הערה קיימת\nשורה");
    const st = await planStatus({ planId: p.planId }, OWNER, m.d);
    ok("F24b. plan status reads the recorded outcome", st.status === "EXECUTED" && (st.steps as Array<{ status: string }>)[0].status === "APPLIED_AS_EXPECTED");
  }

  // ── partial failure (compound plan, test registry, DB-backed stores) ──
  section("Partial failure (compound plan on the DB-backed engine)");
  {
    const db = new FakeDb();
    const st = supabaseActStores(db.client());
    const mk = (id: string, over: Partial<ActionContract> = {}): ActionContract => ({ id, version: 1, domain: "TEST", meaningHe: id, meaningEn: id, businessEvents: [], args: [{ name: "value", kind: "text", required: true }], preconditions: [], riskClass: "SAFE_REVERSIBLE", confirmation: "C1_APPROVAL", effects: [], possibleEffects: [], phase: "INTERNAL", reversible: "YES", compensation: null, idempotency: "EXECUTION_KEY", availability: "SUNNY_EXECUTABLE", availabilityDetail: "EXECUTABLE", reason: "t", wave: "W1", disclosuresHe: [], internal: { routes: [], source: "t", writer: "t", verifier: "t" }, ...over });
    const REG = new Map<string, ActionContract>([["T.A", mk("T.A")], ["T.B", mk("T.B")], ["T.MSG", mk("T.MSG", { effects: ["PUSH"], phase: "COMMUNICATION", riskClass: "EXTERNAL_COMMUNICATION", confirmation: "C3_STRONG_APPROVAL" })]]);
    const w: Record<string, string> = { a: "1", b: "1", msg: "0" };
    const done: string[] = [];
    const ex = (k: string, fails = false): PrimitiveExecutor => ({ fingerprint: async () => "f".repeat(64), execute: async (s) => { if (fails) throw new Error("boom with password=hunter2hunter2"); done.push(k); w[k] = String(s.args.value); return { changed: true }; }, verify: async (s) => w[k] === String(s.args.value) });
    const step = (i: number, id: string, deps: number[] = []): PlanStep => ({ index: i, actionId: id, actionVersion: 1, args: { value: "2" }, entities: [`thing:${U(90 + i)}`], phase: REG.get(id)!.phase, expectedFingerprint: "f".repeat(64), changes: [{ field: "value", before: "1", after: "2" }], dependsOn: deps });
    const plan: Plan = { planId: "pl_" + "c".repeat(18), ownerId: OWNER.ownerId, clientId: OWNER.clientId, intentHe: "compound", steps: [step(0, "T.A"), step(1, "T.B", [0]), step(2, "T.MSG", [1])], riskClass: "EXTERNAL_COMMUNICATION", confirmation: "C3_STRONG_APPROVAL", effects: ["PUSH"], createdAt: new Date(clock).toISOString(), expiresAt: new Date(clock + 10 * 60_000).toISOString() };
    await st.plans.save(plan, REG, "t");
    const tok = issueApprovalToken(SECRET, { planHash: planHash(plan), ownerId: OWNER.ownerId, clientId: OWNER.clientId, nowMs: clock });
    const out = await executePlan(plan, { token: tok, ownerId: OWNER.ownerId, clientId: OWNER.clientId, confirmationText: YES }, { nowMs: clock, secret: SECRET, registry: REG, executors: new Map([["T.A", ex("a")], ["T.B", ex("b", true)], ["T.MSG", ex("msg")]]), nonces: st.nonces, idem: st.idem, audit: st.audit, knownSecrets: [] });
    ok("P1. step 1 applied, step 2 failed → PARTIALLY_APPLIED", out.status === "PARTIALLY_APPLIED" && out.steps[0].status === "APPLIED_AS_EXPECTED" && out.steps[1].status === "FAILED");
    ok("P2. the dependent communication step never runs", out.steps[2].status === "NOT_RUN" && !done.includes("msg") && w.msg === "0");
    const evs = db.rows(ACT_TABLES.events).map((e) => e.event_type);
    ok("P3. the audit records reality (VERIFIED + STEP_FAILED, no success claim for step 2)", evs.includes("VERIFIED") && evs.includes("STEP_FAILED") && db.rows(ACT_TABLES.executions).map((x) => x.status).sort().join() === "APPLIED_AS_EXPECTED,FAILED");
    ok("P4. the failure detail is redacted in storage", !JSON.stringify(db.tables).includes("hunter2"));
  }

  // ── G. every primitive ──
  section("G. Every Wave 1 primitive");
  type Case = { id: string; args: Record<string, unknown>; bad: Record<string, unknown>; missing: Record<string, unknown>; wrongKind: Record<string, unknown>; stale: (w: World) => void; check: (w: World) => boolean; writer: string };
  const CASES: Case[] = [
    { id: "UPDATE_PROJECT_NOTES", args: { project: `project:${U(1)}`, notes: "הזמר צריך להקליט מחדש את הפזמון", mode: "APPEND" }, bad: { project: `project:${U(1)}`, notes: "", mode: "APPEND" }, missing: { project: `project:${U(9)}`, notes: "x", mode: "APPEND" }, wrongKind: { project: `label-artist:${U(50)}`, notes: "x", mode: "APPEND" }, stale: (w) => { w.projects[U(1)].notes = "שונה"; }, check: (w) => w.projects[U(1)].notes === "הערה קיימת\nהזמר צריך להקליט מחדש את הפזמון", writer: "updateProject:notes" },
    { id: "UPDATE_PROJECT_PLANNING", args: { project: `project:${U(1)}`, plannedHours: 12.5, plannedDays: 3 }, bad: { project: `project:${U(1)}`, plannedDays: 2.5 }, missing: { project: `project:${U(9)}`, plannedHours: 1 }, wrongKind: { project: `victor-work:${U(60)}`, plannedHours: 1 }, stale: (w) => { w.projects[U(1)].plannedHours = 99; }, check: (w) => w.projects[U(1)].plannedHours === 12.5 && w.projects[U(1)].plannedDays === 3, writer: "updateProject:planned_days,planned_hours" },
    { id: "UPDATE_PROJECT_TYPE_OR_PARENT", args: { project: `project:${U(1)}`, projectType: "אלבום" }, bad: { project: `project:${U(1)}`, projectType: "סרט" }, missing: { project: `project:${U(9)}`, projectType: "אלבום" }, wrongKind: { project: `mix-work:${U(20)}`, projectType: "אלבום" }, stale: (w) => { w.projects[U(1)].projectType = "EP"; }, check: (w) => w.projects[U(1)].projectType === "אלבום", writer: "updateProject:project_type" },
    { id: "UPDATE_PROJECT_DEADLINE", args: { project: `project:${U(1)}`, deadline: "2026-10-10" }, bad: { project: `project:${U(1)}`, deadline: "2026-02-30" }, missing: { project: `project:${U(9)}`, deadline: "2026-10-10" }, wrongKind: { project: `release:${U(1)}`, deadline: "2026-10-10" }, stale: (w) => { w.projects[U(1)].deadline = "2026-12-01"; }, check: (w) => w.projects[U(1)].deadline === "2026-10-10", writer: "updateProject:deadline" },
    { id: "UPDATE_RELEASE_DETAILS", args: { project: `project:${U(1)}`, nextAction: "לשלוח למאסטר", releaseTargetDate: "2026-11-20" }, bad: { project: `project:${U(1)}`, releaseTargetDate: "20-11-2026" }, missing: { project: `project:${U(9)}`, nextAction: "x" }, wrongKind: { project: `label-artist:${U(50)}`, nextAction: "x" }, stale: (w) => { w.releases[U(1)].blocker = "חדש"; w.releases[U(1)].updatedAt = "2026-09-26T00:00:00.000Z"; }, check: (w) => w.releases[U(1)].nextAction === "לשלוח למאסטר" && w.releases[U(1)].releaseTargetDate === "2026-11-20", writer: "updateReleaseDetails:nextAction,releaseTargetDate" },
    { id: "CHANGE_RELEASE_STAGE", args: { project: `project:${U(1)}`, releaseStage: "מאסטר" }, bad: { project: `project:${U(1)}`, releaseStage: "שלב מומצא" }, missing: { project: `project:${U(9)}`, releaseStage: "מאסטר" }, wrongKind: { project: `victor-work:${U(60)}`, releaseStage: "מאסטר" }, stale: (w) => { w.releases[U(1)].releaseStage = "עטיפה"; }, check: (w) => w.releases[U(1)].releaseStage === "מאסטר", writer: "updateReleaseDetails:releaseStage" },
    { id: "RESOLVE_MIX_COMMENT", args: { mixWork: `mix-work:${U(20)}`, which: "LATEST_OPEN" }, bad: { mixWork: `mix-work:${U(20)}`, which: "LATEST_RESOLVED" }, missing: { mixComment: `mix-comment:${U(99)}` }, wrongKind: { mixComment: `mix-version:${U(30)}` }, stale: (w) => { w.comments[U(41)].status = "resolved"; }, check: (w) => w.comments[U(41)].status === "resolved" && w.comments[U(41)].text === "הווקאל נמוך בפזמון", writer: "updateMixCommentStatus:resolved" },
    { id: "REOPEN_MIX_COMMENT", args: { mixComment: `mix-comment:${U(40)}` }, bad: { mixWork: `mix-work:${U(20)}`, which: "LATEST_OPEN" }, missing: { mixComment: `mix-comment:${U(99)}` }, wrongKind: { mixComment: `project:${U(1)}` }, stale: (w) => { w.comments[U(40)].status = "open"; }, check: (w) => w.comments[U(40)].status === "open", writer: "updateMixCommentStatus:open" },
    { id: "UPDATE_MIX_VERSION_STATUS_OR_LABEL", args: { mixWork: `mix-work:${U(20)}`, which: "LATEST", status: "מאושר" }, bad: { mixWork: `mix-work:${U(20)}`, which: "LATEST", status: "הושלם" }, missing: { mixVersion: `mix-version:${U(99)}`, status: "מוכן" }, wrongKind: { mixVersion: `mix-comment:${U(41)}`, status: "מוכן" }, stale: (w) => { w.versions[U(31)].status = "נדחה"; }, check: (w) => w.versions[U(31)].status === "מאושר" && w.versions[U(30)].status === "בבדיקה", writer: "updateMixVersion:status" },
    { id: "UPDATE_LABEL_ARTIST_NOTES_STATUS", args: { labelArtist: `label-artist:${U(50)}`, status: "בהשהייה" }, bad: { labelArtist: `label-artist:${U(50)}`, status: "מושעה" }, missing: { labelArtist: `label-artist:${U(99)}`, status: "פעיל" }, wrongKind: { labelArtist: `project:${U(1)}`, status: "פעיל" }, stale: (w) => { w.artists[U(50)].status = "לא פעיל"; }, check: (w) => w.artists[U(50)].status === "בהשהייה" && w.artists[U(50)].name === "שליו", writer: "updateLabelArtist:status" },
    { id: "UPDATE_VICTOR_WORK_STATE", args: { victorWork: `victor-work:${U(60)}`, workState: "חזר מויקטור" }, bad: { victorWork: `victor-work:${U(60)}`, workState: "הושלם" }, missing: { victorWork: `victor-work:${U(99)}`, workState: "חזר מויקטור" }, wrongKind: { victorWork: `victor-work:${U(61)}`, workState: "חזר מויקטור" }, stale: (w) => { w.victor[U(60)].workState = "דורש בדיקה"; }, check: (w) => w.victor[U(60)].workState === "חזר מויקטור" && w.victor[U(60)].status === "פעיל" && w.victor[U(60)].internalDeadline === null, writer: "updateVictorWork:workState" },
    { id: "UPDATE_VICTOR_OUTCOME", args: { victorWork: `victor-work:${U(60)}`, outcome: "אושר" }, bad: { victorWork: `victor-work:${U(60)}`, outcome: "מעולה" }, missing: { victorWork: `victor-work:${U(99)}`, outcome: "אושר" }, wrongKind: { victorWork: `project:${U(1)}`, outcome: "אושר" }, stale: (w) => { w.victor[U(60)].outcome = "נדחה"; }, check: (w) => w.victor[U(60)].outcome === "אושר" && w.victor[U(60)].status === "פעיל", writer: "updateVictorWork:outcome" },
    { id: "UPDATE_VICTOR_NOTES", args: { victorWork: `victor-work:${U(60)}`, notes: "הגרסה חזרה אליי לבדיקה", mode: "REPLACE" }, bad: { victorWork: `victor-work:${U(60)}`, notes: "x", mode: "MERGE" }, missing: { victorWork: `victor-work:${U(99)}`, notes: "x", mode: "REPLACE" }, wrongKind: { victorWork: `victor-work:${U(61)}`, notes: "x", mode: "REPLACE" }, stale: (w) => { w.victor[U(60)].notes = "מישהו כתב"; }, check: (w) => w.victor[U(60)].notes === "הגרסה חזרה אליי לבדיקה", writer: "updateVictorWork:notes" },
  ];
  ok("G0. the case table covers exactly the 13 READY primitives", CASES.map((c) => c.id).sort().join() === WAVE1_PRIMITIVES.map((p) => p.actionId).sort().join() && WAVE1_PRIMITIVES.length === 13);
  for (const c of CASES) {
    const h = mkDeps();
    const { p, e } = await fullFlow(h.d, c.id, c.args);
    ok(`G ${c.id}: happy path — plan → preview → approval → execute → exact post-write verification`, p.status === "PREVIEW" && e?.status === "APPLIED_AS_EXPECTED" && c.check(h.world) && h.calls.join() === c.writer, { p: p.status, e: e?.status, calls: h.calls });
    const b = mkDeps(); const pb = await planAction({ intentHe: "x", actionId: c.id, args: c.bad }, OWNER, b.d);
    ok(`G ${c.id}: invalid args refused (no plan, no write)`, pb.status !== "PREVIEW" && b.calls.length === 0 && !b.db.rows(ACT_TABLES.plans).length, pb.status);
    const mi = mkDeps(); const pm = await planAction({ intentHe: "x", actionId: c.id, args: c.missing }, OWNER, mi.d);
    ok(`G ${c.id}: missing entity refused`, pm.status === "ENTITY_NOT_FOUND", pm.status);
    const wk = mkDeps(); const pw = await planAction({ intentHe: "x", actionId: c.id, args: c.wrongKind }, OWNER, wk.d);
    ok(`G ${c.id}: wrong entity type refused`, ["BAD_ENTITY", "WRONG_ENTITY_TYPE", "INVALID_INPUT", "ENTITY_NOT_FOUND"].includes(String(pw.status)) && pw.status !== "PREVIEW", pw.status);
    const s = mkDeps(); const ps = await planAction({ intentHe: "x", actionId: c.id, args: c.args }, OWNER, s.d);
    c.stale(s.world);
    const as = await approveAction({ planId: ps.planId, planHash: ps.planHash, confirmationText: YES }, OWNER, s.d);
    const es = await executeAction({ planId: ps.planId, approvalToken: as.approvalToken, confirmationText: YES }, OWNER, s.d);
    ok(`G ${c.id}: stale state → STALE, no write`, es.status === "STALE" && s.calls.length === 0, es.status);
    const n = mkDeps(); const pn = await planAction({ intentHe: "x", actionId: c.id, args: c.args }, OWNER, n.d);
    const en = await executeAction({ planId: pn.planId, approvalToken: "", confirmationText: "" }, OWNER, n.d);
    ok(`G ${c.id}: no approval → no write`, en.status === "REFUSED" && n.calls.length === 0);
  }
  {
    const m = mkDeps();
    ok("G-noop. a change to the current value is refused (nothing to approve)", (await planAction({ intentHe: "x", actionId: "UPDATE_PROJECT_DEADLINE", args: { project: `project:${U(1)}`, deadline: "2026-10-01" } }, OWNER, m.d)).status === "NO_CHANGE_NEEDED");
    ok("G-latest. 'the latest version' = the newest upload (never the highest number)", (await planAction({ intentHe: "x", actionId: "UPDATE_MIX_VERSION_STATUS_OR_LABEL", args: { mixWork: `mix-work:${U(20)}`, which: "LATEST", versionLabel: "V2-final" } }, OWNER, m.d)).status === "PREVIEW" && JSON.stringify(m.db.rows(ACT_TABLES.plans).slice(-1)[0].plan).includes(`mix-version:${U(31)}`));
    ok("G-victor. a work that is not Victor's is refused", (await planAction({ intentHe: "x", actionId: "UPDATE_VICTOR_OUTCOME", args: { victorWork: `victor-work:${U(61)}`, outcome: "אושר" } }, OWNER, m.d)).status === "WRONG_ENTITY_TYPE");
  }

  // ── H. regressions / boundaries ──
  section("H. Boundaries + regressions");
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");
  const core = ["primitives.ts", "service.ts", "store-supabase.ts", "internal-handler.ts", "remote.ts", "server.ts"].map((f) => strip(read(`lib/partner/act/${f}`))).join("\n");
  ok("H1. no push / email / calendar / Google Tasks / Dropbox / finance / delete path in the action layer", !/sendPushTo|lib\/push|web-push|resend|google-calendar|createGoogleTask|createCalendarEvent|dropbox|transactions|artist_balance|\.delete\(|\.upsert\(|rpc\(/.test(core));
  const srv = strip(read("lib/partner/act/server.ts"));
  const imports = [...srv.matchAll(/import\("@\/lib\/([^"]+)"\)/g)].map((m) => m[1]).sort();
  ok("H2. MAIN uses only the UI's own shared writers / readers (+ the DB client + the role check)", JSON.stringify(imports) === JSON.stringify(["label-artists-store", "mix-comments-store", "mix-versions-store", "projects-store", "release-store", "roles", "sound-engineer-store", "supabase", "vendor-store"]), imports);
  ok("H3. the UI routes still call the same shared writers (no divergence)", /updateProject\(id, patch\)|await updateProject\(id, \{/.test(read("app/api/projects/[id]/route.ts")) && /updateReleaseDetails\(/.test(read("app/api/label/releases/[projectId]/route.ts")) && /updateMixVersion\(/.test(read("app/api/sound-engineer/versions/[versionId]/route.ts")) && /updateLabelArtist\(/.test(read("app/api/label/artists/[id]/route.ts")) && /updateVictorWork\(id, body\)/.test(read("app/api/vendor/victor/work/[id]/route.ts")));
  ok("H4. no generic writer: every executor comes from the registered action id (PRIMITIVES_BY_ID)", /executorFor\(PRIMITIVES_BY_ID\.get\(s\.actionId\)!/.test(strip(read("lib/partner/act/service.ts"))) && !/new Function|eval\(/.test(core));
  ok("H5. the Victor primitives never send status (no completion push) or a deadline (no task / Google Task sync)", WAVE1_PRIMITIVES.filter((p) => p.actionId.startsWith("UPDATE_VICTOR")).every((p) => !/status|internalDeadline/.test(p.apply.toString())));
  ok("H6. every READY primitive is an internal, reversible, no-effect contract", WAVE1_PRIMITIVES.every((p) => { const c = ACTION_REGISTRY.get(p.actionId)!; return c.effects.length === 0 && c.phase === "INTERNAL" && c.reversible === "YES" && c.availabilityDetail === "EXECUTABLE"; }));
  ok("H7. the NEEDS_HARDENING / BLOCKED candidates stay unavailable (client / meeting / social / proposal / send log / album / RF / clip / review / premix / alerts / notifications)", WAVE1_CANDIDATES.filter((w) => w.status !== "READY").every((w) => !PRIMITIVES_BY_ID.has(w.id) && ACTION_REGISTRY.get(w.id)!.availabilityDetail !== "EXECUTABLE") && WAVE1_CANDIDATES.filter((w) => w.status !== "READY").length === 12);
  ok("H8. D5 / D6 / D7 unchanged (still blocked by the Boss's decision)", ["SHOW.RECORD_SHOW_ADVANCE", "SHOW.REHEARSAL", "RF.MARK_PRODUCTION_APPROVED"].every((x) => ACTION_REGISTRY.get(x)?.availabilityDetail === "BLOCKED_BY_OWNER_DECISION"));
  ok("H9. Push-on-refresh still absent", !/api\/push\/check/.test(strip(read("components/AppShell.tsx")) + strip(read("components/PushManager.tsx"))));
  ok("H10. the connector never holds a business writer (relay only)", !/projects-store|release-store|vendor-store|mix-.*-store|label-artists-store/.test(strip(read("lib/integrations/partner-mcp/server.ts")) + strip(read("lib/integrations/partner-mcp/mcp.ts"))));

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
})();
