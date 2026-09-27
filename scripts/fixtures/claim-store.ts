/**
 * Test fixture — a faithful in-memory ClaimStore (lib/push-claims-pure.ts) for push / presence / marker tests.
 * Every operation yields to the event loop first, so concurrent callers really interleave (read-then-write races are
 * observable), and insert / cas / conditional remove are atomic like the database's. Never touches production.
 */
import type { BatchClaimStore } from "../../lib/push-claims-pure";

function canon(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, canon(x)]));
  return v;
}
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const same = (a: unknown, b: unknown) => JSON.stringify(canon(a)) === JSON.stringify(canon(b)); // jsonb equality ignores key order

export type MemoryClaimStore = BatchClaimStore & { data: Map<string, unknown>; writes: string[] };

export function memoryClaimStore(seed: Record<string, unknown> = {}): MemoryClaimStore {
  const data = new Map<string, unknown>(Object.entries(seed).map(([k, v]) => [k, clone(v)]));
  const tick = () => new Promise<void>((r) => setTimeout(r, 0));
  const writes: string[] = [];
  return {
    data, writes,
    async read(key) { await tick(); return data.has(key) ? clone(data.get(key)) : null; },
    async insert(key, value) { await tick(); if (data.has(key)) return "conflict"; data.set(key, clone(value)); writes.push(`insert ${key}`); return "ok"; },
    async cas(key, expected, next) { await tick(); if (!data.has(key) || !same(data.get(key), expected)) return false; data.set(key, clone(next)); writes.push(`cas ${key}`); return true; },
    async upsert(key, value) { await tick(); data.set(key, clone(value)); writes.push(`upsert ${key}`); },
    async remove(key, expected) { await tick(); if (!data.has(key)) return false; if (expected !== undefined && !same(data.get(key), expected)) return false; data.delete(key); writes.push(`remove ${key}`); return true; },
    async list(prefix) { await tick(); return [...data.entries()].filter(([k]) => k.startsWith(prefix)).map(([key, value]) => ({ key, value: clone(value) })); },
  };
}
