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
const VERSION = 'v3';
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
    './src/resolve.js',
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

/**
 * Ambil URL pertama yang terlihat di dalam sepotong teks.
 *
 * Google Maps tidak selalu mengirim link sebagai satu-satunya isi `text`.
 * Yang nyata dishare bisa "Monas\nhttps://maps.app.goo.gl/xyz" atau
 * "Lihat di https://... , mampir besok". Jadi kita cari URL-nya, bukan
 * menganggap seluruh string adalah link.
 *
 * Sengaja tidak dibatasi di sini: string pembatas hanya untuk memotong tanda baca
 * yang jelas bukan bagian URL.
 */
const URL_IN_TEXT = /https?:\/\/[^\s"'<>\u0000-\u001f]+/i;

function extractUrl(text) {
  const m = String(text).match(URL_IN_TEXT);
  return m ? m[0] : '';
}

/**
 * Escape teks untuk disisipkan ke HTML.
 *
 * Isi payload share datang dari aplikasi lain, jadi dianggap tidak
 * dipercaya. Tanpa escape, `"><img src=x onerror=...>` di dalam `text` akan
 * dieksekusi sebagai HTML di origin yang sama dengan aplikasi — stored XSS.
 * Halaman ini dirender di service worker, jadi ini satu-satunya halaman yang
 * dirender di luar app shell.
 */
function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * Halaman diagnosis untuk share yang tidak menghasilkan link.
 *
 * Versi lama membalas 204 tanpa body. Di Android itu muncul sebagai halaman
 * putih kosong: user tidak tahu share-nya gagal, dan kita tidak punya data
 * apa pun untuk menelusurinya. Halaman ini sengaja menampilkan APA YANG
 * BENAR-BENAR DITERIMA, karena itu satu-satunya cara mencari tahu field mana
 * yang sebenarnya dikirim Google Maps.
 *
 * Semua isinya di-escape; lihat catatan di esc().
 */
function diagnosisPage(entries, contentType, note) {
  const rows = entries.length
    ? entries.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')
    : '<tr><td colspan="2"><i>(tidak ada field)</i></td></tr>';

  return `<!doctype html>
<html lang="id"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>Share diterima, link tidak ditemukan</title>
<style>
  body{font:15px/1.5 system-ui,sans-serif;margin:0;padding:1.5rem;background:#111;color:#eee}
  h1{font-size:1.1rem;margin:0 0 .3rem}
  p{margin:0 0 1rem;color:#aaa;max-width:60ch}
  a{color:#8ab4f8}
  code{background:#222;padding:.1rem .3rem;border-radius:3px}
  table{border-collapse:collapse;width:100%;font-size:13px;table-layout:fixed}
  th,td{border:1px solid #333;padding:.4rem .5rem;text-align:left;vertical-align:top;
       word-break:break-all;overflow-wrap:anywhere}
  th{background:#1a1a1a;color:#aaa;font-weight:600;width:8rem}
  pre{background:#1a1a1a;border:1px solid #333;padding:.6rem;border-radius:4px;
      white-space:pre-wrap;word-break:break-all;font-size:12px;max-height:40vh;overflow:auto}
</style></head><body>
<h1>Share diterima, tapi link peta tidak ditemukan</h1>
<p>${esc(note)}</p>
<p>Payload yang benar-benar diterima:</p>
<table><tr><th>Field</th><th>Nilai</th></tr>${rows}</table>
<p style="margin-top:1rem">Content-Type: <code>${esc(contentType || '(kosong)')}</code></p>
<p><a href="./">Buka aplikasi</a></p>
</body></html>`;
}

async function handleShare(request) {
  /** @type {[string, string][]} */
  const entries = [];
  const contentType = request.headers.get('content-type') || '';
  let link = '';
  let note = 'Aplikasi hanya meneruskan share ke server bila link-nya berupa tautan Google Maps.';

  try {
    const fd = await request.formData();
    // Baca SEMUA field, bukan cuma `text`/`url`/`title`. Nama field yang
    // dikirim Google Maps bisa berubah antar versi Android, dan penamaannya
    // satu nama saja adalah alasan share bisa gagal tanpa jejak. Field
    // pertama yang memuat URL yang menang, jadi urutan penamaan tidak penting.
    for (const [key, value] of fd.entries()) {
      if (typeof value !== 'string' || !value) continue;
      entries.push([key, value]);
      if (!link) link = extractUrl(value);
    }
    if (!link) {
      note = 'Tidak ada field yang memuat tautan http/https. Kirim screenshot halaman ini ke Maintainer — isinya persis yang diterima server.';
    }
  } catch {
    // Body tidak bisa dibaca sebagai formData. Coba sebagai teks supaya
    // diagnosis tetap punya isi.
    try {
      const raw = await request.text();
      if (raw) {
        entries.push(['(body)', raw]);
        link = extractUrl(raw);
      }
      note = 'Body tidak terbaca sebagai form data, tapi berhasil dibaca sebagai teks biasa.';
    } catch {
      note = 'Body POST tidak bisa dibaca sama sekali. Biasanya ini berarti service worker aktif tapi formData() ditolak browser.';
    }
  }

  // Ada link → teruskan ke aplikasi lewat fragment, supaya aplikasi yang
  // memutuskan sah atau tidak. Service worker TIDAK memvalidasi host: dia
  // classic worker, tidak bisa meng-import allowlist dari src/parse.js, dan
  // salinan aturan yang lebih longgar di sini justru jadi celah.
  if (link) {
    // Response.redirect butuh URL absolut, makanya dibungkus new URL.
    return Response.redirect(
      new URL('./#u=' + encodeURIComponent(link), self.location.origin).href,
      302
    );
  }

  // Tidak ada link. Versi lama membalas 204 di sini dan user melihat layar
  // putih; sekarang halaman diagnostik supaya masalahnya bisa ditelusuri.
  return new Response(diagnosisPage(entries, contentType, note), {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
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
