import "server-only";

/**
 * Redbloods Partner — Finance Brain server binding.
 * Binds the reader core to the existing service-role client (select-only view) and to the canonical
 * Victor salary resolver (lib/vendor-store.ts getVictorSalaryMonths — itself read-only), then derives the
 * F2.5–F2.7 integrity / rehabilitation state from the same read.
 *
 * F2.8–F2.10: also READS the Owner's active finance answers (Owner Context, resolveCurrentOwnerContexts —
 * read-only) so the brief consumes them. This file never writes anything: the only finance write path is
 * answer-service.ts (one append-only Owner Context revision). No RPC, no Push, no Cron, no Agent Alerts.
 */
import { supabase } from "@/lib/supabase";
import { getVictorSalaryMonths } from "@/lib/vendor-store";
import { ilYmd } from "@/lib/coo/dates";
import { resolveCurrentOwnerContexts } from "../investigation/context-store";
import { buildFinanceBrief } from "./brief";
import type { PartnerFinanceIntegrityState } from "./integrity";
import { deriveFinanceView, type FinanceView } from "./view";
import type { FinanceActionCandidate } from "./actions";
import { financeAnswersFromContexts, type FinanceOwnerAnswer } from "./owner-answers";
import { readFinanceRaw, type FinanceReadClient } from "./readers";
import type { FinanceBriefDto } from "./dto";
import type { FinanceRaw, PartnerFinanceState, SalaryMonthRow } from "./types";

async function salaryMonths(now: Date): Promise<SalaryMonthRow[]> {
  const today = ilYmd(now);
  const year = Number(today.slice(0, 4));
  // A salary is due on the 10th of the following month, so January also needs last December.
  const years = today.slice(5, 7) === "01" ? [year - 1, year] : [year];
  const rows = (await Promise.all(years.map((y) => getVictorSalaryMonths(y)))).flat();
  return rows.map((m) => ({ workMonth: m.workMonth, dueDate: m.dueDate, amount: Number(m.amount), currency: m.currency, status: m.status, transactionId: m.transactionId }));
}

/** The Owner's ACTIVE finance answers (terminal CURRENT_APPLICABLE revisions). Fail-closed: never an empty list on a read failure. */
async function readFinanceAnswers(): Promise<{ ok: true; answers: FinanceOwnerAnswer[] } | { ok: false; detail: string }> {
  const r = await resolveCurrentOwnerContexts();
  if (r.status === "OK") return { ok: true, answers: financeAnswersFromContexts(r.contexts) };
  if (r.status === "NO_CONTEXT") return { ok: true, answers: [] };
  return { ok: false, detail: r.status === "READ_FAILED" ? r.error.message : `owner context unreadable (${r.status})` };
}

export type FinanceLiveResult =
  | { status: "OK"; state: PartnerFinanceState; integrity: PartnerFinanceIntegrityState; answers: FinanceOwnerAnswer[]; answersAvailable: boolean; answersDetail: string | null; actions: FinanceActionCandidate[]; actionNoteHe: string | null; raw: FinanceRaw; view: FinanceView }
  | { status: "UNAVAILABLE"; detail: string };

/** One live derivation: finance read → brain → Owner answers → integrity (answers consumed as OWNER_DECISION). */
export async function loadFinanceLive(now: Date = new Date()): Promise<FinanceLiveResult> {
  try {
    // Narrowing view, not a widening: the reader core only calls select / like / range.
    const raw = await readFinanceRaw(supabase as unknown as FinanceReadClient, () => salaryMonths(now));
    let a: Awaited<ReturnType<typeof readFinanceAnswers>>;
    try { a = await readFinanceAnswers(); } catch (e) { a = { ok: false, detail: e instanceof Error ? e.message : "owner context read failed" }; }
    const answers = a.ok ? a.answers : [];
    // F2.5–F2.11: integrity / rehabilitation + the Owner overlay are evaluated on every read (no background worker).
    const view = deriveFinanceView(raw, now, answers);
    const { state, integrity, actions, actionNoteHe } = view;
    return { status: "OK", state, integrity, answers, answersAvailable: a.ok, answersDetail: a.ok ? null : a.detail, actions, actionNoteHe, raw, view };
  } catch (e) {
    return { status: "UNAVAILABLE", detail: e instanceof Error ? e.message : "finance read failed" };
  }
}

export type FinanceBriefResult = { status: "OK"; brief: FinanceBriefDto; state: PartnerFinanceState; integrity: PartnerFinanceIntegrityState; actions: FinanceActionCandidate[] } | { status: "UNAVAILABLE"; detail: string };

export async function getFinanceBrief(now: Date = new Date()): Promise<FinanceBriefResult> {
  const live = await loadFinanceLive(now);
  if (live.status !== "OK") return live;
  if (!live.answersAvailable) console.warn("[partner/finance] owner answers unreadable — questions hidden:", live.answersDetail);
  return { status: "OK", brief: buildFinanceBrief(live.state, live.integrity, { answersAvailable: live.answersAvailable, actionNoteHe: live.answersAvailable ? live.actionNoteHe : null }), state: live.state, integrity: live.integrity, actions: live.actions };
}
