/**
 * Redbloods Partner — Baseline lifecycle (Phase D.2/D.3). The orchestration
 * between the pure Change Engine (lib/partner/changes) and persistence
 * (lib/partner/baseline/store.ts).
 *
 * Deliberately takes its I/O as an injected `BaselineIO` rather than calling
 * lib/partner/baseline/store.ts directly — this whole file stays testable
 * with an in-memory fake (scripts/test-partner-baseline.ts), and the real
 * runtime wiring (lib/partner/baseline/build.ts) is the only place that ever
 * passes the real Supabase-backed store. No "server-only" import here.
 *
 * Lifecycle (Owner instructions §47, §56, §63; hardened after a pre-launch
 * review caught an under-strict version of step 4 — see assessCurrentBuild()'s
 * own doc comment for the exact scenario):
 *   1. load the previous good baseline (a load failure -> abort, baseline left untouched)
 *   2. build/receive the current snapshot
 *   3. compare (all of D.1's safety gates apply, unchanged)
 *   4. if EVERY domain read cleanly (AVAILABLE or legitimately UNAVAILABLE —
 *      never PARTIAL/UNKNOWN, i.e. a real read failure, in even ONE domain):
 *      persist the current snapshot as the new good baseline
 *   5. if even ONE domain failed to read cleanly: do NOT touch the existing
 *      baseline AT ALL — not just for that domain, for the WHOLE snapshot,
 *      so no domain's last-known-good state is ever silently discarded while
 *      another domain happens to be having a bad day (Owner instruction §46)
 */
import { buildPartnerChangeSnapshot } from "../changes/snapshot";
import { comparePartnerChangeSnapshots } from "../changes/compare";
import type { ChangeDiagnostic, PartnerChange, PartnerChangeSnapshot, SnapshotDomainState } from "../changes/types";
import type { PartnerCompanyState } from "../eyes/types";
import type { StoredPartnerBaseline } from "./types";

export interface BaselineIO {
  load: () => Promise<StoredPartnerBaseline | null>;
  save: (b: StoredPartnerBaseline) => Promise<void>;
}

export interface ChangeAwarenessRunResult {
  runAt: string;
  /** Whether a previous baseline was actually found (false on the very first observation, or when the load itself failed). */
  baselineLoaded: boolean;
  previousCapturedAt: string | null;
  currentCapturedAt: string;
  /** Whether a new baseline was actually persisted this run — false whenever the current build was unusable OR the save itself failed. */
  baselineAdvanced: boolean;
  changes: PartnerChange[];
  diagnostics: ChangeDiagnostic[];
  comparable: boolean;
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 200);

/**
 * Whether the CURRENT build is trustworthy enough to become the new
 * last-known-good baseline — this is a stricter, DIFFERENT question than
 * whether any one domain's diff is safe to report (that's diffEntityDomain's
 * job, unchanged). A domain can be intentionally PARTIAL in *scope* (e.g.
 * projects: is_hidden=false only) and still be perfectly healthy — that must
 * never block advancement. What blocks advancement is a domain whose READ
 * itself failed or partially failed (DataStatus "UNKNOWN" or "PARTIAL" — see
 * lib/partner/eyes/types.ts's DataStatus doc). "UNAVAILABLE" (e.g. suppliers,
 * which has no table at all) is a permanent, correct fact, not a failure,
 * and also never blocks.
 *
 * Why this matters (found in review before the first production write): if
 * baseline advancement only required "at least one domain available," a
 * single domain failing (e.g. transactions timing out) while 13 others were
 * fine would still save a new baseline — silently discarding the
 * last-known-good transactions state. The NEXT time transactions recovered,
 * it would be diffed against ITS OWN just-failed (empty) snapshot instead of
 * the real last-known-good one, and real changes that happened during the
 * outage window would be lost. The fix: advancement requires EVERY domain to
 * be individually healthy (AVAILABLE or UNAVAILABLE) — a single failed
 * domain blocks the WHOLE baseline from advancing, so the last-known-good
 * state for every domain is preserved together, atomically, until a run
 * where everything reads cleanly.
 */
function assessCurrentBuild(snapshot: PartnerChangeSnapshot): { usable: boolean; failedDomains: string[] } {
  const keys = Object.keys(snapshot).filter((k) => k !== "schemaVersion" && k !== "capturedAt") as Array<keyof PartnerChangeSnapshot>;
  const failedDomains = keys
    .filter((k) => {
      const status = (snapshot[k] as SnapshotDomainState<unknown>).status;
      return status !== "AVAILABLE" && status !== "UNAVAILABLE"; // UNKNOWN or PARTIAL = a real read failure
    })
    .map((k) => String(k));
  return { usable: failedDomains.length === 0, failedDomains };
}

export async function runPartnerChangeAwareness(state: PartnerCompanyState, io: BaselineIO): Promise<ChangeAwarenessRunResult> {
  const runAt = new Date().toISOString();
  const currentSnapshot = buildPartnerChangeSnapshot(state);
  const diagnostics: ChangeDiagnostic[] = [];

  let previousBaseline: StoredPartnerBaseline | null = null;
  try {
    previousBaseline = await io.load();
  } catch (e) {
    return {
      runAt, baselineLoaded: false, previousCapturedAt: null, currentCapturedAt: currentSnapshot.capturedAt, baselineAdvanced: false,
      changes: [], comparable: false,
      diagnostics: [{ code: "BASELINE_LOAD_FAILED", domain: null, message: `Baseline load failed (${msg(e)}) — treated as no reliable baseline this run. The existing good baseline, if any, is left completely UNTOUCHED (never overwritten on a load failure).` }],
    };
  }

  if (!previousBaseline) {
    diagnostics.push({ code: "FIRST_OBSERVATION", domain: null, message: "No baseline has ever been saved — this is the first observation. 0 business changes are ever reported on a first observation." });
  }

  const comparison = comparePartnerChangeSnapshots(previousBaseline?.snapshot ?? null, currentSnapshot);

  let baselineAdvanced = false;
  const assessment = assessCurrentBuild(currentSnapshot);
  if (assessment.usable) {
    try {
      await io.save({ schemaVersion: currentSnapshot.schemaVersion, snapshot: currentSnapshot, savedAt: runAt });
      baselineAdvanced = true;
    } catch (e) {
      diagnostics.push({ code: "BASELINE_SAVE_FAILED", domain: null, message: `Baseline save failed (${msg(e)}) — this run's comparison result is still returned below, but the baseline was NOT advanced; the next run will compare against whichever baseline is currently stored.` });
    }
  } else {
    diagnostics.push({
      code: "CURRENT_BUILD_INVALID", domain: null,
      message: `${assessment.failedDomains.length} domain(s) failed to read cleanly this run (${assessment.failedDomains.join(", ")}) — even though other domains are healthy, the WHOLE baseline is held back so the last-known-good state for the FAILED domain(s) is never lost. The existing good baseline is left completely UNTOUCHED. This run's comparison (below) still ran against the last-known-good baseline for every domain.`,
    });
  }

  return {
    runAt,
    baselineLoaded: !!previousBaseline,
    previousCapturedAt: comparison.previousCapturedAt,
    currentCapturedAt: comparison.currentCapturedAt,
    baselineAdvanced,
    changes: comparison.changes,
    diagnostics: [...diagnostics, ...comparison.diagnostics],
    comparable: comparison.comparable,
  };
}
