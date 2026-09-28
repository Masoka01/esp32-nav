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

// Catatan: endMarker dicari MAJUN dari startMarker. Kalau dua fungsi punya
// baris penutup yang sama dan yang salah urut, blok akan terpotong di tengah
// dan menghasilkan SyntaxError — bukan kegagalan test yang enak dibaca.
const src = [
  block('function validLatLng', '      && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;\n}'),
  block('const TRIP_KEY', '  try { sessionStorage.removeItem(TRIP_KEY); } catch { /* abaikan */ }\n}'),
  block('function setUserPos', '  if (state.navigating) checkStepProgress(lat, lng);\n}'),
  // restoreTrip + completeRestore sengaja diambil sebagai satu blok berurutan.
  block('async function restoreTrip', '  if (state.navigating) startWatch();\n}'),
  block('async function selectDestination', '  setInstruction(\'⏳\', \'Menghitung rute...\');\n  await fetchRoute();\n}'),
  block('function startWatch', '  }, null, { enableHighAccuracy: true, maximumAge: 2000 });\n}'),
  block('function stopNavigation', '  toast(\'Navigasi dihentikan\');\n}'),
].join('\n\n');

// Guard: blok yang terekstrak harus utuh, kalau tidak test menguji kode hantu.
check(src.includes('function restoreTrip'), 'blok restoreTrip ikut terekstrak utuh');
check(src.includes('function completeRestore'), 'blok completeRestore ikut terekstrak utuh');
check(src.includes('function saveTrip'), 'blok saveTrip ikut terekstrak utuh');
check(src.includes('function loadTrip'), 'blok loadTrip ikut terekstrak utuh');
check(src.includes('function setUserPos'), 'blok setUserPos ikut terekstrak utuh');
check(src.includes('function startWatch'), 'blok startWatch ikut terekstrak utuh');
check(src.includes('function stopNavigation'), 'blok stopNavigation ikut terekstrak utuh');

// Guard kedua: tidak boleh ada blok yang terpotong di tengah. Kembalinya
// braces harus seimbang; ini menangkap kasus endMarker yang salah pilih
// jauh sebelum Node melempar SyntaxError yang membingungkan.
{
  let depth = 0, opened = false;
  for (const ch of src) {
    if (ch === '{') { depth++; opened = true; }
    else if (ch === '}') depth--;
  }
  check(opened && depth === 0, 'kurung kurawal seimbang, depth=' + depth);
}

// ── lingkungan tiruan ───────────────────────────────────────────────────
const store = new Map();
const sessionStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
};

const calls = { toast: [], instr: [], marker: [], nav: 0, ui: 0, watch: 0, clearWatch: 0, released: 0 };
const searchInput = { value: '' };
let markerObj = null;
const L = { marker: ll => { calls.marker.push(ll); return (markerObj = { setLatLng() {}, addTo() { return markerObj; } }); } };

// navigator tiruan: watchPosition langsung memanggil callback sinkron supaya
// alur pemulihkan bisa diuji tanpa menunggu waktu nyata.
const navigator = {
  geolocation: {
    watchPosition(cb) { calls.watch++; cb({ coords: { latitude: -6.2001, longitude: 106.8001 } }); return 77; },
    clearWatch() { calls.clearWatch++; },
  },
};

function freshState(extra = {}) {
  return {
    destLat: null, destLng: null, destName: null,
    currentStep: 0, steps: [], destMarker: null, navigating: false,
    pendingRestore: null,
    userLat: null, userLng: null, userMarker: null, watchId: null, ...extra,
  };
}

// fetchRoute harus bisa diganti per-test: beberapa test butuh ia benar-benar
// mengisi steps supaya clamp langkah bisa dibuktikan, bukan sekadar dicek
// bahwa fetchRoute benar-benar dipanggil.
let routeSteps = [];
let routeCalls = 0;
async function defaultFetchRoute() {
  routeCalls++;
  state_ref.steps = routeSteps.slice();
}

// Dipakai stub updateInstructionUI meniru perilaku yang asli: teks yang
// tampil mengikuti state.currentStep. Kalau tidak, test tidak membuktikan
// apa pun soal langkah mana yang benar-benar ditampilkan.
let state_ref = null;

function makeEnv(state, opts = {}) {
  state_ref = state;
  const fetchImpl = opts.fetchRoute || defaultFetchRoute;
  const factory = new Function(
    'state', 'sessionStorage', 'L', 'destIcon', 'userIcon', 'map', 'searchInput', 'navigator',
    'toast', 'setInstruction', 'fetchRoute', 'showNavControls', 'updateInstructionUI',
    'checkStepProgress', 'releaseWakeLock',
    src + '\nreturn { saveTrip, loadTrip, clearStoredTrip, restoreTrip, setUserPos, selectDestination, stopNavigation, startWatch, validLatLng };'
  );
  return factory(state, sessionStorage, L, {}, {}, {}, searchInput, navigator,
    m => calls.toast.push(m), (i, t) => calls.instr.push(t), fetchImpl,
    () => calls.nav++,
    () => {
      calls.ui++;
      const s = state.steps[state.currentStep];
      if (s) calls.instr.push(s.instruction);
    },
    () => {},
    () => calls.released++);
}

const flush = () => new Promise(r => setTimeout(r, 0));

// Penghitung di atas bersifat bersama. Kalau tidak direset per-section, test
// berikutnya gagal bukan karena perilakunya salah, tapi karena angka sisa
// dari test sebelumnya ikut terhitung — kegagalan palsu yang sangat mudah
// disalahartikan sebagai bug di kode produksi.
function resetCalls() {
  calls.toast.length = 0;
  calls.instr.length = 0;
  calls.marker.length = 0;
  calls.nav = 0;
  calls.ui = 0;
  calls.watch = 0;
  calls.clearWatch = 0;
  calls.released = 0;
}

// ── simpan & baca balik ──────────────────────────────────────────────────
section('simpan & baca balik');
{
  resetCalls();
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

// ── status navigasi ikut tersimpan ───────────────────────────────────────
section('status navigasi ikut tersimpan');
{
  store.clear();
  resetCalls();
  const state = freshState({ navigating: true });
  const api = makeEnv(state);
  state.destLat = -7.445; state.destLng = 112.358; state.destName = 'X';
  api.saveTrip();

  check(api.loadTrip().navigating === true, 'navigating:true ikut tersimpan');

  // Payload lama (sebelum key ini ada) tidak punya properti navigating.
  // Harus dibaca false — kalau `t.navigating || false` tanpa `!!`, undefined
  // akan lolos sebagai "sedang navigasi".
  store.set('esp32nav.trip', JSON.stringify({ lat: -7.445, lng: 112.358, name: 'X', step: 0 }));
  const legacy = api.loadTrip();
  check(legacy.navigating === undefined, 'payload lama memang tidak punya key navigating');
  check(!!legacy.navigating === false, 'payload lama dibaca sebagai bukan navigasi');
}

// ── tidak ada tujuan → tidak ada yang ditulis ────────────────────────────
section('tidak ada tujuan → tidak ada yang ditulis');
{
  store.clear();
  resetCalls();
  const api = makeEnv(freshState());
  api.saveTrip();
  check(!store.has('esp32nav.trip'), 'tujuan kosong tidak bikin entri');
}

// ── refresh tanpa GPS: tujuan tetap muncul, restore MENUNGGU ─────────────
section('refresh tanpa GPS: restore ditunda, tidak dibuang');
{
  store.clear();
  resetCalls();
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

  // INI inti perbaikannya. Versi lamarestoreTrip() return permanen di sini
  // karena userLat selalu null saat halaman baru dimuat — getCurrentPosition
  // async, restoreTrip sinkron. Akibatnya rute tidak pernah dihitung ulang
  // dan user terjebak di "tujuan ada, rute tidak ada".
  check(state.pendingRestore !== null,
        'restore yang tertunda DISIMPAN, bukan dibuang');
  check(routeCalls === 0, 'belum ada fetch rute tanpa posisi GPS');
}

// ── posisi pertama menyelesaikan restore yang tertunda ────────────────────
section('posisi pertama menyelesaikan restore tertunda');
{
  store.clear();
  resetCalls();
  routeCalls = 0;
  routeSteps = [{ instruction: 'step 0' }, { instruction: 'step 1' }, { instruction: 'step 2' }];
  const state = freshState();
  const api = makeEnv(state);
  store.set('esp32nav.trip', JSON.stringify({ lat: -7.445, lng: 112.358, name: 'X', step: 1 }));
  searchInput.value = '';

  await api.restoreTrip();
  check(state.pendingRestore !== null, 'masih tertunda sebelum ada posisi');

  // Inilah yang tidak pernah terjadi di versi lama: setUserPos melanjutkan
  // perjalanan yang tertunda begitu koordinat pertama masuk.
  api.setUserPos(-6.2001, 106.8001);
  await flush();

  check(state.pendingRestore === null, 'pendingRestore dibersihkan setelah selesai');
  check(routeCalls === 1, 'rute dihitung ulang setelah posisi pertama tiba');
  check(state.currentStep === 1, 'langkah tersimpan dipulihkan, dapat ' + state.currentStep);
  check(calls.nav === 1, 'kontrol navigasi diaktifkan');
  check(searchInput.value === 'X', 'nama tujuan tetap terisi setelah pemulihan');
}

// ── clamp juga berlaku di jalur tertunda ─────────────────────────────────
section('clamp langkah di jalur tertunda');
{
  store.clear();
  resetCalls();
  routeCalls = 0;
  // Rute hasil hitung ulang lebih pendek dari langkah yang tersimpan.
  routeSteps = [{ instruction: 'only step' }];
  const state = freshState();
  const api = makeEnv(state);
  store.set('esp32nav.trip', JSON.stringify({ lat: -7.445, lng: 112.358, name: 'X', step: 99 }));

  await api.restoreTrip();
  api.setUserPos(-6.2001, 106.8001);
  await flush();

  check(state.currentStep === 0,
        'langkah di-clamp ke panjang rute - 1, dapat ' + state.currentStep);
  check(calls.instr.includes('only step'), 'instruksi yang ditampilkan sesuai langkah tersimpan');
}

// ── refresh saat sedang bernavigasi: GPS watch dilanjutkan ─────────────
section('refresh saat bernavigasi: watch dilanjutkan, wake lock tidak');
{
  store.clear();
  resetCalls();
  routeCalls = 0;
  routeSteps = [{ instruction: 'a' }, { instruction: 'b' }];
  const state = freshState();
  const api = makeEnv(state);
  store.set('esp32nav.trip', JSON.stringify({
    lat: -7.445, lng: 112.358, name: 'X', step: 1, navigating: true,
  }));

  await api.restoreTrip();

  check(state.navigating === true, 'status sedang bernavigasi dipulihkan');
  // Kontrol navigasi BELUM muncul di sini: tanpa posisi GPS, rute belum
  // dihitung, jadi tidak ada yang bisa ditampilkan. Assertion ini sengaja
  // diletakkan setelah setUserPos di bawah.
  check(calls.nav === 0, 'kontrol navigasi belum muncul sebelum rute ada');

  // Watch dilanjutkan: tanpa ini, checkStepProgress tidak pernah jalan lagi
  // dan user diam-diam kehilangan progres di tengah perjalanan.
  api.setUserPos(-6.2001, 106.8001);
  await flush();
  check(calls.nav === 1, 'kontrol navigasi muncul setelah rute dihitung ulang');
  check(calls.watch === 1, 'GPS watch dilanjutkan, dapat ' + calls.watch);

  // Wake lock TIDAK boleh diminta diam-diam: butuh user gesture, dan
  // memulihkannya tanpa gestur menghasilkan state yang rusak.
  check(calls.released === 0, 'wake lock tidak diminta diam-diam saat pemulihan');
}

// ── tujuan baru / stop membuang restore yang tertunda ────────────────────
section('restore tertunda dibuang oleh aksi user');
{
  store.clear();
  resetCalls();
  routeCalls = 0;
  routeSteps = [{ instruction: 'a' }];
  const state = freshState();
  const api = makeEnv(state);
  store.set('esp32nav.trip', JSON.stringify({ lat: -7.445, lng: 112.358, name: 'Lama', step: 0 }));

  await api.restoreTrip();
  check(state.pendingRestore !== null, 'tertunda dulu');

  await api.selectDestination(-7.4, 112.3, 'Baru');
  check(state.pendingRestore === null,
        'memilih tujuan baru membuang restore tertunda');
  check(state.destName === 'Baru', 'tujuan baru yang berlaku');
}
{
  store.clear();
  resetCalls();
  routeCalls = 0;
  routeSteps = [{ instruction: 'a' }];
  const state = freshState();
  const api = makeEnv(state);
  store.set('esp32nav.trip', JSON.stringify({ lat: -7.445, lng: 112.358, name: 'Lama', step: 0 }));

  await api.restoreTrip();
  check(state.pendingRestore !== null, 'tertunda dulu');

  api.stopNavigation();
  check(state.pendingRestore === null,
        'stopNavigation membuang restore tertunda');
  check(state.navigating === false, 'status navigasi dimatikan');
}

// ── storage rusak tidak boleh melempar ───────────────────────────────────
section('storage rusak & di luar rentang');
{
  store.clear();
  resetCalls();
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
