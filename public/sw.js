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
  event.waitUntil(self.registration.showNotification(title, options));
});

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
