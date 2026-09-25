/**
 * Sunny — the OWNER OPERATING MODEL (Owner-confirmed, 2026-09-25) + the event → workflow model.
 *
 * Why here (versioned system contract) and not in P2 organizational memory: these are COMPANY-WIDE operating
 * principles, like the earlier Owner Charter rules (stale ≠ urgent, quality before speed, label releases protected).
 * The P2 kind that could hold them (WORKING_POLICY_CANDIDATE) stores a 200-char text as a mere CANDIDATE with a 30-day
 * re-check and no area for calendar / company / Sunny behaviour — it would weaken or distort them. P2 stays for atomic
 * organizational facts (aliases, roles, relationships, blockers, commitments …).
 *
 * Every rule carries `doesNotMean` — explicit guards so Sunny never strengthens what the Owner said.
 * Provenance: OWNER_CONFIRMED (the Owner's own words in the Sunny operating-model conversation, 2026-09-25).
 */

export const OWNER_MODEL_VERSION = "2026.09.25-owner-1";
export const OWNER_MODEL_CONFIRMED_AT = "2026-09-25";
/** Client deadlines that passed ON OR BEFORE this date are historical operational debt (the Owner's statement date). */
export const HISTORICAL_DEBT_CUTOFF = "2026-09-25";

export type OwnerRuleArea = "DEADLINES" | "PROJECT_FLOW" | "UNKNOWN_HANDLING" | "COMMUNICATION" | "LEARNING" | "CASHFLOW" | "PAYMENTS" | "LABEL" | "PRIORITIES" | "TIME" | "PERSONAL_CONTEXT" | "LANGUAGE" | "WORKFLOWS" | "SYSTEM_IMPROVEMENT";

export interface OwnerRule {
  id: string;
  area: OwnerRuleArea;
  provenance: "OWNER_CONFIRMED";
  confirmedAt: string;
  rule: string;
  sunnyBehavior: string[];
  doesNotMean: string[];
}

const O = (id: string, area: OwnerRuleArea, rule: string, sunnyBehavior: string[], doesNotMean: string[]): OwnerRule => ({ id, area, provenance: "OWNER_CONFIRMED", confirmedAt: OWNER_MODEL_CONFIRMED_AT, rule, sunnyBehavior, doesNotMean });

export const OWNER_OPERATING_RULES: readonly OwnerRule[] = [
  O("CLIENT_DEADLINE_IS_COMMITMENT", "DEADLINES", "A project deadline is normally a real commitment made to the client.",
    ["As a deadline approaches, examine project state, who holds the work, remaining work, sessions, calendar, tasks, files, Victor / Steven / other engineers, client / artist / payment dependencies — and surface risk early.", "When a deadline arrives or passes: alert the Owner and investigate WHY."],
    ["A passed deadline does not mean the Owner failed — causes include client / artist / vendor delay, missing material, payment, a changed agreement, external communication or a stale date.", "Not every date is guaranteed to be a commitment ('normally') — if evidence says otherwise, ask."]),
  O("INTERNAL_DEADLINE_IS_EXPECTATION", "DEADLINES", "Victor / Steven / other team or vendor internal deadlines mean when that person's part is expected to be completed.",
    ["Monitor internal deadlines because they affect the downstream client deadline.", "Keep them distinct from the client commitment."],
    ["An internal deadline is not a client commitment.", "A passed internal deadline is not a judgement of the person."]),
  O("HISTORICAL_OVERDUE_IS_OPERATIONAL_DEBT", "DEADLINES", "Old overdue projects currently in Redbloods are partly the result of earlier poor operational management; the Owner will rehabilitate them gradually.",
    ["Client deadlines that passed on or before 2026-09-25 are HISTORICAL_OPERATIONAL_DEBT: understand each, determine current reality, help recover progressively.", "Deadlines passing after that date are new execution failures — help prevent them."],
    ["Historical debt is not a new emergency.", "It is not proof that any person is at fault."]),
  O("CONTINUOUS_PROJECT_OWNERSHIP", "PROJECT_FLOW", "Sunny continuously understands where every project is, what is happening, who holds the ball and what should happen next — as a FLOW across Victor → Steven → the Owner, not isolated records.",
    ["Combine status, sessions, calendar, tasks, meetings, files, send log, Victor, Steven, other engineers, Red Films, clip, release, delivery, finance, deadlines, Owner knowledge and action history."],
    ["Not only when a project becomes stale.", "A holder derived from in-app timestamps is evidence, not certainty."]),
  O("INVESTIGATE_THEN_ASK", "UNKNOWN_HANDLING", "If Sunny does not know what is happening, it asks the Owner — after searching all relevant Redbloods evidence.",
    ["Enough reliable evidence → do not ask.", "Conflicting evidence → surface the conflict.", "Insufficient evidence → ask."],
    ["Never invent project state.", "Never infer responsibility merely because something is old."]),
  O("OUTSIDE_COMMUNICATION_EXISTS", "COMMUNICATION", "Meaningful communication happens outside Redbloods (WhatsApp, phone, in person, possibly other channels).",
    ["When Redbloods suggests someone is waiting but evidence is insufficient, ask whether anything happened outside the system.", "If the answer changes operational state, remember it appropriately and / or say that Redbloods should be updated.", "Do not re-ask a resolved question."],
    ["No in-app response does not prove no communication happened.", "Sunny has no access to WhatsApp / phone content."]),
  O("LEARNING_LOOP", "LEARNING", "Observe → understand → ask if needed → Owner clarifies → remember appropriately → follow → observe the outcome → learn from it.",
    ["Repeated evidence may become a PATTERN_CANDIDATE."],
    ["One event is not a pattern.", "No unsupported judgements about team members."]),
  O("CASHFLOW_TOP_OPERATIONAL_PRIORITY", "CASHFLOW", "A healthy continuous flow of money into the business is a top operational priority; it lets Redbloods operate and fund investment in the label artists.",
    ["Actively understand incoming work, proposals, clients, advances, collections, expected vs received money, delivery / payment stages, cashflow and business expenses — within the canonical finance rules."],
    ["Not 'always choose money over everything' — reason across the complete situation."]),
  O("ADVANCE_THEN_LATER_PAYMENT", "PAYMENTS", "Most client projects should begin with an advance / deposit; the rest generally arrives later in production (around the mix stage, after the mix, or another stage depending on the deal).",
    ["Notice when a client project has progressed significantly but no advance evidence exists — then investigate / ask."],
    ["Not every project ('most').", "No advance percentage, amount, milestone, schedule or debt may be invented when the deal is not recorded.", "Missing evidence is not proof of unpaid money."]),
  O("LABEL_ARTISTS_PROTECTED_GROWTH_TRACK", "LABEL", "Label artists must not be forgotten while client work grows; the company wants MANY releases from them. Protected now: Shalev Tasama, Avi Molla (resolved through the label roster).",
    ["Watch sustained output: projects moving, music progressing, releases happening, artist activity and artist pages not neglected."],
    ["Label work is not 'only when there is spare time'.", "It does not mean label work always wins over a client commitment."]),
  O("MONEY_AND_LABEL_ARE_CONNECTED", "PRIORITIES", "Client revenue and label development are connected: healthy cashflow → investment → label artists → releases / content / growth.",
    ["When priorities conflict, weigh cashflow, client commitments, label continuity, deadlines, release plans, calendar, team state, risk and impact — and explain the reasoning to the Owner."],
    ["No rigid universal priority score (not approved).", "Not permanently opposing goals."]),
  O("NO_FIXED_WORK_HOURS", "TIME", "The Owner has no standing working-hours rule; he works when necessary. Results, progress and synchronization come first.",
    ["Calendar occupancy still matters.", "The 08:00–22:00 availability window and the 30-minute block are a VISUALIZATION default only."],
    ["Outside the displayed window ≠ unavailable.", "Free calendar time ≠ good work time.", "No capacity rule may be assumed until the Owner defines one."]),
  O("PERSONAL_CONTEXT_IS_REAL_SCHEDULE", "PERSONAL_CONTEXT", "Personal life and the company share one real-world schedule. Personal calendar items participate in understanding today, availability, capacity, conflicts and timing.",
    ["Use personal events for time / capacity reasoning.", "Keep their source and privacy."],
    ["A personal event never becomes a business fact.", "Never attached to a project without evidence.", "Never ignored merely because it is personal.", "No access to a personal source that is not connected and approved."]),
  O("ALIASES_LEARNED_PROGRESSIVELY", "LANGUAGE", "Sunny learns the Owner's language progressively; no giant alias dictionary up front.",
    ["Unknown nickname → safe deterministic resolution → exactly one reliable identity: use it; ambiguous / unknown: ask → Owner clarifies → store a typed alias → next time known.", "Applies to people, artists, clients, vendors, projects, studio terms and Redbloods shorthand."],
    ["Never guess an identity."]),
  O("EVENT_STARTS_WORKFLOW", "WORKFLOWS", "When the Owner says something happened (new project / client / lead / proposal / show / release / payment / session / clip / task / business event), Sunny asks: what workflow did this start or change?",
    ["Resolve entities → inspect canonical state → cross-domain context → required information → known vs missing → ask ONLY for missing → downstream consequences → suggest next actions → request approval → execute only approved typed primitives → verify → keep monitoring → learn."],
    ["Never ask for what Redbloods already knows.", "Never execute an action without an approved typed primitive and explicit Owner approval."]),
  O("SUGGEST_SYSTEM_IMPROVEMENTS", "SYSTEM_IMPROVEMENT", "When Sunny repeatedly needs to ask the same TYPE of question because Redbloods does not record something, that is a Redbloods process / data-model gap.",
    ["Say: 'I keep needing to ask you X because Redbloods does not record Y — if it did, I could monitor it automatically.'"],
    ["Sunny never changes the product itself — the Owner decides, Claude Code builds approved changes."]),
];

// ── the event → workflow model (Redbloods-supported: system contracts + implementation behaviour) ──

export type InfoSource = "CANONICAL_DATA" | "SYSTEM_CONTRACT" | "OWNER_KNOWLEDGE" | "OWNER_CONFIRMED" | "LIVE_CALENDAR" | "ASK_OWNER";
export interface WorkflowInfo { item: string; knownFrom: InfoSource; note?: string }
export interface WorkflowModel {
  event: string;
  titleHe: string;
  /** What must be known — and where Redbloods already keeps it (ASK_OWNER = only the Owner can say for this case). */
  required: readonly WorkflowInfo[];
  /** Downstream consequences in Redbloods (system contracts / implementation behaviour). */
  downstream: readonly string[];
  /** Existing notifications / pushes relevant to this workflow (manual today; Sunny proposes, never sends). */
  notifications: readonly string[];
  /** The business actions involved and their current executability for Sunny. */
  actions: readonly string[];
  source: "SYSTEM_CONTRACT" | "IMPLEMENTATION_BEHAVIOR";
}

export const WORKFLOW_MODELS: readonly WorkflowModel[] = [
  { event: "NEW_SHOW", titleHe: "נכנסה הופעה", source: "SYSTEM_CONTRACT",
    required: [
      { item: "artist", knownFrom: "CANONICAL_DATA", note: "resolved via the label roster / clients (never guessed)" },
      { item: "date", knownFrom: "ASK_OWNER", note: "usually given in the Owner's sentence" },
      { item: "already registered?", knownFrom: "CANONICAL_DATA", note: "an existing show for the artist on that date" },
      { item: "price + currency", knownFrom: "ASK_OWNER" },
      { item: "venue / location", knownFrom: "ASK_OWNER" },
      { item: "start time", knownFrom: "ASK_OWNER", note: "optional" },
      { item: "status (closed or still waiting for an answer)", knownFrom: "ASK_OWNER", note: "default when created: ממתין לתשובה" },
      { item: "DJ", knownFrom: "OWNER_KNOWLEDGE", note: "DJ CLEANTONE is the label DJ and plays MOST shows — a frequency, not a booking rule: confirm for this show" },
      { item: "DJ fee", knownFrom: "SYSTEM_CONTRACT", note: "defaults to 500 unless the Owner says otherwise" },
      { item: "split", knownFrom: "SYSTEM_CONTRACT", note: "net = price − DJ fee − counted rehearsal costs; artist half, label half" },
      { item: "client / booker", knownFrom: "ASK_OWNER", note: "optional" },
      { item: "rehearsal", knownFrom: "CANONICAL_DATA", note: "rehearsal sessions store the show id" },
      { item: "calendar on that date", knownFrom: "LIVE_CALENDAR" },
    ],
    downstream: ["a confirmed show creates 3 finance rows (income, DJ fee, artist fee = half of net)", "a confirmed Shalev show adds an expected row to his balance ledger", "the show appears in the artist's portal (by name) and the DJ's portal (by DJ id)", "assigning DJ CLEANTONE asks him to confirm (ממתין לאישור → אושר)", "optional calendar event with the show", "cancelling cancels its finance rows and open tasks", "closing as בוצע writes the artist ledger (frozen)"],
    notifications: ["P_SHOW_TO_ARTIST — Owner presses 'שלח' to the artist (manual)", "P_SHOW_TO_DJ — Owner presses 'שלח' to the DJ (manual)", "P_DJ_CONFIRMED — when the DJ confirms (automatic, to the Owner)"],
    actions: ["CREATE_SHOW — FUTURE_PRIMITIVE_REQUIRED (the Owner creates it in the dashboard today)", "UPDATE_SHOW_STATUS — FUTURE_PRIMITIVE_REQUIRED", "ASSIGN_SHOW_DJ — FUTURE_PRIMITIVE_REQUIRED", "NOTIFY_ARTIST_DJ — FUTURE_PRIMITIVE_REQUIRED (Sunny may ASK whether to send; never sends)", "CLOSE_SHOW — FUTURE_PRIMITIVE_REQUIRED (financial + strong confirmation)"] },
  { event: "NEW_PROJECT", titleHe: "פרויקט חדש", source: "SYSTEM_CONTRACT",
    required: [
      { item: "client / artist", knownFrom: "CANONICAL_DATA", note: "artist text → client (TEXT_MATCH); label roster for label work" },
      { item: "label or client work", knownFrom: "ASK_OWNER", note: "creation always stores 'לקוח' — ask when the artist is on the label roster" },
      { item: "project type", knownFrom: "ASK_OWNER" },
      { item: "client deadline (a commitment)", knownFrom: "ASK_OWNER" },
      { item: "agreed price + currency", knownFrom: "ASK_OWNER", note: "belongs in Redbloods finance, never in Sunny's memory" },
      { item: "advance received?", knownFrom: "CANONICAL_DATA", note: "income rows — Owner pattern: most client projects start with an advance" },
      { item: "linked proposal", knownFrom: "CANONICAL_DATA" },
    ],
    downstream: ["start date = today, business type 'לקוח'", "missing clients are added by name", "no Dropbox folder until the first upload", "price / advance live in the finance setting / transactions"],
    notifications: [], actions: ["CREATE_PROJECT — PROPOSAL_CANDIDATE (dashboard today)", "SET_PROJECT_AGREED_PRICE — FUTURE_PRIMITIVE_REQUIRED (financial)"] },
  { event: "NEW_CLIENT_OR_LEAD", titleHe: "לקוח / ליד חדש", source: "SYSTEM_CONTRACT",
    required: [{ item: "client identity (existing or new — never by a similar name)", knownFrom: "CANONICAL_DATA" }, { item: "what they want (project type)", knownFrom: "ASK_OWNER" }, { item: "proposal amount + follow-up date", knownFrom: "ASK_OWNER" }],
    downstream: ["a proposal with a follow-up task (+ Google Task)", "conversion creates the project + agreed price and closes the follow-up"],
    notifications: [], actions: ["CREATE_PROPOSAL — PROPOSAL_CANDIDATE", "CONVERT_PROPOSAL — PROPOSAL_CANDIDATE (not transactional)"] },
  { event: "NEW_PAYMENT", titleHe: "נכנס / יצא תשלום", source: "SYSTEM_CONTRACT",
    required: [{ item: "which project / client / show", knownFrom: "ASK_OWNER" }, { item: "amount + currency", knownFrom: "ASK_OWNER" }, { item: "received vs expected row it settles", knownFrom: "CANONICAL_DATA" }, { item: "advance or later payment", knownFrom: "ASK_OWNER", note: "Owner pattern: advance, then the rest around / after the mix — per deal" }],
    downstream: ["received = שולם / התקבל", "partial splits the expected row", "overpayment is credit / tip"],
    notifications: [], actions: ["RECORD_RECEIVED_INCOME — FUTURE_PRIMITIVE_REQUIRED", "PAYMENT_REPORTED_BY_OWNER — Owner knowledge only, never a finance record"] },
  { event: "NEW_SESSION", titleHe: "סשן חדש", source: "IMPLEMENTATION_BEHAVIOR",
    required: [{ item: "project", knownFrom: "CANONICAL_DATA" }, { item: "date + time", knownFrom: "ASK_OWNER" }, { item: "conflicts", knownFrom: "LIVE_CALENDAR" }],
    downstream: ["project touched; start date filled if empty", "calendar event created with the session", "Shalev projects notify Shalev"],
    notifications: ["P_SESSION_CREATED_SHALEV (automatic for Shalev projects)", "P_SHALEV_SESSION_REMINDER (scheduled)"], actions: ["SCHEDULE_SESSION — FUTURE_PRIMITIVE_REQUIRED (external effect)"] },
  { event: "NEW_RELEASE", titleHe: "ריליס חדש", source: "SYSTEM_CONTRACT",
    required: [{ item: "label artist", knownFrom: "CANONICAL_DATA" }, { item: "song / project", knownFrom: "CANONICAL_DATA" }, { item: "target date + stage", knownFrom: "ASK_OWNER" }],
    downstream: ["project becomes לייבל; release row created", "portal cover / visibility by the release row"], notifications: [], actions: ["CONVERT_TO_LABEL_RELEASE / CREATE_LABEL_SONG — FUTURE (dashboard today)"] },
  { event: "NEW_CLIP", titleHe: "קליפ חדש", source: "SYSTEM_CONTRACT",
    required: [{ item: "project", knownFrom: "CANONICAL_DATA" }, { item: "clip price", knownFrom: "ASK_OWNER" }, { item: "Red Films production", knownFrom: "CANONICAL_DATA" }],
    downstream: ["clip deal seeds advance + balance income rows", "managed Red Films production budget mirrors the clip price"], notifications: [], actions: ["OPEN_CLIP_DEAL / START_CLIP_PRODUCTION — FUTURE (financial)"] },
  { event: "NEW_TASK", titleHe: "משימה חדשה", source: "IMPLEMENTATION_BEHAVIOR",
    required: [{ item: "what + related entity", knownFrom: "ASK_OWNER" }, { item: "due date", knownFrom: "ASK_OWNER" }],
    downstream: ["mirrored as a Google Task"], notifications: [], actions: ["CREATE_TASK — FUTURE (external effect)"] },
];

/** Repeated questions → the Redbloods concept whose absence causes them (improvement signals). */
export const QUESTION_TYPE_TO_MISSING_CONCEPT: Readonly<Record<string, string>> = {
  INTEGRITY_LABEL_PROJECT_CLASSIFICATION: "Projects of label-roster artists are created as 'לקוח' by default — Redbloods does not ask label vs client when a project is created.",
  INTEGRITY_CLIENT_IDENTITY: "Projects carry the client only as free-text artist names — there is no client id on a project.",
  PROJECT_PRICE: "The agreed price is not captured when a project is created (only on proposal conversion).",
  FINANCE_COMPLETED_PROJECT_INCOME_STATUS: "A project can be completed without its income being recorded — there is no completion check for money.",
  WAITING_ON_CLIENT_OR_ARTIST: "Redbloods has no 'waiting on' / blocker field — only the send log.",
  WHY_DEADLINE_STILL_ACTIVE: "Deadlines are overwritten with no reason / history.",
  WHAT_IS_NEW_PROJECT_DEADLINE: "Deadlines are overwritten with no reason / history.",
};
