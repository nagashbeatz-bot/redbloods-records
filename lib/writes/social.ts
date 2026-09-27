/**
 * Shared writers for social campaigns, content items, their files and paid promotions. Used by BOTH the /api/social
 * routes and Sunny's typed primitives. HARDENED (2026-09-27, Universal Actions):
 *   • campaign / content PATCH + POST accept ONLY the fields the screens edit, validated against the app's vocabularies
 *     (status, platform, content type, dates, platforms list, non-negative promotion budget). They used to write the
 *     whole request body into the row (ids, project / campaign links, calendar / task ids could be overwritten).
 *   • deleting a content item reports how many of its stored files could not be removed (it used to hide failures).
 * Promotions keep the store's money model (the actual spend = ONE linked Finance expense, CAS-guarded; deleting a
 * promotion never deletes its transaction).
 */
import { supabase } from "@/lib/supabase";
import { getDropboxToken } from "@/lib/dropbox-token";
import { SOCIAL_CAMPAIGN_STATUSES, SOCIAL_CONTENT_STATUSES, SOCIAL_PLATFORMS } from "@/lib/types";
import { createCampaign, createContentItem, deleteCampaign, deleteContentItem, getCampaign, getContentItem, updateCampaign, updateContentItem } from "@/lib/social-store";
import { deleteSocialFile, getFile, listFiles } from "@/lib/social-files-store";
import { createPromotion, deletePromotion, syncActualExpense, updatePromotionFields } from "@/lib/social-promotions-store";

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
export async function campaignCounts(id: string): Promise<{ content: number; promotions: number; files: number }> {
  const c = async (table: string) => { const { count, error } = await supabase.from(table).select("id", { count: "exact", head: true }).eq("campaign_id", id); if (error) throw new Error(error.message); return count ?? 0; };
  return { content: await c("social_content_items"), promotions: await c("social_promotions"), files: await c("social_content_files") };
}

// ── content ──
export async function createSocialContent(body: Body) {
  const fields: Body = { ...body }; const campaign_id = fields.campaign_id, project_id = fields.project_id; delete fields.campaign_id; delete fields.project_id;
  if (typeof campaign_id !== "string" || !campaign_id) throw new SocialInputError("campaign_id חסר");
  const p = pick(fields, CONTENT_FIELDS, "content");
  if (!p.title) throw new SocialInputError("title: חסר שם");
  return createContentItem({ ...(p as Parameters<typeof createContentItem>[0]), campaign_id, project_id: typeof project_id === "string" && project_id ? project_id : null });
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
  let actual = 0;
  if (data.linked_transaction_id) {
    const { data: tx } = await supabase.from("transactions").select("amount").eq("id", data.linked_transaction_id).maybeSingle();
    actual = Number(tx?.amount) || 0;
  }
  return { ...(data as Record<string, unknown>), actual_amount: actual };
}
export { createPromotion, updatePromotionFields, deletePromotion, syncActualExpense };
