/**
 * Pure numbering/naming decisions for mix versions — no "server-only", no
 * Supabase, no Dropbox, so it is testable from a plain tsx script (same split as
 * lib/steven-mix-reminder-pure.ts). lib/mix-version-upload.ts holds the I/O and
 * calls straight into these functions.
 *
 * The whole point of this file is the riddim rule: a riddim work holds SEVERAL
 * independent mix lines, so "which Mix number is next" and "is this label taken"
 * must be answered per LINE, not per work. Off a riddim every row's target is
 * null and every function below degrades to exactly the pre-riddim behaviour.
 *
 * The one asymmetry, and it is deliberate:
 *   • labels  are scoped PER TARGET  — Tasama Mix 1 and Desto Mix 1 coexist.
 *   • filenames are scoped PER WORK  — every line shares one /Mix Versions/
 *     folder, so a collision check that ignored the other lines (or the legacy
 *     rows) would let Dropbox silently autorename a file.
 */

/** The fields of a mix_versions row these decisions need. */
export type VersionRow = { label: string; fileName: string; mixTargetId: string | null };

/**
 * The labels that count when numbering the NEXT version. On a riddim only the
 * chosen line's rows count — which is what lets each line start at Mix 1 and
 * keeps one line's Mix 3 from pushing another line's first upload to Mix 4.
 * Legacy rows (null target) belong to no line, so they never affect a line's
 * numbering; they stay visible under "Unassigned" instead.
 */
export function labelsInScope(
  rows: VersionRow[],
  opts: { isRiddim: boolean; mixTargetId: string | null },
): Set<string> {
  const scoped = opts.isRiddim ? rows.filter((r) => r.mixTargetId === opts.mixTargetId) : rows;
  return new Set(scoped.map((r) => r.label));
}

/** File names collide physically, so this is ALWAYS the whole work. */
export function fileNamesInScope(rows: VersionRow[]): Set<string> {
  return new Set(rows.map((r) => r.fileName));
}

/** Lowest free "Mix N" in the given scope (1-based). */
export function nextMixLabel(existingLabels: Set<string>): string {
  let n = 1;
  while (existingLabels.has(`Mix ${n}`)) n++;
  return `Mix ${n}`;
}

/**
 * Does this explicit label already exist in scope? Drives the 409. Scoped, so
 * uploading "Mix 1" for Desto is NOT rejected just because Tasama has one.
 * `addToExisting` is the caller's separate opt-in to stack another role file
 * under a label that is already there.
 */
export function isLabelTaken(existingLabels: Set<string>, label: string): boolean {
  return existingLabels.has(label);
}

/**
 * The pieces of a version's stored file name, before the role word and
 * extension. On a riddim the line's name is inserted so two lines' "Mix 1"
 * cannot produce the same file in the shared folder.
 *
 * This is presentation + collision avoidance ONLY. mix_target_id is the source
 * of truth for the assignment and nothing ever parses it back out of the name —
 * that is exactly the mistake the file-name-derived `role` already made.
 */
export function versionNameParts(
  projectName: string,
  label: string,
  opts: { isRiddim: boolean; mixTargetName: string },
): string[] {
  return opts.isRiddim ? [projectName, opts.mixTargetName, label] : [projectName, label];
}
