// Deklarasi untuk global yang datang dari luar sistem modul.
//
// Leaflet dimuat lewat <script> klasik di index.html, jadi `L` ada sebagai
// global browser, bukan import. Tanpa deklarasi di sini, tsc akan melaporkan
// "Cannot find name 'L'" di setiap modul yang memakainya.
//
// Sengaja `any`, bukan interface Leaflet yang lengkap: proyek ini tidak punya
// package.json, jadi tidak ada @types/leaflet yang bisa diinstal. Menyalin
// definisi tipe Leaflet ke dalam repo hanya untuk memperhalus beberapa
// panggilan tidak sebanding dengan demandeznya. Kalau nanti proyek ini memakai
// dependensi sungguhan, ganti `any` di sini dengan tipe resmi Leaflet, lalu
// hapus juga deklarasi navigator.bluetooth di bawah.

declare const L: any;

interface Navigator {
  // Web Bluetooth hanya ada di Chrome/Android; dipakai src/ble.js yang sudah
  // memeriksa ketersediaan sebelum memanggil.
  bluetooth: any;
}

interface Window {
  // Warisan lama untuk clipboard paste di browser lama. src/ui.js tetap
  // membacanya sebagai fallback untuk e.clipboardData.
  clipboardData: any;
}
