# ESP32 Navigator

Navigasi GPS gratis: OpenStreetMap + OSRM + Web Bluetooth → ESP32 + OLED

---

## Isi Folder

```
esp32-nav/
├── index.html          ← Website navigasi (upload ke hosting)
├── esp32_nav/
│   └── esp32_nav.ino   ← Kode ESP32 (upload via Arduino IDE)
└── README.md
```

---

## Cara Pakai

### 1. Upload kode ke ESP32

**Library yang dibutuhkan (Arduino IDE → Library Manager):**
- `Adafruit SSD1306`
- `Adafruit GFX Library`

**Wiring OLED ke ESP32:**
| OLED | ESP32 |
|------|-------|
| VCC  | 3.3V  |
| GND  | GND   |
| SDA  | GPIO 21 |
| SCL  | GPIO 22 |

Buka `esp32_nav/esp32_nav.ino` di Arduino IDE, pilih board **ESP32 Dev Module**, lalu upload.

---

### 2. Upload website ke hosting gratis

**Opsi A — Netlify (paling mudah):**
1. Buka [netlify.com](https://netlify.com) → Login
2. Drag & drop file `index.html` ke dashboard
3. Dapat link HTTPS otomatis (contoh: `https://esp32-nav.netlify.app`)

**Opsi B — GitHub Pages:**
1. Buat repo baru di GitHub
2. Upload `index.html`
3. Settings → Pages → Deploy from main branch
4. Link: `https://username.github.io/nama-repo`

---

### 3. Gunakan

1. Nyalakan ESP32 → layar OLED tampil "Menunggu HP..."
2. Buka link website di **Chrome Android**
3. Izinkan akses lokasi GPS
4. Tap **Hubungkan** → pilih `ESP32-NAV`
5. Ketik tujuan di kolom pencarian
6. Tap **Mulai Navigasi**
7. Instruksi otomatis dikirim ke OLED ESP32!

---

## Protokol BLE

Website mengirim instruksi ke ESP32 lewat satu characteristic UUID
`6e400001-b5a3-f393-e0a9-e50e24dcca9e`, mode **write**.

Satu pesan logis berbentuk:

```
V1|<icon>|<dist_m>|<text>\n
```

| Field | Isi |
|---|---|
| `V1` | versi protokol |
| `<icon>` | kode maneuver `0`..`12` (lihat tabel di bawah) |
| `<dist_m>` | jarak dalam meter, `-1` = tidak ada jarak |
| `<text>` | teks instruksi, ASCII, maks 40 karakter |
| `\n` | terminator wajib |

Tabel ikon:

| Kode | Maneuver | Kode | Maneuver |
|---|---|---|---|
| 0 | mulai / lurus | 7 | belok kanan |
| 1 | lanjut | 8 | belok tajam kanan |
| 2 | sedikit kiri | 9 | bundaran |
| 3 | belok kiri | 10 | gabung / ramp |
| 4 | belok tajam kiri | 11 | tiba |
| 5 | putar balik | 12 | tidak diketahui |
| 6 | sedikit kanan | | |

Kode ikon ini harus identik di dua tempat: tabel `ICON_*` di
`esp32_nav.ino` dan fungsi `maneuverCode()` di `index.html`.

**Dua hal penting soal pengiriman:**

1. `onWrite()` di firmware dipanggil **sekali per write**, bukan sekali per
   pesan. Jadi website memecah payload jadi beberapa write maksimal **20 byte**
   (muat pada MTU default 23) dan mengirimnya **berurutan**. Tanpa penanda
   `\n`, firmware tidak akan menggambar apa pun.
2. Tulis-an tidak boleh tumpang tindih. `sendToBLE()` di `index.html`
   memakai rantai `Promise` supaya satu pesan selesai sebelum yang berikutnya
   mulai, dan memakai `writeValueWithResponse()` dengan fallback ke
   `writeValue()` untuk characteristic yang tidak mendukungnya.

Firmware juga menyaring ulang teksnya (buang non-ASCII, karakter kontrol,
dan `|`), jadi website yang salah kirim tidak akan merusak layar.

---

## Catatan

- Web Bluetooth hanya jalan di **Chrome** (Android/Desktop)
- Butuh **HTTPS** (makanya perlu hosting, bukan buka file lokal)
- OSRM public API cocok untuk pemakaian pribadi (ada rate limit wajar)
- Pencarian lokasi memakai **Nominatim** dengan `countrycodes=id` (hanya
  Indonesia). Debounce **1000 ms** + cache, karena kebijakan usage
  Nominatim maksimal 1 request/detik
- Jarak deteksi belokan: **25 meter** (bisa diubah di `index.html` baris `if (dist < 25)`)
- Peringatan saat deviasi dari rute (off-route) **belum** diimplementasikan
- Ikon di layar digambar prosedural (garis tebal + segitiga), bukan tabel
  bitmap, supaya mudah diskalakan ke ukuran lain
