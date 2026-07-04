import "server-only";
import { supabase } from "./supabase";

/**
 * Victor profile avatar — non-destructive.
 *   • The SOURCE image lives in Dropbox at a FIXED, server-constant path
 *     (never client input → no path traversal).
 *   • The crop is a lightweight settings layer over it (zoom + position %),
 *     editable any time without re-uploading. No schema change (settings k/v).
 */
const SETTINGS_KEY = "victor_avatar";
const AVATAR_DIR = "/Team/Victor/Profile"; // fixed app-folder path, not client-controlled

export interface VictorAvatar {
  dropboxPath: string | null; // source image path in Dropbox
  ext: string | null;
  zoom: number;               // >= 1 (1 = fit, larger = zoomed in)
  posX: number;               // background-position X, 0..100
  posY: number;               // background-position Y, 0..100
  updatedAt: string | null;
}
const EMPTY: VictorAvatar = { dropboxPath: null, ext: null, zoom: 1, posX: 50, posY: 50, updatedAt: null };

export async function getVictorAvatar(): Promise<VictorAvatar> {
  const { data } = await supabase.from("settings").select("value").eq("key", SETTINGS_KEY).maybeSingle();
  const v = (data?.value ?? null) as Partial<VictorAvatar> | null;
  return v ? { ...EMPTY, ...v } : EMPTY;
}

export async function setVictorAvatar(patch: Partial<VictorAvatar>): Promise<VictorAvatar> {
  const cur = await getVictorAvatar();
  const next: VictorAvatar = { ...cur, ...patch, updatedAt: new Date().toISOString() };
  await supabase
    .from("settings")
    .upsert({ key: SETTINGS_KEY, value: next as unknown as Record<string, unknown> }, { onConflict: "key" });
  return next;
}

/** Server-constant Dropbox path for the source image (ext sanitized to a short
 *  alnum token). Never derived from a client-supplied filename. */
export function avatarDropboxPath(ext: string): string {
  const clean = (ext || "jpg").replace(/[^a-z0-9]/gi, "").toLowerCase().slice(0, 5) || "jpg";
  return `${AVATAR_DIR}/avatar-original.${clean}`;
}
