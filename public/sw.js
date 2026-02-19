self.addEventListener('push', (event) => {
  if (!event.data) {
    return;
  }

  const payload = event.data.json();

  event.waitUntil(
    (async () => {
      const options = {
        body: payload.body,
        tag: 'broadcast-message',
        icon: '/images/notify-icon.svg',
        badge: '/images/notify-icon.svg',
      };

      if (payload.imageUrl) {
        options.image = payload.imageUrl;
      }

      await self.registration.showNotification(payload.title, options);

      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      clients.forEach((client) => {
        client.postMessage({ type: 'PUSH_MESSAGE', payload });
      });
    })(),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      if (clients.length > 0) {
        return clients[0].focus();
      }
      return self.clients.openWindow('/');
    }),
  );
});
