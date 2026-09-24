/** OAuth 2.1 token endpoint (authorization_code + PKCE, refresh_token rotation) for the Redbloods Partner connector. */
import { tokenCore } from "@/lib/integrations/partner-mcp/oauth";
import { getMcpRuntime, notFound, readOAuthForm, toResponse } from "@/lib/integrations/partner-mcp/server";

export async function POST(req: Request) {
  const rt = await getMcpRuntime();
  if (!rt) return notFound();
  const form = await readOAuthForm(req);
  if (!form) return Response.json({ error: "invalid_request", error_description: "form-encoded body required, no repeated parameters" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  try { return toResponse(await tokenCore(form, rt.oauth)); }
  catch { return Response.json({ error: "server_error" }, { status: 500, headers: { "Cache-Control": "no-store" } }); }
}
