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
  const url = event.notification.data?.url ?? "/dashboard";
  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((list) => {
        // If app already open — focus it and navigate
        for (const client of list) {
          if ("focus" in client) {
            client.focus();
            client.navigate?.(url);
            return;
          }
        }
        // Otherwise open new window
        return clients.openWindow(url);
      })
  );
});
