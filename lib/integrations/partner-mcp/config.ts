/**
 * Redbloods Partner MCP connector — configuration. Pure (env injected).
 *
 * Fail closed: the connector exists ONLY when PARTNER_MCP_ENABLED is exactly "true" AND the base URL /
 * secret are valid. Anything else → DISABLED / MISCONFIGURED, and every MCP / OAuth route answers 404.
 * Production keeps PARTNER_MCP_ENABLED unset (false). All public URLs derive from PARTNER_MCP_BASE_URL —
 * never from the request's Host header.
 */
export const MCP_PATH = "/api/mcp";
export const MCP_SCOPE = "partner:read";
/**
 * P1: answer ONE question Partner is currently surfacing with one of its closed answer codes (nothing else).
 * Always granted together with read: the stored scope string is exactly ANSWER_SCOPE_STRING.
 */
export const MCP_ANSWER_SCOPE = "partner:answer";
export const ANSWER_SCOPE_STRING = `${MCP_SCOPE} ${MCP_ANSWER_SCOPE}`;
export const hasAnswerScope = (scope: string) => scope.split(" ").includes(MCP_ANSWER_SCOPE) && scope.split(" ").includes(MCP_SCOPE);
/**
 * P2 (Sunny organizational memory): propose typed Owner knowledge → Owner confirms in the conversation → commit.
 * Never granted alone; the stored scope string is canonical: read [answer] [knowledge] in this order (DB CHECK).
 */
export const MCP_KNOWLEDGE_SCOPE = "partner:knowledge";
export const hasKnowledgeScope = (scope: string) => scope.split(" ").includes(MCP_KNOWLEDGE_SCOPE) && scope.split(" ").includes(MCP_SCOPE);
/** The canonical stored scope string for a grant (order fixed: read, answer, knowledge). */
export const scopeString = (o: { answer: boolean; knowledge: boolean }) => [MCP_SCOPE, ...(o.answer ? [MCP_ANSWER_SCOPE] : []), ...(o.knowledge ? [MCP_KNOWLEDGE_SCOPE] : [])].join(" ");
export const CLAUDE_CALLBACK = "https://claude.ai/api/mcp/auth_callback";
export const SUPPORTED_PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26"] as const;

export interface McpConfig {
  baseUrl: string;
  issuer: string;
  resource: string;
  resourceMetadataUrl: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint: string;
  revocationEndpoint: string;
  allowedRedirectUris: string[];
  secret: string;
  accessTtlSeconds: number;
  refreshTtlSeconds: number;
  familyTtlSeconds: number;
  codeTtlSeconds: number;
  consentTtlSeconds: number;
  maxActiveClients: number;
  toolTimeoutMs: number;
  maxResultChars: number;
  maxRequestBytes: number;
  rateLimit: Array<{ windowMs: number; max: number }>;
  /**
   * P1 answer capability. true ONLY when PARTNER_MCP_ANSWER_ENABLED is exactly "true" AND the deployment is the
   * MCP-only connector (REDBLOODS_MCP_ONLY=true) — it can never switch on in the main app. Off → the scope is not
   * advertised, not consentable, not accepted, and the answer tool does not exist.
   */
  answerEnabled: boolean;
  /** Reserved (finance answers through Claude). NOT wired in P1: finance question refs are refused regardless. */
  answerFinanceEnabled: boolean;
  answerRateLimit: Array<{ windowMs: number; max: number }>;
  /**
   * P2 knowledge capability. true ONLY when PARTNER_MCP_KNOWLEDGE_ENABLED is exactly "true" AND the deployment is the
   * MCP-only connector. Off → partner:knowledge is not advertised / consentable / accepted and the tool does not exist.
   * Requires the P2 schema (partner_owner_knowledge + scope / audit CHECKs) — never switch on before it is applied.
   */
  knowledgeEnabled: boolean;
  knowledgeRateLimit: Array<{ windowMs: number; max: number }>;
  /** Reserved (P3 business-action proposals through Sunny). NOT wired: no scope, no tool, no DB permission exists. */
  proposeActionEnabled: false;
}

export type McpConfigResult = { ok: true; config: McpConfig } | { ok: false; reason: "DISABLED" | "MISCONFIGURED"; detail: string };

/** Canonical form of a URL for audience comparison: lower-case scheme + host, no default port, no trailing slash, no query/fragment. */
export function canonicalUrl(u: string): string | null {
  try {
    const x = new URL(u);
    if (x.protocol !== "https:" || x.username || x.password || x.search || x.hash) return null;
    const path = x.pathname.replace(/\/+$/, "");
    return `https://${x.host.toLowerCase()}${path}`;
  } catch { return null; }
}

export function readMcpConfig(env: Record<string, string | undefined>): McpConfigResult {
  if (env.PARTNER_MCP_ENABLED !== "true") return { ok: false, reason: "DISABLED", detail: "PARTNER_MCP_ENABLED is not \"true\"" };
  const base = canonicalUrl(env.PARTNER_MCP_BASE_URL ?? "");
  if (!base || new URL(base).pathname !== "/" && new URL(base).pathname !== "") return { ok: false, reason: "MISCONFIGURED", detail: "PARTNER_MCP_BASE_URL must be an https origin" };
  const secret = env.PARTNER_MCP_SECRET ?? "";
  if (secret.length < 32) return { ok: false, reason: "MISCONFIGURED", detail: "PARTNER_MCP_SECRET must be at least 32 characters" };
  const redirects = (env.PARTNER_MCP_ALLOWED_REDIRECT_URIS ?? CLAUDE_CALLBACK).split(",").map((s) => s.trim()).filter(Boolean);
  if (!redirects.length || redirects.some((r) => canonicalUrl(r) !== r)) return { ok: false, reason: "MISCONFIGURED", detail: "PARTNER_MCP_ALLOWED_REDIRECT_URIS must be exact canonical https URLs" };
  const origin = base;
  return {
    ok: true,
    config: {
      baseUrl: origin, issuer: origin, resource: `${origin}${MCP_PATH}`,
      resourceMetadataUrl: `${origin}/.well-known/oauth-protected-resource${MCP_PATH}`,
      authorizationEndpoint: `${origin}/mcp-oauth/authorize`, tokenEndpoint: `${origin}/api/mcp-oauth/token`,
      registrationEndpoint: `${origin}/api/mcp-oauth/register`, revocationEndpoint: `${origin}/api/mcp-oauth/revoke`,
      allowedRedirectUris: redirects, secret,
      accessTtlSeconds: 3600, refreshTtlSeconds: 30 * 86400, familyTtlSeconds: 90 * 86400, codeTtlSeconds: 300, consentTtlSeconds: 600,
      maxActiveClients: 10, toolTimeoutMs: 60_000, maxResultChars: 100_000, maxRequestBytes: 16 * 1024,
      rateLimit: [{ windowMs: 60_000, max: 30 }, { windowMs: 3_600_000, max: 300 }],
      answerEnabled: env.PARTNER_MCP_ANSWER_ENABLED === "true" && env.REDBLOODS_MCP_ONLY === "true",
      answerFinanceEnabled: false,
      answerRateLimit: [{ windowMs: 3_600_000, max: 10 }, { windowMs: 86_400_000, max: 30 }],
      knowledgeEnabled: env.PARTNER_MCP_KNOWLEDGE_ENABLED === "true" && env.REDBLOODS_MCP_ONLY === "true",
      knowledgeRateLimit: [{ windowMs: 3_600_000, max: 20 }, { windowMs: 86_400_000, max: 60 }],
      proposeActionEnabled: false,
    },
  };
}
