/**
 * Redbloods Partner MCP connector — the Owner's consent decision (form POST from the consent page).
 * Owner cookie session + exact same-origin + request-bound CSRF MAC; the authorization request is re-validated
 * from scratch (hidden fields are never trusted). Redirects only to a redirect URI that is registered for the
 * client AND in the connector allowlist.
 */
import { getAuthUser } from "@/lib/require-auth";
import { roleForEmail } from "@/lib/roles";
import { decideAuthorization, validateAuthorizeRequest } from "@/lib/integrations/partner-mcp/oauth";
import { getMcpRuntime, notFound, readOAuthForm } from "@/lib/integrations/partner-mcp/server";

const plain = (status: number, text: string) => new Response(text, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
const to = (location: string) => new Response(null, { status: 303, headers: { Location: location, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });

export async function POST(req: Request) {
  const rt = await getMcpRuntime();
  if (!rt) return notFound();
  const origin = req.headers.get("origin");
  const sfs = req.headers.get("sec-fetch-site");
  if (origin !== rt.config.baseUrl || (sfs !== null && sfs !== "same-origin")) return plain(403, "cross-site consent refused");
  const user = await getAuthUser();
  if (!user || roleForEmail(user.email) !== "owner") return plain(403, "only the Redbloods Owner can authorize the connector");
  const form = await readOAuthForm(req);
  if (!form) return plain(400, "invalid form");
  const decision = form.decision;
  if (decision !== "allow" && decision !== "deny") return plain(400, "invalid decision");
  try {
    const v = await validateAuthorizeRequest(form, rt.oauth);
    if (!v.ok) return v.kind === "REDIRECT" ? to(v.location) : plain(400, v.error);
    const d = await decideAuthorization(v.request, { userId: user.id, approve: decision === "allow", csrf: form.csrf ?? "" }, rt.oauth);
    return d.ok ? to(d.location) : plain(400, d.error);
  } catch {
    return plain(500, "authorization failed");
  }
}
