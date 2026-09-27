/**
 * Universal Action Layer — company-wide backfills: every primitive through the REAL service on fakes (standard checks)
 * + family rules (the exact set is fingerprinted — a new candidate before execution is STALE; nothing to do → refused;
 * BULK C3 with "עדכון גורף"; no path in any plan) and the shared writers the backfill routes use (guarded writes).
 * Run with:   npx tsx scripts/test-sunny-act-backfills.tsx      Pure; never touches production.
 */
import fs from "node:fs";
import path from "node:path";
import { runCases, mkDeps, fullFlow, U, OWNER, type FamilyCase } from "./fixtures/act-harness";
import { planAction } from "../lib/partner/act/service";
import { BACKFILL_PRIMITIVES } from "../lib/partner/act/primitives/backfills";
import { ACTION_REGISTRY } from "../lib/partner/act/registry";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: unknown) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 500)}` : ""}`); } };
const read = (p: string) => fs.readFileSync(path.resolve(__dirname, "..", p), "utf8");

interface W { projects: Array<{ id: string; name: string; start: string | null; firstSession: string | null; artist: string; folder: string | null }>; clients: string[] }
const world = (): W => ({
  projects: [
    { id: U(1), name: "קרוב", start: null, firstSession: "2026-03-01", artist: "שליו טסמה", folder: null },
    { id: U(2), name: "אלבום", start: "2026-01-01", firstSession: "2025-12-01", artist: "אבי מולה, שליו טסמה", folder: "/Projects/אבי מולה/אלבום" },
    { id: U(3), name: "בלי סשנים", start: null, firstSession: null, artist: "לקוח חדש", folder: null },
  ],
  clients: ["שליו טסמה"],
});
function mk() {
  const w = world(); const calls: string[] = [];
  const names = () => Array.from(new Set(w.projects.flatMap((p) => p.artist.split(/[,،;]/).map((x) => x.trim()).filter(Boolean))));
  const writers = {
    async startDatePlan() { const c = w.projects.filter((p) => !p.start); return { rows: c.filter((p) => p.firstSession).map((p) => ({ projectId: p.id, name: p.name, date: p.firstSession! })), withoutSessions: c.filter((p) => !p.firstSession).length }; },
    async applyStartDatesNow() { calls.push("applyStartDatesNow"); let n = 0; for (const p of w.projects) if (!p.start && p.firstSession) { p.start = p.firstSession; n++; } return { updated: n, failed: 0 }; },
    async missingArtistClients() { const all = names(); return { all: all.length, missing: all.filter((n) => !w.clients.includes(n)) }; },
    async createMissingArtistClients() { calls.push("createMissingArtistClients"); const m = names().filter((n) => !w.clients.includes(n)); w.clients.push(...m); return m.length; },
    async folderFreezeCandidates() { return w.projects.filter((p) => !p.folder).map((p) => ({ id: p.id, name: p.name })); },
    async applyFolderFreezeNow() { calls.push("applyFolderFreezeNow"); let n = 0; for (const p of w.projects) if (!p.folder) { p.folder = `/Projects/${p.artist}/${p.name}`; n++; } return { applied: n, failed: 0 }; },
  };
  return { w, calls, writers };
}
const C = "כן בוס, עדכון גורף";
const CASES: FamilyCase<W>[] = [
  { id: "BACKFILL_PROJECT_START_DATES", args: {}, confirm: C, bad: { force: true }, stale: (w) => { w.projects[2].firstSession = "2026-04-01"; }, check: (w) => w.projects[0].start === "2026-03-01" && w.projects[1].start === "2026-01-01" && w.projects[2].start === null },
  { id: "CREATE_MISSING_ARTIST_CLIENTS", args: {}, confirm: C, bad: { force: true }, stale: (w) => { w.projects.push({ id: U(4), name: "x", start: null, firstSession: null, artist: "אמן נוסף", folder: "f" }); }, check: (w) => ["אבי מולה", "לקוח חדש"].every((n) => w.clients.includes(n)) && w.clients.filter((n) => n === "שליו טסמה").length === 1 },
  { id: "FREEZE_PROJECT_FOLDERS", args: {}, confirm: C, bad: { force: true }, stale: (w) => { w.projects[1].folder = null; }, check: (w) => w.projects.every((p) => !!p.folder) && w.projects[1].folder === "/Projects/אבי מולה/אלבום" },
];

(async () => {
  console.log("Backfills — standard checks");
  ok("the case table covers every backfill primitive", CASES.map((c) => c.id).sort().join() === BACKFILL_PRIMITIVES.map((p) => p.actionId).sort().join());
  await runCases(CASES, mk, ok);

  console.log("\nFamily rules");
  const q = (id: string, h = mk()) => planAction({ intentHe: "x", actionId: id, args: {} }, OWNER, mkDeps(h.writers).d);
  const done = mk(); done.w.projects.forEach((p) => { p.start = p.start ?? "2026-01-01"; p.folder = p.folder ?? "f"; }); done.w.clients.push("אבי מולה", "לקוח חדש");
  ok("nothing to do → refused (no empty bulk plan)", (await Promise.all(BACKFILL_PRIMITIVES.map((p) => q(p.actionId, done)))).every((r) => r.status === "NO_CHANGE_NEEDED"));
  const m = mk(); const r = await fullFlow(mkDeps(m.writers).d, "CREATE_MISSING_ARTIST_CLIENTS", {}, "מאשר");
  ok("a bulk write: the preview names the exact set; a plain \"מאשר\" approves that exact set (no repeated words, 2026-09-27)", JSON.stringify(r.p).includes("עדכון גורף") && r.e?.status === "APPLIED_AS_EXPECTED", r.e?.status);
  const pv = await q("BACKFILL_PROJECT_START_DATES");
  ok("the preview lists exactly what will change (project → date) and the ones left alone", JSON.stringify(pv).includes("קרוב → 2026-03-01") && !JSON.stringify(pv).includes("אלבום → "));
  ok("no storage path in the folder-freeze plan", !JSON.stringify(await q("FREEZE_PROJECT_FOLDERS")).includes("/Projects/"));
  ok("all three are BULK C3", BACKFILL_PRIMITIVES.every((p) => ACTION_REGISTRY.get(p.actionId)!.confirmation === "C3_STRONG_APPROVAL" && p.meta.riskClass === "BULK"));

  console.log("\nShared writers");
  const wb = read("lib/writes/backfills.ts");
  ok("guarded writes: start date only while NULL, folder only while NULL, clients re-checked before insert", /\.is\("start_date", null\)/.test(wb) && /\.is\("dropbox_folder", null\)/.test(wb) && /filter\(\(n\) => !have\.has\(n\)\)/.test(wb));
  ok("the three backfill routes use the shared writers", /applyStartDates\(/.test(read("app/api/projects/backfill-start-dates/route.ts")) && /createArtistClients\(/.test(read("app/api/projects/sync-artists/route.ts")) && /applyFolderFreeze\(/.test(read("app/api/projects/backfill-dropbox-folder/route.ts")));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
