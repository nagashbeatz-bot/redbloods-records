/**
 * Redbloods Partner — Entity Dossiers (Phase C.1 / C.2). Public entrypoint.
 *
 * Project, Client, and Label Artist Dossiers. Pure, deterministic, built over
 * an already-computed PartnerCompanyState — no I/O in this module at all.
 */
export * from "./types";
export { buildProjectDossier, buildAllProjectDossiers } from "./project";
export { buildClientDossier, buildAllClientDossiers } from "./client";
export { buildLabelArtistDossier, buildAllLabelArtistDossiers } from "./labelArtist";
export { buildClientProjectIndex, buildArtistProjectIndex } from "./indexes";
export { aggregateFinance, aggregateSessions } from "./aggregate";
export { splitArtistNames, matchClientCandidates, matchLabelArtistCandidates } from "./relations";
