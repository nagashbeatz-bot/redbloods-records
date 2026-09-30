/**
 * SUNNY UNIVERSAL ACTION LAYER — the ONE Universal Action Registry (Wave 0, pure).
 *
 * Built from the seven curated domain inventories (projects, clients, label, mix, Red Films, shows, Victor) plus the
 * supplementary contracts below for every write route no domain inventory owns, plus the narrow Wave 1 candidates.
 * Every write handler in app/api maps to a contract or to an explicit exclusion (guard G1, proven against the pinned
 * handler map). Nothing here executes: an action runs only through the engine, only with the Boss's approval, and only
 * when its availability is SUNNY_EXECUTABLE / EXECUTABLE with a registered executor (Wave 0 registers none).
 */
import { COVERAGE_MAP } from "./coverage-map";
import { PROJECT_ACTIONS } from "@/lib/partner/system/project-actions";
import { CLIENT_ACTIONS } from "@/lib/partner/system/clients";
import { LABEL_ACTIONS } from "@/lib/partner/system/label-artists";
import { MIX_ACTIONS } from "@/lib/partner/system/mix";
import { RF_ACTIONS } from "@/lib/partner/system/red-films";
import { SHOW_ACTIONS } from "@/lib/partner/system/shows";
import { VICTOR_ACTIONS } from "@/lib/partner/system/victor";
import { HANDLER_MAP } from "./handler-map.generated";
import { ALL_PRIMITIVES, type PrimitiveSpec } from "./primitives";
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
};
/** Unsafe behaviour already HARDENED in the shared writers (2026-09-27, Universal Actions) — kept as the audit trail of what changed. */
export const HARDENED: Readonly<Record<string, string>> = {
  "PROJECT.EDIT_SESSION": "a date / time edit now moves the linked Google event server-side even without absolute times (lib/writes/sessions)",
  "PROJECT.EDIT_MEETING": "a date / time / duration / place edit moves the Google event; a delete removes it (lib/writes/meetings)",
  "CLIENT.MEETING_HELD_OR_CANCELLED": "a date / time / duration / place edit moves the Google event; a delete removes it (lib/writes/meetings)",
  "PROJECT.CONVERT_PROPOSAL": "CAS claim on the proposal (linked project IS NULL + updated_at): a second concurrent conversion is refused (lib/writes/proposals)",
  "CLIENT.CONVERT_PROPOSAL": "CAS claim on the proposal (linked project IS NULL + updated_at): a second concurrent conversion is refused (lib/writes/proposals)",
  "CLIENT.UPDATE_CLIENT": "Sunny's field-level edit merges into the current record (nothing blanked); rename is a separate C3 action with the cascade count",
  "CLIENT.UPDATE_PROPOSAL": "Sunny's primitives validate status (the code vocabulary), amount (≥ 0) and currency (₪ / $) before the shared writer",
  "PROJECT.LINK_PROPOSAL": "Sunny's link primitive checks that the project exists before writing",
  "PROJECT.EDIT_TRANSACTION": "Sunny's MOVE_TRANSACTION checks the target project and refuses sync-owned or session-linked rows; edits of show / mix / Red Films rows go through their families (lib/writes/finance financeOwnerOf). 2026-09-27: ONE owned-row rule (lib/finance/ownership) for the Finance route, the Finance screen and Sunny — an owned row is never deleted in Finance and its money / identity fields are refused (409 naming the owner)",
  "LABEL.SHOW_LIFECYCLE": "the booking-time ledger sync skips a show whose earning row the close already realized (source_show_id) — no second expected row (lib/artist-balance-show-sync.ts)",
  "SHOW.CLOSE_SHOW": "same ledger guard; the close is one server-side writer (closeShowRecord) with the dialog's exact semantics",
  "SHOW.EDIT_SHOW": "same ledger guard; Sunny's show primitives validate price / payment status / DJ fee before the shared writer (the route itself still accepts raw values). 2026-09-27 (A1): the client payment status in a save is intent only; DJ / artist fee rows never follow it and a paid fee is never downgraded or re-priced (MARK_SHOW_FEE_PAID marks a fee explicitly)",
  "PROJECT.DELETE_ENGINEER_WORK": "deleting a work removes its UNPAID linked expense; a paid one is kept as history (lib/writes/mix deleteEngineerWorkClean — the route uses it too). 2026-09-27: ONE expense writer (reconcileEngineerExpense) for every path — work currency, a שולם row never overwritten, un-pay refused while it is שולם",
  "PROJECT.EDIT_VICTOR_WORK": "a failed Victor save / delete now throws (lib/vendor-store) instead of reporting success; the owner flows live in lib/writes/victor",
  "PROJECT.DELETE_VICTOR_WORK": "removing a Victor work deletes its follow-up task (+ Google Task) first (lib/writes/victor removeVictorWork; the route uses it)",
  "UPDATE_VICTOR_VERSION_REVIEW": "one version's review is written per version with an updated_at claim (lib/writes/victor saveVictorReviewDraft), never the whole JSON blindly",
  "PROJECT.PROMOTE_CLIP_ITEM": "the clip row is claimed (status → הועבר לכספים only while it has no linked expense) before the expense is created, then KEPT and linked to it (B3 provenance); a failed expense releases the claim — no double expense (lib/writes/redfilms promoteClipItem; the route uses it)",
  "RF.PROMOTE_CLIP_ROW": "same claim-first promotion (lib/writes/redfilms promoteClipItem)",
  "RF.CANCEL_PRODUCTION": "the production is saved first and only then are its future tasks / Google Tasks cancelled (lib/writes/redfilms updateProduction; the route uses it)",
  "PROJECT.SEND_LOG_DELETE": "the drawer's cascade runs on the server (lib/writes/worklog deleteSendLogEntryWithCascade): engineer send → deleteEngineerWorkClean; Victor send → removeVictorWork (task first); then the entry — no half-delete when the browser closes",
  "PROJECT.DELIVERY": "the status write changes ONLY deliveryStatus + deliveredAt (validated) merged into the record — the whole-body merge that could overwrite the folder / link is gone; create checks its settings write (lib/writes/delivery; the route uses it)",
  "PROJECT.SOCIAL": "campaign / content POST + PATCH accept only the fields the screens edit, validated against the app's vocabularies (lib/writes/social; the routes use it) — the whole-body writes are gone; a content delete reports storage failures instead of hiding them",
  "AGENT.UPDATE_GOALS": "only the four known goals with a validated shape are written, all checked before any write; a failed write is an error (lib/writes/system; the route uses it) — the route used to turn any body key into a goal_<key> settings row",
  "AGENT.MARK_ALERT_HANDLED": "a failed alert-status write is an error (it used to be ignored); the kill-switch rule is reused unchanged",
  "SYSTEM.MAINTENANCE": "a failed maintenance write is an error (it used to be silently ignored)",
  "NOTIFY.MARK_READ": "a recipient-bound writer for the Owner's own rows (OWNER_EMAILS user ids, never the recipient_role echo)",
  "PROJECT.DELETE_PROJECT_FILE": "the delete route refuses a path that is not the project's own (listed file, inside the project folder, or a folder of listed files) and traversal (lib/writes/files deleteProjectFileByPath; the route uses it) — it used to delete any path",
  "PROJECT.ALBUM_SETTINGS": "the legacy album finance PATCH (no screen) accepts only its five typed keys — the whole-body merge is gone; previous-system info goes through one shared normalizing writer (lib/writes/worklog)",
  "PROJECT.BACKFILL_START_DATES": "the backfill write is guarded by start_date IS NULL and failures are reported (lib/writes/backfills; the route uses it)",
  "CLIENT.BACKFILL_CLIENTS_FROM_PROJECTS": "names created meanwhile are re-checked before insert — no duplicate client (lib/writes/backfills)",
  "PROJECT.DELETE_PROJECT": "a READ-ONLY preflight runs first: final files on the project's mix works BLOCK the delete with zero writes (BLOCKED_BY_DEPENDENTS, 409); each cleanup step is checked and the delete aborts on the first failure; a fresh blocker re-check runs right before the project row, which goes LAST (retry-safe); Google events / Tasks / the cover file are removed only after the database commit and failures are reported; Victor works go through the shared writer (their tasks too) — lib/writes/project-delete, the route uses it. A single database transaction still needs an approved SQL function.",
  "RF.REFERENCES": "reference-links PATCH wrote the whole request body into the row → the shared writer updateVideoReference (lib/writes/redfilms) accepts only title / notes (the UI and Sunny use the same writer)",
};
/** Legacy surfaces the Boss no longer uses — kept knowable, never offered. */
const LEGACY: Readonly<Record<string, string>> = {
  "PROJECT.HIDE": "legacy drawer only",
  "CLIENT.MARK_PROPOSAL_LOST": "legacy dashboard only (the proposal status edit covers it)",
  "PROJECT.BACKFILL_START_DATES": "one-off backfill with no screen",
  "CLIENT.BACKFILL_CLIENTS_FROM_PROJECTS": "one-off backfill with no screen (a GET that writes)",
};
/** Blocked until the Boss decides. D5 / D6 / D7 are decided (2026-09-27); the D5 + currency SQL is applied. */
const OWNER_DECISION: Readonly<Record<string, string>> = {};

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
  { id: "CALENDAR.DISCONNECT", domain: "CALENDAR", en: "Disconnect Google Calendar (delete the stored token)", routes: ["app/api/calendar/status/route.ts"], detail: "NEEDS_PRIMITIVE", reason: "typed high-impact primitive; the token itself is never read or exposed", effects: ["SETTINGS", "CALENDAR", "GOOGLE_TASKS"] },
  { id: "CALENDAR.CHECK_SLOT", domain: "CALENDAR", en: "Check a manual slot against the calendar (read via POST)", routes: ["app/api/calendar/check-slot/route.ts"], detail: "SUNNY_NATIVE", reason: "a read: Sunny already reads the live calendar (calendar capability)" },
  { id: "CALENDAR.CREATE_EVENT", domain: "CALENDAR", en: "Create a calendar event", routes: ["app/api/calendar/create-event/route.ts"], detail: "NEEDS_PRIMITIVE", reason: "needs a typed calendar primitive storing the event id on its record", effects: ["CALENDAR"] },
  { id: "CALENDAR.UPDATE_OR_DELETE_EVENT", domain: "CALENDAR", en: "Move / edit / delete a calendar event", routes: ["app/api/calendar/events/[id]/route.ts"], detail: "NEEDS_PRIMITIVE", reason: "needs a typed calendar primitive (Wave 4)", effects: ["CALENDAR", "DELETION"] },
  { id: "CALENDAR.CREATE_GOOGLE_TASK", domain: "CALENDAR", en: "Create a Google Task", routes: ["app/api/calendar/create-task/route.ts"], detail: "NEEDS_PRIMITIVE", reason: "needs a typed primitive", effects: ["GOOGLE_TASKS"] },
  { id: "CALENDAR.DELETE_GOOGLE_TASK", domain: "CALENDAR", en: "Delete a Google Task", routes: ["app/api/calendar/tasks/[id]/route.ts"], detail: "NEEDS_PRIMITIVE", reason: "needs a typed primitive", effects: ["GOOGLE_TASKS", "DELETION"] },
  { id: "CALENDAR.SYNC_COMPLETED_TASKS", domain: "CALENDAR", en: "Sync completed Google Tasks back into Redbloods", routes: ["app/api/calendar/tasks/sync/route.ts"], detail: "SYSTEM_AUTOMATIC", reason: "page-load / background sync" },
  // Dropbox
  { id: "FILES.FOLDER_LINK", domain: "FILES", en: "Create / return a folder share link", routes: ["app/api/dropbox/folder-link/route.ts"], detail: "NEEDS_PRIMITIVE", reason: "public links are a Wave 5 file primitive", effects: ["EXTERNAL_LINK"] },
  { id: "FILES.DISCONNECT_DROPBOX", domain: "FILES", en: "Disconnect Dropbox (revoke token)", routes: ["app/api/dropbox/status/route.ts"], detail: "NEEDS_PRIMITIVE", reason: "re-reviewed 2026-09-27: an Owner operation on an integration, not a credential flow — a typed C3 primitive (the token is never read into a plan or exposed; reconnecting stays the Boss's own consent)", effects: ["SETTINGS", "FILES"], approvalClass: "DESTRUCTIVE", reversible: "NO" },
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
  { id: "SYSTEM.MAINTENANCE", domain: "SYSTEM", en: "Maintenance mode / system maintenance", routes: ["app/api/maintenance/route.ts"], detail: "NEEDS_PRIMITIVE", reason: "re-reviewed 2026-09-27: the Owner's maintenance lock — a typed C3 BULK primitive (who is locked out is previewed); users, roles and passwords stay excluded", effects: ["SETTINGS"], approvalClass: "BULK", reversible: "YES" },
  { id: "REPORTS.UPDATE_CONFIG", domain: "REPORTS", en: "Edit report schedule / recipients", routes: ["app/api/reports/config/route.ts"], detail: "NEEDS_PRIMITIVE", reason: "settings primitive; changes who receives email", effects: ["SETTINGS"] },
  { id: "REPORTS.SEND", domain: "REPORTS", en: "Send the morning / evening / weekly report email", routes: ["app/api/reports/morning/route.ts", "app/api/reports/evening/route.ts", "app/api/reports/weekly/route.ts"], detail: "SYSTEM_AUTOMATIC", reason: "scheduled; Sunny's morning brief is produced on request, never emailed", effects: ["EMAIL"] },
  // Sunny connector / OAuth / MCP (security)
  { id: "SUNNY.CONNECTOR_OAUTH", domain: "SUNNY", en: "Connector OAuth authorize / register / token / revoke", routes: ["app/api/mcp-oauth/authorize/route.ts", "app/api/mcp-oauth/register/route.ts", "app/api/mcp-oauth/token/route.ts", "app/api/mcp-oauth/revoke/route.ts"], detail: "SECURITY_EXCLUDED", reason: "credentials — never Sunny", security: true },
  { id: "SUNNY.ACT_RELAY", domain: "SUNNY", en: "The connector → MAIN internal action endpoint (plan / preview / approve / execute / status)", routes: ["app/api/partner/internal/act/route.ts"], detail: "SUNNY_NATIVE", reason: "the Universal Action Layer's own relay: service-secret authenticated, off unless enabled, every write through a registered primitive after the Boss's approval" },
  { id: "SUNNY.MCP_TRANSPORT", domain: "SUNNY", en: "The MCP transport itself", routes: ["app/api/mcp/route.ts"], detail: "SUNNY_NATIVE", reason: "Sunny's own channel (reads, P1 answers, P2 knowledge — each gated)" },
  { id: "SUNNY.ANSWER_FINANCE_QUESTION", domain: "SUNNY", en: "The Boss answers a finance question in the dashboard", routes: ["app/api/partner/finance/answer/route.ts"], detail: "SUNNY_NATIVE", reason: "the Boss's own answer loop (typed, validated)" },
  { id: "SUNNY.ANSWER_INTEGRITY_QUESTION", domain: "SUNNY", en: "The Boss answers an integrity question in the dashboard", routes: ["app/api/partner/integrity/answer/route.ts"], detail: "SUNNY_NATIVE", reason: "the Boss's own answer loop (typed, validated)" },
  { id: "SUNNY.OWNER_INBOX_SUBMIT", domain: "SUNNY", en: "The Boss writes a quick update to Sunny ('עדכון לסאני', Dashboard V2) — stored as OWNER_REPORTED evidence", routes: ["app/api/sunny/inbox/route.ts"], detail: "SUNNY_NATIVE", reason: "the Boss's own channel TO Sunny (like answering a question): one sunny_owner_inbox row through the approved RPC, idempotent by requestKey; the text is never a fact and changes no record" },
  { id: "SUNNY.OWNER_INBOX_MARK_PROCESSED", domain: "SUNNY", en: "Mark a 'עדכון לסאני' item handled (NEW → PROCESSED with a typed outcome)", routes: ["app/api/sunny/inbox/[id]/route.ts"], detail: "BLOCKED_BY_OWNER_DECISION", reason: "the Boss marks it in the dashboard route today (processed_via DASHBOARD, lib/writes/owner-inbox). Sunny's own path = a typed primitive MARK_OWNER_INBOX_ITEM over the SAME writer with a new owner-inbox target key kind — the key-kind CHECKs of the Partner audit / action tables are a DB change that needs the Boss's separate approval. The outcome records what happened; it never turns the text into a fact", reversible: "NO" },
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
  { id: "SHOW.RECORD_SHOW_ADVANCE", domain: "SHOW", en: "Record money received for a show — deposit / partial / full / overpayment (D5: a SHOW_PAYMENT row in Finance)", routes: ["app/api/shows/[id]/payments/route.ts"], detail: "NEEDS_PRIMITIVE", reason: "executed through RECORD_SHOW_PAYMENT", effects: ["FINANCE"] },
  { id: "RF.MARK_PRODUCTION_APPROVED", domain: "RF", en: "Mark the current Red Films stage approved (D7: the Owner approved the current production / edit stage to proceed — not client / payment / final)", routes: [], detail: "NEEDS_PRIMITIVE", reason: "executed as a status / edit-status change through UPDATE_PRODUCTION_DETAILS" },
  { id: "SHOW.SET_SHOW_CURRENCY", domain: "SHOW", en: "Set the currency of a show (price, DJ fee and its Finance rows)", routes: [], detail: "NEEDS_PRIMITIVE", reason: "executed through SET_SHOW_CURRENCY", effects: ["FINANCE"] },
  { id: "SHOW.SET_SHOW_DEAL_TYPE", domain: "SHOW", en: "Switch a show's deal type PAID ↔ UNPAID_COLLAB (not a payment status; PAID → collaboration refused while real money exists)", routes: [], detail: "NEEDS_PRIMITIVE", reason: "executed through SET_SHOW_DEAL_TYPE", effects: ["FINANCE", "LEDGER", "DELETION"] },
  { id: "RF.SET_PAYMENT_CURRENCY", domain: "RF", en: "Set the currency of Red Films money (production / budget line — its payments follow it / equipment)", routes: [], detail: "NEEDS_PRIMITIVE", reason: "executed through SET_RF_CURRENCY", effects: ["FINANCE"] },
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

// ── improvement candidates (Boss decision 2026-09-27) ──────────────────────────────────────────────────────────────
/** Not Redbloods operations (the Boss cannot do them in the app either) — proposals, never census rows, never a Sunny
 *  gap. Building one is a separate, approved product / infrastructure mission; then it becomes a route + a primitive. */
export const IMPROVEMENT_CANDIDATES: ReadonlyArray<{ id: string; kind: "PRODUCT" | "INFRASTRUCTURE"; en: string; he: string; today: string; wouldNeed: string }> = [
  { id: "PROJECT.FILE_RENAME_MOVE", kind: "PRODUCT", en: "Rename / reorder project files, move a project folder", he: "שינוי שם / סידור קבצי פרויקט והעברת תיקייה", today: "no route and no screen in Redbloods (project-actions FILE_RENAME_MOVE, enforcement NO_ROUTE)", wouldNeed: "a product decision (which files, what the player / delivery / send-log references do after a move), a shared writer + a route + a screen, then a typed primitive" },
  { id: "PROJECT.ATOMIC_DELETE_FN", kind: "INFRASTRUCTURE", en: "Delete a project and its dependents in one database transaction", he: "מחיקת פרויקט ותלויותיו בטרנזקציה אחת במסד הנתונים", today: "DELETE_PROJECT runs a read-only preflight (final files on the project's works block it with zero writes), then the app's ordered dependent cleanup, a fresh blocker re-check and the row delete; external effects (calendar / Google Tasks / cover file) after the DB commit (gap PRJ_DELETE_NON_ATOMIC PARTIALLY_CLOSED: a mid-way DB failure can still leave a partial, retryable cleanup; the preview lists every dependent and the result is verified)", wouldNeed: "an approved database function (SQL) called by the shared writer — no SQL is written or run until the Boss approves" },
  { id: "RF.APPROVAL_HISTORY", kind: "PRODUCT", en: "Record who approved which Red Films stage / version and when", he: "תיעוד מי אישר איזה שלב / גרסה ב-Red Films ומתי", today: "D7: 'מאושר' is a stage status only (the Owner approved the current stage to proceed); no approval history exists", wouldNeed: "an Owner product decision + approved schema (approved_at / approved_by / an approval events table / per-version approval)" },
  { id: "SUNNY.CLAUDE_FILE_TRANSFER", kind: "PRODUCT", en: "Move a file attached in the Claude conversation straight into Redbloods (OWNER_DEFERRED_CLAUDE_FILE_TRANSFER)", he: "העברת קובץ שצורף לשיחה ב-Claude ישירות ל-Redbloods", today: "Owner-deferred (2026-09-27): new files reach Redbloods through the Sunny Inbox folder (fallback) and are placed by the UPLOAD_* primitives after approval; existing-file operations work from Claude", wouldNeed: "an Owner decision to open a secured receiving endpoint (deposit ticket / MCP App) — not built" },
];
// ── explicit exclusions (write routes that are not business actions) ────────────────────────────────────────────────
/** A write route that is intentionally NOT an action, with the reason. G1 accepts a route only via a contract or here. */
export const ROUTE_EXCLUSIONS: Readonly<Record<string, string>> = {};

// ── build ────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** A READY contract, built from the primitive's own metadata (one source of truth). */
function fromPrimitive(p: PrimitiveSpec): ActionContract {
  const m = p.meta;
  return {
    id: p.actionId, version: 1, domain: m.domain, meaningHe: m.he, meaningEn: m.en, businessEvents: [], args: m.args, fields: m.fields,
    preconditions: ["the target exists (or, for a create, the creation context is unchanged)", "the live fields match the previewed fingerprint", "the Boss approved this exact plan"],
    riskClass: m.riskClass, confirmation: confirmationOf(m.riskClass), effects: m.effects, possibleEffects: [], phase: phaseOf(m.effects), reversible: m.reversible,
    compensation: m.compensation ?? null, idempotency: p.createContext ? "EXECUTION_KEY_PLUS_NATURAL_DUPLICATE_WARNING" : "EXECUTION_KEY",
    availability: "SUNNY_EXECUTABLE", availabilityDetail: "EXECUTABLE", reason: "typed primitive over the same shared writer the Redbloods screens use",
    wave: WAVE1_IDS.has(p.actionId) ? "W1" : waveOfRisk(m.riskClass), disclosuresHe: p.disclosuresHe,
    internal: { routes: [], source: "lib/partner/act/primitives", writer: m.writer, verifier: p.verify ? "custom verification (lib/partner/act/primitives)" : "fresh read of the same fields (lib/partner/act/primitives)" },
  };
}
const WAVE1_IDS = new Set([...WAVE1_CANDIDATES.map((w) => w.id), "UPDATE_PROJECT_DEADLINE"]);

function build(): ReadonlyMap<string, ActionContract> {
  const m = new Map<string, ActionContract>();
  const add = (c: ActionContract) => { if (m.has(c.id)) throw new Error(`duplicate action id ${c.id}`); m.set(c.id, c); };
  const prim = new Set(ALL_PRIMITIVES.map((p) => p.actionId));
  ALL_PRIMITIVES.map(fromPrimitive).forEach(add);
  LIVE.filter((c) => !prim.has(c.id)).forEach(add);
  for (const inv of INVENTORIES) for (const e of inv.entries) if (e.enforcement !== "NO_ROUTE") add(fromInventory(inv.domain, inv.source, e)); // NO_ROUTE = not a Redbloods operation → IMPROVEMENT_CANDIDATES
  SUPPLEMENTARY.map(fromSupp).forEach(add);
  WAVE1_CANDIDATES.filter((w) => !prim.has(w.id)).map(fromW1).forEach(add);
  // One fact, one source: a census row whose whole outcome the live primitives carry out IS executable (COVERAGE_MAP);
  // a partly covered row says which primitives are live and what remains.
  for (const [id, c] of m) {
    const cov = COVERAGE_MAP[id];
    if (prim.has(id) || !cov || !cov.by.every((x) => prim.has(x))) continue;
    m.set(id, cov.full
      ? { ...c, availability: "SUNNY_EXECUTABLE", availabilityDetail: "EXECUTABLE", reason: `executable through the typed primitives ${cov.by.join(" + ")} (each only after the Boss approves its exact preview)` }
      : { ...c, reason: `partly live through ${cov.by.join(" + ")}; remaining: ${cov.remaining ?? c.reason}` });
  }
  return m;
}
export const ACTION_REGISTRY: ReadonlyMap<string, ActionContract> = build();
export const ACTION_CONTRACTS: readonly ActionContract[] = [...ACTION_REGISTRY.values()];

/** Routes (with optional #METHOD) → the contracts that own them. */
export function contractsForRoute(route: string, method?: string): ActionContract[] {
  return ACTION_CONTRACTS.filter((c) => c.internal.routes.some((r) => { const [p, mm] = r.split("#"); return p === route && (!mm || !method || mm === method); }));
}
