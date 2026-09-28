// @ts-check
//
import * as nodeFs from 'node:fs';
//
//  STUB LINGKUNGAN UNTUK TEST
//
//  Test dulu meng-eval potongan kode yang dikiris dari index.html, lalu
//  menyuntikkan stub sebagai parameter factory. Cara itu menyalin sumber
//  yang benar, tapi rapuh: setiap refactor pada index.html akan merusak
//  marker di test, dan test tidak pernah bisa menguji modul yang crashing
//  karena import-nya salah.
//
//  Sekarang modulnya bisa di-import langsung. Masalahnya: src/map.js dan
//  src/dom.js menyentuh `document` dan `L` pada top-level modul, jadi Node
//  akan gagal saat import. Solusinya di sini.
//
//  Kunci teknisnya adalah urutan: import di dalam modul ESM di-hoist, jadi
//  `import` statis akan SELALU dieksekusi sebelum statement di bawahnya. Stub
//  karena itu harus dipasang lewat `import()` DINAMIS, yang baru berjalan
//  setelah statement di atas selesai.
//
//  Modul pure (src/parse.js, src/state.js, src/toast.js) tidak butuh file ini
//  sama sekali — itu gunanya dipisah sejak awal sejak awal.

/** @type {Map<string, any>} */
const elements = new Map();

/** Registry semua panggilan yang ingin diamati test. */
export const calls = {
  /** @type {string[]} */ toast: [],
  /** @type {string[]} */ instr: [],
  /** @type {any[]} */ marker: [],
  /** @type {any[]} */ polyline: [],
  nav: 0, ui: 0, watch: 0, clearWatch: 0, released: 0, locate: 0,
  /** @type {string[]} */ fetchUrls: [],
  /** @type {Map<string, any>} */ fetchBodies: new Map(),
  /** @type {string[]} */ clipboard: [],
  /** Semua penulisan textContent, dikelompokkan per id elemen. */
  text: /** @type {Map<string, string[]>} */ (new Map()),
};

// Pastikan setiap elemen punya catatan, supaya test tidak perlu
// memeriksa keberadaan key sebelum membacanya.
for (const id of ['toast', 'instr-text', 'instr-icon', 'instr-dist',
                  'maps-confirm', 'search-input', 'route-info',
                  'ble-label', 'awake-note', 'bookmarklet-code']) {
  calls.text.set(id, []);
}

// Kelas awal tiap elemen dibaca dari index.html, supaya stub benar-benar
// meniru DOM. Tanpa ini elemen tiruan selalu mulai tanpa kelas, padahal di
// HTML nyata #awake-note sudah punya `class="hidden"` — dan test yang
// memeriksa "catatan tidak terlihat" akan gagal bukan karena logikanya salah,
// tapi karena stubnya berbohong.
const INITIAL_CLASSES = (() => {
  /** @type {Map<string, string[]>} */
  const m = new Map();
  try {
    const fs = nodeFs;
    const html = fs.readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
    for (const match of html.matchAll(/id="([^"]+)"[^>]*class="([^"]*)"/g)) {
      m.set(match[1], match[2].split(/\s+/).filter(Boolean));
    }
  } catch { /* index.html tidak terbaca: stub tetap jalan tanpa kelas awal */ }
  return m;
})();

function makeElement(id) {
  const el = {
    id,
    value: '',
    // textContent memakai accessor, bukan properti biasa, supaya setiap
    // penulisan tercatat. Test dulu meny-stub toast() dan setInstruction()
    // lalu memeriksa argumen yang masuk. Sekarang kode produksi yang asli yang
    // jalan, jadi yang diperiksa harus akibatnya: teks yang benar-benar
    // ditulis ke elemen. calls.text[id] adalah catatan penulisan itu.
    _text: '',
    get textContent() { return el._text; },
    set textContent(v) {
      el._text = String(v);
      // Map harus lewat .get(), bukan calls.text[id]. Dibuat lazy supaya
      // elemen yang dibuat di luar daftar awal tetap punya catatan.
      const log = calls.text.get(id) || [];
      log.push(String(v));
      calls.text.set(id, log);
    },
    className: (INITIAL_CLASSES.get(id) || []).join(' '),
    innerHTML: '',
    checked: false,
    style: {},
    dataset: {},
    children: [],
    _classes: new Set(INITIAL_CLASSES.get(id) || []),
    _listeners: /** @type {Map<string, Function[]>} */ (new Map()),
    // Dipakai toast() untuk add/remove class.
    classList: {
      add: (c) => { el._classes.add(c); el.className = [...el._classes].join(' '); },
      remove: (c) => { el._classes.delete(c); el.className = [...el._classes].join(' '); },
      toggle: (c, on) => { on ? el._classes.add(c) : el._classes.delete(c); el.className = [...el._classes].join(' '); },
      contains: (c) => el._classes.has(c),
    },
    addEventListener(type, fn) {
      const l = el._listeners.get(type) || [];
      l.push(fn);
      el._listeners.set(type, l);
    },
    removeEventListener() {},
    appendChild(child) { el.children.push(child); return child; },
    append(...kids) { el.children.push(...kids); },
    prepend(...kids) { el.children.unshift(...kids); },
    removeChild() {},
    setAttribute() {},
    getAttribute: () => null,
    focus() {},
    select() {},
    closest: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  return el;
}

/** Ambil (atau buat) elemen tiruan untuk sebuah id. */
export function el(id) {
  if (!elements.has(id)) elements.set(id, makeElement(id));
  return elements.get(id);
}

/** Reset semua elemen tiruan ke keadaan awal. */
export function resetElements() {
  elements.clear();
}

// ── sessionStorage / localStorage ────────────────────────────────────────
/** @type {Map<string, string>} */
const session = new Map();
/** @type {Map<string, string>} */
const local = new Map();

function makeStorage(backing) {
  return {
    getItem: (k) => (backing.has(k) ? backing.get(k) : null),
    setItem: (k, v) => { backing.set(k, String(v)); },
    removeItem: (k) => { backing.delete(k); },
    clear: () => { backing.clear(); },
    key: (i) => [...backing.keys()][i] ?? null,
    get length() { return backing.size; },
  };
}

// ── navigator.geolocation ────────────────────────────────────────────────
// watchPosition sengaja memanggil callback secara sinkron supaya alur
// pemulihan bisa diuji tanpa menunggu waktu nyata.
let nextPosition = { latitude: -6.2001, longitude: 106.8001 };

/** Atur posisi yang dikembalikan geolocation berikutnya. */
export function setPosition(lat, lng) {
  nextPosition = { latitude: lat, longitude: lng };
}

const navigatorStub = {
  geolocation: {
    getCurrentPosition(cb) { calls.locate++; cb({ coords: nextPosition }); },
    watchPosition(cb) {
      calls.watch++;
      cb({ coords: nextPosition });
      return 77;
    },
    clearWatch() { calls.clearWatch++; },
  },
  clipboard: {
    async writeText(t) { calls.clipboard.push(t); },
  },
  sendBeacon: () => true,
};

// ── Leaflet ──────────────────────────────────────────────────────────────
// Leaflet asli tidak bisa diimpor di Node, jadi ini hanya cukup untuk
//hmencatat apa yang terjadi: modul yang diuji tidak boleh crash saat membuat
// marker atau polyline.
let markerObj = null;

// Objek peta harus chainable: map.js menulis
// `L.map('map', {...}).setView([...], 13)`, jadi setiap metode harus
// mengembalikan objeknya sendiri. Kalau setView mengembalikan undefined,
// `map` dievaluasi jadi undefined dan geocode.js gagal saat memanggil
// map.setView() — gejalanya jauh dari penyebabnya.
function makeMapStub() {
  const m = {
    setView: () => m,
    addTo: () => m,
    fitBounds: () => m,
    removeLayer: () => m,
    panTo: () => m,
    setZoom: () => m,
    getZoom: () => 13,
    remove: () => m,
    on: () => m,
    off: () => m,
  };
  return m;
}

const Lstub = {
  map: () => makeMapStub(),
  tileLayer: () => ({ addTo: () => {} }),
  control: { zoom: () => ({ addTo: () => {} }) },
  divIcon: (o) => o,
  latLng: (a, b) => (b === undefined ? a : [a, b]),
  latLngBounds: (a) => a,
  marker(ll) {
    calls.marker.push(ll);
    markerObj = { _ll: ll, setLatLng(v) { markerObj._ll = v; return markerObj; }, addTo: () => markerObj, remove: () => markerObj };
    return markerObj;
  },
  polyline(ll) {
    calls.polyline.push(ll);
    return { addTo: () => {}, setLatLngs: () => {} };
  },
};

// ── document / window / location / history ────────────────────────────────
const documentStub = {
  visibilityState: 'visible',
  getElementById: (id) => el(id),
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: (tag) => makeElement('<' + tag + '>'),
  addEventListener() {},
  removeEventListener() {},
  body: makeElement('body'),
};

const locationStub = {
  hash: '', pathname: '/app/index.html', search: '', origin: 'https://esp32-nav.vercel.app',
  href: 'https://esp32-nav.vercel.app/app/index.html',
};

const historyStub = {
  replaced: 0, lastUrl: null,
  replaceState(_s, _t, url) {
    historyStub.replaced++;
    // Browser asli juga membersihkan hash saat replaceState. Stub harus
    // menirukan itu, kalau tidak test "share dua kali berturut-turut" akan
    // membaca hash lama dan tidak membuktikan apa pun.
    locationStub.hash = '';
    historyStub.lastUrl = url;
  },
  pushState() {},
};

const windowStub = {
  addEventListener() {}, removeEventListener() {},
  location: locationStub, history: historyStub,
  matchMedia: () => ({ matches: false, addEventListener() {} }),
  navigator: navigatorStub,
  setTimeout: (...a) => setTimeout(...a),
  clearTimeout: (...a) => clearTimeout(...a),
};

// ── fetch ────────────────────────────────────────────────────────────────
// fetchRoute() memanggil `fetch` global, jadi meny-stub global-nya memberi
// kontrol yang sama dengan injeksi fetchRoute versi lama — tanpa perlu
// mengubah kode produksi.
async function fetchStub(url) {
  calls.fetchUrls.push(String(url));
  // fetchBodies adalah Map (needle -> body), jadi harus diiterasi, bukan
  // Object.keys: stubFetch() mendaftarkan kunci berupa potongan URL.
  let body = null, found = false;
  for (const [needle, b] of calls.fetchBodies) {
    if (String(url).includes(needle)) { body = b; found = true; break; }
  }
  if (!found) {
    return { ok: false, status: 404, async json() { throw new Error('no stub for ' + url); } };
  }
  return { ok: true, status: 200, async json() { return typeof body === 'function' ? body() : body; } };
}

/**
 * Pasang seluruh stub ke globalThis.
 *
 * WAJIB dipanggil sebelum import() dinamis mana pun ke src/.
 * @returns {void}
 */
export function installStubs() {
  const g = /** @type {any} */ (globalThis);
  // Node 26 punya global `navigator` bawaan yang hanya punya getter, jadi
  // Penugasan biasa akan dilempar. defineProperty dipakai untuk semua agar
  // perilakunya sama konsisten, termasuk untuk yang sudah ada.
  const put = (k, v) => Object.defineProperty(g, k, {
    value: v, writable: true, configurable: true, enumerable: true,
  });
  put('document', documentStub);
  put('window', windowStub);
  put('navigator', navigatorStub);
  put('location', locationStub);
  put('history', historyStub);
  put('sessionStorage', makeStorage(session));
  put('localStorage', makeStorage(local));
  put('L', Lstub);
  put('fetch', fetchStub);
  put('alert', () => {});
}

/** Reset penghitung panggilan dan semua state tiruan. */
export function resetAll() {
  for (const k of Object.keys(calls)) {
    const v = calls[k];
    if (Array.isArray(v)) v.length = 0;
    else if (v instanceof Map) v.clear();
    else calls[k] = 0;
  }
  session.clear();
  local.clear();
  // Elemen TIDAK dihapus dari registry. Pada DOM sungguhan elemen tetap ada
  // sepanjang hidup halaman; yang berubah hanya isinya. Kalau registry
  // dikosongkan, src/dom.js akan memegang elemen basi yang tidak lagi sama
  // dengan el('...') yang dipanggil test — dan setiap assertion jadi bohong.
  for (const elx of elements.values()) {
    elx._text = '';
    elx.value = '';
    // Dikembalikan ke kelas yang ada di index.html, bukan diemptikan: di DOM
    // sungguhan memuat ulang halaman selalu mengembalikan markup asli, jadi
    // elemen yang punya `class="hidden"` di HTML kembali tersembunyi.
    const seed = INITIAL_CLASSES.get(elx.id) || [];
    elx._classes = new Set(seed);
    elx.className = seed.join(' ');
    elx.children.length = 0;
    elx.style = {};
    elx._listeners.clear();
  }
  locationStub.hash = '';
  historyStub.replaced = 0;
  historyStub.lastUrl = null;
  setPosition(-6.2001, 106.8001);
}

// Root repo, dihitung sekali dari lokasi file ini. `load()` me-resolve
// relatif ke sini, bukan ke file pemanggil, supaya setiap test cukup menulis
// load('src/store.js') tanpa harus tahu letaknya env.mjs di mana.
const ROOT = new URL('../../', import.meta.url);

/**
 * Import modul src/ dengan stub terpasang.
 *
 * Sengaja dinamis: import statis di-hoist dan akan berjalan sebelum
 * installStubs() sempat dipanggil.
 *
 * @param {string} rel  Path relatif root repo, mis. 'src/store.js'
 * @returns {Promise<any>}
 */
export function load(rel) {
  return import(new URL(rel, ROOT).href);
}

/** Daftarkan tubuh respons untuk URL yang mengandung `needle`. */
export function stubFetch(needle, body) {
  calls.fetchBodies.set(needle, body);
}

// ── adapter untuk bodily test lama ────────────────────────────────────────
//
// Test sebelumnya memakai `store` berupa Map (has/get/set/clear). Memakai
// sessionStorage sungguhan berarti API-nya getItem/setItem. Adapter ini
// membungkus Map yang sama supaya badan test tidak perlu diubah semua, dan
// kode produksi tetap membaca sessionStorage lewat API aslinya.

export const mem = {
  has: (k) => session.has(k),
  get: (k) => (session.has(k) ? session.get(k) : null),
  set: (k, v) => { session.set(k, String(v)); },
  clear: () => session.clear(),
};

/**
 * Kembalikan state singleton ke kondisi awal, di tempat.
 *
 * Dipakai di Replace `freshState()` yang lama membuat objek baru. Sekarang
 * semua modul mengimpor satu objek `state` yang sama, jadi reset harus
 * Terjadi di tempat — menambah atau menghapus kunci, bukan mengganti objek.
 *
 * @param {Record<string, any>} [extra]
 */
export function freshState(extra = {}) {
  const { state } = loadSyncState();
  for (const k of Object.keys(state)) delete state[k];
  Object.assign(state, {
    userLat: null, userLng: null,
    destLat: null, destLng: null, destName: null,
    steps: [], currentStep: 0, navigating: false,
    pendingRestore: null, pendingRoute: null,
    bleDevice: null, bleChar: null, wakeLock: null, watchId: null,
    routeLayer: null, destMarker: null, userMarker: null,
  }, extra);
  return state;
}

function loadSyncState() {
  // src/state.js bebas DOM, jadi aman diimpor sinkron di sini.
  return { state: stateRef };
}

// Ditetapkan oleh test_trip.mjs setelah memuat modul lewat load().
let stateRef = {};
/** @param {any} s */
export function bindState(s) { stateRef = s; }

/**
 * Bangun tubuh respons OSRM yang realistis dari daftar langkah sederhana.
 *
 * fetchRoute() mem-parsing bentuk mentah OSRM, bukan bentuk RouteStep yang
 * sudah dirapikan. Test lama meny-stub fetchRoute secara keseluruhan, jadi
 * parseSteps tidak pernah ikut teruji. Stub di sini membuat jalur parse ikut
 * berjalan tanpa mengubah kode produksi.
 *
 * @param {{steps?: Array<{name?: string, distance?: number, type?: string, modifier?: string, lat?: number, lng?: number}>, distance?: number, duration?: number}} o
 */
export function osrmBody(o = {}) {
  const specs = o.steps || [];
  return {
    code: 'Ok',
    routes: [{
      distance: o.distance ?? 1000,
      duration: o.duration ?? 300,
      geometry: { coordinates: [[106.8, -6.2], [106.9, -6.3]] },
      legs: [{
        steps: specs.map((s, i) => ({
          maneuver: {
            type: s.type ?? 'turn',
            modifier: s.modifier ?? 'left',
            location: [s.lng ?? 106.8 + i * 0.01, s.lat ?? -6.2 - i * 0.01],
          },
          name: s.name ?? 'Jalan ' + (i + 1),
          distance: s.distance ?? (100 * (i + 1)),
        })),
      }],
    }],
  };
}

/** Berapa kali fetchRoute() memanggil OSRM. */
export function routeCalls() {
  return calls.fetchUrls.filter(u => /router\.project-osrm\.org/.test(u)).length;
}

// ── accessor efek yangobservable ──────────────────────────────────────────
//
// Test tidak lagi memeriksa "fungsi apa yang dipanggil" lewat stub suntikan.
// Yang diperiksa adalah akibat yang dilihat user: teks toast, teks instruksi,
// dan apakah kontrol navigasi terlihat.

/** Semua pesan toast yang pernah ditulis, urut. */
export function toasts() { return calls.text.get('toast') || []; }

/** Semua teks instruksi navigasi yang pernah ditulis, urut. */
export function instr() { return calls.text.get('instr-text') || []; }

/** Ikon instruksi terakhir. */
export function instrIcon() { return el('instr-icon').textContent; }

/** Kontrol navigasi sedang terlihat? */
export function navVisible() { return el('nav-controls').classList.contains('visible'); }

/** Dialog konfirmasi sedang terlihat? */
export function confirmVisible() { return el('maps-confirm').style.display === 'block'; }

/** Seluruh teks yang muncul di dialog konfirmasi, digabung. */
export function confirmText() {
  return el('maps-confirm').children.map(c => c.textContent || '').join(' | ');
}

/** Nilai kotak pencarian. */
export function searchValue() { return el('search-input').value; }
