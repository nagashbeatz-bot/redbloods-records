/**
 * Standalone smoke test for lib/project-cover.ts — the pure logic behind the
 * Project Cover feature (config validation, default fallback, image URLs, title
 * fitting, storage-shape guards).
 *
 * Run with:   npx tsx scripts/test-project-cover.ts
 *
 * Imports ONLY the pure module (no "server-only", no Supabase, no Dropbox), so
 * nothing here touches production.
 */
import {
  COVER_THEMES, DEFAULT_COVER_THEME, coverDropboxPath, coverImageUrl,
  coverSettingsKey, coverTitleLayout, COVER_MIN_FONT_PX, COVER_TITLE_MAX_LINES, getCoverTheme, isCoverThemeId, isSafeProjectId,
  looksLikeJpeg, normalizeCover,
} from "../lib/project-cover";
import {
  AVI_ARTIST_ID, isAviAllowedPath, isShalevAllowedPath, isCleantoneAllowedPath,
  isVictorAllowedPath, isStevenAllowedPath,
} from "../lib/roles";

let pass = 0, fail = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log(`  ✓ ${name}`); pass++; }
  else { console.log(`  ✗ ${name}\n      expected ${e}\n      actual   ${a}`); fail++; }
}

const PID = "3f2b8c1e-4a5d-4e6f-9a7b-1c2d3e4f5a6b";

console.log("themes");
check("9 themes", COVER_THEMES.length, 9);
check("unique ids", new Set(COVER_THEMES.map((t) => t.id)).size, 9);
check("default theme exists", isCoverThemeId(DEFAULT_COVER_THEME), true);
check("unknown theme rejected", isCoverThemeId("hacker"), false);
check("non-string rejected", isCoverThemeId(42), false);

console.log("normalizeCover / default fallback");
check("undefined → null (default cover)", normalizeCover(undefined), null);
check("null → null", normalizeCover(null), null);
check("string → null", normalizeCover("x"), null);
check("valid theme kept", normalizeCover({ theme: "nightblue", customImage: false, updatedAt: "t" }), { theme: "nightblue", customImage: false, updatedAt: "t" });
check("bad theme → default theme", normalizeCover({ theme: "nope", customImage: true, updatedAt: "t" })?.theme, "redbloods");
check("customImage only when strictly true", normalizeCover({ theme: "black", customImage: "yes" })?.customImage, false);
check("no config → redbloods theme", getCoverTheme(null).id, "redbloods");
check("no config → redbloods (undefined)", getCoverTheme(undefined).id, "redbloods");

console.log("image URLs (one source; owner vs portal)");
const custom = { theme: "black" as const, customImage: true, updatedAt: "2026-09-21T10:00:00.000Z" };
check("theme-only → no image URL", coverImageUrl(PID, { theme: "black", customImage: false, updatedAt: null }), null);
check("no config → no image URL", coverImageUrl(PID, null), null);
check("owner URL", coverImageUrl(PID, custom), `/api/projects/${PID}/cover/image?v=2026-09-21T10%3A00%3A00.000Z`);
check("portal URL (Shalev)", coverImageUrl(PID, custom, "/api/red-artists"), `/api/red-artists/project-cover?projectId=${PID}&v=2026-09-21T10%3A00%3A00.000Z`);
check("portal URL (artist-scoped)", coverImageUrl(PID, custom, "/api/label/artists/abc"), `/api/label/artists/abc/project-cover?projectId=${PID}&v=2026-09-21T10%3A00%3A00.000Z`);
check("cache-buster changes with updatedAt", coverImageUrl(PID, custom) !== coverImageUrl(PID, { ...custom, updatedAt: "2026-09-22T00:00:00.000Z" }), true);
check("settings key", coverSettingsKey(PID), `project_cover_${PID}`);

console.log("title typography (name at EVERY size, never an initial)");
const L = coverTitleLayout;
const NAMES = ["לא מאמינה", "Dancehall School חלק א׳", "Closer To You", "שלום", "פרצייפ", "דאנסהול סקול"];
const VERY_LONG = "Closer To You (Extended Radio Mix) feat. Somebody";
const EDGES = [236, 192, 148, 124, 60, 46];
for (const n of NAMES) {
  for (const e of EDGES) {
    const r = L(n, e);
    check(`"${n}" @${e}px: fits in ≤${COVER_TITLE_MAX_LINES} lines, font ≥ ${COVER_MIN_FONT_PX}px`, r.fits && r.lines <= COVER_TITLE_MAX_LINES && r.fontPx >= COVER_MIN_FONT_PX, true);
  }
}
// A 50-char name wraps fully down to a 60px thumbnail; on a 46px one (≈35px of text
// width) it is the only case allowed to clamp — nobody names a release like that.
for (const e of EDGES.filter((x) => x >= 60)) {
  const r = L(VERY_LONG, e);
  check(`very long name @${e}px: wraps fully (no ellipsis cut), font ≥ ${COVER_MIN_FONT_PX}px`, r.clamp >= r.lines && r.fontPx >= COVER_MIN_FONT_PX, true);
}
check("לא מאמינה @192: elegant size (18–26px)", L("לא מאמינה", 192).fontPx >= 18 && L("לא מאמינה", 192).fontPx <= 26, true);
check("לא מאמינה @148 smaller than @192", L("לא מאמינה", 148).fontPx < L("לא מאמינה", 192).fontPx, true);
check("לא מאמינה @60 smaller than @148", L("לא מאמינה", 60).fontPx < L("לא מאמינה", 148).fontPx, true);
check("לא מאמינה @46 ≤ @60", L("לא מאמינה", 46).fontPx <= L("לא מאמינה", 60).fontPx, true);
check("לא מאמינה @46 still readable (≥7px)", L("לא מאמינה", 46).fontPx >= 7, true);
check("relative size grows on small covers (60px thumb > hero share)", L("לא מאמינה", 60).fontPx / 60 > L("לא מאמינה", 192).fontPx / 192, true);
check("hero type is calm (≤ 14% of the edge)", L("לא מאמינה", 192).fontPx / 192 <= 0.14, true);
check("longer name is never bigger @192", L("Closer To You", 192).fontPx >= L("Closer To You (Extended Radio Mix) feat. Somebody", 192).fontPx, true);
check("long single word shrinks so it stays on one line", L("Supercalifragilistic", 192).fontPx < L("Super Cali", 192).fontPx, true);
check("impossible name floors at the minimum, never throws", L("א".repeat(200), 46).fontPx, COVER_MIN_FONT_PX);
check("impossible name reports fits=false", L("א".repeat(200), 46).fits, false);
check("empty name safe", L("", 192).lines, 1);
check("same input → same output (deterministic)", JSON.stringify(L("Closer To You", 60)) === JSON.stringify(L("Closer To You", 60)), true);

console.log("storage guards");
check("uuid is a safe id", isSafeProjectId(PID), true);
check("path traversal rejected", isSafeProjectId("../../etc/passwd"), false);
check("slash rejected", isSafeProjectId("abc/def123"), false);
check("too short rejected", isSafeProjectId("abc"), false);
check("non-string rejected", isSafeProjectId(undefined), false);
check("dropbox path by projectId", coverDropboxPath(PID), `/Project Covers/${PID}.jpg`);
let threw = false; try { coverDropboxPath("../x"); } catch { threw = true; }
check("dropbox path throws on unsafe id", threw, true);
check("jpeg magic accepted", looksLikeJpeg(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00])), true);
check("png rejected", looksLikeJpeg(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d])), false);
check("html rejected", looksLikeJpeg(new TextEncoder().encode("<html>")), false);
check("tiny buffer rejected", looksLikeJpeg(new Uint8Array([0xff, 0xd8])), false);

console.log("proxy allowlists — artists get READ-only, scoped cover access; only the owner reaches the write/owner routes");
const OTHER = "11111111-2222-3333-4444-555555555555";
const ownerWrite = `/api/projects/${PID}/cover`, ownerImage = `/api/projects/${PID}/cover/image`;
check("Avi: own project-cover allowed", isAviAllowedPath(`/api/label/artists/${AVI_ARTIST_ID}/project-cover`), true);
check("Avi: another artist's project-cover denied", isAviAllowedPath(`/api/label/artists/${OTHER}/project-cover`), false);
check("Avi: owner cover write route denied", isAviAllowedPath(ownerWrite), false);
check("Avi: owner cover image route denied", isAviAllowedPath(ownerImage), false);
check("Shalev: portal project-cover allowed", isShalevAllowedPath("/api/red-artists/project-cover"), true);
check("Shalev: owner cover write route denied", isShalevAllowedPath(ownerWrite), false);
check("Shalev: owner cover image route denied", isShalevAllowedPath(ownerImage), false);
check("Shalev: artist-scoped route denied", isShalevAllowedPath(`/api/label/artists/${OTHER}/project-cover`), false);
for (const [n, fn] of [["Cleantone", isCleantoneAllowedPath], ["Victor", isVictorAllowedPath], ["Steven", isStevenAllowedPath]] as const) {
  check(`${n}: no cover routes at all`, [ownerWrite, ownerImage, "/api/red-artists/project-cover", `/api/label/artists/${AVI_ARTIST_ID}/project-cover`].some((p) => fn(p)), false);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
