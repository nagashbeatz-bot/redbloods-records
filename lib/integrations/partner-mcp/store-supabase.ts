import "server-only";

/**
 * Redbloods Partner MCP connector — store binding to the approved migration's functions (server only).
 * Codes / tokens are reachable ONLY through the SECURITY DEFINER functions (the service role has no table
 * privilege on them); clients are SELECT-only; the audit table is INSERT-only (return=minimal).
 * Every infrastructure failure THROWS — callers fail closed.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { toAccessCheck, toGrantResult, type AuditRow, type McpClientRow, type McpStore } from "./store";

export function supabaseMcpStore(db: SupabaseClient): McpStore {
  const rpc = async (fn: string, args: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const { data, error } = await db.rpc(fn, args);
    if (error) throw new Error(`${fn}: ${error.code ?? "error"}`);
    return (data ?? {}) as Record<string, unknown>;
  };
  return {
    async registerClient(i) {
      const r = await rpc("partner_mcp_register_client", { p_client_id: i.clientId, p_client_name: i.clientName, p_redirect_uris: i.redirectUris, p_grant_types: i.grantTypes, p_max_active: i.maxActive });
      return r.result === "REGISTERED" ? "REGISTERED" : "LIMIT_REACHED";
    },
    async getClient(clientId) {
      if (!/^rbmcp_[A-Za-z0-9_-]{32,64}$/.test(clientId)) return null;
      const { data, error } = await db.from("partner_mcp_clients").select("client_id, client_name, redirect_uris, grant_types, disabled_at").eq("client_id", clientId).maybeSingle();
      if (error) throw new Error(`partner_mcp_clients: ${error.code ?? "error"}`);
      if (!data) return null;
      const row: McpClientRow = { clientId: data.client_id, clientName: data.client_name ?? "", redirectUris: data.redirect_uris ?? [], grantTypes: data.grant_types ?? [], disabled: data.disabled_at !== null };
      return row;
    },
    async createCode(i) {
      const r = await rpc("partner_mcp_create_code", { p_code_hash: i.codeHash, p_client_id: i.clientId, p_user_id: i.userId, p_redirect_uri: i.redirectUri, p_code_challenge: i.codeChallenge, p_scope: i.scope, p_resource: i.resource, p_ttl_seconds: i.ttlSeconds });
      return r.result === "CREATED" || r.result === "INVALID_CLIENT" || r.result === "INVALID_REDIRECT_URI" || r.result === "INVALID_TTL" ? r.result : "INVALID_CLIENT";
    },
    async exchangeCode(i) {
      return toGrantResult(await rpc("partner_mcp_exchange_code", {
        p_code_hash: i.codeHash, p_client_id: i.clientId, p_redirect_uri: i.redirectUri, p_challenge_from_verifier: i.challengeFromVerifier, p_resource: i.resource,
        p_access_hash: i.accessHash, p_refresh_hash: i.refreshHash, p_access_ttl_seconds: i.accessTtl, p_refresh_ttl_seconds: i.refreshTtl, p_family_ttl_seconds: i.familyTtl,
      }));
    },
    async rotateRefresh(i) {
      return toGrantResult(await rpc("partner_mcp_rotate_refresh", {
        p_refresh_hash: i.refreshHash, p_client_id: i.clientId, p_resource: i.resource, p_new_access_hash: i.newAccessHash, p_new_refresh_hash: i.newRefreshHash,
        p_access_ttl_seconds: i.accessTtl, p_refresh_ttl_seconds: i.refreshTtl,
      }));
    },
    async checkAccess(tokenHash) { return toAccessCheck(await rpc("partner_mcp_check_access", { p_token_hash: tokenHash })); },
    async revokeToken(tokenHash, clientId) { await rpc("partner_mcp_revoke_token", { p_token_hash: tokenHash, p_client_id: clientId }); },
    async writeAudit(row: AuditRow) {
      const { error } = await db.from("partner_gateway_audit").insert(row);
      if (error) throw new Error(`partner_gateway_audit: ${error.code ?? "error"}`);
    },
  };
}
