/**
 * Steven supplier scope — server-only. The single source of truth for what a
 * signed-in Steven ("steven" role) may see and touch. Two jobs:
 *
 *   1. sanitize — strip every owner-internal / financial field before any
 *      /api/supplier/steven/* response leaves the server (defence in depth: the
 *      UI also hides them, but the API is the real boundary).
 *   2. ownership — resolve work / version / comment ids to their owning work and
 *      confirm engineerName === 'Steven'. Anything else → null → the route 403s.
 *      This is what stops IDOR (Steven guessing another engineer's ids).
 *
 * NEVER trust a client-supplied engineer/vendor value — ownership is always
 * re-derived from the DB row here.
 */
import "server-only";
import type { SoundEngineerWork, MixVersion } from "@/lib/types";
import { getSoundEngineerWork } from "@/lib/sound-engineer-store";
import { getMixVersion } from "@/lib/mix-versions-store";
import { getMixComment } from "@/lib/mix-comments-store";

/** The one engineer name Steven's login is scoped to. */
export const STEVEN_ENGINEER = "Steven";

/**
 * Strip owner-INTERNAL fields from a work before sending to Steven. Payment info
 * (agreedPrice / amountPaid / balance / currency / paymentDate / derived pay status)
 * is now shown to Steven READ-ONLY (there is no work-mutation route for him, so the
 * data alone can't be changed). We still hide the finance-transaction link and any
 * owner-internal text / raw external link.
 */
export function sanitizeWorkForSteven(w: SoundEngineerWork): SoundEngineerWork {
  return {
    ...w,
    linkedTransactionId: null,   // internal Finance transaction id — never exposed
    notes:               "",     // owner-internal notes — never shown to Steven
    filesLink:           null,   // raw external link — never shown
  };
}

/** Replace a version's raw Dropbox path / path-bearing URL with an opaque,
 *  ownership-checked stream ref. Steven never receives a Dropbox path. */
export function sanitizeVersionForSteven(v: MixVersion): MixVersion {
  return {
    ...v,
    dropboxPath: "",
    url: `/api/supplier/steven/stream?versionId=${encodeURIComponent(v.id)}`,
  };
}

/** True when the work belongs to Steven. */
function isStevenWork(w: SoundEngineerWork | null): w is SoundEngineerWork {
  return !!w && w.engineerName === STEVEN_ENGINEER;
}

/** Resolve a work id → the work IFF it is Steven's, else null (→ 403). */
export async function assertStevenOwnsWork(workId: string): Promise<SoundEngineerWork | null> {
  const w = await getSoundEngineerWork(workId);
  return isStevenWork(w) ? w : null;
}

/** Resolve a version id → { version, work } IFF the version's work is Steven's. */
export async function assertStevenOwnsVersion(
  versionId: string
): Promise<{ version: MixVersion; work: SoundEngineerWork } | null> {
  const version = await getMixVersion(versionId);
  if (!version) return null;
  const work = await getSoundEngineerWork(version.soundEngineerWorkId);
  return isStevenWork(work) ? { version, work } : null;
}

/** Resolve a comment id → its owning work IFF that work is Steven's. */
export async function assertStevenOwnsComment(
  commentId: string
): Promise<{ work: SoundEngineerWork } | null> {
  const comment = await getMixComment(commentId);
  if (!comment) return null;
  const version = await getMixVersion(comment.mixVersionId);
  if (!version) return null;
  const work = await getSoundEngineerWork(version.soundEngineerWorkId);
  return isStevenWork(work) ? { work } : null;
}
