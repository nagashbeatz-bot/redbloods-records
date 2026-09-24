/**
 * Redbloods Partner MCP connector — in-memory sliding-window rate limit. Single Owner, single instance:
 * it stops accidental loops / floods, it is not a distributed quota. (A restart resets it; several instances
 * would each count separately — acceptable for V1, documented.)
 */
export class SlidingWindowLimiter {
  private hits = new Map<string, number[]>();
  constructor(private readonly limits: ReadonlyArray<{ windowMs: number; max: number }>) {}

  /** Records the hit and returns true when allowed; a denied hit is not recorded. */
  allow(key: string, nowMs: number): boolean {
    const longest = Math.max(...this.limits.map((l) => l.windowMs));
    const arr = (this.hits.get(key) ?? []).filter((t) => t > nowMs - longest);
    for (const l of this.limits) if (arr.filter((t) => t > nowMs - l.windowMs).length >= l.max) { this.hits.set(key, arr); return false; }
    arr.push(nowMs);
    this.hits.set(key, arr);
    if (this.hits.size > 1000) for (const [k, v] of this.hits) if (!v.some((t) => t > nowMs - longest)) this.hits.delete(k);
    return true;
  }
}
