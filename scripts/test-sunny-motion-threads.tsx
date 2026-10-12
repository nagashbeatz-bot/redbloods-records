/**
 * Sunny stage 4 (Owner-approved 2026-10-12) — BUSINESS THREADS in motion: presentation only, canonical links only.
 *
 *   • an artist whose release (label_artist_id, CANONICAL) already carries a MUST / SHOULD item joins THAT item — one
 *     thread, one move; his other free projects are context only (the 11.10 production case: אבי twice);
 *   • a clip project and its song (song_project_id, CANONICAL) are ONE thread — the stronger leads, the other joins with
 *     its reasons; with no item of its own, the related project is a context line;
 *   • a name / credit match (TEXT_MATCH) never joins a thread; each entity key is served once;
 *   • money never mixes: each project's money stays its own (no thread total, no currency sum); no record changes.
 * Pure, in-memory fixtures (the motion-company fixture). Run with:   npx tsx scripts/test-sunny-motion-threads.tsx
 */
import fs from "node:fs";
import path from "node:path";
import type { GatewaySources } from "../lib/partner/gateway/core";
import { buildCooView } from "../lib/partner/coo/priorities";
import { motionSummary, type BusinessMotion, type MotionItem } from "../lib/partner/coo/motion";
import { AVI_ARTIST_ID } from "../lib/roles";
import { src, K, P_LO, P_KESEF, P_YAHALOM, P_CLIP, P_TAS, type Fx } from "./fixtures/motion-company";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: unknown) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 700)}` : ""}`); } };
const section = (t: string) => console.log(`\n${t}`);
const ROOT = path.resolve(__dirname, "..");
const code = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const motionOf = (s: GatewaySources): BusinessMotion => buildCooView(s).motion;
const AVI = `label-artist:${AVI_ARTIST_ID}`;
const served = (m: BusinessMotion) => [...new Map([...m.todayItems, ...m.greeting, ...m.atRisk, ...m.closeLoops, ...m.label, ...m.watch].map((i) => [i.key, i])).values()];

/** The fixture with a CANONICAL song ↔ clip link (the clip project's song_project_id). */
function withSongClip(song: string, clip: string, fx: Fx = {}): GatewaySources {
  const s = src(fx) as unknown as { operations: { value: { projectsMeta: { rows: Array<Record<string, unknown>> } } } } & GatewaySources;
  const row = s.operations.value.projectsMeta.rows.find((r) => r.id === clip);
  if (row) row.songProjectId = song;
  return s;
}

async function main() {
  const M = motionOf(src());

  section("1. The artist's thread — אבי once, led by his release (label_artist_id, CANONICAL)");
  const lo = M.all.find((i) => i.entity === K(P_LO))!;
  ok("1a. the release item carries אבי as a CANONICAL ARTIST thread member", !!lo?.thread?.some((m) => m.entity === AVI && m.role === "ARTIST" && m.quality === "CANONICAL_RELATION"), lo?.thread);
  ok("1b. no separate artist item for אבי (never a second, competing move)", !M.all.some((i) => i.entity === AVI));
  ok("1c. his other free project ('כסף') is said as context in the thread — never its own served move", lo.reasonsHe.some((r) => r.includes("אבי מולה: זה הצעד שלו עכשיו") && r.includes("כסף")) && !served(M).some((i) => i.entity === K(P_KESEF)));
  ok("1d. the release keeps ITS move and draft (Victor notes), no 'סשן לכסף' added", lo.move?.draft?.actionId === "SEND_VICTOR_VERSION_NOTES" && !/לכסף/.test(lo.move?.he ?? ""), lo.move);
  ok("1e. the thread is LABEL work (the week line still names the protected artist's concrete move)", lo.sections.includes("LABEL") && lo.labelWork && M.label.some((i) => i.key === lo.key));
  const noRel = motionOf(src({ noWork: true }));
  ok("1f. no canonical release → the artist item stays as before (nothing invented)", !noRel.all.some((i) => i.thread?.some((m) => m.role === "ARTIST")));

  section("2. Song ↔ clip — ONE thread by song_project_id only");
  const S = motionOf(withSongClip(P_YAHALOM, P_CLIP));
  const y = S.all.find((i) => i.entity === K(P_YAHALOM) || i.thread?.some((m) => m.entity === K(P_YAHALOM)));
  const c = S.all.find((i) => i.entity === K(P_CLIP));
  const joined = (y && y.thread?.some((m) => m.entity === K(P_CLIP))) || (c && c.thread?.some((m) => m.entity === K(P_YAHALOM)));
  ok("2a. the song and its clip are ONE thread (CANONICAL member), never two unrelated items", !!joined, { y: y?.thread, c: c?.thread });
  ok("2b. the two project keys are never both served as separate items", !(served(S).some((i) => i.entity === K(P_YAHALOM)) && served(S).some((i) => i.entity === K(P_CLIP))));
  const plain = motionOf(src());
  const lead2 = [y, c].find((i) => i && (i.thread ?? []).some((m) => m.role === "CLIP" || m.role === "SONG"));
  const subItem = motionOf(src()).all.find((i) => i.entity === (lead2?.entity === K(P_YAHALOM) ? K(P_CLIP) : K(P_YAHALOM)));
  ok("2b2. a weaker member never adds its move to the lead (reasons only)", !lead2 || !subItem || subItem.level === lead2.level || !subItem.move || !(lead2.move?.he ?? "").includes(subItem.move.he), [lead2?.move?.he, subItem?.move?.he, subItem?.level, lead2?.level]);
  ok("2c. without song_project_id there is no song / clip thread (a similar name never joins)", !plain.all.some((i) => i.thread?.some((m) => m.role === "CLIP" || m.role === "SONG")));

  section("3. Never by text, never twice");
  ok("3a. every thread member is CANONICAL_RELATION (no TEXT_MATCH member exists)", M.all.concat(S.all).every((i) => (i.thread ?? []).every((m) => m.quality === "CANONICAL_RELATION")));
  ok("3b. 'טס' (credit 'טל צגאי' as text) is never pulled into another project's thread", !M.all.some((i) => i.entity !== K(P_TAS) && i.thread?.some((m) => m.entity === K(P_TAS))));
  for (const [name, m] of [["base", M], ["song+clip", S]] as const) {
    const prim = served(m).map((i) => i.entity).filter((e): e is string => !!e);
    ok(`3c. (${name}) each entity key is the primary of at most ONE served item`, prim.length === new Set(prim).size, prim);
    const inThreads = new Set(served(m).flatMap((i) => (i.thread ?? []).map((t) => t.entity)));
    ok(`3d. (${name}) an entity inside a thread is never also its own served item`, !served(m).some((i) => i.entity && inThreads.has(i.entity)), [...inThreads]);
  }

  section("4. Money never mixes; nothing changes");
  const fin = (m: BusinessMotion) => JSON.stringify([m.financial, m.revenue]);
  ok("4a. the money picture (financial forward + revenue) is identical with and without the thread link", fin(motionOf(src())) === fin(motionOf(withSongClip(P_YAHALOM, P_CLIP))));
  ok("4b. a thread carries no money total / currency sum (members are entity + role + note only)", S.all.every((i) => (i.thread ?? []).every((t) => Object.keys(t).sort().join(",") === "entity,noteHe,quality,role,titleHe")));
  ok("4c. financial items never join a thread", S.all.filter((i) => i.financial).every((i) => !i.thread?.length));
  const src4 = code(fs.readFileSync(path.join(ROOT, "lib/partner/coo/motion.ts"), "utf8"));
  ok("4d. motion still writes nothing (no write verbs / plan / push / fetch)", !/\.(insert|upsert|rpc)\(|planAction\(|sendPush|createEvent|fetch\(/.test(src4));

  section("5. The SAME object everywhere");
  const slim = motionSummary(M) as unknown as { todayItems: Array<{ entity: string | null; thread: unknown[] }> };
  ok("5a. partner_brief / coo / Dashboard V2 carry the thread (motionSummary)", slim.todayItems.some((i) => i.entity === K(P_LO) && Array.isArray(i.thread) && i.thread.length > 0));
  ok("5b. AGENTS.md carries the stage-4 contract", fs.readFileSync(path.join(ROOT, "AGENTS.md"), "utf8").includes("Stage 4 threads (Owner-approved 2026-10-12)"));

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
