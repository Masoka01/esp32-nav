# ESP32 Navigator

Navigasi GPS gratis: OpenStreetMap + OSRM + Web Bluetooth → ESP32 + OLED

---

## Isi Folder

```
esp32-nav/
├── index.html          ← Website navigasi (upload ke hosting)
├── manifest.json       ← Metadata PWA: nama, ikon, mode standalone
├── sw.js               ← Service worker (syarat agar bisa di-install)
├── icons/
│   ├── icon.svg        ← Sumber ikon (edit lalu regenerate, lihat Test)
│   ├── icon-192.png    ← Ikon 192px
│   ├── icon-512.png    ← Ikon 512px
│   └── maskable-512.png← Ikon anti-terpotong untuk Android
├── esp32_nav/
│   └── esp32_nav.ino   ← Kode ESP32 (upload via Arduino IDE)
├── test/               ← Test host, tidak butuh board
│   ├── run.sh          ← bash test/run.sh
│   ├── payloads.txt    ← Data payload bersama web ↔ firmware
│   └── ...
└── README.md
```

---

## Tech Stack

Semuanya gratis, tanpa API key, tanpa akun, tanpa biaya bulanan. Tidak ada
build step: yang kamu upload ke hosting adalah file yang persis seperti di repo.

### Peta & routing

| Pilih | Dipakai untuk | Keterangan |
|-------|---------------|------------|
| **Leaflet 1.9.4** | Render peta | Dimuat dari unpkg, satu file JS + CSS |
| **OpenStreetMap tiles** | Gambaran peta jalan | Tile raster, `tile.openstreetmap.org` |
| **OSRM** | Menghitung rute jalan | `router.project-osrm.org`, mendukung `steps=true` untuk belokan |
| **Nominatim** | Pencarian alamat | `nominatim.openstreetmap.org/search` |
| **Google Fonts** | DM Sans + DM Mono | Typography saja, bukan data |

Ketiganya adalah API publik tanpa autentikasi. Konsekuensinya jujur dan perlu
dikusung: Nominatim dan OSRM punya **rate limit** dan **tidak ada jaminan
uptime**. Untuk dipakai pribadi atau skala kecil ini sepenuhnya wajar; jangan
mengandalkannya untuk dipakai luas atau jadi sistem produksi.

> Semua host di atas **tidak boleh** di-cache service worker. Ini aturan
> yang paling sering dilanggar dan paling merusak: cache tile
> OpenStreetMap melanggar kebijakan mereka. Service worker di sini memakai
> pola *deny-by-default* — hanya file shell same-origin yang boleh masuk cache.

### Web app

- **Tanpa framework.** Satu `index.html` berisi HTML + CSS + JS. Tidak ada React,
  Vue, atau build step. Alasannya: aplikasi ini harus bisa di-host di mana saja
  dan tetap jalan, termasuk setelah lima tahun tidak disentuh.
- **Web Bluetooth** (`navigator.bluetooth`) untuk bicara ke ESP32. Hanya
  tersedia di Chrome/Android, dan butuh **HTTPS** + user gesture.
- **PWA** — `manifest.json` + `sw.js` ditulis tangan, tanpa Workbox.
- **Web Share Target** — menangkap `POST` dari share sheet Android di dalam
  service worker, lalu meneruskan lewat fragment. Tujuannya: link tujuan
  **tidak pernah sampai ke server**.
- **Screen Wake Lock** + fallback audio WAV yang di-inline sebagai base64,
  supaya layar tidak mati saat menjelajah sambil mengendarai.
- **GPS** via `navigator.geolocation.watchPosition`, dengan `pendingRestore`
  supaya refresh saat tengah bernavigasi tidak ikut hilang.

### Firmware

- **ESP32** (C3 atau WROOM) + **SSD1306 OLED 128×64** lewat I2C.
- **NimBLE-Arduino 2.x** — GATT server, protokol Nordic UART UUID.
- **Adafruit GFX + SSD1306** — menggambar panah secara prosedural (tidak ada
  sprite bitmap), supaya semuanya muat di flash kecil.
- **FreeRTOS queue** — `onWrite` hanya accumulate lalu enqueue, tidak
  menggambar di dalam context task GATT. Menunda BLE akan merusak koneksi.

### Test

- **Node.js** (`node --test` style, runner sendiri) — logika web di-*extract*
  dari `index.html` lalu dijalankan, jadi yang diuji adalah kode yang benar-benar
  terkirim.
- **g++** — firmware dikompilasi ke host dengan stub Arduino/NimBLE di
  `test/stubs.h`. Nol dependency, nol `arduino-cli`.
- **479 check**, semuanya jalan di laptop tanpa board dan tanpa Chrome.

---

## Cara Pakai

### 1. Upload kode ke ESP32

**Library yang dibutuhkan (Arduino IDE → Library Manager):**
- `Adafruit SSD1306`
- `Adafruit GFX Library`
- `NimBLE-Arduino` (**wajib versi 2.x**)

> **Kenapa NimBLE, bukan BLE bawaan?** Firmware ini memakai stack **NimBLE**,
> bukan `BLEDevice.h` bawaan ESP-IDF. Alasannya bukan selera: `BLEDevice.h`
> **hanya ada di chip ESP32 asli**. ESP32-C3 punya radio BLE 5.0, tapi tidak
> punya stack itu, sehingga kode versi lama **tidak akan bisa dikompilasi**
> di C3 sama sekali. NimBLE jalan di **kedua** chip, jadi satu sketch ini
> bisa dipakai untuk WROOM maupun C3 tanpa perubahan.
>
> Wajib 2.x karena API-nya berubah drastis dari 1.x — parameter callback
> berubah dan nama fungsi advertising berbeda. Di 1.x, kode ini gagal
> compile dengan error yang membingungkan.

**Board yang bisa dipakai:**

| Board | Pilihan di Arduino IDE | Status |
|-------|------------------------|--------|
| ESP32-C3 | `ESP32C3 Dev Module` | didukung |
| ESP32 asli (WROOM / D0WD) | `ESP32 Dev Module` | didukung |
| ESP32-S3, C6, H2 | — | belum diverifikasi |

Buka `esp32_nav/esp32_nav.ino` di Arduino IDE, pilih board yang sesuai, lalu
upload.

**Wiring OLED ke ESP32 asli (WROOM):**
| OLED | ESP32 |
|------|-------|
| VCC  | 3.3V  |
| GND  | GND   |
| SDA  | GPIO 21 |
| SCL  | GPIO 22 |

**Kalau pakai ESP32-C3:** jangan memakai pin di atas. C3 tidak punya GPIO 21/22,
dan pin I2C default-nya **berbeda tiap board**. Cek silkscreen atau pinout
board-mu — sebagian C3 memakai SDA/SCL di GPIO 8/9, sebagian di 6/7. Kalau
pinnya tidak cocok, ganti angka GPIO di bagian `setup()`.

> **Belum pernah diuji di hardware.** Port ke NimBLE diverifikasi lewat test
> suite (stub-nya mencerminkan API 2.x), tapi belum pernah di-flash ke board
> asli. Kalau advertising-nya bermasalah, gejalanya khas: Wi-Fi dan OLED
> normal, tapi **Chrome menampilkan "no devices found"** padahal ESP32
> menyala dan berada di dekat.

---

### 2. Upload website ke hosting gratis

> **Upload SELURUH folder, bukan cuma `index.html`.**
> Kalau `manifest.json`, `sw.js`, atau `icons/` tidak ikut ter-deploy, Chrome
> hanya bisa membuat shortcut biasa dan aplikasi tidak bisa di-install.

**Opsi A — Vercel (paling mudah):**
1. Buka [vercel.com](https://vercel.com) → Login
2. Add New → Project, lalu pilih repo GitHub ini
3. Framework Preset: **Other**. Biarkan Build Command kosong, Output
   Directory: `.` — repo ini statis, tidak ada build step
4. Deploy → dapat link HTTPS otomatis (contoh: `https://esp32-nav.vercel.app`)

Alternatif tanpa akun GitHub: `npx vercel` di root repo, lalu ikut prompt.

**Opsi B — Netlify:**
1. Buka [netlify.com](https://netlify.com) → Login
2. **Drag & drop folder `esp32-nav/`** — bukan file `index.html` saja
3. Dapat link HTTPS otomatis

**Opsi C — GitHub Pages:**
1. Upload seluruh isi repo ke branch `main`
2. Settings → Pages → Deploy from main branch
3. Link: `https://username.github.io/nama-repo`

### 2b. Pasang sebagai aplikasi di HP

Wajib lewat **HTTPS**. Dari `file://` atau `http://192.168.x.x` tidak akan
berhasil: Chrome memblokir service worker dan geolokasi di luar secure context,
sehingga tidak ada install **dan** GPS tidak akan menyala.

1. Buka link HTTPS di **Chrome Android**
2. Menu `⋮` → **Install app** (atau **Add to home screen** → Install app)
3. Kalau yang muncul hanya "Create shortcut", berarti `manifest.json` atau
   `sw.js` belum ikut ter-deploy — cek lagi langkah 2 di atas

Kalau Chrome masih menampilkan "Create shortcut" padahal semua file sudah
ter-deploy, uninstall dulu shortcut lama, lalu muat ulang sekali. Chrome
menyimpan status installability di cache.

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

Baris konfirmasi sengaja tidak langsung merute: aplikasi ini dipakai sambil
mengendarai, jadi tujuan yang salah harus dicek mata dulu.

#### Cara utama: Share dari Google Maps

1. Di Google Maps, pilih lokasi → **Share**
2. Pilih **ESP-Nav** dari daftar share sheet Android
3. Aplikasi terbuka sendiri dan baris konfirmasi langsung muncul:
   - **persis** — koordinat diambil dari pin asli (`!3d/!4d`)
   - **perkiraan — pusat layar Google Maps** — hanya pusat layar, bisa jauh dari pin
4. Tap **Pakai tujuan ini**

Tidak ada copy-paste sama sekali. Link-nya ditangkap service worker saat
dibaca, lalu diteruskan lewat fragment `#u=` — jadi **tidak pernah sampai ke
server** dan tidak muncul di access log.

**Dua syarat yang wajib dipenuhi:**

- Aplikasi sudah **ter-install**, karena share target hanya muncul untuk PWA
  yang sudah terpasang.
- Aplikasi sudah **dibuka minimal sekali** setelah install. Chrome hanya
  mengaktifkan service worker setelah halaman pertama selesai dimuat, dan
  share target butuh SW yang sudah aktif. Kalau Share masih membuka halaman
  kosong, buka aplikasinya sekali, tutup, lalu coba lagi.

> **Penting: kalau Share tidak muncul di daftar, uninstall lalu install ulang.**
> Share target didaftarkan oleh Chrome **pada saat PWA di-install**, bukan
> saat aplikasi di-update. Kalau kamu install versi yang sudah punya fitur
> ini, app-mu **harus** dicabut dulu: tekan ikon app di home screen lama,
> tahan, pilih *Uninstall* / *Remove*, baru install ulang dari Chrome.
> Setelah itu **tutup lalu buka sekali** aplikasinya, supaya service worker
> aktif. Tanpa langkah itu, Share akan tetap tidak muncul, apa pun
> yang kamu coba.

Kalau Share tidak muncul — iOS tidak mendukungnya sama sekali, atau kamu
share dari browser — pakai jalur cadangan di bawah.

#### Cadangan: Copy link lalu paste

1. Di Google Maps, pilih lokasi → **Share** → **Copy link**
2. Paste ke kolom pencarian di aplikasi ini
3. Muncul baris konfirmasi → tap **Pakai tujuan ini**

#### Cadangan terakhir: bookmarklet

Kalau tautannya berupa tautan pendek, copy-paste biasa tidak bisa mem-parse-nya
(jelaskanannya di bawah). Jalur terakhir: **Share → Copy link** di Maps,
lalu jalankan bookmarklet.

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
| `test_firmware.cpp` | `formatDist`, sanitasi, parsing, geometri 13 ikon, batas layar, pemenggalan footer, framing BLE, antrean penuh, callback koneksi, guard NimBLE | 128 |
| `test_cross.cpp` | Payload dipecah jadi chunk 20 byte, di-feed ke firmware, hasilnya dibandingkan baris demi baris | 40 |
| `test_web.mjs` | `sanitizeForBLE`, `clampCode`, `normalizeDist`, 23 kasus `maneuverCode`, format payload, pemecahan chunk, antrean kirim | 146 |
| `test_wake.mjs` | Acquire/release wake lock, reacquire saat `visibilitychange`, fallback audio, kondisi gagal | 42 |
| `test_trip.mjs` | Persistensi tujuan, restore tertunda, refresh saat bernavigasi, storage rusak | 50 |
| `test_pwa.mjs` | Manifest, aturan cache service worker, share target, fragment vs query string | 73 |

Total **479 check**, semuanya jalan di host tanpa board, tanpa `arduino-cli`,
tanpa Chrome.

`test/payloads.txt` adalah sumber data bersama: byte yang dikirim web
dipakai `test_cross.cpp` untuk membuktikan firmware meng-assemble dan
meng-parse-nya dengan hasil yang sama.

Yang **tidak** bisa diuji tanpa hardware: integrasi library NimBLE
sungguhan, perilaku I2C SSD1306, dan Screen Wake Lock di Chrome Android.

## Catatan

- Web Bluetooth hanya jalan di **Chrome** (Android/Desktop)
- Butuh **HTTPS** (makanya perlu hosting, bukan buka file lokal). Secure
  context ini juga yang mengaktifkan **GPS** — di `file://` atau HTTP biasa,
  `getCurrentPosition` diblokir sehingga rute tidak pernah dihitung
- Aplikasi bisa di-install sebagai PWA (ikon sendiri, tanpa address bar).
  Chrome membangun WebAPK kalau `manifest.json` + `sw.js` + ikon lengkap dan
  halaman sudah pernah dibuka minimal sekali di Chrome
- `sw.js` **sengaja hanya meng-cache shell** (`index.html`, manifest, ikon)
  dengan deny-by-default: semua request lintas-origin selalu network-only.
  Rute OSRM dan tile peta tidak pernah di-cache — rute basi membuat user
  diarahkan ke jalan yang salah, dan itu lebih buruk daripada peta kosong.
  `test/test_pwa.mjs` menjaga aturan ini dari regresi
- Setelah mengubah `sw.js`, naikkan `VERSION` di dalamnya, kalau tidak user
  akan tetap dilayani service worker lama dari cache
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
