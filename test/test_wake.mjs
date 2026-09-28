// Uji logika wake lock dari src/wake.js.
//
// Modul di-import sungguhan, bukan diekstrak dari index.html dengan marker.
// Stub dipasang lewat installStubs() dulu, lalu import memakai import()
// DINAMIS — import statis akan di-hoist dan berjalan sebelum stub siap.
//
// Yang diuji: apakah layar benar-benar dijaga selama navigasi, apakah
// lock tidak pernah dobel, apakah sentinel dari sistem dilaporkan ke user,
// dan apakah kegagalan request terlihat (bukan diam-diam).
import { installStubs, load, resetAll, calls, el, freshState, bindState } from './helpers/env.mjs';

installStubs();

const { state } = await load('src/state.js');
bindState(state);
const wake_ = await load('src/wake.js');

let pass = 0, fail = 0;
const check = (cond, what) => {
  if (cond) pass++;
  else { fail++; console.log(`  FAIL: ${what}`); }
};
const section = s => console.log(`\n== ${s} ==`);

// Sentinel tiruan:/release() mengembalikan Promise dan listener 'release'
// bisa dipicu manual untuk meniru sistem yang melepas lock sendiri.
function makeSentinel() {
  const ls = {};
  return {
    released: false,
    addEventListener(ev, fn) { (ls[ev] = ls[ev] || []).push(fn); },
    release() {
      this.released = true;
      return Promise.resolve().then(() => (ls.release || []).forEach(f => f()));
    },
    fireSystemRelease() { (ls.release || []).forEach(f => f()); },
    listenerCount(ev) { return (ls[ev] || []).length; },
  };
}

/**
 * Skenario: state mewat navigasi, navigator dengan atau tanpa Screen Wake
 * Lock API, dan Audio tiruan yang mencatat setiap elemen yang dibuat.
 *
 * Bentuk kembalannya sama dengan versi lama supaya badan test di bawah tidak
 * perlu diubah — yang berubah hanya dari mana asalnya.
 */
function makeEnv({ hasApi = true, requestImpl } = {}) {
  resetAll();
  const st = freshState({ navigating: true });

  // keepAwakeAudio adalah state modul, jadi harus dibersihkan agar test
  // sebelumnya tidak meninggalkan audio yang masih hidup.
  wake_.stopKeepAwakeFallback();

  if (hasApi) {
    globalThis.navigator.wakeLock = { request: requestImpl || (async () => makeSentinel()) };
  } else {
    // requestWakeLock mengecek `'wakeLock' in navigator`, jadi menghapus
    // properti-nya — bukan mengesetnya jadi null.
    delete globalThis.navigator.wakeLock;
  }

  const audioLog = [];
  class AudioMock {
    constructor(src) { this.src = src; audioLog.push(this); }
    play() { this.played = true; return Promise.resolve(); }
    pause() { this.played = false; }
  }
  globalThis.Audio = AudioMock;

  const note = el('awake-note');
  return {
    state: st,
    nav: globalThis.navigator,
    doc: globalThis.document,
    note, audioLog,
    api: wake_,
    noteVisible: () => !note.classList.contains('hidden'),
    noteWarn: () => note.classList.contains('warn'),
  };
}


// ══════════════════════════════════════════════
section('Acquire saat navigasi dimulai');
{
  let acquired = 0;
  const env = makeEnv({ requestImpl: async () => { acquired++; return makeSentinel(); } });
  await env.api.requestWakeLock();
  check(acquired === 1, 'sentinel diminta tepat sekali');
  check(env.state.wakeLock !== null, 'sentinel disimpan di state');
  check(env.noteVisible(), 'catatan layar dijaga terlihat');
  check(!env.noteWarn(), 'catatan normal, bukan peringatan');
}

section('Tidak acquire kalau belum navigasi');
{
  const env = makeEnv();
  env.state.navigating = false;
  await env.api.requestWakeLock();
  check(env.state.wakeLock === null, 'tidak ada lock');
}

section('Tidak acquire dobel');
{
  let acquired = 0;
  const env = makeEnv({ requestImpl: async () => { acquired++; return makeSentinel(); } });
  await env.api.requestWakeLock();
  await env.api.requestWakeLock();
  await env.api.requestWakeLock();
  check(acquired === 1, `tiga panggilan -> satu acquire (dapat ${acquired})`);
}

section('Release saat navigasi berhenti');
{
  const env = makeEnv();
  await env.api.requestWakeLock();
  const s = env.state.wakeLock;
  check(!s.released, 'sebelum release belum lepas');
  env.state.navigating = false;          // urutan stopNavigation()
  env.api.releaseWakeLock();
  await new Promise(r => setTimeout(r, 0));
  check(s.released, 'sentinel dilepas');
  check(env.state.wakeLock === null, 'state dibersihkan');
  check(!env.noteVisible(), 'catatan disembunyikan');
  check(!env.noteWarn(), 'pelepasan yang disengaja TIDAK jadi peringatan');
}

section('Sistem yang melepas lock → user diberi tahu');
{
  const env = makeEnv();
  await env.api.requestWakeLock();
  env.state.wakeLock.fireSystemRelease();
  check(env.state.wakeLock === null, 'state dibersihkan');
  check(env.noteVisible(), 'peringatan terlihat');
  check(env.noteWarn(), 'ditandai sebagai peringatan');
}

section('Request ditolak → gagal terlihat, tidak melempar');
{
  const env = makeEnv({
    requestImpl: async () => { const e = new Error('NotAllowedError'); e.name = 'NotAllowedError'; throw e; },
  });
  let threw = false;
  try { await env.api.requestWakeLock(); } catch { threw = true; }
  check(!threw, 'tidak melempar ke pemanggil');
  check(env.state.wakeLock === null, 'tidak ada lock tersimpan');
  check(env.noteVisible(), 'kegagalan terlihat ke user');
  check(env.noteWarn(), 'ditandai sebagai peringatan');
}

section('Sentinel datang terlambat setelah navigasi berhenti');
{
  const env = makeEnv();
  let resolveReq;
  const p = new Promise(r => { resolveReq = r; });
  env.nav.wakeLock.request = () => p;
  const pending = env.api.requestWakeLock();
  env.state.navigating = false;         // navigasi berhenti sebelum request selesai
  const s = makeSentinel();
  resolveReq(s);
  await pending;
  await new Promise(r => setTimeout(r, 0));
  check(s.released, 'sentinel yang terlambat langsung dilepas');
  check(!env.noteVisible(), 'tidak menampilkan catatan untuk navigasi yang sudah berhenti');
}

section('visibilitychange → acquire ulang');
{
  let acquired = 0;
  const env = makeEnv({ requestImpl: async () => { acquired++; return makeSentinel(); } });
  await env.api.requestWakeLock();
  check(acquired === 1, 'lock pertama');

  ///browser melepas lock sendiri saat halaman hidden
  env.state.wakeLock.fireSystemRelease();
  env.doc.visibilityState = 'hidden';
  env.api.handleVisibilityChange();
  await new Promise(r => setTimeout(r, 0));
  check(acquired === 1, 'saat hidden tidak acquire baru');

  env.doc.visibilityState = 'visible';
  env.api.handleVisibilityChange();
  await new Promise(r => setTimeout(r, 0));
  check(acquired === 2, `kembali visible → acquire ulang (dapat ${acquired})`);
  check(!env.noteWarn(), 'catatan kembali normal setelah berhasil');
}

section('visibilitychange tidak disturb lock yang masih hidup');
{
  let acquired = 0;
  const env = makeEnv({ requestImpl: async () => { acquired++; return makeSentinel(); } });
  await env.api.requestWakeLock();
  env.doc.visibilityState = 'visible';
  env.api.handleVisibilityChange();
  env.api.handleVisibilityChange();
  await new Promise(r => setTimeout(r, 0));
  check(acquired === 1, 'tidak acquire ulang saat lock masih dipegang');
}

section('visibilitychange saat tidak navigasi → no-op');
{
  let acquired = 0;
  const env = makeEnv({ requestImpl: async () => { acquired++; return makeSentinel(); } });
  env.state.navigating = false;
  env.api.handleVisibilityChange();
  await new Promise(r => setTimeout(r, 0));
  check(acquired === 0, 'tidak ada acquire');
}

section('Fallback audio tanpa Screen Wake Lock API');
{
  const env = makeEnv({ hasApi: false });
  await env.api.requestWakeLock();
  check(env.audioLog.length === 1, 'satu elemen audio dibuat');
  check(env.audioLog[0].played, 'audio diputar');
  check(env.audioLog[0].loop === true, 'loop aktif');
  check(env.audioLog[0].src.startsWith('data:audio/wav;base64,'), 'WAV senyap dari data URI');
  check(env.noteVisible() && !env.noteWarn(), 'catatan kompatibilitas, bukan peringatan');

  env.state.navigating = false;
  env.api.releaseWakeLock();
  await new Promise(r => setTimeout(r, 0));
  check(env.audioLog[0].played === false, 'audio dihentikan saat navigasi berhenti');
}

section('Fallback tidak dobel');
{
  const env = makeEnv({ hasApi: false });
  await env.api.requestWakeLock();
  await env.api.requestWakeLock();
  check(env.audioLog.length === 1, 'tidak membuat audio kedua');
}

section('Fallback yang gagal → ada peringatan');
{
  const env = makeEnv({ hasApi: false });
  // Paksa constructor Audio melempar, seperti browser yang memblokirnya.
    // Paksa constructor Audio melempar, seperti browser yang memblokirnya.
    //
    // Versi lama membuat instans modul kedua lewat new Function supaya punya
    // Audio yang melempar tanpa mengganggu test lain. Sekarang tidak perlu:
    // wake.js membaca global `Audio` saat startKeepAwakeFallback() dipanggil,
    // jadi cukup ganti globalnya sesaat di test ini saja.
    globalThis.Audio = function () { throw new Error('blocked'); };
    const requestWakeLock = env.api.requestWakeLock;

  let threw = false;
  try { await requestWakeLock(); } catch { threw = true; }
  check(!threw, 'error Audio tertangkap di dalam, tidak naik ke pemanggil');
  check(env.noteWarn(), 'kegagalan fallback menghasilkan peringatan');
}

section('Data URI WAV benar-benar valid');
{
  const env = makeEnv({ hasApi: false });
  await env.api.requestWakeLock();
  const b64 = env.audioLog[0].src.split(',')[1];
  const buf = Buffer.from(b64, 'base64');
  check(buf.slice(0, 4).toString() === 'RIFF', 'header RIFF');
  check(buf.slice(8, 12).toString() === 'WAVE', 'header WAVE');
  check(buf.length === 844, `panjang 844 byte (dapat ${buf.length})`);
  // fmt chunk: audioFormat=1 (PCM), channels=1, rate=8000
  check(buf.readUInt16LE(20) === 1, 'PCM');
  check(buf.readUInt16LE(22) === 1, 'mono');
  check(buf.readUInt32LE(24) === 8000, '8000 Hz');
  // semua sampel hening (0x80 = 128 = silence untuk 8-bit unsigned)
  const data = buf.slice(44);
  check(data.every(b => b === 0x80), 'seluruh sampel hening');
}

console.log('\n─────────────────────────────');
console.log(`PASS: ${pass}   FAIL: ${fail}`);
process.exit(fail === 0 ? 0 : 1);
