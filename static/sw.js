/* Keeps the mood page usable when the server is unreachable, and shows the
 * reminders the server pushes. Only the rating page and its assets are cached;
 * everything else always goes to the network. */
const CACHE = "asom-v3";
const PAGE = "/rate/";
const ASSETS = ["/static/css/app.css", "/static/js/rate.js", "/static/icons/icon-192.png"];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(ASSETS);
    // Cache the page only when signed in; a redirect to the login page is not cached.
    const page = await fetch(PAGE, { redirect: "manual", credentials: "same-origin" }).catch(() => null);
    if (page && page.ok) await cache.put(PAGE, page);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname !== PAGE && !ASSETS.includes(url.pathname)) return;
  // Network first, so the page is fresh whenever the server answers.
  event.respondWith((async () => {
    try {
      const response = await fetch(event.request);
      if (response.ok && !response.redirected) {
        const cache = await caches.open(CACHE);
        await cache.put(url.pathname, response.clone());
      }
      return response;
    } catch (error) {
      return (await caches.match(url.pathname)) || Response.error();
    }
  })());
});

// A reminder: the payload carries only its text. Tapping it opens the rating page.
self.addEventListener("push", (event) => {
  let message = { title: "A Study On Myself", body: "How do you feel right now?", url: PAGE };
  try {
    if (event.data) message = { ...message, ...event.data.json() };
  } catch (error) {
    // an unreadable payload still gets the default reminder
  }
  event.waitUntil(self.registration.showNotification(message.title, {
    body: message.body, tag: "mood-" + (message.slot || "now"), icon: "/static/icons/icon-192.png", data: { url: message.url || PAGE },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || PAGE;
  event.waitUntil((async () => {
    for (const client of await self.clients.matchAll({ type: "window", includeUncontrolled: true })) {
      if (new URL(client.url).pathname === url && "focus" in client) return client.focus();
    }
    return self.clients.openWindow(url);
  })());
});
