// Test persistensi perjalanan: tujuan harus selamat dari refresh.
//
// Fungsi diambil langsung dari index.html (bukan disalin), jadi test ini
// menguji kode yang benar-benar berjalan di browser.
//
// Dipasang dengan stub DOM/sessionStorage minimum — tidak butuh browser.
//
// Run:  node test/test_trip.mjs
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(here, '..', 'index.html'), 'utf8');

let pass = 0, fail = 0;
const section = n => console.log('== ' + n + ' ==');
function check(cond, what) {
  if (cond) { pass++; return; }
  fail++;
  console.log('  FAIL: ' + what);
}

function block(startMarker, endMarker) {
  const a = html.indexOf(startMarker);
  if (a < 0) throw new Error('tidak menemukan: ' + startMarker);
  const b = html.indexOf(endMarker, a);
  if (b < 0) throw new Error('tidak menemukan akhir untuk: ' + startMarker);
  return html.slice(a, b + endMarker.length);
}

const src = [
  block('function validLatLng', '      && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;\n}'),
  block('const TRIP_KEY', '  try { sessionStorage.removeItem(TRIP_KEY); } catch { /* abaikan */ }\n}'),
  block('async function restoreTrip', '    showNavControls();\n    updateInstructionUI();\n  }\n}'),
].join('\n\n');

// Guard: blok yang terekstrak harus utuh, kalau tidak test menguji kode hantu.
check(src.includes('function restoreTrip'), 'blok restoreTrip ikut terekstrak utuh');
check(src.includes('function saveTrip'), 'blok saveTrip ikut terekstrak utuh');
check(src.includes('function loadTrip'), 'blok loadTrip ikut terekstrak utuh');

// ── lingkungan tiruan ───────────────────────────────────────────────────
const store = new Map();
const sessionStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
};

const calls = { toast: [], instr: [], marker: [], nav: 0, ui: 0 };
const searchInput = { value: '' };
let markerObj = null;
const L = { marker: ll => { calls.marker.push(ll); return (markerObj = { setLatLng() {}, addTo() { return markerObj; } }); } };

function freshState(extra = {}) {
  return {
    destLat: null, destLng: null, destName: null,
    currentStep: 0, steps: [], destMarker: null, navigating: false,
    userLat: null, userLng: null, ...extra,
  };
}

// Tiap environment punya state sendiri supaya pengujian tidak saling menimpa.
function makeEnv(state) {
  const factory = new Function(
    'state', 'sessionStorage', 'L', 'destIcon', 'map', 'searchInput',
    'toast', 'setInstruction', 'fetchRoute', 'showNavControls', 'updateInstructionUI',
    src + '\nreturn { saveTrip, loadTrip, clearStoredTrip, restoreTrip, validLatLng };'
  );
  return factory(state, sessionStorage, L, {}, {}, searchInput,
    m => calls.toast.push(m), (i, t) => calls.instr.push(t),
    async () => {},
    () => calls.nav++,
    // Stub ini harus meniru updateInstructionUI yang asli: teks yang tampil
    // mengikuti state.currentStep. Kalau tidak, test tidak membuktikan apa pun
    // soal langkah mana yang benar-benar ditampilkan.
    () => {
      calls.ui++;
      const s = state.steps[state.currentStep];
      if (s) calls.instr.push(s.instruction);
    });
}

// ── simpan & baca balik ──────────────────────────────────────────────────
section('simpan & baca balik');
{
  const state = freshState();
  const api = makeEnv(state);
  state.destLat = -7.4450072; state.destLng = 112.3587988;
  state.destName = 'WH-2 ARCHER'; state.currentStep = 2;
  api.saveTrip();

  check(store.has('esp32nav.trip'), 'saveTrip menulis entri');
  const raw = JSON.parse(store.get('esp32nav.trip'));
  check(raw.name === 'WH-2 ARCHER', 'nama ikut tersimpan');
  check(raw.step === 2, 'langkah ikut tersimpan');

  const back = api.loadTrip();
  check(back.lat === -7.4450072 && back.lng === 112.3587988, 'koordinat balik utuh');
  check(back.step === 2, 'langkah balik utuh');
}

// ── tidak ada tujuan → tidak ada yang ditulis ────────────────────────────
section('tidak ada tujuan → tidak ada yang ditulis');
{
  store.clear();
  const api = makeEnv(freshState());
  api.saveTrip();
  check(!store.has('esp32nav.trip'), 'tujuan kosong tidak bikin entri');
}

// ── refresh tanpa GPS: tujuan tetap muncul ──────────────────────────────
section('refresh tanpa GPS: tujuan tetap muncul');
{
  store.clear();
  calls.marker.length = 0;
  const state = freshState();          // state benar-benar baru = hasil refresh
  const api = makeEnv(state);
  store.set('esp32nav.trip', JSON.stringify({ lat: -7.4450072, lng: 112.3587988, name: 'WH-2 ARCHER', step: 0 }));

  await api.restoreTrip();

  check(state.destLat === -7.4450072, 'destLat pulih');
  check(state.destLng === 112.3587988, 'destLng pulih');
  check(state.destName === 'WH-2 ARCHER', 'nama tujuan pulih');
  check(searchInput.value === 'WH-2 ARCHER', 'kotak pencarian terisi ulang');
  check(calls.marker.length === 1, 'marker digambar ulang');
  check(calls.marker[0] && calls.marker[0][0] === -7.4450072, 'marker di koordinat yang benar');
  check(calls.toast.some(m => /dipulihkan/.test(m)), 'user diberi tahu tujuan dipulihkan');

  // Melanjutkan navigasi tanpa user gesture akan menghasilkan state rusak:
  // checkStepProgress & wake lock mengambul hal yang tidak ada.
  check(state.navigating === false, 'TIDAK diam-diam menyatakan sedang navigasi');
  check(calls.nav === 0, 'kontrol navigasi tidak diaktifkan paksa');
}

// ── refresh dengan GPS: rute dihitung ulang, langkah di-clamp ────────────
section('refresh dengan GPS: langkah di-clamp');
{
  store.clear();
  const steps = Array.from({ length: 3 }, (_, i) => ({ instruction: 'step ' + i }));
  const state = freshState({ userLat: -6.2, userLng: 106.8, steps });
  const api = makeEnv(state);
  // Langkah 99 melompat jauh melewati panjang rute.
  store.set('esp32nav.trip', JSON.stringify({ lat: -7.445, lng: 112.358, name: 'X', step: 99 }));

  await api.restoreTrip();

  check(state.currentStep === 2,
        'currentStep di-clamp ke panjang rute - 1, dapat ' + state.currentStep);
  check(calls.instr.includes('step 2'), 'instruksi yang ditampilkan sesuai langkah tersimpan');
}

// ── storage rusak tidak boleh melempar ───────────────────────────────────
section('storage rusak & di luar rentang');
{
  store.clear();
  const api = makeEnv(freshState());

  store.set('esp32nav.trip', 'bukan json');
  check((await api.loadTrip()) === null, 'JSON rusak ditolak, tidak melempar');

  store.set('esp32nav.trip', JSON.stringify({ lat: 999, lng: 999, name: 'X', step: 0 }));
  check((await api.loadTrip()) === null, 'koordinat di luar rentang ditolak');

  store.set('esp32nav.trip', JSON.stringify({ lat: -7.4, lng: 112.3, name: 'X', step: 0 }));
  api.clearStoredTrip();
  check(!store.has('esp32nav.trip'), 'clearStoredTrip menghapus entri');
}

console.log('\n─────────────────────────────');
console.log('PASS: ' + pass + '   FAIL: ' + fail);
process.exit(fail === 0 ? 0 : 1);
