/**
 * Redbloods Partner — Gateway: ONE transaction (partner_entity "transaction:<id>"). Pure, deterministic, READ-ONLY.
 *
 * Built only from sources the Gateway already loads — no new table reader, no second source of truth:
 *   money / identity   → the Finance Brain raw read (the same row every Finance view counts);
 *   ownership          → the app's ONE rule (lib/finance/ownership ownerFromLinks / ownerUi) over the SAME link
 *                        columns the Finance route reads (shows, mix work, clip rows, Red Films lines / payments,
 *                        social promotions) — taken from Finance raw, PROJECT_DETAIL and OPERATIONS;
 *   expense share      → the ONE rule (lib/records-expense-share) + the recorded artist-ledger rows;
 *   text               → PROJECT_DETAIL / CLIENT_DETAIL (Owner-only; the receipt is a boolean, never the reference).
 * Money is shown exactly as stored: the row's own amount and currency, never converted, never summed with another row.
 * Nothing here decides, plans or writes — a change to a transaction is a separate typed action with its own preview.
 */
import { ownerFromLinks, ownerUi, type FinanceOwnerCode, type TxOwnerLinks } from "../../finance/ownership";
import { DEPRECATED_PAYMENT_STATUSES } from "../../finance/classify";
import { expenseShareOf } from "../../records-expense-share";
import { expenseSharesFromFinanceRaw } from "../finance/unit-view";
import { salaryLinkedId, salaryMonthLabel } from "../../victor-salary-format";
import { ok, partner, record, heDate, type GatewaySources } from "./core";
import { drill, fact, type EntityDraft } from "./entity-common";
import type { GatewayFact, GatewayRelationship } from "./types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHOW_ROLE_OWNERS = new Set(["SHOW_PAYMENT", "SHOW_BALANCE_EXPECTED", "DJ_FEE", "ARTIST_FEE", "REHEARSAL", "SHOW"]);
/** ownerFromLinks precedence (lower = checked first) — so an unread link source can only hide a LOWER-ranked owner. */
function ownerRank(o: FinanceOwnerCode | null): number {
  if (o === null) return 99;
  if (SHOW_ROLE_OWNERS.has(o)) return 0;
  if (o === "VICTOR_SALARY" || o === "ARTIST_PAYMENT" || o === "MEDIA_INCOME") return 1;
  return ({ MIX_WORK: 2, CLIP_ROW: 3, RF_PAYMENT: 4, RF_BUDGET: 5, PROMOTION: 6 } as Record<string, number>)[o] ?? 99;
}

/** The exact stored amount as a number (numeric columns may arrive as strings); null = not a valid number. */
function amountOf(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}
/** What a linked_session_id marker means (the app's own marker prefixes). */
function markerKind(m: string): "VICTOR_SALARY" | "ARTIST_PAYMENT" | "MEDIA_INCOME" | "SESSION" | "OTHER" {
  if (m.startsWith("victor_salary_")) return "VICTOR_SALARY";
  if (m.startsWith("artist_payment:")) return "ARTIST_PAYMENT";
  if (m.startsWith("media_income:")) return "MEDIA_INCOME";
  return UUID_RE.test(m) ? "SESSION" : "OTHER";
}

export function transactionDraft(src: GatewaySources, id: string): EntityDraft | null {
  const f = ok(src.finance);
  if (!f) return null;
  const t = f.raw.transactions.find((x) => x.id === id);
  if (!t) return null;
  const key = `transaction:${id}`;
  const amount = amountOf(t.amount);
  const typeHe = t.type === "income" ? "הכנסה" : t.type === "expense" ? "הוצאה" : t.type ?? "—";
  const facts: GatewayFact[] = [];
  const rels: GatewayRelationship[] = [];
  const missing: EntityDraft["missing"] = [];
  const drillDown: EntityDraft["drillDown"] = [];

  // ── the row, exactly as stored (FACT) ──
  facts.push(fact("TX_AMOUNT", "סכום ומטבע (כפי שנרשמו — בלי המרה)", { amount, currency: t.currency }, amount === null ? "UNKNOWN" : "FACT", "FINANCE"));
  if (amount === null) missing.push({ fact: "amount", whyNeeded: "the stored amount is not a valid number — the row's money is UNKNOWN" });
  if (!t.currency) missing.push({ fact: "currency", whyNeeded: "no currency is stored on the row (the app reads a blank currency as ₪ — shown here as stored, never assumed)" });
  facts.push(fact("TX_TYPE", "סוג", t.type, t.type ? "FACT" : "UNKNOWN", "FINANCE"));
  facts.push(fact("TX_STATUS", "סטטוס תשלום", { status: t.status, deprecated: !!t.status && (DEPRECATED_PAYMENT_STATUSES as readonly string[]).includes(t.status) }, t.status ? "FACT" : "UNKNOWN", "FINANCE"));
  facts.push(fact("TX_DATE", "תאריך", t.date, t.date ? "FACT" : "UNKNOWN", "FINANCE"));
  facts.push(fact("TX_CATEGORY", "קטגוריה", t.category, "FACT", "FINANCE"));
  facts.push(fact("TX_SCOPE", "שיוך (פרויקט / כללי) ותחום הוצאה", { scope: t.scope, expenseScope: t.expenseScope }, "FACT", "FINANCE"));
  if (t.businessUnit !== undefined) {
    facts.push(fact("TX_BUSINESS_UNIT", "יחידה עסקית (ומקור הקביעה)", { businessUnit: t.businessUnit, source: t.businessUnitSource ?? null }, t.businessUnit ? "FACT" : "UNKNOWN", "FINANCE"));
    if (!t.businessUnit) missing.push({ fact: "business unit", whyNeeded: "the row has no business unit — 'דורש סיווג' (never a default)" });
  }
  facts.push(fact("TX_CREATED_AT", "נוצר", t.createdAt, "FACT", "FINANCE"));

  // ── canonical links (ID) ──
  const projectsById = new Map(f.raw.projects.map((p) => [p.id, p]));
  if (t.projectId) {
    const p = projectsById.get(t.projectId);
    facts.push(fact("TX_PROJECT", "פרויקט (קישור במזהה)", `project:${t.projectId}`, "FACT", "FINANCE"));
    rels.push({ from: `project:${t.projectId}`, relation: "PROJECT_HAS_TRANSACTION", to: key, toLabel: record(`${typeHe} ${t.currency ?? ""}${amount ?? "?"}`), quality: "ID", source: "FINANCE", ...(p ? {} : { note: partner("הפרויקט לא נמצא בקריאת הכספים") }) });
    drillDown.push(drill(`project:${t.projectId}`, p?.name ? `פתח את ${p.name}` : "פתח את הפרויקט"));
  } else facts.push(fact("TX_PROJECT", "פרויקט (קישור במזהה)", null, "FACT", "FINANCE"));
  if (t.showId) {
    const sh = ok(src.state)?.domains.shows.data?.items.find((x) => x.id === t.showId) ?? null;
    facts.push(fact("TX_SHOW", "הופעה ותפקיד הכסף בה", { show: `show:${t.showId}`, moneyRole: t.showMoneyRole ?? null }, "FACT", "FINANCE"));
    rels.push({ from: `show:${t.showId}`, relation: "SHOW_HAS_TRANSACTION", to: key, toLabel: record(`${t.showMoneyRole ?? "—"} · ${t.currency ?? ""}${amount ?? "?"}`), quality: "ID", source: "FINANCE" });
    drillDown.push(drill(`show:${t.showId}`, sh?.name ? `פתח את ${sh.name}` : "פתח את ההופעה"));
  }
  if (t.linkedSessionId) {
    const kind = markerKind(t.linkedSessionId);
    facts.push(fact("TX_LINK_MARKER", "סימון קישור ברשומה (linked session)", { kind, marker: kind === "SESSION" ? `session:${t.linkedSessionId}` : t.linkedSessionId }, "FACT", "FINANCE"));
    if (kind === "SESSION") rels.push({ from: `session:${t.linkedSessionId}`, relation: "SESSION_HAS_TRANSACTION", to: key, toLabel: record(`${t.currency ?? ""}${amount ?? "?"}`), quality: "ID", source: "FINANCE" });
    const period = kind === "VICTOR_SALARY" ? (f.raw.victorSalary ?? []).find((s) => salaryLinkedId(s.workMonth) === t.linkedSessionId)?.workMonth ?? null : null;
    if (period) {
      rels.push({ from: `recurring:VICTOR_SALARY:${period}`, relation: "SALARY_PERIOD_HAS_TRANSACTION", to: key, toLabel: record(`משכורת ${salaryMonthLabel(period)}`), quality: "ID", source: "FINANCE" });
      drillDown.push(drill(`recurring:VICTOR_SALARY:${period}`, `משכורת ${salaryMonthLabel(period)}`));
    }
  }

  // ── ownership: which Redbloods writer keeps this row in step (the Finance route's ONE rule) ──
  const pd = ok(src.projectDetail);
  const ops = ok(src.operations);
  const links: TxOwnerLinks = {
    showId: t.showId ?? null, showMoneyRole: t.showMoneyRole ?? null, linkedSessionId: t.linkedSessionId,
    legacyShowRole: f.raw.shows.some((s) => s.incomeTxId === id) ? "SHOW_PAYMENT" : f.raw.shows.some((s) => s.djTxId === id) ? "DJ_FEE" : f.raw.shows.some((s) => s.artistTxId === id) ? "ARTIST_FEE" : null,
    mixWork: f.raw.engineerWorks.some((w) => w.linkedTransactionId === id),
    rfPayment: f.raw.redFilmsPayments.some((p) => p.linkedTransactionId === id),
    clipRow: !!pd?.clipItems?.rows.some((c) => c.linkedTransactionId === id),
    rfBudget: !!pd?.budgetItems?.rows.some((b) => b.linkedTransactionId === id),
    promotion: !!ops?.promotions?.rows.some((p) => p.linkedTransactionId === id),
  };
  // link sources that were not read completely (unavailable / capped) can hide an owner of a LOWER precedence only
  const unread: Array<[string, number]> = [];
  if (!pd?.clipItems || pd.clipItems.capped) unread.push(["clip planning rows", 3]);
  if (!pd?.budgetItems || pd.budgetItems.capped) unread.push(["Red Films budget lines", 5]);
  if (!ops?.promotions || ops.promotions.capped) unread.push(["social promotions", 6]);
  const owner = ownerFromLinks(links);
  const hidden = unread.filter(([, rank]) => rank < ownerRank(owner));
  if (hidden.length) {
    facts.push(fact("TX_OWNER", "מי מנהל את השורה (בעלות)", owner ? { owner, partial: true } : null, "UNKNOWN", "FINANCE"));
    missing.push({ fact: "ownership", whyNeeded: `link sources not fully read (${hidden.map(([n]) => n).join(", ")}) — whether another screen owns this row is UNKNOWN` });
  } else {
    const ui = ownerUi(owner);
    facts.push(fact("TX_OWNER", "מי מנהל את השורה (בעלות)", ui
      ? { owner: ui.owner, ownerHe: partner(ui.labelHe), changeWhereHe: partner(ui.whereHe), financeEditableFields: ui.allowed, deletableInFinance: false }
      : { owner: null, ownerHe: partner("שורה עצמאית — אף מסך אחר לא מנהל אותה"), financeEditableFields: "ALL", deletableInFinance: true }, "DERIVED", "FINANCE"));
  }

  // ── Records ↔ artist expense share (the ONE rule) + the ledger rows recorded for this row ──
  const artistText = t.projectId ? projectsById.get(t.projectId)?.artist ?? null : null;
  const share = expenseShareOf({ id, type: t.type, amount: t.amount, currency: t.currency, paymentStatus: t.status, businessUnit: t.businessUnit ?? null, category: t.category, expenseScope: t.expenseScope, showId: t.showId ?? null, showMoneyRole: t.showMoneyRole ?? null, projectId: t.projectId }, t.projectId ? { artistText } : null);
  if (share.status !== "NOT_APPLICABLE") {
    facts.push(fact("TX_EXPENSE_SHARE", "חלוקת ההוצאה Records מול האמנים (לפי החוק)", share.status === "DEFINED"
      ? { status: share.status, basis: share.basis, kind: share.kind, active: share.active, amount: share.amount, currency: share.currency, recordsShare: share.recordsAmount, artists: share.artists.map((a) => ({ artist: `label-artist:${a.artistId}`, name: a.name, pct: a.pct, amount: a.amount })), basisHe: partner(share.basisHe) }
      : { status: share.status, amount: share.amount, currency: share.currency, reasonHe: partner(share.reasonHe) }, "DERIVED", "FINANCE"));
    const findings = expenseSharesFromFinanceRaw(f.raw).findings.filter((x) => x.transactionId === id);
    if (findings.length) facts.push(fact("TX_EXPENSE_SHARE_FINDINGS", "אי-התאמות בין השורה ליומן האמן", findings.map((x) => ({ code: x.code, artist: x.artistId ? `label-artist:${x.artistId}` : null, expected: x.expected, recorded: x.recorded, he: partner(x.he) })), "DERIVED", "FINANCE"));
  }
  const ledgerRows = f.raw.ledger.filter((l) => l.sourceExpenseTxId === id || l.sourceTxId === id);
  if (ledgerRows.length) facts.push(fact("TX_ARTIST_LEDGER_ROWS", "שורות ביומן האמן שמקושרות לשורה הזאת (היומן בלי מטבע)", ledgerRows.map((l) => ({ artist: `label-artist:${l.artistId}`, entryType: l.entryType, amount: amountOf(l.amount), link: l.sourceExpenseTxId === id ? "SOURCE_EXPENSE_TX" : "SOURCE_TX" })), "FACT", "LABEL_ARTISTS"));

  // ── text (Owner-only; free text is evidence, never a structured fact) ──
  if (src.audience?.ownerAuthorized === true) {
    const cd = ok(src.clientDetail);
    const text = t.projectId ? pd?.transactionsText?.rows.find((x) => x.id === id) ?? null : cd?.unlinkedTransactionsText?.rows.find((x) => x.id === id) ?? null;
    if (text) facts.push(fact("TX_TEXT", "תיאור, הערות ואמצעי תשלום (טקסט חופשי — ראיה, לא עובדה מובנית)", { description: record(text.description), notes: record(text.notes), paymentMethod: text.paymentMethod, artistText: record(text.artistText), hasReceipt: text.hasReceipt }, "FACT", t.projectId ? "PROJECT_DETAIL" : "CLIENT_DETAIL"));
    else missing.push({ fact: "description / notes", whyNeeded: t.projectId ? "project detail text was not read (or not found) for this row" : "client detail text was not read (or not found) for this row" });
  } else missing.push({ fact: "description / notes", whyNeeded: "the row's free text is Owner-only" });

  return {
    entity: { key, type: "transaction", label: record(`${typeHe} ${t.currency ?? ""}${amount ?? "?"} · ${t.status ?? "—"} · ${heDate(t.date) ?? "—"}`) },
    facts, relationships: rels, missing, drillDown,
    scopeKeys: [key], caseIds: new Set([id]), patternFamily: () => false,
  };
}
