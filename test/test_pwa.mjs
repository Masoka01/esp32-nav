// Test PWA: manifest, ikon, dan - yang paling penting - MENJAMIN service
// worker tidak pernah meng-cache rute OSRM atau tile peta.
//
// Test terakhir ini bukan formalitas. Kalau SW diam-diam meng-cache
// router.project-osrm.org, user yang sedang di jalan dapat rute versi lama
// dan diarahkan ke jalan yang salah. Kegagalan itu tidak muncul di review
// kode, jadi harus dijaga oleh test.

import { readFileSync, existsSync, statSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0;
const failures = [];

function check(cond, label) {
  if (cond) pass++;
  else failures.push(label);
}

// ══════════════════════════════════════════════
//  1. Manifest memenuhi syarat install Chrome
// ══════════════════════════════════════════════

const manifest = JSON.parse(read('manifest.json'));

check(typeof manifest.name === 'string' && manifest.name.length > 0,
  'manifest: name ada');
check(typeof manifest.short_name === 'string' && manifest.short_name.length > 0,
  'manifest: short_name ada');
check(typeof manifest.start_url === 'string' && manifest.start_url.length > 0,
  'manifest: start_url ada');
check(manifest.display === 'standalone',
  'manifest: display harus standalone (inilah yang hilang address bar)');
check(manifest.theme_color === '#0f1117',
  'manifest: theme_color harus sama dengan --bg di index.html');
check(manifest.background_color === '#0f1117',
  'manifest: background_color harus sama dengan --bg');

// Chrome menolak install kalau prefer_related_applications bernilai true.
check(manifest.prefer_related_applications !== true,
  'manifest: prefer_related_applications tidak boleh true');

const icons = manifest.icons || [];
const sizes = icons.map((i) => i.sizes);
check(sizes.includes('192x192'), 'manifest: ada ikon 192x192');
check(sizes.includes('512x512'), 'manifest: ada ikon 512x512');
check(icons.some((i) => i.purpose === 'maskable'),
  'manifest: ada ikon maskable (Android memotong jadi squircles)');

// Path relatif: Vercel memberi subdomain acak, hardcode domain akan rusak.
check(manifest.start_url.startsWith('./') || manifest.start_url === '/',
  'manifest: start_url relatif atau root, jangan hardcode domain');
check(icons.every((i) => i.src.startsWith('./') || i.src.startsWith('/')),
  'manifest: semua src ikon relatif, jangan hardcode domain');

// ══════════════════════════════════════════════
//  2. Ikon benar-benar ada dan berukuran tepat
// ══════════════════════════════════════════════

// Dimensi dibaca langsung dari header PNG supaya test tidak bergantung pada
// ImageMagick yang mungkin tidak ada di mesin lain.
function pngSize(rel) {
  const buf = readFileSync(path.join(ROOT, rel));
  if (buf.length < 24) return null;
  // 8-15 byte: signature + "IHDR"; 16-23: width & height big-endian.
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

for (const icon of icons) {
  const rel = icon.src.replace(/^\.\//, '');
  check(existsSync(path.join(ROOT, rel)), `ikon ada di disk: ${rel}`);

  const want = parseInt(icon.sizes, 10);
  const got = pngSize(rel);
  check(got && got.w === want && got.h === want,
    `ikon ${rel} benar-benar ${want}x${want} (dibaca: ${got ? got.w + 'x' + got.h : 'tidak bisa dibaca'})`);
}

// ══════════════════════════════════════════════
//  3. Service worker tidak pernah menyentuh host-berbahaya
// ══════════════════════════════════════════════

// Host yang WAJIB tetap network-only. Tile memakai subdomain a/b/c, jadi
// polanya harus cocok dengan suffix, bukan host persis.
const HARAM = [
  'https://router.project-osrm.org/route/v1/driving/106.8,-6.2;106.81,-6.21?steps=true',
  'https://a.tile.openstreetmap.org/13/6564/4062.png',
  'https://b.tile.openstreetmap.org/13/6564/4062.png',
  'https://c.tile.openstreetmap.org/13/6564/4062.png',
  'https://nominatim.openstreetmap.org/search?q=monas&format=json',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://fonts.googleapis.com/css2?family=DM+Sans&display=swap',
];

const ORIGIN = 'https://esp32-nav.vercel.app';

// Harness: muat sw.js sungguhan di dalam vm dengan stub, lalu memicu satu
// event fetch dan lihat apakah dia menyentuh cache.
function loadSw() {
  const src = read('sw.js');
  const handlers = {};
  const cacheWrites = [];
  const netCalls = [];

  const cacheApi = {
    async open(name) {
      return {
        async addAll(urls) {
          for (const u of urls) cacheWrites.push({ op: 'addAll', url: u });
        },
        async put(req) {
          const u = typeof req === 'string' ? req : (req && req.url);
          cacheWrites.push({ op: 'put', url: u });
        },
      };
    },
    async match() { return undefined; },
    async keys() { return []; },
    async delete() { return true; },
  };

  const self = {
    location: { origin: ORIGIN },
    addEventListener(type, fn) { handlers[type] = fn; },
    skipWaiting: async () => {},
    clients: { claim: async () => {} },
  };

  const ctx = {
    self,
    caches: cacheApi,
    URL,
    // sw.js memakai Response.redirect() untuk membalas share target, jadi
    // stub-nya wajib punya static method itu juga.
    Response: class {
      constructor(b, o) { this.body = b; this.o = o; this.status = (o && o.status) || 200; }
      static redirect(url, status = 302) { return { redirected: true, url, status }; }
    },
    console,
    fetch: async (req) => {
      netCalls.push(typeof req === 'string' ? req : req.url);
      return { ok: true, clone() { return this; } };
    },
  };
  ctx.globalThis = ctx;

  vm.createContext(ctx);
  vm.runInContext(src, ctx, { filename: 'sw.js' });

  return { handlers, cacheWrites, netCalls };
}

const sw = loadSw();
check(typeof sw.handlers.fetch === 'function',
  'sw.js mendaftarkan handler fetch');
check(typeof sw.handlers.install === 'function',
  'sw.js mendaftarkan handler install');
check(typeof sw.handlers.activate === 'function',
  'sw.js mendaftarkan handler activate');

async function fireFetch(url, { mode = 'cors', method = 'GET', body = null } = {}) {
  const beforeWrites = sw.cacheWrites.length;
  const beforeNet = sw.netCalls.length;
  let responded = false;
  let respondPromise = null;
  let resolved = null;
  // Share target dibaca lewat request.formData(). Map sudah punya .get(),
  // jadi bentuknya cukup sama dengan FormData untuk keperluan test.
  const form = new Map(Object.entries(body || {}));
  const event = {
    request: {
      url, mode, method,
      formData: async () => form,
    },
    respondWith(p) { responded = true; respondPromise = p; },
    waitUntil(p) { Promise.resolve(p).catch(() => {}); },
  };
  sw.handlers.fetch(event);

  // Penting: operasi cache di dalam respondWith baru terjadi SETELAH
  // `await fetch(...)`, yaitu di tick berikutnya. Kalau tidak ditunggu di
  // sini, assertion berjalan duluan dan selalu melaporkan "tidak ada
  // penulisan cache" padahal cache.put-nya memang dipanggil.
  if (respondPromise) {
    try { resolved = await respondPromise; } catch { /* fallback offline, tidak relevan */ }
  }

  return {
    responded,
    resolved,
    wroteSomething: sw.cacheWrites.length > beforeWrites,
    hitNetwork: sw.netCalls.length > beforeNet,
    writes: sw.cacheWrites.slice(beforeWrites),
  };
}

// --- 3a. host terlarang: tidak boleh ada respons dari SW, tidak boleh cache
for (const url of HARAM) {
  const host = new URL(url).host;
  const r = await fireFetch(url);
  check(!r.responded,
    `${host}: SW tidak boleh menangani request ini, harus diteruskan ke network`);
  check(!r.wroteSomething,
    `${host}: TIDAK BOLEH ada penulisan cache`);
}

// --- 3b. navigasi same-origin: network-first
{
  const r = await fireFetch(`${ORIGIN}/`, { mode: 'navigate' });
  check(r.responded, 'navigasi: SW menangani dan memberi fallback');
  check(r.hitNetwork, 'navigasi: mencoba jaringan DULU (network-first)');
  const navWrite = r.writes.find((w) => String(w.url).includes('index.html'));
  check(!!navWrite, 'navigasi: menyegarkan cache index.html setelah sukses');
}

// --- 3c. shell same-origin: boleh di-cache
for (const rel of ['manifest.json', 'icons/icon-192.png', 'icons/icon-512.png']) {
  const r = await fireFetch(`${ORIGIN}/${rel}`);
  check(r.responded, `shell ${rel}: ditangani SW (cache-first)`);
  check(r.wroteSomething, `shell ${rel}: masuk cache saat belum ada`);
}

// --- 3d. metode non-GET dilewati
{
  const r = await fireFetch(`${ORIGIN}/api`, { method: 'POST' });
  check(!r.responded, 'POST: dilewati, tidak boleh di-cache');
  check(!r.wroteSomething, 'POST: tidak menulis cache');
}

// --- 3e. share target: POST dari Android
// Android mengirim POST ke action dari manifest saat user memilih aplikasi ini
// di share sheet. SW harus menangkapnya dan mengarahkan ke fragment, supaya
// link tujuan tidak pernah sampai ke server.
const SHARE_PATH = '/share-target';

{
  const link = 'https://www.google.com/maps/place/Monas/@-6.1753,106.8248,17z';
  const r = await fireFetch(`${ORIGIN}${SHARE_PATH}`, {
    method: 'POST', mode: 'navigate',
    body: { text: link, title: 'Monas' },
  });

  check(r.responded, 'share: SW menangani POST share target');
  check(r.resolved && r.resolved.redirected === true,
    'share: membalas dengan redirect, bukan halaman');

  const loc = (r.resolved && r.resolved.url) || '';
  check(loc.includes('#u='), 'share: redirect menuju fragment #u=');
  check(!loc.includes('?u='),
    'share: link tujuan TIDAK boleh di query string (bocor ke access log)');
  check(decodeURIComponent(loc.split('#u=')[1] || '') === link,
    'share: link tujuan utuh setelah di-decode');
  check(!r.wroteSomething, 'share: tidak menulis cache');
  check(!r.hitNetwork, 'share: link TIDAK boleh requesting server');
}

// --- 3f. share target: memprioritaskan `text` (Maps kirim link di EXTRA_TEXT)
{
  const link = 'https://maps.app.goo.gl/abc123';
  const r = await fireFetch(`${ORIGIN}${SHARE_PATH}`, {
    method: 'POST', mode: 'navigate',
    body: { text: link, url: 'https://example.com/harus-diabaikan' },
  });
  const got = decodeURIComponent(((r.resolved && r.resolved.url) || '').split('#u=')[1] || '');
  check(got === link, 'share: `text` menang atas `url`');
}

// --- 3g. share target: short link juga diterima
{
  const link = 'https://maps.app.goo.gl/xyz789';
  const r = await fireFetch(`${ORIGIN}${SHARE_PATH}`, {
    method: 'POST', mode: 'navigate', body: { text: link },
  });
  check((r.resolved && r.resolved.redirected) === true,
    'share: short link maps.app.goo.gl ikut diterima');
}

// --- 3h. share target: teks yang bukan peta ditolak
for (const junk of ['halo apa kabar', 'https://example.com/bukan-peta',
                    'https://google.com.evil.example/maps/x']) {
  const r = await fireFetch(`${ORIGIN}${SHARE_PATH}`, {
    method: 'POST', mode: 'navigate', body: { text: junk },
  });
  check(r.responded, `share: SW tetap menangani share "${junk.slice(0, 20)}"`);
  check(r.resolved && r.resolved.redirected !== true,
    `share: "${junk.slice(0, 20)}" tidak dialihkan ke app navigasi`);
}

// --- 3i. share target: body tidak terbaca harus aman
{
  const r = await fireFetch(`${ORIGIN}${SHARE_PATH}`, { method: 'POST', mode: 'navigate' });
  check(r.responded, 'share: body kosong tetap ditangani tanpa melempar error');
  check(r.resolved && r.resolved.redirected !== true,
    'share: body kosong tidak dialihkan');
}

// --- 3j. POST di luar share-target tidak ikut tertangkap
{
  const r = await fireFetch(`${ORIGIN}/index.html`, { method: 'POST' });
  check(!r.responded,
    'share: handler hanya berlaku untuk path share-target, bukan semua POST');
}

// ══════════════════════════════════════════════
//  4. index.html benar-benar merujuk PWA
// ══════════════════════════════════════════════

const html = read('index.html');
check(/<link[^>]+rel=["']manifest["'][^>]*>/i.test(html),
  'index.html: ada tag link rel=manifest');
check(/<meta[^>]+name=["']theme-color["'][^>]*>/i.test(html),
  'index.html: ada meta theme-color');
// Registrasi service worker pindah ke src/main.js saat inline script dipecah
// jadi modul. Yang diuji tetap sama persis (aplikasi mendaftarkan SW-nya),
// hanya sekarang yang dicari lewat entry module, bukan seluruh isi index.html.
const swEntry = (html.match(/<script[^>]*type="module"[^>]*src="([^"]+)"/) || [])[1];
check(!!swEntry && /navigator\.serviceWorker\.register/.test(read(swEntry.replace(/^\.\//, ''))),
  'entry module mendaftarkan service worker (dulu di index.html)');
check(/href=["']\.\/manifest\.json["']/.test(html),
  'index.html: manifest pakai path relatif');

// ══════════════════════════════════════════════
//  5. Cache busting: share target tidak boleh gagal diam-diam
// ══════════════════════════════════════════════
//
// Bug nyata yang sudah pernah terjadi: sw.js ditambah handler share
// target, tapi VERSION tidak dinaikkan. manifest.json dilayani
// cache-first, jadi HP tetap memakai manifest LAMA dari cache --
// termasuk yang belum punya share_target -- dan aplikasi tidak pernah
// muncul di share sheet. Tidak ada error, tidak ada logging, cuma
// "kok ESP-Nav tidak ada?". Test ini menjaga supaya tidak terulang.

const swSrc = read('sw.js');
const mf    = JSON.parse(read('manifest.json'));
const ver   = (swSrc.match(/const VERSION\s*=\s*'([^']*)'/) || [])[1];

check(!!ver, 'sw.js: VERSION terdefinisi');
check(/esp32nav-shell-\$\{VERSION\}/.test(swSrc),
  'sw.js: nama cache diturunkan dari VERSION');
check(/['"]\.\/manifest\.json['"]/.test(swSrc),
  'sw.js: manifest.json ada di SHELL_ASSETS, jadi bisa di-refresh via VERSION');
check(!!mf.share_target,
  'manifest.json: share_target terdaftar (ini yang bikin app muncul di share sheet)');
check(mf.share_target && mf.share_target.method === 'POST',
  'manifest.json: share_target memakai POST, bukan GET');

// ══════════════════════════════════════════════
//  Offline: modul ES harus ikut ter-cache
// ══════════════════════════════════════════════
//
// Memecah inline script jadi modul ES menciptakan mode gagal baru: modul
// yang tidak ada di SHELL_ASSETS tetap ter-cache saat online, karena aturan 3
// (cache-first) menyimpan apa pun yang diminta. Jadi bug-nya baru muncul saat
// perangkat benar-benar offline — lalu seluruh aplikasi gagal start karena
// satu modul tidak ditemukan di cache.
//
// Daftar di bawah sengaja TIDAK di-hardcode. Ia ditelusuri dari entry module
// di index.html lalu mengikuti seluruh import transitif. Kalau nanti ada modul
// baru yang lupa didaftarkan, test inilah yang menangkapnya.
{
  const shellBlock = (swSrc.match(/SHELL_ASSETS\s*=\s*\[([\s\S]*?)\]/) || [])[1] || '';
  const inShell = new Set(
    (shellBlock.match(/['"]([^'"]+)['"]/g) || []).map(q => q.slice(1, -1))
  );

  // Specifier import bersifat relatif terhadap BERKAS pengimpor, bukan root:
  // './ble.js' di dalam src/main.js berarti src/ble.js.
  const dirname = f => f.split('/').slice(0, -1).join('/');
  const resolve = (from, spec) => {
    const parts = (dirname(from) + '/' + spec).split('/');
    const out = [];
    for (const part of parts) {
      if (part === '' || part === '.') continue;
      if (part === '..') out.pop();
      else out.push(part);
    }
    return out.join('/');
  };

  const seen = new Set();
  const queue = swEntry ? [swEntry.replace(/^\.\//, '')] : [];
  while (queue.length) {
    const rel = queue.shift();
    if (seen.has(rel)) continue;
    seen.add(rel);
    for (const m of read(rel).matchAll(/from\s+['"]([^'"]+)['"]/g)) {
      if (m[1].startsWith('.')) queue.push(resolve(rel, m[1]));
    }
  }

  check(seen.size >= 14, `graf modul tertelusuri: ${seen.size} berkas`);
  for (const rel of [...seen].sort()) {
    check(inShell.has('./' + rel),
      `sw.js: ${rel} ada di SHELL_ASSETS (kalau tidak, app gagal start saat offline)`);
  }
  check(inShell.has('./index.html') && inShell.has('./manifest.json'),
    'sw.js: index.html dan manifest.json tetap ada di SHELL_ASSETS');
}

// ══════════════════════════════════════════════
//  Hasil
// ══════════════════════════════════════════════

if (failures.length) {
  console.log(`\n${'─'.repeat(64)}`);
  for (const f of failures) console.log(`  ✗ ${f}`);
  console.log(`${'─'.repeat(64)}\n`);
}

console.log(`PWA: ${pass} check lulus, ${failures.length} gagal`);

if (failures.length) process.exit(1);
