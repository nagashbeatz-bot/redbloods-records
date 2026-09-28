/**
 * Universal Action Layer — Mix / mastering family: every primitive through the REAL service on fakes (6 standard checks
 * each) + family rules (only exactly "Steven" is Steven; his page's finance semantics; the project-type rule; paid only
 * with a price + date; pushes only for Steven and never claimed when not sent; instrumental line protected), pinned
 * vocabularies, shared writers + the hardened delete in the routes.
 * Run with:   npx tsx scripts/test-sunny-act-mix.tsx      Pure; never touches production.
 */
import fs from "node:fs";
import path from "node:path";
import { runCases, mkDeps, fullFlow, U, OWNER, type FamilyCase } from "./fixtures/act-harness";
import { planAction } from "../lib/partner/act/service";
import { ENGINEER_STATUSES, ENGINEER_WORK_TYPES, MIX_PRIMITIVES, STEVEN_PROJECT_TYPES, type EngineerWorkView } from "../lib/partner/act/primitives/mix";
import { ACTION_REGISTRY } from "../lib/partner/act/registry";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: unknown) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 500)}` : ""}`); } };
const read = (p: string) => fs.readFileSync(path.resolve(__dirname, "..", p), "utf8");

type Cm = { versionId: string; workId: string; text: string; timestampSeconds: number | null; status: string; attachments: number };
type Tg = { workId: string; name: string; kind: string; removed: boolean };
type Nt = { targetId: string; text: string; status: string };
interface W { atts: Record<string, { commentId: string; fileName: string }>; works: Record<string, EngineerWorkView>; order: string[]; versions: Record<string, { workId: string; label: string; status: string }>; comments: Record<string, Cm>; targets: Record<string, Tg>; notes: Record<string, Nt>; projects: Record<string, string>; pushes: string[]; skipped: boolean[]; synced: string[]; sentOnce: boolean }
const wv = (o: Partial<EngineerWorkView>): EngineerWorkView => ({ projectId: U(40), projectType: "שיר", title: "קרוב אלייך", engineerName: "Steven", workType: "מיקס", status: "נשלח", agreedPrice: 200, currency: "$", amountPaid: 0, paymentDate: null, sentDate: "2026-09-01", internalDeadline: null, notes: "", expenseStatus: null, ...o });
const world = (): W => ({
  atts: { [U(70)]: { commentId: U(30), fileName: "vocal-ref.m4a" } },
  works: { [U(1)]: wv({}), [U(2)]: wv({ engineerName: "Bill", title: "סינגל", agreedPrice: 800, currency: "₪", expenseStatus: "צפוי" }), [U(3)]: wv({ title: "רידים", projectType: "רידים" }) },
  order: [U(1), U(3)], versions: { [U(20)]: { workId: U(1), label: "v2", status: "בבדיקה" } },
  comments: { [U(30)]: { versionId: U(20), workId: U(1), text: "הווקאל חזק מדי", timestampSeconds: 42, status: "open", attachments: 1 } },
  targets: { [U(50)]: { workId: U(3), name: "Instrumental", kind: "instrumental", removed: false }, [U(51)]: { workId: U(3), name: "שליו", kind: "artist", removed: false } },
  notes: { [U(60)]: { targetId: U(51), text: "להוריד ריוורב", status: "open" } },
  projects: { [U(40)]: "שיר", [U(41)]: "קליפ" }, pushes: [], skipped: [], synced: [], sentOnce: false,
});
function mk() {
  const w = world(); const calls: string[] = []; let n = 500;
  const writers = {
    async readCommentAttachment(id: string) { return w.atts[id] ? { ...w.atts[id] } : null; },
    async deleteCommentAttachment(cid: string, id: string) { calls.push("deleteCommentAttachment"); if (w.atts[id]?.commentId !== cid) return "not_found"; delete w.atts[id]; return "ok"; },
    async readEngineerWork(id: string) { return w.works[id] ? { ...w.works[id] } : null; },
    async listEngineerOrder(eng: string) { return w.order.filter((id) => w.works[id]?.engineerName === eng); },
    async projectTypeOf(pid: string) { return w.projects[pid] ?? null; },
    async createEngineerWork(pid: string | null, f: { engineerName: string; workTitle: string | null; workType: string; status: string; agreedPrice: number; currency: string; skipFinanceSync: boolean }) { calls.push(`createEngineerWork:${f.skipFinanceSync}`); const id = U(++n); w.works[id] = wv({ projectId: pid, title: f.workTitle ?? "", engineerName: f.engineerName, workType: f.workType, status: f.status, agreedPrice: f.agreedPrice, currency: f.currency }); return id; },
    async updateEngineerWork(id: string, f: Record<string, unknown>) { calls.push(`updateEngineerWork:${f.skipFinanceSync}`); for (const [k, v] of Object.entries(f)) if (k !== "skipFinanceSync") (w.works[id] as unknown as Record<string, unknown>)[k] = v; },
    async recordEngineerPayment(id: string, paid: boolean, date: string | null) { calls.push("recordEngineerPayment"); w.works[id].amountPaid = paid ? w.works[id].agreedPrice : 0; w.works[id].paymentDate = paid ? date : null; },
    async deleteEngineerWork(id: string) { calls.push("deleteEngineerWork"); delete w.works[id]; return { removedExpense: true }; },
    async reorderEngineerWork(ids: string[]) { calls.push("reorderEngineerWork"); w.order = ids; },
    async forceEngineerFinanceSync(id: string) { calls.push("forceEngineerFinanceSync"); w.synced.push(id); return "tx-1"; },
    async readMixVersion(id: string) { return w.versions[id] ? { ...w.versions[id] } : null; },
    async readMixCommentFull(id: string) { return w.comments[id] ? { ...w.comments[id] } : null; },
    async createMixComment(c: { versionId: string; text: string; timestampSeconds: number | null }) { calls.push("createMixComment"); const id = U(++n); w.comments[id] = { versionId: c.versionId, workId: w.versions[c.versionId].workId, text: c.text, timestampSeconds: c.timestampSeconds, status: "open", attachments: 0 }; return id; },
    async editMixComment(id: string, p: { commentText?: string; timestampSeconds?: number }) { calls.push("editMixComment"); if (p.commentText !== undefined) w.comments[id].text = p.commentText; if (p.timestampSeconds !== undefined) w.comments[id].timestampSeconds = p.timestampSeconds; },
    async deleteMixComment(id: string) { calls.push("deleteMixComment"); delete w.comments[id]; },
    async deleteMixVersion(id: string) { calls.push("deleteMixVersion"); delete w.versions[id]; },
    async isRiddimWork(wid: string) { return w.works[wid]?.projectType === "רידים"; },
    async readMixTarget(id: string) { return w.targets[id] ? { ...w.targets[id] } : null; },
    async addRiddimLine(wid: string, name: string) { calls.push("addRiddimLine"); const id = U(++n); w.targets[id] = { workId: wid, name, kind: "artist", removed: false }; return { status: "ok", id }; },
    async renameRiddimLine(id: string, name: string) { calls.push("renameRiddimLine"); w.targets[id].name = name; return "ok"; },
    async removeRiddimLine(id: string) { calls.push("removeRiddimLine"); w.targets[id].removed = true; return "ok"; },
    async readPremixNote(id: string) { return w.notes[id] ? { ...w.notes[id] } : null; },
    async createPremixNote(tid: string, text: string) { calls.push("createPremixNote"); const id = U(++n); w.notes[id] = { targetId: tid, text, status: "open" }; return id; },
    async updatePremixNote(id: string, p: { noteText?: string; status?: string }) { calls.push("updatePremixNote"); if (p.noteText !== undefined) w.notes[id].text = p.noteText; if (p.status !== undefined) w.notes[id].status = p.status; },
    async deletePremixNote(id: string) { calls.push("deletePremixNote"); delete w.notes[id]; },
    async notifyMixReady(wid: string, again: boolean) { calls.push("notifyMixReady"); if (w.sentOnce && !again) return { ok: true, alreadySent: true }; w.sentOnce = true; w.pushes.push(`ready:${wid}`); return { ok: true }; },
    async sendMixNotes(wid: string) { calls.push("sendMixNotes"); w.pushes.push(`notes:${wid}`); return { ok: true }; },
  };
  return { w, calls, writers };
}
const MW1 = `mix-work:${U(1)}`, MW2 = `mix-work:${U(2)}`, MW3 = `mix-work:${U(3)}`, MV = `mix-version:${U(20)}`, MC = `mix-comment:${U(30)}`, ML = `mix-line:${U(51)}`, PN = `premix-note:${U(60)}`;
const CASES: FamilyCase<W>[] = [
  { id: "DELETE_MIX_ATTACHMENT", args: { attachment: `mix-attachment:${U(70)}` }, confirm: "כן בוס, מחיקה", bad: { attachment: "mix-attachment:1" }, missing: { attachment: `mix-attachment:${U(79)}` }, wrongKind: { attachment: MC }, stale: (w) => { w.atts[U(70)].fileName = "x.m4a"; }, check: (w) => !w.atts[U(70)] && !!w.comments[U(30)] },
  { id: "CREATE_ENGINEER_WORK", args: { project: `project:${U(40)}`, engineerName: "Steven", workType: "מיקס", agreedPrice: 250, currency: "$" }, confirm: "כן בוס, Steven $250", bad: { project: `project:${U(40)}`, engineerName: "Steven", workType: "הקלטה" }, missing: { project: `project:${U(99)}`, engineerName: "Bill", workType: "מיקס" }, stale: (w) => { w.projects[U(40)] = "EP"; }, check: (w, c) => Object.values(w.works).some((x) => x.agreedPrice === 250 && x.engineerName === "Steven") && c.join() === "createEngineerWork:true" },
  { id: "UPDATE_ENGINEER_WORK", args: { mixWork: MW2, workType: "מאסטר", internalDeadline: "2026-10-05" }, confirm: "כן בוס, 2026-10-05", bad: { mixWork: MW2, internalDeadline: "מחר" }, missing: { mixWork: `mix-work:${U(9)}`, notes: "x" }, wrongKind: { mixWork: MV, notes: "x" }, stale: (w) => { w.works[U(2)].notes = "x"; }, check: (w, c) => w.works[U(2)].workType === "מאסטר" && c.join() === "updateEngineerWork:false" },
  { id: "SET_ENGINEER_WORK_STATUS", args: { mixWork: MW1, status: "אושר" }, confirm: "כן בוס, אושר", bad: { mixWork: MW1, status: "הושלם" }, missing: { mixWork: `mix-work:${U(9)}`, status: "אושר" }, stale: (w) => { w.works[U(1)].status = "חזר"; }, check: (w, c) => w.works[U(1)].status === "אושר" && c.join() === "updateEngineerWork:true" },
  { id: "SET_ENGINEER_WORK_PRICE", args: { mixWork: MW2, agreedPrice: 900, currency: "₪" }, confirm: "כן בוס, ₪900", bad: { mixWork: MW2, agreedPrice: -1, currency: "₪" }, missing: { mixWork: `mix-work:${U(9)}`, agreedPrice: 1, currency: "$" }, stale: (w) => { w.works[U(2)].agreedPrice = 850; }, check: (w) => w.works[U(2)].agreedPrice === 900 && w.works[U(2)].currency === "₪" },
  { id: "RECORD_ENGINEER_PAYMENT", args: { mixWork: MW1, paid: true, paymentDate: "2026-09-26" }, confirm: "כן בוס, שולם 2026-09-26", bad: { mixWork: MW1, paid: true }, missing: { mixWork: `mix-work:${U(9)}`, paid: false }, stale: (w) => { w.works[U(1)].agreedPrice = 300; }, check: (w, c) => w.works[U(1)].amountPaid === 200 && w.works[U(1)].paymentDate === "2026-09-26" && c.join() === "recordEngineerPayment" },
  { id: "DELETE_ENGINEER_WORK", args: { mixWork: MW2 }, confirm: "כן בוס, מחיקה", bad: { mixWork: "mix-work:1" }, missing: { mixWork: `mix-work:${U(9)}` }, stale: (w) => { w.works[U(2)].expenseStatus = "שולם"; }, check: (w) => !w.works[U(2)] },
  { id: "MOVE_ENGINEER_WORK", args: { mixWork: MW3, position: 1 }, bad: { mixWork: MW3, position: 9 }, missing: { mixWork: `mix-work:${U(9)}`, position: 1 }, stale: (w) => { w.order = [U(3), U(1)]; }, check: (w) => w.order[0] === U(3) && w.order[1] === U(1) },
  { id: "FORCE_ENGINEER_FINANCE_SYNC", args: { mixWork: MW2 }, confirm: "כן בוס, סנכרון", bad: { mixWork: "x" }, missing: { mixWork: `mix-work:${U(9)}` }, stale: (w) => { w.works[U(2)].agreedPrice = 1; }, check: (w) => w.synced.includes(U(2)) },
  { id: "ADD_MIX_COMMENT", args: { mixVersion: MV, text: "הבס נבלע", timestampSeconds: 95 }, bad: { mixVersion: MV, text: "" }, missing: { mixVersion: `mix-version:${U(9)}`, text: "x" }, wrongKind: { mixVersion: MW1, text: "x" }, stale: (w) => { w.versions[U(20)].label = "v3"; }, check: (w) => Object.values(w.comments).some((c) => c.text === "הבס נבלע" && c.timestampSeconds === 95) },
  { id: "EDIT_MIX_COMMENT", args: { mixComment: MC, text: "הווקאל חזק מדי בפזמון" }, bad: { mixComment: MC, timestampSeconds: -4 }, missing: { mixComment: `mix-comment:${U(9)}`, text: "x" }, stale: (w) => { w.comments[U(30)].text = "y"; }, check: (w) => w.comments[U(30)].text === "הווקאל חזק מדי בפזמון" && w.comments[U(30)].status === "open" },
  { id: "DELETE_MIX_COMMENT", args: { mixComment: MC }, confirm: "כן בוס, מחיקה", bad: { mixComment: "mix-comment:1" }, missing: { mixComment: `mix-comment:${U(9)}` }, stale: (w) => { w.comments[U(30)].attachments = 2; }, check: (w) => !w.comments[U(30)] },
  { id: "DELETE_MIX_VERSION", args: { mixVersion: MV }, confirm: "כן בוס, מחיקה", bad: { mixVersion: "mix-version:1" }, missing: { mixVersion: `mix-version:${U(9)}` }, stale: (w) => { w.versions[U(20)].status = "מאושר"; }, check: (w) => !w.versions[U(20)] },
  { id: "ADD_RIDDIM_LINE", args: { mixWork: MW3, name: "נגש" }, bad: { mixWork: MW3, name: "" }, missing: { mixWork: `mix-work:${U(9)}`, name: "x" }, stale: (w) => { w.works[U(3)].projectType = "שיר"; }, check: (w) => Object.values(w.targets).some((t) => t.name === "נגש" && t.workId === U(3)) },
  { id: "RENAME_RIDDIM_LINE", args: { mixLine: ML, name: "שליו טסמה" }, bad: { mixLine: ML, name: "" }, missing: { mixLine: `mix-line:${U(9)}`, name: "x" }, stale: (w) => { w.targets[U(51)].name = "x"; }, check: (w) => w.targets[U(51)].name === "שליו טסמה" },
  { id: "REMOVE_RIDDIM_LINE", args: { mixLine: ML }, bad: { mixLine: "mix-line:1" }, missing: { mixLine: `mix-line:${U(9)}` }, stale: (w) => { w.targets[U(51)].name = "x"; }, check: (w) => w.targets[U(51)].removed === true },
  { id: "ADD_PREMIX_NOTE", args: { mixLine: ML, text: "יותר מקום לקיק" }, bad: { mixLine: ML, text: "" }, missing: { mixLine: `mix-line:${U(9)}`, text: "x" }, stale: (w) => { w.targets[U(51)].name = "x"; }, check: (w) => Object.values(w.notes).some((x) => x.text === "יותר מקום לקיק" && x.targetId === U(51)) },
  { id: "UPDATE_PREMIX_NOTE", args: { premixNote: PN, status: "resolved" }, bad: { premixNote: PN, status: "done" }, missing: { premixNote: `premix-note:${U(9)}`, status: "resolved" }, stale: (w) => { w.notes[U(60)].text = "x"; }, check: (w) => w.notes[U(60)].status === "resolved" },
  { id: "DELETE_PREMIX_NOTE", args: { premixNote: PN }, confirm: "כן בוס, מחיקה", bad: { premixNote: "premix-note:1" }, missing: { premixNote: `premix-note:${U(9)}` }, stale: (w) => { w.notes[U(60)].status = "resolved"; }, check: (w) => !w.notes[U(60)] },
  { id: "NOTIFY_MIX_READY", args: { mixWork: MW1 }, confirm: "כן בוס, Steven", bad: { mixWork: "x" }, missing: { mixWork: `mix-work:${U(9)}` }, stale: (w) => { w.works[U(1)].status = "חזר"; }, check: (w) => w.pushes.join() === `ready:${U(1)}` },
  { id: "SEND_MIX_NOTES", args: { mixWork: MW1, mixVersion: MV }, confirm: "כן בוס, Steven", bad: { mixWork: "x" }, missing: { mixWork: `mix-work:${U(9)}` }, stale: (w) => { w.works[U(1)].notes = "z"; }, check: (w) => w.pushes.join() === `notes:${U(1)}` },
];

(async () => {
  console.log("Mix family — standard checks");
  ok("the case table covers every Mix primitive", CASES.map((c) => c.id).sort().join() === MIX_PRIMITIVES.map((p) => p.actionId).sort().join());
  await runCases(CASES, mk, ok);

  console.log("\nMix rules");
  const q = (id: string, args: Record<string, unknown>, h = mk()) => planAction({ intentHe: "x", actionId: id, args }, OWNER, mkDeps(h.writers).d);
  ok("Steven only gets the project types the app allows", (await q("CREATE_ENGINEER_WORK", { project: `project:${U(41)}`, engineerName: "Steven", workType: "מיקס" })).status === "STEVEN_PROJECT_TYPE");
  ok("only exactly 'Steven' is Steven (a 'steven' spelled differently is a different engineer)", (await q("CREATE_ENGINEER_WORK", { project: `project:${U(41)}`, engineerName: "steven", workType: "מיקס" })).status === "PREVIEW");
  ok("a price needs an explicit currency", (await q("CREATE_ENGINEER_WORK", { title: "x", engineerName: "Bill", workType: "מיקס", agreedPrice: 100 })).status === "BAD_CURRENCY");
  const nop = mk(); nop.w.works[U(1)].agreedPrice = 0;
  ok("paid needs a price first", (await q("RECORD_ENGINEER_PAYMENT", { mixWork: MW1, paid: true, paymentDate: "2026-09-26" }, nop)).status === "NO_PRICE");
  ok("the Steven pushes exist only for Steven", (await q("NOTIFY_MIX_READY", { mixWork: MW2 })).status === "NOT_STEVEN" && (await q("SEND_MIX_NOTES", { mixWork: MW2 })).status === "NOT_STEVEN");
  const twice = mk(); twice.w.sentOnce = true; const rt = await fullFlow(mkDeps(twice.writers).d, "NOTIFY_MIX_READY", { mixWork: MW1 }, "כן בוס, Steven");
  ok("an already-sent 'mix ready' is reported as NOT sent (never a false success)", rt.e?.status !== "APPLIED_AS_EXPECTED" && twice.w.pushes.length === 0, rt.e?.status);
  ok("the instrumental line can never be removed or renamed", (await q("REMOVE_RIDDIM_LINE", { mixLine: `mix-line:${U(50)}` })).status === "INSTRUMENTAL" && (await q("RENAME_RIDDIM_LINE", { mixLine: `mix-line:${U(50)}`, name: "x" })).status === "INSTRUMENTAL");
  ok("riddim lines only on a riddim work", (await q("ADD_RIDDIM_LINE", { mixWork: MW1, name: "x" })).status === "NOT_RIDDIM");
  ok("a Steven work's finance goes through payment, not the drawer sync", (await q("FORCE_ENGINEER_FINANCE_SYNC", { mixWork: MW1 })).status === "STEVEN_FLOW");
  const del = await q("DELETE_ENGINEER_WORK", { mixWork: MW2 });
  ok("delete preview says the unpaid linked expense goes with it", del.status === "PREVIEW" && JSON.stringify(del).includes("תימחק איתה"));
  ok("deletes are C3; pushes are EXTERNAL_COMMUNICATION with PUSH", ["DELETE_ENGINEER_WORK", "DELETE_MIX_COMMENT", "DELETE_MIX_VERSION", "DELETE_PREMIX_NOTE"].every((id) => ACTION_REGISTRY.get(id)!.confirmation === "C3_STRONG_APPROVAL") && ["NOTIFY_MIX_READY", "SEND_MIX_NOTES"].every((id) => ACTION_REGISTRY.get(id)!.effects.includes("PUSH" as never)));

  console.log("\nVocabularies pinned to the code");
  const ty = read("lib/types.ts");
  ok("engineer statuses = lib/types SOUND_ENGINEER_STATUSES", ty.includes(`"${ENGINEER_STATUSES.join('", "')}",`));
  ok("work types = lib/types SOUND_ENGINEER_WORK_TYPES", ty.includes(`"${ENGINEER_WORK_TYPES.join('", "')}",`));
  const sc = read("lib/steven-scope.ts");
  ok("Steven's project types = lib/steven-scope", /STEVEN_ALLOWED_PROJECT_TYPES: string\[\] = \["שיר", RIDDIM_PROJECT_TYPE, "אלבום", "EP"\]/.test(sc) && /RIDDIM_PROJECT_TYPE = "רידים"/.test(sc) && STEVEN_PROJECT_TYPES.join() === "שיר,רידים,אלבום,EP" && /STEVEN_ENGINEER = "Steven"/.test(sc));

  console.log("\nShared writers + hardening");
  ok("comment / version / work deletes use the shared writer", /deleteMixCommentWithAttachments\(/.test(read("app/api/sound-engineer/comments/[commentId]/route.ts")) && /deleteMixVersionWithFile\(/.test(read("app/api/sound-engineer/versions/[versionId]/route.ts")) && /deleteEngineerWorkClean\(/.test(read("app/api/sound-engineer/[id]/route.ts")));
  const wm = read("lib/writes/mix.ts");
  ok("HARDENED (A4 2026-09-29): deleting a work removes its UNPAID linked expense only — a paid OR partly paid (חלקי) one is kept; the delete is conditional", /exp && !ENGINEER_EXPENSE_MONEY_MOVED\.includes\(exp\.status\)/.test(wm) && /ENGINEER_EXPENSE_MONEY_MOVED: readonly string\[\] = \["שולם", "חלקי", "התקבל"\]/.test(wm) && /\.delete\(\)\.eq\("id", exp\.id\)\.not\("payment_status", "in", \'\("שולם","חלקי","התקבל"\)\'\)/.test(wm));
  const store = read("lib/sound-engineer-store.ts");
  ok("payment: ONE call for every engineer (the store update runs THE one writer server-side); no second Steven sync", /await updateSoundEngineerWork\(workId, \{ amountPaid: paid \? w\.agreedPrice : 0, paymentDate: paid \? paymentDate : null \}\)/.test(wm) && !/syncStevenPaymentExpense/.test(wm + store));
  ok("the one writer: reconcileEngineerExpense decides with decideEngineerExpense; every store path uses it (create / update / force sync)", /export async function reconcileEngineerExpense/.test(wm) && /decideEngineerExpense\(/.test(wm) && (store.match(/await reconcile\(/g) ?? []).length >= 3 && !/function syncTransaction/.test(store));
  ok("paid rows protected on both write paths: the conditional update / delete never touch a שולם row", /\.update\(d\.fields\)\.eq\("id", d\.txId\)\.neq\("payment_status", "שולם"\)/.test(wm) && /\.delete\(\)\.eq\("id", d\.txId\)\.not\("payment_status", "in", \'\("שולם","חלקי","התקבל"\)\'\)/.test(wm));
  ok("no caller supplies a storage path (paths come from the stored records)", !/path:\s*string/.test(read("lib/partner/act/primitives/mix.ts")));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
