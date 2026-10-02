import "server-only";

/**
 * Sunny Brain — the connector binding (imported ONLY when PARTNER_MCP_OBSERVE_ENABLED is on). The token's user must
 * STILL be the Redbloods Owner (re-checked per call, fail closed); then ONE op of lib/writes/brain.ts runs with the
 * service client, whose only Brain privileges are the five wrappers + the two T2 request functions.
 *
 * The Owner deciding from the chat (owner-decide switch on): present_request shows ONE pending request and remembers it
 * per token (lib/partner/brain/chat-decision.ts); decide_request checks that presentation + his words, then calls
 * owner_approval_decide_mcp with the hash of THIS request's bearer — the DB proves the Owner itself (live token of an
 * Owner principal, partner:observe). The service client has no power of its own there; nothing here claims an approval.
 */
import { isRedbloodsOwner } from "../bridge/server";
import * as W from "@/lib/writes/brain";
import { readBrainSnapshot, type BrainReadClient, type BrainRpcClient } from "@/lib/brain-store";
import { PresentationRegistry, runChatDecision } from "@/lib/partner/brain/chat-decision";
import type { ObserveOp } from "@/lib/integrations/partner-mcp/observe-tool";

const ilToday = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

/** In memory, this process only: a restart forgets every presentation (fail closed → present again). */
const presentations = new PresentationRegistry();

export async function observeViaConnector(op: ObserveOp, input: Record<string, unknown>, actor: { userId: string; clientId: string; tokenId?: string; tokenHash?: string }): Promise<Record<string, unknown>> {
  let owner = false;
  try { owner = await isRedbloodsOwner(actor.userId); } catch { owner = false; }
  if (!owner) return { status: "NOT_AUTHORIZED", messageHe: "רק הבוס יכול להשתמש במוח של סאני." };
  const { supabase } = await import("@/lib/supabase");
  const now = new Date();
  const ctx: W.SunnyBrainContext = { client: supabase as unknown as BrainRpcClient, todayIL: ilToday(now), nowIso: now.toISOString(), clientId: /^rbmcp_[A-Za-z0-9_-]{32,64}$/.test(actor.clientId) ? actor.clientId : null };
  if (op === "present_request" || op === "decide_request") return chatDecision(op, input, actor, supabase, now);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- each writer re-validates every field (unknown → typed)
  const i = input as any;
  const r = op === "request_authorization" ? await W.requestTrackingAuthorization(ctx, i)
    : op === "request_owner_observations" ? await W.requestOwnerObservations(ctx, i)
    : op === "cancel_request" ? await W.cancelRequest(ctx, i)
    : op === "register_content" ? await W.registerContent(ctx, i)
    : op === "record_observations" ? await W.recordObservations(ctx, i)
    : op === "create_record" ? await W.createRecord(ctx, i)
    : op === "transition" ? await W.transition(ctx, i)
    : await W.addLinks(ctx, i);
  return r as unknown as Record<string, unknown>;
}

type Supa = Awaited<typeof import("@/lib/supabase")>["supabase"];
const chatDecision = (op: "present_request" | "decide_request", input: Record<string, unknown>, actor: { tokenId?: string; tokenHash?: string }, supabase: Supa, now: Date) =>
  runChatDecision(op, input, actor, { read: () => readBrainSnapshot(supabase as unknown as BrainReadClient), rpc: supabase as unknown as BrainRpcClient, registry: presentations, now });
