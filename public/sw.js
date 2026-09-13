/*
 * maeosan service worker — web push only.
 * No offline caching: chat data is private and always fetched live.
 */

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "maeosan", body: event.data ? event.data.text() : "" };
  }

  event.waitUntil(
    (async () => {
      // The open, focused app already alerts in-page; don't double up.
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      if (windows.some((client) => client.focused && client.visibilityState === "visible")) return;

      await self.registration.showNotification(data.title || "maeosan", {
        body: data.body || "New message",
        tag: data.tag,
        renotify: Boolean(data.tag),
        icon: "/icon.svg",
        badge: "/icon.svg",
        timestamp: data.timestamp || Date.now(),
        data: { url: data.url || "/" },
      });
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || "/", self.location.origin).href;

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of windows) {
        if (new URL(client.url).origin !== self.location.origin) continue;
        await client.focus();
        if ("navigate" in client) await client.navigate(target);
        return;
      }
      await self.clients.openWindow(target);
    })(),
  );
});
