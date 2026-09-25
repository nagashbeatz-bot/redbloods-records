/**
 * Sunny System Awareness — SHOWS + DJ DEEP CONTRACT (a live show as Redbloods actually implements it).
 *
 * Produced by the Shows + DJ Deep Brain discovery (2026-09-25): every store / route / UI / portal / push / finance /
 * ledger / calendar / task path touching shows and DJs, the live production schema (columns, checks, FKs, indexes)
 * and read-only production counts. Pure data; served through system_awareness mode show_model. Semantic only — the
 * schema pin, route patterns and reviewed files below are internal to the coverage test and never served.
 */
import type { ApprovalClass, Enforcement, Who } from "./project-actions";

export const SHOWS_BASELINE_VERSION = "2026.09.25-shows-1";

/** Live production columns (information_schema, 2026-09-25) — internal, pinned by the test. */
export const SHOW_SCHEMA_COLUMNS = ["id", "name", "artist", "date", "start_time", "location", "contact_person", "phone", "status", "payment_status", "show_price", "dj_fee", "advance_payment", "notes", "created_at", "updated_at", "artist_client_id", "booker_client_id", "booker_name", "calendar_event_id", "dj_client_id", "dj_name", "linked_income_transaction_id", "linked_dj_expense_transaction_id", "artist_fee", "linked_artist_expense_transaction_id", "dj_confirmation_status", "dj_confirmed_at"] as const;

export type FieldClass = "CANONICAL" | "DERIVED" | "DISPLAY_ONLY" | "LEGACY" | "AMBIGUOUS" | "POSSIBLE_BUG" | "CONFLICT";
export interface ShowField { field: string; classification: FieldClass; meaning: string; validation: string; writers: string; readers: string; sideEffects: string; history: string; sunnyReads: string }
const W = "Owner (shows hub form / quick pickers / close-show dialog; legacy drawer)";
const F = (field: string, classification: FieldClass, meaning: string, validation: string, o: Partial<ShowField> = {}): ShowField =>
  ({ field, classification, meaning, validation, writers: W, readers: "shows hub, portals, COO, label page, Partner", sideEffects: "—", history: "no change history (updated_at only)", sunnyReads: "show_view", ...o });

export const SHOW_FIELDS: readonly ShowField[] = [
  F("id", "CANONICAL", "Show identity.", "generated", { history: "—" }),
  F("name", "CANONICAL", "Show name (a quote gets 'הצעת מחיר — <contact>' until confirmed).", "required, trimmed", { sideEffects: "calendar title; transaction descriptions (stale until a money field changes); artist / DJ push fingerprint" }),
  F("artist", "AMBIGUOUS", "Artist display text copied from the artist client (collaborations as several names). It — not the artist id — decides show → ledger eligibility.", "none", { sideEffects: "finance artist text, ledger artist resolution (single exact roster name), artist-push eligibility (Shalev token)" }),
  F("artist_client_id", "CANONICAL", "The artist's CLIENT record (not the label roster).", "FK to clients, set null", { readers: "hub, portals (Shalev / Avi summaries by client), label page" }),
  F("booker_client_id", "CANONICAL", "The booker's client record.", "FK to clients, set null"),
  F("booker_name", "CANONICAL", "Booker name text (also the income transaction's party).", "none"),
  F("date", "CANONICAL", "Show date.", "date or null", { sideEffects: "calendar event, finance dates, ledger entry date, artist-push fingerprint; a date change does NOT reset the DJ confirmation" }),
  F("start_time", "CANONICAL", "Start time text (calendar defaults to 20:00, 2 hours).", "none", { sideEffects: "calendar, push fingerprint" }),
  F("location", "CANONICAL", "Venue / place.", "none", { sideEffects: "calendar, push fingerprint" }),
  F("contact_person", "CANONICAL", "Venue / booker contact name.", "none", { sunnyReads: "show_view (name)" }),
  F("phone", "CANONICAL", "Contact phone.", "none", { sunnyReads: "show_view (hasPhone only)" }),
  F("status", "CANONICAL", "Lifecycle: ליד חדש / ממתין לתשובה / צריך פולואפ (pipeline) · נסגר / אושרה (confirmed upcoming) · בוצע (done) · בוטל (cancelled).", "not validated server-side; DB default ליד חדש", { sideEffects: "confirmed → finance rows; back to pipeline → finance rows HARD-deleted; בוטל → rows cancelled, open tasks cancelled, expected ledger removed; בוצע via the close dialog → ledger income (+ payment)" }),
  F("payment_status", "CANONICAL", "CLIENT payment: שולם / לא שולם / צפוי / מקדמה / בוטל (legacy חלקי shown as מקדמה).", "not validated server-side; DB default לא שולם", { sideEffects: "income row received vs expected; also drives DJ / artist rows on a re-sync (close-dialog per-party statuses are re-derived from it on a later edit)" }),
  F("show_price", "CANONICAL", "Gross show price — NO currency stored (finance rows are written as ₪).", "number, default 0", { sideEffects: "income row, split" }),
  F("dj_fee", "CANONICAL", "DJ fee — defaults to 500 at creation even when no DJ is chosen.", "number, default 500 (a bad PATCH value becomes NaN)", { sideEffects: "DJ expense row (created from the fee even without a DJ), split" }),
  F("advance_payment", "CANONICAL", "Advance received from the client (amount).", "number, default 0", { sideEffects: "none in finance — used only by the UI 'remaining' and the COO", readers: "hub UI, COO evidence" }),
  F("artist_fee", "LEGACY", "Stored artist fee — NEVER read by any calculation (the split computes it); 0 on every production show.", "number, default 0", { readers: "nobody" }),
  F("notes", "CANONICAL", "Free text; the close dialog appends a 'סגירת הופעה <date>: …' line.", "none", { sunnyReads: "show_view (evidence)" }),
  F("calendar_event_id", "CANONICAL", "The show's Google Calendar event (canonical calendar link).", "text or null", { sideEffects: "event title 'הופעה: <name> - <artist>'; updated when name / artist / date / time / place / booker / contact / phone / price / DJ fee change; removed only by the hub's cancel / delete", sunnyReads: "show_view (hasCalendarEvent) + calendar" }),
  F("dj_client_id", "CANONICAL", "The DJ's client record (any crew client — only CLEANTONE has confirmation / portal / push).", "FK to clients, set null", { sideEffects: "becoming CLEANTONE sets confirmation ממתין לאישור (null when done / cancelled); changing away clears it" }),
  F("dj_name", "AMBIGUOUS", "DJ display text — set with the DJ picker, but the close dialog can overwrite it as free text without changing the DJ id (the legacy drawer never sends the id).", "none", { sideEffects: "DJ transaction party text" }),
  F("dj_confirmation_status", "CANONICAL", "CLEANTONE's confirmation: ממתין לאישור / אושר / null (outside the confirmation system).", "DB check", { writers: "the show store (on DJ change) + CLEANTONE's confirm / unconfirm (atomic conditional update)", sideEffects: "confirm pushes the Owner" }),
  F("dj_confirmed_at", "CANONICAL", "When CLEANTONE confirmed.", "timestamp or null", { writers: "confirm / unconfirm / DJ change", history: "last confirmation only" }),
  F("linked_income_transaction_id", "CANONICAL", "The show's income transaction.", "FK to transactions, set null", { writers: "finance sync only" }),
  F("linked_dj_expense_transaction_id", "CANONICAL", "The DJ-fee expense transaction.", "FK to transactions, set null", { writers: "finance sync only" }),
  F("linked_artist_expense_transaction_id", "CANONICAL", "The artist-fee expense transaction (also the key of Shalev's expected ledger row).", "FK to transactions, set null", { writers: "finance sync only" }),
  F("created_at", "CANONICAL", "Created.", "default now", { history: "creation only" }),
  F("updated_at", "CANONICAL", "Last change (any field, incl. DJ confirm).", "default now", { history: "last change only" }),
];

export const SHOW_VOCABULARIES = {
  statuses: ["ליד חדש", "ממתין לתשובה", "צריך פולואפ", "נסגר", "אושרה", "בוצע", "בוטל"],
  paymentStatuses: ["שולם", "לא שולם", "צפוי", "מקדמה", "בוטל"],
  djConfirmation: ["ממתין לאישור", "אושר"],
  groups: { pipeline: ["ליד חדש", "ממתין לתשובה", "צריך פולואפ"], confirmedFinance: ["נסגר", "אושרה", "בוצע"], upcomingConfirmed: ["אושרה", "נסגר"], portalVisible: ["אושרה", "נסגר", "בוצע"], done: ["בוצע"], cancelled: ["בוטל"] },
  formStatuses: { fullForm: ["ממתין לתשובה", "אושרה", "בוצע", "בוטל"], quoteForm: ["ליד חדש", "ממתין לתשובה", "צריך פולואפ"] },
  rehearsalOperational: ["מתוכנן", "בוצע", "בוטל", "התקיים (auto-mark — never counted)"],
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
] as const;

export const LIFECYCLE = [
  { transition: "CREATE", entry: "hub 'הופעה חדשה' (full form) or 'הצעת מחיר' (quote) · legacy form", writes: "show (DJ confirmation computed)", finance: "rows only when created confirmed", ledger: "Shalev expected income when confirmed + artist fee > 0", calendar: "event when 'add to calendar' (default on for the full form)", push: "none", tasks: "no-DJ task 'לסגור דיג׳יי להופעה' (due tomorrow) when saved without a DJ; quote → 'פולואפ להצעת מחיר' task", idempotent: "—" },
  { transition: "QUOTE_SENT", entry: "quote save", writes: "task", finance: "—", ledger: "—", calendar: "—", push: "none", tasks: "follow-up task (no due date), refreshed while open", idempotent: "per show + marker" },
  { transition: "CONFIRM (→ אושרה / נסגר)", entry: "status picker / form ('הצעה אושרה' switches to the full form)", writes: "status (+ payment צפוי when future and לא שולם)", finance: "income / DJ fee / artist fee rows created or re-activated", ledger: "Shalev expected income", calendar: "event synced if it exists", push: "none (manual 'שלח')", tasks: "quote task → בוצע", idempotent: "linked ids" },
  { transition: "EDIT", entry: "form / pickers", writes: "fields", finance: "re-synced only when price / DJ fee / DJ name / artist fee / status / date / payment / close change — name / artist / booker alone leave descriptions stale", ledger: "expected row re-derived (frozen once received)", calendar: "event updated on sync fields", push: "artist / DJ button reopens only when name / date / time / place change", tasks: "—", idempotent: "yes" },
  { transition: "BACK_TO_PIPELINE", entry: "status picker", writes: "status", finance: "ALL THREE rows HARD-DELETED (even received income)", ledger: "expected row removed (received kept)", calendar: "—", push: "—", tasks: "—", idempotent: "yes" },
  { transition: "CLOSE (→ בוצע via dialog)", entry: "choosing בוצע or שולם opens the close-show dialog", writes: "status בוצע, client payment, per-party paid, DJ name, notes line", finance: "rows re-synced then per-party statuses (income received / DJ paid / artist paid)", ledger: "INCOME row for any single roster artist (+ PAYMENT if 'artist paid'); dated the show date; retry-safe (502 on failure)", calendar: "—", push: "—", tasks: "—", idempotent: "per show + artist; payment app-level" },
  { transition: "REOPEN", entry: "status picker", writes: "status", finance: "cancelled rows re-activated from the stored ids; to pipeline → deleted", ledger: "realized income is never demoted", calendar: "—", push: "—", tasks: "—", idempotent: "yes" },
  { transition: "CANCEL (→ בוטל)", entry: "'בטל הופעה' / status", writes: "status", finance: "rows set to בוטל (kept)", ledger: "expected row removed; realized income + payments KEPT", calendar: "event removed only via the hub cancel button", push: "—", tasks: "open show tasks → בוטל; quote task → בוטל", idempotent: "yes" },
  { transition: "DELETE", entry: "hub trash (legacy drawer)", writes: "show deleted", finance: "rows hard-deleted (by id + marker, rehearsal expenses kept)", ledger: "expected removed; realized kept (source link cleared)", calendar: "hub removes the event first; legacy / server do not", push: "—", tasks: "hub HARD-deletes all show tasks", idempotent: "blocked while rehearsals exist" },
  { transition: "DJ_CONFIRM / UNCONFIRM", entry: "DJ portal (CLEANTONE or Owner preview)", writes: "confirmation + time (atomic, only for CLEANTONE's shows)", finance: "—", ledger: "—", calendar: "—", push: "confirm → Owner", tasks: "—", idempotent: "already-confirmed returns without a second push" },
] as const;

export const DJ_MODEL = {
  identity: "the DJ is a CLIENT record (usually type איש צוות) chosen in the form; CLEANTONE = the app's fixed client id (his label-artist record has a different name)",
  default: "NO default DJ anywhere — never preselected; a show saved without a DJ creates a 'close a DJ' task",
  otherDjs: "any crew client can be the DJ; only CLEANTONE has confirmation, a portal and push",
  confirmation: "becoming CLEANTONE → ממתין לאישור (null if done / cancelled); changing away → null; NOT reset by date / time / place change or cancellation",
  fee: "dj_fee (default 500) → a DJ expense row, created even with no DJ chosen; DJ paid state = that row's status",
  portal: "CLEANTONE sees his non-cancelled shows with name / artist / date / time / place / DJ fee / CLIENT payment status / confirmation; can confirm / unconfirm; 'upcoming' has no date or status filter",
  portalBug: "the portal's payment pill shows the CLIENT's payment, not whether the DJ was paid",
  ownerKnowledge: "Owner: CLEANTONE is the label DJ and plays MOST label shows — a frequency, never an assignment rule",
  hardcoded: ["CLEANTONE client id (DJ matching, confirmation, notify, portal)", "the cleantone login role (account email)"],
} as const;

export const MONEY_MODEL = {
  currency: "shows store NO currency; the finance sync writes every show / DJ / artist / rehearsal row as ₪ — a foreign-currency show would be recorded as ₪ (registered gap)",
  split: "gross = price; net = max(0, price − DJ fee − counted rehearsal costs); artist fee = net / 2; label profit = net − artist fee. No rounding (x.5 possible). The stored artist fee column is never used; there is no override.",
  rehearsalCounted: "a rehearsal cost counts when its operational status is בוצע, or when it is paid (שולם / התקבל); חלקי never counts; planned / cancelled unpaid never count; the auto-mark status 'התקיים' is NOT counted",
  advance: "stored amount only — not a finance row; the UI shows remaining = price − advance; מקדמה counts as unpaid in finance",
  rows: [
    { row: "INCOME", category: "הופעה", scope: "הופעה", when: "confirmed + price > 0", status: "בוטל if cancelled; התקבל if client paid; else צפוי", amount: "price", party: "booker name, else artist, else 'לקוח'" },
    { row: "DJ_FEE", category: "שכר דיג'יי", scope: "הופעה", when: "confirmed + DJ fee > 0 (even with no DJ)", status: "בוטל if cancelled / fee 0; שולם if paid; else צפוי", amount: "DJ fee", party: "DJ name" },
    { row: "ARTIST_FEE", category: "שכר אמן", scope: "הופעה", when: "confirmed + artist fee > 0", status: "בוטל if cancelled / fee 0; שולם if paid; else צפוי", amount: "split artist fee", party: "artist text (full, incl. collaborations)" },
    { row: "REHEARSAL", category: "חזרה", scope: "הופעה", when: "a rehearsal session with cost > 0", status: "session payment (שולם / לא שולם)", amount: "cost", party: "artist" },
  ],
  rowRules: "rows carry a 'show_id:<id>' note; linked ids make re-syncs patch (never duplicate); an existing row is always patched, never deleted by sync; the close dialog sets per-party paid statuses, a later edit re-derives all three from the client payment",
  ledger: "see LEDGER_SYNC — the artist ledger is separate money (no currency)",
} as const;

export const LEDGER_SYNC = {
  booking: { artists: "Shalev only (fixed allowlist by id)", match: "the show's artist text is exactly one name that equals a roster name", trigger: "every finance sync that creates / has the artist-fee row", writes: "EXPECTED income = split artist fee, dated the show date (or today), description 'הופעה - <name>', keyed by the artist-fee row (unique)", manualInteraction: "frozen once the row is income (manual or close)", removal: "on cancel / back-to-pipeline / delete the expected row is removed; income rows are kept" },
  close: { artists: "any single roster name (no allowlist)", trigger: "the close dialog with status בוצע and artist fee > 0 (a plain status edit to בוצע writes NOTHING)", writes: "INCOME: promote the show's row, else promote the expected row by the artist-fee row, else insert (unique per show + artist); PAYMENT only when 'artist paid' (app-level dedupe), dated the chosen date", failure: "502 with the show saved — retry is safe" },
  edgeCases: [
    "cancel / delete after close keeps realized income and payments on the ledger",
    "a price change after close does not update the realized income unless the close is re-sent",
    "unticking 'artist paid' deletes nothing (a warning only)",
    "collaboration shows are skipped by both paths",
    "a close-inserted income without the artist-fee key could later meet a booking insert — a second expected row is possible (only if the booking sync had not run)",
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
  { id: "SHOW_TO_ARTIST", trigger: "Owner presses 'שלח' in Shalev's portal shows tab", recipient: "Shalev (+ Owner ack 'שליו עודכן')", eligibility: "artist text contains Shalev; status אושרה / נסגר; date ≥ today", dedupe: "claim per show + fingerprint of name / date / time / place (money edits never reopen it)", marker: "show sent to artist (status processing / sent / failed + fingerprint + sent time)", deepLink: "Shalev's shows tab", guard: "production only" },
  { id: "SHOW_TO_DJ", trigger: "Owner presses 'שלח' for the DJ", recipient: "CLEANTONE (+ Owner ack)", eligibility: "DJ = CLEANTONE; status אושרה / נסגר; date ≥ today", dedupe: "same claim model", marker: "show sent to DJ", deepLink: "DJ portal shows", guard: "production only" },
  { id: "DJ_CONFIRMED", trigger: "CLEANTONE confirms", recipient: "Owner", eligibility: "a real transition", dedupe: "per show + confirmation time", marker: null, deepLink: "DJ portal shows", guard: "production only" },
  { id: "SESSION_CREATED_SHALEV", trigger: "a session on a Shalev project", recipient: "Shalev + Owner", eligibility: "rehearsals have no project → never fire", dedupe: "per session", marker: null, deepLink: "schedule", guard: "production only" },
  { id: "WEEK_STRENGTH", trigger: "weekly summary", recipient: "Owner", eligibility: "counts next week's confirmed shows", dedupe: "per week", marker: null, deepLink: null, guard: "production only" },
] as const;

export const PREPARATION_MODEL = {
  recordedEvidence: ["status (confirmed)", "date / time / place", "DJ assigned + CLEANTONE confirmation", "artist notified (marker) / DJ notified (marker)", "rehearsal sessions (show id) + their status / cost", "calendar event", "client payment / advance", "open show tasks (no-DJ, quote follow-up)", "notes"],
  noReadinessModel: "Redbloods has no 'ready for show' rule or checklist; Sunny lists evidence and asks, never scores",
  performanceFiles: "per ARTIST (not per show) audio files in the artist's storage folder (no database metadata); Shalev and the Owner can upload; no delete; Sunny cannot list them (storage gap)",
} as const;

export interface ShowActionEntry { id: string; action: string; who: Who | "DJ"; enforcement: Enforcement; entryPoint: string; writes: string; finance: string | null; ledger: string | null; calendar: string | null; push: string | null; external: boolean; destructive: boolean; reversible: "YES" | "PARTIAL" | "NO"; approvalClass: ApprovalClass; sunnyToday: "KNOWLEDGE_ONLY"; futurePrimitive: string; internal: { routes: readonly string[] } }
type SA = Omit<ShowActionEntry, "sunnyToday" | "internal"> & { routes: readonly string[] };
const X = (e: SA): ShowActionEntry => { const { routes, ...rest } = e; return { ...rest, sunnyToday: "KNOWLEDGE_ONLY", internal: { routes } }; };
const S = "app/api/shows/route.ts", SI = "app/api/shows/[id]/route.ts";
export const SHOW_ACTIONS: readonly ShowActionEntry[] = [
  X({ id: "CREATE_SHOW", action: "Create a show / quote", who: "OWNER", enforcement: "PROXY_ONLY", entryPoint: "hub 'הופעה חדשה' / 'הצעת מחיר'", writes: "show (+ quick client)", finance: "rows when confirmed", ledger: "Shalev expected income when confirmed", calendar: "event (default on)", push: null, external: true, destructive: false, reversible: "PARTIAL", approvalClass: "FINANCIAL", futurePrimitive: "CREATE_SHOW", routes: [S] }),
  X({ id: "QUOTE_SENT", action: "Mark a quote sent (follow-up task)", who: "OWNER", enforcement: "ROUTE_CHECKS_OWNER", entryPoint: "quote save", writes: "task", finance: null, ledger: null, calendar: null, push: null, external: false, destructive: false, reversible: "YES", approvalClass: "STANDARD", futurePrimitive: "SHOW_QUOTE_FOLLOW_UP", routes: ["app/api/shows/[id]/quote-sent/route.ts"] }),
  X({ id: "EDIT_SHOW", action: "Edit show fields / status / client payment", who: "OWNER", enforcement: "ROUTE_CHECKS_OWNER", entryPoint: "form / pickers", writes: "show", finance: "re-sync (pipeline → delete rows)", ledger: "expected row re-derived / removed", calendar: "event update", push: null, external: true, destructive: false, reversible: "PARTIAL", approvalClass: "FINANCIAL", futurePrimitive: "UPDATE_SHOW / UPDATE_SHOW_STATUS", routes: [SI] }),
  X({ id: "ASSIGN_DJ", action: "Choose / change the DJ", who: "OWNER", enforcement: "ROUTE_CHECKS_OWNER", entryPoint: "form DJ picker", writes: "DJ id + name + confirmation reset", finance: "DJ row party", ledger: null, calendar: "description", push: null, external: false, destructive: false, reversible: "YES", approvalClass: "STANDARD", futurePrimitive: "ASSIGN_SHOW_DJ", routes: [SI] }),
  X({ id: "CLOSE_SHOW", action: "Close a show (done + who was paid)", who: "OWNER", enforcement: "ROUTE_CHECKS_OWNER", entryPoint: "close-show dialog", writes: "status בוצע, payments, DJ name, notes", finance: "per-party paid statuses", ledger: "artist INCOME (+ PAYMENT)", calendar: null, push: null, external: false, destructive: false, reversible: "PARTIAL", approvalClass: "FINANCIAL", futurePrimitive: "CLOSE_SHOW", routes: [SI] }),
  X({ id: "CANCEL_SHOW", action: "Cancel a show", who: "OWNER", enforcement: "ROUTE_CHECKS_OWNER", entryPoint: "'בטל הופעה'", writes: "status בוטל", finance: "rows → בוטל", ledger: "expected removed; realized kept", calendar: "event removed (hub)", push: null, external: true, destructive: false, reversible: "PARTIAL", approvalClass: "FINANCIAL", futurePrimitive: "CANCEL_SHOW", routes: [SI] }),
  X({ id: "DELETE_SHOW", action: "Delete a show (blocked while rehearsals exist)", who: "OWNER", enforcement: "ROUTE_CHECKS_OWNER", entryPoint: "hub trash", writes: "show + tasks (hub) deleted", finance: "rows hard-deleted", ledger: "expected removed; realized kept", calendar: "event removed (hub only)", push: null, external: true, destructive: true, reversible: "NO", approvalClass: "DESTRUCTIVE", futurePrimitive: "DELETE_SHOW", routes: [SI] }),
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
  { event: "CLOSE_SHOW", support: "SUPPORTED", concept: "close dialog", evidence: ["status בוצע", "per-party paid", "ledger rows"], missing: ["ledger when בוצע was set by a plain edit"] },
  { event: "SHOW_REOPENED", support: "PARTIAL", concept: "status change back", evidence: ["rows re-activated / deleted"], missing: ["ledger demotion (never happens)"] },
  { event: "SHOW_CANCELLED", support: "SUPPORTED", concept: "rows → בוטל, tasks cancelled, expected ledger removed", evidence: ["status", "rows"], missing: ["realized ledger reversal"] },
  { event: "SHOW_DELETED", support: "SUPPORTED", concept: "blocked with rehearsals; rows deleted", evidence: ["—"], missing: ["audit of the deleted show"] },
  { event: "ARTIST_LEDGER_SYNC", support: "PARTIAL", concept: "booking (Shalev) + close (any single roster artist)", evidence: ["ledger rows by show / artist-fee row"], missing: ["collaborations", "other artists at booking"] },
  { event: "POST_SHOW_PAYMENT", support: "PARTIAL", concept: "close dialog per-party paid; ledger payment", evidence: ["rows", "ledger payment"], missing: ["DJ / artist payout after close outside the dialog"] },
  { event: "SHOW_REMINDER", support: "NOT_SUPPORTED", concept: "no show reminder / cron exists", evidence: [], missing: ["any automatic show reminder"] },
];

export const SHOW_SIGNAL_MODEL: ReadonlyArray<{ code: string; kind: "CANONICAL_FACT" | "DERIVED_SIGNAL" | "UNKNOWN"; note: string }> = [
  { code: "UPCOMING", kind: "CANONICAL_FACT", note: "confirmed show with a future date" },
  { code: "PIPELINE", kind: "CANONICAL_FACT", note: "lead / quote status" },
  { code: "NO_DJ", kind: "CANONICAL_FACT", note: "no DJ recorded — never auto-filled with CLEANTONE" },
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
  { code: "DATE_PASSED_NOT_CLOSED", kind: "DERIVED_SIGNAL", note: "confirmed show whose date passed, not בוצע / בוטל" },
  { code: "DONE_WITHOUT_LEDGER", kind: "DERIVED_SIGNAL", note: "done show of a single roster artist with no ledger income (closed by a plain edit?)" },
  { code: "LEDGER_KEPT_AFTER_CANCEL", kind: "DERIVED_SIGNAL", note: "cancelled show that still has realized ledger income / payment" },
  { code: "ARTIST_ROW_UNPAID_AFTER_DONE", kind: "CANONICAL_FACT", note: "done show whose artist-fee row is still expected" },
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
    "העמודה 'שכר אמן' שמורה כ-0 בכל ההופעות — הסכום האמיתי נגזר ונמצא רק בשורת הכספים.",
    "הופעה אחת (03.09) מסומנת בוצע עם מחיר 0, בלי שורת הכנסה, עם שורת DJ של 0 ומשימה פתוחה.",
    "בשתי הופעות שבוצעו נרשמה הכנסה לאמן במאזן אבל שורת 'שכר אמן' בכספים עדיין צפוי — לא נרשם תשלום לאמן.",
    "הופעה של אבי (01.08) בוצעה ושולמה — אין לה שורת מאזן (נסגרה בלי דיאלוג הסגירה או לפני שהמנגנון קיים).",
    "מעולם לא נשלחה הודעה ל-DJ מהמערכת; 5 הופעות ללא סטטוס אישור (לפני מערכת האישורים).",
    "אין הופעות עתידיות רשומות.",
  ],
} as const;

/** Server-side show / DJ / ledger / notify files — a change must review this contract (internal). */
export const SHOW_REVIEWED_FILES = [
  "lib/shows-store.ts", "lib/shows-types.ts", "lib/shows-finance-sync.ts", "lib/artist-balance-show-sync.ts", "lib/artist-balance-show-sync-pure.ts", "lib/artist-balance-show-close-sync.ts",
  "lib/show-notify.ts", "lib/show-notify-pure.ts", "lib/dj-show-notify.ts", "lib/dj-confirm-notify.ts", "lib/show-quote-followup.ts", "lib/show-cancel-tasks.ts", "lib/red-artists/cleantone.ts",
  "app/api/shows/route.ts", "app/api/shows/[id]/route.ts",
] as const;
export const SHOW_REVIEWED_FINGERPRINTS: Readonly<Record<string, string>> = {
  "lib/shows-store.ts": "a53af88357604ae6120b9165275bc42ebd020c3fb691fd6ccdc4b062694acf09",
  "lib/shows-types.ts": "d97e5e51cd921bff4b0b604a5500e22933c339ad767a6847a63df844115dff29",
  "lib/shows-finance-sync.ts": "9160fc47886538a308f411d37018942d58a031378f16ced541ac9b9afe7f57be",
  "lib/artist-balance-show-sync.ts": "f50e003a0835783db4bd37049d602f4ff82a927cfdb0d3e31592301ddd503764",
  "lib/artist-balance-show-sync-pure.ts": "bf0bfad2538c4c10a907638e923d029b06f8b1c2eb1f03cf7997c66cf021a0a7",
  "lib/artist-balance-show-close-sync.ts": "f5dc1d4a95233d8db0a2eece60db8616e9f8ed7432ea9fa4ce1021dfe0ad6e46",
  "lib/show-notify.ts": "36d21aa31146c992d4a00302add47e9d44be5c88b98e1708309ba7650c650b46",
  "lib/show-notify-pure.ts": "a41ebb19cff070217271feab12a4c4d8cba12cdb76da469c2e01fbfccf8e46ec",
  "lib/dj-show-notify.ts": "4866f1caf5f53d3d0e221f4b4bd593361624a26e7e84a5f4087d864a27aedbf9",
  "lib/dj-confirm-notify.ts": "6f2542f077f0ac2fc4ddf64ba068faac9564cfc10e87838cec51a135d8e6c0e6",
  "lib/show-quote-followup.ts": "4ab61b81333b94c00556e7d188a4adbf5949c4d5ddc7267f62dda697877c3b17",
  "lib/show-cancel-tasks.ts": "b182fd76f8826168b266b667c7b603c340ea7aaa542f048fa39d75a8619da891",
  "lib/red-artists/cleantone.ts": "ca64bf791b7d13822a5fc29eb541f276e08dedcf1d7d77270f5a9b9c22edf5cf",
  "app/api/shows/route.ts": "4aad6a055b7193dc00f4a67424913affeb24af3d00dbb13ffe33bdb7ecd2dfc8",
  "app/api/shows/[id]/route.ts": "d543ac125672f8d66c65dcd2326f80c4112158f409dd0f316f090771fe49fe42",
};

/** Route families touching shows (internal — the test re-discovers routes). */
export const SHOW_ROUTE_GROUPS: ReadonlyArray<{ pattern: string; purpose: string }> = [
  { pattern: "^app/api/shows/", purpose: "shows CRUD, close, notify artist / DJ, quote follow-up" },
  { pattern: "^app/api/red-artists/cleantone(-summary|/)", purpose: "DJ portal: summary, confirm / unconfirm, presence ping, push registration, profile image, streaming" },
  { pattern: "^app/api/tasks/route\\.ts$", purpose: "tasks carry an optional show id (no-DJ task, quote follow-up)" },
  { pattern: "^app/api/label/artists/\\[id\\]/balance/cycles/remind/", purpose: "cycle reminder maps artists (incl. CLEANTONE) to push roles" },
  { pattern: "^app/api/(red-artists/shalev-summary|label/artists/\\[id\\]/(summary|shows|recoup|weekly)|red-artists/weekly)/", purpose: "portal / label views that read shows" },
  { pattern: "^app/api/sessions/", purpose: "rehearsals (show id) → rehearsal finance + show re-sync" },
];
