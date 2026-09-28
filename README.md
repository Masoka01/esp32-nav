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

## Catatan

- Web Bluetooth hanya jalan di **Chrome** (Android/Desktop)
- Butuh **HTTPS** (makanya perlu hosting, bukan buka file lokal)
- OSRM public API cocok untuk pemakaian pribadi (ada rate limit wajar)
- Jarak deteksi belokan: **25 meter** (bisa diubah di `index.html` baris `if (dist < 25)`)
