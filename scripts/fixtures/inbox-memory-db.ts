/**
 * A fake of the four Owner Inbox MEMORY RPCs that does EXACTLY what scripts/sql/2026-10-01-inbox-memory.sql does — and
 * nothing more (so a test can prove which rules live in the DB and which only in the writer, Option A):
 *   - request_key lookup BEFORE the lock, then the lock (per item / per entity, async mutex = FOR UPDATE / advisory lock),
 *     then the lookup AGAIN (the concurrency fix), then the checks, then the insert; the request_key UNIQUE raises a
 *     unique_violation that the RPC turns into REQUEST_KEY_REUSED;
 *   - structure / existence / surface-in-text / candidate membership / head chain / retract rules, as in the SQL;
 *   - it does NOT check the resolver (uniqueness of a name), the candidates' origin or the basis' truth.
 * `yieldBeforeLock` forces the race the Owner described (both calls pass the first lookup before either writes);
 * `skipRelookup` shows what would happen without the fix (a raw unique violation instead of a replay).
 */
import { createHash, randomUUID } from "node:crypto";

type Row = Record<string, unknown>;
const KEY_RE = /^(project|client|label-artist|dj|show|session|release):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const tick = () => new Promise((r) => setTimeout(r, 0));
class Mutex { private q = Promise.resolve(); run<T>(f: () => Promise<T>): Promise<T> { const p = this.q.then(f, f); this.q = p.then(() => undefined, () => undefined); return p; } }
class PgError extends Error { constructor(m: string, public code = "22023") { super(m); } }
const hash = (o: unknown) => createHash("sha256").update(JSON.stringify(o)).digest("hex");
const listOk = (p: unknown, n: number, len: number) => Array.isArray(p) && p.length <= n && p.every((x) => typeof x === "string" && x === x.trim() && x.length >= 1 && x.length <= len);

export class FakeInboxMemoryDb {
  items = new Map<string, { body: string; status: string; created_at: string }>();
  entities = new Set<string>(["vendor:VICTOR", "vendor:STEVEN"]);
  links: Row[] = [];
  interps: Row[] = [];
  rpcCalls: string[] = [];
  opts = { yieldBeforeLock: false, skipRelookup: false };
  private seq = 0;
  private itemLocks = new Map<string, Mutex>();
  private entityLocks = new Map<string, Mutex>();
  private lock(m: Map<string, Mutex>, k: string) { if (!m.has(k)) m.set(k, new Mutex()); return m.get(k)!; }
  exists(k: unknown) { return typeof k === "string" && (k === "vendor:VICTOR" || k === "vendor:STEVEN" || (KEY_RE.test(k) && this.entities.has(k))); }
  private insertUnique(table: Row[], row: Row, constraint: string) {
    if (table.some((r) => r.request_key === row.request_key)) throw new PgError(`duplicate key value violates unique constraint "${constraint}"`, "23505");
    table.push(row);
  }

  async link(a: { p_item_id: string; p_entity_key: string; p_method: string; p_surface: string; p_candidates: string[] | null; p_request_key: string }) {
    const surface = (a.p_surface ?? "").trim();
    if (!a.p_item_id || !a.p_request_key || !a.p_entity_key) throw new PgError("INVALID_REQUEST");
    if (!["RESOLVER_UNIQUE", "OWNER_ANSWER"].includes(a.p_method)) throw new PgError(`INVALID_METHOD: "${a.p_method}"`);
    let cands: string[] | null = null;
    if (a.p_method === "OWNER_ANSWER") { if (!a.p_candidates || a.p_candidates.some((c) => c === null)) throw new PgError("INVALID_CANDIDATES"); cands = [...new Set(a.p_candidates)].sort(); }
    else if (a.p_candidates) throw new PgError("CANDIDATES_NOT_ALLOWED: only OWNER_ANSWER carries candidates");
    const h = hash({ item: a.p_item_id, entity: a.p_entity_key, method: a.p_method, surface, candidates: cands });
    const replay = () => { const r = this.links.find((x) => x.request_key === a.p_request_key); if (!r) return null; if (r.payload_hash !== h) throw new PgError("REQUEST_KEY_REUSED"); return { linkId: r.id, quality: r.quality, replayed: true }; };
    const pre = replay(); if (pre) return pre;
    if (this.opts.yieldBeforeLock) await tick();
    return this.lock(this.itemLocks, a.p_item_id).run(async () => {
      const item = this.items.get(a.p_item_id); if (!item) throw new PgError("ITEM_NOT_FOUND", "P0002");
      if (!this.opts.skipRelookup) { const post = replay(); if (post) return post; }
      if (surface.length < 2 || surface.length > 80 || !item.body.includes(surface)) throw new PgError("SURFACE_NOT_IN_TEXT");
      if (!this.exists(a.p_entity_key)) throw new PgError(`ENTITY_NOT_FOUND: ${a.p_entity_key}`);
      if (cands) {
        if (cands.length < 2 || cands.length > 8) throw new PgError("INVALID_CANDIDATES: 2-8");
        if (!cands.includes(a.p_entity_key)) throw new PgError(`NOT_A_CANDIDATE: ${a.p_entity_key}`);
        if (cands.some((c) => !this.exists(c))) throw new PgError("ENTITY_NOT_FOUND: a candidate");
      }
      if (this.links.some((l) => l.item_id === a.p_item_id && l.entity_key === a.p_entity_key && !l.retracted_at)) throw new PgError(`ALREADY_LINKED: ${a.p_entity_key}`);
      await tick();
      const id = randomUUID();
      try { this.insertUnique(this.links, { id, item_id: a.p_item_id, entity_key: a.p_entity_key, quality: cands ? "OWNER_CONFIRMED" : "EXACT_UNIQUE", method: a.p_method, surface, candidates: cands, request_key: a.p_request_key, payload_hash: h, created_at: new Date().toISOString(), retracted_at: null, retracted_reason: null }, "sunny_inbox_links_request_key_key"); }
      catch (e) { if ((e as PgError).code === "23505" && !this.opts.skipRelookup) throw new PgError("REQUEST_KEY_REUSED"); throw e; }
      return { linkId: id, quality: cands ? "OWNER_CONFIRMED" : "EXACT_UNIQUE", replayed: false };
    });
  }

  async record(a: Row) {
    const next = typeof a.p_inferred_next_step === "string" && a.p_inferred_next_step.trim() ? a.p_inferred_next_step.trim() : null;
    const reason = typeof a.p_supersede_reason === "string" && a.p_supersede_reason.trim() ? a.p_supersede_reason.trim() : null;
    const completed = (a.p_completed ?? []) as string[], gaps = (a.p_open_gaps ?? []) as string[], blockers = (a.p_blockers ?? []) as string[];
    if (!a.p_link_id || !a.p_request_key) throw new PgError("INVALID_REQUEST");
    // the basis is NOT part of the payload hash (the first write wins on a retry), exactly like the SQL
    const h = hash({ link: a.p_link_id, whatHappened: a.p_what_happened, completed, openGaps: gaps, blockers, ballWith: a.p_ball_with, nextStep: next, confidence: a.p_confidence, supersedes: a.p_supersedes_id ?? null, supersedeKind: a.p_supersede_kind ?? null, supersedeReason: reason });
    const replay = () => { const r = this.interps.find((x) => x.request_key === a.p_request_key); if (!r) return null; if (r.payload_hash !== h) throw new PgError("REQUEST_KEY_REUSED"); return { interpretationId: r.id, replayed: true }; };
    const pre = replay(); if (pre) return pre;
    const link0 = this.links.find((l) => l.id === a.p_link_id); if (!link0) throw new PgError("LINK_NOT_FOUND", "P0002");
    if (!String(link0.entity_key).startsWith("project:")) throw new PgError("NOT_A_PROJECT_LINK: interpretation is for projects only (Phase 1)");
    if (this.opts.yieldBeforeLock) await tick();
    return this.lock(this.entityLocks, String(link0.entity_key)).run(async () => {
      const link = this.links.find((l) => l.id === a.p_link_id)!;
      if (!this.opts.skipRelookup) { const post = replay(); if (post) return post; }
      if (link.retracted_at) throw new PgError("LINK_RETRACTED");
      if (!this.exists(link.entity_key)) throw new PgError(`ENTITY_NOT_FOUND: ${link.entity_key}`);
      const w = a.p_what_happened;
      if (typeof w !== "string" || w !== w.trim() || w.length < 1 || w.length > 300) throw new PgError("INVALID_FIELD: what_happened (1-300, trimmed)");
      if (!listOk(completed, 5, 160)) throw new PgError("INVALID_FIELD: completed");
      if (!listOk(gaps, 5, 160)) throw new PgError("INVALID_FIELD: open_gaps");
      if (!listOk(blockers, 5, 160)) throw new PgError("INVALID_FIELD: blockers");
      if (!["OWNER", "TEAM", "ENGINEER", "VICTOR", "ARTIST", "CLIENT", "UNKNOWN"].includes(String(a.p_ball_with))) throw new PgError("INVALID_FIELD: ball_with");
      if (next && next.length > 200) throw new PgError("INVALID_FIELD: inferred_next_step");
      if (!["LOW", "MEDIUM", "HIGH"].includes(String(a.p_confidence))) throw new PgError("INVALID_FIELD: confidence");
      if (a.p_basis_status !== null && a.p_basis_status !== undefined && (String(a.p_basis_status).length < 1 || String(a.p_basis_status).length > 40)) throw new PgError("INVALID_BASIS: status");
      if (a.p_basis_ball !== null && a.p_basis_ball !== undefined && !/^[A-Z_]{1,60}$/.test(String(a.p_basis_ball))) throw new PgError("INVALID_BASIS: ball");
      if (reason && reason.length > 200) throw new PgError("INVALID_REASON: 1-200 chars");
      const head = this.interps.filter((x) => x.entity_key === link.entity_key && !x.retracted_at).sort((x, y) => Number(y.seq) - Number(x.seq))[0];
      if (head) {
        if ((a.p_supersedes_id ?? null) !== head.id) throw new PgError(`HEAD_CHANGED: the current head is ${head.id}`);
        if (!["NEW_UPDATE", "CORRECTION"].includes(String(a.p_supersede_kind))) throw new PgError("INVALID_SUPERSEDE_KIND");
        if (a.p_supersede_kind === "CORRECTION" && !reason) throw new PgError("INVALID_REASON: a correction needs a reason");
      } else if (a.p_supersedes_id || a.p_supersede_kind || reason) throw new PgError("NOTHING_TO_SUPERSEDE");
      await tick();
      const id = randomUUID();
      try {
        this.insertUnique(this.interps, {
          id, seq: ++this.seq, item_id: link.item_id, link_id: link.id, entity_key: link.entity_key, what_happened: w, completed, open_gaps: gaps, blockers, ball_with: a.p_ball_with,
          inferred_next_step: next, confidence: a.p_confidence, epistemic: "HYPOTHESIS", source: "OWNER_REPORTED_DERIVED",
          basis_status: a.p_basis_status ?? null, basis_ball: a.p_basis_ball ?? null, basis_event_at: a.p_basis_event_at ?? null,
          supersedes_id: head ? head.id : null, supersede_kind: head ? a.p_supersede_kind : null, supersede_reason: head ? reason : null,
          request_key: a.p_request_key, payload_hash: h, created_at: new Date().toISOString(), retracted_at: null, retracted_reason: null,
        }, "sunny_inbox_interpretations_request_key_key");
      } catch (e) { if ((e as PgError).code === "23505" && !this.opts.skipRelookup) throw new PgError("REQUEST_KEY_REUSED"); throw e; }
      return { interpretationId: id, supersedes: head ? head.id : null, replayed: false };
    });
  }

  async retractLink(a: { p_link_id: string; p_reason: string }) {
    const reason = (a.p_reason ?? "").trim();
    if (!reason || reason.length > 200) throw new PgError("INVALID_REASON: 1-200 chars");
    const l0 = this.links.find((l) => l.id === a.p_link_id); if (!l0) throw new PgError("LINK_NOT_FOUND", "P0002");
    return this.lock(this.entityLocks, String(l0.entity_key)).run(async () => {
      const l = l0;
      if (l.retracted_at) { if (l.retracted_reason === reason) return { linkId: l.id, replayed: true }; throw new PgError("ALREADY_RETRACTED"); }
      let n = 0;
      for (const i of this.interps) if (i.link_id === l.id && !i.retracted_at) { Object.assign(i, { retracted_at: new Date().toISOString(), retracted_reason: `link retracted: ${reason}`.slice(0, 200) }); n++; }
      Object.assign(l, { retracted_at: new Date().toISOString(), retracted_reason: reason });
      return { linkId: l.id, interpretationsRetracted: n, replayed: false };
    });
  }
  async retractInterpretation(a: { p_interpretation_id: string; p_reason: string }) {
    const reason = (a.p_reason ?? "").trim();
    if (!reason || reason.length > 200) throw new PgError("INVALID_REASON: 1-200 chars");
    const i0 = this.interps.find((x) => x.id === a.p_interpretation_id); if (!i0) throw new PgError("INTERPRETATION_NOT_FOUND", "P0002");
    return this.lock(this.entityLocks, String(i0.entity_key)).run(async () => {
      if (i0.retracted_at) { if (i0.retracted_reason === reason) return { interpretationId: i0.id, replayed: true }; throw new PgError("ALREADY_RETRACTED"); }
      Object.assign(i0, { retracted_at: new Date().toISOString(), retracted_reason: reason });
      return { interpretationId: i0.id, replayed: false };
    });
  }

  /** The Supabase-shaped client the real store uses. */
  client() {
    const self = this;
    return {
      async rpc(fn: string, args: Record<string, unknown>) {
        self.rpcCalls.push(fn);
        try {
          const data = fn === "sunny_inbox_link_entity" ? await self.link(args as never) : fn === "sunny_inbox_record_interpretation" ? await self.record(args) : fn === "sunny_inbox_retract_link" ? await self.retractLink(args as never) : fn === "sunny_inbox_retract_interpretation" ? await self.retractInterpretation(args as never) : null;
          if (data === null) return { data: null, error: { message: `function ${fn} does not exist` } };
          return { data, error: null };
        } catch (e) { return { data: null, error: { message: (e as Error).message, code: (e as PgError).code } }; }
      },
      from(table: string) {
        return { select: () => ({ order: () => ({ limit: async () => ({ data: (table === "sunny_inbox_links" ? self.links : table === "sunny_inbox_interpretations" ? [...self.interps].sort((x, y) => Number(y.seq) - Number(x.seq)) : []).map((r) => ({ ...r })), error: null }) }) }) };
      },
    };
  }
}
