import "server-only";

/**
 * Server orchestrator: fetch (read-only, once) → pure assembly.
 * Mirrors lib/coo/build.ts exactly. Nothing is written or cached.
 */
import { buildCoo } from "../../coo/build";
import { assemblePartnerCompanyState } from "./company-state";
import { readPartnerEyesRaw } from "./readers";
import type { PartnerCompanyState } from "./types";

export async function buildPartnerCompanyState(now: Date = new Date()): Promise<PartnerCompanyState> {
  const [coo, raw] = await Promise.all([buildCoo(now), readPartnerEyesRaw()]);
  return assemblePartnerCompanyState(coo, raw);
}
