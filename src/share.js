// @ts-check
//
//  SHARE TARGET & BOOKMARKLET
//

import { bmPanel, bmCode } from './dom.js';
import { toast } from './toast.js';
import { handleMapsInput } from './ui.js';
// ══════════════════════════════════════════════
//  BOOKMARKLET: KIRIM DARI GOOGLE MAPS
// ══════════════════════════════════════════════
//
// Short link (maps.app.goo.gl) tidak bisa di-expand dari browser karena CORS
// melarang JavaScript membaca jawaban server Google. Tapi bookmarklet tidak
// melakukan fetch sama sekali: dia membaca location.href dari halaman yang
// SEDANG dibuka, jadi tidak ada request lintas domain dan CORS tidak pernah
// tersentuh. Batas yang menutup fitur di atas justru hilang total di sini.
//
// URL dikirim lewat FRAGMENT (#u=), bukan query string (?u=), supaya tujuan
// yang dipilih user tidak pernah masuk ke access log server hosting.
//
// Alur: Google Maps → tap bookmark → tab baru terbuka ke aplikasi ini dengan
// koordinat tujuan terisi → baris konfirmasi muncul → user menyetujui.

export function buildBookmarklet(appUrl) {
  const base = String(appUrl || '').replace(/\/+$/, '');
  return 'javascript:(function(){window.open('
       + JSON.stringify(base + '#u=')
       + '+encodeURIComponent(location.href))})()';
}

export function readIncomingLink() {
  const hash = location.hash.replace(/^#/, '');
  if (!hash) return null;
  try { return new URLSearchParams(hash).get('u'); } catch { return null; }
}

// Buang fragment setelah dibaca supaya refresh tidak memicu parse ulang dan
// URL di address bar tetap bersih.
export function cleanIncomingLink() {
  if (!location.hash) return;
  history.replaceState(null, '', location.pathname + location.search);
}

// Satu pintu untuk membaca link dari fragment, dipakai boot maupun hashchange.
// Mengembalikan true kalau ada link yang diproses.
export function consumeIncomingLink() {
  const link = readIncomingLink();
  if (!link) return false;
  cleanIncomingLink();
  return handleMapsInput(link);
}

// Share target yang SEDANG TERBUKA tidak reload halaman.
//
// sw.js membalas POST dari share sheet dengan redirect ke './#u=...' —
// perubahan fragment saja. Kalau aplikasinya sudah terbuka di './', navigasi
// itu SAME-DOCUMENT: browser tidak memuat ulang dokumen, sehingga skrip boot
// di bawah tidak pernah jalan lagi dan link-nya hangus diam-diam. Gejalanya
// persis seperti ini: share sukses, aplikasi terbuka, tapi tidak ada
// apa-apa yang terjadi.
//
// Dengarkan hashchange supaya link yang masuk ke aplikasi yang sudah hidup
// tetap diproses. Ini juga menutup kasus "user share dua kali berturut-turut".
//
// Dibuat named function, bukan arrow inline, supaya test bisa memanggilnya
// langsung — bug ini hilang hanya kalau listener-nya sengaja dibuang, dan
// arrow inline tidak bisa diuji tanpa browser.
export function handleHashChange() { consumeIncomingLink(); }


export function detectPlatform() {
  const ua = navigator.userAgent || '';
  // iPadOS 13+ tidak pernah mengirim "iPad" di user agent — ia melaporkan
  // "MacIntel" dengan maxTouchPoints > 1. Kalau hanya cek /iPad/, iPad akan
  // salah dikira desktop dan dapat instruksi yang tidak bisa dijalankan.
  if (/iPhone|iPad|iPod/.test(ua)
      || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'ios';
  if (/Android/.test(ua)) return 'android';
  return 'desktop';
}

// Instruksi bookmarklet TIDAK sama di semua platform, dan salahnya tidak
// sekadar membingungkan: di Android, mengetuk bookmark dari daftar bookmark
// tidak menjalankan apa pun karena Chrome membuang URL "javascript:" di sana
// (bug Chromium 480010). User akan mengira aplikasinya rusak.
// Satu-satunya jalur yang jalan di Android: address bar.
const BM_HELP = {
  desktop: {
    save: '(Chrome: ⋮ → Bookmark → Edit → More ⋮ → Edit)',
    run: 'klik bookmark <b>Kirim ke ESP-Nav</b>',
    note: '',
  },
  android: {
    save: '(Chrome: ⋮ → ⭐ → <b>Edit</b>, lalu ganti kolom URL dengan kode di bawah)',
    run: 'ketik <b>Kirim ke ESP-Nav</b> di address bar Google Maps, lalu tap sarannya',
    note: 'Bookmark Android tidak bisa dibuka dari daftar bookmark: Chrome membuang URL "javascript:" di sana. Address bar satu-satunya tempat yang menjalankannya.',
  },
};

export function renderBookmarkletHelp() {
  const platform = detectPlatform();
  const flow = document.getElementById('bm-bm-flow');
  const alt  = document.getElementById('bm-alt');
  const note = document.getElementById('bm-note');

  if (platform === 'ios') {
    // Mobile Safari memblokir JavaScript di address bar DAN di bookmark, jadi
    // menampilkan kode yang dijamin tidak bisa jalan hanya membuang waktu
    // user. Jalur tempel manual sudah ada dan tidak butuh kode baru.
    flow.style.display = 'none';
    alt.style.display = 'block';
    alt.innerHTML =
      '<p><b>Safari di iOS tidak bisa menjalankan bookmarklet.</b> Apple menghentikan '
      + 'eksekusi JavaScript di address bar maupun di bookmarknya.</p>'
      + '<p>Cara biasa sudah cukup: buka lokasi di <b>Chrome</b> (bukan aplikasi '
      + 'Google Maps), tekan address bar, salin URL panjangnya, lalu tempel ke kotak '
      + 'pencarian di atas.</p>'
      + '<p>URL dari address bar Chrome selalu bentuk panjang, jadi bisa dibaca '
      + 'langsung tanpa perlu expand tautan pendek.</p>';
    note.textContent = '';
    return;
  }

  const help = BM_HELP[platform];
  flow.style.display = 'block';
  alt.style.display = 'none';
  document.getElementById('bm-save-hint').textContent = help.save;
  document.getElementById('bm-run-how').innerHTML = help.run;
  note.textContent = help.note;
}

export function toggleBookmarkletPanel(force) {
  const open = force !== undefined ? force : bmPanel.style.display !== 'block';
  if (open) {
    bmCode.value = buildBookmarklet(location.origin);
    renderBookmarkletHelp();
  }
  bmPanel.style.display = open ? 'block' : 'none';
  document.getElementById('btn-bookmarklet').classList.toggle('active', open);
}

/**
 * Share target, hashchange, & panel bookmarklet.
 *
 * Dipanggil sekali dari src/main.js. Semua listener dipasang di sini,
 * bukan diatas modul modul, supaya urutan mendaftarnya mengikuti urutan pemanggilan
 * init dan bisa diuji tanpa memuat halaman.
 */
export function initShare() {
  window.addEventListener('hashchange', handleHashChange);
  document.getElementById('btn-bookmarklet').addEventListener('click', () => toggleBookmarkletPanel());
  document.getElementById('btn-close-bm').addEventListener('click', () => toggleBookmarkletPanel(false));
  document.getElementById('btn-copy-bm').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(bmCode.value);
      toast('Kode tersalin. Simpan sebagai bookmark "Kirim ke ESP-Nav".');
    } catch {
      // Clipboard API butuh konteks aman; kalau gagal, andalkan selection manual.
      bmCode.focus();
      bmCode.select();
      toast('Tekan Ctrl+C untuk menyalin kode yang tersorot.');
    }
  });
}
