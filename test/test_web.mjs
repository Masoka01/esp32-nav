// Test sisi web: sanitasi, pemetaan ikon, dan format payload BLE.
//
// Modul src/ di-import sungguhan, bukan dikiris dari index.html. Stub DOM-nya
// dipasang lewat installStubs() dulu, baru import-nya memakai import() DINAMIS
// — import statis akan di-hoist dan berjalan sebelum stub siap.
//
// Bedanya dengan versi lama: dulu konstanta BLE_CHUNK_SIZE/TEXT_MAX/ICON_MAX
// diambil dengan regex dari index.html. Sekarang dibaca langsung dari
// src/ble.js, jadi test ikut gagal kalau konstantanya berubah.
//
// Pasangannya: test_cross.cpp membuktikan byte yang sama diterima firmware.
//
// Run:  node test/test_web.mjs
import { installStubs, load, resetAll, calls, el } from './helpers/env.mjs';

installStubs();

const { state } = await load('src/state.js');
const ble_   = await load('src/ble.js');
const parse_ = await load('src/parse.js');
const share_ = await load('src/share.js');
const route_ = await load('src/route.js');

let pass = 0, fail = 0;
const section = n => console.log('== ' + n + ' ==');
function check(cond, what) {
  if (cond) { pass++; return; }
  fail++;
  console.log('  FAIL: ' + what);
}

// Konstanta dibaca dari modul aslinya, bukan dari teks HTML.
const consts = {
  BLE_CHUNK_SIZE: ble_.BLE_CHUNK_SIZE,
  TEXT_MAX: ble_.TEXT_MAX,
  ICON_MAX: ble_.ICON_MAX,
};

// Dipakai badan test di bawah dengan nama yang sama seperti sebelumnya.
const api = {
  sanitizeForBLE: ble_.sanitizeForBLE,
  clampCode: ble_.clampCode,
  normalizeDist: ble_.normalizeDist,
  maneuverCode: route_.maneuverCode,
  maneuverIcon: route_.maneuverIcon,
  writeChunks: ble_.writeChunks,
  sendToBLE: ble_.sendToBLE,
  parseMapsLink: parse_.parseMapsLink,
  validLatLng: parse_.validLatLng,
  buildBookmarklet: share_.buildBookmarklet,
  readIncomingLink: share_.readIncomingLink,
};

// ── guard: modul benar-benar bisa dipakai, bukan sekadar ada ─────────────
//
// Versi lama menjaga "blok ini ikut terekstrak utuh" dengan membaca teks
// hasil ekstraksi. Sekarang tidak ada teks yang bisa dibaca, jadi yang dijaga
// adalah perilaku yang sungguhan diuji: parser harus bisa membedakan
// short link, link yang butuh geocoding, dan link berisi koordinat.
check(api.parseMapsLink('https://maps.app.goo.gl/abc123').reason === 'short-link',
      'parser mengenali short link maps.app.goo.gl');
check(api.parseMapsLink('https://goo.gl/maps/abc123').reason === 'short-link',
      'parser mengenali short link goo.gl');
check(api.parseMapsLink('https://www.google.com/maps/place/Monas').reason === 'needs-geocode',
      'parser mengenali jalur needs-geocode');
check(api.parseMapsLink('https://www.google.com/maps?q=-6.2,106.8').ok === true,
      'parser mengurai link berkoordinat');
check(api.validLatLng(-6.2, 106.8) && !api.validLatLng(999, 0),
      'validLatLng membedakan rentang sah dan tidak sah');
check(consts.TEXT_MAX === 40 && consts.ICON_MAX === 12 && consts.BLE_CHUNK_SIZE === 20,
      'konstanta BLE sesuai nilai yang di-hardcode firmware');

// Stub characteristic: mencatat setiap write beserta urutan dan async-ness.
function makeChar() {
  const log = [];
  const ch = {
    log,
    async writeValueWithResponse(chunk) {
      log.push({ chunk: new Uint8Array(chunk), kind: 'withResponse' });
      await new Promise(r => setImmediate(r));   // realistis: async
    },
    async writeValue(chunk) {
      log.push({ chunk: new Uint8Array(chunk), kind: 'plain' });
    },
  };
  return ch;
}
// ── sanitizeForBLE ──────────────────────────────────────────────────────
section('sanitizeForBLE');
{
  const s = api.sanitizeForBLE;
  check(s('') === '', 'string kosong');
  check(s('   ') === '', 'spasi semua');
  check(s('  hello  ') === 'hello', 'spasi tepi dibuang');
  check(s('a     b') === 'a b', 'spasi dalam dirapatkan');
  check(s('a|b') === 'a b', 'pipe jadi spasi (bukan dihapus)');
  check(s('a\tb') === 'a b', 'tab jadi spasi');
  check(s('a\nb') === 'a b', 'newline jadi spasi');
  check(s('a\rb') === 'a b', 'CR jadi spasi');
  check(s('Café') === 'Cafe', 'aksen dipecah via NFD');
  check(s('naïve') === 'naive', 'diaeresis dipecah');
  check(s('北京') === '', 'CJK tidak punya padanan ASCII');
  check(s('a\x00b') === 'a b', 'NUL jadi spasi');
  check(s('Jl. Sudirman No. 1') === 'Jl. Sudirman No. 1', 'alamat utuh');
  check(s('x'.repeat(100)).length === consts.TEXT_MAX,
        'dipotong ke TEXT_MAX (' + consts.TEXT_MAX + ')');
  check(s('a' + '|'.repeat(60)).split('|').length === 1,
        'tidak ada pipe yang lolos ke wire');
  check(!/[\x00-\x1F\x7F]/.test(s('a\x01b\x7Fc')), 'tidak ada byte kontrol');
}

// ── clampCode / normalizeDist ───────────────────────────────────────────
section('clampCode & normalizeDist');
{
  const c = api.clampCode;
  check(c(0) === 0, '0 tetap 0');
  check(c(12) === 12, 'batas atas 12');
  check(c(13) === 12, 'di atas batas jadi 12');
  check(c(-1) === 12, 'negatif jadi 12');
  check(c(3.4) === 3, 'pembulatan ke bawah');
  check(c(3.6) === 4, 'pembulatan ke atas');
  check(c(NaN) === 12, 'NaN jadi 12');
  check(c('abc') === 12, 'string rusak jadi 12');
  check(c(undefined) === 12, 'undefined jadi 12');

  const d = api.normalizeDist;
  check(d(120) === 120, 'bulat tetap');
  check(d(120.4) === 120, 'pembulatan ke bawah');
  check(d(120.6) === 121, 'pembulatan ke atas');
  check(d(-1) === -1, 'minus satu = tidak diketahui');
  check(d(-40) === -40, 'jarak negatif diteruskan');
  check(d(NaN) === -1, 'NaN jadi -1');
  check(d(Infinity) === -1, 'Infinity jadi -1');
  check(d('abc') === -1, 'string rusak jadi -1');
}

// ── maneuverCode ────────────────────────────────────────────────────────
section('maneuverCode');
{
  const m = api.maneuverCode;
  const cases = [
    ['depart', null, 0], ['arrive', null, 11],
    ['roundabout', null, 9], ['rotary', null, 9],
    ['roundabout turn', null, 9], ['exit roundabout', null, 9], ['exit rotary', null, 9],
    ['merge', null, 10], ['on ramp', null, 10], ['off ramp', null, 10],
    ['turn', 'uturn', 5],
    ['turn', 'slight left', 2], ['turn', 'left', 3], ['turn', 'sharp left', 4],
    ['turn', 'slight right', 6], ['turn', 'right', 7], ['turn', 'sharp right', 8],
    ['continue', null, 1], ['new name', null, 1], ['end of road', null, 1],
    ['tipeTidakDikenal', null, 12],
  ];
  for (const [type, modifier, want] of cases) {
    check(m(type, modifier) === want,
          type + (modifier ? '/' + modifier : '') + ' -> ' + want);
  }
  for (const [type, mod] of cases) {
    const v = m(type, mod);
    check(Number.isInteger(v) && v >= 0 && v <= consts.ICON_MAX,
          type + ' dalam rentang ikon');
  }
}

// ── payload & chunking ──────────────────────────────────────────────────
section('sendToBLE: format payload');
{
  const ch = makeChar();
  state.bleChar = ch;
  await api.sendToBLE(3, 'Jalan Merdeka', 120);
  const bytes = ch.log.map(e => e.chunk);
  const all = new Uint8Array(bytes.flatMap(b => [...b]));
  const text = new TextDecoder().decode(all);
  check(text === 'V1|3|120|Jalan Merdeka\n',
        'payload persis "V1|3|120|Jalan Merdeka\\n", dapat ' + JSON.stringify(text));
  check(all[all.length - 1] === 0x0A, 'diakhiri newline');
  check(text.split('|').length - 1 === 3, 'tepat 3 separator, dapat ' + (text.split('|').length - 1));
  ch.log.length = 0;
}

section('writeChunks: memecah 20 byte');
{
  const ch = makeChar();
  state.bleChar = ch;
  // 60 karakter teks -> payload jauh di atas 20 byte -> harus dipecah.
  const long = 'x'.repeat(60);
  await api.sendToBLE(1, long, 999);
  const sizes = ch.log.map(e => e.chunk.length);
  check(sizes.length > 1, 'payload panjang dipecah jadi beberapa write');
  check(sizes.every(s => s <= consts.BLE_CHUNK_SIZE),
        'tiapot write <= BLE_CHUNK_SIZE, dapat ' + sizes.join(','));
  check(sizes.slice(0, -1).every(s => s === consts.BLE_CHUNK_SIZE),
        'semua chunk penuh kecuali yang terakhir');
  const joined = new Uint8Array(ch.log.flatMap(e => [...e.chunk]));
  check(new TextDecoder().decode(joined) === 'V1|1|999|' + 'x'.repeat(40) + '\n',
        'payload utuh setelah dipecah');
  check(ch.log.every(e => e.kind === 'withResponse'),
        'memakai writeValueWithResponse bila tersedia');
  ch.log.length = 0;
}

section('writeChunks: fallback tanpa writeValueWithResponse');
{
  const log = [];
  state.bleChar = { async writeValue(c) { log.push(new Uint8Array(c)); } };
  await api.sendToBLE(1, 'abc', 10);
  check(log.length === 1, 'satu write, dapat ' + log.length);
  state.bleChar = null;
}

section('sendToBLE: tanpa koneksi & antrean');
{
  state.bleChar = null;
  const p = api.sendToBLE(1, 'x', 1);
  check(p instanceof Promise, 'return Promise walau tanpa characteristic');
  await p;

  // Dua kiriman beruntun tidak boleh saling menimpa di tengah chunk.
  const ch = makeChar();
  state.bleChar = ch;
  const order = [];
  const t0 = api.sendToBLE(1, 'AAA', 1);
  const t1 = api.sendToBLE(2, 'BBB', 2);
  await Promise.all([t0, t1]);
  for (const e of ch.log) order.push(new TextDecoder().decode(e.chunk));
  check(order[0].startsWith('V1|1|1|AAA'), 'pesan pertama lengkap');
  check(order[order.length - 1].endsWith('V1|2|2|BBB\n'), 'pesan kedua lengkap');
  check(order.some(x => x.includes('V1|2|2|BBB')), 'pesan kedua terkirim');
  state.bleChar = null;
}

section('payload: tidak pernah punya byte di luar ASCII');
{
  const ch = makeChar();
  state.bleChar = ch;
  await api.sendToBLE(9, 'Belok kiri ke Jalan Übäh–Tokyo 東京', 250);
  const all = new Uint8Array(ch.log.flatMap(e => [...e.chunk]));
  // Semua byte isi harus ASCII printable; byte terakhir adalah terminator
  // '\n' yang memang di luar rentang itu.
  check(all[all.length - 1] === 0x0A, 'terminator newline di akhir');
  check(all.slice(0, -1).every(b => b >= 0x20 && b < 0x7F),
        'semua byte isi ASCII printable');
  const t = new TextDecoder().decode(all);
  check(/^V1\|9\|250\|/.test(t), 'header payload benar, dapat ' + JSON.stringify(t.slice(0, 14)));
  state.bleChar = null;
}

// ── parseMapsLink ────────────────────────────────────────────────────────
section('parseMapsLink');
{
  const p = api.parseMapsLink;
  const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

  // URL milik user sungguhan. Satu-satunya pair-nya ber-prefix !8m2.
  const WH2 = 'https://www.google.com/maps/place/WH-2+ARCHER/@-7.4450072,112.3587988,1074m'
    + '/data=!3m2!1e3!4b1!4m6!3m5!1s0x2e78110013ed2f4b:0x8cd94e5ea237aea0'
    + '!8m2!3d-7.4450072!4d112.3587988!16s%2Fg%2F11ntpfhd38';
  {
    const r = p(WH2);
    check(r.ok === true, 'link WH-2 ARCHER terbaca');
    check(r.name === 'WH-2 ARCHER', 'nama dari path /place/, dapat ' + JSON.stringify(r.name));
    check(near(r.lat, -7.4450072) && near(r.lng, 112.3587988),
          'koordinat dari !3d/!4d, dapat ' + r.lat + ',' + r.lng);
    check(r.exact === true, 'pair tunggal = persis');
  }

  // Guard regresi inti: !8m2 TIDAK boleh dilewati.
  {
    const r = p('https://www.google.com.br/maps/place/Abbraccio+Cucina+Italiana'
      + '/@-15.7202756,-47.9207687,13z/data=!4m9!1m3!2m2!1srestaurants+in+Bras%C3%ADlia!6e5'
      + '!3m4!1s0x935a39a1395ec361:0x5c869291493e902c!8m2!3d-15.7202756!4d-47.8857498');
    check(near(r.lng, -47.8857498),
          'pair ber-prefix !8m2 tetap dipakai sebagai pin, dapat ' + r.lng);
    check(!near(r.lng, -47.9207687), 'tidak jatuh ke @ viewport');
    check(r.exact === true, 'pair tunggal ber-!8m2 tetap persis');
  }

  // Dua pair = ambigu, jangan diklaim persis.
  {
    const r = p('https://www.google.com/maps/place/Egypt/@26.8444558,26.3722095,6z/data=!3m1!4b1'
      + '!4m13!1m7!3m6!1s0x0:0x0!2zMTfCsDMwJzA0!JmQ!3b1!8m2!3d17.5012212!4d74.1235132'
      + '!3m4!1s0x14368976c35c36e9:0x2c45a00925c4c444!8m2!3d27.0982539!4d29.8828125');
    check(near(r.lat, 17.5012212) && near(r.lng, 74.1235132), 'ambil pair pertama');
    check(r.exact === false, 'dua pair = ambigu, exact=false');
  }

  // Tidak ada pair -> dari @ (pusat viewport), harus approx.
  {
    const r = p('https://www.google.com/maps/place/Eiffel+Tower/@48.858,2.294,17z');
    check(near(r.lat, 48.858) && near(r.lng, 2.294), 'koordinat dari @ viewport');
    check(r.exact === false, '@ viewport bukan pin -> approx');
    check(r.name === 'Eiffel Tower', 'nama dari path tanpa !2s');
  }

  // Jebakan zoom: digit zoom tidak boleh ikut terparse.
  {
    const r = p('https://www.google.com/maps/place/X/@-6.2088,106.8456,17z');
    check(near(r.lat, -6.2088) && near(r.lng, 106.8456),
          'zoom 17z tidak terserap, dapat ' + r.lat + ',' + r.lng);
  }
  {
    const r = p('https://www.google.com/maps/place/X/@-7.4450072,112.3587988,1074m');
    check(near(r.lng, 112.3587988), 'zoom 1074m tidak terserap');
  }

  // Bentuk koordinat eksplisit.
  {
    const r = p('https://www.google.com/maps/search/?api=1&query=-6.2088,106.8456');
    check(r.ok && near(r.lat, -6.2088) && near(r.lng, 106.8456) && r.exact === true,
          '?query=LAT,LNG dianggap koordinat persis');
  }
  {
    const r = p('https://www.google.com/maps/place/X/@-6.2,106.8,12z?ll=-6.2088,106.8456');
    check(r.ok && near(r.lat, -6.2088) && near(r.lng, 106.8456) && r.exact === true,
          '?ll=LAT,LNG dipakai dan dianggap persis');
  }

  // Hanya nama -> needs-geocode, nama harus ter-decode dengan spasi.
  {
    const r = p('https://www.google.com/maps/search/?api=1&query=Monas%20Jakarta');
    check(r.ok === false && r.reason === 'needs-geocode', 'nama saja -> needs-geocode');
    check(r.name === 'Monas Jakarta', 'nama ter-decode, dapat ' + JSON.stringify(r.name));
  }

  // Short link.
  {
    const r = p('https://maps.app.goo.gl/duSRki9gmgdUBotg9');
    check(r.ok === false && r.reason === 'short-link', 'short link ditolak');
  }
  {
    const r = p('https://goo.gl/maps/abcdef');
    check(r.ok === false && r.reason === 'short-link', 'goo.gl/maps juga short link');
  }

  // Bukan Google Maps.
  {
    check(p('https://example.com/maps/place/foo').reason === 'not-a-link', 'domain lain');
    check(p('Jakarta').reason === 'not-a-link', 'ketik alamat biasa bukan link');
    check(p('').reason === 'not-a-link', 'input kosong');
    check(p('   ').reason === 'not-a-link', 'spasi saja');
  }

  // Domain Google lain yang sah.
  {
    const r = p('https://www.google.co.id/maps/place/Monas/@-6.1754,106.8272,17z');
    check(r.ok === true && r.name === 'Monas', 'google.co.id diterima');
  }
  {
    const r = p('https://www.google.com.br/maps/place/Teste/@-15.79,-47.88,13z');
    check(r.ok === true, 'google.com.br diterima');
  }

  // Domain yang menyerupai Google harus ditolak.
  {
    check(p('https://google.com.evil.example/maps/place/foo').reason === 'not-a-link',
          'google.com.evil.example ditolak');
    check(p('https://notgoogle.com/maps/place/foo').reason === 'not-a-link',
          'notgoogle.com ditolak');
  }

  // Nama dari !2s.
  {
    const r = p('https://www.google.com/maps/place/X/@-6.2,106.8,12z/data=!4m2!2sKopi%20Rindu');
    check(r.name === 'Kopi Rindu', 'nama dari !2s, dapat ' + JSON.stringify(r.name));
  }

  // Koordinat di luar rentang harus ditolak.
  {
    const r = p('https://www.google.com/maps/place/X/@999.5,106.8,12z');
    check(r.ok === false, 'lat di luar rentang ditolak');
  }
  {
    const r = p('https://www.google.com/maps/place/X/@-6.2,999.5,12z');
    check(r.ok === false, 'lng di luar rentang ditolak');
  }

  // /dir/: tujuan = segmen terakhir, bukan yang pertama.
  {
    const r = p('https://www.google.com/maps/dir/-6.2,106.8/-6.9,107.6');
    check(r.ok && near(r.lat, -6.9) && near(r.lng, 107.6),
          '/dir/ ambil segmen terakhir, dapat ' + r.lat + ',' + r.lng);
    check(r.exact === true, 'koordinat /dir/ dianggap persis');
  }
  {
    const r = p('https://www.google.com/maps/dir/Jakarta/Monumen+Nasional/@-6.2,106.8,12z');
    check(r.ok === false && r.reason === 'needs-geocode', '/dir/ berbasis nama -> needs-geocode');
    check(r.name === 'Monumen Nasional', 'nama tujuan /dir/, dapat ' + JSON.stringify(r.name));
  }

  // Latitude selalu lebih dulu di URL Google — jangan tertukar.
  {
    const r = p(WH2);
    check(r.lat < 0 && r.lng > 0, 'lat negatif & lng positif: urutan tidak tertukar');
  }
}

// ── bookmarklet ──────────────────────────────────────────────────────────
section('bookmarklet');
{
  const b = api.buildBookmarklet;
  const APP = 'https://esp32nav.netlify.app';

  const bm = b(APP);
  check(bm.startsWith('javascript:'), 'dimulai dengan javascript:');
  check(bm.includes('encodeURIComponent(location.href)'),
        'mengambil URL halaman yang sedang dibuka');
  check(bm.includes(APP + '#u='), 'menunjuk ke aplikasi sendiri dengan fragment #u=');

  // Privasi: tujuan user tidak boleh masuk ke access log server hosting,
  // jadi fragment wajib, query string tidak boleh.
  check(!bm.includes('?u='), 'tidak memakai query string (tujuan tidak masuk server log)');
  check(bm.includes('#u='), 'memakai fragment #u=');

  check(!b(APP + '/').includes('//#u='), 'garis miring ganda di URL aplikasi dibersihkan');
  check(!b(APP + '///').includes('//#u='), 'garis miring berulang dibersihkan');
  check(typeof b('') === 'string' && b('').length > 0, 'appUrl kosong tidak melempar');
  check(b(null).includes('#u='), 'null tidak melempar');
}

section('readIncomingLink');
{
  const r = api.readIncomingLink;
  // Bookmarklet mengirim location.href PENUH, jadi fixture ini harus lengkap
  // dengan bagian data= yang memuat !8m2!3d...!4d... — itulah yang membuat
  // hasilnya 'persis'. URL yang hanya punya @ akan jadi 'perkiraan', dan itu
  // perilaku yang benar, bukan bug.
  const G = 'https://www.google.com/maps/place/WH-2+ARCHER/@-7.4450072,112.3587988,1074m'
    + '/data=!3m2!1e3!4b1!4m6!3m5!1s0x2e78110013ed2f4b:0x8cd94e5ea237aea0'
    + '!8m2!3d-7.4450072!4d112.3587988!16s%2Fg%2F11ntpfhd38';

  location.hash = '#u=' + encodeURIComponent(G);
  check(r() === G, 'fragment #u= dibaca dan di-decode');

  location.hash = '';
  check(r() === null, 'tanpa fragment -> null');

  location.hash = '#lain=1';
  check(r() === null, 'fragment tanpa u -> null');

  // Yang kembali harus langsung bisa dipakai parser.
  location.hash = '#u=' + encodeURIComponent(G);
  const res = api.parseMapsLink(r());
  check(res.ok === true, 'hasil bookmarklet langsung bisa diparse');
  check(res.name === 'WH-2 ARCHER', 'nama tempat terbaca dari tautan bookmarklet');
  check(res.exact === true, 'pin terbaca sebagai koordinat persis');
  location.hash = '';
}

console.log('\n─────────────────────────────');
console.log('PASS: ' + pass + '   FAIL: ' + fail);
process.exit(fail === 0 ? 0 : 1);
