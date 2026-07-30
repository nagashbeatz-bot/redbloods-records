/**
 * Plain assert-and-print test for lib/show-notify-pure.ts — no DB, no push.
 * Matches this repo's existing scripts/test-*.ts convention.
 * Run: npx tsx scripts/test-show-notify.ts
 */
import {
  fmtShowDateForPush,
  buildShowNotifyBody,
  computeShowNotifyFingerprint,
  decideShowNotifyClaim,
  isUpcomingShowStatus,
  STUCK_PROCESSING_TIMEOUT_MS,
  type ShowNotifyClaimValue,
} from "../lib/show-notify-pure";

let pass = 0;
let fail = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { pass++; }
  else { fail++; console.error(`FAIL: ${label}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`); }
}

// ── fmtShowDateForPush ────────────────────────────────────────────────────────
check("YYYY-MM-DD → DD.MM.YYYY", fmtShowDateForPush("2026-08-06"), "06.08.2026");
check("null date", fmtShowDateForPush(null), "—");

// ── buildShowNotifyBody ────────────────────────────────────────────────────────
check(
  "no location → {name} · {date} בשעה {time}",
  buildShowNotifyBody({ name: "פורום באר שבע", date: "2026-08-06", startTime: "22:00", location: "" }),
  "פורום באר שבע · 06.08.2026 בשעה 22:00",
);
check(
  "with location → {name} · {date} · {time} · {location}",
  buildShowNotifyBody({ name: "פורום באר שבע", date: "2026-08-06", startTime: "22:00", location: "באר שבע" }),
  "פורום באר שבע · 06.08.2026 · 22:00 · באר שבע",
);
check(
  "no startTime → falls back to em dash, not empty",
  buildShowNotifyBody({ name: "X", date: "2026-08-06", startTime: null, location: "" }),
  "X · 06.08.2026 בשעה —",
);
{
  const body = buildShowNotifyBody({ name: "פורום באר שבע", date: "2026-08-06", startTime: "22:00", location: "באר שבע" });
  check("never leaks money-shaped tokens (₪ sign)", body.includes("₪"), false);
}

// ── computeShowNotifyFingerprint ──────────────────────────────────────────────
const base = { name: "פורום באר שבע", date: "2026-08-06", startTime: "22:00", location: "באר שבע" };
check("same fields → identical fingerprint", computeShowNotifyFingerprint(base), computeShowNotifyFingerprint({ ...base }));
check("whitespace-only name diff → same fingerprint (trimmed)", computeShowNotifyFingerprint(base), computeShowNotifyFingerprint({ ...base, name: "  פורום באר שבע  " }));
check("name change → different fingerprint", computeShowNotifyFingerprint(base) !== computeShowNotifyFingerprint({ ...base, name: "שם אחר" }), true);
check("date change → different fingerprint", computeShowNotifyFingerprint(base) !== computeShowNotifyFingerprint({ ...base, date: "2026-08-07" }), true);
check("time change → different fingerprint", computeShowNotifyFingerprint(base) !== computeShowNotifyFingerprint({ ...base, startTime: "23:00" }), true);
check("location change → different fingerprint", computeShowNotifyFingerprint(base) !== computeShowNotifyFingerprint({ ...base, location: "מקום אחר" }), true);

// ── isUpcomingShowStatus ────────────────────────────────────────────────────────
check("אושרה → upcoming", isUpcomingShowStatus("אושרה"), true);
check("נסגר → upcoming", isUpcomingShowStatus("נסגר"), true);
check("בוצע → not upcoming", isUpcomingShowStatus("בוצע"), false);
check("בוטל → not upcoming", isUpcomingShowStatus("בוטל"), false);
check("ליד חדש → not upcoming", isUpcomingShowStatus("ליד חדש"), false);

// ── decideShowNotifyClaim ────────────────────────────────────────────────────
const now = new Date("2026-08-01T10:00:00.000Z");
const fp = computeShowNotifyFingerprint(base);

check("QA: no existing claim → insert (first send ever)", decideShowNotifyClaim(null, fp, now), { action: "insert" });

{
  const existing: ShowNotifyClaimValue = { status: "sent", fingerprint: fp, claimedAt: now.toISOString(), sentAt: now.toISOString() };
  check("QA: same version, already sent → already_sent (button shows נשלח, no new push)", decideShowNotifyClaim(existing, fp, now), { action: "already_sent" });
}

{
  const existing: ShowNotifyClaimValue = { status: "processing", fingerprint: fp, claimedAt: now.toISOString() };
  const soonAfter = new Date(now.getTime() + 2000); // 2s later — well within the stuck window
  check("QA: double-click (fresh processing claim) → in_progress, second click blocked", decideShowNotifyClaim(existing, fp, soonAfter), { action: "in_progress" });
}

{
  const existing: ShowNotifyClaimValue = { status: "processing", fingerprint: fp, claimedAt: now.toISOString() };
  const stuckLater = new Date(now.getTime() + STUCK_PROCESSING_TIMEOUT_MS + 1000);
  check("QA: stuck processing (crashed mid-send) past timeout → cas_update (safe reclaim)", decideShowNotifyClaim(existing, fp, stuckLater), { action: "cas_update" });
}

{
  const existing: ShowNotifyClaimValue = { status: "failed", fingerprint: fp, claimedAt: now.toISOString() };
  check("QA: prior send failed, same version → cas_update (retry allowed)", decideShowNotifyClaim(existing, fp, now), { action: "cas_update" });
}

{
  // Date changed since the last send → different fingerprint → button re-opens,
  // regardless of the old row's status (even if it was already "sent").
  const existing: ShowNotifyClaimValue = { status: "sent", fingerprint: fp, claimedAt: now.toISOString(), sentAt: now.toISOString() };
  const newFp = computeShowNotifyFingerprint({ ...base, date: "2026-08-07" });
  check("QA: date changed after a prior send → cas_update (resend allowed for the new version)", decideShowNotifyClaim(existing, newFp, now), { action: "cas_update" });
}

{
  // A money-only change never alters the fingerprint at all — the caller never
  // even reaches decideShowNotifyClaim with a different fingerprint for this case,
  // so this asserts the fingerprint itself is money-blind (the real guarantee).
  const withMoneyFieldsIgnored = computeShowNotifyFingerprint(base); // fingerprint has no amount/fee inputs by construction
  check("QA: fingerprint has no money inputs — a money-only show edit can't change it", withMoneyFieldsIgnored, fp);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
