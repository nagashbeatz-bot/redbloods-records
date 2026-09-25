/**
 * Sunny System Awareness — RED FILMS + CLIP / VIDEO DEEP CONTRACT (video production as Redbloods actually implements it).
 *
 * Produced by the Red Films + Clip Deep Brain discovery (2026-09-25). Sources:
 *   - the Red Films pages, drawer, budget / payments / documents / references / tasks / equipment components;
 *   - the Red Films routes and the project clip routes (clip deal, clip payments, send clip);
 *   - the clip planning rows + promote, the clip-finance / clip-production / label-clips modules;
 *   - shoot days (clip sessions) + calendar, the Finance / Insights / agent / COO / week-summary consumers;
 *   - the live production schema and read-only production counts.
 * Pure data; served through system_awareness mode red_films_model. The served text is semantic only: the schema pin,
 * route lists and reviewed files are internal.
 */
import type { ApprovalClass, Enforcement, Who } from "./project-actions";

export const RED_FILMS_BASELINE_VERSION = "2026.09.25-rf-1";

/** Live production columns of the video tables (2026-09-25) — internal, pinned by the test. */
export const RF_SCHEMA: Readonly<Record<string, readonly string[]>> = {
  red_films_productions: ["id", "title", "production_type", "status", "project_id", "client_id", "artist_name", "client_name", "client_source", "photographer_name", "director_name", "editor_name", "shoot_date", "locations", "concept_summary", "concept_vibe", "ref_links", "script_start", "script_middle", "script_end", "director_notes", "photographer_notes", "general_budget", "client_price", "advance_required", "advance_received", "collection_status", "files_raw_link", "files_edit_folder", "version_1_link", "version_2_link", "final_version_link", "fix_notes", "edit_status", "publish_date", "published_where", "notes", "created_at", "updated_at", "dropbox_folder_path", "dropbox_folder_url"],
  red_films_budget_items: ["id", "production_id", "title", "category", "planned_amount", "actual_amount", "vendor_name", "status", "linked_transaction_id", "notes", "created_at", "updated_at"],
  red_films_budget_payments: ["id", "production_id", "budget_item_id", "amount", "payment_date", "payment_method", "notes", "receipt_file_name", "receipt_mime_type", "receipt_dropbox_path", "receipt_dropbox_url", "created_at", "updated_at"],
  red_films_crew: ["id", "production_id", "name", "role", "contact", "arrival_time", "confirmation_status", "payment_amount", "payment_status", "notes", "created_at", "updated_at"],
  red_films_documents: ["id", "production_id", "file_name", "file_type", "mime_type", "dropbox_path", "dropbox_url", "notes", "created_at", "updated_at"],
  red_films_equipment: ["id", "name", "category", "quantity", "acquired_date", "purchase_price", "purchased_from", "serial_number", "notes", "added_by", "status", "removed_at", "created_at", "updated_at"],
  red_films_reference_images: ["id", "production_id", "file_name", "dropbox_path", "dropbox_url", "caption", "tag", "sort_order", "created_at", "updated_at"],
  red_films_reference_links: ["id", "production_id", "url", "provider", "video_id", "title", "thumbnail_url", "notes", "created_at", "updated_at"],
  red_films_scenes: ["id", "production_id", "sort_order", "title", "location", "description", "participants", "status", "notes", "created_at", "updated_at"],
  clip_items: ["id", "project_id", "category", "description", "amount", "currency", "status", "linked_transaction_id", "notes", "created_at", "updated_at"],
};
/** Served entity → stored table (internal). */
export const RF_ENTITY_TABLE: Readonly<Record<string, string>> = { production: "red_films_productions", budget_item: "red_films_budget_items", budget_payment: "red_films_budget_payments", crew_row: "red_films_crew", document: "red_films_documents", equipment: "red_films_equipment", reference_image: "red_films_reference_images", reference_link: "red_films_reference_links", scene: "red_films_scenes", clip_item: "clip_items" };
/** Settings keys / JSON keys that carry video meaning (internal). */
export const RF_SETTINGS_KEYS = ["finance_<projectId>.clipAgreedPrice", "finance_<projectId>.clipProductionId"] as const;

export type FieldClass = "CANONICAL" | "DERIVED" | "DISPLAY_ONLY" | "LEGACY" | "AMBIGUOUS" | "POSSIBLE_BUG" | "CONFLICT" | "SECRET_LINK";
export interface RfField { entity: string; field: string; classification: FieldClass; meaning: string; writers: string; readers: string; history: string; sunnyReads: string }
const F = (entity: string, field: string, classification: FieldClass, meaning: string, o: Partial<RfField> = {}): RfField =>
  ({ entity, field, classification, meaning, writers: "Owner (Red Films page / drawer)", readers: "Red Films UI, Partner", history: "no change history (updated time only)", sunnyReads: "video_view", ...o });
const P = "production", BI = "budget_item", BP = "budget_payment", CR = "crew_row", D = "document", E = "equipment", RI = "reference_image", RL = "reference_link", SC = "scene", CI = "clip_item";
const LINK = "a PUBLIC storage link (bearer access material) — Sunny sees only that it exists";

export const RF_FIELDS: readonly RfField[] = [
  // ── production (the Red Films work unit) ──
  F(P, "id", "CANONICAL", "Red Films production identity — the video work unit.", { history: "—" }),
  F(P, "title", "CANONICAL", "Production title (the project name when created by 'שלח קליפ')."),
  F(P, "production_type", "CANONICAL", "קליפ / יום צילום / תוכן סושיאל / צילום הופעה / צילום סטודיו / מאחורי הקלעים / פרסומת / ויזואלייזר / צילום לייב / אחר. 2 production rows carry an unreadable (encoding-damaged) type."),
  F(P, "status", "CANONICAL", "רעיון → הצעה נשלחה → ממתין לאישור → בתכנון → יום צילום נקבע → צולם → חומרי גלם הועלו → בעריכה → נשלחה גרסה → תיקונים → מאושר → פורסם, or בוטל. Manual; no transition is enforced; no status history."),
  F(P, "project_id", "CANONICAL", "The music project (optional; 10 of 14 carry one). Several productions per project are allowed (no unique guard)."),
  F(P, "client_id", "AMBIGUOUS", "Client id — filled by matching the artist NAME to a client (send clip / new-production modal), so a TEXT_MATCH stored as an id."),
  F(P, "artist_name", "CANONICAL", "Artist text (copied from the project); the label recoup matches artists by this name."),
  F(P, "client_name", "DERIVED", "Client name snapshot at creation."),
  F(P, "client_source", "POSSIBLE_BUG", "פנימי - לייבל / לקוח חיצוני / אמן לייבל / פרויקט שיווקי / אחר — 'שלח קליפ' ALWAYS writes פנימי - לייבל, even for a client project (all 14 production rows say פנימי - לייבל)."),
  F(P, "photographer_name", "CANONICAL", "Photographer — FREE TEXT (no person record)."),
  F(P, "director_name", "CANONICAL", "Director — free text."),
  F(P, "editor_name", "CANONICAL", "Editor — free text."),
  F(P, "shoot_date", "CANONICAL", "ONE planned shoot date on the production (separate from the project's clip shoot sessions). A passed date does not mean 'shot' — only the status says צולם."),
  F(P, "locations", "CANONICAL", "Locations text."),
  F(P, "concept_summary", "CANONICAL", "Concept."), F(P, "concept_vibe", "CANONICAL", "Vibe."),
  F(P, "ref_links", "CANONICAL", "Reference links text (a boolean for Sunny)."),
  F(P, "script_start", "CANONICAL", "Script — opening."), F(P, "script_middle", "CANONICAL", "Script — middle."), F(P, "script_end", "CANONICAL", "Script — ending."),
  F(P, "director_notes", "CANONICAL", "Director notes."), F(P, "photographer_notes", "CANONICAL", "Photographer notes."),
  F(P, "general_budget", "CANONICAL", "The production BUDGET (planning ceiling, no currency column — ₪ assumed by the UI). For a production created by 'שלח קליפ' it mirrors the project's clip price one-way and is locked; legacy productions keep their own. The label recoup uses it (50/50 split)."),
  F(P, "client_price", "CANONICAL", "What the client pays for the production (Red Films' own deal, not Finance)."),
  F(P, "advance_required", "CANONICAL", "Advance required from the client."), F(P, "advance_received", "CANONICAL", "Advance received (manual, not from Finance)."),
  F(P, "collection_status", "CANONICAL", "לא רלוונטי / צפוי / התקבל / שולם / לא שולם / חלקי / בוטל — collection from the client, manual."),
  F(P, "files_raw_link", "SECRET_LINK", `Raw footage link — ${LINK}.`), F(P, "files_edit_folder", "SECRET_LINK", `Edit folder link — ${LINK}.`),
  F(P, "version_1_link", "SECRET_LINK", `Edit version 1 link — ${LINK}. The only 'version' record.`), F(P, "version_2_link", "SECRET_LINK", `Edit version 2 link — ${LINK}.`),
  F(P, "final_version_link", "SECRET_LINK", `Final video link — ${LINK}. Its existence is the only 'final video' evidence.`),
  F(P, "fix_notes", "CANONICAL", "Revision notes for the editor — the only recorded video feedback."),
  F(P, "edit_status", "CANONICAL", "לא התחיל / חומרי גלם הועלו / בעריכה / נשלחה גרסה 1 / תיקונים / מאושר / פורסם — editing state, manual, independent of status."),
  F(P, "publish_date", "CANONICAL", "Publish date (0 set in production)."), F(P, "published_where", "CANONICAL", "Where it was published (text)."),
  F(P, "notes", "CANONICAL", "Production notes."),
  F(P, "created_at", "CANONICAL", "Created."), F(P, "updated_at", "CANONICAL", "Updated (any change)."),
  F(P, "dropbox_folder_path", "CANONICAL", "The production storage folder (created on demand)."), F(P, "dropbox_folder_url", "SECRET_LINK", `Folder link — ${LINK}.`),
  // ── budget item (Red Films planning + payments) ──
  F(BI, "id", "CANONICAL", "A Red Films budget line.", { history: "—" }), F(BI, "production_id", "CANONICAL", "Owning production."),
  F(BI, "title", "CANONICAL", "Line title."), F(BI, "category", "CANONICAL", "צלם / ציוד / לוקיישן / תלבושות / סטיילינג / פוסט פרודקשן / שחקנים / מודלים / קייטרינג / הובלה / לוגיסטיקה / שיווק / אחר."),
  F(BI, "planned_amount", "CANONICAL", "PLANNED cost (no currency column — ₪ assumed)."),
  F(BI, "actual_amount", "CONFLICT", "A manual 'actual' number; the UI shows paid = the SUM of the line's payments instead. Production: actual 1,800 vs payments 4,355."),
  F(BI, "vendor_name", "CANONICAL", "Vendor — free text (0 set in production)."),
  F(BI, "status", "CANONICAL", "מתוכנן / שולם / בוטל (manual). The UI also shows 'paid' when payments reach 99% of the plan (display rule)."),
  F(BI, "linked_transaction_id", "LEGACY", "Never written — Red Films lines never reach Finance (0 set)."),
  F(BI, "notes", "CANONICAL", "Notes."), F(BI, "created_at", "CANONICAL", "Created."), F(BI, "updated_at", "CANONICAL", "Updated."),
  // ── budget payment (Red Films' own ledger) ──
  F(BP, "id", "CANONICAL", "A payment made against a budget line — Red Films' OWN ledger, never a Finance transaction.", { history: "—" }),
  F(BP, "production_id", "CANONICAL", "Production."), F(BP, "budget_item_id", "CANONICAL", "The budget line paid."),
  F(BP, "amount", "CANONICAL", "Amount (no currency column — ₪ assumed; > 0 enforced)."), F(BP, "payment_date", "CANONICAL", "Paid on."),
  F(BP, "payment_method", "CANONICAL", "ביט / העברה בנקאית / כרטיס אשראי / מזומן …"), F(BP, "notes", "CANONICAL", "Notes."),
  F(BP, "receipt_file_name", "CANONICAL", "Receipt file name."), F(BP, "receipt_mime_type", "CANONICAL", "Receipt type."),
  F(BP, "receipt_dropbox_path", "CANONICAL", "Receipt storage path (internal)."), F(BP, "receipt_dropbox_url", "SECRET_LINK", `Receipt link — ${LINK}.`),
  F(BP, "created_at", "CANONICAL", "Recorded."), F(BP, "updated_at", "CANONICAL", "Updated."),
  // ── crew table (unused) ──
  F(CR, "id", "LEGACY", "A crew row — the table exists but NO code reads or writes it (0 rows). Crew is the three free-text names on the production.", { writers: "nobody", readers: "nobody (bulk delete mentions it as future work)" }),
  ...["production_id", "name", "role", "contact", "arrival_time", "confirmation_status", "payment_amount", "payment_status", "notes", "created_at", "updated_at"].map((f) => F(CR, f, "LEGACY", `Crew ${f.replace(/_/g, " ")} — unused table (0 rows, no code).`, { writers: "nobody", readers: "nobody" })),
  // ── document ──
  F(D, "id", "CANONICAL", "A production document.", { history: "—" }), F(D, "production_id", "CANONICAL", "Owning production."),
  F(D, "file_name", "CANONICAL", "File name."), F(D, "file_type", "CANONICAL", "תסריט / בריף / שוט ליסט / לו״ז צילום / אישור / חוזה / ציוד / אחר (UI list; free text in the database)."),
  F(D, "mime_type", "CANONICAL", "MIME type."), F(D, "dropbox_path", "CANONICAL", "Storage path (internal; preview / download stream it server-side)."),
  F(D, "dropbox_url", "SECRET_LINK", `Created at upload — ${LINK}.`), F(D, "notes", "CANONICAL", "Notes."), F(D, "created_at", "CANONICAL", "Uploaded."), F(D, "updated_at", "CANONICAL", "Updated."),
  // ── equipment (company-level, not per production) ──
  F(E, "id", "CANONICAL", "A Red Films equipment item (company inventory, not linked to productions).", { history: "—" }),
  F(E, "name", "CANONICAL", "Item name."), F(E, "category", "CANONICAL", "מצלמות / עדשות / ייצוב / תאורה / סאונד / אביזרים / אחר."), F(E, "quantity", "CANONICAL", "Quantity."),
  F(E, "acquired_date", "CANONICAL", "Acquired."), F(E, "purchase_price", "CANONICAL", "Price paid (no currency; not Finance)."), F(E, "purchased_from", "CANONICAL", "Seller."),
  F(E, "serial_number", "CANONICAL", "Serial number (asset identity, not a secret)."), F(E, "notes", "CANONICAL", "Notes."), F(E, "added_by", "CANONICAL", "Who added it (text)."),
  F(E, "status", "CANONICAL", "Item status."), F(E, "removed_at", "CANONICAL", "Soft remove."), F(E, "created_at", "CANONICAL", "Created."), F(E, "updated_at", "CANONICAL", "Updated."),
  // ── reference image ──
  F(RI, "id", "CANONICAL", "A reference image (mood board).", { history: "—" }), F(RI, "production_id", "CANONICAL", "Production."), F(RI, "file_name", "CANONICAL", "File name."),
  F(RI, "dropbox_path", "CANONICAL", "Storage path (internal)."), F(RI, "dropbox_url", "SECRET_LINK", `Thumbnail / image link — ${LINK}.`), F(RI, "caption", "CANONICAL", "Caption."),
  F(RI, "tag", "CANONICAL", "Location tag (כללי / טיילת בערב / רכב / מונית / בר / מועדון / חוף / דירה …)."), F(RI, "sort_order", "DISPLAY_ONLY", "Board order."), F(RI, "created_at", "CANONICAL", "Added."), F(RI, "updated_at", "CANONICAL", "Updated."),
  // ── reference link ──
  F(RL, "id", "CANONICAL", "A reference video link (YouTube).", { history: "—" }), F(RL, "production_id", "CANONICAL", "Production."), F(RL, "url", "CANONICAL", "The public video URL (a public reference, not company material)."),
  F(RL, "provider", "CANONICAL", "Provider."), F(RL, "video_id", "CANONICAL", "Provider video id."), F(RL, "title", "CANONICAL", "Title."), F(RL, "thumbnail_url", "DISPLAY_ONLY", "Thumbnail."),
  F(RL, "notes", "CANONICAL", "Notes."), F(RL, "created_at", "CANONICAL", "Added."), F(RL, "updated_at", "CANONICAL", "Updated."),
  // ── scenes (unused) ──
  F(SC, "id", "LEGACY", "A scene row — the table exists but NO code reads or writes it (0 rows).", { writers: "nobody", readers: "nobody" }),
  ...["production_id", "sort_order", "title", "location", "description", "participants", "status", "notes", "created_at", "updated_at"].map((f) => F(SC, f, "LEGACY", `Scene ${f.replace(/_/g, " ")} — unused table (0 rows, no code).`, { writers: "nobody", readers: "nobody" })),
  // ── clip item (project clip planning) ──
  F(CI, "id", "CANONICAL", "A clip PLANNING row on a project (project drawer קליפ tab).", { history: "—" }), F(CI, "project_id", "CANONICAL", "The project."),
  F(CI, "category", "CANONICAL", "צילום קליפ / עריכת קליפ / ציוד צילום / תאורה / לוקיישן / דוגמניות / משתתפים / איפור / סטיילינג / הסעות / אוכל / הפקה / אביזרים / אחר."),
  F(CI, "description", "CANONICAL", "Description."), F(CI, "amount", "CANONICAL", "PLANNED amount (planning — never money spent)."), F(CI, "currency", "CANONICAL", "Currency (₪ default)."),
  F(CI, "status", "CANONICAL", "תכנון בלבד (new rows); הועבר לכספים only on OLDER rows — today 'העבר לכספים' creates the expense and DELETES the row."),
  F(CI, "linked_transaction_id", "LEGACY", "Set only on older promoted rows (the current promote deletes the row). The 1 production row points at a transaction that no longer exists."),
  F(CI, "notes", "CANONICAL", "Notes."), F(CI, "created_at", "CANONICAL", "Created."), F(CI, "updated_at", "CANONICAL", "Updated."),
];

export const RF_VOCABULARIES = {
  productionStatus: ["רעיון", "הצעה נשלחה", "ממתין לאישור", "בתכנון", "יום צילום נקבע", "צולם", "חומרי גלם הועלו", "בעריכה", "נשלחה גרסה", "תיקונים", "מאושר", "פורסם", "בוטל"],
  productionType: ["קליפ", "יום צילום", "תוכן סושיאל", "צילום הופעה", "צילום סטודיו", "מאחורי הקלעים", "פרסומת", "ויזואלייזר", "צילום לייב", "אחר"],
  collectionStatus: ["לא רלוונטי", "צפוי", "התקבל", "שולם", "לא שולם", "חלקי", "בוטל"],
  editStatus: ["לא התחיל", "חומרי גלם הועלו", "בעריכה", "נשלחה גרסה 1", "תיקונים", "מאושר", "פורסם"],
  clientSource: ["פנימי - לייבל", "לקוח חיצוני", "אמן לייבל", "פרויקט שיווקי", "אחר"],
  budgetItemStatus: ["מתוכנן", "שולם", "בוטל"],
  budgetItemCategory: ["צלם", "ציוד", "לוקיישן", "תלבושות / סטיילינג", "פוסט פרודקשן", "שחקנים / מודלים", "קייטרינג", "הובלה / לוגיסטיקה", "שיווק", "אחר"],
  documentType: ["תסריט", "בריף", "שוט ליסט", "לו״ז צילום", "אישור / חוזה", "ציוד", "אחר"],
  equipmentCategory: ["מצלמות", "עדשות", "ייצוב", "תאורה", "סאונד", "אביזרים", "אחר"],
  clipItemCategory: ["צילום קליפ", "עריכת קליפ", "ציוד צילום", "תאורה", "לוקיישן", "דוגמניות / משתתפים", "איפור / סטיילינג", "הסעות", "אוכל / הפקה", "אביזרים", "אחר"],
  clipDealStatus: ["אין עסקה", "ממתין", "חלקי", "שולם", "יתרת זכות"],
  clipPaymentStatus: ["התקבל", "שולם", "צפוי", "לא שולם", "בוטל"],
} as const;

export const DOMAIN_MODEL = {
  twoSystems: "Video lives in TWO connected systems: (1) the PROJECT clip deal — a clip price the artist pays (project finance settings), clip payments = INCOME transactions with expense scope קליפ, clip planning rows, clip shoot days (sessions), clip expenses (expense scope קליפ); (2) RED FILMS — productions with their own status, crew names, budget lines + payments (a separate ledger), documents, references, tasks, links. They meet on the production's project id.",
  workUnit: "Red Films work unit = the production. Project video unit = the project's clip deal + clip rows + shoot sessions + clip-scoped transactions. Neither implies the other: a project can have clip data and no production; a production can have no project.",
  projectType: "there is no 'קליפ' project type: 'שיר + קליפ' is the type a song gets when a clip deal is seeded (1 project in production). A clip is never a separate top-level project.",
  sendClip: "'שלח קליפ' (Owner): creates a Red Films production (type קליפ, status רעיון, the project's name / artist, client matched by artist NAME, client source פנימי - לייבל, budget = the clip price) and records it as the project's MANAGED production (the budget then follows the clip price one-way and is locked in Red Films). Idempotent by lookup twice (no database unique guard); cancelled productions do not block a new one. Production: 0 managed productions — every production predates the flow.",
  equipment: "company inventory of cameras / lenses / lights … (8 items) — not per production.",
} as const;

export const STATUS_MODEL = {
  productionStatus: "13 manual statuses (see vocabularies); nothing enforces the order; no status history; cancelling a production cancels its future / undated tasks (+ Google Tasks).",
  editStatus: "a separate manual editing state; it can disagree with the status.",
  collection: "the client collection status is manual and separate from Finance.",
  lifecycleRecorded: "recorded phases: the status, the edit status, shoot date, link fields (raw / edit / version 1 / version 2 / final), publish date / where. NOT recorded: when each phase happened, who reviewed, footage received time, delivery.",
  consistency: "project status, production status, edit status, shoot date and sessions are independent — contradictions are shown, never resolved (production: 2 active productions still רעיון while their shoot dates passed and a shoot session התקיים).",
} as const;

export const MONEY_MODEL = {
  layers: [
    "PLANNED_BUDGET: the production budget (ceiling), budget lines' planned amounts, clip planning rows (all planning — never 'spent')",
    "RED_FILMS_PAID: budget payments = Red Films' own ledger (never in Finance)",
    "ACTUAL_EXPENSE: Finance expenses with expense scope קליפ (from 'העבר לכספים', a shoot-day expense, or a manual Finance entry) — canonical once they exist",
    "PAID_EXPENSE: an expense with status שולם (חלקי = partial; התקבל = invalid for an expense)",
    "CLIP_DEAL_INCOME: the artist's clip payments (INCOME with scope קליפ) vs the clip price — revenue, never an expense",
  ],
  promote: "'העבר לכספים' on a clip planning row: an expense (project scope, status לא שולם, expense scope קליפ, amount + currency of the row, the date chosen) is created and the ROW IS DELETED — so the plan and the expense never coexist (no double count), but the plan's history is gone. Guard: a row already carrying a transaction link returns 409; no atomic claim (a double click could create two expenses). No Owner check in the route (proxy only).",
  shootExpense: "adding a shoot day can optionally create an expense (status לא שולם, category צילום קליפ, expense scope קליפ, linked to the session).",
  noDoubleCount: "Sunny never adds a planning row / budget line to an expense; Red Films payments are shown apart from Finance; a clip expense and a Red Films payment for the same vendor are 'possible duplicate evidence', never summed.",
  currency: "clip rows and Finance carry a currency (₪ default); Red Films budget / lines / payments / client price have NO currency column (₪ assumed by the UI) — Sunny labels them 'currency not recorded' and never converts.",
  clipDeal: "clip deal status: אין עסקה / ממתין / חלקי / שולם / יתרת זכות; remaining = max(0, price − received), overpayment = credit. Clip income is excluded from the song's balance.",
  recoup: "label recoup: every ACTIVE (not cancelled) production of type קליפ whose artist text includes the artist's name contributes half of its BUDGET (planned, not actual) as the artist's recoup target — a name match on planned money.",
} as const;

export const CREW_MODEL = {
  representation: "photographer / director / editor = three FREE-TEXT names on the production; a shoot session carries a free-text photographer; budget lines carry a free-text vendor. The crew table and the scenes table exist but are unused (0 rows, no code).",
  identity: "no person record, no link to clients — every crew name is TEXT_MATCH at best; Sunny never merges names.",
  money: "crew pay is recorded only as budget lines / payments (Red Films ledger) or Finance expenses — no per-person agreed price.",
} as const;

export const SHOOT_MODEL = {
  shootDay: "a shoot day = a SESSION of type צילום קליפ on the project: date, start / end, status (מתוכנן / התקיים / בוטל / נדחה / לא הגיע), photographer (text), location (text), cost (not written by the UI), a calendar event id when added to Google Calendar (title 'צילום קליפ: <project> — <artist> (<photographer>)').",
  multiple: "a project can have several shoot days; the production also has its own single shoot date — two separate concepts.",
  completed: "only the session status התקיים or the production status צולם says a shoot happened — a passed date never does.",
  calendar: "the calendar event id is the only canonical calendar link; the live event is read through the calendar capability (unreadable = UNKNOWN, never 'no event').",
  preparation: "recorded preparation: crew names, locations, scenes (unused), documents (script / brief / shot list / schedule / contract / equipment), references, tasks, budget. No readiness checklist exists — Sunny reports what is missing, never 'not ready'.",
} as const;

export const FILES_MODEL = {
  storage: "a production storage folder (created on demand) holds documents, references, receipts; the raw / edit / version / final links are pasted links (public). Sunny reads the records only — storage listing is a capability gap.",
  documents: "documents: file name, type, MIME, notes, upload time; preview / download stream server-side (Owner via the central gate); upload ALSO creates a public link.",
  footage: "raw footage is only a pasted link on the production; no footage record — 'no link' ≠ 'no footage'.",
  versions: "editing versions = version 1 / version 2 / final link fields + edit status + fix notes. No version records, no comments, no review history.",
  delivery: "no video delivery record (the project delivery is the music delivery); the final link is the only final-video evidence.",
  publication: "publish date + where on the production (0 set); social content items can carry a posted URL / publish date per project — not linked to productions.",
} as const;

export const OTHER_CONSUMERS = {
  finance: "Finance / Insights / project views separate clip income (expense scope קליפ) from the song's income; the expense scope list offers קליפ for manual entries.",
  label: "label recoup targets come from active clip productions' budgets (name match, 50/50).",
  weekSummary: "the weekly week-strength summary counts production shoot dates (non-cancelled).",
  agent: "the AI chat context lists a project's clip shoot days; agent rules read clip scope.",
  coo: "COO facts read clip money.",
  artistPortal: "the artist portal shows a 'נקבע צילום קליפ' update for a clip shoot session.",
  tasks: "production tasks are CANONICAL (related type red_film_production + the production id; optional Google Task); 2 in production.",
  pushes: "no Red Films / clip push exists; page loads write nothing video-related.",
  agentAlerts: "no video alert type exists.",
} as const;

export interface RfActionEntry { id: string; action: string; who: Who; enforcement: Enforcement; writes: string; finance: string | null; calendar: string | null; files: string | null; project: string | null; destructive: boolean; reversible: "YES" | "PARTIAL" | "NO"; approvalClass: ApprovalClass; sunnyToday: "KNOWLEDGE_ONLY"; futurePrimitive: string; internal: { routes: readonly string[] } }
type RA = Omit<RfActionEntry, "sunnyToday" | "internal"> & { routes: readonly string[] };
const X = (e: RA): RfActionEntry => { const { routes, ...rest } = e; return { ...rest, sunnyToday: "KNOWLEDGE_ONLY", internal: { routes } }; };
const RF = "app/api/red-films", PC = "app/api/projects/[id]/clip", CL = "app/api/clip-items";
export const RF_ACTIONS: readonly RfActionEntry[] = [
  X({ id: "CREATE_PRODUCTION", action: "Create a Red Films production (new-production modal)", who: "OWNER", enforcement: "PROXY_ONLY", writes: "production", finance: null, calendar: null, files: null, project: "optional link", destructive: false, reversible: "YES", approvalClass: "STANDARD", futurePrimitive: "CREATE_VIDEO_PRODUCTION", routes: [`${RF}/productions/route.ts`] }),
  X({ id: "SEND_CLIP", action: "'שלח קליפ' — create / return the project's managed clip production", who: "OWNER", enforcement: "ROUTE_CHECKS_OWNER", writes: "production + the managed marker in the project's finance settings", finance: "budget = clip price", calendar: null, files: null, project: "managed link", destructive: false, reversible: "PARTIAL", approvalClass: "STANDARD", futurePrimitive: "SEND_CLIP_TO_RED_FILMS", routes: [`${PC}/send/route.ts`] }),
  X({ id: "EDIT_PRODUCTION", action: "Edit a production (status, edit status, crew names, dates, concept, script, budget unless managed, client price, links, publish)", who: "OWNER", enforcement: "PROXY_ONLY", writes: "production", finance: null, calendar: null, files: null, project: null, destructive: false, reversible: "PARTIAL", approvalClass: "STANDARD", futurePrimitive: "UPDATE_VIDEO_PRODUCTION", routes: [`${RF}/productions/[id]/route.ts`] }),
  X({ id: "CANCEL_PRODUCTION", action: "Cancel a production (status בוטל)", who: "OWNER", enforcement: "PROXY_ONLY", writes: "status + its future / undated tasks cancelled", finance: null, calendar: "Google Tasks deleted", files: null, project: null, destructive: false, reversible: "PARTIAL", approvalClass: "EXTERNAL_EFFECT", futurePrimitive: "CANCEL_VIDEO_PRODUCTION", routes: [`${RF}/productions/[id]/route.ts`] }),
  X({ id: "BULK_DELETE_PRODUCTIONS", action: "Permanently delete productions (bulk)", who: "OWNER", enforcement: "PROXY_ONLY", writes: "productions + references + budget lines + tasks deleted (payments / documents / folders may remain)", finance: null, calendar: "Google Tasks", files: "reference files", project: null, destructive: true, reversible: "NO", approvalClass: "DESTRUCTIVE", futurePrimitive: "DELETE_VIDEO_PRODUCTION", routes: [`${RF}/productions/bulk-permanent-delete/route.ts`] }),
  X({ id: "BUDGET_LINES", action: "Add / edit / delete a budget line", who: "OWNER", enforcement: "PROXY_ONLY", writes: "budget line", finance: null, calendar: null, files: null, project: null, destructive: true, reversible: "PARTIAL", approvalClass: "FINANCIAL", futurePrimitive: "—", routes: [`${RF}/productions/[id]/budget-items/route.ts`, `${RF}/budget-items/[itemId]/route.ts`] }),
  X({ id: "BUDGET_PAYMENTS", action: "Record / edit / delete a payment on a budget line (+ receipt upload)", who: "OWNER", enforcement: "PROXY_ONLY", writes: "Red Films payment (NOT Finance)", finance: "none (separate ledger)", calendar: null, files: "receipt upload + public link", project: null, destructive: true, reversible: "PARTIAL", approvalClass: "FINANCIAL", futurePrimitive: "—", routes: [`${RF}/budget-items/[itemId]/payments/route.ts`, `${RF}/budget-payments/[paymentId]/route.ts`, `${RF}/budget-payments/[paymentId]/receipt/route.ts`] }),
  X({ id: "DOCUMENTS", action: "Upload / delete a document", who: "OWNER", enforcement: "PROXY_ONLY", writes: "document", finance: null, calendar: null, files: "storage upload (+ public link) / delete", project: null, destructive: true, reversible: "NO", approvalClass: "DESTRUCTIVE", futurePrimitive: "—", routes: [`${RF}/productions/[id]/documents/upload/route.ts`, `${RF}/documents/[docId]/route.ts`] }),
  X({ id: "REFERENCES", action: "Add / edit / delete reference images and video links", who: "OWNER", enforcement: "PROXY_ONLY", writes: "references", finance: null, calendar: null, files: "image upload (+ public thumbnail link) / delete", project: null, destructive: true, reversible: "NO", approvalClass: "STANDARD", futurePrimitive: "—", routes: [`${RF}/productions/[id]/references/upload/route.ts`, `${RF}/references/[refId]/route.ts`, `${RF}/productions/[id]/reference-links/route.ts`, `${RF}/reference-links/[linkId]/route.ts`] }),
  X({ id: "STORAGE_FOLDER", action: "Create the production storage folder", who: "OWNER", enforcement: "PROXY_ONLY", writes: "folder path + link", finance: null, calendar: null, files: "storage folder", project: null, destructive: false, reversible: "YES", approvalClass: "EXTERNAL_EFFECT", futurePrimitive: "—", routes: [`${RF}/productions/[id]/dropbox-folder/route.ts`] }),
  X({ id: "EQUIPMENT", action: "Add / edit / remove equipment", who: "OWNER", enforcement: "ROUTE_CHECKS_OWNER", writes: "equipment", finance: null, calendar: null, files: null, project: null, destructive: false, reversible: "YES", approvalClass: "STANDARD", futurePrimitive: "—", routes: [`${RF}/equipment/route.ts`, `${RF}/equipment/[id]/route.ts`] }),
  X({ id: "CLIP_PRICE", action: "Set the project's clip price (syncs a managed production's budget)", who: "OWNER", enforcement: "ROUTE_CHECKS_OWNER", writes: "project finance settings", finance: "clip deal price", calendar: null, files: null, project: "managed production budget", destructive: false, reversible: "YES", approvalClass: "FINANCIAL", futurePrimitive: "SET_CLIP_PRICE", routes: [`${PC}/route.ts`] }),
  X({ id: "CLIP_PAYMENTS", action: "Add clip payments (seed 50/50 advance + final, or one payment)", who: "OWNER", enforcement: "ROUTE_CHECKS_OWNER", writes: "INCOME transactions (expense scope קליפ)", finance: "clip income", calendar: null, files: null, project: "a שיר becomes שיר + קליפ", destructive: false, reversible: "PARTIAL", approvalClass: "FINANCIAL", futurePrimitive: "RECORD_CLIP_PAYMENT", routes: [`${PC}/payments/route.ts`] }),
  X({ id: "CLIP_ROWS", action: "Add / edit / delete a clip planning row", who: "OWNER", enforcement: "PROXY_ONLY", writes: "clip planning row", finance: null, calendar: null, files: null, project: null, destructive: true, reversible: "PARTIAL", approvalClass: "STANDARD", futurePrimitive: "—", routes: [`${CL}/route.ts`, `${CL}/[id]/route.ts`] }),
  X({ id: "PROMOTE_CLIP_ROW", action: "'העבר לכספים' — clip planning row → Finance expense (row deleted)", who: "OWNER", enforcement: "PROXY_ONLY", writes: "expense (לא שולם, scope קליפ) + the row deleted", finance: "actual expense", calendar: null, files: null, project: null, destructive: true, reversible: "NO", approvalClass: "FINANCIAL", futurePrimitive: "PROMOTE_CLIP_PLAN", routes: [`${CL}/[id]/promote/route.ts`] }),
];
/** Read-only Red Films routes (internal). */
export const RF_READ_ROUTES = [`${RF}/productions/[id]/budget-payments/route.ts`, `${RF}/productions/[id]/documents/route.ts`, `${RF}/documents/[docId]/preview/route.ts`, `${RF}/productions/[id]/references/route.ts`, `${RF}/references/thumbnail/route.ts`] as const;

export interface RfWorkflow { event: string; support: "SUPPORTED" | "PARTIAL" | "NOT_SUPPORTED"; concept: string; missing: string[] }
export const RF_WORKFLOWS: readonly RfWorkflow[] = [
  { event: "CREATE_VIDEO_WORK", support: "SUPPORTED", concept: "a production (modal) or a project clip deal", missing: [] },
  { event: "SEND_TO_RED_FILMS", support: "SUPPORTED", concept: "'שלח קליפ' (idempotent by lookup)", missing: ["no database unique guard"] },
  { event: "PLAN_CLIP_BUDGET", support: "SUPPORTED", concept: "production budget + budget lines + clip planning rows", missing: ["currency on Red Films money"] },
  { event: "TRANSFER_CLIP_ITEM_TO_FINANCE", support: "SUPPORTED", concept: "'העבר לכספים' (row deleted)", missing: ["plan history", "atomic claim"] },
  { event: "ASSIGN_CREW", support: "PARTIAL", concept: "three free-text names", missing: ["crew records (table unused)"] },
  { event: "SCHEDULE_SHOOT", support: "SUPPORTED", concept: "clip shoot session (+ calendar) / production shoot date", missing: ["a link between the two"] },
  { event: "RECORD_SHOOT_EXPENSE", support: "SUPPORTED", concept: "optional expense on a shoot day", missing: [] },
  { event: "SHOOT_COMPLETED", support: "PARTIAL", concept: "session התקיים / production צולם", missing: ["one shoot truth"] },
  { event: "FOOTAGE_RECEIVED", support: "PARTIAL", concept: "status חומרי גלם הועלו + raw link", missing: ["when / who"] },
  { event: "SEND_TO_EDITOR", support: "PARTIAL", concept: "edit status + editor name", missing: ["handoff record"] },
  { event: "EDIT_VERSION_RECEIVED", support: "PARTIAL", concept: "version 1 / 2 links + edit status", missing: ["version records"] },
  { event: "OWNER_REVIEW", support: "PARTIAL", concept: "fix notes + status תיקונים", missing: ["review records"] },
  { event: "FINAL_VIDEO", support: "PARTIAL", concept: "final link + status מאושר", missing: [] },
  { event: "DELIVERY", support: "NOT_SUPPORTED", concept: "—", missing: ["video delivery record"] },
  { event: "PUBLICATION", support: "PARTIAL", concept: "publish date / where (unused) + social posted URL", missing: ["a production ↔ social link"] },
  { event: "VENDOR_PAYMENT", support: "PARTIAL", concept: "Red Films payments (own ledger) or Finance expenses", missing: ["one money truth"] },
  { event: "CLIENT_COLLECTION", support: "PARTIAL", concept: "client price / advance / collection status (manual)", missing: ["Finance link"] },
];

export const RF_SIGNAL_MODEL: ReadonlyArray<{ code: string; kind: "CANONICAL_FACT" | "DERIVED_SIGNAL" | "UNKNOWN"; note: string }> = [
  { code: "SHOOT_DATE_PASSED_NOT_SHOT", kind: "DERIVED_SIGNAL", note: "production shoot date passed, status still before צולם — a stale status or a missed shoot; never 'shot'" },
  { code: "SHOOT_SESSION_HAPPENED_STATUS_STALE", kind: "DERIVED_SIGNAL", note: "a shoot session התקיים while the production status is before צולם" },
  { code: "PRODUCTION_STATUS_VS_PROJECT", kind: "DERIVED_SIGNAL", note: "project הושלם / בוטל while its production is active (or the reverse)" },
  { code: "PLANNED_NOT_SPENT", kind: "CANONICAL_FACT", note: "planning only (budget / lines / clip rows) — never money spent" },
  { code: "RF_LEDGER_NOT_IN_FINANCE", kind: "CANONICAL_FACT", note: "Red Films payments exist and are not Finance transactions" },
  { code: "LINE_ACTUAL_VS_PAYMENTS", kind: "DERIVED_SIGNAL", note: "a budget line's manual actual differs from its payments" },
  { code: "CLIP_ROW_PROMOTED_MISSING_TX", kind: "CANONICAL_FACT", note: "an older 'transferred' clip row whose transaction no longer exists" },
  { code: "CLIP_EXPENSE_UNPAID", kind: "CANONICAL_FACT", note: "a clip expense not שולם" },
  { code: "CLIP_EXPENSE_RECEIVED_STATUS", kind: "CANONICAL_FACT", note: "a clip EXPENSE with status התקבל — invalid for an expense" },
  { code: "DUPLICATE_PRODUCTIONS", kind: "CANONICAL_FACT", note: "more than one production on one project" },
  { code: "PRODUCTION_WITHOUT_PROJECT", kind: "CANONICAL_FACT", note: "a production with no project" },
  { code: "PROJECT_VIDEO_NO_PRODUCTION", kind: "CANONICAL_FACT", note: "project clip data (deal / rows / shoot / expense) with no active production" },
  { code: "CLIENT_SOURCE_MISLABELLED", kind: "DERIVED_SIGNAL", note: "production says פנימי - לייבל while its project is a client project" },
  { code: "CLIP_PLAN_VS_EXPENSE", kind: "DERIVED_SIGNAL", note: "a transferred plan whose expense differs (amount / currency) — the expense is canonical" },
  { code: "PUBLISHED_CONTENT_VS_PRODUCTION", kind: "DERIVED_SIGNAL", note: "posted social content on the project while its production is not פורסם — two sources, never rewritten" },
  { code: "RELEASE_CONTEXT", kind: "CANONICAL_FACT", note: "the project has a release — context only; a release never requires a video" },
  { code: "CLIP_DEAL_OPEN", kind: "CANONICAL_FACT", note: "clip price not fully received" },
  { code: "MISSING_RECORDED_PREP", kind: "CANONICAL_FACT", note: "an active production / upcoming shoot without a recorded location / crew / documents — facts, never 'not ready'" },
];

export const RF_INTEGRITY = {
  productionCounts20260925: {
    productions: 14, byStatus: { "בוטל": 12, "רעיון": 2 }, byType: { "קליפ": 12, "unreadable (encoding)": 2 }, withProject: 10, distinctProjects: 7, projectsWithTwoOrMore: 2, projectBusinessType: { "לקוח": 10 }, managedBySendClip: 0,
    activeProductions: 2, activeWithPassedShootDate: 2, activeWithProjectCompleted: 1, clientSourceAllInternalLabel: 14, publishDates: 0, finalLinks: 0, versionLinks: 0, rawLinks: 0,
    budgetLines: 17, budgetLineStatus: { "מתוכנן": 17 }, plannedTotal: 10655, manualActualTotal: 1800, budgetPayments: 9, paymentsTotal: 4355, paymentsWithReceipt: 9, linesInFinance: 0, currencyRecorded: "none (₪ assumed)",
    crewRows: 0, sceneRows: 0, documents: 2, documentTypes: ["תסריט", "אחר"], documentsWithPublicLink: 2, referenceImages: 47, referenceLinks: 2, equipment: 8, productionTasks: 2,
    clipRows: 1, clipRowStatus: { "הועבר לכספים": 1 }, clipRowTransactionMissing: 1, clipDeals: 1, clipDealPrice: 3500, clipIncome: { received: 1500, expected: 2000 }, clipScopedExpenses: 0,
    shootSessions: 2, shootSessionStatus: { "התקיים": 2 }, shootSessionsWithCalendar: 2, shootSessionsWithExpense: 0, shootSessionWithoutProduction: 1, projectTypeSongPlusClip: 1,
    videoPushes: 0, videoAgentAlertTypes: 0,
  },
  findingsHe: [
    "14 הפקות Red Films: 12 בוטלו, 2 פעילות — שתיהן עדיין 'רעיון' למרות שתאריך הצילום עבר (ואחת מהן בפרויקט שהושלם).",
    "אף הפקה לא נוצרה דרך 'שלח קליפ' (0 הפקות מנוהלות); 2 פרויקטים עם יותר מהפקה אחת. כל 10 ההפקות המקושרות הן לפרויקטים של לקוחות.",
    "תקציב Red Films: 17 שורות מתוכננות ₪10,655, 9 תשלומים ₪4,355 עם קבלות — פנקס נפרד שלא עובר לכספים; ה'בפועל' הידני (1,800) לא תואם לתשלומים.",
    "אין הוצאה אחת עם היקף 'קליפ' בכספים; היקף 'קליפ' מופיע רק על 2 הכנסות של עסקת קליפ (₪1,500 התקבל, ₪2,000 צפוי מתוך ₪3,500).",
    "שורת תכנון קליפ אחת מסומנת 'הועבר לכספים' — אבל העסקה שהיא מצביעה עליה לא קיימת.",
    "2 ימי צילום (התקיים, מחוברים ליומן, בלי הוצאה); אחד מהם בפרויקט בלי הפקה.",
    "טבלאות הצוות והסצנות קיימות אבל ריקות ולא בשימוש — הצוות הוא 3 שמות חופשיים על ההפקה.",
    "כל 14 ההפקות מסומנות 'פנימי - לייבל' גם כשהפרויקט של לקוח.",
  ],
} as const;

export const SECURITY_REVIEW = {
  enforcement: "Red Films and clip-row routes are Owner-only through the central gate; most have NO in-route Owner check (the equipment and project clip routes do). No other role reaches them.",
  findings: [
    "Red Films + clip-row routes rely on the proxy alone (no in-route check) — delete / upload / payment / promote included",
    "documents, receipts and reference thumbnails get PUBLIC storage links at upload (part of SG_PUBLIC_SHARE_LINKS)",
    "the raw / edit / version / final / folder link fields hold public links",
    "bulk permanent delete can leave payments, documents and folders behind",
    "promote has no atomic claim (a double click could create two expenses)",
  ],
} as const;

/** Files whose video semantics the Sunny contract encodes — internal; the test pins their fingerprints. */
export const RF_REVIEWED_FILES = [
  "lib/clip-finance.ts", "lib/clip-production.ts", "lib/label-clips.ts",
  "app/api/projects/[id]/clip/send/route.ts", "app/api/projects/[id]/clip/route.ts", "app/api/projects/[id]/clip/payments/route.ts",
  "app/api/clip-items/route.ts", "app/api/clip-items/[id]/route.ts", "app/api/clip-items/[id]/promote/route.ts",
  "app/api/red-films/productions/route.ts", "app/api/red-films/productions/[id]/route.ts", "app/api/red-films/productions/bulk-permanent-delete/route.ts",
  "app/api/red-films/budget-items/[itemId]/payments/route.ts", "app/api/red-films/productions/[id]/documents/upload/route.ts",
  "components/red-films/RedFilmsStatusBadge.tsx",
] as const;
export const RF_REVIEWED_FINGERPRINTS: Readonly<Record<string, string>> = {
  "lib/clip-finance.ts": "c862ac29cd8849cd1a0234bea8f79ff6715b7d303ae21f285f76b4b1b70a492b",
  "lib/clip-production.ts": "9167e4578406e96976576e511bf579dfb10a12ca430616ab107180be0b6e0712",
  "lib/label-clips.ts": "68cce31a6cacc93540fc91bc535ed68cbbd8bb355bca61b974fb6dc88b819413",
  "app/api/projects/[id]/clip/send/route.ts": "d8928a6da68596e0a1cd029ff1539cd559a116458d252b1e7a9d5ba75b8817af",
  "app/api/projects/[id]/clip/route.ts": "b5d5be2b44bf28d0f2b3c8c632bbdf2da9e9fa8b50cb9c691aa6263fe789c89e",
  "app/api/projects/[id]/clip/payments/route.ts": "8cfa0c27e6c8286194071f95d44fb4bc34c19deb113912765b2709b502ae91e2",
  "app/api/clip-items/route.ts": "86e988e3f691cd646641aaa045fc01ed9377d80e98fa41e03b02108a62909f18",
  "app/api/clip-items/[id]/route.ts": "606395073c492aabbf1efd305d4ee530fbfb90b6b392e5aa6b5a58e654f913dc",
  "app/api/clip-items/[id]/promote/route.ts": "111af72b150f34a61f84820dd60654bee6198c9bf02e59d2af81eb217ee48784",
  "app/api/red-films/productions/route.ts": "b0ab207a985f68d1668239c7f85ea768273c160f0dce46bb860a9d3f898e874f",
  "app/api/red-films/productions/[id]/route.ts": "e82cb14dc071233b0ceb71fdf95467d11832d96ee9fda403fef303142937de60",
  "app/api/red-films/productions/bulk-permanent-delete/route.ts": "2841dc173279acdac936880523166970c1eb500f04528cc2b914dba95632220e",
  "app/api/red-films/budget-items/[itemId]/payments/route.ts": "1706c47992b9ce20a94d661ed8302541b9729e101520e8e1bd8e80aab15aee62",
  "app/api/red-films/productions/[id]/documents/upload/route.ts": "c2c6843eabb396fb60fd9e607365c7aedcb749c80f3266e340f41d0f8f532afa",
  "components/red-films/RedFilmsStatusBadge.tsx": "4f41f32f43f7c113649db6c0d9e0d484ab9a3cd3fd8dbdf15847f5fe212d699b",
};

/** Route families touching video (internal — the test re-discovers them). */
export const RF_ROUTE_GROUPS = [
  { pattern: "^app/api/red-films/", note: "Red Films productions / budget / payments / documents / references / equipment" },
  { pattern: "^app/api/clip-items/", note: "project clip planning rows + promote" },
  { pattern: "^app/api/projects/\\[id\\]/clip/", note: "project clip deal (price, payments, send clip)" },
] as const;
