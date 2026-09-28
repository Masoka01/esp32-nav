// @ts-check
//
//  SIMPAN PERJALANAN
//

import { state } from './state.js';
import { map, destIcon } from './map.js';
import { toast } from './toast.js';
import { validLatLng } from './parse.js';
import { fetchRoute, showNavControls } from './route.js';
import { setInstruction, setUserPos, startWatch, checkStepProgress, updateInstructionUI } from './nav.js';
import { locateMe } from './geocode.js';
import { searchInput } from './dom.js';
// ══════════════════════════════════════════════
//  SIMPAN PERJALANAN (bertahan saat refresh)
// ══════════════════════════════════════════════
//
// sessionStorage, bukan localStorage: harus selamat dari refresh DAN crash,
// tapi harus hilang begitu tab ditutup. Kalau localStorage, membuka aplikasi
// esok hari akan menghidupkan kembali tujuan dari kemarin.
const TRIP_KEY = 'esp32nav.trip';

export function saveTrip() {
  try {
    if (state.destLat === null || state.destLng === null) return;
    sessionStorage.setItem(TRIP_KEY, JSON.stringify({
      lat: state.destLat, lng: state.destLng,
      name: state.destName, step: state.currentStep,
      // navigating WAJIB ikut disimpan. Tanpa ini, refresh mengembalikan tujuan
      // dan rute, tapi UI navigasi tetap dalam keadaan idle — persis gejala
      // "kena refresh langsung balik ke tampilan awal".
      // `!!` dipakai karena payload lama (sebelum key ini ada) tidak punya
      // properti, dan undefined harus dibaca sebagai false, bukan tersesat
      // menjadi true lewat operator `||`.
      navigating: !!state.navigating,
    }));
  } catch { /* storage penuh / private mode: bukan alasan gagalkan navigasi */ }
}

export function loadTrip() {
  try {
    const raw = sessionStorage.getItem(TRIP_KEY);
    if (!raw) return null;
    const t = JSON.parse(raw);
    if (!t || !validLatLng(t.lat, t.lng)) { clearStoredTrip(); return null; }
    return t;
  } catch { return null; }
}

export function clearStoredTrip() {
  try { sessionStorage.removeItem(TRIP_KEY); } catch { /* abaikan */ }
}

// Refresh di tengah perjalanan tidak boleh menghapus tujuan.
//
// BUG: versi lama fungsi ini mengecek `if (!state.userLat) return;` di sini.
// Tapi restoreTrip() dipanggil secara SINKRON di akhir script, sedangkan
// locateMe() yang mengisi userLat memakai getCurrentPosition yang ASYNC.
// Jadi pada baris ini posisi belum pernah tiba, userLat selalu null, dan
// return dini itu terjadi di SETIAP page load — bukan kasus jarang. Rute pun
// tidak pernah dihitung ulang, dan tidak ada yang mencoba lagi.
//
// Perbaikan: jangan menolak, simpan perjalanan yang tertunda, lalu selesaikan
// begitu posisi pertama masuk (lihat setUserPos). Karena setUserPos dipanggil
// dari locateMe() maupun watchPosition, urutan callback tidak berpengaruh.
//
// Wake lock dan BLE tetap TIDAK dipulihkan: keduanya butuh user gesture.
export async function restoreTrip() {
  const t = loadTrip();
  if (!t) return;

  state.destLat = t.lat;
  state.destLng = t.lng;
  state.destName = t.name || 'Tujuan';
  searchInput.value = state.destName;

  if (state.destMarker) state.destMarker.setLatLng([t.lat, t.lng]);
  else state.destMarker = L.marker([t.lat, t.lng], { icon: destIcon }).addTo(map);

  // Payload lama (sebelum key `navigating` disimpan) tidak punya properti ini.
  // `!!` menjaga undefined terbaca sebagai false, bukan menyalakan mode
  // navigasi pada perjalanan yang sebenarnya tidak sedang berjalan.
  state.navigating = !!t.navigating;

  if (!state.userLat) {
    state.pendingRestore = t;
    toast('Tujuan dipulihkan. Menunggu GPS untuk menghitung rute...');
    return;
  }

  await completeRestore(t);
}

// Bagian yang butuh posisi GPS: menghitung ulang rute, memulihkan langkah,
// lalu melanjutkan pantauan posisi kalau sedang bernavigasi.
export async function completeRestore(t) {
  state.pendingRestore = null;
  setInstruction('⏳', 'Menghitung rute...');
  await fetchRoute();

  // Clamp: rute hasil hitung ulang bisa lebih pendek, currentStep tidak boleh
  // keluar rentang.
  if (state.steps.length) {
    state.currentStep = Math.min(t.step || 0, state.steps.length - 1);
    showNavControls();
    updateInstructionUI();
  }

  // Lanjutkan GPS watch kalau sebelumnya sedang bernavigasi, supaya
  // checkStepProgress benar-benar jalan lagi. watchPosition tidak butuh user
  // gesture, jadi aman dipulihkan otomatis — berbeda dengan wake lock dan BLE.
  if (state.navigating) startWatch();
}

