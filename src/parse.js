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

  // eTLD+1 harus benar-benar milik Google. Dicek per-label, bukan pola
  // string, supaya 'google.com.evil.example' dan 'notgoogle.com' ditolak.
  const labels = u.hostname.toLowerCase().split('.');
  const isGoogle = labels.slice(-2).includes('google') || labels.slice(-3).includes('google');
  if (!isGoogle || !u.pathname.includes('/maps'))
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

