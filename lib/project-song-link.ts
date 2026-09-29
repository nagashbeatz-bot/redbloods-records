/**
 * Song ↔ clip project link (Owner decision 2026-09-29, P1). Pure — no I/O.
 *
 * The canonical link is ONE column on the CLIP project: projects.song_project_id → the song project's id
 * (uuid, FK ON DELETE SET NULL, CHECK not self — Owner-approved DDL 2026-09-29). A song discovers its clips by the
 * reverse lookup (clips whose song_project_id = the song's id). parent_project stays a legacy / display NAME and is
 * never read as this link.
 *
 * Application rules (enforced by every writer of the link — none exists yet in P1):
 *   - only a project whose project_type is 'קליפ' may carry a song link;
 *   - the target must be an existing project that is NOT a clip;
 *   - never itself (the DB CHECK also refuses it).
 */
export const CLIP_PROJECT_TYPE = "קליפ";

export type SongLinkRefusal = "NOT_A_CLIP_PROJECT" | "SELF_LINK" | "SONG_NOT_FOUND" | "TARGET_IS_A_CLIP" | "BAD_ID";
export type SongLinkVerdict = { ok: true; songProjectId: string | null } | { ok: false; code: SongLinkRefusal; messageHe: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HE: Record<SongLinkRefusal, string> = {
  NOT_A_CLIP_PROJECT: "רק פרויקט מסוג 'קליפ' יכול להיות מקושר לשיר",
  SELF_LINK: "פרויקט לא יכול להיות מקושר לעצמו",
  SONG_NOT_FOUND: "לא מצאתי את פרויקט השיר",
  TARGET_IS_A_CLIP: "פרויקט השיר לא יכול להיות בעצמו פרויקט קליפ",
  BAD_ID: "מזהה פרויקט לא תקין",
};

/**
 * May `clip` carry the link `songProjectId`? null = remove the link (always allowed).
 * `song` is the target as read fresh by the writer (null = it does not exist).
 */
export function validateSongLink(
  clip: { id: string; projectType: string | null | undefined },
  songProjectId: string | null,
  song: { id: string; projectType: string | null | undefined } | null,
): SongLinkVerdict {
  if (songProjectId === null) return { ok: true, songProjectId: null };
  const refuse = (code: SongLinkRefusal): SongLinkVerdict => ({ ok: false, code, messageHe: HE[code] });
  if (!UUID_RE.test(songProjectId)) return refuse("BAD_ID");
  if (songProjectId.toLowerCase() === clip.id.toLowerCase()) return refuse("SELF_LINK");
  if ((clip.projectType ?? "") !== CLIP_PROJECT_TYPE) return refuse("NOT_A_CLIP_PROJECT");
  if (!song || song.id.toLowerCase() !== songProjectId.toLowerCase()) return refuse("SONG_NOT_FOUND");
  if ((song.projectType ?? "") === CLIP_PROJECT_TYPE) return refuse("TARGET_IS_A_CLIP");
  return { ok: true, songProjectId: songProjectId.toLowerCase() };
}

/** The canonical relation, both directions, from project rows (id, type, song link) — never by name. */
export function songClipRelations<P extends { id: string; songProjectId?: string | null }>(projectId: string, all: readonly P[]): { song: P | null; clips: P[] } {
  const self = all.find((p) => p.id === projectId) ?? null;
  const song = self?.songProjectId ? all.find((p) => p.id === self.songProjectId) ?? null : null;
  const clips = all.filter((p) => p.songProjectId === projectId && p.id !== projectId);
  return { song, clips };
}
