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
import { CUSTOM_FRESH_READ, PARTIAL_VERIFIED } from "../lib/partner/act/verify-kind";
import { ilYmd, addDays, targetProblem, TARGET_PROBLEM_HE, type CadenceTargetRow } from "../lib/social-cadence";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: unknown) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 500)}` : ""}`); } };
const read = (p: string) => fs.readFileSync(path.resolve(__dirname, "..", p), "utf8");

type Row = Record<string, unknown>;
interface W { artists: Record<string, string>; projects: Record<string, { name: string; artist: string }>; campaigns: Record<string, Row>; content: Record<string, Row>; files: Record<string, Row>; promos: Record<string, Row>; tx: Record<string, number>; storageDeleted: number; series: Record<string, Row>; targets: CadenceTargetRow[] }
const world = (): W => ({
  artists: { [U(60)]: "שליו טסמה" },
  projects: { [U(1)]: { name: "סינגל קיץ", artist: "שליו" }, [U(2)]: { name: "אלבום", artist: "דנה" } },
  campaigns: { [U(10)]: { project_id: U(2), title: "קמפיין אלבום", status: "active", release_date: "2026-11-01", marketing_angle: "", target_audience: "", main_message: "", platforms: ["tiktok"], notes: "", promotion_budget: 0 } },
  content: { [U(21)]: { campaign_id: null, label_artist_id: U(60), project_id: null, title: "פריסטייל", content_type: "ריל", platform: "youtube,instagram", status: "idea", due_date: null, publish_date: null, publish_time: null, owner_name: "", hook: "", caption: "", notes: "" }, [U(20)]: { campaign_id: U(10), project_id: U(2), title: "טיזר ראשון", content_type: "טיזר", platform: "tiktok", status: "idea", due_date: null, publish_date: null, publish_time: null, owner_name: "", hook: "", caption: "", notes: "" } },
  files: { [U(30)]: { content_item_id: U(20), file_name: "teaser.mp4" }, [U(31)]: { content_item_id: U(20), file_name: "cover.jpg" } },
  promos: { [U(40)]: { campaign_id: U(10), name: "TikTok boost", channel: "TikTok", promo_type: "קידום ממומן", planned_amount: 500, status: "מתוכנן", promo_date: "2026-10-20", notes: "", linked_transaction_id: null } },
  tx: {}, storageDeleted: 0,
  // stage 2: an artist series + one existing overall target (3 / week, since the 1st)
  series: { [U(70)]: { id: U(70), name: "Red Bars", owner_scope: "ARTIST", label_artist_id: U(60), platforms: ["youtube"], status: "ACTIVE", notes: "" } },
  targets: [{ id: U(80), scope: "OVERALL", label_artist_id: U(60), series_id: null, platform: null, content_type: null, action: "SET", per_week: 3, valid_from: "2026-10-01", valid_until: null, supersedes_id: null, source: "OWNER_STATEMENT", recommendation_id: null, note_he: null, created_at: "2026-10-01T08:00:00Z" }],
});
const TODAY = ilYmd(new Date());
function mk() {
  const w = world(); const calls: string[] = []; let n = 500;
  const writers = {
    async readProjectMeta(id: string) { const p = w.projects[id]; return p ? { name: p.name, artist: p.artist, status: "בעבודה", isHidden: false, businessType: "לייבל", projectType: "שיר", hasRelease: true } : null; },
    async readSocialCampaign(id: string) { return w.campaigns[id] ? { ...w.campaigns[id] } : null; },
    async campaignForProject(pid: string) { return Object.entries(w.campaigns).find(([, c]) => c.project_id === pid)?.[0] ?? null; },
    async createSocialCampaign(b: Row) { calls.push("createSocialCampaign"); const id = U(++n); w.campaigns[id] = { marketing_angle: "", target_audience: "", main_message: "", notes: "", promotion_budget: 0, ...b }; return id; },
    async updateSocialCampaign(id: string, b: Row) { calls.push("updateSocialCampaign"); Object.assign(w.campaigns[id], b); },
    async deleteSocialCampaign(id: string) { calls.push("deleteSocialCampaign"); delete w.campaigns[id]; },
    async campaignCounts(id: string) { return { content: Object.values(w.content).filter((c) => c.campaign_id === id).length, promotions: Object.values(w.promos).filter((p) => p.campaign_id === id).length, files: 2, artistContentKept: Object.values(w.content).filter((c) => c.campaign_id === id && c.label_artist_id).length }; },
    async readLabelArtist(id: string) { return w.artists[id] ? { name: w.artists[id], notes: "", status: "פעיל" } : null; },
    async linkSocialCampaignArtist(cid: string, aid: string) { calls.push("linkSocialCampaignArtist"); const c = w.campaigns[cid]; if (c.label_artist_id && c.label_artist_id !== aid) throw new Error("other artist"); c.label_artist_id = aid; let n_ = 0; for (const x of Object.values(w.content)) if (x.campaign_id === cid && !x.label_artist_id) { x.label_artist_id = aid; n_++; } return { campaign: true, items: n_ }; },
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
    async readSocialSeries(id: string) { return w.series[id] ? { ...w.series[id] } : null; },
    async listSocialSeries() { return Object.values(w.series).map((x) => ({ ...x })); },
    async createSocialSeries(b: Row) { calls.push("createSocialSeries"); const id = U(++n); w.series[id] = { id, status: "ACTIVE", ...b }; return id; },
    async updateSocialSeries(id: string, b: Row) { calls.push("updateSocialSeries"); Object.assign(w.series[id], b); },
    async listSocialTargets() { return w.targets.map((t) => ({ ...t })); },
    // the fake mirrors the writer + DB guard: the SAME targetProblem refuses before anything is stored
    async setSocialCadenceTarget(b: Row) { calls.push("setSocialCadenceTarget"); const row = { scope: b.scope, label_artist_id: b.scope === "SERIES" ? (w.series[String(b.series_id)]?.label_artist_id ?? null) : b.label_artist_id ?? null, series_id: b.series_id ?? null, platform: b.platform ?? null, content_type: b.content_type ?? null, action: b.action, per_week: b.per_week ?? null, valid_from: b.valid_from, valid_until: b.valid_until ?? null, supersedes_id: b.supersedes_id ?? null, source: b.source, recommendation_id: b.recommendation_id ?? null, note_he: b.note_he ?? null } as Omit<CadenceTargetRow, "id" | "created_at">; const pr = targetProblem(row, w.targets, TODAY); if (pr) throw new Error(pr); const id = U(++n); w.targets.push({ ...row, id, created_at: new Date().toISOString() }); return id; },
  };
  return { w, calls, writers };
}
const LA60 = `label-artist:${U(60)}`, S70 = `social-series:${U(70)}`, T80 = `social-target:${U(80)}`, X21 = `social-content:${U(21)}`;
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
  // stage 1 (2026-10-17): an artist's own content (no campaign) + the campaign → artist link
  { id: "ADD_SOCIAL_CONTENT", args: { artist: `label-artist:${U(60)}`, title: "רילס בין ריליסים", contentType: "BTS", status: "idea" }, bad: { artist: `label-artist:${U(60)}`, title: "" }, missing: { artist: `label-artist:${U(61)}`, title: "x" }, stale: (w) => { w.artists[U(60)] = "שליו ט."; }, check: (w) => Object.values(w.content).some((c) => c.title === "רילס בין ריליסים" && c.campaign_id === null && c.label_artist_id === U(60)) },
  { id: "LINK_SOCIAL_CAMPAIGN_ARTIST", args: { campaign: C10, artist: `label-artist:${U(60)}` }, bad: { campaign: C10, artist: "shalev" }, missing: { campaign: `social-campaign:${U(9)}`, artist: `label-artist:${U(60)}` }, wrongKind: { campaign: X20, artist: `label-artist:${U(60)}` }, stale: (w) => { w.content[U(89)] = { campaign_id: U(10), title: "חדש" }; }, check: (w, calls) => w.campaigns[U(10)].label_artist_id === U(60) && w.content[U(20)].label_artist_id === U(60) && calls.includes("linkSocialCampaignArtist") },
  // stage 2 (2026-10-17): series + weekly targets + series assignment
  { id: "CREATE_SOCIAL_SERIES", args: { name: "סשנים בלייב", owner: "ARTIST", artist: LA60, platforms: "instagram" }, bad: { name: "", owner: "ARTIST", artist: LA60 }, missing: { name: "x", owner: "ARTIST", artist: `label-artist:${U(61)}` }, stale: (w) => { w.artists[U(60)] = "שליו ט."; }, check: (w, calls) => Object.values(w.series).some((x) => x.name === "סשנים בלייב" && x.owner_scope === "ARTIST" && x.label_artist_id === U(60) && x.status === "ACTIVE" && JSON.stringify(x.platforms) === '["instagram"]') && calls.includes("createSocialSeries") },
  { id: "UPDATE_SOCIAL_SERIES", args: { series: S70, status: "PAUSED", notes: "הפסקה עד אחרי הסינגל" }, bad: { series: S70, status: "DONE" }, missing: { series: `social-series:${U(9)}`, status: "PAUSED" }, wrongKind: { series: X20, status: "PAUSED" }, stale: (w) => { w.series[U(70)].notes = "x"; }, check: (w) => w.series[U(70)].status === "PAUSED" && w.series[U(70)].notes === "הפסקה עד אחרי הסינגל" && w.series[U(70)].label_artist_id === U(60) },
  { id: "SET_SOCIAL_CADENCE_TARGET", args: { scope: "OVERALL", artist: LA60, perWeek: 4 }, bad: { scope: "OVERALL", artist: LA60, perWeek: 0 }, missing: { scope: "OVERALL", artist: `label-artist:${U(61)}`, perWeek: 3 }, stale: (w) => { w.targets.push({ ...w.targets[0], id: U(81), per_week: 5, supersedes_id: U(80), valid_from: TODAY }); }, check: (w) => w.targets.length === 2 && w.targets[1].per_week === 4 && w.targets[1].supersedes_id === U(80) && w.targets[1].valid_from === TODAY && w.targets[1].source === "OWNER_STATEMENT" && w.targets[0].per_week === 3 },
  { id: "END_SOCIAL_CADENCE_TARGET", args: { target: T80 }, bad: { target: "social-target:1" }, missing: { target: `social-target:${U(9)}` }, wrongKind: { target: S70 }, stale: (w) => { w.targets[0].per_week = 5; }, check: (w) => w.targets.length === 2 && w.targets[1].action === "END" && w.targets[1].supersedes_id === U(80) && w.targets[1].valid_from === TODAY },
  { id: "ASSIGN_SOCIAL_CONTENT_SERIES", args: { content: X21, series: S70 }, bad: { content: X21 }, missing: { content: `social-content:${U(9)}`, series: S70 }, wrongKind: { content: C10, series: S70 }, stale: (w) => { w.content[U(21)].title = "שונה"; }, check: (w) => w.content[U(21)].series_id === U(70) && w.content[U(21)].label_artist_id === U(60) },
];

(async () => {
  console.log("Social — standard checks");
  ok("the case table covers every social primitive", [...new Set(CASES.map((c) => c.id))].sort().join() === SOCIAL_PRIMITIVES.map((p) => p.actionId).sort().join());
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
  ok("A5: deleting a promotion discloses the provenance marker written into the kept expense", JSON.stringify(pd).includes("קידום נמחק"));
  { const up = mk(); up.w.promos[U(40)].linked_transaction_id = "tx-9"; up.w.tx["tx-9"] = 300; const base = up.writers.readPromotion; up.writers.readPromotion = async (id: string) => { const r = await base(id); return r ? { ...r, actual_amount: 0, linked_amount: 300, actual_currency: "$", linked_status: "בוטל" } : null; };
    const r = await q("SET_PROMOTION_ACTUAL_SPEND", { promotion: PR40, amount: 350 }, up);
    ok("A5: an unpaid / cancelled linked expense is disclosed as NOT spend, and the amount keeps its own currency ($)", r.status === "PREVIEW" && JSON.stringify(r).includes("לא נספרת") && JSON.stringify(r).includes("$350"), r); }
  const ps = read("lib/social-promotions-store.ts"), ss = read("lib/social-store.ts");
  ok("A5: promotion / campaign delete marks the transaction BEFORE the row delete, and a 0-row sync update is an error", ps.indexOf("await markPromotionTransactionDetached(row") < ps.indexOf('from(TABLE).delete().eq("id", id)') && ss.indexOf("detachCampaignPromotions(id)") < ss.indexOf('from("social_campaigns").delete()') && /upd\.length !== 1/.test(ps));
  ok("no link / URL argument exists in the family", SOCIAL_PRIMITIVES.every((p) => p.meta.args.every((a) => !/url|link|asset|dropbox/i.test(a.name))));
  ok("the spend is FINANCIAL (C2); deletes are C3", ACTION_REGISTRY.get("SET_PROMOTION_ACTUAL_SPEND")!.effects.includes("FINANCE" as never) && ["DELETE_SOCIAL_CAMPAIGN", "DELETE_SOCIAL_CONTENT", "DELETE_SOCIAL_FILE", "DELETE_PROMOTION"].every((id) => ACTION_REGISTRY.get(id)!.confirmation === "C3_STRONG_APPROVAL"));
  ok("PROJECT.SOCIAL moved from NEEDS_HARDENING to HARDENED", !("PROJECT.SOCIAL" in NEEDS_HARDENING) && "PROJECT.SOCIAL" in HARDENED);

  console.log("\nStage 2 — series + weekly targets");
  { const h = mk(); ok("an artist series takes only that artist's content (campaign content with no artist → refused)", (await q("ASSIGN_SOCIAL_CONTENT_SERIES", { content: X20, series: S70 }, h)).status === "SERIES_ARTIST_MISMATCH" && h.calls.length === 0); }
  { const h = mk(); h.w.series[U(70)].status = "ENDED"; ok("an ended series takes no new content", (await q("ASSIGN_SOCIAL_CONTENT_SERIES", { content: X21, series: S70 }, h)).status === "SERIES_ENDED"); }
  { const h = mk(); const r = await fullFlow(mkDeps(h.writers).d, "ADD_SOCIAL_CONTENT", { series: S70, title: "Red Bars #4" }, "מאשר");
    ok("ADD_SOCIAL_CONTENT with only a series: the artist series gives its artist", r.e?.status === "APPLIED_AS_EXPECTED" && Object.values(h.w.content).some((c) => c.title === "Red Bars #4" && c.series_id === U(70) && c.label_artist_id === U(60) && c.campaign_id === null), r.e?.status); }
  { const h = mk(); h.w.series[U(70)].status = "ENDED"; ok("an ended series cannot reopen", (await q("UPDATE_SOCIAL_SERIES", { series: S70, status: "ACTIVE" }, h)).status === "SERIES_ENDED"); }
  ok("a series owner never changes (no owner / artist argument on update)", !ACTION_REGISTRY.get("UPDATE_SOCIAL_SERIES")!.args.some((a) => a.name === "owner" || a.name === "artist"));
  { const h = mk(); ok("a target equal to the current one = NO_CHANGE (no row)", (await q("SET_SOCIAL_CADENCE_TARGET", { scope: "OVERALL", artist: LA60, perWeek: 3 }, h)).status === "NO_CHANGE"); }
  { const h = mk(); ok("a target is never backdated", (await q("SET_SOCIAL_CADENCE_TARGET", { scope: "OVERALL", artist: LA60, perWeek: 5, validFrom: addDays(TODAY, -1) }, h)).status === "TARGET_BACKDATED"); }
  { const h = mk(); const p = await q("SET_SOCIAL_CADENCE_TARGET", { scope: "OVERALL", artist: LA60, perWeek: 5 }, h);
    ok("the preview of a replacement shows the old target (3) and the new (5), and that history stays", p.status === "PREVIEW" && JSON.stringify(p).includes("3 בשבוע") && JSON.stringify(p).includes("5 בשבוע") && JSON.stringify(p).includes("היסטוריה"), p); }
  { const h = mk(); const d2 = mkDeps(h.writers).d;
    const a1 = await fullFlow(d2, "SET_SOCIAL_CADENCE_TARGET", { scope: "BREAKDOWN", artist: LA60, platform: "youtube", perWeek: 2 }, "מאשר");
    const a2 = await fullFlow(d2, "SET_SOCIAL_CADENCE_TARGET", { scope: "BREAKDOWN", artist: LA60, contentType: "ריל", perWeek: 1 }, "מאשר");
    ok("an overlapping breakdown (platform vs content type) is refused by the shared rule — nothing stored", a1.e?.status === "APPLIED_AS_EXPECTED" && a2.e?.status !== "APPLIED_AS_EXPECTED" && h.w.targets.length === 2, { a1: a1.e?.status, a2: a2.p.status, ex: a2.e?.status }); }
  { const h = mk(); ok("a SERIES target is set by the series (an artist argument is refused)", (await q("SET_SOCIAL_CADENCE_TARGET", { scope: "SERIES", series: S70, artist: LA60, perWeek: 1 }, h)).status === "BAD_ENTITY"); }
  { const h = mk(); const r = await fullFlow(mkDeps(h.writers).d, "SET_SOCIAL_CADENCE_TARGET", { scope: "SERIES", series: S70, perWeek: 1, recommendationId: U(99) }, "מאשר");
    ok("a target from an approved recommendation stores the source + the recommendation", r.e?.status === "APPLIED_AS_EXPECTED" && h.w.targets.some((t) => t.scope === "SERIES" && t.series_id === U(70) && t.label_artist_id === U(60) && t.source === "OWNER_APPROVED_RECOMMENDATION" && t.recommendation_id === U(99)), r.e?.status); }
  { const h = mk(); h.w.targets.push({ ...h.w.targets[0], id: U(82), per_week: 4, supersedes_id: U(80), valid_from: TODAY }); ok("ending an already replaced target is refused", (await q("END_SOCIAL_CADENCE_TARGET", { target: T80 }, h)).status === "TARGET_HAS_SUCCESSOR"); }
  { const h = mk(); const args = { name: "Red Bars 2", owner: "ARTIST", artist: LA60, platforms: "instagram, tiktok", notes: "ורס פריסטייל של כ-40 שניות" };
    const p = await q("CREATE_SOCIAL_SERIES", args, h);
    const shown = JSON.stringify(p);
    ok("the series preview shows EVERY value it will store (name, owner, platforms, definition, status)", p.status === "PREVIEW" && shown.includes("instagram,tiktok") && shown.includes("ורס פריסטייל של כ-40 שניות") && shown.includes("ACTIVE") && shown.includes("Red Bars 2"), p);
    const r = await fullFlow(mkDeps(h.writers).d, "CREATE_SOCIAL_SERIES", args, "מאשר");
    const fs_ = JSON.stringify((r.e as { freshState?: unknown } | undefined)?.freshState ?? null);
    ok("after execution the read-back returns every stored field (platforms + definition) for Sunny to verify", r.e?.status === "APPLIED_AS_EXPECTED" && fs_.includes("instagram,tiktok") && fs_.includes("ורס פריסטייל של כ-40 שניות"), fs_); }
  { const h = mk(); const base = h.writers.createSocialSeries; h.writers.createSocialSeries = async (b: Row) => base({ ...b, notes: "" });
    const r = await fullFlow(mkDeps(h.writers).d, "CREATE_SOCIAL_SERIES", { name: "Red Bars 3", owner: "ARTIST", artist: LA60, platforms: "instagram", notes: "הגדרה" }, "מאשר");
    ok("a create whose stored definition differs from the preview is NOT reported as done", r.e?.status !== "APPLIED_AS_EXPECTED", r.e?.status); }
  ok("series create verification is a full fresh read (every planned value), not partial", !PARTIAL_VERIFIED.has("CREATE_SOCIAL_SERIES") && CUSTOM_FRESH_READ.has("CREATE_SOCIAL_SERIES"));
  ok("no target / series action has a delete, push, calendar or finance effect", ["CREATE_SOCIAL_SERIES", "UPDATE_SOCIAL_SERIES", "SET_SOCIAL_CADENCE_TARGET", "END_SOCIAL_CADENCE_TARGET", "ASSIGN_SOCIAL_CONTENT_SERIES"].every((id) => ACTION_REGISTRY.get(id)!.effects.length === 0));
  ok("the Hebrew problem texts exist for every guard code", ["TARGET_BACKDATED", "TARGET_OVERLAP", "BREAKDOWN_OVERLAP", "TARGET_HAS_SUCCESSOR", "SERIES_ARTIST_MISMATCH"].every((k) => !!TARGET_PROBLEM_HE[k as keyof typeof TARGET_PROBLEM_HE]));
  ok("the series / target routes use the shared writers and are Owner-only in the route (no DELETE)", /createSocialSeries\(/.test(read("app/api/social/series/route.ts")) && /updateSocialSeries\(/.test(read("app/api/social/series/[id]/route.ts")) && /setSocialCadenceTarget\(/.test(read("app/api/social/targets/route.ts")) && ["app/api/social/series/route.ts", "app/api/social/series/[id]/route.ts", "app/api/social/targets/route.ts"].every((f) => /requireOwner/.test(read(f)) && !/export async function DELETE/.test(read(f))));

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
