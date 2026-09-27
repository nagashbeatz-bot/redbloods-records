/**
 * Universal Action Layer — send log + album tracks: every primitive through the REAL service on fakes (6 standard
 * checks each) + family rules (the drawer's vocabularies; the delete cascade runs server-side; no URL is written;
 * duplicate track numbers refused; move renumbers 1…n), pinned vocabularies and the shared writers the routes use.
 * Run with:   npx tsx scripts/test-sunny-act-worklog.tsx      Pure; never touches production.
 */
import fs from "node:fs";
import path from "node:path";
import { runCases, mkDeps, fullFlow, U, OWNER, type FamilyCase } from "./fixtures/act-harness";
import { planAction } from "../lib/partner/act/service";
import { MIX_MASTER_STATUSES, SEND_ACTION_TYPES, SEND_STATUSES, WORKLOG_PRIMITIVES } from "../lib/partner/act/primitives/worklog";
import { ACTION_REGISTRY } from "../lib/partner/act/registry";
import { NEEDS_HARDENING, HARDENED } from "../lib/partner/act/registry";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: unknown) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 500)}` : ""}`); } };
const read = (p: string) => fs.readFileSync(path.resolve(__dirname, "..", p), "utf8");

type Lg = Record<string, unknown>;
type Tr = { project_id: string; track_number: number; title: string; status: string; mix_status: string; master_status: string; notes: string | null };
interface W { prev: { rows: Array<{ id: string; name: string; costWithoutMix: number; mixMaster: number; paid: number }>; note: string }; projects: Record<string, string>; log: Record<string, Lg>; tracks: Record<string, Tr>; cascades: string[] }
const world = (): W => ({
  projects: { [U(1)]: "אלבום שליו" },
  log: {
    [U(10)]: { project_id: U(1), action_type: "sent", content_type: "mix", version_label: "V1", recipient_role: "artist", recipient_name: "שליו", status: "pending_feedback", action_date: "2026-09-20", followup_date: null, notes: null, linked_work_id: null },
    [U(11)]: { project_id: U(1), action_type: "sent", content_type: "stems", version_label: null, recipient_role: "sound_engineer", recipient_name: "Steven", status: "sent", action_date: "2026-09-21", followup_date: null, notes: null, linked_work_id: U(50) },
  },
  tracks: {
    [U(20)]: { project_id: U(1), track_number: 1, title: "פתיחה", status: "בעבודה", mix_status: "לא התחיל", master_status: "לא התחיל", notes: null },
    [U(21)]: { project_id: U(1), track_number: 2, title: "אמצע", status: "בעבודה", mix_status: "בתהליך", master_status: "לא התחיל", notes: null },
    [U(22)]: { project_id: U(1), track_number: 3, title: "סוף", status: "בעבודה", mix_status: "לא התחיל", master_status: "לא התחיל", notes: null },
  },
  cascades: [],
  prev: { rows: [{ id: "row-0001", name: "שיר 1", costWithoutMix: 3000, mixMaster: 800, paid: 2000 }], note: "" },
});
const snake: Record<string, string> = { actionType: "action_type", contentType: "content_type", versionLabel: "version_label", recipientRole: "recipient_role", recipientName: "recipient_name", recipientPhone: "recipient_phone", status: "status", actionDate: "action_date", followupDate: "followup_date", notes: "notes" };
function mk() {
  const w = world(); const calls: string[] = []; let n = 500;
  const writers = {
    async readProjectMeta(id: string) { return w.projects[id] ? { name: w.projects[id], artist: "שליו", status: "בעבודה", isHidden: false, businessType: "לייבל", projectType: "אלבום", hasRelease: false } : null; },
    async readAlbumPrevInfo() { return JSON.parse(JSON.stringify(w.prev)); },
    async saveAlbumPrevInfo(_p: string, v: W["prev"]) { calls.push("saveAlbumPrevInfo"); w.prev = JSON.parse(JSON.stringify(v)); },
    async readVictorWorkFull(id: string) { return id === U(60) ? { title: "הפקה לאלבום", projectId: U(1) } : id === U(61) ? { title: "אחר", projectId: U(9) } : null; },
    async readEngineerWork(id: string) { return id === U(50) ? { title: "מיקס", projectId: U(1) } : null; },
    async readSendLogEntry(id: string) { return w.log[id] ? { ...w.log[id] } : null; },
    async createSendLogEntry(b: Record<string, unknown>) { calls.push("createSendLogEntry"); const id = U(++n); const r: Lg = { project_id: b.projectId, linked_work_id: null }; for (const [k, v] of Object.entries(snake)) r[v] = b[k] ?? null; w.log[id] = r; return id; },
    async updateSendLogEntry(id: string, b: Record<string, unknown>) { calls.push("updateSendLogEntry"); for (const [k, v] of Object.entries(b)) w.log[id][snake[k] ?? k] = v; },
    async deleteSendLogEntryWithCascade(id: string) { calls.push("deleteSendLogEntryWithCascade"); const e = w.log[id]; const c = e.linked_work_id ? (e.recipient_role === "sound_engineer" ? "engineer_work" : "victor_work") : "none"; w.cascades.push(c); delete w.log[id]; return { cascade: c }; },
    async readAlbumTrack(id: string) { return w.tracks[id] ? { ...w.tracks[id] } : null; },
    async albumTrackOrder(pid: string) { return Object.entries(w.tracks).filter(([, t]) => t.project_id === pid).map(([id, t]) => ({ id, track_number: t.track_number })).sort((a, b) => a.track_number - b.track_number); },
    async createAlbumTrack(b: Record<string, unknown>) { calls.push("createAlbumTrack"); const id = U(++n); w.tracks[id] = { project_id: String(b.project_id), track_number: Number(b.track_number), title: String(b.title), status: String(b.status ?? "טרום הקלטה"), mix_status: String(b.mix_status ?? "לא התחיל"), master_status: String(b.master_status ?? "לא התחיל"), notes: (b.notes as string) ?? null }; return id; },
    async updateAlbumTrack(id: string, b: Record<string, unknown>) { calls.push("updateAlbumTrack"); Object.assign(w.tracks[id], b); },
    async deleteAlbumTrack(id: string) { calls.push("deleteAlbumTrack"); delete w.tracks[id]; },
    async renumberAlbumTracks(ts: Array<{ id: string; track_number: number }>) { calls.push("renumberAlbumTracks"); for (const t of ts) w.tracks[t.id].track_number = t.track_number; },
  };
  return { w, calls, writers };
}
const P1 = `project:${U(1)}`, L10 = `send-log:${U(10)}`, L11 = `send-log:${U(11)}`, T20 = `album-track:${U(20)}`, T22 = `album-track:${U(22)}`;
const CASES: FamilyCase<W>[] = [
  { id: "SET_ALBUM_PREV_ROW", args: { project: P1, rowId: "row-0001", paid: 2500 }, bad: { project: P1, rowId: "row-0001", paid: -1 }, missing: { project: P1, rowId: "row-9999", paid: 1 }, wrongKind: { project: T20, paid: 1 }, stale: (w) => { w.prev.rows[0].mixMaster = 900; }, check: (w) => w.prev.rows[0].paid === 2500 && w.prev.rows[0].costWithoutMix === 3000 },
  { id: "DELETE_ALBUM_PREV_ROW", args: { project: P1, rowId: "row-0001" }, confirm: "כן בוס, מחיקה", bad: { project: P1 }, missing: { project: P1, rowId: "row-9999" }, stale: (w) => { w.prev.rows.push({ id: "row-0002", name: "x", costWithoutMix: 0, mixMaster: 0, paid: 0 }); }, check: (w) => w.prev.rows.length === 0 },
  { id: "SET_ALBUM_PREV_NOTE", args: { project: P1, note: "יובא ממאנדיי 2025" }, bad: { project: P1, note: 5 }, missing: { project: `project:${U(9)}`, note: "x" }, stale: (w) => { w.prev.note = "y"; }, check: (w) => w.prev.note === "יובא ממאנדיי 2025" },
  { id: "ADD_SEND_LOG_ENTRY", args: { project: P1, actionType: "sent", contentType: "master", recipientRole: "client", recipientName: "יוסי", actionDate: "2026-09-26", followupDate: "2026-09-30" }, bad: { project: P1, actionType: "shipped" }, missing: { project: `project:${U(9)}`, actionType: "sent" }, wrongKind: { project: T20, actionType: "sent" }, stale: (w) => { w.projects[U(1)] = "אלבום שליו 2"; }, check: (w) => Object.values(w.log).some((e) => e.recipient_name === "יוסי" && e.status === "pending_feedback" && e.followup_date === "2026-09-30" && e.content_type === "master") },
  { id: "UPDATE_SEND_LOG_ENTRY", args: { sendLogEntry: L10, status: "got_notes", notes: "הערות על הבית" }, bad: { sendLogEntry: L10, status: "done" }, missing: { sendLogEntry: `send-log:${U(9)}`, status: "closed" }, wrongKind: { sendLogEntry: T20, status: "closed" }, stale: (w) => { w.log[U(10)].status = "approved"; }, check: (w) => w.log[U(10)].status === "got_notes" && w.log[U(10)].notes === "הערות על הבית" && w.log[U(10)].recipient_name === "שליו" },
  { id: "DELETE_SEND_LOG_ENTRY", args: { sendLogEntry: L11 }, confirm: "כן בוס, מחיקה", bad: { sendLogEntry: "send-log:1" }, missing: { sendLogEntry: `send-log:${U(9)}` }, stale: (w) => { w.log[U(11)].status = "approved"; }, check: (w) => !w.log[U(11)] && w.cascades.join() === "engineer_work" },
  { id: "ADD_ALBUM_TRACK", args: { project: P1, title: "בונוס", trackNumber: 4, mixStatus: "בתהליך" }, bad: { project: P1, title: "x", trackNumber: 0 }, missing: { project: `project:${U(9)}`, title: "x", trackNumber: 9 }, stale: (w) => { w.tracks[U(77)] = { project_id: U(1), track_number: 9, title: "t", status: "בעבודה", mix_status: "לא התחיל", master_status: "לא התחיל", notes: null }; }, check: (w) => Object.values(w.tracks).some((t) => t.title === "בונוס" && t.track_number === 4 && t.mix_status === "בתהליך") },
  { id: "UPDATE_ALBUM_TRACK", args: { albumTrack: T20, masterStatus: "הושלם", title: "פתיחה (אינטרו)" }, bad: { albumTrack: T20, mixStatus: "גמור" }, missing: { albumTrack: `album-track:${U(9)}`, title: "x" }, wrongKind: { albumTrack: L10, title: "x" }, stale: (w) => { w.tracks[U(20)].notes = "x"; }, check: (w) => w.tracks[U(20)].master_status === "הושלם" && w.tracks[U(20)].title === "פתיחה (אינטרו)" },
  { id: "DELETE_ALBUM_TRACK", args: { albumTrack: T20 }, confirm: "כן בוס, מחיקה", bad: { albumTrack: "album-track:1" }, missing: { albumTrack: `album-track:${U(9)}` }, stale: (w) => { w.tracks[U(20)].title = "t"; }, check: (w) => !w.tracks[U(20)] },
  { id: "MOVE_ALBUM_TRACK", args: { albumTrack: T22, position: 1 }, bad: { albumTrack: T22, position: 4 }, missing: { albumTrack: `album-track:${U(9)}`, position: 1 }, stale: (w) => { w.tracks[U(20)].track_number = 5; }, check: (w) => w.tracks[U(22)].track_number === 1 && w.tracks[U(20)].track_number === 2 && w.tracks[U(21)].track_number === 3 },
];

(async () => {
  console.log("Send log + albums — standard checks");
  ok("the case table covers every worklog primitive", CASES.map((c) => c.id).sort().join() === WORKLOG_PRIMITIVES.map((p) => p.actionId).sort().join());
  await runCases(CASES, mk, ok);

  console.log("\nFamily rules");
  const q = (id: string, args: Record<string, unknown>, h = mk()) => planAction({ intentHe: "x", actionId: id, args }, OWNER, mkDeps(h.writers).d);
  ok("a taken track number is refused", (await q("ADD_ALBUM_TRACK", { project: P1, title: "x", trackNumber: 2 })).status === "DUPLICATE");
  ok("an unchanged send-log update is a no-op refusal", (await q("UPDATE_SEND_LOG_ENTRY", { sendLogEntry: L10, status: "pending_feedback" })).status !== "PREVIEW");
  ok("no URL argument exists (plans never persist links)", WORKLOG_PRIMITIVES.every((p) => p.meta.args.every((a) => !/url|dropbox|^link$/i.test(a.name))));
  const v = mk(); v.w.log[U(11)].recipient_role = "external_producer";
  const rv = await fullFlow(mkDeps(v.writers).d, "DELETE_SEND_LOG_ENTRY", { sendLogEntry: L11 }, "כן בוס, מחיקה");
  ok("a non-engineer linked send cascades into the Victor path (server-side)", rv.e?.status === "APPLIED_AS_EXPECTED" && v.w.cascades.join() === "victor_work");
  const r0 = mk(); const r0f = await fullFlow(mkDeps(r0.writers).d, "DELETE_SEND_LOG_ENTRY", { sendLogEntry: L11 }, "כן בוס");
  ok("a delete: \"כן בוס\" after the preview is enough (no repeated מחיקה)", r0f.e?.status === "APPLIED_AS_EXPECTED", r0f.e?.status);
  const lk = mk(); const rl = await fullFlow(mkDeps(lk.writers).d, "ADD_SEND_LOG_ENTRY", { project: P1, actionType: "sent", linkedWork: `victor-work:${U(60)}` });
  ok("a send-log entry can be linked to the project's Victor work (role forced to external_producer — the cascade stays right)", rl.e?.status === "APPLIED_AS_EXPECTED" && Object.values(lk.w.log).some((e) => e.recipient_role === "external_producer"), rl.e?.status);
  ok("a work of another project is refused", (await q("ADD_SEND_LOG_ENTRY", { project: P1, actionType: "sent", linkedWork: `victor-work:${U(61)}` })).status === "WRONG_PROJECT");
  ok("an engineer work link with a non-engineer recipient is refused", (await q("ADD_SEND_LOG_ENTRY", { project: P1, actionType: "sent", linkedWork: `mix-work:${U(50)}`, recipientRole: "artist" })).status === "BAD_ARGS");
  const nr = mk(); const rn = await fullFlow(mkDeps(nr.writers).d, "SET_ALBUM_PREV_ROW", { project: P1, name: "שיר 2", costWithoutMix: 1500 });
  ok("a new previous-info row is appended (other rows untouched)", rn.e?.status === "APPLIED_AS_EXPECTED" && nr.w.prev.rows.length === 2 && nr.w.prev.rows[1].name === "שיר 2" && nr.w.prev.rows[0].paid === 2000, rn.e);
  ok("the album finance route is typed (no whole-body merge) and prev-info uses the shared writer", /patchAlbumFinance\(projectId, body\)/.test(read("app/api/album-finance/route.ts")) && /saveAlbumPrevInfo\(projectId, body\)/.test(read("app/api/album-prev-info/route.ts")));
  ok("deletes are C3 destructive", ["DELETE_SEND_LOG_ENTRY", "DELETE_ALBUM_TRACK"].every((id) => ACTION_REGISTRY.get(id)!.confirmation === "C3_STRONG_APPROVAL"));
  ok("PROJECT.SEND_LOG_DELETE moved from NEEDS_HARDENING to HARDENED", !("PROJECT.SEND_LOG_DELETE" in NEEDS_HARDENING) && "PROJECT.SEND_LOG_DELETE" in HARDENED);

  console.log("\nVocabularies pinned to the code");
  const dr = read("components/ui/ProjectDrawer.tsx");
  ok("send-log action types = the drawer's typeLabel keys", SEND_ACTION_TYPES.every((t) => new RegExp(`${t}: "`).test(dr)));
  ok("send-log statuses all have drawer labels", SEND_STATUSES.every((s) => new RegExp(`\\b${s}:\\s+"`).test(dr)));
  ok("mix / master statuses = lib/types MixMasterStatus", read("lib/types.ts").includes(`MixMasterStatus  = ${MIX_MASTER_STATUSES.map((x) => `"${x}"`).join(" | ")}`));

  console.log("\nShared writers");
  ok("the send-log routes use lib/writes/worklog", /createSendLogEntry\(/.test(read("app/api/project-actions/route.ts")) && /updateSendLogEntry\(/.test(read("app/api/project-actions/[id]/route.ts")) && /deleteSendLogEntry\(/.test(read("app/api/project-actions/[id]/route.ts")));
  ok("the album routes use lib/writes/worklog", /createAlbumTrack\(/.test(read("app/api/album-tracks/route.ts")) && /updateAlbumTrack\(/.test(read("app/api/album-tracks/[id]/route.ts")) && /deleteAlbumTrack\(/.test(read("app/api/album-tracks/[id]/route.ts")) && /renumberAlbumTracks\(/.test(read("app/api/album-tracks/reorder/route.ts")));
  const wl = read("lib/writes/worklog.ts");
  ok("the cascade reuses the mix / Victor shared writers (no second delete rule)", /deleteEngineerWorkClean\(linkedWorkId\)/.test(wl) && /removeVictorWork\(linkedWorkId\)/.test(wl) && wl.indexOf("deleteEngineerWorkClean(linkedWorkId)") < wl.lastIndexOf("await deleteSendLogEntry(id)"));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
