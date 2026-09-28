// Resolver short link Google Maps, dipakai share target PWA.
//
// KENAPA BUTUH SERVER
// -------------------
// Share dari aplikasi Google Maps kadang memberi short link `maps.app.goo.gl`
// yang isinya tidak ada koordinat. Untuk mendapat koordinat, link itu harus
// mengikuti HTTP redirect ke URL `google.com/maps/place/...` yang sebenarnya.
//
// Browser tidak bisa melakukannya: fetch() ke domain Google adalah request
// lintas domain, dan CORS melarang JavaScript membaca jawabannya — termasuk
// header `Location` yang justru satu-satunya hal yang kita butuhkan. Mode
// `no-cors` tidak menolong karena jawabannya jadi opaque.
//
// Server tidak terikat CORS, jadi hanya server yang bisa mengikuti redirect
// tersebut. Bookmarklet (src/share.js) adalah jalan keluar lain untuk masalah
// yang sama, tapi harus dijalankan manual di halaman Maps; endpoint ini
// otomatis begitu user memilih aplikasi ini di share sheet.
//
// KEAMANAN
// --------
// Fungsi ini mengambil URL dari request publik, jadi harus aman dari SSRF.
// Proteksinya BUKAN daftar blokir, tapi allowlist yang diterapkan di SETIAP hop:
//
//   1. Hop pertama hanya boleh short-link host. Input bebas apa pun yang
//      dikirim share sheet tidak bisa membuat server menyentuh host lain.
//   2. Redirect dibaca manual (`redirect: 'manual'`), bukan `follow`. Ini
//      titik kuncinya: kalau `follow` yang dipakai, Node akan mengikuti
//      redirect ke mana saja — termasuk alamat internal seperti
//      169.254.169.254 (metadata cloud) atau 127.0.0.1 — dan allowlist kita
//      jadi tidak berarti. Dengan `manual` kita membaca `Location` sendiri dan
//      baru memutuskan host itu boleh diambil atau tidak.
//   3. Hop berikutnya hanya boleh short-link host atau host peta Google.
//   4. Hanya https, dan deadline total dibagi seluruh hop.
//
// Server tidak pernah mengambil URL di luar allowlist, jadi tidak ada jalur
// ke jaringan internal.

/** Host yang boleh menjadi hop pertama. */
const SHORT_HOSTS = new Set(['maps.app.goo.gl', 'goo.gl']);

/**
 * Host peta Google. Daftar PERSIS, bukan polanya.
 *
 * Kenapa tidak pakai pola seperti `endsWith('.google.com')` atau
 * "hostname mengandung 'google'"? Karena pola itu menerima domain milik orang
 * lain:
 *   - `google.evil.com`  → pola longgar lolos, padahal registrable domain-nya
 *                          `evil.com`, milik penyerang
 *   - `evil.google.co`   → juga lolos, dan `google.co` BUKAN domain Google
 *                          (Google memakai `google.com.co`)
 *   - `google.com.evil.example` → lolos kalau polanya "satu label sebelum TLD"
 *
 * Yang bisa disimpulkan tanpa sumber keabsahan tidak ada: konfirmasi
 * kepemilikan nama domain butuh data registrar, dan kita tidak punya akses ke
 * itu. Jadi daftar eksplisit adalah satu-satunya opsi yang benar, dan menambah
 * negara cukup menambah satu entri di GOOGLE_MAPS_CC di bawah.
 *
 * Konsekuensinya disengaja: host di luar daftar DITOLAK. Itu berarti short
 * link dari negara yang belum terdaftar tidak ter-expand — annoyable, bukan
 * berbahaya, dan bookmarklet tetap tersedia. Arah sebaliknya (menerima host
 * milik orang lain) akan membuka SSRF.
 *
 * PENTING: aturan ini harus identik dengan isGoogleMapsHost() di
 * src/parse.js. Keduanya sengaja diduplikasi, bukan di-share, karena yang satu
 * berjalan di server (TypeScript, tanpa bundler) dan yang satu di browser
 * (ES module). Kalau salah sinkron, hasil expand bisa ditolak parser.
 */
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

const MAX_HOPS = 5;
const TIMEOUT_MS = 5000;

export interface ExpandResult {
  ok: boolean;
  /** URL akhir yang sudah berisi koordinat. Hanya ada kalau ok. */
  url?: string;
  /** Alasan penolakan, kalau gagal. Dipakai untuk diagnostik di UI. */
  reason?: string;
}

/** goo.gl hanya sah kalau path-nya diawali /maps, sama seperti src/parse.js. */
function isShortLink(u: URL): boolean {
  if (u.hostname === 'maps.app.goo.gl') return true;
  return u.hostname === 'goo.gl' && u.pathname.startsWith('/maps');
}

/**
 * Host peta Google, hanya dari allowlist eksplisit di atas.
 *
 * Path-nya juga wajib diawali /maps: goo.gl redirect ke
 * https://www.google.com/ (halaman utama) bukan link peta, dan menerimanya
 * akan membuat UI menampilkan "berhasil" tanpa koordinat apa pun.
 */
export function isMapsHost(u: URL): boolean {
  return MAPS_HOSTS.has(u.hostname.toLowerCase()) && u.pathname.startsWith('/maps');
}

/** Host yang boleh disentuh pada hop ke-`n`. */
function hostAllowed(u: URL, hop: number): boolean {
  if (hop === 0) return isShortLink(u);
  return isShortLink(u) || isMapsHost(u);
}

/**
 * Ikuti rantai redirect short link sampai ketemu URL peta.
 *
 * `fetchImpl` dan `deadline` diinjeksi supaya seluruh percabangan bisa diuji
 * tanpa jaringan dan tanpa menunggu detik.
 */
export async function expandShortLink(
  input: string,
  fetchImpl: typeof fetch = fetch,
  deadline: number = Date.now() + TIMEOUT_MS,
): Promise<ExpandResult> {
  let current: URL;
  try {
    current = new URL(String(input || '').trim());
  } catch {
    return { ok: false, reason: 'not-a-link' };
  }

  if (current.protocol !== 'https:') return { ok: false, reason: 'not-https' };

  for (let hop = 0; hop < MAX_HOPS; hop++) {
    if (!hostAllowed(current, hop)) return { ok: false, reason: 'host-not-allowed' };

    const left = deadline - Date.now();
    if (left <= 0) return { ok: false, reason: 'timeout' };

    let res: Response;
    try {
      // `manual` — bukan `follow`. Lihat catatan keamanan di atas file ini.
      res = await fetchImpl(current.href, {
        redirect: 'manual',
        headers: { accept: 'text/html' },
        signal: AbortSignal.timeout(left),
      });
    } catch {
      // Timeout, DNS gagal, TLS rusak: semuanya berarti short link tidak bisa
      // di-expand. Bedakan hanya kalau perlu pesan yang lebih spesifik.
      return { ok: false, reason: 'fetch-failed' };
    }

    const loc = res.headers.get('location');
    if (res.status < 300 || res.status >= 400 || !loc) {
      return { ok: false, reason: 'no-redirect' };
    }

    try {
      // Header Location hanya berlaku pada respons 3xx, jadi server boleh
      // mengirimnya apa adanya — termasuk sebagai path relatif.
      current = new URL(loc, current);
    } catch {
      return { ok: false, reason: 'bad-location' };
    }

    // Sudah sampai di URL peta. Berhenti di sini: hop selanjutnya hanya
    // akan mengikuti redirect lain yang tidak ada gunanya, dan membiarkan
    // loop berjalan sampai batas hop.
    if (isMapsHost(current)) return { ok: true, url: current.href };
  }

  return { ok: false, reason: 'too-many-hops' };
}

// ── Handler Vercel ────────────────────────────────────────────────────────
// Bentuk req/res dideklarasikan lokal, bukan diimpor dari @vercel/node,
// supaya project ini tetap tanpa node_modules.

interface HandlerRequest {
  method?: string;
  url?: string;
  query?: Record<string, string | string[]>;
}

interface HandlerResponse {
  status(code: number): HandlerResponse;
  setHeader(name: string, value: string): void;
  json(body: unknown): void;
}

export default async function handler(req: HandlerRequest, res: HandlerResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ ok: false, reason: 'method-not-allowed' });
    return;
  }

  // Input hanya dibaca dari query (?url=). Membaca dari header akan membuka
  // jalan bagi situs mana pun memancing request ke endpoint ini, dan itu
  // permukaan serang yang tidak perlu kita punya. Allowlist membuat hasilnya
  // tetap aman, tapi tidak ada gunanya menambah jalan masuk.
  const raw = req.query?.url;
  const input = Array.isArray(raw) ? raw[0] : raw;

  if (!input) {
    res.status(400).json({ ok: false, reason: 'missing-url' });
    return;
  }

  const result = await expandShortLink(input);

  // Cache pendek. Hasilnya data publik (link peta yang bisa diakses siapa
  // saja) dan menguranginya berarti serverless invocation jauh berkurang,
  // yang penting untuk function yang dipanggil dari HP.
  res.setHeader('Cache-Control', result.ok ? 'public, s-maxage=600' : 'no-store');
  res.status(result.ok ? 200 : 422).json(result);
}
