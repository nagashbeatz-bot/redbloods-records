import "server-only";
import { supabase } from "./supabase";
import type { SocialCampaign, SocialContentItem, SocialCampaignStatus, SocialContentStatus, SocialPlatform } from "./types";

// ── Campaigns ──────────────────────────────────────────────────────────────────

export async function listCampaigns(): Promise<SocialCampaign[]> {
  const { data, error } = await supabase
    .from("social_campaigns")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(normalizeCampaign);
}

export async function getCampaign(id: string): Promise<SocialCampaign | null> {
  const { data, error } = await supabase
    .from("social_campaigns")
    .select("*")
    .eq("id", id)
    .single();
  if (error) return null;
  return normalizeCampaign(data);
}

export async function createCampaign(input: {
  project_id?: string | null;
  title: string;
  artist_name?: string;
  release_date?: string | null;
  status?: SocialCampaignStatus;
  marketing_angle?: string;
  target_audience?: string;
  main_message?: string;
  platforms?: SocialPlatform[];
  owner_id?: string;
  notes?: string;
}): Promise<SocialCampaign> {
  const { data, error } = await supabase
    .from("social_campaigns")
    .insert({
      project_id:      input.project_id ?? null,
      title:           input.title,
      artist_name:     input.artist_name ?? "",
      release_date:    input.release_date ?? null,
      status:          input.status ?? "draft",
      marketing_angle: input.marketing_angle ?? "",
      target_audience: input.target_audience ?? "",
      main_message:    input.main_message ?? "",
      platforms:       input.platforms ?? [],
      owner_id:        input.owner_id ?? "",
      notes:           input.notes ?? "",
    })
    .select()
    .single();
  if (error) throw error;
  return normalizeCampaign(data);
}

export async function updateCampaign(id: string, patch: Partial<Omit<SocialCampaign, "id" | "created_at">>): Promise<SocialCampaign> {
  const { data, error } = await supabase
    .from("social_campaigns")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return normalizeCampaign(data);
}

export async function deleteCampaign(id: string): Promise<void> {
  const { error } = await supabase.from("social_campaigns").delete().eq("id", id);
  if (error) throw error;
}

// ── Content Items ──────────────────────────────────────────────────────────────

export async function listContentItems(campaignId: string): Promise<SocialContentItem[]> {
  const { data, error } = await supabase
    .from("social_content_items")
    .select("*")
    .eq("campaign_id", campaignId)
    .order("due_date", { ascending: true, nullsFirst: false });
  if (error) throw error;
  return (data ?? []).map(normalizeItem);
}

export async function getContentItem(id: string): Promise<SocialContentItem | null> {
  const { data, error } = await supabase
    .from("social_content_items")
    .select("*")
    .eq("id", id)
    .single();
  if (error) return null;
  return normalizeItem(data);
}

export async function createContentItem(input: {
  campaign_id: string;
  project_id?: string | null;
  title: string;
  content_type?: string;
  status?: SocialContentStatus;
  platform?: SocialPlatform | null;
  due_date?: string | null;
  publish_date?: string | null;
  publish_time?: string | null;
  owner_name?: string;
  notes?: string;
  hook?: string;
  caption?: string;
}): Promise<SocialContentItem> {
  const { data, error } = await supabase
    .from("social_content_items")
    .insert({
      campaign_id:  input.campaign_id,
      project_id:   input.project_id ?? null,
      title:        input.title,
      content_type: input.content_type ?? "אחר",
      status:       input.status ?? "idea",
      platform:     input.platform ?? null,
      due_date:     input.due_date ?? null,
      publish_date: input.publish_date ?? null,
      publish_time: input.publish_time ?? null,
      owner_name:   input.owner_name ?? "",
      notes:        input.notes ?? "",
      hook:         input.hook ?? "",
      caption:      input.caption ?? "",
      asset_link:   "",
      dropbox_link: "",
      posted_url:   "",
    })
    .select()
    .single();
  if (error) throw error;
  return normalizeItem(data);
}

export async function updateContentItem(id: string, patch: Partial<Omit<SocialContentItem, "id" | "created_at">>): Promise<SocialContentItem> {
  const { data, error } = await supabase
    .from("social_content_items")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return normalizeItem(data);
}

export async function deleteContentItem(id: string): Promise<void> {
  const { error } = await supabase.from("social_content_items").delete().eq("id", id);
  if (error) throw error;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function normalizeCampaign(row: Record<string, unknown>): SocialCampaign {
  return {
    id:              row.id as string,
    project_id:      (row.project_id as string) ?? null,
    title:           (row.title as string) ?? "",
    artist_name:     (row.artist_name as string) ?? "",
    release_date:    (row.release_date as string) ?? null,
    status:          ((row.status as string) ?? "draft") as SocialCampaign["status"],
    marketing_angle: (row.marketing_angle as string) ?? "",
    target_audience: (row.target_audience as string) ?? "",
    main_message:    (row.main_message as string) ?? "",
    platforms:       ((row.platforms as SocialPlatform[]) ?? []),
    owner_id:        (row.owner_id as string) ?? "",
    notes:           (row.notes as string) ?? "",
    created_at:      (row.created_at as string) ?? "",
    updated_at:      (row.updated_at as string) ?? "",
  };
}

function normalizeItem(row: Record<string, unknown>): SocialContentItem {
  return {
    id:               row.id as string,
    campaign_id:      (row.campaign_id as string) ?? "",
    project_id:       (row.project_id as string) ?? null,
    title:            (row.title as string) ?? "",
    content_type:     (row.content_type as string) ?? "",
    status:           ((row.status as string) ?? "idea") as SocialContentStatus,
    platform:         ((row.platform as SocialPlatform) ?? null),
    due_date:         (row.due_date as string) ?? null,
    publish_date:     (row.publish_date as string) ?? null,
    publish_time:     (row.publish_time as string) ?? null,
    owner_name:       (row.owner_name as string) ?? "",
    asset_link:       (row.asset_link as string) ?? "",
    dropbox_link:     (row.dropbox_link as string) ?? "",
    calendar_event_id:(row.calendar_event_id as string) ?? null,
    task_id:          (row.task_id as string) ?? null,
    caption:          (row.caption as string) ?? "",
    hook:             (row.hook as string) ?? "",
    notes:            (row.notes as string) ?? "",
    posted_url:       (row.posted_url as string) ?? "",
    created_at:       (row.created_at as string) ?? "",
    updated_at:       (row.updated_at as string) ?? "",
  };
}
