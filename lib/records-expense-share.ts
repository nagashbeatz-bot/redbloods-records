/**
 * RECORDS ↔ ARTIST EXPENSE SHARE — the ONE rule (Owner decision 2026-09-28, task 6). Pure: no I/O, safe everywhere.
 *
 * Two different questions, never merged:
 *   Finance (cash)          what Records REALLY paid — the full amount, one transaction, business_unit RECORDS. Never split,
 *                           never reduced, never an internal transfer / internal revenue (Films producing a Records clip
 *                           is not a sale).
 *   Artist share (ledger)   which part of that real expense enters the settlement with each artist — an artist EXPENSE row
 *                           in the artist ledger (artist_balance_entries), kept in step by lib/writes/artist-expense-share.
 *   business_unit answers "whose money is it"; the share answers "how much of it the artist carries". Independent.
 *
 * The default rule, by who the PROJECT credits (lib/project-classification recordsPartiesOf — exact tokens):
 *   NagashBeatz credited (with anyone)            Records 100 %  — no automatic artist charge
 *   one Records artist (Shalev / Avi)             Records 50 %  · the artist 50 %
 *   two Records artists (Shalev + Avi)            Records 50 %  · each artist 25 %
 *   a Records artist + an EXTERNAL party          UNDEFINED — host vs guest is not recorded (e.g. בלאגן: אבי is a guest of
 *                                                 טל צגאי — a Studio deal). Needs a specific agreement / Owner decision.
 *   no Records artist / no project / not ₪        UNDEFINED — never guessed, never charged to an artist
 * The artists together never carry more than 50 % by default. Any expense type (clip, promotion, photo, distribution,
 * PR, vendor …) follows the same rule — except what is NOT an artist expense at all:
 *   show money (DJ fee, rehearsal, the show's own rows) — the show split already nets them (computeShowSplit);
 *   a payment to an artist (שכר אמן) — that is a payment, not an expense;
 *   mix / master — a Studio capability, 100 % label (Owner decision 2026-09-27; business_unit STUDIO).
 * Only a PAID expense (שולם) is an active share; an expected / cancelled one is not (the ledger row is kept, at 0).
 *
 * Explicit Owner exceptions win over the default (EXPENSE_SHARE_EXCEPTIONS, by transaction id). Existing OWNER_DECISION /
 * HISTORICAL_APPROVED facts are never overwritten by the rule.
 */
import { recordsPartiesOf } from "./project-classification";
import { isExpenseFullyPaidStatus } from "./finance/classify";

export const RECORDS_EXPENSE_SHARE_VERSION = "2026-09-28";
const SHALEV_ID = "8806fe5e-1238-4228-8078-b3db3ccc9b46";
const SHALEV_NAME = "שליו טסמה";

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

// ── the project rule ─────────────────────────────────────────────────────────────────────────────────────────────
export type ProjectSettlementKind = "SINGLE_RECORDS_ARTIST" | "TWO_RECORDS_ARTISTS" | "NAGASHBEATZ";
export type UndefinedReason = "EXTERNAL_PARTY" | "NO_RECORDS_ARTIST" | "NO_ARTIST_CONTEXT" | "NOT_ILS" | "TOO_MANY_ARTISTS";
export const UNDEFINED_HE: Readonly<Record<UndefinedReason, string>> = {
  EXTERNAL_PARTY: "אמן Records לצד גורם חיצוני — לא רשום מי המארח ומי האורח; אין חלוקה אוטומטית (דורש הסכם / החלטת בעלים)",
  NO_RECORDS_ARTIST: "הפרויקט לא מקרדט אמן Records — אין חיוב אוטומטי לאמן (דורש החלטת בעלים)",
  NO_ARTIST_CONTEXT: "ההוצאה לא מקושרת לפרויקט עם אמנים — לא יודעים של איזה אמן היא; אין חיוב אוטומטי (דורש החלטת בעלים)",
  NOT_ILS: "יומן האמן בש\"ח בלבד — הוצאה במטבע אחר לא נזקפת אוטומטית (בלי המרה)",
  TOO_MANY_ARTISTS: "יותר משני אמני Records — אין חוק חלוקה רשום",
};
export type ProjectSettlementRule =
  | { status: "DEFINED"; kind: ProjectSettlementKind; recordsPct: number; artists: Array<{ artistId: string; name: string; pct: number }>; basisHe: string }
  | { status: "UNDEFINED"; reason: UndefinedReason; reasonHe: string; external: string[] };

/** Who carries a Records-artist expense of this project, by its credits (the Owner's rule). */
export function projectSettlementRule(artistText: string | null | undefined): ProjectSettlementRule {
  const p = recordsPartiesOf(artistText);
  const und = (reason: UndefinedReason): ProjectSettlementRule => ({ status: "UNDEFINED", reason, reasonHe: UNDEFINED_HE[reason], external: p.external });
  if (!p.tokens.length) return und("NO_ARTIST_CONTEXT");
  if (p.nagashBeatz) return { status: "DEFINED", kind: "NAGASHBEATZ", recordsPct: 100, artists: [], basisHe: "NagashBeatz בפרויקט — 100% Records, בלי חיוב אוטומטי לאמנים" };
  if (!p.recordsArtists.length) return und("NO_RECORDS_ARTIST");
  if (p.external.length) return und("EXTERNAL_PARTY");
  if (p.recordsArtists.length === 1) {
    const a = p.recordsArtists[0];
    return { status: "DEFINED", kind: "SINGLE_RECORDS_ARTIST", recordsPct: 50, artists: [{ artistId: a.id, name: a.name, pct: 50 }], basisHe: `אמן Records יחיד — 50% Records / 50% ${a.name}` };
  }
  if (p.recordsArtists.length === 2) {
    return { status: "DEFINED", kind: "TWO_RECORDS_ARTISTS", recordsPct: 50, artists: p.recordsArtists.map((a) => ({ artistId: a.id, name: a.name, pct: 25 })), basisHe: `שני אמני Records — 50% Records / 25% ${p.recordsArtists[0].name} / 25% ${p.recordsArtists[1].name}` };
  }
  return und("TOO_MANY_ARTISTS");
}

// ── explicit Owner exceptions (by transaction id) ────────────────────────────────────────────────────────────────
export type ExpenseShareException =
  | { kind: "ARTIST_100"; artistId: string; name: string; reasonHe: string }
  | { kind: "ARTIST_50"; artistId: string; name: string; reasonHe: string }
  | { kind: "RECORDS_100"; reasonHe: string }
  | { kind: "RECORDED_LUMP"; ledgerEntryId: string; reasonHe: string };
const PRINCIPE_LUMP = "14c924ec-277b-42d6-8a74-d0170271a569";
const PRINCIPE_CLIP_TX = [
  "09d3fe39-75d3-470a-9848-225779026b4f", "dbb43e88-3f53-48dd-894e-772069d17bb2", "bbb61684-d76d-4c31-b7f0-5e7c1143d946",
  "8bdaa565-71f8-45f5-a7ed-2190f8fa9f90", "87c05b43-070a-4a5a-b6e6-c52ac1bb5c85", "93efd240-1ef7-400c-a595-5d728708548f",
  "02900aba-74ef-49c1-8ebc-bd0d6ee815f3", "c8691277-ae9d-45c3-9ae2-4f9ce8f0dbdd", "15e86a7e-06f5-4dc4-81b2-37728529abac",
  "3b8d90cf-16ca-4926-a322-bbb45bffd7d1",
];
export const EXPENSE_SHARE_EXCEPTIONS: Readonly<Record<string, ExpenseShareException>> = {
  // ACUM — Shalev's registration: 100 % Shalev (Owner exception)
  "d4f6ca0f-98a6-4d3d-945d-d749fda5c6af": { kind: "ARTIST_100", artistId: SHALEV_ID, name: SHALEV_NAME, reasonHe: "רישום שליו לאקו\"ם — 100% על שליו (חריג בעלים)" },
  // ISSA VYBZ promotion — no project link; the historical alignment (task 3, Owner-approved) recorded Shalev's 50 %
  "8da01d3c-3750-4596-888a-ee2d4faf3335": { kind: "ARTIST_50", artistId: SHALEV_ID, name: SHALEV_NAME, reasonHe: "קידום ISSA VYBZ — 50% שליו (יישור היסטורי מאושר, בלי קישור לפרויקט)" },
  // Principe YouTube promotion 3 × 100 — 100 % Records (Owner exception)
  "71356ad5-a483-4d9d-a667-a9b570c71272": { kind: "RECORDS_100", reasonHe: "קידום יוטיוב פרנציפ — 100% Records (חריג בעלים)" },
  "baef9740-6ec7-4b0a-beed-b28c41e242c9": { kind: "RECORDS_100", reasonHe: "קידום יוטיוב פרנציפ — 100% Records (חריג בעלים)" },
  "fc12a6f8-69e5-4be8-a803-fa530385ecf6": { kind: "RECORDS_100", reasonHe: "קידום יוטיוב פרנציפ — 100% Records (חריג בעלים)" },
  // Principe clip (10 Finance rows, ₪4,955): Shalev's share is the ONE ledger row the Owner recorded (₪2,480, approved
  // 2026-09-27) — never a second, per-row share
  ...Object.fromEntries(PRINCIPE_CLIP_TX.map((id) => [id, { kind: "RECORDED_LUMP" as const, ledgerEntryId: PRINCIPE_LUMP, reasonHe: "קליפ פרנציפ — חלק שליו רשום ברשומה אחת שהבעלים רשם (₪2,480, מאושר)" }])),
};

// ── one transaction ──────────────────────────────────────────────────────────────────────────────────────────────
export interface ShareTx {
  id: string; type: string | null; amount: unknown; currency: string | null; paymentStatus: string | null; businessUnit: string | null;
  category?: string | null; expenseScope?: string | null; showId?: string | null; showMoneyRole?: string | null; projectId?: string | null;
}
export interface ArtistShareLine { artistId: string; name: string; pct: number; amount: number }
export type NotApplicableReason = "NOT_EXPENSE" | "NOT_RECORDS" | "SHOW_MONEY" | "ARTIST_PAYMENT" | "MIX_MASTER";
export const NOT_APPLICABLE_HE: Readonly<Record<NotApplicableReason, string>> = {
  NOT_EXPENSE: "לא הוצאה",
  NOT_RECORDS: "לא כסף של Records",
  SHOW_MONEY: "הוצאת הופעה — נכללת בחלוקת הרווח הנקי של ההופעה",
  ARTIST_PAYMENT: "תשלום לאמן — לא הוצאה",
  MIX_MASTER: "מיקס / מאסטר — 100% על הלייבל (יכולת Studio)",
};
export type ExpenseShare =
  | { status: "NOT_APPLICABLE"; reason: NotApplicableReason; reasonHe: string }
  | { status: "RECORDED_ELSEWHERE"; ledgerEntryId: string; reasonHe: string; amount: number; currency: string }
  | { status: "UNDEFINED"; reason: UndefinedReason; reasonHe: string; amount: number; currency: string }
  | { status: "DEFINED"; basis: "RULE" | "OWNER_EXCEPTION"; kind: ProjectSettlementKind | ExpenseShareException["kind"]; active: boolean; amount: number; currency: string; recordsAmount: number; artists: ArtistShareLine[]; basisHe: string };

const SHOW_CATEGORIES = new Set(["שכר דיג'יי", "חזרה", "הופעה"]);
const MIX_SCOPE = "מיקס / מאסטר";

function split(amount: number, parts: Array<{ artistId: string; name: string; pct: number }>): { artists: ArtistShareLine[]; recordsAmount: number } {
  const artists = parts.map((p) => ({ ...p, amount: r2((amount * p.pct) / 100) }));
  return { artists, recordsAmount: r2(amount - artists.reduce((s, a) => s + a.amount, 0)) };
}

/** The artist share of ONE Finance transaction. `project` = the transaction's project credits (null = no project). */
export function expenseShareOf(tx: ShareTx, project: { artistText: string | null } | null): ExpenseShare {
  const amount = r2(Number(tx.amount) || 0);
  const currency = tx.currency || "₪";
  const na = (reason: NotApplicableReason): ExpenseShare => ({ status: "NOT_APPLICABLE", reason, reasonHe: NOT_APPLICABLE_HE[reason] });
  if (tx.type !== "expense") return na("NOT_EXPENSE");
  const active = isExpenseFullyPaidStatus(tx.paymentStatus);
  const exc = EXPENSE_SHARE_EXCEPTIONS[tx.id];
  if (exc) {
    if (exc.kind === "RECORDED_LUMP") return { status: "RECORDED_ELSEWHERE", ledgerEntryId: exc.ledgerEntryId, reasonHe: exc.reasonHe, amount, currency };
    const parts = exc.kind === "ARTIST_100" ? [{ artistId: exc.artistId, name: exc.name, pct: 100 }] : exc.kind === "ARTIST_50" ? [{ artistId: exc.artistId, name: exc.name, pct: 50 }] : [];
    return { status: "DEFINED", basis: "OWNER_EXCEPTION", kind: exc.kind, active, amount, currency, ...split(amount, parts), basisHe: exc.reasonHe };
  }
  if (tx.businessUnit !== "RECORDS") return na("NOT_RECORDS");
  if (tx.showId || tx.showMoneyRole || tx.expenseScope === "הופעה" || SHOW_CATEGORIES.has(String(tx.category ?? ""))) return na("SHOW_MONEY");
  if (tx.category === "שכר אמן") return na("ARTIST_PAYMENT");
  if (tx.expenseScope === MIX_SCOPE || tx.category === MIX_SCOPE) return na("MIX_MASTER");
  const und = (reason: UndefinedReason): ExpenseShare => ({ status: "UNDEFINED", reason, reasonHe: UNDEFINED_HE[reason], amount, currency });
  if (currency !== "₪") return und("NOT_ILS");
  if (!project) return und("NO_ARTIST_CONTEXT");
  const rule = projectSettlementRule(project.artistText);
  if (rule.status === "UNDEFINED") return und(rule.reason);
  return { status: "DEFINED", basis: "RULE", kind: rule.kind, active, amount, currency, ...split(amount, rule.artists), basisHe: rule.basisHe };
}

/** The artist amounts a share puts in the ledger right now (0 when not active / not defined). */
export function activeArtistAmounts(s: ExpenseShare): Map<string, number> {
  const m = new Map<string, number>();
  if (s.status === "DEFINED") for (const a of s.artists) m.set(a.artistId, s.active ? a.amount : 0);
  return m;
}

// ── the ledger link (no schema change: the note carries the marker) ──────────────────────────────────────────────
/** LEGACY link: share rows written before the DB key (2026-09-28) carry this marker in their note. New rows are linked by
 *  artist_balance_entries.source_expense_tx_id (unique with the artist) — the marker is read for compatibility only. */
export const EXPENSE_SHARE_MARKER = "[חלק הוצאה tx:";
export const expenseShareMarker = (txId: string) => `${EXPENSE_SHARE_MARKER}${txId}]`;
export const INACTIVE_SHARE_PREFIX = "[חלק הוצאה לא פעיל]";
/** A duplicate share row a concurrent sync cancelled (kept at 0) — never the share row, never counted, never revived. */
export const DUPLICATE_SHARE_TAG = "כפילות מקבילה";
export const isDuplicateShareNote = (note: string | null | undefined) => (note ?? "").includes(DUPLICATE_SHARE_TAG);
export function markerTxIdOf(note: string | null | undefined): string | null {
  const m = /\[חלק הוצאה tx:([0-9a-f-]{36})\]/.exec(note ?? "");
  return m ? m[1] : null;
}

// ── reconciliation (Finance ↔ ledger) — read by Finance, the label page and Sunny ────────────────────────────────
export interface ShareLedgerRow { id: string; artistId: string; entryType: string | null; amount: unknown; sourceTxId: string | null; note?: string | null; /** the canonical expense-share key (DB, 2026-09-28) */ sourceExpenseTxId?: string | null }
export type ShareFindingCode = "SHARE_MISSING" | "SHARE_AMOUNT_MISMATCH" | "SHARE_DUPLICATE" | "SHARE_UNDEFINED" | "SHARE_ORPHAN";
export interface ShareFinding { code: ShareFindingCode; transactionId: string | null; artistId: string | null; expected: number | null; recorded: number | null; he: string }
export interface ShareReconciliation {
  findings: ShareFinding[];
  totals: { cashOut: number; recordsShare: number; artistShare: number; undefinedCashOut: number; recordedElsewhere: number };
  byArtist: Record<string, number>;
}

/** Every paid Records expense vs its ledger share rows: missing / wrong amount / duplicate / undefined / orphan. ₪ only. */
export function reconcileExpenseShares(input: { transactions: readonly ShareTx[]; projectArtistText: (projectId: string) => string | null | undefined; ledger: readonly ShareLedgerRow[] }): ShareReconciliation {
  const findings: ShareFinding[] = [];
  const totals = { cashOut: 0, recordsShare: 0, artistShare: 0, undefinedCashOut: 0, recordedElsewhere: 0 };
  const byArtist: Record<string, number> = {};
  const expenseRows = input.ledger.filter((e) => e.entryType === "הוצאות" || e.entryType === "הוצאות צפויות");
  const rowsOf = (txId: string) => expenseRows.filter((e) => (e.sourceExpenseTxId === txId || e.sourceTxId === txId || markerTxIdOf(e.note) === txId) && !isDuplicateShareNote(e.note));
  const txIds = new Set(input.transactions.map((t) => t.id));
  for (const t of input.transactions) {
    const s = expenseShareOf(t, t.projectId ? { artistText: input.projectArtistText(t.projectId) ?? null } : null);
    if (s.status === "NOT_APPLICABLE") continue;
    const paid = isExpenseFullyPaidStatus(t.paymentStatus);
    if (paid && (s.currency ?? "₪") === "₪") totals.cashOut = r2(totals.cashOut + (s.status === "DEFINED" || s.status === "UNDEFINED" || s.status === "RECORDED_ELSEWHERE" ? s.amount : 0));
    if (s.status === "RECORDED_ELSEWHERE") { if (paid) totals.recordedElsewhere = r2(totals.recordedElsewhere + s.amount); continue; }
    if (s.status === "UNDEFINED") {
      if (paid) { totals.undefinedCashOut = r2(totals.undefinedCashOut + s.amount); findings.push({ code: "SHARE_UNDEFINED", transactionId: t.id, artistId: null, expected: null, recorded: null, he: s.reasonHe }); }
      continue;
    }
    const want = activeArtistAmounts(s);
    if (paid) { totals.recordsShare = r2(totals.recordsShare + s.recordsAmount); }
    const rows = rowsOf(t.id);
    for (const [artistId, amount] of want) {
      const mine = rows.filter((r) => r.artistId === artistId);
      const recorded = r2(mine.filter((r) => r.entryType === "הוצאות").reduce((x, r) => x + (Number(r.amount) || 0), 0));
      if (paid) { totals.artistShare = r2(totals.artistShare + amount); byArtist[artistId] = r2((byArtist[artistId] ?? 0) + amount); }
      if (mine.length > 1) findings.push({ code: "SHARE_DUPLICATE", transactionId: t.id, artistId, expected: amount, recorded, he: `לאותה הוצאה יש ${mine.length} רשומות חלק-אמן` });
      else if (!mine.length && amount > 0) findings.push({ code: "SHARE_MISSING", transactionId: t.id, artistId, expected: amount, recorded: null, he: `חלק האמן (₪${amount}) לא רשום ביומן האמן` });
      else if (mine.length && recorded !== amount) findings.push({ code: "SHARE_AMOUNT_MISMATCH", transactionId: t.id, artistId, expected: amount, recorded, he: `ביומן רשום ₪${recorded}, לפי החוק ₪${amount}` });
    }
    for (const r of rows) if (!want.has(r.artistId) && r.entryType === "הוצאות" && (Number(r.amount) || 0) !== 0) findings.push({ code: "SHARE_ORPHAN", transactionId: t.id, artistId: r.artistId, expected: 0, recorded: Number(r.amount) || 0, he: "רשומת חלק-אמן לאמן שלא חל עליו החוק" });
  }
  // a marker row whose transaction is gone / not an expense any more
  for (const r of expenseRows) { const id = r.sourceExpenseTxId ?? markerTxIdOf(r.note); if (id && !txIds.has(id) && (Number(r.amount) || 0) !== 0) findings.push({ code: "SHARE_ORPHAN", transactionId: id, artistId: r.artistId, expected: 0, recorded: Number(r.amount) || 0, he: "רשומת חלק-אמן שההוצאה שלה לא קיימת" }); }
  return { findings, totals, byArtist };
}

// ── INCOME (Owner decision 2026-09-28, final hardening) ──────────────────────────────────────────────────────────
// Finance records the FULL income Records received (RECORDS). The artist's part is an ENTITLEMENT in the ledger:
//   distribution / streaming (through a distributor): by the credits — one Records artist 50 / 50, Shalev + Avi
//     50 / 25 / 25, NagashBeatz credited (or NagashBeatz's own income) 100 % Records, a Records artist next to an
//     external party UNDEFINED;
//   YouTube income: 100 % Records — no artist entitlement (also for a Shalev / Avi clip);
//   ACUM income: 100 % Records — no artist entitlement;
//   show income: never here — the show's own net split (computeShowSplit).
export type RecordsIncomeKind = "DISTRIBUTION" | "YOUTUBE" | "ACUM";
/** The income kind of a media / Finance income source text (exact words; anything else = distribution / streaming). */
export function incomeKindOfSource(source: string | null | undefined): RecordsIncomeKind {
  const s = String(source ?? "");
  if (/youtube|יוטיוב|יו טיוב/i.test(s)) return "YOUTUBE";
  if (/acum|אקו"?ם|אקום/i.test(s)) return "ACUM";
  return "DISTRIBUTION";
}
export type IncomeShare =
  | { status: "DEFINED"; kind: RecordsIncomeKind; recordsPct: number; artists: Array<{ artistId: string; name: string; pct: number }>; basisHe: string }
  | { status: "UNDEFINED"; kind: RecordsIncomeKind; reason: UndefinedReason; reasonHe: string };
/** Who is entitled to a Records income, by its kind and the credits (a project's artist text or the artist's own name). */
export function incomeShareOf(kind: RecordsIncomeKind, artistText: string | null | undefined): IncomeShare {
  if (kind === "YOUTUBE") return { status: "DEFINED", kind, recordsPct: 100, artists: [], basisHe: "הכנסת YouTube — 100% Records, בלי זכאות לאמן" };
  if (kind === "ACUM") return { status: "DEFINED", kind, recordsPct: 100, artists: [], basisHe: "הכנסת אקו\"ם — 100% Records, בלי זכאות לאמן" };
  const r = projectSettlementRule(artistText);
  if (r.status === "UNDEFINED") return { status: "UNDEFINED", kind, reason: r.reason, reasonHe: r.reasonHe };
  return { status: "DEFINED", kind, recordsPct: r.recordsPct, artists: r.artists, basisHe: r.kind === "NAGASHBEATZ" ? "הכנסת הפצה עם NagashBeatz — 100% Records" : r.kind === "TWO_RECORDS_ARTISTS" ? "הכנסת הפצה — 50% Records / 25% לכל אמן" : "הכנסת הפצה — 50% Records / 50% האמן" };
}
/** The Records (label) part of a media income record by the rule — the RPC stores 50 / 50 for every source (history). */
export function mediaLabelShareByRule(source: string | null | undefined, artistName: string | null | undefined, gross: number): number | null {
  const s = incomeShareOf(incomeKindOfSource(source), artistName);
  return s.status === "DEFINED" ? Math.round(((gross * s.recordsPct) / 100 + Number.EPSILON) * 100) / 100 : null;
}
