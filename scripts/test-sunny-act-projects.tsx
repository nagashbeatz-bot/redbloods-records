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
import { businessTypeForNewProject, rosterIdByNameOf } from "../lib/project-classification";
import { SHALEV_ARTIST_ID } from "../lib/red-artists/portal-registry";
import { AVI_ARTIST_ID } from "../lib/roles";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: unknown) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 500)}` : ""}`); } };
const read = (p: string) => fs.readFileSync(path.resolve(__dirname, "..", p), "utf8");

interface P { deadline?: string | null; name: string; artist: string; status: string; isHidden: boolean; businessType: string; projectType: string; release: boolean; cover: { theme: string; customImage: boolean } | null; limit: number }
interface W { impact?: Record<string, number>; projects: Record<string, P>; artists: Record<string, { name: string; notes: string; status: string }>; clients: string[] }
const world = (): W => ({
  projects: { [U(1)]: { name: "קרוב אלייך", artist: "שליו", status: "בעבודה", isHidden: false, businessType: "לקוח", projectType: "שיר", release: false, cover: { theme: "black", customImage: true }, limit: 3, deadline: "2026-10-10" } },
  artists: { [U(50)]: { name: "שליו", notes: "", status: "פעיל" }, [SHALEV_ARTIST_ID]: { name: "שליו טסמה", notes: "", status: "פעיל" }, [AVI_ARTIST_ID]: { name: "אבי מולה", notes: "", status: "פעיל" }, [U(51)]: { name: "נגש ביטס", notes: "", status: "פעיל" } }, clients: ["שליו"],
});
function mk() {
  const w = world(); const calls: string[] = [];
  const roster = () => rosterIdByNameOf(Object.entries(w.artists).map(([id, a]) => ({ id, name: a.name })));
  const writers = {
    async projectDeleteImpact(id: string) { return { finalFilesBlocking: 0, sessions: 2, calendarEvents: 1, sendLog: 3, clipRows: 0, victorWorks: 1, settingsKeys: 3, coverCustomImage: 1, proposalFollowUpTasks: 1, engineerWorks: 1, mixVersions: 4, mixComments: 6, mixAttachments: 1, albumTracks: 0, releaseDetails: 0, openAlerts: 0, transactionsUnlinked: 4, sessionLinkedTransactions: 1, proposalsReset: 1, socialCampaignsUnlinked: 1, finalFilesUnlinked: 0, tasksKept: 2, meetingsKept: 0, productionsKept: 0, storageFolderKept: 1, ...(w.impact ?? {}), ...(id ? {} : {}) }; },
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
    // B2: the fake writer applies the SAME Owner rule function the real shared writer uses (roster = the fake world)
    async newProjectBusinessType(artist: string) { return businessTypeForNewProject(artist, roster()); },
    async createClientProject(f: { name: string; artist?: string; status?: string; projectType?: string }) { calls.push("createClientProject"); const id = U(100 + Object.keys(w.projects).length); w.projects[id] = { name: f.name, artist: f.artist ?? "", status: f.status ?? "לא התחיל", isHidden: false, businessType: businessTypeForNewProject(f.artist, roster()), projectType: f.projectType ?? "", release: false, cover: null, limit: 3 }; return id; },
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
    // B2 — the Owner classification rule on create (preview shows the type; the stored type matches; verify checks it)
    for (const [artist, want] of [["שליו טסמה", "לייבל"], ["רוני, שליו טסמה", "לייבל"], ["אבי מולה", "לייבל"], ["אבי מולה; מישהו", "לייבל"], ["נגש ביטס", "לקוח"], ["לקוח חיצוני", "לקוח"], ["שליו", "לקוח"]] as const) {
      const pv = await planAction({ intentHe: "x", actionId: "CREATE_PROJECT", args: { name: `B2 ${artist}`, artist } }, OWNER, mkDeps(mk().writers).d);
      ok(`B2 CREATE_PROJECT preview shows businessType ${want} for "${artist}"`, pv.status === "PREVIEW" && JSON.stringify(pv.preview).includes(`"businessType"`) && JSON.stringify(pv.preview).includes(want), pv.status === "PREVIEW" ? pv.preview : pv);
      const hh = mk(); const r2 = await fullFlow(mkDeps(hh.writers).d, "CREATE_PROJECT", { name: `B2 ${artist}`, artist }, "מאושר");
      ok(`B2 CREATE_PROJECT stores ${want} for "${artist}" and verifies`, r2.e?.status === "APPLIED_AS_EXPECTED" && Object.values(hh.w.projects).some((p) => p.name === `B2 ${artist}` && p.businessType === want), r2.e?.status);
    }
    const n = await planAction({ intentHe: "x", actionId: "UPDATE_PROJECT_STATUS", args: { project: `project:${U(1)}`, status: "בעבודה" } }, OWNER, mkDeps(mk().writers).d);
    ok("a change to the current value is refused (nothing to approve)", n.status === "NO_CHANGE_NEEDED");
    const c = await planAction({ intentHe: "x", actionId: "CONVERT_TO_LABEL_RELEASE", args: { project: `project:${U(1)}`, labelArtist: `label-artist:${U(50)}` } }, OWNER, mkDeps((() => { const x = mk(); x.w.projects[U(1)].projectType = "קליפ"; return x.writers; })()).d);
    ok("a non-releasable project type is refused with the app's own rule", c.status === "NOT_RELEASABLE");
  }
  console.log("\nShared writers (no divergence)");
  ok("the projects route uses the shared status / freeze helpers", /statusPatch\(/.test(read("app/api/projects/[id]/route.ts")) && /freezeFolderPatch\(/.test(read("app/api/projects/[id]/route.ts")));
  ok("the create-project route uses the shared writer", /createClientProject\(/.test(read("app/api/projects/route.ts")));
  ok("B2: the shared create writer applies the Owner rule (no hard-coded לקוח)", /newProjectBusinessType\(/.test(read("lib/writes/projects.ts")) && !/project_business_type: "לקוח"/.test(read("lib/writes/projects.ts")));
  ok("B2: proposal conversion applies the same Owner rule", /newProjectBusinessType\(/.test(read("lib/writes/proposals.ts")) && /project_business_type: businessType/.test(read("lib/writes/proposals.ts")));
  ok("the session-limit route uses the shared writer", /setSessionLimit\(/.test(read("app/api/sessions/route.ts")));
  console.log("\nProject delete (hardened)");
  const pd = read("lib/writes/project-delete.ts");
  ok("the delete route uses the shared writer", /deleteProjectCompletely\(id\)/.test(read("app/api/projects/[id]/route.ts")) && !/cleanupBeforeDelete/.test(read("app/api/projects/[id]/route.ts")));
  ok("every step is checked; the project row is deleted LAST", (pd.match(/ok\("/g) ?? []).length >= 7 && pd.lastIndexOf("deleteProject(projectId)") > pd.lastIndexOf('ok("agent_alerts")'));
  ok("Victor works go through the shared writer (their follow-up task goes too)", /removeVictorWork\(w\)/.test(pd) && !/from\("vendor_project_work"\)\.delete\(\)/.test(pd));
  const body = pd.slice(pd.indexOf("export async function deleteProjectCompletely"));
  const firstWrite = Math.min(...[".delete()", ".update(", "removeVictorWork(", "deleteTask("].map((x) => body.indexOf(x)).filter((i) => i >= 0));
  ok("A5 order: preflight FIRST, blocked → throw BEFORE any write", body.indexOf("projectDeletePreflight(") >= 0 && body.indexOf("projectDeletePreflight(") < body.indexOf("ProjectDeleteBlockedError(pre.blockers)") && body.indexOf("ProjectDeleteBlockedError(pre.blockers)") < firstWrite);
  ok("A5 order: a fresh blocker re-check sits immediately before the project row delete", body.lastIndexOf("blockingFinalFiles(projectId)") > body.lastIndexOf('ok("agent_alerts")') && body.lastIndexOf("blockingFinalFiles(projectId)") < body.indexOf("deleteProject(projectId)"));
  ok("A5 order: Google Calendar / Google Tasks / cover file only AFTER the project row (DB commit) and reported", ["deleteCalendarEvent", "deleteGoogleTask", "deleteProjectCoverFile"].every((x) => body.indexOf(x) > body.indexOf("deleteProject(projectId)")) && /external\.push\(/.test(body));
  ok("A5: every per-project settings family is cleaned", ["finance_", "delivery_", "project_cover_", "session_limit_", "album_finance_", "album_prev_info_", "steven_final_files_requested_project:"].every((k) => pd.includes(`"${k}"`)) && pd.includes('"steven_final_files_requested:"'));
  ok("A5: the route answers a blocked delete with 409 + the blockers", /status: 409/.test(read("app/api/projects/[id]/route.ts")) && /ProjectDeleteBlockedError/.test(read("app/api/projects/[id]/route.ts")));
  {
    const b = mk(); b.w.impact = { finalFilesBlocking: 2 };
    const r = await planAction({ intentHe: "x", actionId: "DELETE_PROJECT", args: { project: `project:${U(1)}` } }, OWNER, mkDeps(b.writers).d);
    ok("A5: Sunny's DELETE_PROJECT refuses BLOCKED_BY_DEPENDENTS (final files), nothing written", r.status === "BLOCKED_BY_DEPENDENTS" && JSON.stringify(r).includes("2") && b.calls.length === 0, r);
    const p = await planAction({ intentHe: "x", actionId: "DELETE_PROJECT", args: { project: `project:${U(1)}` } }, OWNER, mkDeps(mk().writers).d);
    ok("A5: the preview shows every count (cascade versions / comments, settings, unlinked campaigns, kept folder)", p.status === "PREVIEW" && ["4 גרסאות", "6 הערות", "3 הגדרות", "קמפייני סושיאל", "תיקיית הפרויקט"].every((x) => JSON.stringify(p).includes(x)), p);
  }
  ok("DELETE_PROJECT is C3 and previews the impact counts", ACTION_REGISTRY.get("DELETE_PROJECT")!.confirmation === "C3_STRONG_APPROVAL");

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
})();
