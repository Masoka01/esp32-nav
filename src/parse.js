// @ts-check
//
//  PARSE LINK GOOGLE MAPS
//
// Mengubah teks yang diberikan share sheet atau kolom pencarian menjadi
// koordinat + nama tempat. Modul ini SENGAJA bebas DOM: tidak menyentuh
// document, window, location, atau navigator. Itu yang membuatnya bisa
// diuji di Node tanpa browser, dan kenapa test tidak perlu mengiris
// kode dari file HTML lagi.

// ══════════════════════════════════════════════
//  PARSE LINK GOOGLE MAPS
// ══════════════════════════════════════════════
//
// Format URL Google Maps tidak terdokumentasi resmi dan sudah beberapa kali
// berubah bentuk, jadi ini parser best-effort berlapis fallback.
//
// ⚠️ ATURAN YANG SUDAH DIBUKTIKAN DENGAN DATA ASLI:
// Pasangan !3d/!4d boleh ber-prefix !8m2, dan itu JUSTRU encoding standar
// untuk pin tempat. Link milik user (WH-2 ARCHER) hanya punya satu pair dan
// ber-prefix !8m2. Kalau prefix !8m2 dilewati, link itu jadi nol hasil lalu
// jatuh ke '@' yang berbeda ~284 meter. Jadi: ambil pair PERTAMA, tanpa
// pengecualian berdasarkan prefix.
const MAPS_NUM = '-?\\d+(?:\\.\\d+)?';

// Domain ccTLD tempat Google Maps operate. Ingin menambah negara? Tambahkan
// satu entri di sini — jangan longgarkan pencocokan di isGoogleMapsHost(),
// karena konsekuensinya host milik orang lain ikut diterima.
//
// Daftar ini harus identik dengan GOOGLE_MAPS_CC di api/expand.js; lihat
// catatan sinkronisasi di parseMapsLink().
const GOOGLE_MAPS_CC = [
  'com', 'co.id', 'co.uk', 'com.br', 'co.jp', 'com.au', 'co.in', 'com.mx',
  'com.ar', 'com.sg', 'com.my', 'com.tw', 'com.ph', 'com.vn', 'com.tr',
  'com.ua', 'de', 'fr', 'es', 'it', 'nl', 'se', 'no', 'fi', 'dk',
  'pl', 'co.th', 'co.kr', 'co.il', 'ae', 'co.za', 'cz', 'at', 'ch', 'be',
  'pt', 'gr', 'ro', 'hu',
];

export const MAPS_HOSTS = new Set();
for (const cc of GOOGLE_MAPS_CC)
  for (const sub of ['', 'www.', 'maps.']) MAPS_HOSTS.add(`${sub}google.${cc}`);

export function isGoogleMapsHost(u) {
  return MAPS_HOSTS.has(u.hostname.toLowerCase());
}

export function validLatLng(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng)
      && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

export function parseMapsLink(text) {
  const raw = String(text || '').trim();
  if (!raw) return { ok: false, reason: 'not-a-link' };

  // Short link tidak bisa di-expand dari browser: CORS melarang membaca
  // target redirect. Harus dibuka sekali di Chrome lalu disalin dari address bar.
  if (/^https?:\/\/(maps\.app\.goo\.gl|goo\.gl\/maps)(\/|$)/i.test(raw))
    return { ok: false, reason: 'short-link' };

  let u;
  try { u = new URL(raw); } catch { return { ok: false, reason: 'not-a-link' }; }

  // Host harus benar-benar milik Google — dicek dari allowlist PERSIS, bukan
  // dari pola hostname.
  //
  // Pola seperti endsWith('.google.com') atau "hostname mengandung 'google'"
  // kelihatan aman tapi menerima domain milik orang lain: `google.evil.com`
  // lolos padahal registrable domain-nya `evil.com`, dan `evil.google.co`
  // juga lolos padahal `google.co` bukan domain Google (Google memakai
  // `google.com.co`). Confirmasi kepemilikan nama domain butuh data registrar
  // yang tidak kita punya, jadi daftar eksplisit adalah satu-satunya opsi
  // yang benar. Menambah negara = menambah satu entri di GOOGLE_MAPS_CC.
  //
  // Konsekuensinya disengaja: host di luar daftar ditolak. Itu berarti link
  // peta dari negara yang belum terdaftar tidak terbaca — annoying, bukan
  // berbahaya, dan bookmarklet masih ada.
  //
  // Aturan ini WAJIB identik dengan isMapsHost() di api/expand.js. Keduanya
  // sengaja diduplikasi, bukan di-share: yang ini jalan di browser sebagai ES
  // module, yang di sana di server sebagai TypeScript tanpa bundler. Kalau
  // salah sinkron, URL hasil expand akan ditolak parser dan user melihat
  // "gagal dibuka" padahal expand-nya sukses.
  if (!isGoogleMapsHost(u) || !u.pathname.startsWith('/maps'))
    return { ok: false, reason: 'not-a-link' };

  const safeDec = t => { try { return decodeURIComponent(t); } catch { return t; } };
  const dec     = t => { try { return decodeURIComponent(t.replace(/\+/g, ' ')); } catch { return t.replace(/\+/g, ' '); } };
  const s = safeDec(raw);

  const coordPair = str => {
    const m = String(str).trim().match(new RegExp(`^(${MAPS_NUM})\\s*,\\s*(${MAPS_NUM})$`));
    if (!m) return null;
    const lat = parseFloat(m[1]), lng = parseFloat(m[2]);
    return validLatLng(lat, lng) ? { lat, lng } : null;
  };

  // ── Nama ──────────────────────────────────────────────────────────────
  // Penting: link WH-2 ARCHER tidak punya !2s sama sekali — namanya hanya
  // ada di path /place/. Jadi sumber nama dari path itu wajib, bukan pelengkap.
  const m2s    = s.match(/!2s([^!]+)/);
  const mPlace = s.match(/\/place\/([^/@?]+)/);
  // Tujuan pada /dir/ adalah segmen TERAKHIR, bukan yang pertama.
  const dirSegs = (u.pathname.split('/dir/')[1] || '').split('/')
    .filter(x => x && !x.startsWith('@') && !x.includes('=')).map(dec);
  const dirDest  = dirSegs.length ? dirSegs[dirSegs.length - 1] : '';
  const dirCoord = coordPair(dirDest);
  // 'query' adalah nama parameter pada format resmi Maps URLs API
  // (?api=1&query=...), jadi harus ikut dibaca di samping q/ll/daddr.
  const qVal   = (u.searchParams.get('query') || u.searchParams.get('q')
               || u.searchParams.get('ll') || u.searchParams.get('daddr') || '').trim();
  const qCoord = coordPair(qVal);
  // Tujuan /dir/ berupa nama, bukan koordinat. Penting untuk keputusan di bawah.
  const isDirNamed = !!(dirDest && !dirCoord);

  const fallbackName = 'Tujuan dari Google Maps';
  const name = (m2s && dec(m2s[1]))
    || (mPlace && dec(mPlace[1]))
    || (dirDest && !dirCoord ? dirDest : '')
    || (qVal && !qCoord ? qVal : '')
    || fallbackName;

  // ── Koordinat, dari paling akurat ke paling kasar ─────────────────────
  const pairs = [...s.matchAll(new RegExp(`!3d(${MAPS_NUM})!4d(${MAPS_NUM})`, 'g'))];
  let lat, lng, exact = false;

  if (pairs.length) {
    lat = parseFloat(pairs[0][1]);
    lng = parseFloat(pairs[0][2]);
    // Lebih dari satu pair = ambigu (mis. pencarian lintas area), bukan satu
    // pin. Tetap pakai yang pertama, tapi jangan diklaim 'persis'.
    exact = pairs.length === 1;
  } else {
    // Koordinat eksplisit lebih akurat daripada '@', jadi dicek lebih dulu.
    if (dirCoord) { lat = dirCoord.lat; lng = dirCoord.lng; exact = true; }
    else if (qCoord) { lat = qCoord.lat;  lng = qCoord.lng;  exact = true; }
    else {
      // '@lat,lng' adalah pusat viewport, bukan pin. Regex berhenti sebelum
      // zoom supaya '@lat,lng,17z' tidak ikut memakan angka zoom.
      //
      // TAPI jangan pakai '@' kalau tujuan /dir/ berupa NAMA: pada URL
      // directions, viewport berada di TENGAH rute, bukan di tujuan. Memakainya
      // akan merute ke tengah perjalanan — lebih buruk daripada gagal.
      const at = isDirNamed
        ? null
        : s.match(new RegExp(`@(${MAPS_NUM}),(${MAPS_NUM})(?:,|$)`));
      if (at) { lat = parseFloat(at[1]); lng = parseFloat(at[2]); exact = false; }
      else return (name !== fallbackName)
        ? { ok: false, reason: 'needs-geocode', name }
        : { ok: false, reason: 'no-coords' };
    }
  }

  if (!validLatLng(lat, lng)) return { ok: false, reason: 'no-coords' };
  return { ok: true, lat, lng, name, exact };
}

