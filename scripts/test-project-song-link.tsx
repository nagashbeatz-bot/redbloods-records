/**
 * Tests — song ↔ clip project link, P1 (projects.song_project_id; Owner decision 2026-09-29).
 *
 * Run with:   npx tsx scripts/test-project-song-link.tsx
 *
 * Proves: the application link rule (clip only, target a non-clip existing project, never self); the canonical relation
 * in both directions; Sunny reads it (project_view + the relationship graph) as CANONICAL and NEVER infers it from a name;
 * legacy parent_project still works as before (TEXT_MATCH); the Partner operations reader carries the column; the song
 * delete preview names the clips that lose their link; no Finance code reads the link (P1 changes no money). Pure.
 */
import fs from "node:fs";
import path from "node:path";
import { songClipRelations, validateSongLink } from "../lib/project-song-link";
import { buildProjectView, } from "../lib/partner/projects/view";
import { buildProjectSection } from "../lib/partner/projects/sections";
import { readOperationsRaw, type OperationsReadClient } from "../lib/partner/operations/readers";
import type { GatewaySources } from "../lib/partner/gateway/core";
import type { OperationsRaw, OpsProjectMeta } from "../lib/partner/operations/types";
import { PRIMITIVES_BY_ID } from "../lib/partner/act/primitives";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: unknown) => { if (cond) { console.log(`  ✓ ${name}`); pass++; } else { console.log(`  ✗ ${name}${detail === undefined ? "" : `\n      ${JSON.stringify(detail).slice(0, 700)}`}`); fail++; } };
const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const SONG = U(1), CLIP = U(2), CLIP2 = U(3), OTHER = U(4), NAME_ONLY = U(5), ALBUM = U(6);

const meta = (id: string, name: string, projectType: string, o: Partial<OpsProjectMeta> = {}): OpsProjectMeta => ({ id, name, status: "בעבודה", projectType, businessType: "לקוח", artistText: "אמן", deadline: null, startDate: null, endDate: null, parentProject: "ללא שיוך", isHidden: false, plannedHours: null, plannedDays: null, updatedAt: null, ...o });
const ROWS: OpsProjectMeta[] = [
  meta(SONG, "בלאגן", "שיר"),
  meta(CLIP, "בלאגן — קליפ", "קליפ", { songProjectId: SONG, parentProject: "בלאגן" }),
  meta(CLIP2, "בלאגן — טיזר", "קליפ", { songProjectId: SONG }),
  meta(OTHER, "שיר רגיל", "שיר"),
  // a clip whose parent TEXT equals a song name but has NO id link — must never become a canonical relation
  meta(NAME_ONLY, "יהלום — קליפ", "קליפ", { parentProject: "שיר רגיל" }),
  meta(ALBUM, "אלבום X", "אלבום"),
];
const src = (): GatewaySources => ({ now: new Date("2026-09-29T09:00:00Z"), identities: { cleantone: null }, operations: { status: "OK", value: { projectsMeta: { rows: ROWS, capped: false } } as unknown as OperationsRaw } });

async function main() {
  console.log("The link rule (application guard; P1 has no writer — every future writer must use it)");
  {
    const clip = { id: CLIP, projectType: "קליפ" }, song = { id: SONG, projectType: "שיר" };
    ok("a clip → an existing song: allowed (normalized id)", JSON.stringify(validateSongLink(clip, SONG.toUpperCase(), song)) === JSON.stringify({ ok: true, songProjectId: SONG }));
    ok("removing the link (null) is always allowed", validateSongLink(clip, null, null).ok === true);
    const codes = [
      validateSongLink(clip, CLIP, { id: CLIP, projectType: "קליפ" }),
      validateSongLink({ id: OTHER, projectType: "שיר" }, SONG, song),
      validateSongLink(clip, OTHER, null),
      validateSongLink(clip, CLIP2, { id: CLIP2, projectType: "קליפ" }),
      validateSongLink(clip, "not-a-uuid", null),
      validateSongLink(clip, SONG, { id: OTHER, projectType: "שיר" }),
    ].map((v) => (v.ok ? "OK" : v.code));
    ok("self / not a clip / song missing / target is a clip / bad id / another project read → refused", JSON.stringify(codes) === JSON.stringify(["SELF_LINK", "NOT_A_CLIP_PROJECT", "SONG_NOT_FOUND", "TARGET_IS_A_CLIP", "BAD_ID", "SONG_NOT_FOUND"]), codes);
  }

  console.log("\nThe relation, both directions, by id only");
  {
    const r = songClipRelations(CLIP, ROWS.map((x) => ({ ...x })));
    ok("a clip with song_project_id → its song", r.song?.id === SONG && r.clips.length === 0);
    const s = songClipRelations(SONG, ROWS);
    ok("the song → every clip linked to it (2)", JSON.stringify(s.clips.map((x) => x.id).sort()) === JSON.stringify([CLIP, CLIP2].sort()) && s.song === null);
    const n = songClipRelations(NAME_ONLY, ROWS), o = songClipRelations(OTHER, ROWS);
    ok("a parent NAME that equals a song never creates the relation (either side)", n.song === null && o.clips.length === 0);
  }

  console.log("\nSunny reads it (project_view + graph) — CANONICAL, never by name");
  {
    const vc = buildProjectView(src(), CLIP), vs = buildProjectView(src(), SONG), vo = buildProjectView(src(), OTHER), vn = buildProjectView(src(), NAME_ONLY);
    ok("clip: songProject = the song, CANONICAL_RELATION", vc.identity?.songProject?.quality === "CANONICAL_RELATION" && vc.identity?.songProject?.value.key === `project:${SONG}` && vc.identity?.songProject?.value.name === "בלאגן", vc.identity);
    ok("song: clipProjects = both clips, CANONICAL_RELATION", JSON.stringify(vs.identity?.clipProjects.map((c) => [c.quality, c.value.key]).sort()) === JSON.stringify([["CANONICAL_RELATION", `project:${CLIP}`], ["CANONICAL_RELATION", `project:${CLIP2}`]].sort()), vs.identity?.clipProjects);
    ok("a regular project: no song, no clips (unchanged)", vo.identity?.songProject === null && vo.identity?.clipProjects.length === 0);
    ok("name-only clip: NO songProject (the parent text stays TEXT_MATCH, legacy)", vn.identity?.songProject === null && vn.identity?.parentProject?.quality === "TEXT_MATCH" && vn.identity?.parentProject?.value === "שיר רגיל");
    ok("legacy parent_project on the linked clip still reads as TEXT_MATCH", vc.identity?.parentProject?.quality === "TEXT_MATCH" && vc.identity?.parentProject?.value === "בלאגן");
    const g = buildProjectSection(src(), CLIP, "graph");
    const gs = buildProjectSection(src(), SONG, "graph");
    const edges = (x: typeof g) => x.rows.map((r) => r.fields as { relation?: string; to?: string; quality?: string });
    ok("graph: clip → SONG_OF_CLIP (CANONICAL, traversable); song → 2 CLIP_PROJECT edges", edges(g).some((e) => e.relation === "SONG_OF_CLIP" && e.to === `project:${SONG}` && e.quality === "CANONICAL_RELATION") && edges(gs).filter((e) => e.relation === "CLIP_PROJECT" && e.quality === "CANONICAL_RELATION").length === 2, { g: edges(g), gs: edges(gs) });
    const gn = buildProjectSection(src(), NAME_ONLY, "graph");
    ok("graph of the name-only clip: no SONG_OF_CLIP; the parent stays a TEXT_MATCH edge", !edges(gn).some((e) => e.relation === "SONG_OF_CLIP") && edges(gn).some((e) => e.relation === "PARENT_PROJECT" && e.quality === "TEXT_MATCH"), edges(gn));
  }

  console.log("\nThe Partner operations reader carries the column");
  {
    const tables: Record<string, Array<Record<string, unknown>>> = { projects: [{ id: CLIP, name: "בלאגן — קליפ", status: "בעבודה", project_type: "קליפ", project_business_type: "לקוח", artist: "א", parent_project: "בלאגן", song_project_id: SONG, is_hidden: false }, { id: OTHER, name: "שיר רגיל", status: "בעבודה", project_type: "שיר", project_business_type: "לקוח", artist: "א", parent_project: "ללא שיוך", song_project_id: null, is_hidden: false }] };
    const selected: Record<string, string> = {};
    const q = (t: string): ReturnType<OperationsReadClient["from"]>["select"] extends (c: string) => infer R ? R : never => {
      const self = { range: () => self, like: () => self, in: () => self, then: (f: (v: { data: unknown[]; error: null }) => unknown) => Promise.resolve({ data: tables[t] ?? [], error: null }).then(f) };
      return self as never;
    };
    const client: OperationsReadClient = { from: (t: string) => ({ select: (cols: string) => { selected[t] = cols; return q(t); } }) };
    const raw = await readOperationsRaw(client);
    const rows = raw.projectsMeta?.rows ?? [];
    ok("reads song_project_id and maps it (null stays null)", /song_project_id/.test(selected.projects ?? "") && rows.find((r) => r.id === CLIP)?.songProjectId === SONG && rows.find((r) => r.id === OTHER)?.songProjectId === null, rows);
  }

  console.log("\nDeleting a song names the clips that lose their link");
  {
    const del = PRIMITIVES_BY_ID.get("DELETE_PROJECT")!;
    const base = { finalFilesBlocking: 0, sessions: 0, calendarEvents: 0, sendLog: 0, clipRows: 0, victorWorks: 0, settingsKeys: 0, coverCustomImage: 0, proposalFollowUpTasks: 0, engineerWorks: 0, mixVersions: 0, mixComments: 0, mixAttachments: 0, albumTracks: 0, releaseDetails: 0, openAlerts: 0, transactionsUnlinked: 0, sessionLinkedTransactions: 0, proposalsReset: 0, socialCampaignsUnlinked: 0, finalFilesUnlinked: 0, tasksKept: 0, meetingsKept: 0, productionsKept: 0, storageFolderKept: 0 };
    const w = (del.warnings?.({ ...base, name: "בלאגן", clipProjectsUnlinked: 2 } as never, {}) ?? []).join(" | ");
    const w0 = (del.warnings?.({ ...base, name: "שיר רגיל", clipProjectsUnlinked: 0 } as never, {}) ?? []).join(" | ");
    ok("2 linked clips → the preview says they stay but lose the link; 0 → nothing added", w.includes("2 פרויקטי קליפ") && !w0.includes("פרויקטי קליפ"), { w, w0 });
  }

  console.log("\nP1 changes no money");
  {
    const ROOT = path.resolve(__dirname, "..");
    const walk = (d: string): string[] => fs.readdirSync(path.join(ROOT, d), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith(".ts") ? [path.join(d, e.name)] : []));
    const money = [...walk("lib/finance"), ...walk("lib/partner/finance"), "lib/clip-finance.ts", "lib/clip-rf-money-pure.ts", "lib/business-unit.ts", "lib/records-expense-share.ts", "lib/writes/finance.ts", "lib/writes/clip.ts", "lib/partner/projects/money.ts"];
    const hits = money.filter((f) => /song_project_id|songProjectId|project-song-link/.test(fs.readFileSync(path.join(ROOT, f), "utf8")));
    ok("no Finance / money module reads the link", hits.length === 0, hits);
    ok("nothing writes song_project_id in P1 (no writer)", !walkAll(ROOT).some((f) => /song_project_id\s*:/.test(fs.readFileSync(f, "utf8")) && /\.(insert|update|upsert)\(/.test(fs.readFileSync(f, "utf8")) && !f.includes("scripts")));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}
function walkAll(root: string): string[] {
  const out: string[] = [];
  for (const d of ["lib", "app"]) {
    const rec = (p: string) => { for (const e of fs.readdirSync(p, { withFileTypes: true })) { const f = path.join(p, e.name); if (e.isDirectory()) rec(f); else if (/\.(ts|tsx)$/.test(e.name)) out.push(f); } };
    rec(path.join(root, d));
  }
  return out;
}
main().catch((e) => { console.error(e); process.exit(1); });
