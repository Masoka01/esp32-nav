// Test untuk api/expand.js — resolver short link Google Maps.
//
// Modul di-import langsung tanpa build, sama seperti src/*.js. Project ini
// sengaja tidak punya package.json maupun node_modules, dan file .ts di api/
// membuat Vercel butuh build step — yang justru menggagalkan deploy.
//
// `fetch` disuntikkan sebagai parameter, jadi tidak ada satu pun test yang
// menyentuh jaringan. Ini yang membuat timeout dan rantai redirect bisa diuji
// secara deterministik, bukan dengan menunggu detik sungguhan.
//
// Yang paling penting diuji adalah penolakan: fungsi ini mengambil URL dari
// request publik, jadi jalur ke jaringan internal harus tertutup. Test SSRF
// di bawah sengaja mencobaMenembus allowlist — bukan sekadar memastikan
// request valid berhasil.
//
// Run:  node test/test_expand.mjs

import { expandShortLink, default as handler } from '../api/expand.js';

let pass = 0, fail = 0;
const section = (s) => console.log(`\n== ${s} ==`);
const check = (cond, what) => {
  if (cond) { pass++; return; }
  fail++;
  console.log(`  FAIL: ${what}`);
};

/**
 * Peta host → Location berikutnya. Dipakai untuk membangun rantai redirect.
 * @param {Record<string, string|undefined>} map
 * @param {{delayMs?: number, throwOn?: string[]}} opts
 */
function fakeFetch(map, opts = {}) {
  const calls = [];
  const impl = async (url) => {
    calls.push(url);
    if (opts.throwOn?.includes(url)) throw new TypeError('fetch failed');
    if (opts.delayMs) {
      await new Promise((r) => {
        const t = setTimeout(r, opts.delayMs);
        if (typeof t === 'object' && t && 'unref' in t) t.unref();
      });
    }
    const loc = map[url];
    if (loc === undefined) {
      return { status: 404, headers: new Map([['location', null]]) };
    }
    const headers = new Map();
    if (loc !== null) headers.set('location', loc);
    return { status: 302, headers };
  };
  impl.calls = calls;
  return impl;
}

/** Deadline yang selalu belum tercapai, supaya test tidak Depends on jam. */
const FUTURE = () => Date.now() + 60_000;

// ── sukses ────────────────────────────────────────────────────────────────
section('Short link langsung → URL peta');
{
  const f = fakeFetch({
    'https://maps.app.goo.gl/abc': 'https://www.google.com/maps/place/Monas/@-6.175,106.827,17z',
  });
  const r = await expandShortLink('https://maps.app.goo.gl/abc', f, FUTURE());
  check(r.ok === true, 'berhasil expand');
  check(r.url === 'https://www.google.com/maps/place/Monas/@-6.175,106.827,17z',
    'URL dikembalikan apa adanya, dapat ' + r.url);
  check(f.calls.length === 1, 'tepat satu request, dapat ' + f.calls.length);
}

section('Rantai beberapa short link');
{
  const f = fakeFetch({
    'https://maps.app.goo.gl/a': 'https://maps.app.goo.gl/b',
    'https://maps.app.goo.gl/b': 'https://goo.gl/maps/c',
    'https://goo.gl/maps/c': 'https://www.google.com/maps?q=-6.2,106.8',
  });
  const r = await expandShortLink('https://maps.app.goo.gl/a', f, FUTURE());
  check(r.ok === true, 'rantai 3 hop berhasil');
  check(r.url === 'https://www.google.com/maps?q=-6.2,106.8', 'mencapai URL peta');
  check(f.calls.length === 3, 'mengikuti 3 hop, dapat ' + f.calls.length);
}

section('Location relatif dan goo.gl');
{
  const f = fakeFetch({ 'https://maps.app.goo.gl/a': '/maps/place/Monas' });
  const r = await expandShortLink('https://maps.app.goo.gl/a', f, FUTURE());
  // Location relatif di-resolve terhadap host SEBELUMNYA, jadi hasilnya masih
  // di host short link — bukan host peta Google. Fungsinya karena itu terus
  // mengikuti rantai, dan berhenti karena host itu tidak pernah mengirim
  // Location lagi. Yang diuji di sini: resolusi relatifnya benar, bukan URL-nya
  // dianggap peta.
  check(r.ok === false, 'Location relatif tidak dianggap URL peta');
  check(f.calls[1] === 'https://maps.app.goo.gl/maps/place/Monas',
    'Location relatif di-resolve terhadap short link, dapat ' + f.calls[1]);

  const g = fakeFetch({ 'https://goo.gl/maps/x': 'https://maps.google.com/maps/place/A' });
  const r2 = await expandShortLink('https://goo.gl/maps/x', g, FUTURE());
  check(r2.ok === true, 'goo.gl/maps yang sah diterima');
}

section('Allowlist host peta');
{
  // Hanya host yang benar-benar ada di GOOGLE_MAPS_CC yang diterima. Form
  // "google" di posisi lain tidak cukup: "google.evil.com" dan "evil.google.co"
  // punya Kata "google" di dalamnya, tapi registrable domain-nya milik orang
  // lain, dan Google pun tidak memiliki "google.co".
  const sah = [
    'https://www.google.com/maps/place/X',
    'https://www.google.co.id/maps/place/X',
    'https://www.google.com.br/maps/place/X',
    'https://maps.google.com/maps/place/X',
    'https://google.com/maps/place/X',
    'https://maps.google.co.uk/maps/place/X',
    'https://www.google.com.au/maps/place/X',
  ];
  for (const target of sah) {
    const f = fakeFetch({ 'https://maps.app.goo.gl/a': target });
    const r = await expandShortLink('https://maps.app.goo.gl/a', f, FUTURE());
    check(r.ok === true && r.url === target, `diterima: ${target} → ${r.reason ?? r.url}`);
  }

  // Fail closed. Setiap host di sini adalah "short link tidak ter-expand",
  // dan itu hasil yang benar: annoying, bukan berbahaya.
  const ditolak = [
    ['https://google.evil.com/maps/place/X',        'kata "google" ada, domain bukan'],
    ['https://evil.google.co/maps/place/X',         'google.co bukan domain Google'],
    ['https://google.com.evil.example/maps/place/X','"google" jauh dari TLD'],
    ['https://maps.google.com.evil.example/maps/place/X', 'sama, dengan subdomain'],
    ['https://a.b.google.com/maps/place/X',         'subdomain di luar allowlist'],
    ['https://www.google.co.zz/maps/place/X',       'negara belum didaftarkan'],
    ['https://www.google.io/notmaps/place/X',       'path bukan /maps'],
    ['https://www.google.com/notmaps/place/X',      'path bukan /maps (host sah)'],
  ];
  for (const [target, why] of ditolak) {
    const f = fakeFetch({ 'https://maps.app.goo.gl/a': target });
    const r = await expandShortLink('https://maps.app.goo.gl/a', f, FUTURE());
    check(r.ok === false, `ditolak: ${target} (${why}) → ${r.reason}`);
    check(f.calls.length === 1, 'tidak mengikuti ke host itu');
  }
}

// ── penolakan ─────────────────────────────────────────────────────────────
section('Input yang bukan short link');
{
  const f = fakeFetch({});
  for (const [input, why] of [
    ['https://www.google.com/maps?q=1,1', 'link peta biasa (sudah punya koordinat)'],
    ['https://evil.example/maps.app.goo.gl', 'host lain yang menyamar'],
    ['https://evil.example/', 'host acak'],
  ]) {
    const r = await expandShortLink(input, f, FUTURE());
    check(r.ok === false && r.reason === 'host-not-allowed',
      `ditolak: ${why} (${r.reason})`);
  }
  check(f.calls.length === 0, 'server tidak menyentuh jaringan sama sekali');
}

section('Penolakan skema');
{
  const f = fakeFetch({});
  const r = await expandShortLink('http://maps.app.goo.gl/abc', f, FUTURE());
  check(r.reason === 'not-https', 'http ditolak sebelum fetch');

  // `new URL('javascript:alert(1)')` justru BERHASIL — itu URL yang sah
  // dengan skema 'javascript:'. Jadi penolakannya datang dari gerbang https,
  // bukan dari parser. Mengasumsikan 'not-a-link' di sini akan menguji asumsi
  // salah tentang URL, bukan perilaku yang benar.
  const r2 = await expandShortLink('javascript:alert(1)', f, FUTURE());
  check(r2.ok === false && r2.reason === 'not-https',
    'javascript: ditolak sebagai bukan-https, dapat ' + r2.reason);

  const r3 = await expandShortLink('data:text/html,<script>', f, FUTURE());
  check(r3.ok === false, 'data: ditolak, dapat ' + r3.reason);

  check(f.calls.length === 0, 'tidak ada request yang lolos');
}

section('goo.gl di luar /maps bukan short link');
{
  const f = fakeFetch({});
  const r = await expandShortLink('https://goo.gl/abcdef', f, FUTURE());
  check(r.ok === false && r.reason === 'host-not-allowed',
    'goo.gl tanpa /maps ditolak, dapat ' + r.reason);
  check(f.calls.length === 0, 'tidak ada request');
}

section('Input rusak');
{
  const f = fakeFetch({});
  for (const input of ['', '   ', 'bukan-url', 'https://', null, undefined]) {
    const r = await expandShortLink(input, f, FUTURE());
    check(r.ok === false, `ditolak: ${JSON.stringify(input)} → ${r.reason}`);
  }
  check(f.calls.length === 0, 'tidak ada request');
}

// ── SSRF ──────────────────────────────────────────────────────────────────
section('SSRF: redirect ke jaringan internal');
{
  // Ini inti dari allowlist. Kalau redirect dibiarkan `follow`, Node akan
  // mengambil sendiri URL di bawah ini dan allowlist kita jadi tidak berarti.
  for (const target of [
    'http://169.254.169.254/latest/meta-data/',
    'http://127.0.0.1:8080/admin',
    'http://10.0.0.1/',
    'http://[::1]/',
    'https://attacker.example/steal',
  ]) {
    const f = fakeFetch({ 'https://maps.app.goo.gl/a': target });
    const r = await expandShortLink('https://maps.app.goo.gl/a', f, FUTURE());
    check(r.ok === false, `ditolak: ${target} → ${r.reason}`);
    // Kunci: hanya short link yang pernah diambil, target redirect tidak.
    check(f.calls.length === 1, `hanya 1 request (short link), dapat ${f.calls.length}`);
    check(f.calls[0] === 'https://maps.app.goo.gl/a', 'request pertama ke short link');
  }
}

section('SSRF: host yang menyamar sebagai Google');
{
  for (const target of [
    'https://google.com.evil.example/maps/place/X',
    'https://notgoogle.com/maps/place/X',
    'https://maps.google.com.evil.example/maps/place/X',
  ]) {
    const f = fakeFetch({ 'https://maps.app.goo.gl/a': target });
    const r = await expandShortLink('https://maps.app.goo.gl/a', f, FUTURE());
    check(r.ok === false, `ditolak: ${target} → ${r.reason}`);
    check(f.calls.length === 1, 'tidak mengikuti ke host itu');
  }
}

// ── batas ─────────────────────────────────────────────────────────────────
section('Batas hop');
{
  // Selalu berbalik ke short link lagi: tidak akan pernah mencapai URL peta.
  const loop = {};
  for (let i = 0; i < 10; i++) loop['https://maps.app.goo.gl/h' + i] = 'https://maps.app.goo.gl/h' + (i + 1);
  const f = fakeFetch(loop);
  const r = await expandShortLink('https://maps.app.goo.gl/h0', f, FUTURE());
  check(r.ok === false, 'rantai tak berujung ditolak');
  check(r.reason === 'too-many-hops', 'alasan: terlalu banyak hop, dapat ' + r.reason);
  check(f.calls.length === 5, 'tepat 5 hop dicoba, dapat ' + f.calls.length);
}

section('Batas waktu');
{
  // Deadline sudah lewat: ditolak tanpa satu pun request.
  const f = fakeFetch({ 'https://maps.app.goo.gl/a': 'https://www.google.com/maps/place/X' });
  const r = await expandShortLink('https://maps.app.goo.gl/a', f, Date.now() - 1);
  check(r.ok === false && r.reason === 'timeout', 'ditolak karena timeout, dapat ' + r.reason);
  check(f.calls.length === 0, 'tidak ada request setelah deadline lewat');
}

section('Fetch melempar');
{
  const f = fakeFetch({}, { throwOn: ['https://maps.app.goo.gl/a'] });
  const r = await expandShortLink('https://maps.app.goo.gl/a', f, FUTURE());
  check(r.ok === false && r.reason === 'fetch-failed', 'ditolak, dapat ' + r.reason);
}

section('Tidak ada redirect sama sekali');
{
  const f = fakeFetch({ 'https://maps.app.goo.gl/a': null });
  const r = await expandShortLink('https://maps.app.goo.gl/a', f, FUTURE());
  check(r.ok === false && r.reason === 'no-redirect', 'ditolak, dapat ' + r.reason);
}

section('Status 404 tanpa Location');
{
  const f = fakeFetch({});   // 404 + Location null
  const r = await expandShortLink('https://maps.app.goo.gl/a', f, FUTURE());
  check(r.ok === false && r.reason === 'no-redirect', 'ditolak, dapat ' + r.reason);
}

// ── handler ───────────────────────────────────────────────────────────────
section('Handler Vercel');
{
  /** Tangkap apa yang ditulis handler ke res. */
  function stubRes() {
    const out = { statusCode: 200, headers: {}, body: null };
    return {
      out,
      setHeader(k, v) { out.headers[k] = v; },
      status(c) { out.statusCode = c; return this; },
      json(b) { out.body = b; return this; },
    };
  }

  let res = stubRes();
  await handler({ method: 'GET', query: {} }, res);
  check(res.out.statusCode === 400 && res.out.body.reason === 'missing-url',
    'tanpa ?url → 400 missing-url');

  res = stubRes();
  await handler({ method: 'POST', query: {} }, res);
  check(res.out.statusCode === 405, 'POST ditolak 405');
  check(res.out.headers.Allow === 'GET', 'header Allow diisi');

  res = stubRes();
  await handler({ method: 'GET', query: { url: 'https://evil.example/' } }, res);
  check(res.out.statusCode === 422, 'URL ditolak → 422');
  check(res.out.body.ok === false, 'body ok=false');
  check(res.out.headers['Cache-Control'] === 'no-store',
    'kegagalan tidak di-cache, dapat ' + res.out.headers['Cache-Control']);

  res = stubRes();
  // Array: Vercel memberi array kalau ?url diulang.
  await handler({ method: 'GET', query: { url: ['https://evil.example/', 'https://x.example/'] } }, res);
  check(res.out.statusCode === 422, 'query berulang: elemen pertama yang dipakai');

  res = stubRes();
  await handler({ method: 'GET', query: {} }, res);
  check(res.out.statusCode === 400, 'query kosong tetap 400');
}

section('Sinkronisasi allowlist server ↔ client');
{
  // Dua salinan allowlist ini hidup di dua runtime berbeda (server TypeScript
  // vs browser ES module), jadi tidak bisa di-share. Yang bisa dilakukan
  // adalah memastikan keduanya memutuskan hal yang sama untuk setiap host.
  //
  // Kalau tidak sinkron, akibatnya user melihat "gagal dibuka" untuk link yang
  // expand-nya justru berhasil. Test ini menangkapnya di CI, bukan di lapangan.
  const client = await import('../src/parse.js');
  const server = await import('../api/expand.js');

  const a = [...client.MAPS_HOSTS].sort();
  const b = [...server.MAPS_HOSTS].sort();
  check(a.length === b.length && a.join(',') === b.join(','),
    `isi allowlist sama (${a.length} host)`);
  check(a.length === 117, 'tidak ada entri dobel di daftar cc, dapat ' + a.length + ' host');

  // Corpus yang isinya sengaja bercampur: host sah, host curiga, dan host
  // yang hanya beda posisi kata "google". Dua sisi harus jatuh pada verdict sama
  // persis, bukan cuma sama-sama menerima allowlist.
  const corpus = [
    'www.google.com', 'google.com', 'maps.google.com', 'a.b.google.com',
    'www.google.co.id', 'maps.google.co.uk', 'www.google.com.br',
    'google.evil.com', 'evil.google.co', 'evil.google.com',
    'google.com.evil.example', 'maps.google.com.evil.example',
    'notgoogle.com', 'google.co', 'goo.gl', 'maps.app.goo.gl',
    'www.google.co.zz', 'www.google.io', 'googleusercontent.com',
  ];
  let beda = 0;
  for (const host of corpus) {
    const u = new URL('https://' + host + '/maps/place/-6.1,106.1');
    const c = client.isGoogleMapsHost(u);
    const s = server.isMapsHost(u);
    if (c !== s) {
      beda++;
      console.log(`  FAIL:beda verdict — ${host}: client=${c} server=${s}`);
    }
  }
  check(beda === 0, 'kedua sisi jatuh verdict pada ' + corpus.length + ' host');

  // Cross-check nyata: setiap host yang server terima, client juga harus terima
  // lewat parseMapsLink, dan sebaliknya. Ini yang mencegah link hasil expand
  // ditolak parser.
  for (const host of a) {
    const c = client.parseMapsLink(`https://${host}/maps/place/-6.1,106.1?ll=-6.1,106.1`);
    if (!c.ok) { console.log(`  FAIL: client menolak allowlist sendiri: ${host} (${c.reason})`); fail++; }
    else pass++;
  }
}

console.log('\n─────────────────────────────');
console.log(`PASS: ${pass}   FAIL: ${fail}`);
process.exit(fail === 0 ? 0 : 1);
