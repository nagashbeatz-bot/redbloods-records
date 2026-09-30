// Owner Inbox MEMORY — the ONE data path (lib/inbox-memory.ts has the rules). Writes go ONLY through the four approved
// SECURITY DEFINER RPCs (2026-10-01); reads are bounded SELECTs (service_role has SELECT only). Injectable client for tests.
// Only lib/writes/inbox-memory.ts calls the write methods (a source test pins it).
import { INBOX_INTERPRETATIONS_TABLE, INBOX_INTERPRETATION_COLUMNS, INBOX_LINKS_TABLE, INBOX_LINK_COLUMNS, mapInterpretationRow, mapLinkRow, type InboxInterpretation, type InboxLink, type InboxMemory, type LinkMethod } from "./inbox-memory";

type RpcResult = { data: unknown; error: { message: string; code?: string } | null };
export interface InboxMemoryClient {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<RpcResult>;
  from(table: string): { select(cols: string): { order(col: string, o: { ascending: boolean }): { limit(n: number): PromiseLike<RpcResult> } } };
}

/** The RPC refusal codes the writer maps to Hebrew (anything else = WRITE_FAILED). */
export const RPC_CODES = [
  "REQUEST_KEY_REUSED", "ITEM_NOT_FOUND", "SURFACE_NOT_IN_TEXT", "ENTITY_NOT_FOUND", "INVALID_CANDIDATES", "NOT_A_CANDIDATE", "CANDIDATES_NOT_ALLOWED",
  "ALREADY_LINKED", "LINK_NOT_FOUND", "NOT_A_PROJECT_LINK", "LINK_RETRACTED", "INVALID_FIELD", "INVALID_BASIS", "INVALID_REASON", "HEAD_CHANGED",
  "INVALID_SUPERSEDE_KIND", "NOTHING_TO_SUPERSEDE", "ALREADY_RETRACTED", "INTERPRETATION_NOT_FOUND", "INVALID_METHOD", "INVALID_REQUEST",
] as const;
export type RpcCode = (typeof RPC_CODES)[number];
export type MemoryWrite<T> = { status: "OK"; value: T } | { status: "REFUSED"; code: RpcCode; detail: string } | { status: "WRITE_FAILED"; detail: string };

function refusal<T>(e: { message: string }): MemoryWrite<T> {
  const m = e.message ?? "";
  const code = RPC_CODES.find((c) => m.startsWith(c) || m.includes(`${c}:`) || m === c);
  return code ? { status: "REFUSED", code, detail: m.slice(0, 200) } : { status: "WRITE_FAILED", detail: m.slice(0, 200) };
}
const obj = (d: unknown) => (d && typeof d === "object" && !Array.isArray(d) ? (d as Record<string, unknown>) : null);
const MAX_ROWS = 1000;

export function createInboxMemoryStore(client: InboxMemoryClient) {
  async function call<T>(fn: string, args: Record<string, unknown>, pick: (o: Record<string, unknown>) => T | null): Promise<MemoryWrite<T>> {
    const { data, error } = await client.rpc(fn, args);
    if (error) return refusal<T>(error);
    const o = obj(Array.isArray(data) ? data[0] : data);
    const v = o ? pick(o) : null;
    return v === null ? { status: "WRITE_FAILED", detail: `${fn} returned no valid result` } : { status: "OK", value: v };
  }
  const id = (k: string) => (o: Record<string, unknown>) => (typeof o[k] === "string" ? { id: o[k] as string, replayed: o.replayed === true } : null);
  return {
    linkEntity(a: { itemId: string; entityKey: string; method: LinkMethod; surface: string; candidates: string[] | null; requestKey: string }) {
      return call("sunny_inbox_link_entity", { p_item_id: a.itemId, p_entity_key: a.entityKey, p_method: a.method, p_surface: a.surface, p_candidates: a.candidates, p_request_key: a.requestKey }, id("linkId"));
    },
    recordInterpretation(a: {
      linkId: string; requestKey: string; whatHappened: string; completed: string[]; openGaps: string[]; blockers: string[]; ballWith: string; inferredNextStep: string | null; confidence: string;
      basisStatus: string | null; basisBall: string | null; basisEventAt: string | null; supersedesId: string | null; supersedeKind: string | null; supersedeReason: string | null;
    }) {
      return call("sunny_inbox_record_interpretation", {
        p_link_id: a.linkId, p_request_key: a.requestKey, p_what_happened: a.whatHappened, p_completed: a.completed, p_open_gaps: a.openGaps, p_blockers: a.blockers,
        p_ball_with: a.ballWith, p_inferred_next_step: a.inferredNextStep, p_confidence: a.confidence,
        p_basis_status: a.basisStatus, p_basis_ball: a.basisBall, p_basis_event_at: a.basisEventAt,
        p_supersedes_id: a.supersedesId, p_supersede_kind: a.supersedeKind, p_supersede_reason: a.supersedeReason,
      }, id("interpretationId"));
    },
    retractLink(linkId: string, reason: string) { return call("sunny_inbox_retract_link", { p_link_id: linkId, p_reason: reason }, id("linkId")); },
    retractInterpretation(interpretationId: string, reason: string) { return call("sunny_inbox_retract_interpretation", { p_interpretation_id: interpretationId, p_reason: reason }, id("interpretationId")); },
    /** Every link + interpretation (bounded, newest first). A row breaking the contract fails the read — never served half-read. */
    async readAll(): Promise<{ status: "OK"; value: InboxMemory } | { status: "READ_FAILED"; detail: string }> {
      const [l, i] = await Promise.all([
        client.from(INBOX_LINKS_TABLE).select(INBOX_LINK_COLUMNS).order("created_at", { ascending: false }).limit(MAX_ROWS),
        client.from(INBOX_INTERPRETATIONS_TABLE).select(INBOX_INTERPRETATION_COLUMNS).order("seq", { ascending: false }).limit(MAX_ROWS),
      ]);
      if (l.error || i.error) return { status: "READ_FAILED", detail: (l.error ?? i.error)!.message.slice(0, 200) };
      const lr = Array.isArray(l.data) ? l.data : [], ir = Array.isArray(i.data) ? i.data : [];
      const links = lr.map(mapLinkRow).filter((x): x is InboxLink => x !== null);
      const interpretations = ir.map(mapInterpretationRow).filter((x): x is InboxInterpretation => x !== null);
      if (links.length !== lr.length || interpretations.length !== ir.length) return { status: "READ_FAILED", detail: `stored inbox memory rows break the contract (${lr.length - links.length} links, ${ir.length - interpretations.length} interpretations)` };
      return { status: "OK", value: { links, interpretations } };
    },
  };
}
export type InboxMemoryStore = ReturnType<typeof createInboxMemoryStore>;
