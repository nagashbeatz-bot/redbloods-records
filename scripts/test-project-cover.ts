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
  COVER_THEMES, DEFAULT_COVER_THEME, coverDropboxPath, coverImageUrl, coverInitial,
  coverSettingsKey, coverTitleScale, getCoverTheme, isCoverThemeId, isSafeProjectId,
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

console.log("title fitting");
const s = (n: string) => Number(coverTitleScale(n).toFixed(2));
check("short Hebrew is largest", s("שלום") , 22);
check("12-char Hebrew (דאנסהול סקול) ≤ 17%", s("דאנסהול סקול") <= 17, true);
check("longer name is never bigger", s("Closer To You") >= s("Closer To You (Extended Radio Mix) feat. Somebody"), true);
check("very long name floors at 6.5%", s("א".repeat(120)), 6.5);
check("long single word shrinks so it fits one line", s("Supercalifragilistic") < s("Super Cali"), true);
check("mixed Hebrew/English in range", s("Dancehall School חלק א׳") >= 6.5 && s("Dancehall School חלק א׳") <= 22, true);
check("empty name safe", s(""), 22);
check("initial: Hebrew", coverInitial("דאנסהול סקול"), "ד");
check("initial: English uppercased", coverInitial("closer"), "C");
check("initial: empty", coverInitial("  "), "•");

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
