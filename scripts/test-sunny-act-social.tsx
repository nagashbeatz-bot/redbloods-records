/**
 * Universal Action Layer — social: every primitive through the REAL service on fakes (6 standard checks each) + family
 * rules (one campaign per project; the actual spend = ONE linked expense with the exact ₪ amount in the approval;
 * deleting a promotion keeps its expense; no link / URL argument), pinned vocabularies, and the hardened shared writers
 * (field allowlists validated against the app's vocabularies; the preview page's comma-joined platform list accepted).
 * Run with:   npx tsx scripts/test-sunny-act-social.tsx      Pure; never touches production.
 */
import fs from "node:fs";
import path from "node:path";
import { runCases, mkDeps, fullFlow, U, OWNER, type FamilyCase } from "./fixtures/act-harness";
import { planAction } from "../lib/partner/act/service";
import { PROMO_CHANNEL_VALUES, PROMO_STATUS_VALUES, PROMO_TYPE_VALUES, SOCIAL_PRIMITIVES } from "../lib/partner/act/primitives/social";
import { ACTION_REGISTRY, HARDENED, NEEDS_HARDENING } from "../lib/partner/act/registry";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: unknown) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 500)}` : ""}`); } };
const read = (p: string) => fs.readFileSync(path.resolve(__dirname, "..", p), "utf8");

type Row = Record<string, unknown>;
interface W { projects: Record<string, { name: string; artist: string }>; campaigns: Record<string, Row>; content: Record<string, Row>; files: Record<string, Row>; promos: Record<string, Row>; tx: Record<string, number>; storageDeleted: number }
const world = (): W => ({
  projects: { [U(1)]: { name: "סינגל קיץ", artist: "שליו" }, [U(2)]: { name: "אלבום", artist: "דנה" } },
  campaigns: { [U(10)]: { project_id: U(2), title: "קמפיין אלבום", status: "active", release_date: "2026-11-01", marketing_angle: "", target_audience: "", main_message: "", platforms: ["tiktok"], notes: "", promotion_budget: 0 } },
  content: { [U(20)]: { campaign_id: U(10), project_id: U(2), title: "טיזר ראשון", content_type: "טיזר", platform: "tiktok", status: "idea", due_date: null, publish_date: null, publish_time: null, owner_name: "", hook: "", caption: "", notes: "" } },
  files: { [U(30)]: { content_item_id: U(20), file_name: "teaser.mp4" }, [U(31)]: { content_item_id: U(20), file_name: "cover.jpg" } },
  promos: { [U(40)]: { campaign_id: U(10), name: "TikTok boost", channel: "TikTok", promo_type: "קידום ממומן", planned_amount: 500, status: "מתוכנן", promo_date: "2026-10-20", notes: "", linked_transaction_id: null } },
  tx: {}, storageDeleted: 0,
});
function mk() {
  const w = world(); const calls: string[] = []; let n = 500;
  const writers = {
    async readProjectMeta(id: string) { const p = w.projects[id]; return p ? { name: p.name, artist: p.artist, status: "בעבודה", isHidden: false, businessType: "לייבל", projectType: "שיר", hasRelease: true } : null; },
    async readSocialCampaign(id: string) { return w.campaigns[id] ? { ...w.campaigns[id] } : null; },
    async campaignForProject(pid: string) { return Object.entries(w.campaigns).find(([, c]) => c.project_id === pid)?.[0] ?? null; },
    async createSocialCampaign(b: Row) { calls.push("createSocialCampaign"); const id = U(++n); w.campaigns[id] = { marketing_angle: "", target_audience: "", main_message: "", notes: "", promotion_budget: 0, ...b }; return id; },
    async updateSocialCampaign(id: string, b: Row) { calls.push("updateSocialCampaign"); Object.assign(w.campaigns[id], b); },
    async deleteSocialCampaign(id: string) { calls.push("deleteSocialCampaign"); delete w.campaigns[id]; },
    async campaignCounts(id: string) { return { content: Object.values(w.content).filter((c) => c.campaign_id === id).length, promotions: Object.values(w.promos).filter((p) => p.campaign_id === id).length, files: 2 }; },
    async readSocialContent(id: string) { return w.content[id] ? { ...w.content[id] } : null; },
    async createSocialContent(b: Row) { calls.push("createSocialContent"); const id = U(++n); w.content[id] = { platform: null, due_date: null, publish_date: null, publish_time: null, owner_name: "", hook: "", caption: "", notes: "", content_type: "אחר", ...b }; return id; },
    async updateSocialContent(id: string, b: Row) { calls.push("updateSocialContent"); Object.assign(w.content[id], b); },
    async deleteSocialContentWithFiles(id: string) { calls.push("deleteSocialContentWithFiles"); const fs_ = Object.keys(w.files).filter((k) => w.files[k].content_item_id === id); fs_.forEach((k) => { delete w.files[k]; w.storageDeleted++; }); delete w.content[id]; return { files: fs_.length, storageFailures: 0 }; },
    async contentFileCount(id: string) { return Object.values(w.files).filter((f) => f.content_item_id === id).length; },
    async readSocialFile(id: string) { const f = w.files[id]; return f ? { contentItemId: String(f.content_item_id), fileName: String(f.file_name) } : null; },
    async deleteSocialFileWithStorage(id: string) { calls.push("deleteSocialFileWithStorage"); delete w.files[id]; w.storageDeleted++; return { storageFailures: 0 }; },
    async readPromotion(id: string) { const p = w.promos[id]; return p ? { ...p, actual_amount: p.linked_transaction_id ? w.tx[String(p.linked_transaction_id)] : 0 } : null; },
    async createPromotion(i: Row) { calls.push("createPromotion"); const id = U(++n); w.promos[id] = { ...i, linked_transaction_id: null }; return id; },
    async updatePromotionFields(id: string, p: Row) { calls.push("updatePromotionFields"); Object.assign(w.promos[id], p); },
    async syncActualExpense(id: string, amount: number) { calls.push("syncActualExpense"); const p = w.promos[id]; if (p.linked_transaction_id) w.tx[String(p.linked_transaction_id)] = amount; else if (amount > 0) { const t = `tx-${++n}`; w.tx[t] = amount; p.linked_transaction_id = t; } },
    async deletePromotion(id: string) { calls.push("deletePromotion"); delete w.promos[id]; },
  };
  return { w, calls, writers };
}
const P1 = `project:${U(1)}`, P2 = `project:${U(2)}`, C10 = `social-campaign:${U(10)}`, X20 = `social-content:${U(20)}`, F30 = `social-attachment:${U(30)}`, PR40 = `promotion:${U(40)}`;
const CASES: FamilyCase<W>[] = [
  { id: "CREATE_SOCIAL_CAMPAIGN", args: { project: P1, releaseDate: "2026-12-01", platforms: "tiktok, instagram" }, bad: { project: P1, platforms: "myspace" }, missing: { project: `project:${U(9)}` }, wrongKind: { project: C10 }, stale: (w) => { w.campaigns[U(77)] = { project_id: U(1), title: "x", status: "draft" }; }, check: (w) => Object.values(w.campaigns).some((c) => c.project_id === U(1) && c.title === "סינגל קיץ" && c.status === "active" && JSON.stringify(c.platforms) === '["tiktok","instagram"]' && c.artist_name === "שליו") },
  { id: "UPDATE_SOCIAL_CAMPAIGN", args: { campaign: C10, mainMessage: "הקיץ של שליו", promotionBudget: 2000 }, bad: { campaign: C10, status: "live" }, missing: { campaign: `social-campaign:${U(9)}`, notes: "x" }, wrongKind: { campaign: X20, notes: "x" }, stale: (w) => { w.campaigns[U(10)].notes = "q"; }, check: (w) => w.campaigns[U(10)].main_message === "הקיץ של שליו" && w.campaigns[U(10)].promotion_budget === 2000 },
  { id: "DELETE_SOCIAL_CAMPAIGN", args: { campaign: C10 }, confirm: "כן בוס, מחיקה", bad: { campaign: "social-campaign:1" }, missing: { campaign: `social-campaign:${U(9)}` }, stale: (w) => { w.content[U(21)] = { campaign_id: U(10), title: "חדש" }; }, check: (w) => !w.campaigns[U(10)] },
  { id: "ADD_SOCIAL_CONTENT", args: { campaign: C10, title: "BTS מהאולפן", contentType: "BTS", platforms: "instagram", status: "needs_shoot", dueDate: "2026-10-15" }, bad: { campaign: C10, title: "x", contentType: "וידאו" }, missing: { campaign: `social-campaign:${U(9)}`, title: "x" }, stale: (w) => { w.campaigns[U(10)].title = "שונה"; }, check: (w) => Object.values(w.content).some((c) => c.title === "BTS מהאולפן" && c.status === "needs_shoot" && c.platform === "instagram" && c.due_date === "2026-10-15" && c.project_id === U(2)) },
  { id: "UPDATE_SOCIAL_CONTENT", args: { content: X20, status: "ready", publishDate: "2026-10-25", publishTime: "20:00" }, bad: { content: X20, status: "viral" }, missing: { content: `social-content:${U(9)}`, status: "ready" }, wrongKind: { content: C10, status: "ready" }, stale: (w) => { w.content[U(20)].hook = "x"; }, check: (w) => w.content[U(20)].status === "ready" && w.content[U(20)].publish_date === "2026-10-25" && w.content[U(20)].publish_time === "20:00" },
  { id: "DELETE_SOCIAL_CONTENT", args: { content: X20 }, confirm: "כן בוס, מחיקה", bad: { content: "social-content:1" }, missing: { content: `social-content:${U(9)}` }, stale: (w) => { w.files[U(32)] = { content_item_id: U(20), file_name: "z" }; }, check: (w) => !w.content[U(20)] && w.storageDeleted === 2 },
  { id: "DELETE_SOCIAL_FILE", args: { socialFile: F30 }, confirm: "כן בוס, מחיקה", bad: { socialFile: "social-attachment:1" }, missing: { socialFile: `social-attachment:${U(9)}` }, stale: (w) => { w.files[U(30)].file_name = "renamed.mp4"; }, check: (w) => !w.files[U(30)] && !!w.files[U(31)] },
  { id: "ADD_PROMOTION", args: { campaign: C10, name: "Instagram ads", channel: "Instagram", plannedAmount: 800 }, bad: { campaign: C10, name: "x", channel: "Facebook" }, missing: { campaign: `social-campaign:${U(9)}`, name: "x" }, stale: (w) => { w.campaigns[U(10)].title = "שונה"; }, check: (w) => Object.values(w.promos).some((p) => p.name === "Instagram ads" && p.planned_amount === 800 && p.status === "מתוכנן" && p.promo_type === "קידום ממומן") },
  { id: "UPDATE_PROMOTION", args: { promotion: PR40, status: "פעיל", plannedAmount: 650 }, bad: { promotion: PR40, status: "הושלם" }, missing: { promotion: `promotion:${U(9)}`, status: "פעיל" }, wrongKind: { promotion: C10, status: "פעיל" }, stale: (w) => { w.promos[U(40)].notes = "x"; }, check: (w) => w.promos[U(40)].status === "פעיל" && w.promos[U(40)].planned_amount === 650 },
  { id: "SET_PROMOTION_ACTUAL_SPEND", args: { promotion: PR40, amount: 480 }, confirm: "כן בוס, ₪480", bad: { promotion: PR40, amount: -5 }, missing: { promotion: `promotion:${U(9)}`, amount: 1 }, stale: (w) => { w.promos[U(40)].planned_amount = 700; }, check: (w, calls) => Object.values(w.tx).join() === "480" && calls.filter((c) => c === "syncActualExpense").length === 1 },
  { id: "DELETE_PROMOTION", args: { promotion: PR40 }, confirm: "כן בוס, מחיקה", bad: { promotion: "promotion:1" }, missing: { promotion: `promotion:${U(9)}` }, stale: (w) => { w.promos[U(40)].status = "בוטל"; }, check: (w) => !w.promos[U(40)] },
];

(async () => {
  console.log("Social — standard checks");
  ok("the case table covers every social primitive", CASES.map((c) => c.id).sort().join() === SOCIAL_PRIMITIVES.map((p) => p.actionId).sort().join());
  await runCases(CASES, mk, ok);

  console.log("\nFamily rules");
  const q = (id: string, args: Record<string, unknown>, h = mk()) => planAction({ intentHe: "x", actionId: id, args }, OWNER, mkDeps(h.writers).d);
  ok("one campaign per project", (await q("CREATE_SOCIAL_CAMPAIGN", { project: P2 })).status === "DUPLICATE");
  const m = mk(); const r0 = await fullFlow(mkDeps(m.writers).d, "SET_PROMOTION_ACTUAL_SPEND", { promotion: PR40, amount: 480 }, "מאשר");
  ok("the actual spend: the preview shows ₪480; a plain \"מאשר\" records exactly that", JSON.stringify(r0.p).includes("480") && r0.e?.status === "APPLIED_AS_EXPECTED", r0.e?.status);
  const tw = mk(); const d = mkDeps(tw.writers).d;
  await fullFlow(d, "SET_PROMOTION_ACTUAL_SPEND", { promotion: PR40, amount: 480 }, "כן בוס, ₪480");
  const r2 = await fullFlow(d, "SET_PROMOTION_ACTUAL_SPEND", { promotion: PR40, amount: 520 }, "כן בוס, ₪520");
  ok("a second spend updates the SAME expense (never a second transaction)", r2.e?.status === "APPLIED_AS_EXPECTED" && Object.keys(tw.w.tx).length === 1 && Object.values(tw.w.tx)[0] === 520);
  ok("zero spend without an expense is a no-op refusal", (await q("SET_PROMOTION_ACTUAL_SPEND", { promotion: PR40, amount: 0 })).status === "NO_CHANGE_NEEDED");
  const dp = mk(); dp.w.promos[U(40)].linked_transaction_id = "tx-1"; dp.w.tx["tx-1"] = 300;
  const pd = await q("DELETE_PROMOTION", { promotion: PR40 }, dp);
  ok("deleting a promotion warns that its expense stays", JSON.stringify(pd).includes("נשארת"));
  ok("no link / URL argument exists in the family", SOCIAL_PRIMITIVES.every((p) => p.meta.args.every((a) => !/url|link|asset|dropbox/i.test(a.name))));
  ok("the spend is FINANCIAL (C2); deletes are C3", ACTION_REGISTRY.get("SET_PROMOTION_ACTUAL_SPEND")!.effects.includes("FINANCE" as never) && ["DELETE_SOCIAL_CAMPAIGN", "DELETE_SOCIAL_CONTENT", "DELETE_SOCIAL_FILE", "DELETE_PROMOTION"].every((id) => ACTION_REGISTRY.get(id)!.confirmation === "C3_STRONG_APPROVAL"));
  ok("PROJECT.SOCIAL moved from NEEDS_HARDENING to HARDENED", !("PROJECT.SOCIAL" in NEEDS_HARDENING) && "PROJECT.SOCIAL" in HARDENED);

  console.log("\nVocabularies + shared writers");
  const sp = read("components/social/SocialPromotions.tsx");
  ok("promotion channel / type / status = the promotions screen", sp.includes(`const CHANNELS = [${PROMO_CHANNEL_VALUES.map((x) => `"${x}"`).join(", ")}]`) && sp.includes(`const TYPES    = [${PROMO_TYPE_VALUES.map((x) => `"${x}"`).join(", ")}]`) && sp.includes(`const STATUSES = [${PROMO_STATUS_VALUES.map((x) => `"${x}"`).join(", ")}]`));
  const ws = read("lib/writes/social.ts");
  ok("the writers keep field allowlists (no whole-body write) and accept the preview's comma-joined platform list", /const CAMPAIGN_FIELDS = \[/.test(ws) && /const CONTENT_FIELDS = \[/.test(ws) && /v\.split\(","\)\.every/.test(ws) && /שדות לא מותרים/.test(ws));
  ok("the campaign / content / file routes use the shared writers", /createSocialCampaign\(/.test(read("app/api/social/campaigns/route.ts")) && /updateSocialCampaign\(/.test(read("app/api/social/campaigns/[id]/route.ts")) && /createSocialContent\(/.test(read("app/api/social/content/route.ts")) && /updateSocialContent\(/.test(read("app/api/social/content/[id]/route.ts")) && /deleteSocialContentWithFiles\(/.test(read("app/api/social/content/[id]/route.ts")) && /deleteSocialFileWithStorage\(/.test(read("app/api/social/files/route.ts")));
  ok("every field the screens send is allowed (campaign summary, create modal, content editors, budget)", ["marketing_angle", "target_audience", "main_message", "platforms", "promotion_budget", "title", "artist_name", "release_date", "status"].every((f) => ws.includes(`"${f}"`)) && ["content_type", "platform", "due_date", "publish_date", "publish_time", "owner_name", "hook", "caption", "asset_link", "dropbox_link", "posted_url", "notes"].every((f) => ws.includes(`"${f}"`)));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
