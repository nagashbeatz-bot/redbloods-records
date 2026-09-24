/**
 * Redbloods Partner MCP connector — persistence contract. Pure types.
 *
 * Every code / token state change is ONE call to an atomic, row-locked SECURITY DEFINER function of the
 * approved migration (mcp-oauth-final.sql). Implementations: store-supabase.ts (server) and the local
 * Docker harness adapter. A store method THROWS on an infrastructure failure — callers fail closed.
 */
export interface McpClientRow { clientId: string; clientName: string; redirectUris: string[]; grantTypes: string[]; disabled: boolean }

export type GrantResult =
  | { result: "ISSUED"; userId: string; scope: string; resource: string; accessExpiresAt: string }
  | { result: "INVALID_GRANT" | "INVALID_TARGET" | "INVALID_TTL"; reason: string };

export type AccessCheck =
  | { result: "VALID" | "REVOKED" | "EXPIRED" | "CLIENT_DISABLED"; tokenId: string; clientId: string; userId: string; scope: string; resource: string }
  | { result: "NOT_FOUND" };

export interface AuditRow {
  actor_user_id: string | null;
  client_id: string | null;
  token_id: string | null;
  method: string;
  tool: "partner_brief" | "partner_resolve" | "partner_entity" | null;
  input_fingerprint: string | null;
  input_key: string | null;
  resolved_entity_key: string | null;
  status: "OK" | "REJECTED" | "ERROR";
  http_status: number | null;
  error_category: string | null;
  freshness: string | null;
  response_bytes: number | null;
  latency_ms: number | null;
  protocol_version: string | null;
}

export interface McpStore {
  registerClient(i: { clientId: string; clientName: string; redirectUris: string[]; grantTypes: string[]; maxActive: number }): Promise<"REGISTERED" | "LIMIT_REACHED">;
  getClient(clientId: string): Promise<McpClientRow | null>;
  createCode(i: { codeHash: string; clientId: string; userId: string; redirectUri: string; codeChallenge: string; scope: string; resource: string; ttlSeconds: number }): Promise<"CREATED" | "INVALID_CLIENT" | "INVALID_REDIRECT_URI" | "INVALID_TTL">;
  exchangeCode(i: { codeHash: string; clientId: string; redirectUri: string; challengeFromVerifier: string; resource: string | null; accessHash: string; refreshHash: string; accessTtl: number; refreshTtl: number; familyTtl: number }): Promise<GrantResult>;
  rotateRefresh(i: { refreshHash: string; clientId: string; resource: string | null; newAccessHash: string; newRefreshHash: string; accessTtl: number; refreshTtl: number }): Promise<GrantResult>;
  checkAccess(tokenHash: string): Promise<AccessCheck>;
  revokeToken(tokenHash: string, clientId: string): Promise<void>;
  writeAudit(row: AuditRow): Promise<void>;
}

/** Map a raw function result (jsonb) onto the typed contract — unknown shapes fail closed. */
export function toGrantResult(v: unknown): GrantResult {
  const o = (v ?? {}) as Record<string, unknown>;
  if (o.result === "ISSUED" && typeof o.user_id === "string" && typeof o.scope === "string" && typeof o.resource === "string") {
    return { result: "ISSUED", userId: o.user_id, scope: o.scope, resource: o.resource, accessExpiresAt: String(o.access_expires_at ?? "") };
  }
  const r = o.result === "INVALID_TARGET" || o.result === "INVALID_TTL" ? o.result : "INVALID_GRANT";
  return { result: r, reason: typeof o.reason === "string" ? o.reason : "UNKNOWN" };
}
export function toAccessCheck(v: unknown): AccessCheck {
  const o = (v ?? {}) as Record<string, unknown>;
  const r = o.result;
  if ((r === "VALID" || r === "REVOKED" || r === "EXPIRED" || r === "CLIENT_DISABLED") && typeof o.token_id === "string" && typeof o.client_id === "string"
    && typeof o.user_id === "string" && typeof o.scope === "string" && typeof o.resource === "string") {
    return { result: r, tokenId: o.token_id, clientId: o.client_id, userId: o.user_id, scope: o.scope, resource: o.resource };
  }
  return { result: "NOT_FOUND" };
}
