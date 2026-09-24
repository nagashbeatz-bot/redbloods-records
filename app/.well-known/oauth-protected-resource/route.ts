/** RFC 9728 Protected Resource Metadata for the Redbloods Partner MCP connector (404 when disabled). */
import { protectedResourceMetadata } from "@/lib/integrations/partner-mcp/metadata";
import { getMcpRuntime, notFound } from "@/lib/integrations/partner-mcp/server";

export async function GET() {
  const rt = await getMcpRuntime();
  if (!rt) return notFound();
  return Response.json(protectedResourceMetadata(rt.config), { headers: { "Cache-Control": "public, max-age=300" } });
}
