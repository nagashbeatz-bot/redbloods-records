import "server-only";

/**
 * Redbloods Partner — Finance Brain V1 server binding. READ-ONLY.
 * Binds the reader core to the existing service-role client (select-only view) and to the canonical
 * Victor salary resolver (lib/vendor-store.ts getVictorSalaryMonths — itself read-only). Used only by
 * GET /api/partner/finance (Owner-only). No write, no RPC, no Push, no Cron, no Agent Alerts.
 */
import { supabase } from "@/lib/supabase";
import { getVictorSalaryMonths } from "@/lib/vendor-store";
import { ilYmd } from "@/lib/coo/dates";
import { buildFinanceBrain } from "./core";
import { buildFinanceBrief } from "./brief";
import { readFinanceRaw, type FinanceReadClient } from "./readers";
import type { FinanceBriefDto } from "./dto";
import type { PartnerFinanceState, SalaryMonthRow } from "./types";

async function salaryMonths(now: Date): Promise<SalaryMonthRow[]> {
  const today = ilYmd(now);
  const year = Number(today.slice(0, 4));
  // A salary is due on the 10th of the following month, so January also needs last December.
  const years = today.slice(5, 7) === "01" ? [year - 1, year] : [year];
  const rows = (await Promise.all(years.map((y) => getVictorSalaryMonths(y)))).flat();
  return rows.map((m) => ({ workMonth: m.workMonth, dueDate: m.dueDate, amount: Number(m.amount), currency: m.currency, status: m.status, transactionId: m.transactionId }));
}

export type FinanceBriefResult = { status: "OK"; brief: FinanceBriefDto; state: PartnerFinanceState } | { status: "UNAVAILABLE"; detail: string };

export async function getFinanceBrief(now: Date = new Date()): Promise<FinanceBriefResult> {
  try {
    // Narrowing view, not a widening: the reader core only calls select / like / range.
    const raw = await readFinanceRaw(supabase as unknown as FinanceReadClient, () => salaryMonths(now));
    const state = buildFinanceBrain(raw, now);
    return { status: "OK", brief: buildFinanceBrief(state), state };
  } catch (e) {
    return { status: "UNAVAILABLE", detail: e instanceof Error ? e.message : "finance read failed" };
  }
}
