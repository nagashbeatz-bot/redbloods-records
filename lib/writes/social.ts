/**
 * Shared writers for social campaigns, content items, their files and paid promotions. Used by BOTH the /api/social
 * routes and Sunny's typed primitives. HARDENED (2026-09-27, Universal Actions):
 *   • campaign / content PATCH + POST accept ONLY the fields the screens edit, validated against the app's vocabularies
 *     (status, platform, content type, dates, platforms list, non-negative promotion budget). They used to write the
 *     whole request body into the row (ids, project / campaign links, calendar / task ids could be overwritten).
 *   • deleting a content item reports how many of its stored files could not be removed (it used to hide failures).
 * Promotions keep the store's money model (the actual spend = ONE linked Finance expense, CAS-guarded; it counts as
 * spend only when שולם, per currency; deleting a promotion / campaign never deletes its transaction — the transaction
 * gets a provenance marker first, and a failed marker aborts the delete).
 */
import { supabase } from "@/lib/supabase";
import { getDropboxToken } from "@/lib/dropbox-token";
import { SOCIAL_CAMPAIGN_STATUSES, SOCIAL_CONTENT_STATUSES, SOCIAL_PLATFORMS } from "@/lib/types";
import { createCampaign, createContentItem, deleteCampaign, deleteContentItem, getCampaign, getContentItem, labelArtistNameById, listContentItemsByArtist, listContentItemsWithoutCampaign, updateCampaign, updateContentItem } from "@/lib/social-store";
import { deleteSocialFile, getFile, listFiles } from "@/lib/social-files-store";
import { createPromotion, deletePromotion, promotionSpend, syncActualExpense, updatePromotionFields } from "@/lib/social-promotions-store";

export class SocialInputError extends Error {}
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const HM = /^\d{2}:\d{2}(:\d{2})?$/;
type Body = Record<string, unknown>;

/** Promotion vocabularies (components/social/SocialPromotions.tsx — pinned by the family test). */
export const PROMO_CHANNELS = ["YouTube", "TikTok", "Instagram", "אחר"] as const;
export const PROMO_TYPES = ["קידום ממומן", "רקדן / יוצר תוכן", "משפיען", "עמוד תוכן", "אחר"] as const;
export const PROMO_STATUSES = ["מתוכנן", "פעיל", "בוצע", "בוטל"] as const;

const CAMPAIGN_FIELDS = ["title", "artist_name", "release_date", "status", "marketing_angle", "target_audience", "main_message", "platforms", "owner_id", "notes", "promotion_budget"] as const;
const CONTENT_FIELDS = ["title", "content_type", "platform", "status", "due_date", "publish_date", "publish_time", "owner_name", "hook", "caption", "asset_link", "dropbox_link", "posted_url", "notes"] as const;

function check(field: string, v: unknown): unknown {
  const bad = (m: string) => { throw new SocialInputError(`${field}: ${m}`); };
  switch (field) {
    case "status_campaign": return (SOCIAL_CAMPAIGN_STATUSES as readonly string[]).includes(String(v)) ? v : bad("סטטוס לא תקין");
    case "status_content": return (SOCIAL_CONTENT_STATUSES as readonly string[]).includes(String(v)) ? v : bad("סטטוס לא תקין");
    // one platform, or the comma-joined list the preview page writes ("instagram,tiktok")
    case "platform": return v === null || v === "" ? null : typeof v === "string" && v.split(",").every((p) => (SOCIAL_PLATFORMS as readonly string[]).includes(p.trim())) ? v : bad("פלטפורמה לא תקינה");
    case "platforms": return Array.isArray(v) && v.every((p) => (SOCIAL_PLATFORMS as readonly string[]).includes(String(p))) ? [...new Set(v.map(String))] : bad("פלטפורמות לא תקינות");
    // the screens re-send a stored legacy type unchanged, so the route accepts any short type text; Sunny's primitive
    // enforces SOCIAL_CONTENT_TYPES itself
    case "content_type": return typeof v === "string" && v.trim() && v.length <= 60 ? v : bad("סוג תוכן לא תקין");
    case "release_date": case "due_date": case "publish_date": return v === null || v === "" ? null : typeof v === "string" && YMD.test(v) ? v : bad("תאריך לא תקין");
    case "publish_time": return v === null || v === "" ? null : typeof v === "string" && HM.test(v) ? v : bad("שעה לא תקינה");
    case "promotion_budget": { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : bad("תקציב לא תקין"); }
    case "title": return typeof v === "string" && v.trim() ? v.trim() : bad("חסר שם");
    default: return typeof v === "string" ? v : v === null ? "" : bad("טקסט לא תקין");
  }
}
function pick(body: Body, fields: readonly string[], kind: "campaign" | "content"): Body {
  const out: Body = {};
  const extra = Object.keys(body).filter((k) => !fields.includes(k));
  if (extra.length) throw new SocialInputError(`שדות לא מותרים: ${extra.join(", ")}`);
  for (const f of fields) if (body[f] !== undefined) out[f] = check(f === "status" ? `status_${kind}` : f, body[f]);
  return out;
}

// ── campaigns ──
export async function createSocialCampaign(body: Body) {
  const allowed = ["project_id", ...CAMPAIGN_FIELDS.filter((f) => f !== "promotion_budget")];
  const fields: Body = { ...body }; const project_id = fields.project_id; delete fields.project_id;
  const p = pick(fields, allowed.filter((f) => f !== "project_id"), "campaign");
  if (!p.title) throw new SocialInputError("title: חסר שם");
  return createCampaign({ ...(p as Parameters<typeof createCampaign>[0]), project_id: typeof project_id === "string" && project_id ? project_id : null });
}
export async function updateSocialCampaign(id: string, body: Body) { return updateCampaign(id, pick(body, CAMPAIGN_FIELDS, "campaign")); }
export async function deleteSocialCampaign(id: string) { await deleteCampaign(id); }
export async function readSocialCampaign(id: string) { return getCampaign(id); }
export async function campaignForProject(projectId: string): Promise<string | null> {
  const { data, error } = await supabase.from("social_campaigns").select("id").eq("project_id", projectId).maybeSingle();
  if (error) throw new Error(error.message);
  return (data?.id as string | undefined) ?? null;
}
export async function campaignCounts(id: string): Promise<{ content: number; promotions: number; files: number; artistContentKept: number }> {
  const c = async (table: string) => { const { count, error } = await supabase.from(table).select("id", { count: "exact", head: true }).eq("campaign_id", id); if (error) throw new Error(error.message); return count ?? 0; };
  // stage 1 (DB trigger social_campaign_before_delete): content that belongs to an artist is KEPT (detached), the rest goes
  const { count: kept, error: ke } = await supabase.from("social_content_items").select("id", { count: "exact", head: true }).eq("campaign_id", id).not("label_artist_id", "is", null);
  if (ke) throw new Error(ke.message);
  return { content: await c("social_content_items"), promotions: await c("social_promotions"), files: await c("social_content_files"), artistContentKept: kept ?? 0 };
}

// ── stage 1: artist content (2026-10-17) ──
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A roster artist by exact id — the canonical link (never a name). */
export async function labelArtistExists(id: unknown): Promise<string | null> {
  if (typeof id !== "string" || !UUID.test(id)) return null;
  return (await labelArtistNameById(id)) !== null ? id : null;
}
export async function listSocialContentForArtist(labelArtistId: string) { return listContentItemsByArtist(labelArtistId); }
export async function listSocialContentWithoutCampaign() { return listContentItemsWithoutCampaign(); }
/**
 * Link a campaign to its label artist (ONE approved change): the campaign and its content that has no artist yet. Compare-and-
 * swap — a campaign / item already linked to ANOTHER artist is never overwritten; nothing else changes.
 */
export async function linkSocialCampaignArtist(campaignId: string, labelArtistId: string): Promise<{ campaign: boolean; items: number }> {
  if (!(await labelArtistExists(labelArtistId))) throw new SocialInputError("אמן לא קיים ברוסטר");
  const camp = await getCampaign(campaignId);
  if (!camp) throw new SocialInputError("הקמפיין לא נמצא");
  if (camp.label_artist_id && camp.label_artist_id !== labelArtistId) throw new SocialInputError("הקמפיין כבר מקושר לאמן אחר");
  let linked = false;
  if (!camp.label_artist_id) {
    const { data, error } = await supabase.from("social_campaigns").update({ label_artist_id: labelArtistId, updated_at: new Date().toISOString() }).eq("id", campaignId).is("label_artist_id", null).select("id");
    if (error) throw new Error(error.message);
    linked = (data ?? []).length === 1;
    if (!linked) throw new SocialInputError("הקמפיין השתנה בינתיים — לא קישרתי");
  }
  const { data: items, error: ie } = await supabase.from("social_content_items").update({ label_artist_id: labelArtistId, updated_at: new Date().toISOString() }).eq("campaign_id", campaignId).is("label_artist_id", null).select("id");
  if (ie) throw new Error(ie.message);
  return { campaign: linked, items: (items ?? []).length };
}

// ── content ──
/**
 * Stage 1: a content item belongs to a campaign, to a label artist, or both (DB CHECK). Inside a campaign that is linked to an
 * artist it inherits that artist; an explicit different artist is refused (never two owners). No campaign → the artist is required.
 */
export async function createSocialContent(body: Body) {
  const fields: Body = { ...body }; const campaign_id = fields.campaign_id, project_id = fields.project_id, artistRaw = fields.label_artist_id;
  delete fields.campaign_id; delete fields.project_id; delete fields.label_artist_id;
  const campaignId = typeof campaign_id === "string" && campaign_id ? campaign_id : null;
  let artistId: string | null = null;
  if (artistRaw !== undefined && artistRaw !== null && artistRaw !== "") {
    artistId = await labelArtistExists(artistRaw);
    if (!artistId) throw new SocialInputError("label_artist_id: אמן לא קיים ברוסטר");
  }
  if (campaignId) {
    const camp = await getCampaign(campaignId);
    if (!camp) throw new SocialInputError("campaign_id: הקמפיין לא נמצא");
    if (camp.label_artist_id && artistId && camp.label_artist_id !== artistId) throw new SocialInputError("label_artist_id: הקמפיין שייך לאמן אחר");
    artistId = artistId ?? camp.label_artist_id ?? null;
  } else if (!artistId) throw new SocialInputError("campaign_id חסר (או אמן — label_artist_id)");
  const p = pick(fields, CONTENT_FIELDS, "content");
  if (!p.title) throw new SocialInputError("title: חסר שם");
  return createContentItem({ ...(p as Parameters<typeof createContentItem>[0]), campaign_id: campaignId, label_artist_id: artistId, project_id: typeof project_id === "string" && project_id ? project_id : null });
}
export async function updateSocialContent(id: string, body: Body) { return updateContentItem(id, pick(body, CONTENT_FIELDS, "content")); }
export async function readSocialContent(id: string) { return getContentItem(id); }

async function deleteStored(paths: string[]): Promise<number> {
  if (!paths.length) return 0;
  let failed = 0;
  try {
    const token = await getDropboxToken();
    await Promise.all(paths.map(async (p) => {
      const r = await fetch("https://api.dropboxapi.com/2/files/delete_v2", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ path: p }) }).catch(() => null);
      if (!r || !r.ok) failed++;
    }));
  } catch { failed = paths.length; }
  return failed;
}
/** DELETE /api/social/content/[id] semantics: stored files best-effort, then the row (DB cascade removes file rows). */
export async function deleteSocialContentWithFiles(id: string): Promise<{ files: number; storageFailures: number }> {
  const files = await listFiles(id);
  const failed = await deleteStored(files.map((f) => f.dropbox_path).filter((p): p is string => !!p));
  await deleteContentItem(id);
  return { files: files.length, storageFailures: failed };
}
export async function contentFileCount(id: string): Promise<number> { return (await listFiles(id)).length; }

// ── files ──
export async function readSocialFile(id: string) { return getFile(id); }
/** DELETE /api/social/files semantics: the stored file best-effort, then the row. */
export async function deleteSocialFileWithStorage(id: string): Promise<{ storageFailures: number }> {
  const f = await getFile(id);
  const failed = f?.dropbox_path ? await deleteStored([f.dropbox_path]) : 0;
  await deleteSocialFile(id);
  return { storageFailures: failed };
}

// ── promotions ──
export async function readPromotion(id: string): Promise<(Record<string, unknown> & { actual_amount: number }) | null> {
  const { data, error } = await supabase.from("social_promotions").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  // ACTUAL spend = the linked transaction's amount only when שולם, in its own currency (promotionSpend — one rule)
  let tx: { amount: unknown; currency: unknown; payment_status: unknown } | null = null;
  if (data.linked_transaction_id) {
    const { data: t, error: te } = await supabase.from("transactions").select("amount, currency, payment_status").eq("id", data.linked_transaction_id).maybeSingle();
    if (te) throw new Error(te.message);
    tx = t;
  }
  const sp = promotionSpend(tx);
  return { ...(data as Record<string, unknown>), actual_amount: sp.amount, actual_currency: sp.currency, linked_amount: sp.linkedAmount, linked_status: sp.status };
}
export { createPromotion, updatePromotionFields, deletePromotion, syncActualExpense };
