/**
 * Sunny FULL-BRAIN COMPLETION — permanent guards + scenarios for Sessions / Tasks / Meetings / Albums / Delivery /
 * Social / Files / Reports / Sunny core / Sunny connector.
 *
 * Guards (a change Sunny cannot explain fails here):
 *   - every production column of the domain tables is classified (census 2026-09-25) and every column the readers use exists;
 *   - every vocabulary equals the code that declares it;
 *   - every route of each family is inventoried (auth + writes) and every inventoried route exists;
 *   - every in-process schedule and every secret-protected cron route belongs to a known background job;
 *   - the storage namespaces cover every path builder; no database file bucket is used;
 *   - the connector tools equal the tools the MCP server declares;
 *   - the ten domains are DEEP_BRAIN_V1 and nothing is pending; the capabilities are Owner-only, pure and serve no
 *     implementation / secret term.
 *
 * Run with:   npx tsx scripts/test-sunny-full-brain.tsx      Pure; never touches production.
 */
import fs from "node:fs";
import path from "node:path";
import { PARTNER_KNOWLEDGE_REGISTRY } from "../lib/partner/knowledge/catalog";
import { queryKnowledgeCore } from "../lib/partner/knowledge/query";
import type { KnowledgeAudience, QueryResponse } from "../lib/partner/knowledge/types";
import type { GatewaySources, GatewayFinance } from "../lib/partner/gateway/core";
import type { OperationsRaw } from "../lib/partner/operations/types";
import type { ProjectDetailRaw, DetailSession, DetailTask, DetailMeeting } from "../lib/partner/projects/detail-types";
import type { FinanceRaw } from "../lib/partner/finance/types";
import type { SettingsState } from "../lib/partner/settings/types";
import { deriveFinanceView } from "../lib/partner/finance/view";
import { buildFinanceBrief } from "../lib/partner/finance/brief";
import { buildSessionsView, buildTasksView, buildMeetingsView, buildAlbumsView, buildDeliveryView, buildSocialView } from "../lib/partner/work/view";
import { buildStorageView, buildReportsState, buildSunnySelfView } from "../lib/partner/self/view";
import { WORK_DOMAINS } from "../lib/partner/system/work-domains";
import * as PD from "../lib/partner/system/platform-domains";
import { FORBIDDEN_SERVED_TERMS, DOMAIN_CONTRACTS } from "../lib/partner/system";
import { DOMAIN_KNOWLEDGE_DEPTH, KNOWLEDGE_GAPS } from "../lib/partner/system/gaps";
import { NOW, P, U, input } from "./fixtures/integrity-company";
import { empty, tx, project } from "./fixtures/finance-mirror";

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
const walk = (d: string): string[] => fs.existsSync(path.join(ROOT, d)) ? fs.readdirSync(path.join(ROOT, d), { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(`${d}/${e.name}`) : e.name === "route.ts" ? [`${d}/${e.name}`] : []) : [];
const walkTs = (d: string): string[] => fs.readdirSync(path.join(ROOT, d), { withFileTypes: true }).flatMap((e) => e.name === "node_modules" ? [] : e.isDirectory() ? walkTs(`${d}/${e.name}`) : /\.(ts|tsx)$/.test(e.name) ? [`${d}/${e.name}`] : []);
const quoted = (s: string) => [...s.matchAll(/"([^"]+)"/g)].map((m) => m[1]).filter((x) => !x.startsWith("#"));
const OWNER: KnowledgeAudience = { channel: "EXTERNAL", ownerAuthorized: true };
const STRANGER: KnowledgeAudience = { channel: "EXTERNAL", ownerAuthorized: false };
const REG = PARTNER_KNOWLEDGE_REGISTRY;

/** Production columns (information_schema, read-only census 2026-09-25). */
const PROD_COLUMNS: Record<string, string[]> = {
  sessions: ["id", "project_id", "date", "start_time", "end_time", "status", "notes", "calendar_event_id", "created_at", "session_type", "photographer", "location", "title", "show_id", "cost"],
  tasks: ["id", "title", "notes", "status", "related_type", "related_id", "due_date", "start_time", "end_time", "calendar_event_id", "created_at", "updated_at", "show_id"],
  meetings: ["id", "client_id", "client_name", "project_id", "date", "time", "duration", "location", "notes", "status", "calendar_event_id", "created_at"],
  album_tracks: ["id", "project_id", "track_number", "title", "status", "mix_status", "master_status", "notes", "created_at", "updated_at"],
  final_files: ["id", "work_id", "project_id", "file_name", "dropbox_path", "file_size", "file_type", "uploaded_by", "created_at"],
  social_campaigns: ["id", "project_id", "title", "artist_name", "release_date", "status", "marketing_angle", "target_audience", "main_message", "platforms", "owner_id", "notes", "created_at", "updated_at", "promotion_budget"],
  social_content_items: ["id", "campaign_id", "project_id", "title", "content_type", "status", "platform", "due_date", "publish_date", "owner_name", "asset_link", "dropbox_link", "calendar_event_id", "task_id", "caption", "hook", "notes", "posted_url", "created_at", "updated_at", "publish_time"],
  social_content_files: ["id", "content_item_id", "campaign_id", "project_id", "file_name", "file_type", "file_size", "dropbox_path", "dropbox_file_id", "dropbox_share_link", "uploaded_by", "created_at", "updated_at"],
  social_promotions: ["id", "campaign_id", "channel", "promo_type", "name", "planned_amount", "status", "promo_date", "notes", "linked_transaction_id", "created_at", "updated_at"],
};
const ROUTE_FAMILIES: Record<string, string[]> = {
  SESSIONS: ["app/api/sessions"], TASKS: ["app/api/tasks", "app/api/calendar/create-task", "app/api/calendar/tasks"], MEETINGS: ["app/api/meetings"],
  ALBUMS: ["app/api/album-tracks", "app/api/album-finance", "app/api/album-prev-info"], DELIVERY: ["app/api/delivery"], SOCIAL: ["app/api/social"],
};

// ── fixture ──
const sec = <T,>(rows: T[]) => ({ rows, capped: false });
const EMPTY = Object.fromEntries(["projects", "financeNotes", "deliveries", "actions", "sessions", "meetings", "tasks", "engineerWork", "mixVersions", "mixComments", "commentAttachments", "mixTargets", "mixTargetNotes", "finalFiles", "victor", "productions", "budgetItems", "albumTracks", "clipItems", "proposals", "releases", "campaigns", "contentItems", "socialFiles", "projectSettings", "transactionsText", "budgetPayments", "agentAlerts", "notifications", "rfCrew", "rfDocuments", "rfScenes", "rfRefImages", "rfRefLinks", "rfEquipment"].map((k) => [k, { rows: [], capped: false }])) as unknown as ProjectDetailRaw;
const sess = (n: number, o: Partial<DetailSession>): DetailSession => ({ id: U(n), projectId: P(2), showId: null, date: "2026-09-20", startTime: "10:00", endTime: "12:00", status: "מתוכנן", type: "סשן", title: null, notes: null, location: null, photographer: null, cost: null, hasCalendarEvent: true, createdAt: null, ...o });
const task = (n: number, o: Partial<DetailTask>): DetailTask => ({ id: U(n), relatedType: "general", relatedId: null, title: "משימה", notes: null, status: "פתוח", dueDate: "2026-09-30", startTime: null, endTime: null, showId: null, hasGoogleTask: false, createdAt: null, updatedAt: null, ...o });
const meet = (n: number, o: Partial<DetailMeeting>): DetailMeeting => ({ id: U(n), createdAt: null, projectId: null, clientId: null, clientName: null, date: "2026-09-10", time: "12:00", duration: 60, location: "זום", notes: null, status: "נקבעה", hasCalendarEvent: false, ...o });
const meta = (id: string, name: string, type: string, status: string, businessType = "לקוח", artist = "אבי מולה") => ({ id, name, status, projectType: type, businessType, artistText: artist, deadline: null, startDate: null, endDate: null, parentProject: null, isHidden: false, plannedHours: null, plannedDays: null, updatedAt: "2026-09-20T10:00:00Z" });
const ALBUM = U(150), CAMP = U(160);
function sources(o: { settings?: boolean; knowledge?: boolean } = {}): GatewaySources {
  const st = input({ contexts: [] }).state!;
  const clientId = st.domains.clients.data!.items[0].id;
  const ops = {
    projectsMeta: sec([meta(P(2), "אבי 1", "שיר", "בעבודה"), meta(P(4), "נגש 1", "שיר", "הושלם"), meta(P(5), "כפול", "שיר", "הושלם"), meta(ALBUM, "אלבום א", "אלבום", "בעבודה")]),
    albumTracks: sec([{ projectId: ALBUM, trackNumber: 1, title: "פתיחה", status: "טרום הקלטה", mixStatus: "לא התחיל", masterStatus: "לא התחיל" }, { projectId: ALBUM, trackNumber: 2, title: "שני", status: "הושלם", mixStatus: "לא התחיל", masterStatus: "לא התחיל" }]),
    engineerWork: sec([{ id: U(170), projectId: ALBUM, engineerName: "Steven", workType: "מיקס", workTitle: "אלבום", status: "בתהליך", sentDate: null, internalDeadline: null, agreedPrice: null, amountPaid: null, currency: "$", paymentDate: null }]),
    campaigns: sec([{ id: CAMP, projectId: P(1), title: "קמפיין שליו", artistName: "שליו טסמה", releaseDate: "2026-09-30", status: "active", promotionBudget: 500 }]),
    promotions: sec([{ campaignId: CAMP, channel: "TikTok", plannedAmount: 300, status: "מתוכנן", promoDate: null, hasTransaction: false }]),
    beats: sec([]), redFilms: sec([]),
  } as unknown as OperationsRaw;
  const det: ProjectDetailRaw = { ...EMPTY,
    sessions: sec([
      sess(201, { status: "מתוכנן", date: "2026-09-20" }), sess(202, { status: "מתוכנן", date: "2026-09-28", hasCalendarEvent: false }), sess(203, { status: "בוטל", date: "2026-09-29" }),
      sess(204, { projectId: null, showId: U(401), type: "חזרה להופעה", status: "התקיים", cost: 200, date: "2026-09-18" }), sess(205, { type: "צילום קליפ", status: "התקיים", date: "2026-09-15" }),
    ]),
    tasks: sec([
      task(301, { title: "מעקב הצעת מחיר - לקוח", relatedType: "client", relatedId: clientId, notes: "[proposal_id:00000000-0000-4000-8000-000000000999]\nהצעה", dueDate: "2026-09-10", hasGoogleTask: true }),
      task(302, { title: "להתקשר", dueDate: "2026-09-24" }), task(303, { title: "מעקב ויקטור — אבי 1", relatedType: "project", relatedId: P(2), status: "בוצע" }),
    ]),
    victor: sec([{ id: U(710), projectId: P(2), linkedTaskId: U(399), notes: null, briefText: null, references: [], reviews: [], filesSent: [{ name: "v1.wav", category: null, versionLabel: "V1", trackId: null, durationSeconds: 100, size: 5000, uploadedAt: "2026-09-10T10:00:00Z", path: "/Projects/x/Victor/Production/v1.wav", hasShareLink: true, fromMixVersionId: null, structureMarkers: 0 }], filesReceived: [], briefFiles: [], returnedDate: null, outcome: null, quality: null, enteredProject: null, dropboxFolder: "/Projects/x/Victor", hasFolderLink: true }] as never),
    meetings: sec([meet(501, { clientId, clientName: "שם ישן", status: "נקבעה", date: "2026-09-10" }), meet(502, { clientId: "no-such-client", clientName: "זר", status: "בוטלה", hasCalendarEvent: true, date: "2026-10-02" })]),
    deliveries: sec([{ projectId: "__test_token_check__", folderPath: null, status: "ready", deliveredAt: null, hasLink: true }, { projectId: P(4), folderPath: "/Projects/x/Delivery", status: "delivered", deliveredAt: "2026-09-21", hasLink: true }, { projectId: P(2), folderPath: "/Projects/y/Delivery", status: "ready", deliveredAt: null, hasLink: true }]),
    finalFiles: sec([{ workId: U(170), projectId: P(5), fileName: "final.wav", path: "/Projects/z/Final Files/final.wav", fileType: "wav", fileSize: 9000, uploadedBy: "Steven", createdAt: "2026-09-19T10:00:00Z" }]),
    contentItems: sec([{ id: U(610), projectId: P(1), campaignId: CAMP, title: "טיזר", contentType: "טיזר", status: "idea", platform: "instagram", dueDate: "2026-09-01", publishDate: null, caption: null, hook: null, notes: null, ownerName: null, postedUrl: null, hasAssetLink: false, hasCalendarEvent: false, taskId: null, publishTime: null, createdAt: null, updatedAt: null }]),
    campaigns: sec([{ id: CAMP, projectId: P(1), title: "קמפיין שליו", marketingAngle: null, targetAudience: null, mainMessage: null, platforms: ["instagram"], notes: null, ownerUserId: null, createdAt: null, updatedAt: null }]),
    socialFiles: sec([{ projectId: P(1), contentItemId: U(610), campaignId: CAMP, dropboxFileId: "id:x", updatedAt: null, fileName: "teaser.mp4", fileType: "video/mp4", fileSize: 1000, uploadedBy: "", createdAt: "2026-09-02T10:00:00Z", path: "/Social/x/Media/teaser.mp4", hasShareLink: true }]),
  };
  const raw: FinanceRaw = empty({ transactions: [
    tx({ id: "reh", type: "expense", amount: 200, currency: "₪", status: "לא שולם", category: "חזרה", scope: "general", expenseScope: "הופעה", date: "2026-09-18", linkedSessionId: U(204) }),
    tx({ id: "orphan", type: "expense", amount: 300, currency: "₪", status: "לא שולם", category: "צילום קליפ", scope: "project", expenseScope: "קליפ", date: "2026-09-01", linkedSessionId: U(299), projectId: P(2) }),
    tx({ id: "sal", type: "expense", amount: 550, currency: "$", status: "שולם", category: "משכורת", scope: "general", date: "2026-09-10", linkedSessionId: "victor_salary_2026_08" }),
    tx({ id: "open4", type: "income", amount: 1000, currency: "₪", status: "צפוי", category: "תשלום", scope: "project", date: "2026-10-01", projectId: P(4) }),
  ], projects: [project({ id: P(4), name: "נגש 1", status: "הושלם" }), project({ id: P(2), name: "אבי 1" })], financeSettings: [{ projectId: P(4), value: { agreedPrice: 3000 } }] });
  const view = deriveFinanceView(raw, NOW, []);
  const f: GatewayFinance = { state: view.state, integrity: view.integrity, actions: view.actions, raw, brief: buildFinanceBrief(view.state, view.integrity, { answersAvailable: true, actionNoteHe: view.actionNoteHe }), answersAvailable: true };
  const settings: SettingsState = { families: o.settings === false ? {} : { REPORT_SCHEDULE: sec([{ key: "report_schedule", updatedAt: "2026-09-01T10:00:00Z", value: { morningTime: "08:30", eveningTime: "20:00" } }]) } } as unknown as SettingsState;
  const knowledge = o.knowledge === false ? undefined : { status: "OK" as const, value: [
    { id: "k1", createdAt: "2026-09-24T10:00:00Z", kind: "ENTITY_ALIAS", subjectKey: "label-artist:x", identityKeys: [], slotKey: "a", value: {}, epistemic: "OWNER_REPORTED", meaningHe: "קוראים לו גם X", operation: "ASSERT", supersedesId: null, reviewAt: null, expiresAt: null, provenance: { source: "owner_via_sunny" } },
    { id: "k2", createdAt: "2026-09-25T10:00:00Z", kind: "ENTITY_ALIAS", subjectKey: "label-artist:x", identityKeys: [], slotKey: "a", value: {}, epistemic: "OWNER_REPORTED", meaningHe: "בוטל", operation: "WITHDRAW", supersedesId: "k1", reviewAt: null, expiresAt: null, provenance: { source: "owner_via_sunny" } },
  ] as never };
  return { now: NOW, identities: { cleantone: null }, state: { status: "OK", value: st }, finance: { status: "OK", value: f }, operations: { status: "OK", value: ops }, projectDetail: { status: "OK", value: det },
    settings: { status: "OK", value: settings }, ...(knowledge ? { ownerKnowledge: knowledge } : {}), actions: { status: "OK", value: [] }, outcomes: { status: "OK", value: [] }, cases: { status: "OK", value: [] },
    labelDetail: { status: "OK", value: { shows: { rows: [{ id: U(401), name: "הופעה", date: "2026-09-26" }], capped: false } } as never } };
}
const q = (capability: string, mode: string, params: Record<string, string> = {}, aud = OWNER): QueryResponse => queryKnowledgeCore(REG, { capability, mode, params }, sources(), aud);

function main() {
  section("1. schema / vocabulary / route guards (six work domains)");
  for (const d of WORK_DOMAINS) {
    for (const [table, fields] of Object.entries(d.fields)) if (PROD_COLUMNS[table]) check(`${d.id}: every production column of ${table} is classified`, Object.keys(fields).sort(), [...PROD_COLUMNS[table]].sort());
    for (const [voc, src] of Object.entries(d.internal.vocabularySources)) {
      const m = new RegExp(src.pattern).exec(read(src.file));
      ok(`${d.id}: vocabulary ${voc} is declared in the code`, !!m);
      if (m) check(`${d.id}: vocabulary ${voc} = the code`, [...d.vocabularies[voc]].sort(), quoted(m[1]).sort());
    }
    const routes = (ROUTE_FAMILIES[d.id] ?? []).flatMap((f) => fs.existsSync(path.join(ROOT, f, "route.ts")) ? [`${f}/route.ts`, ...walk(f).filter((r) => r !== `${f}/route.ts`)] : walk(f));
    const inv = new Set(d.internal.routes.map((r) => r.route));
    check(`${d.id}: every route of the family is inventoried`, [...new Set(routes)].filter((r) => !inv.has(r)).sort(), []);
    ok(`${d.id}: every inventoried route exists`, d.internal.routes.every((r) => fs.existsSync(path.join(ROOT, r.route))));
  }
  const readerCols = (table: string) => [...code(read("lib/partner/projects/detail-reader.ts") + read("lib/partner/operations/readers.ts")).matchAll(new RegExp(`\\(\\s*(?:client,\\s*)?"${table}",\\s*"([^"]+)"`, "g"))].flatMap((m) => m[1].split(",").map((c) => c.trim().split(":").pop()!.split("->")[0].trim()));
  for (const t of Object.keys(PROD_COLUMNS)) check(`every column the Sunny readers select from ${t} exists in production`, readerCols(t).filter((c) => !PROD_COLUMNS[t].includes(c)), []);
  ok("the social checker is imported (not re-implemented)", /from "\.\.\/\.\.\/social-missing-checker"/.test(read("lib/partner/work/view.ts")) && /checkMissing\(/.test(read("lib/partner/work/view.ts")));

  section("2. platform guards (files / reports / background / connector)");
  const all = [...walkTs("app"), ...walkTs("lib"), ...walkTs("components")];
  check("no database file bucket is used (Dropbox is the only store)", all.filter((f) => /\.storage\.from\(/.test(read(f))), []);
  ok("every storage namespace builder exists", PD.STORAGE_NAMESPACES.every((n) => fs.existsSync(path.join(ROOT, n.internal.builder))));
  const pathBuilders = ["lib/project-paths.ts", "lib/vendor-folder.ts", "lib/red-artists/portal-files.ts", "lib/beat-upload.ts", "lib/project-cover.ts", "lib/victor-avatar.ts", "lib/final-file-upload.ts"];
  ok("every storage path builder is owned by a namespace (or the project tree)", pathBuilders.every((b) => PD.STORAGE_NAMESPACES.some((n) => n.internal.builder === b) || b === "lib/project-paths.ts"));
  const schedules = (code(read("instrumentation.ts")).match(/cron\.schedule\(/g) ?? []).length;
  check("every in-process schedule belongs to a known background job", schedules, PD.JOB_SOURCES_INTERNAL.inProcessSchedules.length);
  ok("every in-process job id is a background job", PD.JOB_SOURCES_INTERNAL.inProcessSchedules.every((id) => PD.BACKGROUND_JOBS.some((j) => j.id === id)));
  const secretRoutes = walk("app/api").filter((r) => /CRON_SECRET/.test(read(r)));
  check("every secret-protected cron route belongs to a known background job", secretRoutes.filter((r) => !PD.JOB_SOURCES_INTERNAL.secretRoutes[r]).sort(), []);
  ok("…and every mapped job exists", Object.values(PD.JOB_SOURCES_INTERNAL.secretRoutes).every((id) => PD.BACKGROUND_JOBS.some((j) => j.id === id)));
  ok("the reports model points at existing files / routes", [...PD.REPORTS_MODEL.internal.files, ...PD.REPORTS_MODEL.internal.routes].every((f) => fs.existsSync(path.join(ROOT, f))));
  check("every reports route is in the reports model", walk("app/api/reports").sort(), [...PD.REPORTS_MODEL.internal.routes].sort());
  const mcpTools = new Set([...read("lib/integrations/partner-mcp/tools.ts").matchAll(/"(partner_[a-z_]+)"/g)].map((m) => m[1]));
  check("the connector tools = the tools the MCP server declares", PD.SUNNY_CONNECTOR_MODEL.tools.map((t) => t.tool).sort(), [...mcpTools].sort());
  const goalsSrc = read(PD.CODE_BUSINESS_GOALS.internal.file);
  check("the code business goals = the code (fresh discovery pin)", [/monthlyRevenue:\s*\{ target: (\d+)/.exec(goalsSrc)?.[1], /weeklySessions:\s*\{ target: (\d+)/.exec(goalsSrc)?.[1], /monthlyVictor:\s*\{ target: (\d+)/.exec(goalsSrc)?.[1], /monthlyCompletions:\s*\{ target: (\d+)/.exec(goalsSrc)?.[1]].map(Number), [PD.CODE_BUSINESS_GOALS.goals.monthlyRevenueIls, PD.CODE_BUSINESS_GOALS.goals.weeklySessions, PD.CODE_BUSINESS_GOALS.goals.monthlyVictor, PD.CODE_BUSINESS_GOALS.goals.monthlyCompletions]);
  ok("Sunny does not depend on the legacy in-app AI", PD.LEGACY_AI.sunnyDependsOnIt === false && !walkTs("lib/partner").some((f) => /from "(@\/lib\/|\.\.\/)+(agent-core|ai-router|openai|providers\/|mai\/)/.test(read(f))));

  section("3. depth + capabilities");
  const TEN = ["SESSIONS", "TASKS", "MEETINGS", "ALBUMS", "DELIVERY", "SOCIAL", "FILES_DROPBOX", "REPORTS", "SUNNY_CORE", "SUNNY_CONNECTOR"];
  check("all ten domains are DEEP_BRAIN_V1", TEN.filter((d) => DOMAIN_KNOWLEDGE_DEPTH[d] !== "DEEP_BRAIN_V1"), []);
  check("no domain is still pending", Object.entries(DOMAIN_KNOWLEDGE_DEPTH).filter(([, v]) => v === "PENDING_DEEP_MISSION").map(([k]) => k), []);
  const CAPS = ["session_view", "task_view", "meeting_view", "album_view", "delivery_view", "social_view", "storage_view", "reports_view", "sunny_self"];
  ok("the nine capabilities are registered, Owner-only", CAPS.every((id) => REG.get(id)?.access.ownerOnly === true));
  ok("each is claimed by its domain", [["SESSIONS", "session_view"], ["TASKS", "task_view"], ["MEETINGS", "meeting_view"], ["ALBUMS", "album_view"], ["DELIVERY", "delivery_view"], ["SOCIAL", "social_view"], ["FILES_DROPBOX", "storage_view"], ["REPORTS", "reports_view"], ["SUNNY_CORE", "sunny_self"], ["SUNNY_CONNECTOR", "sunny_self"]].every(([d, c]) => DOMAIN_CONTRACTS.find((x) => x.id === d)!.readCapabilities.includes(c)));
  ok("the stranger is refused", CAPS.every((id) => q(id, "overview", {}, STRANGER).status === "NOT_AUTHORIZED"));
  const V = code(read("lib/partner/work/view.ts") + read("lib/partner/self/view.ts") + read("lib/partner/knowledge/capabilities/full-brain.ts"));
  ok("pure: no DB / fetch / write / push / email", !/supabase|fetch\(|\.insert\(|\.update\(|\.upsert\(|\.delete\(|\.rpc\(|sendPush|resend/i.test(V));
  const outs = CAPS.flatMap((id) => Object.keys(REG.get(id)!.modes).map((m) => q(id, m)));
  ok(`every mode answers (${outs.length})`, outs.every((r) => r.status === "OK" || (r.completeness === "UNKNOWN")));
  const served = JSON.stringify(outs).toLowerCase();
  check("no implementation / secret term is served", FORBIDDEN_SERVED_TERMS.filter((t) => served.includes(t.toLowerCase())), []);
  ok("no storage path or public link is served", !/\/projects\/|\/red films\/|\/social\/|dropbox\.com|https?:\/\/www\.dropbox/i.test(served));
  ok("every new gap is registered", ["WK_SESSION_HAPPENED_UNPROVEN", "WK_REHEARSAL_STATUS_CONFLICT", "WK_TASK_TEXT_LINKS", "WK_GOOGLE_TASKS_NOT_READ", "WK_MEETING_OUTCOME_NOT_RECORDED", "WK_DELIVERY_RECIPIENT_NOT_RECORDED", "FS_STORAGE_ONLY_FILES", "RP_REPORT_SEMANTICS_CONFLICT", "RP_NO_REPORT_HISTORY", "SC_FEEDBACK_NO_WRITER", "SC_CONVERSATION_NOT_STORED", "CO_SUNNY_OWN_AUDIT"].every((id) => KNOWLEDGE_GAPS.some((g) => g.id === id)));

  const src = sources();
  section("SESSIONS — passed ≠ happened; auto-mark; rehearsal vocabulary; calendar; orphan expense");
  const S = buildSessionsView(src);
  const sig = (v: { signals: Array<{ code: string }> }, c: string) => v.signals.filter((x) => x.code === c).length;
  ok("a passed מתוכנן session is UNKNOWN (never 'happened') + asks the Owner", S.sessions.find((s) => s.id === U(201))!.happened.startsWith("UNKNOWN") && sig(S, "SESSION_PASSED_STILL_PLANNED") === 1 && S.questions.length >= 1);
  ok("התקיים is 'recorded as happened — possibly auto-marked'", S.sessions.find((s) => s.id === U(205))!.happened.includes("auto"));
  ok("an auto-marked show rehearsal is flagged as not counted by the split", sig(S, "REHEARSAL_STATUS_NOT_COUNTED") === 1);
  ok("upcoming without a calendar event is flagged", sig(S, "SESSION_NO_CALENDAR_EVENT") === 1);
  ok("a cancelled session keeps its event (flagged)", sig(S, "SESSION_CANCELLED_EVENT_KEPT") === 1);
  ok("an expense linked to a missing session is an orphan; Victor salary keys are ignored", sig(S, "SESSION_EXPENSE_ORPHAN") === 1 && !S.orphanTransactions.some((t) => t.sessionId.startsWith("victor_salary")));
  ok("the rehearsal expense is linked to its session", S.sessions.find((s) => s.id === U(204))!.finance.length === 1);
  section("TASKS — TEXT markers stay TEXT_MATCH; overdue; Google mirror; dangling link");
  const T = buildTasksView(src);
  const pf = T.tasks.find((t) => t.id === U(301))!;
  ok("a proposal follow-up is recognised by its marker as TEXT_MATCH (never canonical)", pf.origin?.id === "PROPOSAL_FOLLOW_UP" && pf.origin.quality === "TEXT_MATCH" && pf.related?.quality === "CANONICAL_RELATION");
  ok("overdue + today are flagged", sig(T, "TASK_OVERDUE") === 1 && sig(T, "TASK_DUE_TODAY") === 1);
  ok("Google mirror is reported, not read", pf.googleTask === "MIRRORED" && T.unavailable.some((u) => /Google Tasks/.test(u)));
  ok("a Victor work pointing at a missing task is a dangling link", sig(T, "TASK_LINK_DANGLING") === 1);
  ok("no assignee / priority is invented", !JSON.stringify(T.tasks).includes("priority") && !JSON.stringify(T.tasks).includes("assignee"));
  section("MEETINGS — text client id; past scheduled unknown; name drift; event not synced");
  const M = buildMeetingsView(src);
  ok("a past נקבעה meeting is UNKNOWN", M.meetings.find((m) => m.id === U(501))!.happened.startsWith("UNKNOWN") && sig(M, "MEETING_PAST_STILL_SCHEDULED") === 1);
  ok("the booking-time name differs from today's client name", sig(M, "MEETING_CLIENT_NAME_DRIFT") === 1);
  ok("an unknown client id is flagged; a cancelled meeting keeps its event", sig(M, "MEETING_CLIENT_NOT_FOUND") === 1 && sig(M, "MEETING_CANCELLED_EVENT_KEPT") === 1);
  section("ALBUMS — manual track statuses vs mix works, never merged");
  const A = buildAlbumsView(src);
  const al = A.albums.find((x) => x.key === `project:${ALBUM}`)!;
  ok("the album project with its ordered tracks", al.tracks.map((t) => t.number).join() === "1,2");
  ok("an out-of-vocabulary track status is flagged", sig(A, "ALBUM_TRACK_STATUS_OUT_OF_VOCAB") === 1);
  ok("track mix statuses and the mix works are shown side by side (flagged, not merged)", sig(A, "ALBUM_TRACK_MIX_UNLINKED") === 1 && al.mixWorks.length === 1 && al.progress.mixDone === 0);
  section("DELIVERY — evidence ladder; 'delivered' only from a record");
  const D = buildDeliveryView(src);
  const lvl = (id: string) => D.projects.find((p) => p.key === `project:${id}`)?.evidence;
  check("evidence levels", [lvl(P(4)), lvl(P(2)), lvl(P(5))], ["DELIVERY_RECORDED", "DELIVERY_READY", "FINAL_FILES_EXIST"]);
  ok("a completed project with only final files is NOT delivered (flagged)", D.signals.some((s) => s.code === "COMPLETED_NO_DELIVERY_EVIDENCE" && s.project === `project:${P(5)}`));
  ok("delivered + remaining balance is flagged", sig(D, "DELIVERED_BALANCE_OPEN") === 1);
  ok("ready but not marked delivered is flagged", sig(D, "DELIVERY_READY_NOT_MARKED") === 1);
  ok("a leftover non-project delivery key is counted apart, never a project", D.counts.nonProjectDeliveryRecords === 1 && !D.projects.some((p) => p.key.includes("__test")));
  ok("no recipient is ever claimed", D.projects.every((p) => !p.delivery || p.delivery.recipientRecorded === false));
  section("SOCIAL — the app's checklist as implementation behaviour");
  const SO = buildSocialView(src);
  const k = SO.campaigns[0];
  ok("the app's checker runs and flags missing content", k.appReadiness.missing.length > 0 && /IMPLEMENTATION_BEHAVIOR/.test(k.appReadiness.classification));
  ok("the campaign release date differs from the release target (two sources)", sig(SO, "SOCIAL_RELEASE_DATE_DIFFERS") === 1);
  ok("overdue content + promotions are read", sig(SO, "SOCIAL_CONTENT_OVERDUE") === 1 && k.promotions.length === 1);
  section("FILES — every recorded file, no paths; storage-only files are a gap");
  const F = buildStorageView(src);
  const nsOf = (id: string) => F.namespaces.find((n) => n.id === id)!;
  ok("recorded files are counted per namespace", nsOf("VICTOR_WORK").recordedFiles === 1 && nsOf("FINAL_FILES").recordedFiles === 1 && nsOf("SOCIAL").recordedFiles === 1);
  ok("the artist portal is storage-only (null, not 0)", nsOf("ARTIST_PORTAL").recordedFiles === null && nsOf("DELIVERY").extra?.contents === "NOT_LISTED");
  ok("no path is kept in the view", !JSON.stringify(F.byProject).includes("/Projects/"));
  ok("the live listing needs Owner approval (stated)", PD.STORAGE_READ_DECISION.canSunnyListStorageSafelyToday === false);
  section("REPORTS — schedule + semantics vs the Finance Brain");
  const RS = buildReportsState(src);
  ok("the stored schedule is read", RS.schedule?.morningTime === "08:30" && RS.schedule.stored);
  ok("no stored schedule → defaults, marked as defaults", buildReportsState(sources({ settings: false })).schedule?.morningTime === "07:00 (default)");
  ok("the created-at money semantics are a stated conflict", RS.model.moneySemantics.some((m) => /CONFLICT/.test(m.vsFinanceBrain)));
  ok("every background job is classified", PD.BACKGROUND_JOBS.every((j) => j.classes.length > 0) && PD.ATTENTION_ENGINES.length === 5);
  section("SUNNY CORE + CONNECTOR — what Sunny remembers and what it cannot");
  const SS = buildSunnySelfView(src);
  ok("taught knowledge incl. a withdrawal", SS.knowledge?.records === 2 && SS.knowledge.withdrawn === 1 && SS.knowledge.active === 0);
  ok("the audit is explicitly unreadable (never pretended)", SS.audit.readable === false && /insert-only/.test(SS.audit.why));
  ok("the audit gap it names is registered", KNOWLEDGE_GAPS.some((g) => SS.audit.closesWith.includes(g.id)));
  ok("no conversation memory is claimed", /NONE/.test(SS.conversationMemory));
  ok("knowledge store off → unknown, not empty", buildSunnySelfView(sources({ knowledge: false })).knowledge === null);
  ok("the connector model carries no secret term", !/secret\s*[:=]|bearer\s+[a-z0-9]|rbmcp_/i.test(JSON.stringify(PD.SUNNY_CONNECTOR_MODEL)));

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}
main();
