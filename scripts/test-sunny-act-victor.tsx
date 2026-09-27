/**
 * Universal Action Layer — Victor family: every primitive through the REAL service on fakes (6 standard checks each)
 * + family rules (one Victor work per project; sends need a Victor-facing title / saved notes and are never claimed
 * when not sent; salary row duplicate-guarded; overrides are statements; settings through the app's validator), the
 * shared writers + hardening in the routes, and the Victor portal security test still green.
 * Run with:   npx tsx scripts/test-sunny-act-victor.tsx      Pure; never touches production.
 */
import fs from "node:fs";
import path from "node:path";
import { runCases, mkDeps, fullFlow, U, OWNER, type FamilyCase } from "./fixtures/act-harness";
import { planAction } from "../lib/partner/act/service";
import { VICTOR_PRIMITIVES, VICTOR_STATUS_VALUES, type VictorWorkView } from "../lib/partner/act/primitives/victor";
import { ACTION_REGISTRY } from "../lib/partner/act/registry";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: unknown) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 500)}` : ""}`); } };
const read = (p: string) => fs.readFileSync(path.resolve(__dirname, "..", p), "utf8");

type Settings = { monthlyGoal: number; monthlySalary: number; salaryCurrency: string; salaryPayDay: number; stuckAfterDays: number };
interface W { vfolders: Set<string>; vfiles: Record<string, Array<{ ref: string; name: string; uploadedBy: string | null }>>; works: Record<string, VictorWorkView>; reviews: Record<string, Record<string, { notes: string; draft: boolean; sent: boolean }>>; settings: Settings; rows: Record<string, { id: string; status: string; amount: number; currency: string }>; overrides: Record<string, { amount?: number; status?: string }>; marks: Record<string, string>; pushes: string[]; projects: Record<string, string>; byProject: Record<string, string> }
const vv = (o: Partial<VictorWorkView>): VictorWorkView => ({ title: "ביט לשליו", projectId: U(40), projectName: "קרוב אלייך", status: "פעיל", workState: "נשלח לויקטור", sentDate: "2026-09-01", internalDeadline: null, briefText: "", hasTask: false, reviewKeys: "v1", vendorName: "victor", ...o });
const world = (): W => ({
  vfolders: new Set<string>(),
  vfiles: { [U(1)]: [{ ref: "ref_aaaa1111", name: "Beat V1.wav", uploadedBy: "victor" }, { ref: "ref_bbbb2222", name: "Brief.pdf", uploadedBy: "owner" }] },
  works: { [U(1)]: vv({}), [U(2)]: vv({ title: "", projectId: null, projectName: "" }) },
  reviews: { [U(1)]: { v1: { notes: "להאט את הטמפו", draft: true, sent: false } } },
  settings: { monthlyGoal: 12, monthlySalary: 550, salaryCurrency: "$", salaryPayDay: 10, stuckAfterDays: 5 },
  rows: { "2026-06": { id: "tx-6", status: "לא שולם", amount: 550, currency: "$" } }, overrides: {}, marks: {}, pushes: [],
  projects: { [U(40)]: "קרוב אלייך", [U(41)]: "סינגל" }, byProject: { [U(40)]: U(1) },
});
function mk() {
  const w = world(); const calls: string[] = []; let n = 500;
  const writers = {
    async victorFolderState(id: string) { return w.works[id] ? { hasFolder: w.vfolders.has(id) } : null; },
    async setUpVictorFolder(id: string) { calls.push("setUpVictorFolder"); w.vfolders.add(id); },
    async victorWorkFiles(id: string) { return w.vfiles[id] ? w.vfiles[id].map((f) => ({ ...f })) : (w.works[id] ? [] : null); },
    async deleteVictorWorkFile(id: string, ref: string) { calls.push("deleteVictorWorkFile"); w.vfiles[id] = w.vfiles[id].filter((f) => f.ref !== ref); return "ok"; },
    async readProjectMeta(id: string) { return w.projects[id] ? { name: w.projects[id], artist: "", status: "בעבודה", isHidden: false, businessType: "לקוח", projectType: "שיר", hasRelease: false } : null; },
    async readVictorWorkFull(id: string) { return w.works[id] ? { ...w.works[id] } : null; },
    async victorWorkForProject(pid: string) { return w.byProject[pid] ?? null; },
    async createVictorWorkRecord(pid: string | null, f: { title: string | null; workState: string | null; sentDate: string }) { calls.push("createVictorWorkRecord"); const id = U(++n); w.works[id] = vv({ projectId: pid, title: f.title ?? "", workState: f.workState, sentDate: f.sentDate }); if (pid) w.byProject[pid] = id; return id; },
    async ownerPatchVictorWork(id: string, b: Record<string, unknown>) { calls.push("ownerPatchVictorWork"); const x = w.works[id] as unknown as Record<string, unknown>; for (const [k, v] of Object.entries(b)) x[k] = v; if ("internalDeadline" in b) w.works[id].hasTask = true; if (b.status === "הושלם") w.pushes.push(`completed:${id}`); },
    async removeVictorWork(id: string) { calls.push("removeVictorWork"); delete w.works[id]; return { removedTask: true }; },
    async notifyVictorWork(id: string) { calls.push("notifyVictorWork"); w.pushes.push(`work:${id}`); return { ok: true }; },
    async readVictorReview(id: string, vk: string) { return w.reviews[id]?.[vk] ? { ...w.reviews[id][vk] } : null; },
    async saveVictorReviewDraft(id: string, vk: string, notes: string) { calls.push("saveVictorReviewDraft"); (w.reviews[id] ??= {})[vk] = { notes, draft: true, sent: false }; return "ok" as const; },
    async sendVictorVersionNotes(id: string, vk: string) { calls.push("sendVictorVersionNotes"); w.reviews[id][vk].sent = true; w.pushes.push(`notes:${id}:${vk}`); return { ok: true }; },
    async readVictorSettings() { return { ...w.settings }; },
    async updateVictorSettings(p: Partial<Settings>) { calls.push("updateVictorSettings"); w.settings = { ...w.settings, ...p }; },
    async readVictorSalaryMonth(m: string) { return { row: w.rows[m] ?? null, amountOverride: w.overrides[m]?.amount ?? null, statusOverride: w.overrides[m]?.status ?? null, legacyMark: w.marks[m] ?? null }; },
    async recordVictorSalaryMonth(p: { workMonth: string; amount: number; currency: string; historicPaid: boolean }) { calls.push("recordVictorSalaryMonth"); w.rows[p.workMonth] = { id: `tx-${p.workMonth}`, status: p.historicPaid ? "שולם" : "לא שולם", amount: p.amount, currency: p.currency }; return "ok" as const; },
    async setVictorSalaryOverride(m: string, p: { amount?: number; status?: string }) { calls.push("setVictorSalaryOverride"); w.overrides[m] = { ...w.overrides[m], ...p }; },
    async setVictorLegacyPaymentMark(m: string, s: string) { calls.push("setVictorLegacyPaymentMark"); w.marks[m] = s; },
  };
  return { w, calls, writers };
}
const V1 = `victor-work:${U(1)}`, V2 = `victor-work:${U(2)}`;
const CASES: FamilyCase<W>[] = [
  { id: "SET_UP_VICTOR_FOLDER", args: { victorWork: V1 }, confirm: "כן בוס, קישור ציבורי", bad: { victorWork: "victor-work:1" }, missing: { victorWork: `victor-work:${U(9)}` }, wrongKind: { victorWork: `project:${U(1)}` }, stale: (w) => { w.vfolders.add(U(1)); }, check: (w) => w.vfolders.has(U(1)) },
  { id: "DELETE_VICTOR_FILE", args: { victorWork: V1, fileRef: "ref_aaaa1111" }, confirm: "כן בוס, מחיקה", bad: { victorWork: V1, fileRef: "/Projects/x.wav" }, missing: { victorWork: V1, fileRef: "ref_zzzz9999" }, wrongKind: { victorWork: `project:${U(1)}`, fileRef: "ref_aaaa1111" }, stale: (w) => { w.vfiles[U(1)][0].name = "Beat V1b.wav"; }, check: (w) => w.vfiles[U(1)].length === 1 && w.vfiles[U(1)][0].ref === "ref_bbbb2222" },
  { id: "CREATE_VICTOR_WORK", args: { project: `project:${U(41)}`, title: "ביט חדש" }, bad: { project: `project:${U(41)}`, sentDate: "אתמול" }, missing: { project: `project:${U(99)}` }, wrongKind: { project: V1 }, stale: (w) => { w.byProject[U(41)] = U(2); }, check: (w, c) => Object.values(w.works).some((x) => x.projectId === U(41) && x.workState === "נשלח לויקטור") && c.join() === "createVictorWorkRecord" },
  { id: "UPDATE_VICTOR_WORK_DETAILS", args: { victorWork: V1, briefText: "BPM 90, מינורי" }, bad: { victorWork: V1, sentDate: "x" }, missing: { victorWork: `victor-work:${U(9)}`, title: "x" }, wrongKind: { victorWork: `project:${U(40)}`, title: "x" }, stale: (w) => { w.works[U(1)].briefText = "משהו"; }, check: (w) => w.works[U(1)].briefText === "BPM 90, מינורי" },
  { id: "SET_VICTOR_WORK_STATUS", args: { victorWork: V1, status: "הושלם" }, confirm: "כן בוס, הושלם", bad: { victorWork: V1, status: "נסגר" }, missing: { victorWork: `victor-work:${U(9)}`, status: "הושלם" }, stale: (w) => { w.works[U(1)].status = "בוטל"; }, check: (w) => w.works[U(1)].status === "הושלם" && w.pushes.includes(`completed:${U(1)}`) },
  { id: "SET_VICTOR_DEADLINE", args: { victorWork: V1, internalDeadline: "2026-10-10" }, confirm: "כן בוס, 2026-10-10", bad: { victorWork: V1, internalDeadline: "10/10" }, missing: { victorWork: `victor-work:${U(9)}`, internalDeadline: "2026-10-10" }, stale: (w) => { w.works[U(1)].internalDeadline = "2026-10-01"; }, check: (w) => w.works[U(1)].internalDeadline === "2026-10-10" && w.works[U(1)].hasTask },
  { id: "NOTIFY_VICTOR_WORK", args: { victorWork: V1 }, confirm: "כן בוס, ויקטור", bad: { victorWork: "x" }, missing: { victorWork: `victor-work:${U(9)}` }, stale: (w) => { w.works[U(1)].title = "שם אחר"; }, check: (w) => w.pushes.join() === `work:${U(1)}` },
  { id: "UPDATE_VICTOR_VERSION_REVIEW", args: { victorWork: V1, versionKey: "v1", notes: "להאט את הטמפו ולהוריד בס" }, bad: { victorWork: V1, versionKey: "v1", notes: "" }, missing: { victorWork: `victor-work:${U(9)}`, versionKey: "v1", notes: "x" }, stale: (w) => { w.reviews[U(1)].v1.notes = "אחר"; }, check: (w) => w.reviews[U(1)].v1.notes === "להאט את הטמפו ולהוריד בס" && w.reviews[U(1)].v1.draft },
  { id: "SEND_VICTOR_VERSION_NOTES", args: { victorWork: V1, versionKey: "v1" }, confirm: "כן בוס, ויקטור v1", bad: { victorWork: V1 }, missing: { victorWork: `victor-work:${U(9)}`, versionKey: "v1" }, stale: (w) => { w.works[U(1)].title = "x2"; }, check: (w) => w.reviews[U(1)].v1.sent && w.pushes.join() === `notes:${U(1)}:v1` },
  { id: "REMOVE_VICTOR_WORK", args: { victorWork: V2 }, confirm: "כן בוס, מחיקה", bad: { victorWork: "victor-work:1" }, missing: { victorWork: `victor-work:${U(9)}` }, stale: (w) => { w.works[U(2)].status = "הושלם"; }, check: (w) => !w.works[U(2)] },
  { id: "UPDATE_VICTOR_SETTINGS", args: { monthlySalary: 600, salaryCurrency: "$" }, confirm: "כן בוס, 600 $", bad: { salaryPayDay: 31 }, stale: (w) => { w.settings.monthlySalary = 570; }, check: (w) => w.settings.monthlySalary === 600 && w.settings.monthlyGoal === 12 },
  { id: "RECORD_VICTOR_SALARY_MONTH", args: { workMonth: "2026-08", amount: 550, currency: "$" }, confirm: "כן בוס, 2026-08 $550 לא שולם", bad: { workMonth: "2026-8", amount: 550, currency: "$" }, stale: (w) => { w.overrides["2026-08"] = { amount: 500 }; }, check: (w) => w.rows["2026-08"]?.status === "לא שולם" && w.rows["2026-08"].amount === 550 },
  { id: "SET_VICTOR_SALARY_OVERRIDE", args: { workMonth: "2026-06", amount: 500 }, confirm: "כן בוס, 2026-06 500", bad: { workMonth: "2026-06", status: "ששולם" }, stale: (w) => { w.rows["2026-06"].status = "שולם"; }, check: (w) => w.overrides["2026-06"]?.amount === 500 && w.rows["2026-06"].status === "לא שולם" },
  { id: "SET_VICTOR_MONTH_PAYMENT_MARK", args: { workMonth: "2026-06", status: "שולם", paidDate: "2026-07-10" }, confirm: "כן בוס, 2026-06 שולם", bad: { workMonth: "2026-06", status: "x" }, stale: (w) => { w.marks["2026-06"] = "צפוי"; }, check: (w) => w.marks["2026-06"] === "שולם" && w.rows["2026-06"].status === "לא שולם" },
];

(async () => {
  console.log("Victor family — standard checks");
  ok("the case table covers every Victor primitive", CASES.map((c) => c.id).sort().join() === VICTOR_PRIMITIVES.map((p) => p.actionId).sort().join());
  await runCases(CASES, mk, ok);

  console.log("\nVictor rules");
  const q = (id: string, args: Record<string, unknown>, h = mk()) => planAction({ intentHe: "x", actionId: id, args }, OWNER, mkDeps(h.writers).d);
  ok("one Victor work per project", (await q("CREATE_VICTOR_WORK", { project: `project:${U(40)}` })).status === "DUPLICATE");
  ok("a send needs a Victor-facing title", (await q("NOTIFY_VICTOR_WORK", { victorWork: V2 })).status === "NO_TITLE");
  const nn = mk(); nn.w.reviews[U(1)].v1.notes = "";
  ok("notes are sent only when saved", (await q("SEND_VICTOR_VERSION_NOTES", { victorWork: V1, versionKey: "v1" }, nn)).status === "NO_NOTES");
  ok("a salary month with an active row is refused (mark it paid through its finance status)", (await q("RECORD_VICTOR_SALARY_MONTH", { workMonth: "2026-06", amount: 550, currency: "$" })).status === "DUPLICATE");
  ok("settings go through the app's own validator", (await q("UPDATE_VICTOR_SETTINGS", { monthlyGoal: 5000 })).status === "INVALID_SETTINGS");
  const ov = await q("SET_VICTOR_SALARY_OVERRIDE", { workMonth: "2026-06", status: "שולם" });
  ok("an override is disclosed as a statement that never changes the finance row", ov.status === "PREVIEW" && JSON.stringify(ov).includes("לא משנה אותה"));
  const s = mk(); const rs = await fullFlow(mkDeps(s.writers).d, "RECORD_VICTOR_SALARY_MONTH", { workMonth: "2026-09", amount: 550, currency: "$" }, "כן בוס");
  ok("a salary row needs the month + exact money + status in the approval", rs.a?.status === "CONFIRMATION_VALUES_MISSING" && s.calls.length === 0);
  ok("sends are EXTERNAL_COMMUNICATION with PUSH; removal is C3", ["NOTIFY_VICTOR_WORK", "SEND_VICTOR_VERSION_NOTES", "SET_VICTOR_WORK_STATUS"].every((id) => ACTION_REGISTRY.get(id)!.effects.includes("PUSH" as never)) && ACTION_REGISTRY.get("REMOVE_VICTOR_WORK")!.confirmation === "C3_STRONG_APPROVAL");
  ok("statuses = lib/types VICTOR_STATUSES", read("lib/types.ts").includes(`VICTOR_STATUSES: VictorStatus[] = [${VICTOR_STATUS_VALUES.map((x) => `"${x}"`).join(", ")}]`));

  console.log("\nShared writers + hardening + portal security");
  ok("Victor owner routes use the shared writer (patch / remove / sends / salary)", /ownerPatchVictorWork\(id, body\)/.test(read("app/api/vendor/victor/work/[id]/route.ts")) && /removeVictorWork\(id\)/.test(read("app/api/vendor/victor/work/[id]/route.ts")) && /notifyVictorWork\(workId\)/.test(read("app/api/vendor/victor/notify-work/route.ts")) && /sendVictorVersionNotes\(workId, versionKey\)/.test(read("app/api/vendor/victor/notify-version-notes/route.ts")) && /recordVictorSalaryMonth\(/.test(read("app/api/vendor/victor/salary/route.ts")));
  ok("the Victor-role checks stay in the route before the writer", (() => { const r = read("app/api/vendor/victor/work/[id]/route.ts"); return r.indexOf("victorMayPatch(body)") < r.indexOf("ownerPatchVictorWork(id, body)") && r.indexOf('existingWork.vendorName !== "victor"') < r.indexOf("ownerPatchVictorWork(id, body)"); })());
  const vs = read("lib/vendor-store.ts"), wv2 = read("lib/writes/victor.ts");
  ok("HARDENED: a failed Victor save / delete is surfaced (no silent failure)", (vs.match(/if \(error\) throw new Error\(error\.message\);/g) ?? []).length >= 2 && /a failed save is surfaced/.test(vs));
  ok("HARDENED: removing a work deletes its follow-up task first; the Dropbox folder is never touched", /deleteTaskRecord\(w\.linkedTaskId\)/.test(wv2) && !/dropbox/i.test(wv2.slice(wv2.indexOf("export async function removeVictorWork"), wv2.indexOf("export type SendResult"))));
  ok("HARDENED: a review draft writes ONE version, claimed by updated_at", /\.eq\("updated_at", row\.updated_at\)/.test(wv2));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
