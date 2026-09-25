/**
 * The internal calendar endpoint's logic (pure over injected deps, so tests exercise the REAL auth + read path).
 * Order: MCP-only service → 404; secret not configured → 503; missing / wrong secret → 401 (nothing read);
 * then the read core over the trusted Google adapter. Never returns or logs the secret.
 */
import { INTERNAL_AUTH_HEADER, INTERNAL_SECRET_ENV, verifyInternalAuth } from "./internal-auth";
import { readCalendarWindowCore, type CalendarApi } from "./read-core";
import type { CalendarWindowResult } from "./types";

export interface InternalCalendarRequest { header: (name: string) => string | null; query: (name: string) => string | null }
export type InternalCalendarResponse = { status: number; body: CalendarWindowResult | { error: string } };

export async function handleInternalCalendar(req: InternalCalendarRequest, env: Record<string, string | undefined>, api: () => CalendarApi | Promise<CalendarApi>): Promise<InternalCalendarResponse> {
  if (env.REDBLOODS_MCP_ONLY === "true") return { status: 404, body: { error: "not_found" } };
  const auth = verifyInternalAuth(req.header(INTERNAL_AUTH_HEADER), env[INTERNAL_SECRET_ENV]);
  if (auth === "NOT_CONFIGURED") return { status: 503, body: { error: "internal_read_disabled" } };
  if (auth !== "OK") return { status: 401, body: { error: "unauthorized" } };
  return { status: 200, body: await readCalendarWindowCore(await api(), req.query("start") ?? "", req.query("end") ?? "") };
}
