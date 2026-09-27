/**
 * Universal Action Layer — ONE logical request = ONE plan (2026-09-27), reproduced on a FIXTURE album (never real data):
 *   11 × ADD_ALBUM_TRACK → one plan, one preview of all 11, ONE approval, ONE execute, every step APPLIED — no self-STALE
 *   (the plan's own new tracks are left out of the album order by their real created ids); an external change (after the
 *   preview, or between steps) still → STALE; a duplicate track number inside the plan is refused at planning; notes /
 *   status / mix / master are previewed, verified by a fresh read and readable back in album_view; 20-step cap.
 *   Connector rate limits: retryAfterSec, GENERAL vs ACTION named, a refused request spends no quota anywhere.
 * Run with:   npx tsx scripts/test-sunny-act-album-plan.tsx      Pure; never touches production.
 */
import fs from "node:fs";
import path from "node:path";
import { mkDeps, U, OWNER } from "./fixtures/act-harness";
import { approveAction, executeAction, planAction, previewAction, planStatus } from "../lib/partner/act/service";
import { ACT_TABLES } from "../lib/partner/act/store-supabase";
import { executorFor, PRIMITIVES_BY_ID } from "../lib/partner/act/primitives";
import { validateActInput, MAX_WORKFLOW_STEPS, ACT_TOOL_DEFINITIONS } from "../lib/partner/act/mcp-tools";
import { MAX_ACT_BODY_BYTES } from "../lib/partner/act/internal-handler";
import { readOperationsRaw, type OperationsReadClient } from "../lib/partner/operations/readers";
import { readProjectDetailRaw } from "../lib/partner/projects/detail-reader";
import { buildAlbumsView } from "../lib/partner/work/view";
import { handleMcpHttp, SERVER_INSTRUCTIONS, type McpDeps } from "../lib/integrations/partner-mcp/mcp";
import { readMcpConfig } from "../lib/integrations/partner-mcp/config";
import { SlidingWindowLimiter, gate } from "../lib/integrations/partner-mcp/rate-limit";
import { SUNNY_CONNECTOR_MODEL } from "../lib/partner/system/platform-domains";
import type { GatewaySources } from "../lib/partner/gateway/core";
import type { Plan } from "../lib/partner/act/types";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: unknown) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 700)}` : ""}`); } };
const read = (p: string) => fs.readFileSync(path.resolve(__dirname, "..", p), "utf8");

// ── the fixture album (NOT the real one) ────────────────────────────────────────────────────────────────────────────
type Tr = { project_id: string; track_number: number; title: string; status: string; mix_status: string; master_status: string; notes: string | null };
const ALBUM = U(50), P = `project:${ALBUM}`;
function mk() {
  const w = { tracks: {} as Record<string, Tr> };
  const calls: string[] = []; let n = 900;
  let onCreate: ((count: number) => void) | null = null; let created = 0;
  let dropNotes = false;
  const writers = {
    async readProjectMeta(id: string) { return id === ALBUM ? { name: "אלבום בדיקה", artist: "אמן בדיקה", status: "בעבודה", isHidden: false, businessType: "לקוח", projectType: "אלבום", hasRelease: false } : null; },
    async readAlbumTrack(id: string) { return w.tracks[id] ? { ...w.tracks[id] } : null; },
    async albumTrackOrder(pid: string) { return Object.entries(w.tracks).filter(([, t]) => t.project_id === pid).map(([id, t]) => ({ id, track_number: t.track_number })).sort((a, b) => a.track_number - b.track_number); },
    // like lib/writes/worklog createAlbumTrack: the app defaults + the DB UNIQUE (project_id, track_number)
    async createAlbumTrack(b: Record<string, unknown>) {
      calls.push("createAlbumTrack");
      if (Object.values(w.tracks).some((t) => t.project_id === b.project_id && t.track_number === b.track_number)) throw new Error("duplicate key value violates unique constraint \"album_tracks_unique_track_number\"");
      const id = U(++n);
      w.tracks[id] = { project_id: String(b.project_id), track_number: Number(b.track_number), title: String(b.title), status: String(b.status ?? "טרום הקלטה"), mix_status: String(b.mix_status ?? "לא התחיל"), master_status: String(b.master_status ?? "לא התחיל"), notes: dropNotes ? null : ((b.notes as string | undefined) ?? null) };
      onCreate?.(++created);
      return id;
    },
    async updateAlbumTrack(id: string, b: Record<string, unknown>) { calls.push("updateAlbumTrack"); Object.assign(w.tracks[id], b); },
    async renumberAlbumTracks(ts: Array<{ id: string; track_number: number }>) { calls.push("renumberAlbumTracks"); for (const t of ts) w.tracks[t.id].track_number = t.track_number; },
  };
  return { w, calls, writers, setOnCreate: (f: ((count: number) => void) | null) => { onCreate = f; }, setDropNotes: (v: boolean) => { dropNotes = v; } };
}
const extTrack = (w: ReturnType<typeof mk>["w"], id: number, num: number, title = "נוסף ממסך אחר") => { w.tracks[U(id)] = { project_id: ALBUM, track_number: num, title, status: "בעבודה", mix_status: "לא התחיל", master_status: "לא התחיל", notes: null }; };

const STATUSES = ["בעבודה", "מחכה למיקס", "במיקס", "הושלם", "בהשהייה", "לא התחיל"] as const;
const MM = ["לא התחיל", "בתהליך", "הושלם"] as const;
const TITLES = ["פתיחה", "אור ראשון", "ים", "חלון", "דרך", "בית", "שפל וגאות — גרסת בדיקה", "לילה", "רוח", "לאן — בדיקה", "סוף"];
const TRACK = (i: number) => ({ actionId: "ADD_ALBUM_TRACK", args: { project: P, title: TITLES[i], trackNumber: i + 1, status: STATUSES[i % STATUSES.length], mixStatus: MM[i % 3], masterStatus: MM[(i + 1) % 3], ...(i % 2 === 0 ? { notes: `הערה לשיר ${i + 1}: להקליט שוב את הפזמון` } : {}) } });
const ELEVEN = Array.from({ length: 11 }, (_, i) => TRACK(i));
type Deps = ReturnType<typeof mkDeps>["d"];
const plan = (d: Deps, steps: unknown[]) => planAction({ intentHe: "להוסיף 11 שירים לאלבום", steps }, OWNER, d);
async function approveExec(d: Deps, p: Record<string, unknown>) {
  const a = await approveAction({ planId: p.planId, planHash: p.planHash, confirmationText: "מאשר" }, OWNER, d);
  const e = a.status === "APPROVED_PENDING_EXECUTION" ? await executeAction({ planId: p.planId, approvalToken: a.approvalToken, confirmationText: "מאשר" }, OWNER, d) : null;
  return { a, e };
}
const creates = (c: string[]) => c.filter((x) => x === "createAlbumTrack").length;

/** album_view through the REAL readers (operations = ids / numbers / statuses; PROJECT_DETAIL = the free-text notes). */
async function albumView(w: ReturnType<typeof mk>["w"], o: { detail?: boolean } = {}) {
  const client: OperationsReadClient = {
    from(table: string) {
      return {
        select() {
          const rows = table === "album_tracks" ? Object.entries(w.tracks).map(([id, t]) => ({ id, ...t })) : table === "projects" ? [{ id: ALBUM, name: "אלבום בדיקה", project_type: "אלבום", status: "בעבודה" }] : [];
          const q = { range: () => q, like: () => q, in: () => q, then: (f: (v: unknown) => unknown, r?: (e: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(f, r) };
          return q as unknown as ReturnType<ReturnType<OperationsReadClient["from"]>["select"]>;
        },
      };
    },
  };
  const ops = await readOperationsRaw(client);
  const det = o.detail === false ? null : await readProjectDetailRaw(client);
  return buildAlbumsView({ now: new Date("2026-09-27T09:00:00Z"), operations: { status: "OK", value: ops }, ...(det ? { projectDetail: { status: "OK", value: det } } : {}) } as unknown as GatewaySources);
}

(async () => {
  console.log("A. 11 tracks = ONE plan · ONE preview · ONE approval · ONE execute (fixture album)");
  {
    const h = mk(); const { d, db } = mkDeps(h.writers);
    const p = await plan(d, ELEVEN);
    const steps = (p.steps ?? []) as Array<{ changes: Array<{ field: string; after: { value: unknown } }> }>;
    ok("A1. planning succeeds: one PREVIEW, a workflow of 11 steps, ONE stored plan", p.status === "PREVIEW" && p.workflow === true && steps.length === 11 && db.rows(ACT_TABLES.plans).length === 1, p.status === "PREVIEW" ? steps.length : p);
    ok("A2. the ONE preview carries all 11 tracks (preview.steps + per-step changes)", ((p.preview as { steps: unknown[] }).steps.length === 11) && steps.every((s, i) => s.changes.find((c) => c.field === "trackNumber")?.after.value === i + 1 && s.changes.find((c) => c.field === "title")?.after.value === TITLES[i]));
    ok("A2b. the preview shows status / mix / master / notes of every track (notes only where given)", steps.every((s, i) => s.changes.find((c) => c.field === "status")?.after.value === ELEVEN[i].args.status && s.changes.find((c) => c.field === "mixStatus")?.after.value === ELEVEN[i].args.mixStatus && s.changes.find((c) => c.field === "masterStatus")?.after.value === ELEVEN[i].args.masterStatus && (i % 2 === 0 ? s.changes.find((c) => c.field === "notes")?.after.value === ELEVEN[i].args.notes : !s.changes.some((c) => c.field === "notes"))));
    ok("A2c. the preview asks ONE approval for all of them", String(p.askHe).includes("11"), p.askHe);
    const prevLen = JSON.stringify(p).length;
    ok(`A2d. the whole preview response fits the connector output cap (${prevLen} chars < 100,000)`, prevLen < 100_000);
    const mcpInput = { intentHe: "להוסיף 11 שירים לאלבום", steps: ELEVEN };
    const bytes = Buffer.byteLength(JSON.stringify({ op: "plan", ownerId: OWNER.ownerId, clientId: OWNER.clientId, input: mcpInput }), "utf8");
    ok(`A2e. the 11-step request passes the connector's shape check and fits the 16KB request caps (${bytes} bytes)`, validateActInput("partner_plan_action", mcpInput).ok && bytes < MAX_ACT_BODY_BYTES && bytes < 16 * 1024);
    const r = await approveExec(d, p);
    const st = (r.e?.steps ?? []) as Array<{ status: string; createdKey?: string }>;
    ok("A3. ONE approval (\"מאשר\") → APPROVED; exactly one approval record for the plan", r.a.status === "APPROVED_PENDING_EXECUTION" && db.rows(ACT_TABLES.approvals).length === 1, r.a.status);
    ok("A4+A5. ONE execute → APPLIED_AS_EXPECTED, all 11 steps APPLIED, 11 creates", r.e?.status === "APPLIED_AS_EXPECTED" && st.length === 11 && st.every((x) => x.status === "APPLIED_AS_EXPECTED") && creates(h.calls) === 11, { status: r.e?.status, steps: st.map((x) => x.status) });
    ok("A6. no self-STALE: step 2 (and every later step) ran after step 1's own new track", st[1]?.status === "APPLIED_AS_EXPECTED" && !st.some((x) => x.status === "STALE"));
    const byNum = Object.values(h.w.tracks).sort((a, b) => a.track_number - b.track_number);
    ok("A7. track numbers #1–#11 stored in order with the right titles", byNum.map((t) => t.track_number).join() === "1,2,3,4,5,6,7,8,9,10,11" && byNum.every((t, i) => t.title === TITLES[i]));
    ok("A8. every track's status stored as sent", byNum.every((t, i) => t.status === ELEVEN[i].args.status));
    ok("A9. notes stored exactly where sent (and nowhere else)", byNum.every((t, i) => t.notes === (i % 2 === 0 ? ELEVEN[i].args.notes : null)));
    ok("A10. mix / master stored as sent", byNum.every((t, i) => t.mix_status === ELEVEN[i].args.mixStatus && t.master_status === ELEVEN[i].args.masterStatus));
    ok("A10b. each created track is named by its createdKey (album-track:<id>)", st.every((x) => /^album-track:[0-9a-f-]{36}$/.test(String(x.createdKey))));
    const rows = db.rows(ACT_TABLES.executions).filter((x) => x.plan_id === p.planId);
    ok("A10c. one execution row per step, all APPLIED; plan status EXECUTED", rows.length === 11 && rows.every((x) => x.status === "APPLIED_AS_EXPECTED") && (await planStatus({ planId: p.planId }, OWNER, d)).status === "EXECUTED");
    const v = await albumView(h.w);
    const al = v.albums.find((a) => a.key === P)!;
    const blind = await albumView(h.w, { detail: false });
    ok("A9c. without the detail source the notes are UNKNOWN (never 'no notes'); the operations reader never selects free text", blind.albums[0].tracks.every((t) => t.notes?.trust === "UNKNOWN") && !/notes/.test(read("lib/partner/operations/readers.ts").match(/"album_tracks", "([^"]+)"/)![1]));
    ok("A9b. notes read BACK through album_view (the real readers → view), with each track's action key", !!al && al.tracks.length === 11 && al.tracks.every((t, i) => (i % 2 === 0 ? t.notes?.text === ELEVEN[i].args.notes && t.notes?.trust === "RECORD" : t.notes === null) && t.key === st[i].createdKey), al?.tracks.slice(0, 2));
    // root cause pinned: WITHOUT leaving out step 1's own track, step 2's live context differs from its preview
    const stored = db.rows(ACT_TABLES.plans).find((x) => x.plan_id === p.planId)!.plan as Plan;
    const ex = executorFor(PRIMITIVES_BY_ID.get("ADD_ALBUM_TRACK")!, d.writers);
    const ids = st.map((x) => String(x.createdKey).split(":")[1]);
    const noEx = await ex.fingerprint(stored.steps[1], { excludeCreated: [] });
    const withEx = await ex.fingerprint(stored.steps[1], { excludeCreated: ids });
    ok("A6b. root cause pinned: the album order with the plan's own tracks ≠ the previewed one (old behaviour → STALE); leaving out exactly THIS run's created ids restores it", noEx !== stored.steps[1].expectedFingerprint && withEx === stored.steps[1].expectedFingerprint);
    const again = await approveAction({ planId: p.planId, planHash: p.planHash, confirmationText: "מאשר" }, OWNER, d);
    ok("A11. the executed plan cannot be approved / run again", again.status === "ALREADY_EXECUTED" && creates(h.calls) === 11, again.status);
  }

  console.log("\nB. Duplicate track number INSIDE the plan → refused at planning (never a DB error at execute)");
  {
    const h = mk(); const { d, db } = mkDeps(h.writers);
    const steps = [...ELEVEN.slice(0, 4), { actionId: "ADD_ALBUM_TRACK", args: { project: P, title: "כפול", trackNumber: 3 } }];
    const p = await plan(d, steps);
    ok("B1. two steps with #3 on the same album → DUPLICATE_TRACK_NUMBER_IN_PLAN, nothing stored, nothing written", p.status === "DUPLICATE_TRACK_NUMBER_IN_PLAN" && db.rows(ACT_TABLES.plans).length === 0 && creates(h.calls) === 0, p);
    ok("B1b. the refusal names both steps and the number (Hebrew, for the Boss)", String(p.messageHe).includes("שלב 3") && String(p.messageHe).includes("שלב 5") && String(p.messageHe).includes("3"), p.messageHe);
    const other = await plan(d, [ELEVEN[0], { actionId: "ADD_ALBUM_TRACK", args: { project: `project:${U(51)}`, title: "x", trackNumber: 1 } }]);
    ok("B2. the same number on a DIFFERENT album is not a clash (checked by album) — it fails only because that project is missing", other.status === "ENTITY_NOT_FOUND", other.status);
    extTrack(h.w, 300, 7, "קיים");
    const liveTaken = await plan(d, ELEVEN);
    ok("B3. a number already taken in the live album is still refused per step (DUPLICATE, with its step)", liveTaken.status === "DUPLICATE" && liveTaken.step === 6, liveTaken);
    const move = await plan(d, [ELEVEN[0], { actionId: "MOVE_ALBUM_TRACK", args: { albumTrack: `album-track:${U(300)}`, position: 1 } }]);
    ok("B4. adding + moving tracks of the same album in one plan → refused (the move would renumber around unseen tracks)", move.status === "ALBUM_ADD_AND_MOVE_IN_PLAN" && creates(h.calls) === 0, move.status);
  }

  console.log("\nC. External changes still → STALE (the self-STALE fix never weakens it)");
  {
    const h = mk(); const { d, db } = mkDeps(h.writers);
    const p = await plan(d, ELEVEN);
    extTrack(h.w, 301, 12); // someone adds a track in another screen after the preview (a free number)
    const pv = await previewAction({ planId: p.planId }, OWNER, d);
    ok("C1. the preview re-read already says STALE", pv.status === "STALE", pv.status);
    const r = await approveExec(d, p);
    ok("C2. an external track added after the preview → STALE and NOTHING runs", r.e?.status === "STALE" && creates(h.calls) === 0, r.e?.status);
    const rows = db.rows(ACT_TABLES.executions).filter((x) => x.plan_id === p.planId);
    ok("C3. every step has its one truthful row (STALE for the first changed step, NOT_RUN for the rest)", rows.length === 11 && rows.filter((x) => x.status === "STALE").length === 1 && rows.filter((x) => x.status === "NOT_RUN").length === 10);
  }
  {
    const h = mk(); const { d } = mkDeps(h.writers);
    const p = await plan(d, ELEVEN);
    extTrack(h.w, 302, 5); // the external change takes one of the plan's own numbers
    const r = await approveExec(d, p);
    ok("C4. a track number the plan will use taken externally after the preview → STALE, nothing runs (no DB error path)", r.e?.status === "STALE" && creates(h.calls) === 0, r.e?.status);
  }
  {
    const h = mk(); const { d } = mkDeps(h.writers);
    const p = await plan(d, ELEVEN);
    h.setOnCreate((n) => { if (n === 3) extTrack(h.w, 303, 30, "הוסף באמצע הריצה"); }); // an external insert DURING the run
    const r = await approveExec(d, p);
    const st = (r.e?.steps ?? []) as Array<{ status: string }>;
    ok("C5. an external change BETWEEN steps → the next step is STALE, nothing later runs (PARTIALLY_APPLIED, 3 applied)", r.e?.status === "PARTIALLY_APPLIED" && st.slice(0, 3).every((x) => x.status === "APPLIED_AS_EXPECTED") && st[3]?.status === "STALE" && st.slice(4).every((x) => x.status === "NOT_RUN") && creates(h.calls) === 3, st.map((x) => x.status));
  }
  {
    const h = mk(); const { d } = mkDeps(h.writers);
    extTrack(h.w, 304, 20, "קיים");
    const p = await plan(d, ELEVEN);
    h.w.tracks[U(304)].title = "שונה ממסך אחר"; // an existing track RENAMED — not a number change
    const r = await approveExec(d, p);
    ok("C6. only the order (numbers + ids) is the creation context: renaming an unrelated existing track does not block", r.e?.status === "APPLIED_AS_EXPECTED" && creates(h.calls) === 11, r.e?.status);
  }

  console.log("\nD. notes: previewed, verified, readable (ADD + UPDATE); single-step actions unchanged");
  {
    const h = mk(); const { d } = mkDeps(h.writers);
    const p = await planAction({ intentHe: "שיר אחד", actionId: "ADD_ALBUM_TRACK", args: { project: P, title: "יחיד", trackNumber: 1, notes: "  לבדוק את הבס  " } }, OWNER, d);
    ok("D1. single-step ADD_ALBUM_TRACK still plans (one PREVIEW, notes shown trimmed)", p.status === "PREVIEW" && (p.changes as Array<{ field: string; after: { value: unknown } }>).some((c) => c.field === "notes" && c.after.value === "לבדוק את הבס"), p.changes);
    const r = await approveExec(d, p);
    const t = Object.values(h.w.tracks)[0];
    ok("D2. …executes and verifies (notes stored exactly as previewed)", r.e?.status === "APPLIED_AS_EXPECTED" && t.notes === "לבדוק את הבס", r.e?.status);
    const id = Object.keys(h.w.tracks)[0];
    const u = await planAction({ intentHe: "הערה", actionId: "UPDATE_ALBUM_TRACK", args: { albumTrack: `album-track:${id}`, notes: "הבס תוקן" } }, OWNER, d);
    const ru = await approveExec(d, u);
    const v = await albumView(h.w);
    ok("D3. UPDATE_ALBUM_TRACK notes → verified → readable in album_view", ru.e?.status === "APPLIED_AS_EXPECTED" && v.albums[0].tracks[0].notes?.text === "הבס תוקן", ru.e?.status);
  }
  {
    const h = mk(); const { d } = mkDeps(h.writers);
    h.setDropNotes(true); // a writer that silently loses the notes
    const p = await planAction({ intentHe: "שיר", actionId: "ADD_ALBUM_TRACK", args: { project: P, title: "x", trackNumber: 1, notes: "חשוב" } }, OWNER, d);
    const r = await approveExec(d, p);
    ok("D4. verification now covers notes: a write that lost them is FAILED, never 'done'", r.e?.status === "FAILED" && (r.e?.steps as Array<{ status: string }>)[0].status === "FAILED", r.e?.status);
    const empty = await planAction({ intentHe: "שיר", actionId: "ADD_ALBUM_TRACK", args: { project: P, title: "y", trackNumber: 2, notes: "   " } }, OWNER, d);
    ok("D5. blank notes are simply not written (no refusal, no notes field)", empty.status === "PREVIEW" && !(empty.changes as Array<{ field: string }>).some((c) => c.field === "notes"), empty.status);
  }

  console.log("\nE. Plan size: 2–20 steps");
  {
    const h = mk(); const { d } = mkDeps(h.writers);
    const twenty = Array.from({ length: 20 }, (_, i) => ({ actionId: "ADD_ALBUM_TRACK", args: { project: P, title: `שיר ${i + 1}`, trackNumber: i + 1 } }));
    const p20 = await plan(d, twenty);
    ok("E1. MAX_WORKFLOW_STEPS = 20 and a 20-step plan is accepted", MAX_WORKFLOW_STEPS === 20 && p20.status === "PREVIEW" && (p20.steps as unknown[]).length === 20, p20.status);
    const p21 = await plan(d, [...twenty, { actionId: "ADD_ALBUM_TRACK", args: { project: P, title: "21", trackNumber: 21 } }]);
    ok("E2. 21 steps → refused", p21.status === "INVALID_INPUT", p21.status);
    const tool = ACT_TOOL_DEFINITIONS.find((x) => x.name === "partner_plan_action")!;
    ok("E3. the MCP tool schema advertises maxItems 20 and '2–20'", (tool.inputSchema.properties.steps as { maxItems: number }).maxItems === 20 && tool.description.includes("2–20"));
  }

  console.log("\nF. Connector rate limits — retryAfterSec, the blocking limiter named, a refused request costs nothing");
  {
    const t0 = 1_000_000_000;
    const L = new SlidingWindowLimiter([{ windowMs: 3_600_000, max: 40 }, { windowMs: 86_400_000, max: 150 }]);
    for (let i = 0; i < 40; i++) L.record("tok", t0 + i * 60_000); // 40 hits, one a minute
    const c = L.check("tok", t0 + 40 * 60_000);
    ok("F1. 41st action within the hour → refused with the REAL wait: until the oldest hit leaves the 60-min window (20 min)", !c.ok && Math.round((c as { retryAfterMs: number }).retryAfterMs / 60_000) === 20, c);
    ok("F2. check() never records: repeated refused checks do not extend the wait", (() => { for (let i = 0; i < 50; i++) L.check("tok", t0 + 40 * 60_000); const c2 = L.check("tok", t0 + 40 * 60_000); return !c2.ok && Math.round(c2.retryAfterMs / 60_000) === 20; })());
    ok("F3. exactly when the oldest hit leaves the window, one request is allowed again", L.check("tok", t0 + 3_600_000 + 1).ok);
    const G = new SlidingWindowLimiter([{ windowMs: 60_000, max: 30 }, { windowMs: 3_600_000, max: 300 }]);
    const A = new SlidingWindowLimiter([{ windowMs: 3_600_000, max: 40 }, { windowMs: 86_400_000, max: 150 }]);
    for (let i = 0; i < 40; i++) A.record("tok", t0 + i * 60_000);
    for (let i = 0; i < 5; i++) G.record("tok", t0 + 40 * 60_000 - 1000);
    const g1 = gate("tok", t0 + 40 * 60_000, [{ name: "GENERAL", limiter: G }, { name: "ACTION", limiter: A }]);
    ok("F4. action limit full, general free → ACTION named, retryAfterSec = 1201 (20 min: the oldest hit leaves the hour 1 ms after 60:00)", !g1.ok && g1.limiter === "ACTION" && g1.retryAfterSec === 1201, g1);
    for (let i = 0; i < 10; i++) gate("tok", t0 + 40 * 60_000, [{ name: "GENERAL", limiter: G }, { name: "ACTION", limiter: A }]); // 10 more refused
    let left = 0; while (G.check("tok", t0 + 40 * 60_000).ok && left < 99) { G.record("tok", t0 + 40 * 60_000); left++; }
    ok("F5. 11 requests refused by the ACTION limit spent NO general quota (25 of 30 general requests still left this minute)", left === 25, left);
    const G2 = new SlidingWindowLimiter([{ windowMs: 60_000, max: 30 }]); const A2 = new SlidingWindowLimiter([{ windowMs: 3_600_000, max: 40 }]);
    for (let i = 0; i < 30; i++) G2.record("tok", t0 + i * 1000);
    const g2 = gate("tok", t0 + 30_000, [{ name: "GENERAL", limiter: G2 }, { name: "ACTION", limiter: A2 }]);
    ok("F6. general limit full, action free → GENERAL named (never 'too many action requests'), wait from the minute window", !g2.ok && g2.limiter === "GENERAL" && g2.retryAfterSec === 31, g2);
    ok("F7. …and the refused request spent no ACTION quota", A2.check("tok", t0 + 30_000).ok && (() => { let n = 0; while (A2.check("tok", t0 + 30_000).ok && n < 100) { A2.record("tok", t0 + 30_000); n++; } return n === 40; })());
    const boom = { check() { throw new Error("x"); }, record() { throw new Error("x"); } } as unknown as SlidingWindowLimiter;
    ok("F8. fail-safe: a limiter that throws refuses the request (never a silent pass)", !gate("tok", t0, [{ name: "ACTION", limiter: boom }]).ok);
    const G3 = new SlidingWindowLimiter([{ windowMs: 60_000, max: 5 }]); const A3 = new SlidingWindowLimiter([{ windowMs: 60_000, max: 5 }]);
    ok("F9. an allowed request is counted in EVERY limiter it belongs to", gate("tok", t0, [{ name: "GENERAL", limiter: G3 }, { name: "ACTION", limiter: A3 }]).ok && (() => { let a = 0, b = 0; while (G3.check("tok", t0).ok && a < 9) { G3.record("tok", t0); a++; } while (A3.check("tok", t0).ok && b < 9) { A3.record("tok", t0); b++; } return a === 4 && b === 4; })());
  }
  {
    // through the REAL MCP handler (the relay to MAIN is a fake that counts)
    const base = { PARTNER_MCP_ENABLED: "true", PARTNER_MCP_BASE_URL: "https://c.example", PARTNER_MCP_SECRET: "m".repeat(64), REDBLOODS_MCP_ONLY: "true", PARTNER_MCP_ACT_ENABLED: "true", PARTNER_MAIN_BASE_URL: "https://main.example", PARTNER_INTERNAL_ACT_SECRET: "s".repeat(40) };
    const cfg = (readMcpConfig(base) as { config: McpDeps["config"] }).config;
    let clock = 5_000_000_000; const relayed: string[] = [];
    const general = new SlidingWindowLimiter(cfg.rateLimit), action = new SlidingWindowLimiter(cfg.actRateLimit);
    const deps: McpDeps = {
      config: cfg, authenticate: async () => ({ ok: true, principal: { tokenId: "t1", clientId: OWNER.clientId, userId: OWNER.ownerId, scope: "partner:read partner:act" } }),
      gateway: { brief: async () => ({}), resolve: async () => ({ status: "RESOLVED", candidates: [] }), entity: async () => ({}), query: async () => ({ status: "OK" }), capabilityIndex: () => [] },
      limiter: general, audit: async () => undefined, auditRejected: async () => undefined, nowMs: () => clock,
      act: { limiter: action, call: async (op: string) => { relayed.push(op); return { status: "PREVIEW" }; } },
    } as unknown as McpDeps;
    const call = async (name: string, args: unknown) => JSON.parse((await handleMcpHttp({ method: "POST", header: (n) => (n === "authorization" ? "Bearer x" : null), bodyText: async () => JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) }, deps)).body ?? "{}");
    const status = { planId: "pl_" + "q".repeat(18) };
    ok("F10. production ceilings unchanged: general 30/min + 300/h, action 40/h + 150/24h", JSON.stringify(cfg.rateLimit) === JSON.stringify([{ windowMs: 60_000, max: 30 }, { windowMs: 3_600_000, max: 300 }]) && JSON.stringify(cfg.actRateLimit) === JSON.stringify([{ windowMs: 3_600_000, max: 40 }, { windowMs: 86_400_000, max: 150 }]));
    for (let i = 0; i < 40; i++) { clock += 61_000; await call("partner_plan_status", status); }
    ok("F11. 40 action calls in the hour relayed", relayed.length === 40);
    clock += 1000;
    const limited = (await call("partner_plan_status", status)).result?.structuredContent;
    // 40 calls 61 s apart: the first leaves the hour at first + 3,600,000 ms + 1 → wait = 3,600,001 − (40 × 61,000 + 1,000 − 61,000) ms = 1,220,001 ms
    ok("F12. the 41st → RATE_LIMITED, limiter ACTION, retryAfterSec = 1221 (the exact wait of the hour window)", limited?.error === "RATE_LIMITED" && limited.limiter === "ACTION" && limited.retryAfterSec === 1221 && /action limit/.test(limited.message) && relayed.length === 40, limited);
    for (let i = 0; i < 5; i++) await call("partner_plan_status", status); // 5 more refused retries
    let readsOk = 0; for (let i = 0; i < 40; i++) { const r = await call("partner_resolve", { query: "אלבום" }); if (!r.result?.structuredContent?.error) readsOk++; }
    ok("F13. 6 refused action calls cost no general quota: exactly 29 reads fit this minute (30 − the 40th action call, 1 s ago)", readsOk === 29, readsOk);
    const gl = (await call("partner_resolve", { query: "אלבום" })).result?.structuredContent;
    ok("F14. a READ blocked by the general limit → names GENERAL (never 'too many action requests'), wait ≤ 60 s", gl?.error === "RATE_LIMITED" && gl.limiter === "GENERAL" && gl.retryAfterSec <= 60 && !/action limit/.test(gl.message), gl);
    const both = (await call("partner_plan_status", status)).result?.structuredContent;
    ok("F15. both limits full → the one that blocks LONGER is named (ACTION, ~21 min): the request can pass only when both allow", both?.limiter === "ACTION" && both.retryAfterSec >= 1200 && relayed.length === 40, both);
    clock += 1_221_000;
    const back = (await call("partner_plan_status", status)).result?.structuredContent;
    ok("F16. after exactly retryAfterSec the action call goes through (retries never extended the wait)", back?.status === "PREVIEW" && relayed.length === 41, back);
  }

  console.log("\nG. Sunny's contract + instructions say it (one plan per request, no plans in advance, AMBIGUOUS never bypassed)");
  {
    ok("G1. server instructions: ONE logical request = ONE plan, never one plan per item, no plans prepared in advance", /ONE logical request of the Boss = ONE plan/.test(SERVER_INSTRUCTIONS) && /do not prepare several plans in advance/.test(SERVER_INSTRUCTIONS));
    ok("G2. server instructions: AMBIGUOUS_OPEN_PREVIEWS is a safety refusal, never worked around; ASK — never guess", /AMBIGUOUS_OPEN_PREVIEWS is a safety refusal, never work around it/.test(SERVER_INSTRUCTIONS) && /ASK — never guess/.test(SERVER_INSTRUCTIONS));
    ok("G3. server instructions: steps of one plan never make each other STALE; STALE = a real outside change; RATE_LIMITED → retryAfterSec", /never make each other STALE/.test(SERVER_INSTRUCTIONS) && /retryAfterSec/.test(SERVER_INSTRUCTIONS));
    const m = JSON.stringify(SUNNY_CONNECTOR_MODEL);
    ok("G4. the connector contract no longer says actions are 'flag off / not wired'", !/not wired/.test(m) && !/action proposal \(off\)/.test(m));
    ok("G5. the connector contract documents the five action tools = the tools the connector declares", SUNNY_CONNECTOR_MODEL.actionTools.map((t) => t.tool).sort().join() === ACT_TOOL_DEFINITIONS.map((t) => t.name).sort().join());
    ok("G6. …2–20 steps, STALE vs self-change, the real limits, retryAfterSec, AMBIGUOUS fail-closed, no plans in advance", /2–20/.test(m) && /never make a later step STALE/.test(m) && /40\/h \+ 150\/24h/.test(m) && /30\/min \+ 300\/h/.test(m) && /retryAfterSec/.test(m) && /fail-closed/.test(m) && /never several in advance/.test(m));
    ok("G7. AMBIGUOUS stays fail-closed in the service (unchanged: newer open preview → refused, unknown → refused)", /if \(newer === "UNKNOWN"\) return refused\("AMBIGUITY_CHECK_FAILED"/.test(read("lib/partner/act/service.ts")) && /if \(newer\) return refused\("AMBIGUOUS_OPEN_PREVIEWS"/.test(read("lib/partner/act/service.ts")));
    ok("G8. the exclusion is by created id only (withExcluded filters similarRecords + albumTrackOrder by id)", /k === "albumTrackOrder"\) return async \(pid: string\) => \(await t\.albumTrackOrder\(pid\)\)\.filter\(\(r\) => !ex\.has\(String\(r\.id\)\)\)/.test(read("lib/partner/act/primitives/core.ts")));
  }
  {
    // AMBIGUOUS_OPEN_PREVIEWS: the older of two open plans cannot be approved (fail-closed), the newest can
    const h = mk(); const { d } = mkDeps(h.writers);
    let t = Date.parse("2026-09-27T09:00:00Z"); d.nowMs = () => t;
    const older = await planAction({ intentHe: "א", actionId: "ADD_ALBUM_TRACK", args: { project: P, title: "א", trackNumber: 1 } }, OWNER, d);
    t += 1000;
    const newer = await planAction({ intentHe: "ב", actionId: "ADD_ALBUM_TRACK", args: { project: P, title: "ב", trackNumber: 2 } }, OWNER, d);
    const a1 = await approveAction({ planId: older.planId, planHash: older.planHash, confirmationText: "מאשר" }, OWNER, d);
    const a2 = await approveAction({ planId: newer.planId, planHash: newer.planHash, confirmationText: "מאשר" }, OWNER, d);
    ok("G9. two open previews: approving the OLDER → AMBIGUOUS_OPEN_PREVIEWS (nothing approved); the newest → approved", a1.status === "AMBIGUOUS_OPEN_PREVIEWS" && a1.newerPlanId === newer.planId && a2.status === "APPROVED_PENDING_EXECUTION" && creates(h.calls) === 0, [a1.status, a2.status]);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
