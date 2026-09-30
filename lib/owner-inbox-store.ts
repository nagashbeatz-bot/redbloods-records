// Sunny Owner Inbox — the ONE data path (lib/owner-inbox.ts has the rules). Writes go ONLY through the two approved
// SECURITY DEFINER RPCs; reads are a bounded SELECT (service_role has SELECT only). Injectable client for tests.

import { OWNER_INBOX_COLUMNS, OWNER_INBOX_TABLE, mapInboxRow, type InboxOutcome, type InboxVia, type OwnerInboxItem } from "./owner-inbox";

type RpcResult = { data: unknown; error: { message: string; code?: string } | null };
export interface OwnerInboxClient {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<RpcResult>;
  from(table: string): {
    select(cols: string): {
      order(col: string, o: { ascending: boolean }): { limit(n: number): PromiseLike<RpcResult> };
    };
  };
}

export type InboxWriteResult =
  | { status: "OK"; item: OwnerInboxItem }
  | { status: "REQUEST_KEY_REUSED" | "NOT_NEW_OR_MISSING" | "INVALID"; detail: string }
  | { status: "WRITE_FAILED"; detail: string };
export type InboxListResult = { status: "OK"; items: OwnerInboxItem[]; invalidRows: number } | { status: "READ_FAILED"; detail: string };

const one = (data: unknown) => mapInboxRow(Array.isArray(data) ? data[0] : data);

function writeError(e: { message: string; code?: string }): InboxWriteResult {
  const m = e.message ?? "";
  if (m.includes("REQUEST_KEY_REUSED")) return { status: "REQUEST_KEY_REUSED", detail: m.slice(0, 200) };
  if (m.includes("NOT_NEW_OR_MISSING")) return { status: "NOT_NEW_OR_MISSING", detail: m.slice(0, 200) };
  if (m.includes("INVALID_PROCESSED_VIA") || m.includes("INVALID_OUTCOME") || e.code === "23514") return { status: "INVALID", detail: m.slice(0, 200) };
  return { status: "WRITE_FAILED", detail: m.slice(0, 200) };
}

export function createOwnerInboxStore(client: OwnerInboxClient) {
  return {
    /** Idempotent by requestKey: a retry / double click returns the SAME row; a different text under the same key is refused. */
    async submit(body: string, requestKey: string): Promise<InboxWriteResult> {
      const { data, error } = await client.rpc("sunny_owner_inbox_submit", { p_body: body, p_request_key: requestKey });
      if (error) return writeError(error);
      const item = one(data);
      return item ? { status: "OK", item } : { status: "WRITE_FAILED", detail: "the RPC returned no valid row" };
    },
    /** NEW → PROCESSED only (the RPC validates via / outcome and refuses a second transition). */
    async markProcessed(id: string, via: InboxVia, outcome: InboxOutcome, ref: string | null): Promise<InboxWriteResult> {
      const { data, error } = await client.rpc("sunny_owner_inbox_mark_processed", { p_id: id, p_via: via, p_outcome: outcome, p_ref: ref ?? "" });
      if (error) return writeError(error);
      const item = one(data);
      return item ? { status: "OK", item } : { status: "WRITE_FAILED", detail: "the RPC returned no valid row" };
    },
    /** Newest first, bounded. A row that breaks the contract is counted, never served. */
    async list(limit = 200): Promise<InboxListResult> {
      const { data, error } = await client.from(OWNER_INBOX_TABLE).select(OWNER_INBOX_COLUMNS).order("created_at", { ascending: false }).limit(Math.min(Math.max(limit, 1), 500));
      if (error) return { status: "READ_FAILED", detail: error.message.slice(0, 200) };
      const rows = Array.isArray(data) ? data : [];
      const items = rows.map(mapInboxRow).filter((x): x is OwnerInboxItem => x !== null);
      return { status: "OK", items, invalidRows: rows.length - items.length };
    },
  };
}
export type OwnerInboxStore = ReturnType<typeof createOwnerInboxStore>;
