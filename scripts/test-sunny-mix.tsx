/**
 * Sunny STEVEN + MIX PIPELINE DEEP BRAIN — coverage guards + reasoning scenarios A–X.
 *
 * Guards (permanent):
 *   - every column of the seven mix tables is classified;
 *   - every status / work type / version status / Steven display status / mix-setup engineer option equals the code;
 *   - every Steven / mix settings key literal in the code is classified;
 *   - every mix route belongs to a family, and every mutating route is an inventoried action (or portal infrastructure);
 *   - the reviewed files are unchanged since the last review (MIX_REVIEWED_FINGERPRINTS);
 *   - the view reuses the app's own final-files rule, closed-status rule, newer-version comparison and Finance
 *     validation, and the payment ratio it reports equals the code's.
 * The view is pure.
 *
 * Run with:   npx tsx scripts/test-sunny-mix.tsx      Pure; never touches production.
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { PARTNER_KNOWLEDGE_REGISTRY } from "../lib/partner/knowledge/catalog";
import { queryKnowledgeCore } from "../lib/partner/knowledge/query";
import type { KnowledgeAudience, QueryResponse } from "../lib/partner/knowledge/types";
import type { GatewayFinance, GatewaySources } from "../lib/partner/gateway/core";
import type { OperationsRaw } from "../lib/partner/operations/types";
import type { ProjectDetailRaw, DetailEngineerWork, DetailMixVersion, DetailMixComment } from "../lib/partner/projects/detail-types";
import type { SettingsState } from "../lib/partner/settings/types";
import type { FinanceRaw } from "../lib/partner/finance/types";
import { deriveFinanceView } from "../lib/partner/finance/view";
import { buildFinanceBrief } from "../lib/partner/finance/brief";
import { buildMixView, roundNumber, APP_PAYMENT_RATIO, STEVEN } from "../lib/partner/mix/view";
import * as MX from "../lib/partner/system/mix";
import { SECURITY_GAPS } from "../lib/partner/system/people";
import { DOMAIN_CONTRACTS, FORBIDDEN_SERVED_TERMS, CAPABILITY_CHANGES, validateSystemRegistry } from "../lib/partner/system";
import { DOMAIN_KNOWLEDGE_DEPTH, KNOWLEDGE_GAPS, validateKnowledgeGaps } from "../lib/partner/system/gaps";
import { KNOWLEDGE_KINDS } from "../lib/partner/owner-knowledge/kinds";
import { SOUND_ENGINEER_STATUSES, SOUND_ENGINEER_WORK_TYPES } from "../lib/types";
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
const walk = (d: string): string[] => fs.readdirSync(path.join(ROOT, d), { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(`${d}/${e.name}`) : e.name === "route.ts" ? [`${d}/${e.name}`] : []);

// ── fixture ──
const sec = <T,>(rows: T[]) => ({ rows, capped: false });
const EMPTY = Object.fromEntries(["projects", "financeNotes", "deliveries", "actions", "sessions", "meetings", "tasks", "engineerWork", "mixVersions", "mixComments", "commentAttachments", "mixTargets", "mixTargetNotes", "finalFiles", "victor", "productions", "budgetItems", "albumTracks", "clipItems", "proposals", "releases", "campaigns", "contentItems", "socialFiles", "projectSettings", "transactionsText", "budgetPayments", "agentAlerts", "notifications"].map((k) => [k, { rows: [], capped: false }])) as unknown as ProjectDetailRaw;
const T = (d: number, h = 10) => new Date(Date.UTC(2026, 8, d, h)).toISOString();
const work = (id: number, o: Partial<DetailEngineerWork>): DetailEngineerWork => ({ id: U(id), projectId: null, engineerName: STEVEN, notes: null, hasFilesLink: false, sortOrder: null, createdAt: T(1), updatedAt: T(1),
  workTitle: null, workType: "מיקס + מאסטר", status: "בתהליך", agreedPrice: 200, currency: "$", amountPaid: 0, sentDate: "2026-09-01", internalDeadline: null, linkedTransactionId: null, paymentDate: null, ...o });
let vn = 0, cn = 0;
const ver = (w: number, label: string, at: string, o: Partial<DetailMixVersion> = {}): DetailMixVersion => ({ id: U(5000 + ++vn), workId: U(w), projectId: null, label, fileName: `${label} Mix.wav`, status: "בבדיקה", uploadedBy: STEVEN, durationSeconds: null, uploadedAt: at, targetId: null, path: `/Projects/x/Mix Versions/${label}.wav`, size: 1, type: "wav", createdAt: at, updatedAt: at, ...o });
const com = (versionId: string, at: string, status = "open", text = "הערה"): DetailMixComment => ({ id: U(7000 + ++cn), versionId, timestampSeconds: 12, text, author: null, role: "mix", status, createdAt: at, updatedAt: at });
const W_V3 = 801, W_FB = 802, W_NOFB = 803, W_DONE = 804, W_DONE_FF = 805, W_PAIDCONF = 806, W_RECEIVED = 807, W_OLD = 808, W_BILL = 809, W_V10 = 810, W_DONE_OPEN = 811, W_NOTES = 812, W_CYCLE = 813;
function det(): ProjectDetailRaw {
  vn = 0; cn = 0;
  const v3a = ver(W_V3, "Mix 2", T(10)), v3b = ver(W_V3, "Mix 3", T(14));
  const fb = ver(W_FB, "Mix 1", T(10));
  const nofb = ver(W_NOFB, "Mix 1", T(12));
  const done = ver(W_DONE, "Mix 1", T(5));
  const doneff = ver(W_DONE_FF, "Mix 1", T(5));
  const old = ver(W_OLD, "Mix 1", T(2));
  const v9 = ver(W_V10, "Mix 9", T(10)), v10 = ver(W_V10, "Mix 10", T(12));
  const dopen = ver(W_DONE_OPEN, "Mix 1", T(5));
  const notes1 = ver(W_NOTES, "Mix 1", T(10));
  const cyc = ver(W_CYCLE, "Mix 1", T(15));
  const c1 = com(v3a.id, T(12)), c2 = com(fb.id, T(13)), c3 = com(done.id, T(6), "resolved"), c4 = com(old.id, T(3)), c5 = com(dopen.id, T(6)), c6 = com(v9.id, T(11), "resolved");
  return { ...EMPTY,
    engineerWork: sec([
      work(W_V3, { projectId: P(2), internalDeadline: "2026-09-30" }),
      work(W_FB, { projectId: P(4), internalDeadline: "2026-09-20" }),
      work(W_NOFB, { projectId: P(5), internalDeadline: "2026-09-22" }),
      work(W_DONE, { projectId: P(3), status: "אושר", amountPaid: 200, paymentDate: "2026-09-10", linkedTransactionId: "tx-paid" }),
      work(W_DONE_FF, { projectId: null, workTitle: "ביט עצמאי", status: "אושר", agreedPrice: 150 }),
      work(W_PAIDCONF, { projectId: null, workTitle: "תשלום סותר", status: "אושר", amountPaid: 200, paymentDate: "2026-09-11", linkedTransactionId: "tx-unpaid" }),
      work(W_RECEIVED, { projectId: null, workTitle: "התקבל על הוצאה", status: "אושר", amountPaid: 200, paymentDate: "2026-09-12", linkedTransactionId: "tx-received" }),
      work(W_OLD, { projectId: P(1), internalDeadline: "2026-06-01" }),
      work(W_BILL, { projectId: P(7), engineerName: "Bill", status: "נשלח", agreedPrice: 300 }),
      work(W_V10, { projectId: null, workTitle: "עשר גרסאות" }),
      work(W_DONE_OPEN, { projectId: null, workTitle: "הושלם עם הערות", status: "אושר", agreedPrice: 0 }),
      work(W_NOTES, { projectId: null, workTitle: "הערות נשלחו", status: "בתהליך" }),
      work(W_CYCLE, { projectId: null, workTitle: "מחזור פעיל", status: "חזר" }),
    ]),
    mixVersions: sec([v3a, v3b, fb, nofb, done, doneff, old, v9, v10, dopen, notes1, cyc]),
    mixComments: sec([c1, c2, c3, c4, c5, c6]),
    commentAttachments: sec([{ commentId: c1.id, fileName: "shot.png", size: 1, path: "/x/a.png", mimeType: "image/png", uploadedBy: "owner", createdAt: T(12) }, { commentId: c1.id, fileName: "ref.mp3", size: 1, path: "/x/r.mp3", mimeType: "audio/mpeg", uploadedBy: "owner", createdAt: T(12) }]),
    finalFiles: sec([{ workId: U(W_DONE_FF), projectId: null, fileName: "Final Master.wav", path: "/x/f.wav", fileType: "wav", fileSize: 1, uploadedBy: STEVEN, createdAt: T(8) }]),
    victor: sec([{ id: U(901), projectId: P(6), vendorName: "victor", title: "הפקה", status: "הושלם", workState: null, sentDate: null, internalDeadline: null, linkedTaskId: null, createdAt: null, updatedAt: null, notes: null, briefText: null, references: [], reviews: [], filesSent: [], filesReceived: [], briefFiles: [], returnedDate: null, outcome: null, quality: null, enteredProject: null, dropboxFolder: null, hasFolderLink: false }]),
    tasks: sec([{ id: U(961), relatedType: "project", relatedId: P(2), title: "מעקב מיקס — אבי 1", notes: null, status: "פתוח", dueDate: "2026-09-30", startTime: null, endTime: null, showId: null, hasGoogleTask: true, createdAt: null, updatedAt: null }]),
  };
}
const SETTINGS: SettingsState = { families: {
  STEVEN_MIX_REMINDER_STATE: sec([{ key: `steven_mix_reminder_send:${U(W_NOTES)}:${T(11)}:1`, updatedAt: null, value: {} }, { key: `steven_mix_reminder_cycle:${U(W_CYCLE)}`, updatedAt: null, value: { workId: U(W_CYCLE), cycleStartAt: T(13), remindersSent: 1, lastReminderAt: T(14) } }]),
  PORTAL_PRESENCE: sec([{ key: "steven_visit_last", updatedAt: null, value: { at: "2026-09-24T08:00:00Z" } }]),
  PUSH_SENT_ONCE_MARKERS: sec([{ key: `steven_mix_ready_pushed_${U(W_FB)}`, updatedAt: null, value: {} }]),
  STEVEN_DEADLINE_DIGEST_SENT: sec([{ key: "steven_deadline_digest:2026-09-24", updatedAt: null, value: {} }]),
} };
function sources(): GatewaySources {
  const st = input({ contexts: [], status: { [P(6)]: "מחכה למיקס" } }).state!;
  const raw: FinanceRaw = empty({ transactions: [
    tx({ id: "tx-paid", type: "expense", amount: 650, currency: "₪", status: "שולם", category: "מיקס / מאסטר", scope: "project", expenseScope: "כללי", date: "2026-09-10" }),
    tx({ id: "tx-unpaid", type: "expense", amount: 200, currency: "$", status: "לא שולם", category: "מיקס / מאסטר", date: null }),
    tx({ id: "tx-received", type: "expense", amount: 650, currency: "₪", status: "התקבל", category: "מיקס / מאסטר", date: "2026-09-12" }),
    tx({ id: "tx-orphan", type: "expense", amount: 50, currency: "$", status: "לא שולם", category: "מיקס / מאסטר", date: null }),
  ] });
  const view = deriveFinanceView(raw, NOW, []);
  const f: GatewayFinance = { state: view.state, integrity: view.integrity, actions: view.actions, raw, brief: buildFinanceBrief(view.state, view.integrity, { answersAvailable: true, actionNoteHe: view.actionNoteHe }), answersAvailable: true };
  return { now: NOW, state: { status: "OK", value: st }, finance: { status: "OK", value: f }, identities: { cleantone: null },
    cases: { status: "OK", value: [] }, actions: { status: "OK", value: [] }, outcomes: { status: "OK", value: [] }, ownerKnowledge: { status: "OK", value: [] },
    projectDetail: { status: "OK", value: det() }, operations: { status: "OK", value: { integrations: { googleCalendarConnected: true, dropboxConnected: true } } as unknown as OperationsRaw }, settings: { status: "OK", value: SETTINGS } };
}
const q = (capability: string, mode: string, params: Record<string, string> = {}, aud = OWNER): QueryResponse => queryKnowledgeCore(REG, { capability, mode, params }, sources(), aud);

function main() {
  section("1. coverage — schema, vocabularies, settings, routes, fingerprints, reuse");
  const served = new Set(MX.MIX_FIELDS.map((f) => `${MX.MIX_ENTITY_TABLE[f.entity]}.${MX.MIX_FIELD_ALIASES[`${f.entity}.${f.field}`] ?? f.field}`));
  const schema = Object.entries(MX.MIX_SCHEMA).flatMap(([t, cols]) => cols.map((c) => `${t}.${c}`));
  check("every column of the seven mix tables is classified (and nothing extra)", [schema.filter((k) => !served.has(k)), [...served].filter((k) => !schema.includes(k))], [[], []]);
  ok("every field fully described", MX.MIX_FIELDS.every((f) => [f.meaning, f.writers, f.readers, f.stevenSees, f.history, f.sunnyReads].every((x) => x.trim().length > 0)));
  check("work status = the code", [...MX.MIX_VOCABULARIES.workStatus], [...SOUND_ENGINEER_STATUSES]);
  check("work type = the code", [...MX.MIX_VOCABULARIES.workType], [...SOUND_ENGINEER_WORK_TYPES]);
  check("version status = the store's allowed set", [...MX.MIX_VOCABULARIES.versionStatus], JSON.parse(`[${/ALLOWED_STATUS = new Set\(\[([^\]]+)\]\)/.exec(read("lib/mix-versions-store.ts"))![1]}]`));
  const page = read("components/team/StevenProfilePage.tsx");
  check("Steven display statuses = the page", [...MX.MIX_VOCABULARIES.stevenUiStatus], JSON.parse(`[${/const STATUS_OPTIONS: WorkStatus\[\] = \[([^\]]+)\]/.exec(page)![1]}]`));
  check("Steven display work types = the page", [...MX.MIX_VOCABULARIES.stevenUiWorkType], JSON.parse(`[${/const WORK_TYPES: WorkType\[\]\s*=\s*\[([^\]]+)\]/.exec(page)![1]}]`));
  check("mix-setup engineer options = the modal", [...MX.MIX_VOCABULARIES.mixSetupEngineers], JSON.parse(`[${/const ENGINEER_OPTIONS = \[([^\]]+)\] as const/.exec(read("components/project/MixSetupModal.tsx"))![1]}]`));
  check("album track mix / master = the type", [...MX.MIX_VOCABULARIES.albumTrackMixMaster], JSON.parse(`[${/export type MixMasterStatus\s*=\s*([^;]+);/.exec(read("lib/types.ts"))![1].split("|").map((x) => x.trim()).join(",")}]`));
  const libFiles = fs.readdirSync(path.join(ROOT, "lib")).filter((f) => /\.ts$/.test(f)).map((f) => `lib/${f}`);
  const keyLits = new Set(libFiles.flatMap((f) => [...code(read(f)).matchAll(/[`"'](steven_[a-z_]+[:_]?|final_files_batch:)/g)].map((m) => m[1])));
  const prefixes = MX.MIX_SETTINGS.map((s) => s.key);
  const uncovered = [...keyLits].filter((k) => !prefixes.some((p) => k === p || k.startsWith(p) || p.startsWith(k)) && !/^steven_(final_files_requested|open_work|unpaid|send_failed|no_subscription|internal_deadline_passed)/.test(k));
  check(`every Steven / mix settings key literal is classified (${keyLits.size} literals)`, uncovered, []);
  check("settings prefixes = the classified keys", [...MX.MIX_SETTINGS_PREFIXES].sort(), [...prefixes].sort());
  const routes = [...walk("app/api/sound-engineer"), ...walk("app/api/supplier/steven")];
  ok(`every mix route belongs to a family (${routes.length})`, routes.every((r) => MX.MIX_ROUTE_GROUPS.some((g) => new RegExp(g.pattern).test(r))));
  const actionRoutes = new Set(MX.MIX_ACTIONS.flatMap((a) => a.internal.routes));
  const mutating = routes.filter((r) => /export async function (POST|PATCH|DELETE|PUT)\b/.test(read(r)));
  check("every mutating mix route is an inventoried action or portal infrastructure", mutating.filter((r) => !actionRoutes.has(r) && !(MX.MIX_INFRA_ROUTES as readonly string[]).includes(r)), []);
  ok("every action route exists; no action is executable by Sunny", MX.MIX_ACTIONS.every((a) => a.internal.routes.every((r) => fs.existsSync(path.join(ROOT, r))) && a.sunnyToday === "KNOWLEDGE_ONLY"));
  for (const [f, want] of Object.entries(MX.MIX_REVIEWED_FINGERPRINTS)) check(`${f} unchanged since the last Sunny Mix review (update lib/partner/system/mix.ts + fingerprint together)`, createHash("sha256").update(read(f).replace(/\r\n/g, "\n")).digest("hex"), want);
  check("fingerprints cover every reviewed file", Object.keys(MX.MIX_REVIEWED_FINGERPRINTS).sort(), [...MX.MIX_REVIEWED_FILES].sort());
  const view = code(read("lib/partner/mix/view.ts"));
  ok("view reuses the app's rules (final-files flags, closed status, newer-version comparison, Finance validation)", /computeFinalFilesFlags\(/.test(view) && /isClosedStatus\(/.test(view) && /hasNewerVersion\(/.test(view) && /validateTx\(/.test(view));
  ok("the reported payment ratio equals the code's", new RegExp(`agreed \\* ${APP_PAYMENT_RATIO.toString().replace(".", "\\.")} \\* 100`).test(read("lib/sound-engineer-store.ts")) && new RegExp(`export const STEVEN_ENGINEER = "${STEVEN}"`).test(read("lib/steven-scope.ts")));
  ok("pure view: no DB / fetch / write / push", !/supabase|fetch\(|\.insert\(|\.update\(|\.upsert\(|\.delete\(|sendPush/.test(view + code(read("lib/partner/knowledge/capabilities/mix-deep.ts"))));
  check("numeric round order (never lexical)", [roundNumber("Mix 10")! > roundNumber("Mix 9")!, roundNumber("Mix 2"), roundNumber("סקיצה")], [true, 2, null]);

  const v = buildMixView(sources());
  const W = (id: number) => v.works.find((w) => w.id === U(id))!;

  section("SCENARIO A — 'מה קורה אצל סטיבן?'");
  ok("counts + Steven summary + signals + questions", v.counts.works === 13 && v.counts.byEngineer.Steven === 12 && v.counts.byEngineer.Bill === 1 && v.steven.works === 12 && v.signals.length > 0 && v.questions.length > 0);
  ok("no score / capacity", /no capacity limit/.test(v.counts.note) && !/"(score|rank|capacity)"/.test(JSON.stringify(v.counts)));
  ok("capabilities served (overview / steven / money)", ["overview", "steven", "money"].every((m) => q("mix_view", m).status === "OK"));

  section("SCENARIO B — 'מה קורה עם המיקס של X?'");
  const b = W(W_V3);
  ok("project + engineer + latest version + comments + handoff + deadlines + final files + money + tasks", b.project?.key === `project:${P(2)}` && b.engineer === STEVEN && b.versions.latest?.label === "Mix 3" && b.comments.total === 1 && !!b.handoff.state && !!b.internalDeadline && !!b.clientDeadline && b.finalFiles.project === 0 && b.money.payStatus === "לא שולם" && b.tasks.length === 1);
  for (const s of ["summary", "project", "versions", "comments", "handoff", "deadlines", "final_files", "money", "timeline", "downstream"]) ok(`mix_view work ${s}`, q("mix_view", "work", { work: U(W_V3), section: s }).status === "OK");

  section("SCENARIO C — V3 uploaded after the Owner's comments on V2");
  check("waiting on the Owner (not 'Steven still owes the notes')", b.handoff.state, "WAITING_ON_OWNER");
  check("the open comment is on an OLDER round, not resolved by the new version", [b.comments.open, b.comments.openOnLatestRound, b.comments.openOnOlderRounds], [1, 0, 1]);

  section("SCENARIO D — Owner commented after the latest version");
  check("waiting on the engineer", W(W_FB).handoff.state, "WAITING_ON_ENGINEER");

  section("SCENARIO E — latest version, no Owner response evidence");
  check("waiting on the Owner (review not recorded)", [W(W_NOFB).handoff.state, /review is not recorded/.test(W(W_NOFB).handoff.basis)], ["WAITING_ON_OWNER", true]);

  section("SCENARIO F — all comments resolved, no approval record");
  const f = W(W_DONE);
  ok("completed, never 'approved'", f.completion.completed && /NOT_RECORDED/.test(f.completion.approvalRecord) && f.comments.open === 0 && !/approved/i.test(JSON.stringify(v.signals.filter((s) => s.work === f.key))));

  section("SCENARIO G — completed without final files");
  ok("completion reported apart from final-file evidence", v.signals.some((s) => s.code === "COMPLETED_NO_FINAL_FILES" && s.work === f.key) && f.completion.finalFilesEvidence === false);

  section("SCENARIO H — final files exist, engineer unpaid");
  const h = W(W_DONE_FF);
  ok("final files, completion and payment separate", h.finalFiles.own === 1 && h.completion.completed && !h.money.paid && v.signals.some((s) => s.code === "COMPLETED_UNPAID" && s.work === h.key) && !v.signals.some((s) => s.code === "COMPLETED_NO_FINAL_FILES" && s.work === h.key));

  section("SCENARIO I — paid on the work, Finance says otherwise");
  ok("CONFLICTING_SOURCES shown", W(W_PAIDCONF).money.conflicts.some((c) => /expense is לא שולם/.test(c)) && v.signals.some((s) => s.code === "PAYMENT_FINANCE_CONFLICT" && s.work === W(W_PAIDCONF).key));

  section("SCENARIO J — expense status התקבל");
  const j = W(W_RECEIVED);
  ok("invalid supplier-expense semantics; not counted as paid", j.money.conflicts.some((c) => /התקבל is income-only/.test(c)) && j.money.expense?.validPaid === false);

  section("SCENARIO K — deadline passed, latest upload waiting on the Owner");
  const k = W(W_NOFB);
  ok("no blame on Steven", k.internalDeadline?.passed === true && v.signals.some((s) => s.code === "INTERNAL_DEADLINE_PASSED" && s.work === k.key && /מחכה לך/.test(s.he) && /לא להאשים/.test(s.he)));

  section("SCENARIO L — deadline passed months ago");
  ok("historical recorded state, not an emergency", /HISTORICAL/.test(W(W_OLD).internalDeadline?.debt ?? ""));

  section("SCENARIO M — Victor completed, no engineer work");
  ok("handoff missing reported, not invented", v.victorDoneNoMix.some((x) => x.key === `project:${P(6)}`) && v.signals.some((s) => s.code === "PRODUCTION_DONE_NO_MIX"));

  section("SCENARIO N — engineer work without a production handoff record");
  ok("work shown, handoff history missing", W(W_V3).handoff.sentEvidence.sendLog.length === 0 && KNOWLEDGE_GAPS.some((g) => g.id === "MIX_NO_PRODUCTION_HANDOFF"));

  section("SCENARIO O — release target + open comments");
  const o = W(W_OLD);
  ok("factual dependency, no readiness verdict", !!o.release && /context only/.test(o.release.note) && o.comments.open === 1 && !/(ready|cannot go out|blocked)/i.test(JSON.stringify(o.release)));

  section("SCENARIO P — Steven portal presence today");
  ok("portal activity only", v.steven.presence.lastVisit === "2026-09-24T08:00:00Z" && /not work done/.test(v.steven.presence.meaning));

  section("SCENARIO Q — another engineer");
  const qb = W(W_BILL);
  ok("no Steven assumptions (no display status, no notes / markers)", qb.isSteven === false && qb.stevenUiStatus === null && /TEXT_MATCH/.test(qb.engineerIdentity) && qb.handoff.sentEvidence.mixReadyPush.startsWith("n/a") && qb.handoff.notesSent.recorded.length === 0);

  section("SCENARIO R — storage not listed");
  ok("unknown / capability gap, never 'no file'", v.unavailable.some((u) => /storage itself is not listed/.test(u)) && KNOWLEDGE_GAPS.some((g) => g.id === "MIX_STORAGE_NOT_LISTED" && g.class === "CAPABILITY_GAP"));

  section("SCENARIO S — V10 after V9");
  check("latest = Mix 10", W(W_V10).versions.latest?.label, "Mix 10");

  section("SCENARIO T — 'מה סטיבן צריך לעשות עכשיו?'");
  const t = q("mix_portfolio", "list", { filter: "waiting_engineer" });
  ok("evidence-backed candidates, no score", t.status === "OK" && t.items.some((i) => i.id === U(W_FB)) && t.items.some((i) => i.id === U(W_NOTES)) && !/"(score|rank)"/.test(JSON.stringify(t.items)));

  section("SCENARIO U — 'מה אני צריך לעשות מול סטיבן?'");
  const u = q("mix_portfolio", "list", { filter: "waiting_owner" });
  ok("Owner-side pending reviews from evidence", u.status === "OK" && u.items.some((i) => i.id === U(W_V3)) && u.items.some((i) => i.id === U(W_NOFB)));
  ok("payment + finance questions for the Owner", v.questions.some((x) => x.kind === "PAYMENT") && v.questions.some((x) => x.kind === "FINANCE"));

  section("SCENARIO V — image / audio attachment");
  const r2 = W(W_V3).rounds.find((r) => r.label === "Mix 2")!;
  check("attachments counted on the comment's round, never as versions", [r2.attachments.images, r2.attachments.audio, W(W_V3).versions.files], [1, 1, 2]);

  section("SCENARIO W — completed with unresolved comments");
  ok("contradiction reported", v.signals.some((s) => s.code === "COMPLETED_OPEN_COMMENTS" && s.work === W(W_DONE_OPEN).key));

  section("SCENARIO X — the Steven payment push reaches other engineers");
  ok("registered SYSTEM_BEHAVIOR_GAP + security gap, report only", MX.STEVEN_VS_GENERIC.some((x) => x.scope === "STEVEN_ASSUMPTION_APPLIED_TO_ALL" && /Payment sent/.test(x.behavior)) && SECURITY_GAPS.some((g) => g.id === "SG_STEVEN_PAYMENT_WRONG_RECIPIENT" && g.status === "REPORTED_NOT_FIXED") && KNOWLEDGE_GAPS.some((g) => g.id === "MIX_STEVEN_ASSUMPTIONS_GENERIC" && g.class === "SYSTEM_BEHAVIOR_GAP"));

  section("2. notes-sent evidence, conflicts, money, mix stage, capabilities, awareness");
  check("a recorded 'Send notes' after the latest version → waiting on the engineer", W(W_NOTES).handoff.state, "WAITING_ON_ENGINEER");
  check("status חזר / active reminder cycle vs a newer version → conflict", W(W_CYCLE).handoff.state, "CONFLICTING_EVIDENCE");
  const paid = W(W_DONE).money;
  ok("paid work: ₪ expense at the app's fixed ratio, scope כללי flagged, $ and ₪ never added", paid.paid && paid.expense?.currency === "₪" && paid.conflicts.length === 0 && paid.expenseScopeGeneral && JSON.stringify(v.money.paidByCurrency) === JSON.stringify({ $: 200 + 200 + 200 }));
  ok("orphan mix expense listed, never linked", v.money.orphanExpenses.some((x) => x.id === "tx-orphan") && v.signals.some((s) => s.code === "ORPHAN_MIX_EXPENSE"));
  ok("mix-stage project without an engineer", v.mixStageNoEngineer.some((x) => x.key === `project:${P(6)}`) && q("mix_portfolio", "list", { filter: "open" }).items.some((i) => i.id === `noengineer:project:${P(6)}`));
  for (const fl of ["all", "steven", "other_engineer", "unknown", "conflicting", "deadline_passed", "open_comments", "completed", "completed_open_comments", "completed_no_final_files", "unpaid", "release", "label", "client"]) ok(`mix_portfolio filter ${fl}`, q("mix_portfolio", "list", { filter: fl }).status === "OK");
  ok("Owner-only", q("mix_view", "overview", {}, STRANGER).status !== "OK" && q("mix_portfolio", "list", {}, STRANGER).status !== "OK");
  for (const s of ["fields", "settings", "vocabularies", "identity", "steven_vs_generic", "work", "statuses", "handoff", "versions", "feedback", "files", "money", "portal", "pushes", "consumers", "actions", "workflows", "signals", "security", "integrity"]) ok(`system_awareness mix_model ${s}`, (q("system_awareness", "mix_model", { section: s }) as { items: unknown[] }).items.length > 0);
  const servedText = JSON.stringify([q("mix_view", "overview"), q("mix_view", "steven"), q("mix_view", "money"), q("mix_view", "work", { work: U(W_V3), section: "versions" }), q("mix_portfolio", "list", { filter: "all" }), ...["fields", "settings", "money", "actions", "security", "portal"].map((s) => q("system_awareness", "mix_model", { section: s }))]);
  check("no forbidden implementation / secret terms served", FORBIDDEN_SERVED_TERMS.filter((x) => servedText.toLowerCase().includes(x.toLowerCase())), []);
  ok("no storage paths / share links served", !/Mix Versions\/|dropbox\.com|\/x\/a\.png/.test(servedText));
  ok("STEVEN + MIX_PIPELINE = DEEP_BRAIN_V1", DOMAIN_KNOWLEDGE_DEPTH.STEVEN === "DEEP_BRAIN_V1" && DOMAIN_KNOWLEDGE_DEPTH.MIX_PIPELINE === "DEEP_BRAIN_V1" && ["STEVEN", "MIX_PIPELINE"].every((d) => CAPABILITY_CHANGES.some((x) => x.version === "2026.09.25-12" && x.domain === d)));
  check("system registry valid", validateSystemRegistry({ capabilityIds: REG.all().map((x) => x.id), knowledgeKinds: KNOWLEDGE_KINDS.map((x) => x.kind) }), []);
  check("gaps valid", validateKnowledgeGaps({ domainIds: DOMAIN_CONTRACTS.map((x) => x.id), capabilityIds: REG.all().map((x) => x.id) }), []);
  const mg = KNOWLEDGE_GAPS.filter((g) => g.id.startsWith("MIX_"));
  ok("mix gaps cover the required classes", ["DATA_NOT_RECORDED", "DATA_MODEL_GAP", "CAPABILITY_GAP", "AMBIGUOUS_IDENTITY", "CONFLICTING_SOURCES", "LEGACY_CONFLICT", "SYSTEM_BEHAVIOR_GAP", "OWNER_DECISION_REQUIRED"].every((c) => mg.some((g) => g.class === c)));
  ok("no invented policy in the contract (no turnaround / revisions / readiness / fee rule stated as policy)", !/(turnaround|allowed revisions|release[- ]ready|mix[- ]ready|fee policy is)/i.test(JSON.stringify([MX.MONEY_MODEL, MX.HANDOFF_MODEL, MX.STATUS_MACHINE])) && /not Owner policy/.test(MX.MONEY_MODEL.rate));

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}
main();
