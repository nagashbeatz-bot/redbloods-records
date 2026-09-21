/**
 * Render test for components/ui/ProjectCover.tsx — the "custom image = image only" rule.
 *
 * Run with:   npx tsx scripts/test-project-cover-render.tsx
 *
 * Uses react-dom/server (static markup), so nothing touches production. The image
 * onError → theme fallback needs a browser (state) and is not covered here.
 */
import { renderToStaticMarkup } from "react-dom/server";
import ProjectCover from "../components/ui/ProjectCover";
import type { ProjectCoverConfig } from "../lib/project-cover";

let pass = 0, fail = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log(`  ✓ ${name}`); pass++; }
  else { console.log(`  ✗ ${name}\n      expected ${e}\n      actual   ${a}`); fail++; }
}

const PID = "3f2b8c1e-4a5d-4e6f-9a7b-1c2d3e4f5a6b";
const NAMES = ["לא מאמינה", "Dancehall School חלק א׳", "Closer To You"];
const SIZES: [number, number | undefined][] = [[192, undefined], [148, undefined], [60, 46]];
const theme: ProjectCoverConfig = { theme: "nightblue", customImage: false, updatedAt: "t" };
const custom: ProjectCoverConfig = { theme: "nightblue", customImage: true, updatedAt: "2026-09-21T10:00:00.000Z" };

/** Text a user could actually see: markup with every tag (and so every attribute, e.g. aria-label) removed. */
const visibleText = (html: string) => html.replace(/<[^>]*>/g, "");
const render = (name: string, cover: ProjectCoverConfig | null, size: number, mobileSize?: number, extra: { imageSrc?: string | null; imageBase?: string } = {}) =>
  renderToStaticMarkup(<ProjectCover projectId={PID} name={name} cover={cover} size={size} mobileSize={mobileSize} {...extra} />);

console.log("built-in theme → theme + project name");
for (const n of NAMES) for (const [s, m] of SIZES) {
  const h = render(n, theme, s, m);
  check(`"${n}" @${s}: name shown`, visibleText(h).includes(n), true);
  check(`"${n}" @${s}: no <img>`, h.includes("<img"), false);
}

console.log("no config (default / after reset) → default theme + name");
for (const n of NAMES) {
  const h = render(n, null, 192);
  check(`"${n}": name shown, no <img>`, visibleText(h).includes(n) && !h.includes("<img"), true);
}

console.log("custom image → the image ALONE (no name, no scrim, no text block)");
for (const n of NAMES) for (const [s, m] of SIZES) {
  const h = render(n, custom, s, m);
  check(`"${n}" @${s}: <img> present`, h.includes("<img"), true);
  check(`"${n}" @${s}: name NOT shown`, visibleText(h).includes(n), false);
  check(`"${n}" @${s}: no scrim gradient`, h.includes("rgba(0,0,0,0.34)") || h.includes("rgba(0,0,0,0.58)"), false);
  check(`"${n}" @${s}: no title block (dir="auto")`, h.includes('dir="auto"'), false);
  check(`"${n}" @${s}: no text-shadow at all`, h.includes("text-shadow"), false);
}
check("custom image URL = owner route", render("x", custom, 60).includes(`/api/projects/${PID}/cover/image?v=`), true);
check("custom image URL = portal route", render("x", custom, 148, undefined, { imageBase: "/api/red-artists" }).includes("/api/red-artists/project-cover?projectId=" + PID), true);

console.log("modal drafts (explicit imageSrc override)");
check("uploaded draft → clean image, no name", (() => { const h = render("לא מאמינה", custom, 236, 188, { imageSrc: "blob:abc" }); return h.includes('src="blob:abc"') && !visibleText(h).includes("לא מאמינה"); })(), true);
check("switch custom → theme (imageSrc null) → name is back", (() => { const h = render("לא מאמינה", { ...theme, customImage: false }, 236, 188, { imageSrc: null }); return visibleText(h).includes("לא מאמינה") && !h.includes("<img"); })(), true);
check("customImage flag with imageSrc:null forces theme + name", (() => { const h = render("Closer To You", custom, 192, undefined, { imageSrc: null }); return visibleText(h).includes("Closer To You") && !h.includes("<img"); })(), true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
