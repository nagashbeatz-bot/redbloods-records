/**
 * Redbloods Partner — Finance Brain V1 types (Phase F2.1–F2.4). Pure, no I/O.
 *
 * READ + DERIVE + EXPLAIN only. Realized money, expected money, receivables, committed
 * expenses and ideas are separate concepts and are never added together. Amounts are
 * always kept per currency (symbols, as the rest of the app: ₪ $ €) — no FX anywhere.
 */

// ── raw inputs (as read by the server binding; minimal columns, no free text) ──

export interface FinanceTxRow {
  id: string;
  projectId: string | null;
  type: string | null;
  date: string | null;
  amount: unknown;
  currency: string | null;
  status: string | null;
  category: string | null;
  scope: string | null;
  expenseScope: string | null;
  linkedSessionId: string | null;
  createdAt: string | null;
}
export interface FinanceProjectRow { id: string; name: string; status: string; isHidden: boolean; businessType: string | null; artist: string | null; updatedAt: string | null }
/** settings key `finance_<projectId>` (any projectId — orphans included). */
export interface FinanceSettingRow { projectId: string; value: unknown }
export interface EngineerWorkRow { id: string; projectId: string | null; engineerName: string | null; status: string | null; agreedPrice: unknown; amountPaid: unknown; currency: string | null; linkedTransactionId: string | null }
export interface FinanceShowRow { id: string; date: string | null; status: string | null; paymentStatus: string | null; price: unknown; incomeTxId: string | null; artistTxId: string | null; djTxId: string | null }
export interface FinanceProposalRow { id: string; clientId: string | null; status: string | null; amount: unknown; currency: string | null; followupDate: string | null; linkedProjectId: string | null }
export interface FinanceClientRow { id: string; name: string; status: string | null; type: string | null }
export interface FinanceLabelArtistRow { id: string; name: string }
export interface LedgerEntryRow { artistId: string; entryType: string | null; amount: unknown; sourceTxId: string | null }
export interface MediaIncomeRow { labelArtistId: string | null; status: string | null; grossAmount: unknown }
export interface RedFilmsPaymentRow { id: string; amount: unknown; paymentDate: string | null }
/** One month of Victor's salary exactly as lib/vendor-store.ts getVictorSalaryMonths() resolves it (canonical). */
export interface SalaryMonthRow { workMonth: string; dueDate: string; amount: number; currency: string; status: string; transactionId: string | null }

export interface FinanceRaw {
  transactions: FinanceTxRow[];
  projects: FinanceProjectRow[];
  financeSettings: FinanceSettingRow[];
  engineerWorks: EngineerWorkRow[];
  shows: FinanceShowRow[];
  proposals: FinanceProposalRow[];
  clients: FinanceClientRow[];
  labelArtists: FinanceLabelArtistRow[];
  ledger: LedgerEntryRow[];
  mediaIncome: MediaIncomeRow[];
  redFilmsPayments: RedFilmsPaymentRow[];
  /** null = the canonical salary read failed (recurring coverage becomes MISSING, never guessed). */
  victorSalary: SalaryMonthRow[] | null;
}

// ── derived state ──

export type CoverageState = "RELIABLE" | "PARTIAL" | "MISSING" | "AMBIGUOUS";
export type CoverageKey =
  | "realizedIncome" | "realizedExpenses" | "agreedPrices" | "receivableDueDates" | "recurringExpenses"
  | "projectAttribution" | "clientAttribution" | "labelAttribution" | "currencies" | "proposalPipeline";
export interface CoverageEntry { state: CoverageState; reason: string }

export type Epistemic = "FACT" | "DERIVED" | "HYPOTHESIS" | "UNKNOWN";
export type LegacyClass = "CONFIRMED_CURRENT" | "NEEDS_REVIEW" | "LIKELY_HISTORICAL" | "UNKNOWN";

/** Why Partner is saying something — internal provenance (never shown as raw ids). */
export interface Evidence {
  sourceType: "transaction" | "finance_setting" | "project" | "engineer_work" | "show" | "proposal" | "client" | "salary_month" | "label_ledger" | "media_income" | "red_films_payment";
  sourceId: string;
  projectId?: string | null;
  clientId?: string | null;
  currency?: string | null;
  date?: string | null;
  status?: string | null;
  reasonCode: string;
}

export type CurrencyTotals = Record<string, number>;
export interface CurrencyFlow { cashIn: number; cashOut: number; net: number }

export type TargetPosition = "BELOW_FLOOR" | "IN_TARGET_RANGE" | "ABOVE_PREFERRED";

export interface MonthWindow { key: string; start: string; end: string; today: string; dayOfMonth: number; daysInMonth: number; daysRemaining: number }

export interface RealizedMonth {
  month: string;
  byCurrency: Record<string, CurrencyFlow>;
  /** ILS only (the Owner's target currency). */
  ils: CurrencyFlow;
  /** Months that started before the recording policy are recorded-only (never the complete business result). */
  historicalPartial: boolean;
  evidence: Evidence[];
}

export type CollectionState = "UPCOMING" | "DUE_SOON" | "DUE_TODAY" | "OVERDUE" | "NO_DUE_DATE" | "SETTLED" | "NOT_COLLECTIBLE" | "NEEDS_REVIEW";
export type ReminderStage = "NONE" | "7D_BEFORE" | "3D_BEFORE" | "1D_BEFORE" | "DUE_TODAY" | "WEEKLY_OVERDUE" | "WEEKLY_NO_DATE";
export type ImportanceBasis = "HIGH_VALUE" | "VIP_CLIENT" | "STANDARD" | "NON_ILS_NO_THRESHOLD";
export interface CollectionInfo {
  state: CollectionState;
  reminderStage: ReminderStage;
  daysUntilDue: number | null;
  daysOverdue: number | null;
  /** Would the approved adaptive policy remind about this TODAY (display only — no Push). */
  remindToday: boolean;
  important: boolean;
  importanceBasis: ImportanceBasis;
}

export type ReceivableSource = "PROJECT_BALANCE" | "CLIP_BALANCE" | "EXPECTED_TX";
export interface Receivable {
  id: string;
  source: ReceivableSource;
  /** true when an agreed price supports the amount; false = only an explicit expected transaction does. */
  priceKnown: boolean;
  projectId: string | null;
  projectName: string | null;
  projectStatus: string | null;
  amount: number;
  currency: string;
  dueDate: string | null;
  client: { attribution: "TEXT_MATCH" | "AMBIGUOUS" | "NONE"; vip: boolean };
  collection: CollectionInfo;
  legacy: LegacyClass;
  /** No reason model exists yet — Partner does not know why a payment is late. */
  reasonKnown: false;
  reason: "UNKNOWN";
  evidence: Evidence[];
}
export interface ProjectCredit { projectId: string; projectName: string; amount: number; currency: string; kind: "SONG" | "CLIP"; evidence: Evidence[] }

export interface PriceCoverage { liveProjects: number; priced: number; priceUnknownOpen: number; priceUnknownCompleted: number; financeExceptions: number; malformedSettings: number }

export type ExpectedClass = "DATED_EXPECTED" | "UNDATED_EXPECTED" | "PROPOSAL_PIPELINE" | "OTHER_FORECAST";
export interface ExpectedItem { class: ExpectedClass; amount: number; currency: string; date: string | null; certainty: "CONTRACTUAL_RECORD" | "PROPOSAL_ONLY" | "UNKNOWN"; projectId: string | null; evidence: Evidence[] }

export type OpenExpenseSource = "TRANSACTION" | "SHOW_PAYOUT" | "ENGINEER_WORK";
export interface OpenExpense {
  id: string;
  source: OpenExpenseSource;
  amount: number;
  currency: string;
  dueDate: string | null;
  category: string | null;
  projectId: string | null;
  legacy: LegacyClass;
  overdueDays: number | null;
  evidence: Evidence[];
}

export type ExpenseClass = "KNOWN_RECURRING" | "KNOWN_ONE_TIME" | "RECURRING_CANDIDATE" | "UNKNOWN_CLASSIFICATION";
export interface RecurringKnown { code: "VICTOR_SALARY"; workMonth: string; dueDate: string; amount: number; currency: string; state: "FOUND_IN_FINANCE" | "PAID_OUTSIDE_FINANCE" | "EXPECTED_EXPENSE_NOT_FOUND" | "COMMITTED_UPCOMING" | "CANCELLED_OR_OTHER"; evidence: Evidence[] }
export interface RecurringCandidate { key: string; category: string; amount: number; currency: string; months: string[]; epistemic: "HYPOTHESIS"; evidence: Evidence[] }

export type SignalCode =
  | "HISTORICAL_DATA_PARTIAL" | "EXPECTED_INCOME_NOT_RECORDED" | "EXPECTED_EXPENSE_NOT_FOUND" | "EXPENSE_NOT_IN_FINANCE"
  | "PRICE_MISSING" | "COMPLETED_WORK_EXPENSE_NO_INCOME" | "DUE_DATE_MISSING" | "TRANSACTION_PROJECT_LINK_MISSING"
  | "CURRENCY_AMBIGUOUS" | "CURRENCY_SETTLEMENT_AMBIGUOUS" | "RECURRING_CLASSIFICATION_UNKNOWN" | "ORPHAN_PRICE_SETTINGS"
  | "SHOW_PRICE_MISSING" | "DUPLICATE_LOOKING_RECORDS" | "MALFORMED_RECORDS" | "LABEL_LEDGER_NO_CURRENCY"
  | "MEDIA_INCOME_NO_CURRENCY" | "RED_FILMS_OUTSIDE_FINANCE" | "UNDATED_RECORDS" | "POSSIBLE_OBLIGATION_OVERLAP";
export interface FinanceSignal {
  code: SignalCode;
  epistemic: Epistemic;
  /** Grouped count (e.g. how many projects lack a price). */
  count: number;
  /** Per-currency amounts when the signal is about money; never summed across currencies. */
  amounts: CurrencyTotals;
  /** NEEDS_OWNER_REVIEW = only the Owner can resolve it (e.g. orphan price data). */
  review: "NEEDS_OWNER_REVIEW" | null;
  evidence: Evidence[];
}

export type OpportunityKind = "FACT_BASED_OPPORTUNITY" | "DERIVED_OPPORTUNITY" | "IDEA";
export interface Opportunity {
  kind: OpportunityKind;
  code: "OVERDUE_RECEIVABLE" | "DUE_SOON_RECEIVABLE" | "COMPLETED_PROJECT_BALANCE" | "OPEN_PROPOSAL" | "COMPLETED_WORK_EXPENSE_NO_INCOME"
    | "PRICE_MISSING_BLOCKS_COLLECTION" | "NEAR_DELIVERY_UNPRICED" | "VIP_FOLLOW_UP" | "SHOW_PIPELINE_GAP";
  /** Only FACT_BASED opportunities carry a contractually supported amount. IDEAs never do. */
  amount: CurrencyTotals | null;
  count: number;
  evidence: Evidence[];
}

export interface Pacing {
  recordedRealizedNetIls: number;
  knownIncomingIls: number;
  knownOutgoingIls: number;
  knownMonthEndPositionIls: number;
  gapToFloorNow: number;
  gapToPreferredNow: number;
  gapToFloorKnownPosition: number;
  gapToPreferredKnownPosition: number;
  /** Non-ILS known flows before month end — shown separately, never folded into the ILS position. */
  otherCurrencies: { incoming: CurrencyTotals; outgoing: CurrencyTotals };
  daysRemaining: number;
  /** A known position — NOT a forecast — unless coverage is reliable. */
  label: "KNOWN_MONTH_END_POSITION";
  coverage: CoverageState;
}

export interface PartnerFinanceState {
  schemaVersion: "partner-finance-brain-v1";
  policy: { floorIls: number; preferredIls: number; policyStartYmd: string; highValueThresholdIls: number };
  month: MonthWindow;
  coverage: Record<CoverageKey, CoverageEntry>;
  realized: RealizedMonth & { targetPosition: TargetPosition; distanceToFloor: number; distanceToPreferred: number };
  history: RealizedMonth[];
  receivables: Receivable[];
  credits: ProjectCredit[];
  priceCoverage: PriceCoverage;
  expected: ExpectedItem[];
  openExpenses: { items: OpenExpense[]; totalsByCurrency: CurrencyTotals; possibleOverlaps: OpenExpense[] };
  recurring: { known: RecurringKnown[]; candidates: RecurringCandidate[]; unknownClassificationThisMonth: number; classification: Record<string, ExpenseClass> };
  pacing: Pacing;
  signals: FinanceSignal[];
  opportunities: Opportunity[];
  proposalPipeline: { state: "NO_ACTIVE_PIPELINE_DATA" | "ACTIVE"; openCount: number; amounts: CurrencyTotals };
}
