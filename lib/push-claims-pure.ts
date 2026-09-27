/**
 * Delivery claims — the ONE idempotency + "sent only after delivery" model for pushes (and the report emails).
 * Pure: no "server-only" / Supabase / push imports, so plain tsx tests drive it with an in-memory store.
 * The real store (the `settings` key/value table) lives in lib/push-claims.ts.
 *
 * Owner rules this enforces (2026-09-27):
 *   - a marker says "sent" ONLY after a classified delivery success (classifyPushResult === "sent");
 *   - a failed delivery is recorded as "failed" (durable), never as "sent";
 *   - one claim per event: two processes / tabs / double clicks racing on the same key send at most once
 *     (INSERT-first; every later move is a compare-and-swap on the exact previous value);
 *   - a refresh is not a resend: a "sent" claim for the same event version is never re-sent;
 *   - a crashed "processing" claim becomes reclaimable after STUCK_PROCESSING_TIMEOUT_MS.
 */
import { STUCK_PROCESSING_TIMEOUT_MS, classifyPushResult } from "./shalev-weekly-pure";

export { STUCK_PROCESSING_TIMEOUT_MS, classifyPushResult };

export type DeliveryResult = "sent" | "no_subscription" | "send_failed";
export type ClaimStatus = "processing" | "sent" | "failed";

// ── Per-day claim keys (settings) ──
/** One external-push-cron notification type per Israel day: push_cron:<type>:<YYYY-MM-DD>. */
export const PUSH_CRON_CLAIM_PREFIX = "push_cron:";
export const pushCronClaimKey = (type: string, ymd: string) => `push_cron:${type}:${ymd}`;
/** One morning / evening report email per Israel day: report_email:<type>:<YYYY-MM-DD>. */
export const REPORT_EMAIL_CLAIM_PREFIX = "report_email:";
export const reportEmailClaimKey = (type: "morning" | "evening", ymd: string) => `report_email:${type}:${ymd}`;

/** The Israel calendar day (DST-safe via Intl — never a fixed UTC offset). */
export function ilYmd(nowMs: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(nowMs));
}
/** The Israel wall-clock hour 0–23 (DST-safe). */
export function ilHour(nowMs: number): number {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jerusalem", hour: "2-digit", hour12: false }).format(new Date(nowMs))) % 24;
}

/** The stored claim. `version` identifies the event (a payment date, a pre-transition row stamp, a day …). Extra
 *  fields (e.g. the legacy `paymentDate` / `fromUpdatedAt`) are kept alongside for readers written before this model. */
export interface DeliveryClaim {
  status: ClaimStatus;
  version: string;
  claimedAt: string;
  sentAt?: string;
  failedAt?: string;
  result?: DeliveryResult;
  [extra: string]: unknown;
}

/** Minimal key/value store with the two atomic primitives every claim needs. */
export interface ClaimStore {
  /** The stored value, or null when the key does not exist. Throws on a read error (never "none"). */
  read(key: string): Promise<unknown | null>;
  /** INSERT-first claim: "conflict" = the key already exists (another caller won). */
  insert(key: string, value: unknown): Promise<"ok" | "conflict" | "error">;
  /** Compare-and-swap: replace ONLY if the stored value still equals `expected`. */
  cas(key: string, expected: unknown, next: unknown): Promise<boolean>;
  /** Plain write (presence facts only — never a claim). */
  upsert(key: string, value: unknown): Promise<void>;
}

/** A claim store that can also scan and clear pending batches (the upload / final-files flushes only). */
export interface BatchClaimStore extends ClaimStore {
  /** Delete; with `expected`, only when the stored value still equals it. True when a row was removed. */
  remove(key: string, expected?: unknown): Promise<boolean>;
  /** Every (key, value) whose key starts with `prefix`. */
  list(prefix: string): Promise<Array<{ key: string; value: unknown }>>;
}

export type ClaimDecision = "insert" | "cas_update" | "already_sent" | "in_progress";

/**
 * What to do with an existing claim row for this event version.
 *   - no row                          → insert
 *   - "processing" and still fresh    → in_progress (a concurrent sender holds it)
 *   - a different version             → cas_update (a genuinely new event)
 *   - "sent" (same version)           → already_sent (refresh / duplicate never resends)
 *   - legacy row without a status     → already_sent when its legacy version matches (it was written by the old code)
 *   - "failed" or a stuck "processing"→ cas_update (a retry is allowed)
 */
export function decideDeliveryClaim(
  existing: unknown,
  version: string,
  nowMs: number,
  legacyVersionOf?: (legacy: Record<string, unknown>) => string | null,
): ClaimDecision {
  if (existing === null || existing === undefined) return "insert";
  const e = existing as Partial<DeliveryClaim> & Record<string, unknown>;
  if (!e.status) {
    const lv = legacyVersionOf ? legacyVersionOf(e) : null;
    return lv !== null && lv === version ? "already_sent" : "cas_update";
  }
  if (e.status === "processing") {
    const age = nowMs - new Date(String(e.claimedAt ?? 0)).getTime();
    if (Number.isFinite(age) && age <= STUCK_PROCESSING_TIMEOUT_MS) return "in_progress";
    return "cas_update";
  }
  if (e.version !== version) return "cas_update";
  if (e.status === "sent") return "already_sent";
  return "cas_update"; // failed → retry allowed
}

/** How Sunny / a reader should state a marker. A legacy row (written before 2026-09-27 regardless of delivery) is
 *  "RECORDED_UNVERIFIED", never "SENT". */
export type MarkerState = "SENT" | "FAILED" | "IN_PROGRESS" | "RECORDED_UNVERIFIED" | "NONE";
export function markerStateOf(value: unknown): MarkerState {
  if (value === null || value === undefined) return "NONE";
  const s = (value as { status?: unknown }).status;
  if (s === "sent") return "SENT";
  if (s === "failed") return "FAILED";
  if (s === "processing") return "IN_PROGRESS";
  return "RECORDED_UNVERIFIED";
}

export type ClaimResult = { claimed: true; value: DeliveryClaim } | { claimed: false; reason: "already_sent" | "in_progress" | "claim_error" };

/** Claim the event atomically. Fails closed: any unexpected store error is "claim_error" (never a send). */
export async function claimDelivery(
  store: ClaimStore, key: string, version: string, nowMs: number,
  opts: { extra?: Record<string, unknown>; legacyVersionOf?: (legacy: Record<string, unknown>) => string | null } = {},
): Promise<ClaimResult> {
  const value: DeliveryClaim = { ...(opts.extra ?? {}), status: "processing", version, claimedAt: new Date(nowMs).toISOString() };
  let existing: unknown;
  try { existing = await store.read(key); } catch { return { claimed: false, reason: "claim_error" }; }
  const d = decideDeliveryClaim(existing, version, nowMs, opts.legacyVersionOf);
  if (d === "already_sent" || d === "in_progress") return { claimed: false, reason: d };
  try {
    if (d === "insert") {
      const r = await store.insert(key, value);
      if (r === "ok") return { claimed: true, value };
      if (r === "error") return { claimed: false, reason: "claim_error" };
      // lost the insert race — decide again against what the winner wrote
      const now = await store.read(key);
      const again = decideDeliveryClaim(now, version, nowMs, opts.legacyVersionOf);
      return { claimed: false, reason: again === "already_sent" ? "already_sent" : "in_progress" };
    }
    return (await store.cas(key, existing, value)) ? { claimed: true, value } : { claimed: false, reason: "in_progress" };
  } catch {
    return { claimed: false, reason: "claim_error" };
  }
}

/** Close a claim with the CLASSIFIED result: "sent" only on delivery success; anything else is a durable "failed". */
export async function finishDelivery(store: ClaimStore, key: string, claimed: DeliveryClaim, result: DeliveryResult, nowMs: number): Promise<DeliveryClaim> {
  const at = new Date(nowMs).toISOString();
  const next: DeliveryClaim = result === "sent"
    ? { ...claimed, status: "sent", result, sentAt: at }
    : { ...claimed, status: "failed", result, failedAt: at };
  try {
    if (!(await store.cas(key, claimed, next))) console.error(`[push-claims] could not close claim ${key} (value moved)`);
  } catch (e) {
    console.error(`[push-claims] close claim ${key} failed:`, e instanceof Error ? e.message : e);
  }
  return next;
}

export type DeliverOnceOutcome = DeliveryResult | "already_sent" | "in_progress" | "claim_error";

/**
 * Claim → send → classify → mark. `send` returns the CLASSIFIED result (a throw counts as send_failed). The marker
 * says "sent" only when that result is "sent".
 */
export async function deliverOnce(
  store: ClaimStore, key: string, version: string, nowMs: number,
  send: () => Promise<DeliveryResult>,
  opts: { extra?: Record<string, unknown>; legacyVersionOf?: (legacy: Record<string, unknown>) => string | null } = {},
): Promise<{ outcome: DeliverOnceOutcome; claim: DeliveryClaim | null }> {
  const c = await claimDelivery(store, key, version, nowMs, opts);
  if (!c.claimed) return { outcome: c.reason, claim: null };
  let result: DeliveryResult;
  try { result = await send(); } catch (e) {
    console.error(`[push-claims] send for ${key} threw:`, e instanceof Error ? e.message : e);
    result = "send_failed";
  }
  const closed = await finishDelivery(store, key, c.value, result, Date.now());
  return { outcome: result, claim: closed };
}

/** Push results → the classified result (a thrown send is the caller's send_failed). */
export function classify(results: ReadonlyArray<{ status: string }> | null | undefined): DeliveryResult {
  return classifyPushResult([...(results ?? [])]);
}

// ── Pending-batch flush (Steven / Victor upload notices): claim THEN send ─────────────────────────────────────────

/** A coalescing batch row. `status` is absent while the batch is open (the queue writer never sets it). */
export interface FlushableBatch { dueAt?: string; status?: "processing" | "failed"; claimedAt?: string; result?: DeliveryResult; failedAt?: string; [k: string]: unknown }

/** Pure: is this batch due to be claimed by the flusher now? Open + window elapsed, or a stuck processing claim. */
export function batchFlushDecision(v: FlushableBatch, nowMs: number): "claim" | "wait" | "skip" {
  if (v.status === "failed") return "skip"; // durable failure record — never auto-resent (the next real upload opens a fresh batch)
  if (v.status === "processing") {
    const age = nowMs - new Date(String(v.claimedAt ?? 0)).getTime();
    return Number.isFinite(age) && age > STUCK_PROCESSING_TIMEOUT_MS ? "claim" : "skip";
  }
  if (!v.dueAt) return "wait";
  return new Date(v.dueAt).getTime() <= nowMs ? "claim" : "wait";
}

/** Pure: the previous batch a NEW upload may join. A batch already being sent (processing) or a failed record is
 *  never joined — the new upload starts a fresh batch, so already-announced files are never counted twice. */
export function joinableBatch<T extends FlushableBatch>(prev: T | null): T | null {
  if (!prev) return null;
  return prev.status === "processing" || prev.status === "failed" ? null : prev;
}

/**
 * Flush every due batch under `prefix`: CAS-claim (open → processing) so two processes can never both send, send,
 * then on success delete the row ONLY if it is still exactly our processing value (a new upload that re-opened the
 * batch meanwhile survives), on failure keep a durable "failed" row.
 */
export async function flushDueBatches(
  store: BatchClaimStore, prefix: string, nowMs: number,
  send: (batch: FlushableBatch) => Promise<DeliveryResult>,
): Promise<Array<{ key: string; outcome: DeliveryResult | "lost_claim" }>> {
  const out: Array<{ key: string; outcome: DeliveryResult | "lost_claim" }> = [];
  let rows: Array<{ key: string; value: unknown }>;
  try { rows = await store.list(prefix); } catch (e) { console.error(`[push-claims] flush list ${prefix} failed:`, e); return out; }
  for (const row of rows) {
    const v = (row.value ?? {}) as FlushableBatch;
    if (batchFlushDecision(v, nowMs) !== "claim") continue;
    const processing: FlushableBatch = { ...v, status: "processing", claimedAt: new Date(nowMs).toISOString() };
    let won = false;
    try { won = await store.cas(row.key, row.value, processing); } catch { won = false; }
    if (!won) { out.push({ key: row.key, outcome: "lost_claim" }); continue; }
    let result: DeliveryResult;
    try { result = await send(v); } catch (e) { console.error(`[push-claims] flush send ${row.key} threw:`, e); result = "send_failed"; }
    try {
      if (result === "sent") await store.remove(row.key, processing);
      else await store.cas(row.key, processing, { ...processing, status: "failed", result, failedAt: new Date(Date.now()).toISOString() });
    } catch (e) { console.error(`[push-claims] flush close ${row.key} failed:`, e); }
    out.push({ key: row.key, outcome: result });
  }
  return out;
}

/** deliverOnce, returning only the classified result (for callers that need nothing else). */
export async function deliverOnceStatus(...args: Parameters<typeof deliverOnce>): Promise<DeliverOnceOutcome> {
  return (await deliverOnce(...args)).outcome;
}
