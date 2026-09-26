/**
 * SUNNY UNIVERSAL ACTION LAYER — the ONE Universal Action Registry (Wave 0, pure).
 *
 * Built from the seven curated domain inventories (projects, clients, label, mix, Red Films, shows, Victor) plus the
 * supplementary contracts below for every write route no domain inventory owns, plus the narrow Wave 1 candidates.
 * Every write handler in app/api maps to a contract or to an explicit exclusion (guard G1, proven against the pinned
 * handler map). Nothing here executes: an action runs only through the engine, only with the Boss's approval, and only
 * when its availability is SUNNY_EXECUTABLE / EXECUTABLE with a registered executor (Wave 0 registers none).
 */
import { PROJECT_ACTIONS } from "@/lib/partner/system/project-actions";
import { CLIENT_ACTIONS } from "@/lib/partner/system/clients";
import { LABEL_ACTIONS } from "@/lib/partner/system/label-artists";
import { MIX_ACTIONS } from "@/lib/partner/system/mix";
import { RF_ACTIONS } from "@/lib/partner/system/red-films";
import { SHOW_ACTIONS } from "@/lib/partner/system/shows";
import { VICTOR_ACTIONS } from "@/lib/partner/system/victor";
import { HANDLER_MAP } from "./handler-map.generated";
import type { ActionContract, ArgSpec, Availability, AvailabilityDetail, ConfirmationClass, EffectKey, Phase, RiskClass, Wave } from "./types";
import { EFFECT_KEYS, RISK_ORDER } from "./types";
import { LABEL_ARTIST_STATUSES, PROJECT_TYPES, RELEASE_STAGES, VICTOR_OUTCOMES, VICTOR_WORK_STATES } from "@/lib/types";
const PROJECT_TYPE_VALUES: readonly string[] = PROJECT_TYPES;
const RELEASE_STAGE_VALUES: readonly string[] = RELEASE_STAGES;
const LABEL_ARTIST_STATUS_VALUES: readonly string[] = LABEL_ARTIST_STATUSES;
const VICTOR_WORK_STATE_VALUES: readonly string[] = VICTOR_WORK_STATES;
const VICTOR_OUTCOME_VALUES: readonly string[] = VICTOR_OUTCOMES;

export const ACTION_REGISTRY_VERSION = "2026.09.27-w1";

/** The loose union of every domain inventory entry (each inventory is a subset of these fields). */
interface InvEntry {
  id: string; action: string; who: string; enforcement: string; approvalClass: string | null; sunnyToday: string; futurePrimitive: string | null;
  internal: { routes: readonly string[] };
  finance?: string | null; ledger?: string | null; calendar?: string | null; push?: string | null; files?: string | null; project?: string | null;
  destructive?: boolean; external?: boolean; financial?: boolean; reversible?: "YES" | "PARTIAL" | "NO"; sideEffects?: string; writes?: string;
}
const INVENTORIES: ReadonlyArray<{ domain: string; entries: readonly InvEntry[]; source: string }> = [
  { domain: "PROJECT", entries: PROJECT_ACTIONS as readonly InvEntry[], source: "PROJECT_ACTIONS" },
  { domain: "CLIENT", entries: CLIENT_ACTIONS as readonly InvEntry[], source: "CLIENT_ACTIONS" },
  { domain: "LABEL", entries: LABEL_ACTIONS as readonly InvEntry[], source: "LABEL_ACTIONS" },
  { domain: "MIX", entries: MIX_ACTIONS as readonly InvEntry[], source: "MIX_ACTIONS" },
  { domain: "RF", entries: RF_ACTIONS as readonly InvEntry[], source: "RF_ACTIONS" },
  { domain: "SHOW", entries: SHOW_ACTIONS as readonly InvEntry[], source: "SHOW_ACTIONS" },
  { domain: "VICTOR", entries: VICTOR_ACTIONS as readonly InvEntry[], source: "VICTOR_ACTIONS" },
];

// ── classification inputs (discovered 2026-09-26/27; NOT fixed here — Wave 0 classifies, a hardening mission fixes) ──
/** Known unsafe / non-atomic behaviour: the action must be hardened before Sunny may execute it. */
export const NEEDS_HARDENING: Readonly<Record<string, string>> = {
  "PROJECT.EDIT_SESSION": "a date-only edit leaves the calendar event on the old date",
  "PROJECT.EDIT_MEETING": "meeting edits / deletes never touch the calendar event (orphaned event)",
  "CLIENT.MEETING_HELD_OR_CANCELLED": "meeting edits / deletes never touch the calendar event (orphaned event)",
  "PROJECT.CONVERT_PROPOSAL": "not transactional; a double click can create two projects (race)",
  "CLIENT.CONVERT_PROPOSAL": "not transactional; a double click can create two projects (race)",
  "PROJECT.PROMOTE_CLIP_ITEM": "not atomic: the expense is created, then the row is deleted (race / duplicate expense)",
  "RF.PROMOTE_CLIP_ROW": "not atomic: the expense is created, then the row is deleted (race / duplicate expense)",
  "LABEL.SHOW_LIFECYCLE": "show → ledger sync can write a duplicate ledger row",
  "SHOW.CLOSE_SHOW": "show → ledger sync can write a duplicate ledger row",
  "SHOW.EDIT_SHOW": "show → ledger sync can write a duplicate ledger row; client payment has no validation",
  "RF.CANCEL_PRODUCTION": "the cancel side effects (task / calendar cleanup) run before the save succeeds",
  "CLIENT.UPDATE_CLIENT": "full-replacement PATCH: an omitted field is blanked (empty type becomes אחר)",
  "CLIENT.UPDATE_PROPOSAL": "no enum / amount validation on the route",
  "PROJECT.DELIVERY": "whole-body write of the delivery record",
  "PROJECT.ALBUM_SETTINGS": "whole-body write of the album finance / previous-system settings",
  "PROJECT.SOCIAL": "whole-body writes of campaigns / content",
  "RF.REFERENCES": "reference links are written as a whole body",
  "PROJECT.DELETE_PROJECT": "not transactional; a failure mid-way leaves partial data",
  "PROJECT.EDIT_TRANSACTION": "can move a transaction to another project; finance links can dangle",
  "PROJECT.DELETE_ENGINEER_WORK": "the engineer expense is left behind (dangling finance link)",
  "PROJECT.LINK_PROPOSAL": "the linked project id is not checked",
  "PROJECT.DELETE_PROJECT_FILE": "the path is never checked against the project",
  "PROJECT.SEND_LOG_DELETE": "the cascade into engineer / Victor work runs in the browser, not the server",
  "PROJECT.EDIT_VICTOR_WORK": "a Victor save can fail silently (no error surfaced)",
};
/** Legacy surfaces the Boss no longer uses — kept knowable, never offered. */
const LEGACY: Readonly<Record<string, string>> = {
  "PROJECT.HIDE": "legacy drawer only",
  "CLIENT.MARK_PROPOSAL_LOST": "legacy dashboard only (the proposal status edit covers it)",
  "PROJECT.BACKFILL_START_DATES": "one-off backfill with no screen",
  "CLIENT.BACKFILL_CLIENTS_FROM_PROJECTS": "one-off backfill with no screen (a GET that writes)",
};
/** Blocked until the Boss decides (D5 show advance / D6 rehearsal vocabulary / D7 production approved). */
const OWNER_DECISION: Readonly<Record<string, string>> = {
  "SHOW.REHEARSAL": "D6 — the rehearsal vocabulary / money rule awaits the Boss's decision",
};

// ── derivation ───────────────────────────────────────────────────────────────────────────────────────────────────────
const has = (s: string | null | undefined) => !!s && s !== "—" && s.trim() !== "";
function inventoryEffects(e: InvEntry): EffectKey[] {
  const out = new Set<EffectKey>();
  if (has(e.finance) || e.financial) out.add("FINANCE");
  if (has(e.ledger)) out.add("LEDGER");
  if (has(e.calendar)) out.add(/task/i.test(e.calendar ?? "") && !/event|invite/i.test(e.calendar ?? "") ? "GOOGLE_TASKS" : "CALENDAR");
  if (has(e.push)) out.add("PUSH");
  if (has(e.files)) out.add("FILES");
  if (e.destructive || e.approvalClass === "DESTRUCTIVE") out.add("DELETION");
  if (has(e.project) || /cascade|rewrites every/i.test(`${e.sideEffects ?? ""} ${e.action}`)) out.add("CASCADE");
  if (/unlink|dangl|left behind|orphan/i.test(`${e.sideEffects ?? ""} ${e.action}`)) out.add("UNLINK");
  if (/share link|public link|press-kit link|folder \+ public link/i.test(`${e.sideEffects ?? ""} ${e.action}`)) out.add("EXTERNAL_LINK");
  return EFFECT_KEYS.filter((k) => out.has(k));
}
const scanEffects = (routes: readonly string[]): EffectKey[] => {
  const s = new Set<string>(); for (const r of routes) for (const e of HANDLER_MAP[r.split("#")[0]]?.effects ?? []) s.add(e);
  return EFFECT_KEYS.filter((k) => s.has(k));
};
export function riskOf(effects: readonly EffectKey[], o: { approvalClass?: string | null; reversible?: string; security?: boolean }): RiskClass {
  const r: RiskClass[] = [o.reversible === "YES" && !effects.length ? "SAFE_REVERSIBLE" : "NORMAL_BUSINESS"];
  if (effects.some((e) => e === "CALENDAR" || e === "GOOGLE_TASKS" || e === "EXTERNAL_LINK")) r.push("EXTERNAL_SYSTEM_WRITE");
  if (effects.includes("FILES")) r.push("FILE_MUTATION");
  if (effects.includes("FINANCE") || effects.includes("LEDGER") || o.approvalClass === "FINANCIAL") r.push("FINANCIAL");
  if (effects.includes("PUSH") || effects.includes("EMAIL")) r.push("EXTERNAL_COMMUNICATION");
  if (effects.includes("DELETION") || o.approvalClass === "DESTRUCTIVE") r.push("DESTRUCTIVE");
  if (o.approvalClass === "BULK") r.push("BULK");
  if (o.security || o.approvalClass === "ACCESS") r.push("SECURITY_SENSITIVE");
  return r.reduce((m, x) => (RISK_ORDER.indexOf(x) > RISK_ORDER.indexOf(m) ? x : m));
}
export function confirmationOf(r: RiskClass): ConfirmationClass {
  if (r === "SECURITY_SENSITIVE") return "NOT_DELEGATED";
  if (r === "DESTRUCTIVE" || r === "BULK" || r === "EXTERNAL_COMMUNICATION") return "C3_STRONG_APPROVAL";
  if (r === "FINANCIAL" || r === "EXTERNAL_SYSTEM_WRITE" || r === "FILE_MUTATION") return "C2_APPROVAL_WITH_VALUES";
  return "C1_APPROVAL";
}
export const phaseOf = (effects: readonly EffectKey[]): Phase =>
  effects.some((e) => e === "PUSH" || e === "EMAIL") ? "COMMUNICATION" : effects.some((e) => e === "CALENDAR" || e === "GOOGLE_TASKS" || e === "FILES" || e === "EXTERNAL_LINK") ? "EXTERNAL" : "INTERNAL";
export function waveOfRisk(r: RiskClass): Wave {
  switch (r) {
    case "SAFE_REVERSIBLE": case "NORMAL_BUSINESS": return "W2";
    case "FINANCIAL": return "W3";
    case "EXTERNAL_SYSTEM_WRITE": return "W4";
    case "FILE_MUTATION": return "W5";
    case "EXTERNAL_COMMUNICATION": return "W6";
    case "DESTRUCTIVE": case "BULK": return "W7";
    default: return "EXCLUDED";
  }
}
const AVAIL: Record<AvailabilityDetail, Availability> = {
  EXECUTABLE_VIA_DASHBOARD_APPROVAL: "SUNNY_EXECUTABLE", EXECUTABLE: "SUNNY_EXECUTABLE",
  NEEDS_HARDENING: "SUNNY_NEEDS_HARDENING",
  NEEDS_PRIMITIVE: "SUNNY_BLOCKED", BLOCKED_BY_DATA_MODEL: "SUNNY_BLOCKED", BLOCKED_BY_OWNER_DECISION: "SUNNY_BLOCKED", LEGACY_NOT_EXPOSED: "SUNNY_BLOCKED",
  SECURITY_EXCLUDED: "SUNNY_INTENTIONALLY_EXCLUDED", OTHER_USER_PORTAL_ONLY: "SUNNY_INTENTIONALLY_EXCLUDED", SYSTEM_AUTOMATIC: "SUNNY_INTENTIONALLY_EXCLUDED",
  SUNNY_NATIVE: "SUNNY_EXECUTABLE",
};
export const availabilityOf = (d: AvailabilityDetail): Availability => AVAIL[d];
const isCreate = (id: string) => /^(CREATE|ADD|NEW|UPLOAD|RECORD|SEND|OPEN|SCHEDULE|ASSIGN|LOG|SPLIT|PROMOTE|CONVERT)/.test(id.split(".").pop() ?? "");

function fromInventory(domain: string, source: string, e: InvEntry): ActionContract {
  const id = `${domain}.${e.id}`;
  const effects = inventoryEffects(e);
  const possibleEffects = scanEffects(e.internal.routes).filter((x) => !effects.includes(x));
  const otherUser = /^(VICTOR|STEVEN|ARTIST|DJ)$/.test(e.who);
  const system = e.who === "SYSTEM" || e.who === "CRON" || e.enforcement === "AUTOMATIC" || e.enforcement === "CRON_ONLY";
  const security = e.approvalClass === "ACCESS";
  const detail: AvailabilityDetail =
    e.sunnyToday === "EXECUTE_AFTER_DASHBOARD_APPROVAL" ? "EXECUTABLE_VIA_DASHBOARD_APPROVAL"
    : security ? "SECURITY_EXCLUDED"
    : system ? "SYSTEM_AUTOMATIC"
    : otherUser ? "OTHER_USER_PORTAL_ONLY"
    : e.enforcement === "NO_ROUTE" ? "NEEDS_PRIMITIVE"
    : OWNER_DECISION[id] ? "BLOCKED_BY_OWNER_DECISION"
    : LEGACY[id] ? "LEGACY_NOT_EXPOSED"
    : NEEDS_HARDENING[id] ? "NEEDS_HARDENING"
    : "NEEDS_PRIMITIVE";
  const riskClass = riskOf(effects, { approvalClass: e.approvalClass, reversible: e.reversible ?? (e.destructive ? "NO" : "PARTIAL"), security });
  const availability = availabilityOf(detail);
  const reason = detail === "EXECUTABLE_VIA_DASHBOARD_APPROVAL" ? "a validated Partner primitive: Sunny proposes, the Boss approves and executes it in the dashboard"
    : detail === "SECURITY_EXCLUDED" ? "access / roles / credentials stay with the Boss"
    : detail === "SYSTEM_AUTOMATIC" ? "runs automatically inside Redbloods (not a decision anyone makes)"
    : detail === "OTHER_USER_PORTAL_ONLY" ? `performed by ${e.who.toLowerCase()} in their own portal — never on their behalf`
    : detail === "BLOCKED_BY_OWNER_DECISION" ? OWNER_DECISION[id]
    : detail === "LEGACY_NOT_EXPOSED" ? LEGACY[id]
    : detail === "NEEDS_HARDENING" ? NEEDS_HARDENING[id]
    : e.enforcement === "NO_ROUTE" ? "Redbloods has no route for it yet" : `needs the typed primitive ${e.futurePrimitive && e.futurePrimitive !== "—" ? e.futurePrimitive : "(to be named)"}`;
  return {
    id, version: 1, domain, meaningHe: null, meaningEn: e.action, businessEvents: [], args: [], preconditions: [],
    riskClass, confirmation: confirmationOf(riskClass), effects, possibleEffects, phase: phaseOf(effects),
    reversible: e.reversible ?? (e.destructive ? "NO" : "PARTIAL"),
    compensation: e.reversible === "YES" ? "re-apply the previous value shown in the preview (as a new approved plan)" : null,
    idempotency: isCreate(id) ? "EXECUTION_KEY_PLUS_NATURAL_DUPLICATE_WARNING" : "EXECUTION_KEY",
    availability, availabilityDetail: detail, reason,
    wave: detail === "EXECUTABLE_VIA_DASHBOARD_APPROVAL" ? "W0" : availability === "SUNNY_INTENTIONALLY_EXCLUDED" ? "EXCLUDED" : waveOfRisk(riskClass),
    disclosuresHe: NEEDS_HARDENING[id] ? [NEEDS_HARDENING_HE[id] ?? "יש התנהגות לא בטוחה שתתוקן לפני ביצוע"] : [],
    internal: { routes: e.internal.routes, source: `${source}:${e.id}`, writer: null, verifier: null },
  };
}
const NEEDS_HARDENING_HE: Readonly<Record<string, string>> = {
  "PROJECT.EDIT_SESSION": "שינוי תאריך בלבד לא מזיז את האירוע ביומן",
  "PROJECT.EDIT_MEETING": "עריכת / מחיקת פגישה לא מעדכנת את היומן",
  "CLIENT.MEETING_HELD_OR_CANCELLED": "עריכת / מחיקת פגישה לא מעדכנת את היומן",
};

// ── supplementary contracts: every write route no domain inventory owns ─────────────────────────────────────────────
type Supp = { id: string; domain: string; en: string; routes: readonly string[]; detail: AvailabilityDetail; reason: string; effects?: readonly EffectKey[]; approvalClass?: string; reversible?: "YES" | "PARTIAL" | "NO"; security?: boolean };
const SUPPLEMENTARY: readonly Supp[] = [
  // agent alerts / goals (context only; the Boss's own tools)
  { id: "AGENT.MARK_ALERT_HANDLED", domain: "AGENT", en: "Mark an agent alert handled / dismissed", routes: ["app/api/agent/alerts/[id]/route.ts"], detail: "NEEDS_PRIMITIVE", reason: "Wave 1 candidate MARK_AGENT_ALERT_HANDLED", reversible: "YES" },
  { id: "AGENT.CREATE_ALERT", domain: "AGENT", en: "Create an agent alert (rule engine; rules are off)", routes: ["app/api/agent/alerts/route.ts"], detail: "SYSTEM_AUTOMATIC", reason: "written by the alert engine, never by a person (rules are disabled)" },
  { id: "AGENT.RUN_CHECK", domain: "AGENT", en: "Run the agent check (GET that writes alerts / settings)", routes: ["app/api/agent/check/route.ts"], detail: "SYSTEM_AUTOMATIC", reason: "background check; context only" },
  { id: "AGENT.UPDATE_GOALS", domain: "AGENT", en: "Edit the Boss's agent goals", routes: ["app/api/agent/goals/route.ts"], detail: "NEEDS_PRIMITIVE", reason: "needs a typed primitive (Owner goals are settings)", effects: ["SETTINGS"] },
  // calendar / Google Tasks
  { id: "CALENDAR.CONNECT", domain: "CALENDAR", en: "Connect Google Calendar (OAuth callback stores the token)", routes: ["app/api/calendar/callback/route.ts"], detail: "SECURITY_EXCLUDED", reason: "credentials — never Sunny", security: true },
  { id: "CALENDAR.DISCONNECT", domain: "CALENDAR", en: "Disconnect Google Calendar (revoke token)", routes: ["app/api/calendar/status/route.ts"], detail: "SECURITY_EXCLUDED", reason: "credentials — never Sunny", security: true },
  { id: "CALENDAR.CHECK_SLOT", domain: "CALENDAR", en: "Check a manual slot against the calendar (read via POST)", routes: ["app/api/calendar/check-slot/route.ts"], detail: "SUNNY_NATIVE", reason: "a read: Sunny already reads the live calendar (calendar capability)" },
  { id: "CALENDAR.CREATE_EVENT", domain: "CALENDAR", en: "Create a calendar event", routes: ["app/api/calendar/create-event/route.ts"], detail: "NEEDS_PRIMITIVE", reason: "needs a typed calendar primitive storing the event id on its record", effects: ["CALENDAR"] },
  { id: "CALENDAR.UPDATE_OR_DELETE_EVENT", domain: "CALENDAR", en: "Move / edit / delete a calendar event", routes: ["app/api/calendar/events/[id]/route.ts"], detail: "NEEDS_PRIMITIVE", reason: "needs a typed calendar primitive (Wave 4)", effects: ["CALENDAR", "DELETION"] },
  { id: "CALENDAR.CREATE_GOOGLE_TASK", domain: "CALENDAR", en: "Create a Google Task", routes: ["app/api/calendar/create-task/route.ts"], detail: "NEEDS_PRIMITIVE", reason: "needs a typed primitive", effects: ["GOOGLE_TASKS"] },
  { id: "CALENDAR.DELETE_GOOGLE_TASK", domain: "CALENDAR", en: "Delete a Google Task", routes: ["app/api/calendar/tasks/[id]/route.ts"], detail: "NEEDS_PRIMITIVE", reason: "needs a typed primitive", effects: ["GOOGLE_TASKS", "DELETION"] },
  { id: "CALENDAR.SYNC_COMPLETED_TASKS", domain: "CALENDAR", en: "Sync completed Google Tasks back into Redbloods", routes: ["app/api/calendar/tasks/sync/route.ts"], detail: "SYSTEM_AUTOMATIC", reason: "page-load / background sync" },
  // Dropbox
  { id: "FILES.FOLDER_LINK", domain: "FILES", en: "Create / return a folder share link", routes: ["app/api/dropbox/folder-link/route.ts"], detail: "NEEDS_PRIMITIVE", reason: "public links are a Wave 5 file primitive", effects: ["EXTERNAL_LINK"] },
  { id: "FILES.DISCONNECT_DROPBOX", domain: "FILES", en: "Disconnect Dropbox (revoke token)", routes: ["app/api/dropbox/status/route.ts"], detail: "SECURITY_EXCLUDED", reason: "credentials — never Sunny", security: true },
  { id: "FILES.BACKFILL_PROJECT_FOLDERS", domain: "FILES", en: "Backfill project Dropbox folder paths (GET that writes)", routes: ["app/api/projects/backfill-dropbox-folder/route.ts"], detail: "LEGACY_NOT_EXPOSED", reason: "one-off backfill with no screen", approvalClass: "BULK" },
  // label artist portal (Owner-side writes on an artist's portal)
  { id: "LABEL.PORTAL_PING", domain: "LABEL", en: "Artist portal presence ping", routes: ["app/api/label/artists/[id]/ping/route.ts", "app/api/red-artists/ping/route.ts", "app/api/red-artists/cleantone/ping/route.ts"], detail: "SYSTEM_AUTOMATIC", reason: "presence heartbeat from the portal" },
  { id: "LABEL.PORTAL_PUSH_SUBSCRIBE", domain: "LABEL", en: "Portal device push subscription", routes: ["app/api/label/artists/[id]/push-subscribe/route.ts", "app/api/red-artists/push-subscribe/route.ts", "app/api/red-artists/cleantone/push-subscribe/route.ts"], detail: "SECURITY_EXCLUDED", reason: "device credentials — never Sunny", security: true },
  { id: "LABEL.PRESS_KIT_LINK", domain: "LABEL", en: "Create the artist press-kit public link", routes: ["app/api/label/artists/[id]/press-kit-link/route.ts", "app/api/red-artists/press-kit-link/route.ts"], detail: "NEEDS_PRIMITIVE", reason: "public link = Wave 5 file primitive", effects: ["EXTERNAL_LINK", "FILES"] },
  { id: "LABEL.PROFILE_IMAGE", domain: "LABEL", en: "Upload an artist profile image", routes: ["app/api/label/artists/[id]/profile-image/route.ts", "app/api/red-artists/profile-image/route.ts", "app/api/red-artists/cleantone/profile-image/route.ts"], detail: "NEEDS_PRIMITIVE", reason: "file upload = Wave 5", effects: ["FILES"] },
  { id: "LABEL.SKETCH_EDIT", domain: "LABEL", en: "Edit a sketch (beat link / duration / rating / title / order / new version)", routes: ["app/api/label/artists/[id]/sketches/[sketchId]/beat/route.ts", "app/api/label/artists/[id]/sketches/[sketchId]/duration/route.ts", "app/api/label/artists/[id]/sketches/[sketchId]/rating/route.ts", "app/api/label/artists/[id]/sketches/[sketchId]/route.ts#PATCH", "app/api/label/artists/[id]/sketches/[sketchId]/version/route.ts", "app/api/label/artists/[id]/sketches/reorder/route.ts"], detail: "NEEDS_PRIMITIVE", reason: "needs typed sketch primitives", effects: ["FILES"] },
  { id: "LABEL.SKETCH_DELETE", domain: "LABEL", en: "Delete a sketch", routes: ["app/api/label/artists/[id]/sketches/[sketchId]/route.ts#DELETE"], detail: "NEEDS_PRIMITIVE", reason: "destructive file primitive (Wave 7)", effects: ["FILES", "DELETION"] },
  { id: "LABEL.ARTIST_SKETCH_SELF_EDIT", domain: "LABEL", en: "The artist edits / versions / reorders / deletes their own sketches", routes: ["app/api/red-artists/sketches/[id]/duration/route.ts", "app/api/red-artists/sketches/[id]/route.ts", "app/api/red-artists/sketches/[id]/version/route.ts", "app/api/red-artists/sketches/reorder/route.ts", "app/api/red-artists/next-work/route.ts"], detail: "OTHER_USER_PORTAL_ONLY", reason: "the artist's own portal action" },
  // maintenance / reports
  { id: "SYSTEM.MAINTENANCE", domain: "SYSTEM", en: "Maintenance mode / system maintenance", routes: ["app/api/maintenance/route.ts"], detail: "SECURITY_EXCLUDED", reason: "system operation — the Boss only", security: true },
  { id: "REPORTS.UPDATE_CONFIG", domain: "REPORTS", en: "Edit report schedule / recipients", routes: ["app/api/reports/config/route.ts"], detail: "NEEDS_PRIMITIVE", reason: "settings primitive; changes who receives email", effects: ["SETTINGS"] },
  { id: "REPORTS.SEND", domain: "REPORTS", en: "Send the morning / evening / weekly report email", routes: ["app/api/reports/morning/route.ts", "app/api/reports/evening/route.ts", "app/api/reports/weekly/route.ts"], detail: "SYSTEM_AUTOMATIC", reason: "scheduled; Sunny's morning brief is produced on request, never emailed", effects: ["EMAIL"] },
  // Sunny connector / OAuth / MCP (security)
  { id: "SUNNY.CONNECTOR_OAUTH", domain: "SUNNY", en: "Connector OAuth authorize / register / token / revoke", routes: ["app/api/mcp-oauth/authorize/route.ts", "app/api/mcp-oauth/register/route.ts", "app/api/mcp-oauth/token/route.ts", "app/api/mcp-oauth/revoke/route.ts"], detail: "SECURITY_EXCLUDED", reason: "credentials — never Sunny", security: true },
  { id: "SUNNY.ACT_RELAY", domain: "SUNNY", en: "The connector → MAIN internal action endpoint (plan / preview / approve / execute / status)", routes: ["app/api/partner/internal/act/route.ts"], detail: "SUNNY_NATIVE", reason: "the Universal Action Layer's own relay: service-secret authenticated, off unless enabled, every write through a registered primitive after the Boss's approval" },
  { id: "SUNNY.MCP_TRANSPORT", domain: "SUNNY", en: "The MCP transport itself", routes: ["app/api/mcp/route.ts"], detail: "SUNNY_NATIVE", reason: "Sunny's own channel (reads, P1 answers, P2 knowledge — each gated)" },
  { id: "SUNNY.ANSWER_FINANCE_QUESTION", domain: "SUNNY", en: "The Boss answers a finance question in the dashboard", routes: ["app/api/partner/finance/answer/route.ts"], detail: "SUNNY_NATIVE", reason: "the Boss's own answer loop (typed, validated)" },
  { id: "SUNNY.ANSWER_INTEGRITY_QUESTION", domain: "SUNNY", en: "The Boss answers an integrity question in the dashboard", routes: ["app/api/partner/integrity/answer/route.ts"], detail: "SUNNY_NATIVE", reason: "the Boss's own answer loop (typed, validated)" },
  // notifications / push
  { id: "NOTIFY.MARK_READ", domain: "NOTIFY", en: "Mark one notification read", routes: ["app/api/notifications/[id]/route.ts"], detail: "NEEDS_PRIMITIVE", reason: "Wave 1 candidate MARK_NOTIFICATIONS_READ", reversible: "YES" },
  { id: "NOTIFY.MARK_ALL_READ", domain: "NOTIFY", en: "Mark all notifications read", routes: ["app/api/notifications/read-all/route.ts"], detail: "NEEDS_PRIMITIVE", reason: "Wave 1 candidate MARK_NOTIFICATIONS_READ", approvalClass: "BULK", reversible: "PARTIAL" },
  { id: "NOTIFY.LIST_WRITES", domain: "NOTIFY", en: "Notifications list (GET that writes housekeeping)", routes: ["app/api/notifications/route.ts"], detail: "SYSTEM_AUTOMATIC", reason: "page-load housekeeping" },
  { id: "NOTIFY.PUSH_CHECK", domain: "NOTIFY", en: "Push check (re-subscribe / test) — never on page load", routes: ["app/api/push/check/route.ts"], detail: "SECURITY_EXCLUDED", reason: "device push credentials; Sunny may never trigger a push", security: true },
  { id: "NOTIFY.PUSH_SUBSCRIBE", domain: "NOTIFY", en: "Owner device push subscription", routes: ["app/api/push/subscribe/route.ts", "app/api/supplier/steven/push-subscribe/route.ts", "app/api/vendor/victor/push-subscribe/route.ts"], detail: "SECURITY_EXCLUDED", reason: "device credentials — never Sunny", security: true },
  { id: "PEOPLE.PORTAL_PING", domain: "PEOPLE", en: "Steven / Victor portal presence ping", routes: ["app/api/supplier/steven/ping/route.ts", "app/api/vendor/victor/ping/route.ts"], detail: "SYSTEM_AUTOMATIC", reason: "presence heartbeat from the portal" },
  { id: "VICTOR.AVATAR", domain: "VICTOR", en: "Victor avatar upload / change", routes: ["app/api/vendor/victor/avatar/route.ts"], detail: "OTHER_USER_PORTAL_ONLY", reason: "Victor's own portal action" },
  // social
  { id: "SOCIAL.DELETE_FILE", domain: "SOCIAL", en: "Delete a social content file", routes: ["app/api/social/files/route.ts"], detail: "NEEDS_PRIMITIVE", reason: "destructive file primitive (Wave 7)", effects: ["FILES", "DELETION"] },
  { id: "SOCIAL.MIGRATE_PATHS", domain: "SOCIAL", en: "One-off migration of social file paths", routes: ["app/api/social/migrate-paths/route.ts"], detail: "LEGACY_NOT_EXPOSED", reason: "one-off migration", approvalClass: "BULK", effects: ["FILES"] },
  { id: "SOCIAL.PROMOTIONS", domain: "SOCIAL", en: "Create / edit / delete a paid promotion (+ its expense)", routes: ["app/api/social/promotions/route.ts", "app/api/social/promotions/[id]/route.ts"], detail: "NEEDS_PRIMITIVE", reason: "financial primitive (Wave 3)", effects: ["FINANCE"] },
  // Wave 0 / D-decisions kept visible as blocked contracts
  { id: "SHOW.RECORD_SHOW_ADVANCE", domain: "SHOW", en: "Record a show advance payment (D5)", routes: [], detail: "BLOCKED_BY_OWNER_DECISION", reason: "D5 — how a show advance is modelled awaits the Boss", effects: ["FINANCE"] },
  { id: "RF.MARK_PRODUCTION_APPROVED", domain: "RF", en: "Mark a Red Films production approved (D7)", routes: [], detail: "BLOCKED_BY_OWNER_DECISION", reason: "D7 — the 'production approved' state awaits the Boss" },
  { id: "SHOW.SET_SHOW_CURRENCY", domain: "SHOW", en: "Record the currency of a show price", routes: [], detail: "BLOCKED_BY_DATA_MODEL", reason: "shows store no currency", effects: ["FINANCE"] },
  { id: "RF.SET_PAYMENT_CURRENCY", domain: "RF", en: "Record the currency of a Red Films payment", routes: [], detail: "BLOCKED_BY_DATA_MODEL", reason: "Red Films money has no currency column", effects: ["FINANCE"] },
];
function fromSupp(s: Supp): ActionContract {
  const effects = EFFECT_KEYS.filter((k) => (s.effects ?? []).includes(k));
  const possibleEffects = scanEffects(s.routes).filter((x) => !effects.includes(x));
  const riskClass = riskOf(effects, { approvalClass: s.approvalClass, reversible: s.reversible ?? "PARTIAL", security: s.security });
  const availability = availabilityOf(s.detail);
  return {
    id: s.id, version: 1, domain: s.domain, meaningHe: null, meaningEn: s.en, businessEvents: [], args: [], preconditions: [],
    riskClass, confirmation: confirmationOf(riskClass), effects, possibleEffects, phase: phaseOf(effects),
    reversible: s.reversible ?? "PARTIAL", compensation: null,
    idempotency: isCreate(s.id) ? "EXECUTION_KEY_PLUS_NATURAL_DUPLICATE_WARNING" : "EXECUTION_KEY",
    availability, availabilityDetail: s.detail, reason: s.reason,
    wave: s.detail === "SUNNY_NATIVE" ? "NATIVE" : availability === "SUNNY_INTENTIONALLY_EXCLUDED" ? "EXCLUDED" : waveOfRisk(riskClass),
    disclosuresHe: [], internal: { routes: s.routes, source: "SUPPLEMENTARY", writer: null, verifier: null },
  };
}

// ── Wave 1: the first real primitives (typed, internal, reversible, shared writers) + the classified rest ─────────────
const T = (name: string, required = true, noteHe?: string): ArgSpec => ({ name, kind: "text", required, ...(noteHe ? { noteHe } : {}) });
const K = (name: string, required = true): ArgSpec => ({ name, kind: "entityKey", required });
const E = (name: string, values: readonly string[], required = true): ArgSpec => ({ name, kind: "enum", required, values });
const MODE = E("mode", ["REPLACE", "APPEND"]);
type W1Status = "READY" | "NEEDS_HARDENING" | "BLOCKED";
type W1 = { id: string; domain: string; he: string; en: string; covers: readonly string[]; args: readonly ArgSpec[]; fields: readonly string[]; status: W1Status; reason: string; writer: string | null; disclosuresHe?: readonly string[] };
export const WAVE1_CANDIDATES: readonly W1[] = [
  { id: "UPDATE_PROJECT_NOTES", domain: "PROJECT", he: "עדכון הערות פרויקט", en: "Update a project's notes (replace or append)", covers: ["PROJECT.EDIT_NOTES"], args: [K("project"), T("notes"), MODE], fields: ["notes"], status: "READY", reason: "shared writer updateProject (the UI's writer); notes only", writer: "updateProject (lib/projects-store)" },
  { id: "UPDATE_PROJECT_PLANNING", domain: "PROJECT", he: "עדכון תכנון פרויקט (תאריך התחלה / שעות / ימים)", en: "Update start date / planned hours / planned days", covers: ["PROJECT.EDIT_START_DATE", "PROJECT.EDIT_PLANNED"], args: [K("project"), { name: "startDate", kind: "ymd", required: false }, { name: "plannedHours", kind: "number", required: false }, { name: "plannedDays", kind: "number", required: false }], fields: ["startDate", "plannedHours", "plannedDays"], status: "READY", reason: "shared writer updateProject; same validation as the route (hours ≥ 0, whole days ≥ 0)", writer: "updateProject (lib/projects-store)" },
  { id: "UPDATE_PROJECT_TYPE_OR_PARENT", domain: "PROJECT", he: "שינוי סוג פרויקט / פרויקט אב", en: "Change project type or parent (name link)", covers: ["PROJECT.EDIT_TYPE", "PROJECT.EDIT_PARENT"], args: [K("project"), E("projectType", PROJECT_TYPE_VALUES, false), T("parentProject", false)], fields: ["projectType", "parentProject"], status: "READY", reason: "shared writer updateProject; type from the app's own list", writer: "updateProject (lib/projects-store)", disclosuresHe: ["פרויקט אב נשמר כשם בלבד (לא קישור)"] },
  { id: "UPDATE_RELEASE_DETAILS", domain: "LABEL", he: "עדכון פרטי ריליס (יעד / צעד הבא / חסם / אחראי)", en: "Update release target / next action / blocker / responsible", covers: ["PROJECT.UPDATE_RELEASE", "LABEL.UPDATE_RELEASE"], args: [K("project"), { name: "releaseTargetDate", kind: "ymd", required: false }, T("nextAction", false), T("blocker", false), T("responsible", false)], fields: ["releaseTargetDate", "nextAction", "blocker", "responsible"], status: "READY", reason: "shared writer updateReleaseDetails (optimistic lock)", writer: "updateReleaseDetails (lib/release-store)" },
  { id: "CHANGE_RELEASE_STAGE", domain: "LABEL", he: "שינוי שלב ריליס", en: "Change a release stage", covers: ["PROJECT.UPDATE_RELEASE", "LABEL.UPDATE_RELEASE"], args: [K("project"), E("releaseStage", RELEASE_STAGE_VALUES)], fields: ["releaseStage"], status: "READY", reason: "shared writer updateReleaseDetails (same stage clock / release date rule as the app)", writer: "updateReleaseDetails (lib/release-store)" },
  { id: "RESOLVE_MIX_COMMENT", domain: "MIX", he: "סימון הערת מיקס כטופלה", en: "Resolve a mix comment", covers: ["MIX.RESOLVE_COMMENT"], args: [K("mixComment", false), K("mixWork", false), E("which", ["LATEST_OPEN", "LATEST"], false)], fields: ["status"], status: "READY", reason: "shared writer updateMixCommentStatus (status only)", writer: "updateMixCommentStatus (lib/mix-comments-store)" },
  { id: "REOPEN_MIX_COMMENT", domain: "MIX", he: "פתיחה מחדש של הערת מיקס", en: "Reopen a mix comment", covers: ["MIX.RESOLVE_COMMENT"], args: [K("mixComment", false), K("mixWork", false), E("which", ["LATEST_RESOLVED", "LATEST"], false)], fields: ["status"], status: "READY", reason: "shared writer updateMixCommentStatus (status only)", writer: "updateMixCommentStatus (lib/mix-comments-store)" },
  { id: "UPDATE_MIX_VERSION_STATUS_OR_LABEL", domain: "MIX", he: "עדכון סטטוס / תווית גרסת מיקס", en: "Update a mix version's status or label (never the file)", covers: ["MIX.EDIT_OR_DELETE_VERSION"], args: [K("mixVersion", false), K("mixWork", false), E("which", ["LATEST"], false), E("status", ["בבדיקה", "מוכן", "מאושר", "נדחה"], false), T("versionLabel", false)], fields: ["status", "label"], status: "READY", reason: "shared writer updateMixVersion (status / label only)", writer: "updateMixVersion (lib/mix-versions-store)" },
  { id: "UPDATE_LABEL_ARTIST_NOTES_STATUS", domain: "LABEL", he: "עדכון הערות / סטטוס אמן לייבל", en: "Update a label artist's notes / status", covers: ["LABEL.UPDATE_LABEL_ARTIST"], args: [K("labelArtist"), T("notes", false), E("mode", ["REPLACE", "APPEND"], false), E("status", LABEL_ARTIST_STATUS_VALUES, false)], fields: ["notes", "status"], status: "READY", reason: "shared writer updateLabelArtist (notes / status only; name, image untouched)", writer: "updateLabelArtist (lib/label-artists-store)" },
  { id: "UPDATE_VICTOR_WORK_STATE", domain: "VICTOR", he: "עדכון מצב עבודה של ויקטור", en: "Update Victor work state", covers: ["VICTOR.CHANGE_STATUS"], args: [K("victorWork"), E("workState", VICTOR_WORK_STATE_VALUES)], fields: ["workState"], status: "READY", reason: "shared writer updateVictorWork (work state only — no status change, so no completion push and no task sync)", writer: "updateVictorWork (lib/vendor-store)" },
  { id: "UPDATE_VICTOR_OUTCOME", domain: "VICTOR", he: "עדכון תוצאה של עבודת ויקטור", en: "Update Victor work outcome", covers: ["VICTOR.CHANGE_STATUS"], args: [K("victorWork"), E("outcome", VICTOR_OUTCOME_VALUES)], fields: ["outcome"], status: "READY", reason: "shared writer updateVictorWork (outcome only)", writer: "updateVictorWork (lib/vendor-store)" },
  { id: "UPDATE_VICTOR_NOTES", domain: "VICTOR", he: "עדכון הערות עבודת ויקטור (בלי שליחה)", en: "Update Victor work notes (no send)", covers: ["VICTOR.EDIT_BRIEF"], args: [K("victorWork"), T("notes"), MODE], fields: ["notes"], status: "READY", reason: "shared writer updateVictorWork (internal notes only)", writer: "updateVictorWork (lib/vendor-store)" },
  { id: "UPDATE_PROPOSAL_INFO", domain: "CLIENT", he: "עדכון פרטי הצעה", en: "Update proposal info", covers: ["CLIENT.UPDATE_PROPOSAL"], args: [], fields: [], status: "NEEDS_HARDENING", reason: "the proposal route has no field validation and a follow-up date change creates / moves Google Tasks — needs a notes-only shared writer first", writer: null },
  { id: "UPDATE_SEND_LOG_ENTRY", domain: "PROJECT", he: "עדכון רשומת שליחה", en: "Update a send-log entry", covers: ["PROJECT.SEND_LOG_ADD"], args: [], fields: [], status: "NEEDS_HARDENING", reason: "the writer lives inline in the route with no validation, and its status / dates are handoff evidence — needs a shared validated writer first", writer: null },
  { id: "UPDATE_PREMIX_NOTE", domain: "MIX", he: "עדכון הערת פרי-מיקס", en: "Update a pre-mix note", covers: ["MIX.RIDDIM_LINES"], args: [], fields: [], status: "BLOCKED", reason: "a pre-mix note cannot be addressed by Sunny yet (no read view exposes the note keys) — capability gap, not a writer problem", writer: null },
  { id: "UPDATE_VICTOR_VERSION_REVIEW", domain: "VICTOR", he: "טיוטת הערות על גרסה של ויקטור", en: "Save a version review draft", covers: ["VICTOR.SEND_VERSION_NOTES"], args: [], fields: [], status: "NEEDS_HARDENING", reason: "reviews are one JSON column written whole — needs a per-version typed writer first", writer: null },
  { id: "UPDATE_ALBUM_TRACK", domain: "PROJECT", he: "עדכון שיר באלבום", en: "Update an album track", covers: ["PROJECT.ALBUM_TRACKS"], args: [], fields: [], status: "NEEDS_HARDENING", reason: "the writer lives inline in the route with no validation (any status text) — needs a shared validated writer first", writer: null },
  { id: "UPDATE_RED_FILMS_PRODUCTION_DETAILS", domain: "RF", he: "עדכון פרטי הפקת וידאו", en: "Update Red Films production details", covers: ["RF.EDIT_PRODUCTION"], args: [], fields: [], status: "NEEDS_HARDENING", reason: "the production route runs task / calendar side effects before the save — needs a details-only shared writer first", writer: null },
  { id: "UPDATE_CLIP_PLAN_ROW", domain: "RF", he: "עדכון שורת תכנון קליפ", en: "Update a clip planning row", covers: ["RF.CLIP_ROWS", "PROJECT.CLIP_ITEMS"], args: [], fields: [], status: "NEEDS_HARDENING", reason: "the writer lives inline in the route with unvalidated amount / currency — needs a shared validated writer first", writer: null },
  { id: "UPDATE_SOCIAL_CONTENT", domain: "SOCIAL", he: "עדכון תוכן סושיאל", en: "Update one social content item", covers: ["PROJECT.SOCIAL"], args: [], fields: [], status: "NEEDS_HARDENING", reason: "social writes are whole-body — never a Sunny primitive until a field-level writer exists", writer: null },
  { id: "UPDATE_CLIENT_CONTACT", domain: "CLIENT", he: "עדכון פרטי קשר של לקוח", en: "Update client contact fields", covers: ["CLIENT.UPDATE_CLIENT"], args: [], fields: [], status: "NEEDS_HARDENING", reason: "the client PATCH is a full replacement (omitted fields are blanked) — needs a field-level writer first", writer: null },
  { id: "UPDATE_MEETING", domain: "CLIENT", he: "עדכון פגישה", en: "Update a meeting", covers: ["PROJECT.EDIT_MEETING", "CLIENT.MEETING_HELD_OR_CANCELLED"], args: [], fields: [], status: "NEEDS_HARDENING", reason: "meeting edits never sync the calendar event — would create silent calendar divergence", writer: null },
  { id: "MARK_AGENT_ALERT_HANDLED", domain: "AGENT", he: "סימון התראת סוכן כטופלה", en: "Mark an agent alert handled", covers: ["AGENT.MARK_ALERT_HANDLED"], args: [], fields: [], status: "BLOCKED", reason: "alert rules are off (only one exempt alert type is actionable) and Sunny cannot address alert ids — nothing safe to expose yet", writer: null },
  { id: "MARK_NOTIFICATIONS_READ", domain: "NOTIFY", he: "סימון התראה כנקראה", en: "Mark one notification read", covers: ["NOTIFY.MARK_READ"], args: [], fields: [], status: "NEEDS_HARDENING", reason: "the only writer is a session-scoped route (the bell); a recipient-bound shared writer is needed. Mark-all is BULK and never a Sunny primitive", writer: null },
];
function fromW1(w: W1): ActionContract {
  const ready = w.status === "READY";
  const riskClass: RiskClass = ready ? "SAFE_REVERSIBLE" : "NORMAL_BUSINESS";
  return {
    id: w.id, version: 1, domain: w.domain, meaningHe: w.he, meaningEn: w.en, businessEvents: [], args: w.args, fields: w.fields, preconditions: ["the target exists", "the live fields match the previewed fingerprint", "the Boss approved this exact plan"],
    riskClass, confirmation: confirmationOf(riskClass), effects: [], possibleEffects: [], phase: "INTERNAL", reversible: "YES",
    compensation: ready ? "a new approved plan restoring the previous value shown in the preview" : null, idempotency: "EXECUTION_KEY",
    availability: ready ? "SUNNY_EXECUTABLE" : w.status === "NEEDS_HARDENING" ? "SUNNY_NEEDS_HARDENING" : "SUNNY_BLOCKED",
    availabilityDetail: ready ? "EXECUTABLE" : w.status === "NEEDS_HARDENING" ? "NEEDS_HARDENING" : "NEEDS_PRIMITIVE",
    reason: w.reason, wave: "W1", disclosuresHe: w.disclosuresHe ?? [],
    internal: { routes: [], source: `WAVE1:${w.covers.join(",")}`, writer: w.writer, verifier: ready ? "fresh read of the same fields (lib/partner/act/primitives)" : null },
  };
}

// ── the two validated primitives that pre-date the universal layer ──────────────────────────────────────────────────
const LIVE: readonly ActionContract[] = [
  {
    id: "UPDATE_PROJECT_DEADLINE", version: 1, domain: "PROJECT", meaningHe: "שינוי דדליין של פרויקט", meaningEn: "Change a project's deadline", businessEvents: ["DEADLINE_CHANGED"],
    args: [K("project"), { name: "deadline", kind: "ymd", required: true }], fields: ["deadline"], preconditions: ["the project exists", "the deadline differs from the current one", "live snapshot matches the preview"],
    riskClass: "SAFE_REVERSIBLE", confirmation: "C1_APPROVAL", effects: [], possibleEffects: [], phase: "INTERNAL", reversible: "YES", compensation: "a new approved plan restoring the previous deadline",
    idempotency: "EXECUTION_KEY", availability: "SUNNY_EXECUTABLE", availabilityDetail: "EXECUTABLE", reason: "Wave 1: through Claude via the universal pipeline over the UI's own deadline writer (updateProject); the dashboard's older decide / execute path is unchanged", wave: "W1",
    disclosuresHe: ["היומן לא משתנה"], internal: { routes: ["app/api/partner/actions/execute/route.ts"], source: "lib/partner/act/primitives + lib/partner/actions (dashboard path)", writer: "updateProject (lib/projects-store)", verifier: "fresh read of the deadline (lib/partner/act/primitives)" },
  },
  {
    id: "RECORD_PAID_EXPENSE", version: 1, domain: "FINANCE", meaningHe: "רישום הוצאה ששולמה", meaningEn: "Record that a known expense was paid", businessEvents: ["PAYMENT_MADE"],
    args: [K("expense"), { name: "amount", kind: "money", required: true }, { name: "currency", kind: "enum", required: true, values: ["₪", "$"] }, { name: "paidDate", kind: "ymd", required: true }],
    preconditions: ["the salary month is known", "no paid row exists for it", "live snapshot matches the preview"],
    riskClass: "FINANCIAL", confirmation: "C2_APPROVAL_WITH_VALUES", effects: ["FINANCE"], possibleEffects: [], phase: "INTERNAL", reversible: "PARTIAL", compensation: null,
    idempotency: "EXECUTION_KEY_PLUS_NATURAL_DUPLICATE_WARNING", availability: "SUNNY_EXECUTABLE", availabilityDetail: "EXECUTABLE_VIA_DASHBOARD_APPROVAL", reason: "validated finance primitive; executable only from the dashboard (no finance execution through Claude — finance gets its own wave)", wave: "W0",
    disclosuresHe: ["מטבעות לא מחוברים לעולם"], internal: { routes: ["app/api/partner/actions/execute/route.ts"], source: "lib/partner/finance", writer: "PARTNER_FINANCE_PAID_EXPENSE_PRIMITIVE (lib/partner/finance)", verifier: "outcome.ts" },
  },
];

// ── explicit exclusions (write routes that are not business actions) ────────────────────────────────────────────────
/** A write route that is intentionally NOT an action, with the reason. G1 accepts a route only via a contract or here. */
export const ROUTE_EXCLUSIONS: Readonly<Record<string, string>> = {};

// ── build ────────────────────────────────────────────────────────────────────────────────────────────────────────────
function build(): ReadonlyMap<string, ActionContract> {
  const m = new Map<string, ActionContract>();
  const add = (c: ActionContract) => { if (m.has(c.id)) throw new Error(`duplicate action id ${c.id}`); m.set(c.id, c); };
  LIVE.forEach(add);
  for (const inv of INVENTORIES) for (const e of inv.entries) add(fromInventory(inv.domain, inv.source, e));
  SUPPLEMENTARY.map(fromSupp).forEach(add);
  WAVE1_CANDIDATES.map(fromW1).forEach(add);
  return m;
}
export const ACTION_REGISTRY: ReadonlyMap<string, ActionContract> = build();
export const ACTION_CONTRACTS: readonly ActionContract[] = [...ACTION_REGISTRY.values()];

/** Routes (with optional #METHOD) → the contracts that own them. */
export function contractsForRoute(route: string, method?: string): ActionContract[] {
  return ACTION_CONTRACTS.filter((c) => c.internal.routes.some((r) => { const [p, mm] = r.split("#"); return p === route && (!mm || !method || mm === method); }));
}
