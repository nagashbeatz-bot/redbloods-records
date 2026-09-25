/**
 * Sunny RED FILMS + CLIP / VIDEO DEEP BRAIN — coverage guards + reasoning scenarios A–Z.
 *
 * Guards (permanent):
 *   - every column of the ten video tables is classified;
 *   - the vocabularies equal the Red Films / project drawer / clip-finance code;
 *   - every video route belongs to a family and every mutating route is an inventoried action;
 *   - every writer of expense scope קליפ is known;
 *   - the reviewed files are unchanged (RF_REVIEWED_FINGERPRINTS);
 *   - the view reuses the app's clip-deal math and the Finance validation.
 * The view is pure.
 *
 * Run with:   npx tsx scripts/test-sunny-red-films.tsx      Pure; never touches production.
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { PARTNER_KNOWLEDGE_REGISTRY } from "../lib/partner/knowledge/catalog";
import { queryKnowledgeCore } from "../lib/partner/knowledge/query";
import type { KnowledgeAudience, QueryResponse } from "../lib/partner/knowledge/types";
import type { GatewayFinance, GatewaySources } from "../lib/partner/gateway/core";
import type { OperationsRaw, OpsRedFilmsProduction } from "../lib/partner/operations/types";
import type { ProjectDetailRaw, DetailProduction, DetailSession, DetailContentItem } from "../lib/partner/projects/detail-types";
import type { FinanceRaw } from "../lib/partner/finance/types";
import { deriveFinanceView } from "../lib/partner/finance/view";
import { buildFinanceBrief } from "../lib/partner/finance/brief";
import { buildVideoView } from "../lib/partner/redfilms/view";
import * as RF from "../lib/partner/system/red-films";
import { SECURITY_GAPS } from "../lib/partner/system/people";
import { DOMAIN_CONTRACTS, FORBIDDEN_SERVED_TERMS, CAPABILITY_CHANGES, validateSystemRegistry } from "../lib/partner/system";
import { DOMAIN_KNOWLEDGE_DEPTH, KNOWLEDGE_GAPS, validateKnowledgeGaps } from "../lib/partner/system/gaps";
import { KNOWLEDGE_KINDS } from "../lib/partner/owner-knowledge/kinds";
import { CLIP_PAYMENT_STATUSES } from "../lib/clip-finance";
import { NOW, P, U, input } from "./fixtures/integrity-company";
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
const walk = (d: string): string[] => fs.existsSync(path.join(ROOT, d)) ? fs.readdirSync(path.join(ROOT, d), { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(`${d}/${e.name}`) : e.name === "route.ts" ? [`${d}/${e.name}`] : []) : [];
const arr = (src: string, re: RegExp) => JSON.parse(`[${re.exec(src)![1].replace(/\s+/g, " ").replace(/,\s*$/, "")}]`) as string[];

// ── fixture ──
const sec = <T,>(rows: T[]) => ({ rows, capped: false });
const EMPTY = Object.fromEntries(["projects", "financeNotes", "deliveries", "actions", "sessions", "meetings", "tasks", "engineerWork", "mixVersions", "mixComments", "commentAttachments", "mixTargets", "mixTargetNotes", "finalFiles", "victor", "productions", "budgetItems", "albumTracks", "clipItems", "proposals", "releases", "campaigns", "contentItems", "socialFiles", "projectSettings", "transactionsText", "budgetPayments", "agentAlerts", "notifications"].map((k) => [k, { rows: [], capped: false }])) as unknown as ProjectDetailRaw;
const PR_MAIN = U(301), PR_NOPROJ = U(302), PR_DUP_A = U(303), PR_DUP_B = U(304), PR_NODATE = U(305);
const prod = (id: string, o: Partial<OpsRedFilmsProduction>): OpsRedFilmsProduction => ({ id, title: "קליפ", productionType: "קליפ", status: "בתכנון", projectId: null, clientId: null, artistName: "אבי מולה", clientSource: "פנימי - לייבל", shootDate: null, publishDate: null, editStatus: "לא התחיל", collectionStatus: "לא רלוונטי", generalBudget: 5000, clientPrice: 0, advanceRequired: 0, advanceReceived: 0, ...o });
const dprod = (id: string, o: Partial<DetailProduction> = {}): DetailProduction => ({ id, projectId: null, clientNameSnapshot: null, createdAt: "2026-09-01T10:00:00Z", updatedAt: "2026-09-10T10:00:00Z", photographer: "צלם א", director: null, editor: null, locations: null, conceptSummary: "קונספט", conceptVibe: null,
  script: { start: null, middle: null, end: null }, directorNotes: null, photographerNotes: null, fixNotes: null, notes: null, publishedWhere: null, dropboxFolderPath: "/Red Films/x", links: { references: false, rawFiles: false, editFolder: false, version1: false, version2: false, finalVersion: false, folder: true }, ...o });
const sess = (id: number, projectId: string, date: string, o: Partial<DetailSession> = {}): DetailSession => ({ id: U(id), projectId, showId: null, date, startTime: "10:00", endTime: "18:00", status: "מתוכנן", type: "צילום קליפ", title: null, notes: null, location: "חוף", photographer: "צלם א", cost: null, hasCalendarEvent: true, createdAt: null, ...o });
const content = (projectId: string, posted: boolean): DetailContentItem => ({ id: U(990), projectId, campaignId: null, title: "קליפ בסושיאל", contentType: "וידאו", status: "פורסם", platform: "Instagram", dueDate: null, publishDate: "2026-09-20", caption: null, hook: null, notes: null, ownerName: null, postedUrl: posted ? "https://instagram.com/p/x" : null, hasAssetLink: false, hasCalendarEvent: false, taskId: null, publishTime: null, createdAt: null, updatedAt: null });
function sources(): GatewaySources {
  const st = input({ contexts: [] }).state!;
  const ops = { integrations: { googleCalendarConnected: true, dropboxConnected: true }, redFilms: sec([
    prod(PR_MAIN, { title: "קליפ אבי", projectId: P(2), shootDate: "2026-09-10", status: "בתכנון" }),
    prod(PR_NOPROJ, { title: "פרסומת", productionType: "פרסומת", projectId: null }),
    prod(PR_DUP_A, { title: "נגש ישן", projectId: P(4), status: "בוטל" }),
    prod(PR_DUP_B, { title: "נגש", projectId: P(4), status: "רעיון" }),
    prod(PR_NODATE, { title: "לייבל בלי תאריך", projectId: P(1), status: "בתכנון", shootDate: null }),
  ]) } as unknown as OperationsRaw;
  const det: ProjectDetailRaw = { ...EMPTY,
    productions: sec([dprod(PR_MAIN, { projectId: P(2) }), dprod(PR_NOPROJ), dprod(PR_DUP_A, { projectId: P(4) }), dprod(PR_DUP_B, { projectId: P(4) }), dprod(PR_NODATE, { projectId: P(1), director: "במאי ב" })]),
    budgetItems: sec([{ id: U(401), productionId: PR_MAIN, linkedTransactionId: null, createdAt: null, updatedAt: null, title: "צלם", category: "צלם", vendorName: null, status: "מתוכנן", planned: 2000, actual: 500, notes: null }]),
    budgetPayments: sec([{ productionId: PR_MAIN, budgetItemId: U(401), amount: 1200, date: "2026-09-05", method: "ביט", notes: null, receiptFileName: "r.pdf", receiptMime: "application/pdf", receiptPath: "/Red Films/x/r.pdf", hasReceiptLink: true, createdAt: null, updatedAt: null }]),
    rfDocuments: sec([{ id: U(501), productionId: PR_MAIN, fileName: "script.pdf", fileType: "תסריט", mimeType: "application/pdf", path: "/Red Films/x/docs/script.pdf", hasPublicLink: true, notes: null, createdAt: "2026-09-02T10:00:00Z", updatedAt: null }]),
    rfCrew: sec([]), rfRefImages: sec([]), rfRefLinks: sec([]), rfScenes: sec([]), rfEquipment: sec([]),
    sessions: sec([sess(601, P(2), "2026-09-08", { status: "התקיים" }), sess(602, P(2), "2026-09-25"), sess(603, P(5), "2026-09-20", { status: "מתוכנן", hasCalendarEvent: true })]),
    tasks: sec([{ id: U(701), relatedType: "red_film_production", relatedId: PR_MAIN, title: "להזמין לוקיישן", notes: null, status: "פתוח", dueDate: "2026-09-26", startTime: null, endTime: null, showId: null, hasGoogleTask: false, createdAt: null, updatedAt: null }]),
    clipItems: sec([
      { id: U(801), projectId: P(3), category: "לוקיישן", description: "לוקיישן", notes: null, status: "תכנון בלבד", createdAt: null, updatedAt: null, amount: 1000, currency: "₪", linkedTransactionId: null },
      { id: U(802), projectId: P(2), category: "צילום קליפ", description: "צלם", notes: null, status: "הועבר לכספים", createdAt: null, updatedAt: null, amount: 900, currency: "₪", linkedTransactionId: "tx-promoted" },
      { id: U(803), projectId: P(2), category: "תאורה", description: "תאורה", notes: null, status: "הועבר לכספים", createdAt: null, updatedAt: null, amount: 400, currency: "₪", linkedTransactionId: "tx-gone" },
    ]),
    contentItems: sec([content(P(4), true)]),
  };
  const raw: FinanceRaw = empty({ transactions: [
    tx({ id: "tx-promoted", projectId: P(2), type: "expense", amount: 1100, currency: "₪", status: "לא שולם", category: "צילום קליפ", scope: "project", expenseScope: "קליפ", date: "2026-09-06" }),
    tx({ id: "tx-shoot", projectId: P(2), type: "expense", amount: 300, currency: "$", status: "שולם", category: "צילום קליפ", scope: "project", expenseScope: "קליפ", date: "2026-09-08", linkedSessionId: U(601) }),
    tx({ id: "tx-manual", projectId: P(5), type: "expense", amount: 700, currency: "₪", status: "התקבל", category: "אחר", scope: "project", expenseScope: "קליפ", date: "2026-09-09" }),
    tx({ id: "tx-clip-in-1", projectId: P(2), type: "income", amount: 1500, currency: "₪", status: "התקבל", category: "מקדמה", scope: "project", expenseScope: "קליפ", date: "2026-09-01" }),
    tx({ id: "tx-clip-in-2", projectId: P(2), type: "income", amount: 2000, currency: "₪", status: "צפוי", category: "תשלום סופי", scope: "project", expenseScope: "קליפ", date: "2026-10-01" }),
  ], financeSettings: [{ projectId: P(2), value: { agreedPrice: 5000, clipAgreedPrice: 3500 } }] });
  const view = deriveFinanceView(raw, NOW, []);
  const f: GatewayFinance = { state: view.state, integrity: view.integrity, actions: view.actions, raw, brief: buildFinanceBrief(view.state, view.integrity, { answersAvailable: true, actionNoteHe: view.actionNoteHe }), answersAvailable: true };
  return { now: NOW, state: { status: "OK", value: st }, finance: { status: "OK", value: f }, identities: { cleantone: null },
    cases: { status: "OK", value: [] }, actions: { status: "OK", value: [] }, outcomes: { status: "OK", value: [] }, ownerKnowledge: { status: "OK", value: [] },
    projectDetail: { status: "OK", value: det }, operations: { status: "OK", value: ops }, settings: { status: "OK", value: { families: {} } } };
}
const q = (capability: string, mode: string, params: Record<string, string> = {}, aud = OWNER): QueryResponse => queryKnowledgeCore(REG, { capability, mode, params }, sources(), aud);

function main() {
  section("1. coverage — schema, vocabularies, routes, expense-scope writers, fingerprints, reuse");
  const served = new Set(RF.RF_FIELDS.map((f) => `${RF.RF_ENTITY_TABLE[f.entity]}.${f.field}`));
  const schema = Object.entries(RF.RF_SCHEMA).flatMap(([t, cols]) => cols.map((c) => `${t}.${c}`));
  check("every column of the ten video tables is classified (and nothing extra)", [schema.filter((k) => !served.has(k)), [...served].filter((k) => !schema.includes(k))], [[], []]);
  ok("the detail source reads every Red Films table", ["red_films_crew", "red_films_documents", "red_films_scenes", "red_films_reference_images", "red_films_reference_links", "red_films_equipment", "red_films_productions", "red_films_budget_items", "red_films_budget_payments", "clip_items"].every((t) => read("lib/partner/projects/detail-reader.ts").includes(`r("${t}"`)));
  const badge = read("components/red-films/RedFilmsStatusBadge.tsx");
  check("production status = the code", [...RF.RF_VOCABULARIES.productionStatus], arr(badge, /export const PRODUCTION_STATUSES = \[([^\]]+)\]/));
  check("production type = the code", [...RF.RF_VOCABULARIES.productionType], arr(badge, /export const PRODUCTION_TYPES = \[([^\]]+)\]/));
  check("collection status = the code", [...RF.RF_VOCABULARIES.collectionStatus], arr(badge, /export const COLLECTION_STATUSES = \[([^\]]+)\]/));
  check("edit status = the code", [...RF.RF_VOCABULARIES.editStatus], arr(badge, /export const EDIT_STATUSES = \[([^\]]+)\]/));
  check("client source = the code", [...RF.RF_VOCABULARIES.clientSource], arr(badge, /export const CLIENT_SOURCES = \[([^\]]+)\]/));
  const bi = read("components/red-films/RedFilmsBudgetItems.tsx");
  check("budget line statuses / categories = the code", [[...RF.RF_VOCABULARIES.budgetItemStatus], [...RF.RF_VOCABULARIES.budgetItemCategory]], [arr(bi, /const ITEM_STATUSES = \[([^\]]+)\]/), arr(bi, /const CATEGORIES = \[([^\]]+)\]/)]);
  check("document types = the code", [...RF.RF_VOCABULARIES.documentType], arr(read("components/red-films/RedFilmsDocuments.tsx"), /const FILE_TYPES = \[([^\]]+)\]/));
  check("equipment categories = the code", [...RF.RF_VOCABULARIES.equipmentCategory], arr(read("components/red-films/RedFilmsEquipment.tsx"), /export const EQUIPMENT_CATEGORIES = \[([^\]]+)\]/));
  check("clip planning categories = the project drawer", [...RF.RF_VOCABULARIES.clipItemCategory], arr(read("components/ui/ProjectDrawer.tsx"), /const CLIP_EXPENSE_CATS = \[([^\]]+)\]/));
  check("clip payment statuses = clip-finance", [...RF.RF_VOCABULARIES.clipPaymentStatus], [...CLIP_PAYMENT_STATUSES]);
  const routes = [...walk("app/api/red-films"), ...walk("app/api/clip-items"), ...walk("app/api/projects/[id]/clip")];
  ok(`every video route belongs to a family (${routes.length})`, routes.every((r) => RF.RF_ROUTE_GROUPS.some((g) => new RegExp(g.pattern).test(r))));
  const actionRoutes = new Set([...RF.RF_ACTIONS.flatMap((a) => a.internal.routes), ...RF.RF_READ_ROUTES]);
  check("every video route is an inventoried action or a known read route", routes.filter((r) => !actionRoutes.has(r)), []);
  ok("every action route exists; no action is executable by Sunny", RF.RF_ACTIONS.every((a) => a.internal.routes.every((r) => fs.existsSync(path.join(ROOT, r))) && a.sunnyToday === "KNOWLEDGE_ONLY"));
  const scopeWriters = [...walk("app/api"), ...fs.readdirSync(path.join(ROOT, "components/ui")).map((f) => `components/ui/${f}`)].filter((f) => fs.statSync(path.join(ROOT, f)).isFile() && /expense_?[sS]cope:\s*(CLIP_SCOPE|"קליפ")|expenseScope:\s*"קליפ"/.test(code(read(f))));
  check("the known writers of expense scope קליפ (promote, clip payments, shoot-day expense)", scopeWriters.sort(), ["app/api/clip-items/[id]/promote/route.ts", "app/api/projects/[id]/clip/payments/route.ts", "components/ui/ProjectDrawer.tsx", "components/ui/ProjectDrawerV2.tsx" /* a local clip-deal summary preview, not a write */].sort());
  for (const [f, want] of Object.entries(RF.RF_REVIEWED_FINGERPRINTS)) check(`${f} unchanged since the last Sunny Red Films review (update lib/partner/system/red-films.ts + fingerprint together)`, createHash("sha256").update(read(f).replace(/\r\n/g, "\n")).digest("hex"), want);
  check("fingerprints cover every reviewed file", Object.keys(RF.RF_REVIEWED_FINGERPRINTS).sort(), [...RF.RF_REVIEWED_FILES].sort());
  const view = code(read("lib/partner/redfilms/view.ts"));
  ok("view reuses the app's clip-deal math + Finance validation", /summarizeClipFinance\(/.test(view) && /validateTx\(/.test(view));
  ok("promote still deletes the row and writes expense scope קליפ (the contract's statement)", /from\("clip_items"\)\.delete\(\)/.test(read("app/api/clip-items/[id]/promote/route.ts")) && /expense_scope:\s*"קליפ"/.test(read("app/api/clip-items/[id]/promote/route.ts")));
  ok("pure view: no DB / fetch / write / push", !/supabase|fetch\(|\.insert\(|\.update\(|\.upsert\(|\.delete\(|sendPush/.test(view + code(read("lib/partner/knowledge/capabilities/video-deep.ts"))));

  const v = buildVideoView(sources());
  const PRD = (id: string) => v.productions.find((p) => p.id === id)!;
  const PV = (pid: string) => v.projects.find((p) => p.project.key === `project:${pid}`)!;

  section("SCENARIO A — 'מה קורה עם הקליפ של X?'");
  const a = PRD(PR_MAIN);
  ok("project + state + budget + crew + shoot + documents + editing + money + tasks", a.project?.key === `project:${P(2)}` && a.status === "בתכנון" && a.money.budget === 5000 && a.crew.photographer === "צלם א" && a.shoot.sessions.length === 2 && a.files.documents.length === 1 && !!a.editing && a.tasks.length === 1);
  for (const s of ["summary", "project", "crew", "shoot", "concept", "editing", "files", "money", "tasks"]) ok(`video_view production ${s}`, q("video_view", "production", { ref: PR_MAIN, section: s }).status === "OK");
  ok("video_view project + money + overview", ["project", "money", "overview"].every((m) => q("video_view", m, m === "project" ? { ref: P(2) } : {}).status === "OK"));

  section("SCENARIO B — clip row ₪1,000, no transaction");
  check("planned 1,000, not spent", [PV(P(3)).planning.plannedByCurrency, PV(P(3)).expenses.total], [{ "₪": 1000 }, {}]);

  section("SCENARIO C — transferred row");
  const c2 = PV(P(2));
  ok("the transaction is the actual expense; the row is not planned money", !("₪" in c2.planning.plannedByCurrency) && c2.expenses.total["₪"] === 1100);

  section("SCENARIO D — expense scope קליפ with no clip row");
  ok("actual expense shown; planning origin unknown", PV(P(5)).planning.rows.length === 0 && PV(P(5)).expenses.invalid.length === 1);

  section("SCENARIO E — plan and expense differ");
  ok("both shown, the expense is canonical", c2.planning.rows.some((r) => r.expenseDiffers?.planned === 900 && r.expenseDiffers?.expense === 1100) && v.signals.some((s) => s.code === "CLIP_PLAN_VS_EXPENSE"));

  section("SCENARIO F — shoot tomorrow with a calendar event");
  const tomorrow = c2.shoots.find((s) => s.date === "2026-09-25")!;
  ok("exact recorded schedule + calendar link", !tomorrow.datePassed && /LINKED/.test(tomorrow.calendar) && tomorrow.start === "10:00" && q("video_portfolio", "list", { filter: "upcoming_shoots" }).items.some((i) => i.id === `project-video:${P(2)}`));

  section("SCENARIO G — shoot date passed, status does not prove it");
  ok("never 'shot'", a.shoot.datePassed && !a.shoot.statusSaysShot && v.signals.some((s) => s.code === "SHOOT_DATE_PASSED_NOT_SHOT" && s.production === a.key) && PV(P(5)).shoots[0].happened === false);

  section("SCENARIO H — calendar unreadable");
  ok("calendar = an event link, details via the calendar capability (never 'no event')", /LINKED/.test(PV(P(5)).shoots[0].calendar) && v.unavailable.some((u) => /calendar capability/.test(u)));

  section("SCENARIO I — one clip, two shoot days");
  check("both shown", c2.shoots.length, 2);

  section("SCENARIO J — crew, no shoot date");
  const j = PRD(PR_NODATE);
  ok("reported as a fact, never 'not ready'", j.crew.director === "במאי ב" && !j.shoot.productionShootDate && q("video_portfolio", "list", { filter: "no_shoot_date" }).items.some((i) => i.id === PR_NODATE) && !/not ready|לא מוכן/.test(JSON.stringify(v.signals)));

  section("SCENARIO K — release target, video not final");
  ok("context only, never 'blocked'", v.signals.some((s) => s.code === "RELEASE_CONTEXT" && /לא מחייב קליפ/.test(s.he)) && !/blocked|חסום/.test(JSON.stringify(v.signals)));

  section("SCENARIO L — audio release without video");
  ok("not an error: no signal type exists for 'release without video'; the release note says so", !RF.RF_SIGNAL_MODEL.some((x) => /RELEASE_(WITHOUT|NO)_VIDEO|MISSING_VIDEO/.test(x.code)) && !v.signals.some((s) => /missing video|אין קליפ לריליס/.test(s.he)) && v.projects.filter((p) => p.release).every((p) => /never requires a video/.test(p.release!.note)));

  section("SCENARIO M — ₪ and $ expenses");
  check("kept apart", c2.expenses.total, { "₪": 1100, $: 300 });

  section("SCENARIO N — expense status התקבל");
  ok("not a properly paid supplier expense", PV(P(5)).expenses.invalid[0].status === "התקבל" && !("₪" in PV(P(5)).expenses.paid) && v.signals.some((s) => s.code === "CLIP_EXPENSE_RECEIVED_STATUS"));

  section("SCENARIO O — document metadata, no unsafe links");
  const docText = JSON.stringify(q("video_view", "production", { ref: PR_MAIN, section: "files" }));
  ok("type + name + time; no storage path / link", /script\.pdf/.test(docText) && /תסריט/.test(docText) && !/\/Red Films\/x|dropbox\.com/.test(docText));

  section("SCENARIO P — storage not listed");
  ok("capability gap, never 'no footage'", /NOT_AVAILABLE/.test(a.files.storageListing) && KNOWLEDGE_GAPS.some((g) => g.id === "RF_STORAGE_NOT_LISTED" && g.class === "CAPABILITY_GAP"));

  section("SCENARIO Q — production without a project");
  ok("orphan relation reported", v.signals.some((s) => s.code === "PRODUCTION_WITHOUT_PROJECT" && s.production === PRD(PR_NOPROJ).key));

  section("SCENARIO R — project video data, no production");
  ok("project evidence shown, no production invented", v.signals.some((s) => s.code === "PROJECT_VIDEO_NO_PRODUCTION" && s.project === `project:${P(3)}`) && PV(P(3)).productions.length === 0);

  section("SCENARIO S — repeated send clip / duplicates");
  ok("duplicate productions reported + the real idempotency behavior", v.signals.some((s) => s.code === "DUPLICATE_PRODUCTIONS" && s.project === `project:${P(4)}`) && /Idempotent by lookup twice \(no database unique guard\)/.test(RF.DOMAIN_MODEL.sendClip));

  section("SCENARIO T — a row transferred twice / its expense gone");
  ok("linkage evidence + missing transaction flagged; the promote race is documented", c2.planning.rows.some((r) => r.transferred && r.transactionExists === false) && v.signals.some((s) => s.code === "CLIP_ROW_PROMOTED_MISSING_TX") && /double click could create two expenses/.test(RF.MONEY_MODEL.promote));

  section("SCENARIO U — shoot expense and plan for the same cost");
  ok("never summed with planning; the shoot expense is linked to its session", a.shoot.sessions.some((s) => s.expenseLinked) && c2.expenses.total["$"] === 300 && !Object.keys(c2.planning.plannedByCurrency).length);

  section("SCENARIO V — 'מה אני צריך לעשות עם הקליפים?'");
  ok("evidence-backed candidates + questions, no score", v.questions.length > 0 && v.signals.length > 0 && !/"(score|rank)"/.test(JSON.stringify(v)));

  section("SCENARIO W — 'מה הצוות צריך לעשות?'");
  ok("recorded names only; responsibility never assigned", a.crew.identity.includes("free-text") && !/responsib/.test(JSON.stringify(a.crew)) && a.tasks.every((t) => /CANONICAL/.test(t.relation)));

  section("SCENARIO X — posted content, stale production");
  ok("conflicting sources shown, never rewritten", v.signals.some((s) => s.code === "PUBLISHED_CONTENT_VS_PRODUCTION" && s.project === `project:${P(4)}`));

  section("SCENARIO Y — label artist video");
  ok("label context + recoup rule, no priority", PV(P(1)).labelWork === true && /recoup/.test(PRD(PR_NODATE).money.recoup) && !/priority/.test(JSON.stringify(PV(P(1)))));

  section("SCENARIO Z — client video");
  ok("clip income ≠ expense", PV(P(2)).labelWork === false && PV(P(2)).clipDeal.price === 3500 && PV(P(2)).clipDeal.paid === 1500 && PV(P(2)).expenses.total["₪"] === 1100 && /revenue, never a video expense/.test(PV(P(2)).clipDeal.note));

  section("2. money layers, Red Films ledger, awareness");
  ok("Red Films ledger apart from Finance; manual actual vs payments flagged; no currency", a.money.paidRedFilmsLedger === 1200 && a.money.manualActualOnLines === 500 && v.signals.some((s) => s.code === "LINE_ACTUAL_VS_PAYMENTS") && v.signals.some((s) => s.code === "RF_LEDGER_NOT_IN_FINANCE") && /NOT_RECORDED/.test(a.money.currency));
  for (const fl of ["active", "all", "cancelled", "shoot_passed_not_shot", "no_project", "with_documents", "with_payments", "projects", "projects_no_production"]) ok(`video_portfolio filter ${fl}`, q("video_portfolio", "list", { filter: fl }).status === "OK");
  ok("Owner-only", q("video_view", "overview", {}, STRANGER).status !== "OK" && q("video_portfolio", "list", {}, STRANGER).status !== "OK");
  for (const s of ["fields", "settings", "vocabularies", "work", "statuses", "money", "identity", "calendar", "files", "consumers", "actions", "workflows", "signals", "security", "integrity"]) ok(`system_awareness red_films_model ${s}`, (q("system_awareness", "red_films_model", { section: s }) as { items: unknown[] }).items.length > 0);
  const servedText = JSON.stringify([q("video_view", "overview"), q("video_view", "money"), q("video_view", "project", { ref: P(2) }), q("video_portfolio", "list", { filter: "all" }), ...["fields", "money", "actions", "security", "files"].map((s) => q("system_awareness", "red_films_model", { section: s }))]);
  check("no forbidden implementation / secret terms served", FORBIDDEN_SERVED_TERMS.filter((x) => servedText.toLowerCase().includes(x.toLowerCase())), []);
  ok("no storage paths / public links served", !/\/Red Films\/x|dropbox\.com|instagram\.com/.test(servedText));
  ok("RED_FILMS + CLIPS = DEEP_BRAIN_V1", DOMAIN_KNOWLEDGE_DEPTH.RED_FILMS === "DEEP_BRAIN_V1" && DOMAIN_KNOWLEDGE_DEPTH.CLIPS === "DEEP_BRAIN_V1" && ["RED_FILMS", "CLIPS"].every((d) => CAPABILITY_CHANGES.some((x) => x.version === "2026.09.25-13" && x.domain === d)));
  check("system registry valid", validateSystemRegistry({ capabilityIds: REG.all().map((x) => x.id), knowledgeKinds: KNOWLEDGE_KINDS.map((x) => x.kind) }), []);
  check("gaps valid", validateKnowledgeGaps({ domainIds: DOMAIN_CONTRACTS.map((x) => x.id), capabilityIds: REG.all().map((x) => x.id) }), []);
  const rg = KNOWLEDGE_GAPS.filter((g) => /^(RF_|CLIP_)/.test(g.id));
  ok("video gaps cover the required classes", ["DATA_NOT_RECORDED", "DATA_MODEL_GAP", "CAPABILITY_GAP", "AMBIGUOUS_IDENTITY", "CONFLICTING_SOURCES", "LEGACY_CONFLICT", "SYSTEM_BEHAVIOR_GAP", "OWNER_DECISION_REQUIRED"].every((c) => rg.some((g) => g.class === c)));
  ok("security finding registered (report only)", SECURITY_GAPS.some((g) => g.id === "SG_RED_FILMS_ROUTES_PROXY_ONLY" && g.status === "REPORTED_NOT_FIXED"));
  ok("no invented policy (no required budget / crew / checklist / release-requires-clip / turnaround)", !/(required budget|mandatory|readiness checklist is|release requires|turnaround)/i.test(JSON.stringify([RF.MONEY_MODEL, RF.SHOOT_MODEL, RF.CREW_MODEL, RF.FILES_MODEL])));

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}
main();
