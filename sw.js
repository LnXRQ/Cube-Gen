// Offline: App, Draft-Motor und Kartenbilder kommen aus dem Speicher des iPhones.
const VERSION = "20261124-140047";            // bauen.py setzt die Version ein
const APP = "app-" + VERSION;
const BILDER = "karten-bilder-v1";        // gleicher Name wie in app.js – Bilder überleben Updates
const DATEIEN = ["./", "index.html", "app.css", "app.js", "motor.js", "manifest.webmanifest", "icons/icon-180.png", "icons/icon-192.png", "icons/icon-512.png", "fonts/alegreya-sans-400.woff2", "fonts/alegreya-sans-700.woff2", "fonts/alegreya-sans-800.woff2", "fonts/uncial-antiqua-400.woff2", "py/cubegen.json", "pyodide/pyodide.js", "pyodide/pyodide.asm.js", "pyodide/pyodide.asm.wasm", "pyodide/python_stdlib.zip", "pyodide/pyodide-lock.json"];

self.addEventListener("install", ev => {
  ev.waitUntil(caches.open(APP).then(c => c.addAll(DATEIEN)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", ev => {
  ev.waitUntil(caches.keys()
    .then(k => Promise.all(k.filter(n => n.startsWith("app-") && n !== APP).map(n => caches.delete(n))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", ev => {
  const r = ev.request;
  if (r.method !== "GET") return;
  const u = new URL(r.url);
  // Kartenbilder: erst aus dem Speicher, sonst aus dem Netz
  if (u.hostname === "cards.scryfall.io" || (u.hostname === "api.scryfall.com" && u.pathname === "/cards/named")) {
    ev.respondWith(caches.open(BILDER).then(c => c.match(r.url)).then(t => t || fetch(r)));
    return;
  }
  if (u.origin !== self.location.origin) return;
  // Mitgelieferte Cubes: lieber frisch, offline aus dem Speicher
  if (u.pathname.includes("/cubes/")) {
    ev.respondWith(fetch(r).then(a => { const k = a.clone(); caches.open(APP).then(c => c.put(r, k)); return a; })
      .catch(() => caches.match(r, {ignoreSearch: true})));
    return;
  }
  ev.respondWith(caches.match(r, {ignoreSearch: true}).then(t => t || fetch(r)));
});
