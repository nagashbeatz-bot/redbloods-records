/**
 * Sunny LABEL ARTISTS DEEP BRAIN — coverage guards + reasoning scenarios A–L.
 *
 * Guards (permanent): every label column classified; vocabularies equal what the code declares (roster status,
 * release stages, ledger entry types, show statuses, DJ confirmation, portal slugs); every label / portal / beats
 * API route belongs to a route family; the artist / release / ledger / media / beats / availability server files are
 * unchanged since the last review (LABEL_REVIEWED_FINGERPRINTS); the label detail reader is SELECT-only.
 *
 * Run with:   npx tsx scripts/test-sunny-label-artists.tsx      Pure; never touches production.
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { PARTNER_KNOWLEDGE_REGISTRY } from "../lib/partner/knowledge/catalog";
import { queryKnowledgeCore } from "../lib/partner/knowledge/query";
import type { KnowledgeAudience, QueryResponse } from "../lib/partner/knowledge/types";
import type { GatewayFinance, GatewaySources } from "../lib/partner/gateway/core";
import type { OperationsRaw } from "../lib/partner/operations/types";
import type { ProjectDetailRaw } from "../lib/partner/projects/detail-types";
import type { LabelDetailRaw, DetailShow } from "../lib/partner/label/detail-types";
import { LABEL_DETAIL_SOURCES } from "../lib/partner/label/detail-types";
import type { SettingsState } from "../lib/partner/settings/types";
import type { CalendarWindowResult } from "../lib/partner/calendar/types";
import { deriveFinanceView } from "../lib/partner/finance/view";
import { buildFinanceBrief } from "../lib/partner/finance/brief";
import { artistPortfolio, buildArtistView, cycleWindow } from "../lib/partner/label/view";
import * as LM from "../lib/partner/system/label-artists";
import { DOMAIN_CONTRACTS, FORBIDDEN_SERVED_TERMS, SYSTEM_BASELINE_VERSION, CAPABILITY_CHANGES, validateSystemRegistry } from "../lib/partner/system";
import { DOMAIN_KNOWLEDGE_DEPTH, KNOWLEDGE_GAPS, validateKnowledgeGaps } from "../lib/partner/system/gaps";
import { KNOWLEDGE_KINDS } from "../lib/partner/owner-knowledge/kinds";
import { PORTAL_ARTISTS } from "../lib/red-artists/portal-registry";
import { RELEASE_STAGES, LABEL_ARTIST_STATUSES } from "../lib/types";
import { SHOW_STATUSES, DJ_CONFIRMATION_STATUSES } from "../lib/shows-types";
import { C_AVI, C_CLEAN, C_SHALEV, LA_AVI, LA_CLEAN, LA_NAGASH, LA_SHALEV, NOW, P, U, input } from "./fixtures/integrity-company";
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
const SHOW_PAST = U(401), SHOW_NEXT = U(402), SHOW_DJ = U(403);
const show = (id: string, o: Partial<DetailShow>): DetailShow => ({ id, name: "הופעה", artistText: "שליו טסמה", date: "2026-08-06", startTime: "21:00", location: "תל אביב", contactPerson: null, hasPhone: true, status: "בוצע", paymentStatus: "שולם", price: 3000, djFee: 500, artistFee: 1250, advancePayment: null, notes: null,
  artistClientId: C_SHALEV, bookerClientId: null, bookerName: null, djClientId: C_CLEAN, djName: "DJ CLEANTONE", djConfirmationStatus: "אושר", djConfirmedAt: null, hasCalendarEvent: true, incomeTxId: null, djExpenseTxId: null, artistExpenseTxId: null, createdAt: null, updatedAt: null, ...o });
const LD: LabelDetailRaw = {
  artists: sec([{ id: LA_SHALEV, name: "שליו טסמה", status: "פעיל", hasImage: false, notes: null, createdAt: "2026-07-11T10:00:00Z", updatedAt: null }, { id: LA_AVI, name: "אבי מולה", status: "פעיל", hasImage: true, notes: null, createdAt: "2026-07-28T10:00:00Z", updatedAt: null },
    { id: LA_CLEAN, name: "DJ CLEANTONE", status: "פעיל", hasImage: false, notes: null, createdAt: "2026-07-31T10:00:00Z", updatedAt: null }, { id: LA_NAGASH, name: "נגש ביטס", status: "פעיל", hasImage: true, notes: null, createdAt: "2026-09-21T10:00:00Z", updatedAt: null }]),
  ledger: sec([
    { id: U(1101), artistId: LA_SHALEV, entryType: "הכנסות", amount: 1250, entryDate: "2026-08-06", description: "הופעה - הופעה", note: null, sourceTxId: null, sourceShowId: SHOW_PAST, createdAt: null, updatedAt: null },
    { id: U(1102), artistId: LA_SHALEV, entryType: "תשלומים", amount: 300, entryDate: "2026-08-20", description: "תשלום", note: null, sourceTxId: null, sourceShowId: null, createdAt: null, updatedAt: null },
    { id: U(1103), artistId: LA_SHALEV, entryType: "הוצאות", amount: 100, entryDate: "2026-09-02", description: "אולפן", note: null, sourceTxId: null, sourceShowId: null, createdAt: null, updatedAt: null },
    { id: U(1104), artistId: LA_SHALEV, entryType: "הכנסות צפויות", amount: 500, entryDate: "2026-09-30", description: "הופעה - הבאה", note: null, sourceTxId: U(9001), sourceShowId: null, createdAt: null, updatedAt: null }]),
  cycles: sec([]),
  mediaIncome: sec([{ id: U(1201), artistId: LA_SHALEV, recordType: "income", reversesId: null, grossAmount: 400, source: "Mobile1", reportPeriod: "Q2", receivedDate: "2026-08-15", status: "התקבל", notes: null, labelShare: 200, artistShareGross: 200, recoupBefore: 1000, recouped: 200, artistPayable: 0, recoupAfter: 800, createdAt: "2026-08-15T10:00:00Z", updatedAt: null }]),
  beats: sec([{ id: U(1301), name: "Fire", genre: "dancehall", musicalKey: "A Minor", status: "available", fileName: "fire.wav", path: "/nagashbeatz/beats/fire.wav", durationSeconds: 180, createdAt: null, assignedTo: [{ artistSlug: "shalev-tasama", at: "2026-09-01T10:00:00Z" }] }]),
  shows: sec([show(SHOW_PAST, {}), show(SHOW_NEXT, { date: "2026-10-15", status: "אושרה", paymentStatus: "צפוי", djClientId: null, djName: null, djConfirmationStatus: null }), show(SHOW_DJ, { artistText: "אמן זר", artistClientId: null, date: "2026-10-20", status: "נסגר", paymentStatus: "צפוי", djConfirmationStatus: "ממתין לאישור" })]),
};
const SETTINGS: SettingsState = { families: {
  ARTIST_BALANCE_CYCLE_ANCHOR: sec([{ key: `balance_cycle_anchor:${LA_SHALEV}`, updatedAt: null, value: { anchorDate: "2026-08-01" } }]),
  ARTIST_WEEKLY_AVAILABILITY: sec([{ key: "shalev_weekly_availability", updatedAt: null, value: { days: [{ day: "ראשון", date: "2026-09-27", available: true, from: "12:00" }], sentBy: "shalev", sentAt: "2026-09-24T08:00:00Z" } }]),
  PORTAL_PRESENCE: sec([{ key: "shalev_entry_last", updatedAt: null, value: { at: "2026-09-24T07:00:00Z" } }]),
  SHOW_SENT_TO_ARTIST: sec([{ key: `show_notify:${SHOW_PAST}`, updatedAt: null, value: {} }]),
  SHOW_SENT_TO_DJ: sec([]), AVAILABILITY_REMINDER_SENT: sec([]),
} };
const cal: CalendarWindowResult = { status: "CALENDAR_DATA_AVAILABLE", window: { start: "2026-09-17T00:00:00+03:00", end: "2026-10-31T23:59:59+02:00", days: 45 }, fetchedAt: NOW.toISOString(), cache: "MISS", calendars: [], truncated: false, reasons: [], events: [] };

interface Opt { victorInternal?: string; engineerOn?: string; cal?: "NONE"; settings?: "NONE"; labelDetail?: "NONE" }
function sources(o: Opt = {}): GatewaySources {
  const st = input({ contexts: [] }).state!;
  if (o.victorInternal) for (const w of st.domains.victor.data?.active ?? []) (w as { internalDeadline: string | null }).internalDeadline = o.victorInternal;
  const ops: OperationsRaw = {
    redFilms: sec([{ id: U(801), title: "קליפ שליו", productionType: "קליפ", status: "בעריכה", projectId: null, clientId: null, artistName: "שליו טסמה", clientSource: "פנימי - לייבל", shootDate: "2026-09-20", publishDate: null, editStatus: "בעריכה", collectionStatus: null, generalBudget: 8000, clientPrice: null, advanceRequired: null, advanceReceived: null }]),
    budgetPayments: sec([]), clipItems: sec([]), meetings: sec([]), finalFiles: sec([]), deliveries: sec([]), projectActions: sec([]), projectsMeta: sec([]), budgetItems: sec([]), equipment: sec([]), beats: sec([]), beatAssignments: sec([]),
    campaigns: sec([{ id: U(811), projectId: P(1), title: "קמפיין שיר", artistName: "שליו טסמה", releaseDate: "2026-10-05", status: "פעיל", promotionBudget: null }]), contentItems: sec([{ campaignId: U(811), status: "טיוטה", contentType: "רילס", platform: "instagram", dueDate: "2026-10-01", publishDate: null }]),
    promotions: sec([]), balanceCycles: sec([]), albumTracks: sec([]),
    engineerWork: sec(o.engineerOn ? [{ id: U(851), projectId: o.engineerOn, engineerName: "Steven", workType: "מיקס", workTitle: null, status: "בתהליך", sentDate: "2026-09-10", internalDeadline: "2026-09-30", agreedPrice: 200, amountPaid: 0, currency: "$", paymentDate: null }] : []),
    mixVersions: sec(o.engineerOn ? [{ id: U(861), workId: U(851), status: "בבדיקה", createdAt: "2026-09-18T10:00:00Z" }] : []),
    mixComments: sec(o.engineerOn ? [{ versionId: U(861), status: "open" }, { versionId: U(861), status: "resolved" }] : []),
    integrations: { googleCalendarConnected: true, dropboxConnected: true },
  };
  const det: ProjectDetailRaw = { ...EMPTY,
    sessions: sec([{ id: U(901), projectId: P(1), showId: null, date: "2026-09-28", startTime: "12:00", endTime: "15:00", status: "מתוכנן", type: "סשן", title: null, notes: null, location: null, photographer: null, cost: null, hasCalendarEvent: true, createdAt: null },
      { id: U(902), projectId: null, showId: SHOW_NEXT, date: "2026-10-12", startTime: "18:00", endTime: "20:00", status: "מתוכנן", type: "חזרה להופעה", title: "חזרה", notes: null, location: null, photographer: null, cost: 200, hasCalendarEvent: true, createdAt: null }]),
    releases: sec([{ projectId: P(1), nextAction: "להקליט שירה", blocker: "", responsible: "שליו", stageEnteredAt: "2026-09-01T10:00:00Z", releasedAt: null }]) };
  const raw = empty({ transactions: [tx({ projectId: P(1), type: "income", amount: 1000, status: "התקבל" }), tx({ projectId: P(1), type: "income", amount: 100, currency: "$", status: "התקבל" }), tx({ projectId: P(2), type: "income", amount: 700, status: "התקבל" })],
    financeSettings: [{ projectId: P(1), value: { agreedPrice: 2000, currency: "₪" } }, { projectId: P(2), value: { agreedPrice: 1500, currency: "₪" } }] });
  const view = deriveFinanceView(raw, NOW, []);
  const f: GatewayFinance = { state: view.state, integrity: view.integrity, actions: view.actions, raw, brief: buildFinanceBrief(view.state, view.integrity, { answersAvailable: true, actionNoteHe: view.actionNoteHe }), answersAvailable: true };
  return { now: NOW, state: { status: "OK", value: st }, finance: { status: "OK", value: f }, identities: { cleantone: { clientId: C_CLEAN, labelArtistName: "DJ CLEANTONE" } },
    cases: { status: "OK", value: [] }, actions: { status: "OK", value: [] }, outcomes: { status: "OK", value: [] }, ownerKnowledge: { status: "OK", value: [] },
    projectDetail: { status: "OK", value: det }, operations: { status: "OK", value: ops },
    ...(o.labelDetail === "NONE" ? {} : { labelDetail: { status: "OK" as const, value: LD } }),
    ...(o.settings === "NONE" ? {} : { settings: { status: "OK" as const, value: SETTINGS } }),
    ...(o.cal === "NONE" ? {} : { calendar: { status: "OK" as const, value: cal } }) };
}
const q = (capability: string, mode: string, params: Record<string, string> = {}, src = sources(), aud = OWNER): QueryResponse => queryKnowledgeCore(REG, { capability, mode, params }, src, aud);
const codes = (v: ReturnType<typeof buildArtistView>) => (v?.signals ?? []).map((s) => s.code);

function main() {
  section("1. coverage — schema, vocabularies, routes, fingerprints");
  for (const [table, cols] of Object.entries(LM.LABEL_SCHEMA_COLUMNS)) check(`every ${LM.LABEL_ENTITY_OF[table]} column has a field contract`, LM.LABEL_FIELDS.filter((f) => f.entity === LM.LABEL_ENTITY_OF[table]).map((f) => f.field).sort(), [...cols].sort());
  ok("every field fully described", LM.LABEL_FIELDS.every((f) => [f.meaning, f.validation, f.writers, f.readers, f.history, f.sunnyReads].every((x) => x.trim().length > 0)));
  check("release stages = the code", [...LM.LABEL_VOCABULARIES.releaseStages], [...RELEASE_STAGES]);
  check("roster statuses = the code", [...LM.LABEL_VOCABULARIES.artistStatuses], [...LABEL_ARTIST_STATUSES]);
  check("ledger entry types = the code", [...LM.LABEL_VOCABULARIES.ledgerEntryTypes], [...(/BALANCE_ENTRY_TYPES = \[([^\]]+)\]/.exec(read("lib/artist-balance-store.ts"))![1].match(/"([^"]+)"/g) ?? []).map((x) => x.slice(1, -1))]);
  check("show statuses = the code", [...LM.LABEL_VOCABULARIES.showStatuses], [...SHOW_STATUSES]);
  check("DJ confirmation = the code", [...LM.LABEL_VOCABULARIES.djConfirmationStatuses], [...DJ_CONFIRMATION_STATUSES]);
  check("portal slugs = the app's name → slug table", LM.LABEL_VOCABULARIES.portalSlugs, Object.fromEntries(Object.entries(PORTAL_ARTISTS).map(([k, v]) => [k, v.slug])));
  const walk = (d: string): string[] => fs.readdirSync(path.join(ROOT, d), { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(`${d}/${e.name}`) : e.name === "route.ts" ? [`${d}/${e.name}`] : []);
  const labelRoutes = walk("app/api").filter((f) => /^app\/api\/(label|red-artists|beats)\//.test(f) || /\.from\(\s*["'](label_artists|project_release_details|artist_balance_entries|artist_balance_cycles|label_media_income|beats|beat_artist_assignments)["']\)|label-artists-store|release-store|artist-balance|media-income-store|beats-store|red-artists\//.test(read(f)));
  check("every label / portal / beats route belongs to a route family", labelRoutes.filter((f) => !LM.LABEL_ROUTE_GROUPS.some((g) => new RegExp(g.pattern).test(f))), []);
  ok("route inventory is substantial (≥ 80 routes)", labelRoutes.length >= 80);
  for (const [f, want] of Object.entries(LM.LABEL_REVIEWED_FINGERPRINTS)) check(`${f} unchanged since the last Sunny label review (update lib/partner/system/label-artists.ts + fingerprint together)`, createHash("sha256").update(read(f).replace(/\r\n/g, "\n")).digest("hex"), want);
  ok("every label action names existing routes", LM.LABEL_ACTIONS.every((a) => a.internal.routes.length > 0 && a.internal.routes.every((r) => fs.existsSync(path.join(ROOT, r)))));
  ok("no label action executable by Sunny today", LM.LABEL_ACTIONS.every((a) => a.sunnyToday === "KNOWLEDGE_ONLY"));
  ok("destructive actions carry the DESTRUCTIVE class", LM.LABEL_ACTIONS.filter((a) => a.destructive && a.area === "BEATS").every((a) => a.approvalClass === "DESTRUCTIVE"));
  ok("every artist push is mapped with a source and dedupe; Sunny never sends", LM.ARTIST_PUSHES.length >= 14 && LM.ARTIST_PUSHES.every((p) => p.source && p.dedupe));
  ok("18 workflows classified", LM.ARTIST_WORKFLOWS.length === 18 && LM.ARTIST_WORKFLOWS.every((w) => ["SUPPORTED", "PARTIAL", "NOT_SUPPORTED"].includes(w.support)));
  const reader = code(read("lib/partner/label/detail-reader.ts"));
  ok("label detail reader is SELECT-only, scrubs text, hides image URL / phone", !/\.(insert|update|upsert|delete|rpc)\(/.test(reader) && /scrubSecrets/.test(reader) && /hasImage: has\(x\.image_url\)/.test(reader) && /hasPhone: has\(x\.phone\)/.test(reader) && LABEL_DETAIL_SOURCES.length === 7);
  ok("pure view: no DB / fetch / write / push path", !/supabase|fetch\(|\.insert\(|\.update\(|\.upsert\(|\.delete\(|sendPush/.test(code(read("lib/partner/label/view.ts") + read("lib/partner/knowledge/capabilities/label-deep.ts"))));
  check("cycle window rule (anchor + 2 months, current = max(today, closed))", [cycleWindow("2026-08-01", "2026-09-24", 0), cycleWindow("2026-08-01", "2026-09-24", 1).index, cycleWindow("2026-08-01", "2026-10-01", 0).index], [{ index: 0, start: "2026-08-01", endExclusive: "2026-10-01" }, 1, 1]);

  section("SCENARIO A — 'מה קורה עם שליו?'");
  const a = buildArtistView(sources(), LA_SHALEV)!;
  ok("cross-domain summary: projects, releases, sessions, shows, money, visual content", a.projects.length > 0 && a.releases.length === 1 && a.sessions.length === 2 && a.shows.length === 2 && !!a.money.ledger && a.redFilms.length === 1 && a.social.length === 1);
  check("ledger balance = income − payments − expenses (expected not counted)", a.money.ledger!.allTime, { income: 1250, expectedIncome: 500, payments: 300, expenses: 100, expectedExpenses: 0, balance: 850 });
  ok("next release with next action + responsible", a.nextRelease?.stage === "רעיון" && a.nextSteps.some((s) => /להקליט שירה/.test(s.evidence) && /שליו/.test(s.evidence)));
  ok("availability + presence from settings", (a.availability as { state: string }).state === "RECORDED" && (a.presence as { lastPortalEntry?: string }).lastPortalEntry === "2026-09-24T07:00:00Z");
  ok("beats by portal slug (DERIVED)", a.beats.length === 1 && /DERIVED/.test(a.beats[0].link));
  ok("media income with stored recoup snapshot, never touching the ledger", a.money.mediaIncome.receivedArtistShare === 200 && a.money.mediaIncome.lastRecoupAfter === 800 && /never touches the ledger/.test(a.money.mediaIncome.note));
  ok("current cycle from the anchor", a.money.cycles.current?.start === "2026-08-01" && a.money.cycles.current?.totals.balance === 850);
  const qa = q("artist_view", "view", { artist: `label-artist:${LA_SHALEV}` });
  ok("artist_view summary served", qa.status === "OK" && qa.summary.some((f) => f.code === "LEDGER_BALANCE"));

  section("SCENARIO B — 'מה קורה עם אבי?'");
  const b = buildArtistView(sources(), LA_AVI)!;
  ok("Avi: projects by name, Victor work visible, portal = avi login", b.projects.some((p) => p.id === P(2) && (p.victor?.length ?? 0) > 0) && b.identity.portal.loginRole === "avi");
  ok("Avi has no ledger rows → ledger totals zero, never invented", b.money.ledger!.entries === 0);

  section("SCENARIO C — Victor holds an artist project; his internal deadline passed");
  const c = buildArtistView(sources({ victorInternal: "2026-09-20" }), LA_AVI)!;
  const s = c.signals.find((x) => x.code === "INTERNAL_DEADLINE_PASSED");
  ok("internal expectation, not a client commitment", !!s && /לא התחייבות ללקוח/.test(s.he) && codes(c).includes("WAITING_PRODUCTION"));

  section("SCENARIO D — mix with Steven, unresolved comments");
  const d = buildArtistView(sources({ engineerOn: P(1) }), LA_SHALEV)!;
  const wm = d.signals.find((x) => x.code === "WAITING_MIX");
  ok("handoff = engineer, with open comment evidence", !!wm && /Steven/.test(wm.he) && /1 הערות פתוחות/.test(wm.he) && d.nextSteps.some((n) => /מיקס/.test(n.step)));

  section("SCENARIO E — no recorded activity, no upcoming release / session");
  const e = buildArtistView(sources(), LA_NAGASH)!;
  const ns = e.signals.find((x) => x.code === "NO_UPCOMING_RECORDED_WORK");
  ok("evidence without judgement", !!ns && /לא שיפוט/.test(ns.he) && !/lazy|עצלן|בעייתי|underperform/i.test(JSON.stringify(e.signals)));
  ok("asks the Owner for the plan", e.questions.some((x) => x.kind === "ARTIST_PLAN"));

  section("SCENARIO F — same person has client work: money stays separate");
  const f = buildArtistView(sources(), LA_AVI)!;
  const aviProj = f.projects.find((p) => p.id === P(2))!;
  ok("client-work project is not label work (no Owner classification / release / stored לייבל)", aviProj.labelWork === false && aviProj.labelBasis === "CLIENT_WORK_OR_UNCLASSIFIED");
  ok("client income (700) never appears as artist money", !JSON.stringify(f.money.labelWorkProjects).includes("700") && f.money.ledger!.allTime.income === 0);

  section("SCENARIO G — new show without a DJ");
  const g = buildArtistView(sources(), LA_SHALEV)!;
  const ng = g.shows.find((x) => x.key === `show:${SHOW_NEXT}`)!;
  ok("no DJ auto-assigned; asks", ng.dj === null && codes(g).includes("SHOW_WITHOUT_DJ") && g.questions.some((x) => x.kind === "SHOW_DJ"));
  ok("rehearsal + sent markers + split read", ng.rehearsals.length === 1 && ng.sentToArtist === "NOT_SENT" && g.shows.find((x) => x.key === `show:${SHOW_PAST}`)!.sentToArtist === "SENT");
  const cl = buildArtistView(sources(), LA_CLEAN)!;
  ok("CLEANTONE: his DJ shows by the canonical client id (incl. another artist's show)", cl.shows.some((x) => x.role === "DJ" && x.key === `show:${SHOW_DJ}` && /CANONICAL/.test(x.link)) && !!cl.identity.labelDj);

  section("SCENARIO H — artist also has a client record");
  ok("roles kept separate", a.identity.clientRecords.length === 1 && /never merged/.test(a.identity.clientRecords[0].link) && codes(a).includes("IDENTITY_DUAL_ROLE"));

  section("SCENARIO I — calendar unavailable");
  ok("UNKNOWN, never 'no events'", /never 'nothing scheduled'/.test(JSON.stringify(buildArtistView(sources({ cal: "NONE" }), LA_SHALEV)!.calendar)));
  ok("label detail missing → PARTIAL, never empty money", q("artist_view", "view", { artist: `label-artist:${LA_SHALEV}` }, sources({ labelDetail: "NONE" })).completeness !== "COMPLETE");

  section("SCENARIO J — relationship quality explicit");
  ok("release link CANONICAL; name links TEXT_MATCH; collaboration flagged", a.projects.find((p) => p.id === P(1))!.quality === "CANONICAL_RELATION" && b.projects.find((p) => p.id === P(2))!.quality === "TEXT_MATCH" && b.projects.some((p) => p.basis === "NAME_COLLABORATION"));

  section("SCENARIO K — ₪ and $ never mixed");
  ok("label-work project money split per currency", !!a.money.labelWorkProjects && !!a.money.labelWorkProjects["₪"] && Object.keys(a.money.labelWorkProjects).length >= 1 && /NO currency/.test(a.money.currencyRule));
  ok("show / ledger amounts marked currency NOT_STORED", a.shows.every((x) => /NOT_STORED/.test(x.currency)));

  section("SCENARIO L — 'מה הדבר הבא שצריך לקרות עם האמן?'");
  const l = q("artist_view", "view", { artist: `label-artist:${LA_SHALEV}`, section: "next_steps" });
  ok("evidence-based steps, no score", l.status === "OK" && l.items.length >= 2 && !/"(score|rank|priority)"/.test(JSON.stringify(l.items)));

  section("2. portfolio + capabilities + system awareness");
  const pf = artistPortfolio(sources());
  ok("roster of 4, sorted by name, no ranking", pf.length === 4 && !/"(score|rank)"/.test(JSON.stringify(pf)));
  ok("every emitted signal is in the signal model", pf.flatMap((r) => r.signals).every((x) => LM.ARTIST_SIGNAL_MODEL.some((m) => m.code === x)));
  for (const sname of ["identity", "projects", "releases", "next_steps", "beats", "shows", "money", "sessions", "calendar", "tasks", "meetings", "visual_content", "availability", "presence", "portal", "owner_knowledge", "signals", "questions", "history"]) ok(`artist_view ${sname}`, q("artist_view", "view", { artist: `label-artist:${LA_SHALEV}`, section: sname }).status === "OK");
  ok("artist_view / artist_portfolio are Owner-only", q("artist_view", "view", { artist: `label-artist:${LA_SHALEV}` }, sources(), STRANGER).status !== "OK" && q("artist_portfolio", "roster", {}, sources(), STRANGER).status !== "OK");
  ok("artist_portfolio roster + signal", q("artist_portfolio", "roster").status === "OK" && q("artist_portfolio", "signal", { signal: "NO_UPCOMING_RECORDED_WORK" }).status === "OK");
  for (const t of ["fields", "vocabularies", "membership", "links", "releases", "money", "portal", "availability", "presence", "pushes", "actions", "workflows", "signals", "integrity"]) ok(`system_awareness artist_model ${t}`, (q("system_awareness", "artist_model", { section: t }) as { items: unknown[] }).items.length > 0);
  const served = JSON.stringify([qa, q("artist_portfolio", "roster"), ...["fields", "links", "money", "pushes", "actions"].map((t) => q("system_awareness", "artist_model", { section: t }))]);
  check("no forbidden implementation / secret terms served", FORBIDDEN_SERVED_TERMS.filter((t) => served.toLowerCase().includes(t.toLowerCase())), []);
  ok("no image URL / phone / share link served", !/https?:\/\/|dropbox\.com\/s|050-/.test(served.replace(/\\"/g, "")));
  ok("baseline -8 + LABEL_ARTISTS change entry", ((v) => v.date > "2026.09.25" || (v.date === "2026.09.25" && v.n >= 8))({ date: SYSTEM_BASELINE_VERSION.split("-")[0], n: Number(SYSTEM_BASELINE_VERSION.split("-")[1]) }) && CAPABILITY_CHANGES.some((x) => x.version === "2026.09.25-8" && x.domain === "LABEL_ARTISTS"));
  ok("LABEL_ARTISTS = DEEP_BRAIN_V1; Steven / Red Films NOT marked complete by the artist mission", DOMAIN_KNOWLEDGE_DEPTH.LABEL_ARTISTS === "DEEP_BRAIN_V1" && ["RED_FILMS"].every((d) => DOMAIN_KNOWLEDGE_DEPTH[d] === "PENDING_DEEP_MISSION"));
  ok("label domains read artist_view", ["LABEL_ARTISTS", "RELEASES", "ARTIST_BALANCES", "MEDIA_INCOME", "BEATS", "ARTIST_PORTALS"].every((dd) => DOMAIN_CONTRACTS.find((x) => x.id === dd)!.readCapabilities.includes("artist_view")));
  check("system registry valid", validateSystemRegistry({ capabilityIds: REG.all().map((x) => x.id), knowledgeKinds: KNOWLEDGE_KINDS.map((k) => k.kind) }), []);
  check("gaps valid", validateKnowledgeGaps({ domainIds: DOMAIN_CONTRACTS.map((x) => x.id), capabilityIds: REG.all().map((x) => x.id) }), []);
  const lg = KNOWLEDGE_GAPS.filter((x) => x.id.startsWith("LBL_"));
  ok("label gaps cover the required classes", ["CAPABILITY_GAP", "DATA_MODEL_GAP", "CONFLICTING_SOURCES", "SYSTEM_BEHAVIOR_GAP", "OWNER_DECISION_REQUIRED", "AMBIGUOUS_IDENTITY", "DATA_NOT_RECORDED", "FUTURE_PRIMITIVE_REQUIRED"].every((k) => lg.some((x) => x.class === k)));

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}
main();
