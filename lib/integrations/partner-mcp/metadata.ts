/**
 * Redbloods Partner MCP connector — discovery documents. Pure.
 *   RFC 9728 OAuth 2.0 Protected Resource Metadata (the MCP resource)
 *   RFC 8414 OAuth 2.0 Authorization Server Metadata (this app, single Owner)
 * CIMD is deliberately NOT advertised (client_id_metadata_document_supported absent) → Claude uses DCR.
 */
import { scopeString, type McpConfig } from "./config";

const scopes = (c: McpConfig) => scopeString({ answer: c.answerEnabled, knowledge: c.knowledgeEnabled, act: c.actEnabled }).split(" ");
/** User-facing connector identity: Sunny (the internal names — partner_*, lib/partner — intentionally stay). */
export const CONNECTOR_DISPLAY_NAME = "Redbloods Sunny";

export function protectedResourceMetadata(c: McpConfig) {
  return {
    resource: c.resource,
    authorization_servers: [c.issuer],
    scopes_supported: scopes(c),
    bearer_methods_supported: ["header"],
    resource_name: c.answerEnabled || c.knowledgeEnabled ? CONNECTOR_DISPLAY_NAME : `${CONNECTOR_DISPLAY_NAME} (read-only)`,
  };
}

export function authorizationServerMetadata(c: McpConfig) {
  return {
    issuer: c.issuer,
    authorization_endpoint: c.authorizationEndpoint,
    token_endpoint: c.tokenEndpoint,
    registration_endpoint: c.registrationEndpoint,
    revocation_endpoint: c.revocationEndpoint,
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    revocation_endpoint_auth_methods_supported: ["none"],
    scopes_supported: scopes(c),
    authorization_response_iss_parameter_supported: true,
  };
}
