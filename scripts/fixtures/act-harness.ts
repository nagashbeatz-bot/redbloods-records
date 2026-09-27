/**
 * Shared test harness for Universal Action Layer primitive families: a PostgREST-faithful fake for the 4 action tables,
 * the REAL service (plan / preview / approve / execute / status) and a standard 6-check case runner per primitive:
 * happy path with exact post-write verification · invalid args · missing entity · wrong entity type · stale → no write ·
 * no approval → no write. Pure; never touches production.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { ACT_TABLES, supabaseActStores } from "../../lib/partner/act/store-supabase";
import { approveAction, executeAction, planAction, type ActServiceDeps } from "../../lib/partner/act/service";
import { approvalKeyFrom } from "../../lib/partner/act/internal-handler";
import { ACTION_REGISTRY, ACTION_REGISTRY_VERSION } from "../../lib/partner/act/registry";
import type { WriterDeps } from "../../lib/partner/act/primitives";

type Row = Record<string, unknown>;
const KEYS: Record<string, string[][]> = {
  [ACT_TABLES.plans]: [["plan_id"], ["plan_hash"]], [ACT_TABLES.approvals]: [["nonce"]],
  [ACT_TABLES.executions]: [["execution_key"], ["plan_id", "step_index"]], [ACT_TABLES.events]: [["id"]],
};
export class FakeDb {
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
      let lim: number | null = null;
      const match = (r: Row) => filters.every(([op, c, v]) => (op === "eq" ? r[c] === v : op === "neq" ? r[c] !== v : op === "lt" ? String(r[c]) < String(v) : op === "gte" ? String(r[c]) >= String(v) : (v as unknown[]).includes(r[c])));
      const run = () => {
        if (db.failOn === t || db.failOn === `${t}:${mode}`) return res(null, { message: "simulated database failure" });
        let rs = db.rows(t).filter(match);
        if (mode === "update") for (const r of rs) Object.assign(r, patch);
        if (orderCol) rs = [...rs].sort((a, b) => ((a[orderCol!] as number) < (b[orderCol!] as number) ? -1 : 1) * (asc ? 1 : -1));
        if (lim !== null) rs = rs.slice(0, lim);
        return res(rs.map((r) => ({ ...r })), null);
      };
      const chain = {
        eq(c: string, v: unknown) { filters.push(["eq", c, v]); return chain; },
        neq(c: string, v: unknown) { filters.push(["neq", c, v]); return chain; },
        lt(c: string, v: unknown) { filters.push(["lt", c, v]); return chain; },
        gte(c: string, v: unknown) { filters.push(["gte", c, v]); return chain; },
        in(c: string, v: unknown[]) { filters.push(["in", c, v]); return chain; },
        limit(n: number) { lim = n; return chain; },
        order(c: string, o?: { ascending?: boolean }) { orderCol = c; asc = o?.ascending !== false; return chain; },
        select() { return chain; },
        maybeSingle() { return run().then((r) => ({ data: (r.data as Row[] | null)?.[0] ?? null, error: r.error })); },
        then(onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) { return run().then(onF, onR); },
      };
      return {
        insert(row: Row) {
          if (db.failOn === t || db.failOn === `${t}:insert`) return res(null, { message: "simulated database failure" });
          const r: Row = { ...row, ...(t === ACT_TABLES.events ? { id: ++db.seq, created_at: new Date().toISOString() } : {}), ...(t === ACT_TABLES.executions && !("recorded_at" in row) ? { recorded_at: null } : {}) };
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

export const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const OWNER = { ownerId: "owner-user-1", clientId: "client-1" };
export const YES = "כן בוס, מאשר";
const SECRET = approvalKeyFrom("s".repeat(40));
let seq = 0;

/** Writers not faked by a family test fail loudly (never silently succeed). */
export const onlyFaked = (w: object): WriterDeps => new Proxy(w, { get: (t, k) => (k in t ? (t as Record<string | symbol, unknown>)[k] : async () => { throw new Error(`writer not faked in this test: ${String(k)}`); }) }) as unknown as WriterDeps;

export function mkDeps(writers: object, o: { owner?: boolean } = {}) {
  const db = new FakeDb();
  const d: ActServiceDeps = {
    nowMs: () => Date.parse("2026-09-27T09:00:00Z"), approvalSecret: SECRET, registry: ACTION_REGISTRY, registryVersion: ACTION_REGISTRY_VERSION,
    stores: supabaseActStores(db.client()), writers: onlyFaked(writers), isOwner: async (u) => (o.owner ?? true) && u === OWNER.ownerId,
    knownSecrets: [], newPlanId: () => `pl_${String(++seq).padStart(18, "h")}`,
  };
  return { d, db };
}

export async function fullFlow(d: ActServiceDeps, actionId: string, args: Record<string, unknown>, confirmation = YES) {
  const p = await planAction({ intentHe: "בקשה בשיחה", actionId, args }, OWNER, d);
  if (p.status !== "PREVIEW") return { p, a: null as Record<string, unknown> | null, e: null as Record<string, unknown> | null };
  const a = await approveAction({ planId: p.planId, planHash: p.planHash, confirmationText: confirmation }, OWNER, d);
  if (a.status !== "APPROVED_PENDING_EXECUTION") return { p, a, e: null };
  const e = await executeAction({ planId: p.planId, approvalToken: a.approvalToken, confirmationText: confirmation }, OWNER, d);
  return { p, a, e };
}

export interface FamilyCase<Wd> {
  id: string;
  args: Record<string, unknown>;
  /** approval text (must contain the primitive's required values, if any) */
  confirm?: string;
  bad: Record<string, unknown>;
  missing?: Record<string, unknown>;
  wrongKind?: Record<string, unknown>;
  stale: (w: Wd) => void;
  check: (w: Wd, calls: string[]) => boolean;
}
export async function runCases<Wd>(cases: readonly FamilyCase<Wd>[], mk: () => { w: Wd; calls: string[]; writers: object }, ok: (name: string, cond: boolean, detail?: unknown) => void) {
  for (const c of cases) {
    const h = mk(); const { d } = mkDeps(h.writers);
    const { p, a, e } = await fullFlow(d, c.id, c.args, c.confirm ?? YES);
    ok(`${c.id}: happy path → plan → preview → approval → execute → exact verification`, p.status === "PREVIEW" && e?.status === "APPLIED_AS_EXPECTED" && c.check(h.w, h.calls), { p: p.status, pm: p.messageHe ?? p.codes, a: a?.status, e: e?.status, steps: e?.steps, calls: h.calls });
    const b = mk(); const bb = mkDeps(b.writers); const pb = await planAction({ intentHe: "x", actionId: c.id, args: c.bad }, OWNER, bb.d);
    ok(`${c.id}: invalid args refused (no plan, no write)`, pb.status !== "PREVIEW" && b.calls.length === 0 && !bb.db.rows(ACT_TABLES.plans).length, pb.status);
    if (c.missing) { const m = mk(); const pm = await planAction({ intentHe: "x", actionId: c.id, args: c.missing }, OWNER, mkDeps(m.writers).d); ok(`${c.id}: missing entity refused`, pm.status === "ENTITY_NOT_FOUND", pm.status); }
    if (c.wrongKind) { const k = mk(); const pk = await planAction({ intentHe: "x", actionId: c.id, args: c.wrongKind }, OWNER, mkDeps(k.writers).d); ok(`${c.id}: wrong entity type refused`, pk.status !== "PREVIEW", pk.status); }
    const s = mk(); const sd = mkDeps(s.writers); const ps = await planAction({ intentHe: "x", actionId: c.id, args: c.args }, OWNER, sd.d);
    c.stale(s.w);
    const as = await approveAction({ planId: ps.planId, planHash: ps.planHash, confirmationText: c.confirm ?? YES }, OWNER, sd.d);
    const es = await executeAction({ planId: ps.planId, approvalToken: as.approvalToken, confirmationText: c.confirm ?? YES }, OWNER, sd.d);
    ok(`${c.id}: stale state → STALE, no write`, es.status === "STALE" && s.calls.length === 0, { es: es.status, calls: s.calls });
    const n = mk(); const nd = mkDeps(n.writers); const pn = await planAction({ intentHe: "x", actionId: c.id, args: c.args }, OWNER, nd.d);
    const en = await executeAction({ planId: pn.planId, approvalToken: "", confirmationText: "" }, OWNER, nd.d);
    ok(`${c.id}: no approval → no write`, en.status === "REFUSED" && n.calls.length === 0);
  }
}
