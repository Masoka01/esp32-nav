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

// Jalur share diuji terpisah: consumeIncomingLink() menyentuh location,
// history, dan handleMapsInput — ketiganya tidak ada di factory utama, dan
// memaksanya ke sana hanya menambah parameter yang tidak pernah terpakai.
const shareSrc = [
  block('function readIncomingLink', 'try { return new URLSearchParams(hash).get(\'u\'); } catch { return null; }\n}'),
  block('function cleanIncomingLink', 'history.replaceState(null, \'\', location.pathname + location.search);\n}'),
  block('function consumeIncomingLink', 'return handleMapsInput(link);\n}'),
  block('function handleHashChange', 'consumeIncomingLink(); }'),
].join('\n\n');

check(shareSrc.includes('function readIncomingLink'), 'blok readIncomingLink ikut terekstrak utuh');
check(shareSrc.includes('function cleanIncomingLink'), 'blok cleanIncomingLink ikut terekstrak utuh');
check(shareSrc.includes('function consumeIncomingLink'), 'blok consumeIncomingLink ikut terekstrak utuh');
check(shareSrc.includes('function handleHashChange'), 'blok handleHashChange ikut terekstrak utuh');

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
    pendingRestore: null, pendingRoute: null,
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

// Env terpisah untuk jalur share. `location` dan `history` disimulasikan
// supaya test bisa mengecek apakah fragment benar-benar dibersihkan.
function makeShareEnv(initialHash, handled = []) {
  const loc = {
    hash: initialHash,
    pathname: '/app/index.html',
    search: '',
  };
  const hist = {
    replaced: 0,
    // replaceState di browser juga membersihkan hash. Stub harus menirukan
    // itu, kalau tidak test kedua (share beruntun) akan membaca hash lama.
    replaceState(_state, _title, url) {
      hist.replaced++;
      loc.hash = '';
      loc.lastUrl = url;
    },
  };
  const factory = new Function(
    'location', 'history', 'handleMapsInput',
    shareSrc + '\nreturn { readIncomingLink, cleanIncomingLink, consumeIncomingLink, handleHashChange };'
  );
  const api = factory(loc, hist, link => { handled.push(link); return true; });
  return { api, loc, hist, handled };
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

// ── share tanpa GPS: tujuan menunggu, rute tidak hilang ──────────────────
section('share tanpa GPS: rute ditunda, bukan dibuang');
{
  store.clear();
  resetCalls();
  routeCalls = 0;
  routeSteps = [{ instruction: 'a' }];
  const state = freshState();
  const api = makeEnv(state);

  // Persis kondisi saat share target dibuka: getCurrentPosition async,
  // jadi userLat masih null ketika user menekan "Pakai tujuan ini".
  await api.selectDestination(-7.445, 112.358, 'WH-2 ARCHER');

  check(state.destLat === -7.445, 'tujuan tetap dipilih');
  check(state.pendingRoute !== null, 'tujuan yang menunggu GPS DISIMPAN');
  check(routeCalls === 0, 'belum ada fetch rute tanpa posisi');

  // Versi lama: toast "Aktifkan GPS dulu" lalu return. Toast hilang dalam
  // 2.5 detik dan tidak ada percobaan ulang, jadi user terkunci di
  // "tujuan ada, rute tidak ada" selamanya.
  check(!calls.toast.some(m => /Aktifkan GPS dulu/.test(m)),
        'tidak lagi menebak user harus mengaktifkan GPS');
  check(calls.instr.some(t => /Menunggu GPS/.test(t)),
        'user diberi tahu rute sedang menunggu GPS');
}

section('posisi pertama menyelesaikan rute yang tertunda');
{
  store.clear();
  resetCalls();
  routeCalls = 0;
  routeSteps = [{ instruction: 'a' }, { instruction: 'b' }];
  const state = freshState();
  const api = makeEnv(state);

  await api.selectDestination(-7.445, 112.358, 'WH-2 ARCHER');
  check(state.pendingRoute !== null, 'masih tertunda sebelum ada posisi');

  api.setUserPos(-6.2001, 106.8001);
  await flush();

  check(state.pendingRoute === null, 'pendingRoute dibersihkan setelah selesai');
  check(routeCalls === 1, 'rute DIHITUNG setelah posisi pertama tiba, dapat ' + routeCalls);
}

section('tujuan baru membuang rute tertunda');
{
  store.clear();
  resetCalls();
  routeCalls = 0;
  routeSteps = [{ instruction: 'a' }];
  const state = freshState();
  const api = makeEnv(state);

  await api.selectDestination(-7.4, 112.3, 'Pertama');
  check(state.pendingRoute !== null, 'tertunda dulu');

  await api.selectDestination(-7.5, 112.4, 'Kedua');
  check(state.pendingRoute !== null, 'tujuan kedua juga tertunda (belum ada GPS)');
  check(state.destName === 'Kedua', 'tujuan kedua yang berlaku');

  // Setelah posisi masuk, hanya yang terakhir yang boleh calculating.
  routeCalls = 0;
  api.setUserPos(-6.2001, 106.8001);
  await flush();
  check(routeCalls === 1, 'rute yang pending itu milik tujuan terakhir, dapat ' + routeCalls);
}

// ── share ke aplikasi yang SUDAH TERBUKA ─────────────────────────────────
//
// Ini regresi untuk bug yang dilaporkan user: share dari Maps sukses, aplikasi
// terbuka, tapi tidak ada dialog dan tidak ada rute — sunyi total.
//
// Akar masalahnya: sw.js membalas POST dari share sheet dengan redirect ke
// './#u=...' — perubahan FRAGMENT saja. Kalau aplikasinya sudah terbuka di
// './', itu navigasi same-document: browser tidak reload dokumen, jadi skrip
// boot yang memanggil readIncomingLink() tidak pernah jalan lagi.
section('share ke aplikasi yang sudah terbuka');
{
  const link = 'https://maps.google.com/?q=-6.2,106.8';
  const hash = '#u=' + encodeURIComponent(link);
  const handled = [];
  const { api, loc, hist } = makeShareEnv(hash, handled);

  // App sudah hidup di './' (tanpa fragment) — kondisi sebenarnya saat user
  // share untuk kedua kalinya.
  loc.hash = hash;

  const processed = api.consumeIncomingLink();

  check(processed === true, 'link dari share diproses');
  check(handled.length === 1, 'handleMapsInput dipanggil sekali, dapat ' + handled.length);
  check(handled[0] === link, 'link diteruskan apa adanya, dapat ' + handled[0]);
  check(hist.replaced === 1, 'fragment dibersihkan supaya refresh tidak parse ulang');
}

section('hashchange menangkap share saat app terbuka');
{
  const link = 'https://www.google.com/maps/place/Monas';
  const handled = [];
  const { api, loc, hist } = makeShareEnv('', handled);

  // Tidak ada fragment saat boot — listener inilah satu-satunya penjaga.
  check(api.consumeIncomingLink() === false, 'boot tanpa fragment tidak memproses apa pun');
  check(handled.length === 0, 'tidak ada link yang diproses tanpa fragment');

  // Share tiba: browser mengubah hash TANPA reload.
  loc.hash = '#u=' + encodeURIComponent(link);
  api.handleHashChange();

  check(handled.length === 1, 'hashchange memproses link yang masuk, dapat ' + handled.length);
  check(handled[0] === link, 'isi link benar, dapat ' + handled[0]);
  check(hist.replaced === 1, 'fragment dibersihkan setelah diproses');
}

section('share dua kali berturut-turut');
{
  const handled = [];
  const { api, loc, hist } = makeShareEnv('', handled);

  // Share pertama.
  loc.hash = '#u=' + encodeURIComponent('https://maps.google.com/?q=1,1');
  api.handleHashChange();
  check(handled.length === 1, 'share pertama diproses');

  // Share kedua dengan link berbeda. Karena fragment pertama sudah dibersihkan
  // lewat replaceState, hash yang baru ini tetap memicu hashchange.
  loc.hash = '#u=' + encodeURIComponent('https://maps.google.com/?q=2,2');
  api.handleHashChange();
  check(handled.length === 2, 'share kedua juga diproses, dapat ' + handled.length);
  check(handled[1] === 'https://maps.google.com/?q=2,2', 'link kedua benar');
  check(hist.replaced === 2, 'fragment dibersihkan dua kali');
}

section('fragment tanpa link tidak dianggap share');
{
  const handled = [];
  const { api } = makeShareEnv('#lain', handled);
  check(api.consumeIncomingLink() === false, 'fragment lain diabaikan');
  check(handled.length === 0, 'tidak ada handler yang dipanggil');
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
