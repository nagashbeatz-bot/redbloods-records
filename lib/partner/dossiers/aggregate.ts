/**
 * Pure aggregation helpers shared by Client and Label Artist Dossiers
 * (Phase C.2) — never recompute finance logic, only sum lib/coo's own
 * already-derived per-project figures (receivables rows), grouped by
 * currency, never merged across currencies.
 */
import type { PartnerCompanyState } from "../eyes/types";
import type { RelationQuality } from "../eyes/types";
import type { AggregatedFinanceContext, FinanceByCurrencySummary, SessionsBucket } from "./types";

export function aggregateFinance(state: PartnerCompanyState, projectIds: string[], relationQuality: RelationQuality, note: string): AggregatedFinanceContext {
  const receivables = state.domains.receivables.data;
  const byCurrency = new Map<string, FinanceByCurrencySummary>();
  let projectsWithUnknownFinance = 0;
  for (const pid of projectIds) {
    const row = receivables?.rows.find((r) => r.projectId === pid);
    if (!row) { projectsWithUnknownFinance++; continue; }
    const entry = byCurrency.get(row.currency) ?? { currency: row.currency, agreedPriceSum: 0, receivedSum: 0, balanceSum: 0, projectCount: 0 };
    entry.agreedPriceSum += row.agreedPrice;
    entry.receivedSum += row.received;
    entry.balanceSum += row.balance;
    entry.projectCount += 1;
    byCurrency.set(row.currency, entry);
  }
  return { byCurrency: [...byCurrency.values()], projectsWithUnknownFinance, relationQuality, note };
}

export function aggregateSessions(state: PartnerCompanyState, projectIds: string[]): SessionsBucket {
  const idSet = new Set(projectIds);
  const items = (state.domains.sessions.data?.items ?? []).filter((s) => s.projectId !== null && idSet.has(s.projectId));
  const dates = items.map((s) => s.dateYmd).filter((d): d is string => !!d).sort();
  return { count: items.length, firstSessionDate: dates[0] ?? null, latestSessionDate: dates[dates.length - 1] ?? null, items };
}
