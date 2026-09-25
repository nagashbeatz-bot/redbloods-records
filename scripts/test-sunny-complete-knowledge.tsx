/**
 * Tests — SUNNY COMPLETE SYSTEM AWARENESS (Projects completion + global knowledge charter). PROOF BY REPOSITORY
 * COVERAGE, not by contract:
 *   - every column of every project-linked production table is read by a Sunny reader (or read-and-reduced as a secret);
 *   - every mutating route that touches project data is in the action inventory;
 *   - the global gap registry is valid and disposes every inherited 92671ee gap;
 *   - project_view V2 serves every section with provenance, bounded, Owner-only, with no secret;
 *   - price evidence keeps every distinction; waiting / history / calendar / show context never invent;
 *   - P2 is not a copy of canonical state.
 *
 * Run with:   npx tsx scripts/test-sunny-complete-knowledge.tsx      NEVER touches production.
 */
import fs from "node:fs";
import path from "node:path";
import { FORBIDDEN_SERVED_TERMS, DOMAIN_CONTRACTS, validateSystemRegistry, SYSTEM_BASELINE_VERSION, CAPABILITY_CHANGES } from "../lib/partner/system";
import { KNOWLEDGE_GAPS, DOMAIN_KNOWLEDGE_DEPTH, validateKnowledgeGaps } from "../lib/partner/system/gaps";
import { PROJECT_ACTIONS, PROJECT_ACTION_EXCLUSIONS, ACTION_CONTRACT_FIELDS, APPROVAL_CLASSES } from "../lib/partner/system/project-actions";
import { PROJECT_TABLE_COLUMNS, PROJECT_REDUCED_COLUMNS, PROJECT_READER_FILES, PROJECT_COLUMNS_READ_ELSEWHERE } from "../lib/partner/system/project-columns";
import { PROJECT_SCHEMA_COLUMNS } from "../lib/partner/system/projects";
import { PROJECT_DETAIL_SOURCES } from "../lib/partner/projects/detail-types";
import { PARTNER_KNOWLEDGE_REGISTRY } from "../lib/partner/knowledge/catalog";
import { entityKnowledge, queryKnowledgeCore } from "../lib/partner/knowledge/query";
import type { KnowledgeAudience, QueryResponse } from "../lib/partner/knowledge/types";
import { KNOWLEDGE_KINDS } from "../lib/partner/owner-knowledge/kinds";
import type { OperationsRaw } from "../lib/partner/operations/types";
import type { GatewayFinance, GatewaySources } from "../lib/partner/gateway/core";
import { parseEntityKey } from "../lib/partner/gateway/keys";
import { deriveFinanceView } from "../lib/partner/finance/view";
import { buildFinanceBrief } from "../lib/partner/finance/brief";
import type { FinanceRaw } from "../lib/partner/finance/types";
import { buildProjectSection, priceEvidence, PROJECT_SECTIONS } from "../lib/partner/projects/sections";
import { scrubSecrets } from "../lib/partner/projects/detail-reader";
import type { ProjectDetailRaw } from "../lib/partner/projects/detail-types";
import { NOW, P, U, C_AVI, input } from "./fixtures/integrity-company";
import { empty, tx } from "./fixtures/finance-mirror";
import { fakeDetailClient, projectDetailFixture, PLANTED_SECRETS, LONG_NOTE } from "./fixtures/project-detail";
import { readProjectDetailRaw } from "../lib/partner/projects/detail-reader";

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
const walk = (dir: string, out: string[] = []) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) walk(p, out); else if (e.name === "route.ts") out.push(p); } return out; };
const rel = (p: string) => path.relative(ROOT, p).replace(/\\/g, "/");

// ── fixture ──
const sec = <T,>(rows: T[]) => ({ rows, capped: false });
const OPS: OperationsRaw = {
  redFilms: sec([{ id: U(801), title: "קליפ שליו", productionType: "קליפ", status: "בעריכה", projectId: P(1), clientId: null, artistName: "שליו טסמה", clientSource: "אמן לייבל", shootDate: "2026-09-20", publishDate: null, editStatus: "בעריכה", collectionStatus: "לא רלוונטי", generalBudget: 8000, clientPrice: null, advanceRequired: null, advanceReceived: null }]),
  budgetItems: sec([]), budgetPayments: sec([]), equipment: sec([]), clipItems: sec([]), beats: sec([]), beatAssignments: sec([]), campaigns: sec([]), contentItems: sec([]), promotions: sec([]), balanceCycles: sec([]), albumTracks: sec([]),
  meetings: sec([]), projectActions: sec([{ id: U(821), projectId: P(2), actionType: "sent", contentType: "mix", recipientRole: "artist", status: "pending_feedback", actionDate: "2026-09-15", followupDate: "2026-09-20" }]),
  engineerWork: sec([
    { id: U(851), projectId: P(2), engineerName: "Steven", workType: "מיקס + מאסטר", workTitle: null, status: "בתהליך", sentDate: "2026-09-10", internalDeadline: "2026-09-30", agreedPrice: 200, amountPaid: 0, currency: "$", paymentDate: null },
    { id: U(852), projectId: P(4), engineerName: "Bill", workType: "מיקס", workTitle: null, status: "אושר", sentDate: "2026-08-10", internalDeadline: null, agreedPrice: 800, amountPaid: 0, currency: "₪", paymentDate: null },
  ]),
  mixVersions: sec([{ id: U(861), workId: U(851), status: "בבדיקה", createdAt: "2026-09-18T10:00:00Z" }]), mixComments: sec([{ versionId: U(861), status: "open" }]), finalFiles: sec([]),
  deliveries: sec([{ projectId: P(3), status: "ready", deliveredAt: null }]),
  projectsMeta: sec([
    { id: P(2), name: "אבי 1", status: "בעבודה", projectType: "שיר", businessType: "לקוח", artistText: "אבי מולה", deadline: "2026-09-01", startDate: "2026-08-01", endDate: null, parentProject: "אלבום: אבי 2", isHidden: false, plannedHours: null, plannedDays: null, updatedAt: "2026-09-20T10:00:00Z" },
    { id: P(3), name: "אבי 2", status: "הושלם", projectType: "אלבום", businessType: "לקוח", artistText: "אבי מולה, שליו טסמה", deadline: null, startDate: null, endDate: "2026-09-01", parentProject: "ללא שיוך", isHidden: false, plannedHours: null, plannedDays: null, updatedAt: "2026-09-01T10:00:00Z" },
  ]),
  integrations: { googleCalendarConnected: true, dropboxConnected: true },
};
function finRaw(): FinanceRaw {
  return empty({
    transactions: [tx({ projectId: P(2), type: "income", amount: 600, status: "שולם" }), tx({ projectId: P(6), type: "income", amount: 300, status: "שולם" })],
    financeSettings: [{ projectId: P(2), value: { agreedPrice: 1000, currency: "₪" } }, { projectId: P(4), value: { agreedPrice: 0 } }, { projectId: P(5), value: { clipAgreedPrice: 3500 } }, { projectId: P(8), value: { agreedPrice: 2000, currency: "₪" } }],
  });
}
let DETAIL: ProjectDetailRaw;
function sources(o: { detail?: ProjectDetailRaw | "UNAVAILABLE"; fin?: FinanceRaw; proposals?: Array<{ linked: string; amount: number }>; shows?: boolean } = {}): GatewaySources {
  const st = structuredClone(input({ contexts: [] }).state!);
  if (o.proposals && st.domains.proposalsFull.data) st.domains.proposalsFull.data.items = o.proposals.map((p, i) => ({ id: U(950 + i), clientId: C_AVI, clientName: "אבי מולה", linkedProjectId: p.linked, title: "הצעה", amount: p.amount, currency: "₪", status: "נסגר", followupYmd: null, sentYmd: null, createdAt: null, updatedAt: null }));
  if (o.shows && st.domains.shows.data) st.domains.shows.data.items = [{ id: U(960), name: "הופעה של אבי", status: "סגור", paymentStatus: "", dateYmd: "2026-10-10", djClientId: null, djConfirmationStatus: null, artistClientId: C_AVI, bookerClientId: null, price: 5000 }];
  const raw = o.fin ?? finRaw();
  const view = deriveFinanceView(raw, NOW, []);
  const f: GatewayFinance = { state: view.state, integrity: view.integrity, actions: view.actions, raw, brief: buildFinanceBrief(view.state, view.integrity, { answersAvailable: true, actionNoteHe: view.actionNoteHe }), answersAvailable: true };
  return { now: NOW, state: { status: "OK", value: st }, finance: { status: "OK", value: f }, identities: { cleantone: null },
    cases: { status: "OK", value: [] }, actions: { status: "OK", value: [] }, outcomes: { status: "OK", value: [] }, ownerKnowledge: { status: "OK", value: [] },
    operations: { status: "OK", value: OPS }, projectDetail: o.detail === "UNAVAILABLE" ? { status: "UNAVAILABLE", detail: "x" } : { status: "OK", value: o.detail ?? DETAIL } };
}
const q = (params: Record<string, string>, src = sources(), aud = OWNER, limit?: number): QueryResponse => queryKnowledgeCore(REG, { capability: "project_view", params, ...(limit ? { limit } : {}) }, src, aud);
const sa = (mode: string, params: Record<string, string> = {}) => queryKnowledgeCore(REG, { capability: "system_awareness", mode, params }, sources(), OWNER);

async function main() {
  DETAIL = await projectDetailFixture();
  const P2 = `project:${P(2)}`;

  section("1. Complete-system charter is permanent in the repository contract");
  const agents = read("AGENTS.md");
  ok("AGENTS.md: SUNNY COMPLETE SYSTEM AWARENESS + 'everything Redbloods knows'", /SUNNY COMPLETE SYSTEM AWARENESS/.test(agents) && /SUNNY KNOWS EVERYTHING REDBLOODS KNOWS/.test(agents));
  ok("charter: secrets are not knowledge / connect not copy / progressive disclosure / provenance / approval flow", ["SECRETS ARE NOT KNOWLEDGE", "CONNECT, DO NOT COPY", "MAXIMUM KNOWLEDGE, MINIMUM CONTEXT", "PROVENANCE", "OWNER APPROVAL"].every((t) => agents.includes(t)));
  check("charter lists the 15 questions", [...agents.matchAll(/\b(\d{1,2})\. /g)].map((m) => Number(m[1])).filter((n, i, a) => a.indexOf(n) === i && n <= 15).length >= 15, true);
  ok("charter points at the proving tests + contracts", /test-sunny-complete-knowledge\.tsx/.test(agents) && /project-columns\.ts/.test(agents) && /project-actions\.ts/.test(agents) && /gaps\.ts/.test(agents));

  section("2. Global gap registry");
  const capIds = REG.all().map((c) => c.id);
  check("validateKnowledgeGaps()", validateKnowledgeGaps({ domainIds: DOMAIN_CONTRACTS.map((d) => d.id), capabilityIds: capIds }), []);
  check("validateSystemRegistry()", validateSystemRegistry({ capabilityIds: capIds, knowledgeKinds: KNOWLEDGE_KINDS.map((k) => k.kind) }), []);
  const INHERITED = ["project notes not read", "project files not read", "work_materials not read", "dropbox_folder not read", "shows ↔ projects not linked", "client ↔ project name-only", "parent project name-only", "Google Calendar beyond sessions not read", "Red Films crew not read", "waiting for client / artist not recorded", "19 open projects PRICE_UNKNOWN", "9 orphan finance settings", "12 unfrozen Dropbox folders", "finance conflicts C1–C17", "page-load side effects", "proposal conversion non-transactional", "status not server-validated", "project delete not transactional", "concurrent file-write risk"];
  check("every inherited 92671ee gap has exactly one disposition", INHERITED.filter((x) => KNOWLEDGE_GAPS.filter((g) => g.inherited92671ee === x).length !== 1), []);
  check("inherited count", INHERITED.length, 19);
  ok("INTENTIONALLY_SECRET only for credentials / bearer links", KNOWLEDGE_GAPS.filter((g) => g.class === "INTENTIONALLY_SECRET").every((g) => g.id.startsWith("SECRET_")) && KNOWLEDGE_GAPS.filter((g) => g.class === "INTENTIONALLY_SECRET").length === 2);
  check("every system domain has a knowledge-depth status", DOMAIN_CONTRACTS.map((d) => d.id).filter((d) => !DOMAIN_KNOWLEDGE_DEPTH[d]), []);
  ok("calendar is a CAPABILITY_GAP needing approval, NOT permanently unavailable", KNOWLEDGE_GAPS.find((g) => g.id === "PRJ_CALENDAR_LIVE")!.class === "CAPABILITY_GAP" && KNOWLEDGE_GAPS.find((g) => g.id === "PRJ_CALENDAR_LIVE")!.appRemediation === "OAUTH_OR_INTEGRATION_APPROVAL");
  const kg = sa("knowledge_gaps");
  check("system_awareness knowledge_gaps serves every gap", kg.page?.total, KNOWLEDGE_GAPS.length);
  ok("version bumped + change logged", SYSTEM_BASELINE_VERSION >= "2026.09.25-3" && CAPABILITY_CHANGES.some((c) => c.version === "2026.09.25-3" && c.domain === "PROJECTS"));

  section("3. PROOF: every project-linked production column is read by Sunny");
  const readerSrc = PROJECT_READER_FILES.map(read).join("\n");
  const selected: Record<string, Set<string>> = {};
  for (const m of readerSrc.matchAll(/(?:readSection\(client, |\br\()"([a-z_]+)",\s*"([^"]+)"/g)) for (const c of m[2].split(",")) (selected[m[1]] ??= new Set()).add(c.trim().split(":").pop()!.split("->")[0].trim());
  const unread: string[] = [];
  for (const [t, cols] of Object.entries(PROJECT_TABLE_COLUMNS)) for (const c of cols) {
    if (selected[t]?.has(c)) continue;
    const elsewhere = PROJECT_COLUMNS_READ_ELSEWHERE[`${t}.${c}`] ?? PROJECT_COLUMNS_READ_ELSEWHERE[t];
    if (elsewhere && new RegExp(`\\b${c}\\b`).test(read(elsewhere))) continue;
    unread.push(`${t}.${c}`);
  }
  check("project-linked columns Sunny does not read", unread, []);
  const totalCols = Object.values(PROJECT_TABLE_COLUMNS).flat().length;
  ok(`${Object.keys(PROJECT_TABLE_COLUMNS).length} tables / ${totalCols} columns pinned`, totalCols > 350);
  check("every project-referencing schema column's table is pinned", PROJECT_SCHEMA_COLUMNS.map((c) => c.split(".")[0]).filter((t) => !PROJECT_TABLE_COLUMNS[t]), []);
  check("every reduced column exists in the pinned schema", Object.keys(PROJECT_REDUCED_COLUMNS).filter((k) => !PROJECT_TABLE_COLUMNS[k.split(".")[0]]?.includes(k.split(".")[1])), []);
  ok("the detail source lists what it reads", PROJECT_DETAIL_SOURCES.length >= 28);

  section("4. PROOF: every mutating project route is in the action inventory");
  const inventoried = new Set(PROJECT_ACTIONS.flatMap((a) => a.internal.routes));
  const touching = walk(path.join(ROOT, "app/api")).map(rel).filter((f) => { const t = code(read(f)); return /export (async )?function (POST|PUT|PATCH|DELETE)|export const (POST|PUT|PATCH|DELETE)/.test(t) && /projectId|project_id|"projects"|projects-store|linked_project|touchProject|updateProject|sound_engineer|vendor_project_work|project_actions|clip_items|album_tracks|final_files|mix_/.test(t); });
  check("mutating project routes missing from the inventory", touching.filter((f) => !inventoried.has(f) && !PROJECT_ACTION_EXCLUSIONS[f]), []);
  check("inventory routes that do not exist", [...inventoried].filter((f) => !fs.existsSync(path.join(ROOT, f))), []);
  ok(`${touching.length} mutating project routes found, ${PROJECT_ACTIONS.length} inventory entries`, touching.length >= 50 && PROJECT_ACTIONS.length >= 70);
  check("Sunny can execute only the deadline action today", PROJECT_ACTIONS.filter((a) => a.sunnyToday !== "KNOWLEDGE_ONLY").map((a) => a.id), ["SUNNY_DEADLINE"]);
  check("irreversible high-risk actions are DESTRUCTIVE / BULK class", PROJECT_ACTIONS.filter((a) => a.reversible === "NO" && a.risk === "HIGH" && !["DESTRUCTIVE", "BULK"].includes(a.approvalClass ?? "")).map((a) => a.id), []);
  ok("action contract has all 16 fields + 6 approval classes", ACTION_CONTRACT_FIELDS.length === 16 && Object.keys(APPROVAL_CLASSES).length === 6);
  const ai = sa("action_inventory");
  check("action_inventory served without internals", [ai.page?.total, JSON.stringify(ai).includes("\"internal\""), JSON.stringify(ai).includes("app/api")], [PROJECT_ACTIONS.length, false, false]);

  section("5. Reader: read-only, bounded, secrets never leave the edge");
  const fk = fakeDetailClient();
  const raw = await readProjectDetailRaw(fk.client);
  const rawJson = JSON.stringify(raw);
  check("planted secrets in the reader output", PLANTED_SECRETS.filter((s) => rawJson.includes(s)), []);
  ok("links became booleans (hasShareLink / hasLink / hasFolderLink)", raw.projects!.rows[0].files.every((f) => f.hasShareLink) && raw.actions!.rows[0].hasLink && raw.victor!.rows[0].hasFolderLink && raw.productions!.rows[0].links.rawFiles);
  ok("public YouTube reference kept, private reference link dropped", raw.victor!.rows[0].references[0].publicUrl === "https://youtube.com/watch?v=abc" && raw.victor!.rows[0].references[1].publicUrl === null);
  ok("JSON settings deep-scrubbed (link keys → has_*)", JSON.stringify(raw.projectSettings).includes("has_shareUrl"));
  check("scrubSecrets redacts tokens / share links, keeps normal text", [scrubSecrets(`a ${PLANTED_SECRETS[0]} b`)!.includes("dropbox"), scrubSecrets("שלום עולם")], [false, "שלום עולם"]);
  ok("the fake client exposes SELECT only (no insert / update / delete / rpc on the interface)", !/\.(insert|update|upsert|delete|rpc)\s*\(/.test(code(read("lib/partner/projects/detail-reader.ts"))));
  ok("settings are read only by prefix (never all settings)", fk.calls.filter((c) => c.table === "settings").every((c) => !!c.like));

  section("6. project_view V2 — every section, with provenance");
  const summary = q({ project: P2 });
  const sidx = summary.items[0].fields.sections as Record<string, number>;
  ok("summary = one item with a section index", summary.items.length === 1 && Object.keys(sidx).length >= 24);
  const bad = PROJECT_SECTIONS.filter((s) => q({ project: P2, section: s }).status !== "OK");
  check("every section answers", bad, []);
  const notes = q({ project: P2, section: "notes" }, sources(), OWNER, 50);
  const nt = JSON.stringify(notes);
  ok("notes include project notes, send log, session, meeting, task, engineer, mix comment, Victor brief / review, transaction, proposal", ["הלקוח אולי רוצה לדחות", "שלחתי מיקס 2", "הקלטנו פזמון", "לדבר על קליפ", "להתקשר לאבי", "להוריד את הווקאל", "אווירה של קיץ", "לתקן פתיח", "מקדמה", "כולל 3 סשנים", "שולם חצי במזומן"].every((t) => nt.includes(t)));
  const n1 = notes.items.find((i) => i.fields.source === "PROJECT_NOTES")!;
  check("a note is OWNER_REPORTED free text, never a fact", [n1.epistemic, n1.fields.textClass, n1.label.trust], ["OWNER_REPORTED", "FREE_TEXT_EVIDENCE_NOT_CANONICAL", "RECORD"]);
  check("'the client may want to postpone' does NOT change the status", q({ project: P2, section: "identity" }).items[0].fields.status, "בעבודה");
  const files = q({ project: P2, section: "files" }, sources(), OWNER, 50);
  const kinds = [...new Set(files.items.map((i) => i.fields.kind))].sort();
  check("file universe: project files, mix versions, Victor files, comment attachments", kinds, ["COMMENT_ATTACHMENT", "MIX_VERSION", "PROJECT_FILE", "TRANSACTION_RECEIPT_REFERENCE", "VICTOR_BRIEF_FILE", "VICTOR_DELIVERED"]);
  ok("file metadata: version / path / uploadedAt / source; share link only as a boolean", files.items.some((i) => i.fields.version === "V1" && i.fields.path && i.fields.uploadedAt && i.fields.hasShareLink === true) && files.items.some((i) => i.fields.source === "MIX_VERSION_COPY"));
  ok("unfrozen folder is disclosed", files.coverage.some((c) => c.text.includes("לא קפואה")));
  ok("expected material missing: approved engineer work without final files", JSON.stringify(q({ project: `project:${P(4)}`, section: "files" })).includes("EXPECTED_MATERIAL_MISSING"));
  const p4files = JSON.stringify(q({ project: `project:${P(4)}`, section: "files" }, sources(), OWNER, 50));
  ok("Steven final-files request markers (project + work settings) are visible, token scrubbed", (p4files.match(/FINAL_FILES_REQUESTED/g) ?? []).length >= 2 && !p4files.includes("sl.ABCDEFG"));
  const mats = q({ project: P2, section: "materials" });
  ok("materials: BPM / key / instructions (token redacted) + work-material file + Victor brief", JSON.stringify(mats).includes("\"bpm\":\"95\"") && JSON.stringify(mats).includes("WORK_MATERIAL_FILE") && !JSON.stringify(mats).includes("sl.ABCDEFG"));
  const rf = q({ project: `project:${P(1)}`, section: "red_films" });
  check("Red Films crew = text identity, link exists", [rf.items[0].fields.relation, (rf.items[0].fields.crew as Record<string, unknown>).photographer, String((rf.items[0].fields.crew as Record<string, unknown>).identity).startsWith("CREW_IDENTITY_TEXT")], ["RED_FILMS_LINK_EXISTS", "דני לוי", true]);
  ok("release blocker / responsible readable", JSON.stringify(q({ project: `project:${P(1)}`, section: "release" })).includes("מחכים לעטיפה"));
  ok("notifications + agent alerts readable", ["Steven העלה מיקס", "דדליין עבר"].every((t) => JSON.stringify(q({ project: P2, section: "notifications" })).includes(t)));

  section("7. Traversal + relationship provenance");
  const graph = q({ project: P2, section: "graph" }, sources({ proposals: [{ linked: P(2), amount: 1000 }] }), OWNER, 50);
  const Q = ["CANONICAL_RELATION", "OWNER_CONFIRMED_RELATION", "DERIVED_RELATION", "TEXT_MATCH", "AMBIGUOUS", "UNKNOWN"];
  check("every edge carries an allowed quality", graph.items.filter((i) => !Q.includes(String(i.fields.quality))).map((i) => i.id), []);
  check("traversable edges have real entity keys", graph.items.filter((i) => i.fields.traversable && !parseEntityKey(String(i.fields.to))).map((i) => i.fields.to), []);
  const rels = graph.items.map((i) => i.fields.relation);
  ok("project → client (text), client id bridge, proposal, session, Steven, task, meeting, transactions, parent", ["CLIENT", "CLIENT_BY_ID_BRIDGE", "PROPOSAL", "SESSION", "STEVEN", "TASK", "MEETING", "TRANSACTIONS", "PARENT_PROJECT"].every((r) => rels.includes(r)));
  const parent = graph.items.find((i) => i.fields.relation === "PARENT_PROJECT")!;
  check("parent 'אלבום: אבי 2' resolves by exact name as TEXT_MATCH", [parent.fields.to, parent.fields.quality], [`project:${P(3)}`, "TEXT_MATCH"]);
  ok("child edge on the parent side", q({ project: `project:${P(3)}`, section: "graph" }).items.some((i) => i.fields.relation === "CHILD_PROJECT" && i.fields.to === P2));
  ok("no show edge in the graph (shows never link to projects)", !rels.includes("SHOW"));
  const sc = q({ project: P2, section: "show_context" }, sources({ shows: true }));
  check("show context is ARTIST_LEVEL, flagged not a project relation, plus the data-model gap", [sc.items[0].fields.relation, sc.items[0].fields.notAProjectRelation, sc.items.at(-1)!.fields.relation], ["ARTIST_LEVEL_CONTEXT", true, "DATA_MODEL_GAP"]);
  const enr = entityKnowledge(REG, { ...sources(), audience: OWNER }, P2);
  const pv = enr.find((s) => s.capability === "project_view");
  ok("partner_entity(project) includes the V2 summary (1 bounded item)", !!pv && pv.items.length === 1);

  section("8. Price evidence — every distinction kept, no source silently chosen");
  const pc = (id: string, o: Parameters<typeof sources>[0] = {}) => priceEvidence(sources(o), id).class;
  check("canonical price", pc(P(2)), "PRICE_EXISTS_CANONICALLY");
  check("stored 0 (not collapsed into unknown)", pc(P(4)), "PRICE_ZERO_STORED");
  check("clip price only — not the project price", pc(P(5)), "CLIP_PRICE_ONLY");
  check("label project with no price", pc(P(1)), "LABEL_NO_RECEIVABLE_CONTEXT");
  check("nothing anywhere", pc(P(7)), "LABEL_NO_RECEIVABLE_CONTEXT");
  check("no price but income rows", pc(P(6)), "UNRESOLVED");
  check("proposal only → exists elsewhere (not adopted)", pc(P(3), { proposals: [{ linked: P(3), amount: 4000 }] }), "PRICE_EXISTS_ELSEWHERE");
  check("setting ≠ linked proposal → conflict", pc(P(8), { proposals: [{ linked: P(8), amount: 2500 }] }), "PRICE_CONFLICT");
  check("not recorded anywhere (client project)", pc(P(3)), "PRICE_NOT_RECORDED");
  ok("portfolio carries the price class", queryKnowledgeCore(REG, { capability: "project_portfolio" }, sources(), OWNER).items.every((i) => typeof i.fields.priceClass === "string"));

  section("9. Waiting / blockers — evidence, never invented");
  const w = q({ project: P2, section: "waiting" }, sources(), OWNER, 50);
  const on = w.items.map((i) => `${i.fields.waitingOn}:${i.fields.evidence}`);
  ok("send log → ARTIST; engineer → ENGINEER; open comment → ENGINEER; Victor draft → OWNER; needs revision → VICTOR; money → CLIENT", ["ARTIST:send log entry", "ENGINEER:engineer work status", "ENGINEER:open mix comments", "OWNER:Victor review notes written but not sent", "VICTOR:Victor version review needs revision", "CLIENT:"].every((x) => on.some((o) => o.startsWith(x))));
  const w6 = q({ project: `project:${P(6)}`, section: "waiting" }, sources({ detail: { ...DETAIL, actions: { rows: [], capped: false } } }));
  check("no evidence → DATA_NOT_RECORDED (never 'nobody')", [w6.items.length, w6.items[0].fields.waitingOn, w6.items[0].epistemic], [1, "DATA_NOT_RECORDED", "UNKNOWN"]);

  section("10. History vs current state + calendar");
  const h = q({ project: P2, section: "history" }, sources(), OWNER, 50);
  ok("events are historical, newest first", h.items.filter((i) => i.fields.historical).every((i, k, a) => k === 0 || String(a[k - 1].fields.at) >= String(i.fields.at)));
  const nr = h.items.find((i) => i.fields.kind === "HISTORY_NOT_RECORDED")!;
  check("HISTORY_NOT_RECORDED stated with the CURRENT status", [nr.epistemic, (nr.fields.current as Record<string, unknown>).status], ["UNKNOWN", "בעבודה"]);
  const cal = q({ project: P2, section: "calendar" }, sources(), OWNER, 50);
  ok("calendar: session / meeting / task links from Redbloods; live Google gap disclosed", ["SESSION", "MEETING", "TASK"].every((k) => cal.items.some((i) => i.fields.kind === k)) && cal.coverage.some((c) => c.text.includes("פער יכולת")));

  section("11. Progressive disclosure / bounded context");
  const long = q({ project: `project:${P(4)}`, section: "notes" });
  const lt = (long.items[0].fields.text as { text: string }).text;
  check("deep text allowed up to 4000 chars (then capped), labels stay short", [lt.length, long.items[0].label.text.length <= 81], [4001, true]);
  ok("LONG_NOTE really longer than the cap", LONG_NOTE.length === 5000);
  check("paging bounded at 50", queryKnowledgeCore(REG, { capability: "project_view", params: { project: P2, section: "notes" }, limit: 51 }, sources(), OWNER).status, "INVALID_REQUEST");
  const un = q({ project: P2, section: "notes" }, sources({ detail: "UNAVAILABLE" }));
  check("detail source down → UNKNOWN + missing (never 'no notes')", [un.completeness, un.items.length, un.missing.length > 0], ["UNKNOWN", 0, true]);

  section("12. Owner-only");
  check("every section refused for a non-Owner", PROJECT_SECTIONS.filter((s) => q({ project: P2, section: s }, sources(), STRANGER).status === "OK"), []);

  section("13. Secret exclusion in everything served");
  const everything = JSON.stringify(PROJECT_SECTIONS.map((s) => [P2, `project:${P(1)}`, `project:${P(4)}`].map((p) => q({ project: p, section: s }, sources({ shows: true }), OWNER, 50))));
  check("planted secrets served anywhere", PLANTED_SECRETS.filter((s) => everything.includes(s)), []);
  ok("no raw url / shareUrl keys served", !/"(url|dropboxShareUrl|dropboxUrl|filesLink|shareLink)":/.test(everything));
  const sys = JSON.stringify([sa("knowledge_gaps"), sa("action_inventory"), sa("changes")]);
  check("no implementation term served by system awareness", FORBIDDEN_SERVED_TERMS.filter((t) => sys.toLowerCase().includes(t.toLowerCase())), []);

  section("14. No duplicate brain — P2 is not canonical storage");
  const kindsList = KNOWLEDGE_KINDS.map((k) => k.kind);
  check("no P2 kind copies canonical state", kindsList.filter((k) => /STATUS|PRICE|DEADLINE|RECORD|FILE|NOTE|TRANSACTION|SHOW_|CLIENT_|PROJECT_DATA|SESSION/.test(k)), []);
  for (const f of ["lib/partner/projects/detail-reader.ts", "lib/partner/projects/sections.ts", "lib/partner/projects/view.ts", "lib/partner/knowledge/capabilities/projects-deep.ts"]) {
    const t = code(read(f));
    ok(`${f}: never writes P2 / never mutates`, !/commitKnowledge|createOwnerKnowledgeStore|partner_owner_knowledge|\.(insert|update|upsert|delete|rpc)\s*\(/.test(t));
  }
  ok("the detail source never reads Owner knowledge / Owner context tables", !/partner_owner_knowledge|partner_owner_context/.test(read("lib/partner/projects/detail-reader.ts")));
}

main().then(() => { console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1); });
