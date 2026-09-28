// @ts-check
//
//  MAP INIT
//
// ══════════════════════════════════════════════
//  MAP INIT
// ══════════════════════════════════════════════
//
// Peta dan ikon dibuat pada top-level modul, sama seperti sebelumnya di
// index.html. Aman karena module script bersifat deferred, jadi `#map` sudah
// ada; dan `L` sudah terdefinisi karena Leaflet dimuat lewat <script> klasik
// yang berjalan sebelum modul apa pun dieksekusi.
export const map = L.map('map', { zoomControl: false }).setView([-6.2, 106.8], 13);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© OpenStreetMap contributors',
  maxZoom: 19,
}).addTo(map);

L.control.zoom({ position: 'topright' }).addTo(map);

export const userIcon = L.divIcon({
  html: '<div style="width:16px;height:16px;background:#4f8ef7;border:3px solid #fff;border-radius:50%;box-shadow:0 0 8px #4f8ef7aa"></div>',
  iconSize: [16, 16], iconAnchor: [8, 8], className: '',
});

export const destIcon = L.divIcon({
  html: '<div style="font-size:26px;line-height:1;filter:drop-shadow(0 2px 4px #0008)">📍</div>',
  iconSize: [26, 32], iconAnchor: [13, 32], className: '',
});

