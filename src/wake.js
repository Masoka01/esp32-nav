// @ts-check
//
//  KEEP AWAKE
//

import { state } from './state.js';
import { toast } from './toast.js';
// ══════════════════════════════════════════════
//  WAKE LOCK
//
//  Selama navigasi, layar HP harus tetap menyala. Kalau tidak, Chrome
//  membuat tab ter-background, watchPosition di-throttle lalu berhenti,
//  dan OLED membeku pada instruksi terakhir — tanpa indikator apa pun
//  bahwa instruksi itu sudah basi.
//
//  Batasnya, dan ini penting: Screen Wake Lock hanya mencegah timeout
//  layar. Kalau pengguna pindah ke aplikasi lain atau mengunci HP manual,
//  lock tetap dilepas oleh sistem dan navigasi bisa terputus. Jadi ini
//  memperbaiki kasus yang paling sering, bukan semua kasus.
// ══════════════════════════════════════════════
// WAV senyap 0,1 detik dibangun saat runtime, bukan blob base64 sepanjang
// 1 KB di dalam source: string sebesar itu gampang rusak saat diedit dan
// mustahil dibaca atau ditinjau.
export function silentWavDataUri() {
  const RATE = 8000, FRAMES = 800, CHANNELS = 1, BITS = 8;
  const dataSize = FRAMES * CHANNELS * (BITS / 8);
  const buf = new ArrayBuffer(44 + dataSize);
  const v = new DataView(buf);
  const tag = (off, s) => {
    for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i));
  };
  tag(0, 'RIFF');
  v.setUint32(4, 36 + dataSize, true);
  tag(8, 'WAVE');
  tag(12, 'fmt ');
  v.setUint32(16, 16, true);                          // panjang chunk fmt
  v.setUint16(20, 1, true);                           // PCM tak terkompresi
  v.setUint16(22, CHANNELS, true);
  v.setUint32(24, RATE, true);
  v.setUint32(28, RATE * CHANNELS * BITS / 8, true);  // byte per detik
  v.setUint16(32, CHANNELS * BITS / 8, true);         // block align
  v.setUint16(34, BITS, true);
  tag(36, 'data');
  v.setUint32(40, dataSize, true);
  // ArrayBuffer tidak punya fill(); fill() itu metode TypedArray
  const bytes = new Uint8Array(buf);
  bytes.fill(128, 44);                              // 128 = hening 8-bit
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return 'data:audio/wav;base64,' + btoa(bin);
}

let keepAwakeAudio = null;          // hanya untuk fallback
let releasingIntentionally = false; // bedsakan "kita lepas" vs "sistem lepas"

export function setAwakeNote(msg, warn = false) {
  const el = document.getElementById('awake-note');
  if (!el) return;
  if (!msg) {
    el.classList.add('hidden');
    el.classList.remove('warn');
    return;
  }
  el.textContent = msg;
  el.classList.remove('hidden');
  el.classList.toggle('warn', warn);
}

export function stopKeepAwakeFallback() {
  if (!keepAwakeAudio) return;
  try { keepAwakeAudio.pause(); } catch (e) { /* abaikan */ }
  keepAwakeAudio = null;
}

// Fallback HANYA untuk browser tanpa Screen Wake Lock API. Cara lama ini
// sudah usang: browser modern sering memblokir audio senyap, dan tetap saja
// membuat baterai terkuras. Dipakai sebagai upaya terakhir, bukan utama.
export function startKeepAwakeFallback() {
  if (keepAwakeAudio) return;
  try {
    const audio = new Audio(silentWavDataUri());
    audio.loop = true;
    audio.volume = 0.01;
    const played = audio.play();
    if (played && played.catch) played.catch(() => {});
    keepAwakeAudio = audio;
    setAwakeNote('Layar dijaga (mode kompatibilitas, boros baterai).');
  } catch (e) {
    console.warn('[AWAKE] fallback gagal:', e);
    setAwakeNote('Tidak bisa menjaga layar tetap menyala. Navigasi bisa terputus saat tab tidak aktif.', true);
  }
}

export async function requestWakeLock() {
  if (!state.navigating) return;
  if (!('wakeLock' in navigator)) { startKeepAwakeFallback(); return; }

  // Jangan acquire dua kali: satu sentinel hanya bisa dipakai sekali.
  if (state.wakeLock && !state.wakeLock.released) return;

  try {
    const sentinel = await navigator.wakeLock.request('screen');
    if (!state.navigating) { sentinel.release().catch(() => {}); return; }
    state.wakeLock = sentinel;
    setAwakeNote('Layar dijaga — layar tidak akan padam selama navigasi.');
    sentinel.addEventListener('release', () => {
      state.wakeLock = null;
      if (state.navigating && !releasingIntentionally) {
        setAwakeNote('Layar tidak lagi dijaga. Navigasi bisa berhenti kalau tab dibekukan browser.', true);
      }
    });
  } catch (e) {
    // Ditolak karena battery saver, baterai lemah, atau dokumen tidak
    // visible. Harus terlihat: kalau diam saja, pengguna tidak akan tahu
    // navigasinya bisa mati.
    console.warn('[AWAKE] wake lock ditolak:', e);
    setAwakeNote('Tidak bisa menjaga layar tetap menyala. Navigasi bisa terputus saat tab tidak aktif.', true);
  }
}

export function releaseWakeLock() {
  const sentinel = state.wakeLock;
  state.wakeLock = null;
  if (sentinel) {
    releasingIntentionally = true;
    try { sentinel.release().catch(() => {}); } catch (e) { /* abaikan */ }
    // Bendera hanya untuk menahan event 'release' yang menyertainya.
    setTimeout(() => { releasingIntentionally = false; }, 0);
  }
  stopKeepAwakeFallback();
  setAwakeNote('');
}

export function handleVisibilityChange() {
  if (document.visibilityState !== 'visible') return;
  if (!state.navigating) return;
  if (state.wakeLock) return;
  // Sistem melepas lock sendiri saat halaman jadi hidden, jadi di sini
  // kita minta yang baru.
  requestWakeLock();
}

/**
 * Jaga layar tetap menyala.
 *
 * Dipanggil sekali dari src/main.js. Semua listener dipasang di sini,
 * bukan diatas modul modul, supaya urutan mendaftarnya mengikuti urutan pemanggilan
 * init dan bisa diuji tanpa memuat halaman.
 */
export function initWake() {
  document.addEventListener('visibilitychange', handleVisibilityChange);
  window.addEventListener('pagehide', releaseWakeLock);
}
