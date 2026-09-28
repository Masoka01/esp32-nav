// @ts-check
//
//  PENCARIAN / GEOCODING
//

import { map } from './map.js';
import { searchInput, suggestionsEl } from './dom.js';
import { toast } from './toast.js';
import { hideConfirm } from './ui.js';
import { selectDestination } from './route.js';
import { setUserPos } from './nav.js';
import { toggleBookmarkletPanel } from './share.js';
export function locateMe() {
  if (!navigator.geolocation) { toast('GPS tidak tersedia'); return; }
  navigator.geolocation.getCurrentPosition(pos => {
    const { latitude: lat, longitude: lng } = pos.coords;
    setUserPos(lat, lng);
    map.setView([lat, lng], 15);
  }, () => toast('Tidak bisa mendapatkan lokasi'));
}


// Init locate on load
locateMe();

// ══════════════════════════════════════════════
//  SEARCH / NOMINATIM
// ══════════════════════════════════════════════
let searchTimer;

// Cache hasil geocoding supaya ketik ulang tidak memukul Nominatim lagi.
// Kebijakan usage Nominatim maksimal 1 request/detik, jadi debounce di
// bawah WAJIB 1000ms dan tidak boleh dilewati oleh cache.
const geocodeCache = new Map();


export async function fetchSuggestions(q) {
  if (geocodeCache.has(q)) { renderSuggestions(geocodeCache.get(q)); return; }
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=5&countrycodes=id`;
    const res  = await fetch(url, { headers: { 'Accept-Language': 'id' } });
    const data = await res.json();
    geocodeCache.set(q, data);
    renderSuggestions(data);
  } catch { toast('Gagal mencari lokasi'); }
}

export function renderSuggestions(items) {
  suggestionsEl.innerHTML = '';
  if (!items.length) { suggestionsEl.style.display = 'none'; return; }
  items.forEach(item => {
    const div = document.createElement('div');
    div.className = 'suggestion-item';
    div.textContent = item.display_name;
    div.addEventListener('click', () => {
      searchInput.value = item.display_name;
      suggestionsEl.style.display = 'none';
      selectDestination(parseFloat(item.lat), parseFloat(item.lon), item.display_name);
    });
    suggestionsEl.appendChild(div);
  });
  suggestionsEl.style.display = 'block';
}

/**
 * Pencarian tempat & tombol lokasi.
 *
 * Dipanggil sekali dari src/main.js. Semua listener dipasang di sini,
 * bukan diatas modul modul, supaya urutan mendaftarnya mengikuti urutan pemanggilan
 * init dan bisa diuji tanpa memuat halaman.
 */
export function initSearch() {
  document.getElementById('btn-locate').addEventListener('click', locateMe);
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const q = searchInput.value.trim();
    if (q.length < 3) { suggestionsEl.style.display = 'none'; return; }
    if (geocodeCache.has(q)) { renderSuggestions(geocodeCache.get(q)); return; }
    searchTimer = setTimeout(() => fetchSuggestions(q), 1000);
  });
  document.addEventListener('click', e => {
    // TypeScript memberi e.target tipe EventTarget, yang tidak punya
    // closest(). Untuk event klik target selalu elemen, jadi cast ini aman
    // dan itu memberitahu tsc apa yang sebenarnya terjadi di browser.
    const el = /** @type {Element} */ (e.target);
    // Panel bookmarklet ikut dikecualikan: tanpa ini, klik tombolnya akan
    // membuka panel lalu langsung menutupnya lagi di handler document ini.
    if (el.closest('.search-wrap') || el.closest('#bookmarklet-panel')
        || el.closest('#btn-bookmarklet')) return;
    suggestionsEl.style.display = 'none';
    hideConfirm();
    toggleBookmarkletPanel(false);
  });
}
