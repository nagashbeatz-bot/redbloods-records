/**
 * Clip — a REPORTING tag, never a second money layer.
 *
 * ONE MODEL (Owner decision 2026-10-01): a clip is its own PROJECT (project_type "קליפ", linked to its song
 * project). Every project — song or clip — has ONE price, the finance settings `agreedPrice`, and ONE
 * balance: agreedPrice − the project's received income (lib/finance/project-summary.ts). There is no clip price, no clip
 * purse, no clip debt and no clip payment list inside a project.
 *
 * expense_scope = "קליפ" stays a reporting category only (Finance badge, business unit, Records expense share, the
 * Red Films link). It NEVER removes an income row from its project's paid amount — `isProjectIncome` ignores the scope.
 *
 * Deliberately a plain module (no "server-only") so both server routes and client components can import it.
 */

/** expense_scope reporting tag for clip money (income or expense). A category, never a separate deal. */
export const CLIP_SCOPE = "קליפ";

const isIncomeType = (t: string | null | undefined) => t === "income" || t === "הכנסה";

/** True for any transaction (income or expense) tagged with the clip reporting category. */
export function isClipScoped(tx: { expense_scope?: string | null }): boolean {
  return (tx.expense_scope ?? "") === CLIP_SCOPE;
}

/**
 * True for income that counts toward its project's agreedPrice — EVERY income row of the project, whatever its
 * expense_scope. The one predicate every "received / expected / cancelled against the agreed price" aggregation uses.
 */
export function isProjectIncome(tx: { type?: string | null }): boolean {
  return isIncomeType(tx.type);
}

/**
 * True when a Red Films production was CREATED by its linked project's "שלח קליפ" (provenance only).
 *
 * B3 (Owner canon 2026-09-27): a project's price is never the production's planned budget. There is no price → budget
 * sync and no budget lock: every production owns its own planning budget and currency. This reads the provenance flag
 * the SERVER computes (lib/clip-production.ts isManagedClipProduction, from the project's finance-settings marker).
 */
export function isCreatedBySendClip(prod: {
  budget_managed_by_project?: boolean | null;
}): boolean {
  return prod.budget_managed_by_project === true;
}

/** Shown on a production created by "שלח קליפ" — provenance, never a lock. */
export const SEND_CLIP_PROVENANCE_NOTE = "נוצרה מהפרויקט ('שלח קליפ') — התקציב הוא תכנון של ההפקה, לא מחיר הפרויקט ללקוח";
