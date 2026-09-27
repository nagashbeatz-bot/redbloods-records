/**
 * Mix version GROUPING — one pure rule shared by the Steven page (groupVersions) and Sunny's mix view (roundsOf), so
 * the UI and Sunny always agree on what "one version / round" is (integrity fix A2, 2026-09-27).
 *
 * A trailing role qualifier is stripped so "Mix 1 (acapella)" groups with "Mix 1", and the key is scoped by the riddim
 * line (mix_target_id): two lines may both have a "Mix 1". Off a riddim every target is null, so the key reduces to the
 * base label. A version with an empty label is its own group (keyed by its id).
 */

/** Strip a trailing role qualifier so "Mix 1 (acapella)" groups with "Mix 1". Empty label → "". */
export function baseVersionKey(label: string | null | undefined): string {
  const l = label ?? "";
  return l
    .replace(/[\s\-_()·|]*\b(acapella|accapella|acappella|acapela|vocals?|vox|instrumental|inst|beat)\b[\s\-_()·|]*$/i, "")
    .trim() || l;
}

/** THE group key: `${targetId ?? "unassigned"}|${baseVersionKey(label) || id}`. */
export function versionGroupKey(v: { id: string; label: string | null | undefined; targetId: string | null | undefined }): string {
  return `${v.targetId ?? "unassigned"}|${baseVersionKey(v.label) || v.id}`;
}

/** The group's display label (the base label, else the raw label). */
export function versionGroupLabel(label: string | null | undefined): string {
  return baseVersionKey(label) || (label ?? "");
}
