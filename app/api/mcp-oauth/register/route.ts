/**
 * RFC 7591 Dynamic Client Registration for the Redbloods Partner connector: public PKCE clients only, redirect
 * URIs restricted to the configured connector callback allowlist, capped number of active clients.
 */
import { registerClientCore } from "@/lib/integrations/partner-mcp/oauth";
import { getMcpRuntime, notFound, toResponse } from "@/lib/integrations/partner-mcp/server";

export async function POST(req: Request) {
  const rt = await getMcpRuntime();
  if (!rt) return notFound();
  if (!rt.allowRegistration()) return Response.json({ error: "invalid_client_metadata", error_description: "too many registrations — try again later" }, { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": "600" } });
  if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) return Response.json({ error: "invalid_client_metadata", error_description: "application/json required" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  const text = await req.text();
  if (text.length > 8192) return Response.json({ error: "invalid_client_metadata", error_description: "body too large" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  let body: unknown;
  try { body = JSON.parse(text); } catch { body = null; }
  try { return toResponse(await registerClientCore(body, rt.oauth)); }
  catch { return Response.json({ error: "server_error" }, { status: 500, headers: { "Cache-Control": "no-store" } }); }
}
