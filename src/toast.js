// @ts-check
//
//  TOAST
//
//  Sengaja modul daun: TIDAK mengimpor apa pun, dan tidak diimpor
//  modul lain selain yang benar-benar memanggilnya.
//
//
//  Dulu toast tinggal di dalam satu scope besar bersama semua kode
//  lain, jadi setiap modul bisa memanggilnya tanpa perlu melihat
//  struktur modul lain. Setelah dipecah, menyisipkannya di ui.js
//  membuat ui.js jadi hub yang mengimpor parse, geocode, dan route, dan
//  itu melahirkan rantai import circular yang panjang. Memisahkannya
//  sebagai modul daun memutus rantai itu di sumbernya.
//

let toastTimer;

/**
 * Tampilkan pesan singkat di bawah layar.
 *
 * @param {string} msg
 */
export function toast(msg) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2500);
}
