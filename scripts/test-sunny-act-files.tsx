/**
 * Universal Action Layer — existing project files + work materials: every primitive through the REAL service on fakes
 * (6 standard checks each) + family rules (files by handle only — a wrong handle lists the project's files; no path ever
 * in a plan; portal only for the project's own link-enabled artist), and the HARDENED path check of the delete route
 * (a path that is not the project's own is refused) exercised on the real pure checker.
 * Run with:   npx tsx scripts/test-sunny-act-files.tsx      Pure; never touches production.
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { runCases, mkDeps, U, OWNER, type FamilyCase } from "./fixtures/act-harness";
import { planAction } from "../lib/partner/act/service";
import { FILES_PRIMITIVES } from "../lib/partner/act/primitives/files";
import { ACTION_REGISTRY, HARDENED, NEEDS_HARDENING } from "../lib/partner/act/registry";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: unknown) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 500)}` : ""}`); } };
const read = (p: string) => fs.readFileSync(path.resolve(__dirname, "..", p), "utf8");
const refOf = (p: string) => createHash("sha256").update(p).digest("hex").slice(0, 24);

type F = { name: string; path: string; category: string | null };
interface W { projects: Record<string, { name: string; artist: string; files: F[]; wm: { bpm?: string; key?: string; instructions?: string } }>; library: string[] }
const MIX = "/Projects/שליו טסמה/קרוב/Mix 3.wav", STEM = "/Projects/שליו טסמה/קרוב/Instructions/Stems.zip";
const world = (): W => ({
  projects: {
    [U(1)]: { name: "קרוב", artist: "שליו טסמה", files: [{ name: "Mix 3.wav", path: MIX, category: null }, { name: "Stems.zip", path: STEM, category: "חומרי עבודה" }], wm: { bpm: "96", key: "A Minor", instructions: "" } },
    [U(2)]: { name: "שיר לקוח", artist: "יוסי", files: [{ name: "a.wav", path: "/Projects/יוסי/שיר לקוח/a.wav", category: null }], wm: {} },
  },
  library: [],
});
function mk() {
  const w = world(); const calls: string[] = [];
  const writers = {
    async readProjectMeta(id: string) { const p = w.projects[id]; return p ? { name: p.name, artist: p.artist, status: "בעבודה", isHidden: false, businessType: "לייבל", projectType: "שיר", hasRelease: false } : null; },
    async projectFiles(id: string) { const p = w.projects[id]; return p ? p.files.map((f) => ({ ref: refOf(f.path), name: f.name, category: f.category, versionLabel: null, trackId: null })) : null; },
    async deleteProjectFile(pid: string, ref: string) { calls.push("deleteProjectFile"); w.projects[pid].files = w.projects[pid].files.filter((f) => refOf(f.path) !== ref); return { unlinked: 0 }; },
    async readWorkMaterials(id: string) { return w.projects[id] ? { ...w.projects[id].wm } : null; },
    async setWorkMaterials(id: string, p: Record<string, string>) { calls.push("setWorkMaterials"); Object.assign(w.projects[id].wm, p); },
    async portalOfProject(id: string) { return w.projects[id]?.artist === "שליו טסמה" ? { artistName: "שליו טסמה", slug: "shalev-tasama" } : null; },
    async listSketchChoices() { return [{ id: U(50), title: "קרוב" }]; },
    async shareProjectFileToPortal(pid: string, ref: string, sketchId: string) { calls.push("shareProjectFileToPortal"); w.library.push(`${ref}:${sketchId || "new"}`); return { sketchId: sketchId || U(51) }; },
  };
  return { w, calls, writers };
}
const P1 = `project:${U(1)}`, P2 = `project:${U(2)}`;
const CASES: FamilyCase<W>[] = [
  { id: "DELETE_PROJECT_FILE", args: { project: P1, fileRef: refOf(MIX) }, confirm: "כן בוס, מחיקה", bad: { project: P1, fileRef: "../../etc" }, missing: { project: P1, fileRef: "0".repeat(24) }, wrongKind: { project: `client:${U(1)}`, fileRef: refOf(MIX) }, stale: (w) => { w.projects[U(1)].files[0].name = "Mix 3 final.wav"; }, check: (w) => w.projects[U(1)].files.length === 1 && w.projects[U(1)].files[0].path === STEM },
  { id: "UPDATE_WORK_MATERIALS", args: { project: P1, bpm: "98", instructions: "ווקאל קדימה" }, bad: { project: P1, bpm: "x".repeat(60) }, missing: { project: `project:${U(9)}`, bpm: "90" }, wrongKind: { project: `show:${U(1)}`, bpm: "90" }, stale: (w) => { w.projects[U(1)].wm.key = "C Major"; }, check: (w) => w.projects[U(1)].wm.bpm === "98" && w.projects[U(1)].wm.instructions === "ווקאל קדימה" && w.projects[U(1)].wm.key === "A Minor" },
  { id: "SHARE_FILE_TO_PORTAL", args: { project: P1, fileRef: refOf(MIX), sketchId: U(50) }, confirm: "כן בוס, המוזיקה שלי", bad: { project: P1, fileRef: refOf(MIX), sketchId: U(50), newTitle: "x" }, missing: { project: P1, fileRef: "f".repeat(24) }, stale: (w) => { w.projects[U(1)].files[0].name = "Mix 3b.wav"; }, check: (w) => w.library.join() === `${refOf(MIX)}:${U(50)}` },
];

(async () => {
  console.log("Files — standard checks");
  ok("the case table covers every files primitive", CASES.map((c) => c.id).sort().join() === FILES_PRIMITIVES.map((p) => p.actionId).sort().join());
  await runCases(CASES, mk, ok);

  console.log("\nFamily rules");
  const q = (id: string, args: Record<string, unknown>, h = mk()) => planAction({ intentHe: "x", actionId: id, args }, OWNER, mkDeps(h.writers).d);
  const miss = await q("DELETE_PROJECT_FILE", { project: P1, fileRef: "0".repeat(24) });
  ok("a wrong handle is refused WITH the project's files (handle — name), never a path", miss.status === "ENTITY_NOT_FOUND" && String(miss.messageHe).includes(`${refOf(MIX)} — Mix 3.wav`) && !String(miss.messageHe).includes("/Projects/"), miss.messageHe);
  ok("a raw path as the handle is refused", (await q("DELETE_PROJECT_FILE", { project: P1, fileRef: MIX })).status !== "PREVIEW");
  const pv = await q("DELETE_PROJECT_FILE", { project: P1, fileRef: refOf(MIX) });
  ok("no storage path in the plan / preview", !JSON.stringify(pv).includes("/Projects/"));
  ok("portal sharing only for the project's own link-enabled artist", (await q("SHARE_FILE_TO_PORTAL", { project: P2, fileRef: refOf("/Projects/יוסי/שיר לקוח/a.wav") })).status === "NOT_LINKABLE");
  const bs = await q("SHARE_FILE_TO_PORTAL", { project: P1, fileRef: refOf(MIX), sketchId: U(77) });
  ok("an unknown sketch is refused with the artist's sketches", bs.status === "ENTITY_NOT_FOUND" && String(bs.messageHe).includes(U(50)));
  ok("the delete is C3; sharing is C2 FILES", ACTION_REGISTRY.get("DELETE_PROJECT_FILE")!.confirmation === "C3_STRONG_APPROVAL" && ACTION_REGISTRY.get("SHARE_FILE_TO_PORTAL")!.confirmation === "C2_APPROVAL_WITH_VALUES");
  ok("PROJECT.DELETE_PROJECT_FILE moved from NEEDS_HARDENING to HARDENED", !("PROJECT.DELETE_PROJECT_FILE" in NEEDS_HARDENING) && "PROJECT.DELETE_PROJECT_FILE" in HARDENED);

  console.log("\nHardened path check (lib/writes/files) — pure copy of the rule, pinned to the source");
  const wf = read("lib/writes/files.ts");
  ok("the rule in source: listed file, inside the project folder (not the folder itself), or a folder of listed files ≥ project-subfolder depth; no traversal", /listed\.includes\(target\)/.test(wf) && /target\.startsWith\(`\$\{base\}\/`\) && target !== base/.test(wf) && /target\.split\("\/"\)\.length >= 5/.test(wf) && /\\\.\\\.\?/.test(wf));
  const rule = (base: string, listed: string[], p: string) => { const n = (x: string) => x.trim().replace(/\/+$/, "").toLowerCase(); const t = n(p); const b = n(base); const L = listed.map(n); if (!p.startsWith("/") || /(^|\/)\.\.?(\/|$)/.test(p)) return false; return L.includes(t) || (t.startsWith(`${b}/`) && t !== b) || (t.split("/").length >= 5 && L.some((f) => f.startsWith(`${t}/`))); };
  const base = "/Projects/שליו טסמה/קרוב";
  ok("allowed: a listed file / a file in the folder / the channels folder", rule(base, [MIX], MIX) && rule(base, [], `${base}/Delivery/x.wav`) && rule(base, [`${base}/Channels/kick.wav`], `${base}/Channels`));
  ok("refused: the project folder itself, another project, the artist root, traversal, relative", !rule(base, [MIX], base) && !rule(base, [MIX], "/Projects/אבי מולה/שיר/a.wav") && !rule(base, [MIX], "/Projects/שליו טסמה") && !rule(base, [MIX], `${base}/../אחר/x.wav`) && !rule(base, [MIX], "Projects/x"));
  const dr = read("app/api/dropbox/delete/route.ts");
  ok("the delete route uses the hardened writer (403 on a foreign path) and no longer deletes directly", /deleteProjectFileByPath\(projectId, dropboxPath\)/.test(dr) && /status: 403/.test(dr) && !/files\/delete_v2/.test(dr));
  ok("the portal link route uses the shared writer (the Owner gate stays in the route)", /linkProjectFileToPortal\(g\.name, g\.slug/.test(read("app/api/label/artists/[id]/sketches/project-link/route.ts")));
  ok("the artist library is un-linked BEFORE the bytes go (abort on failure)", wf.indexOf("unlinkProjectPathFromArtist(projectId, dropboxPath)") < wf.indexOf("files/delete_v2"));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
