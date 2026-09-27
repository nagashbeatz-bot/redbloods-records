/**
 * Tests — PUSH / PRESENCE / MARKERS integrity (A4, 2026-09-27). Fakes only: an in-memory settings store and counting
 * fake senders. NEVER sends a real push, never touches production.
 *
 *   A. presence: one push per REAL visit (refresh / navigation / re-render / heartbeat → 0; tabs in parallel → 1;
 *      a later entry after a real absence → 1); last-seen ≠ the push claim; a failed delivery is "failed", never "sent"
 *   B. delivery claims: markers only after a delivered push (mix ready / payment / Victor completed), idempotent, atomic
 *   C. final files: claimed before the push, removed only after delivery, a failure is a durable failed row
 *   D. upload flushes: a CAS claim before the send — two processes never both send; a new upload is never lost
 *   E. report emails: one durable claim per type per Israel day
 *   F. external push cron: production guard, per-day dedupe, hidden / cancelled never overdue, totals per currency
 *   G. Victor stuck: the app's one rule, computed and served to Sunny, NEVER pushed (Owner decision Q3)
 *   H. registry / settings / readers wiring
 *
 * Run with:   npx tsx scripts/test-push-presence-integrity.tsx
 */
import fs from "node:fs";
import path from "node:path";
import { memoryClaimStore } from "./fixtures/claim-store";
import {
  runPresencePing, presenceFactsOf, presenceLastSeenKey, presenceVisitPushKey, decidePresence,
  PRESENCE_ABSENCE_WINDOW_MS, PRESENCE_HEARTBEAT_MS, PRESENCE_LAST_SEEN_THROTTLE_MS, PRESENCE_KEYS, type PresencePortal,
} from "../lib/push-presence-pure";
import { VISIT_COOLDOWN_MS } from "../lib/victor-presence-pure";
import {
  deliverOnce, markerStateOf, decideDeliveryClaim, flushDueBatches, joinableBatch, batchFlushDecision, classify,
  pushCronClaimKey, reportEmailClaimKey, ilYmd, ilHour, STUCK_PROCESSING_TIMEOUT_MS, type DeliveryResult,
} from "../lib/push-claims-pure";
import { claimAndSendBatch, isBatchClaimStuck, type BatchValue } from "../lib/final-files-batch-pure";
import { buildOwnerDigest, isDeadlineCandidate, sumByCurrency } from "../lib/push-digest-pure";
import { isVictorWorkStuck, victorStuckSignals, VICTOR_STUCK_PUSH_ENABLED, DEFAULT_STUCK_AFTER_DAYS } from "../lib/victor-stuck";
import { BACKGROUND_WRITERS } from "../lib/partner/act/background";
import { familyOfKey, SETTINGS_FAMILIES } from "../lib/partner/system/settings";
import { PUSH_CONTRACTS } from "../lib/partner/system/people";
import { ATTENTION_MAP } from "../lib/partner/system/company";

const ROOT = path.resolve(__dirname, "..");
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8");
const code = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");
let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: unknown) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 500)}` : ""}`); } };
const section = (t: string) => console.log(`\n${t}`);

const T0 = Date.parse("2026-09-27T09:00:00Z");
const MIN = 60 * 1000;
/** A counting fake sender returning a fixed classified result (or throwing). */
function fakeSender(result: DeliveryResult | "throw" = "sent") {
  const calls: string[] = [];
  const send = async (ctx?: { visitStartedAt?: string }) => { calls.push(ctx?.visitStartedAt ?? "x"); await new Promise((r) => setTimeout(r, 0)); if (result === "throw") throw new Error("webpush down"); return result; };
  return { calls, send };
}
const ping = (store: ReturnType<typeof memoryClaimStore>, portal: PresencePortal, at: number, send: (c: { visitStartedAt: string }) => Promise<DeliveryResult>, pushAllowed = true) =>
  runPresencePing(store, portal, at, { pushAllowed, send });

async function main() {
  // ── A. presence ────────────────────────────────────────────────────────────────────────────────────────────────
  section("A. Presence — one push per REAL visit");
  ok("the absence window reuses the existing 30-minute Victor / Steven visit window", PRESENCE_ABSENCE_WINDOW_MS === VISIT_COOLDOWN_MS && PRESENCE_ABSENCE_WINDOW_MS === 30 * MIN);
  ok("heartbeat (5 min) and write throttle (60 s) are well inside the window", PRESENCE_HEARTBEAT_MS * 3 < PRESENCE_ABSENCE_WINDOW_MS && PRESENCE_LAST_SEEN_THROTTLE_MS < PRESENCE_HEARTBEAT_MS);
  {
    const store = memoryClaimStore(); const s = fakeSender("sent");
    const r1 = await ping(store, "shalev", T0, s.send);
    ok("new entry → exactly one push, claim sent, last-seen written", s.calls.length === 1 && r1.push === "sent" && r1.newVisit && (store.data.get(presenceVisitPushKey("shalev")) as { status: string }).status === "sent" && (store.data.get(presenceLastSeenKey("shalev")) as { at: string }).at === new Date(T0).toISOString());
    const writesBefore = store.writes.length;
    const r2 = await ping(store, "shalev", T0 + 10 * 1000, s.send);
    ok("refresh after 10 s → 0 pushes and NO write (throttled)", s.calls.length === 1 && r2.push === "NOT_A_NEW_VISIT" && store.writes.length === writesBefore);
    const r3 = await ping(store, "shalev", T0 + 2 * MIN, s.send);
    ok("in-portal navigation / re-render after 2 min → 0 pushes, last-seen refreshed", s.calls.length === 1 && r3.lastSeenWritten && !r3.newVisit);
    for (let t = T0 + 5 * MIN; t <= T0 + 120 * MIN; t += PRESENCE_HEARTBEAT_MS) await ping(store, "shalev", t, s.send);
    ok("two hours of 5-minute heartbeats in an open portal → still exactly one push", s.calls.length === 1);
    const lastBeat = T0 + 120 * MIN;
    const r4 = await ping(store, "shalev", lastBeat + PRESENCE_ABSENCE_WINDOW_MS - MIN, s.send);
    ok("return after 29 minutes away → 0 pushes (not a real absence)", s.calls.length === 1 && !r4.newVisit);
    const back = lastBeat + PRESENCE_ABSENCE_WINDOW_MS - MIN + PRESENCE_ABSENCE_WINDOW_MS + MIN;
    const r5 = await ping(store, "shalev", back, s.send);
    ok("later entry after a real absence (31 min without any ping) → one new push", s.calls.length === 2 && r5.push === "sent" && r5.newVisit);
    const facts = presenceFactsOf([...store.data.entries()].map(([key, value]) => ({ key, value })), "shalev");
    ok("last-seen ≠ push claim: Sunny's lastSeenAt is the last ping, the claim is the visit start", facts.lastSeenAt === new Date(back).toISOString() && facts.visitPush?.visitStartedAt === new Date(back).toISOString() && facts.visitPush?.status === "sent");
    await ping(store, "shalev", back + 3 * MIN, s.send);
    const facts2 = presenceFactsOf([...store.data.entries()].map(([key, value]) => ({ key, value })), "shalev");
    ok("…and after a heartbeat the two differ (last-seen moves, the claim does not)", facts2.lastSeenAt === new Date(back + 3 * MIN).toISOString() && facts2.visitPush?.visitStartedAt === new Date(back).toISOString());
  }
  {
    const store = memoryClaimStore(); const s = fakeSender("sent");
    await Promise.all([ping(store, "victor", T0, s.send), ping(store, "victor", T0 + 5, s.send)]);
    ok("two tabs opened together → one push", s.calls.length === 1);
    const s2 = fakeSender("sent");
    const later = T0 + 2 * PRESENCE_ABSENCE_WINDOW_MS;
    const res = await Promise.all(Array.from({ length: 6 }, (_, i) => ping(store, "victor", later + i, s2.send)));
    ok("six tabs racing a new visit (old claim → CAS) → one push, the rest ALREADY_CLAIMED / not new", s2.calls.length === 1 && res.filter((r) => r.push === "sent").length === 1);
  }
  {
    const store = memoryClaimStore(); const s = fakeSender("no_subscription");
    const r = await ping(store, "steven", T0, s.send);
    const claim = store.data.get(presenceVisitPushKey("steven")) as { status: string; result: string; sentAt?: string };
    ok("failed delivery (no subscription) → claim 'failed', never 'sent'", r.push === "no_subscription" && claim.status === "failed" && claim.result === "no_subscription" && !claim.sentAt);
    const r2 = await ping(store, "steven", T0 + 5 * MIN, s.send);
    ok("a refresh inside the visit does NOT retry the failed push", s.calls.length === 1 && r2.push === "NOT_A_NEW_VISIT");
    const ok2 = fakeSender("sent");
    const r3 = await ping(store, "steven", T0 + 5 * MIN + PRESENCE_ABSENCE_WINDOW_MS + MIN, ok2.send);
    ok("the next genuine entry (after an absence) claims again and sends", ok2.calls.length === 1 && r3.push === "sent");
    const thrower = fakeSender("throw"); const st = memoryClaimStore();
    const r4 = await ping(st, "avi", T0, thrower.send);
    ok("a thrown send → 'failed' (send_failed)", r4.push === "send_failed" && (st.data.get(presenceVisitPushKey("avi")) as { status: string }).status === "failed");
  }
  {
    const store = memoryClaimStore(); const s = fakeSender("sent");
    const r = await ping(store, "cleantone", T0, s.send, false);
    ok("outside production: last-seen recorded, no claim, no push", s.calls.length === 0 && r.push === "PUSH_DISABLED" && store.data.has(presenceLastSeenKey("cleantone")) && !store.data.has(presenceVisitPushKey("cleantone")));
    await ping(store, "shalev", T0 + 1000, s.send);
    ok("portals are isolated (Shalev's visit does not suppress / trigger another portal)", s.calls.length === 1 && !store.data.has(presenceVisitPushKey("avi")));
    ok("decidePresence: missing / garbage last-seen = new visit", decidePresence(null, T0).newVisit && decidePresence("not-a-date", T0).newVisit);
  }
  {
    const src = code(read("components/team/usePortalPresence.ts"));
    ok("client: ping on open + heartbeat + visible again; the server decides (no push logic on the client)", /setInterval\(ping, PRESENCE_HEARTBEAT_MS\)/.test(src) && /visibilitychange/.test(src) && !/sendPush/.test(src));
    for (const f of ["components/red-artists/ArtistPortalPage.tsx", "components/team/StevenProfilePage.tsx", "components/team/VictorProfilePage.tsx"]) ok(`${f} uses the shared presence hook (no own beacon)`, /usePortalPresence\(/.test(read(f)) && !/rb_(shalev|avi|cleantone)_entry_pinged/.test(read(f)));
    for (const f of ["lib/shalev-presence-notify.ts", "lib/avi-presence-notify.ts", "lib/cleantone-presence-notify.ts", "lib/victor-presence-notify.ts", "lib/steven-notify.ts"]) ok(`${f} decides through the ONE presence model (recordPortalPresence) and classifies delivery`, /recordPortalPresence\(/.test(code(read(f))) && /classify\(await sendPushToAll/.test(code(read(f))) && !/_entry_last|_visit_last|steven_login_seen/.test(code(read(f))));
  }

  // ── B. delivery claims ─────────────────────────────────────────────────────────────────────────────────────────
  section("B. Markers only after a delivered push (mix ready / payment / Victor completed)");
  {
    const store = memoryClaimStore(); let n = 0;
    const r1 = await deliverOnce(store, "steven_mix_ready_pushed_w1", "job", T0, async () => { n++; return "sent"; });
    const r2 = await deliverOnce(store, "steven_mix_ready_pushed_w1", "job", T0 + MIN, async () => { n++; return "sent"; });
    ok("success → marker 'sent'; the same event again → already_sent, no second push", r1.outcome === "sent" && r2.outcome === "already_sent" && n === 1 && markerStateOf(store.data.get("steven_mix_ready_pushed_w1")) === "SENT");
    const f = memoryClaimStore(); let m = 0;
    const r3 = await deliverOnce(f, "steven_payment_pushed_w2", "2026-09-27", T0, async () => { m++; return "send_failed"; });
    ok("failed delivery → marker 'failed' (durable), never 'sent'", r3.outcome === "send_failed" && markerStateOf(f.data.get("steven_payment_pushed_w2")) === "FAILED" && (f.data.get("steven_payment_pushed_w2") as { paymentDate?: string }).paymentDate === undefined);
    const r4 = await deliverOnce(f, "steven_payment_pushed_w2", "2026-09-27", T0 + MIN, async () => { m++; return "sent"; }, { extra: { paymentDate: "2026-09-27" } });
    ok("a failed event may be retried; success then marks sent (with the legacy field kept for readers)", r4.outcome === "sent" && m === 2 && (f.data.get("steven_payment_pushed_w2") as { paymentDate?: string }).paymentDate === "2026-09-27");
    const c = memoryClaimStore(); let k = 0;
    const both = await Promise.all([1, 2, 3].map(() => deliverOnce(c, "victor_work_completed_pushed_w3", "2026-09-27T08:00:00Z", T0, async () => { k++; await new Promise((r) => setTimeout(r, 5)); return "sent"; })));
    ok("three concurrent completions of the same transition → one push", k === 1 && both.filter((b) => b.outcome === "sent").length === 1);
    const legacy = memoryClaimStore({ steven_payment_pushed_w4: { paymentDate: "2026-09-01" } }); let l = 0;
    const lv = (x: Record<string, unknown>) => (typeof x.paymentDate === "string" ? x.paymentDate : null);
    const r5 = await deliverOnce(legacy, "steven_payment_pushed_w4", "2026-09-01", T0, async () => { l++; return "sent"; }, { legacyVersionOf: lv });
    const r6 = await deliverOnce(legacy, "steven_payment_pushed_w4", "2026-09-20", T0, async () => { l++; return "sent"; }, { legacyVersionOf: lv });
    ok("a legacy marker still dedupes its own event; a new event sends", r5.outcome === "already_sent" && r6.outcome === "sent" && l === 1);
    ok("a legacy marker (no status) is RECORDED_UNVERIFIED, never SENT", markerStateOf({ at: "2026-09-01T00:00:00Z" }) === "RECORDED_UNVERIFIED" && markerStateOf(null) === "NONE");
    ok("a fresh processing claim is in progress; a stuck one is reclaimable", decideDeliveryClaim({ status: "processing", version: "job", claimedAt: new Date(T0).toISOString() }, "job", T0 + MIN) === "in_progress" && decideDeliveryClaim({ status: "processing", version: "job", claimedAt: new Date(T0).toISOString() }, "job", T0 + STUCK_PROCESSING_TIMEOUT_MS + 1000) === "cas_update");
    ok("classify: empty = no_subscription, none fulfilled = send_failed, any fulfilled = sent", classify([]) === "no_subscription" && classify([{ status: "rejected" }]) === "send_failed" && classify([{ status: "rejected" }, { status: "fulfilled" }]) === "sent");
  }
  {
    const mr = code(read("lib/steven-mix-ready-notify.ts")), pay = code(read("lib/steven-payment-notify.ts")), vc = code(read("lib/victor-completed-notify.ts"));
    ok("mix ready / payment / Victor completed write their marker ONLY through deliverOnce (no marker upsert around the send)", [mr, pay, vc].every((t) => /deliverOnce\(/.test(t) && !/\.upsert\(/.test(t) && !/from\("settings"\)/.test(t)));
    ok("mix ready + payment classify STEVEN's own delivery (a separate Owner copy never makes it 'sent')", [mr, pay].every((t) => /classify\(await sendPushToRoles\(\["steven"\]/.test(t)));
    ok("Victor completed: the Owner ack only after Victor's push was delivered", /if \(outcome !== "sent"\)[\s\S]{0,300}return;[\s\S]{0,200}sendPushToRoles\(\["owner"\]/.test(vc));
    const notes = code(read("lib/steven-notes-notify.ts"));
    ok("notes: the result is real (sent only when Steven's push was delivered); cycleStartAt is named Owner-action evidence", /stevenResult === "sent"\) return \{ ok: true, sent: true/.test(notes) && /ok: false, sent: false/.test(notes) && /ownerActionAt/.test(notes) && /startOrResetReminderCycle\(work\.id, ownerActionAt\)/.test(notes));
    const av = code(read("lib/red-artists/availability.ts"));
    ok("availability: each push classified; 'sent' only when the other side's push was delivered", /classify\(await sendPushToRoles/.test(av) && /primary === "sent"/.test(av) && !/return \{ sent: true \};/.test(av));
  }

  // ── C. final files ─────────────────────────────────────────────────────────────────────────────────────────────
  section("C. Final-files batch — claimed before the push, 'sent' never written before delivery");
  {
    const open: BatchValue = { status: "open", workId: "w1", workName: "Song", successCount: 3, lastUpdateAt: new Date(T0).toISOString() };
    const store = memoryClaimStore({ "final_files_batch:b1": open }); let n = 0;
    const out = await claimAndSendBatch(store, "final_files_batch:b1", open, T0, async () => { n++; return "sent"; });
    ok("delivered → one push, the batch row removed", out === "sent" && n === 1 && !store.data.has("final_files_batch:b1"));
    const f = memoryClaimStore({ "final_files_batch:b2": open }); let m = 0;
    const out2 = await claimAndSendBatch(f, "final_files_batch:b2", open, T0, async () => { m++; return "no_subscription"; });
    const row = f.data.get("final_files_batch:b2") as BatchValue;
    ok("not delivered → a durable 'failed' row with the result (never 'sent')", out2 === "no_subscription" && row?.status === "failed" && row.result === "no_subscription");
    const c = memoryClaimStore({ "final_files_batch:b3": open }); let k = 0;
    const res = await Promise.all([1, 2].map(() => claimAndSendBatch(c, "final_files_batch:b3", open, T0, async () => { k++; return "sent"; })));
    ok("double complete (click + fallback tick) → one push", k === 1 && res.filter((r) => r === "lost_claim").length === 1);
    const z = memoryClaimStore({ "final_files_batch:b4": { ...open, successCount: 0 } }); let zz = 0;
    await claimAndSendBatch(z, "final_files_batch:b4", { ...open, successCount: 0 }, T0, async () => { zz++; return "sent"; });
    ok("zero successful files → no push", zz === 0);
    ok("a crashed processing claim is reclaimable after the stuck timeout", isBatchClaimStuck({ ...open, status: "processing", claimedAt: new Date(T0).toISOString() }, T0 + STUCK_PROCESSING_TIMEOUT_MS + 1000) && !isBatchClaimStuck({ ...open, status: "processing", claimedAt: new Date(T0).toISOString() }, T0 + MIN));
    ok("the notifier never writes status 'sent' itself", !/status:\s*"sent"/.test(code(read("lib/final-files-batch-notify.ts"))) && /claimAndSendBatch\(/.test(code(read("lib/final-files-batch-notify.ts"))));
  }

  // ── D. upload flushes ──────────────────────────────────────────────────────────────────────────────────────────
  section("D. Upload-notice flushes — claim before send, no double send across processes");
  {
    const due = { workId: "w1", projectName: "P", count: 2, dueAt: new Date(T0 - 1000).toISOString() };
    const store = memoryClaimStore({ victor_upload_pending_w1: due }); let n = 0;
    const [a, b] = await Promise.all([1, 2].map(() => flushDueBatches(store, "victor_upload_pending_", T0, async () => { n++; await new Promise((r) => setTimeout(r, 5)); return "sent"; })));
    ok("two overlapping ticks (two processes) → one push; the row removed after delivery", n === 1 && [...a, ...b].filter((x) => x.outcome === "lost_claim").length === 1 && !store.data.has("victor_upload_pending_w1"));
    const f = memoryClaimStore({ steven_upload_pending_w2: due }); let m = 0;
    await flushDueBatches(f, "steven_upload_pending_", T0, async () => { m++; return "send_failed"; });
    await flushDueBatches(f, "steven_upload_pending_", T0 + MIN, async () => { m++; return "sent"; });
    ok("a failed flush stays as a durable failed row and is not resent every minute", m === 1 && (f.data.get("steven_upload_pending_w2") as { status: string }).status === "failed");
    const g = memoryClaimStore({ steven_upload_pending_w3: due });
    await flushDueBatches(g, "steven_upload_pending_", T0, async () => { await g.upsert("steven_upload_pending_w3", { workId: "w3", count: 1, dueAt: new Date(T0 + MIN).toISOString() }); return "sent"; });
    ok("an upload that arrives while the batch is being sent survives (conditional delete)", (g.data.get("steven_upload_pending_w3") as { count: number }).count === 1);
    ok("a new upload never joins a batch being sent or a failed record", joinableBatch({ status: "processing" }) === null && joinableBatch({ status: "failed" }) === null && joinableBatch({ dueAt: "x" }) !== null);
    ok("an open batch waits for its window; a stuck processing claim is reclaimed", batchFlushDecision({ dueAt: new Date(T0 + 1000).toISOString() }, T0) === "wait" && batchFlushDecision({ status: "processing", claimedAt: new Date(T0).toISOString() }, T0 + STUCK_PROCESSING_TIMEOUT_MS + 1) === "claim");
    for (const fl of ["lib/steven-notify.ts", "lib/victor-upload-notify.ts"]) ok(`${fl} flushes through the claiming flushDueBatches (no send-then-delete)`, /flushDueBatches\(/.test(code(read(fl))) && !/\.delete\(\)/.test(code(read(fl))));
  }

  // ── E. report emails ───────────────────────────────────────────────────────────────────────────────────────────
  section("E. Report emails — one durable claim per type per Israel day");
  {
    const store = memoryClaimStore(); let n = 0;
    const day = ilYmd(T0);
    const a = await Promise.all([1, 2].map(() => deliverOnce(store, reportEmailClaimKey("morning", day), "day", T0, async () => { n++; return "sent"; })));
    const again = await deliverOnce(store, reportEmailClaimKey("morning", day), "day", T0 + MIN, async () => { n++; return "sent"; });
    ok("two processes / a restart in the same minute → one morning email; later the same day → none", n === 1 && a.filter((x) => x.outcome === "sent").length === 1 && again.outcome === "already_sent");
    await deliverOnce(store, reportEmailClaimKey("evening", day), "day", T0, async () => { n++; return "sent"; });
    ok("the evening report has its own claim", n === 2);
    const f = memoryClaimStore();
    await deliverOnce(f, reportEmailClaimKey("morning", day), "day", T0, async () => { throw new Error("resend 500"); });
    ok("an email failure is recorded as failed", markerStateOf(f.data.get(reportEmailClaimKey("morning", day))) === "FAILED");
    const inst = code(read("instrumentation.ts"));
    ok("instrumentation sends reports only through the per-day claim", /deliverOnceStatus\(settingsClaimStore, reportEmailClaimKey\(type, ilYmd\(nowMs\)\)/.test(inst));
  }

  // ── F. external push cron ──────────────────────────────────────────────────────────────────────────────────────
  section("F. External push cron — production guard, per-day dedupe, hidden / cancelled filtered, per currency");
  {
    const today = "2026-09-27";
    const projects = [
      { id: "p1", name: "Visible overdue", status: "בעבודה", deadline: "2026-09-20", is_hidden: false },
      { id: "p2", name: "Hidden overdue", status: "בעבודה", deadline: "2026-09-20", is_hidden: true },
      { id: "p3", name: "Cancelled overdue", status: "בוטל", deadline: "2026-09-20", is_hidden: false },
      { id: "p4", name: "Paused", status: "בהשהייה", deadline: "2026-09-20", is_hidden: false },
      { id: "p5", name: "Done", status: "הושלם", deadline: "2026-09-20", is_hidden: false },
    ];
    const d = buildOwnerDigest({ today, hour: 9, withSummary: true, projects, sessions: [], overdueIncome: [{ id: "t1", amount: 1000, currency: "₪" }, { id: "t2", amount: 300, currency: "$" }, { id: "t3", amount: 500, currency: "₪" }] });
    ok("hidden / cancelled / paused / completed projects are never overdue", d.overdue.map((p) => p.id).join() === "p1" && !isDeadlineCandidate(projects[1]) && !isDeadlineCandidate(projects[2]));
    const pay = d.notifications.find((x) => x.type === "payments")!;
    ok("overdue income totals per currency — never one mixed sum under one label", JSON.stringify(sumByCurrency([{ id: "a", amount: 1, currency: "₪" }, { id: "b", amount: 2, currency: "$" }])) === JSON.stringify({ "₪": 1, "$": 2 }) && /1,500₪|1500₪/.test(pay.body) && /300\$/.test(pay.body) && !/1,800|1800/.test(pay.body));
    ok("the morning summary counts no Victor-stuck item and nothing pushes Victor stuck", !d.notifications.some((x) => /ויקטור|victor/i.test(`${x.title} ${x.body} ${x.tag}`)));
    ok("Israel day / hour (DST-safe): 22:30Z on 2026-09-26 is already 2026-09-27 01:30 in Israel", ilYmd(Date.parse("2026-09-26T22:30:00Z")) === "2026-09-27" && ilHour(Date.parse("2026-09-26T22:30:00Z")) === 1 && ilHour(Date.parse("2026-12-01T07:00:00Z")) === 9);
    const store = memoryClaimStore(); let n = 0;
    for (const call of [1, 2, 3]) for (const x of d.notifications) await deliverOnce(store, pushCronClaimKey(x.type, today), "day", T0 + call * MIN, async () => { n++; return "sent"; });
    ok("the cron called three times the same day → each notification type sent once", n === d.notifications.length && d.notifications.length >= 3);
    const dg = code(read("lib/push-digest.ts"));
    ok("the digest sends only when pushAllowed() and only through the per-day claim; hidden + closed filtered in the query", /if \(!allowed\)/.test(dg) && /const allowed = pushAllowed\(\)/.test(dg) && /deliverOnce\(settingsClaimStore, pushCronClaimKey\(n\.type, today\)/.test(dg) && /\.eq\("is_hidden", false\)/.test(dg) && /NOT_DEADLINE_CANDIDATE_STATUSES/.test(dg));
    ok("cron + legacy check both use the one digest (parity)", ["app/api/push/cron/route.ts", "app/api/push/check/route.ts"].every((f) => /runOwnerDigest\(/.test(code(read(f)))) && !/getUTCHours\(\) \+ 3/.test(read("app/api/push/cron/route.ts")));
  }

  // ── G. Victor stuck ────────────────────────────────────────────────────────────────────────────────────────────
  section("G. Victor stuck — the app's one rule, computed, NEVER pushed (Owner decision Q3)");
  {
    ok("rule: פעיל AND more than stuckAfterDays since sent (default 5)", isVictorWorkStuck("פעיל", 6, 5) && !isVictorWorkStuck("פעיל", 5, 5) && !isVictorWorkStuck("הושלם", 30, 5) && !isVictorWorkStuck("פעיל", null, 5) && isVictorWorkStuck("פעיל", DEFAULT_STUCK_AFTER_DAYS + 1, undefined) && isVictorWorkStuck("פעיל", 3, 2));
    const sig = victorStuckSignals([
      { id: "v1", title: "Beat A", status: "פעיל", daysSinceSent: 9, filesSent: [{ uploadedAt: "2026-09-25T10:00:00Z" }], versionReviews: {} },
      { id: "v2", title: "Beat B", status: "פעיל", daysSinceSent: 2 },
      { id: "v3", title: "Old status value", status: "בעבודה אצל ויקטור", daysSinceSent: 40 },
    ], 5);
    ok("computed with the ball (an upload with no notes → the ball is the Owner's, never 'Victor is late')", sig.length === 1 && sig[0].id === "v1" && sig[0].ballHolder === "owner");
    ok("the push is disabled: flag false, no sender for it anywhere in the digest", VICTOR_STUCK_PUSH_ENABLED === false && !/victor-stuck|ויקטור — /.test(read("lib/push-digest-pure.ts").replace(/\/\*[\s\S]*?\*\//g, "")));
    ok("the app's store uses the same rule", /isVictorWorkStuck\(/.test(code(read("lib/vendor-store.ts"))));
    ok("Sunny knows it: victor_view emits VICTOR_STUCK with the same rule, and the company map classifies it", /code: "VICTOR_STUCK"/.test(read("lib/partner/victor/view.ts")) && /isVictorWorkStuck\(/.test(read("lib/partner/victor/view.ts")) && !!ATTENTION_MAP.VICTOR_STUCK);
    const cron = PUSH_CONTRACTS.find((p) => p.id === "P_EXTERNAL_PUSH_CRON")!;
    ok("the push contract states the Owner decision", /never pushed \(Owner decision Q3, 2026-09-27\)/.test(cron.purpose) && cron.productionOnly === true);
  }

  // ── H. registry / settings / readers ───────────────────────────────────────────────────────────────────────────
  section("H. Registry, settings classification and Sunny readers");
  {
    const pp = BACKGROUND_WRITERS.find((w) => w.id === "PORTAL_PRESENCE")!;
    ok("PORTAL_PRESENCE: PORTAL_HEARTBEAT, sendsPush true, describes the real behaviour", pp.trigger === "PORTAL_HEARTBEAT" && pp.sendsPush && /30 minutes/.test(pp.noteEn) && /claimed atomically/.test(pp.noteEn));
    ok("phantom NOTIFICATIONS_HOUSEKEEPING removed; SKETCH_DURATION_LEARN classified", !BACKGROUND_WRITERS.some((w) => w.id === "NOTIFICATIONS_HOUSEKEEPING") && BACKGROUND_WRITERS.some((w) => w.id === "SKETCH_DURATION_LEARN" && !w.sendsPush));
    ok("the handler-map scan no longer treats createSupabase* / createClient as writes", /NOT_WRITER_CALL_RE/.test(read("scripts/gen-act-handler-map.mjs")));
    const fam = (k: string) => familyOfKey(k)?.id;
    ok("every new settings key is classified (C, readable by Sunny)", PRESENCE_KEYS.every((k) => fam(k) === "PORTAL_PRESENCE") && fam(pushCronClaimKey("overdue", "2026-09-27")) === "PUSH_CRON_SENT" && fam(reportEmailClaimKey("morning", "2026-09-27")) === "REPORT_EMAIL_SENT"
      && ["PORTAL_PRESENCE", "PUSH_CRON_SENT", "REPORT_EMAIL_SENT"].every((id) => { const f = SETTINGS_FAMILIES.find((x) => x.id === id)!; return f.class === "C_INTERNAL_STATE_WITH_MEANING" && f.read === "SYSTEM_SETTINGS"; }));
    const presFam = SETTINGS_FAMILIES.find((x) => x.id === "PORTAL_PRESENCE")!.internal.query as { in: readonly string[] };
    ok("Sunny's bounded presence read includes every last-seen + claim key (and the legacy rows)", PRESENCE_KEYS.every((k) => presFam.in.includes(k)) && presFam.in.includes("victor_visit_last"));
    for (const [f, portal] of [["lib/partner/victor/view.ts", "victor"], ["lib/partner/mix/view.ts", "steven"], ["lib/partner/label/view.ts", "presPortal"]] as const) ok(`${f} reads LAST_SEEN (presenceFactsOf) — not the old push cooldown — as the last entry`, new RegExp(`presenceFactsOf\\([^)]*${portal === "presPortal" ? "presPortal" : `"${portal}"`}\\)`).test(read(f)) && /lastSeenAt/.test(read(f)));
    ok("Sunny states marker truth: failed / legacy markers are never 'SENT'", /markerStateOf/.test(read("lib/partner/victor/view.ts")) && /markerStateOf/.test(read("lib/partner/mix/view.ts")) && /markerStateOf/.test(read("lib/partner/mix/handoff.ts")));
    const presC = PUSH_CONTRACTS.filter((p) => /_PRESENCE$/.test(p.id));
    ok("the five presence push contracts describe the one model (30-minute absence, atomic claim, sent only after delivery)", presC.length === 5 && presC.every((p) => /30 minutes/.test(p.dedupe) && /claimed atomically/.test(p.dedupe) && /sent only after delivery/.test(p.dedupe) && p.knownBugs.length === 0));
    ok("the ping routes stay Owner no-ops and never call /api/push/check", ["app/api/red-artists/ping/route.ts", "app/api/label/artists/[id]/ping/route.ts", "app/api/red-artists/cleantone/ping/route.ts", "app/api/supplier/steven/ping/route.ts", "app/api/vendor/victor/ping/route.ts"].every((f) => /return NextResponse\.json\(\{ ok: true \}\)/.test(read(f)) && !/push\/check/.test(code(read(f)))));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
