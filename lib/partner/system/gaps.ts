/**
 * Sunny System Awareness — the GLOBAL KNOWLEDGE / CONNECTIVITY GAP REGISTRY (every domain, not only Projects).
 *
 * Permanent rule (Owner, 2026-09-25): SUNNY KNOWS EVERYTHING REDBLOODS KNOWS. "Redbloods knows it but Sunny cannot
 * see it" is never an accepted final state — every such case is a registered gap with a reason and what would close
 * it. Only real secrets / access material are INTENTIONALLY_SECRET. Pure data; served through system_awareness.
 */

export type GapClass =
  | "DATA_NOT_RECORDED"        // Redbloods itself never stores it
  | "DATA_MODEL_GAP"           // stored, but without a stable relationship / id
  | "CAPABILITY_GAP"           // Redbloods has it, Sunny's read path cannot reach it yet
  | "AMBIGUOUS_IDENTITY"       // who / which entity is not deterministic
  | "CONFLICTING_SOURCES"      // two sources disagree
  | "INTENTIONALLY_SECRET"     // credentials / bearer access material — only the existence + health is knowledge
  | "TEMPORARILY_UNAVAILABLE"  // exists but a source may be down / cleared
  | "LEGACY_CONFLICT"          // an old surface still computes it differently
  | "SYSTEM_BEHAVIOR_GAP"      // the app itself behaves in a way that loses / corrupts meaning
  | "OWNER_DECISION_REQUIRED"  // the meaning is a policy only the Owner can set
  | "FUTURE_PRIMITIVE_REQUIRED"; // Sunny knows the action but no approved typed primitive exists yet

/** Knowledge disposition (Sunny's side). */
export type GapStatus = "CLOSED_NOW" | "PARTIALLY_CLOSED" | "DATA_NOT_RECORDED" | "FUTURE_SCHEMA_REQUIRED" | "CONFLICT_REQUIRES_OWNER_DECISION" | "SECURITY_REMEDIATION_REQUIRED" | "OPEN";

/** What the APPLICATION would need (separate from Sunny's knowledge). Never done inside a knowledge mission. */
export type AppRemediation = "NONE" | "SCHEMA_CHANGE" | "BUG_FIX_MISSION" | "SECURITY_FIX" | "OWNER_DECISION" | "OWNER_INPUT" | "OAUTH_OR_INTEGRATION_APPROVAL";

export interface KnowledgeGap {
  id: string;
  domain: string;
  entityType: string;
  class: GapClass;
  description: string;
  redbloodsKnows: string;
  sunnyKnows: string;
  why: string;
  wouldClose: string;
  relationshipsAffected: readonly string[];
  risk: "LOW" | "MEDIUM" | "HIGH";
  ownerImpact: string;
  futureActionImpact: string;
  status: GapStatus;
  appRemediation: AppRemediation;
  /** Where Sunny reads what it does know (capability[:mode/section]). */
  sunnyReadsVia: readonly string[];
  /** The item from the 92671ee report this disposes of (if inherited). */
  inherited92671ee?: string;
}

const G = (g: KnowledgeGap) => g;

export const KNOWLEDGE_GAPS: readonly KnowledgeGap[] = [
  // ── inherited from the Projects Deep Brain report (92671ee) ──
  G({ id: "PRJ_NOTES_NOT_READ", domain: "PROJECTS", entityType: "project", class: "CAPABILITY_GAP", inherited92671ee: "project notes not read",
    description: "Project notes and the other project-linked free text", redbloodsKnows: "project notes, financial notes, send-log notes, meeting notes, task descriptions, engineer instructions / comments / target notes, Victor review notes, Red Films director / photographer notes, release blocker / next action, clip / album / budget notes",
    sunnyKnows: "all of it, on demand, with provenance (OWNER_TEXT — never a canonical fact)", why: "earlier safe-read deliberately excluded free text", wouldClose: "project_view section notes (bounded per project)",
    relationshipsAffected: ["project → notes"], risk: "LOW", ownerImpact: "Sunny can quote what was written about a project", futureActionImpact: "a future UPDATE_PROJECT_NOTES primitive can preview the exact text", status: "CLOSED_NOW", appRemediation: "NONE", sunnyReadsVia: ["project_view:notes"] }),
  G({ id: "PRJ_FILES_NOT_READ", domain: "PROJECTS", entityType: "project file", class: "CAPABILITY_GAP", inherited92671ee: "project files not read",
    description: "The project's file / material list", redbloodsKnows: "name, category, version, track, size / duration, upload time, source (upload / intake / mix copy / work materials), Dropbox path, share link",
    sunnyKnows: "every entry's metadata, categories, versions, dates and source; the folder it lives in. Share links / tokens withheld (bearer access)", why: "earlier safe-read excluded paths and links", wouldClose: "project_view section files (links redacted)",
    relationshipsAffected: ["project → files", "engineer version → project file copy"], risk: "LOW", ownerImpact: "Sunny can answer 'what files exist / which version is latest'", futureActionImpact: "file actions stay DESTRUCTIVE / EXTERNAL_EFFECT class", status: "CLOSED_NOW", appRemediation: "NONE", sunnyReadsVia: ["project_view:files"] }),
  G({ id: "PRJ_WORK_MATERIALS_NOT_READ", domain: "PROJECTS", entityType: "work materials", class: "CAPABILITY_GAP", inherited92671ee: "work_materials not read",
    description: "BPM / key / instructions for the engineer", redbloodsKnows: "the work-materials object on the project", sunnyKnows: "all of it", why: "excluded earlier", wouldClose: "project_view section materials",
    relationshipsAffected: ["project → engineer"], risk: "LOW", ownerImpact: "Sunny knows what the engineer was told", futureActionImpact: "UPDATE_WORK_MATERIALS", status: "CLOSED_NOW", appRemediation: "NONE", sunnyReadsVia: ["project_view:materials"] }),
  G({ id: "PRJ_DROPBOX_FOLDER", domain: "FILES_DROPBOX", entityType: "project folder", class: "CAPABILITY_GAP", inherited92671ee: "dropbox_folder not read",
    description: "Where the project's files live and whether the folder is frozen", redbloodsKnows: "the frozen folder (or none → computed from the current artist + name); the live Dropbox listing lives in Dropbox",
    sunnyKnows: "the folder path, whether it is frozen (unfrozen = future uploads move on an artist change), and every file Redbloods recorded", why: "a LIVE Dropbox listing needs the Dropbox credential at read time (refreshing it writes the stored token); Sunny's read path is credential-free",
    wouldClose: "an Owner-approved read-only Dropbox listing primitive that never persists refreshed tokens", relationshipsAffected: ["project → Dropbox folder"], risk: "LOW", ownerImpact: "files uploaded straight to Dropbox (outside Redbloods) are invisible to Sunny and to Redbloods' own file list", futureActionImpact: "none (read)", status: "PARTIALLY_CLOSED", appRemediation: "OAUTH_OR_INTEGRATION_APPROVAL", sunnyReadsVia: ["project_view:files"] }),
  G({ id: "PRJ_SHOW_LINK", domain: "SHOWS", entityType: "show", class: "DATA_MODEL_GAP", inherited92671ee: "shows ↔ projects not linked",
    description: "Shows never reference a project (rehearsal sessions carry the show but no project; show money has no project)", redbloodsKnows: "the show's artist as a client id + text", sunnyKnows: "ARTIST-LEVEL context: shows of the same artist (never claimed as the project's shows)",
    why: "no column links a show to a project or release", wouldClose: "a nullable show → project / release link (schema change, Owner decision)", relationshipsAffected: ["project ↔ show", "release ↔ show"], risk: "LOW",
    ownerImpact: "'which show promotes this song' is unknown to Redbloods itself", futureActionImpact: "a future LINK_SHOW_TO_RELEASE primitive needs the schema first", status: "FUTURE_SCHEMA_REQUIRED", appRemediation: "SCHEMA_CHANGE", sunnyReadsVia: ["project_view:show_context"] }),
  G({ id: "PRJ_CLIENT_IDENTITY", domain: "CLIENTS", entityType: "client", class: "AMBIGUOUS_IDENTITY", inherited92671ee: "client ↔ project name-only",
    description: "Projects carry the client only as artist TEXT", redbloodsKnows: "artist text; id bridges on proposals (client + linked project), meetings (client + project), Red Films (client + project), send log (recipient client + project)",
    sunnyKnows: "TEXT_MATCH by exact token + DERIVED corroboration from every id bridge, and conflicts when a bridge names a different client", why: "projects have no client id; screens even disagree on case sensitivity",
    wouldClose: "a project → client id (schema change) or Owner-confirmed identity (P2)", relationshipsAffected: ["project ↔ client"], risk: "MEDIUM", ownerImpact: "renames / typos silently detach projects from clients", futureActionImpact: "client-targeted actions need a deterministic identity first", status: "PARTIALLY_CLOSED", appRemediation: "SCHEMA_CHANGE", sunnyReadsVia: ["client_view:projects", "project_view:people", "project_view:graph"] }),
  G({ id: "PRJ_PARENT_BY_NAME", domain: "PROJECTS", entityType: "parent project", class: "DATA_MODEL_GAP", inherited92671ee: "parent project name-only",
    description: "Parent project is free text ('אלבום: X', 'EP: X', a name, or ללא שיוך)", redbloodsKnows: "the text", sunnyKnows: "the text + the project(s) whose name matches exactly (TEXT_MATCH) + children pointing at this project by name",
    why: "typed by hand, no picker, no id", wouldClose: "a parent project id (schema change)", relationshipsAffected: ["project → parent", "parent → children"], risk: "LOW", ownerImpact: "renaming an album orphans its songs", futureActionImpact: "SET_PARENT_PROJECT", status: "FUTURE_SCHEMA_REQUIRED", appRemediation: "SCHEMA_CHANGE", sunnyReadsVia: ["project_view:graph"] }),
  G({ id: "PRJ_CALENDAR_LIVE", domain: "GOOGLE_CALENDAR", entityType: "calendar event", class: "CAPABILITY_GAP", inherited92671ee: "Google Calendar beyond sessions not read",
    description: "Live Google Calendar content", redbloodsKnows: "the Calendar page reads every calendar live from Google; Redbloods records store event ids",
    sunnyKnows: "the LIVE calendar (all calendars: titles, times, descriptions, locations, attendees + responses, organizer, recurrence, status, type, free / busy, holidays, untitled events) through the trusted MAIN integration, linked to Redbloods with explicit quality, plus availability", why: "closed 2026-09-25 (Sunny live calendar)",
    wouldClose: "—", relationshipsAffected: ["project → calendar events", "session / meeting / show → calendar event"], risk: "LOW", ownerImpact: "Sunny sees what the Owner's Calendar shows", futureActionImpact: "calendar writes stay future EXTERNAL_EFFECT primitives", status: "CLOSED_NOW", appRemediation: "NONE", sunnyReadsVia: ["calendar", "project_view:calendar"] }),
  G({ id: "PRJ_RED_FILMS_CREW", domain: "RED_FILMS", entityType: "crew", class: "DATA_MODEL_GAP", inherited92671ee: "Red Films crew not read",
    description: "Who shot / directed / edited", redbloodsKnows: "photographer / director / editor NAMES and notes as free text on the production; budget-item vendor names", sunnyKnows: "all of it as OWNER_TEXT (CREW_IDENTITY_TEXT, not an identity)",
    why: "crew are text, not people records", wouldClose: "crew as client / person ids (schema change)", relationshipsAffected: ["production → crew"], risk: "LOW", ownerImpact: "the same photographer under two spellings is two people", futureActionImpact: "crew payment actions need ids", status: "PARTIALLY_CLOSED", appRemediation: "SCHEMA_CHANGE", sunnyReadsVia: ["project_view:red_films"] }),
  G({ id: "PRJ_WAITING_ON", domain: "PROJECTS", entityType: "blocker", class: "DATA_NOT_RECORDED", inherited92671ee: "waiting for client / artist not recorded",
    description: "Who the project is waiting on", redbloodsKnows: "send-log entries (recipient role / name / status / follow-up), engineer status (חזר = back with the Owner), open mix comments, Victor work state + reviews, release blocker / responsible text",
    sunnyKnows: "every one of those signals with its evidence; Owner-taught PROJECT_BLOCKER knowledge", why: "no field says 'waiting for client / artist' unless the Owner logged a send", wouldClose: "the Owner logging sends / teaching blockers (no schema needed)",
    relationshipsAffected: ["project → waiting party"], risk: "MEDIUM", ownerImpact: "unlogged waits look like silence", futureActionImpact: "LOG_PROJECT_SEND", status: "PARTIALLY_CLOSED", appRemediation: "OWNER_INPUT", sunnyReadsVia: ["project_view:waiting"] }),
  G({ id: "PRJ_PRICE_UNKNOWN", domain: "FINANCE", entityType: "agreed price", class: "DATA_NOT_RECORDED", inherited92671ee: "19 open projects PRICE_UNKNOWN",
    description: "Open projects without an agreed price", redbloodsKnows: "production check 2026-09-25: of 20 open non-priced projects, 17 have no price in ANY source (no setting, proposal, transaction or production price); one has only a clip price; one stores price 0; one is a label project",
    sunnyKnows: "the per-project evidence (setting, proposal, transactions, production price) and why the verdict exists", why: "the price was never entered", wouldClose: "the Owner entering prices in Redbloods (never into P2)",
    relationshipsAffected: ["project → money"], risk: "MEDIUM", ownerImpact: "debt is UNKNOWN, not zero", futureActionImpact: "SET_PROJECT_AGREED_PRICE (FINANCIAL)", status: "DATA_NOT_RECORDED", appRemediation: "OWNER_INPUT", sunnyReadsVia: ["project_view:money"] }),
  G({ id: "PRJ_PRICE_ZERO", domain: "FINANCE", entityType: "agreed price", class: "CONFLICTING_SOURCES",
    description: "A price stored as 0 (and a Red Films production at 0)", redbloodsKnows: "agreedPrice = 0", sunnyKnows: "the value and that 0 is treated as 'no price' by the Finance Brain but as 'has setting' by other screens",
    why: "0 can mean free work, unknown, or a placeholder", wouldClose: "Owner decision: finance exception (free) vs. real price", relationshipsAffected: ["project → money"], risk: "LOW", ownerImpact: "unclear if money is owed", futureActionImpact: "SET_FINANCE_EXCEPTION or SET_PROJECT_AGREED_PRICE", status: "CONFLICT_REQUIRES_OWNER_DECISION", appRemediation: "OWNER_DECISION", sunnyReadsVia: ["project_view:money"] }),
  G({ id: "PRJ_ORPHAN_FINANCE_SETTINGS", domain: "FINANCE", entityType: "finance setting", class: "SYSTEM_BEHAVIOR_GAP", inherited92671ee: "9 orphan finance settings",
    description: "Price settings whose project no longer exists", redbloodsKnows: "9 rows (2026-09-25)", sunnyKnows: "the count and that they are ignored by the Finance Brain", why: "older delete paths / manual deletes left them",
    wouldClose: "a cleanup mission (Owner-approved)", relationshipsAffected: ["finance setting → project"], risk: "LOW", ownerImpact: "none today", futureActionImpact: "none", status: "CLOSED_NOW", appRemediation: "BUG_FIX_MISSION", sunnyReadsVia: ["system_awareness:project_model/integrity"] }),
  G({ id: "PRJ_UNFROZEN_FOLDERS", domain: "FILES_DROPBOX", entityType: "project folder", class: "SYSTEM_BEHAVIOR_GAP", inherited92671ee: "12 unfrozen Dropbox folders",
    description: "Projects whose folder is computed, not frozen", redbloodsKnows: "12 projects (2026-09-25)", sunnyKnows: "per project: frozen or not (project_view files.folderFrozen)", why: "folders freeze only on the first rename",
    wouldClose: "freeze-on-create (bug-fix mission)", relationshipsAffected: ["project → folder"], risk: "MEDIUM", ownerImpact: "an artist change moves future uploads", futureActionImpact: "CHANGE_PROJECT_ARTIST must disclose the folder move", status: "CLOSED_NOW", appRemediation: "BUG_FIX_MISSION", sunnyReadsVia: ["project_view:files"] }),
  G({ id: "PRJ_FINANCE_CONFLICTS", domain: "FINANCE", entityType: "project money", class: "LEGACY_CONFLICT", inherited92671ee: "finance conflicts C1–C17",
    description: "Screens compute project money differently (currencies mixed, exception ignored, 'expected' defined differently)", redbloodsKnows: "C1–C17", sunnyKnows: "every conflict and the canonical rule; project_view uses only the canonical rule",
    why: "legacy surfaces", wouldClose: "fix missions per conflict (Owner-approved)", relationshipsAffected: ["project → money"], risk: "MEDIUM", ownerImpact: "two screens can show two balances", futureActionImpact: "financial primitives preview the canonical verdict", status: "CONFLICT_REQUIRES_OWNER_DECISION", appRemediation: "BUG_FIX_MISSION", sunnyReadsVia: ["system_awareness:project_model/money"] }),
  G({ id: "PRJ_PAGE_LOAD_WRITES", domain: "SESSIONS", entityType: "session / project", class: "SYSTEM_BEHAVIOR_GAP", inherited92671ee: "page-load side effects",
    description: "Opening pages writes data (sessions auto-marked held by the device clock; legacy drawer overwrites start dates)", redbloodsKnows: "the behavior", sunnyKnows: "every page-load write and its risk", why: "implementation behavior",
    wouldClose: "bug-fix mission", relationshipsAffected: ["session status", "project start date"], risk: "MEDIUM", ownerImpact: "'held' may be wrong when a device clock is wrong", futureActionImpact: "none", status: "CLOSED_NOW", appRemediation: "BUG_FIX_MISSION", sunnyReadsVia: ["system_awareness:project_model/side_effects"] }),
  G({ id: "PRJ_PROPOSAL_CONVERT_NON_ATOMIC", domain: "PROPOSALS", entityType: "proposal → project", class: "SYSTEM_BEHAVIOR_GAP", inherited92671ee: "proposal conversion non-transactional",
    description: "Conversion is several writes; it also overwrites the whole finance setting", redbloodsKnows: "behavior", sunnyKnows: "behavior + the resulting link", why: "implementation", wouldClose: "bug-fix mission (atomic conversion)",
    relationshipsAffected: ["proposal → project"], risk: "MEDIUM", ownerImpact: "a failed conversion can leave a project without its proposal link / price", futureActionImpact: "CONVERT_PROPOSAL must be atomic before delegation", status: "CLOSED_NOW", appRemediation: "BUG_FIX_MISSION", sunnyReadsVia: ["system_awareness:action_inventory"] }),
  G({ id: "PRJ_STATUS_NOT_VALIDATED", domain: "PROJECTS", entityType: "status", class: "SYSTEM_BEHAVIOR_GAP", inherited92671ee: "status not server-validated",
    description: "Any status text is accepted", redbloodsKnows: "behavior (production: 0 non-vocabulary statuses)", sunnyKnows: "behavior + production count", why: "no server check", wouldClose: "bug-fix mission",
    relationshipsAffected: [], risk: "LOW", ownerImpact: "a typo would hide a project from every 'active' view", futureActionImpact: "UPDATE_PROJECT_STATUS validates against the vocabulary", status: "CLOSED_NOW", appRemediation: "BUG_FIX_MISSION", sunnyReadsVia: ["system_awareness:project_model/vocabularies"] }),
  G({ id: "PRJ_DELETE_NON_ATOMIC", domain: "PROJECTS", entityType: "project delete", class: "SYSTEM_BEHAVIOR_GAP", inherited92671ee: "project delete not transactional",
    description: "Delete is part app, part DB cascade, part left behind", redbloodsKnows: "behavior", sunnyKnows: "exactly what is deleted / changed / left behind", why: "implementation", wouldClose: "bug-fix mission",
    relationshipsAffected: ["every project link"], risk: "HIGH", ownerImpact: "orphans after deletes", futureActionImpact: "DELETE_PROJECT is DESTRUCTIVE class; preview must list what stays", status: "CLOSED_NOW", appRemediation: "BUG_FIX_MISSION", sunnyReadsVia: ["system_awareness:action_inventory"] }),
  G({ id: "PRJ_CONCURRENT_FILE_WRITES", domain: "FILES_DROPBOX", entityType: "project files", class: "SYSTEM_BEHAVIOR_GAP", inherited92671ee: "concurrent file-write risk",
    description: "The file list is read-modify-written without a lock", redbloodsKnows: "behavior", sunnyKnows: "behavior; a file missing from the list may still exist in Dropbox", why: "implementation", wouldClose: "bug-fix mission",
    relationshipsAffected: ["project → files"], risk: "MEDIUM", ownerImpact: "two parallel uploads can lose one entry", futureActionImpact: "file primitives must serialize", status: "CLOSED_NOW", appRemediation: "BUG_FIX_MISSION", sunnyReadsVia: ["project_view:files"] }),
  // ── discovered in this mission ──
  G({ id: "PRJ_HISTORY_NOT_RECORDED", domain: "PROJECTS", entityType: "project history", class: "DATA_NOT_RECORDED",
    description: "Status / deadline / price / artist history", redbloodsKnows: "only the current value + last updated time; append-only history exists only for Sunny deadline actions; the send log is dated but editable",
    sunnyKnows: "current state, last update, send-log timeline, Sunny action decisions / outcomes, project bell notifications that still exist", why: "the app overwrites fields in place", wouldClose: "a project change log (schema change)",
    relationshipsAffected: [], risk: "MEDIUM", ownerImpact: "'when did this change / who changed it' is unanswerable", futureActionImpact: "every Sunny primitive already writes append-only events", status: "DATA_NOT_RECORDED", appRemediation: "SCHEMA_CHANGE", sunnyReadsVia: ["project_view:history"] }),
  G({ id: "PRJ_NOTIFICATIONS_CLEARED", domain: "PUSH_NOTIFICATIONS", entityType: "notification", class: "TEMPORARILY_UNAVAILABLE",
    description: "Owner bell notifications are deleted every Friday", redbloodsKnows: "recent notifications with their project", sunnyKnows: "the ones that still exist", why: "weekly cleanup",
    wouldClose: "keeping notification history (Owner decision)", relationshipsAffected: ["project → notifications"], risk: "LOW", ownerImpact: "old alerts are gone", futureActionImpact: "none", status: "PARTIALLY_CLOSED", appRemediation: "OWNER_DECISION", sunnyReadsVia: ["project_view:notifications"] }),
  G({ id: "PRJ_FILE_CONTENTS", domain: "FILES_DROPBOX", entityType: "file content", class: "CAPABILITY_GAP",
    description: "The contents of files (audio, documents, the artist-portal sketch manifest)", redbloodsKnows: "files live in Dropbox; Redbloods stores metadata", sunnyKnows: "metadata only",
    why: "content needs a live Dropbox read (same credential issue as the listing); audio is binary", wouldClose: "an Owner-approved read-only Dropbox content primitive for text documents", relationshipsAffected: [], risk: "LOW", ownerImpact: "Sunny cannot read a lyric sheet or brief document", futureActionImpact: "none", status: "OPEN", appRemediation: "OAUTH_OR_INTEGRATION_APPROVAL", sunnyReadsVia: [] }),
  G({ id: "PRJ_EXPENSE_ORPHANS_ON_DELETE", domain: "FINANCE", entityType: "engineer expense", class: "SYSTEM_BEHAVIOR_GAP",
    description: "Deleting an engineer work (directly or via the send log) leaves its expense", redbloodsKnows: "behavior", sunnyKnows: "behavior", why: "implementation", wouldClose: "bug-fix mission",
    relationshipsAffected: ["engineer work → expense"], risk: "MEDIUM", ownerImpact: "expenses without work", futureActionImpact: "DESTRUCTIVE preview must disclose it", status: "CLOSED_NOW", appRemediation: "BUG_FIX_MISSION", sunnyReadsVia: ["system_awareness:action_inventory"] }),
  G({ id: "PRJ_MEETING_EVENT_ORPHANS", domain: "MEETINGS", entityType: "meeting event", class: "SYSTEM_BEHAVIOR_GAP",
    description: "Editing / deleting a meeting leaves its Google event unchanged", redbloodsKnows: "behavior", sunnyKnows: "behavior", why: "implementation", wouldClose: "bug-fix mission",
    relationshipsAffected: ["meeting → calendar event"], risk: "LOW", ownerImpact: "stale calendar events", futureActionImpact: "UPDATE_MEETING must sync the event", status: "CLOSED_NOW", appRemediation: "BUG_FIX_MISSION", sunnyReadsVia: ["system_awareness:action_inventory"] }),
  G({ id: "CAL_UNTRACKED_EVENTS_TEXT_ONLY", domain: "GOOGLE_CALENDAR", entityType: "calendar event", class: "DATA_MODEL_GAP",
    description: "Events created directly in Google have no stored Redbloods link", redbloodsKnows: "only event ids of records it created", sunnyKnows: "a TEXT_MATCH / AMBIGUOUS / UNLINKED classification for them",
    why: "nothing links a manual Google event to a project", wouldClose: "creating sessions / meetings from Redbloods (stores the id) or a future LINK_EVENT primitive", relationshipsAffected: ["calendar event → project / client"], risk: "LOW", ownerImpact: "manual events relate to projects only by their title", futureActionImpact: "a future link primitive", status: "PARTIALLY_CLOSED", appRemediation: "OWNER_INPUT", sunnyReadsVia: ["calendar"] }),
  G({ id: "CAL_WEEK_UTC_WINDOW", domain: "GOOGLE_CALENDAR", entityType: "calendar page", class: "SYSTEM_BEHAVIOR_GAP",
    description: "The Calendar page's week starts at 00:00 UTC (03:00 Israel)", redbloodsKnows: "behavior", sunnyKnows: "behavior; Sunny's own reads use Israel-time windows", why: "implementation", wouldClose: "bug-fix mission",
    relationshipsAffected: [], risk: "LOW", ownerImpact: "events between 00:00 and 03:00 on the first day of the week can be missing on the Calendar page", futureActionImpact: "none", status: "CLOSED_NOW", appRemediation: "BUG_FIX_MISSION", sunnyReadsVia: ["system_awareness:rules"] }),
  G({ id: "CAL_GOOGLE_TASKS_AND_HIDDEN", domain: "GOOGLE_CALENDAR", entityType: "calendar", class: "CAPABILITY_GAP",
    description: "Google Tasks items, hidden calendars and free/busy-only calendars", redbloodsKnows: "the Calendar page shows neither", sunnyKnows: "neither (same as the Calendar page); Redbloods tasks are read from Redbloods",
    why: "parity with what the Owner's Redbloods Calendar shows", wouldClose: "an Owner decision to include them", relationshipsAffected: [], risk: "LOW", ownerImpact: "tasks created only in Google Tasks are invisible", futureActionImpact: "none", status: "OPEN", appRemediation: "OWNER_DECISION", sunnyReadsVia: [] }),
  // ── Owner operating model (2026-09-25): what the Owner's way of working needs that Redbloods does not record ──
  G({ id: "OWN_P2_NO_PERSONAL_EVENT_KIND", domain: "SUNNY_CORE", entityType: "owner knowledge kind", class: "DATA_MODEL_GAP",
    description: "No Owner-knowledge kind can say 'this recurring calendar event is personal context' (e.g. a driving-license course)", redbloodsKnows: "the event itself (live calendar, UNLINKED)", sunnyKnows: "that the event occupies time; it treats unlinked events as personal / availability-only by rule — but cannot persist the Owner's classification of a specific event",
    why: "the ten P2 kinds cover entities, roles, relationships, blockers, follow-ups, vendor commitments, release priority, reported payments, friction and policy candidates — none fits a personal calendar classification", wouldClose: "a bounded kind (e.g. PERSONAL_CONTEXT_EVENT with a recurring-event id and no business link) — schema + Owner approval", relationshipsAffected: ["calendar event → personal"], risk: "LOW", ownerImpact: "the Owner may have to repeat that such an event is personal", futureActionImpact: "none", status: "FUTURE_SCHEMA_REQUIRED", appRemediation: "SCHEMA_CHANGE", sunnyReadsVia: ["calendar"] }),
  G({ id: "OWN_POLICY_CANDIDATE_TOO_WEAK", domain: "SUNNY_CORE", entityType: "owner operating rule", class: "DATA_MODEL_GAP",
    description: "Owner-CONFIRMED operating rules have no P2 home: WORKING_POLICY_CANDIDATE is a candidate (review after 30 days) with six areas only", redbloodsKnows: "the rules, as a versioned system contract (operating_model)", sunnyKnows: "every confirmed rule with provenance OWNER_CONFIRMED and its date",
    why: "storing a confirmed rule as a 'candidate' would weaken it; storing it as free text is forbidden", wouldClose: "kept as a versioned system contract (changed only through a reviewed code change with the Owner) — or, if the Owner wants to edit rules from the app, a confirmed-policy kind (schema)", relationshipsAffected: [], risk: "LOW", ownerImpact: "rule changes go through Claude Code, not the app", futureActionImpact: "none", status: "PARTIALLY_CLOSED", appRemediation: "OWNER_DECISION", sunnyReadsVia: ["operating_model:rules"] }),
  G({ id: "OWN_DEAL_TERMS_NOT_RECORDED", domain: "FINANCE", entityType: "project deal terms", class: "DATA_NOT_RECORDED",
    description: "Advance amount / percentage and the milestone for the remaining payment (mix, delivery, release) per deal", redbloodsKnows: "the agreed price and income rows (received / expected) — not the agreed payment structure", sunnyKnows: "whether any income was received on a progressed project (advance evidence present / missing) — never the expected advance",
    why: "Redbloods has no deal-terms field", wouldClose: "per-project payment terms (advance + milestone) — schema + Owner approval", relationshipsAffected: ["project → payment schedule"], risk: "MEDIUM", ownerImpact: "Sunny can flag a missing advance but not say how much is due now", futureActionImpact: "a collection reminder primitive would need the terms", status: "DATA_NOT_RECORDED", appRemediation: "SCHEMA_CHANGE", sunnyReadsVia: ["client_view:money", "system_awareness:client_model", "operating_model:project", "finance_receivables"] }),
  G({ id: "OWN_OUTSIDE_COMMUNICATION", domain: "SUNNY_CORE", entityType: "communication", class: "CAPABILITY_GAP",
    description: "WhatsApp / phone / in-person communication with clients, artists and the team", redbloodsKnows: "only what is recorded in the app (send log, comments, uploads)", sunnyKnows: "that outside communication exists (Owner rule) — so in-app ball-holder evidence is never conclusive",
    why: "no integration; privacy-sensitive", wouldClose: "an Owner-approved integration, or the Owner telling Sunny (P2 blocker / follow-up)", relationshipsAffected: ["project → who holds the ball"], risk: "MEDIUM", ownerImpact: "Sunny may ask 'was this handled outside Redbloods?'", futureActionImpact: "none", status: "OPEN", appRemediation: "OAUTH_OR_INTEGRATION_APPROVAL", sunnyReadsVia: ["operating_model:project"] }),
  G({ id: "OWN_DEADLINE_KIND_NOT_RECORDED", domain: "PROJECTS", entityType: "project deadline", class: "DATA_NOT_RECORDED",
    description: "Whether a project's deadline is a firm client commitment, a soft target or a stale date", redbloodsKnows: "one deadline date per project", sunnyKnows: "the Owner rule (normally a client commitment) + the historical-debt cutoff (2026-09-25)",
    why: "a single date field", wouldClose: "a deadline-kind field, or the Owner answering per project", relationshipsAffected: ["project → client commitment"], risk: "LOW", ownerImpact: "Sunny asks when a date looks stale instead of assuming", futureActionImpact: "UPDATE_PROJECT_DEADLINE already exists", status: "PARTIALLY_CLOSED", appRemediation: "OWNER_INPUT", sunnyReadsVia: ["operating_model:project"] }),
  G({ id: "OWN_PROTECTED_LABEL_ARTIST", domain: "LABEL_ARTISTS", entityType: "label artist", class: "DATA_MODEL_GAP",
    description: "'Protected growth track' is not a stored attribute", redbloodsKnows: "the label roster", sunnyKnows: "the Owner rule: every roster artist (Shalev Tasama, Avi Molla) is a protected growth track",
    why: "roster membership is the only signal", wouldClose: "nothing needed while the rule covers the whole roster; a per-artist flag if the Owner ever distinguishes", relationshipsAffected: [], risk: "LOW", ownerImpact: "none today", futureActionImpact: "none", status: "CLOSED_NOW", appRemediation: "NONE", sunnyReadsVia: ["operating_model:rules", "label_roster"] }),
  G({ id: "OWN_PERSONAL_SOURCES", domain: "GOOGLE_CALENDAR", entityType: "personal source", class: "CAPABILITY_GAP",
    description: "Personal context outside the Google calendar (other calendars, reminders, notes)", redbloodsKnows: "nothing", sunnyKnows: "only the connected Google calendar",
    why: "not connected", wouldClose: "only if the Owner connects and approves a source", relationshipsAffected: [], risk: "LOW", ownerImpact: "personal commitments that are not in the calendar are invisible", futureActionImpact: "none", status: "OPEN", appRemediation: "OAUTH_OR_INTEGRATION_APPROVAL", sunnyReadsVia: [] }),
  // ── Clients + Proposals Deep Brain (2026-09-25) ──
  G({ id: "CLI_NO_LEAD_ENTITY", domain: "CLIENTS", entityType: "lead", class: "DATA_MODEL_GAP",
    description: "There is no lead / opportunity entity (source, channel, interest, stage)", redbloodsKnows: "a client record, an open proposal, a meeting or free text", sunnyKnows: "a DERIVED pre-project opportunity (client with an open proposal / meeting and no project); never a lead stage or likelihood",
    why: "the app never modelled leads", wouldClose: "a lead model — schema + Owner approval (only if the Owner wants lead management)", relationshipsAffected: ["lead → client → proposal"], risk: "LOW", ownerImpact: "early conversations exist only outside Redbloods", futureActionImpact: "CREATE_LEAD would need the model", status: "OPEN", appRemediation: "SCHEMA_CHANGE", sunnyReadsVia: ["client_portfolio", "system_awareness:client_model"] }),
  G({ id: "CLI_CONTACT_AND_REPLIES_NOT_RECORDED", domain: "PROPOSALS", entityType: "follow-up contact", class: "DATA_NOT_RECORDED",
    description: "Follow-up calls / messages and client replies to a proposal", redbloodsKnows: "only the follow-up date, the status label and the last-updated time", sunnyKnows: "'the recorded follow-up date passed' — never 'the Owner did not follow up'",
    why: "no contact log; WhatsApp / phone are outside Redbloods", wouldClose: "a contact / reply log (schema) or the Owner telling Sunny", relationshipsAffected: ["proposal → contact history"], risk: "MEDIUM", ownerImpact: "Sunny may ask whether contact happened outside the system", futureActionImpact: "LOG_CONTACT would need the model", status: "DATA_NOT_RECORDED", appRemediation: "SCHEMA_CHANGE", sunnyReadsVia: ["client_view:proposals", "client_portfolio:follow_ups"] }),
  G({ id: "CLI_PROPOSAL_CHANGE_HISTORY", domain: "PROPOSALS", entityType: "proposal history", class: "DATA_NOT_RECORDED",
    description: "Changes to a proposal's amount / status / follow-up / notes (and client field changes — clients have no updated_at)", redbloodsKnows: "created / sent / last updated only", sunnyKnows: "a timeline of recorded dates only (never reconstructed changes)",
    why: "no audit trail", wouldClose: "an append-only change log (schema)", relationshipsAffected: [], risk: "LOW", ownerImpact: "'when did the price change?' is unknowable", futureActionImpact: "Sunny's own future actions will carry outcomes", status: "DATA_NOT_RECORDED", appRemediation: "SCHEMA_CHANGE", sunnyReadsVia: ["client_view:history"] }),
  G({ id: "CLI_MEETING_OUTCOME_NOT_RECORDED", domain: "MEETINGS", entityType: "meeting outcome", class: "DATA_NOT_RECORDED",
    description: "What was decided in a meeting; whether a past 'נקבעה' meeting happened", redbloodsKnows: "date, time, location, status, notes", sunnyKnows: "those + 'past meeting still נקבעה — held or not unknown'",
    why: "no outcome field; status is updated by hand", wouldClose: "an outcome field (schema) or the Owner updating status / notes", relationshipsAffected: ["meeting → next step"], risk: "LOW", ownerImpact: "2 production meetings are past and still 'נקבעה'", futureActionImpact: "UPDATE_MEETING", status: "DATA_NOT_RECORDED", appRemediation: "OWNER_INPUT", sunnyReadsVia: ["client_view:meetings"] }),
  G({ id: "CLI_PROPOSAL_STATUS_CONSUMERS_DISAGREE", domain: "PROPOSALS", entityType: "proposal status", class: "CONFLICTING_SOURCES",
    description: "Which proposals count as open / due differs by screen (allow-list vs block-list, ₪-only vs mixed-currency sums, UTC vs Israel dates)", redbloodsKnows: "each screen's own rule", sunnyKnows: "every consumer's rule (client_model status_consumers); Sunny uses the block-list + Israel dates and reports unknown statuses",
    why: "status is unvalidated free text and each screen computes its own view", wouldClose: "a validated status set + one shared rule (bug-fix mission)", relationshipsAffected: [], risk: "LOW", ownerImpact: "dashboard, Insights and the drawer can show different open totals", futureActionImpact: "CHANGE_PROPOSAL_STATUS must validate", status: "PARTIALLY_CLOSED", appRemediation: "BUG_FIX_MISSION", sunnyReadsVia: ["system_awareness:client_model"] }),
  G({ id: "CLI_RETURN_LATER_MEANING", domain: "PROPOSALS", entityType: "proposal status", class: "OWNER_DECISION_REQUIRED",
    description: "Whether 'לחזור בעתיד' belongs in the open pipeline / follow-up lists", redbloodsKnows: "every screen counts it as open", sunnyKnows: "the status and that its meaning is unset",
    why: "a label with no behavior", wouldClose: "an Owner decision", relationshipsAffected: [], risk: "LOW", ownerImpact: "open value may include parked opportunities", futureActionImpact: "none", status: "CONFLICT_REQUIRES_OWNER_DECISION", appRemediation: "OWNER_DECISION", sunnyReadsVia: ["system_awareness:client_model"] }),
  G({ id: "CLI_CONVERSION_NOT_ATOMIC", domain: "PROPOSALS", entityType: "conversion", class: "SYSTEM_BEHAVIOR_GAP",
    description: "Proposal → project conversion is not transactional; the only guard is read-then-write; the UI swallows errors", redbloodsKnows: "behavior", sunnyKnows: "the full flow + failure modes (client_model conversion)",
    why: "implementation", wouldClose: "a transactional / idempotent conversion (bug-fix mission)", relationshipsAffected: ["proposal → project → finance"], risk: "MEDIUM", ownerImpact: "a double click or a mid-way failure can create a second project", futureActionImpact: "CONVERT_PROPOSAL must be idempotent before Sunny may run it", status: "OPEN", appRemediation: "BUG_FIX_MISSION", sunnyReadsVia: ["system_awareness:client_model"] }),
  G({ id: "CLI_FOLLOWUP_TASK_BEHAVIOR", domain: "PROPOSALS", entityType: "follow-up task", class: "SYSTEM_BEHAVIOR_GAP",
    description: "The follow-up task is linked by a text marker, stays open when the proposal is lost, and an edit silently adds a follow-up date", redbloodsKnows: "behavior", sunnyKnows: "the task (DERIVED link) + these behaviors",
    why: "implementation", wouldClose: "a proposal id on tasks + closing the task on status change (bug-fix mission)", relationshipsAffected: ["proposal ↔ task"], risk: "LOW", ownerImpact: "stale follow-up tasks after a lost proposal", futureActionImpact: "SET_FOLLOW_UP", status: "OPEN", appRemediation: "BUG_FIX_MISSION", sunnyReadsVia: ["client_view:tasks"] }),
  G({ id: "CLI_FOLLOWUP_ALERT_DISABLED", domain: "PROPOSALS", entityType: "follow-up alert", class: "LEGACY_CONFLICT",
    description: "The legacy proposal follow-up alert is switched off (and would never push); the flag's comment says the opposite", redbloodsKnows: "the rule + flag", sunnyKnows: "that nothing reminds the Owner except dashboards / COO / the follow-up task",
    why: "legacy Mai agent disabled", wouldClose: "an Owner decision about reminders (Sunny may surface due follow-ups itself)", relationshipsAffected: [], risk: "LOW", ownerImpact: "no push for due follow-ups", futureActionImpact: "none", status: "OPEN", appRemediation: "OWNER_DECISION", sunnyReadsVia: ["client_portfolio:follow_ups"] }),
  G({ id: "CLI_DELETE_AND_RENAME_LEAVE_TRACES", domain: "CLIENTS", entityType: "client", class: "SYSTEM_BEHAVIOR_GAP",
    description: "Client delete leaves meetings / tasks / Red Films / Google Tasks pointing at it (no confirmation when no project names them); rename updates projects only", redbloodsKnows: "behavior", sunnyKnows: "behavior + the stale references it can see",
    why: "implementation", wouldClose: "bug-fix mission", relationshipsAffected: ["client ↔ meetings / tasks / Red Films / money text"], risk: "MEDIUM", ownerImpact: "history detaches after a delete / rename", futureActionImpact: "DELETE_CLIENT is DESTRUCTIVE", status: "OPEN", appRemediation: "BUG_FIX_MISSION", sunnyReadsVia: ["system_awareness:client_model"] }),
  G({ id: "CLI_STATUS_FIELD_MIXES_CONCEPTS", domain: "CLIENTS", entityType: "client status", class: "DATA_MODEL_GAP",
    description: "Client status mixes lifecycle, VIP tier and the label-artist role; חדש is also the auto-create default", redbloodsKnows: "one status value", sunnyKnows: "the value, never read as 'active customer' or 'lead'",
    why: "one field for three concepts", wouldClose: "separate lifecycle / tier / role (schema) — Owner decision", relationshipsAffected: [], risk: "LOW", ownerImpact: "'active clients' is not a stored fact — Sunny derives it from open work", futureActionImpact: "UPDATE_CLIENT", status: "OPEN", appRemediation: "OWNER_DECISION", sunnyReadsVia: ["client_view:identity"] }),
  G({ id: "CLI_PROJECTLESS_INCOME_BY_TEXT", domain: "FINANCE", entityType: "transaction", class: "AMBIGUOUS_IDENTITY",
    description: "Income with no project (mostly show income) links to a client only through the artist text", redbloodsKnows: "artist text on the row", sunnyKnows: "the rows attributed by exact name (TEXT_MATCH), labelled as such",
    why: "transactions have no client id", wouldClose: "an optional client id on transactions (schema, part of the client_id recommendation)", relationshipsAffected: ["transaction → client"], risk: "LOW", ownerImpact: "renames detach this money from the client", futureActionImpact: "RECORD_INCOME should carry the client", status: "PARTIALLY_CLOSED", appRemediation: "SCHEMA_CHANGE", sunnyReadsVia: ["client_view:money"] }),
  G({ id: "CLI_PERSON_WITH_TWO_RECORDS", domain: "CLIENTS", entityType: "person", class: "AMBIGUOUS_IDENTITY",
    description: "The same person can be a client record AND a label-artist record (linked only by the same name)", redbloodsKnows: "two records", sunnyKnows: "both, as roles of one person (TEXT_MATCH) + the Owner's label classification — never merged, label work never treated as client work",
    why: "no person entity", wouldClose: "a person / identity link (schema) or Owner-confirmed identity", relationshipsAffected: ["client ↔ label artist"], risk: "LOW", ownerImpact: "none while names stay identical", futureActionImpact: "none", status: "PARTIALLY_CLOSED", appRemediation: "OWNER_INPUT", sunnyReadsVia: ["client_view:roles"] }),
  G({ id: "CLI_PROPOSAL_AMOUNT_VS_PRICE", domain: "PROPOSALS", entityType: "price", class: "CONFLICTING_SOURCES",
    description: "The proposal amount and the project's agreed price can differ after conversion (1 of 3 in production)", redbloodsKnows: "both numbers", sunnyKnows: "both + the difference; the agreed price is the finance truth, the reason is unknown",
    why: "copied once, edited separately", wouldClose: "the proposed deal-terms model", relationshipsAffected: ["proposal → project price"], risk: "LOW", ownerImpact: "a discount may be invisible", futureActionImpact: "none", status: "PARTIALLY_CLOSED", appRemediation: "OWNER_INPUT", sunnyReadsVia: ["client_view:proposals"] }),
  G({ id: "CLI_NO_PROPOSAL_DOCUMENTS", domain: "PROPOSALS", entityType: "document", class: "DATA_NOT_RECORDED",
    description: "Proposal documents / contracts / attachments", redbloodsKnows: "nothing — no document model or storage for proposals", sunnyKnows: "that none exist in Redbloods",
    why: "not built", wouldClose: "a document model (only if wanted)", relationshipsAffected: [], risk: "LOW", ownerImpact: "the proposal text lives outside Redbloods", futureActionImpact: "none", status: "DATA_NOT_RECORDED", appRemediation: "OWNER_DECISION", sunnyReadsVia: [] }),
  G({ id: "CLI_ACTIONS_NOT_EXECUTABLE", domain: "CLIENTS", entityType: "client / proposal action", class: "FUTURE_PRIMITIVE_REQUIRED",
    description: "Every client / proposal mutation (create / edit / delete client, create / edit / status / follow-up / delete / convert proposal, meetings, client tasks)", redbloodsKnows: "the dashboard actions", sunnyKnows: "each action, its effects and approval class (client_model actions)",
    why: "no approved typed primitive", wouldClose: "typed primitives with preview + Owner approval (CONVERT_PROPOSAL only after it is idempotent)", relationshipsAffected: [], risk: "LOW", ownerImpact: "the Owner performs them in the dashboard", futureActionImpact: "roadmap", status: "OPEN", appRemediation: "NONE", sunnyReadsVia: ["system_awareness:client_model"] }),
  // ── secrets (the ONLY intentional exclusion) ──
  G({ id: "SECRET_INTEGRATION_TOKENS", domain: "PLATFORM_ACCESS", entityType: "credential", class: "INTENTIONALLY_SECRET",
    description: "Google / Dropbox OAuth tokens, service keys, cron / webhook secrets, passwords, cookies", redbloodsKnows: "the credentials", sunnyKnows: "that each integration exists, whether it is connected, what it does and what depends on it — never the secret",
    why: "credentials are not knowledge", wouldClose: "never (by design)", relationshipsAffected: [], risk: "HIGH", ownerImpact: "none", futureActionImpact: "none", status: "CLOSED_NOW", appRemediation: "NONE", sunnyReadsVia: ["integrations"] }),
  G({ id: "SECRET_SHARE_LINKS", domain: "FILES_DROPBOX", entityType: "public share link / share token", class: "INTENTIONALLY_SECRET",
    description: "Dropbox public share links and share tokens stored with files / folders", redbloodsKnows: "the bearer URLs", sunnyKnows: "that a file / folder HAS a share link (hasShareLink) — never the URL",
    why: "anyone holding the link can open the file (bearer access material)", wouldClose: "never (by design)", relationshipsAffected: [], risk: "HIGH", ownerImpact: "none", futureActionImpact: "sharing stays an EXTERNAL_EFFECT action", status: "CLOSED_NOW", appRemediation: "NONE", sunnyReadsVia: ["project_view:files"] }),
];

/** Complete-knowledge status per system domain (Part N: the next deep-brain missions). */
export type DomainDepth = "DEEP_BRAIN_COMPLETE_STANDARD" | "DEEP_BRAIN_V1" | "SYSTEM_AWARENESS_ONLY" | "PENDING_DEEP_MISSION";
export const DOMAIN_KNOWLEDGE_DEPTH: Readonly<Record<string, DomainDepth>> = {
  PROJECTS: "DEEP_BRAIN_COMPLETE_STANDARD", PROJECT_ACTIONS: "DEEP_BRAIN_COMPLETE_STANDARD",
  PLATFORM_ACCESS: "DEEP_BRAIN_V1", ARTIST_PORTALS: "DEEP_BRAIN_V1", PUSH_NOTIFICATIONS: "DEEP_BRAIN_V1", FINANCE: "DEEP_BRAIN_V1",
  CLIENTS: "DEEP_BRAIN_V1", PROPOSALS: "DEEP_BRAIN_V1", SESSIONS: "PENDING_DEEP_MISSION", GOOGLE_CALENDAR: "DEEP_BRAIN_V1", TASKS: "PENDING_DEEP_MISSION",
  MEETINGS: "PENDING_DEEP_MISSION", ALBUMS: "PENDING_DEEP_MISSION", DELIVERY: "PENDING_DEEP_MISSION", LABEL_ARTISTS: "PENDING_DEEP_MISSION", SHOWS: "PENDING_DEEP_MISSION",
  LABEL_DJ: "PENDING_DEEP_MISSION", ARTIST_BALANCES: "PENDING_DEEP_MISSION", MEDIA_INCOME: "PENDING_DEEP_MISSION", RELEASES: "PENDING_DEEP_MISSION", BEATS: "PENDING_DEEP_MISSION",
  VICTOR: "PENDING_DEEP_MISSION", STEVEN: "PENDING_DEEP_MISSION", MIX_PIPELINE: "PENDING_DEEP_MISSION", RED_FILMS: "PENDING_DEEP_MISSION", CLIPS: "PENDING_DEEP_MISSION",
  SOCIAL: "PENDING_DEEP_MISSION", FILES_DROPBOX: "PENDING_DEEP_MISSION", REPORTS: "PENDING_DEEP_MISSION", AGENT_ALERTS: "SYSTEM_AWARENESS_ONLY", COMPANY_OVERVIEW: "SYSTEM_AWARENESS_ONLY",
  SUNNY_CORE: "PENDING_DEEP_MISSION", SUNNY_CONNECTOR: "PENDING_DEEP_MISSION",
};

export function validateKnowledgeGaps(o: { domainIds: readonly string[]; capabilityIds: readonly string[] }): string[] {
  const errs: string[] = [];
  const ids = new Set<string>();
  for (const g of KNOWLEDGE_GAPS) {
    if (!/^[A-Z][A-Z0-9_]{2,50}$/.test(g.id)) errs.push(`bad gap id ${g.id}`);
    if (ids.has(g.id)) errs.push(`duplicate gap ${g.id}`);
    ids.add(g.id);
    if (!o.domainIds.includes(g.domain)) errs.push(`${g.id}: unknown domain ${g.domain}`);
    for (const via of g.sunnyReadsVia) if (!o.capabilityIds.includes(via.split(":")[0])) errs.push(`${g.id}: unknown capability ${via}`);
    if (g.class === "INTENTIONALLY_SECRET" && !g.id.startsWith("SECRET_")) errs.push(`${g.id}: INTENTIONALLY_SECRET is reserved for credentials / bearer access (SECRET_*)`);
    if (g.status === "CLOSED_NOW" && g.sunnyReadsVia.length === 0) errs.push(`${g.id}: CLOSED_NOW needs a read path`);
    for (const k of ["description", "redbloodsKnows", "sunnyKnows", "why", "wouldClose"] as const) if (!g[k].trim()) errs.push(`${g.id}: empty ${k}`);
  }
  for (const d of o.domainIds) if (!(d in DOMAIN_KNOWLEDGE_DEPTH)) errs.push(`domain ${d} has no knowledge-depth status`);
  return errs;
}
