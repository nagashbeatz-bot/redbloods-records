/**
 * Redbloods Partner — Finance Brain V1 core (Phase F2.1–F2.4). Pure, deterministic, no I/O, no clock
 * (`now` is injected).
 *
 * READ + DERIVE + EXPLAIN. Reuses the canonical finance helpers — never redefines them:
 *   income received     lib/finance/classify.ts isReceivedStatus  ("שולם" | "התקבל") — INCOME ONLY
 *   expense paid        "שולם" ONLY (lib/finance/stats.ts, lib/coo/facts.ts); an expense marked "התקבל" is
 *                       invalid data — never paid, never open, never money received (fails closed, flagged)
 *   cancelled           lib/finance/classify.ts isCancelledStatus ("בוטל")
 *   currency            lib/finance/currency.ts normalizeCurrency (blank = ₪; no FX anywhere)
 *   project balance     lib/payment-status.ts   actualOutstanding / overpayment / collectibleAmount
 *   song vs clip income lib/clip-finance.ts     isSongIncome / isClipIncome / summarizeClipFinance
 *   Victor salary       lib/vendor-store.ts     getVictorSalaryMonths (resolved by the server binding)
 *
 * Owner policy (authoritative): realized net = actual business cash received − actual business
 * expenses paid, per currency; the ₪20K floor / ₪30K preferred target apply to ILS only; realized,
 * expected, receivable, committed and ideas never merge; historical months are recorded-only;
 * recording discipline starts 2026-09-23; orphan price settings never count as money.
 */
import { addDays, diffDays, ilYmd, parseYmd } from "../../coo/dates";
import { isCancelledStatus, isReceivedStatus } from "../../finance/classify";
import { normalizeCurrency } from "../../finance/currency";
import { collectibleAmount, overpaymentAmount } from "../../payment-status";
import { isClipIncome, isSongIncome, summarizeClipFinance } from "../../clip-finance";
import { splitArtistNames } from "../dossiers/relations";
import { HIGH_VALUE_THRESHOLD_ILS, resolveCollection } from "./collections";
import type {
  CoverageEntry, CoverageKey, CoverageState, CurrencyFlow, CurrencyTotals, Evidence, ExpectedItem, ExpenseClass, FinanceRaw, FinanceSignal,
  FinanceTxRow, LegacyClass, MonthWindow, OpenExpense, Opportunity, PartnerFinanceState, ProjectCredit, Receivable, RealizedMonth,
  RecurringCandidate, RecurringKnown, TargetPosition,
} from "./types";

export const FINANCE_FLOOR_ILS = 20000;
export const FINANCE_PREFERRED_ILS = 30000;
export const RECORDING_POLICY_START = "2026-09-23";
/** Items due within this many days before the policy start still count as current operations. */
export const LEGACY_CURRENT_WINDOW_DAYS = 30;
/** Recurring-candidate amount similarity (+/-10%). */
export const RECURRING_AMOUNT_TOLERANCE = 0.1;
const ILS = "₪";
const COMPLETED = "הושלם";
const CANCELLED_PROJECT = "בוטל";
/** Mirrors lib/coo/facts.ts CLOSED_PROPOSAL and lib/partner/cases/detectors/risks.ts PROPOSAL_TERMINAL_STATUSES. */
const PROPOSAL_TERMINAL = new Set(["נסגר", "לא נסגר"]);
const NEAR_DELIVERY_STATUSES = new Set(["במיקס", "מחכה למיקס"]);
const MIX_CATEGORY = /מיקס|מאסטר/;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

const round2 = (n: number) => Math.round(n * 100) / 100;
const add = (t: CurrencyTotals, cur: string, v: number) => { t[cur] = round2((t[cur] ?? 0) + v); return t; };
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
};

// ── month window (Asia/Jerusalem) ──

export function monthWindow(now: Date): MonthWindow {
  const today = ilYmd(now);
  const [y, m, d] = today.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const key = today.slice(0, 7);
  return { key, start: `${key}-01`, end: `${key}-${String(daysInMonth).padStart(2, "0")}`, today, dayOfMonth: d, daysInMonth, daysRemaining: daysInMonth - d };
}

// ── input validation (fail closed: malformed rows never reach a total) ──

/** `received` = income received (שולם|התקבל) OR expense fully paid (שולם only) — the canonical rule per type. */
interface Tx { row: FinanceTxRow; amount: number; currency: string; type: "income" | "expense"; date: string | null; received: boolean; cancelled: boolean }
/** Canonical expense-paid status (lib/finance/stats.ts, lib/coo/facts.ts). "התקבל" is an INCOME status only. */
export const EXPENSE_PAID_STATUS = "שולם";
/** An expense carrying an income-only status is invalid finance data (never counted anywhere). */
export const isInvalidExpenseStatus = (type: string | null, status: string | null) => type === "expense" && status === "התקבל";
/** Exported for the integrity layer: the SAME validation / canonical received-or-paid rule (no second copy). */
export type ValidatedTx = Tx;
export function validateTx(row: FinanceTxRow): Tx | null {
  const amount = num(row.amount);
  if (amount === null || amount < 0) return null;
  if (row.type !== "income" && row.type !== "expense") return null;
  if (row.date !== null && row.date !== undefined && row.date !== "" && !YMD.test(String(row.date).slice(0, 10))) return null;
  const date = row.date ? parseYmd(String(row.date).slice(0, 10)) : null;
  if (row.date && !date) return null;
  if (isInvalidExpenseStatus(row.type, row.status)) return null;
  const received = row.type === "income" ? isReceivedStatus(row.status) : row.status === EXPENSE_PAID_STATUS;
  return { row, amount, currency: normalizeCurrency(row.currency), type: row.type, date, received, cancelled: isCancelledStatus(row.status) };
}

interface PriceSetting { price: number | null; currency: string; exception: boolean; clipPrice: number | null; malformed: boolean }
function parseSetting(value: unknown): PriceSetting {
  if (!isObj(value)) return { price: null, currency: ILS, exception: false, clipPrice: null, malformed: true };
  const rawPrice = value.agreedPrice;
  const price = num(rawPrice);
  const malformed = rawPrice !== undefined && rawPrice !== null && rawPrice !== "" && price === null;
  const clip = num(value.clipAgreedPrice);
  return { price: price !== null && price > 0 ? price : null, currency: normalizeCurrency(typeof value.currency === "string" ? value.currency : null), exception: !!value.financeException, clipPrice: clip !== null && clip > 0 ? clip : null, malformed };
}

export function legacyOf(i: { dueDate: string | null; createdAt: string | null; amount: number; policyStart: string }): LegacyClass {
  if (i.amount === 0) return "LIKELY_HISTORICAL";
  if (i.dueDate) {
    if (i.dueDate >= i.policyStart) return "CONFIRMED_CURRENT";
    return diffDays(i.dueDate, i.policyStart) <= LEGACY_CURRENT_WINDOW_DAYS ? "CONFIRMED_CURRENT" : "NEEDS_REVIEW";
  }
  const created = i.createdAt ? parseYmd(String(i.createdAt).slice(0, 10)) : null;
  if (!created) return "UNKNOWN";
  return created >= i.policyStart ? "CONFIRMED_CURRENT" : "NEEDS_REVIEW";
}

const txEv = (t: Tx, reasonCode: string): Evidence => ({ sourceType: "transaction", sourceId: t.row.id, projectId: t.row.projectId, currency: t.currency, date: t.date, status: t.row.status, reasonCode });

function flowOf(txs: Tx[]): { byCurrency: Record<string, CurrencyFlow>; evidence: Evidence[] } {
  const byCurrency: Record<string, CurrencyFlow> = {};
  const evidence: Evidence[] = [];
  for (const t of txs) {
    if (t.cancelled || !t.received) continue;
    const f = (byCurrency[t.currency] ??= { cashIn: 0, cashOut: 0, net: 0 });
    if (t.type === "income") f.cashIn = round2(f.cashIn + t.amount); else f.cashOut = round2(f.cashOut + t.amount);
    f.net = round2(f.cashIn - f.cashOut);
    evidence.push(txEv(t, t.type === "income" ? "REALIZED_CASH_IN" : "REALIZED_CASH_OUT"));
  }
  return { byCurrency, evidence };
}

export function targetPosition(netIls: number): TargetPosition {
  return netIls < FINANCE_FLOOR_ILS ? "BELOW_FLOOR" : netIls <= FINANCE_PREFERRED_ILS ? "IN_TARGET_RANGE" : "ABOVE_PREFERRED";
}

// ── the Finance Brain ──

export function buildFinanceBrain(raw: FinanceRaw, now: Date): PartnerFinanceState {
  const month = monthWindow(now);
  const today = month.today;
  const policyStart = RECORDING_POLICY_START;

  const txs: Tx[] = [];
  let malformedTx = 0;
  const malformedEv: Evidence[] = [];
  for (const r of raw.transactions) {
    const t = validateTx(r);
    if (t) txs.push(t);
    else { malformedTx++; malformedEv.push({ sourceType: "transaction", sourceId: r.id, status: r.status, reasonCode: isInvalidExpenseStatus(r.type, r.status) ? "EXPENSE_WITH_INCOME_ONLY_STATUS" : "MALFORMED_TRANSACTION" }); }
  }
  const txById = new Map(txs.map((t) => [t.row.id, t]));
  const projects = raw.projects.filter((p) => !p.isHidden);
  const projectById = new Map(raw.projects.map((p) => [p.id, p]));
  const settingByProject = new Map<string, PriceSetting>();
  const orphanEv: Evidence[] = [];
  let malformedSettings = 0;
  for (const s of raw.financeSettings) {
    const parsed = parseSetting(s.value);
    if (parsed.malformed) { malformedSettings++; malformedEv.push({ sourceType: "finance_setting", sourceId: s.projectId, reasonCode: "MALFORMED_FINANCE_SETTING" }); }
    if (!projectById.has(s.projectId)) { orphanEv.push({ sourceType: "finance_setting", sourceId: s.projectId, reasonCode: "ORPHAN_PRICE_SETTING" }); continue; }
    settingByProject.set(s.projectId, parsed);
  }

  // clients (VIP) — soft relation: projects.artist ↔ clients.name (exact, split like the rest of the app)
  const clientsByName = new Map<string, typeof raw.clients>();
  for (const c of raw.clients) clientsByName.set(c.name, [...(clientsByName.get(c.name) ?? []), c]);
  const clientOf = (projectId: string | null): Receivable["client"] => {
    const p = projectId ? projectById.get(projectId) : null;
    if (!p?.artist) return { attribution: "NONE", vip: false };
    const found = splitArtistNames(p.artist).flatMap((n) => clientsByName.get(n) ?? []);
    const unique = [...new Map(found.map((c) => [c.id, c])).values()];
    if (unique.length === 0) return { attribution: "NONE", vip: false };
    if (unique.length > 1) return { attribution: "AMBIGUOUS", vip: false };
    return { attribution: "TEXT_MATCH", vip: unique[0].status === "VIP" };
  };

  // ── realized (current month + history) ──
  const dated = txs.filter((t) => t.date);
  const monthsPresent = [...new Set(dated.map((t) => t.date!.slice(0, 7)))].sort();
  const realizedOf = (key: string): RealizedMonth => {
    const { byCurrency, evidence } = flowOf(dated.filter((t) => t.date!.startsWith(key)));
    return { month: key, byCurrency, ils: byCurrency[ILS] ?? { cashIn: 0, cashOut: 0, net: 0 }, historicalPartial: `${key}-01` < policyStart, evidence };
  };
  const current = realizedOf(month.key);
  const history = monthsPresent.filter((k) => k < month.key).map(realizedOf);

  // ── receivables, credits, expected ──
  const receivables: Receivable[] = [];
  const credits: ProjectCredit[] = [];
  const expected: ExpectedItem[] = [];
  const currencyMismatchEv: Evidence[] = [];
  const pushReceivable = (r: Omit<Receivable, "collection" | "legacy" | "reasonKnown" | "reason" | "client"> & { createdAt: string | null; notCollectible?: boolean; needsReview?: boolean }) => {
    const client = clientOf(r.projectId);
    const collection = resolveCollection({ amount: r.amount, currency: r.currency, dueDate: r.dueDate, today, vip: client.vip, notCollectible: r.notCollectible, needsReview: r.needsReview });
    const p = r.projectId ? projectById.get(r.projectId) : null;
    // A balance with no date on a still-open project is part of a live deal; on a completed/older one it needs review.
    const legacy: LegacyClass = r.source !== "EXPECTED_TX" && !r.dueDate
      ? (p && p.status !== COMPLETED ? "CONFIRMED_CURRENT" : legacyOf({ dueDate: null, createdAt: p?.updatedAt ?? null, amount: r.amount, policyStart }))
      : legacyOf({ dueDate: r.dueDate, createdAt: r.createdAt, amount: r.amount, policyStart });
    const { createdAt: _c, notCollectible: _n, needsReview: _r, ...rest } = r;
    void _c; void _n; void _r;
    receivables.push({ ...rest, client, collection, legacy, reasonKnown: false, reason: "UNKNOWN" });
  };
  const openIncome = (t: Tx) => t.type === "income" && !t.received && !t.cancelled;
  for (const t of txs.filter(openIncome)) {
    expected.push({ class: t.date ? "DATED_EXPECTED" : "UNDATED_EXPECTED", amount: t.amount, currency: t.currency, date: t.date, certainty: "CONTRACTUAL_RECORD", projectId: t.row.projectId, evidence: [txEv(t, "EXPECTED_INCOME_RECORD")] });
  }

  /** Allocates a known outstanding amount over explicit expected rows (dated first); the rest is an undated balance. */
  const allocate = (
    p: { id: string; name: string; status: string }, outstanding: number, currency: string, rows: Tx[], source: "PROJECT_BALANCE" | "CLIP_BALANCE", baseEv: Evidence[], notCollectible: boolean,
  ) => {
    let remaining = outstanding;
    const ordered = [...rows].sort((a, b) => (a.date ?? "9999") < (b.date ?? "9999") ? -1 : (a.date ?? "9999") > (b.date ?? "9999") ? 1 : a.row.id < b.row.id ? -1 : 1);
    for (const t of ordered) {
      if (remaining <= 0) break;
      const amt = round2(Math.min(t.amount, remaining));
      remaining = round2(remaining - amt);
      pushReceivable({ id: `EXPECTED_TX:${t.row.id}`, source: "EXPECTED_TX", priceKnown: true, projectId: p.id, projectName: p.name, projectStatus: p.status, amount: amt, currency, dueDate: t.date, createdAt: t.row.createdAt, evidence: [...baseEv, txEv(t, "EXPECTED_INCOME_WITHIN_AGREED_PRICE")], notCollectible });
    }
    if (remaining > 0) {
      pushReceivable({ id: `${source}:${p.id}`, source, priceKnown: true, projectId: p.id, projectName: p.name, projectStatus: p.status, amount: remaining, currency, dueDate: null, createdAt: null, evidence: baseEv, notCollectible });
    }
  };

  const handledIncomeTx = new Set<string>();
  const priceCoverage = { liveProjects: projects.length, priced: 0, priceUnknownOpen: 0, priceUnknownCompleted: 0, financeExceptions: 0, malformedSettings };
  for (const p of projects) {
    const st = settingByProject.get(p.id);
    const mine = txs.filter((t) => t.row.projectId === p.id);
    const txLike = (t: Tx) => ({ type: t.type, amount: t.amount, payment_status: t.row.status, expense_scope: t.row.expenseScope });
    if (st?.exception) priceCoverage.financeExceptions++;
    else if (st?.price) priceCoverage.priced++;
    else if (p.status === COMPLETED) priceCoverage.priceUnknownCompleted++;
    else if (p.status !== CANCELLED_PROJECT) priceCoverage.priceUnknownOpen++;
    const notCollectible = p.status === CANCELLED_PROJECT;

    // Song deal
    const song = mine.filter((t) => isSongIncome(txLike(t)));
    if (st?.price && !st.exception) {
      const same = song.filter((t) => t.currency === st.currency);
      const received = round2(same.filter((t) => t.received && !t.cancelled).reduce((s, t) => s + t.amount, 0));
      const cancelledIncome = round2(same.filter((t) => t.cancelled).reduce((s, t) => s + t.amount, 0));
      const baseEv: Evidence[] = [{ sourceType: "finance_setting", sourceId: p.id, projectId: p.id, currency: st.currency, reasonCode: "AGREED_PRICE" }, ...same.filter((t) => t.received).map((t) => txEv(t, "RECEIVED_AGAINST_PRICE"))];
      const over = overpaymentAmount(st.price, received);
      if (over > 0) credits.push({ projectId: p.id, projectName: p.name, amount: round2(over), currency: st.currency, kind: "SONG", evidence: baseEv });
      const collectible = collectibleAmount(st.price, received, cancelledIncome, p.status);
      const openRows = same.filter(openIncome);
      for (const t of openRows) handledIncomeTx.add(t.row.id);
      if (collectible > 0) allocate(p, round2(collectible), st.currency, openRows, "PROJECT_BALANCE", baseEv, false);
      else if (notCollectible && st.price - received > 0) pushReceivable({ id: `PROJECT_BALANCE:${p.id}`, source: "PROJECT_BALANCE", priceKnown: true, projectId: p.id, projectName: p.name, projectStatus: p.status, amount: round2(st.price - received), currency: st.currency, dueDate: null, createdAt: null, evidence: baseEv, notCollectible: true });
      for (const t of song.filter((x) => x.currency !== st.currency && openIncome(x))) {
        handledIncomeTx.add(t.row.id);
        currencyMismatchEv.push(txEv(t, "EXPECTED_INCOME_CURRENCY_DIFFERS_FROM_PRICE"));
        pushReceivable({ id: `EXPECTED_TX:${t.row.id}`, source: "EXPECTED_TX", priceKnown: false, projectId: p.id, projectName: p.name, projectStatus: p.status, amount: t.amount, currency: t.currency, dueDate: t.date, createdAt: t.row.createdAt, evidence: [txEv(t, "EXPECTED_INCOME_CURRENCY_DIFFERS_FROM_PRICE")], needsReview: true });
      }
    }
    // Clip deal (its own agreed price; canonical clip math)
    const clip = mine.filter((t) => isClipIncome(txLike(t)));
    if (st?.clipPrice && !st.exception) {
      const same = clip.filter((t) => t.currency === st.currency);
      const summary = summarizeClipFinance(same.map(txLike), st.clipPrice);
      const baseEv: Evidence[] = [{ sourceType: "finance_setting", sourceId: p.id, projectId: p.id, currency: st.currency, reasonCode: "CLIP_AGREED_PRICE" }, ...same.filter((t) => t.received).map((t) => txEv(t, "CLIP_RECEIVED"))];
      if (summary.credit > 0) credits.push({ projectId: p.id, projectName: p.name, amount: round2(summary.credit), currency: st.currency, kind: "CLIP", evidence: baseEv });
      const openRows = same.filter(openIncome);
      for (const t of openRows) handledIncomeTx.add(t.row.id);
      if (summary.remaining > 0) allocate(p, round2(summary.remaining), st.currency, openRows, "CLIP_BALANCE", baseEv, notCollectible);
    }
  }
  // Explicit expected income not covered by an agreed price (still real, recorded evidence — amount from the record itself).
  for (const t of txs.filter(openIncome)) {
    if (handledIncomeTx.has(t.row.id)) continue;
    const p = t.row.projectId ? projectById.get(t.row.projectId) : null;
    pushReceivable({ id: `EXPECTED_TX:${t.row.id}`, source: "EXPECTED_TX", priceKnown: false, projectId: p ? p.id : null, projectName: p?.name ?? null, projectStatus: p?.status ?? null, amount: t.amount, currency: t.currency, dueDate: t.date, createdAt: t.row.createdAt, evidence: [txEv(t, "EXPECTED_INCOME_RECORD")], notCollectible: p?.status === CANCELLED_PROJECT });
  }
  receivables.sort((a, b) => (a.dueDate ?? "9999-99-99") < (b.dueDate ?? "9999-99-99") ? -1 : (a.dueDate ?? "9999-99-99") > (b.dueDate ?? "9999-99-99") ? 1 : a.id < b.id ? -1 : 1);

  // ── proposals (pipeline — never income) ──
  const openProposals = raw.proposals.filter((p) => !PROPOSAL_TERMINAL.has(p.status ?? ""));
  const pipelineAmounts: CurrencyTotals = {};
  for (const p of openProposals) {
    const a = num(p.amount);
    if (a !== null && a > 0) add(pipelineAmounts, normalizeCurrency(p.currency), a);
    expected.push({ class: "PROPOSAL_PIPELINE", amount: a ?? 0, currency: normalizeCurrency(p.currency), date: parseYmd(p.followupDate), certainty: "PROPOSAL_ONLY", projectId: p.linkedProjectId, evidence: [{ sourceType: "proposal", sourceId: p.id, clientId: p.clientId, reasonCode: "OPEN_PROPOSAL" }] });
  }

  // ── open / committed expenses (with dedupe + provenance) ──
  const engineerLinked = new Set(raw.engineerWorks.map((w) => w.linkedTransactionId).filter((x): x is string => !!x));
  const showPayoutTx = new Set(raw.shows.flatMap((s) => [s.artistTxId, s.djTxId]).filter((x): x is string => !!x));
  const items: OpenExpense[] = [];
  const settlementAmbiguous: Evidence[] = [];
  for (const w of raw.engineerWorks) {
    if ((w.status ?? "") === "בוטל") continue;
    const agreed = num(w.agreedPrice), paid = num(w.amountPaid) ?? 0;
    const cur = normalizeCurrency(w.currency);
    const linked = w.linkedTransactionId ? txById.get(w.linkedTransactionId) : null;
    if (linked && linked.currency !== cur) settlementAmbiguous.push({ sourceType: "engineer_work", sourceId: w.id, projectId: w.projectId, currency: cur, status: w.status, reasonCode: `WORK_IN_${cur}_TRANSACTION_IN_${linked.currency}` });
    if (agreed === null || agreed - paid <= 0) continue;
    const approvedUnpaid = w.status === "אושר";
    items.push({ id: `ENGINEER_WORK:${w.id}`, source: "ENGINEER_WORK", amount: round2(agreed - paid), currency: cur, dueDate: null, category: "מיקס / מאסטר", projectId: w.projectId, legacy: approvedUnpaid ? "NEEDS_REVIEW" : "CONFIRMED_CURRENT", overdueDays: null, evidence: [{ sourceType: "engineer_work", sourceId: w.id, projectId: w.projectId, currency: cur, status: w.status, reasonCode: approvedUnpaid ? "APPROVED_WORK_UNPAID" : "WORK_IN_PROGRESS_UNPAID" }] });
  }
  const possibleOverlaps: OpenExpense[] = [];
  for (const t of txs) {
    if (t.type !== "expense" || t.received || t.cancelled || engineerLinked.has(t.row.id)) continue;
    const e: OpenExpense = {
      id: `TX:${t.row.id}`, source: showPayoutTx.has(t.row.id) ? "SHOW_PAYOUT" : "TRANSACTION", amount: t.amount, currency: t.currency, dueDate: t.date, category: t.row.category, projectId: t.row.projectId,
      legacy: legacyOf({ dueDate: t.date, createdAt: t.row.createdAt, amount: t.amount, policyStart }), overdueDays: t.date && t.date < today ? diffDays(t.date, today) : null,
      evidence: [txEv(t, showPayoutTx.has(t.row.id) ? "SHOW_PAYOUT_OPEN" : "EXPENSE_OPEN")],
    };
    const overlaps = e.source === "TRANSACTION" && MIX_CATEGORY.test(t.row.category ?? "") && items.some((w) => w.source === "ENGINEER_WORK" && w.projectId && w.projectId === t.row.projectId && w.currency === t.currency);
    (overlaps ? possibleOverlaps : items).push(e);
  }
  const openTotals: CurrencyTotals = {};
  for (const e of items) add(openTotals, e.currency, e.amount);

  // ── recurring vs one-time ──
  const classification: Record<string, ExpenseClass> = {};
  const expenseTx = txs.filter((t) => t.type === "expense" && !t.cancelled);
  const known: RecurringKnown[] = [];
  for (const t of expenseTx) {
    const sid = t.row.linkedSessionId ?? "";
    if (sid.startsWith("victor_salary_")) classification[t.row.id] = "KNOWN_RECURRING";
    else if (engineerLinked.has(t.row.id) || showPayoutTx.has(t.row.id) || (t.row.expenseScope ?? "") === "קליפ" || (t.row.expenseScope ?? "") === "הופעה" || (sid !== "" && !sid.startsWith("victor_salary_"))) classification[t.row.id] = "KNOWN_ONE_TIME";
  }
  // Recurring candidates (HYPOTHESIS only): same explicit category (exact, trimmed; free text is never read or
  // fuzzy-merged), same currency, reasonably similar amount (within RECURRING_AMOUNT_TOLERANCE of the cluster's
  // smallest amount), present in >= 3 distinct months. Rows without a category are never grouped.
  const groups = new Map<string, Tx[]>();
  for (const t of expenseTx.filter((x) => !classification[x.row.id] && x.received && x.date && (x.row.category ?? "").trim() !== "")) {
    const k = `${(t.row.category ?? "").trim()}|${t.currency}`;
    groups.set(k, [...(groups.get(k) ?? []), t]);
  }
  const candidates: RecurringCandidate[] = [];
  for (const [k, list] of groups) {
    const [category, currency] = k.split("|");
    const sorted = [...list].sort((x, y) => x.amount - y.amount || (x.row.id < y.row.id ? -1 : 1));
    let i = 0;
    while (i < sorted.length) {
      const anchor = sorted[i].amount;
      const cluster = sorted.filter((t, j) => j >= i && t.amount <= anchor * (1 + RECURRING_AMOUNT_TOLERANCE));
      i += cluster.length;
      const months = [...new Set(cluster.map((t) => t.date!.slice(0, 7)))].sort();
      if (months.length < 3) continue;
      for (const t of cluster) classification[t.row.id] = "RECURRING_CANDIDATE";
      const amounts = cluster.map((t) => t.amount).sort((x, y) => x - y);
      const median = amounts[Math.floor((amounts.length - 1) / 2)];
      candidates.push({ key: `${category}|${median}|${currency}`, category, amount: median, currency, months, epistemic: "HYPOTHESIS", evidence: cluster.map((t) => txEv(t, "REPEATED_EXPENSE_PATTERN")) });
    }
  }
  for (const t of expenseTx) classification[t.row.id] ??= "UNKNOWN_CLASSIFICATION";
  const unknownClassificationThisMonth = expenseTx.filter((t) => t.received && t.date?.startsWith(month.key) && classification[t.row.id] === "UNKNOWN_CLASSIFICATION").length;
  if (raw.victorSalary) {
    for (const s of raw.victorSalary) {
      if (!(s.dueDate >= month.start && s.dueDate <= month.end)) continue;
      const tx = s.transactionId ? txById.get(s.transactionId) : null;
      const state: RecurringKnown["state"] = s.status === "שולם" ? (tx && tx.received ? "FOUND_IN_FINANCE" : "PAID_OUTSIDE_FINANCE")
        : tx ? "FOUND_IN_FINANCE"
        : s.status === "לא שולם" ? "EXPECTED_EXPENSE_NOT_FOUND"
        : s.status === "צפוי" ? "COMMITTED_UPCOMING" : "CANCELLED_OR_OTHER";
      known.push({ code: "VICTOR_SALARY", workMonth: s.workMonth, dueDate: s.dueDate, amount: s.amount, currency: normalizeCurrency(s.currency), state, evidence: [{ sourceType: "salary_month", sourceId: s.workMonth, currency: normalizeCurrency(s.currency), date: s.dueDate, status: s.status, reasonCode: `VICTOR_SALARY_${state}` }] });
    }
  }

  // ── signals (recording discipline + data quality; no blame, no mutation) ──
  const signals: FinanceSignal[] = [];
  const sig = (code: FinanceSignal["code"], epistemic: FinanceSignal["epistemic"], count: number, evidence: Evidence[], amounts: CurrencyTotals = {}, review: FinanceSignal["review"] = null) => {
    if (count > 0) signals.push({ code, epistemic, count, amounts, review, evidence });
  };
  const historicalMonths = [...history.filter((h) => h.historicalPartial).map((h) => h.month), ...(current.historicalPartial ? [current.month] : [])];
  sig("HISTORICAL_DATA_PARTIAL", "FACT", historicalMonths.length, historicalMonths.map((m) => ({ sourceType: "transaction" as const, sourceId: m, reasonCode: "MONTH_BEFORE_RECORDING_POLICY" })));
  const expectedNotRecorded = receivables.filter((r) => r.source === "EXPECTED_TX" && r.dueDate && r.dueDate >= policyStart && r.dueDate <= today && (r.collection.state === "DUE_TODAY" || r.collection.state === "OVERDUE"));
  sig("EXPECTED_INCOME_NOT_RECORDED", "DERIVED", expectedNotRecorded.length, expectedNotRecorded.flatMap((r) => r.evidence), expectedNotRecorded.reduce((m, r) => add(m, r.currency, r.amount), {} as CurrencyTotals));
  const missingRecurring = known.filter((k) => k.state === "EXPECTED_EXPENSE_NOT_FOUND");
  sig("EXPECTED_EXPENSE_NOT_FOUND", "DERIVED", missingRecurring.length, missingRecurring.flatMap((k) => k.evidence), missingRecurring.reduce((m, k) => add(m, k.currency, k.amount), {} as CurrencyTotals));
  const outside = known.filter((k) => k.state === "PAID_OUTSIDE_FINANCE");
  sig("EXPENSE_NOT_IN_FINANCE", "FACT", outside.length, outside.flatMap((k) => k.evidence), outside.reduce((m, k) => add(m, k.currency, k.amount), {} as CurrencyTotals));
  const unpricedEv = projects.filter((p) => !settingByProject.get(p.id)?.price && !settingByProject.get(p.id)?.exception && p.status !== CANCELLED_PROJECT).map((p) => ({ sourceType: "project" as const, sourceId: p.id, projectId: p.id, status: p.status, reasonCode: "PRICE_UNKNOWN" }));
  sig("PRICE_MISSING", "FACT", unpricedEv.length, unpricedEv);
  const completedNoIncome = projects.filter((p) => {
    if (p.status !== COMPLETED || settingByProject.get(p.id)?.price) return false;
    const mine = txs.filter((t) => t.row.projectId === p.id && !t.cancelled);
    return mine.some((t) => t.type === "expense" && t.received) && !mine.some((t) => t.type === "income");
  });
  sig("COMPLETED_WORK_EXPENSE_NO_INCOME", "DERIVED", completedNoIncome.length,
    completedNoIncome.map((p) => ({ sourceType: "project" as const, sourceId: p.id, projectId: p.id, status: p.status, reasonCode: "COMPLETED_PAID_EXPENSE_NO_INCOME_RECORD" })),
    completedNoIncome.reduce((m, p) => { for (const t of txs.filter((x) => x.row.projectId === p.id && x.type === "expense" && x.received)) add(m, t.currency, t.amount); return m; }, {} as CurrencyTotals));
  const collectibleRec = receivables.filter((r) => r.collection.state !== "SETTLED" && r.collection.state !== "NOT_COLLECTIBLE");
  const noDate = collectibleRec.filter((r) => r.collection.state === "NO_DUE_DATE");
  sig("DUE_DATE_MISSING", "FACT", noDate.length, noDate.flatMap((r) => r.evidence), noDate.reduce((m, r) => add(m, r.currency, r.amount), {} as CurrencyTotals));
  const unlinked = txs.filter((t) => t.row.scope === "project" && !t.row.projectId);
  sig("TRANSACTION_PROJECT_LINK_MISSING", "FACT", unlinked.length, unlinked.map((t) => txEv(t, "PROJECT_SCOPE_WITHOUT_PROJECT")));
  sig("CURRENCY_SETTLEMENT_AMBIGUOUS", "FACT", settlementAmbiguous.length, settlementAmbiguous);
  sig("CURRENCY_AMBIGUOUS", "FACT", currencyMismatchEv.length, currencyMismatchEv);
  sig("RECURRING_CLASSIFICATION_UNKNOWN", "UNKNOWN", unknownClassificationThisMonth, expenseTx.filter((t) => t.received && t.date?.startsWith(month.key) && classification[t.row.id] === "UNKNOWN_CLASSIFICATION").map((t) => txEv(t, "EXPENSE_CLASS_UNKNOWN")));
  sig("ORPHAN_PRICE_SETTINGS", "FACT", orphanEv.length, orphanEv, {}, "NEEDS_OWNER_REVIEW");
  const showNoPrice = raw.shows.filter((s) => s.status === "בוצע" && !((num(s.price) ?? 0) > 0));
  sig("SHOW_PRICE_MISSING", "FACT", showNoPrice.length, showNoPrice.map((s) => ({ sourceType: "show" as const, sourceId: s.id, date: s.date, status: s.status, reasonCode: "COMPLETED_SHOW_WITHOUT_PRICE" })));
  const dupKey = (t: Tx) => [t.type, t.amount, t.currency, t.date, t.row.projectId, t.row.category, t.row.status].join("|");
  const dupGroups = new Map<string, Tx[]>();
  for (const t of txs) dupGroups.set(dupKey(t), [...(dupGroups.get(dupKey(t)) ?? []), t]);
  const dups = [...dupGroups.values()].filter((g) => g.length > 1);
  sig("DUPLICATE_LOOKING_RECORDS", "HYPOTHESIS", dups.length, dups.flat().map((t) => txEv(t, "SAME_TYPE_AMOUNT_DATE_PROJECT_CATEGORY")));
  sig("MALFORMED_RECORDS", "FACT", malformedTx + malformedSettings, malformedEv);
  sig("LABEL_LEDGER_NO_CURRENCY", "FACT", raw.ledger.length, raw.ledger.map((l, i) => ({ sourceType: "label_ledger" as const, sourceId: `${l.artistId}#${i}`, reasonCode: l.sourceTxId ? "LEDGER_ROW_MIRRORS_TRANSACTION" : "LEDGER_ROW_NO_CURRENCY" })));
  sig("MEDIA_INCOME_NO_CURRENCY", "FACT", raw.mediaIncome.length, raw.mediaIncome.map((m, i) => ({ sourceType: "media_income" as const, sourceId: `${m.labelArtistId}#${i}`, status: m.status, reasonCode: "MEDIA_INCOME_NO_CURRENCY" })));
  const rfPaid = raw.redFilmsPayments.filter((p) => (num(p.amount) ?? 0) > 0);
  sig("RED_FILMS_OUTSIDE_FINANCE", "FACT", rfPaid.length, rfPaid.map((p) => ({ sourceType: "red_films_payment" as const, sourceId: p.id, date: p.paymentDate, reasonCode: "PAYMENT_WITHOUT_CURRENCY_OR_TRANSACTION" })));
  const undated = txs.filter((t) => !t.date && !t.cancelled);
  sig("UNDATED_RECORDS", "FACT", undated.length, undated.map((t) => txEv(t, "NO_DATE")), undated.reduce((m, t) => add(m, t.currency, t.amount), {} as CurrencyTotals));
  sig("POSSIBLE_OBLIGATION_OVERLAP", "HYPOTHESIS", possibleOverlaps.length, possibleOverlaps.flatMap((e) => e.evidence), possibleOverlaps.reduce((m, e) => add(m, e.currency, e.amount), {} as CurrencyTotals));

  // ── coverage (factual categories — no score) ──
  const has = (c: FinanceSignal["code"]) => signals.some((s) => s.code === c);
  const cov = (state: CoverageState, reason: string): CoverageEntry => ({ state, reason });
  const beforePolicy = month.start < policyStart;
  const projectScoped = txs.filter((t) => t.row.scope === "project");
  const coverage: Record<CoverageKey, CoverageEntry> = {
    realizedIncome: beforePolicy ? cov("PARTIAL", "MONTH_STARTED_BEFORE_RECORDING_POLICY") : has("EXPECTED_INCOME_NOT_RECORDED") ? cov("PARTIAL", "EXPECTED_INCOME_NOT_CONFIRMED") : cov("RELIABLE", "RECORDING_POLICY_IN_EFFECT"),
    realizedExpenses: beforePolicy ? cov("PARTIAL", "MONTH_STARTED_BEFORE_RECORDING_POLICY")
      : has("EXPECTED_EXPENSE_NOT_FOUND") || has("EXPENSE_NOT_IN_FINANCE") ? cov("PARTIAL", "KNOWN_RECURRING_EXPENSE_NOT_IN_FINANCE")
      : cov("PARTIAL", "FIXED_COSTS_NOT_FULLY_REPRESENTED"),
    agreedPrices: priceCoverage.priced === 0 ? cov("MISSING", "NO_LIVE_PROJECT_HAS_A_PRICE") : priceCoverage.priceUnknownOpen + priceCoverage.priceUnknownCompleted === 0 ? cov("RELIABLE", "ALL_LIVE_PROJECTS_PRICED") : cov("PARTIAL", `${priceCoverage.priced}_OF_${priceCoverage.liveProjects}_PRICED`),
    receivableDueDates: collectibleRec.length === 0 ? cov("RELIABLE", "NO_OPEN_RECEIVABLES") : noDate.length === 0 ? cov("RELIABLE", "ALL_DATED") : noDate.length === collectibleRec.length ? cov("MISSING", "NONE_DATED") : cov("PARTIAL", `${collectibleRec.length - noDate.length}_OF_${collectibleRec.length}_DATED`),
    recurringExpenses: raw.victorSalary === null ? cov("MISSING", "SALARY_READ_UNAVAILABLE") : cov("PARTIAL", "ONLY_VICTOR_SALARY_CONFIGURED"),
    projectAttribution: projectScoped.length === 0 || unlinked.length === 0 ? cov("RELIABLE", "PROJECT_SCOPED_ROWS_LINKED") : cov("PARTIAL", "PROJECT_SCOPED_ROWS_WITHOUT_PROJECT"),
    clientAttribution: cov("AMBIGUOUS", "PROJECTS_LINK_CLIENTS_BY_NAME_ONLY"),
    labelAttribution: cov("AMBIGUOUS", "LABEL_WORK_LINKED_BY_NAME"),
    currencies: has("CURRENCY_SETTLEMENT_AMBIGUOUS") || has("CURRENCY_AMBIGUOUS") ? cov("AMBIGUOUS", "USD_OBLIGATIONS_SETTLED_IN_ILS_WITHOUT_FX_POLICY")
      : raw.ledger.length || raw.mediaIncome.length || rfPaid.length ? cov("PARTIAL", "SOME_LEDGERS_WITHOUT_CURRENCY") : cov("RELIABLE", "TRANSACTIONS_CARRY_CURRENCY"),
    proposalPipeline: openProposals.length === 0 ? cov("MISSING", "NO_ACTIVE_PIPELINE_DATA") : cov("PARTIAL", "PROPOSALS_ARE_NOT_COMMITTED_INCOME"),
  };

  // ── pacing: known month-end position (NOT a straight-line forecast) ──
  const inMonth = (d: string | null) => !!d && d >= month.start && d <= month.end;
  const activeRec = receivables.filter((r) => r.collection.state !== "SETTLED" && r.collection.state !== "NOT_COLLECTIBLE" && r.collection.state !== "NEEDS_REVIEW");
  const knownIn: CurrencyTotals = {}, knownOut: CurrencyTotals = {};
  for (const r of activeRec) if (r.dueDate && r.dueDate >= today && r.dueDate <= month.end) add(knownIn, r.currency, r.amount);
  for (const e of items) if (inMonth(e.dueDate)) add(knownOut, e.currency, e.amount);
  for (const k of known) if (k.state === "COMMITTED_UPCOMING" && k.dueDate >= today) add(knownOut, k.currency, k.amount);
  const recordedNet = current.ils.net;
  const knownInIls = knownIn[ILS] ?? 0, knownOutIls = knownOut[ILS] ?? 0;
  const position = round2(recordedNet + knownInIls - knownOutIls);
  const other = (t: CurrencyTotals) => Object.fromEntries(Object.entries(t).filter(([c]) => c !== ILS));
  const combined: CoverageState = coverage.realizedIncome.state === "RELIABLE" && coverage.realizedExpenses.state === "RELIABLE" ? "RELIABLE" : "PARTIAL";
  const gap = (target: number, v: number) => round2(Math.max(target - v, 0));

  // ── opportunities (never a revenue prediction) ──
  const opportunities: Opportunity[] = [];
  const opp = (kind: Opportunity["kind"], code: Opportunity["code"], list: { amount?: number; currency?: string; evidence: Evidence[] }[], withAmount: boolean) => {
    if (!list.length) return;
    opportunities.push({ kind, code, count: list.length, amount: withAmount ? list.reduce((m, x) => add(m, x.currency!, x.amount!), {} as CurrencyTotals) : null, evidence: list.flatMap((x) => x.evidence) });
  };
  opp("FACT_BASED_OPPORTUNITY", "OVERDUE_RECEIVABLE", activeRec.filter((r) => r.collection.state === "OVERDUE"), true);
  opp("FACT_BASED_OPPORTUNITY", "DUE_SOON_RECEIVABLE", activeRec.filter((r) => r.collection.state === "DUE_SOON" || r.collection.state === "DUE_TODAY" || (r.collection.state === "UPCOMING" && r.dueDate! <= month.end)), true);
  opp("FACT_BASED_OPPORTUNITY", "COMPLETED_PROJECT_BALANCE", activeRec.filter((r) => r.priceKnown && r.source !== "EXPECTED_TX" && r.projectStatus === COMPLETED), true);
  opp("DERIVED_OPPORTUNITY", "OPEN_PROPOSAL", openProposals.map((p) => ({ evidence: [{ sourceType: "proposal" as const, sourceId: p.id, clientId: p.clientId, reasonCode: "OPEN_PROPOSAL" }] })), false);
  opp("DERIVED_OPPORTUNITY", "COMPLETED_WORK_EXPENSE_NO_INCOME", completedNoIncome.map((p) => ({ evidence: [{ sourceType: "project" as const, sourceId: p.id, projectId: p.id, reasonCode: "CHECK_INCOME_RECORD" }] })), false);
  const openUnpriced = projects.filter((p) => p.status !== COMPLETED && p.status !== CANCELLED_PROJECT && !settingByProject.get(p.id)?.price && !settingByProject.get(p.id)?.exception);
  opp("DERIVED_OPPORTUNITY", "PRICE_MISSING_BLOCKS_COLLECTION", openUnpriced.map((p) => ({ evidence: [{ sourceType: "project" as const, sourceId: p.id, projectId: p.id, reasonCode: "OPEN_PROJECT_PRICE_UNKNOWN" }] })), false);
  opp("DERIVED_OPPORTUNITY", "NEAR_DELIVERY_UNPRICED", openUnpriced.filter((p) => NEAR_DELIVERY_STATUSES.has(p.status)).map((p) => ({ evidence: [{ sourceType: "project" as const, sourceId: p.id, projectId: p.id, status: p.status, reasonCode: "NEAR_DELIVERY_PRICE_UNKNOWN" }] })), false);
  const vips = raw.clients.filter((c) => c.status === "VIP");
  if (openProposals.length === 0) opp("IDEA", "VIP_FOLLOW_UP", vips.map((c) => ({ evidence: [{ sourceType: "client" as const, sourceId: c.id, clientId: c.id, reasonCode: "VIP_CLIENT_NO_OPEN_PROPOSAL" }] })), false);
  const futureShows = raw.shows.filter((s) => s.date && s.date > today && s.status !== "בוטל");
  if (futureShows.length === 0) opportunities.push({ kind: "IDEA", code: "SHOW_PIPELINE_GAP", count: 0, amount: null, evidence: [{ sourceType: "show", sourceId: "none", date: today, reasonCode: "NO_FUTURE_SHOWS_RECORDED" }] });

  return {
    schemaVersion: "partner-finance-brain-v1",
    policy: { floorIls: FINANCE_FLOOR_ILS, preferredIls: FINANCE_PREFERRED_ILS, policyStartYmd: policyStart, highValueThresholdIls: HIGH_VALUE_THRESHOLD_ILS },
    month,
    coverage,
    realized: { ...current, targetPosition: targetPosition(current.ils.net), distanceToFloor: gap(FINANCE_FLOOR_ILS, current.ils.net), distanceToPreferred: gap(FINANCE_PREFERRED_ILS, current.ils.net) },
    history,
    receivables,
    credits,
    priceCoverage,
    expected,
    openExpenses: { items, totalsByCurrency: openTotals, possibleOverlaps },
    recurring: { known, candidates, unknownClassificationThisMonth, classification },
    pacing: {
      recordedRealizedNetIls: recordedNet, knownIncomingIls: round2(knownInIls), knownOutgoingIls: round2(knownOutIls), knownMonthEndPositionIls: position,
      gapToFloorNow: gap(FINANCE_FLOOR_ILS, recordedNet), gapToPreferredNow: gap(FINANCE_PREFERRED_ILS, recordedNet),
      gapToFloorKnownPosition: gap(FINANCE_FLOOR_ILS, position), gapToPreferredKnownPosition: gap(FINANCE_PREFERRED_ILS, position),
      otherCurrencies: { incoming: other(knownIn), outgoing: other(knownOut) }, daysRemaining: month.daysRemaining, label: "KNOWN_MONTH_END_POSITION", coverage: combined,
    },
    signals,
    opportunities,
    proposalPipeline: { state: openProposals.length ? "ACTIVE" : "NO_ACTIVE_PIPELINE_DATA", openCount: openProposals.length, amounts: pipelineAmounts },
  };
}

/** For callers that need a date N days from a YMD (tests / brief wording). */
export { addDays };
