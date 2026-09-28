// @ts-check
//
//  MAIN — COMPOSITION ROOT
//
//  Satu-satunya modul yang tahu semua modul lain ada. Modul lain tidak saling
//  mengimpor main.js; hubungan antar fitur tetap lewat modul yang relevan
//  masing-masing.
//
//  Dipakai sebagai <script type="module" src="./src/main.js">, jadi seluruh
//  modul sudah dievaluasi (dan semua event listener terpasang) sebelum baris
//  di bawah dieksekusi.

import { initBle }     from './ble.js';
import { initSearch }  from './geocode.js';
import { initNav }     from './nav.js';
import { initShare }   from './share.js';
import { initConfirm } from './ui.js';
import { initWake }    from './wake.js';
import { consumeIncomingLink } from './share.js';
import { restoreTrip } from './store.js';

// ══════════════════════════════════════════════
//  SERVICE WORKER
// ══════════════════════════════════════════════
//
// Tanpa service worker terdaftar, Chrome tidak mau memasang aplikasi (hanya
// shortcut). Pendaftaran gagal diam-diam di localhost/file:// karena keduanya
// bukan secure context, jadi kegagalan tidak perlu Permissions-Policy yang
// akan menggoda developer untuk menambahkan header yang tidak perlu.
//
// Service worker ini sengaja hanya meng-cache shell: rute OSRM dan tile peta
// SELALU network-only. Rute basi lebih buruk daripada peta kosong. Lihat
// sw.js untuk aturan lengkapnya.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => {
      // Tidak fatal: aplikasi tetap jalan normal, cuma tidak bisa di-install
      // sampai service worker berhasil terdaftar.
    });
  });
}

// ══════════════════════════════════════════════
//  BOOT
// ══════════════════════════════════════════════

// Pasang semua listener lebih dulu, baru proses link yang masuk. Kalau
// `consumeIncomingLink()` dipanggil sebelum listener terpasang, GPS yang belum
// siap akan menerima rute dan menahannya — dan tidak ada yang menyelesaikan
// pekerjaan itu setelah listener aktif.
initSearch();
initConfirm();
initShare();
initNav();
initBle();
initWake();

// Dipanggil terakhir, setelah semua listener di atas terpasang.
//
// Kalau halaman dibuka dari bookmarklet, tidak ada yang dipulihkan: tautan yang
// barusan dikirim adalah niat eksplisit user dan harus menang atas perjalanan
// yang tersimpan sebelumnya. Kalau tidak, kembalikan perjalanan yang lalu.
if (!consumeIncomingLink()) restoreTrip();
