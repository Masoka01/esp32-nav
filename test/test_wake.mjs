// Uji logika wake lock dari index.html.
//
// Meng-ekstrak kode NYATA dari index.html, bukan menyalinnya, supaya test
// ikut gagal kalau implementasinya berubah.
//
// Yang diuji: apakah layar benar-benar dijaga selama navigasi, apakah
// lock tidak pernah dobel, apakah sentinel dari sistem dilaporkan ke user,
// dan apakah kegagalan request terlihat (bukan diam-diam).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');   // path relatif, bukan absolut:
                                         // test harus jalan setelah repo dipindah.

let pass = 0, fail = 0;
const check = (cond, what) => {
  if (cond) pass++;
  else { fail++; console.log(`  FAIL: ${what}`); }
};
const section = s => console.log(`\n== ${s} ==`);

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
function extract(startMarker, endMarker) {
  const a = html.indexOf(startMarker);
  if (a < 0) throw new Error(`tidak menemukan: ${startMarker}`);
  const b = html.indexOf(endMarker, a);
  if (b < 0) throw new Error(`tidak menemukan end: ${endMarker}`);
  return html.slice(a, b + endMarker.length);
}

// Ambil blok dari awal (termasuk pembentuk WAV) sampai akhir
// handleVisibilityChange. Listener document/window sengaja TIDAK ikut
// diambil supaya test bisa memasang dan memverifikasinya sendiri.
const wakeSrc = extract('function silentWavDataUri', '\n  requestWakeLock();\n}');

// ── mock ──
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

function makeEnv({ hasApi = true, requestImpl } = {}) {
  const cls = new Set(['hidden']);
  const note = {
    textContent: '',
    classList: {
      add: c => cls.add(c),
      remove: c => cls.delete(c),
      contains: c => cls.has(c),
      toggle(c, force) {
        if (force === undefined) { cls.has(c) ? cls.delete(c) : cls.add(c); return cls.has(c); }
        force ? cls.add(c) : cls.delete(c);
        return !!force;
      },
    },
  };
  const doc = {
    visibilityState: 'visible',
    getElementById: id => (id === 'awake-note' ? note : null),
  };
  const nav = {};
  if (hasApi) {
    nav.wakeLock = {
      request: requestImpl || (async () => makeSentinel()),
    };
  }
  const audioLog = [];
  class AudioMock {
    constructor(src) { this.src = src; audioLog.push(this); }
    play() { this.played = true; return Promise.resolve(); }
    pause() { this.played = false; }
  }
  const state = { navigating: true, wakeLock: null };

  const api = new Function(
    'state', 'navigator', 'document', 'Audio',
    `${wakeSrc}\nreturn { requestWakeLock, releaseWakeLock, handleVisibilityChange,`
      + ` setAwakeNote, getKeepAwakeAudio: () => keepAwakeAudio };`
  )(state, nav, doc, AudioMock);

  return {
    state, nav, doc, note, audioLog, api,
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
  const mod = new Function('state', 'navigator', 'document', 'Audio',
    `${wakeSrc}\nreturn { requestWakeLock };`
  )(env.state, env.nav, env.doc, function () { throw new Error('blocked'); });
  const { requestWakeLock } = mod;

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
