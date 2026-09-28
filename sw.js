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

// Naikkan setiap kali isi sw.js berubah. Ini bukan formalitas: nama cache
// deriving dari VERSION, dan manifest.json dilayani cache-first. Kalau
// VERSION tidak naik, HP tetap memakai manifest LAMA dari cache -- termasuk
// manifest yang belum punya share_target -- sehingga aplikasi tidak muncul
// di share sheet milik Google Maps.
const VERSION = 'v2';
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
  // Logika aplikasi sekarang tersebar di modul ES terpisah, bukan inline di
  // index.html. Semua harus ikut dicache: kalau salah satu hilang, addAll
  // tetap berhasil (file-nya ada di server) tapi offline modul itu tidak
  // bisa diambil dan seluruh aplikasi gagal start — bukan cuma satu fitur.
  './src/ble.js',
  './src/dom.js',
  './src/geocode.js',
  './src/main.js',
  './src/map.js',
  './src/nav.js',
  './src/parse.js',
  './src/route.js',
  './src/share.js',
  './src/state.js',
  './src/store.js',
  './src/toast.js',
  './src/ui.js',
  './src/wake.js',
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

// ══════════════════════════════════════════════
//  Share target: terima tujuan dari Google Maps
// ══════════════════════════════════════════════
//
// Saat user tap Share di Google Maps lalu memilih aplikasi ini, Android
// mengirim POST ke action yang dideklarasikan di manifest. Tanpa handler di
// sini, POST itu akan benar-benar mendarat di server dan mengembalikan 405.
//
// Tangkapan ini terjadi di service worker, jadi link tujuan TIDAK PERNAH
// sampai ke server. Balasannya redirect ke fragment #u=, sama seperti
// bookmarklet: link tidak masuk query string dan tidak muncul di access log.
//
// Hanya berlaku kalau service worker sudah aktif, artinya aplikasi sudah
// di-install DAN sudah dibuka minimal sekali setelah install. Kalau belum,
// Android membuka halaman kosong karena tidak ada yang menangani POST-nya.
// Bookmarklet tetap menutupi kasus ini sebagai cadangan.
async function handleShare(request) {
  let link = '';
  try {
    const fd = await request.formData();
    // Google Maps mengirim tautan sebagai EXTRA_TEXT, jadi `text` adalah
    // sumber utama. `url` dan `title` hanya cadangan.
    link = fd.get('text') || fd.get('url') || fd.get('title') || '';
  } catch {
    // Body tidak bisa dibaca. Perlakukan sebagai share yang tidak berguna.
  }

  // Hanya terima tautan yang memang peta. Share dari aplikasi lain bisa
  // berisi teks sembarang, dan aplikasi ini tidak punya tempat menaruhnya.
  if (!/^https?:\/\/([^/]*\.)?(google\.[a-z]{2,6}\/maps|maps\.google\.[a-z]{2,6}|maps\.app\.goo\.gl)/i.test(link.trim())) {
    return new Response('', { status: 204 });
  }

  // Response.redirect butuh URL absolut, makanya dibungkus new URL.
  return Response.redirect(
    new URL('./#u=' + encodeURIComponent(link.trim()), self.location.origin).href,
    302
  );
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // ═══ ATURAN 0: share target ═══
  // Hanya POST ke path share-target. POST lain tetap jatuh ke network.
  if (request.method === 'POST' && url.pathname.endsWith('/share-target')) {
    event.respondWith(handleShare(request));
    return;
  }

  // Hanya GET yang bisa di-cache. POST/HEAD yang tidak tertangkap di atas
  // dilewati tanpa sentuhan, supaya tidak ikut dilayani aturan cache.
  if (request.method !== 'GET') return;

  // ═══ ATURAN 1: lintas-origin SELALU network-only ═══
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
