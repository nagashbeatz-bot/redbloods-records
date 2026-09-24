/** RFC 7009 token revocation (revokes the token's whole family) for the Redbloods Partner connector. */
import { revokeCore } from "@/lib/integrations/partner-mcp/oauth";
import { getMcpRuntime, notFound, readOAuthForm, toResponse } from "@/lib/integrations/partner-mcp/server";

export async function POST(req: Request) {
  const rt = await getMcpRuntime();
  if (!rt) return notFound();
  const form = await readOAuthForm(req);
  if (!form) return Response.json({ error: "invalid_request" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  try { return toResponse(await revokeCore(form, rt.oauth)); }
  catch { return Response.json({ error: "server_error" }, { status: 500, headers: { "Cache-Control": "no-store" } }); }
}
