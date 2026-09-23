/**
 * Redbloods Partner — Suggested Actions (Phase F.1F, SHADOW MODE).
 * Public entrypoint. Pure proposals only — no persistence, no approval
 * record, no execution handler, no UI, no API route.
 */
export * from "./types";
export { deriveSuggestedActions, revalidateSuggestedAction, type DeriveSuggestedActionsInput, type DeriveSuggestedActionsResult } from "./suggested";
