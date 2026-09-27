/**
 * SUNNY UNIVERSAL ACTION LAYER — the 100% ACTION COVERAGE MATRIX (pure, derived from the ONE registry + explicit,
 * reviewed classifications). Answers mechanically: "Which legitimate operation can the Boss perform in Redbloods that
 * Sunny cannot yet perform after his approval — and what exactly has to be built for it, in which wave?"
 *
 * Every contract lands in exactly ONE of the Boss's four classes:
 *   EXECUTABLE                        — runs through Claude today (only after the Boss approves its exact plan).
 *   NEEDS_HARDENING                   — a Redbloods engineering gap (typed primitive / validation / atomicity / ordering /
 *                                       addressability) — TEMPORARY: `requiredWork` + `targetWave` say how it becomes EXECUTABLE.
 *   BLOCKED_BY_MISSING_CAPABILITY     — Redbloods itself cannot represent it yet (data model / an Owner product decision) —
 *                                       a registered system capability gap; current-semantics equivalent named when one exists.
 *   INTENTIONALLY_SECURITY_EXCLUDED   — ONLY: a raw secret / credential / device-authentication flow, an identity-bound
 *                                       action of ANOTHER user with no legitimate Owner equivalent, or system machinery that
 *                                       is not an Owner operation (with its Owner equivalent named when one exists).
 * There is no dead end: every NEEDS_HARDENING / BLOCKED row has concrete `requiredWork`. Waves are sequencing only.
 */
import { ACTION_CONTRACTS, NEEDS_HARDENING } from "./registry";
import { WORKFLOW_EVENT_MAP } from "./business-events";
import { COVERAGE_MAP } from "./coverage-map";
import { ALL_PRIMITIVES } from "./primitives";
const PRIMITIVE_IDS = new Set(ALL_PRIMITIVES.map((p) => p.actionId));
import type { ActionContract, ConfirmationClass, EffectKey, Wave } from "./types";

export type CoverageClass = "EXECUTABLE" | "NEEDS_HARDENING" | "BLOCKED_BY_MISSING_CAPABILITY" | "INTENTIONALLY_SECURITY_EXCLUDED";
export type ExclusionKind = "SECRET_OR_CREDENTIAL_FLOW" | "IDENTITY_BOUND_OTHER_USER" | "SYSTEM_MACHINERY_NOT_AN_OWNER_OPERATION";
export type TargetWave = "LIVE" | "W2" | "W3" | "W4" | "W5" | "W6" | "W7" | "W8" | "NONE";
export interface CoverageRow {
  id: string; domain: string; meaningEn: string;
  klass: CoverageClass; exclusionKind: ExclusionKind | null;
  targetWave: TargetWave;
  /** What must be built / hardened / decided to make it executable (null only when EXECUTABLE or excluded). */
  requiredWork: string | null;
  /** The Owner-legitimate operation that already covers the same business outcome (when this one is excluded / blocked). */
  ownerEquivalent: string | null;
  approval: ConfirmationClass;
  verification: string;
  effects: readonly EffectKey[];
}

/** Dependency-ordered sequencing (NOT capability exclusions). */
export const WAVE_PLAN: ReadonlyArray<{ wave: TargetWave; titleEn: string; dependsOn: readonly TargetWave[] }> = [
  { wave: "LIVE", titleEn: "Wave 1 — 13 internal reversible primitives (enabled)", dependsOn: [] },
  { wave: "W2", titleEn: "Internal CRUD + lifecycle (incl. hardening the Wave 1 leftovers, creates, statuses, addressability of every sub-record)", dependsOn: ["LIVE"] },
  { wave: "W3", titleEn: "Finance + ledger + cycles + show / clip money (canonical Finance Brain rules, currencies separate, C2 values)", dependsOn: ["W2"] },
  { wave: "W4", titleEn: "Calendar / Google Tasks / public links (canonical integration writers; divergence hardened first)", dependsOn: ["W2"] },
  { wave: "W5", titleEn: "Files / Dropbox / uploads / delivery (safe file ids, never paths; no generic file tool)", dependsOn: ["W2"] },
  { wave: "W6", titleEn: "Notifications / Push / email / artist + DJ + Steven + Victor sends (recipient + content previewed; never on refresh)", dependsOn: ["W2", "W4"] },
  { wave: "W7", titleEn: "Delete / bulk / destructive / high-impact / maintenance (exact targets + counts, C3, dependents, immediate stale check)", dependsOn: ["W2", "W3", "W4", "W5"] },
  { wave: "W8", titleEn: "Compound business workflows (one preview → typed primitives in dependency order; partial failure truthful)", dependsOn: ["W2", "W3", "W4", "W5", "W6"] },
];

/** Reviewed per-operation classifications that the generic derivation cannot know. */
const OVERRIDES: Readonly<Record<string, Partial<CoverageRow>>> = {
  "PROJECT.SUNNY_DEADLINE": { klass: "EXECUTABLE", targetWave: "LIVE", ownerEquivalent: "UPDATE_PROJECT_DEADLINE", requiredWork: null },
  RECORD_PAID_EXPENSE: { klass: "NEEDS_HARDENING", targetWave: "W3", requiredWork: "wire the existing validated finance RPC into the universal pipeline as a C2 typed primitive (amount + currency repeated in the approval); the dashboard path stays" },
  "VICTOR.RECORD_SALARY_EXPENSE": { klass: "NEEDS_HARDENING", targetWave: "W3", requiredWork: "same finance primitive as RECORD_PAID_EXPENSE for the salary month (paid only when the finance row is שולם)" },
  "SHOW.REHEARSAL": { klass: "NEEDS_HARDENING", targetWave: "W3", requiredWork: "typed rehearsal primitive preserving TODAY's semantics (D6 vocabulary unchanged; computeShowSplit / rehearsalCountedAmount reused)" },
  "SHOW.RECORD_SHOW_ADVANCE": { klass: "BLOCKED_BY_MISSING_CAPABILITY", targetWave: "W3", ownerEquivalent: "SHOW.EDIT_SHOW (payment status מקדמה, current semantics)", requiredWork: "Boss decision D5 on how a show advance is modelled; until then the current payment-status edit is the path" },
  "RF.MARK_PRODUCTION_APPROVED": { klass: "BLOCKED_BY_MISSING_CAPABILITY", targetWave: "W2", ownerEquivalent: "RF.EDIT_PRODUCTION (status מאושר, current semantics)", requiredWork: "Boss decision D7 on the canonical 'production approved' event; until then the status edit is the path" },
  "SHOW.SET_SHOW_CURRENCY": { klass: "BLOCKED_BY_MISSING_CAPABILITY", targetWave: "W3", requiredWork: "Redbloods has no currency on shows: product decision + approved schema change (shows are ₪ by convention today)" },
  "RF.SET_PAYMENT_CURRENCY": { klass: "BLOCKED_BY_MISSING_CAPABILITY", targetWave: "W3", requiredWork: "Redbloods has no currency on Red Films money: product decision + approved schema change" },
  "PROJECT.HIDE": { requiredWork: "typed primitive over updateProject(is_hidden) (legacy drawer semantics kept)" },
  "CLIENT.MARK_PROPOSAL_LOST": { ownerEquivalent: "CLIENT.UPDATE_PROPOSAL (status לא נסגר)", requiredWork: "covered by the hardened proposal-status primitive (W2)" , targetWave: "W2" },
  "PROJECT.BACKFILL_START_DATES": { targetWave: "W7", requiredWork: "bulk primitive: exact list of projects + proposed start dates previewed, C3 count confirmation" },
  "CLIENT.BACKFILL_CLIENTS_FROM_PROJECTS": { targetWave: "W7", requiredWork: "bulk primitive: exact list of clients to create previewed, C3 count confirmation" },
  "FILES.BACKFILL_PROJECT_FOLDERS": { targetWave: "W7", requiredWork: "bulk primitive: exact projects + folder ids previewed (never raw paths), C3" },
  "SOCIAL.MIGRATE_PATHS": { klass: "INTENTIONALLY_SECURITY_EXCLUDED", exclusionKind: "SYSTEM_MACHINERY_NOT_AN_OWNER_OPERATION", requiredWork: null, targetWave: "NONE", ownerEquivalent: "none needed — a one-off engineering data migration behind its own migration secret (no Owner screen); re-running it is an approved engineering mission, never a business action" },
  "LABEL.AVAILABILITY_SUBMIT": { klass: "NEEDS_HARDENING", exclusionKind: null, targetWave: "W2", requiredWork: "typed Owner-side availability primitive (the Owner can already submit for an artist)" },
  "LABEL.DJ_CONFIRM": { klass: "INTENTIONALLY_SECURITY_EXCLUDED", exclusionKind: "IDENTITY_BOUND_OTHER_USER", ownerEquivalent: null, requiredWork: null, targetWave: "NONE" },
  "SHOW.DJ_CONFIRM": { klass: "INTENTIONALLY_SECURITY_EXCLUDED", exclusionKind: "IDENTITY_BOUND_OTHER_USER", ownerEquivalent: null, requiredWork: null, targetWave: "NONE" },
  "VICTOR.AVATAR": { klass: "INTENTIONALLY_SECURITY_EXCLUDED", exclusionKind: "IDENTITY_BOUND_OTHER_USER", ownerEquivalent: null, requiredWork: null, targetWave: "NONE" },
  "LABEL.ARTIST_SKETCH_SELF_EDIT": { klass: "INTENTIONALLY_SECURITY_EXCLUDED", exclusionKind: "IDENTITY_BOUND_OTHER_USER", ownerEquivalent: "LABEL.SKETCH_EDIT / LABEL.SKETCH_DELETE", requiredWork: null, targetWave: "NONE" },
  "CALENDAR.CONNECT": { klass: "INTENTIONALLY_SECURITY_EXCLUDED", exclusionKind: "SECRET_OR_CREDENTIAL_FLOW", requiredWork: null, targetWave: "NONE", ownerEquivalent: "Sunny reports connection state + 'reconnect needed' (never handles the OAuth credential)" },
  "SUNNY.CONNECTOR_OAUTH": { klass: "INTENTIONALLY_SECURITY_EXCLUDED", exclusionKind: "SECRET_OR_CREDENTIAL_FLOW", requiredWork: null, targetWave: "NONE" },
  "NOTIFY.PUSH_SUBSCRIBE": { klass: "INTENTIONALLY_SECURITY_EXCLUDED", exclusionKind: "SECRET_OR_CREDENTIAL_FLOW", requiredWork: null, targetWave: "NONE" },
  "LABEL.PORTAL_PUSH_SUBSCRIBE": { klass: "INTENTIONALLY_SECURITY_EXCLUDED", exclusionKind: "SECRET_OR_CREDENTIAL_FLOW", requiredWork: null, targetWave: "NONE" },
  "NOTIFY.PUSH_CHECK": { klass: "INTENTIONALLY_SECURITY_EXCLUDED", exclusionKind: "SECRET_OR_CREDENTIAL_FLOW", requiredWork: null, targetWave: "NONE", ownerEquivalent: "device re-subscribe / test push stays a device action; business pushes are W6 primitives" },
  "CALENDAR.DISCONNECT": { klass: "NEEDS_HARDENING", exclusionKind: null, targetWave: "W7", requiredWork: "typed high-impact primitive (revoke the integration; the token is never exposed); C3 with the list of what stops working" },
  "FILES.DISCONNECT_DROPBOX": { klass: "NEEDS_HARDENING", exclusionKind: null, targetWave: "W7", requiredWork: "typed high-impact primitive (revoke the integration; the token is never exposed); C3 with the list of what stops working" },
  "SYSTEM.MAINTENANCE": { klass: "NEEDS_HARDENING", exclusionKind: null, targetWave: "W7", requiredWork: "typed high-impact primitive for the maintenance lock (who is locked out previewed), C3" },
  "REPORTS.SEND": { klass: "NEEDS_HARDENING", exclusionKind: null, targetWave: "W6", requiredWork: "Owner-triggered typed 'send report now' (the setup page already offers it); recipients + content previewed; the schedule stays automatic" },
  "CALENDAR.SYNC_COMPLETED_TASKS": { klass: "NEEDS_HARDENING", exclusionKind: null, targetWave: "W4", requiredWork: "Owner-triggered typed 'sync Google Tasks now' (same writer as the Tasks page)" },
  "AGENT.RUN_CHECK": { klass: "INTENTIONALLY_SECURITY_EXCLUDED", exclusionKind: "SYSTEM_MACHINERY_NOT_AN_OWNER_OPERATION", requiredWork: null, targetWave: "NONE", ownerEquivalent: "none needed (cron-secret job; alert rules are off)" },
  "AGENT.CREATE_ALERT": { klass: "INTENTIONALLY_SECURITY_EXCLUDED", exclusionKind: "SYSTEM_MACHINERY_NOT_AN_OWNER_OPERATION", requiredWork: null, targetWave: "NONE", ownerEquivalent: "none (the rule engine writes alerts; rules are off)" },
  "PROJECT.AUTO_MARK_HELD": { klass: "INTENTIONALLY_SECURITY_EXCLUDED", exclusionKind: "SYSTEM_MACHINERY_NOT_AN_OWNER_OPERATION", requiredWork: null, targetWave: "NONE", ownerEquivalent: "PROJECT.EDIT_SESSION (mark a session held / not held)" },
  "PROJECT.CALENDAR_PULL": { klass: "INTENTIONALLY_SECURITY_EXCLUDED", exclusionKind: "SYSTEM_MACHINERY_NOT_AN_OWNER_OPERATION", requiredWork: null, targetWave: "NONE", ownerEquivalent: "PROJECT.EDIT_SESSION (session time)" },
  "PROJECT.STEVEN_COMPLETION": { klass: "INTENTIONALLY_SECURITY_EXCLUDED", exclusionKind: "SYSTEM_MACHINERY_NOT_AN_OWNER_OPERATION", requiredWork: null, targetWave: "NONE", ownerEquivalent: "MIX.MARK_COMPLETED / PROJECT.CHANGE_STATUS" },
  "CLIENT.AUTO_CREATE_CLIENT": { klass: "INTENTIONALLY_SECURITY_EXCLUDED", exclusionKind: "SYSTEM_MACHINERY_NOT_AN_OWNER_OPERATION", requiredWork: null, targetWave: "NONE", ownerEquivalent: "CLIENT.CREATE_CLIENT" },
  "NOTIFY.LIST_WRITES": { klass: "INTENTIONALLY_SECURITY_EXCLUDED", exclusionKind: "SYSTEM_MACHINERY_NOT_AN_OWNER_OPERATION", requiredWork: null, targetWave: "NONE", ownerEquivalent: "MARK_NOTIFICATIONS_READ" },
  "LABEL.PORTAL_PING": { klass: "INTENTIONALLY_SECURITY_EXCLUDED", exclusionKind: "IDENTITY_BOUND_OTHER_USER", requiredWork: null, targetWave: "NONE" },
  "PEOPLE.PORTAL_PING": { klass: "INTENTIONALLY_SECURITY_EXCLUDED", exclusionKind: "IDENTITY_BOUND_OTHER_USER", requiredWork: null, targetWave: "NONE" },
  UPDATE_PREMIX_NOTE: { klass: "NEEDS_HARDENING", targetWave: "W2", requiredWork: "expose pre-mix note keys in the mix read view (addressability), then the typed primitive over updateMixTargetNote" },
  MARK_AGENT_ALERT_HANDLED: { klass: "NEEDS_HARDENING", targetWave: "W2", requiredWork: "expose alert ids in a read view + the typed primitive preserving the kill-switch rule (only the exempt alert type while rules are off; never by type, never bulk)" },
};

const VERIFY: Readonly<Record<EffectKey, string>> = {
  FINANCE: "Finance Brain re-read: paid / received semantics (שולם / התקבל), debt / credit, currency never mixed",
  LEDGER: "artist ledger / cycle re-read (entries + balance per cycle)",
  CALENDAR: "re-read the Google event by the id stored on the record (a read failure is never 'empty')",
  GOOGLE_TASKS: "re-read the Google Task by the stored id + the Redbloods task row",
  FILES: "storage metadata re-read by file id (never a path)",
  PUSH: "notification / push log row + recipient; nothing sent on a failed prerequisite",
  EMAIL: "send record + recipient; nothing sent on a failed prerequisite",
  CASCADE: "re-read every related record named in the preview",
  UNLINK: "re-read both sides of the link",
  DELETION: "target absent + dependents exactly as previewed",
  SETTINGS: "settings key re-read (non-secret families only)",
  EXTERNAL_LINK: "link record re-read (the link itself is never served)",
};
const waveOf = (c: ActionContract): TargetWave => (c.wave === "W0" || c.wave === "W1" ? "W2" : c.wave === "EXCLUDED" || c.wave === "NATIVE" ? "NONE" : (c.wave as TargetWave));

export function coverageOf(c: ActionContract): CoverageRow {
  const effects = [...new Set([...c.effects])];
  const verification = effects.length ? effects.map((e) => VERIFY[e]).join(" + ") : "fresh read of exactly the changed fields";
  const base: CoverageRow = { id: c.id, domain: c.domain, meaningEn: c.meaningEn, klass: "NEEDS_HARDENING", exclusionKind: null, targetWave: waveOf(c), requiredWork: null, ownerEquivalent: null, approval: c.confirmation, verification, effects };
  const d = c.availabilityDetail;
  if (d === "EXECUTABLE") Object.assign(base, { klass: "EXECUTABLE", targetWave: "LIVE" });
  else if (d === "SUNNY_NATIVE") Object.assign(base, { klass: "EXECUTABLE", targetWave: "LIVE", requiredWork: null, ownerEquivalent: "Sunny's own channel" });
  else if (d === "NEEDS_HARDENING") Object.assign(base, { requiredWork: `harden: ${NEEDS_HARDENING[c.id] ?? c.reason} — then a typed primitive over the shared writer` });
  else if (d === "NEEDS_PRIMITIVE") Object.assign(base, { requiredWork: c.wave === "W1" ? c.reason : `typed primitive over the existing shared writer (${c.reason})` });
  else if (d === "LEGACY_NOT_EXPOSED") Object.assign(base, { requiredWork: `typed primitive (legacy surface: ${c.reason})` });
  else if (d === "BLOCKED_BY_DATA_MODEL") Object.assign(base, { klass: "BLOCKED_BY_MISSING_CAPABILITY", requiredWork: c.reason });
  else if (d === "BLOCKED_BY_OWNER_DECISION") Object.assign(base, { klass: "BLOCKED_BY_MISSING_CAPABILITY", requiredWork: c.reason });
  else if (d === "SECURITY_EXCLUDED") Object.assign(base, { klass: "INTENTIONALLY_SECURITY_EXCLUDED", exclusionKind: "SECRET_OR_CREDENTIAL_FLOW", targetWave: "NONE" });
  else if (d === "OTHER_USER_PORTAL_ONLY") Object.assign(base, { klass: "INTENTIONALLY_SECURITY_EXCLUDED", exclusionKind: "IDENTITY_BOUND_OTHER_USER", targetWave: "NONE" });
  else if (d === "SYSTEM_AUTOMATIC") Object.assign(base, { klass: "INTENTIONALLY_SECURITY_EXCLUDED", exclusionKind: "SYSTEM_MACHINERY_NOT_AN_OWNER_OPERATION", targetWave: "NONE" });
  else if (d === "EXECUTABLE_VIA_DASHBOARD_APPROVAL") Object.assign(base, { requiredWork: "wire into the universal pipeline", targetWave: "W3" });
  const o = OVERRIDES[c.id];
  if (o && !PRIMITIVE_IDS.has(c.id)) Object.assign(base, o); // a built primitive's own contract is the truth (no stale override)
  const cov = COVERAGE_MAP[c.id];
  if (cov && cov.by.every((x) => PRIMITIVE_IDS.has(x))) {
    if (cov.full) Object.assign(base, { klass: "EXECUTABLE", targetWave: "LIVE", requiredWork: null, ownerEquivalent: cov.by.join(" + ") });
    else base.ownerEquivalent = `${cov.by.join(" + ")} (live; remaining: ${cov.remaining ?? "see required work"})`;
  }
  if (base.klass === "NEEDS_HARDENING" && base.targetWave === "NONE") base.targetWave = "W2";
  return base;
}

export const COVERAGE_MATRIX: readonly CoverageRow[] = ACTION_CONTRACTS.map(coverageOf);

/** Compound workflows (W8): available once every member primitive is executable. */
export const WORKFLOW_COVERAGE = Object.entries(WORKFLOW_EVENT_MAP).map(([event, m]) => {
  const members = m.kind === "ACTIONS" ? m.actions : [];
  const rows = members.map((id) => COVERAGE_MATRIX.find((r) => r.id === id)!);
  const waves = rows.map((r) => r.targetWave);
  const order: TargetWave[] = ["LIVE", "W2", "W3", "W4", "W5", "W6", "W7", "W8"];
  const ready = rows.every((r) => r.klass === "EXECUTABLE");
  return { event, members, ready, availableAfter: ready ? "LIVE" : order[Math.max(...waves.map((w) => order.indexOf(w)), order.indexOf("W8"))] };
});

export function coverageSummary() {
  const by = <K extends string>(f: (r: CoverageRow) => K) => COVERAGE_MATRIX.reduce<Record<string, number>>((m, r) => { const k = f(r); m[k] = (m[k] ?? 0) + 1; return m; }, {});
  return { total: COVERAGE_MATRIX.length, byClass: by((r) => r.klass), byWave: by((r) => r.targetWave), byExclusion: by((r) => r.exclusionKind ?? "—") };
}
