/**
 * The ONE rule that compares a payment the Owner REPORTED (P2 PAYMENT_REPORTED_BY_OWNER) with the canonical Finance
 * rows of the SAME project (Owner decisions D4 / P0-3, 2026-10-05). Pure, read-only — it never writes and never decides.
 *
 *   RECORDED         a REAL money row already says it: same project + direction + amount + currency, not cancelled, and
 *                    a status that means the money actually moved (income: שולם / התקבל; expense: שולם — validateTx's
 *                    own `received` rule). An expected (צפוי / לא שולם / חלקי) or cancelled row is NEVER "recorded".
 *   EXPECTED_UNIQUE  exactly ONE open expected row of the same project + direction + amount + currency, whose status may
 *                    move to the realized one (income צפוי → התקבל; expense צפוי / לא שולם → שולם). The canonical path is
 *                    SET_TRANSACTION_STATUS on THAT row — never a second row.
 *   AMBIGUOUS        anything that is not a unique exact match while open rows exist: more than one candidate, a
 *                    different amount (a partial payment), a different currency, a partly-paid (חלקי) row → ASK the Owner.
 *   NONE             nothing open or realized in that direction → ADD_TRANSACTION may be proposed (preview → approval →
 *                    dupGate → write → read-back). Never written from here.
 *   UNKNOWN          the subject is not a project / Finance was not read — never "not recorded".
 *
 * Direction is never flipped: RECEIVED looks only at income rows, PAID only at expense rows.
 */
import { validateTx } from "./core";
import type { FinanceTxRow } from "./types";

export type ReportedDirection = "RECEIVED" | "PAID";
export type PaymentMatch =
  | { kind: "RECORDED"; txIds: string[] }
  | { kind: "EXPECTED_UNIQUE"; txId: string; fromStatus: string; toStatus: "התקבל" | "שולם" }
  | { kind: "AMBIGUOUS"; reason: "MULTIPLE_CANDIDATES" | "AMOUNT_DIFFERS" | "CURRENCY_DIFFERS" | "PARTIAL_ROW"; txIds: string[] }
  | { kind: "NONE" }
  | { kind: "UNKNOWN"; reason: "NOT_A_PROJECT" | "FINANCE_UNREAD" | "BAD_REPORT" };

/** income → "התקבל" (the income-received status); expense → "שולם" (the only expense-paid status). */
export const REALIZED_STATUS_FOR: Record<ReportedDirection, "התקבל" | "שולם"> = { RECEIVED: "התקבל", PAID: "שולם" };
/** The open statuses a row may move FROM, per direction. חלקי is open but never moved automatically (partial = ASK). */
const MOVABLE_FROM: Record<ReportedDirection, readonly string[]> = { RECEIVED: ["צפוי"], PAID: ["צפוי", "לא שולם"] };
const OPEN_STATUSES = ["צפוי", "לא שולם", "חלקי"];

export function matchReportedPayment(
  report: { subjectKey: string; direction: string; amount: number; currency: string },
  transactions: readonly FinanceTxRow[] | null,
): PaymentMatch {
  if (!report.subjectKey.startsWith("project:")) return { kind: "UNKNOWN", reason: "NOT_A_PROJECT" };
  if (!transactions) return { kind: "UNKNOWN", reason: "FINANCE_UNREAD" };
  const dir = report.direction === "RECEIVED" || report.direction === "PAID" ? report.direction : null;
  if (!dir || !Number.isFinite(report.amount) || report.amount <= 0 || !report.currency) return { kind: "UNKNOWN", reason: "BAD_REPORT" };
  const pid = report.subjectKey.slice("project:".length);
  const type = dir === "RECEIVED" ? "income" : "expense";
  const rows = transactions.map(validateTx).filter((t): t is NonNullable<ReturnType<typeof validateTx>> => !!t && t.row.projectId === pid && t.type === type && !t.cancelled);
  const same = (t: (typeof rows)[number]) => t.amount === report.amount && t.currency === report.currency;
  const realized = rows.filter((t) => t.received && same(t));
  if (realized.length) return { kind: "RECORDED", txIds: realized.map((t) => t.row.id) };
  const open = rows.filter((t) => !t.received && OPEN_STATUSES.includes(String(t.row.status ?? "")));
  if (!open.length) return { kind: "NONE" };
  const exact = open.filter(same);
  if (exact.length > 1) return { kind: "AMBIGUOUS", reason: "MULTIPLE_CANDIDATES", txIds: exact.map((t) => t.row.id) };
  if (exact.length === 1) {
    const t = exact[0];
    const from = String(t.row.status ?? "");
    if (!MOVABLE_FROM[dir].includes(from)) return { kind: "AMBIGUOUS", reason: "PARTIAL_ROW", txIds: [t.row.id] };
    return { kind: "EXPECTED_UNIQUE", txId: t.row.id, fromStatus: from, toStatus: REALIZED_STATUS_FOR[dir] };
  }
  const sameCurrency = open.filter((t) => t.currency === report.currency);
  return sameCurrency.length
    ? { kind: "AMBIGUOUS", reason: "AMOUNT_DIFFERS", txIds: sameCurrency.map((t) => t.row.id) }
    : { kind: "AMBIGUOUS", reason: "CURRENCY_DIFFERS", txIds: open.map((t) => t.row.id) };
}
