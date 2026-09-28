// @ts-check
//
//  NAVIGATION
//

import { state } from './state.js';
import { map, userIcon } from './map.js';
import { toast } from './toast.js';
import { fetchRoute, showNavControls, formatDist } from './route.js';
import { saveTrip, completeRestore } from './store.js';
import { requestWakeLock, releaseWakeLock } from './wake.js';
import { sendToBLE } from './ble.js';
export function setUserPos(lat, lng) {
  state.userLat = lat; state.userLng = lng;
  if (state.userMarker) state.userMarker.setLatLng([lat, lng]);
  else state.userMarker = L.marker([lat, lng], { icon: userIcon }).addTo(map);

  // Perjalanan tersimpan yang menunggu posisi pertama. WAJIB diselesaikan
  // sebelum checkStepProgress: state.steps masih kosong sampai rute dihitung
  // ulang, jadi checkStepProgress akan keluar diam-diam dan langkah yang
  // tersimpan tidak pernah pulih.
  if (state.pendingRestore) {
    completeRestore(state.pendingRestore).catch(() => { /* fetchRoute sudah toast sendiri */ });
    return;
  }

  // Tujuan yang sudah dipilih tapi masih menunggu posisi pertama. Pola-nya
  // sama dengan pendingRestore di atas: jangan bail, tunggu, selesaikan.
  // fetchRoute() sudah memanggil showNavControls() di dalamnya kalau berhasil,
  // jadi jangan dipanggil lagi di sini — kalau rute gagal diambil, kontrol
  // navigasi harus tetap tersembunyi.
  if (state.pendingRoute) {
    state.pendingRoute = null;
    fetchRoute().catch(() => { /* fetchRoute sudah toast sendiri */ });
    return;
  }

  if (state.navigating) checkStepProgress(lat, lng);
}

// ══════════════════════════════════════════════
//  NAVIGATION
// ══════════════════════════════════════════════

// Dipisah dari startNavigation supaya completeRestore() bisa melanjutkan
// pantauan tanpa memutar ulang requestWakeLock() — wake lock butuh user
// gesture, jadi tidak boleh diminta dari jalur pemulihan otomatis.
export function startWatch() {
  if (!navigator.geolocation || state.watchId !== null) return;
  state.watchId = navigator.geolocation.watchPosition(pos => {
    setUserPos(pos.coords.latitude, pos.coords.longitude);
  }, null, { enableHighAccuracy: true, maximumAge: 2000 });
}

export function startNavigation() {
  if (!state.steps.length) { toast('Cari tujuan dulu'); return; }
  state.navigating = true;
  state.currentStep = 0;
  state.pendingRestore = null;
  saveTrip();
  updateInstructionUI();
  const first = currentInstructionPayload();
  if (first) sendToBLE(first.code, first.text, first.dist);

  // Jaga layar tetap menyala. Sengaja TIDAK di-await supaya
  // startNavigation tetap sinkron dan request() tetap dijalankan di dalam
  // task gesture dari klik tombol.
  requestWakeLock();

  startWatch();

  toast('Navigasi dimulai');
}

export function stopNavigation() {
  state.navigating = false;
  // Perjalanan yang masih tertunda harus ikut dibuang. Kalau tidak, satu
  // posisi GPS yang telat datang bisa menghidupkan kembali rute yang baru
  // saja dihentikan oleh user.
  state.pendingRestore = null;
  if (state.watchId !== null) {
    navigator.geolocation.clearWatch(state.watchId);
    state.watchId = null;
  }
  releaseWakeLock();
  setInstruction('🗺️', 'Navigasi dihentikan');
  toast('Navigasi dihentikan');
}

// Instruksi yang sedang aktif, dipakai untuk UI web dan payload BLE.
export function currentInstructionPayload() {
  const s = state.steps[state.currentStep];
  if (!s) return null;
  return { code: s.code, text: s.instruction, dist: s.distance };
}

export function updateInstructionUI() {
  const s = state.steps[state.currentStep];
  if (!s) return;
  setInstruction(s.icon, s.instruction, formatDist(s.distance));
  // Persistensi langkah: user supaya setelah refresh tidak melempar mundur
  // ke manifold pertama di tengah perjalanan.
  saveTrip();
}

export function setInstruction(icon, text, dist = '') {
  document.getElementById('instr-icon').textContent = icon;
  document.getElementById('instr-text').textContent = text;
  document.getElementById('instr-dist').textContent = dist;
}

export function checkStepProgress(lat, lng) {
  const step = state.steps[state.currentStep];
  if (!step) return;
  const dist = haversine(lat, lng, step.lat, step.lng);
  if (dist < 25) { // within 25m → next step
    state.currentStep++;
    if (state.currentStep >= state.steps.length) {
      stopNavigation();
      setInstruction('🏁', 'Anda telah tiba!');
      sendToBLE(11, 'Anda telah tiba di tujuan', -1);
      return;
    }
    updateInstructionUI();
    const next = currentInstructionPayload();
    if (next) sendToBLE(next.code, next.text, next.dist);
  }
}

export function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

/**
 * Tombol mulai / berhenti navigasi.
 *
 * Dipanggil sekali dari src/main.js. Semua listener dipasang di sini,
 * bukan diatas modul modul, supaya urutan mendaftarnya mengikuti urutan pemanggilan
 * init dan bisa diuji tanpa memuat halaman.
 */
export function initNav() {
  document.getElementById('btn-start').addEventListener('click', startNavigation);
  document.getElementById('btn-stop').addEventListener('click', stopNavigation);
}
