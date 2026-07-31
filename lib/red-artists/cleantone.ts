import "server-only";

/**
 * Single canonical identity for DJ CLEANTONE (רועי איוב) — every server-only
 * route/store that needs to recognize him imports from here. Never hardcode
 * this UUID (or his display name) anywhere else.
 */
export const CLEANTONE_CLIENT_ID = "a249d610-a0b5-443f-a329-5ef969e0d94c";
export const CLEANTONE_ARTIST_NAME = "DJ CLEANTONE";
