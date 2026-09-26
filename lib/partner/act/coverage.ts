/**
 * SUNNY UNIVERSAL ACTION LAYER — "What can the Boss do in Redbloods that Sunny still cannot do?" (pure, exact).
 * Derived from the registry only; grouped by the Boss's four buckets and by wave. Proven by the foundation test.
 */
import { ACTION_CONTRACTS } from "./registry";
import type { ActionContract, Availability, AvailabilityDetail, Wave } from "./types";

/** Actions the Boss performs (not automatic system behaviour, not another person's own portal action). */
export const isBossAction = (c: ActionContract) => c.availabilityDetail !== "SYSTEM_AUTOMATIC" && c.availabilityDetail !== "OTHER_USER_PORTAL_ONLY" && c.availabilityDetail !== "SUNNY_NATIVE";
/** Sunny can carry it out end-to-end today (only after the Boss's approval). Wave 0 has none via Claude. */
export const sunnyCanDo = (c: ActionContract) => c.availabilityDetail === "EXECUTABLE";

export interface GapReport {
  bossActions: number;
  sunnyExecutableViaClaude: number;
  executableViaDashboardOnly: readonly string[];
  byBucket: Readonly<Record<Availability, number>>;
  byDetail: Readonly<Partial<Record<AvailabilityDetail, number>>>;
  byWave: Readonly<Partial<Record<Wave, readonly string[]>>>;
}
export function bossCanSunnyCannot(contracts: readonly ActionContract[] = ACTION_CONTRACTS): GapReport {
  const gap = contracts.filter((c) => isBossAction(c) && !sunnyCanDo(c));
  const byBucket = { SUNNY_EXECUTABLE: 0, SUNNY_NEEDS_HARDENING: 0, SUNNY_BLOCKED: 0, SUNNY_INTENTIONALLY_EXCLUDED: 0 } as Record<Availability, number>;
  const byDetail: Partial<Record<AvailabilityDetail, number>> = {};
  const byWave: Partial<Record<Wave, string[]>> = {};
  for (const c of gap) {
    byBucket[c.availability]++;
    byDetail[c.availabilityDetail] = (byDetail[c.availabilityDetail] ?? 0) + 1;
    (byWave[c.wave] ??= []).push(c.id);
  }
  return {
    bossActions: contracts.filter(isBossAction).length,
    sunnyExecutableViaClaude: contracts.filter(sunnyCanDo).length,
    executableViaDashboardOnly: contracts.filter((c) => c.availabilityDetail === "EXECUTABLE_VIA_DASHBOARD_APPROVAL").map((c) => c.id),
    byBucket, byDetail, byWave,
  };
}
