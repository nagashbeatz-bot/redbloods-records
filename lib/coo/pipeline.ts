/**
 * The whole deterministic engine as ONE pure function:
 *   raw rows → Company State → Signals → Cases → priority → Morning Brief.
 * No I/O, no LLM, no writes. Same input + same config + same `now` → same output.
 */
import { COO_CONFIG, type CooConfig } from "./config";
import { buildCompanyState } from "./facts";
import { detectSignals } from "./signals";
import { buildCases } from "./cases";
import { composeBrief } from "./brief";
import type { Brief, Case, CompanyState, CooRawInput, Signal } from "./types";

export interface CooResult {
  state: CompanyState;
  signals: Signal[];
  cases: Case[];      // ALL cases, ranked (the brief shows only the top ones)
  notices: Signal[];
  brief: Brief;
}

export function computeCoo(raw: CooRawInput, now: Date = new Date(), cfg: CooConfig = COO_CONFIG): CooResult {
  const state = buildCompanyState(raw, now, cfg);
  const signals = detectSignals(state, cfg);
  const { cases, notices } = buildCases(state, signals, cfg);
  const brief = composeBrief(state, signals, cases, notices, cfg, now);
  return { state, signals, cases, notices, brief };
}
