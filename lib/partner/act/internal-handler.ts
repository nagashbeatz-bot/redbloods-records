/**
 * The internal action endpoint's logic on Redbloods MAIN (pure over injected deps — tests exercise the REAL gate).
 * Sunny connector → MAIN, service-to-service. Order, each step fails closed:
 *   MCP-only service → 404 · action layer switched off (PARTNER_ACT_ENABLED ≠ "true") → 404
 *   dedicated secret (PARTNER_INTERNAL_ACT_SECRET, ≥ 32, constant-time) not configured → 503 · missing / wrong → 401
 *   body: exact keys { op, ownerId, clientId, input }, ≤ 16 KB, op ∈ the five operations → otherwise 400
 *   then the action service (which re-checks the Owner live, the plan's owner / client, the registry and the approval).
 * The secret is never logged or returned. There is no generic operation, no route / SQL / URL / path argument.
 */
import { createHash } from "node:crypto";
import { verifyInternalAuth, INTERNAL_AUTH_HEADER } from "@/lib/partner/calendar/internal-auth";
import type { ActResult, ActServiceDeps, Caller } from "./service";
import { approveAction, executeAction, planAction, planStatus, previewAction } from "./service";

export const INTERNAL_ACT_PATH = "/api/partner/internal/act";
export const ACT_SECRET_ENV = "PARTNER_INTERNAL_ACT_SECRET";
export const ACT_ENABLED_ENV = "PARTNER_ACT_ENABLED";
export const ACT_OPS = ["plan", "preview", "approve", "execute", "status"] as const;
export type ActOp = (typeof ACT_OPS)[number];
export const MAX_ACT_BODY_BYTES = 16 * 1024;

/** The approval-token HMAC key is derived from the act secret (domain-separated), never the secret itself. */
export const approvalKeyFrom = (secret: string) => createHash("sha256").update(`redbloods-act-approval-v1:${secret}`).digest("hex");

export interface InternalActRequest { header(name: string): string | null; bodyText(): Promise<string> }
export type InternalActResponse = { status: number; body: ActResult | { error: string } };

export async function handleInternalAct(req: InternalActRequest, env: Record<string, string | undefined>, deps: () => Promise<ActServiceDeps>): Promise<InternalActResponse> {
  if (env.REDBLOODS_MCP_ONLY === "true") return { status: 404, body: { error: "not_found" } };
  if (env[ACT_ENABLED_ENV] !== "true") return { status: 404, body: { error: "not_found" } };
  const auth = verifyInternalAuth(req.header(INTERNAL_AUTH_HEADER), env[ACT_SECRET_ENV]);
  if (auth === "NOT_CONFIGURED") return { status: 503, body: { error: "act_disabled" } };
  if (auth !== "OK") return { status: 401, body: { error: "unauthorized" } };
  const raw = await req.bodyText();
  if (Buffer.byteLength(raw, "utf8") > MAX_ACT_BODY_BYTES) return { status: 413, body: { error: "too_large" } };
  let b: unknown;
  try { b = JSON.parse(raw); } catch { return { status: 400, body: { error: "bad_json" } }; }
  if (!b || typeof b !== "object" || Array.isArray(b)) return { status: 400, body: { error: "bad_request" } };
  const o = b as Record<string, unknown>;
  if (Object.keys(o).some((k) => !["op", "ownerId", "clientId", "input"].includes(k))) return { status: 400, body: { error: "bad_request" } };
  if (!(ACT_OPS as readonly string[]).includes(String(o.op)) || typeof o.ownerId !== "string" || typeof o.clientId !== "string" || !o.input || typeof o.input !== "object" || Array.isArray(o.input)) return { status: 400, body: { error: "bad_request" } };
  const caller: Caller = { ownerId: o.ownerId, clientId: o.clientId };
  const input = o.input as Record<string, unknown>;
  const allowed: Record<ActOp, readonly string[]> = { plan: ["intentHe", "actionId", "args"], preview: ["planId"], approve: ["planId", "planHash", "confirmationText"], execute: ["planId", "approvalToken", "confirmationText"], status: ["planId"] };
  const op = o.op as ActOp;
  if (Object.keys(input).some((k) => !allowed[op].includes(k))) return { status: 400, body: { error: "bad_request" } };
  let d: ActServiceDeps;
  try { d = await deps(); } catch { return { status: 503, body: { error: "act_unavailable" } }; }
  try {
    const r = op === "plan" ? await planAction(input as { intentHe: unknown; actionId: unknown; args: unknown }, caller, d)
      : op === "preview" ? await previewAction(input as { planId: unknown }, caller, d)
      : op === "approve" ? await approveAction(input as { planId: unknown; planHash: unknown; confirmationText: unknown }, caller, d)
      : op === "execute" ? await executeAction(input as { planId: unknown; approvalToken: unknown; confirmationText: unknown }, caller, d)
      : await planStatus(input as { planId: unknown }, caller, d);
    return { status: 200, body: r };
  } catch {
    return { status: 200, body: { status: "FAILED_CLOSED", messageHe: "משהו נכשל בצד השרת — שום דבר לא דווח כמבוצע. אבדוק את המצב לפני שאגיד משהו." } };
  }
}
