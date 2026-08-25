/**
 * Mix Target Notes store — server-only. Pure DB CRUD for mix_target_notes, the
 * pre-mix notes on a riddim mix line: what the owner tells Steven about an
 * artist line that has no version yet ("stems are here", "use this acapella").
 *
 * Kept apart from mix_comments on purpose. A comment REQUIRES a mix_version_id
 * (NOT NULL), and the whole point here is that no version exists — the
 * alternative would have been to drop that constraint, which is what the
 * Steven-ownership chain (comment → version → work) is built on. A separate
 * table keeps that chain intact and gives these notes their own lifecycle: they
 * belong to the line, so they survive the first upload instead of being swept
 * away with a version, and they can never be confused for feedback on a mix.
 *
 * On screen they are NOT a second comments system — they normalise to the shape
 * the comment list already renders (no timecode, no role), so the user sees one
 * area throughout.
 */
import "server-only";
import { supabase } from "@/lib/supabase";
import type { MixTargetNote } from "@/lib/types";

function mapRow(r: Record<string, unknown>): MixTargetNote {
  return {
    id:          r.id             as string,
    mixTargetId: r.mix_target_id  as string,
    noteText:    (r.note_text     as string) ?? "",
    author:      (r.author        as string | null) ?? null,
    status:      r.status === "resolved" ? "resolved" : "open",
    createdAt:   (r.created_at    as string) ?? "",
    updatedAt:   (r.updated_at    as string) ?? "",
  };
}

/** A line's notes, oldest first — they read as a briefing, not a feed. */
export async function listMixTargetNotes(targetId: string): Promise<MixTargetNote[]> {
  const { data, error } = await supabase
    .from("mix_target_notes")
    .select("*")
    .eq("mix_target_id", targetId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => mapRow(r as Record<string, unknown>));
}

/** Fetch one note (null = not found). Used for the ownership check. */
export async function getMixTargetNote(id: string): Promise<MixTargetNote | null> {
  const { data, error } = await supabase
    .from("mix_target_notes").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapRow(data as Record<string, unknown>) : null;
}

export async function createMixTargetNote(fields: {
  mixTargetId: string;
  noteText:    string;
  author?:     string | null;
}): Promise<MixTargetNote> {
  const noteText = fields.noteText.trim();
  // Also enforced by mix_target_notes_text_present at the DB level; checked here
  // so the caller gets a clean 400 instead of a constraint violation.
  if (!noteText) throw new Error("טקסט ההערה חסר");

  const { data, error } = await supabase
    .from("mix_target_notes")
    .insert({ mix_target_id: fields.mixTargetId, note_text: noteText, author: fields.author ?? null })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return mapRow(data as Record<string, unknown>);
}

/** Patch the text and/or the open|resolved state. updated_at is set here, the
 *  same way mix_comments and mix_versions do it — there is no DB trigger. */
export async function updateMixTargetNote(
  id: string,
  fields: { noteText?: string; status?: "open" | "resolved" },
): Promise<MixTargetNote> {
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (fields.noteText !== undefined) {
    const text = fields.noteText.trim();
    if (!text) throw new Error("טקסט ההערה חסר");
    patch.note_text = text;
  }
  if (fields.status !== undefined) {
    if (fields.status !== "open" && fields.status !== "resolved") throw new Error("סטטוס לא תקין");
    patch.status = fields.status;
  }

  const { data, error } = await supabase
    .from("mix_target_notes").update(patch).eq("id", id).select().single();
  if (error) throw new Error(error.message);
  return mapRow(data as Record<string, unknown>);
}

export async function deleteMixTargetNote(id: string): Promise<void> {
  const { error } = await supabase.from("mix_target_notes").delete().eq("id", id);
  if (error) throw new Error(error.message);
}
