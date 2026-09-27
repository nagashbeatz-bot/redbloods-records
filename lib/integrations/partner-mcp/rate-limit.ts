/**
 * Redbloods Partner MCP connector — in-memory sliding-window rate limit. Single Owner, single instance:
 * it stops accidental loops / floods, it is not a distributed quota. (A restart resets it; several instances
 * would each count separately — acceptable for V1, documented.)
 *
 * Every hit leaves its window exactly windowMs after it was made (sliding, never a fixed reset). A denied request is
 * never recorded, so retrying while limited never extends the block. `check` reports the real wait (retryAfterMs) of
 * the window that blocks; `gate` checks EVERY limiter a request is counted by before recording it in ANY of them, so a
 * request refused by one limiter (e.g. the action limit) never spends quota in another (the general limit).
 */
export type LimitCheck = { ok: true } | { ok: false; retryAfterMs: number };

export class SlidingWindowLimiter {
  private hits = new Map<string, number[]>();
  constructor(private readonly limits: ReadonlyArray<{ windowMs: number; max: number }>) {}

  private live(key: string, nowMs: number): number[] {
    const longest = Math.max(...this.limits.map((l) => l.windowMs));
    return (this.hits.get(key) ?? []).filter((t) => t > nowMs - longest);
  }

  /** Read-only: would one more hit be allowed now? If not, how long until the blocking window(s) let one through. */
  check(key: string, nowMs: number): LimitCheck {
    const arr = this.live(key, nowMs);
    let wait = 0;
    for (const l of this.limits) {
      const inWindow = arr.filter((t) => t > nowMs - l.windowMs).sort((a, b) => a - b);
      if (inWindow.length < l.max) continue;
      // one hit is allowed again when enough of the oldest hits have left THIS window (count must drop to max - 1)
      const freeing = inWindow[inWindow.length - l.max];
      wait = Math.max(wait, freeing + l.windowMs - nowMs + 1);
    }
    return wait > 0 ? { ok: false, retryAfterMs: wait } : { ok: true };
  }

  /** Record one hit (call only after every limiter of the request allowed it). */
  record(key: string, nowMs: number): void {
    const longest = Math.max(...this.limits.map((l) => l.windowMs));
    const arr = this.live(key, nowMs);
    arr.push(nowMs);
    this.hits.set(key, arr);
    if (this.hits.size > 1000) for (const [k, v] of this.hits) if (!v.some((t) => t > nowMs - longest)) this.hits.delete(k);
  }

  /** Records the hit and returns true when allowed; a denied hit is not recorded. */
  allow(key: string, nowMs: number): boolean {
    if (!this.check(key, nowMs).ok) return false;
    this.record(key, nowMs);
    return true;
  }
}

export type LimiterName = "GENERAL" | "ACTION" | "ANSWER" | "KNOWLEDGE";
export type GateResult = { ok: true } | { ok: false; limiter: LimiterName; retryAfterSec: number };

/**
 * All-or-nothing: the request is counted in every limiter only when ALL of them allow it. When refused, `limiter` names
 * the one that blocks longest (the specific limiter wins a tie) and retryAfterSec is the real wait until every blocking
 * window lets the request through. Fail-safe: a limiter that throws refuses the request (never a silent pass).
 */
export function gate(key: string, nowMs: number, limiters: ReadonlyArray<{ name: LimiterName; limiter: SlidingWindowLimiter }>): GateResult {
  let worst: { name: LimiterName; ms: number } | null = null;
  for (const { name, limiter } of limiters) {
    let c: LimitCheck;
    try { c = limiter.check(key, nowMs); } catch { c = { ok: false, retryAfterMs: 60_000 }; }
    if (!c.ok && (!worst || c.retryAfterMs >= worst.ms)) worst = { name, ms: c.retryAfterMs };
  }
  if (worst) return { ok: false, limiter: worst.name, retryAfterSec: Math.max(1, Math.ceil(worst.ms / 1000)) };
  for (const { limiter } of limiters) limiter.record(key, nowMs);
  return { ok: true };
}
