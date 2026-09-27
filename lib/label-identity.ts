/**
 * Label-artist identity (B4, 2026-09-27): stable ids first, names are display snapshots, ambiguity is explicit.
 * Pure — no I/O; safe for client components, Sunny views and scripts. No schema change.
 */
import { splitArtistNames } from "./partner/dossiers/relations";

export type LabelIdentityQuality = "CANONICAL_RELATION" | "TEXT_MATCH" | "AMBIGUOUS" | "UNKNOWN";
export interface ProjectLabelArtistIdentity {
  labelArtistId: string | null;
  quality: LabelIdentityQuality;
  basis: string;
  /** Every roster id whose exact name is credited (a collab lists several). */
  candidates: string[];
}

/**
 * The label artist a project belongs to: project_release_details.label_artist_id (CANONICAL) first. Without a
 * release row, an exact credit-token → roster-name match is TEXT_MATCH when exactly one roster artist is credited
 * and the project has a single credit, else AMBIGUOUS (collab / several roster artists) — never guessed.
 * Used by callers that today match by name (e.g. recoup clip matching in lib/label-clips.ts — B3 owns that rewrite).
 */
export function labelArtistIdForProject(
  p: { releaseLabelArtistId?: string | null; artistText?: string | null },
  roster: ReadonlyArray<{ id: string; name: string }>,
): ProjectLabelArtistIdentity {
  if (p.releaseLabelArtistId) return { labelArtistId: p.releaseLabelArtistId, quality: "CANONICAL_RELATION", basis: "project_release_details.label_artist_id", candidates: [p.releaseLabelArtistId] };
  const tokens = splitArtistNames(p.artistText ?? "");
  const ids = [...new Set(roster.filter((a) => tokens.includes(a.name.trim())).map((a) => a.id))];
  if (ids.length === 0) return { labelArtistId: null, quality: "UNKNOWN", basis: "no release row and no credited roster name", candidates: [] };
  if (ids.length === 1 && tokens.length === 1) return { labelArtistId: ids[0], quality: "TEXT_MATCH", basis: "no release row — the single credit equals a roster name (text)", candidates: ids };
  return { labelArtistId: null, quality: "AMBIGUOUS", basis: tokens.length > 1 ? "no release row — a collaboration credit; the owning artist is not recorded" : "no release row — several roster rows share the credited name", candidates: ids };
}

/**
 * What still keys on the label artist's NAME after B4 (the rename disclosure — Sunny's RENAME_LABEL_ARTIST and any
 * rename surface show this list). Shalev / Avi portals, the Projects → sketch link of a release owner and the
 * Owner classification rule's id set are id-based and survive a rename.
 */
export const LABEL_ARTIST_RENAME_NAME_KEYED_DEPENDENTS_HE: readonly string[] = [
  "סגירת הופעה → מאזן האמן: מזוהה לפי השם המדויק של האמן בהופעה (להופעות אין מזהה אמן לייבל)",
  "קרדיט בפרויקטים (projects.artist) הוא טקסט: פרויקטים עם השם הישן לא יזוהו כשייכים לאמן (רשימת 'הוסף ריליס', כלל הסיווג לפרויקט חדש, התאמות טקסט אצל סאני)",
  "פורטל DJ CLEANTONE / נגש ביטס, והרשימות 'קישור מפרויקטים' / 'התראה לאמן' / השם הקצר — לפי השם הרשום בקוד",
  "עמודי המאזן של שליו ועמוד ה-DJ, והתראות שליו (סשנים / שבועי / סקיצות / תזכורות) — מאתרים את האמן לפי השם",
  "החזר השקעה בקליפים ואירועי השבוע של האמן — התאמה לפי שם האמן",
];
