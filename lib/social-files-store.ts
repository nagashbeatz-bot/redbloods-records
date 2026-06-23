import "server-only";
import { supabase } from "./supabase";
import type { SocialContentFile } from "./types";

function normalize(row: Record<string, unknown>): SocialContentFile {
  return {
    id: row.id as string,
    content_item_id: row.content_item_id as string,
    campaign_id: row.campaign_id as string,
    project_id: (row.project_id as string | null) ?? null,
    file_name: (row.file_name as string) ?? "",
    file_type: (row.file_type as string) ?? "",
    file_size: (row.file_size as number) ?? 0,
    dropbox_path: (row.dropbox_path as string) ?? "",
    dropbox_file_id: (row.dropbox_file_id as string) ?? "",
    dropbox_share_link: (row.dropbox_share_link as string) ?? "",
    uploaded_by: (row.uploaded_by as string) ?? "",
    created_at: (row.created_at as string) ?? "",
    updated_at: (row.updated_at as string) ?? "",
  };
}

export async function listFiles(contentItemId: string): Promise<SocialContentFile[]> {
  const { data, error } = await supabase
    .from("social_content_files")
    .select("*")
    .eq("content_item_id", contentItemId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map(normalize);
}

export async function listFilesByCampaign(campaignId: string): Promise<SocialContentFile[]> {
  const { data, error } = await supabase
    .from("social_content_files")
    .select("*")
    .eq("campaign_id", campaignId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map(normalize);
}

export async function createSocialFile(
  input: Omit<SocialContentFile, "id" | "created_at" | "updated_at">
): Promise<SocialContentFile> {
  const { data, error } = await supabase
    .from("social_content_files")
    .insert({
      content_item_id: input.content_item_id,
      campaign_id: input.campaign_id,
      project_id: input.project_id ?? null,
      file_name: input.file_name,
      file_type: input.file_type,
      file_size: input.file_size,
      dropbox_path: input.dropbox_path,
      dropbox_file_id: input.dropbox_file_id,
      dropbox_share_link: input.dropbox_share_link,
      uploaded_by: input.uploaded_by,
    })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return normalize(data as Record<string, unknown>);
}

export async function getFile(id: string): Promise<SocialContentFile | null> {
  const { data } = await supabase
    .from("social_content_files")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  return normalize(data as Record<string, unknown>);
}

export async function deleteSocialFile(id: string): Promise<void> {
  const { error } = await supabase
    .from("social_content_files")
    .delete()
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export async function updateSocialFilePath(id: string, newPath: string): Promise<void> {
  const { error } = await supabase
    .from("social_content_files")
    .update({ dropbox_path: newPath })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export async function countFilesByContentItems(
  contentItemIds: string[]
): Promise<Record<string, number>> {
  if (contentItemIds.length === 0) return {};
  const { data, error } = await supabase
    .from("social_content_files")
    .select("content_item_id")
    .in("content_item_id", contentItemIds);
  if (error) return {};
  const counts: Record<string, number> = {};
  for (const row of data ?? []) {
    const id = (row as { content_item_id: string }).content_item_id;
    counts[id] = (counts[id] ?? 0) + 1;
  }
  return counts;
}
