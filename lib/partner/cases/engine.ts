/**
 * Redbloods Partner — Case Engine (Phase E.1, SHADOW MODE). Public entrypoint.
 *
 * PURE. No I/O, no Supabase, no baseline load (Owner instruction §38: the
 * caller runs Change Awareness first, if at all, and passes its result in —
 * this engine never re-derives or re-fetches anything). `today` is always
 * injected, never Date.now() read inside a detector, so tests stay
 * deterministic (Owner instruction §55).
 *
 * A state-only call (changes omitted) produces STATE Cases only. Passing the
 * latest Change Awareness result also produces CHANGE Cases. There is no
 * STATE_AND_CHANGE case in the E.1 catalog yet (kept in the CaseCreatedFrom
 * type for future detectors that genuinely need both).
 */
import { detectVictorInternalDeadlineCases, detectVictorUnfollowedDeliveryCases } from "./detectors/victor";
import { detectProjectFinanceCases } from "./detectors/finance";
import { detectReleaseTimingCases } from "./detectors/release";
import { detectProjectDeadlineCases } from "./detectors/project";
import { detectChangeDerivedCases } from "./detectors/changeDerived";
import type { PartnerChange } from "../changes/types";
import type { PartnerCompanyState } from "../eyes/types";
import type { PartnerCase } from "./types";

export interface BuildPartnerCasesInput {
  state: PartnerCompanyState;
  /** Israel-calendar YYYY-MM-DD — injected, never computed inside this module. */
  today: string;
  /** The latest Change Awareness comparison's changes, if you want CHANGE-derived Cases this run. Omit/null for a state-only run. */
  changes?: PartnerChange[] | null;
  /** Required alongside `changes` so CHANGE Cases can report which two observations they came from (never persisted). */
  changeContext?: { previousCapturedAt: string | null; currentCapturedAt: string } | null;
}

function sortCases(cases: PartnerCase[]): PartnerCase[] {
  return [...cases].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export function buildPartnerCases(input: BuildPartnerCasesInput): PartnerCase[] {
  const cases: PartnerCase[] = [
    ...detectVictorInternalDeadlineCases(input.state, input.today),
    ...detectVictorUnfollowedDeliveryCases(input.state),
    ...detectProjectFinanceCases(input.state),
    ...detectReleaseTimingCases(input.state, input.today),
    ...detectProjectDeadlineCases(input.state, input.today),
  ];
  if (input.changes && input.changes.length > 0) {
    cases.push(...detectChangeDerivedCases(input.state, input.changes, input.changeContext ?? null));
  }
  return sortCases(cases);
}
