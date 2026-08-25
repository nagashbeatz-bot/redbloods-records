"use client";

/**
 * App Icon Badge (Badging API) — the OS-level unread-count number on the
 * home-screen icon (iOS 16.4+ standalone PWAs; Chromium desktop/Android too).
 * Already in TypeScript's bundled DOM lib (Navigator.setAppBadge/clearAppBadge).
 *
 * This file has no role awareness on purpose — it only wraps feature detection
 * plus the set/clear call, so there's one place to change if the API's shape
 * ever needs adjusting. Who gets a badge is decided by the callers: the header
 * bell in the foreground (it renders only for roles AppShell allows), and
 * BADGE_ROLES in public/sw.js while the app is closed.
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
