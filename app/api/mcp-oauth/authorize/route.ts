/**
 * Redbloods Partner MCP connector — the Owner's consent decision (form POST from the consent page).
 * Thin shell around consentDecisionCore (lib/integrations/partner-mcp/oauth.ts): deny-only browser signals,
 * a signature-verified Owner session, the authorization request re-validated from scratch, and a single-use
 * consent token bound to that session + request. Redirects only to a redirect URI registered for the client AND
 * in the connector allowlist. POST only (no GET handler → 405).
 */
import { consentDecisionCore } from "@/lib/integrations/partner-mcp/oauth";
import { getConsentSession, getMcpRuntime, notFound, readOAuthForm, toResponse } from "@/lib/integrations/partner-mcp/server";

export async function POST(req: Request) {
  const rt = await getMcpRuntime();
  if (!rt) return notFound();
  try {
    const out = await consentDecisionCore(
      { header: (n) => req.headers.get(n), form: await readOAuthForm(req), session: await getConsentSession() },
      { ...rt.oauth, log: (event, data) => console.warn(`[partner-mcp] ${event}`, JSON.stringify(data)) },
    );
    return toResponse(out);
  } catch {
    return new Response("authorization failed", { status: 500, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  }
}
