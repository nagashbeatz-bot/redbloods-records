/**
 * Redbloods Partner — Entity Dossiers (Phase C.1). Public entrypoint.
 *
 * Project Dossier only in this phase. Pure, deterministic, built over an
 * already-computed PartnerCompanyState — no I/O in this module at all.
 */
export * from "./types";
export { buildProjectDossier, buildAllProjectDossiers } from "./project";
export { splitArtistNames, matchClientCandidates, matchLabelArtistCandidates } from "./relations";
