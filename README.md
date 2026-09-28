# ESP32 Navigator

Navigasi GPS gratis: OpenStreetMap + OSRM + Web Bluetooth → ESP32 + OLED

---

## Isi Folder

```
esp32-nav/
├── index.html          ← Website navigasi (upload ke hosting)
├── esp32_nav/
│   └── esp32_nav.ino   ← Kode ESP32 (upload via Arduino IDE)
├── test/               ← Test host, tidak butuh board
│   ├── run.sh          ← bash test/run.sh
│   ├── payloads.txt    ← Data payload bersama web ↔ firmware
│   └── ...
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

### Cara paling cepat dapat koordinat dari Google Maps

Kolom pencarian menerima **link Google Maps** secara langsung. Ini cara paling
andal untuk tujuan yang tidak ketemu lewat pencarian biasa, karena koordinatnya
diambil langsung dari pin Google — bukan diterka dari database geocoder.

1. Di Google Maps, pilih lokasi → **Share** → **Copy link**
2. Paste ke kolom pencarian di aplikasi ini
3. Muncul baris konfirmasi berisi nama, koordinat, dan label
   - **persis** — koordinat diambil dari pin asli (`!3d/!4d`)
   - **perkiraan — pusat layar Google Maps** — hanya pusat layar, bisa jauh dari pin
4. Tap **Pakai tujuan ini**

Baris konfirmasi sengaja tidak langsung merute: aplikasi ini dipakai sambil
mengendarai, jadi tujuan yang salah harus dicek mata dulu.

#### Link pendek (`maps.app.goo.gl/…`)

Tautan yang keluar dari tombol Share sering berupa tautan pendek. **Browser
tidak bisa mengembangkannya**: untuk tahu ke mana ia mengarah, JavaScript
harus membaca jawaban server Google, dan `www.google.com/maps` tidak pernah
mengirim header `Access-Control-Allow-Origin`. Bukan karena formatnya belum
diketahui — server-nya memang menutup bacaannya.

Kalau kamu paste tautan pendek, muncul toast yang mengarahkan ke tombol
🔗 di panel atas:

1. Tap tombol **🔗** → kode bookmarklet muncul
2. **Salin kode**
3. Simpan sebagai bookmark bernama **Kirim ke ESP-Nav**
   - Chrome Android: ⋮ → Bookmark → **Edit** → More ⋮ → **Edit**, ganti URL
   - Chrome desktop: seret tautan ke bookmark bar, lalu edit URL-nya
4. Buka lokasi di Google Maps → tap bookmark itu

Kode ini **dibentuk dari `location.origin` aplikasi sendiri saat runtime**, jadi
tetap benar di Netlify, GitHub Pages, atau hosting lain — tidak ada URL yang
ditulis manual di kode.

Yang membuat bookmarklet bisa menembus batas yang tidak bisa dilalui parser:
bookmarklet **tidak melakukan `fetch` sama sekali**. Ia membaca `location.href`
dari halaman yang sedang dibuka, jadi tidak ada request lintas domain dan CORS
tidak pernah tersentuh.

URL tujuan dikirim lewat fragment `#u=`, bukan query string `?u=`, supaya tujuan
yang dipilih pengguna tidak pernah masuk ke access log server hosting.

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

## Test

Semua test berjalan di host — **tidak butuh board ESP32, tidak butuh
`arduino-cli`**, tidak butuh Chrome. Logika di dalam `esp32_nav.ino` diuji
lewat stub Arduino/BLE (`test/stubs.h`), dan logika di `index.html`
diekstrak langsung lalu dijalankan di Node, jadi yang diuji adalah kode
yang benar-benar terkirim dan diterima.

```bash
bash test/run.sh
```

| Suite | Isi | Check |
|---|---|---|
| `test_firmware.cpp` | `formatDist`, sanitasi, parsing, geometri 13 ikon, batas layar, pemenggalan footer, framing BLE, antrean penuh, callback koneksi | 123 |
| `test_cross.cpp` | Payload dipecah jadi chunk 20 byte, di-feed ke firmware, hasilnya dibandingkan baris demi baris | 40 |
| `test_web.mjs` | `sanitizeForBLE`, `clampCode`, `normalizeDist`, 23 kasus `maneuverCode`, format payload, pemecahan chunk, antrean kirim | 91 |
| `test_wake.mjs` | Acquire/release wake lock, reacquire saat `visibilitychange`, fallback audio, kondisi gagal | 42 |

`test/payloads.txt` adalah sumber data bersama: byte yang dikirim web
dipakai `test_cross.cpp` untuk membuktikan firmware meng-assemble dan
meng-parse-nya dengan hasil yang sama.

Yang **tidak** bisa diuji tanpa hardware: integrasi library Asix BLE
sungguhan, perilaku I2C SSD1306, dan Screen Wake Lock di Chrome Android.

## Catatan

- Web Bluetooth hanya jalan di **Chrome** (Android/Desktop)
- Butuh **HTTPS** (makanya perlu hosting, bukan buka file lokal)
- Selama navigasi, layar HP **dijaga tetap menyala** lewat Screen Wake Lock
  API. Kalau tidak, tab akan dibekukan browser, GPS berhenti, dan OLED
  membeku pada instruksi yang sudah basi tanpa ada peringatan
  - Baterai terkuras lebih cepat karena layar terus menyala. Turunkan
    kecerahan layar selama navigasi
  - Batasnya: Wake Lock hanya mencegah timeout layar. Kalau kamu pindah ke
    aplikasi lain atau mengunci HP manual, lock tetap dilepas dan navigasi
    bisa terputus
  - Kalau permintaan wakelock ditolak (battery saver, baterai lemah), aplikasi
    menampilkan peringatan di bawah tombol navigasi
- OSRM public API cocok untuk pemakaian pribadi (ada rate limit wajar)
- Pencarian lokasi memakai **Nominatim** dengan `countrycodes=id` (hanya
  Indonesia). Debounce **1000 ms** + cache, karena kebijakan usage
  Nominatim maksimal 1 request/detik
- Jarak deteksi belokan: **25 meter** (bisa diubah di `index.html` baris `if (dist < 25)`)
- Peringatan saat deviasi dari rute (off-route) **belum** diimplementasikan
- Ikon di layar digambar prosedural (garis tebal + segitiga), bukan tabel
  bitmap, supaya mudah diskalakan ke ukuran lain
