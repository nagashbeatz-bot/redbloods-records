/**
 * Sunny VICTOR DEEP BRAIN — coverage guards + reasoning scenarios A–P.
 *
 * Guards (permanent): every Victor work column classified; every production Victor settings key classified; status /
 * work-state / outcome vocabularies equal the code; every Victor / vendor storage route belongs to a route family; the
 * Victor server files are unchanged since the last review (VICTOR_REVIEWED_FINGERPRINTS); the handoff reuses the
 * app's own ball rule (no second rule); the view is pure; the security findings stay registered.
 *
 * Run with:   npx tsx scripts/test-sunny-victor.tsx      Pure; never touches production.
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { PARTNER_KNOWLEDGE_REGISTRY } from "../lib/partner/knowledge/catalog";
import { queryKnowledgeCore } from "../lib/partner/knowledge/query";
import type { KnowledgeAudience, QueryResponse } from "../lib/partner/knowledge/types";
import type { GatewayFinance, GatewaySources } from "../lib/partner/gateway/core";
import type { OperationsRaw } from "../lib/partner/operations/types";
import type { ProjectDetailRaw, DetailVictorWork, DetailAction } from "../lib/partner/projects/detail-types";
import type { SettingsState } from "../lib/partner/settings/types";
import type { FinanceRaw } from "../lib/partner/finance/types";
import { deriveFinanceView } from "../lib/partner/finance/view";
import { buildFinanceBrief } from "../lib/partner/finance/brief";
import { buildVictorView } from "../lib/partner/victor/view";
import * as VM from "../lib/partner/system/victor";
import { SECURITY_GAPS } from "../lib/partner/system/people";
import { DOMAIN_CONTRACTS, FORBIDDEN_SERVED_TERMS, CAPABILITY_CHANGES, validateSystemRegistry } from "../lib/partner/system";
import { DOMAIN_KNOWLEDGE_DEPTH, KNOWLEDGE_GAPS, validateKnowledgeGaps } from "../lib/partner/system/gaps";
import { KNOWLEDGE_KINDS } from "../lib/partner/owner-knowledge/kinds";
import { VICTOR_STATUSES, VICTOR_WORK_STATES, VICTOR_OUTCOMES } from "../lib/types";
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

// ── fixture ──
const sec = <T,>(rows: T[]) => ({ rows, capped: false });
const EMPTY = Object.fromEntries(["projects", "financeNotes", "deliveries", "actions", "sessions", "meetings", "tasks", "engineerWork", "mixVersions", "mixComments", "commentAttachments", "mixTargets", "mixTargetNotes", "finalFiles", "victor", "productions", "budgetItems", "albumTracks", "clipItems", "proposals", "releases", "campaigns", "contentItems", "socialFiles", "projectSettings", "transactionsText", "budgetPayments", "agentAlerts", "notifications"].map((k) => [k, { rows: [], capped: false }])) as unknown as ProjectDetailRaw;
const file = (name: string, v: string | null, at: string | null) => ({ name, category: null, versionLabel: v, trackId: null, durationSeconds: 180, size: 1000, uploadedAt: at, path: `/Projects/x/Victor/Production/${name}`, hasShareLink: true, fromMixVersionId: null, structureMarkers: 0 });
const review = (version: string, sentAt: string | null, draft = false, notes = "תקן את הפתיחה") => ({ version, status: "waiting", notes, sentNotes: sentAt ? notes : null, sentAt, draft, reviewedAt: null });
const work = (id: number, o: Partial<DetailVictorWork>): DetailVictorWork => ({ id: U(id), projectId: null, vendorName: "victor", title: `עבודה ${id}`, status: "פעיל", workState: "נשלח לויקטור", sentDate: "2026-09-01", internalDeadline: null, linkedTaskId: null, createdAt: "2026-09-01T10:00:00Z", updatedAt: "2026-09-10T10:00:00Z",
  notes: null, briefText: "בריף", references: [], reviews: [], filesSent: [], filesReceived: [], briefFiles: [], returnedDate: null, outcome: null, quality: null, enteredProject: null, dropboxFolder: "/Projects/x/Victor", hasFolderLink: true, ...o });
const W_NOTES = 701, W_STANDALONE = 702, W_CONFLICT = 703, W_DONE = 704, W_OLD_UPLOAD = 705;
interface Opt { afterFeedbackUpload?: boolean }
function works(o: Opt): DetailVictorWork[] {
  return [
    work(W_NOTES, { projectId: P(2), title: "אבי 1", internalDeadline: "2026-09-20", linkedTaskId: U(961), filesSent: [file("a V1.wav", "V1", "2026-09-10T10:00:00Z"), ...(o.afterFeedbackUpload ? [file("a V2.wav", "V2", "2026-09-15T10:00:00Z")] : [])], reviews: [review("V1", "2026-09-12T10:00:00Z")] }),
    work(W_STANDALONE, { title: "ביט חדש" }),
    work(W_CONFLICT, { projectId: P(1), title: "שיר לייבל", filesSent: [file("l V1.wav", "V1", "2026-09-01T10:00:00Z")], reviews: [review("V1", "2026-09-05T10:00:00Z"), review("V2", null, true, "טיוטה")] }),
    work(W_DONE, { projectId: P(4), title: "נגש 1", status: "הושלם", returnedDate: "2026-09-20", filesSent: [file("n V3.wav", "V3", "2026-09-18T10:00:00Z")] }),
    work(W_OLD_UPLOAD, { projectId: P(5), title: "כפול", internalDeadline: "2026-09-15", filesSent: [file("k V1.wav", "V1", "2026-09-01T10:00:00Z")] }),
  ];
}
const action = (projectId: string, status: string): DetailAction => ({ id: U(981), projectId, actionType: "sent", contentType: "הפקה", versionLabel: null, recipientRole: "external_producer", recipientName: "ויקטור", recipientClientId: null, recipientPhone: null, hasLink: false, status, actionDate: "2026-09-06", followupDate: null, notes: null, linkedWorkId: U(W_CONFLICT), linkedTaskId: null, createdAt: null, updatedAt: null });
const SETTINGS: SettingsState = { families: {
  VICTOR_SALARY_SETTINGS: sec([{ key: "vendor_victor_settings", updatedAt: null, value: { monthlyGoal: 12, monthlySalary: 550, salaryCurrency: "$", salaryPayDay: 10, stuckAfterDays: 5, paceMetric: "נכנסו לפרויקט בפועל" } }]),
  VICTOR_SALARY_OVERRIDES: sec([{ key: "vendor_victor_salary_overrides", updatedAt: null, value: { "2026-05": 550, "2026-06": 500 } }, { key: "vendor_victor_salary_status_overrides", updatedAt: null, value: { "2026-05": "שולם", "2026-06": "שולם", "2026-08": "שולם" } }]),
  VICTOR_LEGACY_MONTH_PAYMENT: sec([{ key: "vendor_victor_payment_2026_05", updatedAt: null, value: { status: "צפוי", paidDate: null } }]),
  PORTAL_PRESENCE: sec([{ key: "victor_visit_last", updatedAt: null, value: { at: "2026-09-24T08:00:00Z" } }]),
  PUSH_SENT_ONCE_MARKERS: sec([{ key: `victor_work_completed_pushed_${U(W_DONE)}`, updatedAt: null, value: {} }]),
} };
function sources(o: Opt = {}): GatewaySources {
  const st = input({ contexts: [] }).state!;
  const t = (over: Record<string, unknown>, link: string) => ({ ...tx(over as Parameters<typeof tx>[0]), linkedSessionId: link });
  const raw: FinanceRaw = { ...empty({ transactions: [t({ type: "expense", amount: 550, currency: "$", status: "שולם" }, "victor_salary_2026-08"), t({ type: "expense", amount: 1800, currency: "₪", status: "שולם" }, "victor_salary_2026-04")] }),
    victorSalary: ["04", "05", "06", "07", "08"].map((m) => ({ workMonth: `2026-${m}`, dueDate: `2026-${String(Number(m) + 1).padStart(2, "0")}-10`, amount: m === "06" ? 500 : 550, currency: "$", status: m === "08" || m === "05" || m === "06" ? "שולם" : "לא שולם", transactionId: null })) };
  const view = deriveFinanceView(raw, NOW, []);
  const f: GatewayFinance = { state: view.state, integrity: view.integrity, actions: view.actions, raw, brief: buildFinanceBrief(view.state, view.integrity, { answersAvailable: true, actionNoteHe: view.actionNoteHe }), answersAvailable: true };
  const ops = { engineerWork: sec([]), integrations: { googleCalendarConnected: true, dropboxConnected: true } } as unknown as OperationsRaw;
  const det: ProjectDetailRaw = { ...EMPTY, victor: sec(works(o)), actions: sec([action(P(1), "got_notes")]),
    tasks: sec([{ id: U(961), relatedType: "project", relatedId: P(2), title: "מעקב ויקטור — אבי 1", notes: null, status: "פתוח", dueDate: "2026-09-20", startTime: null, endTime: null, showId: null, hasGoogleTask: true, createdAt: null, updatedAt: null }]) };
  return { now: NOW, state: { status: "OK", value: st }, finance: { status: "OK", value: f }, identities: { cleantone: null },
    cases: { status: "OK", value: [] }, actions: { status: "OK", value: [] }, outcomes: { status: "OK", value: [] }, ownerKnowledge: { status: "OK", value: [] },
    projectDetail: { status: "OK", value: det }, operations: { status: "OK", value: ops }, settings: { status: "OK", value: SETTINGS } };
}
const q = (capability: string, mode: string, params: Record<string, string> = {}, src = sources(), aud = OWNER): QueryResponse => queryKnowledgeCore(REG, { capability, mode, params }, src, aud);
const W = (v: ReturnType<typeof buildVictorView>, id: number) => v.works.find((w) => w.id === U(id))!;

function main() {
  section("1. coverage — schema, settings, vocabularies, routes, fingerprints, no second rule");
  check("every Victor work column has a field contract", VM.VICTOR_FIELDS.map((f) => f.field).sort(), [...VM.VICTOR_SCHEMA_COLUMNS].sort());
  ok("every field fully described", VM.VICTOR_FIELDS.every((f) => [f.meaning, f.validation, f.writers, f.readers, f.victorSees, f.history, f.sunnyReads].every((x) => x.trim().length > 0)));
  const covered = new Set(VM.VICTOR_SETTINGS.map((s) => s.key));
  check("every production Victor settings key is classified", VM.VICTOR_SETTINGS_KEYS.filter((k) => !covered.has(k)), []);
  check("status = the code", [...VM.VICTOR_VOCABULARIES.status], [...VICTOR_STATUSES]);
  check("work state = the code", [...VM.VICTOR_VOCABULARIES.workState], [...VICTOR_WORK_STATES]);
  check("outcome = the code", [...VM.VICTOR_VOCABULARIES.outcome], [...VICTOR_OUTCOMES]);
  const walk = (d: string): string[] => fs.readdirSync(path.join(ROOT, d), { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(`${d}/${e.name}`) : e.name === "route.ts" ? [`${d}/${e.name}`] : []);
  const routes = walk("app/api").filter((f) => /^app\/api\/(vendor\/victor|dropbox\/vendor-)/.test(f) || /vendor-store|vendor_project_work|victor-files|victor-.*-notify/.test(read(f)));
  const extra = routes.filter((f) => !VM.VICTOR_ROUTE_GROUPS.some((g) => new RegExp(g.pattern).test(f)));
  ok(`every Victor route belongs to a family or is a known cross-domain reader (${extra.length} cross-domain: ${extra.join(", ")})`, extra.every((f) => /^app\/api\/(projects|agent|push|coo|reports|tasks|team|dashboard|label)/.test(f)));
  for (const [f, want] of Object.entries(VM.VICTOR_REVIEWED_FINGERPRINTS)) check(`${f} unchanged since the last Sunny Victor review (update lib/partner/system/victor.ts + fingerprint together)`, createHash("sha256").update(read(f).replace(/\r\n/g, "\n")).digest("hex"), want);
  ok("fingerprints cover every reviewed file", Object.keys(VM.VICTOR_REVIEWED_FINGERPRINTS).length === VM.VICTOR_REVIEWED_FILES.length);
  ok("every Victor action names existing routes; only the approved salary action is executable", VM.VICTOR_ACTIONS.every((a) => a.internal.routes.every((r) => fs.existsSync(path.join(ROOT, r)))) && VM.VICTOR_ACTIONS.filter((a) => a.sunnyToday !== "KNOWLEDGE_ONLY").map((a) => a.id).join() === "RECORD_SALARY_EXPENSE");
  const view = code(read("lib/partner/victor/view.ts"));
  ok("handoff reuses the app's own ball rule (no second rule)", /computeVictorBall\(/.test(view) && /COO_CONFIG/.test(view));
  ok("pure view: no DB / fetch / write / push", !/supabase|fetch\(|\.insert\(|\.update\(|\.upsert\(|\.delete\(|sendPush/.test(view + code(read("lib/partner/knowledge/capabilities/victor-deep.ts"))));
  ok("18 workflows classified", VM.VICTOR_WORKFLOWS.length === 18 && VM.VICTOR_WORKFLOWS.find((w) => w.event === "HANDOFF_TO_MIX")!.support === "NOT_SUPPORTED");

  section("SCENARIO A — 'מה קורה אצל ויקטור?'");
  const v = buildVictorView(sources());
  check("recorded counts", [v.counts.works, v.counts.open, v.counts.completed, v.counts.withoutProject], [5, 4, 1, 1]);
  ok("counts carry no score / capacity", /no capacity limit/.test(v.counts.note) && !/"(score|rank|capacity|overloaded)"/.test(JSON.stringify(v.counts)));
  ok("presence + money + signals + questions present", v.presence.state === "RECORDED" && v.money.months.length >= 4 && v.signals.length > 0);
  ok("capability overview served", q("victor_view", "overview").status === "OK");

  section("SCENARIO B — one work: project + Victor state + deadlines + activity");
  const b = W(v, W_NOTES);
  ok("project context (canonical) + client deadline separate from internal", b.project?.key === `project:${P(2)}` && /CANONICAL/.test(b.project.link) && !!b.internalDeadline && /INTERNAL/.test(b.internalDeadline.meaning) && !!b.clientDeadline);
  ok("latest Victor + Owner activity", b.handoff.lastUploadAt === "2026-09-10T10:00:00.000Z" && b.handoff.lastNotesSentAt === "2026-09-12T10:00:00.000Z");
  ok("deadline task linked", b.internalDeadline?.task?.title === "מעקב ויקטור — אבי 1");
  const bq = q("victor_view", "work", { work: U(W_NOTES), section: "handoff" });
  ok("work section served", bq.status === "OK" && bq.items.length === 1);

  section("SCENARIO C — internal deadline passed");
  const c = v.signals.find((s) => s.code === "INTERNAL_DEADLINE_PASSED" && s.work === `victor-work:${U(W_NOTES)}`);
  ok("internal expectation, investigate, no blame", !!c && /לא התחייבות ללקוח/.test(c.he) && /לא להאשים/.test(c.he));

  section("SCENARIO D — new version after Owner feedback");
  const d = W(buildVictorView(sources({ afterFeedbackUpload: true })), W_NOTES);
  check("ball follows the new upload → Owner", d.handoff.state, "WAITING_ON_OWNER");
  ok("latest version = V2", d.files.latestUpload === "2026-09-15T10:00:00Z" && d.files.versions.includes("V2"));

  section("SCENARIO E — Owner responded after the upload");
  check("notes after upload → waiting on Victor (not the Owner)", b.handoff.state, "WAITING_ON_VICTOR");

  section("SCENARIO F — no in-app response for days");
  const f = W(v, W_OLD_UPLOAD);
  ok("waiting on Owner by the app rule + asks about outside communication (no 'ignored')", f.handoff.state === "WAITING_ON_OWNER" && v.questions.some((x) => x.kind === "OUTSIDE_COMMUNICATION" && x.work === f.key) && !/ignored|התעלם/.test(JSON.stringify(v.signals)));

  section("SCENARIO G — label vs client work");
  const lab = W(v, W_CONFLICT), cli = W(v, W_NOTES);
  ok("label / client context shown, no priority score", lab.labelWork === true && cli.labelWork === false && !/"(priority|score)"/.test(JSON.stringify(v.works)));
  ok("portfolio filters label / client", q("victor_portfolio", "list", { filter: "label" }).status === "OK" && q("victor_portfolio", "list", { filter: "client" }).status === "OK");

  section("SCENARIO H — month marked paid without a finance row");
  const may = v.money.months.find((m) => m.month === "2026-05")!;
  ok("conflict surfaced; proof = Owner statement only", may.proof.startsWith("OWNER_STATEMENT_ONLY") && may.conflicts.some((x) => /no paid finance row/.test(x)) && may.conflicts.some((x) => /legacy key says צפוי/.test(x)));
  ok("an Owner question is raised", v.questions.some((x) => x.kind === "PAYMENT" && /2026-05/.test(x.questionHe)));

  section("SCENARIO I — $ and ₪ never mixed");
  check("paid in finance per currency", v.money.paidInFinanceByCurrency, { "₪": 1800, "$": 550 });

  section("SCENARIO J — storage unavailable");
  ok("stored entries only; never 'no files'", /NOT_AVAILABLE/.test(b.files.storageListing) && W(v, W_STANDALONE).files.entries === 0 && v.signals.some((s) => s.code === "NO_FILE_ENTRIES" && /האחסון עצמו לא נקרא/.test(s.he)));

  section("SCENARIO K — completed, no mix evidence");
  ok("COMPLETED_NO_MIX_EVIDENCE", v.signals.some((s) => s.code === "COMPLETED_NO_MIX_EVIDENCE" && s.work === `victor-work:${U(W_DONE)}`) && W(v, W_DONE).completionPush === "SENT (marker)");

  section("SCENARIO L — deadline passed, Owner has not answered the latest upload");
  ok("ball = Owner; deadline signal does not blame", f.handoff.state === "WAITING_ON_OWNER" && f.internalDeadline?.passed === true);

  section("SCENARIO M — portal presence today");
  ok("activity evidence only", v.presence.lastPortalVisit === "2026-09-24T08:00:00Z" && /not work done/.test(v.presence.meaning));

  section("SCENARIO N — 'מה ויקטור צריך לעשות עכשיו?'");
  const n = q("victor_portfolio", "list", { filter: "waiting_victor" });
  ok("evidence-backed candidates (waiting on Victor), no score", n.status === "OK" && n.items.some((i) => i.id === U(W_NOTES)) && !/"(score|rank)"/.test(JSON.stringify(n.items)));

  section("SCENARIO O — over-broad file access");
  ok("the portal findings are REMEDIATED with proof; the chunk-session residue stays open (never claimed closed)", ["SG_VICTOR_DROPBOX_PATHS", "SG_VICTOR_DELETES_OWNER_FILES", "SG_VICTOR_UPLOAD_RESPONSE_LEAK", "SG_VICTOR_SALARY_IN_PAYLOAD", "SG_VENDOR_FOLDER_PUBLIC_LINK", "SG_VICTOR_WORK_LOOKUP_BY_PROJECT", "SG_STORAGE_ROUTES_PROXY_ONLY"].every((id) => SECURITY_GAPS.find((g) => g.id === id)?.status === "REMEDIATED") && SECURITY_GAPS.find((g) => g.id === "SG_VICTOR_CHUNK_SESSION_UNSCOPED")?.status === "REPORTED_NOT_FIXED" && KNOWLEDGE_GAPS.some((g) => g.id === "VIC_PORTAL_FILE_SECURITY" && g.status === "PARTIALLY_CLOSED"));
  ok("Sunny knows the new file-scope rules + that older uploads have no recorded uploader", /folder-scoped paths/.test(JSON.stringify(q("system_awareness", "victor_model", { section: "files" }))) && KNOWLEDGE_GAPS.some((g) => g.id === "VIC_LEGACY_FILE_UPLOADER" && g.class === "DATA_NOT_RECORDED"));
  ok("file metadata carries the recorded uploader or NOT_RECORDED", W(v, W_NOTES).files.byVersion.every((bv) => bv.files.every((x) => x.uploadedBy === "NOT_RECORDED")));

  section("SCENARIO P — August 2026");
  const aug = v.money.months.find((m) => m.month === "2026-08")!;
  ok("canonical finance paid $550, separate from the override", aug.proof.startsWith("PAID_IN_FINANCE") && aug.canonicalFinance[0].amount === 550 && aug.canonicalFinance[0].currency === "$" && aug.statusOverride === "שולם" && aug.conflicts.length === 0);

  section("2. conflict / unknown handoff + capabilities + system awareness");
  check("send log 'got notes' vs the notes-later rule → CONFLICTING_EVIDENCE", lab.handoff.state, "CONFLICTING_EVIDENCE");
  ok("conflict shows both + a question", v.signals.some((s) => s.code === "HANDOFF_CONFLICT") && v.questions.some((x) => x.kind === "HANDOFF"));
  check("standalone work → UNKNOWN, no project", [W(v, W_STANDALONE).handoff.state, W(v, W_STANDALONE).project], ["UNKNOWN", null]);
  ok("draft notes not sent surfaced", v.signals.some((s) => s.code === "DRAFT_NOTES_NOT_SENT"));
  ok("goal is KPI-only; 12 never a pay rule", /no code ties it to pay/.test(v.money.goalNote) && v.money.settings?.monthlyGoal === 12);
  for (const s of ["summary", "project", "handoff", "deadlines", "files", "feedback", "brief", "downstream"]) ok(`victor_view work ${s}`, q("victor_view", "work", { work: U(W_CONFLICT), section: s }).status === "OK");
  ok("victor_view money served", q("victor_view", "money").status === "OK");
  ok("Owner-only", q("victor_view", "overview", {}, sources(), STRANGER).status !== "OK" && q("victor_portfolio", "list", {}, sources(), STRANGER).status !== "OK");
  for (const t of ["fields", "settings", "identity", "statuses", "handoff", "files", "feedback", "money", "portal", "pushes", "actions", "workflows", "signals", "integrity"]) ok(`system_awareness victor_model ${t}`, (q("system_awareness", "victor_model", { section: t }) as { items: unknown[] }).items.length > 0);
  const served = JSON.stringify([q("victor_view", "overview"), q("victor_view", "money"), q("victor_view", "work", { work: U(W_NOTES), section: "files" }), q("victor_portfolio", "list", { filter: "all" }), ...["fields", "files", "money", "actions", "portal"].map((t) => q("system_awareness", "victor_model", { section: t }))]);
  check("no forbidden implementation / secret terms served", FORBIDDEN_SERVED_TERMS.filter((t) => served.toLowerCase().includes(t.toLowerCase())), []);
  ok("no share links / tokens served", !/dropbox\.com\/s|token=|access_token|dropboxShareUrl/.test(served));
  ok("VICTOR = DEEP_BRAIN_V1; Steven / Mix / Red Films NOT marked complete", DOMAIN_KNOWLEDGE_DEPTH.VICTOR === "DEEP_BRAIN_V1" && ["STEVEN", "MIX_PIPELINE", "RED_FILMS"].every((d) => DOMAIN_KNOWLEDGE_DEPTH[d] === "PENDING_DEEP_MISSION") && CAPABILITY_CHANGES.some((x) => x.version === "2026.09.25-10" && x.domain === "VICTOR"));
  check("system registry valid", validateSystemRegistry({ capabilityIds: REG.all().map((x) => x.id), knowledgeKinds: KNOWLEDGE_KINDS.map((k) => k.kind) }), []);
  check("gaps valid", validateKnowledgeGaps({ domainIds: DOMAIN_CONTRACTS.map((x) => x.id), capabilityIds: REG.all().map((x) => x.id) }), []);
  const vg = KNOWLEDGE_GAPS.filter((x) => x.id.startsWith("VIC_"));
  ok("Victor gaps cover the required classes", ["CAPABILITY_GAP", "DATA_MODEL_GAP", "CONFLICTING_SOURCES", "OWNER_DECISION_REQUIRED", "SYSTEM_BEHAVIOR_GAP", "DATA_NOT_RECORDED", "FUTURE_PRIMITIVE_REQUIRED"].every((k) => vg.some((x) => x.class === k)));

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}
main();
