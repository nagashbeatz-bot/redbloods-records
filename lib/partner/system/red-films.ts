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
  red_films_productions: ["id", "title", "production_type", "status", "project_id", "client_id", "artist_name", "client_name", "client_source", "photographer_name", "director_name", "editor_name", "shoot_date", "locations", "concept_summary", "concept_vibe", "ref_links", "script_start", "script_middle", "script_end", "director_notes", "photographer_notes", "general_budget", "client_price", "advance_required", "advance_received", "collection_status", "files_raw_link", "files_edit_folder", "version_1_link", "version_2_link", "final_version_link", "fix_notes", "edit_status", "publish_date", "published_where", "notes", "created_at", "updated_at", "dropbox_folder_path", "dropbox_folder_url", "currency"],
  red_films_budget_items: ["id", "production_id", "title", "category", "planned_amount", "actual_amount", "vendor_name", "status", "linked_transaction_id", "notes", "created_at", "updated_at", "currency"],
  red_films_budget_payments: ["id", "production_id", "budget_item_id", "amount", "payment_date", "payment_method", "notes", "receipt_file_name", "receipt_mime_type", "receipt_dropbox_path", "receipt_dropbox_url", "created_at", "updated_at", "currency", "linked_transaction_id"],
  red_films_crew: ["id", "production_id", "name", "role", "contact", "arrival_time", "confirmation_status", "payment_amount", "payment_status", "notes", "created_at", "updated_at"],
  red_films_documents: ["id", "production_id", "file_name", "file_type", "mime_type", "dropbox_path", "dropbox_url", "notes", "created_at", "updated_at"],
  red_films_equipment: ["id", "name", "category", "quantity", "acquired_date", "purchase_price", "purchased_from", "serial_number", "notes", "added_by", "status", "removed_at", "created_at", "updated_at", "currency"],
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
  F(P, "status", "CANONICAL", "רעיון → הצעה נשלחה → ממתין לאישור → בתכנון → יום צילום נקבע → צולם → חומרי גלם הועלו → בעריכה → נשלחה גרסה → תיקונים → מאושר → פורסם, or בוטל. Manual; no transition is enforced; no status history. מאושר = the Owner approved the current production stage to proceed (D7) — not client approval / payment / final / delivered."),
  F(P, "project_id", "CANONICAL", "The music project (optional; 10 of 14 carry one). Several productions per project are allowed (no unique guard)."),
  F(P, "client_id", "AMBIGUOUS", "Client id — filled by matching the artist NAME to a client (send clip / new-production modal), so a TEXT_MATCH stored as an id."),
  F(P, "artist_name", "CANONICAL", "Artist text (copied from the project); the label artist's clip information (A / B / C) matches productions by this name (TEXT_MATCH); the clip allocation follows the artist agreement (שליו / אבי: 50 / 50 of the actual paid cost — the artist's half is an artist expense in the cycle, never repaid by a specific income; anyone else NOT_DEFINED)."),
  F(P, "client_name", "DERIVED", "Client name snapshot at creation."),
  F(P, "client_source", "CANONICAL", "פנימי - לייבל / לקוח חיצוני / אמן לייבל / פרויקט שיווקי / אחר. Since 2026-09-27 'שלח קליפ' sets it from the project's classification (לייבל → פנימי - לייבל, לקוח → לקוח חיצוני); existing rows are unchanged (all 14 production rows say פנימי - לייבל, their projects are client projects — CLIENT_SOURCE_MISLABELLED)."),
  F(P, "photographer_name", "CANONICAL", "Photographer — FREE TEXT (no person record)."),
  F(P, "director_name", "CANONICAL", "Director — free text."),
  F(P, "editor_name", "CANONICAL", "Editor — free text."),
  F(P, "shoot_date", "CANONICAL", "ONE planned shoot date on the production (separate from the project's clip shoot sessions). A passed date does not mean 'shot' — only the status says צולם."),
  F(P, "locations", "CANONICAL", "Locations text."),
  F(P, "concept_summary", "CANONICAL", "Concept."), F(P, "concept_vibe", "CANONICAL", "Vibe."),
  F(P, "ref_links", "CANONICAL", "Reference links text (a boolean for Sunny)."),
  F(P, "script_start", "CANONICAL", "Script — opening."), F(P, "script_middle", "CANONICAL", "Script — middle."), F(P, "script_end", "CANONICAL", "Script — ending."),
  F(P, "director_notes", "CANONICAL", "Director notes."), F(P, "photographer_notes", "CANONICAL", "Photographer notes."),
  F(P, "currency", "CANONICAL", "The production's currency (₪ / $ / €, DB check, default ₪ — every row before 2026-09-27 was ₪): general budget, client price, advances. A 'שלח קליפ' production starts in the project clip deal's currency (no lock)."),
  F(P, "general_budget", "CANONICAL", "B — the production's planning BUDGET (in the production's currency). Owner canon 2026-09-27: never the client clip price (A), never an actual cost (C), never a recoup basis (D = NOT_DEFINED). A 'שלח קליפ' production starts at 0 and owns its budget (no price → budget sync, no lock); a budget equal to the clip price on an older production is a remnant of the retired sync (BUDGET_EQUALS_CLIP_PRICE_OLD_SYNC)."),
  F(P, "client_price", "CANONICAL", "What the client pays for the production (Red Films' own deal, not Finance)."),
  F(P, "advance_required", "CANONICAL", "Advance required from the client."), F(P, "advance_received", "CANONICAL", "Advance received (manual, not from Finance)."),
  F(P, "collection_status", "CANONICAL", "לא רלוונטי / צפוי / התקבל / שולם / לא שולם / חלקי / בוטל — collection from the client, manual."),
  F(P, "files_raw_link", "SECRET_LINK", `Raw footage link — ${LINK}.`), F(P, "files_edit_folder", "SECRET_LINK", `Edit folder link — ${LINK}.`),
  F(P, "version_1_link", "SECRET_LINK", `Edit version 1 link — ${LINK}. The only 'version' record.`), F(P, "version_2_link", "SECRET_LINK", `Edit version 2 link — ${LINK}.`),
  F(P, "final_version_link", "SECRET_LINK", `Final video link — ${LINK}. Its existence is the only 'final video' evidence.`),
  F(P, "fix_notes", "CANONICAL", "Revision notes for the editor — the only recorded video feedback."),
  F(P, "edit_status", "CANONICAL", "לא התחיל / חומרי גלם הועלו / בעריכה / נשלחה גרסה 1 / תיקונים / מאושר / פורסם — editing state, manual, independent of status. מאושר = the Owner approved the current edit stage to proceed (D7), not the final version / delivery."),
  F(P, "publish_date", "CANONICAL", "Publish date (0 set in production)."), F(P, "published_where", "CANONICAL", "Where it was published (text)."),
  F(P, "notes", "CANONICAL", "Production notes."),
  F(P, "created_at", "CANONICAL", "Created."), F(P, "updated_at", "CANONICAL", "Updated (any change)."),
  F(P, "dropbox_folder_path", "CANONICAL", "The production storage folder (created on demand)."), F(P, "dropbox_folder_url", "SECRET_LINK", `Folder link — ${LINK}.`),
  // ── budget item (Red Films planning + payments) ──
  F(BI, "id", "CANONICAL", "A Red Films budget line.", { history: "—" }), F(BI, "production_id", "CANONICAL", "Owning production."),
  F(BI, "title", "CANONICAL", "Line title."), F(BI, "category", "CANONICAL", "צלם / ציוד / לוקיישן / תלבושות / סטיילינג / פוסט פרודקשן / שחקנים / מודלים / קייטרינג / הובלה / לוגיסטיקה / שיווק / אחר."),
  F(BI, "planned_amount", "CANONICAL", "PLANNED cost (in the line's currency)."),
  F(BI, "currency", "CANONICAL", "The line's currency (₪ / $ / €, DB check, default = the production's). Its payments are always in it; it cannot change once the line has payments (no FX)."),
  F(BI, "actual_amount", "LEGACY", "A manual 'actual' number (legacy mirror) — never 'paid'. Paid comes only from the line's payments (the one line rule). Production: actual 1,800 vs payments 4,355 (LINE_ACTUAL_VS_PAYMENTS)."),
  F(BI, "vendor_name", "CANONICAL", "Vendor — free text (0 set in production)."),
  F(BI, "status", "CANONICAL", "מתוכנן / שולם / בוטל — PLANNING INTENT only (2026-09-27): the paid state comes from the payments in the line currency (PAID / PARTIAL / UNPAID / NO_PLAN) on the screen and in Sunny; בוטל = the line is cancelled; a stored status that disagrees with the payments is BUDGET_LINE_STATUS_VS_PAYMENTS."),
  F(BI, "linked_transaction_id", "LEGACY", "The old per-LINE Finance link — never written by the app (0 set). Planning never reaches Finance; since DB-1 (2026-09-27) the Finance link lives on each PAYMENT (its linked_transaction_id). A line row linked here is treated as a possible duplicate by the payment link (the Boss decides)."),
  F(BI, "notes", "CANONICAL", "Notes."), F(BI, "created_at", "CANONICAL", "Created."), F(BI, "updated_at", "CANONICAL", "Updated."),
  // ── budget payment (Red Films' own ledger) ──
  F(BP, "id", "CANONICAL", "A payment made against a budget line — REAL money that left the company (Owner canon). Since DB-1 (live 2026-09-27) each payment has exactly ONE linked Finance expense (linked_transaction_id).", { history: "—" }),
  F(BP, "linked_transaction_id", "CANONICAL", "DB-1 (Owner-approved, live 2026-09-27; uuid UNIQUE → transactions ON DELETE SET NULL): the payment's ONE Finance expense (type expense, שולם, the payment's amount + currency, its date / method, the production's project, scope קליפ, notes [Red Films payment <id>]). Written ONLY by the one shared link writer (compare-and-swap; UNIQUE is the final guard): a new payment links automatically; historical payments by LINK_RF_PAYMENT_TO_FINANCE / LINK_RF_PAYMENTS_FOR_PRODUCTION. A non-clip production → SCOPE_REQUIRED, a clip production without project → PROJECT_REQUIRED, a similar unlinked expense → POSSIBLE_DUPLICATE — the payment stays unlinked and it is reported. The linked expense is owned by the payment (Finance owner RF_PAYMENT: notes only); an edit propagates amount / date / method; a delete removes it. 0 linked at go-live.", { writers: "the shared Red Films → Finance link writer (via the payment insert + the link primitives)", readers: "finance core (RED_FILMS_OUTSIDE_FINANCE counts only unlinked), video view (per payment LINKED / UNLINKED / SCOPE_REQUIRED / PROJECT_REQUIRED), operations, label clips (rfLedgerPaid = unlinked only), Finance ownership" }),
  F(BP, "production_id", "CANONICAL", "Production."), F(BP, "budget_item_id", "CANONICAL", "The budget line paid."),
  F(BP, "amount", "CANONICAL", "Amount (> 0 enforced), in the payment's currency."), F(BP, "currency", "CANONICAL", "Always its budget line's currency (the writer forces it; another currency is refused — no FX)."), F(BP, "payment_date", "CANONICAL", "Paid on."),
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
  F(E, "acquired_date", "CANONICAL", "Acquired."), F(E, "purchase_price", "CANONICAL", "Price paid (in the row's currency; not Finance)."), F(E, "currency", "CANONICAL", "The purchase price's currency (₪ / $ / €, default ₪)."), F(E, "purchased_from", "CANONICAL", "Seller."),
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
  F(CI, "status", "CANONICAL", "תכנון בלבד (new rows) / הועבר לכספים (claimed by 'העבר לכספים' and KEPT) / שולם (its expense was paid) / בוטל — validated by the writer (400 otherwise, 2026-09-27). A promoted / linked row is provenance, never planning."),
  F(CI, "linked_transaction_id", "CANONICAL", "The Finance expense the row was promoted into (plan → actual provenance, since 2026-09-27 the row is kept and linked). The 1 older production row points at a transaction that no longer exists (CLIP_ROW_PROMOTED_MISSING_TX)."),
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
  sendClip: "'שלח קליפ' (Owner): creates a Red Films production (type קליפ, status רעיון, the project's name / artist, client matched by artist NAME, client source from the project classification, budget 0 in the clip deal's currency) and records it as the project's production marker (compare-and-swap settings merge). Provenance only — the budget is the production's own planning, the clip price never sets it and nothing is locked (2026-09-27). Idempotent by lookup twice (no database unique guard); cancelled productions do not block a new one. Production: 0 productions created by the flow.",
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
    "RED_FILMS_PAID: budget payments = REAL company money (Owner canon 2026-09-27). DB-1 (live 2026-09-27): each payment → exactly ONE linked Finance expense (scope קליפ, שולם, same currency) — a LINKED payment is part of ACTUAL_EXPENSE and is never counted again; only UNLINKED payments are outside Finance (historical ones until the Boss links them). A clip production maps to expense scope קליפ, any other type needs an explicit scope (SCOPE_REQUIRED — never auto-created); a clip production without a project → PROJECT_REQUIRED",
    "ACTUAL_EXPENSE: Finance expenses with expense scope קליפ (from 'העבר לכספים', a shoot-day expense, or a manual Finance entry) — canonical once they exist",
    "PAID_EXPENSE: an expense with status שולם (חלקי = partial; התקבל = invalid for an expense)",
    "CLIP_DEAL_INCOME: the artist's clip payments (INCOME with scope קליפ) vs the clip price — revenue, never an expense",
    "BUSINESS_UNIT (task 4, Owner decision 2026-09-28): a REAL clip cost of a Records (label) project is RECORDS — Red Films may execute it, but there is no internal revenue, transfer or theoretical cost for Films. Clip money of a client project is FILMS only when the project has a Red Films production for an external client; otherwise it is NULL (דורש סיווג) and the Owner decides (e.g. בלאגן is a Studio deal). RF payment rows, 'העבר לכספים' rows and clip deal payments get their unit from the ONE unit rule on creation.",
  ],
  promote: "'העבר לכספים' on a clip planning row: the row is CLAIMED first (status → הועבר לכספים only while it has no linked expense — a double click could create two expenses before 2026-09-27; now the second click finds the claim), then an expense (project scope, status לא שולם, expense scope קליפ, amount + currency of the row, the date chosen) is created and the row is KEPT and linked to it (plan → actual provenance); a failed insert releases the claim. The expense is canonical; a plan ≠ expense difference is CLIP_PLAN_VS_EXPENSE. The expense is owned by the row in Finance (not deletable there; amount / currency / description / category stay editable). No Owner check in the route (proxy only).",
  shootExpense: "adding a shoot day can optionally create an expense (status לא שולם, category צילום קליפ, expense scope קליפ, linked to the session).",
  noDoubleCount: "Sunny never adds a planning row / budget line to an expense. A LINKED Red Films payment IS its Finance expense (paidLinkedInFinance ⊂ actual clip expenses) — never added to it; only paidOutsideFinance (unlinked) is shown apart. Linking checks for a similar UNLINKED Finance expense (same project / amount / currency, ±14 days, similar text, or the line's legacy Finance row) → POSSIBLE_DUPLICATE for the Boss — never summed, never merged automatically.",
  currency: "every money row carries its currency (₪ / $ / €; migration 75bf144e… applied 2026-09-27, every existing row = ₪): productions (budget / client price / advances), budget lines (planned / actual) and their payments (always the line's currency), equipment purchase price, clip rows, Finance. Nothing is converted; totals are grouped by currency, never added across currencies (SET_RF_CURRENCY; refused on a line that already has payments).",
  clipDeal: "clip deal status: אין עסקה / ממתין / חלקי / שולם / יתרת זכות; remaining = max(0, price − received), overpayment = credit. Clip income is excluded from the song's balance.",
  recoup: "Owner canon 2026-09-27: there is NO clip recoup — for שליו / אבי the artist's clip share (50 % of the ACTUAL PAID cost, funded by the label) is an artist expense in the bi-monthly cycle, never repaid by a specific income (media is separate 50 / 50 income); every other artist has no agreement (NOT_DEFINED; never 50 % of the budget, never the client price). Active clip productions matched by artist name give INFORMATION per currency only (A client price, B planned budget, C paid clip cost, Red Films ledger). Media records stored before 2026-09-27 carry 'recouped' values from a retired rule — history only.",
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
  label: "the label page shows clip money A / B / C per currency as information, and the clip cash out ≠ the label share ≠ the artist share funded by the label (agreement: שליו / אבי 50 / 50 of the actual paid cost); the label P&L counts the LABEL share (a cost with no agreement rule in full, shown apart), never the whole cash out as label share. The Red Films actual cost is a Finance dimension; the artist ledger (e.g. the clip expense the Owner recorded) is the accounting dimension — never merged.",
  weekSummary: "the weekly week-strength summary counts production shoot dates (non-cancelled).",
  agent: "the AI chat context lists a project's clip shoot days; agent rules read clip scope.",
  coo: "COO facts read clip money.",
  artistPortal: "the artist portal shows a 'נקבע צילום קליפ' update for a clip shoot session.",
  tasks: "production tasks are CANONICAL (related type red_film_production + the production id; optional Google Task); 2 in production.",
  pushes: "no Red Films / clip push exists; page loads write nothing video-related.",
  agentAlerts: "no video alert type exists.",
} as const;

/** Executability is NOT restated here (one fact, one source): it is served only by the action coverage matrix (capability action_registry, mode coverage — lib/partner/act/matrix.ts). */
export interface RfActionEntry { id: string; action: string; who: Who; enforcement: Enforcement; writes: string; finance: string | null; calendar: string | null; files: string | null; project: string | null; destructive: boolean; reversible: "YES" | "PARTIAL" | "NO"; approvalClass: ApprovalClass; sunnyToday: "SEE_ACTION_COVERAGE"; futurePrimitive: string; internal: { routes: readonly string[] } }
type RA = Omit<RfActionEntry, "sunnyToday" | "internal"> & { routes: readonly string[] };
const X = (e: RA): RfActionEntry => { const { routes, ...rest } = e; return { ...rest, sunnyToday: "SEE_ACTION_COVERAGE", internal: { routes } }; };
const RF = "app/api/red-films", PC = "app/api/projects/[id]/clip", CL = "app/api/clip-items";
export const RF_ACTIONS: readonly RfActionEntry[] = [
  X({ id: "CREATE_PRODUCTION", action: "Create a Red Films production (new-production modal)", who: "OWNER", enforcement: "PROXY_ONLY", writes: "production", finance: null, calendar: null, files: null, project: "optional link", destructive: false, reversible: "YES", approvalClass: "STANDARD", futurePrimitive: "CREATE_VIDEO_PRODUCTION", routes: [`${RF}/productions/route.ts`] }),
  X({ id: "SEND_CLIP", action: "'שלח קליפ' — create / return the project's clip production", who: "OWNER", enforcement: "ROUTE_CHECKS_OWNER", writes: "production + the production marker in the project's finance settings (compare-and-swap merge)", finance: "budget 0 in the deal currency (planning — never the clip price)", calendar: null, files: null, project: "production marker (provenance)", destructive: false, reversible: "PARTIAL", approvalClass: "STANDARD", futurePrimitive: "SEND_CLIP_TO_RED_FILMS", routes: [`${PC}/send/route.ts`] }),
  X({ id: "EDIT_PRODUCTION", action: "Edit a production (status, edit status, crew names, dates, concept, script, budget unless managed, client price, links, publish)", who: "OWNER", enforcement: "PROXY_ONLY", writes: "production", finance: null, calendar: null, files: null, project: null, destructive: false, reversible: "PARTIAL", approvalClass: "STANDARD", futurePrimitive: "UPDATE_VIDEO_PRODUCTION", routes: [`${RF}/productions/[id]/route.ts`] }),
  X({ id: "CANCEL_PRODUCTION", action: "Cancel a production (status בוטל)", who: "OWNER", enforcement: "PROXY_ONLY", writes: "status + its future / undated tasks cancelled", finance: null, calendar: "Google Tasks deleted", files: null, project: null, destructive: false, reversible: "PARTIAL", approvalClass: "EXTERNAL_EFFECT", futurePrimitive: "CANCEL_VIDEO_PRODUCTION", routes: [`${RF}/productions/[id]/route.ts`] }),
  X({ id: "BULK_DELETE_PRODUCTIONS", action: "Permanently delete productions (bulk)", who: "OWNER", enforcement: "ROUTE_CHECKS_OWNER", writes: "A5 (2026-09-27): read-only preflight first — only בוטל productions; any Red Films payment refuses the whole delete (HAS_PAYMENTS, real money, zero writes); then reference images, documents, reference links, scenes, crew, budget lines (a linked Finance transaction stays), tasks, the project's clip-production marker (only when it still points at the production, compare-and-swap) and the productions — every step checked, verified by a re-read; stored files + Google Tasks after the DB, failures reported; the storage folder stays", finance: null, calendar: "Google Tasks", files: "reference files", project: null, destructive: true, reversible: "NO", approvalClass: "DESTRUCTIVE", futurePrimitive: "DELETE_VIDEO_PRODUCTION", routes: [`${RF}/productions/bulk-permanent-delete/route.ts`] }),
  X({ id: "BUDGET_LINES", action: "Add / edit / delete a budget line", who: "OWNER", enforcement: "PROXY_ONLY", writes: "budget line", finance: null, calendar: null, files: null, project: null, destructive: true, reversible: "PARTIAL", approvalClass: "FINANCIAL", futurePrimitive: "—", routes: [`${RF}/productions/[id]/budget-items/route.ts`, `${RF}/budget-items/[itemId]/route.ts`] }),
  X({ id: "BUDGET_PAYMENTS", action: "Record / edit / delete a payment on a budget line (+ receipt upload)", who: "OWNER", enforcement: "PROXY_ONLY", writes: "Red Films payment + (DB-1) its ONE linked Finance expense: created on record (clip production with project), updated with the payment, deleted with it", finance: "one linked expense per payment (scope קליפ, שולם, same currency); non-clip → SCOPE_REQUIRED (left unlinked, reported)", calendar: null, files: "receipt upload + public link", project: null, destructive: true, reversible: "PARTIAL", approvalClass: "FINANCIAL", futurePrimitive: "LINK_RF_PAYMENT_TO_FINANCE / LINK_RF_PAYMENTS_FOR_PRODUCTION (historical links)", routes: [`${RF}/budget-items/[itemId]/payments/route.ts`, `${RF}/budget-payments/[paymentId]/route.ts`, `${RF}/budget-payments/[paymentId]/receipt/route.ts`] }),
  X({ id: "DOCUMENTS", action: "Upload / delete a document", who: "OWNER", enforcement: "PROXY_ONLY", writes: "document", finance: null, calendar: null, files: "storage upload (+ public link) / delete", project: null, destructive: true, reversible: "NO", approvalClass: "DESTRUCTIVE", futurePrimitive: "—", routes: [`${RF}/productions/[id]/documents/upload/route.ts`, `${RF}/documents/[docId]/route.ts`] }),
  X({ id: "REFERENCES", action: "Add / edit / delete reference images and video links", who: "OWNER", enforcement: "PROXY_ONLY", writes: "references", finance: null, calendar: null, files: "image upload (+ public thumbnail link) / delete; video link edit = title / notes only (hardened 2026-09-27: the shared writer updateVideoReference accepts only title / notes; the PATCH used to write the whole body)", project: null, destructive: true, reversible: "NO", approvalClass: "STANDARD", futurePrimitive: "—", routes: [`${RF}/productions/[id]/references/upload/route.ts`, `${RF}/references/[refId]/route.ts`, `${RF}/productions/[id]/reference-links/route.ts`, `${RF}/reference-links/[linkId]/route.ts`] }),
  X({ id: "STORAGE_FOLDER", action: "Create the production storage folder", who: "OWNER", enforcement: "PROXY_ONLY", writes: "folder path + link", finance: null, calendar: null, files: "storage folder", project: null, destructive: false, reversible: "YES", approvalClass: "EXTERNAL_EFFECT", futurePrimitive: "—", routes: [`${RF}/productions/[id]/dropbox-folder/route.ts`] }),
  X({ id: "EQUIPMENT", action: "Add / edit / remove equipment", who: "OWNER", enforcement: "ROUTE_CHECKS_OWNER", writes: "equipment", finance: null, calendar: null, files: null, project: null, destructive: false, reversible: "YES", approvalClass: "STANDARD", futurePrimitive: "—", routes: [`${RF}/equipment/route.ts`, `${RF}/equipment/[id]/route.ts`] }),
  X({ id: "CLIP_PRICE", action: "Set the project's clip price (A — the deal; never a production budget)", who: "OWNER", enforcement: "ROUTE_CHECKS_OWNER", writes: "project finance settings", finance: "clip deal price", calendar: null, files: null, project: null, destructive: false, reversible: "YES", approvalClass: "FINANCIAL", futurePrimitive: "SET_CLIP_PRICE", routes: [`${PC}/route.ts`] }),
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
  { event: "PLAN_CLIP_BUDGET", support: "SUPPORTED", concept: "production budget + budget lines + clip planning rows", missing: [] },
  { event: "TRANSFER_CLIP_ITEM_TO_FINANCE", support: "SUPPORTED", concept: "'העבר לכספים' (row deleted)", missing: ["plan history", "atomic claim"] },
  { event: "ASSIGN_CREW", support: "PARTIAL", concept: "three free-text names", missing: ["crew records (table unused)"] },
  { event: "SCHEDULE_SHOOT", support: "SUPPORTED", concept: "clip shoot session (+ calendar) / production shoot date", missing: ["a link between the two"] },
  { event: "RECORD_SHOOT_EXPENSE", support: "SUPPORTED", concept: "optional expense on a shoot day", missing: [] },
  { event: "SHOOT_COMPLETED", support: "PARTIAL", concept: "session התקיים / production צולם", missing: ["one shoot truth"] },
  { event: "FOOTAGE_RECEIVED", support: "PARTIAL", concept: "status חומרי גלם הועלו + raw link", missing: ["when / who"] },
  { event: "SEND_TO_EDITOR", support: "PARTIAL", concept: "edit status + editor name", missing: ["handoff record"] },
  { event: "EDIT_VERSION_RECEIVED", support: "PARTIAL", concept: "version 1 / 2 links + edit status", missing: ["version records"] },
  { event: "OWNER_REVIEW", support: "PARTIAL", concept: "fix notes + status תיקונים", missing: ["review records"] },
  { event: "FINAL_VIDEO", support: "PARTIAL", concept: "the final version link (its existence is the only final-video evidence; status מאושר is a stage approval, not 'final' — D7)", missing: [] },
  { event: "DELIVERY", support: "NOT_SUPPORTED", concept: "—", missing: ["video delivery record"] },
  { event: "PUBLICATION", support: "PARTIAL", concept: "publish date / where (unused) + social posted URL", missing: ["a production ↔ social link"] },
  { event: "VENDOR_PAYMENT", support: "PARTIAL", concept: "a Red Films payment → its ONE linked Finance expense (DB-1, automatic for a clip production with a project)", missing: ["a canonical Finance scope for non-clip productions (SCOPE_REQUIRED)", "the historical payments' links (the Boss's typed link actions)"] },
  { event: "CLIENT_COLLECTION", support: "PARTIAL", concept: "client price / advance / collection status (manual)", missing: ["Finance link"] },
];

export const RF_SIGNAL_MODEL: ReadonlyArray<{ code: string; kind: "CANONICAL_FACT" | "DERIVED_SIGNAL" | "UNKNOWN"; note: string }> = [
  { code: "SHOOT_DATE_PASSED_NOT_SHOT", kind: "DERIVED_SIGNAL", note: "production shoot date passed, status still before צולם — a stale status or a missed shoot; never 'shot'" },
  { code: "SHOOT_SESSION_HAPPENED_STATUS_STALE", kind: "DERIVED_SIGNAL", note: "a shoot session התקיים while the production status is before צולם" },
  { code: "PRODUCTION_STATUS_VS_PROJECT", kind: "DERIVED_SIGNAL", note: "project הושלם / בוטל while its production is active (or the reverse)" },
  { code: "PLANNED_NOT_SPENT", kind: "CANONICAL_FACT", note: "planning only (budget / lines / clip rows) — never money spent" },
  { code: "RF_LEDGER_NOT_IN_FINANCE", kind: "CANONICAL_FACT", note: "Red Films payments NOT linked to their Finance expense yet (DB-1 live: only unlinked payments; linked ones are in Finance)" },
  { code: "LINE_ACTUAL_VS_PAYMENTS", kind: "DERIVED_SIGNAL", note: "a budget line's manual actual differs from its payments" },
  { code: "CLIP_ROW_PROMOTED_MISSING_TX", kind: "CANONICAL_FACT", note: "an older 'transferred' clip row whose transaction no longer exists" },
  { code: "CLIP_EXPENSE_UNPAID", kind: "CANONICAL_FACT", note: "a clip expense not שולם" },
  { code: "CLIP_EXPENSE_RECEIVED_STATUS", kind: "CANONICAL_FACT", note: "a clip EXPENSE with status התקבל — invalid for an expense" },
  { code: "DUPLICATE_PRODUCTIONS", kind: "CANONICAL_FACT", note: "more than one production on one project" },
  { code: "PRODUCTION_WITHOUT_PROJECT", kind: "CANONICAL_FACT", note: "a production with no project" },
  { code: "PROJECT_VIDEO_NO_PRODUCTION", kind: "CANONICAL_FACT", note: "project clip data (deal / rows / shoot / expense) with no active production" },
  { code: "CLIENT_SOURCE_MISLABELLED", kind: "DERIVED_SIGNAL", note: "production says פנימי - לייבל while its project is a client project (older rows; new ones follow the classification)" },
  { code: "BUDGET_LINE_STATUS_VS_PAYMENTS", kind: "DERIVED_SIGNAL", note: "a budget line's stored status (planning intent) disagrees with its payments — the payments decide paid" },
  { code: "BUDGET_EQUALS_CLIP_PRICE_OLD_SYNC", kind: "DERIVED_SIGNAL", note: "the production budget equals the clip price — a remnant of the retired price → budget sync; planning, not a decision" },
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
    budgetLines: 17, budgetLineStatus: { "מתוכנן": 17 }, plannedTotal: 10655, manualActualTotal: 1800, budgetPayments: 9, paymentsTotal: 4355, paymentsWithReceipt: 9, linesInFinance: 0, currencyRecorded: "per row since 2026-09-27 (all existing rows ₪)",
    crewRows: 0, sceneRows: 0, documents: 2, documentTypes: ["תסריט", "אחר"], documentsWithPublicLink: 2, referenceImages: 47, referenceLinks: 2, equipment: 8, productionTasks: 2,
    clipRows: 1, clipRowStatus: { "הועבר לכספים": 1 }, clipRowTransactionMissing: 1, clipDeals: 1, clipDealPrice: 3500, clipIncome: { received: 1500, expected: 2000 }, clipScopedExpenses: 0,
    shootSessions: 2, shootSessionStatus: { "התקיים": 2 }, shootSessionsWithCalendar: 2, shootSessionsWithExpense: 0, shootSessionWithoutProduction: 1, projectTypeSongPlusClip: 1,
    videoPushes: 0, videoAgentAlertTypes: 0,
  },
  findingsHe: [
    "14 הפקות Red Films: 12 בוטלו, 2 פעילות — שתיהן עדיין 'רעיון' למרות שתאריך הצילום עבר (ואחת מהן בפרויקט שהושלם).",
    "אף הפקה לא נוצרה דרך 'שלח קליפ' (0 הפקות מנוהלות); 2 פרויקטים עם יותר מהפקה אחת. כל 10 ההפקות המקושרות הן לפרויקטים של לקוחות.",
    "תקציב Red Films: 17 שורות מתוכננות ₪10,655, 9 תשלומים ₪4,355 עם קבלות; ה'בפועל' הידני (1,800) לא תואם לתשלומים. DB-1 (2026-09-27): כל תשלום → הוצאה אחת מקושרת בכספים; בעלייה לאוויר 0 מקושרים — הבוס מקשר את ההיסטוריים בפעולות הקישור.",
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
    "bulk permanent delete (A5) refuses productions with payments and removes documents / scenes / crew / links too; the storage folder stays and file-removal failures are reported",
    "promote had no atomic claim (a double click could create two expenses) — HARDENED 2026-09-27: the row is claimed first",
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
  "lib/writes/redfilms.ts", "lib/writes/clip.ts", "lib/writes/rf-finance-link.ts", "app/api/red-films/budget-payments/[paymentId]/route.ts",
] as const;
export const RF_REVIEWED_FINGERPRINTS: Readonly<Record<string, string>> = {
  "lib/writes/rf-finance-link.ts": "99e21fccf0c24d71c94870b907e0f72ab12853a1fe255bfca43a4a9d3e072472",
  "app/api/red-films/budget-payments/[paymentId]/route.ts": "d0986855ef6d1d2e5eaffa7858101c3233d0bb7ad2abcc6c443185fdde5c657b",
  "lib/writes/redfilms.ts": "a5c6a7523840029624bf88071c5a5636b6a2fd64787aee3640cd1e1343e89c7b",
  "lib/writes/clip.ts": "e37ff6bd9b0fc9b0e1b09bbf0a724c6dea5e5513562ca390998fb39eeab2edbc",
  "lib/clip-finance.ts": "6cb3e64c6b7dad5b994e977cd55da864a93d9b466b023faea46da8851fdaa23c",
  "lib/clip-production.ts": "dcdb87951da5443020449a2a96a66f841f828c0e07f9456a74af130044140a58",
  "lib/label-clips.ts": "f69745076431936c8cca1237f4e34557eb7f9a6b443765eebf55de91043ac7c4",
  "app/api/projects/[id]/clip/send/route.ts": "356bcbde091e657738998046edc4e7cf41f6972dec0f783063e980152ebd1fba",
  "app/api/projects/[id]/clip/route.ts": "b97d7b15f72005dd63bde526336aa8dc536f3d5155d4d446a1b79060f28d5f15",
  "app/api/projects/[id]/clip/payments/route.ts": "702daa9ca700179488d3427137dbe4ffc3daaf2e015b8dacc0acff965aaae3d5",
  "app/api/clip-items/route.ts": "c40439dae22f8b175b85c3a35ecbdf3188633a05c225ded96b428c0f0cae6f89",
  "app/api/clip-items/[id]/route.ts": "d31ca649d1ced7a5a346963da1330e29cdc953560bcba7825b7b271aa0c54f17",
  "app/api/clip-items/[id]/promote/route.ts": "d2a6dbdcee397491afb7d1b82244a94c8754a3b7243703a75c08ddab64e89218",
  "app/api/red-films/productions/route.ts": "dd055fbfcdd19fa33cb5d241c7024696a8326b9054e639a420bb5648e2be184a",
  "app/api/red-films/productions/[id]/route.ts": "3fb198a3244277eadef0b231ba76357b3f9385078a585f5f55bf85c5331e0b0d",
  "app/api/red-films/productions/bulk-permanent-delete/route.ts": "c176d9d02f12393c56c7faf612762b6a1a89f4b993f2befc709b0647d4201e1b",
  "app/api/red-films/budget-items/[itemId]/payments/route.ts": "f2230177508724d887c162d6e32c78130fb2ef323479af93f8e66285bae01349",
  "app/api/red-films/productions/[id]/documents/upload/route.ts": "82561ad85f4861a6189539aeeef435da737df14851266f95138920ae7068800b",
  "components/red-films/RedFilmsStatusBadge.tsx": "4f41f32f43f7c113649db6c0d9e0d484ab9a3cd3fd8dbdf15847f5fe212d699b",
};

/** Route families touching video (internal — the test re-discovers them). */
export const RF_ROUTE_GROUPS = [
  { pattern: "^app/api/red-films/", note: "Red Films productions / budget / payments / documents / references / equipment" },
  { pattern: "^app/api/clip-items/", note: "project clip planning rows + promote" },
  { pattern: "^app/api/projects/\\[id\\]/clip/", note: "project clip deal (price, payments, send clip)" },
] as const;
