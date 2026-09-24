/**
 * Redbloods Partner MCP connector — the MCP resource (Streamable HTTP, stateless, JSON responses).
 * Bearer-only (never cookies). 404 unless PARTNER_MCP_ENABLED=true and fully configured.
 * GET (SSE stream) / DELETE (session end) are not offered → 405.
 */
import { handleMcpHttp } from "@/lib/integrations/partner-mcp/mcp";
import { getMcpRuntime, notFound, toResponse } from "@/lib/integrations/partner-mcp/server";

export async function POST(req: Request) {
  const rt = await getMcpRuntime();
  if (!rt) return notFound();
  return toResponse(await handleMcpHttp({ method: "POST", header: (n) => req.headers.get(n), bodyText: () => req.text() }, rt.mcp));
}

async function notAllowed() {
  if (!(await getMcpRuntime())) return notFound();
  return new Response(null, { status: 405, headers: { Allow: "POST", "Cache-Control": "no-store" } });
}
export const GET = notAllowed;
export const DELETE = notAllowed;
export const PUT = notAllowed;
export const PATCH = notAllowed;
export const OPTIONS = notAllowed;
