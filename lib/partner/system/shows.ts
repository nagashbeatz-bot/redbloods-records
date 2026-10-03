/**
 * Sunny System Awareness — SHOWS + DJ DEEP CONTRACT (a live show as Redbloods actually implements it).
 *
 * Produced by the Shows + DJ Deep Brain discovery (2026-09-25): every store / route / UI / portal / push / finance /
 * ledger / calendar / task path touching shows and DJs, the live production schema (columns, checks, FKs, indexes)
 * and read-only production counts. Pure data; served through system_awareness mode show_model. Semantic only — the
 * schema pin, route patterns and reviewed files below are internal to the coverage test and never served.
 */
import type { ApprovalClass, Enforcement, Who } from "./project-actions";

export const SHOWS_BASELINE_VERSION = "2026.09.27-shows-3";

/** Live production columns (information_schema, 2026-09-25) — internal, pinned by the test. */
export const SHOW_SCHEMA_COLUMNS = ["id", "name", "artist", "date", "start_time", "location", "contact_person", "phone", "status", "payment_status", "show_price", "dj_fee", "advance_payment", "notes", "created_at", "updated_at", "artist_client_id", "booker_client_id", "booker_name", "calendar_event_id", "dj_client_id", "dj_name", "linked_income_transaction_id", "linked_dj_expense_transaction_id", "artist_fee", "linked_artist_expense_transaction_id", "dj_confirmation_status", "dj_confirmed_at", "currency", "deal_type"] as const;

export type FieldClass = "CANONICAL" | "DERIVED" | "DISPLAY_ONLY" | "LEGACY" | "AMBIGUOUS" | "POSSIBLE_BUG" | "CONFLICT";
export interface ShowField { field: string; classification: FieldClass; meaning: string; validation: string; writers: string; readers: string; sideEffects: string; history: string; sunnyReads: string }
const W = "Owner (shows hub form / quick pickers / close-show dialog; legacy drawer)";
const F = (field: string, classification: FieldClass, meaning: string, validation: string, o: Partial<ShowField> = {}): ShowField =>
  ({ field, classification, meaning, validation, writers: W, readers: "shows hub, portals, COO, label page, Partner", sideEffects: "—", history: "no change history (updated_at only)", sunnyReads: "show_view", ...o });

export const SHOW_FIELDS: readonly ShowField[] = [
  F("id", "CANONICAL", "Show identity.", "generated", { history: "—" }),
  F("name", "CANONICAL", "Show name (a quote gets 'הצעת מחיר — <contact>' until confirmed).", "required, trimmed", { sideEffects: "calendar title; transaction descriptions (stale until a money field changes); artist / DJ push fingerprint" }),
  F("artist", "AMBIGUOUS", "Artist display text copied from the artist client (collaborations as several names). It — not the artist id — decides show → ledger eligibility.", "none", { sideEffects: "finance artist text, ledger artist resolution (single exact roster name = TEXT_MATCH identity; a collaboration = AMBIGUOUS, never attributed; shows store no label-artist id), artist-push eligibility (Shalev token)" }),
  F("artist_client_id", "CANONICAL", "The artist's CLIENT record (not the label roster).", "FK to clients, set null", { readers: "hub, portals (Shalev / Avi summaries by client), label page" }),
  F("booker_client_id", "CANONICAL", "The booker's client record.", "FK to clients, set null"),
  F("booker_name", "CANONICAL", "Booker name text (also the income transaction's party).", "none"),
  F("date", "CANONICAL", "Show date.", "date or null", { sideEffects: "calendar event, finance dates, ledger entry date, artist-push fingerprint; a date change does NOT reset the DJ confirmation" }),
  F("start_time", "CANONICAL", "Start time text (calendar defaults to 20:00, 2 hours).", "none", { sideEffects: "calendar, push fingerprint" }),
  F("location", "CANONICAL", "Venue / place.", "none", { sideEffects: "calendar, push fingerprint" }),
  F("contact_person", "CANONICAL", "Venue / booker contact name.", "none", { sunnyReads: "show_view (name)" }),
  F("phone", "CANONICAL", "Contact phone.", "none", { sunnyReads: "show_view (hasPhone only)" }),
  F("status", "CANONICAL", "Lifecycle: ליד חדש / ממתין לתשובה / צריך פולואפ (pipeline) · נסגר / אושרה (confirmed upcoming) · בוצע (done) · בוטל (cancelled).", "not validated server-side; DB default ליד חדש", { sideEffects: "confirmed → finance rows; back to pipeline → refused (zero writes) while Finance holds a received payment (HAS_PAYMENTS) or a DJ / artist fee row is שולם (HAS_PAID_FEES), otherwise the still-expected balance / unpaid fee rows are HARD-deleted; בוטל → rows cancelled, open tasks cancelled, expected ledger removed; בוצע via the close dialog → ledger income (+ payment)" }),
  F("payment_status", "DERIVED", "CLIENT payment, derived from Finance (D5): שולם when received ≥ agreed, מקדמה when partly received; לא שולם / צפוי / בוטל otherwise. Choosing שולם = INTENT: the client paid the whole REMAINING balance (a payment row for it), only when the save moves it from a stored non-שולם value. A save never writes it from the form except a no-money label (לא שולם / צפוי) while Finance holds no payment; undoing a payment is an explicit Finance correction (A1, Owner canon 2026-09-27). (legacy חלקי shown as מקדמה)", "derived by the sync; DB default לא שולם", { sideEffects: "income row received vs expected ONLY (A1: never drives the DJ / artist fee rows — client paid ≠ DJ paid ≠ artist paid)" }),
  F("show_price", "CANONICAL", "Gross (agreed) show price, in the show's currency.", "number, default 0", { sideEffects: "expected balance row (price − received), split" }),
  F("currency", "CANONICAL", "The show's currency (₪ / $ / €, DB check, default ₪ — every row before 2026-09-27 was ₪). Price, DJ fee and every Finance row of the show carry it; never converted, never added across currencies. Refused once money was received.", "DB check ₪ / $ / €", { sideEffects: "its Finance rows' currency; a non-₪ show is not synced into the (currency-less) artist ledger" }),
  F("deal_type", "CANONICAL", "Deal type (Owner decision 2026-09-27) — NOT a payment status: PAID = the normal finance flow; UNPAID_COLLAB = 'שת״פ ללא תשלום', operationally a completely normal show (artist, portal, calendar, notifications, statuses, DJ confirmation, closing) with ZERO automatic finance activity: no price, expected income, receivable, payment, DJ / artist / rehearsal row, artist ledger entry or 50 / 50 split. Its payment_status is simply not relevant (never 'שת״פ'). It counts as a show everywhere; never as money.", "DB check PAID / UNPAID_COLLAB, NOT NULL, default PAID (migration 2026-09-27; every row before it is PAID)", { writers: "Owner (the 'סוג עסקה' choice in the new-show form / edit form; Sunny CREATE_SHOW dealType + SET_SHOW_DEAL_TYPE) through the shared show writer", readers: "shows hub (badge 'שת״פ', '—' balance, money KPIs exclude it), label page + recoup, DJ portal, calendar description, COO, finance brain, show_view", sideEffects: "UNPAID_COLLAB: the finance sync writes nothing, a payment / fee-paid / money close / rehearsal cost is refused; PAID → UNPAID_COLLAB refused while real money exists (a client payment, a paid fee, a realized ledger entry, a rehearsal expense, any other show row) — otherwise its still-expected rows are removed like a revert to a lead; UNPAID_COLLAB → PAID needs a price and runs the normal flow", sunnyReads: "show_view identity.dealType + money.dealType / moneyApplies; show_portfolio dealType" }),
  F("dj_fee", "CANONICAL", "DJ fee — defaults to 500 at creation even when no DJ is chosen.", "number, default 500 (a bad PATCH value becomes NaN)", { sideEffects: "DJ expense row (created from the fee even without a DJ), split" }),
  F("advance_payment", "DERIVED", "D5: a MIRROR of the money received in Finance (Σ SHOW_PAYMENT rows) — written by the sync, never typed in (a typed advance becomes a payment row).", "number, default 0", { sideEffects: "none — read by the UI 'remaining' and the COO", readers: "hub UI, COO evidence" }),
  F("artist_fee", "LEGACY", "Stored artist fee — NEVER read by any calculation (the split computes it); 0 on every production show.", "number, default 0", { readers: "nobody" }),
  F("notes", "CANONICAL", "Free text; the close dialog appends a 'סגירת הופעה <date>: …' line.", "none", { sunnyReads: "show_view (evidence)" }),
  F("calendar_event_id", "CANONICAL", "The show's Google Calendar event (canonical calendar link).", "text or null", { sideEffects: "event title 'הופעה: <name> - <artist>'; the description shows the price / DJ fee in the SHOW's currency (fixed 2026-09-27, was always ₪); updated when name / artist / date / time / place / booker / contact / phone / price / DJ fee change; removed only by the hub's cancel / delete", sunnyReads: "show_view (hasCalendarEvent) + calendar" }),
  F("dj_client_id", "CANONICAL", "The DJ's client record (any crew client — only CLEANTONE has confirmation / portal / push).", "FK to clients, set null", { sideEffects: "becoming CLEANTONE sets confirmation ממתין לאישור (null when done / cancelled); changing away clears it" }),
  F("dj_name", "AMBIGUOUS", "DJ display text — set with the DJ picker, but the close dialog can overwrite it as free text without changing the DJ id (the legacy drawer never sends the id).", "none", { sideEffects: "DJ transaction party text" }),
  F("dj_confirmation_status", "CANONICAL", "CLEANTONE's confirmation: ממתין לאישור / אושר / null (outside the confirmation system).", "DB check", { writers: "the show store (on DJ change) + CLEANTONE's confirm / unconfirm (atomic conditional update)", sideEffects: "confirm pushes the Owner" }),
  F("dj_confirmed_at", "CANONICAL", "When CLEANTONE confirmed.", "timestamp or null", { writers: "confirm / unconfirm / DJ change", history: "last confirmation only" }),
  F("linked_income_transaction_id", "CANONICAL", "The show's income transaction.", "FK to transactions, set null", { writers: "finance sync only" }),
  F("linked_dj_expense_transaction_id", "CANONICAL", "The DJ-fee expense transaction.", "FK to transactions, set null", { writers: "finance sync only" }),
  F("linked_artist_expense_transaction_id", "CANONICAL", "LEGACY since the net settlement model (2026-09-28): the artist-fee expense transaction of a show booked before it (no new one is created). A legacy unpaid row is cancelled with a cancelled show; a legacy expected ledger row keyed by it is ADOPTED by the entitlement sync (source_show_id set), never duplicated.", "FK to transactions, set null", { writers: "finance sync only (legacy)" }),
  F("created_at", "CANONICAL", "Created.", "default now", { history: "creation only" }),
  F("updated_at", "CANONICAL", "Last change (any field, incl. DJ confirm).", "default now", { history: "last change only" }),
];

export const SHOW_VOCABULARIES = {
  statuses: ["ליד חדש", "ממתין לתשובה", "צריך פולואפ", "נסגר", "אושרה", "בוצע", "בוטל"],
  paymentStatuses: ["שולם", "לא שולם", "צפוי", "מקדמה", "בוטל"],
  djConfirmation: ["ממתין לאישור", "אושר"],
  /** NOT a payment status — pinned to lib/shows-types SHOW_DEAL_TYPES by the test. */
  dealTypes: ["PAID", "UNPAID_COLLAB"],
  groups: { pipeline: ["ליד חדש", "ממתין לתשובה", "צריך פולואפ"], confirmedFinance: ["נסגר", "אושרה", "בוצע"], upcomingConfirmed: ["אושרה", "נסגר"], portalVisible: ["אושרה", "נסגר", "בוצע"], done: ["בוצע"], cancelled: ["בוטל"] },
  formStatuses: { fullForm: ["ממתין לתשובה", "אושרה", "בוצע", "בוטל"], quoteForm: ["ליד חדש", "ממתין לתשובה", "צריך פולואפ"] },
  rehearsalOperational: ["מתוכנן", "בוצע", "בוטל", "התקיים"], // התקיים = legacy only (the pre-D6 page-load auto-mark, retired in A3 2026-09-27) — see rehearsalCounted
} as const;

/** Where consumers disagree about which shows count (reported, never normalized). */
export const SHOW_STATUS_CONSUMERS = [
  { consumer: "shows hub KPIs", counts: "confirmed, not cancelled, not received" },
  { consumer: "COO", counts: "upcoming = אושרה / נסגר with a future date; done-unpaid = בוצע, price > 0, not שולם" },
  { consumer: "finance sync", counts: "rows only for נסגר / אושרה / בוצע" },
  { consumer: "label page + recoup", counts: "every show not cancelled — INCLUDING pipeline leads" },
  { consumer: "dashboard upcoming", counts: "future date, not cancelled — INCLUDING leads" },
  { consumer: "artist portals", counts: "אושרה / נסגר / בוצע" },
  { consumer: "DJ portal", counts: "CLEANTONE's shows not cancelled; 'upcoming' = not בוצע (no date / status filter — leads and past unfinished shows can be confirmed)" },
  { consumer: "artist / DJ push", counts: "אושרה / נסגר with date ≥ today" },
  { consumer: "every money consumer (hub KPIs / unpaid tab / label page / recoup / COO / finance brain / show_view signals)", counts: "never an UNPAID_COLLAB show (deal type) — it still counts in every SHOW count (סה״כ הופעות, upcoming, portals, calendar)" },
] as const;

export const LIFECYCLE = [
  { transition: "CREATE", entry: "hub 'הופעה חדשה' (full form) or 'הצעת מחיר' (quote) · legacy form", writes: "show (DJ confirmation computed)", finance: "rows only when created confirmed", ledger: "agreement artist (שליו / אבי): ONE expected entitlement (הכנסות צפויות, source_show_id) when confirmed + share > 0 — never a Finance expense (net model 2026-09-28)", calendar: "event when 'add to calendar' (default on for the full form)", push: "none", tasks: "no-DJ task 'לסגור דיג׳יי להופעה' (due tomorrow) when saved without a DJ; quote → 'פולואפ להצעת מחיר' task", idempotent: "—" },
  { transition: "QUOTE_SENT", entry: "quote save", writes: "task", finance: "—", ledger: "—", calendar: "—", push: "none", tasks: "follow-up task (no due date), refreshed while open", idempotent: "per show + marker" },
  { transition: "CONFIRM (→ אושרה / נסגר)", entry: "status picker / form ('הצעה אושרה' switches to the full form)", writes: "status (+ payment צפוי when future and לא שולם)", finance: "income / DJ fee rows created or re-activated (no artist-fee row — net model)", ledger: "the expected entitlement created / re-activated", calendar: "event synced if it exists", push: "none (manual 'שלח')", tasks: "quote task → בוצע", idempotent: "linked ids" },
  { transition: "EDIT", entry: "form / pickers", writes: "fields", finance: "A1: the client payment_status in the form is intent only (שולם from a non-שולם = record the remainder once; a no-money label only while nothing was received); fee rows never follow it; re-synced only when price / DJ fee / DJ name / artist fee / status / date / payment / close change — name / artist / booker alone leave descriptions stale", ledger: "expected row re-derived (frozen once received)", calendar: "event updated on sync fields", push: "artist / DJ button reopens only when name / date / time / place change", tasks: "—", idempotent: "yes" },
  { transition: "BACK_TO_PIPELINE", entry: "status picker", writes: "status", finance: "refused with zero writes while a payment was received (D5, HAS_PAYMENTS) or a DJ / artist fee row is שולם (HAS_PAID_FEES — money that went out is never deleted; the Owner corrects it in Finance first); otherwise the expected-balance / unpaid DJ / unpaid artist rows are HARD-DELETED", ledger: "expected row removed (received kept)", calendar: "—", push: "—", tasks: "—", idempotent: "yes" },
  { transition: "CLOSE (→ בוצע via dialog)", entry: "choosing בוצע or שולם opens the close-show dialog", writes: "status בוצע, client payment, DJ paid, DJ name, notes line (Phase 1, 2026-10-03: there is NO 'artist paid' — the dialog has two ticks, client + DJ)", finance: "rows re-synced then the two statuses: income received = the remainder recorded once; DJ paid → the DJ fee row שולם; a flag left false changes nothing (A1: an already-paid fee is never downgraded). The artist is never paid here", ledger: "INCOME row (the ENTITLEMENT, realized) for the agreement artist; dated the show date; NEVER a payment / payout (the payout is a separate payment in the artist's balance); retry-safe (502 on failure)", calendar: "—", push: "closing itself sends NO payment push; only the 'שולם ל-DJ' tick (DJ_FEE → שולם) can push CLEANTONE once (P_DJ_PAYMENT_PAID) and then confirm to the Owner after delivery", tasks: "—", idempotent: "per show + artist (entitlement); the DJ push once per payment" },
  { transition: "REOPEN", entry: "status picker", writes: "status", finance: "cancelled rows re-activated from the stored ids; to pipeline → deleted", ledger: "realized income is never demoted", calendar: "—", push: "—", tasks: "—", idempotent: "yes" },
  { transition: "CANCEL (→ בוטל)", entry: "'בטל הופעה' / status", writes: "status", finance: "rows set to בוטל (kept)", ledger: "expected row removed; realized income + payments KEPT", calendar: "event removed only via the hub cancel button", push: "—", tasks: "open show tasks → בוטל; quote task → בוטל", idempotent: "yes" },
  { transition: "DELETE", entry: "hub trash (legacy drawer)", writes: "show deleted", finance: "still-expected rows hard-deleted (by id + the show_id link; rehearsal expenses, SHOW_PAYMENT rows and any שולם / התקבל row are never deleted)", ledger: "expected removed; realized kept (source link cleared)", calendar: "hub (server-side, after the refusal checks) removes the event; legacy drawer does not", push: "—", tasks: "hub HARD-deletes all show tasks", idempotent: "refused by the server before any write while rehearsals exist, a payment was received (HAS_PAYMENTS) or a DJ / artist fee row is שולם (HAS_PAID_FEES); the hub now calls DELETE ?complete=1 (the same server writer as Sunny's DELETE_SHOW), so every refusal is checked before the calendar event or any task is touched — a refused delete changes nothing" },
  { transition: "DJ_CONFIRM / UNCONFIRM", entry: "DJ portal (CLEANTONE or Owner preview)", writes: "confirmation + time (atomic, only for CLEANTONE's shows)", finance: "—", ledger: "—", calendar: "—", push: "confirm → Owner", tasks: "—", idempotent: "already-confirmed returns without a second push" },
  { transition: "DEAL_TYPE (PAID ↔ UNPAID_COLLAB)", entry: "the 'סוג עסקה' choice in the edit form / Sunny SET_SHOW_DEAL_TYPE", writes: "deal_type (+ price / DJ / artist fee zeroed for a collaboration; the price for PAID)", finance: "→ UNPAID_COLLAB: refused with zero writes while real money exists (client payment, paid fee, realized artist ledger entry, rehearsal expense, any other show row); otherwise the still-expected rows are removed by clearShowFinance (the revert-to-lead removal). → PAID: needs a price; the normal sync runs for the show's state (a done show then closes through the close dialog)", ledger: "a realized entry blocks the switch to a collaboration", calendar: "the event description follows (price line ↔ 'סוג עסקה: שת״פ ללא תשלום')", push: "none", tasks: "—", idempotent: "yes" },
] as const;

export const DJ_MODEL = {
  identity: "the DJ is a CLIENT record (usually type איש צוות) chosen in the form; CLEANTONE = the app's fixed client id; he is TEAM (the label's DJ), not a label artist — his former label-artist row was removed 2026-09-27 (Owner decision), nothing about his DJ shows changed",
  default: "NO default DJ anywhere — never preselected; a PAID show saved without a DJ creates a 'close a DJ' task (the new-show form); an unpaid collaboration (deal type UNPAID_COLLAB) does not — it needs no DJ by default, and an explicitly chosen DJ is handled as for any show (Owner decision 2026-09-27)",
  otherDjs: "any crew client can be the DJ; only CLEANTONE has confirmation, a portal and push",
  confirmation: "becoming CLEANTONE → ממתין לאישור (null if done / cancelled); changing away → null; NOT reset by date / time / place change or cancellation",
  fee: "dj_fee (default 500) → a DJ expense row, created even with no DJ chosen; DJ paid state = that row's status — set only explicitly (close flag / MARK_SHOW_FEE_PAID / Finance), never from the client payment (A1). A REAL DJ_FEE → שולם transition (the close dialog, MARK_SHOW_FEE_PAID DJ, or a Finance edit) pushes DJ CLEANTONE once per payment and, only after that push was delivered, confirms to the Owner (P_DJ_PAYMENT_PAID); a push failure never touches the money",
  portal: "CLEANTONE sees his non-cancelled shows with name / artist / date / time / place / DJ fee (with currency) / HIS OWN DJ-fee payment status / confirmation; can confirm / unconfirm; 'upcoming' has no date or status filter",
  portalBug: "FIXED (A1, 2026-09-27): the DJ portal's payment pill shows HIS OWN DJ_FEE row status (never the client's payment); djFee carries its currency",
  ownerKnowledge: "Owner: CLEANTONE is the label DJ and plays MOST label shows — a frequency, never an assignment rule",
  hardcoded: ["CLEANTONE client id (DJ matching, confirmation, notify, portal)", "the cleantone login role (account email)"],
} as const;

export const MONEY_MODEL = {
  currency: "each show has ONE currency (shows.currency ₪ / $ / €); its Finance rows carry it; nothing is converted or added across currencies; a payment in another currency is refused; a non-₪ show is not synced into the currency-less artist ledger (flagged for the Owner)",
  split: "Owner agreement (2026-09-27, the agreement rule layer — ONLY שליו טסמה / אבי מולה): gross = price; net = max(0, price − DJ fee − counted rehearsal costs) (the recorded direct show expenses); artist fee = net / 2; label profit = net − artist fee — 50 / 50 of the NET, never of the gross. Any other artist or a collaboration text: NOT_DEFINED — no artist fee row is created or re-priced (an existing one is left untouched and reported), nothing is realized into the ledger. No rounding (x.5 possible). The stored artist fee column is never used; there is no override.",
  rehearsalCounted: "D6 (Owner decision 2026-09-27): a show rehearsal cost counts only when the rehearsal is בוצע (whatever its payment state); מתוכנן (even if paid) and בוטל never count; a legacy התקיים (written by the old page-load auto-mark, retired entirely in A3 2026-09-27 — nothing writes it any more) keeps the pre-D6 rule — counts only if paid — until the Owner confirms בוצע / בוטל",
  advance: "D5 (Owner decision, migration 75bf144e… applied 2026-09-27): money received = SHOW_PAYMENT income rows linked by transactions.show_id (status התקבל / שולם). received = Σ payments; remaining = max(0, agreed − received) held by ONE SHOW_BALANCE_EXPECTED row (צפוי; 0 / בוטל when nothing remains); credit = received − agreed stays visible. Deposit / partial / full / overpayment = RECORD_SHOW_PAYMENT (the shared show-payments writer). Marking שולם / closing with 'received' records the REMAINDER once — never the full price again (no fake revenue). Payments are never deleted, re-priced or cancelled by a sync; a show with payments is never deleted or reverted to a lead. A1 (Owner canon 2026-09-27): received money comes ONLY from a real payment event (RECORD_SHOW_PAYMENT, the שולם intent, close 'received') — a price rise on a paid show never invents income, and there is no implicit undo (the pre-A1 'שולם click undo' branch was removed; reversal = an explicit Finance correction). Historical: the 6 legacy fully-paid income rows became SHOW_PAYMENT (known money); no deposit was invented.",
  dealType: "Owner decision 2026-09-27: deal_type UNPAID_COLLAB ('שת״פ ללא תשלום') = 0 automatic income + 0 automatic expense. syncShowFinance writes nothing for it; RECORD_SHOW_PAYMENT / MARK_SHOW_FEE_PAID / a money close / a rehearsal cost are refused; no split, no ledger. A real exceptional expense (DJ / rehearsal / travel) is recorded explicitly in Finance, never automated. It is a DEAL TYPE, never a payment status (payment_status keeps its neutral default and is not read)",
  showMoneyRule: "showMoneyOf — the one rule shared by the sync, the payment writer, the Shows hub and show_view",
  listMoney: "GET /api/shows attaches received / remaining / credit per show from Finance (one read, the same rule) — the Shows hub never trusts the advance mirror for money",
  rows: [
    { row: "SHOW_PAYMENT", category: "הופעה", scope: "הופעה", when: "money received (RECORD_SHOW_PAYMENT / שולם / close 'received')", status: "התקבל", amount: "the amount received", party: "booker name, else artist, else 'לקוח'" },
    { row: "SHOW_BALANCE_EXPECTED", category: "הופעה", scope: "הופעה", when: "confirmed + price > 0", status: "צפוי while something remains; בוטל (0) when paid in full or the show is cancelled", amount: "agreed − received", party: "booker name, else artist, else 'לקוח'" },
    { row: "DJ_FEE", category: "שכר דיג'יי", scope: "הופעה", when: "confirmed + DJ fee > 0 (even with no DJ)", status: "created צפוי; שולם only explicitly (close flag / MARK_SHOW_FEE_PAID / Finance edit) — never from the client payment; → בוטל when cancelled / fee 0 unless שולם; בוטל → צפוי when the fee stands again", amount: "DJ fee (re-priced only while not שולם)", party: "DJ name" },
    { row: "ARTIST_FEE (LEGACY)", category: "שכר אמן", scope: "הופעה", when: "NEVER created since the net settlement model (Owner 2026-09-28) — the show share is an ENTITLEMENT in the artist ledger. A legacy row: unpaid → בוטל with a cancelled show (never revived, never re-priced); שולם stays. The approved alignment set the 3 legacy expected rows בוטל with an audit note.", status: "legacy only", amount: "legacy only", party: "legacy only" },
    { row: "ARTIST_PAYMENT (net model)", category: "שכר אמן", scope: "הופעה / כללי", when: "only a REAL payment to the artist, written ONLY from the artist's balance: 'הוסף תשלום' in the artist balance or Sunny ADD_LEDGER_ENTRY (the one artist-payment writer, recordArtistPayment). Phase 1 (Owner decision 2026-10-03): the close dialog and MARK_SHOW_FEE_PAID NEVER pay the artist (ARTIST_PAYOUT_VIA_BALANCE)", status: "שולם, ₪, business_unit RECORDS (RULE); NOT show-linked in Finance (show_id null; notes artist_payment_show:<id>); + ONE ledger payment (תשלומים, source_tx_id + source_show_id); idempotent per payment key (a legacy show:<id> key is only read); a similar payment → DUPLICATE unless the Owner confirms; a ledger failure → PARTIAL, the Finance row stays (no automatic delete)", amount: "the artist's share (showAgreementSplit)", party: "the roster artist (by id)" },
    { row: "REHEARSAL", category: "חזרה", scope: "הופעה", when: "a rehearsal session with cost > 0", status: "session payment (שולם / לא שולם)", amount: "cost", party: "artist" },
  ],
  rowRules: "task 4 (2026-09-28): every NEW show row gets transactions.business_unit by the ONE unit rule — RECORDS for a show of a Records roster artist (exact single name on label_artists), NULL (דורש סיווג) for a collab / other artist, never a guess; the sync never re-derives a unit. Every row carries transactions.show_id + show_money_role (the canonical link; the 'show_id:<id>' note is kept for older readers); one expected-balance row per show (DB unique index); re-syncs patch, never duplicate; a payment row is never deleted / re-priced by a sync; A1: the DJ / artist rows are independent obligations — their status never follows the client payment, and a שולם fee row is never re-priced / re-dated / re-currencied (a mismatch is reported as a finance warning + logged, never overwritten)",
  ledger: "see LEDGER_SYNC — the artist ledger is separate money (no currency)",
} as const;

export const LEDGER_SYNC = {
  booking: { artists: "the agreement artists only (שליו / אבי, the agreement layer, by roster id); any other artist / a collaboration → NOT_DEFINED (no entitlement)", match: "agreementArtistOf (roster id); a collaboration text is never attributed", trigger: "every finance sync of a confirmed ₪ show (the entitlement sync, syncShowEntitlement)", writes: "ONE EXPECTED entitlement (הכנסות צפויות) = the split artist share, dated the show date, 'הופעה - <name>', keyed by source_show_id + artist (unique); re-priced while expected; a legacy row keyed by the old artist-fee transaction is adopted", manualInteraction: "frozen once realized (הכנסות — close or manual)", removal: "NEVER deleted: cancel / back-to-pipeline / delete / deal switch / no agreement / a non-₪ show → the expected row's note is marked '[זכאות לא פעילה] …' (readers exclude it); re-confirming re-activates the SAME row" },
  close: { artists: "any single roster name (no allowlist)", trigger: "status בוצע and artist fee > 0 — the close dialog, or (since A7) any edit to בוצע (the entitlement is realized). A PAID show with open client money / DJ fee moves to בוצע only through the close flow (409 CLOSE_REQUIRED, Phase 1)", writes: "INCOME: promote the show's row (an inactive note is cleared — the show was performed), else promote the legacy expected row by the artist-fee row, else insert (unique per show + artist); the agreement artist by roster id. NO PAYMENT is made by a close (Phase 1, Owner decision 2026-10-03): the entitlement is a credit in the artist's balance; the payout is a separate payment in the artist's balance (ARTIST_PAYOUT_VIA_BALANCE). A client still sending closeShow.artistPaid / artistPaidDate (even false) is refused before any write", failure: "502 with the show saved — retry is safe (idempotent)" },
  edgeCases: [
    "cancel / delete after close keeps realized income and payments on the ledger",
    "a price change after close does not update the realized income unless the close is re-sent",
    "there is no 'artist paid' in the close any more (Phase 1): closing realizes the entitlement and never creates a payout; a payment already made from the artist's balance is untouched by a re-close; leaving the DJ tick off never downgrades a paid DJ fee row (A1: no implicit undo)",
    "collaboration shows are skipped by both paths (the sync returns AMBIGUOUS identity evidence — shows store no label-artist id)",
    "HARDENED 2026-09-27: a close-realized income (source_show_id) now blocks the booking sync from inserting a second, expected row for the same show + artist",
    "the close dialog previews the artist amount WITHOUT rehearsal costs while the server deducts them",
  ],
  djLedger: "the DJ has no ledger; his money is the DJ-fee row",
} as const;

export const CALENDAR_MODEL = {
  link: "the show stores its event id (canonical)",
  title: "'הופעה: <name> - <artist>'; description has booker, contact, phone, place, DJ, price, notes",
  sync: "updated when name / artist / date / time / place / booker / contact / phone / price / DJ fee change; status and notes are not synced",
  removal: "only the hub's cancel / delete remove the event; server delete and the legacy drawer leave it",
  rehearsals: "'חזרה להופעה - <title>' events when requested",
} as const;

export const NOTIFICATION_MODEL = [
  { id: "SHOW_TO_ARTIST", trigger: "Owner presses 'שלח' in Shalev's portal shows tab", recipient: "Shalev (+ Owner ack 'שליו עודכן')", eligibility: "artist text contains Shalev; status אושרה / נסגר; date ≥ today", dedupe: "claim per show + fingerprint of name / date / time / place (money edits never reopen it)", marker: "show sent to artist (status processing / sent / failed + fingerprint + sent time) — read-only readShalevShowNotifyState / readDjShowNotifyState (POLISH #1, 2026-09-27): Sunny's NOTIFY_SHOW_ARTIST / _DJ fresh read = SENT only when the row is 'sent' for the current version; already sent → ALREADY_SENT (no second offer); failed → FAILED, never 'sent'", deepLink: "Shalev's shows tab", guard: "production only" },
  { id: "SHOW_TO_DJ", trigger: "Owner presses 'שלח' for the DJ", recipient: "CLEANTONE (+ Owner ack)", eligibility: "DJ = CLEANTONE; status אושרה / נסגר; date ≥ today", dedupe: "same claim model", marker: "show sent to DJ", deepLink: "DJ portal shows", guard: "production only" },
  { id: "DJ_CONFIRMED", trigger: "CLEANTONE confirms", recipient: "Owner", eligibility: "a real transition", dedupe: "per show + confirmation time", marker: null, deepLink: "DJ portal shows", guard: "production only" },
  { id: "DJ_PAYMENT_PAID", trigger: "a REAL DJ_FEE not-paid → שולם transition: the close dialog's 'שולם ל-DJ', MARK_SHOW_FEE_PAID (DJ) or a Finance edit of the row (Owner decision 2026-10-03; closing the show by itself does NOT push)", recipient: "CLEANTONE ('התשלום הועבר 💸'), then — only after that push was delivered — the Owner ('עדכון תשלום נשלח ל-CLEANTONE ✓')", eligibility: "the show's DJ is CLEANTONE, the DJ_FEE row is שולם now and was not before, fee > 0; never an already-paid row, a cancelled row, a refresh / GET / page load", dedupe: "ONE delivery claim per payment (settings dj_payment_paid:<DJ_FEE transaction id>); a 'sent' claim never re-sends; a failed push is a warning + log and never touches the money; a failed Owner confirmation never re-sends to the DJ", marker: "the claim row (processing → sent / failed)", deepLink: "DJ portal shows", guard: "production only (pushAllowed, checked before any claim)" },
  { id: "SESSION_CREATED_SHALEV", trigger: "a session on a Shalev project", recipient: "Shalev + Owner", eligibility: "rehearsals have no project → never fire", dedupe: "per session", marker: null, deepLink: "schedule", guard: "production only" },
  { id: "WEEK_STRENGTH", trigger: "weekly summary", recipient: "Owner", eligibility: "counts next week's confirmed shows", dedupe: "per week", marker: null, deepLink: null, guard: "production only" },
] as const;

export const PREPARATION_MODEL = {
  recordedEvidence: ["status (confirmed)", "date / time / place", "DJ assigned + CLEANTONE confirmation", "artist notified (marker) / DJ notified (marker)", "rehearsal sessions (show id) + their status / cost", "calendar event", "client payment / advance", "open show tasks (no-DJ, quote follow-up)", "notes"],
  noReadinessModel: "Redbloods has no 'ready for show' rule or checklist; Sunny lists evidence and asks, never scores",
  performanceFiles: "per ARTIST (not per show) audio files in the artist's storage folder (no database metadata); Shalev and the Owner can upload; no delete; Sunny cannot list them (storage gap)",
} as const;

/** Executability is NOT restated here (one fact, one source): it is served only by the action coverage matrix (capability action_registry, mode coverage — lib/partner/act/matrix.ts). */
export interface ShowActionEntry { id: string; action: string; who: Who | "DJ"; enforcement: Enforcement; entryPoint: string; writes: string; finance: string | null; ledger: string | null; calendar: string | null; push: string | null; external: boolean; destructive: boolean; reversible: "YES" | "PARTIAL" | "NO"; approvalClass: ApprovalClass; sunnyToday: "SEE_ACTION_COVERAGE"; futurePrimitive: string; internal: { routes: readonly string[] } }
type SA = Omit<ShowActionEntry, "sunnyToday" | "internal"> & { routes: readonly string[] };
const X = (e: SA): ShowActionEntry => { const { routes, ...rest } = e; return { ...rest, sunnyToday: "SEE_ACTION_COVERAGE", internal: { routes } }; };
const S = "app/api/shows/route.ts", SI = "app/api/shows/[id]/route.ts";
export const SHOW_ACTIONS: readonly ShowActionEntry[] = [
  X({ id: "CREATE_SHOW", action: "Create a show / quote", who: "OWNER", enforcement: "PROXY_ONLY", entryPoint: "hub 'הופעה חדשה' / 'הצעת מחיר'", writes: "show (+ quick client)", finance: "rows when confirmed", ledger: "Shalev expected income when confirmed", calendar: "event (default on)", push: null, external: true, destructive: false, reversible: "PARTIAL", approvalClass: "FINANCIAL", futurePrimitive: "CREATE_SHOW", routes: [S] }),
  X({ id: "QUOTE_SENT", action: "Mark a quote sent (follow-up task)", who: "OWNER", enforcement: "ROUTE_CHECKS_OWNER", entryPoint: "quote save", writes: "task", finance: null, ledger: null, calendar: null, push: null, external: false, destructive: false, reversible: "YES", approvalClass: "STANDARD", futurePrimitive: "SHOW_QUOTE_FOLLOW_UP", routes: ["app/api/shows/[id]/quote-sent/route.ts"] }),
  X({ id: "EDIT_SHOW", action: "Edit show fields / status / client payment", who: "OWNER", enforcement: "ROUTE_CHECKS_OWNER", entryPoint: "form / pickers", writes: "show", finance: "re-sync (pipeline → refused with payments, else non-payment rows deleted); fee statuses never follow the client payment (A1)", ledger: "expected row re-derived / removed", calendar: "event update", push: null, external: true, destructive: false, reversible: "PARTIAL", approvalClass: "FINANCIAL", futurePrimitive: "UPDATE_SHOW / UPDATE_SHOW_STATUS", routes: [SI] }),
  X({ id: "ASSIGN_DJ", action: "Choose / change the DJ", who: "OWNER", enforcement: "ROUTE_CHECKS_OWNER", entryPoint: "form DJ picker", writes: "DJ id + name + confirmation reset", finance: "DJ row party", ledger: null, calendar: "description", push: null, external: false, destructive: false, reversible: "YES", approvalClass: "STANDARD", futurePrimitive: "ASSIGN_SHOW_DJ", routes: [SI] }),
  X({ id: "RECORD_PAYMENT", action: "Record money received for a show (deposit / partial / full / overpayment)", who: "OWNER", enforcement: "ROUTE_CHECKS_OWNER", entryPoint: "show panel 'רשום תשלום' / Sunny RECORD_SHOW_PAYMENT", writes: "one SHOW_PAYMENT income row (show currency) + the expected balance + the derived payment status", finance: "payment row; expected balance = agreed − received; DJ / artist fee statuses unchanged (A1)", ledger: "unchanged (the ledger follows the split, not the cash)", calendar: null, push: null, external: false, destructive: false, reversible: "PARTIAL", approvalClass: "FINANCIAL", futurePrimitive: "RECORD_SHOW_PAYMENT", routes: ["app/api/shows/[id]/payments/route.ts"] }),
  X({ id: "MARK_FEE_PAID", action: "Mark a show's DJ fee paid (or explicitly back to expected) — its own obligation (A1). The artist is refused (ARTIST_PAYOUT_VIA_BALANCE, Phase 1): artist payouts are payments in the artist's balance only", who: "OWNER", enforcement: "ROUTE_CHECKS_OWNER", entryPoint: "close-show dialog flags / the Finance row edit / Sunny MARK_SHOW_FEE_PAID", writes: "DJ: that fee row's status (+ payment date / method). ARTIST: refused (ARTIST_PAYOUT_VIA_BALANCE) — nothing is written", finance: "DJ_FEE row status", ledger: null, calendar: null, push: null, external: false, destructive: false, reversible: "YES", approvalClass: "FINANCIAL", futurePrimitive: "MARK_SHOW_FEE_PAID", routes: [] }),
  X({ id: "CLOSE_SHOW", action: "Close a show (done + who was paid)", who: "OWNER", enforcement: "ROUTE_CHECKS_OWNER", entryPoint: "close-show dialog", writes: "status בוצע, DJ name, notes (the artist is never paid by a close)", finance: "client remainder recorded once when 'received'; a DJ flag set → that fee row שולם; a flag left false changes nothing (never a downgrade)", ledger: "artist INCOME (the entitlement) — never a payment", calendar: null, push: null, external: false, destructive: false, reversible: "PARTIAL", approvalClass: "FINANCIAL", futurePrimitive: "CLOSE_SHOW", routes: [SI] }),
  X({ id: "CANCEL_SHOW", action: "Cancel a show", who: "OWNER", enforcement: "ROUTE_CHECKS_OWNER", entryPoint: "'בטל הופעה'", writes: "status בוטל", finance: "rows → בוטל", ledger: "expected removed; realized kept", calendar: "event removed (hub)", push: null, external: true, destructive: false, reversible: "PARTIAL", approvalClass: "FINANCIAL", futurePrimitive: "CANCEL_SHOW", routes: [SI] }),
  X({ id: "DELETE_SHOW", action: "Delete a show (refused while rehearsals exist, a payment was received or a DJ / artist fee is already paid)", who: "OWNER", enforcement: "ROUTE_CHECKS_OWNER", entryPoint: "hub trash", writes: "show + tasks (hub) deleted", finance: "still-expected rows hard-deleted; a SHOW_PAYMENT row or a שולם fee row refuses the delete (HAS_PAYMENTS / HAS_PAID_FEES, zero writes)", ledger: "expected removed; realized kept", calendar: "event removed (hub only)", push: null, external: true, destructive: true, reversible: "NO", approvalClass: "DESTRUCTIVE", futurePrimitive: "DELETE_SHOW", routes: [SI] }),
  X({ id: "NOTIFY_ARTIST", action: "Send the show to the artist", who: "OWNER", enforcement: "ROUTE_CHECKS_OWNER", entryPoint: "portal shows tab 'שלח'", writes: "sent marker", finance: null, ledger: null, calendar: null, push: "Shalev + Owner ack", external: true, destructive: false, reversible: "NO", approvalClass: "EXTERNAL_EFFECT", futurePrimitive: "NOTIFY_ARTIST_DJ", routes: ["app/api/shows/[id]/notify-artist/route.ts"] }),
  X({ id: "NOTIFY_DJ", action: "Send the show to the DJ", who: "OWNER", enforcement: "ROUTE_CHECKS_OWNER", entryPoint: "DJ portal 'שלח'", writes: "sent marker", finance: null, ledger: null, calendar: null, push: "CLEANTONE + Owner ack", external: true, destructive: false, reversible: "NO", approvalClass: "EXTERNAL_EFFECT", futurePrimitive: "NOTIFY_ARTIST_DJ", routes: ["app/api/shows/[id]/notify-dj/route.ts"] }),
  X({ id: "DJ_CONFIRM", action: "CLEANTONE confirms / unconfirms", who: "DJ", enforcement: "ROLE_SCOPED", entryPoint: "DJ portal", writes: "confirmation", finance: null, ledger: null, calendar: null, push: "Owner on confirm", external: false, destructive: false, reversible: "YES", approvalClass: "STANDARD", futurePrimitive: "—", routes: ["app/api/red-artists/cleantone/shows/[id]/confirm/route.ts", "app/api/red-artists/cleantone/shows/[id]/unconfirm/route.ts"] }),
  X({ id: "REHEARSAL", action: "Book / edit a show rehearsal", who: "OWNER", enforcement: "ROUTE_CHECKS_OWNER", entryPoint: "show panel 'קבע חזרה'", writes: "session (show id, cost)", finance: "rehearsal expense + show re-sync (split)", ledger: "Shalev expected income re-derived", calendar: "event when requested", push: null, external: true, destructive: false, reversible: "PARTIAL", approvalClass: "FINANCIAL", futurePrimitive: "SCHEDULE_REHEARSAL", routes: ["app/api/sessions/route.ts", "app/api/sessions/[id]/route.ts"] }),
];

export interface ShowWorkflow { event: string; support: "SUPPORTED" | "PARTIAL" | "NOT_SUPPORTED"; concept: string; evidence: string[]; missing: string[] }
export const SHOW_WORKFLOWS: readonly ShowWorkflow[] = [
  { event: "NEW_SHOW", support: "SUPPORTED", concept: "create (full form or quote)", evidence: ["show", "no-DJ task", "calendar event"], missing: ["price / place / time / DJ when not given"] },
  { event: "SHOW_EDITED", support: "SUPPORTED", concept: "edit + finance / calendar re-sync", evidence: ["updated time"], missing: ["what changed (no history)"] },
  { event: "SHOW_CONFIRMED", support: "SUPPORTED", concept: "status אושרה / נסגר → finance rows", evidence: ["status", "rows"], missing: [] },
  { event: "ASSIGN_DJ", support: "SUPPORTED", concept: "DJ picker (any crew client)", evidence: ["DJ id / name", "confirmation"], missing: [] },
  { event: "NOTIFY_ARTIST", support: "PARTIAL", concept: "manual push — Shalev only", evidence: ["sent marker + fingerprint"], missing: ["notification for other artists"] },
  { event: "NOTIFY_DJ", support: "PARTIAL", concept: "manual push — CLEANTONE only", evidence: ["sent marker"], missing: ["notification for other DJs"] },
  { event: "DJ_CONFIRMED", support: "PARTIAL", concept: "CLEANTONE only, atomic", evidence: ["confirmation + time"], missing: ["confirmation for other DJs"] },
  { event: "REHEARSAL_CREATED", support: "SUPPORTED", concept: "session with the show id + cost", evidence: ["sessions", "rehearsal expense"], missing: [] },
  { event: "ADVANCE_RECORDED", support: "PARTIAL", concept: "advance amount on the show (no finance row)", evidence: ["advance amount", "payment מקדמה"], missing: ["advance date / as a received row"] },
  { event: "CLIENT_PAID", support: "SUPPORTED", concept: "client payment שולם → income received", evidence: ["income row status"], missing: [] },
  { event: "SHOW_PREPARATION", support: "PARTIAL", concept: "evidence only (DJ, confirmation, markers, rehearsals, calendar, tasks)", evidence: ["see PREPARATION_MODEL"], missing: ["a readiness definition"] },
  { event: "CLOSE_SHOW", support: "SUPPORTED", concept: "close dialog (client + DJ ticks; the artist entitlement enters the balance — never a payout)", evidence: ["status בוצע", "client paid", "DJ paid", "ledger rows (entitlement)"], missing: [] },
  { event: "SHOW_REOPENED", support: "PARTIAL", concept: "status change back", evidence: ["rows re-activated / deleted"], missing: ["ledger demotion (never happens)"] },
  { event: "SHOW_CANCELLED", support: "SUPPORTED", concept: "rows → בוטל, tasks cancelled, expected ledger removed", evidence: ["status", "rows"], missing: ["realized ledger reversal"] },
  { event: "SHOW_DELETED", support: "SUPPORTED", concept: "blocked with rehearsals; rows deleted", evidence: ["—"], missing: ["audit of the deleted show"] },
  { event: "ARTIST_LEDGER_SYNC", support: "PARTIAL", concept: "net model: booking = expected entitlement (agreement artists, by id) → close = realized entitlement → real payment = Finance + ledger payment", evidence: ["ledger rows by source_show_id", "payment rows by source_tx_id"], missing: ["collaborations (never attributed)", "artists without an agreement (NOT_DEFINED)", "non-₪ shows (the ledger has no currency)"] },
  { event: "POST_SHOW_PAYMENT", support: "PARTIAL", concept: "close dialog: client + DJ paid; the artist payout is a payment in the artist's balance (never from a show)", evidence: ["rows", "ledger payment"], missing: ["the artist-ledger PAYMENT is recorded in the artist's balance itself (a show close / MARK_SHOW_FEE_PAID never pays the artist)"] },
  { event: "SHOW_REMINDER", support: "NOT_SUPPORTED", concept: "no show reminder / cron exists", evidence: [], missing: ["any automatic show reminder"] },
];

export const SHOW_SIGNAL_MODEL: ReadonlyArray<{ code: string; kind: "CANONICAL_FACT" | "DERIVED_SIGNAL" | "UNKNOWN"; note: string }> = [
  { code: "UPCOMING", kind: "CANONICAL_FACT", note: "confirmed show with a future date" },
  { code: "PIPELINE", kind: "CANONICAL_FACT", note: "lead / quote status" },
  { code: "NO_DJ", kind: "CANONICAL_FACT", note: "no DJ recorded — never auto-filled with CLEANTONE; never raised for an unpaid collaboration (deal type UNPAID_COLLAB needs no DJ by default — an explicit DJ is handled normally)" },
  { code: "DJ_FEE_WITHOUT_DJ", kind: "CANONICAL_FACT", note: "a DJ fee (and DJ expense row) without a DJ" },
  { code: "DJ_AWAITING_CONFIRMATION", kind: "CANONICAL_FACT", note: "CLEANTONE assigned, not confirmed" },
  { code: "DJ_CONFIRMED", kind: "CANONICAL_FACT", note: "CLEANTONE confirmed" },
  { code: "DJ_CONFIRMED_BEFORE_CHANGE", kind: "DERIVED_SIGNAL", note: "confirmed before the show's last change (date changes do not reset confirmation)" },
  { code: "ARTIST_NOT_NOTIFIED", kind: "CANONICAL_FACT", note: "eligible for the artist push, no sent marker" },
  { code: "ARTIST_NOTIFIED_OUTDATED", kind: "DERIVED_SIGNAL", note: "sent, but name / date / time / place changed since" },
  { code: "DJ_NOT_NOTIFIED", kind: "CANONICAL_FACT", note: "eligible for the DJ push, no sent marker" },
  { code: "REHEARSALS_RECORDED", kind: "CANONICAL_FACT", note: "rehearsal sessions exist (no rehearsal requirement exists)" },
  { code: "NO_CALENDAR_EVENT", kind: "CANONICAL_FACT", note: "confirmed show without a calendar event" },
  { code: "PRICE_MISSING", kind: "CANONICAL_FACT", note: "confirmed / done show with price 0" },
  { code: "UPCOMING_UNPAID", kind: "CANONICAL_FACT", note: "upcoming, client payment not שולם (advance shown)" },
  { code: "DONE_UNPAID", kind: "CANONICAL_FACT", note: "done, client payment not שולם" },
  { code: "DATE_PASSED_NOT_CLOSED", kind: "DERIVED_SIGNAL", note: "PAST_SHOW_NOT_CLOSED (Owner decision 2026-10-03): a show whose date is before today (Israel, the date only) and whose status is still נסגר / אושרה — not בוצע / בוטל. The time passing ≠ בוצע: a past date does NOT prove the show took place. If it did → close it as בוצע (the close records whether the client paid and whether the DJ was paid; an unpaid client does not prevent בוצע — the debt stays open); if not → update the status through the existing flow. Sunny never assumes it took place, nothing closes it automatically" },
  { code: "PAST_SHOW_OPEN_MONEY", kind: "DERIVED_SIGNAL", note: "the SAME event with money still open: client money not received (Finance showMoneyOf remaining) and / or the DJ_FEE row not שולם — money raises the urgency, it is not the reason the show is listed; the artist's entitlement is still only expected until בוצע (details, never the headline)" },
  { code: "DONE_WITHOUT_LEDGER", kind: "DERIVED_SIGNAL", note: "done show of a single roster artist with no ledger income (closed by a plain edit?)" },
  { code: "SHOW_SPLIT_NOT_DEFINED", kind: "UNKNOWN", note: "the show's artist has no agreement (only שליו / אבי) or is a collaboration — no artist / label split, no artist fee row" },
  { code: "LEDGER_KEPT_AFTER_CANCEL", kind: "DERIVED_SIGNAL", note: "cancelled show that still has realized ledger income / payment" },
  { code: "ARTIST_ROW_UNPAID_AFTER_DONE", kind: "CANONICAL_FACT", note: "done show whose artist-fee row is still expected (the artist's own obligation — never paid by the client payment)" },
  { code: "PAID_FEE_ROW_MISMATCH", kind: "DERIVED_SIGNAL", note: "a DJ / artist fee row already שולם no longer matches the show (amount / currency / a cancelled show) — the app's own rule; the row is never overwritten (A1)" },
  { code: "OPEN_SHOW_TASKS", kind: "CANONICAL_FACT", note: "open tasks linked to the show" },
  { code: "COLLABORATION", kind: "CANONICAL_FACT", note: "several artist names — no ledger sync" },
];

export const SHOW_INTEGRITY = {
  productionCounts20260925: {
    shows: 10, byStatus: { "בוצע": 7, "בוטל": 3 }, future: 0, withArtistClient: 10, rosterArtist: 10, withBooker: 9, withDj: 7, djIsCleantone: 7, otherDjs: 0,
    djConfirmation: { "אושר": 3, "ממתין לאישור": 2, none: 5 }, artistSentMarkers: 7, djSentMarkers: 0, withCalendarEvent: 10, storedArtistFeeNonZero: 0,
    rehearsals: 1, rehearsalCost: 180, showsWithLedgerIncome: 5, showTasks: 9, showTasksOpen: 1,
  },
  findingsHe: [
    "העמודה 'שכר אמן' שמורה כ-0 בכל ההופעות — הסכום נגזר (showAgreementSplit). מאז מודל הנטו (28.9) חלק האמן הוא זכאות ביומן האמן בלבד — לא שורת כספים; רק תשלום אמיתי נרשם בכספים (שכר אמן, שולם, Records).",
    "זכאות צפויה של הופעה שבוטלה לא נמחקת — היא מסומנת '[זכאות לא פעילה]' בהערה (אין עמודת סטטוס ביומן). מסך המאזן עדיין מציג אותה כשורה (מסומנת בהערה) — פער תצוגה רשום.",
    "הופעה אחת (03.09) מסומנת בוצע עם מחיר 0, בלי שורת הכנסה, עם שורת DJ של 0 ומשימה פתוחה.",
    "שורות 'שכר אמן' צפויות ישנות (לפני 28.9) אינן תשלום ואינן חוב בכספים — היישור המאושר מסמן אותן 'בוטל' עם הערת ביקורת; החוב לאמן = יתרת היומן.",
    "הופעה של אבי (לונה, 01.08) בוצעה ושולמה — ביומן שלו זכאות ממומשת ₪750 ותשלום ₪750 מקושרים להופעה (היסטוריה לפני המחזור הראשון; נבדק 2026-09-29).",
    "מעולם לא נשלחה הודעה ל-DJ מהמערכת; 5 הופעות ללא סטטוס אישור (לפני מערכת האישורים).",
    "אין הופעות עתידיות רשומות.",
  ],
} as const;

/** Server-side show / DJ / ledger / notify files — a change must review this contract (internal). */
export const SHOW_REVIEWED_FILES = [
  "lib/shows-store.ts", "lib/shows-types.ts", "lib/shows-finance-sync.ts", "lib/artist-balance-show-sync.ts", "lib/artist-balance-show-sync-pure.ts", "lib/artist-balance-show-close-sync.ts",
  "lib/show-notify.ts", "lib/show-notify-pure.ts", "lib/dj-show-notify.ts", "lib/dj-confirm-notify.ts", "lib/dj-payment-notify.ts", "lib/dj-payment-notify-pure.ts", "lib/show-quote-followup.ts", "lib/show-cancel-tasks.ts", "lib/red-artists/cleantone.ts",
  "app/api/shows/route.ts", "app/api/shows/[id]/route.ts",
] as const;
export const SHOW_REVIEWED_FINGERPRINTS: Readonly<Record<string, string>> = {
  "lib/shows-store.ts": "62db5ba2642c0db7d2bff609e13c72feeed3f1dd67748002a2327693b809eae7",
  "lib/shows-types.ts": "4ff774de1368126c2f9ad65dba06e417a341e452cc75c667a4edd162ab993aa3",
  // 2026-10-03 review (Phase 1, Owner decision): a show never pays the artist (ARTIST_PAYOUT_VIA_BALANCE; applyShowClosureStatuses has no artist flag); the PATCH / POST routes answer partial (502) and CLOSE_REQUIRED / ShowRefusedError (409)
  // 2026-09-29 review (Final Hardening A1–A9): failed money writes fail the operation; unknown rehearsal cost ≠ 0; realized entitlement follows the show; conversion exactly-once; no field / vocabulary / link semantics changed
  "lib/shows-finance-sync.ts": "80cba1d248fd9f1f7f9dc2a4e8b8b210a28743e3d007cffb9f97ff9a80bd43f9",
  "lib/artist-balance-show-sync.ts": "578ae5accad84c65e945050a5b343398823751e96325f491a6ae9c906821584c",
  "lib/artist-balance-show-sync-pure.ts": "b695fd979b16ebfc38b97a05517fb34505b31db431dc8a3587bf7c11f712eba3",
  "lib/artist-balance-show-close-sync.ts": "bfd356bfcbd24fa65e7cba2c93603ed07d33e5380e966c87af7b6f4e3ebb433c",
  "lib/show-notify.ts": "e34620394d6b55cab4413460ce4411a2933d5473aa75a0946d1a4fcbeda3e77e",
  "lib/show-notify-pure.ts": "8cde3a74655cd7d93b2832c9a9fc50212861e8f9ebd7eeafb44881026eefb977",
  "lib/dj-show-notify.ts": "a6b2faf555de56bf78a5b1952ada1fdfe59784242045de62343ad7b2099e6a0c",
  "lib/dj-confirm-notify.ts": "6f2542f077f0ac2fc4ddf64ba068faac9564cfc10e87838cec51a135d8e6c0e6",
  // 2026-10-03 review (DJ payment push, Owner decision): ONE shared notifier behind the three DJ_FEE → שולם writers; one delivery claim per payment
  "lib/dj-payment-notify.ts": "c25b7a5c8c23fcf18ce3cde11f0e3712d60b5d64ba173e5c4ff3df68400649f2",
  "lib/dj-payment-notify-pure.ts": "6727561f2ee958475f0cb7c1cace67572f534ce4c117ef2d319f4a438dbe3f03",
  "lib/show-quote-followup.ts": "4ab61b81333b94c00556e7d188a4adbf5949c4d5ddc7267f62dda697877c3b17",
  "lib/show-cancel-tasks.ts": "b182fd76f8826168b266b667c7b603c340ea7aaa542f048fa39d75a8619da891",
  "lib/red-artists/cleantone.ts": "24c56172b94900b3184debd5abf64576214a852a93e2fe4ff21354e6110902ad",
  "app/api/shows/route.ts": "eeed351424e3cb7210c6bdc3fbd44d8edb1e439b1afcfaa41b84b1b0e5d48db1",
  "app/api/shows/[id]/route.ts": "c0a869571a99fe4ce09a6f782b251a1f82e4df6c2f1e715a4ec8760a081a77ef",
};

/** Route families touching shows (internal — the test re-discovers routes). */
export const SHOW_ROUTE_GROUPS: ReadonlyArray<{ pattern: string; purpose: string }> = [
  { pattern: "^app/api/shows/", purpose: "shows CRUD, close, notify artist / DJ, quote follow-up" },
  { pattern: "^app/api/red-artists/cleantone(-summary|/)", purpose: "DJ portal: summary, confirm / unconfirm, presence ping, push registration, profile image, streaming" },
  { pattern: "^app/api/tasks/route\\.ts$", purpose: "tasks carry an optional show id (no-DJ task, quote follow-up)" },
  { pattern: "^app/api/label/artists/\\[id\\]/balance/cycles/remind/", purpose: "cycle reminder maps LABEL artists (Shalev / Avi) to push roles — DJ CLEANTONE is team and never a recipient" },
  { pattern: "^app/api/(red-artists/shalev-summary|label/artists/\\[id\\]/(summary|shows|recoup|weekly)|red-artists/weekly)/", purpose: "portal / label views that read shows" },
  { pattern: "^app/api/sessions/", purpose: "rehearsals (show id) → rehearsal finance + show re-sync" },
  { pattern: "^app/api/transactions/route\\.ts$", purpose: "the Finance list returns each row's owner (show payment / balance / DJ fee / artist fee / rehearsal rows are owned by their show — the owned-row guard)" },
];
