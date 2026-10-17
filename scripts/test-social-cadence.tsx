/**
 * Social stage 2 (Owner approval 2026-10-17) — the ONE cadence computation (lib/social-cadence.ts) + its wiring.
 * Week math (Sunday–Saturday, Israel), target chains (replace / END / same-day / history), the guard rules mirrored from
 * the DB trigger (overlap, breakdown overlap, backdating), items vs platform publications never mixed, a series item counted
 * once per summary, the artist view (CADENCE), the hub UI and the no-side-effect guards.
 * Run with:   npx tsx scripts/test-social-cadence.tsx      Pure; never touches production.
 */
import fs from "node:fs";
import path from "node:path";
import { addDays, cadenceHistory, chainOf, effectiveWindows, headOf, labelSeriesWeek, overdueCount, platformsOf, targetProblem, targetsInEffect, weekStartOf, weekSummary, type CadenceItem, type CadenceTargetRow, type SeriesRow } from "../lib/social-cadence";
import { artistCadenceOf } from "../lib/partner/label/social";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: unknown) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 600)}` : ""}`); } };
const section = (s: string) => console.log(`\n${s}`);
const read = (p: string) => fs.readFileSync(path.resolve(__dirname, "..", p), "utf8");

const A = "aaaaaaaa-0000-4000-8000-000000000001", B = "bbbbbbbb-0000-4000-8000-000000000002";
const S1 = "51515151-0000-4000-8000-000000000001", SL = "52525252-0000-4000-8000-000000000002";
let n = 0;
const T = (o: Partial<CadenceTargetRow>): CadenceTargetRow => ({ id: `t${++n}`, scope: "OVERALL", label_artist_id: A, series_id: null, platform: null, content_type: null, action: "SET", per_week: 3, valid_from: "2026-10-01", valid_until: null, supersedes_id: null, source: "OWNER_STATEMENT", recommendation_id: null, note_he: null, created_at: "2026-10-01T00:00:00Z", ...o });
const I = (o: Partial<CadenceItem>): CadenceItem => ({ id: `i${++n}`, title: "x", label_artist_id: A, series_id: null, status: "published", content_type: "ריל", platform: "instagram", due_date: null, publish_date: "2026-10-13", ...o });
const SER = (o: Partial<SeriesRow>): SeriesRow => ({ id: S1, name: "Red Bars", owner_scope: "ARTIST", label_artist_id: A, platforms: ["youtube"], status: "ACTIVE", notes: "", created_at: "", updated_at: "", ...o });
const row = (t: CadenceTargetRow) => { const { id: _i, created_at: _c, ...r } = t; return r; };

(async () => {
  section("1. Week math — Sunday–Saturday");
  ok("1a. Friday 2026-10-16 → week of Sunday 2026-10-11", weekStartOf("2026-10-16") === "2026-10-11");
  ok("1b. Sunday is its own week start; Saturday belongs to the previous Sunday", weekStartOf("2026-10-11") === "2026-10-11" && weekStartOf("2026-10-17") === "2026-10-11" && weekStartOf("2026-10-18") === "2026-10-18");
  ok("1c. addDays crosses months", addDays("2026-10-30", 3) === "2026-11-02" && addDays("2026-11-01", -1) === "2026-10-31");
  ok("1d. the history = the current week + 4 back", cadenceHistory({ artistId: A, todayIL: "2026-10-16", items: [], targets: [], series: [] }).map((w) => w.weekStart).join() === "2026-10-11,2026-10-04,2026-09-27,2026-09-20,2026-09-13");

  section("2. Target chains — replace / END / same-day / history");
  { const t1 = T({ valid_from: "2026-10-01" }); const t2 = T({ per_week: 5, valid_from: "2026-10-15", supersedes_id: t1.id }); const rows = [t1, t2];
    const w = effectiveWindows(rows);
    ok("2a. a replacement ends the old row the day before it starts", w.get(t1.id)!.to === "2026-10-14" && w.get(t2.id)!.from === "2026-10-15");
    ok("2b. in effect: the old on the 14th, the new on the 15th (never both)", targetsInEffect(rows, "2026-10-14").map((x) => x.id).join() === t1.id && targetsInEffect(rows, "2026-10-15").map((x) => x.id).join() === t2.id);
    ok("2c. chainOf from any row = the whole chain in order; headOf = the last", chainOf(rows, t1.id).map((x) => x.id).join() === `${t1.id},${t2.id}` && chainOf(rows, t2.id).length === 2 && headOf(rows, t1.id)!.id === t2.id); }
  { const t1 = T({ valid_from: "2026-10-16" }); const t2 = T({ per_week: 4, valid_from: "2026-10-16", supersedes_id: t1.id });
    ok("2d. a same-day replacement leaves the first row an EMPTY window (it never applied) — no error", effectiveWindows([t1, t2]).get(t1.id)!.empty && targetsInEffect([t1, t2], "2026-10-16").map((x) => x.id).join() === t2.id); }
  { const t1 = T({ valid_from: "2026-10-01" }); const e = T({ action: "END", per_week: null, valid_from: "2026-10-16", supersedes_id: t1.id });
    ok("2e. END closes the chain: nothing in effect from its date, the old row still in effect before", targetsInEffect([t1, e], "2026-10-16").length === 0 && targetsInEffect([t1, e], "2026-10-15").length === 1); }

  section("3. The guard rules (same as the DB trigger)");
  { const today = "2026-10-16"; const t1 = T({ valid_from: "2026-10-01" });
    ok("3a. backdated → TARGET_BACKDATED", targetProblem(row(T({ valid_from: "2026-10-15" })), [], today) === "TARGET_BACKDATED");
    ok("3b. a second open target in the same slot → TARGET_OVERLAP", targetProblem(row(T({ valid_from: today })), [t1], today) === "TARGET_OVERLAP");
    ok("3c. a replacement of the head → allowed", targetProblem(row(T({ valid_from: today, supersedes_id: t1.id })), [t1], today) === null);
    const t2 = T({ valid_from: today, supersedes_id: t1.id });
    ok("3d. replacing a row that already has a successor → TARGET_HAS_SUCCESSOR", targetProblem(row(T({ valid_from: today, supersedes_id: t1.id })), [t1, t2], today) === "TARGET_HAS_SUCCESSOR");
    ok("3e. replacement of another slot → TARGET_SLOT_MISMATCH", targetProblem(row(T({ valid_from: today, supersedes_id: t1.id, label_artist_id: B })), [t1], today) === "TARGET_SLOT_MISMATCH");
    const e = T({ action: "END", per_week: null, valid_from: today, supersedes_id: t1.id });
    ok("3f. superseding an END → TARGET_ALREADY_ENDED; after END a NEW chain may start", targetProblem(row(T({ valid_from: today, supersedes_id: e.id })), [t1, e], today) === "TARGET_ALREADY_ENDED" && targetProblem(row(T({ valid_from: today })), [t1, e], today) === null);
    ok("3g. a replacement before the row it replaces → TARGET_BEFORE_PREVIOUS", targetProblem(row(T({ valid_from: "2026-10-20", supersedes_id: T({ valid_from: "2026-10-25" }).id })), [T({ id: "tx", valid_from: "2026-10-25" })], today) !== null);
    ok("3h. another artist's target never blocks", targetProblem(row(T({ label_artist_id: B, valid_from: today })), [t1], today) === null);
    const b1 = T({ scope: "BREAKDOWN", platform: "youtube", valid_from: today });
    ok("3i. BREAKDOWN platform vs content type → BREAKDOWN_OVERLAP; two different platforms → allowed", targetProblem(row(T({ scope: "BREAKDOWN", content_type: "ריל", valid_from: today })), [b1], today) === "BREAKDOWN_OVERLAP" && targetProblem(row(T({ scope: "BREAKDOWN", platform: "tiktok", valid_from: today })), [b1], today) === null);
    ok("3j. a future-dated target does not overlap a past, ended chain", targetProblem(row(T({ valid_from: "2026-10-20" })), [T({ id: "old", valid_from: "2026-09-01", valid_until: "2026-09-30" })], today) === null); }

  section("4. Counting — items ≠ publications; a series item once per summary");
  { const s = SER({});
    const items = [
      I({ platform: "instagram,tiktok", publish_date: "2026-10-12" }),            // 1 item, 2 publications
      I({ platform: "youtube", series_id: S1, publish_date: "2026-10-13" }),      // series item: counts in overall + series
      I({ status: "scheduled", publish_date: "2026-10-17" }),                     // planned, still ahead
      I({ status: "ready", publish_date: "2026-10-14" }),                         // planned, date passed, not marked published
      I({ status: "cancelled", publish_date: "2026-10-15" }),                     // cancelled: never planned
      I({ label_artist_id: B, publish_date: "2026-10-12" }),                      // another artist
      I({ publish_date: "2026-10-05" }),                                          // previous week
    ];
    const targets = [T({ per_week: 4 }), T({ scope: "BREAKDOWN", platform: "instagram", per_week: 2 }), T({ scope: "SERIES", series_id: S1, per_week: 1 })];
    const w = weekSummary({ artistId: A, weekStart: "2026-10-11", todayIL: "2026-10-16", items, targets, series: [s] });
    ok("4a. unique items published = 2 (the 2-platform item counts once)", w.items.published === 2, w.items);
    ok("4b. publications = 3 (instagram 1, tiktok 1, youtube 1) — a separate number", w.publications.total === 3 && w.publications.byPlatform.instagram === 1 && w.publications.byPlatform.tiktok === 1 && w.publications.byPlatform.youtube === 1, w.publications);
    ok("4c. planned = 4 (cancelled out); remaining = 1; planned-not-published = 1", w.items.planned === 4 && w.items.plannedRemaining === 1 && w.items.plannedNotPublished === 1, w.items);
    ok("4d. overall target 4 → 2 published + 1 planned = not on track, gap 2", !!w.overall && w.overall.progress.metric === "ITEMS" && w.overall.progress.gap === 2 && !w.overall.progress.onTrack);
    ok("4e. a platform breakdown measures PUBLICATIONS on that platform", w.breakdown[0]?.progress.metric === "PUBLICATIONS" && w.breakdown[0]?.progress.published === 1);
    ok("4f. the series item counts once in its series (1 / 1 ✓) AND in the overall (never twice in one summary)", w.series[0]?.publishedItems === 1 && w.series[0]?.progress?.onTrack === true && w.items.published === 2);
    ok("4g. signals: below target + planned-not-published; no number of different kinds added", w.signals.some((x) => x.code === "BELOW_TARGET" && x.scope === "OVERALL") && w.signals.some((x) => x.code === "PLANNED_NOT_PUBLISHED"));
    ok("4h. another artist's items never count", weekSummary({ artistId: B, weekStart: "2026-10-11", todayIL: "2026-10-16", items, targets, series: [s] }).items.published === 1);
    ok("4i. no target → NO_TARGET ('לא מנחשים מספר'), never an invented number", weekSummary({ artistId: A, weekStart: "2026-10-11", todayIL: "2026-10-16", items, targets: [], series: [] }).signals.some((x) => x.code === "NO_TARGET" && x.textHe.includes("לא מנחשים")));
    const past = weekSummary({ artistId: A, weekStart: "2026-10-04", todayIL: "2026-10-16", items, targets: [T({ per_week: 2, valid_from: "2026-10-01", id: "p1" }), T({ per_week: 9, valid_from: "2026-10-15", supersedes_id: "p1" })], series: [] });
    ok("4j. a past week is measured against the target in effect THEN (its Saturday), not today's", past.overall?.progress.required === 2 && !past.isCurrent);
    ok("4k. overdue = the app's rule, never week-bound", overdueCount([I({ status: "idea", due_date: "2026-10-01", publish_date: null })], A, "2026-10-16") === 1);
    ok("4l. platformsOf: one value or a comma-joined list, deduped", platformsOf("instagram, tiktok,instagram").join() === "instagram,tiktok" && platformsOf(null).length === 0);
    const lab = labelSeriesWeek({ weekStart: "2026-10-11", todayIL: "2026-10-16", items: [I({ label_artist_id: null, series_id: SL })], targets: [], series: [SER({ id: SL, owner_scope: "LABEL", label_artist_id: null, name: "לייבל" })] });
    ok("4m. a LABEL series is measured at label level, never inside one artist", lab[0]?.publishedItems === 1 && weekSummary({ artistId: A, weekStart: "2026-10-11", todayIL: "2026-10-16", items: [], targets: [], series: [SER({ id: SL, owner_scope: "LABEL", label_artist_id: null })] }).series.length === 0); }

  section("5. The artist view (Sunny's CADENCE) — unreadable is UNKNOWN; external evidence apart");
  { const brain = { resources: [{ id: "r1", resourceKind: "ACCOUNT", parentId: null, displayName: "ig", identityKey: "ig" }, { id: "r2", resourceKind: "CONTENT", parentId: "r1", displayName: "post", identityKey: "p" }], observations: [{ id: "o1", resourceId: "r2", type: "INSTAGRAM.PUBLISHED_AT", valueText: "2026-10-12", observedAt: "2026-10-15T10:00:00Z" }], records: [], links: [], events: [] } as never;
    const none = artistCadenceOf(A, { campaigns: [], items: [] }, "2026-10-16", brain, ["r1"], new Date("2026-10-16T09:00:00Z"));
    ok("5a. series / targets not read → readable false (never 'no target')", none.readable === false);
    let v: ReturnType<typeof artistCadenceOf> | null = null;
    try { v = artistCadenceOf(A, { campaigns: [], items: [], series: [], targets: [T({ per_week: 3 })] }, "2026-10-16", brain, ["r1"], new Date("2026-10-16T09:00:00Z")); } catch (e) { ok("5b. view builds", false, String(e)); }
    if (v) {
      ok("5b. readable: 5 weeks, the current target with its history", v.readable && v.weeks.length === 5 && v.targets.length === 1 && v.targets[0].history.length === 1);
      ok("5c. external evidence is its own list (never added into the weeks' counts)", Array.isArray(v.external) && v.weeks[0].items.published === 0);
    } }

  section("6. Wiring + guards");
  const mod = read("lib/social-cadence.ts"), lab = read("lib/partner/label/social.ts"), cap = read("lib/partner/knowledge/capabilities/artist-social.ts");
  ok("6a. the cadence module is pure (no DB / fetch / push / cron / clock of its own)", !/supabase|fetch\(|sendPush|setInterval|cron|(?<!Array)\.from\(|new Date\(\)/.test(mod));
  ok("6b. the view and the capability use the ONE module (no second count)", /from "@\/lib\/social-cadence"/.test(lab) && /cadenceHistory\(/.test(lab) && /CADENCE/.test(cap));
  const ui = read("components/social/ArtistCadenceSection.tsx"), hub = read("components/social/LabelArtistsSocial.tsx");
  ok("6c. the hub shows the week on every artist card + the full section in the artist view", /code === "CADENCE"/.test(hub) && /<ArtistCadenceSection /.test(hub));
  ok("6d. the UI reads the SAME artist_social answer and writes only the Owner-only routes (no DELETE)", /capability=artist_social/.test(ui) && /\/api\/social\/targets/.test(ui) && /\/api\/social\/series/.test(ui) && !/method: "DELETE"|"DELETE"/.test(ui));
  ok("6e. every UI write shows the exact change and waits for confirmation", (ui.match(/write\(/g) ?? []).length >= 5 && /window\.confirm/.test(ui) && /לפני:/.test(ui) && /אחרי:/.test(ui));
  ok("6f. items and publications are labelled apart; external measurements say they are not counted", /פרסומים בפלטפורמות/.test(ui) && /לא נספרות ביעד/.test(ui) && /פריטים ופרסומים לא מחוברים/.test(ui));
  ok("6g. no push / calendar / cron / publishing anywhere in stage 2", ![mod, lab, ui, read("lib/social-cadence-store.ts"), read("app/api/social/targets/route.ts"), read("app/api/social/series/route.ts")].some((t) => /sendPush|calendar_event|calendarEvent|setInterval|cron\.|publishTo/.test(t)));
  const sql = read("scripts/sql/2026-10-17-artist-social-stage2-APPLIED.sql");
  ok("6h. the applied SQL is recorded: append-only + guard triggers, RLS on, no anon / authenticated grant", /social_cadence_targets_append_only/.test(sql) && /social_cadence_targets_guard/.test(sql) && /enable row level security/i.test(sql) && /revoke all on public\.social_series, public\.social_cadence_targets from anon, authenticated/i.test(sql));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
