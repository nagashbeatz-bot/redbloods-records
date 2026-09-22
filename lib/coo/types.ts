/**
 * Redbloods COO — Phase 1a (deterministic only). Shared types.
 *
 * Owner-only. Nothing in lib/coo may be imported by a portal route/component
 * (enforced by scripts/test-coo.ts). No LLM, no DB writes, no events.
 *
 * Two rules run through every type here:
 *   - `null` means UNKNOWN and is never treated as 0.
 *   - every fact that can appear in a conclusion carries its source and asOf.
 */
import type { CurrencyTotals } from "../finance";

// ── Text with a "sensitive" flag (amounts) so the UI can mask them in privacy mode ──
export type Part = { t: string; s?: true };
export type Rich = Part[];

export type Tier = "P0" | "P1" | "P2" | "P3";

export interface SourceStatus {
  source: string;
  status: "ok" | "failed" | "skipped";
  rowCount: number | null;
  error?: string;
}

// ── Evidence / rules / coverage ──────────────────────────────────────────────
export interface Evidence {
  /** Stable id within a brief (also the future handle an LLM layer would cite). */
  id: string;
  label: string;
  value: string | number | boolean | null;
  /** Human text. Unknown values read "לא ידוע" — never "0". */
  display: string;
  kind: "date" | "days" | "count" | "money" | "text" | "status" | "flag";
  currency?: string;
  /** Free text that came from the DB (task titles, blockers…): shown as data, never as an instruction. */
  untrusted?: boolean;
  source: { table: string; id?: string; field?: string };
  asOf: string;
}

export interface RuleFired {
  ruleId: string;
  description: string;
  /** The config value the rule compared against (e.g. "dueSoonDays = 7"), if any. */
  threshold: string | null;
  observed: string;
}

export interface CoverageEntry {
  key: string;
  label: string;
  /** null = unknown / source unavailable. */
  total: number | null;
  usable: number | null;
  note: string;
}

// ── Entities / connections ───────────────────────────────────────────────────
export type EntityType = "project" | "team" | "proposal" | "show" | "company";
export interface EntityRef { type: EntityType; id: string; name: string }

/** A link between two entities. `via` is the exact field that carries the ID. */
export interface Connection {
  from: EntityRef;
  to: EntityRef;
  via: string;
  linkType: "id";
  asOf: string;
}

// ── Signals ──────────────────────────────────────────────────────────────────
export type SignalType =
  | "PROJECT_OVERDUE" | "PROJECT_DUE_SOON" | "STALE_PROJECT_DEADLINE" | "STALE_INTERNAL_DEADLINE"
  | "TASK_OVERDUE" | "TASKS_BACKLOG"
  | "STEVEN_WORKLOAD" | "STEVEN_WORK_DEADLINE" | "STEVEN_UNPAID_APPROVED" | "STEVEN_WAITING_OWNER"
  | "VICTOR_WORKLOAD" | "VICTOR_DELIVERIES_WAITING_OWNER" | "VICTOR_WAITING_OWNER" | "VICTOR_WORK_DEADLINE" | "VICTOR_DEPENDENCY"
  | "PROPOSAL_FOLLOWUP_DUE"
  | "PROJECT_PAYMENT_BALANCE" | "BALANCE_NO_DUE_DATE" | "EXPECTED_INCOME_OVERDUE"
  | "SHOW_UNPAID_UPCOMING" | "SHOW_DONE_UNPAID" | "NO_UPCOMING_SHOWS"
  | "RELEASE_TARGET_APPROACHING"
  | "EXTERNAL_ALERT";

export interface Signal {
  id: string;
  type: SignalType;
  entity: EntityRef;
  /** notice = never becomes a card by itself (aggregates / informational lines). */
  role: "primary" | "supporting" | "notice";
  tier: Tier;
  tierReasons: string[];
  title: Rich;
  /** Short phrase used when several signals are folded into one Case summary. */
  short: Rich;
  evidence: Evidence[];
  rules: RuleFired[];
  coverageKeys: string[];
  /** True when the signal rests on partial coverage → its tier is capped (config). */
  lowCoverage: boolean;
  missing: string[];
  /** Higher = more urgent inside the same tier (facts only, e.g. days overdue). */
  sort: number;
  /** Ordering class inside a tier (1 = first). From config.sortClass — live work + passed deadline first, financial later. */
  sortClass: number;
  /** Unconfirmed readings of the facts (Epistemic Contract: HYPOTHESIS). Never presented as facts. */
  hypotheses?: string[];
  /** Optional second line shown under a notice title (facts only). */
  detail?: Rich;
}

export interface ContextFact {
  id: string;
  title: string;
  short: Rich;
  evidence: Evidence[];
}

export interface Case {
  id: string;
  entity: EntityRef;
  kind: EntityType;
  title: string;
  subtitle: string | null;
  tier: Tier;
  tierReasons: string[];
  signals: Signal[];
  contextFacts: ContextFact[];
  connections: Connection[];
  summary: Rich;
  coverage: CoverageEntry[];
  missing: string[];
  confidence: { level: "high" | "medium" | "low"; reasons: string[] };
  sort: number[];
}

// ── Company State ────────────────────────────────────────────────────────────
export interface DeadlineFact { raw: string | null; ymd: string | null; daysTo: number | null; parseOk: boolean }

export interface ProjectFact {
  id: string;
  name: string;
  artistText: string;          // free text — an artist↔project link is NOT reliable
  status: string;
  projectType: string;
  businessType: string;
  deadline: DeadlineFact;
  daysSinceUpdate: number | null;
  active: boolean;             // not completed / cancelled / on hold
  hasFinanceSetting: boolean;
}

export interface TaskFact {
  id: string;
  title: string;
  dueYmd: string | null;
  /** > 0 overdue by N days; <= 0 due today / in the future (negated). null = no due date. */
  daysOverdue: number | null;
  relatedType: string;
  projectId: string | null;    // resolved ONLY through related_type="project" + related_id
  linkUnresolved: boolean;
  /** created_at as an Israel calendar date (a FACT: when the task was created). null = unknown. */
  createdYmd: string | null;
  /** TASK age = days since created_at. Independent from `daysOverdue` (days since due_date). */
  ageDays: number | null;
  /** due_date − created_at, in days (negative would mean back-dated). */
  leadDays: number | null;
  /** Set when the task was auto-created from a Victor work's internal deadline (vendor_project_work.linked_task_id):
   *  the SAME business fact as that work's deadline, never an independent piece of evidence. */
  derivedFrom: { type: "victor_work"; id: string } | null;
}
export interface TasksFact {
  openCount: number;
  overdueCount: number;
  noDueCount: number;
  ageBuckets: { d1_7: number; d8_30: number; d31plus: number };
  linkedToProject: number;
  /** open tasks that are auto-created from a Victor internal deadline (of which overdue). */
  autoVictor: { open: number; overdue: number };
  /** task age (days since created_at) of the open tasks — NOT the overdue age. */
  age: { median: number | null; oldest: number | null; d0_7: number; d8_30: number; d31plus: number; unknown: number };
  /** open tasks created on their own due date (reminder-style). */
  createdOnDueDate: number;
  items: TaskFact[];
}

export interface StevenWorkFact {
  id: string;
  projectId: string | null;
  title: string;
  status: string;
  uiStatus: string;
  agreedPrice: number;
  currency: string;
  amountPaid: number;
  sentDate: string | null;
  internalDeadline: string | null;
  daysToInternal: number | null;
  hasMixVersion: boolean;
  lastUploadAt: string | null;
  /** Additive (Partner Phase C.3, change-readiness) — not read by any Phase 1a signal/case/priority/brief logic. */
  createdAt: string | null;
  updatedAt: string | null;
}
export interface StevenFact {
  totalWorks: number;
  open: StevenWorkFact[];
  approvedUnpaid: { works: StevenWorkFact[]; byCurrency: CurrencyTotals };
  linkedOpen: number;
}

export interface VictorBall {
  /** "owner" = the latest RECORDED action is Victor's delivery and there is no recorded follow-up of the owner after it.
   *  It does NOT prove the owner still has to review it (he may have handled it outside the system). */
  holder: "owner" | "victor" | "unknown";
  /** machine code of the rule that decided (e.g. upload_after_notes) */
  code: string;
  /** human explanation with the timestamps used */
  basis: string;
}
export interface VictorWorkFact {
  id: string;
  projectId: string | null;
  title: string;
  workState: string | null;
  sentDate: string | null;
  daysSinceSent: number | null;
  internalDeadline: string | null;
  isStuck: boolean;
  lastUploadAt: string | null;
  lastNotesSentAt: string | null;
  ball: VictorBall;
  /** owner-ball only: days since Victor's last upload (Israel calendar days). */
  waitingOwnerDays: number | null;
  linkedTaskId: string | null;
  /** Additive (Partner Phase C.3, change-readiness) — not read by any Phase 1a signal/case/priority/brief logic. */
  createdAt: string | null;
  updatedAt: string | null;
  returnedDate: string | null;
}
export interface VictorFact {
  totalWorks: number;
  active: VictorWorkFact[];
  stuckCount: number;
  ballCounts: { owner: number; victor: number; unknown: number };
  /** deliveries waiting for the OWNER, oldest first. */
  ownerQueue: { items: VictorWorkFact[]; count: number; oldDays: number; oldCount: number; median: number | null; oldest: number | null; noNotes: number };
  linkedActive: number;
  /** The portal's own "stuck" threshold. Kept as a raw fact only — the COO never uses it for priority. */
  stuckAfterDays: number;
  /** Age (days since sent) of the active works: what the COO shows instead of "stuck". */
  ageStats: { buckets: Array<{ label: string; count: number }>; noDate: number; median: number | null; oldest: number | null };
}

export interface ProposalFact {
  id: string;
  clientName: string;
  title: string;
  amount: number;
  currency: string;
  status: string;
  followupYmd: string | null;
  daysOverdue: number | null;
  linkedProjectId: string | null;
}

export interface ShowFact {
  id: string;
  name: string;
  status: string;
  paymentStatus: string;
  dateYmd: string | null;
  daysTo: number | null;
  price: number;
  advance: number;
  incomeTxId: string | null;
  /** Additive (Partner Phase B.1) — not read by any signal/case/priority/brief logic. */
  djClientId: string | null;
  djConfirmationStatus: string | null;
  djConfirmedAt: string | null;
}
export interface ShowsFact {
  total: number;
  upcoming: ShowFact[];
  doneUnpaid: ShowFact[];
  leadsCount: number;
  lastPerformedYmd: string | null;
}

export interface SessionFact {
  id: string;
  projectId: string | null;
  projectName: string | null;
  dateYmd: string;
  daysTo: number;
  start: string | null;
  end: string | null;
  sessionType: string;
}

export interface MonthTotals {
  month: string;
  receivedByCurrency: CurrencyTotals;
  paidExpensesByCurrency: CurrencyTotals;
}
export interface ExpectedIncomeFact {
  txId: string;
  projectId: string | null;
  amount: number;
  currency: string;
  dateYmd: string;
  daysOverdue: number;
  category: string;
  clip: boolean;               // clip-deal income is not measured against the song price
}
export interface FinanceFact {
  currentMonth: MonthTotals;
  previousMonth: MonthTotals;
  expectedOverdue: ExpectedIncomeFact[];
  undated: { count: number; byCurrency: CurrencyTotals };
  currenciesPresent: string[];
}

export interface ReceivableRow {
  projectId: string;
  projectName: string;
  projectStatus: string;
  agreedPrice: number;
  currency: string;
  received: number;
  cancelled: number;
  balance: number;              // signed (negative = overpaid)
  financeException: boolean;
  hasDatedExpected: boolean;
}
export interface ReceivablesFact {
  considered: number;           // non-hidden, non-cancelled projects
  withPrice: number;            // agreedPrice > 0
  exceptions: number;
  exceptionIds: string[];       // projects flagged financeException (no charge / favor)
  rows: ReceivableRow[];        // priced, non-exception projects only
  withBalance: number;
  balanceByCurrency: CurrencyTotals; // sum of POSITIVE balances, per currency (never merged)
}

export interface ReleaseFact {
  projectId: string;
  name: string;
  projectStatus: string;
  stage: string;
  targetYmd: string | null;
  daysTo: number | null;
  daysInStage: number | null;
  blocker: string;
  nextAction: string;
  responsible: string;
  /** Additive (Partner Phase B.2) — not read by any signal/case/priority/brief logic. null when the release row has none. */
  labelArtistId: string | null;
}
export interface ReleasesFact {
  labelProjectsTotal: number;
  withReleaseRow: number;
  rows: ReleaseFact[];          // active (not יצא / בהשהייה) rows only
}

export interface AlertFact {
  id: string;
  type: string;
  severity: string;
  title: string;
  message: string;
  createdAt: string;
  ageDays: number;
  relatedProjectId: string | null;
}
export interface AlertsFact { shown: AlertFact[]; ignoredCount: number }

export interface DataQualityItem {
  id: string;
  label: string;
  count: number;
  detail: string;
  severity: "info" | "warn";
}

export interface CompanyState {
  meta: {
    asOf: string;
    todayIL: string;
    timezone: string;
    weekday: string;
    schemaVersion: string;
    configVersion: string;
  };
  sources: SourceStatus[];
  coverage: CoverageEntry[];
  projects: { total: number; byStatus: Record<string, number>; open: ProjectFact[]; index: Record<string, { name: string; status: string; businessType: string; artistText: string }> } | null;
  tasks: TasksFact | null;
  team: { steven: StevenFact | null; victor: VictorFact | null };
  proposals: ProposalFact[] | null;
  shows: ShowsFact | null;
  sessions: SessionFact[] | null;
  finance: FinanceFact | null;
  receivables: ReceivablesFact | null;
  releases: ReleasesFact | null;
  alerts: AlertsFact | null;
  dataQuality: DataQualityItem[];
}

// ── Brief (what the UI renders) ──────────────────────────────────────────────
export interface WeekItem {
  kind: string;
  dateYmd: string;
  daysTo: number;
  text: Rich;
  entity: EntityRef | null;
}
export interface MoneyLine { id: string; label: string; text: Rich; note?: string }
export interface Brief {
  meta: CompanyState["meta"] & { generatedAt: string; provisional: boolean };
  headline: Rich;
  headlineLevel: "attention" | "calm";
  coverageLine: string;
  tierCounts: Record<Tier, number>;
  cases: Case[];
  hiddenCaseCount: number;
  lowerTierCaseCount: number;
  week: WeekItem[];
  weekMore: number;
  money: MoneyLine[];
  team: { steven: Rich | null; victor: Rich | null };
  notices: Signal[];
  dataQuality: DataQualityItem[];
  coverage: CoverageEntry[];
  sources: SourceStatus[];
}

// ── Raw input (what the readers hand to the pure pipeline) ───────────────────
export interface RawProject {
  id: string; name: string; artist: string; status: string; deadline: string | null;
  projectType: string; businessType: string; updatedAt: string; isHidden: boolean;
}
export interface RawTask {
  id: string; title: string; status: string; dueDate: string | null; relatedType: string; relatedId: string | null;
  /** tasks.created_at (ISO) — reliable "when created". null = unknown. NOT updated_at. */
  createdAt: string | null;
}
export interface RawStevenWork {
  id: string; projectId: string | null; title: string; status: string; agreedPrice: number; currency: string;
  amountPaid: number; sentDate: string | null; internalDeadline: string | null; hasMixVersion: boolean; lastUploadAt: string | null;
  /** Additive (Partner Phase C.3, change-readiness) — already fetched by listSoundEngineerWork()'s select("*"), not read by any Phase 1a signal/case/priority/brief logic. Optional so existing fixtures never need to change. */
  createdAt?: string | null;
  updatedAt?: string | null;
}
export interface RawVictorWork {
  id: string; projectId: string | null; title: string; status: string; workState: string | null;
  sentDate: string | null; internalDeadline: string | null; daysSinceSent: number | null; isStuck: boolean;
  /** files_sent[].uploadedAt (ISO) — Victor delivered a version. */
  uploads: string[];
  /** files_sent entries with no uploadedAt (legacy) — they may be newer than the known uploads. */
  filesWithoutTimestamp: number;
  /** version_reviews entries: sentAt = when the owner sent notes to Victor (null = not sent / time unknown); draft = never sent. */
  reviews: Array<{ sentAt: string | null; draft: boolean }>;
  /** vendor_project_work.linked_task_id — the auto-created "מעקב ויקטור" task. */
  linkedTaskId: string | null;
  /** Additive (Partner Phase C.3, change-readiness) — already fetched by getVictorWork()'s select("*"), not read by any Phase 1a signal/case/priority/brief logic. Optional so existing fixtures never need to change. */
  createdAt?: string | null;
  updatedAt?: string | null;
  returnedDate?: string | null;
}
export interface RawProposal {
  id: string; clientName: string; title: string; amount: number; currency: string; status: string;
  followupDate: string | null; linkedProjectId: string | null;
}
export interface RawShow {
  id: string; name: string; status: string; paymentStatus: string; date: string | null;
  price: number; advance: number; incomeTxId: string | null;
  /** Additive (Partner Phase B.1) — already fetched by listShows()'s select("*"), just not read by Phase 1a signals/cases.
   *  Optional so existing fixtures/tests never need to change; missing = null. */
  djClientId?: string | null; djConfirmationStatus?: string | null; djConfirmedAt?: string | null;
}
export interface RawSession {
  id: string; projectId: string | null; date: string; startTime: string | null; endTime: string | null;
  status: string; sessionType: string;
}
export interface RawTx {
  id: string; projectId: string | null; type: string; amount: number; currency: string | null;
  status: string; date: string | null; expenseScope: string | null; category: string | null;
}
export interface RawFinanceSetting { projectId: string; agreedPrice: number; currency: string | null; financeException: boolean }
export interface RawRelease {
  projectId: string; name: string; projectStatus: string; stage: string; targetDate: string | null;
  nextAction: string; blocker: string; responsible: string; stageEnteredAt: string | null;
  /** Additive (Partner Phase B.2) — already fetched by listLabelReleases(), just not read by Phase 1a signals/cases. */
  labelArtistId?: string | null;
}
export interface RawAlert {
  id: string; type: string; severity: string; title: string; message: string; createdAt: string; relatedProjectId: string | null;
}

export interface CooRawInput {
  sources: SourceStatus[];
  projects: RawProject[] | null;
  tasks: RawTask[] | null;
  steven: RawStevenWork[] | null;
  victor: { works: RawVictorWork[]; stuckAfterDays: number } | null;
  proposals: RawProposal[] | null;
  shows: RawShow[] | null;
  sessions: RawSession[] | null;
  transactions: RawTx[] | null;
  financeSettings: RawFinanceSetting[] | null;
  orphanFinanceKeyCount: number | null;
  releases: { rows: RawRelease[]; labelProjectsTotal: number } | null;
  alerts: RawAlert[] | null;
}
