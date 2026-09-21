import "server-only";

/** Server orchestrator: read (SELECT-only) → pure deterministic pipeline. Nothing is written or cached. */
import { COO_CONFIG, type CooConfig } from "./config";
import { readCooRaw } from "./readers";
import { computeCoo, type CooResult } from "./pipeline";

export async function buildCoo(now: Date = new Date(), cfg: CooConfig = COO_CONFIG): Promise<CooResult> {
  const raw = await readCooRaw(now, cfg);
  return computeCoo(raw, now, cfg);
}
