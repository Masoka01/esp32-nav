// @ts-check
//
//  ROUTING / OSRM
//

import { state } from './state.js';
import { map, destIcon } from './map.js';
import { searchInput } from './dom.js';
import { toast } from './toast.js';
import { setInstruction, setUserPos, updateInstructionUI } from './nav.js';
import { saveTrip } from './store.js';
// ══════════════════════════════════════════════
//  ROUTING / OSRM
// ══════════════════════════════════════════════
export async function selectDestination(lat, lng, name) {
  state.destLat = lat; state.destLng = lng;
  state.destName = name || 'Tujuan';
  state.currentStep = 0;
  // Tujuan baru yang dipilih user membatalkan perjalanan lama yang masih
  // tertunda: kalau dibiarkan, restore yang telat datang akan menimpa tujuan
  // yang baru saja dipilih.
  state.pendingRestore = null;
  // Tujuan yang lebih baru membatalkan yang masih tertunda, supaya restore
  // atau rute tertunda tidak menimpa tujuan yang baru saja dipilih.
  state.pendingRoute = null;
  saveTrip();

  if (state.destMarker) state.destMarker.setLatLng([lat, lng]);
  else state.destMarker = L.marker([lat, lng], { icon: destIcon }).addTo(map);

  // Posisi GPS itu ASYNC. Tepat setelah aplikasi dibuka — yang justru terjadi
  // setiap kali share target dipakai — userLat masih null, dan kode lama hanya
  // menampilkan "Aktifkan GPS dulu" lalu menyerah. Rute tidak pernah dihitung
  // dan tidak ada percobaan ulang, jadi user melihat pin di peta tanpa rute.
  // Simpan dulu, biarkan setUserPos yang menyelesaikan — pola yang sama dengan
  // pendingRestore di atas.
  if (!state.userLat) {
    state.pendingRoute = { lat, lng };
    setInstruction('⏳', 'Menunggu GPS untuk menghitung rute...');
    toast('Menunggu GPS...');
    return;
  }

  setInstruction('⏳', 'Menghitung rute...');
  await fetchRoute();
}

export async function fetchRoute() {
  const { userLat: oLat, userLng: oLng, destLat: dLat, destLng: dLng } = state;
  if (!oLat || !dLat) return;

  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${oLng},${oLat};${dLng},${dLat}?steps=true&geometries=geojson&overview=full&annotations=false`;
    const res  = await fetch(url);
    const data = await res.json();

    if (data.code !== 'Ok') { toast('Rute tidak ditemukan'); return; }

    const route = data.routes[0];
    drawRoute(route.geometry.coordinates);
    parseSteps(route.legs[0].steps);
    showRouteInfo(route.distance, route.duration);
    showNavControls();
    fitRoute(route.geometry.coordinates);
  } catch { toast('Gagal mengambil rute'); }
}

export function drawRoute(coords) {
  if (state.routeLayer) map.removeLayer(state.routeLayer);
  const latlngs = coords.map(([lng, lat]) => [lat, lng]);
  state.routeLayer = L.polyline(latlngs, {
    color: '#4f8ef7', weight: 5, opacity: 0.85,
    lineCap: 'round', lineJoin: 'round',
  }).addTo(map);
}

export function fitRoute(coords) {
  const latlngs = coords.map(([lng, lat]) => [lat, lng]);
  map.fitBounds(L.latLngBounds(latlngs), { padding: [40, 40] });
}

export function parseSteps(rawSteps) {
  state.steps = rawSteps.map(s => {
    const loc = s.maneuver.location; // [lng, lat]
    return {
      lat: loc[1], lng: loc[0],
      instruction: cleanInstruction(s.maneuver.type, s.maneuver.modifier, s.name),
      icon: maneuverIcon(s.maneuver.type, s.maneuver.modifier),
      code: maneuverCode(s.maneuver.type, s.maneuver.modifier),
      distance: s.distance,
    };
  });
  state.currentStep = 0;
  updateInstructionUI();
}

export function cleanInstruction(type, modifier, name) {
  const road = name && name !== '' ? ` ke ${name}` : '';
  if (type === 'depart') return `Mulai perjalanan${road}`;
  if (type === 'arrive') return 'Anda telah tiba di tujuan';
  if (type === 'turn') {
    if (modifier === 'left')       return `Belok kiri${road}`;
    if (modifier === 'right')      return `Belok kanan${road}`;
    if (modifier === 'slight left')  return `Sedikit belok kiri${road}`;
    if (modifier === 'slight right') return `Sedikit belok kanan${road}`;
    if (modifier === 'sharp left')   return `Belok tajam kiri${road}`;
    if (modifier === 'sharp right')  return `Belok tajam kanan${road}`;
    if (modifier === 'uturn')        return `Putar balik${road}`;
  }
  if (type === 'roundabout') return `Masuk bundaran${road}`;
  if (type === 'merge')      return `Gabung ke jalan${road}`;
  if (type === 'fork') {
    if (modifier === 'left')  return `Ambil kiri di persimpangan${road}`;
    if (modifier === 'right') return `Ambil kanan di persimpangan${road}`;
  }
  return `Lanjutkan${road}`;
}

export function maneuverIcon(type, modifier) {
  if (type === 'depart') return '🚦';
  if (type === 'arrive') return '🏁';
  if (type === 'roundabout') return '🔄';
  if (modifier === 'left' || modifier === 'sharp left') return '⬅️';
  if (modifier === 'right' || modifier === 'sharp right') return '➡️';
  if (modifier === 'slight left') return '↖️';
  if (modifier === 'slight right') return '↗️';
  if (modifier === 'uturn') return '↩️';
  return '⬆️';
}

// Kode numerik yang dikirim ke ESP32 (0..12). HARUS sinkron dengan tabel
// ICON_* di esp32_nav.ino. Emoji di atas hanya untuk tampilan web.
export function maneuverCode(type, modifier) {
  if (type === 'depart')    return 0;
  if (type === 'arrive')    return 11;
  // Semua varian bundaran/rotary dipetakan ke satu ikon.
  if (type === 'roundabout' || type === 'rotary' ||
      type === 'roundabout turn' || type === 'exit roundabout' ||
      type === 'exit rotary') return 9;
  // Ramp dan persimpangan ambil jalur gabungan/masuk.
  if (type === 'merge' || type === 'on ramp' || type === 'off ramp') return 10;
  if (modifier === 'uturn')         return 5;
  if (modifier === 'slight left')   return 2;
  if (modifier === 'left')          return 3;
  if (modifier === 'sharp left')    return 4;
  if (modifier === 'slight right')  return 6;
  if (modifier === 'right')         return 7;
  if (modifier === 'sharp right')   return 8;
  // "new name" = nama jalan berubah, tapi geometri tetap lurus.
  // cleanInstruction() juga jatuh ke "Lanjutkan", jadi ini konsisten.
  if (type === 'continue' || type === 'new name' || type === 'end of road') return 1;
  return 12;
}

export function formatDist(m) {
  return m >= 1000 ? `${(m/1000).toFixed(1)} km` : `${Math.round(m)} m`;
}

export function formatDur(s) {
  const m = Math.round(s / 60);
  return m >= 60 ? `${Math.floor(m/60)} jam ${m%60} mnt` : `${m} mnt`;
}

export function showRouteInfo(dist, dur) {
  const el = document.getElementById('route-info');
  document.getElementById('info-dist').textContent = `📏 ${formatDist(dist)}`;
  document.getElementById('info-dur').textContent  = `⏱ ${formatDur(dur)}`;
  el.classList.add('visible');
}

export function showNavControls() {
  document.getElementById('nav-controls').classList.add('visible');
}

