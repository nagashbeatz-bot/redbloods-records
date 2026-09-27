/**
 * Victor "stuck" — the ONE rule (pure; no server-only / Supabase imports).
 *
 * A Victor work is stuck when its status is "פעיל" (open) AND more than `stuckAfterDays` whole days passed since it
 * was sent (the Owner's Victor setting vendor_victor_settings.stuckAfterDays, default 5). This is exactly the rule the
 * portal / Victor page has always used (lib/vendor-store.ts mapRow → isStuck); the external push cron and Sunny now
 * reuse it instead of the cron's old copy, which filtered `status` by WORK-STATE values and therefore never matched.
 *
 * The ball (who holds the next move) is reported next to it from the app's own computeVictorBall — stuck is
 * "sent long ago and still open", never a verdict that Victor is late (the ball may be with the Owner).
 *
 * PUSH: the Victor-stuck push is DISABLED by the Owner (decision Q3, 2026-09-27). The signal is computed and returned
 * by the cron response and served to Sunny (victor_view signal VICTOR_STUCK); no push is ever sent for it.
 */
import { computeVictorBall } from "./coo/victor-ball";
import { COO_CONFIG } from "./coo/config";

export const DEFAULT_STUCK_AFTER_DAYS = 5;
export const VICTOR_STUCK_PUSH_ENABLED = false; // Owner decision Q3 (2026-09-27): compute, never push

/** The rule itself. */
export function isVictorWorkStuck(status: string | null | undefined, daysSinceSent: number | null | undefined, stuckAfterDays: number | null | undefined): boolean {
  const limit = typeof stuckAfterDays === "number" && Number.isFinite(stuckAfterDays) ? stuckAfterDays : DEFAULT_STUCK_AFTER_DAYS;
  return status === "פעיל" && typeof daysSinceSent === "number" && daysSinceSent > limit;
}

export interface VictorStuckInput {
  id: string; title: string | null; projectName?: string | null; projectId?: string | null;
  status: string; daysSinceSent: number | null;
  filesSent?: ReadonlyArray<{ uploadedAt?: string | null }>;
  versionReviews?: Record<string, { sentAt?: string | null; draft?: boolean }> | null;
}
export interface VictorStuckSignal { id: string; title: string; projectId: string | null; daysSinceSent: number; stuckAfterDays: number; ballHolder: string; ballBasis: string }

/** Every stuck work with its ball (for the cron response and Sunny). */
export function victorStuckSignals(works: readonly VictorStuckInput[], stuckAfterDays: number | null | undefined): VictorStuckSignal[] {
  const limit = typeof stuckAfterDays === "number" && Number.isFinite(stuckAfterDays) ? stuckAfterDays : DEFAULT_STUCK_AFTER_DAYS;
  return works.filter((w) => isVictorWorkStuck(w.status, w.daysSinceSent, limit)).map((w) => {
    const uploads = (w.filesSent ?? []).map((f) => f.uploadedAt).filter((u): u is string => !!u);
    const ball = computeVictorBall({
      uploads,
      filesWithoutTimestamp: (w.filesSent ?? []).filter((f) => !f.uploadedAt).length,
      reviews: Object.values(w.versionReviews ?? {}).map((r) => ({ sentAt: r.sentAt ?? null, draft: r.draft === true })),
    } as never, COO_CONFIG as never);
    return { id: w.id, title: w.title ?? w.projectName ?? "עבודה", projectId: w.projectId ?? null, daysSinceSent: w.daysSinceSent as number, stuckAfterDays: limit, ballHolder: ball.ball.holder, ballBasis: ball.ball.basis };
  });
}
