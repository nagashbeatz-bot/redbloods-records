/**
 * Client / label classification of a project — ONE canonical field, one Owner rule (B2, Owner canon 2026-09-27).
 *
 * Canonical: `projects.project_business_type` ("לקוח" | "לייבל", lib/types.ts). `isLabelProject` is the ONLY
 * classifier any reader (UI, Sunny views, company view) may use.
 *
 * Owner rule (the only automatic classification, applied at CREATE time only — Owner decision 2026-09-28, task 6,
 * supersedes the 2026-09-27 "solo or in a collaboration" wording):
 *   NagashBeatz (נגש ביטס) credited                                  → LABEL (everything under NagashBeatz is Records)
 *   שליו טסמה / אבי מולה credited, and nobody else (solo / together)  → LABEL
 *   a Records artist credited together with an EXTERNAL party         → NO rule (host vs guest is not recorded — e.g.
 *                                                                       בלאגן: טל צגאי host, אבי מולה guest = Studio).
 *                                                                       Never guessed as label; the app default לקוח.
 * The artists are identified by their stable label_artists.id (via the roster name → id map), never by a "roster
 * artist = label" rule: DJ CLEANTONE and any other name are NOT covered. A client who came because of the NagashBeatz
 * brand but does not credit NagashBeatz is not covered either.
 *
 * Everything else — a roster-name match, a release row, clients.status "אמן לייבל", Red Films client_source,
 * the Owner's LABEL_SONGS integrity answers — is detection / migration EVIDENCE, never a competing classifier.
 * An existing project is never reclassified automatically: a stored לקוח that the Owner rule would call לייבל is a
 * DERIVED signal (MISMATCH_OWNER_RULE) with an explicit, Owner-clicked fix (PATCH …/business-type).
 *
 * Pure: no I/O, safe for client components and scripts.
 */
import type { ProjectBusinessType } from "./types";
import { AVI_ARTIST_ID } from "./roles";
import { SHALEV_ARTIST_ID, SHALEV_NAME, AVI_NAME } from "./red-artists/portal-registry";
import { splitArtistNames } from "./partner/dossiers/relations";

/** The label_artists ids the Owner rule covers (Shalev Tasama, Avi Molla). Reuses the existing id constants. */
export const OWNER_LABEL_ARTIST_IDS: ReadonlySet<string> = new Set([SHALEV_ARTIST_ID, AVI_ARTIST_ID]);

/** Registered names of the covered artists — used ONLY as a fallback roster when the live roster cannot be read. */
export const OWNER_LABEL_REGISTERED_ROSTER: ReadonlyArray<{ id: string; name: string }> = [
  { id: SHALEV_ARTIST_ID, name: SHALEV_NAME },
  { id: AVI_ARTIST_ID, name: AVI_NAME },
];

export const OWNER_LABEL_RULE_HE = "כלל הבעלים: פרויקט שמקרדט את NagashBeatz (נגש ביטס) הוא פרויקט לייבל; פרויקט של שליו טסמה / אבי מולה (לבד או שניהם יחד, בלי גורם חיצוני) הוא פרויקט לייבל. אמן Records שמתארח אצל גורם חיצוני — אין סיווג אוטומטי (דורש החלטת בעלים). אין כלל כללי של 'אמן רוסטר = לייבל'.";

/** A project's artist credits — the app-wide /[,،;]/ split, trimmed (the shared splitter). */
export const projectArtistTokens = (artistText: string | null | undefined): string[] => splitArtistNames(artistText ?? "");

/** Roster name → id. A name carried by two roster rows is AMBIGUOUS and maps to null (never guessed). */
export type RosterIdByName = ReadonlyMap<string, string | null>;
export function rosterIdByNameOf(roster: ReadonlyArray<{ id: string; name: string }>): Map<string, string | null> {
  const m = new Map<string, string | null>();
  for (const a of roster) {
    const k = (a.name ?? "").trim();
    if (!k) continue;
    m.set(k, m.has(k) && m.get(k) !== a.id ? null : a.id);
  }
  return m;
}

/** NagashBeatz as a project credit (exact token; the roster name נגש ביטס or the brand spelling). */
const NAGASH_TOKENS: ReadonlySet<string> = new Set(["נגש ביטס", "nagashbeatz", "nagash beatz"]);
export const isNagashBeatzToken = (t: string): boolean => NAGASH_TOKENS.has(t.trim()) || NAGASH_TOKENS.has(t.trim().toLowerCase());

/**
 * Who is credited, for the Records settlement (Owner decision 2026-09-28): the covered Records artists (Shalev / Avi, by
 * the registered roster ids), NagashBeatz, and every other credit (EXTERNAL — a host / client / guest outside Records).
 * Exact tokens of the shared splitter only; no fuzzy matching, no position rule.
 */
export interface RecordsParties { tokens: string[]; recordsArtists: Array<{ id: string; name: string }>; nagashBeatz: boolean; external: string[] }
export function recordsPartiesOf(artistText: string | null | undefined, rosterIdByName?: RosterIdByName): RecordsParties {
  const tokens = projectArtistTokens(artistText);
  const map = rosterIdByName ?? rosterIdByNameOf(OWNER_LABEL_REGISTERED_ROSTER);
  const recordsArtists: Array<{ id: string; name: string }> = [];
  const external: string[] = [];
  let nagashBeatz = false;
  for (const t of tokens) {
    if (isNagashBeatzToken(t)) { nagashBeatz = true; continue; }
    const id = map.get(t);
    if (id && OWNER_LABEL_ARTIST_IDS.has(id)) { if (!recordsArtists.some((a) => a.id === id)) recordsArtists.push({ id, name: t }); continue; }
    external.push(t);
  }
  return { tokens, recordsArtists, nagashBeatz, external };
}

/** The covered label_artists ids credited on this artist text (exact token → roster id). */
export function ownerRuleArtistIds(artistText: string | null | undefined, rosterIdByName: RosterIdByName): string[] {
  const ids = new Set<string>();
  for (const t of projectArtistTokens(artistText)) {
    const id = rosterIdByName.get(t);
    if (id && OWNER_LABEL_ARTIST_IDS.has(id)) ids.add(id);
  }
  return [...ids];
}

/**
 * "לייבל" when NagashBeatz is credited, or when Shalev / Avi are credited with nobody external; null otherwise (= no
 * Owner rule — a Records artist next to an external party may be a guest at an external host; stays the app default).
 */
export function ownerRuleClassification(artistText: string | null | undefined, rosterIdByName: RosterIdByName): ProjectBusinessType | null {
  const p = recordsPartiesOf(artistText, rosterIdByName);
  if (p.nagashBeatz) return "לייבל";
  return p.recordsArtists.length > 0 && p.external.length === 0 ? "לייבל" : null;
}

/** The business type a NEW project gets: the Owner rule, else the app default לקוח. */
export function businessTypeForNewProject(artistText: string | null | undefined, rosterIdByName: RosterIdByName): ProjectBusinessType {
  return ownerRuleClassification(artistText, rosterIdByName) ?? "לקוח";
}

/** THE classifier: the stored project_business_type. Unknown / empty is NOT label. */
export function isLabelProject(p: { businessType?: string | null } | null | undefined): boolean {
  return p?.businessType === "לייבל";
}
/** Stored client work (explicitly לקוח). Unknown / empty is neither. */
export function isClientProject(p: { businessType?: string | null } | null | undefined): boolean {
  return p?.businessType === "לקוח";
}

export const MISMATCH_OWNER_RULE = "MISMATCH_OWNER_RULE" as const;
export interface ClassificationSignal {
  code: typeof MISMATCH_OWNER_RULE;
  kind: "DERIVED_SIGNAL";
  he: string;
  stored: string | null;
  ownerRule: ProjectBusinessType;
  artistIds: string[];
  /** Never an automatic write — the fix is the explicit Owner action (UI button / SET_PROJECT_BUSINESS_TYPE). */
  fix: "OWNER_ACTION_SET_PROJECT_BUSINESS_TYPE";
}

/**
 * DERIVED signal (never a write): the stored type is not לייבל, but the Owner rule says it is.
 * Null when the stored type already agrees or the rule does not apply.
 */
export function classificationSignal(project: { businessType?: string | null; artistText?: string | null; artist?: string | null }, rosterIdByName: RosterIdByName): ClassificationSignal | null {
  const artistText = project.artistText ?? project.artist ?? "";
  const ids = ownerRuleArtistIds(artistText, rosterIdByName);
  if (ownerRuleClassification(artistText, rosterIdByName) !== "לייבל" || isLabelProject(project)) return null;
  return {
    code: MISMATCH_OWNER_RULE, kind: "DERIVED_SIGNAL",
    he: `לפי כלל הבעלים זה פרויקט לייבל (שמור כ'${project.businessType || "לא ידוע"}'). אין שינוי אוטומטי — הסיווג משתנה רק בפעולה מפורשת של הבעלים.`,
    stored: project.businessType ?? null, ownerRule: "לייבל", artistIds: ids, fix: "OWNER_ACTION_SET_PROJECT_BUSINESS_TYPE",
  };
}

/**
 * The create-path rule with the roster loaded by the caller (the writers pass the live label_artists read).
 * A roster read failure falls back to the code-registered ids / names of the covered artists — the Owner rule is
 * never silently skipped because a read failed. Returns the basis for the preview / audit.
 */
export async function resolveNewProjectBusinessType(
  artistText: string | null | undefined,
  loadRoster: () => Promise<ReadonlyArray<{ id: string; name: string }>>,
): Promise<{ businessType: ProjectBusinessType; basis: "OWNER_RULE" | "DEFAULT_CLIENT"; roster: "LIVE" | "REGISTERED_FALLBACK"; artistIds: string[] }> {
  let roster: ReadonlyArray<{ id: string; name: string }>;
  let src: "LIVE" | "REGISTERED_FALLBACK" = "LIVE";
  try { roster = await loadRoster(); } catch { roster = OWNER_LABEL_REGISTERED_ROSTER; src = "REGISTERED_FALLBACK"; }
  const map = rosterIdByNameOf(roster);
  const ids = ownerRuleArtistIds(artistText, map);
  const label = ownerRuleClassification(artistText, map) === "לייבל";
  return { businessType: label ? "לייבל" : "לקוח", basis: label ? "OWNER_RULE" : "DEFAULT_CLIENT", roster: src, artistIds: ids };
}
