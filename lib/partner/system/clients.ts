/**
 * Sunny System Awareness — CLIENTS + PROPOSALS DEEP CONTRACT (the customer journey as Redbloods actually implements it).
 *
 * Produced by the Clients + Proposals Deep Brain discovery (2026-09-25): every route / store / UI path touching
 * clients or proposals, the live production schema (information_schema + indexes + FKs) and read-only production
 * integrity counts. Pure data; served through system_awareness mode client_model. Semantic only — no env / secret.
 *
 * Maintained with the code: scripts/test-sunny-clients.tsx pins the schema columns, the status / type vocabularies
 * as the code declares them, every API route that touches clients / proposals, and fingerprints of the server-side
 * client / proposal / meeting files (CLIENT_REVIEWED_FINGERPRINTS). A change there fails until this contract is
 * reviewed. UI files are checked semantically (vocabularies), not by fingerprint — visual changes never fail it.
 */
import type { ApprovalClass, Enforcement, Who } from "./project-actions";

export const CLIENTS_BASELINE_VERSION = "2026.09.25-clients-1";

export type FieldClass = "CANONICAL" | "DERIVED" | "DISPLAY_ONLY" | "LEGACY" | "AMBIGUOUS" | "POSSIBLE_BUG" | "CONFLICT";
export interface EntityField {
  field: string; meaning: string; classification: FieldClass; nullable: string; validation: string;
  writers: string; readers: string; relationships: string; sideEffects: string; history: string; sunnyReads: string;
}
const F = (field: string, classification: FieldClass, meaning: string, o: Omit<EntityField, "field" | "classification" | "meaning">): EntityField => ({ field, classification, meaning, ...o });

/** Live production columns (information_schema, 2026-09-25). The test pins these to the field contracts. */
export const CLIENT_SCHEMA_COLUMNS = {
  clients: ["id", "name", "phone", "email", "type", "status", "notes", "created_at"],
  proposals: ["id", "client_id", "title", "amount", "currency", "status", "sent_date", "followup_date", "notes", "linked_project_id", "created_at", "updated_at"],
} as const;

export const CLIENT_FIELDS: readonly EntityField[] = [
  F("id", "CANONICAL", "Client identity (uuid).", { nullable: "never", validation: "generated", writers: "insert only", readers: "every client link by id (proposals, meetings, tasks, shows, send log, Red Films, alerts)", relationships: "proposals (FK cascade), shows (FK set null), send log (FK set null), alerts (FK cascade), meetings / tasks / Red Films (id stored, no FK)", sideEffects: "—", history: "—", sunnyReads: "clients, client_view, client_portfolio" }),
  F("name", "CANONICAL", "The person / company name — AND the only link key between a client and projects (projects.artist text) and project-less money (transactions.artist).", { nullable: "never", validation: "required; DB-unique ignoring case and surrounding spaces (not inner spaces); nothing else", writers: "Owner (Clients page, drawer, shows quick-create, new project with a new artist); automatic from a project's artist (exact-case check, insert errors ignored); one-off backfill route", readers: "project matching (case-insensitive on the server, case-sensitive in the client drawer / Red Films / clip send / send-log recipient), shows pickers, legacy AI context", relationships: "project artist tokens (TEXT_MATCH), transactions.artist (TEXT_MATCH), label roster by same name (TEXT_MATCH), meetings / Red Films name snapshots", sideEffects: "rename rewrites matching project artist text (case-insensitive, not atomic); meetings / Red Films / transactions / send-log recipient names / follow-up task titles are NOT updated", history: "no rename history", sunnyReads: "clients, client_view identity" }),
  F("phone", "CANONICAL", "Stored phone (free text).", { nullable: "empty string default", validation: "none", writers: "Owner (client form)", readers: "client drawer WhatsApp / call links", relationships: "send-log recipient phone is a separate copy", sideEffects: "—", history: "none", sunnyReads: "client_view section contact (Owner-only)" }),
  F("email", "CANONICAL", "Stored email (free text).", { nullable: "empty string default", validation: "none", writers: "Owner (client form)", readers: "session scheduling looks up the email by name for calendar invites; Insights 'clients without email'", relationships: "calendar invite attendee (by lookup)", sideEffects: "—", history: "none", sunnyReads: "client_view section contact (Owner-only)" }),
  F("type", "CANONICAL", "What kind of party: אמן / לקוח / איש צוות / אחר.", { nullable: "DB default אחר", validation: "none on the server (any string)", writers: "Owner; defaults differ by path — API create לקוח, client form אמן, auto-create אמן, shows quick-create לקוח, edit without a type → אחר", readers: "shows pickers (לקוח → booker, איש צוות → DJ), artist picker order", relationships: "—", sideEffects: "changes who appears in show pickers", history: "none", sunnyReads: "clients, client_view identity" }),
  F("status", "AMBIGUOUS", "One field that mixes lifecycle (חדש / פעיל / לא פעיל / בעייתי), tier (VIP) and organizational role (אמן לייבל).", { nullable: "DB default חדש", validation: "none on the server", writers: "Owner; auto-created clients are חדש", readers: "client list order (אמן לייבל, VIP, פעיל …), shows artist picker (אמן לייבל), VIP filters, release candidates, finance VIP flag on receivables", relationships: "אמן לייבל is NOT a link to the label roster (roster is a separate table, matched by name)", sideEffects: "changes pickers / ordering only", history: "none", sunnyReads: "clients, client_view identity (never read as 'active customer' — חדש is also the auto-create default)" }),
  F("notes", "CANONICAL", "Free text about the client — evidence, never a structured fact.", { nullable: "empty string default", validation: "none", writers: "Owner", readers: "client drawer", relationships: "—", sideEffects: "—", history: "none", sunnyReads: "client_view section notes (scrubbed of links / tokens)" }),
  F("created_at", "CANONICAL", "When the client record was created (by the Owner or automatically from a project artist).", { nullable: "default now", validation: "—", writers: "insert", readers: "Partner", relationships: "—", sideEffects: "—", history: "the only client timestamp — there is no updated_at", sunnyReads: "clients, client_view history" }),
];

export const PROPOSAL_FIELDS: readonly EntityField[] = [
  F("id", "CANONICAL", "Proposal identity.", { nullable: "never", validation: "generated", writers: "insert", readers: "all", relationships: "follow-up task text marker [proposal_id:…]", sideEffects: "—", history: "—", sunnyReads: "proposals, client_view proposals" }),
  F("client_id", "CANONICAL", "The client the proposal was made to.", { nullable: "NOT NULL", validation: "required by the API; FK to clients ON DELETE CASCADE (deleting the client deletes its proposals)", writers: "create only", readers: "client drawer, dashboards (join for the name)", relationships: "client (CANONICAL)", sideEffects: "—", history: "—", sunnyReads: "proposals, client_view" }),
  F("title", "CANONICAL", "What is offered (free text; the UI starts from a type tile). Becomes the project name on conversion unless the Owner types one.", { nullable: "NOT NULL", validation: "required", writers: "Owner", readers: "UI, conversion", relationships: "—", sideEffects: "—", history: "no history", sunnyReads: "proposals, client_view" }),
  F("amount", "AMBIGUOUS", "Offered price. 0 is the default — it cannot distinguish 'not priced yet' from 'free'.", { nullable: "default 0", validation: "Number() or 0", writers: "Owner", readers: "open-value sums (₪ only in Insights / legacy grid; ALL currencies mixed in the client drawer)", relationships: "copied to the project's agreed price on conversion only when > 0", sideEffects: "—", history: "no history", sunnyReads: "proposals, client_view (POTENTIAL money, never revenue)" }),
  F("currency", "CANONICAL", "Currency of the amount.", { nullable: "default ₪", validation: "none", writers: "Owner", readers: "UI", relationships: "copied to the project price on conversion", sideEffects: "—", history: "—", sunnyReads: "proposals, client_view" }),
  F("status", "CONFLICT", "Proposal lifecycle label (see PROPOSAL_STATUS_SEMANTICS). Any string is accepted; consumers disagree on unknown strings and on לחזור בעתיד.", { nullable: "NOT NULL default ממתין לתשובה", validation: "none (any string)", writers: "Owner (edit form), conversion (נסגר), project deletion (לא נסגר), legacy grid (לא נסגר)", readers: "client drawer, dashboards, Insights, COO, agent rule, Partner", relationships: "—", sideEffects: "status changes never touch the follow-up task", history: "no status history (only updated_at of the last change)", sunnyReads: "proposals, client_view, client_portfolio" }),
  F("sent_date", "CANONICAL", "When the proposal was sent (the create form sets today).", { nullable: "yes", validation: "none", writers: "Owner", readers: "UI", relationships: "—", sideEffects: "—", history: "—", sunnyReads: "proposals, client_view" }),
  F("followup_date", "CANONICAL", "When to follow up. The UI defaults to today + 3 and an edit silently fills today + 3 when empty.", { nullable: "yes", validation: "none", writers: "Owner (form); an empty date is filled on edit", readers: "COO (Israel date), dashboards / Insights / agent rule (UTC date), drawer next follow-up", relationships: "mirrors a follow-up task (+ Google Task)", sideEffects: "create / change / clear creates, updates or deletes the follow-up task and its Google Task", history: "no history", sunnyReads: "proposals, client_view, client_portfolio follow_ups" }),
  F("notes", "CANONICAL", "Free text; on conversion copied into the new project's notes.", { nullable: "empty default", validation: "none", writers: "Owner", readers: "UI, conversion", relationships: "—", sideEffects: "—", history: "—", sunnyReads: "client_view section notes" }),
  F("linked_project_id", "CANONICAL", "The project this proposal became (conversion), or a project linked by edit (id not checked by the app).", { nullable: "yes", validation: "FK to projects ON DELETE SET NULL; the app also reverts the proposal to לא נסגר when the project is deleted", writers: "conversion, proposal edit", readers: "drawer (open project), conversion guard (409 when set)", relationships: "project (CANONICAL) — the only canonical client → project chain", sideEffects: "—", history: "—", sunnyReads: "proposals, client_view, project_view" }),
  F("created_at", "CANONICAL", "Proposal created.", { nullable: "default now", validation: "—", writers: "insert", readers: "ordering", relationships: "—", sideEffects: "—", history: "creation only", sunnyReads: "client_view history" }),
  F("updated_at", "CANONICAL", "Last change (any field).", { nullable: "default now", validation: "—", writers: "every edit, conversion", readers: "Partner", relationships: "—", sideEffects: "—", history: "last change only — WHAT changed is not recorded", sunnyReads: "client_view history" }),
];

export const CLIENT_VOCABULARIES = {
  clientTypes: ["אמן", "לקוח", "איש צוות", "אחר"],
  clientStatuses: ["פעיל", "לא פעיל", "בעייתי", "VIP", "חדש", "אמן לייבל"],
  proposalStatuses: ["הצעה נשלחה", "ממתין לתשובה", "צריך פולואפ", "נסגר", "לא נסגר", "לחזור בעתיד"],
  meetingStatuses: ["נקבעה", "התקיימה", "בוטלה"],
  taskRelatedTypes: ["general", "client", "project", "red_film_production"],
} as const;

export interface ProposalStatusSemantics { status: string; meaning: string; open: boolean; followUpExpected: string; conversionButton: boolean; setBy: string; sideEffects: string; note?: string }
export const PROPOSAL_STATUS_SEMANTICS: readonly ProposalStatusSemantics[] = [
  { status: "הצעה נשלחה", meaning: "The proposal was sent.", open: true, followUpExpected: "only through the follow-up date", conversionButton: true, setBy: "Owner", sideEffects: "none" },
  { status: "ממתין לתשובה", meaning: "Waiting for the client's answer (the default).", open: true, followUpExpected: "only through the follow-up date", conversionButton: true, setBy: "default / Owner", sideEffects: "none" },
  { status: "צריך פולואפ", meaning: "The Owner marked it as needing follow-up — a label only; no code path branches on it.", open: true, followUpExpected: "implied by the label; the date is what the app uses", conversionButton: true, setBy: "Owner", sideEffects: "none" },
  { status: "לחזור בעתיד", meaning: "Return to it later — a label only.", open: true, followUpExpected: "counted as open by every consumer (open value + follow-up alerts)", conversionButton: true, setBy: "Owner", sideEffects: "none", note: "Whether 'return later' belongs in the open pipeline is an Owner decision (registered)." },
  { status: "נסגר", meaning: "Closed / won. Set automatically by conversion; can also be set by hand WITHOUT creating a project.", open: false, followUpExpected: "no", conversionButton: true, setBy: "conversion / Owner", sideEffects: "none by itself; the follow-up task is closed only by conversion" },
  { status: "לא נסגר", meaning: "Not closed / lost. Also written automatically when the linked project is deleted.", open: false, followUpExpected: "no — but its follow-up task stays open (status changes never touch it)", conversionButton: true, setBy: "Owner / project deletion / legacy dashboard", sideEffects: "none" },
];

/** How each consumer counts a proposal as open / due. They disagree — Sunny reports, never normalizes. */
export const PROPOSAL_STATUS_CONSUMERS = [
  { consumer: "Client drawer KPIs", open: "allow-list of the 4 open statuses (unknown string = not open)", followUp: "earliest follow-up among open", money: "sums every currency under one label" },
  { consumer: "proposal follow-up rules (client drawer)", open: "allow-list", followUp: "date ≤ today (UTC)", money: "—" },
  { consumer: "Legacy dashboard grid", open: "block-list (not נסגר / לא נסגר)", followUp: "today / overdue (UTC)", money: "₪ only" },
  { consumer: "Live dashboard", open: "block-list", followUp: "date = today only (UTC)", money: "none" },
  { consumer: "Insights", open: "block-list", followUp: "overdue < today, today = (UTC)", money: "'potential' ₪ only" },
  { consumer: "Agent rule (disabled)", open: "block-list", followUp: "date ≤ today", money: "—" },
  { consumer: "COO brief", open: "block-list", followUp: "Israel date, days overdue ≥ 0", money: "—" },
  { consumer: "Sunny", open: "block-list (same as COO); unknown strings reported as UNKNOWN_STATUS", followUp: "Israel date; 'recorded follow-up due', never 'you did not follow up'", money: "per currency, POTENTIAL only" },
] as const;

export type LinkQuality = "CANONICAL_RELATION" | "OWNER_CONFIRMED_RELATION" | "DERIVED_RELATION" | "TEXT_MATCH" | "AMBIGUOUS" | "UNKNOWN";
export interface ClientLink { id: string; from: string; to: string; method: string; quality: LinkQuality; enforcement: string; breaks: string; sunnyReads: string }
export const CLIENT_LINKS: readonly ClientLink[] = [
  { id: "PROPOSAL_CLIENT", from: "proposal", to: "client", method: "proposals.client_id", quality: "CANONICAL_RELATION", enforcement: "FK, ON DELETE CASCADE", breaks: "deleting the client deletes its proposals (the app deletes no follow-up tasks then)", sunnyReads: "proposals, client_view" },
  { id: "PROPOSAL_PROJECT", from: "proposal", to: "project", method: "proposals.linked_project_id", quality: "CANONICAL_RELATION", enforcement: "FK, ON DELETE SET NULL (+ app reverts status to לא נסגר)", breaks: "a proposal edit can link any id (unchecked)", sunnyReads: "client_view, project_view" },
  { id: "CLIENT_PROJECT_VIA_PROPOSAL", from: "client", to: "project", method: "client ← proposal → linked project (two FKs)", quality: "CANONICAL_RELATION", enforcement: "FKs", breaks: "only converted / linked proposals have it", sunnyReads: "client_view projects (basis PROPOSAL_CHAIN)" },
  { id: "CLIENT_PROJECT_BY_NAME", from: "client", to: "project", method: "projects.artist split on , ، ; — token equals the client name", quality: "TEXT_MATCH", enforcement: "none (client name DB-unique ignoring case / outer spaces)", breaks: "renames outside the Clients page, spelling differences, inner spaces, case-sensitive UI matchers", sunnyReads: "client_view projects (basis NAME_EXACT or NAME_COLLABORATION)" },
  { id: "MEETING_CLIENT", from: "meeting", to: "client", method: "meetings.client_id (text) + client_name snapshot", quality: "CANONICAL_RELATION", enforcement: "stored id, NO FK (a deleted client leaves the meeting pointing nowhere); the name snapshot is not updated on rename", breaks: "client deletion / rename", sunnyReads: "client_view meetings" },
  { id: "MEETING_PROJECT", from: "meeting", to: "project", method: "meetings.project_id (text)", quality: "CANONICAL_RELATION", enforcement: "no FK", breaks: "project deletion leaves it", sunnyReads: "client_view meetings, project_view meetings" },
  { id: "TASK_CLIENT", from: "task", to: "client", method: "tasks.related_type = client + related_id", quality: "CANONICAL_RELATION", enforcement: "no FK (dangling after client deletion)", breaks: "client deletion", sunnyReads: "client_view tasks" },
  { id: "TASK_PROPOSAL", from: "task", to: "proposal", method: "text marker [proposal_id:…] inside the task notes (the follow-up task)", quality: "DERIVED_RELATION", enforcement: "none", breaks: "editing the task notes", sunnyReads: "client_view tasks / proposals" },
  { id: "SHOW_ARTIST_CLIENT", from: "show", to: "client", method: "shows.artist_client_id", quality: "CANONICAL_RELATION", enforcement: "FK, SET NULL", breaks: "—", sunnyReads: "shows, client_view roles" },
  { id: "SHOW_BOOKER_CLIENT", from: "show", to: "client", method: "shows.booker_client_id", quality: "CANONICAL_RELATION", enforcement: "FK, SET NULL", breaks: "—", sunnyReads: "client_view roles" },
  { id: "SHOW_DJ_CLIENT", from: "show", to: "client", method: "shows.dj_client_id", quality: "CANONICAL_RELATION", enforcement: "FK, SET NULL", breaks: "—", sunnyReads: "client_view roles" },
  { id: "SEND_LOG_RECIPIENT", from: "send-log entry", to: "client", method: "project_actions.recipient_client_id (chosen by exact-name match in the project drawer)", quality: "CANONICAL_RELATION", enforcement: "FK, SET NULL", breaks: "case differences at write time pick no client", sunnyReads: "client_view roles, project_view waiting" },
  { id: "RED_FILMS_CLIENT", from: "Red Films production", to: "client", method: "the Red Films production's client id (chosen by exact name at clip send) + a client-name snapshot", quality: "CANONICAL_RELATION", enforcement: "no FK; snapshot not updated on rename", breaks: "rename / deletion", sunnyReads: "red_films, client_view roles" },
  { id: "ALERT_CLIENT", from: "agent alert", to: "client", method: "agent_alerts.related_client_id", quality: "CANONICAL_RELATION", enforcement: "FK, CASCADE", breaks: "—", sunnyReads: "never canonical action truth (Owner decision)" },
  { id: "TRANSACTION_CLIENT", from: "transaction", to: "client", method: "transactions.artist text (no client id); project-less income (e.g. show income) is attributable ONLY this way", quality: "TEXT_MATCH", enforcement: "none", breaks: "rename (not rewritten), spelling", sunnyReads: "client_view money (project-less rows, basis ARTIST_TEXT)" },
  { id: "LABEL_ARTIST_CLIENT", from: "label artist", to: "client", method: "same name (case-insensitive); DJ CLEANTONE by the app's fixed client id", quality: "TEXT_MATCH", enforcement: "none (CLEANTONE: app constant)", breaks: "name differences", sunnyReads: "client_view roles (person with two records — never merged)" },
  { id: "CALENDAR_CLIENT", from: "calendar event", to: "client", method: "meetings.calendar_event_id (canonical) / event title names the client (TEXT_MATCH)", quality: "CANONICAL_RELATION", enforcement: "stored event id", breaks: "meeting edits / deletes never update the Google event", sunnyReads: "client_view calendar, calendar context" },
  { id: "SESSION_CLIENT", from: "session", to: "client", method: "through the session's project only (sessions store no client)", quality: "TEXT_MATCH", enforcement: "inherits the project → client quality", breaks: "as project ↔ client", sunnyReads: "client_view sessions" },
  { id: "OWNER_KNOWLEDGE_CLIENT", from: "Owner knowledge", to: "client", method: "subject key client:<id>", quality: "OWNER_CONFIRMED_RELATION", enforcement: "typed P2", breaks: "—", sunnyReads: "client_view owner_knowledge" },
];

export const CONVERSION_FLOW = {
  entryPoints: ["client drawer proposal card '⇒ הפוך לפרויקט' (asks for a project name; shown on every unlinked card, including לא נסגר)", "legacy dashboard grid (no body → project named after the proposal title; /dashboard-old only)"],
  steps: [
    "read the proposal with the client name (404 when missing)",
    "guard: already linked → 409 (the ONLY duplicate guard; a read-then-write, no lock, no status check)",
    "insert the project: name (typed or proposal title), artist = client name, status לא התחיל, start date today (UTC), no deadline, notes = proposal notes, empty type / parent, business type לקוח",
    "add missing clients from the artist (not awaited, errors ignored — the client already exists)",
    "only when amount > 0: write the project's agreed price setting {agreedPrice, currency, financialNotes: ''} (whole value; error not checked)",
    "proposal → status נסגר + linked project (error not checked)",
    "follow-up task → בוצע + Google Task completed (best effort)",
  ],
  atomic: false,
  failureModes: [
    "a failure after the project insert leaves a project with no linked proposal → the next click creates a SECOND project",
    "two concurrent clicks both pass the guard → two projects",
    "UI swallows errors silently (including the 409)",
    "deleting the project later reverts the proposal to לא נסגר (not to its previous status)",
  ],
  notSet: ["deadline", "project type", "advance / payment schedule", "calendar event", "push / notification"],
  finance: "agreed price only (no transaction is created; no advance is recorded)",
  fix: "not fixed here — a separate approved mission (transactional RPC / idempotency key)",
} as const;

export const FOLLOW_UP_MODEL = {
  where: "proposals.followup_date (one date, no history) mirrored by a follow-up task (tasks, related to the client, marker [proposal_id:…] in the notes) and a Google Task when Google is connected",
  created: "the create form defaults the date to today + 3; an edit silently fills today + 3 when the date is empty (so saving any edit adds a follow-up)",
  statusLabels: "צריך פולואפ / לחזור בעתיד are labels only — no code path branches on them; status changes never close the follow-up task",
  overdue: "computed separately by each consumer (UTC vs Israel dates) — there is no stored 'overdue' state",
  alerts: "the proposal follow-up agent rule exists but the agent check is switched off (agent-alert rules switch); even when on, its severity is never pushed; no push, cron or email covers proposals",
  contactLog: "NOT recorded — Redbloods has no record of calls / messages / replies; WhatsApp / phone / in-person are invisible",
  sunnyWording: "Sunny says 'I don't see a recorded follow-up' / 'the recorded follow-up date passed' — never 'you did not follow up'.",
} as const;

export const LEAD_REALITY = {
  leadEntity: "NONE — Redbloods has no lead / opportunity / source / channel concept",
  howAPotentialClientExists: [
    "a client record (status חדש) — but auto-created clients from a project's artist are also חדש, so חדש ≠ lead",
    "a proposal (open status) — the first structured commercial step",
    "a meeting with the client",
    "free text (client notes) or nothing at all (the conversation happened outside Redbloods)",
  ],
  classification: "DATA_MODEL_GAP",
  sunnyBehavior: "treat 'a client with an open proposal / meeting and no project' as a pre-project opportunity (DERIVED); never invent a lead stage, source or likelihood",
} as const;

export type DealConcept = "STORED" | "DERIVABLE" | "NOT_RECORDED" | "AMBIGUOUS" | "CONFLICTING";
export const DEAL_TERMS_MATRIX: ReadonlyArray<{ concept: string; state: DealConcept; where: string }> = [
  { concept: "total agreed price", state: "STORED", where: "project agreed price setting (per project, one currency); before conversion only the proposal amount" },
  { concept: "proposal amount vs agreed price", state: "CONFLICTING", where: "copied once at conversion; later edits of either diverge silently (1 of 3 production proposals differs)" },
  { concept: "advance amount / percentage", state: "NOT_RECORDED", where: "—" },
  { concept: "advance received", state: "DERIVABLE", where: "received income rows on the project — but no row is marked as 'the advance'" },
  { concept: "installments", state: "AMBIGUOUS", where: "several income rows (some categorised תשלום חלקי); no plan behind them" },
  { concept: "payment milestones (e.g. rest at mix / delivery)", state: "NOT_RECORDED", where: "—" },
  { concept: "due dates", state: "AMBIGUOUS", where: "an expected income row's date is used as its due date; no agreed schedule" },
  { concept: "remaining balance", state: "DERIVABLE", where: "agreed price − received song income (Finance Brain)" },
  { concept: "package deals (several songs, one price)", state: "AMBIGUOUS", where: "one proposal title + amount, or an album / EP project, or a parent project name — no package model" },
  { concept: "barter / favor / free work", state: "AMBIGUOUS", where: "the project finance exception flag + reason text is the only marker; amount 0 is ambiguous" },
  { concept: "currency", state: "STORED", where: "proposal currency; project price currency" },
  { concept: "project-less income (e.g. show income)", state: "AMBIGUOUS", where: "transactions without a project, linked to a client only by artist text" },
];

export const DEAL_TERMS_DECISION = {
  canRepresentRealDeal: false,
  why: "Redbloods stores the total price and the payments that happened, but not the AGREEMENT between them: how much is due up front, when the rest is due (mix / delivery / release / date), and whether the deal is a package, a favor or barter. Sunny can therefore see 'money received / not received' but cannot tell 'late' from 'not yet due'.",
  proposedModel: {
    status: "PROPOSAL ONLY — not created; needs Owner approval + a schema mission",
    entity: "deal terms per project (1:1), optionally drafted on the proposal and carried over at conversion",
    fields: [
      "dealTotal + currency (replaces the ambiguous proposal-amount / agreed-price copy)",
      "arrangement: STANDARD | PACKAGE | FAVOR | BARTER | FREE | CUSTOM (+ short reason)",
      "advance: amount OR percent, dueCondition (ON_START | ON_BOOKING | DATE) + optional date",
      "remaining: dueCondition (MIX_START | MIX_DELIVERY | FINAL_DELIVERY | RELEASE | DATE | CUSTOM) + optional date",
      "packageScope: number of songs / clips covered (optional)",
      "confirmedAt / updatedAt (history of changes, append-only)",
      "income rows may reference their role: ADVANCE | INSTALLMENT | FINAL (optional column or mapping)",
    ],
  },
} as const;

export const CLIENT_ID_ASSESSMENT = {
  current: "projects store the artist as free text; the client link is a name match (split on , ، ;). Transactions store artist text only.",
  productionFacts20260925: { clients: 32, projects: 38, projectsExactSingleClientName: 34, projectsCollaborationTokens: 4, projectsWithNoClientMatch: 0, duplicateClientNames: 0, nearDuplicateNamesIgnoringSpaces: 0, clientsAlsoOnLabelRosterByName: 3, transactionsWithArtistText: 48, projectLessIncomeRows: 10, projectLessIncomeMatchedByArtistText: 10, proposals: 3, proposalsWhoseProjectArtistDiffersFromClientName: 1 },
  risks: [
    "rename: the Clients page rewrites project artist text (not atomic), but meetings / Red Films snapshots, transactions.artist, send-log recipient names and task titles keep the old name",
    "case: some matchers are case-sensitive (client drawer, clip send, send-log recipient) while the server is not",
    "collaborations: one project can name several clients — a single client_id could not represent it",
    "dual roles: the same person can be a client record AND a label-artist record (label vs client work is an Owner classification, not a link)",
    "project-less income (show income) can only be attributed by text",
  ],
  mitigations: "a DB unique index on the client name (ignoring case and outer spaces) prevents exact duplicates; production currently has 0 unmatched projects",
  recommendation: "YES, in a future approved mission — but as a project ↔ client JOIN (role PRIMARY / COLLABORATOR, many-to-many) plus an optional client id on transactions, not a single project.client_id column. Priority MEDIUM: the data is small and consistent today, so the main value is correctness under renames / collaborations and money attribution. Do NOT execute here.",
} as const;

export const CLIENT_HISTORY_MODEL = {
  current: "client: created_at only (no updated_at). proposal: created_at, sent_date, updated_at (last change only).",
  recorded: ["client created", "proposal created / sent date / last updated", "conversion evidence = linked project + the project's creation time", "payments (transaction dates + status)", "meetings (date, status)", "tasks (created / updated / due)"],
  notRecorded: ["client field changes / renames", "proposal amount / status / follow-up changes", "who changed what", "contact attempts / replies"],
  sunnyRule: "a DERIVED timeline from stored dates only — change history is never invented from current timestamps",
} as const;

export interface ClientActionEntry { id: string; group: "CLIENTS" | "PROPOSALS" | "MEETINGS" | "TASKS"; action: string; who: Who; enforcement: Enforcement; entryPoint: string; input: string; writes: string; sideEffects: string; finance: string | null; calendar: string | null; push: string | null; destructive: boolean; external: boolean; financial: boolean; approvalClass: ApprovalClass; sunnyToday: "KNOWLEDGE_ONLY"; futurePrimitive: string; seeProjectAction?: string; internal: { routes: readonly string[] } }
type CA = Omit<ClientActionEntry, "sunnyToday" | "internal"> & { routes: readonly string[] };
const A = (e: CA): ClientActionEntry => { const { routes, ...rest } = e; return { ...rest, sunnyToday: "KNOWLEDGE_ONLY", internal: { routes } }; };
const CR = "app/api/clients/route.ts", CI = "app/api/clients/[id]/route.ts", PR = "app/api/proposals/route.ts", PI = "app/api/proposals/[id]/route.ts";

/** Every client / proposal mutation in the app (2026-09-25). None is executable by Sunny today. */
export const CLIENT_ACTIONS: readonly ClientActionEntry[] = [
  A({ id: "CREATE_CLIENT", group: "CLIENTS", action: "Create client", who: "OWNER", enforcement: "ROUTE_CHECKS_OWNER", entryPoint: "Clients page '+ הוסף לקוח'; shows quick-create; new project with a new artist", input: "name (+ phone, email, type, status, notes)", writes: "clients", sideEffects: "defaults differ by path (type לקוח / אמן); DB rejects a duplicate name", finance: null, calendar: null, push: null, destructive: false, external: false, financial: false, approvalClass: "STANDARD", futurePrimitive: "CREATE_CLIENT", routes: [CR] }),
  A({ id: "AUTO_CREATE_CLIENT", group: "CLIENTS", action: "Automatic client from a project's artist", who: "SYSTEM", enforcement: "AUTOMATIC", entryPoint: "project create / artist change / conversion", input: "artist text", writes: "clients (type אמן, status חדש)", sideEffects: "exact-case check; insert errors ignored; never removes", finance: null, calendar: null, push: null, destructive: false, external: false, financial: false, approvalClass: "STANDARD", futurePrimitive: "—", routes: ["app/api/projects/route.ts", "app/api/projects/[id]/route.ts", "app/api/proposals/[id]/convert/route.ts"] }),
  A({ id: "BACKFILL_CLIENTS_FROM_PROJECTS", group: "CLIENTS", action: "One-off backfill: create missing clients from every project artist (a GET that writes; no UI)", who: "OWNER", enforcement: "PROXY_ONLY", entryPoint: "none (manual URL)", input: "—", writes: "clients", sideEffects: "exact-case match", finance: null, calendar: null, push: null, destructive: false, external: false, financial: false, approvalClass: "BULK", futurePrimitive: "—", routes: ["app/api/projects/sync-artists/route.ts"] }),
  A({ id: "UPDATE_CLIENT", group: "CLIENTS", action: "Edit client (full overwrite; empty type → אחר)", who: "OWNER", enforcement: "PROXY_ONLY", entryPoint: "Clients page ✎ / drawer ⋯", input: "every field", writes: "clients", sideEffects: "rename rewrites project artist text (see CLIENT_RENAME_REWRITES)", finance: null, calendar: null, push: null, destructive: false, external: false, financial: false, approvalClass: "STANDARD", futurePrimitive: "UPDATE_CLIENT", seeProjectAction: "CLIENT_RENAME_REWRITES", routes: [CI] }),
  A({ id: "DELETE_CLIENT", group: "CLIENTS", action: "Delete client (hard; no confirmation when no project names them)", who: "OWNER", enforcement: "PROXY_ONLY", entryPoint: "Clients page ✕", input: "client", writes: "clients; DB cascades proposals + alerts; shows / send log set null", sideEffects: "meetings, tasks, Red Films rows keep a dangling id; follow-up tasks / Google Tasks stay", finance: "project-less income keeps the artist text", calendar: "Google Tasks stay", push: null, destructive: true, external: false, financial: false, approvalClass: "DESTRUCTIVE", futurePrimitive: "DELETE_CLIENT", routes: [CI] }),
  A({ id: "CREATE_PROPOSAL", group: "PROPOSALS", action: "Create proposal", who: "OWNER", enforcement: "ROUTE_CHECKS_OWNER", entryPoint: "client drawer 'הצעה חדשה' (type tile → form)", input: "title, amount, currency, status (any string), sent date (today), follow-up date (today + 3)", writes: "proposals; tasks (follow-up) when a date is set", sideEffects: "follow-up task + Google Task", finance: null, calendar: "Google Task", push: null, destructive: false, external: true, financial: false, approvalClass: "EXTERNAL_EFFECT", futurePrimitive: "CREATE_PROPOSAL", routes: [PR] }),
  A({ id: "UPDATE_PROPOSAL", group: "PROPOSALS", action: "Edit proposal (status / amount / dates / notes; no validation)", who: "OWNER", enforcement: "PROXY_ONLY", entryPoint: "proposal card ✎", input: "any field", writes: "proposals; follow-up task sync", sideEffects: "empty follow-up silently becomes today + 3 in the UI; status changes never close the task", finance: null, calendar: "Google Task create / update / delete", push: null, destructive: false, external: true, financial: false, approvalClass: "EXTERNAL_EFFECT", futurePrimitive: "UPDATE_PROPOSAL / CHANGE_PROPOSAL_STATUS / SET_FOLLOW_UP", seeProjectAction: "LINK_PROPOSAL", routes: [PI] }),
  A({ id: "MARK_PROPOSAL_LOST", group: "PROPOSALS", action: "Mark proposal לא נסגר (legacy dashboard)", who: "OWNER", enforcement: "PROXY_ONLY", entryPoint: "/dashboard-old grid", input: "—", writes: "proposals.status", sideEffects: "follow-up task stays open", finance: null, calendar: null, push: null, destructive: false, external: false, financial: false, approvalClass: "STANDARD", futurePrimitive: "CHANGE_PROPOSAL_STATUS", routes: [PI] }),
  A({ id: "DELETE_PROPOSAL", group: "PROPOSALS", action: "Delete proposal (double click)", who: "OWNER", enforcement: "PROXY_ONLY", entryPoint: "proposal card ✕", input: "proposal", writes: "proposals; follow-up task + Google Task deleted (best effort)", sideEffects: "—", finance: null, calendar: "Google Task deleted", push: null, destructive: true, external: true, financial: false, approvalClass: "DESTRUCTIVE", futurePrimitive: "DELETE_PROPOSAL", routes: [PI] }),
  A({ id: "CONVERT_PROPOSAL", group: "PROPOSALS", action: "Convert proposal to project (not transactional)", who: "OWNER", enforcement: "PROXY_ONLY", entryPoint: "proposal card '⇒ הפוך לפרויקט'", input: "project name", writes: "projects, settings (price), proposals, tasks", sideEffects: "see CONVERSION_FLOW", finance: "agreed price set", calendar: "Google Task completed", push: null, destructive: false, external: true, financial: true, approvalClass: "FINANCIAL", futurePrimitive: "CONVERT_PROPOSAL", seeProjectAction: "CONVERT_PROPOSAL", routes: ["app/api/proposals/[id]/convert/route.ts"] }),
  A({ id: "NEW_PROJECT_FROM_CLIENT", group: "CLIENTS", action: "New project from the client drawer (artist = client name)", who: "OWNER", enforcement: "ROUTE_CHECKS_OWNER", entryPoint: "client drawer '+ פרויקט חדש'", input: "name, type, status (לא התחיל / בעבודה), deadline", writes: "projects", sideEffects: "business type לקוח", finance: null, calendar: null, push: null, destructive: false, external: false, financial: false, approvalClass: "STANDARD", futurePrimitive: "CREATE_PROJECT", seeProjectAction: "CREATE_PROJECT", routes: ["app/api/projects/route.ts"] }),
  A({ id: "SESSION_FROM_CLIENT", group: "CLIENTS", action: "New session from the client drawer (+ optional payment row with artist = client name)", who: "OWNER", enforcement: "PROXY_ONLY", entryPoint: "client drawer 'סשן חדש'", input: "session fields, optional amount", writes: "sessions; transactions (artist text)", sideEffects: "payment row linked to the client by text only", finance: "optional income row", calendar: "optional event", push: "Shalev session push when the project is Shalev's", destructive: false, external: true, financial: true, approvalClass: "FINANCIAL", futurePrimitive: "SCHEDULE_SESSION", routes: ["app/api/sessions/route.ts", "app/api/transactions/route.ts"] }),
  A({ id: "CREATE_MEETING", group: "MEETINGS", action: "New meeting with the client (+ optional calendar event)", who: "OWNER", enforcement: "PROXY_ONLY", entryPoint: "client drawer 'פגישה חדשה'", input: "date, time, duration, location, notes, project", writes: "meetings (status נקבעה)", sideEffects: "calendar failure still saves the meeting", finance: null, calendar: "event 'פגישה עם …'", push: null, destructive: false, external: true, financial: false, approvalClass: "EXTERNAL_EFFECT", futurePrimitive: "SCHEDULE_MEETING", seeProjectAction: "ADD_MEETING", routes: ["app/api/meetings/route.ts"] }),
  A({ id: "MEETING_HELD_OR_CANCELLED", group: "MEETINGS", action: "Mark meeting התקיימה / בוטלה, edit, delete", who: "OWNER", enforcement: "PROXY_ONLY", entryPoint: "client drawer ✓ / ✕ / 🗑", input: "status / fields", writes: "meetings", sideEffects: "the Google event is never updated or deleted", finance: null, calendar: "orphan event", push: null, destructive: false, external: false, financial: false, approvalClass: "STANDARD", futurePrimitive: "UPDATE_MEETING", seeProjectAction: "EDIT_MEETING", routes: ["app/api/meetings/[id]/route.ts"] }),
  A({ id: "CLIENT_TASK", group: "TASKS", action: "Task related to a client (Tasks page)", who: "OWNER", enforcement: "PROXY_ONLY", entryPoint: "Tasks page (client picker)", input: "title, due, client", writes: "tasks (related_type client)", sideEffects: "Google Task mirror", finance: null, calendar: "Google Task", push: null, destructive: false, external: true, financial: false, approvalClass: "EXTERNAL_EFFECT", futurePrimitive: "CREATE_TASK", routes: ["app/api/tasks/route.ts"] }),
];

export interface ClientWorkflow { event: string; supported: "SUPPORTED" | "PARTIAL" | "NOT_SUPPORTED"; redbloodsConcept: string; know: string[]; inspect: string[]; mayBeMissing: string[]; ask: string[]; downstream: string[]; actionsToday: string[]; futureActions: string[]; outcomeEvidence: string }
const W = (w: ClientWorkflow) => w;
export const CLIENT_WORKFLOWS: readonly ClientWorkflow[] = [
  W({ event: "NEW_LEAD", supported: "NOT_SUPPORTED", redbloodsConcept: "none — no lead entity (LEAD_REALITY)", know: ["whether the person already exists as a client"], inspect: ["clients by name", "proposals / meetings"], mayBeMissing: ["everything about the opportunity"], ask: ["who is it and what do they want — then proceed as NEW_CLIENT / NEW_PROPOSAL"], downstream: [], actionsToday: [], futureActions: ["a lead model needs Owner approval + schema"], outcomeEvidence: "—" }),
  W({ event: "NEW_CLIENT", supported: "SUPPORTED", redbloodsConcept: "client record", know: ["identity (resolve first — the name is DB-unique; a label artist may already exist under the same name)"], inspect: ["clients (exact + case-insensitive)", "label roster", "projects naming them", "proposals"], mayBeMissing: ["type", "phone / email"], ask: ["only what is not stored: contact details if the Owner wants them recorded; type when ambiguous"], downstream: ["available for proposals / meetings / projects / shows pickers"], actionsToday: ["Owner creates it on the Clients page"], futureActions: ["CREATE_CLIENT (STANDARD approval)"], outcomeEvidence: "client row exists" }),
  W({ event: "NEW_PROPOSAL", supported: "SUPPORTED", redbloodsConcept: "proposal (title, amount, currency, status, sent, follow-up)", know: ["client", "existing open proposals / projects for the client"], inspect: ["proposals of the client", "projects by name / proposal chain", "calendar meetings"], mayBeMissing: ["price", "currency", "what exactly (songs / package)", "follow-up date", "deal terms (never recorded)"], ask: ["price + currency", "what the proposal covers (one proposal for 3 songs, or one per song?)", "when to follow up (the app would default to 3 days)"], downstream: ["follow-up task + Google Task", "counted as open pipeline (POTENTIAL money)"], actionsToday: ["Owner creates it in the client drawer"], futureActions: ["CREATE_PROPOSAL (EXTERNAL_EFFECT: Google Task)"], outcomeEvidence: "proposal row + follow-up task" }),
  W({ event: "PROPOSAL_SENT", supported: "PARTIAL", redbloodsConcept: "status הצעה נשלחה + sent date (the create form already sets today)", know: ["whether the proposal exists"], inspect: ["open proposals of the client", "sent / follow-up dates"], mayBeMissing: ["the proposal itself when it was sent outside Redbloods", "follow-up date"], ask: ["if no proposal exists: title, price, currency, follow-up date", "if it exists: nothing — report its state"], downstream: ["follow-up date drives dashboards / COO"], actionsToday: ["Owner edits status / dates"], futureActions: ["UPDATE_PROPOSAL / SET_FOLLOW_UP"], outcomeEvidence: "status / sent date stored" }),
  W({ event: "FOLLOW_UP_DUE", supported: "SUPPORTED", redbloodsConcept: "followup_date ≤ today on an open proposal (+ its follow-up task)", know: ["recorded follow-up date passed"], inspect: ["meetings / tasks / calendar after the date", "status changes (updated_at)"], mayBeMissing: ["whether the Owner already talked to the client outside Redbloods"], ask: ["'היה קשר עם הלקוח מחוץ למערכת? מה המצב?' — never 'you did not follow up'"], downstream: ["dashboards / COO list it"], actionsToday: ["Owner updates status / date"], futureActions: ["SET_FOLLOW_UP / CHANGE_PROPOSAL_STATUS"], outcomeEvidence: "new status or date" }),
  W({ event: "CLIENT_RESPONDED", supported: "PARTIAL", redbloodsConcept: "only a status change — replies are not recorded", know: ["current status"], inspect: ["proposal status / updated_at"], mayBeMissing: ["the reply itself", "when it came"], ask: ["what the client answered, if the Owner wants it reflected"], downstream: ["status → נסגר / לא נסגר / לחזור בעתיד"], actionsToday: ["Owner edits status"], futureActions: ["CHANGE_PROPOSAL_STATUS"], outcomeEvidence: "status" }),
  W({ event: "PROPOSAL_WON", supported: "SUPPORTED", redbloodsConcept: "status נסגר — by conversion (with a project) or by hand (without one)", know: ["status", "linked project"], inspect: ["linked project", "project price setting", "income rows"], mayBeMissing: ["the project when closed by hand", "deal terms / advance"], ask: ["closed without a project → should a project be opened (conversion) or was it recorded elsewhere?"], downstream: ["project (conversion) + agreed price"], actionsToday: ["Owner converts in the drawer"], futureActions: ["CONVERT_PROPOSAL (FINANCIAL)"], outcomeEvidence: "linked project + price setting" }),
  W({ event: "PROPOSAL_LOST", supported: "SUPPORTED", redbloodsConcept: "status לא נסגר (also written when the linked project is deleted)", know: ["status"], inspect: ["whether a project was deleted (status reverted)", "open follow-up task"], mayBeMissing: ["reason"], ask: ["nothing by default; the reason only if the Owner wants it recorded"], downstream: ["its follow-up task stays open (bug)"], actionsToday: ["Owner edits status"], futureActions: ["CHANGE_PROPOSAL_STATUS"], outcomeEvidence: "status" }),
  W({ event: "RETURN_LATER", supported: "PARTIAL", redbloodsConcept: "status לחזור בעתיד — a label; counted as open everywhere", know: ["status", "follow-up date"], inspect: ["follow-up date"], mayBeMissing: ["when 'later' is"], ask: ["when to return to it (follow-up date) if none is set"], downstream: ["stays in open value / follow-up lists"], actionsToday: ["Owner edits"], futureActions: ["SET_FOLLOW_UP"], outcomeEvidence: "date" }),
  W({ event: "PROPOSAL_TO_PROJECT", supported: "SUPPORTED", redbloodsConcept: "conversion (CONVERSION_FLOW)", know: ["proposal, client, amount, currency"], inspect: ["already linked? (duplicate risk)", "existing projects for the client"], mayBeMissing: ["project name", "deadline (never set by conversion)", "project type", "advance terms"], ask: ["project name", "deadline (a client commitment)", "was an advance agreed / received?"], downstream: ["project לא התחיל, business type לקוח, agreed price = amount when > 0, proposal נסגר, follow-up task done"], actionsToday: ["Owner converts"], futureActions: ["CONVERT_PROPOSAL (FINANCIAL, idempotent primitive required)"], outcomeEvidence: "linked project + price setting + proposal נסגר" }),
  W({ event: "ADVANCE_EXPECTED", supported: "PARTIAL", redbloodsConcept: "no advance field — an expected income row may exist", know: ["agreed price", "income rows"], inspect: ["received / expected income on the project"], mayBeMissing: ["the advance amount / due point (NOT_RECORDED)"], ask: ["was an advance agreed, and how much? (never assumed)"], downstream: ["—"], actionsToday: ["Owner adds an expected income row"], futureActions: ["deal terms model (proposal)"], outcomeEvidence: "an expected income row" }),
  W({ event: "ADVANCE_RECEIVED", supported: "PARTIAL", redbloodsConcept: "a received income row (not marked as the advance)", know: ["received rows"], inspect: ["project income", "project-less income with the client's name"], mayBeMissing: ["which row is the advance"], ask: ["nothing when a received row exists"], downstream: ["project balance"], actionsToday: ["Owner records income"], futureActions: ["RECORD_INCOME (FINANCIAL)"], outcomeEvidence: "received income row" }),
  W({ event: "CLIENT_PROJECT_ACTIVE", supported: "SUPPORTED", redbloodsConcept: "client project in בעבודה / מחכה למיקס / במיקס", know: ["project state, deadline class, ball holder, advance evidence (operating model)"], inspect: ["project_view", "operating_model project"], mayBeMissing: ["who holds the ball outside Redbloods"], ask: ["only what evidence cannot answer"], downstream: ["—"], actionsToday: [], futureActions: [], outcomeEvidence: "project status" }),
  W({ event: "CLIENT_PROJECT_NEAR_COMPLETION", supported: "SUPPORTED", redbloodsConcept: "project in מחכה למיקס / במיקס (mix stage) — where the Owner's pattern expects the rest of the payment", know: ["received vs agreed", "open expected rows"], inspect: ["money section", "deal terms (not recorded)"], mayBeMissing: ["when exactly the rest is due"], ask: ["is the rest due now (mix) or at delivery for this deal?"], downstream: ["delivery"], actionsToday: [], futureActions: [], outcomeEvidence: "income rows" }),
  W({ event: "REMAINING_PAYMENT", supported: "PARTIAL", redbloodsConcept: "agreed − received (Finance Brain collectible)", know: ["collectible balance"], inspect: ["receivables", "Owner closures"], mayBeMissing: ["due condition"], ask: ["never states a debt without an agreed price; asks when the rest is due"], downstream: ["cashflow"], actionsToday: ["Owner records income"], futureActions: ["RECORD_INCOME"], outcomeEvidence: "received row" }),
  W({ event: "REPEAT_CLIENT_OPPORTUNITY", supported: "PARTIAL", redbloodsConcept: "derived only — a client with ≥ 2 projects / proposals", know: ["relationship depth with link quality"], inspect: ["projects by name + proposal chain", "last activity"], mayBeMissing: ["whether the client wants more work"], ask: ["nothing proactively — surfaced as context, never as a sales score"], downstream: ["—"], actionsToday: [], futureActions: [], outcomeEvidence: "a new proposal / project" }),
];

export const CLIENT_SIGNAL_MODEL: ReadonlyArray<{ code: string; kind: "CANONICAL_FACT" | "DERIVED_SIGNAL" | "UNKNOWN"; note: string }> = [
  { code: "OPEN_PROPOSAL", kind: "CANONICAL_FACT", note: "a proposal whose status is not נסגר / לא נסגר" },
  { code: "FOLLOW_UP_DUE", kind: "DERIVED_SIGNAL", note: "recorded follow-up date ≤ today (Israel) on an open proposal — not proof that nobody followed up" },
  { code: "OPEN_PROPOSAL_NO_FOLLOW_UP", kind: "CANONICAL_FACT", note: "open proposal without a follow-up date" },
  { code: "RETURN_LATER", kind: "CANONICAL_FACT", note: "status לחזור בעתיד" },
  { code: "UNKNOWN_PROPOSAL_STATUS", kind: "UNKNOWN", note: "a status outside the vocabulary (consumers disagree)" },
  { code: "PROPOSAL_CONVERTED", kind: "CANONICAL_FACT", note: "proposal linked to a project" },
  { code: "PROPOSAL_CLOSED_WITHOUT_PROJECT", kind: "CANONICAL_FACT", note: "נסגר with no linked project — conversion evidence missing" },
  { code: "PROPOSAL_AMOUNT_DIFFERS_FROM_PRICE", kind: "CANONICAL_FACT", note: "proposal amount ≠ the linked project's agreed price" },
  { code: "MEETING_UPCOMING", kind: "CANONICAL_FACT", note: "a meeting dated today or later" },
  { code: "MEETING_STATUS_NOT_UPDATED", kind: "DERIVED_SIGNAL", note: "meeting date passed and status is still נקבעה (held or not is unknown)" },
  { code: "ACTIVE_CLIENT_PROJECT", kind: "CANONICAL_FACT", note: "an open project linked to the client (with its link quality)" },
  { code: "CLIENT_DEADLINE_APPROACHING", kind: "DERIVED_SIGNAL", note: "operating model: APPROACHING / AT_RISK" },
  { code: "HISTORICAL_DEADLINE_DEBT", kind: "DERIVED_SIGNAL", note: "operating model: passed on or before 2026-09-25" },
  { code: "PAYMENT_EVIDENCE_MISSING", kind: "DERIVED_SIGNAL", note: "operating model: progressed client work with no received income" },
  { code: "RECEIVABLE_EXISTS", kind: "DERIVED_SIGNAL", note: "Finance Brain collectible balance > 0" },
  { code: "NO_RECENT_RECORDED_ACTIVITY", kind: "DERIVED_SIGNAL", note: "no recorded proposal / project / meeting / payment activity for 90+ days — stale is not urgent, and outside contact is invisible" },
  { code: "IDENTITY_DUAL_ROLE", kind: "CANONICAL_FACT", note: "the same name exists as a label artist (two records, one person — never merged)" },
  { code: "IDENTITY_COLLABORATION", kind: "DERIVED_SIGNAL", note: "a project names this client together with others" },
  { code: "DEAL_TERMS_UNKNOWN", kind: "UNKNOWN", note: "Redbloods does not record the payment agreement (advance / milestones)" },
];

export const CLIENT_INTEGRITY = {
  productionCounts20260925: {
    clients: 32, byType: { "אמן": 24, "לקוח": 6, "איש צוות": 1, "אחר": 1 }, byStatus: { "חדש": 23, "VIP": 4, "אמן לייבל": 3, "פעיל": 2 },
    withPhone: 5, withEmail: 14, withNotes: 1, duplicatePhones: 0, duplicateEmails: 0, duplicateNames: 0,
    clientsNamedByProjects: 23, clientsWithSeveralProjects: 10, clientsWithProposals: 3, clientsWithMeetings: 1, clientsWithTasks: 4, showArtists: 2, showBookers: 6, showDjs: 1, sendLogRecipients: 4, redFilmsClients: 7, clientsWithNoRecordedActivity: 2,
    proposals: 3, proposalsOpen: 0, proposalsClosedLinked: 3, proposalsClosedWithoutProject: 0, brokenLinkedProject: 0, proposalAmountDiffersFromPrice: 1, proposalFollowUpBeforeSent: 1,
    meetings: 2, meetingsPastStillScheduled: 2, meetingsWithCalendarEvent: 1, clientTasks: 6, clientTasksOrphan: 0,
  },
  findingsHe: [
    "אין הצעות פתוחות כרגע — כל 3 ההצעות נסגרו והומרו לפרויקטים.",
    "בהצעה אחת הסכום (4,500) שונה מהמחיר המוסכם בפרויקט (4,250) — ייתכן הנחה; לא ידוע.",
    "בהצעה אחת תאריך הפולואפ קודם לתאריך השליחה.",
    "2 הפגישות שרשומות עברו ועדיין 'נקבעה' — לא ידוע אם התקיימו.",
    "10 הכנסות בלי פרויקט (בעיקר הופעות) מקושרות ללקוח רק לפי שם האמן.",
    "3 אנשים קיימים גם כלקוח וגם כאמן לייבל.",
  ],
} as const;

/** Server-side client / proposal / meeting files. A semantic change must review this contract and update the fingerprint. */
export const CLIENT_REVIEWED_FINGERPRINTS: Readonly<Record<string, string>> = {
  "lib/clients-store.ts": "ebb90e6828853739ac5fda2afa7793d61382a23e9c926901383614290c84cc6e",
  "app/api/clients/route.ts": "bb1cf6cae04a25673ff087d9465299fc88c9c8db8abda3cefed771d4b2bd9ecd",
  "app/api/clients/[id]/route.ts": "98f3f335e86d4a3041d80baa51a0d3df076d184cb9b6cbe67244406007e58a6c",
  "app/api/proposals/route.ts": "88990298305caa2cfc288e7e3dad5002f1594220d13fa6462d57e59a5e00fdce",
  "app/api/proposals/[id]/route.ts": "78ee80cd9ab1d252b824dbc5125d323439770dfa0fddfdb050875184b0b77105",
  "app/api/proposals/[id]/convert/route.ts": "a08297d8d9b4903b687e539a5e4b2887998b38ac6e6949a95a1f1b073fc74368",
  "app/api/proposals/all/route.ts": "038c4babad0ecafca5317441c001deb5bf1572bf3e3ebf2413ebbc603bc0251a",
  "app/api/meetings/route.ts": "b97f70befae4adabd5e048f803aea25683b2927e3c7ca48082c78ea3bf73a52c",
  "app/api/meetings/[id]/route.ts": "b1c2203236067cb2b8ec982fef8ccfa021e26e92af2f2d3a1521ad6081ca205b",
  "lib/tasks-store.ts": "72b1eb5ee4c8f7d05c60858290ae183bc18ec3008513d743ba4bca4f314fa6c7",
};

/** Every API route file that reads or writes the clients / proposals tables (the test re-discovers them from the repo). */
export const CLIENT_ROUTE_INVENTORY: Readonly<Record<string, string>> = {
  "app/api/clients/route.ts": "list / create clients",
  "app/api/clients/[id]/route.ts": "client + linked projects (name match) / edit (rename rewrites projects) / delete",
  "app/api/proposals/route.ts": "proposals of a client / create (+ follow-up task)",
  "app/api/proposals/[id]/route.ts": "edit (+ follow-up task sync) / delete (+ task)",
  "app/api/proposals/[id]/convert/route.ts": "conversion (CONVERSION_FLOW)",
  "app/api/proposals/all/route.ts": "every proposal with the client name / status (dashboards, Insights)",
  "app/api/projects/sync-artists/route.ts": "one-off backfill (GET that writes clients)",
  "app/api/projects/[id]/route.ts": "project deletion reverts linked proposals to לא נסגר + removes their follow-up tasks",
  "app/api/projects/[id]/clip/send/route.ts": "reads the client by exact name for the Red Films production",
  "app/api/shows/route.ts": "reads client names for shows",
  "app/api/shows/[id]/route.ts": "reads client names for a show",
  "app/api/shows/[id]/quote-sent/route.ts": "reads the client name for a show quote",
  "app/api/agent/check/route.ts": "proposal follow-up rule (switched off)",
  "app/api/projects/route.ts": "project creation adds missing clients from the artist text",
  "app/api/label/artists/[id]/recoup/route.ts": "parses artist names (client-store name splitter) to match a label artist's projects",
  "app/api/label/artists/[id]/shows/route.ts": "parses artist names (client-store name splitter) for a label artist's shows",
};
