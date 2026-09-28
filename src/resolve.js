// @ts-check
//
//  RESOLVER SHORT LINK ( sisi client )
//
// maps.app.goo.gl tidak bisa di-expand dari browser: CORS melarang JavaScript
// membaca respons redirect, dan Google memang tidak mengirim header CORS
// untuknya. Server bisa karena CORS tidak berlaku pada server-to-server.
//
// Modul ini memanggil /api/expand milik kita sendiri, jadi request-nya
// same-origin dan tidak butuh header CORS apa pun.
//
// Yang TIDAK ada di sini: validasi host. Allowlist ada di server
// (api/expand.js) dan di parser (parse.js). Client cukup meneruskan link,
// menerima URL akhir, lalu memparsenya ulang lewat jalur yang biasa —
// sehingga hanya ada satu tempat yang memutuskan sah atau tidak.

/** Batas waktu di sisi client. Server sudah membatasi 5 detik. */
const CLIENT_TIMEOUT_MS = 8000;

/** Alasan penolakan server → kalimat yang bisa dibaca user. */
const REASON_TEXT = {
  'not-a-link':        'Link itu bukan tautan yang bisa dibuka.',
  'not-https':         'Link itu bukan HTTPS.',
  'missing-url':       'Linknya kosong.',
  'method-not-allowed': 'Permintaan ditolak server.',
  'host-not-allowed':  'Tautan itu bukan short link Google Maps.',
  'no-redirect':       'Tautan itu tidak mengarah ke peta.',
  'too-many-hops':     'Rantai pengalihan terlalu panjang.',
  'timeout':           'Server terlalu lama menjawab.',
  'fetch-failed':      'Server tidak bisa menghubungi Google.',
  'bad-location':      'Tautan itu tidak valid.',
};

/**
 * Error dari resolver, dengan `reason` apa adanya supaya pemanggil bisa
 * membedakan "link memang bukan peta" (pesan sendiri) dari "server mati"
 * (pesan umum). Tanpa itu, semua kegagalan tampil sebagai "gagal", dan user
 * tidak bisa tahu harus mencoba apa.
 */
export class ResolveError extends Error {
  /** @param {string} reason @param {boolean} offline */
  constructor(reason, offline) {
    super(REASON_TEXT[reason] || 'Tautan tidak bisa dibuka.');
    this.name = 'ResolveError';
    /** Alasan mentah dari server; berguna untuk diagnostik. */
    this.reason = reason;
    /** True kalau kegaagalannya di sisi kita, bukan keputusan server. */
    this.offline = offline;
  }

  /** Pesan yang layak ditampilkan ke user. */
  get userMessage() { return this.message; }
}

/** True kalau teks ini jelas sebuah URL (bukan teks biasa). */
export function looksLikeUrl(text) {
  return /^https?:\/\/\S+$/i.test(String(text || '').trim());
}

/**
 * Expand short link jadi URL peta yang berisi koordinat.
 *
 * `fetchImpl` diinjeksi supaya bisa diuji tanpa jaringan. Timeout-nya punya
 * sendiri karena server yang timeout tidak selalu respond — kalau koneksi
 * benar-benar putus, tidak akan ada respons yang bisa ditunggu selamanya.
 *
 * @param {string} url
 * @param {{fetchImpl?: typeof fetch, timeoutMs?: number}} [opts]
 * @returns {Promise<string>} URL peta tujuan
 * @throws {ResolveError}
 */
export async function resolveShortLink(url, opts = {}) {
  const fetchImpl = opts.fetchImpl || fetch;
  const timeoutMs = opts.timeoutMs === undefined ? CLIENT_TIMEOUT_MS : opts.timeoutMs;

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);

  let res;
  try {
    res = await fetchImpl('./api/expand?url=' + encodeURIComponent(String(url)), {
      signal: ctl.signal,
    });
  } catch {
    // Timeout dan kegagalan jaringan sampai sini tidak bisa dibedakan dari
    // sisi client, jadi keduanya dilaporkan sebagai "offline".
    throw new ResolveError('fetch-failed', true);
  } finally {
    clearTimeout(timer);
  }

  /** @type {{ok?: boolean, url?: string, reason?: string}} */
  let body = {};
  try {
    body = await res.json();
  } catch {
    // Server membalas non-JSON: biasanya proxy atau halaman error platform.
    throw new ResolveError('fetch-failed', true);
  }

  if (!res.ok || !body.ok || !body.url) {
    throw new ResolveError(body.reason || 'fetch-failed', false);
  }
  return body.url;
}
