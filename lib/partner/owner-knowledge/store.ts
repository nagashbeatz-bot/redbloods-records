/**
 * Sunny organizational memory — the append-only store (public.partner_owner_knowledge). Pure core over an injected
 * table client (tests use an in-memory mirror; production binds Supabase ONLY when PARTNER_OWNER_KNOWLEDGE_ENABLED).
 *
 * History is never rewritten: a correction is a NEW row that supersedes the slot's current terminal row; "no longer
 * true" is a WITHDRAW row. The DB blocks UPDATE / DELETE / TRUNCATE, allows one root per slot and one successor per
 * row, and one row per (confirmation_id, item_index) — the preview confirmation can be committed exactly once.
 * Every stored row is parsed strictly on read; any unreadable row fails the whole read closed (never partial memory).
 */
import { knowledgeKind, type KnowledgeEpistemic, type KnowledgeValue } from "./kinds";

export const OWNER_KNOWLEDGE_TABLE = "partner_owner_knowledge";
export const OWNER_KNOWLEDGE_SCHEMA = "partner-owner-knowledge-v1";
export const OWNER_KNOWLEDGE_COLUMNS = "id,created_at,schema_version,kind,subject_key,identity_keys,slot_key,value,epistemic,meaning_he,operation,supersedes_id,review_at,expires_at,provenance,confirmation_id,item_index";

export interface OwnerKnowledgeProvenance { source: "owner_via_sunny"; channel: "mcp"; client_id: string; token_id: string; attempt_audit_id: string; operation: "LEARN_KNOWLEDGE" }

export interface OwnerKnowledgeRecord {
  id: string;
  createdAt: string;
  kind: string;
  subjectKey: string;
  /** Every Gateway key of the same identity (e.g. dj:… + label-artist:… for DJ CLEANTONE). */
  identityKeys: string[];
  slotKey: string;
  value: KnowledgeValue;
  epistemic: KnowledgeEpistemic;
  /** Partner's normalized Hebrew meaning (the read-back the Owner confirmed) — never raw conversation text. */
  meaningHe: string;
  operation: "ASSERT" | "WITHDRAW";
  supersedesId: string | null;
  reviewAt: string | null;
  expiresAt: string | null;
  provenance: OwnerKnowledgeProvenance;
  confirmationId: string;
  itemIndex: number;
}

export type OwnerKnowledgeDraft = Omit<OwnerKnowledgeRecord, "id" | "createdAt">;

interface Resp<T> { data: T | null; error: { code?: string; message?: string; details?: string | null } | null }
export interface OwnerKnowledgeTableClient {
  from(table: string): {
    select(cols: string): { order(col: string, o: { ascending: boolean }): { range(a: number, b: number): PromiseLike<Resp<unknown[]>> } };
    insert(rows: unknown[]): { select(cols: string): PromiseLike<Resp<unknown[]>> };
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const YMD = /^\d{4}-\d{2}-\d{2}$/;
export const SUBJECT_KEY_RE = /^((project|client|label-artist|dj|show|release):[0-9a-f-]{36}|vendor:(VICTOR|STEVEN)|company:REDBLOODS)$/;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function parseKnowledgeProvenance(p: unknown): OwnerKnowledgeProvenance | null {
  if (!isObj(p)) return null;
  const keys = ["source", "channel", "client_id", "token_id", "attempt_audit_id", "operation"];
  if (Object.keys(p).some((k) => !keys.includes(k))) return null;
  if (p.source !== "owner_via_sunny" || p.channel !== "mcp" || p.operation !== "LEARN_KNOWLEDGE") return null;
  if (typeof p.client_id !== "string" || !/^rbmcp_[A-Za-z0-9_-]{32,64}$/.test(p.client_id) || !UUID.test(String(p.token_id)) || !UUID.test(String(p.attempt_audit_id))) return null;
  return { source: "owner_via_sunny", channel: "mcp", client_id: p.client_id, token_id: String(p.token_id), attempt_audit_id: String(p.attempt_audit_id), operation: "LEARN_KNOWLEDGE" };
}

/** The ONLY way a stored row becomes a record. Fail closed. */
export function mapOwnerKnowledgeRow(r: unknown): OwnerKnowledgeRecord | null {
  if (!isObj(r) || r.schema_version !== OWNER_KNOWLEDGE_SCHEMA) return null;
  if (!UUID.test(String(r.id)) || typeof r.created_at !== "string" || !knowledgeKind(r.kind)) return null;
  if (typeof r.subject_key !== "string" || !SUBJECT_KEY_RE.test(r.subject_key) || typeof r.slot_key !== "string" || r.slot_key.length > 300) return null;
  if (!Array.isArray(r.identity_keys) || !r.identity_keys.every((k) => typeof k === "string" && SUBJECT_KEY_RE.test(k))) return null;
  if (!isObj(r.value) || !Object.values(r.value).every((x) => typeof x === "string" || typeof x === "number")) return null;
  if (!["OWNER_DECISION", "OWNER_REPORTED", "OWNER_POLICY_CANDIDATE"].includes(String(r.epistemic)) || typeof r.meaning_he !== "string" || r.meaning_he.length > 500) return null;
  if (r.operation !== "ASSERT" && r.operation !== "WITHDRAW") return null;
  if (r.supersedes_id !== null && !UUID.test(String(r.supersedes_id))) return null;
  if ((r.review_at !== null && !YMD.test(String(r.review_at))) || (r.expires_at !== null && !YMD.test(String(r.expires_at)))) return null;
  const provenance = parseKnowledgeProvenance(r.provenance);
  if (!provenance || typeof r.confirmation_id !== "string" || !/^[A-Za-z0-9_-]{16,64}$/.test(r.confirmation_id) || !Number.isInteger(r.item_index)) return null;
  return {
    id: String(r.id), createdAt: new Date(r.created_at).toISOString(), kind: String(r.kind), subjectKey: r.subject_key, identityKeys: r.identity_keys as string[], slotKey: r.slot_key,
    value: r.value as KnowledgeValue, epistemic: r.epistemic as KnowledgeEpistemic, meaningHe: r.meaning_he, operation: r.operation, supersedesId: (r.supersedes_id as string | null) ?? null,
    reviewAt: (r.review_at as string | null) ?? null, expiresAt: (r.expires_at as string | null) ?? null, provenance, confirmationId: r.confirmation_id, itemIndex: r.item_index as number,
  };
}

const toRow = (d: OwnerKnowledgeDraft) => ({
  schema_version: OWNER_KNOWLEDGE_SCHEMA, kind: d.kind, subject_key: d.subjectKey, identity_keys: d.identityKeys, slot_key: d.slotKey, value: d.value, epistemic: d.epistemic,
  meaning_he: d.meaningHe, operation: d.operation, supersedes_id: d.supersedesId, review_at: d.reviewAt, expires_at: d.expiresAt, provenance: d.provenance, confirmation_id: d.confirmationId, item_index: d.itemIndex,
});

export type KnowledgeListResult = { status: "OK"; records: OwnerKnowledgeRecord[] } | { status: "READ_FAILED"; detail: string } | { status: "INVALID_STORED_ROWS"; count: number };
export type KnowledgeAppendResult = { status: "APPENDED"; records: OwnerKnowledgeRecord[] } | { status: "ALREADY_COMMITTED" } | { status: "SLOT_CHANGED" } | { status: "WRITE_FAILED"; detail: string };

export interface OwnerKnowledgeStore {
  list(): Promise<KnowledgeListResult>;
  /** One INSERT statement for the whole confirmed batch (atomic). */
  appendBatch(drafts: OwnerKnowledgeDraft[]): Promise<KnowledgeAppendResult>;
}

export function createOwnerKnowledgeStore(client: OwnerKnowledgeTableClient): OwnerKnowledgeStore {
  return {
    async list() {
      const out: OwnerKnowledgeRecord[] = [];
      let bad = 0;
      for (let from = 0; ; from += 1000) {
        let res: Resp<unknown[]>;
        try { res = await client.from(OWNER_KNOWLEDGE_TABLE).select(OWNER_KNOWLEDGE_COLUMNS).order("created_at", { ascending: true }).range(from, from + 999); } catch (e) { return { status: "READ_FAILED", detail: (e as Error).message }; }
        if (res.error || !Array.isArray(res.data)) return { status: "READ_FAILED", detail: res.error?.message ?? "no data" };
        for (const r of res.data) { const m = mapOwnerKnowledgeRow(r); if (m) out.push(m); else bad++; }
        if (res.data.length < 1000) break;
      }
      return bad ? { status: "INVALID_STORED_ROWS", count: bad } : { status: "OK", records: out };
    },
    async appendBatch(drafts) {
      let res: Resp<unknown[]>;
      try { res = await client.from(OWNER_KNOWLEDGE_TABLE).insert(drafts.map(toRow)).select(OWNER_KNOWLEDGE_COLUMNS); } catch (e) { return { status: "WRITE_FAILED", detail: (e as Error).message }; }
      if (res.error) {
        const text = `${res.error.message ?? ""} ${res.error.details ?? ""}`;
        if (res.error.code === "23505" && /confirmation/i.test(text)) return { status: "ALREADY_COMMITTED" };
        if (res.error.code === "23505" || res.error.code === "23503") return { status: "SLOT_CHANGED" };
        return { status: "WRITE_FAILED", detail: `${res.error.code ?? ""} ${res.error.message ?? ""}`.trim() };
      }
      const recs = (res.data ?? []).map(mapOwnerKnowledgeRow);
      if (recs.some((r) => !r)) return { status: "WRITE_FAILED", detail: "stored row did not read back" };
      return { status: "APPENDED", records: recs as OwnerKnowledgeRecord[] };
    },
  };
}

/** The slot's current terminal row (the one nothing supersedes), or null. */
export function terminalOfSlot(records: readonly OwnerKnowledgeRecord[], slotKey: string): OwnerKnowledgeRecord | null {
  const inSlot = records.filter((r) => r.slotKey === slotKey);
  const superseded = new Set(inSlot.map((r) => r.supersedesId).filter(Boolean));
  const terminals = inSlot.filter((r) => !superseded.has(r.id));
  return terminals.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
}

/** ACTIVE knowledge: each slot's terminal row, an ASSERT, not expired. History = everything else. */
export function activeKnowledge(records: readonly OwnerKnowledgeRecord[], todayIL: string): OwnerKnowledgeRecord[] {
  const slots = [...new Set(records.map((r) => r.slotKey))];
  return slots.map((s) => terminalOfSlot(records, s)).filter((r): r is OwnerKnowledgeRecord => !!r && r.operation === "ASSERT" && (!r.expiresAt || r.expiresAt >= todayIL))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
}
