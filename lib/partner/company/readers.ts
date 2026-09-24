/**
 * Redbloods Partner — CompanyReadContext narrow extra readers. SELECT only.
 *
 * The client is a NARROWING interface (from / select / order / limit) — no insert / update / delete / rpc exist on
 * it, so these readers cannot write even by mistake. Bounded columns and row caps; a failure is reported, never
 * turned into an empty list (fail closed → the register marks the source UNAVAILABLE).
 */
import type { IntegrityExtras } from "../integrity/detectors";

interface Resp { data: unknown[] | null; error: { message?: string } | null }
interface SelectChain extends PromiseLike<Resp> { limit(n: number): PromiseLike<Resp> }
export interface CompanyExtrasReadClient { from(table: string): { select(columns: string): SelectChain } }

export const EXTRA_ROW_CAP = 500;

async function rows(client: CompanyExtrasReadClient, table: string, columns: string): Promise<Record<string, unknown>[] | null> {
  try {
    const { data, error } = await client.from(table).select(columns).limit(EXTRA_ROW_CAP);
    if (error || !Array.isArray(data)) return null;
    return data as Record<string, unknown>[];
  } catch { return null; }
}

const str = (v: unknown) => (typeof v === "string" ? v : null);

export async function readIntegrityExtras(client: CompanyExtrasReadClient): Promise<IntegrityExtras> {
  const [prods, meetings] = await Promise.all([
    rows(client, "red_films_productions", "id, title, status, production_type"),
    rows(client, "meetings", "id, date, status"),
  ]);
  return {
    redFilmsProductions: prods?.map((r) => ({ id: String(r.id), title: str(r.title) ?? "", status: str(r.status), productionType: str(r.production_type) })) ?? null,
    meetings: meetings?.map((r) => ({ id: String(r.id), date: str(r.date), status: str(r.status) })) ?? null,
  };
}
