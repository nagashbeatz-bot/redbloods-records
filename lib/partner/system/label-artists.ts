/**
 * Sunny System Awareness — LABEL ARTISTS DEEP CONTRACT (artist development as Redbloods actually implements it).
 *
 * Produced by the Label Artists Deep Brain discovery (2026-09-25): every store / route / portal / push path touching
 * label artists, releases, beats, the artist ledger + balance cycles, media income, show → ledger and portals, the
 * live production schema (columns, CHECK constraints, FKs, unique indexes) and read-only production counts.
 * Pure data; served through system_awareness mode artist_model. Semantic only — no table / env / secret / source path
 * in served content (the schema pin and file lists below are internal to the coverage test).
 */
import type { ApprovalClass, Enforcement, Who } from "./project-actions";

export const LABEL_BASELINE_VERSION = "2026.09.25-label-1";

/** Live production columns (information_schema, 2026-09-25) — internal, pinned by the test. */
export const LABEL_SCHEMA_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  label_artists: ["id", "name", "status", "image_url", "notes", "created_at", "updated_at"],
  project_release_details: ["project_id", "release_stage", "release_target_date", "next_action", "blocker", "responsible", "stage_entered_at", "released_at", "created_at", "updated_at", "label_artist_id"],
  beats: ["id", "name", "genre", "file_name", "dropbox_path", "duration_seconds", "status", "created_at", "musical_key"],
  beat_artist_assignments: ["id", "beat_id", "artist_slug", "created_at"],
  artist_balance_entries: ["id", "artist_id", "entry_type", "amount", "entry_date", "description", "note", "source_tx_id", "created_at", "updated_at", "source_show_id"],
  artist_balance_cycles: ["id", "artist_id", "cycle_index", "start_date", "end_date", "income", "expected_income", "payments", "expenses", "expected_expenses", "ending_balance", "closed_at", "created_at"],
  label_media_income: ["id", "label_artist_id", "record_type", "reverses_id", "gross_amount", "source", "report_period", "received_date", "status", "notes", "label_share", "artist_share_gross", "recoup_before", "recouped", "artist_payable", "recoup_after", "created_at", "updated_at"],
};
/** Semantic entity name per table (the only name ever served). */
export const LABEL_ENTITY_OF: Readonly<Record<string, string>> = {
  label_artists: "label artist", project_release_details: "release", beats: "beat", beat_artist_assignments: "beat assignment",
  artist_balance_entries: "artist ledger entry", artist_balance_cycles: "balance cycle", label_media_income: "media income record",
};

export type FieldClass = "CANONICAL" | "DERIVED" | "DISPLAY_ONLY" | "LEGACY" | "AMBIGUOUS" | "POSSIBLE_BUG" | "CONFLICT";
export interface LabelField { entity: string; field: string; classification: FieldClass; meaning: string; validation: string; writers: string; readers: string; history: string; sunnyReads: string }
const D: Record<string, { writers: string; readers: string; sunnyReads: string }> = {
  "label artist": { writers: "Owner (add-artist modal; add-release 'create artist'); the edit route exists but no screen calls it; no delete exists", readers: "label page, artist page / portal, releases, ledger, beats (via portal slug by name), Partner", sunnyReads: "artist_view identity" },
  "release": { writers: "Owner (label page / artist page / dashboard add-release; new label song = one transaction; convert project = guarded + rollback); stage edits use an optimistic lock", readers: "label page, artist page, portal next-release card + weekly view, dashboard releases card, COO", sunnyReads: "artist_view releases, releases" },
  "beat": { writers: "Owner (beats page upload / edit / delete)", readers: "beats page, portals (only assigned beats)", sunnyReads: "artist_view beats" },
  "beat assignment": { writers: "Owner (assign / unassign) — assignment pushes the artist once", readers: "portal beats tab, stream / download checks", sunnyReads: "artist_view beats" },
  "artist ledger entry": { writers: "Owner (ledger modals; 'mark received' turns an expected income into income in place); show sync (Shalev expected row at booking); close-show (income + optional payment, all roster artists)", readers: "artist portal balance tab (Owner full; Shalev read-only), cycle close snapshot, Partner", sunnyReads: "artist_view money" },
  "balance cycle": { writers: "cycle close only (insert; never updated / deleted)", readers: "portal balance tab (history), Partner", sunnyReads: "artist_view money" },
  "media income record": { writers: "Owner via server transactions (create / update with optimistic lock / cancel — a received record gets an appended reversal); the split + recoup numbers are computed there", readers: "label page KPIs + recoup view", sunnyReads: "artist_view money" },
};
const F = (entity: string, field: string, classification: FieldClass, meaning: string, validation: string, history = "no change history", o: Partial<LabelField> = {}): LabelField =>
  ({ entity, field, classification, meaning, validation, history, writers: D[entity].writers, readers: D[entity].readers, sunnyReads: D[entity].sunnyReads, ...o });

export const LABEL_FIELDS: readonly LabelField[] = [
  F("label artist", "id", "CANONICAL", "Label artist identity — the canonical roster key (releases, ledger, cycles, media income point here; delete is restricted by those links).", "generated"),
  F("label artist", "name", "CANONICAL", "Display name — ALSO the key to the portal slug, to projects (artist text tokens), to shows (via a client record of the same name) and to Red Films / social (artist name text).", "required, trimmed; DB-unique on the normalized name"),
  F("label artist", "status", "CANONICAL", "Roster state: פעיל / בהשהייה / לא פעיל.", "DB check (3 values); default פעיל"),
  F("label artist", "image_url", "DISPLAY_ONLY", "Avatar URL (else the portal profile image in the artist's storage folder).", "none", "none", { sunnyReads: "artist_view identity (hasImage only — the URL is not served)" }),
  F("label artist", "notes", "LEGACY", "Free-text notes — no screen writes or shows them today.", "none"),
  F("label artist", "created_at", "CANONICAL", "When the artist joined the roster (roster order).", "default now", "creation only"),
  F("label artist", "updated_at", "CANONICAL", "Last change to the record.", "default now", "last change only"),
  F("release", "project_id", "CANONICAL", "The project this release is (1:1; the project IS the song).", "FK, cascade on project delete"),
  F("release", "label_artist_id", "CANONICAL", "The artist the release belongs to — the ONLY canonical artist ↔ project link.", "FK, restrict"),
  F("release", "release_stage", "CANONICAL", "Owner-managed stage: רעיון, הפקה, הקלטה, עריכות, מיקס, מאסטר, עטיפה, הפצה, תוכן, מוכן ליציאה, יצא, בהשהייה (NOT derived from the project status).", "DB check; default רעיון"),
  F("release", "release_target_date", "CANONICAL", "Planned release date (a target, not a commitment to a client).", "YYYY-MM-DD", "overwritten"),
  F("release", "next_action", "CANONICAL", "Owner's free-text next step.", "none", "overwritten"),
  F("release", "blocker", "CANONICAL", "Owner's free-text blocker (drives 'needs attention').", "none", "overwritten"),
  F("release", "responsible", "CANONICAL", "Who holds the next step (suggested: אני / שליו / ויקטור / סטיבן / אחר — free text).", "none", "overwritten"),
  F("release", "stage_entered_at", "CANONICAL", "When the current stage started (reset on every real stage change).", "default now", "current stage only — earlier stages are not recorded"),
  F("release", "released_at", "CONFLICT", "When it came out. Set when moving to יצא; CLEARED on any move away from יצא — so a re-staged release loses its release date.", "—", "not preserved"),
  F("release", "created_at", "CANONICAL", "Release row created (conversion / new label song).", "default now", "creation only"),
  F("release", "updated_at", "CANONICAL", "Last change — also the optimistic-lock token.", "default now", "last change only"),
  F("beat", "id", "CANONICAL", "Beat identity.", "generated"),
  F("beat", "name", "CANONICAL", "Beat name.", "non-empty"),
  F("beat", "genre", "CANONICAL", "dancehall / rnb / hiphop / soul.", "DB check"),
  F("beat", "musical_key", "CANONICAL", "Musical key ('<note> Major/Minor').", "DB check or null"),
  F("beat", "file_name", "CANONICAL", "Audio file name.", "required"),
  F("beat", "dropbox_path", "CANONICAL", "Storage path of the audio (metadata, never a share link).", "unique (case-insensitive)", "—", { sunnyReads: "artist_view beats (path metadata)" }),
  F("beat", "duration_seconds", "CANONICAL", "Length.", "> 0 or null"),
  F("beat", "status", "CANONICAL", "available / archived.", "DB check; default available"),
  F("beat", "created_at", "CANONICAL", "Uploaded.", "default now", "creation only"),
  F("beat assignment", "id", "CANONICAL", "Assignment identity.", "generated"),
  F("beat assignment", "beat_id", "CANONICAL", "The beat.", "FK, cascade"),
  F("beat assignment", "artist_slug", "AMBIGUOUS", "The artist the beat is offered to — by PORTAL SLUG (a fixed name → slug table in the app), not by artist id; never linked to a project or release.", "unique per beat + slug"),
  F("beat assignment", "created_at", "CANONICAL", "When it was assigned (the artist was pushed once).", "default now", "creation only"),
  F("artist ledger entry", "id", "CANONICAL", "Entry identity.", "generated"),
  F("artist ledger entry", "artist_id", "CANONICAL", "The label artist (scope is always by id).", "FK, restrict"),
  F("artist ledger entry", "entry_type", "CANONICAL", "הכנסות / הכנסות צפויות / תשלומים / הוצאות / הוצאות צפויות.", "DB check"),
  F("artist ledger entry", "amount", "CANONICAL", "Positive amount — NO currency is stored (the screens show ₪).", "> 0"),
  F("artist ledger entry", "entry_date", "CANONICAL", "Economic date (decides the cycle window).", "strict YYYY-MM-DD"),
  F("artist ledger entry", "description", "CANONICAL", "Free text (show sync writes 'הופעה - <name>').", "none"),
  F("artist ledger entry", "note", "CANONICAL", "Free text.", "none"),
  F("artist ledger entry", "source_tx_id", "CANONICAL", "The artist-fee finance row that created a show expected row (dedupe key).", "unique when set"),
  F("artist ledger entry", "source_show_id", "CANONICAL", "The show a close-show income came from (dedupe with the artist for income types).", "FK set null; unique with artist for income types"),
  F("artist ledger entry", "created_at", "CANONICAL", "Written.", "default now", "creation only"),
  F("artist ledger entry", "updated_at", "CANONICAL", "Last change (e.g. expected → received in place).", "default now", "last change only — the expected → received promotion is not recorded"),
  F("balance cycle", "id", "CANONICAL", "Snapshot identity.", "generated"),
  F("balance cycle", "artist_id", "CANONICAL", "The artist.", "FK, restrict"),
  F("balance cycle", "cycle_index", "CANONICAL", "0-based cycle number from the anchor.", "unique per artist (double close refused)"),
  F("balance cycle", "start_date", "CANONICAL", "Window start (anchor + 2 × index months).", "—"),
  F("balance cycle", "end_date", "CANONICAL", "Window end (EXCLUSIVE).", "—"),
  F("balance cycle", "income", "CANONICAL", "Frozen income inside the window.", "—", "frozen at close"),
  F("balance cycle", "expected_income", "CANONICAL", "Frozen expected income.", "—", "frozen at close"),
  F("balance cycle", "payments", "CANONICAL", "Frozen payments to the artist.", "—", "frozen at close"),
  F("balance cycle", "expenses", "CANONICAL", "Frozen expenses.", "—", "frozen at close"),
  F("balance cycle", "expected_expenses", "CANONICAL", "Frozen expected expenses.", "—", "frozen at close"),
  F("balance cycle", "ending_balance", "CANONICAL", "Frozen window balance = income − payments − expenses (no carry-over between cycles).", "—", "frozen at close"),
  F("balance cycle", "closed_at", "CANONICAL", "When it was closed (early close allowed with an explicit force).", "default now", "close time"),
  F("balance cycle", "created_at", "CANONICAL", "Row written.", "default now", "creation only"),
  F("media income record", "id", "CANONICAL", "Record identity.", "generated"),
  F("media income record", "label_artist_id", "CANONICAL", "The artist.", "FK, restrict"),
  F("media income record", "record_type", "CANONICAL", "income / reversal (a cancelled received income gets a reversal, never an edit).", "DB check"),
  F("media income record", "reverses_id", "CANONICAL", "The income a reversal cancels.", "required for reversals only"),
  F("media income record", "gross_amount", "CANONICAL", "Gross amount from the platform — NO currency stored.", "> 0"),
  F("media income record", "source", "CANONICAL", "Platform / distributor (default Mobile1).", "none"),
  F("media income record", "report_period", "AMBIGUOUS", "Reporting period as free text.", "none"),
  F("media income record", "received_date", "CANONICAL", "When the money arrived.", "date"),
  F("media income record", "status", "CANONICAL", "התקבל / צפוי / בוטל.", "DB check + consistency checks with the split / recoup numbers"),
  F("media income record", "notes", "CANONICAL", "Free text.", "none"),
  F("media income record", "label_share", "DERIVED", "Label's share (computed server-side at write).", "consistency checks"),
  F("media income record", "artist_share_gross", "DERIVED", "Artist's gross share.", "label + artist = gross for expected"),
  F("media income record", "recoup_before", "DERIVED", "Artist recoup balance before this record (stored at write).", "consistency checks"),
  F("media income record", "recouped", "DERIVED", "Amount of the artist share applied to recoup.", "consistency checks"),
  F("media income record", "artist_payable", "DERIVED", "Artist share left payable after recoup.", "consistency checks"),
  F("media income record", "recoup_after", "DERIVED", "Recoup balance after this record.", "consistency checks"),
  F("media income record", "created_at", "CANONICAL", "Written.", "default now", "creation only"),
  F("media income record", "updated_at", "CANONICAL", "Last change (optimistic lock).", "default now", "last change only"),
];

export const LABEL_VOCABULARIES = {
  artistStatuses: ["פעיל", "בהשהייה", "לא פעיל"],
  releaseStages: ["רעיון", "הפקה", "הקלטה", "עריכות", "מיקס", "מאסטר", "עטיפה", "הפצה", "תוכן", "מוכן ליציאה", "יצא", "בהשהייה"],
  ledgerEntryTypes: ["הכנסות", "הכנסות צפויות", "תשלומים", "הוצאות", "הוצאות צפויות"],
  mediaRecordTypes: ["income", "reversal"],
  mediaStatuses: ["התקבל", "צפוי", "בוטל"],
  beatGenres: ["dancehall", "rnb", "hiphop", "soul"],
  beatStatuses: ["available", "archived"],
  showStatuses: ["ליד חדש", "ממתין לתשובה", "צריך פולואפ", "נסגר", "אושרה", "בוצע", "בוטל"],
  showPaymentStatuses: ["שולם", "לא שולם", "צפוי", "מקדמה", "בוטל"],
  djConfirmationStatuses: ["ממתין לאישור", "אושר"],
  portalSlugs: { "שליו טסמה": "shalev-tasama", "אבי מולה": "avi-molla", "DJ CLEANTONE": "dj-cleantone", "נגש ביטס": "nagash-beats" },
} as const;

export const MEMBERSHIP_MODEL = {
  whatMakesALabelArtist: "a row in the label roster (canonical). The roster is never derived from project artist text.",
  statusSemantics: "פעיל / בהשהייה / לא פעיל — Owner-set; no screen changes it after creation today (the edit route has no caller).",
  portal: "an artist has a portal only when the app's fixed name → slug table lists the exact name (4 names today); login exists only for Shalev, Avi and CLEANTONE (by account email); Nagash has a portal page but no login.",
  releaseCandidates: "the add-release picker also offers CLIENT records whose status is אמן לייבל and creates the roster row on demand",
  noConcepts: "there is no prospect / former / collaborator concept; collaborators exist only as extra names in a project's artist text",
  cleantone: "DJ CLEANTONE is a roster artist AND the label DJ; his shows are matched by the app's fixed client id (not by name)",
} as const;

export type LinkQuality = "CANONICAL_RELATION" | "OWNER_CONFIRMED_RELATION" | "DERIVED_RELATION" | "TEXT_MATCH" | "AMBIGUOUS" | "UNKNOWN";
export interface ArtistLink { id: string; to: string; method: string; quality: LinkQuality; enforcement: string; note: string }
export const ARTIST_LINKS: readonly ArtistLink[] = [
  { id: "RELEASE", to: "release → project", method: "the release's artist id", quality: "CANONICAL_RELATION", enforcement: "FK (restrict)", note: "the only canonical artist ↔ project link; a project switched back to client work keeps its release row and still shows on the artist page" },
  { id: "PROJECT_BY_NAME", to: "project", method: "project artist text token equals the artist name", quality: "TEXT_MATCH", enforcement: "none", note: "every other artist project; collaborations name several artists" },
  { id: "PROJECT_LABEL_CLASSIFICATION", to: "project (label vs client work)", method: "stored business type לייבל / Owner answer in Company Integrity (label songs)", quality: "OWNER_CONFIRMED_RELATION", enforcement: "Owner decision", note: "most roster artists' projects are stored as לקוח; the Owner's classification decides label work" },
  { id: "LEDGER", to: "ledger entry / balance cycle / media income", method: "artist id", quality: "CANONICAL_RELATION", enforcement: "FK (restrict)", note: "three separate money records — never merged" },
  { id: "PORTAL", to: "portal / login role", method: "the app's fixed name → slug table + account email per role", quality: "CANONICAL_RELATION", enforcement: "app constants", note: "renaming an artist would detach the portal slug" },
  { id: "BEATS", to: "beat assignment", method: "portal slug", quality: "DERIVED_RELATION", enforcement: "unique per beat + slug", note: "via the name → slug table" },
  { id: "CLIENT_RECORD", to: "client record", method: "same name", quality: "TEXT_MATCH", enforcement: "none", note: "same person, separate record; client status אמן לייבל is a label, not a link" },
  { id: "SHOW_ARTIST", to: "show", method: "show artist client id → client record of the same name", quality: "TEXT_MATCH", enforcement: "FK to the client only", note: "show → ledger resolves the artist by the show's artist text (single exact token)" },
  { id: "SHOW_DJ", to: "show (DJ)", method: "show DJ client id = the app's CLEANTONE client id", quality: "CANONICAL_RELATION", enforcement: "app constant", note: "CLEANTONE only" },
  { id: "SESSIONS", to: "session", method: "through the session's project (sessions store no artist)", quality: "TEXT_MATCH", enforcement: "inherits the project link", note: "rehearsals also carry the show id" },
  { id: "RED_FILMS", to: "Red Films production / clip budget", method: "artist name text (and the project id when set)", quality: "TEXT_MATCH", enforcement: "none", note: "clip budgets feed the recoup target by name" },
  { id: "SOCIAL", to: "social campaign / content", method: "campaign artist name text; project id when set", quality: "TEXT_MATCH", enforcement: "none", note: "no artist id" },
  { id: "TASKS_MEETINGS", to: "task / meeting", method: "via the artist's projects (task related to project) or the artist's client record", quality: "DERIVED_RELATION", enforcement: "stored ids, no FK", note: "never fuzzy-attached" },
  { id: "CALENDAR", to: "calendar event", method: "stored event ids of the artist's sessions / shows; title matches", quality: "CANONICAL_RELATION", enforcement: "stored event id", note: "title matches stay TEXT_MATCH; personal events never become artist facts" },
  { id: "OWNER_KNOWLEDGE", to: "Owner knowledge", method: "subject label-artist:<id>", quality: "OWNER_CONFIRMED_RELATION", enforcement: "typed P2", note: "e.g. CLEANTONE LABEL_DJ, plays MOST shows" },
];

export const RELEASE_MODEL = {
  stages: LABEL_VOCABULARIES.releaseStages,
  active: "every stage except יצא and בהשהייה",
  dashboardGroups: { "בעבודה": ["רעיון", "הפקה", "הקלטה", "עריכות", "מיקס", "מאסטר"], "בהכנה לריליס": ["עטיפה", "הפצה", "תוכן"], "מתוזמן": ["מוכן ליציאה"], hidden: ["יצא", "בהשהייה"] },
  ready: "'מוכן ליציאה' is an Owner-set stage (the dashboard shows 'הכל מוכן'); there is NO readiness check — the stage is the Owner's statement",
  nextRelease: "the portal / weekly 'next release' = nearest target date ≥ today, IGNORING stage (a released or shelved row with a future date still counts); the non-portal artist page uses the nearest ACTIVE release",
  attention: "label page: next action, blocker or overdue target; dashboard: blocker or overdue; COO: target within 30 days or a blocker (P0 ≤ 3 days / past, P1 ≤ 14 days or blocker)",
  creation: "new label song (one transaction: project + release) or convert an existing releasable project (guards: releasable type, artist credited, no existing release; sets business type לייבל, rewrites the artist text unless a collaboration, rolls back on failure)",
  sideEffects: "none — stage changes send no push, touch no finance, write no calendar",
  history: "only the current stage start; released_at is cleared when leaving יצא — no stage history, no release history",
  cadenceEvidence: "released dates (released_at) + planned targets; the label page computes 'days since last release' but never shows it; no cadence target exists",
  visibilityQuirk: "the label list shows only business type לייבל (not hidden); the artist page / portal list the artist's releases with no business-type / hidden filter",
} as const;

export const MONEY_MODEL = {
  separateRecords: ["ARTIST_LEDGER (manual + show-synced entries)", "BALANCE_CYCLES (frozen 2-month snapshots of the ledger)", "MEDIA_INCOME (platform income with label / artist split and recoup, reversals)", "RECOUP_VIEW (derived on the label page: clip budgets vs artist income — never stored, never reconciled with the ledger)", "SHOW_MONEY (price, DJ fee, artist fee = half of net; finance rows income / DJ fee / artist fee)", "PROJECT_MONEY (label-work projects' finance rows)", "CLIENT_MONEY (the same person's client work — never artist money)"],
  currency: "the ledger, cycles, media income and shows store NO currency (screens show ₪); finance rows carry a currency. Sunny never adds a currency-less ledger amount to a currency-bearing row and never mixes ₪ / $.",
  ledgerFormula: "current balance = income − payments − expenses (expected income / expected expenses are shown but not counted)",
  cycles: "anchor date per artist (set once; editable only before the first close; optional first-cycle start). Windows are 2 calendar months from the anchor (end exclusive). Current cycle = max(cycle of today, number of closed cycles) — an early close advances it. Totals per window, no carry-over. Close refused before the window ends unless forced; a closed cycle is an immutable snapshot (unique per artist + index).",
  showToLedgerBooking: "Shalev only: when a show is confirmed (נסגר / אושרה / בוצע) with an artist fee > 0, an EXPECTED income row = artist fee (half of price − DJ fee − counted rehearsal costs), dated the show date, deduped by the artist-fee finance row; frozen once a manual income exists; removed (expected only) when the show is cancelled / reverted / deleted.",
  showToLedgerClose: "all roster artists (single exact artist token): closing a show as בוצע through the close-show dialog promotes / links / inserts an INCOME row = artist fee (deduped per show + artist) and, if 'artist paid' is ticked, a PAYMENT row (app-level dedupe). Unticking 'paid' deletes nothing (a warning is returned). Reopen / cancel after close leaves income and payment rows. Setting בוצע by a normal edit writes nothing.",
  djSeparation: "the DJ fee is only subtracted in the split; the DJ has his own finance row and no ledger",
  mediaIncome: "created / updated / cancelled only through server transactions that compute label share, artist share and recoup (before / recouped / payable / after) against a recoup target passed by the server; a received record is corrected only by an appended reversal. Media income does NOT touch the ledger or cycles.",
  recoup: "a real recoup CALCULATION exists but it is derived, not a ledger: target = the artist half of active clip budgets (by artist name); actual artist income = paid shows' artist fees + received media artist share; recouped = min(target, income); credit = income − target when positive; projections from expected shows / media. Media records also store their own recoup snapshot. Neither is reconciled with the artist ledger.",
  portalMoney: "Shalev sees the full ledger + cycles read-only; Avi, CLEANTONE and Nagash have no balance tab; Shalev's summary endpoint returns no balance; CLEANTONE sees his DJ fee + payment status per show",
  thirdView: "an older artist-summary balance from artist-fee finance rows (category שכר אמן) still exists in the summary endpoint but is no longer rendered",
} as const;

export const PORTAL_MODEL = {
  tabs: ["בית", "המוזיקה שלי", "ההופעות שלי", "מאזן", "ביטים פנויים", "לו״ז ועדכונים", "קבצי הופעות ויח״צ"],
  visibleTabs: { SHALEV_AND_OWNER: "all 7", AVI: "בית, ההופעות שלי, המוזיקה שלי, ביטים פנויים", CLEANTONE: "בית, ההופעות שלי", NAGASH: "בית, המוזיקה שלי (no login)" },
  shalevCan: "read ledger + cycles; create / edit sketches (versions); upload performance / press files; set avatar; send weekly availability; read assigned beats",
  aviCan: "read-only: play / download his sketches, download companion beats, register push",
  cleantoneCan: "see his shows (DJ fee + payment status), confirm / unconfirm a show (atomic), register push",
  ownerOnly: "ledger / cycles, ratings (Shalev's portal), sketch order / versions / companion beat / notify, project links, 'שלח' show buttons, 'קבע סשן' from availability, press-kit share link, beats management, next-work pick",
  storedOutsideDb: "sketches (music library), ratings, next-work, next-release card data, press kit, performance files and profile images live in each artist's storage folder / manifest — NOT in the database",
  accessNote: "an artist seeing a button is not responsibility for the result",
} as const;

export const AVAILABILITY_MODEL = {
  storage: "one settings record per artist (Shalev: his own key; others by portal slug): days [{day, date, available, from}], sentBy (owner / artist), sentAt — overwritten, never reset",
  cycle: "the week opens Thursday 08:00 Israel; the form shows the stored days only when sentAt ≥ that opening",
  writers: "the artist in the portal (≥ 2 valid days; pushes the Owner + the artist) or the Owner on the artist page (no push)",
  reminders: "Shalev only: Thu 12:00, Thu 18:00, Fri 09:00 (15-minute windows, skipped once submitted), claimed per week + slot, max 3 attempts; mandatory modal on mobile Thu 20:00 → Sat 21:00",
  sessions: "the Owner's 'קבע סשן' on an available day pre-fills a session — the only link to scheduling",
  meaning: "availability = the artist's stated free days for the week; not a booking, not a commitment",
} as const;

export const PRESENCE_MODEL = {
  storage: "one settings record per artist (Shalev / Avi / CLEANTONE): {at} = last portal entry",
  trigger: "the portal pings once per browser tab session; a 60-second race guard; the Owner is pushed 'X נכנס לאפליקציה' (production only); Owner previews never ping",
  meaning: "portal ACTIVITY evidence only — not work done, not availability",
  missing: "Nagash has no login, so no presence",
} as const;

/** Artist-related pushes / notifications (senders mapped; Sunny never sends). */
export const ARTIST_PUSHES: ReadonlyArray<{ id: string; trigger: string; recipients: string; source: "MANUAL" | "EVENT" | "CRON" | "PAGE_LOAD"; dedupe: string; marker: string | null; deepLink: string | null; guard: string; note?: string }> = [
  { id: "AVAILABILITY_SENT", trigger: "artist submits availability", recipients: "Owner + artist", source: "EVENT", dedupe: "tag only", marker: null, deepLink: "schedule tab", guard: "production" },
  { id: "AVAILABILITY_REMINDER", trigger: "Thu 12:00 / Thu 18:00 / Fri 09:00 until submitted", recipients: "Shalev", source: "CRON", dedupe: "per week + slot claim", marker: "availability reminder claim", deepLink: "schedule tab (availability)", guard: "production" },
  { id: "WEEKLY_SESSIONS", trigger: "Sunday 10:00–10:15 when he has sessions that week", recipients: "Shalev (+ Owner ack)", source: "CRON", dedupe: "per week", marker: "weekly sessions claim", deepLink: "schedule", guard: "production" },
  { id: "SESSION_REMINDER", trigger: "3 hours before each of his project sessions", recipients: "Shalev (+ Owner ack)", source: "CRON", dedupe: "per session + date + time", marker: "session reminder claim", deepLink: "schedule", guard: "production" },
  { id: "SESSION_CREATED", trigger: "a session is created on a project naming Shalev", recipients: "Shalev + Owner", source: "EVENT", dedupe: "per session", marker: null, deepLink: "schedule", guard: "production" },
  { id: "SHOW_TO_ARTIST", trigger: "Owner presses 'שלח' on an upcoming show (אושרה / נסגר)", recipients: "Shalev (+ Owner ack)", source: "MANUAL", dedupe: "per show + fingerprint of name / date / time / place", marker: "show sent to artist", deepLink: "shows tab", guard: "production" },
  { id: "SHOW_TO_DJ", trigger: "Owner presses 'שלח' for the DJ", recipients: "CLEANTONE (+ Owner)", source: "MANUAL", dedupe: "per show", marker: "show sent to DJ", deepLink: "DJ portal", guard: "production" },
  { id: "DJ_CONFIRMED", trigger: "CLEANTONE confirms a show", recipients: "Owner", source: "EVENT", dedupe: "per show + confirmation time", marker: null, deepLink: "shows", guard: "production" },
  { id: "BEAT_ASSIGNED", trigger: "a beat is newly assigned", recipients: "Avi or Shalev (+ Owner ack)", source: "EVENT", dedupe: "per assignment", marker: null, deepLink: "beats tab", guard: "production" },
  { id: "BEAT_UPLOADED_OR_UPDATED", trigger: "beat upload / edit", recipients: "Owner", source: "EVENT", dedupe: "per beat", marker: null, deepLink: "beats", guard: "production" },
  { id: "SKETCH_NEW_OR_VERSION", trigger: "Shalev adds a sketch / version", recipients: "Shalev + Owner ack", source: "EVENT", dedupe: "per sketch / version", marker: null, deepLink: "music tab", guard: "production" },
  { id: "SKETCH_NOTIFY", trigger: "Owner presses notify on a sketch", recipients: "Avi or Shalev + Owner", source: "MANUAL", dedupe: "per sketch + version", marker: null, deepLink: "music tab", guard: "production" },
  { id: "BALANCE_CYCLE_REMINDER", trigger: "Owner presses the cycle reminder", recipients: "Owner and / or the artist", source: "MANUAL", dedupe: "tag only", marker: null, deepLink: "Shalev's balance tab for every artist", guard: "NONE", note: "no environment guard; Avi has no balance tab and CLEANTONE cannot open that page (known bug)" },
  { id: "PORTAL_PRESENCE", trigger: "artist opens the portal", recipients: "Owner", source: "PAGE_LOAD", dedupe: "per tab session + 60 s", marker: "last entry", deepLink: null, guard: "production" },
];

export interface LabelActionEntry { id: string; area: "ARTIST" | "RELEASE" | "BEATS" | "LEDGER" | "CYCLES" | "MEDIA" | "SHOWS" | "SESSIONS" | "PORTAL" | "AVAILABILITY" | "SKETCHES" | "NOTIFY"; action: string; who: Who | "ARTIST"; enforcement: Enforcement; entryPoint: string; writes: string; sideEffects: string; finance: string | null; calendar: string | null; push: string | null; external: boolean; destructive: boolean; reversible: "YES" | "PARTIAL" | "NO"; approvalClass: ApprovalClass; sunnyToday: "KNOWLEDGE_ONLY"; futurePrimitive: string; internal: { routes: readonly string[] } }
type LA = Omit<LabelActionEntry, "sunnyToday" | "internal"> & { routes: readonly string[] };
const X = (e: LA): LabelActionEntry => { const { routes, ...rest } = e; return { ...rest, sunnyToday: "KNOWLEDGE_ONLY", internal: { routes } }; };
const AR = "app/api/label/artists/[id]";

export const LABEL_ACTIONS: readonly LabelActionEntry[] = [
  X({ id: "CREATE_LABEL_ARTIST", area: "ARTIST", action: "Add a label artist", who: "OWNER", enforcement: "ROUTE_CHECKS_OWNER", entryPoint: "label page 'add artist'; add-release 'create artist'", writes: "roster row", sideEffects: "no portal until the name is added to the app's slug table", finance: null, calendar: null, push: null, external: false, destructive: false, reversible: "PARTIAL", approvalClass: "STANDARD", futurePrimitive: "CREATE_LABEL_ARTIST", routes: ["app/api/label/artists/route.ts"] }),
  X({ id: "UPDATE_LABEL_ARTIST", area: "ARTIST", action: "Edit artist name / status / image / notes (route exists, no screen)", who: "OWNER", enforcement: "ROUTE_CHECKS_OWNER", entryPoint: "none", writes: "roster row", sideEffects: "a rename detaches the portal slug, projects, shows and client matching", finance: null, calendar: null, push: null, external: false, destructive: false, reversible: "YES", approvalClass: "STANDARD", futurePrimitive: "UPDATE_LABEL_ARTIST", routes: [`${AR}/route.ts`] }),
  X({ id: "CREATE_LABEL_SONG", area: "RELEASE", action: "New label song (project + release in one transaction)", who: "OWNER", enforcement: "ROUTE_CHECKS_OWNER", entryPoint: "label page 'create release'", writes: "project (לייבל) + release (רעיון)", sideEffects: "—", finance: null, calendar: null, push: null, external: false, destructive: false, reversible: "PARTIAL", approvalClass: "STANDARD", futurePrimitive: "CREATE_LABEL_SONG", routes: ["app/api/label/projects/route.ts"] }),
  X({ id: "CONVERT_TO_LABEL_RELEASE", area: "RELEASE", action: "Mark an existing project as a label release", who: "OWNER", enforcement: "ROUTE_CHECKS_OWNER", entryPoint: "label page 'mark project as label'; dashboard add-release", writes: "project business type לייבל + artist text rewrite (not collabs) + release row", sideEffects: "guarded; rolls back on failure", finance: null, calendar: null, push: null, external: false, destructive: false, reversible: "PARTIAL", approvalClass: "STANDARD", futurePrimitive: "CONVERT_TO_LABEL_RELEASE", routes: ["app/api/label/releases/route.ts"] }),
  X({ id: "UPDATE_RELEASE", area: "RELEASE", action: "Change release stage / target / next action / blocker / responsible (optimistic lock)", who: "OWNER", enforcement: "ROUTE_CHECKS_OWNER", entryPoint: "label page / artist page release card", writes: "release row", sideEffects: "stage change resets the stage start; יצא sets the release date, leaving יצא clears it", finance: null, calendar: null, push: null, external: false, destructive: false, reversible: "PARTIAL", approvalClass: "STANDARD", futurePrimitive: "UPDATE_RELEASE_STAGE", routes: ["app/api/label/releases/[projectId]/route.ts"] }),
  X({ id: "SET_PROJECT_BUSINESS_TYPE", area: "RELEASE", action: "Switch a project between לקוח / לייבל (release kept dormant; no screen)", who: "OWNER", enforcement: "ROUTE_CHECKS_OWNER", entryPoint: "none", writes: "project business type", sideEffects: "changes label / client classification", finance: "changes which money counts as label", calendar: null, push: null, external: false, destructive: false, reversible: "YES", approvalClass: "STANDARD", futurePrimitive: "SET_PROJECT_BUSINESS_TYPE", routes: ["app/api/label/projects/[id]/business-type/route.ts"] }),
  X({ id: "BEAT_UPLOAD_EDIT_DELETE", area: "BEATS", action: "Upload / edit / delete a beat", who: "OWNER", enforcement: "ROUTE_CHECKS_OWNER", entryPoint: "beats page", writes: "beat row + audio file", sideEffects: "delete removes the file", finance: null, calendar: null, push: "Owner self-notice", external: true, destructive: true, reversible: "NO", approvalClass: "DESTRUCTIVE", futurePrimitive: "MANAGE_BEAT", routes: ["app/api/beats/route.ts", "app/api/beats/[id]/route.ts"] }),
  X({ id: "ASSIGN_BEAT", area: "BEATS", action: "Assign / unassign a beat to an artist", who: "OWNER", enforcement: "ROUTE_CHECKS_OWNER", entryPoint: "beats page", writes: "beat assignment", sideEffects: "—", finance: null, calendar: null, push: "artist pushed on a NEW assignment", external: true, destructive: false, reversible: "YES", approvalClass: "EXTERNAL_EFFECT", futurePrimitive: "ASSIGN_BEAT", routes: ["app/api/beats/[id]/assignments/route.ts"] }),
  X({ id: "LEDGER_ENTRY", area: "LEDGER", action: "Add / edit / delete a ledger entry; mark expected income received", who: "OWNER", enforcement: "ROUTE_CHECKS_OWNER", entryPoint: "artist portal balance tab (Owner)", writes: "ledger entry", sideEffects: "changes the current cycle totals", finance: "artist balance", calendar: null, push: null, external: false, destructive: true, reversible: "PARTIAL", approvalClass: "FINANCIAL", futurePrimitive: "RECORD_ARTIST_LEDGER_ENTRY", routes: [`${AR}/balance/route.ts`, `${AR}/balance/[entryId]/route.ts`] }),
  X({ id: "CYCLE_ANCHOR", area: "CYCLES", action: "Set / correct the balance-cycle anchor", who: "OWNER", enforcement: "ROUTE_CHECKS_OWNER", entryPoint: "balance tab", writes: "anchor setting", sideEffects: "correction refused after the first close", finance: "cycle windows", calendar: null, push: null, external: false, destructive: false, reversible: "PARTIAL", approvalClass: "FINANCIAL", futurePrimitive: "SET_CYCLE_ANCHOR", routes: [`${AR}/balance/cycles/route.ts`] }),
  X({ id: "CLOSE_CYCLE", area: "CYCLES", action: "Close the current cycle (early close needs force)", who: "OWNER", enforcement: "ROUTE_CHECKS_OWNER", entryPoint: "balance tab", writes: "frozen cycle snapshot", sideEffects: "immutable; advances the current cycle", finance: "freezes totals", calendar: null, push: null, external: false, destructive: false, reversible: "NO", approvalClass: "FINANCIAL", futurePrimitive: "CLOSE_BALANCE_CYCLE", routes: [`${AR}/balance/cycles/close/route.ts`] }),
  X({ id: "CYCLE_REMINDER", area: "NOTIFY", action: "Send the balance-cycle reminder push", who: "OWNER", enforcement: "ROUTE_CHECKS_OWNER", entryPoint: "balance tab", writes: "—", sideEffects: "no environment guard; wrong deep link for non-Shalev artists", finance: null, calendar: null, push: "Owner and / or artist", external: true, destructive: false, reversible: "NO", approvalClass: "EXTERNAL_EFFECT", futurePrimitive: "NOTIFY_ARTIST", routes: [`${AR}/balance/cycles/remind/route.ts`] }),
  X({ id: "MEDIA_INCOME", area: "MEDIA", action: "Add / edit / cancel media income (server transactions; reversal for received)", who: "OWNER", enforcement: "ROUTE_CHECKS_OWNER", entryPoint: "label page media", writes: "media income record(s)", sideEffects: "recoup snapshot computed at write", finance: "label / artist split, recoup", calendar: null, push: null, external: false, destructive: false, reversible: "PARTIAL", approvalClass: "FINANCIAL", futurePrimitive: "RECORD_MEDIA_INCOME", routes: [`${AR}/media/route.ts`, "app/api/label/media/[recordId]/route.ts", "app/api/label/media/[recordId]/cancel/route.ts"] }),
  X({ id: "SHOW_LIFECYCLE", area: "SHOWS", action: "Create / edit / close / cancel / delete a show (finance triple, Shalev expected row, close-show ledger)", who: "OWNER", enforcement: "ROUTE_CHECKS_OWNER", entryPoint: "shows hub / drawer / close-show dialog", writes: "show + finance rows + ledger rows", sideEffects: "see MONEY_MODEL show → ledger; delete blocked while rehearsals exist", finance: "income / DJ fee / artist fee rows, ledger", calendar: "show event", push: null, external: true, destructive: true, reversible: "PARTIAL", approvalClass: "FINANCIAL", futurePrimitive: "CREATE_SHOW / CLOSE_SHOW", routes: ["app/api/shows/route.ts", "app/api/shows/[id]/route.ts"] }),
  X({ id: "NOTIFY_SHOW", area: "NOTIFY", action: "Send a show to the artist / the DJ", who: "OWNER", enforcement: "ROUTE_CHECKS_OWNER", entryPoint: "shows / portal shows tab 'שלח'", writes: "sent marker", sideEffects: "dedupe by show fingerprint", finance: null, calendar: null, push: "artist / DJ", external: true, destructive: false, reversible: "NO", approvalClass: "EXTERNAL_EFFECT", futurePrimitive: "NOTIFY_ARTIST_DJ", routes: ["app/api/shows/[id]/notify-artist/route.ts", "app/api/shows/[id]/notify-dj/route.ts"] }),
  X({ id: "DJ_CONFIRM", area: "SHOWS", action: "CLEANTONE confirms / unconfirms a show", who: "ARTIST", enforcement: "ROLE_SCOPED", entryPoint: "DJ portal", writes: "show DJ confirmation", sideEffects: "atomic conditional update", finance: null, calendar: null, push: "Owner on confirm", external: false, destructive: false, reversible: "YES", approvalClass: "STANDARD", futurePrimitive: "—", routes: ["app/api/red-artists/cleantone/shows/[id]/confirm/route.ts", "app/api/red-artists/cleantone/shows/[id]/unconfirm/route.ts"] }),
  X({ id: "ARTIST_SESSION", area: "SESSIONS", action: "Book a session / rehearsal for an artist project", who: "OWNER", enforcement: "PROXY_ONLY", entryPoint: "schedule tab 'קבע סשן', quick actions", writes: "session (+ rehearsal finance, show re-sync)", sideEffects: "rehearsal cost changes the show split and Shalev's expected row", finance: "rehearsal expense", calendar: "event", push: "Shalev session push", external: true, destructive: false, reversible: "YES", approvalClass: "EXTERNAL_EFFECT", futurePrimitive: "SCHEDULE_SESSION", routes: ["app/api/sessions/route.ts", "app/api/sessions/[id]/route.ts"] }),
  X({ id: "AVAILABILITY_SUBMIT", area: "AVAILABILITY", action: "Submit weekly availability (artist or Owner)", who: "ARTIST", enforcement: "ROLE_SCOPED", entryPoint: "portal schedule tab / artist page", writes: "availability setting", sideEffects: "stops reminders for the week", finance: null, calendar: null, push: "artist submission pushes Owner + artist; Owner save does not", external: true, destructive: false, reversible: "YES", approvalClass: "STANDARD", futurePrimitive: "—", routes: ["app/api/red-artists/availability/route.ts", `${AR}/availability/route.ts`] }),
  X({ id: "SKETCHES", area: "SKETCHES", action: "Add / version / rate / reorder / link / notify sketches (music library)", who: "OWNER", enforcement: "ROLE_SCOPED", entryPoint: "portal music tab", writes: "artist storage manifest (not the database)", sideEffects: "pushes on new sketch / version / notify", finance: null, calendar: null, push: "artist + Owner", external: true, destructive: false, reversible: "PARTIAL", approvalClass: "EXTERNAL_EFFECT", futurePrimitive: "—", routes: ["app/api/red-artists/sketches/route.ts", `${AR}/sketches/route.ts`] }),
  X({ id: "PORTAL_FILES", area: "PORTAL", action: "Upload performance / press files, avatar, project cover; press-kit link; next-work", who: "OWNER", enforcement: "ROLE_SCOPED", entryPoint: "portal files / home", writes: "artist storage folder", sideEffects: "press-kit link creates a share link (Owner only)", finance: null, calendar: null, push: null, external: true, destructive: false, reversible: "PARTIAL", approvalClass: "EXTERNAL_EFFECT", futurePrimitive: "—", routes: ["app/api/red-artists/upload/route.ts", `${AR}/upload/route.ts`, `${AR}/next-work/route.ts`] }),
];

export interface ArtistWorkflow { event: string; support: "SUPPORTED" | "PARTIAL" | "NOT_SUPPORTED"; concept: string; evidence: string[]; missing: string[]; ask: string[]; actions: string }
const WF = (w: ArtistWorkflow) => w;
export const ARTIST_WORKFLOWS: readonly ArtistWorkflow[] = [
  WF({ event: "NEW_LABEL_ARTIST", support: "PARTIAL", concept: "roster row; a portal needs a code change (slug table)", evidence: ["roster"], missing: ["portal / login until added in code"], ask: ["name + status"], actions: "CREATE_LABEL_ARTIST (future primitive)" }),
  WF({ event: "NEW_ARTIST_PROJECT", support: "SUPPORTED", concept: "new label song (project + release) or a project naming the artist", evidence: ["projects", "release row"], missing: ["label vs client classification when created as a normal project"], ask: ["label work or client work? (only when not recorded)"], actions: "CREATE_LABEL_SONG / CONVERT_TO_LABEL_RELEASE" }),
  WF({ event: "PROJECT_TO_PRODUCTION", support: "PARTIAL", concept: "work sent to Victor (vendor work) or recorded in sessions", evidence: ["Victor work", "sessions", "release stage הפקה / הקלטה"], missing: ["an explicit handoff record for non-Victor production"], ask: ["who is producing when nothing is recorded"], actions: "Victor send (dashboard)" }),
  WF({ event: "PRODUCTION_TO_MIX", support: "SUPPORTED", concept: "engineer work (Steven / other) + mix versions + comments", evidence: ["engineer work", "versions", "open comments", "send log"], missing: [], ask: [], actions: "send to engineer (dashboard)" }),
  WF({ event: "MIX_TO_FINAL", support: "SUPPORTED", concept: "engineer work approved + final files + delivery", evidence: ["approved work", "final files", "delivery state"], missing: [], ask: [], actions: "approve / deliver (dashboard)" }),
  WF({ event: "READY_FOR_RELEASE", support: "PARTIAL", concept: "release stage מוכן ליציאה — an Owner statement, no readiness checks", evidence: ["stage", "blocker", "next action"], missing: ["an objective readiness definition"], ask: ["what 'ready' means (Owner policy) — only if the Owner wants it defined"], actions: "UPDATE_RELEASE" }),
  WF({ event: "RELEASE_PLANNED", support: "SUPPORTED", concept: "release with a target date", evidence: ["target", "stage", "responsible", "next action"], missing: [], ask: [], actions: "UPDATE_RELEASE" }),
  WF({ event: "RELEASE_LIVE", support: "PARTIAL", concept: "stage יצא (released date set; cleared if the stage changes again)", evidence: ["released date"], missing: ["platform links / release history"], ask: [], actions: "UPDATE_RELEASE" }),
  WF({ event: "NEW_SHOW", support: "SUPPORTED", concept: "show workflow (operating model NEW_SHOW)", evidence: ["show", "DJ", "finance rows", "rehearsals", "sent markers"], missing: ["price / venue / DJ / status when not given"], ask: ["only what is missing; DJ confirmed per show (CLEANTONE plays MOST, not all)"], actions: "Owner in the dashboard; notify = FUTURE_PRIMITIVE_REQUIRED" }),
  WF({ event: "SHOW_PREPARATION", support: "PARTIAL", concept: "rehearsal sessions + DJ confirmation + 'sent' markers", evidence: ["rehearsals (show id)", "DJ confirmation", "sent markers"], missing: ["a preparation checklist"], ask: [], actions: "ARTIST_SESSION / NOTIFY_SHOW" }),
  WF({ event: "SHOW_COMPLETED", support: "SUPPORTED", concept: "close-show dialog: בוצע + ledger income (+ payment)", evidence: ["status", "ledger rows by show"], missing: ["ledger when בוצע was set by a normal edit"], ask: ["was the artist paid? (if not recorded)"], actions: "SHOW_LIFECYCLE" }),
  WF({ event: "ARTIST_PAYMENT", support: "PARTIAL", concept: "a ledger payment row (manual or close-show)", evidence: ["ledger payments"], missing: ["payout workflow / method"], ask: [], actions: "LEDGER_ENTRY" }),
  WF({ event: "BALANCE_CYCLE", support: "SUPPORTED", concept: "anchor + 2-month windows + close", evidence: ["anchor", "closed snapshots", "current window"], missing: ["anchor for artists who have none"], ask: [], actions: "CYCLE_ANCHOR / CLOSE_CYCLE" }),
  WF({ event: "NEW_MEDIA_INCOME", support: "SUPPORTED", concept: "media income record with split + recoup", evidence: ["records", "reversals"], missing: ["currency"], ask: [], actions: "MEDIA_INCOME" }),
  WF({ event: "CLIP_PREPARATION", support: "PARTIAL", concept: "Red Films production / clip items / shoot-day sessions (by artist name or project)", evidence: ["production status", "shoot date", "budget"], missing: ["an artist id on productions"], ask: [], actions: "Red Films (dashboard)" }),
  WF({ event: "CONTENT_PREPARATION", support: "PARTIAL", concept: "social campaign + content items (by artist name or project)", evidence: ["campaign", "items", "due / publish dates"], missing: ["an artist id on campaigns", "a content plan / quota (none exists)"], ask: [], actions: "social (dashboard)" }),
  WF({ event: "ARTIST_AVAILABILITY", support: "SUPPORTED", concept: "weekly availability + reminders (Shalev)", evidence: ["stored days + sent time"], missing: ["reminders for other artists"], ask: [], actions: "AVAILABILITY_SUBMIT (artist)" }),
  WF({ event: "ARTIST_PORTAL_ACTIVITY", support: "PARTIAL", concept: "last portal entry (presence) + sketches / uploads (outside the DB)", evidence: ["last entry time"], missing: ["sketch / upload activity (storage manifest, not readable by Sunny)"], ask: [], actions: "—" }),
];

export const ARTIST_SIGNAL_MODEL: ReadonlyArray<{ code: string; kind: "CANONICAL_FACT" | "DERIVED_SIGNAL" | "UNKNOWN"; note: string }> = [
  { code: "ACTIVE_WORK", kind: "CANONICAL_FACT", note: "an open project of the artist (with its link quality)" },
  { code: "WAITING_PRODUCTION", kind: "DERIVED_SIGNAL", note: "Victor holds work on an artist project" },
  { code: "WAITING_MIX", kind: "DERIVED_SIGNAL", note: "an engineer holds work (with open comments)" },
  { code: "INTERNAL_DEADLINE_PASSED", kind: "DERIVED_SIGNAL", note: "a Victor / engineer internal deadline passed — an expectation, not a client commitment" },
  { code: "RELEASE_PLANNED", kind: "CANONICAL_FACT", note: "an active release with a target date" },
  { code: "RELEASE_TARGET_PASSED", kind: "DERIVED_SIGNAL", note: "an active release whose target date passed" },
  { code: "RELEASE_BLOCKER", kind: "CANONICAL_FACT", note: "the Owner recorded a blocker" },
  { code: "READY_FOR_RELEASE", kind: "CANONICAL_FACT", note: "stage מוכן ליציאה (Owner statement)" },
  { code: "RELEASED", kind: "CANONICAL_FACT", note: "stage יצא with a release date" },
  { code: "NO_RELEASE_RECORDED", kind: "CANONICAL_FACT", note: "the artist has no release row at all" },
  { code: "LABEL_PROJECT_WITHOUT_RELEASE", kind: "DERIVED_SIGNAL", note: "label work with no release row (the COO flags it too)" },
  { code: "UPCOMING_SESSION", kind: "CANONICAL_FACT", note: "a future session on an artist project" },
  { code: "UPCOMING_SHOW", kind: "CANONICAL_FACT", note: "a future show" },
  { code: "SHOW_WITHOUT_DJ", kind: "CANONICAL_FACT", note: "an active show with no DJ recorded — never auto-filled with CLEANTONE" },
  { code: "SHOW_DONE_UNPAID", kind: "CANONICAL_FACT", note: "a בוצע show whose client payment is not שולם" },
  { code: "NO_UPCOMING_RECORDED_WORK", kind: "DERIVED_SIGNAL", note: "no open moving project, no future session and no planned release recorded — evidence only, never a judgement" },
  { code: "LEDGER_BALANCE", kind: "DERIVED_SIGNAL", note: "the artist ledger balance (currency not stored)" },
  { code: "CYCLE_NOT_SET", kind: "CANONICAL_FACT", note: "the artist has ledger rows but no cycle anchor" },
  { code: "AVAILABILITY_THIS_WEEK", kind: "CANONICAL_FACT", note: "availability submitted for the current week" },
  { code: "IDENTITY_DUAL_ROLE", kind: "CANONICAL_FACT", note: "a client record with the same name exists (separate record, never merged)" },
];

export const LABEL_INTEGRITY = {
  productionCounts20260925: {
    roster: 4, rosterStatuses: { "פעיל": 4 }, withPortalSlug: 4, withLoginRole: 3, alsoClientRecord: 3,
    projectsByName: { "שליו טסמה": 5, "אבי מולה": 4, "נגש ביטס": 2, "DJ CLEANTONE": 0 }, labelBusinessTypeProjects: { "אבי מולה": 1, others: 0 },
    releases: 1, releaseStages: { "רעיון": 1 }, released: 0, releaseTargetPassed: 0, releaseArtistTextMismatch: 0,
    beats: 16, beatsArchived: 0, beatAssignments: { "shalev-tasama": 15, "avi-molla": 11 },
    ledgerEntries: { "שליו טסמה": { "הכנסות": 10, "הוצאות": 3, "תשלומים": 3, fromShows: 2, fromFinanceRows: 5 } }, closedCycles: 0, cycleAnchors: 1,
    mediaIncome: { "שליו טסמה": 1 }, shows: 10, showStatuses: { "בוצע": 7, "בוטל": 3 }, showsWithDj: 7, djConfirmation: { "אושר": 3, "ממתין לאישור": 2, none: 5 }, futureShows: 0,
    sessions: { "שליו טסמה": { total: 12, future: 1 }, "אבי מולה": { total: 5, future: 0 }, "נגש ביטס": { total: 0, future: 0 } },
    redFilms: { "שליו טסמה": 3 }, socialCampaigns: { "שליו טסמה": 1 }, availabilityRecords: 2, presenceRecords: 3,
  },
  findingsHe: [
    "רק ריליס אחד רשום בכל הלייבל (אבי, שלב רעיון) — לשליו אין אף שורת ריליס.",
    "כל 5 הפרויקטים של שליו שמורים כ'לקוח' (הסיווג שלך בשלמות הנתונים קובע שהם לייבל).",
    "יש מאזן לשליו (16 תנועות) אבל אין אף מחזור שנסגר.",
    "אין הופעות עתידיות רשומות כרגע.",
    "5 הופעות בלי סטטוס אישור DJ (חלקן לפני שמערכת האישור קיימת).",
  ],
} as const;

/** Server-side artist / release / ledger / media / beats / availability files — a change must review this contract. */
export const LABEL_REVIEWED_FILES = [
  "lib/label-artists-store.ts", "lib/release-store.ts", "lib/dashboard-releases.ts", "lib/artist-balance-store.ts", "lib/artist-balance-cycles-store.ts",
  "lib/artist-balance-show-sync.ts", "lib/artist-balance-show-sync-pure.ts", "lib/artist-balance-show-close-sync.ts", "lib/media-income-store.ts", "lib/label-recoup.ts",
  "lib/label-clips.ts", "lib/beats-store.ts", "lib/red-artists/portal-registry.ts", "lib/red-artists/availability.ts", "lib/shows-types.ts",
] as const;
export const LABEL_REVIEWED_FINGERPRINTS: Readonly<Record<string, string>> = {
  "lib/label-artists-store.ts": "c6717f38feb6ac1f871cf35ff364765c7646e926c7a229ef68f5c806be45bbba",
  "lib/release-store.ts": "5f4989ae851754847622070fedb7247be320823b7515cf44c7189e74bc5b4839",
  "lib/dashboard-releases.ts": "76d16f16c4624ab262e36c1ead9c95e2d6be447b0d54dd5e7b40190e9e1ef4a2",
  "lib/artist-balance-store.ts": "17a94547cf830d1d3b4fd9ef0276a8e77deccda7d823628532c515c9046a8bcf",
  "lib/artist-balance-cycles-store.ts": "e05ac92a21cbb374487cb014f1000c7eda6970455cc6d9fccb5d015924b55ffe",
  "lib/artist-balance-show-sync.ts": "f50e003a0835783db4bd37049d602f4ff82a927cfdb0d3e31592301ddd503764",
  "lib/artist-balance-show-sync-pure.ts": "bf0bfad2538c4c10a907638e923d029b06f8b1c2eb1f03cf7997c66cf021a0a7",
  "lib/artist-balance-show-close-sync.ts": "f5dc1d4a95233d8db0a2eece60db8616e9f8ed7432ea9fa4ce1021dfe0ad6e46",
  "lib/media-income-store.ts": "576044795299390987bf414634d95ba9703eea72e18d04aa8c83ab3cf3c52d5a",
  "lib/label-recoup.ts": "445adf5193491bef6db5f5cea24ea66117ccee666b2c57f19789e7fdea1c6c9a",
  "lib/label-clips.ts": "68cce31a6cacc93540fc91bc535ed68cbbd8bb355bca61b974fb6dc88b819413",
  "lib/beats-store.ts": "eb8b5bf1212f6192339d838cbb3a346e5370298796de2cd47296da3d2ee29bb3",
  "lib/red-artists/portal-registry.ts": "ed1434690be4f62b8cb7e119f07e3e6bdeba00db307d90164c14bb197e8776e9",
  "lib/red-artists/availability.ts": "7f698e3d6ede717cc3ab34671695c1c630ab7bdeccfd1983307e6cbbf6846ccf",
  "lib/shows-types.ts": "d97e5e51cd921bff4b0b604a5500e22933c339ad767a6847a63df844115dff29",
};

/** Every API route family touching label artists (internal — the test re-discovers routes and requires a match). */
export const LABEL_ROUTE_GROUPS: ReadonlyArray<{ pattern: string; purpose: string }> = [
  { pattern: "^app/api/label/artists/route\\.ts$", purpose: "roster list / create" },
  { pattern: "^app/api/label/artists/\\[id\\]/route\\.ts$", purpose: "artist record + releases / edit (no screen)" },
  { pattern: "^app/api/(label/artists/\\[id\\]|red-artists)/balance/", purpose: "artist ledger + balance cycles (Owner full; Shalev read-only)" },
  { pattern: "^app/api/label/(artists/\\[id\\]/)?media/", purpose: "media income create / edit / cancel" },
  { pattern: "^app/api/label/artists/\\[id\\]/(recoup|clips|shows)/", purpose: "read-only label finance views (recoup derivation, clips, shows)" },
  { pattern: "^app/api/(label/artists/\\[id\\]|red-artists)/sketches/", purpose: "music library (sketches, versions, ratings, companion beat, notify, order, project link) — storage manifest" },
  { pattern: "^app/api/(label/artists/\\[id\\]|red-artists)/(summary|shalev-summary|weekly|next-release|next-work)/", purpose: "portal home / weekly / next release / next work" },
  { pattern: "^app/api/(label/artists/\\[id\\]|red-artists)/availability/", purpose: "weekly availability" },
  { pattern: "^app/api/(label/artists/\\[id\\]|red-artists)(/cleantone)?/(ping|push-subscribe)/", purpose: "portal presence ping + push registration" },
  { pattern: "^app/api/(label/artists/\\[id\\]|red-artists)(/cleantone)?/(profile-image|project-cover|upload|performance-files|press-kit-link|download|stream|track-duration|beat/download)/", purpose: "portal files, press kit, streaming / downloads (storage)" },
  { pattern: "^app/api/red-artists/cleantone(-summary|/shows)/", purpose: "DJ portal summary + show confirm / unconfirm" },
  { pattern: "^app/api/label/(releases|projects)/", purpose: "releases: new label song, convert, stage edits, business type" },
  { pattern: "^app/api/beats/", purpose: "beats + assignments + streaming" },
  { pattern: "^app/api/shows/\\[id\\]/route\\.ts$", purpose: "show edit / close-show → artist ledger" },
  { pattern: "^app/api/dropbox/delete/route\\.ts$", purpose: "a Dropbox delete also unlinks the project folder from artist sketch links" },
];
