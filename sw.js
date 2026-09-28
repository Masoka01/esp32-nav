/*
 * Service worker ESP32 Navigator.
 *
 * Tujuannya satu: memenuhi syarat install Chrome, supaya user bisa memasang
 * aplikasi, bukan cuma shortcut. File ini BUKAN aplikasi offline.
 *
 * Kenapa tidak dibuat offline:
 * aplikasi menghitung rute lewat OSRM dan menggambar tile OpenStreetMap.
 * Keduanya butuh jaringan. Cache offline tidak membuat navigasi jalan tanpa
 * internet - paling-paling peta kosong. Jadi tidak ada data berguna untuk
 * di-cache, dan tidak ada risiko yang perlu diambil.
 *
 * === ATURAN CACHE (deny-by-default) ===
 *
 * Semua request lintas-origin SELALU network-only dan tidak pernah menyentuh
 * Cache API. Termasuk:
 *   - router.project-osrm.org     -> rute. Rute basi = user tersesat.
 *   - *.tile.openstreetmap.org    -> tile peta. Tile kedaluwarsa = peta salah.
 *                                    Perhatikan subdomainnya: a/b/c.tile...
 *   - nominatim.openstreetmap.org -> pencarian tempat.
 *   - unpkg.com                   -> Leaflet.
 *   - fonts.googleapis.com        -> font.
 *
 * Hanya shell same-origin yang di-cache: index.html, manifest, ikon.
 *
 * Kenapa deny-by-default, bukan daftar blokir:
 * kalau besok ada host baru yang ditambahkan ke app, dia otomatis
 * network-only. Daftar blokir eksplisit bisa kelewat dan diam-diam
 * meng-cache sesuatu yang tidak boleh di-cache.
 *
 * Navigasi memakai NETWORK-FIRST: coba jaringan dulu, cache jadi cadangan.
 * Ini penting supaya update yang baru di-deploy sampai ke user, dan bukan
 * halaman basi yang terus muncul dari cache.
 */

const VERSION = 'v1';
const SHELL_CACHE = `esp32nav-shell-${VERSION}`;

// Hanya file shell. Sengaja TIDAK memakai URL absolut supaya path tetap
// bekerja kalau app nanti di-host di sub-path.
const SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    // addAll gagal seluruhnya kalau satu file hilang. App ini tidak punya
    // asset eksternal wajib selain Leaflet (dimuat saat runtime), jadi aman.
    await cache.addAll(SHELL_ASSETS);
    // Tanpa ini, service worker baru menunggu semua tab lama ditutup sebelum
    // aktif, dan user tetap dilayani versi lama.
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((k) => k.startsWith('esp32nav-shell-') && k !== SHELL_CACHE)
        .map((k) => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Hanya GET yang bisa di-cache. POST/HEAD dilewati tanpa sentuhan.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // === ATURAN 1: lintas-origin SELALU network-only ===
  // Inilah yang melindungi OSRM, tile, dan Nominatim. Tidak ada satu pun
  // request ke host lain yang bisa masuk cache.
  if (url.origin !== self.location.origin) return;

  // === ATURAN 2: navigasi = network-first, cache sebagai cadangan ===
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(request);
        const cache = await caches.open(SHELL_CACHE);
        cache.put('./index.html', fresh.clone());
        return fresh;
      } catch {
        const cached = await caches.match('./index.html');
        return cached || new Response(
          '<!doctype html><meta charset="utf-8">' +
          '<body style="font-family:sans-serif;padding:2rem;background:#0f1117;color:#e8eaf0">' +
          '<h1>Offline</h1>' +
          '<p>Aplikasi ini butuh internet untuk menghitung rute dan memuat peta.</p>',
          { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
        );
      }
    })());
    return;
  }

  // === ATURAN 3: shell static = cache-first ===
  // Ikon dan manifest tidak berubah dalam satu versi, jadi aman dilayani
  // dari cache tanpa perlu network round-trip.
  event.respondWith((async () => {
    const cached = await caches.match(request);
    if (cached) return cached;

    const fresh = await fetch(request);
    if (fresh.ok) {
      const cache = await caches.open(SHELL_CACHE);
      cache.put(request, fresh.clone());
    }
    return fresh;
  })());
});
