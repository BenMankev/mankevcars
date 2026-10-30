// Bump the version number below whenever you publish a new app version.
try { importScripts("config.js"); } catch (e) {}
var CACHE = "mankevcars-v2";
var FILES = ["./", "index.html", "config.js", "manifest.webmanifest", "icon-192.png", "icon-512.png", "apple-touch-icon.png"];
self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(FILES); }));
  self.skipWaiting();
});
self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
// Network first, so updates show up right away; the saved copy is used when offline.
self.addEventListener("fetch", function (e) {
  if (e.request.method !== "GET" || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(fetch(e.request).then(function (r) {
    var copy = r.clone();
    caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
    return r;
  }).catch(function () {
    return caches.match(e.request).then(function (m) { return m || caches.match("index.html"); });
  }));
});
// A reminder arrives as an empty "wake up" push. The text is fetched from the reminder service.
function show(title, body) {
  return self.registration.showNotification(title || "MankevCars", { body: body || "", icon: "icon-192.png", badge: "icon-192.png", tag: "mankevcars" });
}
function fallback() { return show("MankevCars", "Atidarykite programą ir patikrinkite datas. / Open the app and check your dates."); }
self.addEventListener("push", function (e) {
  var api = (self.MC_API || "").replace(/\/+$/, "");
  e.waitUntil(self.registration.pushManager.getSubscription().then(function (sub) {
    if (!sub || !api) return fallback();
    return fetch(api + "/pending", { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify({ endpoint: sub.endpoint }) })
      .then(function (r) { return r.json(); })
      .then(function (d) { return show(d.title, d.body); });
  }).catch(fallback));
});
self.addEventListener("notificationclick", function (e) {
  e.notification.close();
  e.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (l) { return l.length ? l[0].focus() : clients.openWindow("./"); }));
});
