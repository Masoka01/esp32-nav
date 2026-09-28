// @ts-check
//
// ══════════════════════════════════════════════
//  STATE
// ══════════════════════════════════════════════
//
// Sumber kebenaran tunggal untuk bentuk state. Semua modul mengimpor
// `state` dari sini, bukan punya salinan sendiri.
//
// Kenapa modul ini WAJIB bebas DOM: karena itulah yang membuat logika inti
// bisa diuji di Node tanpa browser. Kalau state.js menyentuh `document`,
// setiap test yang mengimpornya ikut butuh DOM, dan kita kembali ke era di
// mana test mengiris teks index.html sebagai jalan keluar.
//
// Yang TIDAK ada di sini: peta, marker, dan ikon Leaflet. Semuanya butuh
// global `L` dan elemen DOM, jadi milik src/map.js yang hanya diimpor oleh
// main.js.

/**
 * Satu langkah rute. Bentuk ini DIHASILKAN oleh parseSteps di src/route.js
 * dan dibaca lagi di src/nav.js, jadi kalau satu sisi berubah, sisi lain
 * ikut ketahuan oleh tsc.
 *
 * @typedef {Object} RouteStep
 * @property {number} lat
 * @property {number} lng
 * @property {string} instruction
 * @property {string} icon         Emoji untuk kolom instr-icon.
 * @property {number} code         Kode manuver untuk diteruskan ke ESP32.
 * @property {number} distance     Jarak ke manuver berikutnya, dalam meter.
 */

/**
 * @typedef {Object} AppState
 * @property {number|null} userLat      Posisi GPS terakhir yang diketahui.
 * @property {number|null} userLng
 * @property {number|null} destLat      Tujuan yang dipilih.
 * @property {number|null} destLng
 * @property {string|null} destName
 * @property {RouteStep[]} steps
 * @property {number} currentStep
 * @property {boolean} navigating
 * @property {{lat: number, lng: number, name: string|null}|null} pendingRestore
 *           Perjalanan tersimpan yang menunggu posisi GPS pertama.
 *           Lihat restoreTrip di src/store.js.
 * @property {{lat: number, lng: number}|null} pendingRoute
 *           Tujuan yang sudah dipilih tapi masih menunggu posisi GPS pertama
 *           sebelum rutenya bisa dihitung. Lihat selectDestination di src/route.js.
 * @property {any} bleDevice           Objek device Web Bluetooth.
 * @property {any} bleChar             Objek characteristic GATT.
 * @property {any} wakeLock            Screen Wake Lock API.
 * @property {number|null} watchId      ID dari navigator.geolocation.watchPosition.
 * @property {any} routeLayer          Layer polyline Leaflet.
 * @property {any} destMarker
 * @property {any} userMarker
 */

/** @type {AppState} */
export const state = {
  userLat: null, userLng: null,
  destLat: null, destLng: null,
  destName: null,
  steps: [],
  currentStep: 0,
  navigating: false,
  // Perjalanan tersimpan yang menunggu posisi GPS pertama. Lihat restoreTrip.
  pendingRestore: null,
  // Tujuan yang sudah dipilih tapi masih menunggu posisi GPS pertama sebelum
  // rutenya bisa dihitung. Lihat selectDestination.
  pendingRoute: null,
  bleDevice: null,
  bleChar: null,
  wakeLock: null,
  watchId: null,
  routeLayer: null,
  destMarker: null,
  userMarker: null,
};

// BLE UUIDs (harus sama dengan kode ESP32).
// Dipakai src/ble.js; menyimpannya di modul yang sama dengan state membuat
// nilainya tidak bisa berbeda dari bentuk state di atas.
export const SERVICE_UUID = '6e400001-b5b3-f393-e0a9-e50e24dcca9e';
export const CHAR_UUID    = '6e400002-b5b3-f393-e0a9-e50e24dcca9e';
