// @ts-check
//
//  KONFIRMASI TUJUAN & TOAST
//

import { confirmEl, searchInput, suggestionsEl } from './dom.js';
import { toast } from './toast.js';
import { parseMapsLink } from './parse.js';
import { fetchSuggestions } from './geocode.js';
import { selectDestination } from './route.js';
// ══════════════════════════════════════════════
//  KONFIRMASI TUJUAN DARI LINK
// ══════════════════════════════════════════════

export function hideConfirm() { confirmEl.style.display = 'none'; }

export function showConfirm(res) {
  confirmEl.innerHTML = '';

  const nameEl = document.createElement('div');
  nameEl.className = 'mc-name';
  nameEl.textContent = res.name;

  const coordEl = document.createElement('div');
  coordEl.className = 'mc-coord';
  coordEl.textContent = res.lat.toFixed(5) + ', ' + res.lng.toFixed(5);

  // '!3d/!4d' = pin asli. '@' = pusat layar Google Maps yang bisa jauh dari
  // pin, jadi koordinat seperti itu tidak boleh tampil tanpa label peringatan.
  const tagEl = document.createElement('span');
  tagEl.className = res.exact ? 'mc-tag' : 'mc-tag approx';
  tagEl.textContent = res.exact ? 'persis' : 'perkiraan — pusat layar Google Maps';

  const actions = document.createElement('div');
  actions.className = 'mc-actions';

  const useBtn = document.createElement('button');
  useBtn.className = 'primary';
  useBtn.textContent = 'Pakai tujuan ini';
  useBtn.addEventListener('click', () => {
    hideConfirm();
    suggestionsEl.style.display = 'none';
    searchInput.value = res.name;
    selectDestination(res.lat, res.lng, res.name);
  });

  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'Batal';
  cancelBtn.addEventListener('click', () => {
    hideConfirm();
    searchInput.value = '';
  });

  actions.append(useBtn, cancelBtn);
  confirmEl.append(nameEl, coordEl, tagEl, actions);
  confirmEl.style.display = 'block';
  suggestionsEl.style.display = 'none';
}

// Sengaja TIDAK memanggil selectDestination langsung. Aplikasi ini dipakai
// sambil mengendarai, dan tujuan yang salah akan mengarahkan ke tempat keliru
// di jalan. Baris konfirmasi memaksa user melambat dan membaca dulu.
export function handleMapsInput(text) {
  const res = parseMapsLink(text);
  if (res.ok) { showConfirm(res); return true; }
  if (res.reason === 'short-link') {
    hideConfirm();
    toast('Link pendek tidak bisa dibaca. Pasang bookmark 🔗 di panel atas untuk kirim sekali-tap.');
    return true;
  }
  if (res.reason === 'needs-geocode' && res.name) {
    hideConfirm();
    searchInput.value = res.name;
    fetchSuggestions(res.name);
    return true;
  }
  return false; // teks biasa — biarkan jalur Nominatim yang sudah ada
}

/**
 * Tempel & Enter di kolom pencarian.
 *
 * Dipanggil sekali dari src/main.js. Semua listener dipasang di sini,
 * bukan diatas modul modul, supaya urutan mendaftarnya mengikuti urutan pemanggilan
 * init dan bisa diuji tanpa memuat halaman.
 */
export function initConfirm() {
  searchInput.addEventListener('paste', e => {
    const text = (e.clipboardData || window.clipboardData).getData('text');
    if (handleMapsInput(text)) e.preventDefault();
  });
  searchInput.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    if (handleMapsInput(searchInput.value)) e.preventDefault();
  });
}
