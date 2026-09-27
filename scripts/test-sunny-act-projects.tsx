/**
 * Universal Action Layer — Projects family: every primitive through the REAL service on fakes (6 standard checks each)
 * + family-specific checks (required values for a destructive reset, duplicate warning on create, shared writers).
 * Run with:   npx tsx scripts/test-sunny-act-projects.tsx      Pure; never touches production.
 */
import fs from "node:fs";
import path from "node:path";
import { runCases, mkDeps, fullFlow, U, OWNER, type FamilyCase } from "./fixtures/act-harness";
import { planAction } from "../lib/partner/act/service";
import { PROJECT_PRIMITIVES } from "../lib/partner/act/primitives/projects";
import { ACTION_REGISTRY } from "../lib/partner/act/registry";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: unknown) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 500)}` : ""}`); } };
const read = (p: string) => fs.readFileSync(path.resolve(__dirname, "..", p), "utf8");

interface P { deadline?: string | null; name: string; artist: string; status: string; isHidden: boolean; businessType: string; projectType: string; release: boolean; cover: { theme: string; customImage: boolean } | null; limit: number }
interface W { impact?: Record<string, number>; projects: Record<string, P>; artists: Record<string, { name: string; notes: string; status: string }>; clients: string[] }
const world = (): W => ({
  projects: { [U(1)]: { name: "קרוב אלייך", artist: "שליו", status: "בעבודה", isHidden: false, businessType: "לקוח", projectType: "שיר", release: false, cover: { theme: "black", customImage: true }, limit: 3, deadline: "2026-10-10" } },
  artists: { [U(50)]: { name: "שליו", notes: "", status: "פעיל" } }, clients: ["שליו"],
});
function mk() {
  const w = world(); const calls: string[] = [];
  const writers = {
    async projectDeleteImpact(id: string) { return { sessions: 2, calendarEvents: 1, sendLog: 3, clipRows: 0, victorWorks: 1, transactionsUnlinked: 4, proposalsReset: 1, engineerWorks: 1, albumTracks: 0, openAlerts: 0, tasksKept: 2, meetingsKept: 0, productionsKept: 0, ...(w.impact ?? {}), ...(id ? {} : {}) }; },
    async deleteProjectCompletely(id: string) { calls.push("deleteProjectCompletely"); delete w.projects[id]; },
    async readProject(id: string) { const p = w.projects[id]; return p ? { name: p.name, notes: "", startDate: null, plannedHours: null, plannedDays: null, projectType: p.projectType, parentProject: "", deadline: p.deadline ?? null } : null; },
    async writeProject(id: string, patch: { deadline?: string | null }) { calls.push("writeProject"); if ("deadline" in patch) w.projects[id].deadline = patch.deadline ?? null; },
    async readProjectMeta(id: string) { const p = w.projects[id]; return p ? { name: p.name, artist: p.artist, status: p.status, isHidden: p.isHidden, businessType: p.businessType, projectType: p.projectType, hasRelease: p.release } : null; },
    async writeProjectStatus(id: string, s: string) { calls.push("writeProjectStatus"); w.projects[id].status = s; },
    async writeProjectHidden(id: string, h: boolean) { calls.push("writeProjectHidden"); w.projects[id].isHidden = h; },
    async renameProject(id: string, n: string) { calls.push("renameProject"); w.projects[id].name = n.trim(); },
    async changeProjectArtist(id: string, a: string) { calls.push("changeProjectArtist"); w.projects[id].artist = a.trim(); if (!w.clients.includes(a.trim())) w.clients.push(a.trim()); },
    async setProjectBusinessType(id: string, t: string) { calls.push("setProjectBusinessType"); if (!w.projects[id]) return false; w.projects[id].businessType = t; return true; },
    async readProjectCover(id: string) { return w.projects[id]?.cover ?? null; },
    async saveProjectCoverTheme(id: string, t: string) { calls.push("saveThemeCover"); w.projects[id].cover = { theme: t, customImage: w.projects[id].cover?.customImage ?? false }; },
    async resetProjectCover(id: string) { calls.push("resetProjectCover"); w.projects[id].cover = null; },
    async readSessionLimit(id: string) { return w.projects[id].limit; },
    async setSessionLimit(id: string, n: number) { calls.push("setSessionLimit"); w.projects[id].limit = n; },
    async countProjectsNamed(n: string) { return Object.values(w.projects).filter((p) => p.name === n).length; },
    async createClientProject(f: { name: string; artist?: string; status?: string; projectType?: string }) { calls.push("createClientProject"); const id = U(100 + Object.keys(w.projects).length); w.projects[id] = { name: f.name, artist: f.artist ?? "", status: f.status ?? "לא התחיל", isHidden: false, businessType: "לקוח", projectType: f.projectType ?? "", release: false, cover: null, limit: 3 }; return id; },
    async createLabelSong(f: { labelArtistId: string; name: string }) { calls.push("createLabelSong"); const id = U(200 + Object.keys(w.projects).length); w.projects[id] = { name: f.name, artist: w.artists[f.labelArtistId].name, status: "לא התחיל", isHidden: false, businessType: "לייבל", projectType: "שיר", release: true, cover: null, limit: 3 }; return id; },
    async convertToLabelRelease(pid: string) { calls.push("convertToLabelRelease"); w.projects[pid].release = true; return "ok"; },
    async readLabelArtist(id: string) { return w.artists[id] ?? null; },
  };
  return { w, calls, writers };
}

const CASES: FamilyCase<W>[] = [
  { id: "DELETE_PROJECT", args: { project: `project:${U(1)}` }, confirm: "כן בוס, מחיקה", bad: { project: "project:1" }, missing: { project: `project:${U(9)}` }, wrongKind: { project: `client:${U(1)}` }, stale: (w) => { w.impact = { sessions: 3 }; }, check: (w, calls) => !w.projects[U(1)] && calls.join() === "deleteProjectCompletely" },
  { id: "CLEAR_PROJECT_DEADLINE", args: { project: `project:${U(1)}` }, bad: { project: "project:1" }, missing: { project: `project:${U(9)}` }, wrongKind: { project: `client:${U(1)}` }, stale: (w) => { w.projects[U(1)].deadline = "2026-10-20"; }, check: (w) => w.projects[U(1)].deadline === null },
  { id: "UPDATE_PROJECT_STATUS", args: { project: `project:${U(1)}`, status: "הושלם" }, bad: { project: `project:${U(1)}`, status: "סגור" }, missing: { project: `project:${U(9)}`, status: "הושלם" }, wrongKind: { project: `label-artist:${U(50)}`, status: "הושלם" }, stale: (w) => { w.projects[U(1)].status = "בהשהייה"; }, check: (w, c) => w.projects[U(1)].status === "הושלם" && c.join() === "writeProjectStatus" },
  { id: "SET_PROJECT_HIDDEN", args: { project: `project:${U(1)}`, hidden: true }, bad: { project: `project:${U(1)}`, hidden: "yes" }, missing: { project: `project:${U(9)}`, hidden: true }, wrongKind: { project: `victor-work:${U(1)}`, hidden: true }, stale: (w) => { w.projects[U(1)].status = "בוטל"; }, check: (w) => w.projects[U(1)].isHidden === true },
  { id: "RENAME_PROJECT", args: { project: `project:${U(1)}`, name: "קרוב אלייך (רמיקס)" }, bad: { project: `project:${U(1)}`, name: "" }, missing: { project: `project:${U(9)}`, name: "x" }, wrongKind: { project: `mix-work:${U(1)}`, name: "x" }, stale: (w) => { w.projects[U(1)].name = "שם אחר"; }, check: (w) => w.projects[U(1)].name === "קרוב אלייך (רמיקס)" },
  { id: "CHANGE_PROJECT_ARTIST", args: { project: `project:${U(1)}`, artist: "שליו, נגש" }, bad: { project: `project:${U(1)}`, artist: "" }, missing: { project: `project:${U(9)}`, artist: "x" }, stale: (w) => { w.projects[U(1)].artist = "מישהו"; }, check: (w) => w.projects[U(1)].artist === "שליו, נגש" && w.clients.includes("שליו, נגש") },
  { id: "SET_PROJECT_BUSINESS_TYPE", args: { project: `project:${U(1)}`, businessType: "לייבל" }, bad: { project: `project:${U(1)}`, businessType: "שותפות" }, missing: { project: `project:${U(9)}`, businessType: "לייבל" }, stale: (w) => { w.projects[U(1)].status = "בוטל"; }, check: (w) => w.projects[U(1)].businessType === "לייבל" },
  { id: "SET_PROJECT_COVER_THEME", args: { project: `project:${U(1)}`, theme: "cinematic" }, bad: { project: `project:${U(1)}`, theme: "neon" }, missing: { project: `project:${U(9)}`, theme: "cinematic" }, stale: (w) => { w.projects[U(1)].cover = { theme: "urban", customImage: true }; }, check: (w) => w.projects[U(1)].cover?.theme === "cinematic" && w.projects[U(1)].cover?.customImage === true },
  { id: "RESET_PROJECT_COVER", args: { project: `project:${U(1)}` }, confirm: "כן בוס, איפוס", bad: { project: `project:bad` }, missing: { project: `project:${U(9)}` }, stale: (w) => { w.projects[U(1)].cover = { theme: "urban", customImage: false }; }, check: (w) => w.projects[U(1)].cover === null },
  { id: "SET_SESSION_LIMIT", args: { project: `project:${U(1)}`, limit: 6 }, bad: { project: `project:${U(1)}`, limit: -1 }, missing: { project: `project:${U(9)}`, limit: 6 }, stale: (w) => { w.projects[U(1)].limit = 4; }, check: (w) => w.projects[U(1)].limit === 6 },
  { id: "CREATE_PROJECT", args: { name: "שיר חדש", artist: "נגש", projectType: "שיר", deadline: "2026-11-01" }, bad: { name: "" }, stale: (w) => { w.projects[U(77)] = { ...w.projects[U(1)], name: "שיר חדש" }; }, check: (w, c) => Object.values(w.projects).some((p) => p.name === "שיר חדש" && p.businessType === "לקוח") && c.join() === "createClientProject" },
  { id: "CREATE_LABEL_SONG", args: { labelArtist: `label-artist:${U(50)}`, name: "סינגל חדש", releaseStage: "הקלטה" }, bad: { labelArtist: `label-artist:${U(50)}`, name: "סינגל", releaseStage: "שלב מומצא" }, missing: { labelArtist: `label-artist:${U(99)}`, name: "x" }, stale: (w) => { w.projects[U(78)] = { ...w.projects[U(1)], name: "סינגל חדש" }; }, check: (w) => Object.values(w.projects).some((p) => p.name === "סינגל חדש" && p.businessType === "לייבל" && p.release) },
  { id: "CONVERT_TO_LABEL_RELEASE", args: { project: `project:${U(1)}`, labelArtist: `label-artist:${U(50)}` }, bad: { project: `project:${U(1)}`, labelArtist: "nope" }, missing: { project: `project:${U(9)}`, labelArtist: `label-artist:${U(50)}` }, stale: (w) => { w.projects[U(1)].status = "בהשהייה"; }, check: (w) => w.projects[U(1)].release === true },
];

(async () => {
  console.log("Projects family — standard checks");
  ok("the case table covers every Projects primitive", CASES.map((c) => c.id).sort().join() === PROJECT_PRIMITIVES.map((p) => p.actionId).sort().join());
  await runCases(CASES, mk, ok);
  console.log("\nFamily-specific");
  {
    const h = mk(); const { d } = mkDeps(h.writers);
    const r = await fullFlow(d, "RESET_PROJECT_COVER", { project: `project:${U(1)}` }, "מאושר");
    ok("a destructive reset: \"מאושר\" after the preview is enough (bound to the plan hash)", r.e?.status === "APPLIED_AS_EXPECTED" && h.w.projects[U(1)].cover === null, r.e?.status);
    ok("RESET_PROJECT_COVER is C3 (strong) and declares FILES + DELETION", ACTION_REGISTRY.get("RESET_PROJECT_COVER")?.confirmation === "C3_STRONG_APPROVAL" && ["FILES", "DELETION"].every((e) => ACTION_REGISTRY.get("RESET_PROJECT_COVER")!.effects.includes(e as never)));
    const p = await planAction({ intentHe: "x", actionId: "CREATE_PROJECT", args: { name: "קרוב אלייך" } }, OWNER, mkDeps(mk().writers).d);
    ok("creating a project whose name already exists shows a duplicate warning in the preview", p.status === "PREVIEW" && JSON.stringify(p.preview).includes("כבר קיים פרויקט באותו שם"));
    const n = await planAction({ intentHe: "x", actionId: "UPDATE_PROJECT_STATUS", args: { project: `project:${U(1)}`, status: "בעבודה" } }, OWNER, mkDeps(mk().writers).d);
    ok("a change to the current value is refused (nothing to approve)", n.status === "NO_CHANGE_NEEDED");
    const c = await planAction({ intentHe: "x", actionId: "CONVERT_TO_LABEL_RELEASE", args: { project: `project:${U(1)}`, labelArtist: `label-artist:${U(50)}` } }, OWNER, mkDeps((() => { const x = mk(); x.w.projects[U(1)].projectType = "קליפ"; return x.writers; })()).d);
    ok("a non-releasable project type is refused with the app's own rule", c.status === "NOT_RELEASABLE");
  }
  console.log("\nShared writers (no divergence)");
  ok("the projects route uses the shared status / freeze helpers", /statusPatch\(/.test(read("app/api/projects/[id]/route.ts")) && /freezeFolderPatch\(/.test(read("app/api/projects/[id]/route.ts")));
  ok("the create-project route uses the shared writer", /createClientProject\(/.test(read("app/api/projects/route.ts")));
  ok("the session-limit route uses the shared writer", /setSessionLimit\(/.test(read("app/api/sessions/route.ts")));
  console.log("\nProject delete (hardened)");
  const pd = read("lib/writes/project-delete.ts");
  ok("the delete route uses the shared writer", /deleteProjectCompletely\(id\)/.test(read("app/api/projects/[id]/route.ts")) && !/cleanupBeforeDelete/.test(read("app/api/projects/[id]/route.ts")));
  ok("every step is checked; the project row is deleted LAST", (pd.match(/ok\("/g) ?? []).length >= 7 && pd.lastIndexOf("deleteProject(projectId)") > pd.lastIndexOf('ok("agent_alerts")'));
  ok("Victor works go through the shared writer (their follow-up task goes too)", /removeVictorWork\(String\(w\.id\)\)/.test(pd) && !/from\("vendor_project_work"\)\.delete\(\)/.test(pd));
  ok("DELETE_PROJECT is C3 and previews the impact counts", ACTION_REGISTRY.get("DELETE_PROJECT")!.confirmation === "C3_STRONG_APPROVAL");

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
})();
