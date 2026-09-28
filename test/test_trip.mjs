// Test persistensi perjalanan: tujuan harus selamat dari refresh.
//
// Modul src/ di-import sungguhan, bukan dikiris dari index.html. Stub DOM-nya
// dipasang lebih dulu lewat installStubs(), baru import-nya dilakukan dengan
// import() DINAMIS — import statis akan di-hoist dan berjalan sebelum stub siap.
//
// Bedanya dengan versi lama dan kenapa ini lebih baik:
//   - dulu: blok kode dicari dengan marker, lalu di-eval dengan stub suntikan.
//     Ganti satu baris di index.html dan test hancur, padahal perilakunya benar.
//   - sekarang: test memanggil kode yang benar-benar terkirim ke browser, dan
//     ikut gagal kalau ada import yang rusak atau salah nama.
//
// Run:  node test/test_trip.mjs
import {
  installStubs, load, resetAll, calls, el, mem,
  freshState, bindState, osrmBody, stubFetch, routeCalls,
  toasts, instr, navVisible, confirmVisible, confirmText, searchValue,
} from './helpers/env.mjs';

installStubs();

const { state } = await load('src/state.js');
bindState(state);
const store_ = await load('src/store.js');
const route_ = await load('src/route.js');
const nav_   = await load('src/nav.js');
const share_ = await load('src/share.js');
const parse_ = await load('src/parse.js');

let pass = 0, fail = 0;
const section = n => console.log('== ' + n + ' ==');
function check(cond, what) {
  if (cond) { pass++; return; }
  fail++;
  console.log('  FAIL: ' + what);
}

const flush = () => new Promise(r => setTimeout(r, 0));

/**
 * Siapkan satu skenario: state kosong, storage kosong, penghitung direset,
 * dan respons OSRM dengan langkah yang diminta.
 */
function scenario(steps = [{ name: 'a' }]) {
  resetAll();
  freshState();
  el('search-input').value = '';
  el('maps-confirm').style.display = '';
  stubFetch('router.project-osrm.org', osrmBody({ steps }));
  return {
    saveTrip: store_.saveTrip,
    loadTrip: store_.loadTrip,
    clearStoredTrip: store_.clearStoredTrip,
    restoreTrip: store_.restoreTrip,
    setUserPos: nav_.setUserPos,
    selectDestination: route_.selectDestination,
    stopNavigation: nav_.stopNavigation,
    startWatch: nav_.startWatch,
    validLatLng: parse_.validLatLng,
  };
}

// ── simpan & baca balik ──────────────────────────────────────────────────
section('simpan & baca balik');
{
  const api = scenario();
  state.destLat = -7.4450072; state.destLng = 112.3587988;
  state.destName = 'WH-2 ARCHER'; state.currentStep = 2;
  api.saveTrip();

  check(mem.has('esp32nav.trip'), 'saveTrip menulis entri');
  const raw = JSON.parse(mem.get('esp32nav.trip'));
  check(raw.name === 'WH-2 ARCHER', 'nama ikut tersimpan');
  check(raw.step === 2, 'langkah ikut tersimpan');

  const back = api.loadTrip();
  check(back.lat === -7.4450072 && back.lng === 112.3587988, 'koordinat balik utuh');
  check(back.step === 2, 'langkah balik utuh');
}

// ── status navigasi ikut tersimpan ───────────────────────────────────────
section('status navigasi ikut tersimpan');
{
  const api = scenario();
  state.destLat = -7.445; state.destLng = 112.358; state.destName = 'X';
  state.navigating = true;
  api.saveTrip();

  check(api.loadTrip().navigating === true, 'navigating:true ikut tersimpan');

  // Payload lama (sebelum key ini ada) tidak punya properti navigating.
  // Harus dibaca false — kalau `t.navigating || false` tanpa `!!`, undefined
  // akan lolos sebagai "sedang navigasi".
  mem.set('esp32nav.trip', JSON.stringify({ lat: -7.445, lng: 112.358, name: 'X', step: 0 }));
  const legacy = api.loadTrip();
  check(legacy.navigating === undefined, 'payload lama memang tidak punya key navigating');
  check(!!legacy.navigating === false, 'payload lama dibaca sebagai bukan navigasi');
}

// ── tidak ada tujuan → tidak ada yang ditulis ────────────────────────────
section('tidak ada tujuan → tidak ada yang ditulis');
{
  const api = scenario();
  api.saveTrip();
  check(!mem.has('esp32nav.trip'), 'tujuan kosong tidak bikin entri');
}

// ── refresh tanpa GPS: tujuan tetap muncul, restore MENUNGGU ─────────────
section('refresh tanpa GPS: restore ditunda, tidak dibuang');
{
  const api = scenario();
  mem.set('esp32nav.trip', JSON.stringify({ lat: -7.4450072, lng: 112.3587988, name: 'WH-2 ARCHER', step: 0 }));

  await api.restoreTrip();

  check(state.destLat === -7.4450072, 'destLat pulih');
  check(state.destLng === 112.3587988, 'destLng pulih');
  check(state.destName === 'WH-2 ARCHER', 'nama tujuan pulih');
  check(searchValue() === 'WH-2 ARCHER', 'kotak pencarian terisi ulang');
  check(calls.marker.length === 1, 'marker digambar ulang');
  check(calls.marker[0] && calls.marker[0][0] === -7.4450072, 'marker di koordinat yang benar');
  check(toasts().some(m => /dipulihkan/.test(m)), 'user diberi tahu tujuan dipulihkan');

  // Melanjutkan navigasi tanpa user gesture akan menghasilkan state rusak:
  // checkStepProgress & wake lock mengambul hal yang tidak ada.
  check(state.navigating === false, 'TIDAK diam-diam menyatakan sedang navigasi');
  check(!navVisible(), 'kontrol navigasi tidak diaktifkan paksa');

  // INI inti perbaikannya. Versi lama restoreTrip() return permanen di sini
  // karena userLat selalu null saat halaman baru dimuat — getCurrentPosition
  // async, restoreTrip sinkron. Akibatnya rute tidak pernah dihitung ulang
  // dan user terjebak di "tujuan ada, rute tidak ada".
  check(state.pendingRestore !== null, 'restore yang tertunda DISIMPAN, bukan dibuang');
  check(routeCalls() === 0, 'belum ada fetch rute tanpa posisi GPS');
}

// ── posisi pertama menyelesaikan restore yang tertunda ────────────────────
section('posisi pertama menyelesaikan restore tertunda');
{
  const api = scenario([{ name: 'step 0' }, { name: 'step 1' }, { name: 'step 2' }]);
  mem.set('esp32nav.trip', JSON.stringify({ lat: -7.445, lng: 112.358, name: 'X', step: 1 }));

  await api.restoreTrip();
  check(state.pendingRestore !== null, 'masih tertunda sebelum ada posisi');

  // Inilah yang tidak pernah terjadi di versi lama: setUserPos melanjutkan
  // perjalanan yang tertunda begitu koordinat pertama masuk.
  api.setUserPos(-6.2001, 106.8001);
  await flush();

  check(state.pendingRestore === null, 'pendingRestore dibersihkan setelah selesai');
  check(routeCalls() === 1, 'rute dihitung ulang setelah posisi pertama tiba');
  check(state.currentStep === 1, 'langkah tersimpan dipulihkan, dapat ' + state.currentStep);
  check(navVisible(), 'kontrol navigasi diaktifkan');
  check(searchValue() === 'X', 'nama tujuan tetap terisi setelah pemulihan');
}

// ── clamp juga berlaku di jalur tertunda ─────────────────────────────────
section('clamp langkah di jalur tertunda');
{
  const api = scenario([{ name: 'only step' }]);
  // Rute hasil hitung ulang lebih pendek dari langkah yang tersimpan.
  mem.set('esp32nav.trip', JSON.stringify({ lat: -7.445, lng: 112.358, name: 'X', step: 99 }));

  await api.restoreTrip();
  api.setUserPos(-6.2001, 106.8001);
  await flush();

  check(state.currentStep === 0,
        'langkah di-clamp ke panjang rute - 1, dapat ' + state.currentStep);
  check(instr().some(t => /only step/.test(t)),
        'instruksi yang ditampilkan sesuai langkah tersimpan, dapat ' + JSON.stringify(instr()));
}

// ── refresh saat sedang bernavigasi: GPS watch dilanjutkan ─────────────
section('refresh saat bernavigasi: watch dilanjutkan, wake lock tidak');
{
  const api = scenario([{ name: 'a' }, { name: 'b' }]);
  mem.set('esp32nav.trip', JSON.stringify({
    lat: -7.445, lng: 112.358, name: 'X', step: 1, navigating: true,
  }));

  await api.restoreTrip();

  check(state.navigating === true, 'status sedang bernavigasi dipulihkan');
  // Kontrol navigasi BELUM muncul di sini: tanpa posisi GPS, rute belum
  // dihitung, jadi tidak ada yang bisa ditampilkan. Assertion ini sengaja
  // diletakkan setelah setUserPos di bawah.
  check(!navVisible(), 'kontrol navigasi belum muncul sebelum rute ada');

  // Watch dilanjutkan: tanpa ini, checkStepProgress tidak pernah jalan lagi
  // dan user diam-diam kehilangan progres di tengah perjalanan.
  api.setUserPos(-6.2001, 106.8001);
  await flush();
  check(navVisible(), 'kontrol navigasi muncul setelah rute dihitung ulang');
  check(calls.watch === 1, 'GPS watch dilanjutkan, dapat ' + calls.watch);

  // Wake lock TIDAK boleh diminta diam-diam: butuh user gesture, dan
  // memulihkannya tanpa gestur menghasilkan state yang rusak.
  check(calls.released === 0, 'wake lock tidak diminta diam-diam saat pemulihan');
}

// ── tujuan baru / stop membuang restore yang tertunda ────────────────────
section('restore tertunda dibuang oleh aksi user');
{
  const api = scenario();
  mem.set('esp32nav.trip', JSON.stringify({ lat: -7.445, lng: 112.358, name: 'Lama', step: 0 }));

  await api.restoreTrip();
  check(state.pendingRestore !== null, 'tertunda dulu');

  await api.selectDestination(-7.4, 112.3, 'Baru');
  check(state.pendingRestore === null, 'memilih tujuan baru membuang restore tertunda');
  check(state.destName === 'Baru', 'tujuan baru yang berlaku');
}
{
  const api = scenario();
  mem.set('esp32nav.trip', JSON.stringify({ lat: -7.445, lng: 112.358, name: 'Lama', step: 0 }));

  await api.restoreTrip();
  check(state.pendingRestore !== null, 'tertunda dulu');

  api.stopNavigation();
  check(state.pendingRestore === null, 'stopNavigation membuang restore tertunda');
  check(state.navigating === false, 'status navigasi dimatikan');
}

// ── share tanpa GPS: tujuan menunggu, rute tidak hilang ──────────────────
section('share tanpa GPS: rute ditunda, bukan dibuang');
{
  const api = scenario();

  // Persis kondisi saat share target dibuka: getCurrentPosition async,
  // jadi userLat masih null ketika user menekan "Pakai tujuan ini".
  await api.selectDestination(-7.445, 112.358, 'WH-2 ARCHER');

  check(state.destLat === -7.445, 'tujuan tetap dipilih');
  check(state.pendingRoute !== null, 'tujuan yang menunggu GPS DISIMPAN');
  check(routeCalls() === 0, 'belum ada fetch rute tanpa posisi');

  // Versi lama: toast "Aktifkan GPS dulu" lalu return. Toast hilang dalam
  // 2.5 detik dan tidak ada percobaan ulang, jadi user terkunci di
  // "tujuan ada, rute tidak ada" selamanya.
  check(!toasts().some(m => /Aktifkan GPS dulu/.test(m)),
        'tidak lagi menebak user harus mengaktifkan GPS');
  check(instr().some(t => /Menunggu GPS/.test(t)),
        'user diberi tahu rute sedang menunggu GPS, dapat ' + JSON.stringify(instr()));
}

section('posisi pertama menyelesaikan rute yang tertunda');
{
  const api = scenario([{ name: 'a' }, { name: 'b' }]);

  await api.selectDestination(-7.445, 112.358, 'WH-2 ARCHER');
  check(state.pendingRoute !== null, 'masih tertunda sebelum ada posisi');

  api.setUserPos(-6.2001, 106.8001);
  await flush();

  check(state.pendingRoute === null, 'pendingRoute dibersihkan setelah selesai');
  check(routeCalls() === 1, 'rute DIHITUNG setelah posisi pertama tiba, dapat ' + routeCalls());
}

section('tujuan baru membuang rute tertunda');
{
  const api = scenario();

  await api.selectDestination(-7.4, 112.3, 'Pertama');
  check(state.pendingRoute !== null, 'tertunda dulu');

  await api.selectDestination(-7.5, 112.4, 'Kedua');
  check(state.pendingRoute !== null, 'tujuan kedua juga tertunda (belum ada GPS)');
  check(state.destName === 'Kedua', 'tujuan kedua yang berlaku');

  // Setelah posisi masuk, hanya yang terakhir yang boleh dihitung.
  const before = routeCalls();
  api.setUserPos(-6.2001, 106.8001);
  await flush();
  check(routeCalls() - before === 1,
        'rute yang pending itu milik tujuan terakhir, dapat ' + routeCalls());
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
//
// Tidak ada stub handleMapsInput di sini. Versi lama meng-stub-nya supaya bisa
// memeriksa "dipanggil sekali dengan link yang benar". Sekarang yang diperiksa
// justru akibatnya: link benar-benar sampai ke parser dan memunculkan dialog
// konfirmasi. Kalau share.js Salah mengimpor handleMapsInput, test ini gagal.
section('share ke aplikasi yang sudah terbuka');
{
  scenario();
  // PENTING: link ini harus benar-benar bisa diurai parseMapsLink. Test lama
  // memakai 'https://maps.google.com/?q=-6.2,106.8' sambil men-stub
  // handleMapsInput() jadi selalu true, sehingga link yang sebenarnya
  // ditolak parser ikut lolos. Sekarang parser aslinya yang dipakai, jadi
  // link harus valid: pakai bentuk /maps?q=lat,lng yang memang didukung.
  const link = 'https://www.google.com/maps?q=-6.2,106.8';
  // App sudah hidup di './' (tanpa fragment) — kondisi sebenarnya saat user
  // share untuk kedua kalinya.
  globalThis.location.hash = '#u=' + encodeURIComponent(link);

  const processed = share_.consumeIncomingLink();

  check(processed === true, 'link dari share diproses');
  check(confirmVisible(), 'dialog konfirmasi muncul');
  check(el('maps-confirm').children.length > 0, 'dialog berisi tombol aksi');
  check(globalThis.history.replaced === 1, 'fragment dibersihkan supaya refresh tidak parse ulang');
}

section('hashchange menangkap share saat app terbuka');
{
  scenario();
  const link = 'https://www.google.com/maps/place/Monas/@-6.2,106.8,17z';

  // Tidak ada fragment saat boot — listener inilah satu-satunya penjaga.
  check(share_.consumeIncomingLink() === false, 'boot tanpa fragment tidak memproses apa pun');
  check(!confirmVisible(), 'tidak ada dialog tanpa fragment');

  // Share tiba: browser mengubah hash TANPA reload.
  globalThis.location.hash = '#u=' + encodeURIComponent(link);
  share_.handleHashChange();

  check(confirmVisible(), 'hashchange memproses link yang masuk');
  check(/Monas/.test(confirmText()), 'nama tempat dari link ditampilkan, dapat ' + confirmText());
  check(globalThis.history.replaced === 1, 'fragment dibersihkan setelah diproses');
}

section('share dua kali berturut-turut');
{
  scenario();

  // Share pertama.
  globalThis.location.hash = '#u=' + encodeURIComponent('https://www.google.com/maps?q=1,1');
  share_.handleHashChange();
  check(globalThis.history.replaced === 1, 'share pertama diproses');

  // Share kedua dengan link berbeda. Karena fragment pertama sudah dibersihkan
  // lewat replaceState, hash yang baru ini tetap memicu hashchange.
  globalThis.location.hash = '#u=' + encodeURIComponent('https://www.google.com/maps?q=-6.3,106.9');
  share_.handleHashChange();
  check(globalThis.history.replaced === 2, 'share kedua juga diproses, dapat ' + globalThis.history.replaced);
  check(/-6\.30/.test(confirmText()),
        'isi dialog mengikuti link kedua, dapat ' + confirmText());
}

section('fragment tanpa link tidak dianggap share');
{
  scenario();
  globalThis.location.hash = '#lain';
  check(share_.consumeIncomingLink() === false, 'fragment lain diabaikan');
  check(!confirmVisible(), 'tidak ada dialog untuk fragment lain');
}

// ── storage rusak tidak boleh melempar ───────────────────────────────────
section('storage rusak & di luar rentang');
{
  const api = scenario();

  mem.set('esp32nav.trip', 'bukan json');
  check(api.loadTrip() === null, 'JSON rusak ditolak, tidak melempar');

  mem.set('esp32nav.trip', JSON.stringify({ lat: 999, lng: 999, name: 'X', step: 0 }));
  check(api.loadTrip() === null, 'koordinat di luar rentang ditolak');

  mem.set('esp32nav.trip', JSON.stringify({ lat: -7.4, lng: 112.3, name: 'X', step: 0 }));
  api.clearStoredTrip();
  check(!mem.has('esp32nav.trip'), 'clearStoredTrip menghapus entri');
}

console.log('\n─────────────────────────────');
console.log('PASS: ' + pass + '   FAIL: ' + fail);
process.exit(fail === 0 ? 0 : 1);
