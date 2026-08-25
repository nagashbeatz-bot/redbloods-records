// Redbloods Records — Service Worker
// Handles push notifications and notification clicks

self.addEventListener("push", (event) => {
  const data = event.data?.json() ?? {};
  const title = data.title ?? "Redbloods Records";
  const options = {
    body:    data.body  ?? "",
    icon:    "/apple-icon.png",
    badge:   "/icon-192.png",
    tag:     data.tag   ?? "rb-default",
    renotify: true,
    data:    { url: data.url ?? "/dashboard" },
    actions: data.actions ?? [],
  };
  event.waitUntil(
    Promise.all([
      self.registration.showNotification(title, options),
      updateAppBadge(),
    ])
  );
});

// ── App Icon Badge (owner + the two suppliers who have a bell) ───────────
// Runs on every push so the home-screen icon badge stays correct even while
// the app is fully closed — this is the one thing a foreground-only update
// can't cover. Reads the SAME two existing, read-only endpoints the page
// itself already uses (/api/me for role, /api/notifications for the unread
// count) — no new endpoint, no count computed/duplicated here, and this is
// the same-origin request's own session cookie, so it's already scoped to
// whichever user is signed in on THIS device. Bails immediately for any
// role that is NOT on the explicit whitelist below — Shalev / CLEANTONE / Avi
// have no bell and must not start getting a badge. Always best-effort: a
// failure here must never block the actual notification.
const BADGE_ROLES = ["owner", "victor", "steven"];

async function updateAppBadge() {
  if (!("setAppBadge" in self.navigator)) return;
  try {
    const meRes = await fetch("/api/me", { credentials: "same-origin" });
    if (!meRes.ok) return;
    const me = await meRes.json();
    if (!BADGE_ROLES.includes(me?.role)) return;

    const notifRes = await fetch("/api/notifications", { credentials: "same-origin" });
    if (!notifRes.ok) return;
    const data = await notifRes.json();
    const count = typeof data?.unreadCount === "number" ? data.unreadCount : 0;

    if (count > 0) await self.navigator.setAppBadge(count);
    else await self.navigator.clearAppBadge();
  } catch { /* best-effort — badge sync must never block the push */ }
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  // Absolute, in-scope URL so an existing PWA window is navigated in place and a
  // fresh open lands inside the installed app (not a detached relative path).
  const target = new URL(event.notification.data?.url ?? "/dashboard", self.location.origin).href;

  event.waitUntil(
    (async () => {
      const list = await clients.matchAll({ type: "window", includeUncontrolled: true });

      // Prefer an already-open window of OUR origin (the PWA) → focus + navigate
      // in place. Keeps the click inside the installed app instead of opening a
      // browser with a separate (unauthenticated) session.
      for (const client of list) {
        let sameOrigin = false;
        try { sameOrigin = new URL(client.url).origin === self.location.origin; } catch { /* opaque url */ }
        if (!sameOrigin) continue;

        try { await client.focus(); } catch { /* focus may be denied */ }
        // WindowClient.navigate is unreliable on iOS PWAs — best-effort only.
        if ("navigate" in client) {
          try { await client.navigate(target); } catch { /* navigation not supported here */ }
        }
        return;
      }

      // No window of ours is open → open one at the deep link.
      await clients.openWindow(target);
    })()
  );
});
