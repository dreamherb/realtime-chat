/* eslint-disable no-restricted-globals */
const DEFAULT_ICON = "/icons/chat-notification.svg";

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data ? event.data.text() : "" };
  }

  const title = payload.title || "새 메시지";
  const options = {
    body: payload.body || "",
    icon: payload.icon || DEFAULT_ICON,
    tag: payload.tag || `chat-push-${Date.now()}`,
    data: {
      url: payload.url || "/dashboard",
    },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetPath = event.notification.data?.url || "/dashboard";
  const targetUrl = new URL(targetPath, self.location.origin).href;

  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((windowClients) => {
        for (const client of windowClients) {
          if (!client.url.startsWith(self.location.origin)) continue;
          if ("focus" in client) {
            return client.focus().then((focused) => {
              if (focused && "navigate" in focused) {
                return focused.navigate(targetUrl);
              }
              return focused;
            });
          }
        }
        if (clients.openWindow) {
          return clients.openWindow(targetUrl);
        }
        return undefined;
      }),
  );
});
