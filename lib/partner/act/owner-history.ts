/**
 * The Owner's own action history for a Redbloods MAIN read surface (the executive dashboard) — Dashboard parity
 * (Owner decision 2026-10-05, Phase A2). It is the SAME owner-scoped history the Sunny connector reads through its act
 * relay: the SAME switch (the action layer on MAIN, PARTNER_ACT_ENABLED), the SAME service operation (planStatus), the
 * SAME request (ACTION_HISTORY_REQUEST) and the SAME mapping (actionHistoryItemsOf). Read-only: no plan, no approval,
 * no write. Not readable → NOT_READ with the reason (never "nothing was done").
 */
import type { ActServiceDeps } from "./service";
import { planStatus } from "./service";
import { ACT_ENABLED_ENV } from "./internal-handler";
import { ACTION_HISTORY_REQUEST, actionHistoryItemsOf } from "../sunny/with-history";
import type { ActionHistoryItem } from "../sunny/since";

/** The caller id MAIN's dashboard reads under. History is OWNER-scoped (the client id never filters it). */
export const DASHBOARD_ACT_CLIENT_ID = "redbloods-dashboard";

export type OwnerActionHistory = { status: "READ"; items: ActionHistoryItem[] } | { status: "NOT_READ"; reasonHe: string };

export async function readOwnerActionHistory(ownerId: string | null, env: Record<string, string | undefined>, deps: () => Promise<ActServiceDeps>): Promise<OwnerActionHistory> {
  if (!ownerId) return { status: "NOT_READ", reasonHe: "לא זוהה הבעלים המחובר — היסטוריית הפעולות לא נקראה" };
  if (env.REDBLOODS_MCP_ONLY === "true" || env[ACT_ENABLED_ENV] !== "true") return { status: "NOT_READ", reasonHe: "שכבת הפעולות כבויה — היסטוריית הפעולות לא נקראה (זה לא אומר שלא בוצע כלום)" };
  try {
    const r = await planStatus({ ...ACTION_HISTORY_REQUEST }, { ownerId, clientId: DASHBOARD_ACT_CLIENT_ID }, await deps());
    const items = actionHistoryItemsOf(r as unknown as Record<string, unknown>);
    return items ? { status: "READ", items } : { status: "NOT_READ", reasonHe: "היסטוריית הפעולות לא זמינה כרגע (זה לא אומר שלא בוצע כלום)" };
  } catch {
    return { status: "NOT_READ", reasonHe: "קריאת היסטוריית הפעולות נכשלה (זה לא אומר שלא בוצע כלום)" };
  }
}
