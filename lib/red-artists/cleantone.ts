import "server-only";

/**
 * Single canonical identity for DJ CLEANTONE (רועי איוב) — every server-only
 * route/store that needs to recognize him imports from here. Never hardcode
 * this UUID (or his display name) anywhere else.
 *
 * He is a TEAM member (the label's DJ), not a label artist (Owner decision 2026-09-27): his only
 * canonical identity is his client record (shows.dj_client_id). His former label_artists row was
 * deleted that day (it had no ledger / cycle / media / release rows).
 */
export const CLEANTONE_CLIENT_ID = "a249d610-a0b5-443f-a329-5ef969e0d94c";
export const CLEANTONE_ARTIST_NAME = "DJ CLEANTONE";

/**
 * The deleted label_artists row's entity key. Owner knowledge recorded before 2026-09-27 is keyed on it (append-only,
 * never rewritten) — read-time it is an alias of his DJ / client identity, never a live label artist.
 */
export const CLEANTONE_RETIRED_LABEL_ARTIST_KEY = "label-artist:f55d5010-4f7c-4372-9af6-b241ba594519";
