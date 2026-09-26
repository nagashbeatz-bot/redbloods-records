/**
 * SUNNY UNIVERSAL ACTION LAYER — shared types (Wave 0 foundation, pure).
 *
 * ONE registry of typed actions, ONE plan → preview → Owner approval → execute → verify → outcome engine, ONE audit.
 * Current trust policy (Boss decision 2026-09-26): EVERY write requires the Boss's explicit approval. Risk classes shape
 * preview detail, warnings, audit and a FUTURE autonomy policy — they never grant execution without approval.
 */

export type RiskClass = "SAFE_REVERSIBLE" | "NORMAL_BUSINESS" | "FINANCIAL" | "EXTERNAL_SYSTEM_WRITE" | "EXTERNAL_COMMUNICATION" | "FILE_MUTATION" | "DESTRUCTIVE" | "BULK" | "SECURITY_SENSITIVE";
/** Highest wins (a plan's class = the highest class among its steps and every side effect). */
export const RISK_ORDER: readonly RiskClass[] = ["SAFE_REVERSIBLE", "NORMAL_BUSINESS", "EXTERNAL_SYSTEM_WRITE", "FILE_MUTATION", "FINANCIAL", "EXTERNAL_COMMUNICATION", "DESTRUCTIVE", "BULK", "SECURITY_SENSITIVE"];
/** Internal confirmation strength. ALL require the Boss's approval; C2/C3 add stronger binding. SECURITY is never delegated. */
export type ConfirmationClass = "C1_APPROVAL" | "C2_APPROVAL_WITH_VALUES" | "C3_STRONG_APPROVAL" | "NOT_DELEGATED";

/** Owner-facing availability (the Boss's four buckets) + the internal detail. */
export type Availability = "SUNNY_EXECUTABLE" | "SUNNY_NEEDS_HARDENING" | "SUNNY_BLOCKED" | "SUNNY_INTENTIONALLY_EXCLUDED";
export type AvailabilityDetail =
  | "EXECUTABLE_VIA_DASHBOARD_APPROVAL" | "EXECUTABLE"
  | "NEEDS_HARDENING"
  | "NEEDS_PRIMITIVE" | "BLOCKED_BY_DATA_MODEL" | "BLOCKED_BY_OWNER_DECISION" | "LEGACY_NOT_EXPOSED"
  | "SECURITY_EXCLUDED" | "OTHER_USER_PORTAL_ONLY" | "SYSTEM_AUTOMATIC" | "SUNNY_NATIVE";
export type Wave = "W0" | "W1" | "W2" | "W3" | "W4" | "W5" | "W6" | "W7" | "EXCLUDED" | "NATIVE";

export type EffectKey = "FINANCE" | "LEDGER" | "CALENDAR" | "GOOGLE_TASKS" | "FILES" | "PUSH" | "EMAIL" | "CASCADE" | "UNLINK" | "DELETION" | "SETTINGS" | "EXTERNAL_LINK";
export const EFFECT_KEYS: readonly EffectKey[] = ["FINANCE", "LEDGER", "CALENDAR", "GOOGLE_TASKS", "FILES", "PUSH", "EMAIL", "CASCADE", "UNLINK", "DELETION", "SETTINGS", "EXTERNAL_LINK"];
/** Execution phase — plans must be ordered INTERNAL → EXTERNAL → COMMUNICATION. */
export type Phase = "INTERNAL" | "EXTERNAL" | "COMMUNICATION";

export interface ArgSpec { name: string; kind: "entityKey" | "text" | "number" | "ymd" | "time" | "enum" | "boolean" | "money"; required: boolean; values?: readonly string[]; noteHe?: string }

export interface ActionContract {
  id: string;
  version: number;
  domain: string;
  meaningHe: string | null;
  meaningEn: string;
  businessEvents: readonly string[];
  args: readonly ArgSpec[];
  preconditions: readonly string[];
  riskClass: RiskClass;
  confirmation: ConfirmationClass;
  /** Every declared side effect (the union of the curated domain inventory and the pinned code scan — never under-declared). */
  effects: readonly EffectKey[];
  /** Reachable through the route's code (transitive scan) but not a declared effect of this action — the preview says "may". */
  possibleEffects: readonly EffectKey[];
  phase: Phase;
  reversible: "YES" | "PARTIAL" | "NO";
  compensation: string | null;
  idempotency: "EXECUTION_KEY" | "EXECUTION_KEY_PLUS_NATURAL_DUPLICATE_WARNING";
  availability: Availability;
  availabilityDetail: AvailabilityDetail;
  reason: string;
  wave: Wave;
  /** Known behaviour the preview MUST disclose (e.g. "the calendar event is not updated"). */
  disclosuresHe: readonly string[];
  internal: { routes: readonly string[]; source: string; writer: string | null; verifier: string | null };
}

// ── plans / previews / outcomes ─────────────────────────────────────────────────────────────────────────────────────
export interface PlanStep {
  index: number;
  actionId: string;
  actionVersion: number;
  /** Canonical, validated arguments. */
  args: Readonly<Record<string, unknown>>;
  /** Resolved canonical entity keys (verified server-side). */
  entities: readonly string[];
  phase: Phase;
  /** Fingerprint of the live state this step was previewed against (null = depends on an earlier step's output). */
  expectedFingerprint: string | null;
  /** Before → after, per field, as shown in the preview. */
  changes: ReadonlyArray<{ field: string; before: unknown; after: unknown }>;
  dependsOn: readonly number[];
}
export interface Plan {
  planId: string;
  ownerId: string;
  clientId: string;
  intentHe: string;
  steps: readonly PlanStep[];
  riskClass: RiskClass;
  confirmation: ConfirmationClass;
  effects: readonly EffectKey[];
  createdAt: string;
  expiresAt: string;
}
export interface Preview {
  planId: string;
  planHash: string;
  intentHe: string;
  addressHe: string;
  steps: ReadonlyArray<{ index: number; meaningHe: string; entities: readonly string[]; changes: PlanStep["changes"]; effectsHe: readonly string[]; willNotHappenHe: readonly string[] }>;
  riskClass: RiskClass;
  confirmation: ConfirmationClass;
  /** For C2/C3: the exact values the Boss's confirmation must repeat (amount / currency / recipient …). */
  requiredConfirmationValues: readonly string[];
  missingHe: readonly string[];
  duplicateWarningsHe: readonly string[];
  expiresAt: string;
  approvalRule: string;
}

export type StepStatus = "APPLIED_AS_EXPECTED" | "NO_CHANGE" | "FAILED" | "STALE" | "CONFLICT" | "NOT_RUN";
export type PlanStatus = "APPLIED_AS_EXPECTED" | "PARTIALLY_APPLIED" | "NO_CHANGE" | "FAILED" | "STALE" | "ROLLED_BACK" | "ROLLBACK_PARTIAL" | "REFUSED";
export interface StepOutcome { index: number; actionId: string; status: StepStatus; detail: string; replayed: boolean }
export interface PlanOutcome { planId: string; planHash: string; status: PlanStatus; refusal: string | null; steps: readonly StepOutcome[] }

export type PlanEventType = "PLAN_CREATED" | "PREVIEWED" | "APPROVED" | "STEP_EXECUTED" | "STEP_FAILED" | "VERIFIED" | "COMPENSATED" | "STALE" | "REFUSED";
export const PLAN_EVENT_TYPES: readonly PlanEventType[] = ["PLAN_CREATED", "PREVIEWED", "APPROVED", "STEP_EXECUTED", "STEP_FAILED", "VERIFIED", "COMPENSATED", "STALE", "REFUSED"];
