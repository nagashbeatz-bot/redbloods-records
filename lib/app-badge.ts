"use client";

/**
 * App Icon Badge (Badging API) — the OS-level unread-count number on the
 * home-screen icon (iOS 16.4+ standalone PWAs; Chromium desktop/Android too).
 * Already in TypeScript's bundled DOM lib (Navigator.setAppBadge/clearAppBadge).
 *
 * Owner-only pilot: callers gate on role themselves (this file has no role
 * awareness) — it only wraps feature detection + the set/clear call so
 * there's one place to change if the API's shape ever needs adjusting.
 */

export function appBadgeSupported(): boolean {
  return typeof navigator !== "undefined" && "setAppBadge" in navigator;
}

/** Best-effort; never throws. count <= 0 clears the badge. */
export function syncAppBadge(count: number): void {
  if (!appBadgeSupported()) return;
  try {
    if (count > 0) navigator.setAppBadge(count).catch(() => {});
    else navigator.clearAppBadge().catch(() => {});
  } catch { /* Badging API unavailable/denied — no-op */ }
}
