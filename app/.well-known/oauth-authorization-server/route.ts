/** RFC 8414 Authorization Server Metadata for the Redbloods Partner MCP connector (404 when disabled). */
import { authorizationServerMetadata } from "@/lib/integrations/partner-mcp/metadata";
import { getMcpRuntime, notFound } from "@/lib/integrations/partner-mcp/server";

export async function GET() {
  const rt = await getMcpRuntime();
  if (!rt) return notFound();
  return Response.json(authorizationServerMetadata(rt.config), { headers: { "Cache-Control": "public, max-age=300" } });
}
