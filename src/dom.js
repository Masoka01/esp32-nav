// @ts-check
//
//  AKSES DOM TERPUSAT
//
//  Semua elemen yang dipakai lebih dari satu modul dikumpulkan di sini, bukan
//  diariskan ulang di tiap modul. Kalau `#maps-confirm` diubah, hanya file
//  ini yang perlu tahu.
//
//  Kenapa aman diambil pada top-level modul: `<script type="module">` selalu
//  deferred, jadi modul baru dieksekusi setelah dokumen selesai di-parse.
//  Elemen yang diambil di sini pasti sudah ada. Modul pure (src/parse.js) tidak
//  boleh mengimpor file ini — itulah yang menjaga logikanya bisa diuji di Node
//  tanpa browser.

/**
 * Ambil elemen by id, dengan pesan error yang benar-benar membantu kalau ada
 * yang lupa mengubah markup.
 *
 * @param {string} id
 * @returns {HTMLElement}
 */
export function $(id) {
  const el = document.getElementById(id);
  if (!el) throw new Error('Elemen #' + id + ' tidak ada di index.html');
  return el;
}

// Elemen yang dipakai lintas modul.
//
// Tipe ditulis eksplisit karena $() mengembalikan HTMLElement generik, sementara
// pemakaian sebenarnya lebih spesifik: searchInput dibaca lewat .value,
// bmCode juga butuh .focus()/.select(). Tanpa cast di sini, tsc akan
// mengeluh "Property 'value' does not exist on type 'HTMLElement'" di setiap
// call site — dan membiarkan tsc mengeluh membuat orang mematikan checkJs.

/** @type {HTMLInputElement} */
export const searchInput = /** @type {HTMLInputElement} */ ($('search-input'));

/** @type {HTMLDivElement} */
export const suggestionsEl = /** @type {HTMLDivElement} */ ($('suggestions'));

/** @type {HTMLDivElement} */
export const confirmEl = /** @type {HTMLDivElement} */ ($('maps-confirm'));

/** @type {HTMLDivElement} */
export const bmPanel = /** @type {HTMLDivElement} */ ($('bookmarklet-panel'));

/** @type {HTMLTextAreaElement} */
export const bmCode = /** @type {HTMLTextAreaElement} */ ($('bookmarklet-code'));

/** @type {HTMLButtonElement} */
export const bleBtn = /** @type {HTMLButtonElement} */ ($('btn-ble'));

/** @type {HTMLSpanElement} */
export const bleDot = /** @type {HTMLSpanElement} */ ($('ble-dot'));

/** @type {HTMLSpanElement} */
export const bleLabel = /** @type {HTMLSpanElement} */ ($('ble-label'));
