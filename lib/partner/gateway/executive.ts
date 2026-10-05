/**
 * The Owner's executive read (Dashboard V2 as Sunny's surface — Owner decision 2026-10-05, Phase A3). It COMPOSES the
 * three existing capabilities Sunny herself reads — BUSINESS_MOTION (coo motion), FINANCIAL_FORWARD (coo forward) and
 * needs_me (board) — over ONE read context, and applies Sunny's own action history through the SAME selector and
 * transform the chat uses (historyDerivationFor + deriveWithActionHistory). No new rule, no ranking, no score, no
 * write, no push, no cache. Each part keeps its own status: a part that cannot be read is served as such (never empty).
 * PURE (no I/O): the server binding is lib/partner/gateway/executive-server.ts.
 */
import { createHash } from "node:crypto";
import { deriveWithActionHistory, historyDerivationFor } from "../sunny/with-history";
import type { ActionHistoryItem } from "../sunny/since";

export const EXECUTIVE_SCHEMA = "owner-executive-v1";
/** The three reads, exactly as the chat asks them (capability + mode); the page size is a display bound only. */
export const EXECUTIVE_PARTS = {
  motion: { capability: "coo", mode: "motion" },
  forward: { capability: "coo", mode: "forward" },
  needsMe: { capability: "needs_me", mode: "board" },
} as const;
export const EXECUTIVE_LIMIT = 50;

export type ExecutivePart = keyof typeof EXECUTIVE_PARTS;
export interface OwnerExecutive {
  schema: typeof EXECUTIVE_SCHEMA;
  asOf: string;
  history: { status: "READ"; plans: number } | { status: "NOT_READ"; reasonHe: string };
  /** A compact, read-only fingerprint of what the Owner would see — compared 1:1 with the chat's answer of the same
   *  minute (production parity verification). Derived from the parts below; never a second truth. */
  parity: ExecutiveParity;
  motion: Record<string, unknown>;
  forward: Record<string, unknown>;
  needsMe: Record<string, unknown>;
}

export type ExecutiveQuery = (part: ExecutivePart) => Promise<Record<string, unknown>>;

export interface ExecutiveParity {
  greeting: Array<{ key: string; level: string; titleHe: string }>;
  todayItems: Array<{ key: string; level: string; codes: string[] }>;
  inboxLineHe: string | null;
  financialLineHe: string | null;
  learning: { status: string; changed: number } | null;
  needsMe: { today: string[]; summaries: string[] };
  digests: Record<"greeting" | "todayItems" | "inbox" | "financial" | "forward" | "needsMe", string>;
}

/** a display fingerprint (not a security hash) — the same sha1 form the Gateway already uses for keys */
const sha = (v: unknown) => createHash("sha1").update(JSON.stringify(v ?? null)).digest("hex").slice(0, 16);
type Fact = { code?: string; value?: unknown };
const factOf = (p: Record<string, unknown>, code: string) => ((p.summary ?? []) as Fact[]).find((x) => x.code === code)?.value;

/** The parity fingerprint of a motion / forward / needs_me answer — the SAME function over the chat's answers and the
 *  dashboard's (so a production check compares like with like). */
export function executiveParity(p: Record<ExecutivePart, Record<string, unknown>>): ExecutiveParity {
  type MItem = { key: string; level: string; titleHe: string; codes: string[] };
  const m = (factOf(p.motion, "MOTION") ?? {}) as { greeting?: MItem[]; todayItems?: MItem[]; inbox?: { lineHe?: string | null }; financial?: { lineHe?: string } | null; learning?: { status: string; changed: number } };
  const nmItems = ((p.needsMe.items ?? []) as Array<{ fields?: { section?: string; key?: string } }>);
  const keysOf = (sec: string) => nmItems.filter((i) => i.fields?.section === sec).map((i) => String(i.fields?.key));
  return {
    greeting: (m.greeting ?? []).map((i) => ({ key: i.key, level: i.level, titleHe: i.titleHe })),
    todayItems: (m.todayItems ?? []).map((i) => ({ key: i.key, level: i.level, codes: i.codes })),
    inboxLineHe: m.inbox?.lineHe ?? null, financialLineHe: m.financial?.lineHe ?? null, learning: m.learning ? { status: m.learning.status, changed: m.learning.changed } : null,
    needsMe: { today: keysOf("today"), summaries: keysOf("summary") },
    digests: { greeting: sha(m.greeting), todayItems: sha(m.todayItems), inbox: sha(m.inbox), financial: sha(m.financial), forward: sha([p.forward.summary, p.forward.items]), needsMe: sha([p.needsMe.summary, p.needsMe.items]) },
  };
}

/** PURE assembly over already-read parts — the SAME derivation the connector applies to the SAME query. */
export function assembleExecutive(parts: Record<ExecutivePart, Record<string, unknown>>, history: { status: "READ"; items: ActionHistoryItem[] } | { status: "NOT_READ"; reasonHe: string }, now: Date): OwnerExecutive {
  const items = history.status === "READ" ? history.items : null;
  const out = {} as Record<ExecutivePart, Record<string, unknown>>;
  for (const part of Object.keys(EXECUTIVE_PARTS) as ExecutivePart[]) {
    const q = EXECUTIVE_PARTS[part];
    const payload = parts[part];
    const derive = payload.status === "OK" ? historyDerivationFor({ tool: "partner_query", capability: q.capability, mode: q.mode }) : null;
    out[part] = derive ? deriveWithActionHistory(derive, payload, items, now.getTime()) : payload;
  }
  return {
    schema: EXECUTIVE_SCHEMA, asOf: now.toISOString(),
    history: history.status === "READ" ? { status: "READ", plans: history.items.length } : history,
    parity: executiveParity(out),
    ...out,
  };
}

/** Reads the three parts through the injected query (the server binds it to ONE read context) and assembles them. A part
 *  whose read throws is served as UNAVAILABLE — never as an empty list. */
export async function readExecutiveParts(history: Parameters<typeof assembleExecutive>[1], query: ExecutiveQuery, now: Date): Promise<OwnerExecutive> {
  const failed = (part: ExecutivePart): Record<string, unknown> => ({ status: "UNAVAILABLE", query: EXECUTIVE_PARTS[part], error: "read_failed" });
  const [motion, forward, needsMe] = await Promise.all((Object.keys(EXECUTIVE_PARTS) as ExecutivePart[]).map((p) => query(p).catch(() => failed(p))));
  return assembleExecutive({ motion, forward, needsMe }, history, now);
}
