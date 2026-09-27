import "server-only";
import { listLabelArtists } from "./label-artists-store";
import { resolveNewProjectBusinessType } from "./project-classification";

/**
 * Server side of the B2 Owner classification rule: the live label roster (id + name only, read-only) → the business
 * type a NEW project gets. Used by the shared create writers (lib/writes/projects createClientProject,
 * lib/writes/proposals convertProposal) — the UI routes and Sunny's CREATE_PROJECT / CONVERT_PROPOSAL go through them.
 */
export async function labelRosterForClassification(): Promise<Array<{ id: string; name: string }>> {
  return (await listLabelArtists()).map((a) => ({ id: a.id, name: a.name }));
}
export async function newProjectBusinessType(artist: string | null | undefined) {
  return resolveNewProjectBusinessType(artist, labelRosterForClassification);
}
