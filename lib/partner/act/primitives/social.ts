/**
 * SUNNY UNIVERSAL ACTION LAYER — social: campaigns (one per project), content items, their stored files and paid
 * promotions. Writes go through lib/writes/social — the validated writers the social screens use. Link / URL fields
 * (asset link, storage link, posted URL) are never plan values (plans never persist URLs); uploading a file needs a
 * new file's bytes (the file channel). A promotion's ACTUAL spend is one linked Finance expense (₪, שולם, scope שיווק)
 * — planned amounts and the campaign budget are planning only. The social checklist is the app's, never a verdict.
 */
import type { ArgSpec } from "../types";
import { artistFields, finishPlan, parseKey, realYmd, refuse, text, type Fields, type PlanRefusal, type PrimitiveMeta, type PrimitiveSpec, type ResolvedTarget, type WriterDeps } from "./core";
import { SOCIAL_CAMPAIGN_STATUSES, SOCIAL_CONTENT_STATUSES, SOCIAL_CONTENT_TYPES, SOCIAL_PLATFORMS } from "@/lib/types";

type Row = Record<string, unknown>;
export interface SocialFamilyWriters {
  readSocialCampaign(id: string): Promise<Row | null>;
  campaignForProject(projectId: string): Promise<string | null>;
  createSocialCampaign(body: Row): Promise<string>;
  updateSocialCampaign(id: string, body: Row): Promise<void>;
  deleteSocialCampaign(id: string): Promise<void>;
  campaignCounts(id: string): Promise<{ content: number; promotions: number; files: number; artistContentKept?: number }>;
  /** Stage 1 (2026-10-17): link a campaign + its artist-less content to a label artist (compare-and-swap, never overwrites). */
  linkSocialCampaignArtist(campaignId: string, labelArtistId: string): Promise<{ campaign: boolean; items: number }>;
  readSocialContent(id: string): Promise<Row | null>;
  createSocialContent(body: Row): Promise<string>;
  updateSocialContent(id: string, body: Row): Promise<void>;
  deleteSocialContentWithFiles(id: string): Promise<{ files: number; storageFailures: number }>;
  contentFileCount(id: string): Promise<number>;
  readSocialFile(id: string): Promise<{ contentItemId: string | null; fileName: string | null } | null>;
  deleteSocialFileWithStorage(id: string): Promise<{ storageFailures: number }>;
  readPromotion(id: string): Promise<Row | null>;
  createPromotion(input: { campaign_id: string; channel: string; promo_type: string; name: string; planned_amount: number; status: string; promo_date: string | null; notes: string }): Promise<string>;
  updatePromotionFields(id: string, patch: Row): Promise<void>;
  syncActualExpense(id: string, amount: number): Promise<void>;
  deletePromotion(id: string): Promise<void>;
}
/** Pinned to components/social/SocialPromotions.tsx + lib/writes/social by the family test. */
export const PROMO_CHANNEL_VALUES: readonly string[] = ["YouTube", "TikTok", "Instagram", "אחר"];
export const PROMO_TYPE_VALUES: readonly string[] = ["קידום ממומן", "רקדן / יוצר תוכן", "משפיען", "עמוד תוכן", "אחר"];
export const PROMO_STATUS_VALUES: readonly string[] = ["מתוכנן", "פעיל", "בוצע", "בוטל"];
const CAMPAIGN_STATUS = SOCIAL_CAMPAIGN_STATUSES as readonly string[];
const CONTENT_STATUS = SOCIAL_CONTENT_STATUSES as readonly string[];
const CONTENT_TYPES = SOCIAL_CONTENT_TYPES as readonly string[];
const PLATFORMS = SOCIAL_PLATFORMS as readonly string[];

const K = (name: string, required = true): ArgSpec => ({ name, kind: "entityKey", required });
const T = (name: string, required = false): ArgSpec => ({ name, kind: "text", required });
const E = (name: string, values: readonly string[], required = false): ArgSpec => ({ name, kind: "enum", required, values });
const D = (name: string): ArgSpec => ({ name, kind: "ymd", required: false });
const M = (name: string, required = false): ArgSpec => ({ name, kind: "money", required });
const meta = (he: string, en: string, args: readonly ArgSpec[], fields: readonly string[], writer: string, o: Partial<PrimitiveMeta>): PrimitiveMeta =>
  ({ domain: "SOCIAL", he, en, args, fields, effects: [], riskClass: "SAFE_REVERSIBLE", reversible: "YES", writer, compensation: "a new approved plan restoring the previous values shown in the preview", ...o });
const isRef = (x: unknown): x is PlanRefusal => !!x && typeof x === "object" && (x as { ok?: unknown }).ok === false;
const s = (v: unknown) => (v === null || v === undefined ? null : String(v));

/** "tiktok, instagram" → validated platform list. */
function platformsOf(v: unknown): string[] | PlanRefusal {
  const xs = String(v).split(",").map((x) => x.trim()).filter(Boolean);
  return xs.length && xs.every((x) => PLATFORMS.includes(x)) ? [...new Set(xs)] : refuse("BAD_PLATFORMS", `פלטפורמות: ${PLATFORMS.join(", ")}`);
}
const textArg = (a: Readonly<Record<string, unknown>>, k: string, max = 2000): string | PlanRefusal | undefined => {
  if (a[k] === undefined) return undefined;
  if (a[k] === "") return "";
  const t = text(a[k], max); return t === null ? refuse("BAD_TEXT", `${k} לא תקין`) : t.trim();
};

// ── readers ──
const campaignFields = async (d: WriterDeps, id: string): Promise<Fields | null> => { const r = await d.readSocialCampaign(id); return r ? { projectId: s(r.project_id), labelArtistId: s(r.label_artist_id), title: String(r.title ?? ""), status: String(r.status ?? ""), releaseDate: s(r.release_date), marketingAngle: String(r.marketing_angle ?? ""), targetAudience: String(r.target_audience ?? ""), mainMessage: String(r.main_message ?? ""), platforms: (Array.isArray(r.platforms) ? r.platforms : []).map(String).join(","), notes: String(r.notes ?? ""), promotionBudget: Number(r.promotion_budget) || 0 } : null; };
async function onCampaign(d: WriterDeps, a: Readonly<Record<string, unknown>>): Promise<ResolvedTarget | PlanRefusal> {
  const k = parseKey(a.campaign, ["social-campaign"]); if (!k) return refuse("BAD_ENTITY", "צריך קמפיין (social-campaign:…)");
  const f = await campaignFields(d, k.id); if (!f) return refuse("ENTITY_NOT_FOUND", "לא מצאתי את הקמפיין");
  return { key: `social-campaign:${k.id}`, id: k.id, label: `קמפיין ${f.title}`, fields: f };
}
const contentFields = async (d: WriterDeps, id: string): Promise<Fields | null> => { const r = await d.readSocialContent(id); return r ? { campaignId: s(r.campaign_id), labelArtistId: s(r.label_artist_id), title: String(r.title ?? ""), contentType: String(r.content_type ?? ""), platform: s(r.platform), status: String(r.status ?? ""), dueDate: s(r.due_date), publishDate: s(r.publish_date), publishTime: s(r.publish_time), ownerName: String(r.owner_name ?? ""), hook: String(r.hook ?? ""), caption: String(r.caption ?? ""), notes: String(r.notes ?? "") } : null; };
async function onContent(d: WriterDeps, a: Readonly<Record<string, unknown>>): Promise<ResolvedTarget | PlanRefusal> {
  const k = parseKey(a.content, ["social-content"]); if (!k) return refuse("BAD_ENTITY", "צריך פריט תוכן (social-content:…)");
  const f = await contentFields(d, k.id); if (!f) return refuse("ENTITY_NOT_FOUND", "לא מצאתי את פריט התוכן");
  return { key: `social-content:${k.id}`, id: k.id, label: `${f.contentType} · ${f.title}`, fields: f };
}
const promoFields = async (d: WriterDeps, id: string): Promise<Fields | null> => { const r = await d.readPromotion(id); return r ? { campaignId: s(r.campaign_id), name: String(r.name ?? ""), channel: String(r.channel ?? ""), promoType: String(r.promo_type ?? ""), plannedAmount: Number(r.planned_amount) || 0, status: String(r.status ?? ""), promoDate: s(r.promo_date), notes: String(r.notes ?? ""), actualAmount: Number(r.linked_amount ?? r.actual_amount) || 0, paidSpend: Number(r.actual_amount) || 0, spendCurrency: String(r.actual_currency ?? "₪"), linkedStatus: s(r.linked_status), hasExpense: !!r.linked_transaction_id } : null; };
/** A5: the actual spend counts only when the linked expense is שולם, in its own currency (lib/social-promotions-store promotionSpend). */
const cur$ = (c: Fields, n: number) => `${String(c.spendCurrency ?? "₪")}${Number(n).toLocaleString("en-US")}`;
async function onPromo(d: WriterDeps, a: Readonly<Record<string, unknown>>): Promise<ResolvedTarget | PlanRefusal> {
  const k = parseKey(a.promotion, ["promotion"]); if (!k) return refuse("BAD_ENTITY", "צריך פעולת קידום (promotion:…)");
  const f = await promoFields(d, k.id); if (!f) return refuse("ENTITY_NOT_FOUND", "לא מצאתי את פעולת הקידום");
  return { key: `promotion:${k.id}`, id: k.id, label: `קידום ${f.name} (${f.channel})`, fields: f };
}

const CAMPAIGN_EDIT: readonly ArgSpec[] = [T("title"), E("status", CAMPAIGN_STATUS), D("releaseDate"), T("marketingAngle"), T("targetAudience"), T("mainMessage"), T("platforms"), T("notes"), M("promotionBudget")];
function campaignPatch(a: Readonly<Record<string, unknown>>): Fields | PlanRefusal {
  const after: Fields = {};
  const t = textArg(a, "title", 200); if (isRef(t)) return t; if (t !== undefined) { if (!t) return refuse("BAD_TEXT", "שם הקמפיין חסר"); after.title = t; }
  if (a.status !== undefined) after.status = String(a.status);
  if (a.releaseDate !== undefined) { if (!realYmd(a.releaseDate)) return refuse("BAD_DATE", "תאריך לא תקין"); after.releaseDate = String(a.releaseDate); }
  for (const k of ["marketingAngle", "targetAudience", "mainMessage", "notes"]) { const v = textArg(a, k); if (isRef(v)) return v; if (v !== undefined) after[k] = v; }
  if (a.platforms !== undefined) { const p = platformsOf(a.platforms); if (isRef(p)) return p; after.platforms = p.join(","); }
  if (a.promotionBudget !== undefined) { const n = Number(a.promotionBudget); if (!Number.isFinite(n) || n < 0) return refuse("BAD_AMOUNT", "תקציב ≥ 0"); after.promotionBudget = n; }
  return after;
}
const campaignBody = (after: Fields): Row => {
  const m: Record<string, string> = { title: "title", status: "status", releaseDate: "release_date", marketingAngle: "marketing_angle", targetAudience: "target_audience", mainMessage: "main_message", notes: "notes", promotionBudget: "promotion_budget" };
  const b: Row = {}; for (const [k, v] of Object.entries(after)) if (k === "platforms") b.platforms = String(v).split(",").filter(Boolean); else if (m[k]) b[m[k]] = v; return b;
};
const CONTENT_EDIT: readonly ArgSpec[] = [T("title"), E("contentType", CONTENT_TYPES), T("platforms"), E("status", CONTENT_STATUS), D("dueDate"), D("publishDate"), T("publishTime"), T("ownerName"), T("hook"), T("caption"), T("notes")];
function contentPatch(a: Readonly<Record<string, unknown>>): Fields | PlanRefusal {
  const after: Fields = {};
  const t = textArg(a, "title", 200); if (isRef(t)) return t; if (t !== undefined) { if (!t) return refuse("BAD_TEXT", "שם הפריט חסר"); after.title = t; }
  if (a.contentType !== undefined) after.contentType = String(a.contentType);
  if (a.status !== undefined) after.status = String(a.status);
  if (a.platforms !== undefined) { if (a.platforms === "") after.platform = null; else { const p = platformsOf(a.platforms); if (isRef(p)) return p; after.platform = p.join(","); } }
  for (const k of ["dueDate", "publishDate"]) if (a[k] !== undefined) { if (!realYmd(a[k])) return refuse("BAD_DATE", "תאריך לא תקין"); after[k] = String(a[k]); }
  if (a.publishTime !== undefined) { if (!/^\d{2}:\d{2}$/.test(String(a.publishTime))) return refuse("BAD_TIME", "שעה HH:MM"); after.publishTime = String(a.publishTime); }
  for (const k of ["ownerName", "hook", "caption", "notes"]) { const v = textArg(a, k); if (isRef(v)) return v; if (v !== undefined) after[k] = v; }
  return after;
}
const contentBody = (after: Fields): Row => {
  const m: Record<string, string> = { title: "title", contentType: "content_type", platform: "platform", status: "status", dueDate: "due_date", publishDate: "publish_date", publishTime: "publish_time", ownerName: "owner_name", hook: "hook", caption: "caption", notes: "notes" };
  const b: Row = {}; for (const [k, v] of Object.entries(after)) if (m[k]) b[m[k]] = v; return b;
};
const PROMO_EDIT: readonly ArgSpec[] = [T("name"), E("channel", PROMO_CHANNEL_VALUES), E("promoType", PROMO_TYPE_VALUES), M("plannedAmount"), E("status", PROMO_STATUS_VALUES), D("promoDate"), T("notes")];
function promoPatch(a: Readonly<Record<string, unknown>>): Fields | PlanRefusal {
  const after: Fields = {};
  const t = textArg(a, "name", 200); if (isRef(t)) return t; if (t !== undefined) { if (!t) return refuse("BAD_TEXT", "שם חסר"); after.name = t; }
  for (const k of ["channel", "promoType", "status"]) if (a[k] !== undefined) after[k] = String(a[k]);
  if (a.plannedAmount !== undefined) { const n = Number(a.plannedAmount); if (!Number.isFinite(n) || n < 0) return refuse("BAD_AMOUNT", "סכום מתוכנן ≥ 0"); after.plannedAmount = n; }
  if (a.promoDate !== undefined) { if (!realYmd(a.promoDate)) return refuse("BAD_DATE", "תאריך לא תקין"); after.promoDate = String(a.promoDate); }
  const n = textArg(a, "notes"); if (isRef(n)) return n; if (n !== undefined) after.notes = n;
  return after;
}
const promoBody = (after: Fields): Row => { const m: Record<string, string> = { name: "name", channel: "channel", promoType: "promo_type", plannedAmount: "planned_amount", status: "status", promoDate: "promo_date", notes: "notes" }; const b: Row = {}; for (const [k, v] of Object.entries(after)) if (m[k]) b[m[k]] = v; return b; };
/** ADD_SOCIAL_CONTENT target (stage 1): a campaign, a label artist, or both — one artist per item. */
async function resolveAddContent(d: WriterDeps, a: Readonly<Record<string, unknown>>): Promise<ResolvedTarget | PlanRefusal> {
  const ak = a.artist !== undefined ? parseKey(a.artist, ["label-artist"]) : null;
  if (a.artist !== undefined && !ak) return refuse("BAD_ENTITY", "אמן = label-artist:…");
  const art = ak ? await artistFields(d, ak.id) : null;
  if (ak && !art) return refuse("ENTITY_NOT_FOUND", "לא מצאתי את האמן");
  if (a.campaign === undefined) {
    if (!ak) return refuse("BAD_ENTITY", "צריך קמפיין (social-campaign:…) או אמן (label-artist:…)");
    return { key: "social-content:new", id: "new", label: `תוכן של ${art!.name}`, fields: { labelArtistId: ak.id, artistName: String(art!.name) } };
  }
  const r = await onCampaign(d, a); if ("ok" in r) return r;
  const campArtist = r.fields.labelArtistId ? String(r.fields.labelArtistId) : null;
  if (ak && campArtist && campArtist !== ak.id) return refuse("ARTIST_MISMATCH", "הקמפיין שייך לאמן אחר — פריט תוכן הוא של אמן אחד");
  const who = ak?.id ?? campArtist;
  return { key: "social-content:new", id: "new", label: `תוכן ל${r.label}`, fields: { campaignTitle: String(r.fields.title), ...(who ? { labelArtistId: who } : {}), ...(art ? { artistName: String(art.name) } : {}) } };
}
const exists = <T extends { fields: Fields }>(r: T | PlanRefusal) => ("ok" in r ? r : { ...r, fields: { ...r.fields, exists: true } });

export const SOCIAL_PRIMITIVES: readonly PrimitiveSpec[] = [
  {
    actionId: "CREATE_SOCIAL_CAMPAIGN", kinds: ["social-campaign"],
    meta: meta("פתיחת קמפיין סושיאל לפרויקט (אחד לפרויקט)", "Open the project's social campaign (one per project, like the screen: status active)", [K("project"), T("title"), D("releaseDate"), T("platforms"), E("status", CAMPAIGN_STATUS)], ["title", "status"], "createSocialCampaign (lib/writes/social)", { riskClass: "NORMAL_BUSINESS", reversible: "PARTIAL", compensation: "DELETE_SOCIAL_CAMPAIGN" }),
    createContext: async (d, a) => { const k = parseKey(a.project, ["project"]); const p = k ? await d.readProjectMeta(k.id) : null; return { existing: k ? (await d.campaignForProject(k.id)) ?? "none" : "none", projectName: p?.name ?? null }; },
    async resolve(d, a) { const k = parseKey(a.project, ["project"]); if (!k) return refuse("BAD_ENTITY", "צריך פרויקט (project:…)"); const p = await d.readProjectMeta(k.id); if (!p) return refuse("ENTITY_NOT_FOUND", "לא מצאתי את הפרויקט"); return { key: "social-campaign:new", id: "new", label: `קמפיין ל-${p.name}`, fields: { existing: (await d.campaignForProject(k.id)) ?? "none", projectName: p.name } }; },
    read: campaignFields,
    plan(a, cur) {
      if (cur.existing !== "none") return refuse("DUPLICATE", "לפרויקט הזה כבר יש קמפיין — לעדכן אותו (UPDATE_SOCIAL_CAMPAIGN)");
      if (a.title !== undefined && text(a.title, 200) === null) return refuse("BAD_TEXT", "שם לא תקין");
      if (a.releaseDate !== undefined && !realYmd(a.releaseDate)) return refuse("BAD_DATE", "תאריך לא תקין");
      if (a.platforms !== undefined && isRef(platformsOf(a.platforms))) return platformsOf(a.platforms) as PlanRefusal;
      return { ok: true, after: { title: String(a.title ?? "").trim() || String(cur.projectName), status: String(a.status ?? "active") } };
    },
    async apply(d, _id, after, a) {
      const k = parseKey(a.project, ["project"])!; const p = await d.readProjectMeta(k.id); if (!p) throw new Error("project not found");
      const pl = a.platforms !== undefined ? (platformsOf(a.platforms) as string[]) : [];
      return { createdId: await d.createSocialCampaign({ project_id: k.id, title: after.title, artist_name: p.artist ?? "", release_date: a.releaseDate ?? null, platforms: pl, status: after.status }) };
    },
    async verify(d, id, after) { const f = await campaignFields(d, id); return !!f && f.status === after.status && f.title === after.title; },
    disclosuresHe: ["קמפיין אחד לפרויקט (כמו במסך) — שם ברירת מחדל: שם הפרויקט", "לא נוצרים תכנים, כסף, יומן או Push"],
  },
  {
    actionId: "UPDATE_SOCIAL_CAMPAIGN", kinds: ["social-campaign"],
    meta: meta("עדכון קמפיין סושיאל (שם / סטטוס / זווית / קהל / מסר / פלטפורמות / תקציב קידום)", "Update a social campaign's fields (validated; the promotion budget is planning only — never a transaction)", [K("campaign"), ...CAMPAIGN_EDIT], ["title", "status", "releaseDate", "marketingAngle", "targetAudience", "mainMessage", "platforms", "notes", "promotionBudget"], "updateSocialCampaign (lib/writes/social)", {}),
    resolve: onCampaign, read: campaignFields,
    plan(a, cur) { const p = campaignPatch(a); return isRef(p) ? p : finishPlan(cur, p); },
    apply: (d, id, after) => d.updateSocialCampaign(id, campaignBody(after)),
    disclosuresHe: ["תקציב הקידום = תכנון בלבד (לא רשומה כספית)", "לא נשלח כלום"],
  },
  {
    actionId: "DELETE_SOCIAL_CAMPAIGN", kinds: ["social-campaign"],
    meta: meta("מחיקת קמפיין סושיאל", "Delete a social campaign (hard delete, like the screen)", [K("campaign")], ["exists"], "deleteSocialCampaign (lib/writes/social)", { effects: ["DELETION", "CASCADE"], riskClass: "DESTRUCTIVE", reversible: "NO", compensation: null }),
    async resolve(d, a) { const r = await onCampaign(d, a); if ("ok" in r) return r; const c = await d.campaignCounts(r.id); return { ...r, fields: { ...r.fields, exists: true, contentCount: c.content, promotionCount: c.promotions, fileCount: c.files, artistContentKept: c.artistContentKept ?? 0 } }; },
    async read(d, id) { const f = await campaignFields(d, id); if (!f) return null; const c = await d.campaignCounts(id); return { ...f, exists: true, contentCount: c.content, promotionCount: c.promotions, fileCount: c.files, artistContentKept: c.artistContentKept ?? 0 }; },
    plan: () => ({ ok: true, after: { exists: false } }),
    apply: (d, id) => d.deleteSocialCampaign(id),
    async verify(d, id) { return (await d.readSocialCampaign(id)) === null; },
    requiredValues: () => ["מחיקה"],
    warnings: (c) => [`לקמפיין ${c.contentCount} פריטי תוכן, ${c.promotionCount} פעולות קידום ו-${c.fileCount} קבצים — מה שמסד הנתונים מקשר לקמפיין נמחק / מתנתק איתו`,
      ...(Number(c.artistContentKept) > 0 ? [`${c.artistContentKept} מפריטי התוכן שייכים לאמן — הם והקבצים שלהם נשארים אצל האמן (מתנתקים מהקמפיין); השאר נמחקים`] : []), "הוצאות קידום שכבר נרשמו בכספים נשארות — כל אחת מקבלת קודם סימון מקור בהערות (\"[קידום נמחק …]\")"],
    disclosuresHe: ["מחיקה לצמיתות, כמו במסך", "אם סימון המקור של הוצאה כלשהי נכשל — הקמפיין לא נמחק"],
  },
  {
    actionId: "ADD_SOCIAL_CONTENT", kinds: ["social-content"],
    // Stage 1 (2026-10-17): a campaign, a label artist (the artist's own content, no campaign), or both. Inside a campaign that
    // is linked to an artist the item inherits that artist (the shared writer refuses a different one).
    meta: meta("הוספת פריט תוכן — לקמפיין או לאמן", "Add a content item to a campaign and/or to a label artist's own content (type / platform / status / dates / texts)", [K("campaign", false), K("artist", false), T("title", true), ...CONTENT_EDIT.filter((x) => x.name !== "title")], ["title", "status", "labelArtistId"], "createSocialContent (lib/writes/social)", { riskClass: "NORMAL_BUSINESS", reversible: "PARTIAL", compensation: "DELETE_SOCIAL_CONTENT" }),
    // the creation context IS the resolved target's fields (the same live values the plan was made on — stale detection)
    createContext: async (d, a) => { const r = await resolveAddContent(d, a); return "ok" in r ? {} : r.fields; },
    resolve: (d, a) => resolveAddContent(d, a),
    read: contentFields,
    plan(a, cur) { const p = contentPatch(a); if (isRef(p)) return p; if (!p.title) return refuse("BAD_TEXT", "שם הפריט חסר"); return { ok: true, after: { title: p.title, status: String(p.status ?? "idea"), ...(cur.labelArtistId ? { labelArtistId: String(cur.labelArtistId) } : {}) } }; },
    async apply(d, _id, after, a) {
      const k = a.campaign !== undefined ? parseKey(a.campaign, ["social-campaign"]) : null;
      const c = k ? await d.readSocialCampaign(k.id) : null;
      const p = contentPatch(a) as Fields;
      return { createdId: await d.createSocialContent({ ...contentBody(p), campaign_id: k?.id ?? null, label_artist_id: after.labelArtistId ?? null, project_id: c?.project_id ?? null, status: after.status }) };
    },
    async verify(d, id, after) { const f = await contentFields(d, id); return !!f && f.title === after.title && f.status === after.status && (f.labelArtistId ?? null) === (after.labelArtistId ?? null); },
    disclosuresHe: ["פריט תכנון בלבד — לא מתפרסם כלום ולא נוצר אירוע ביומן", "קישורים (נכס / אחסון / פוסט) לא נכתבים דרך סאני", "פריט של אמן בלי קמפיין נשאר אצל האמן גם אם יימחק קמפיין"],
  },
  {
    // Stage 1 (2026-10-17): the canonical campaign → label-artist link (artist_name stays the legacy text). The campaign and
    // its content that has no artist yet get the artist — compare-and-swap; another artist is never overwritten.
    actionId: "LINK_SOCIAL_CAMPAIGN_ARTIST", kinds: ["social-campaign"],
    meta: meta("קישור קמפיין לאמן הלייבל (הקמפיין + התוכן שלו שעוד לא משויך)", "Link a social campaign (and its content that has no artist yet) to a label artist — the canonical id link", [K("campaign"), K("artist")], ["labelArtistId", "contentToLink"], "linkSocialCampaignArtist (lib/writes/social)", { riskClass: "NORMAL_BUSINESS", reversible: "YES" }),
    async resolve(d, a) {
      const ak = parseKey(a.artist, ["label-artist"]); if (!ak) return refuse("BAD_ENTITY", "אמן = label-artist:…");
      if (!(await artistFields(d, ak.id))) return refuse("ENTITY_NOT_FOUND", "לא מצאתי את האמן");
      const r = await onCampaign(d, a); if ("ok" in r) return r; const c = await d.campaignCounts(r.id); return { ...r, fields: { ...r.fields, contentToLink: c.content - (c.artistContentKept ?? 0) } };
    },
    async read(d, id) { const f = await campaignFields(d, id); if (!f) return null; const c = await d.campaignCounts(id); return { ...f, contentToLink: c.content - (c.artistContentKept ?? 0) }; },
    plan(a, cur) {
      const ak = parseKey(a.artist, ["label-artist"]); if (!ak) return refuse("BAD_ENTITY", "אמן = label-artist:…");
      if (cur.labelArtistId && cur.labelArtistId !== ak.id) return refuse("ALREADY_LINKED", "הקמפיין כבר מקושר לאמן אחר — לא מחליפה קישור");
      if (cur.labelArtistId === ak.id && Number(cur.contentToLink) === 0) return refuse("NO_CHANGE", "הקמפיין והתוכן שלו כבר מקושרים לאמן הזה");
      return { ok: true, after: { labelArtistId: ak.id, contentToLink: 0 } };
    },
    apply: async (d, id, after) => { await d.linkSocialCampaignArtist(id, String(after.labelArtistId)); },
    async verify(d, id, after) { const f = await campaignFields(d, id); if (!f || f.labelArtistId !== after.labelArtistId) return false; const c = await d.campaignCounts(id); return c.content - (c.artistContentKept ?? 0) === 0; },
    warnings: (c) => [`${Number(c.contentToLink)} פריטי תוכן של הקמפיין יקבלו את האמן — ואז יישארו אצלו גם אם הקמפיין יימחק`],
    disclosuresHe: ["רק קישור: שם האמן בטקסט, הסטטוס, התאריכים, הקבצים והקידומים לא משתנים", "פריט שכבר שייך לאמן אחר לא נדרס"],
  },
  {
    actionId: "UPDATE_SOCIAL_CONTENT", kinds: ["social-content"],
    meta: meta("עדכון פריט תוכן (שם / סוג / פלטפורמה / סטטוס / תאריכים / טקסטים)", "Update one social content item's fields (validated; link fields excluded)", [K("content"), ...CONTENT_EDIT], ["title", "contentType", "platform", "status", "dueDate", "publishDate", "publishTime", "ownerName", "hook", "caption", "notes"], "updateSocialContent (lib/writes/social)", {}),
    resolve: onContent, read: contentFields,
    plan(a, cur) { const p = contentPatch(a); return isRef(p) ? p : finishPlan(cur, p); },
    apply: (d, id, after) => d.updateSocialContent(id, contentBody(after)),
    disclosuresHe: ["סטטוס 'פורסם' הוא רישום בלבד — לא מפרסם כלום", "לא נשלח כלום"],
  },
  {
    actionId: "DELETE_SOCIAL_CONTENT", kinds: ["social-content"],
    meta: meta("מחיקת פריט תוכן (+ הקבצים שלו)", "Delete a content item and its stored files (like the screen)", [K("content")], ["exists"], "deleteSocialContentWithFiles (lib/writes/social)", { effects: ["DELETION", "FILES"], riskClass: "DESTRUCTIVE", reversible: "NO", compensation: null }),
    async resolve(d, a) { const r = await onContent(d, a); if ("ok" in r) return r; return { ...r, fields: { ...r.fields, exists: true, fileCount: await d.contentFileCount(r.id) } }; },
    async read(d, id) { const f = await contentFields(d, id); return f ? { ...f, exists: true, fileCount: await d.contentFileCount(id) } : null; },
    plan: () => ({ ok: true, after: { exists: false } }),
    async apply(d, id) { const r = await d.deleteSocialContentWithFiles(id); return { receipt: r.storageFailures ? `${r.storageFailures}/${r.files} קבצים לא נמחקו מהאחסון` : `${r.files} קבצים נמחקו` }; },
    async verify(d, id) { return (await d.readSocialContent(id)) === null; },
    requiredValues: () => ["מחיקה"],
    warnings: (c) => [Number(c.fileCount) ? `${c.fileCount} קבצים של הפריט נמחקים מהאחסון` : "אין לפריט קבצים"],
    disclosuresHe: ["כשל במחיקת קובץ מהאחסון מדווח בתוצאה (לא מוסתר)"],
  },
  {
    actionId: "DELETE_SOCIAL_FILE", kinds: ["social-attachment"],
    meta: meta("מחיקת קובץ של פריט תוכן", "Delete one social content file (storage + record)", [K("socialFile")], ["exists"], "deleteSocialFileWithStorage (lib/writes/social)", { effects: ["DELETION", "FILES"], riskClass: "DESTRUCTIVE", reversible: "NO", compensation: null }),
    async resolve(d, a) { const k = parseKey(a.socialFile, ["social-attachment"]); if (!k) return refuse("BAD_ENTITY", "צריך קובץ (social-attachment:…)"); const f = await d.readSocialFile(k.id); if (!f) return refuse("ENTITY_NOT_FOUND", "לא מצאתי את הקובץ"); return { key: `social-attachment:${k.id}`, id: k.id, label: f.fileName ?? "קובץ", fields: { contentItemId: f.contentItemId, fileName: f.fileName, exists: true } }; },
    async read(d, id) { const f = await d.readSocialFile(id); return f ? { contentItemId: f.contentItemId, fileName: f.fileName, exists: true } : null; },
    plan: () => ({ ok: true, after: { exists: false } }),
    async apply(d, id) { const r = await d.deleteSocialFileWithStorage(id); return { receipt: r.storageFailures ? "הרשומה נמחקה; הקובץ עצמו לא נמחק מהאחסון" : "נמחק" }; },
    async verify(d, id) { return (await d.readSocialFile(id)) === null; },
    requiredValues: () => ["מחיקה"],
    disclosuresHe: ["הקובץ נמחק מהאחסון ומהרשימה; כשל באחסון מדווח"],
  },
  {
    actionId: "ADD_PROMOTION", kinds: ["promotion"],
    meta: meta("הוספת פעולת קידום (תכנון)", "Add a paid-promotion planning row to a campaign (the actual spend is a separate financial action)", [K("campaign"), T("name", true), E("channel", PROMO_CHANNEL_VALUES), E("promoType", PROMO_TYPE_VALUES), M("plannedAmount"), E("status", PROMO_STATUS_VALUES), D("promoDate"), T("notes")], ["name", "plannedAmount"], "createPromotion (lib/social-promotions-store via lib/writes/social)", { riskClass: "NORMAL_BUSINESS", reversible: "PARTIAL", compensation: "DELETE_PROMOTION" }),
    createContext: async (d, a) => { const k = parseKey(a.campaign, ["social-campaign"]); const c = k ? await campaignFields(d, k.id) : null; return { campaignTitle: c ? String(c.title) : null }; },
    async resolve(d, a) { const r = await onCampaign(d, a); if ("ok" in r) return r; return { key: "promotion:new", id: "new", label: `קידום ב${r.label}`, fields: { campaignTitle: String(r.fields.title) } }; },
    read: promoFields,
    plan(a) { const p = promoPatch(a); if (isRef(p)) return p; if (!p.name) return refuse("BAD_TEXT", "שם חסר"); return { ok: true, after: { name: p.name, plannedAmount: Number(p.plannedAmount ?? 0) } }; },
    async apply(d, _id, after, a) { const p = promoPatch(a) as Fields; return { createdId: await d.createPromotion({ campaign_id: parseKey(a.campaign, ["social-campaign"])!.id, channel: String(p.channel ?? "אחר"), promo_type: String(p.promoType ?? "קידום ממומן"), name: String(after.name), planned_amount: Number(after.plannedAmount), status: String(p.status ?? "מתוכנן"), promo_date: (p.promoDate as string | undefined) ?? null, notes: String(p.notes ?? "") }) }; },
    async verify(d, id, after) { const f = await promoFields(d, id); return !!f && f.name === after.name && f.plannedAmount === after.plannedAmount; },
    disclosuresHe: ["תכנון בלבד — לא נוצרת רשומה כספית"],
  },
  {
    actionId: "UPDATE_PROMOTION", kinds: ["promotion"],
    meta: meta("עדכון פעולת קידום (תכנון)", "Update a promotion's planning fields (never the actual spend)", [K("promotion"), ...PROMO_EDIT], ["name", "channel", "promoType", "plannedAmount", "status", "promoDate", "notes"], "updatePromotionFields (lib/social-promotions-store via lib/writes/social)", {}),
    resolve: onPromo, read: promoFields,
    plan(a, cur) { const p = promoPatch(a); return isRef(p) ? p : finishPlan(cur, p); },
    apply: (d, id, after) => d.updatePromotionFields(id, promoBody(after)),
    disclosuresHe: ["ההוצאה בפועל לא משתנה כאן (פעולה כספית נפרדת)"],
  },
  {
    actionId: "SET_PROMOTION_ACTUAL_SPEND", kinds: ["promotion"],
    meta: meta("רישום ההוצאה בפועל של קידום (הוצאה ששולמה בכספים)", "Record a promotion's ACTUAL spend: creates ONE paid ₪ Finance expense (scope שיווק) or updates the linked one's amount (in its own currency) — the app's CAS-guarded sync; it counts as spend only while שולם", [K("promotion"), M("amount", true)], ["actualAmount", "spendCurrency"], "syncActualExpense (lib/social-promotions-store via lib/writes/social)", { effects: ["FINANCE"], riskClass: "FINANCIAL", reversible: "PARTIAL", compensation: "a new approved plan setting the previous amount" }),
    resolve: onPromo, read: promoFields,
    plan(a, cur) { const n = Number(a.amount); if (!Number.isFinite(n) || n < 0) return refuse("BAD_AMOUNT", "סכום ≥ 0"); if (!cur.hasExpense && n === 0) return refuse("NO_CHANGE_NEEDED", "אין הוצאה לרשום"); return finishPlan(cur, { actualAmount: n, spendCurrency: String(cur.spendCurrency ?? "₪") }); },
    apply: (d, id, after) => d.syncActualExpense(id, Number(after.actualAmount)),
    requiredValues: (_a, after) => [cur$(after, Number(after.actualAmount))],
    warnings: (c) => [
      c.hasExpense ? `משנה את סכום ההוצאה הקיימת בכספים (לא יוצרת שנייה) — במטבע שלה (${c.spendCurrency})` : "נוצרת הוצאה חדשה בכספים: ₪, שולם, היקף שיווק",
      ...(c.hasExpense && c.linkedStatus !== "שולם" ? [`ההוצאה המקושרת במצב '${c.linkedStatus ?? "—"}' — היא לא נספרת כהוצאה בפועל עד שהיא 'שולם'`] : []),
    ],
    disclosuresHe: ["הוצאה חדשה נרשמת ב-₪ (כמו במסך); הוצאה קיימת נשארת במטבע שלה — מטבעות לא מחוברים", "הוצאה בפועל = רק הוצאה מקושרת בסטטוס 'שולם'", "0 על הוצאה קיימת מאפס את הסכום — לא מוחק את הרשומה"],
  },
  {
    actionId: "DELETE_PROMOTION", kinds: ["promotion"],
    meta: meta("מחיקת פעולת קידום (רשומת התכנון בלבד)", "Delete a promotion planning row — its Finance expense stays (the app's rule)", [K("promotion")], ["exists"], "deletePromotion (lib/social-promotions-store via lib/writes/social)", { effects: ["DELETION"], riskClass: "DESTRUCTIVE", reversible: "NO", compensation: null }),
    async resolve(d, a) { return exists(await onPromo(d, a)); },
    async read(d, id) { const f = await promoFields(d, id); return f ? { ...f, exists: true } : null; },
    plan: () => ({ ok: true, after: { exists: false } }),
    apply: (d, id) => d.deletePromotion(id),
    async verify(d, id) { return (await d.readPromotion(id)) === null; },
    requiredValues: () => ["מחיקה"],
    warnings: (c) => [c.hasExpense ? `ההוצאה בכספים (${cur$(c, Number(c.actualAmount))}, ${c.linkedStatus ?? "—"}) נשארת, ובהערות שלה נרשם "[קידום נמחק …: ${c.name} · ${c.channel}]" — למחוק אותה זו פעולה כספית נפרדת` : "אין לקידום הוצאה בכספים"],
    disclosuresHe: ["רק רשומת התכנון נמחקת", "לפני המחיקה נרשם סימון מקור בהערות ההוצאה (הוספה, לא דריסה); אם הרישום נכשל — הקידום לא נמחק"],
  },
];
