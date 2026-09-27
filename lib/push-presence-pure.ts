/**
 * PORTAL PRESENCE — the ONE shared model behind "שליו / אבי / קלינטון / סטיבן / ויקטור נכנס" (Owner decision Q1,
 * 2026-09-27: keep the feature, but only for a REAL presence event). Pure: no "server-only" / Supabase / push
 * imports — tests drive it with an in-memory ClaimStore; the server wiring is lib/push-presence.ts.
 *
 * Two separate facts per portal user, in the existing `settings` table:
 *
 *   portal_last_seen:<portal>   LAST_SEEN — { at } — written by every ping / heartbeat of that user's own portal
 *                               (throttled: only when the stored value is older than PRESENCE_LAST_SEEN_THROTTLE_MS,
 *                               so a burst of tabs / re-renders never becomes a write storm). This is what Sunny shows
 *                               as "last seen in the portal".
 *   portal_visit_push:<portal>  VISIT CLAIM — { status processing | sent | failed, visitStartedAt, claimedAt, sentAt?,
 *                               failedAt?, result? } — the presence PUSH for one visit, claimed atomically.
 *
 * A NEW VISIT = no last-seen within PRESENCE_ABSENCE_WINDOW_MS (30 minutes). Why 30 minutes: it is the window
 * Redbloods already used for Victor's and Steven's visit pushes (lib/victor-presence-pure.ts VISIT_COOLDOWN_MS, the
 * Owner-accepted cadence in production), and the portals now heartbeat every PRESENCE_HEARTBEAT_MS (5 minutes) while
 * they are visible, so 30 minutes without any ping is a real absence, not a quiet tab. The artists' old model
 * (one push per browser-tab session + a 60-second race guard) pushed again for every new tab after a minute — that
 * was the flood the Owner asked to stop.
 *
 *   new entry                          → exactly one push (the visit claim is INSERT-first / compare-and-swap)
 *   refresh / in-portal navigation     → 0 (last-seen is fresh)
 *   re-render / heartbeat              → 0 (last-seen is fresh)
 *   several tabs at once               → 1 (they race for the same claim; one wins)
 *   later entry after a real absence   → a new push
 *   delivery failed                    → the claim is "failed" (never "sent"); it is NOT retried by a refresh inside
 *                                        the visit — only the next genuine entry (after another absence) claims again.
 */
import { VISIT_COOLDOWN_MS } from "./victor-presence-pure";
import type { ClaimStore, DeliveryResult } from "./push-claims-pure";

export const PRESENCE_PORTALS = ["shalev", "avi", "cleantone", "steven", "victor"] as const;
export type PresencePortal = (typeof PRESENCE_PORTALS)[number];

/** A new visit = no last-seen within this window (configurable here, documented above). */
export const PRESENCE_ABSENCE_WINDOW_MS = VISIT_COOLDOWN_MS;
/** Last-seen is rewritten at most this often (throttle against tab / re-render write storms). */
export const PRESENCE_LAST_SEEN_THROTTLE_MS = 60 * 1000;
/** The portal client pings this often while the page is visible (and when it becomes visible again). */
export const PRESENCE_HEARTBEAT_MS = 5 * 60 * 1000;

export const PRESENCE_LAST_SEEN_PREFIX = "portal_last_seen:";
export const PRESENCE_VISIT_PUSH_PREFIX = "portal_visit_push:";
export const presenceLastSeenKey = (p: PresencePortal) => `${PRESENCE_LAST_SEEN_PREFIX}${p}`;
export const presenceVisitPushKey = (p: PresencePortal) => `${PRESENCE_VISIT_PUSH_PREFIX}${p}`;
/** Every presence key Sunny may read (the settings reader's bounded `in` list). */
export const PRESENCE_KEYS: readonly string[] = PRESENCE_PORTALS.flatMap((p) => [presenceLastSeenKey(p), presenceVisitPushKey(p)]);

export interface LastSeenValue { at: string }
export interface VisitPushClaim {
  status: "processing" | "sent" | "failed";
  visitStartedAt: string;
  claimedAt: string;
  sentAt?: string;
  failedAt?: string;
  result?: DeliveryResult;
}

/** Pure: given the stored last-seen (before this ping), is this a new visit, and must last-seen be rewritten? */
export function decidePresence(prevLastSeenAt: string | null, nowMs: number): { newVisit: boolean; writeLastSeen: boolean } {
  const prev = prevLastSeenAt ? new Date(prevLastSeenAt).getTime() : NaN;
  if (!Number.isFinite(prev)) return { newVisit: true, writeLastSeen: true };
  const age = nowMs - prev;
  const newVisit = age >= PRESENCE_ABSENCE_WINDOW_MS;
  return { newVisit, writeLastSeen: newVisit || age >= PRESENCE_LAST_SEEN_THROTTLE_MS };
}

/** Pure: may this new visit claim the presence push? A claim inside the window (sent, failed or processing) belongs to
 *  the same visit or a racing tab → skip. Because a new visit needs ≥ one window of absence since the last ping, and
 *  the last claim happened at or before that ping, a genuine new visit is never blocked by an older claim. */
export function decideVisitPushClaim(existing: Partial<VisitPushClaim> | null, nowMs: number): "insert" | "cas_update" | "skip" {
  if (!existing) return "insert";
  const at = existing.claimedAt ? new Date(existing.claimedAt).getTime() : NaN;
  if (!Number.isFinite(at)) return "cas_update";
  return nowMs - at >= PRESENCE_ABSENCE_WINDOW_MS ? "cas_update" : "skip";
}

export type PresencePushOutcome = "NOT_A_NEW_VISIT" | "PUSH_DISABLED" | "ALREADY_CLAIMED" | "CLAIM_ERROR" | DeliveryResult;
export interface PresencePingResult { portal: PresencePortal; newVisit: boolean; lastSeenWritten: boolean; push: PresencePushOutcome }

/**
 * One ping from the portal user's own session (the caller already verified the role; the Owner previewing a portal
 * never reaches this). Records last-seen, and — only for a claimed NEW visit — sends exactly one presence push and
 * marks the claim "sent" only on a classified delivery success.
 */
export async function runPresencePing(
  store: ClaimStore, portal: PresencePortal, nowMs: number,
  opts: { pushAllowed: boolean; send: (ctx: { visitStartedAt: string }) => Promise<DeliveryResult> },
): Promise<PresencePingResult> {
  const nowIso = new Date(nowMs).toISOString();
  const lsKey = presenceLastSeenKey(portal);
  let prevAt: string | null = null;
  try { prevAt = ((await store.read(lsKey)) as Partial<LastSeenValue> | null)?.at ?? null; }
  catch (e) { console.error(`[presence] ${portal} last-seen read failed:`, e); return { portal, newVisit: false, lastSeenWritten: false, push: "CLAIM_ERROR" }; }

  const d = decidePresence(prevAt, nowMs);
  let lastSeenWritten = false;
  if (d.writeLastSeen) {
    try { await store.upsert(lsKey, { at: nowIso } satisfies LastSeenValue); lastSeenWritten = true; }
    catch (e) { console.error(`[presence] ${portal} last-seen write failed:`, e); }
  }
  if (!d.newVisit) return { portal, newVisit: false, lastSeenWritten, push: "NOT_A_NEW_VISIT" };
  if (!opts.pushAllowed) return { portal, newVisit: true, lastSeenWritten, push: "PUSH_DISABLED" };

  const claimKey = presenceVisitPushKey(portal);
  const processing: VisitPushClaim = { status: "processing", visitStartedAt: nowIso, claimedAt: nowIso };
  try {
    const existing = (await store.read(claimKey)) as Partial<VisitPushClaim> | null;
    const c = decideVisitPushClaim(existing, nowMs);
    if (c === "skip") return { portal, newVisit: true, lastSeenWritten, push: "ALREADY_CLAIMED" };
    if (c === "insert") {
      const r = await store.insert(claimKey, processing);
      if (r === "conflict") return { portal, newVisit: true, lastSeenWritten, push: "ALREADY_CLAIMED" };
      if (r === "error") return { portal, newVisit: true, lastSeenWritten, push: "CLAIM_ERROR" };
    } else if (!(await store.cas(claimKey, existing, processing))) {
      return { portal, newVisit: true, lastSeenWritten, push: "ALREADY_CLAIMED" };
    }
  } catch (e) {
    console.error(`[presence] ${portal} claim failed:`, e);
    return { portal, newVisit: true, lastSeenWritten, push: "CLAIM_ERROR" };
  }

  let result: DeliveryResult;
  try { result = await opts.send({ visitStartedAt: nowIso }); }
  catch (e) { console.error(`[presence] ${portal} push threw:`, e); result = "send_failed"; }
  const doneAt = new Date().toISOString();
  const closed: VisitPushClaim = result === "sent" ? { ...processing, status: "sent", result, sentAt: doneAt } : { ...processing, status: "failed", result, failedAt: doneAt };
  try { if (!(await store.cas(claimKey, processing, closed))) console.error(`[presence] ${portal} claim moved before it was closed`); }
  catch (e) { console.error(`[presence] ${portal} claim close failed:`, e); }
  return { portal, newVisit: true, lastSeenWritten, push: result };
}

/** Pure reader helper for Sunny: the presence facts of one portal from settings rows (never a push). */
export function presenceFactsOf(rows: ReadonlyArray<{ key: string; value: unknown }> | null | undefined, portal: PresencePortal) {
  const ls = rows?.find((r) => r.key === presenceLastSeenKey(portal))?.value as Partial<LastSeenValue> | undefined;
  const claim = rows?.find((r) => r.key === presenceVisitPushKey(portal))?.value as Partial<VisitPushClaim> | undefined;
  return {
    lastSeenAt: ls?.at ?? null,
    visitPush: claim ? { status: claim.status ?? null, visitStartedAt: claim.visitStartedAt ?? null, sentAt: claim.sentAt ?? null, failedAt: claim.failedAt ?? null, result: claim.result ?? null } : null,
  };
}
