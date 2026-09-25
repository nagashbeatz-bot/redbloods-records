/**
 * Sunny SHOWS + DJ DEEP BRAIN — coverage guards + reasoning scenarios A–L.
 *
 * Guards (permanent): every show column classified; status / payment / DJ-confirmation vocabularies equal the code;
 * every show-related API route belongs to a route family; the show / finance-sync / ledger-sync / notify / DJ server
 * files are unchanged since the last review (SHOW_REVIEWED_FINGERPRINTS); money reuses the app's own pure split and
 * rehearsal-counted functions (no second rule); the view is pure.
 *
 * Run with:   npx tsx scripts/test-sunny-shows.tsx      Pure; never touches production.
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { PARTNER_KNOWLEDGE_REGISTRY } from "../lib/partner/knowledge/catalog";
import { queryKnowledgeCore } from "../lib/partner/knowledge/query";
import type { KnowledgeAudience, QueryResponse } from "../lib/partner/knowledge/types";
import type { GatewayFinance, GatewaySources } from "../lib/partner/gateway/core";
import type { OperationsRaw } from "../lib/partner/operations/types";
import type { ProjectDetailRaw, DetailSession } from "../lib/partner/projects/detail-types";
import type { LabelDetailRaw, DetailShow } from "../lib/partner/label/detail-types";
import type { SettingsState } from "../lib/partner/settings/types";
import type { CalendarWindowResult } from "../lib/partner/calendar/types";
import { deriveFinanceView } from "../lib/partner/finance/view";
import { buildFinanceBrief } from "../lib/partner/finance/brief";
import { buildShowView, showPortfolio } from "../lib/partner/shows/view";
import * as SM from "../lib/partner/system/shows";
import { DOMAIN_CONTRACTS, FORBIDDEN_SERVED_TERMS, SYSTEM_BASELINE_VERSION, CAPABILITY_CHANGES, validateSystemRegistry } from "../lib/partner/system";
import { DOMAIN_KNOWLEDGE_DEPTH, KNOWLEDGE_GAPS, validateKnowledgeGaps } from "../lib/partner/system/gaps";
import { KNOWLEDGE_KINDS } from "../lib/partner/owner-knowledge/kinds";
import { SHOW_STATUSES, PAYMENT_STATUSES, DJ_CONFIRMATION_STATUSES } from "../lib/shows-types";
import { computeShowNotifyFingerprint } from "../lib/show-notify-pure";
import { C_CLEAN, C_SHALEV, LA_AVI, LA_CLEAN, LA_NAGASH, LA_SHALEV, NOW, U, input } from "./fixtures/integrity-company";
import { empty, tx } from "./fixtures/finance-mirror";

let pass = 0, fail = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log(`  ✓ ${name}`); pass++; } else { console.log(`  ✗ ${name}\n      expected ${e}\n      actual   ${a}`); fail++; }
}
const ok = (name: string, cond: boolean) => { if (cond) { console.log(`  ✓ ${name}`); pass++; } else { console.log(`  ✗ ${name}`); fail++; } };
const section = (t: string) => console.log(`\n${t}`);
const ROOT = path.resolve(__dirname, "..");
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8");
const code = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const OWNER: KnowledgeAudience = { channel: "EXTERNAL", ownerAuthorized: true };
const STRANGER: KnowledgeAudience = { channel: "EXTERNAL", ownerAuthorized: false };
const REG = PARTNER_KNOWLEDGE_REGISTRY;

// ── fixture ──
const sec = <T,>(rows: T[]) => ({ rows, capped: false });
const EMPTY = Object.fromEntries(["projects", "financeNotes", "deliveries", "actions", "sessions", "meetings", "tasks", "engineerWork", "mixVersions", "mixComments", "commentAttachments", "mixTargets", "mixTargetNotes", "finalFiles", "victor", "productions", "budgetItems", "albumTracks", "clipItems", "proposals", "releases", "campaigns", "contentItems", "socialFiles", "projectSettings", "transactionsText", "budgetPayments", "agentAlerts", "notifications"].map((k) => [k, { rows: [], capped: false }])) as unknown as ProjectDetailRaw;
const PAST = U(401), NEXT = U(402), CLEAN_PENDING = U(403), CANCELLED = U(404), COLLAB = U(405);
const TX_INC = U(9101), TX_DJ = U(9102), TX_ART = U(9103), TX_REH = U(9104);
const show = (id: string, o: Partial<DetailShow>): DetailShow => ({ id, name: "הופעה", artistText: "שליו טסמה", date: "2026-08-06", startTime: "21:00", location: "תל אביב", contactPerson: "מפיק", hasPhone: true, status: "בוצע", paymentStatus: "שולם", price: 3000, djFee: 500, artistFee: 0, advancePayment: 0, notes: null,
  artistClientId: C_SHALEV, bookerClientId: null, bookerName: "מועדון", djClientId: C_CLEAN, djName: "רועי איוב", djConfirmationStatus: "אושר", djConfirmedAt: "2026-08-01T10:00:00Z", hasCalendarEvent: true, incomeTxId: null, djExpenseTxId: null, artistExpenseTxId: null, createdAt: "2026-07-20T10:00:00Z", updatedAt: "2026-07-25T10:00:00Z", ...o });
const SHOWS: DetailShow[] = [
  show(PAST, { incomeTxId: TX_INC, djExpenseTxId: TX_DJ, artistExpenseTxId: TX_ART }),
  show(NEXT, { name: "הופעה הבאה", date: "2026-10-15", startTime: null, location: "", status: "אושרה", paymentStatus: "צפוי", advancePayment: 1000, djClientId: null, djName: "", djConfirmationStatus: null, djConfirmedAt: null }),
  show(CLEAN_PENDING, { name: "הופעה עם CLEANTONE", date: "2026-10-20", status: "נסגר", paymentStatus: "צפוי", djConfirmationStatus: "ממתין לאישור", djConfirmedAt: null }),
  show(CANCELLED, { name: "בוטלה", date: "2026-08-13", status: "בוטל", paymentStatus: "בוטל", djConfirmationStatus: "ממתין לאישור", djConfirmedAt: null }),
  show(COLLAB, { name: "שיתוף", artistText: "שליו טסמה, אבי מולה", date: "2026-10-25", status: "אושרה", paymentStatus: "צפוי" }),
];
const LD: LabelDetailRaw = {
  artists: sec([{ id: LA_SHALEV, name: "שליו טסמה", status: "פעיל", hasImage: false, notes: null, createdAt: null, updatedAt: null }, { id: LA_AVI, name: "אבי מולה", status: "פעיל", hasImage: true, notes: null, createdAt: null, updatedAt: null },
    { id: LA_CLEAN, name: "DJ CLEANTONE", status: "פעיל", hasImage: false, notes: null, createdAt: null, updatedAt: null }, { id: LA_NAGASH, name: "נגש ביטס", status: "פעיל", hasImage: true, notes: null, createdAt: null, updatedAt: null }]),
  ledger: sec([
    { id: U(1101), artistId: LA_SHALEV, entryType: "הכנסות", amount: 1150, entryDate: "2026-08-06", description: "הופעה - הופעה", note: null, sourceTxId: TX_ART, sourceShowId: PAST, createdAt: null, updatedAt: null },
    { id: U(1102), artistId: LA_SHALEV, entryType: "הכנסות", amount: 1250, entryDate: "2026-08-13", description: "הופעה - בוטלה", note: null, sourceTxId: null, sourceShowId: CANCELLED, createdAt: null, updatedAt: null }]),
  cycles: sec([]), mediaIncome: sec([]), beats: sec([]), shows: sec(SHOWS),
};
const fpNext = computeShowNotifyFingerprint({ name: "הופעה עם CLEANTONE", date: "2026-10-20", startTime: "21:00", location: "תל אביב" });
const SETTINGS: SettingsState = { families: {
  SHOW_SENT_TO_ARTIST: sec([{ key: `show_notify:${CLEAN_PENDING}`, updatedAt: null, value: { status: "sent", fingerprint: fpNext, claimedAt: "2026-09-20T10:00:00Z", sentAt: "2026-09-20T10:00:05Z" } },
    { key: `show_notify:${COLLAB}`, updatedAt: null, value: { status: "sent", fingerprint: "old", claimedAt: "2026-09-20T10:00:00Z", sentAt: "2026-09-20T10:00:05Z" } }]),
  SHOW_SENT_TO_DJ: sec([]),
} };
const reh = (id: number, showId: string, status: string, cost: number, date = "2026-08-04"): DetailSession => ({ id: U(id), projectId: null, showId, date, startTime: "18:00", endTime: "20:00", status, type: "חזרה להופעה", title: "חזרה", notes: null, location: null, photographer: null, cost, hasCalendarEvent: true, createdAt: null });
const CAL: CalendarWindowResult = { status: "CALENDAR_DATA_AVAILABLE", window: { start: "2026-09-17T00:00:00+03:00", end: "2026-10-31T23:59:59+02:00", days: 45 }, fetchedAt: NOW.toISOString(), cache: "MISS", calendars: [], truncated: false, reasons: [], events: [] };

function sources(o: { cal?: "NONE"; settings?: "NONE" } = {}): GatewaySources {
  const st = input({ contexts: [] }).state!;
  const t = (id: string, over: Record<string, unknown>) => ({ ...tx(over as Parameters<typeof tx>[0]), id });
  const raw = empty({ transactions: [t(TX_INC, { type: "income", amount: 3000, status: "התקבל", category: "הופעה" }), t(TX_DJ, { type: "expense", amount: 500, status: "שולם", category: "שכר דיג'יי" }), t(TX_ART, { type: "expense", amount: 1150, status: "צפוי", category: "שכר אמן" }),
    { ...t(TX_REH, { type: "expense", amount: 200, status: "שולם", category: "חזרה" }), linkedSessionId: U(951) }] });
  const view = deriveFinanceView(raw, NOW, []);
  const f: GatewayFinance = { state: view.state, integrity: view.integrity, actions: view.actions, raw, brief: buildFinanceBrief(view.state, view.integrity, { answersAvailable: true, actionNoteHe: view.actionNoteHe }), answersAvailable: true };
  const ops = { calendarLinks: sec([{ eventId: "evt-show", kind: "SHOW", entityId: NEXT, projectId: null, clientId: null, showId: NEXT, date: "2026-10-15", status: "אושרה" }]), integrations: { googleCalendarConnected: true, dropboxConnected: true } } as unknown as OperationsRaw;
  const det: ProjectDetailRaw = { ...EMPTY, sessions: sec([reh(951, PAST, "בוצע", 200), reh(952, PAST, "התקיים", 150, "2026-08-05"), reh(953, NEXT, "מתוכנן", 0, "2026-10-12")]),
    tasks: sec([{ id: U(961), relatedType: "general", relatedId: null, title: "לסגור דיג׳יי להופעה: הופעה הבאה", notes: null, status: "פתוח", dueDate: "2026-09-26", startTime: null, endTime: null, showId: NEXT, hasGoogleTask: false, createdAt: null, updatedAt: null }]) };
  return { now: NOW, state: { status: "OK", value: st }, finance: { status: "OK", value: f }, identities: { cleantone: { clientId: C_CLEAN, labelArtistName: "DJ CLEANTONE" } },
    cases: { status: "OK", value: [] }, actions: { status: "OK", value: [] }, outcomes: { status: "OK", value: [] }, ownerKnowledge: { status: "OK", value: [] },
    projectDetail: { status: "OK", value: det }, operations: { status: "OK", value: ops }, labelDetail: { status: "OK", value: LD },
    ...(o.settings === "NONE" ? {} : { settings: { status: "OK" as const, value: SETTINGS } }),
    ...(o.cal === "NONE" ? {} : { calendar: { status: "OK" as const, value: { ...CAL, events: [{ id: "evt-show", calendarId: "primary", calendarName: "owner", holidayCalendar: false, title: "הופעה: הופעה הבאה - שליו טסמה", untitled: false, description: null, start: "2026-10-15T20:00:00+03:00", end: "2026-10-15T22:00:00+03:00", allDay: false, timeZone: "Asia/Jerusalem", durationMinutes: 120, location: null, attendees: [], attendeesOmitted: false, selfResponse: null, organizer: null, creator: null, invited: false, recurringEventId: null, originalStartTime: null, recurrence: null, status: "confirmed", eventType: "default", transparency: "opaque" as const, visibility: null, created: null, updated: null, hasMeetingLink: false, hasAttachments: false, attachmentCount: 0 }] } } }) };
}
const q = (capability: string, mode: string, params: Record<string, string> = {}, src = sources(), aud = OWNER): QueryResponse => queryKnowledgeCore(REG, { capability, mode, params }, src, aud);
const codes = (v: ReturnType<typeof buildShowView>) => (v?.signals ?? []).map((s) => s.code);

function main() {
  section("1. coverage — schema, vocabularies, routes, fingerprints, no second rule");
  check("every show column has a field contract", SM.SHOW_FIELDS.map((f) => f.field).sort(), [...SM.SHOW_SCHEMA_COLUMNS].sort());
  ok("every field fully described", SM.SHOW_FIELDS.every((f) => [f.meaning, f.validation, f.writers, f.readers, f.history, f.sunnyReads].every((x) => x.trim().length > 0)));
  check("show statuses = the code", [...SM.SHOW_VOCABULARIES.statuses], [...SHOW_STATUSES]);
  check("payment statuses = the code", [...SM.SHOW_VOCABULARIES.paymentStatuses], [...PAYMENT_STATUSES]);
  check("DJ confirmation = the code", [...SM.SHOW_VOCABULARIES.djConfirmation], [...DJ_CONFIRMATION_STATUSES]);
  ok("confirmed-finance group = the finance sync constant", /CONFIRMED_STATUSES = new Set\(\["נסגר", ?"אושרה", ?"בוצע"\]\)/.test(read("lib/shows-finance-sync.ts").replace(/\s+/g, " ")) || read("lib/shows-finance-sync.ts").includes('"נסגר","אושרה","בוצע"') || read("lib/shows-finance-sync.ts").includes('"נסגר", "אושרה", "בוצע"'));
  const walk = (d: string): string[] => fs.readdirSync(path.join(ROOT, d), { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(`${d}/${e.name}`) : e.name === "route.ts" ? [`${d}/${e.name}`] : []);
  const routes = walk("app/api").filter((f) => /^app\/api\/shows\//.test(f) || /\.from\(\s*["']shows["']\)|shows-store|shows-finance-sync|show-notify|dj-show-notify|dj-confirm-notify|show-quote-followup|cleantone|show_id|showId/.test(read(f)));
  check("every show-related route belongs to a route family", routes.filter((f) => !SM.SHOW_ROUTE_GROUPS.some((g) => new RegExp(g.pattern).test(f))), []);
  for (const [f, want] of Object.entries(SM.SHOW_REVIEWED_FINGERPRINTS)) check(`${f} unchanged since the last Sunny show review (update lib/partner/system/shows.ts + fingerprint together)`, createHash("sha256").update(read(f).replace(/\r\n/g, "\n")).digest("hex"), want);
  ok("fingerprints cover every reviewed file", Object.keys(SM.SHOW_REVIEWED_FINGERPRINTS).length === SM.SHOW_REVIEWED_FILES.length);
  ok("every show action names existing routes; none executable", SM.SHOW_ACTIONS.every((a) => a.internal.routes.every((r) => fs.existsSync(path.join(ROOT, r))) && a.sunnyToday === "KNOWLEDGE_ONLY"));
  const view = code(read("lib/partner/shows/view.ts"));
  ok("money reuses the app's own split + rehearsal rule (no second rule)", /computeShowSplit\(/.test(view) && /rehearsalCountedAmount\(/.test(view) && !/\/\s*2\b/.test(view.replace(/net \/ 2/g, "")));
  ok("pure view: no DB / fetch / write / push", !/supabase|fetch\(|\.insert\(|\.update\(|\.upsert\(|\.delete\(|sendPush/.test(view + code(read("lib/partner/knowledge/capabilities/shows-deep.ts"))));
  ok("lifecycle covers create / confirm / edit / pipeline / close / reopen / cancel / delete / DJ confirm", ["CREATE", "CONFIRM", "EDIT", "BACK_TO_PIPELINE", "CLOSE", "REOPEN", "CANCEL", "DELETE", "DJ_CONFIRM"].every((k) => SM.LIFECYCLE.some((x) => x.transition.startsWith(k))));

  section("SCENARIO A — 'מה קורה עם ההופעה הבאה של שליו?'");
  const a = buildShowView(sources(), NEXT)!;
  ok("artist: client CANONICAL + roster by text (ledger rule)", a.artist.client?.key === `client:${C_SHALEV}` && a.artist.labelArtist?.key === `label-artist:${LA_SHALEV}` && /TEXT_MATCH/.test(a.artist.labelArtist.link));
  ok("money: price / advance / remaining / split", a.money.price === 3000 && a.money.advance === 1000 && a.money.remainingPerUi === 2000 && a.money.split.net === 2500 && a.money.split.artistFee === 1250);
  ok("rehearsal recorded, calendar event found, task visible", a.rehearsals.length === 1 && (a.calendar as { showEventFound?: boolean }).showEventFound === true && a.tasks.some((t) => t.kind === "CLOSE_A_DJ"));
  ok("asks for place + time (missing)", a.questions.some((x) => x.kind === "PLACE") && a.questions.some((x) => x.kind === "TIME"));

  section("SCENARIO B — show has no DJ");
  ok("NO_DJ + question; never CLEANTONE", a.dj === null && codes(a).includes("NO_DJ") && a.questions.some((x) => x.kind === "DJ") && codes(a).includes("DJ_FEE_WITHOUT_DJ"));

  section("SCENARIO C — CLEANTONE assigned, not confirmed");
  const c = buildShowView(sources(), CLEAN_PENDING)!;
  ok("pending confirmation + Owner next step as a question", c.dj?.isLabelDj === true && c.dj.confirmation === "ממתין לאישור" && codes(c).includes("DJ_AWAITING_CONFIRMATION") && c.questions.some((x) => x.kind === "DJ_CONFIRM"));

  section("SCENARIO D — artist notified, DJ not");
  check("markers distinguished", [(c.notifications.artist as { state: string }).state, (c.notifications.dj as { state: string }).state], ["SENT", "NOT_SENT"]);
  ok("DJ_NOT_NOTIFIED; Sunny never sends", codes(c).includes("DJ_NOT_NOTIFIED") && c.notifications.sunnySends === false);
  const col = buildShowView(sources(), COLLAB)!;
  ok("outdated artist notification detected by the app's fingerprint", codes(col).includes("ARTIST_NOTIFIED_OUTDATED"));
  ok("settings unreadable → UNKNOWN, never 'not sent'", (buildShowView(sources({ settings: "NONE" }), CLEAN_PENDING)!.notifications.artist as { state: string }).state === "UNKNOWN");

  section("SCENARIO E — client paid, show completed");
  const e = buildShowView(sources(), PAST)!;
  ok("income received, DJ paid, artist-fee row still expected", (e.money.finance.income as { received?: boolean }).received === true && (e.money.finance.djFee as { status?: string }).status === "שולם" && codes(e).includes("ARTIST_ROW_UNPAID_AFTER_DONE"));
  ok("ledger income via close (show link)", e.ledger.some((l) => l.type === "הכנסות" && /close-show/.test(l.via)));
  ok("finance rows carry their currency", (e.money.finance.income as { currency?: string }).currency === "₪" && /NOT_STORED/.test(e.money.currency));

  section("SCENARIO F — cancelled after the artist income existed");
  const f = buildShowView(sources(), CANCELLED)!;
  ok("realized ledger kept after cancel is surfaced", codes(f).includes("LEDGER_KEPT_AFTER_CANCEL"));
  ok("a cancelled show never raises 'awaiting DJ confirmation'", !codes(f).includes("DJ_AWAITING_CONFIRMATION"));
  ok("contract explains cancel: rows → בוטל, expected removed, realized kept", /realized income \+ payments KEPT/.test(SM.LIFECYCLE.find((x) => x.transition.startsWith("CANCEL"))!.ledger));

  section("SCENARIO G — reopened after close");
  ok("contract: realized income never demoted; to pipeline rows deleted", /never demoted/.test(SM.LIFECYCLE.find((x) => x.transition === "REOPEN")!.ledger) && /HARD-DELETED/.test(SM.LIFECYCLE.find((x) => x.transition === "BACK_TO_PIPELINE")!.finance));

  section("SCENARIO H — rehearsal cost in the split");
  check("counted: בוצע 200 counts; auto-mark 'התקיים' never", e.rehearsals.map((r) => [r.status, r.counted]), [["בוצע", 200], ["התקיים", 0]]);
  check("split = 3000 − 500 − 200 = 2300 → artist 1150 / label 1150", [e.money.split.net, e.money.split.artistFee, e.money.split.labelProfit], [2300, 1150, 1150]);

  section("SCENARIO I — calendar unavailable");
  ok("UNKNOWN, never 'no event'", (buildShowView(sources({ cal: "NONE" }), NEXT)!.calendar as { state: string }).state === "UNKNOWN");

  section("SCENARIO J — artist also a client");
  ok("client record and label artist are separate roles; collaboration → no ledger", a.artist.client!.key.startsWith("client:") && a.artist.labelArtist!.key.startsWith("label-artist:") && col.artist.collaboration && col.artist.labelArtist === null);

  section("SCENARIO K — performance files");
  ok("CAPABILITY_GAP, never 'no files'", /CAPABILITY_GAP/.test(a.performanceFiles) && KNOWLEDGE_GAPS.some((g) => g.id === "SHW_PERFORMANCE_FILES_NOT_READ"));

  section("SCENARIO L — 'נכנסה הופעה לשליו ב-15.10'");
  const l = q("show_portfolio", "event", { artist: `label-artist:${LA_SHALEV}`, date: "2026-10-15" });
  ok("event workflow: asks only missing data, no write", l.status === "OK" && l.items.some((i) => i.id.startsWith("ask:")) && l.summary.some((x) => x.code === "EVENT" && /none/.test(JSON.stringify(x.value))));

  section("2. capabilities + system awareness");
  for (const s of ["identity", "artist", "dj", "money", "ledger", "rehearsals", "calendar", "tasks", "notifications", "portal", "signals", "questions", "history"]) ok(`show_view ${s}`, q("show_view", "view", { show: `show:${PAST}`, section: s }).status === "OK");
  ok("show_view / show_portfolio Owner-only", q("show_view", "view", { show: `show:${PAST}` }, sources(), STRANGER).status !== "OK" && q("show_portfolio", "all", {}, sources(), STRANGER).status !== "OK");
  ok("show_portfolio upcoming / all / signal", q("show_portfolio", "upcoming").status === "OK" && q("show_portfolio", "all").status === "OK" && q("show_portfolio", "signal", { signal: "NO_DJ" }).status === "OK");
  const pf = showPortfolio(sources());
  ok("portfolio: every signal in the model, no ranking", pf.flatMap((r) => r.signals).every((x) => SM.SHOW_SIGNAL_MODEL.some((m) => m.code === x)) && !/"(score|rank)"/.test(JSON.stringify(pf)));
  for (const t of ["fields", "vocabularies", "status_consumers", "lifecycle", "dj", "money", "ledger", "calendar", "notifications", "preparation", "actions", "workflows", "signals", "integrity"]) ok(`system_awareness show_model ${t}`, (q("system_awareness", "show_model", { section: t }) as { items: unknown[] }).items.length > 0);
  const served = JSON.stringify([q("show_view", "view", { show: `show:${PAST}`, section: "money" }), q("show_portfolio", "all"), ...["fields", "lifecycle", "money", "ledger", "actions", "notifications"].map((t) => q("system_awareness", "show_model", { section: t }))]);
  check("no forbidden implementation / secret terms served", FORBIDDEN_SERVED_TERMS.filter((t) => served.toLowerCase().includes(t.toLowerCase())), []);
  ok("baseline -9 + SHOWS / LABEL_DJ entries; depth DEEP_BRAIN_V1; Victor / Steven / Red Films still pending", SYSTEM_BASELINE_VERSION >= "2026.09.25-9" && ["SHOWS", "LABEL_DJ"].every((d) => CAPABILITY_CHANGES.some((x) => x.version === "2026.09.25-9" && x.domain === d) && DOMAIN_KNOWLEDGE_DEPTH[d] === "DEEP_BRAIN_V1") && ["VICTOR", "STEVEN", "RED_FILMS"].every((d) => DOMAIN_KNOWLEDGE_DEPTH[d] === "PENDING_DEEP_MISSION"));
  check("system registry valid", validateSystemRegistry({ capabilityIds: REG.all().map((x) => x.id), knowledgeKinds: KNOWLEDGE_KINDS.map((k) => k.kind) }), []);
  check("gaps valid", validateKnowledgeGaps({ domainIds: DOMAIN_CONTRACTS.map((x) => x.id), capabilityIds: REG.all().map((x) => x.id) }), []);
  const sg = KNOWLEDGE_GAPS.filter((x) => x.id.startsWith("SHW_"));
  ok("show gaps cover the required classes", ["CAPABILITY_GAP", "DATA_MODEL_GAP", "OWNER_DECISION_REQUIRED", "DATA_NOT_RECORDED", "SYSTEM_BEHAVIOR_GAP", "AMBIGUOUS_IDENTITY", "CONFLICTING_SOURCES", "FUTURE_PRIMITIVE_REQUIRED"].every((k) => sg.some((x) => x.class === k)));

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}
main();
