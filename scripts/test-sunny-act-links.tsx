/**
 * Universal Action Layer — LINK FIELDS (typed `url` arguments): every link primitive through the REAL service on fakes
 * (6 standard checks each) + the URL rule (http(s) only, no user / password, no credential parameter, no token shape,
 * no localhost / IP), the preview shows the exact URL in the exact field, an old link is only a fingerprint, the plan
 * persists ONLY typed URL values, and the intake plans exactly the scanned file set.
 * Run with:   npx tsx scripts/test-sunny-act-links.tsx      Pure; never touches production.
 */
import { runCases, mkDeps, fullFlow, U, OWNER, type FamilyCase } from "./fixtures/act-harness";
import { planAction, previewAction } from "../lib/partner/act/service";
import { LINK_PRIMITIVES } from "../lib/partner/act/primitives/links";
import { linkRef } from "../lib/partner/act/primitives/core";
import { urlProblem, toPersistablePlan } from "../lib/partner/act/persist";
import { validateActInput } from "../lib/partner/act/mcp-tools";
import { ACTION_REGISTRY } from "../lib/partner/act/registry";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: unknown) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 500)}` : ""}`); } };

const OLD = "https://www.dropbox.com/scl/fi/old123/old.wav?rlkey=abc&dl=0";
const NEW = "https://www.dropbox.com/scl/fi/new456/Mix%204.wav?rlkey=xyz&dl=0";
const YT = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
interface W { vlinks: Array<{ id: string; title: string; notes: string }>; brief: Array<{ ref: string; name: string; segments: string }>; prod: Record<string, string>; refLines: string[]; videoRefs: number; social: Record<string, string>; vrefs: Array<{ id: string; url: string; title: string; note: string }>; intake: { files: Array<{ name: string; category: string; folder: string }>; digest: string }; imported: number }
const world = (): W => ({
  vlinks: [{ id: U(60), title: "וייב", notes: "" }], brief: [{ ref: "a".repeat(24), name: "brief.wav", segments: "" }],
  prod: { files_raw_link: OLD, files_edit_folder: "", version_1_link: "", version_2_link: "", final_version_link: "" }, refLines: ["https://vimeo.com/1"], videoRefs: 1,
  social: { asset_link: "", dropbox_link: OLD, posted_url: "" }, vrefs: [{ id: U(40), url: YT, title: "וייב", note: "" }],
  intake: { files: [{ name: "Song MASTER.wav", category: "מאסטר", folder: "" }, { name: "Kick.wav", category: "ערוצים", folder: "ערוצים" }], digest: "d1" }, imported: 0,
});
const COLS: Record<string, string> = { rawFilesLink: "files_raw_link", editFolderLink: "files_edit_folder", version1Link: "version_1_link", version2Link: "version_2_link", finalVersionLink: "final_version_link" };
function mk() {
  const w = world(); const calls: string[] = [];
  const writers = {
    async readProjectMeta(id: string) { return id === U(1) ? { name: "קרוב", artist: "שליו", status: "בעבודה", isHidden: false, businessType: "לקוח", projectType: "שיר", hasRelease: false } : null; },
    async productionLinks(id: string) { if (id !== U(7)) return null; const links: Record<string, string | null> = {}; for (const [f, c] of Object.entries(COLS)) links[f] = linkRef(w.prod[c]); links.addReferenceLink = linkRef(w.refLines[w.refLines.length - 1]); return { title: "קליפ", links }; },
    async setProductionLinks(_id: string, patch: Record<string, string | null>, append: string | null) { calls.push("setProductionLinks"); for (const [c, v] of Object.entries(patch)) w.prod[c] = v ?? ""; if (append) w.refLines.push(append); },
    youtubeVideoId: (u: string) => (/v=([\w-]{11})/.exec(u)?.[1] ?? null),
    async videoReferenceCount() { return w.videoRefs; },
    async addVideoReference() { calls.push("addVideoReference"); w.videoRefs++; return U(99); },
    async socialContentLinks(id: string) { if (id !== U(5)) return null; return { title: "טיזר", links: { assetLink: linkRef(w.social.asset_link), storageLink: linkRef(w.social.dropbox_link), postedLink: linkRef(w.social.posted_url) } }; },
    async setSocialContentLinks(_id: string, patch: Record<string, string | null>) { calls.push("setSocialContentLinks"); const col: Record<string, string> = { assetLink: "asset_link", storageLink: "dropbox_link", postedLink: "posted_url" }; for (const [k, v] of Object.entries(patch)) w.social[col[k]] = v ?? ""; },
    async readVideoReference(id: string) { const r = w.vlinks.find((x) => x.id === id); return r ? { productionId: U(7), title: r.title, notes: r.notes, provider: "youtube" } : null; },
    async updateVideoReference(id: string, p: { title?: string; notes?: string }) { calls.push("updateVideoReference"); Object.assign(w.vlinks.find((x) => x.id === id)!, p); },
    async deleteVideoReference(id: string) { calls.push("deleteVideoReference"); w.vlinks = w.vlinks.filter((x) => x.id !== id); },
    async briefFileViews(id: string) { return id === U(9) ? w.brief.map((b) => ({ ...b })) : null; },
    async removeBriefFile(_w: string, ref: string) { calls.push("removeBriefFile"); w.brief = w.brief.filter((b) => b.ref !== ref); },
    async setBriefSegments(_w: string, ref: string, segs: ReadonlyArray<{ type: string; start: number; end: number; label?: string }>) { calls.push("setBriefSegments"); w.brief.find((b) => b.ref === ref)!.segments = segs.map((x) => `${x.type}${x.label ? `:${x.label}` : ""} ${x.start}-${x.end}`).join("; "); return "ok"; },
    async victorReferenceViews(id: string) { return id === U(9) ? w.vrefs.map((r) => ({ id: r.id, title: r.title, note: r.note, link: linkRef(r.url) })) : null; },
    async addVictorReference(_w: string, i: { url: string; title: string; note: string }) { calls.push("addVictorReference"); w.vrefs.push({ id: U(41), ...i }); return U(41); },
    async updateVictorReference(_w: string, id: string, p: { url?: string; title?: string; note?: string }) { calls.push("updateVictorReference"); const r = w.vrefs.find((x) => x.id === id)!; Object.assign(r, p); },
    async removeVictorReference(_w: string, id: string) { calls.push("removeVictorReference"); w.vrefs = w.vrefs.filter((x) => x.id !== id); },
    async previewIntakeLink() { return { ok: true as const, files: w.intake.files, digest: w.intake.digest }; },
    async importIntakeLink() { calls.push("importIntakeLink"); w.imported = w.intake.files.length; return { moved: w.intake.files.length, total: w.intake.files.length, sourceDeleted: false }; },
  };
  return { w, calls, writers };
}
const PR = `rf-production:${U(7)}`, SC = `social-content:${U(5)}`, VW = `victor-work:${U(9)}`;
const CASES: FamilyCase<W>[] = [
  { id: "IMPORT_DELIVERY_FROM_LINK", args: { project: `project:${U(1)}`, sourceLink: "https://www.dropbox.com/scl/fo/abc/FINAL?rlkey=q" }, confirm: "כן בוס, קליטה", bad: { project: `project:${U(1)}`, sourceLink: "ftp://x.example.com/a" }, missing: { project: `project:${U(9)}`, sourceLink: NEW }, wrongKind: { project: PR, sourceLink: NEW }, stale: (w) => { w.intake.digest = "d2"; }, check: (w) => w.imported === 2 },
  { id: "SET_PRODUCTION_LINKS", args: { production: PR, rawFilesLink: NEW, addReferenceLink: "https://vimeo.com/2" }, bad: { production: PR, finalVersionLink: "javascript:alert(1)" }, missing: { production: `rf-production:${U(8)}`, rawFilesLink: NEW }, wrongKind: { production: SC, rawFilesLink: NEW }, stale: (w) => { w.prod.files_raw_link = "https://x.example.com/other"; }, check: (w) => w.prod.files_raw_link === NEW && w.refLines.join() === "https://vimeo.com/1,https://vimeo.com/2" },
  { id: "ADD_RF_VIDEO_REFERENCE", args: { production: PR, videoLink: YT, title: "וייב" }, bad: { production: PR, videoLink: "https://user:pw@youtube.com/x" }, missing: { production: `rf-production:${U(8)}`, videoLink: YT }, stale: (w) => { w.videoRefs = 5; }, check: (w) => w.videoRefs === 2 },
  { id: "SET_SOCIAL_CONTENT_LINKS", args: { content: SC, postedLink: "https://www.instagram.com/p/Cabc123/" }, bad: { content: SC, assetLink: "http://127.0.0.1/x" }, missing: { content: `social-content:${U(6)}`, postedLink: NEW }, wrongKind: { content: PR, postedLink: NEW }, stale: (w) => { w.social.asset_link = "https://x.example.com/a"; }, check: (w) => w.social.posted_url === "https://www.instagram.com/p/Cabc123/" && w.social.dropbox_link === OLD },
  { id: "ADD_VICTOR_REFERENCE", args: { victorWork: VW, referenceLink: "https://youtu.be/abcdefghijk", title: "גרוב" }, bad: { victorWork: VW, referenceLink: "https://x.example.com/?token=abc" }, missing: { victorWork: `victor-work:${U(8)}`, referenceLink: YT }, stale: (w) => { w.vrefs.push({ id: U(42), url: YT, title: "", note: "" }); }, check: (w) => w.vrefs.length === 2 && w.vrefs[1].url === "https://youtu.be/abcdefghijk" },
  { id: "UPDATE_VICTOR_REFERENCE", args: { victorWork: VW, referenceId: U(40), referenceLink: "https://youtu.be/zzzzzzzzzzz", note: "רק הפזמון" }, bad: { victorWork: VW, referenceId: U(40), referenceLink: "not a url" }, missing: { victorWork: VW, referenceId: U(49), note: "x" }, stale: (w) => { w.vrefs[0].title = "אחר"; }, check: (w) => w.vrefs[0].url === "https://youtu.be/zzzzzzzzzzz" && w.vrefs[0].note === "רק הפזמון" },
  { id: "UPDATE_RF_VIDEO_REFERENCE", args: { videoReference: `rf-video-reference:${U(60)}`, notes: "הצבעים" }, bad: { videoReference: `rf-video-reference:${U(60)}`, notes: 5 }, missing: { videoReference: `rf-video-reference:${U(61)}`, notes: "x" }, wrongKind: { videoReference: PR, notes: "x" }, stale: (w) => { w.vlinks[0].title = "אחר"; }, check: (w) => w.vlinks[0].notes === "הצבעים" && w.vlinks[0].title === "וייב" },
  { id: "DELETE_RF_VIDEO_REFERENCE", args: { videoReference: `rf-video-reference:${U(60)}` }, confirm: "כן בוס, מחיקה", bad: { videoReference: "rf-video-reference:nope" }, missing: { videoReference: `rf-video-reference:${U(61)}` }, wrongKind: { videoReference: PR }, stale: (w) => { w.vlinks = []; }, check: (w) => w.vlinks.length === 0 },
  { id: "DELETE_VICTOR_BRIEF_FILE", args: { victorWork: VW, briefRef: "a".repeat(24) }, confirm: "כן בוס, מחיקה", bad: { victorWork: VW, briefRef: 7 }, missing: { victorWork: VW, briefRef: "b".repeat(24) }, stale: (w) => { w.brief = []; }, check: (w) => w.brief.length === 0 },
  { id: "SET_VICTOR_BRIEF_SEGMENTS", args: { victorWork: VW, briefRef: "a".repeat(24), segments: "intro 0-12.5; chorus1 40-62; custom:Hook 62-70" }, bad: { victorWork: VW, briefRef: "a".repeat(24), segments: "rap 0-5" }, missing: { victorWork: VW, briefRef: "b".repeat(24), segments: "intro 0-1" }, stale: (w) => { w.brief[0].segments = "outro 1-2"; }, check: (w) => w.brief[0].segments === "intro 0-12.5; chorus1 40-62; custom:Hook 62-70" },
  { id: "REMOVE_VICTOR_REFERENCE", args: { victorWork: VW, referenceId: U(40) }, confirm: "כן בוס, מחיקה", bad: { victorWork: VW, referenceId: 5 }, missing: { victorWork: VW, referenceId: U(49) }, stale: (w) => { w.vrefs[0].note = "x"; }, check: (w) => w.vrefs.length === 0 },
];

(async () => {
  console.log("Link fields — standard checks");
  ok("the case table covers every link primitive", CASES.map((c) => c.id).sort().join() === LINK_PRIMITIVES.map((p) => p.actionId).sort().join());
  await runCases(CASES, mk, ok);

  console.log("\nThe URL rule (lib/partner/act/persist urlProblem)");
  const good = ["https://www.dropbox.com/scl/fi/abc/x.wav?rlkey=q&dl=0", "https://youtu.be/abcdefghijk", "http://example.co.il/page", "https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/view"];
  const badUrls: Array<[string, string]> = [["ftp://example.com/x", "URL_SCHEME_NOT_ALLOWED"], ["javascript:alert(1)", "URL_SCHEME_NOT_ALLOWED"], ["https://u:p@example.com/", "URL_WITH_CREDENTIALS"], ["https://example.com/?access_token=abc", "URL_WITH_SECRET"], ["https://example.com/?sig=abc&x=1", "URL_WITH_SECRET"], ["https://localhost/x", "URL_HOST_NOT_ALLOWED"], ["https://10.0.0.1/x", "URL_HOST_NOT_ALLOWED"], ["https://example.com/eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc", "URL_WITH_SECRET"], ["https://example.com/a b", "BAD_URL"], ["x".repeat(10), "BAD_URL"]];
  ok("accepts ordinary share / video / page links", good.every((u) => urlProblem(u) === null), good.map((u) => urlProblem(u)));
  ok("refuses other schemes, credentials, secret parameters, token shapes, localhost / IPs, spaces", badUrls.every(([u, e]) => urlProblem(u) === e), badUrls.map(([u, e]) => [u, urlProblem(u), e]));
  ok("the MCP input gate applies the same rule to url arguments (and only to them)", validateActInput("partner_plan_action", { intentHe: "x", actionId: "SET_SOCIAL_CONTENT_LINKS", args: { content: SC, postedLink: "https://example.com/?token=1" } }).ok === false && validateActInput("partner_plan_action", { intentHe: "x", actionId: "SET_SOCIAL_CONTENT_LINKS", args: { content: SC, postedLink: "https://www.instagram.com/p/C1/" } }).ok === true && validateActInput("partner_plan_action", { intentHe: "x", actionId: "UPDATE_SOCIAL_CONTENT", args: { content: SC, notes: "https://example.com" } }).ok === false);

  console.log("\nPreview + persistence");
  const h = mk(); const { d, db } = mkDeps(h.writers);
  const p = await planAction({ intentHe: "קישור ל-Mix 4", actionId: "SET_PRODUCTION_LINKS", args: { production: PR, rawFilesLink: NEW } }, OWNER, d);
  const pv = await previewAction({ planId: p.planId }, OWNER, d);
  const ch = (pv as unknown as { preview: { steps: Array<{ changes: Array<{ field: string; before: unknown; after: unknown }> }> } }).preview.steps[0].changes.find((c) => c.field === "rawFilesLink");
  ok("the preview shows the exact new URL in the exact field — the old link only as a fingerprint", !!ch && ch.after === NEW && ch.before === linkRef(OLD) && !JSON.stringify(pv).includes("old123"), ch);
  const stored = JSON.stringify(db.rows("partner_action_plans"));
  ok("the stored plan holds the typed URL (arg + change) and never the old link", stored.includes("new456") && !stored.includes("old123"));
  const reg = ACTION_REGISTRY;
  const forged = { planId: "pl_aaaaaaaaaaaaaaaaaaaa", ownerId: "o", clientId: "c", intentHe: "x", riskClass: "SAFE_REVERSIBLE", confirmation: "C1_APPROVAL", effects: [], createdAt: "2026-09-27T10:00:00Z", expiresAt: "2026-09-27T10:10:00Z", steps: [{ index: 0, actionId: "UPDATE_SOCIAL_CONTENT", actionVersion: 1, phase: "INTERNAL", dependsOn: [], expectedFingerprint: null, entities: [SC], args: { content: SC, notes: "see https://evil.example.com" }, changes: [] }] } as never;
  ok("a URL anywhere else (a text argument) still rejects the whole plan", toPersistablePlan(forged, reg).ok === false);
  const h2 = mk(); const r2 = await fullFlow(mkDeps(h2.writers).d, "SET_SOCIAL_CONTENT_LINKS", { content: SC, removeLink: "storageLink" }, "כן בוס, מאשר");
  ok("removing a link sets the field empty (and verifies)", r2.e?.status === "APPLIED_AS_EXPECTED" && h2.w.social.dropbox_link === "", r2.e?.status);
  ok("YouTube-only for video references (the screen's rule)", (await (async () => { const h3 = mk(); const r = await fullFlow(mkDeps(h3.writers).d, "ADD_RF_VIDEO_REFERENCE", { production: PR, videoLink: "https://vimeo.com/5" }, "כן בוס, מאשר"); return r.e?.status !== "APPLIED_AS_EXPECTED" && h3.w.videoRefs === 1; })()));
  const ip = await planAction({ intentHe: "x", actionId: "IMPORT_DELIVERY_FROM_LINK", args: { project: `project:${U(1)}`, sourceLink: NEW } }, OWNER, mkDeps(mk().writers).d);
  const ipv = await previewAction({ planId: ip.planId }, OWNER, mkDeps(mk().writers).d);
  ok("the intake preview lists exactly the scanned files + categories (names only, no path)", ip.status === "PREVIEW" && JSON.stringify(ip).includes("Song MASTER.wav (מאסטר)") && JSON.stringify(ip).includes("ערוצים/Kick.wav") && !JSON.stringify(ipv).includes("/Projects/"), ip);
  ok("the link kinds are declared (EXTERNAL_LINK) and destructive ones are C3", LINK_PRIMITIVES.filter((x) => x.meta.args.some((a) => a.kind === "url") && x.actionId !== "IMPORT_DELIVERY_FROM_LINK").every((x) => ACTION_REGISTRY.get(x.actionId)!.effects.includes("EXTERNAL_LINK" as never)) && LINK_PRIMITIVES.filter((x) => x.meta.effects.includes("DELETION")).every((x) => ACTION_REGISTRY.get(x.actionId)!.confirmation === "C3_STRONG_APPROVAL"));
  ok("the video-reference PATCH writer accepts only title / notes (hardened — the link / video id / production never change)", /for \(const k of \["title", "notes"\]\)/.test(require("fs").readFileSync("lib/writes/redfilms.ts", "utf8")) && !/\.\.\.body/.test(require("fs").readFileSync("app/api/red-films/reference-links/[linkId]/route.ts", "utf8")));
  ok("brief markers parse like the screen's vocabulary (unknown type refused, custom label kept, none = clear)", (() => { const { parseSegments } = require("../lib/partner/act/primitives/links"); const a = parseSegments("custom:Hook 1-2"); return Array.isArray(a) && a[0].label === "Hook" && typeof parseSegments("rap 0-5") === "string" && Array.isArray(parseSegments("none")) && parseSegments("none").length === 0 && typeof parseSegments("intro 5-1") === "string"; })());

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
