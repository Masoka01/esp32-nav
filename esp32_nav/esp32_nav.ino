/*
  ESP32 Navigator - BLE Receiver + OLED Display
  ================================================
  Library yang dibutuhkan (install via Arduino Library Manager):
  - Adafruit SSD1306
  - Adafruit GFX Library

  Wiring OLED ke ESP32:
    OLED VCC  →  3.3V
    OLED GND  →  GND
    OLED SDA  →  GPIO 21
    OLED SCL  →  GPIO 22
*/

// Stack BLE: NimBLE, bukan Bluedroid bawaan ESP-IDF.
//
// Alasannya konkret, bukan selera. BLEDevice.h (Bluedroid) hanya ada di
// chip ESP32 asli. ESP32-C3 punya radio BLE 5.0, tapi TIDAK punya stack
// itu -- firmware tidak akan bisa dikompilasi di sana sama sekali.
// NimBLE jalan di KEDUA chip, jadi satu sketch ini bisa dipakai untuk
// WROOM maupun C3 tanpa perubahan.
//
// Butuh NimBLE-Arduino 2.x. Di 1.x API-nya beda jauh (callback tidak punya
// parameter connInfo, dan advertising memakai nama fungsi yang lain).
#include <NimBLEDevice.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>
#include <math.h>
#include <string.h>

// ── OLED Config ──
#define SCREEN_WIDTH  128
#define SCREEN_HEIGHT 64
#define OLED_RESET    -1  // Reset pin (tidak dipakai)
#define OLED_ADDRESS  0x3C  // Ganti 0x3D jika tidak terdeteksi

Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, OLED_RESET);

// ── BLE UUIDs (harus sama dengan website) ──
#define SERVICE_UUID  "6E400001-B5B3-F393-E0A9-E50E24DCCA9E"
#define CHAR_UUID     "6E400002-B5B3-F393-E0A9-E50E24DCCA9E"

// ═══════════════════════════════════════════════════════════════════
//  PROTOKOL BLE
// ═══════════════════════════════════════════════════════════════════
//  Satu pesan logis:
//
//      "V1|" <icon> "|" <dist_m> "|" <text> "\n"
//
//  - "V1"   versi protokol, 2 byte literal
//  - "|"    pemisah field (0x7C)
//  - "\n"   terminator (0x0A)
//
//  PENTING: satu pesan logis bisa MELEWATI beberapa write BLE.
//  Web Bluetooth tidak memakai ATT prepare-write, jadi website yang
//  memecahnya jadi beberapa writeValueWithResponse() <= 20 byte.
//  onWrite() dipanggil SEKALI PER WRITE, jadi kita HARUS buffer
//  sampai '\n' muncul sebelum menggambar. Tanpa ini tiap pecahan
//  akan digambar sebagai instruksi sendiri.
//
//  <icon>    0..12, lihat tabel ikon di bawah
//  <dist_m>  integer meter, -1 = tanpa jarak
//  <text>    ASCII, tanpa '|' atau newline, maks 40 char
// ═══════════════════════════════════════════════════════════════════

#define PROTO_VER     "V1"
#define PROTO_PREFIX  "V1|"
#define PROTO_SEP     '|'
#define PROTO_END     '\n'
#define TEXT_MAX      40  // sesuai batas di sisi web
#define LINE_MAX      (TEXT_MAX + 48)  // generously sized buffer
#define ICON_MAX      12

// Layout — lihat fungsi drawHeader() untuk asal-usul tiap angka
#define HEADER_H      12
#define ARROW_X        2
#define ARROW_Y        14
#define ARROW_SIZE     32
#define DIST_X        42
#define DIST_Y        22
#define FOOT_Y1       47
#define FOOT_Y2       56
#define FOOT_CHARS    21  // 21 char * 6px = 126px, muat di 128px

// ═══════════════════════════════════════════════════════════════════
//  STATE
// ═══════════════════════════════════════════════════════════════════

bool deviceConnected = false;

// Prototipe eksplisit supaya file ini juga bisa dikompilasi sebagai C++
// biasa (Arduino IDE otomatis membuat prototipe; harness test tidak).
void showStatus(const char* msg, bool connected);

// Antrean baris lengkap dari task BLE ke loop().
QueueHandle_t navQueue = NULL;

// Buffer receptor, hanya disentuh di dalam callback BLE.
String rxBuf;
bool rxOverflow = false;

// ═══════════════════════════════════════════════════════════════════
//  BLE CALLBACKS
// ═══════════════════════════════════════════════════════════════════

class ServerCallbacks : public NimBLEServerCallbacks {
  // NimBLE 2.x menambah parameter NimBLEConnInfo& ke setiap callback koneksi.
  // Versi 1.x hanya punya BLEServer* saja -- kalau tanda tangannya lupa
  // ditambah, override ini tidak akan pernah dipanggil.
  void onConnect(NimBLEServer* pServer, NimBLEConnInfo& connInfo) override {
    deviceConnected = true;
    showStatus("Terhubung!", true);
    Serial.println("[BLE] Device connected");
  }

  void onDisconnect(NimBLEServer* pServer, NimBLEConnInfo& connInfo, int reason) override {
    deviceConnected = false;
    // Buang sisa pesan setengah jadi supaya tidak muncul saat reconnect.
    rxBuf = "";
    rxOverflow = false;
    showStatus("Menunggu HP...", false);
    Serial.print("[BLE] Device disconnected, reason=");
    Serial.println(reason);
    // Wajib: NimBLE 2.x tidak lagi mengiklankan ulang secara otomatis
    // saat peer putus. Tanpa baris ini, HP tidak akan menemukan perangkat
    // lagi sampai ESP32 di-reset.
    NimBLEDevice::startAdvertising();
  }
};

class CharCallbacks : public NimBLECharacteristicCallbacks {
  // Parameter connInfo wajib ada di NimBLE 2.x (versi 1.x tidak punya).
  void onWrite(NimBLECharacteristic* pChar, NimBLEConnInfo& connInfo) override {
    // Callback ini jalan di context task GATT. JANGAN menggambar di sini:
    // frame SSD1306 lewat I2C butuh 10-30ms dan akan menunda BLE.
    // Task juga hanya accumulate + enqueue, lalu return.

    // getData()/getLength() sudah tidak ada di NimBLE; nilainya dibungkus
    // NimBLEAttValue. Yang tetap dijaga: baca lewat data() + length(),
    // BUKAN c_str() — c_str() lossy dan tidak aman untuk data multi-byte
    // (nama jalan Indonesia bisa mengandung byte di luar 7-bit).
    const NimBLEAttValue& val = pChar->getValue();
    const uint8_t* data = val.data();
    size_t len = val.length();
    if (data == NULL || len == 0) return;

    for (size_t i = 0; i < len; i++) {
      char c = (char)data[i];

      if (c == PROTO_END) {
        // Akhir pesan: kirim baris lengkap ke loop().
        if (!rxOverflow && rxBuf.length() > 0) {
          char line[LINE_MAX];
          size_t n = rxBuf.length() < (size_t)(LINE_MAX - 1) ? rxBuf.length() : (size_t)(LINE_MAX - 1);
          memcpy(line, rxBuf.c_str(), n);
          line[n] = '\0';
          if (xQueueSend(navQueue, line, 0) != pdTRUE) {
            Serial.println("[NAV] antrean penuh, pesan dibuang");
          }
        }
        // Reset state setelah terminator, baik sukses maupun overflow.
        rxBuf = "";
        rxOverflow = false;
      } else if (c == '\r') {
        // Abaikan — sebagian klien kirim CRLF.
      } else {
        if (rxOverflow) continue;  // buang sisa sampai terminator berikutnya
        if (rxBuf.length() >= (unsigned int)(LINE_MAX - 1)) {
          // Terlalu panjang: tolak seluruh pesan, tunggu resync di '\n'.
          rxBuf = "";
          rxOverflow = true;
          Serial.println("[NAV] pesan melebihi buffer, dibuang");
        } else {
          rxBuf += c;
        }
      }
    }
  }
};

// ═══════════════════════════════════════════════════════════════════
//  PARSING PROTOKOL
// ═══════════════════════════════════════════════════════════════════

// Buang byte >= 0x7F (font GFX cuma ASCII), karakter kontrol, dan
// FIELD_SEPARATOR. Rapatkan spasi, lalu potong ke TEXT_MAX.
// Dipanggil di loop(), bukan di callback.
String sanitizeText(const String& in) {
  String out;
  bool lastWasSpace = true;  // true supaya spasi depan langsung dilewati

  for (unsigned int i = 0; i < in.length(); i++) {
    char c = in.charAt(i);
    unsigned char u = (unsigned char)c;

    if (u >= 0x7F) continue;               // non-ASCII / sisipan UTF-8
    if (c == PROTO_SEP || c == '\n' || c == '\r') continue;
    if (u < 0x20) continue;                // sisa kontrol lain

    if (c == ' ') {
      if (lastWasSpace) continue;
      lastWasSpace = true;
      out += ' ';
    } else {
      lastWasSpace = false;
      out += c;
    }
    if (out.length() >= TEXT_MAX) break;
  }

  while (out.length() > 0 && out.charAt(out.length() - 1) == ' ') {
    out.remove(out.length() - 1);
  }
  return out;
}

bool allDigits(const String& s) {
  if (s.length() == 0) return false;
  for (unsigned int i = 0; i < s.length(); i++) {
    char c = s.charAt(i);
    if (c < '0' || c > '9') return false;
  }
  return true;
}

// Parse "V1|<icon>|<dist>|<text>". Mengembalikan false (dan diam-diam
// mengabaikan pesan) untuk apa pun yang tidak persis sesuai kontrak.
bool parseMessage(const char* line, uint8_t& icon, long& dist, String& text) {
  String s(line);
  if (!s.startsWith(PROTO_PREFIX)) return false;

  int i1 = s.indexOf(PROTO_SEP, 3);  // 3 = panjang "V1|"
  if (i1 < 0) return false;
  int i2 = s.indexOf(PROTO_SEP, i1 + 1);
  if (i2 < 0) return false;

  String sIcon = s.substring(3, i1);
  String sDist = s.substring(i1 + 1, i2);
  String sText = s.substring(i2 + 1);

  if (!allDigits(sIcon)) return false;
  int v = sIcon.toInt();
  if (v < 0 || v > ICON_MAX) return false;

  if (sDist.length() == 0) return false;
  bool neg = (sDist.charAt(0) == '-');
  String sDigits = neg ? sDist.substring(1) : sDist;
  if (!allDigits(sDigits)) return false;

  icon = (uint8_t)v;
  dist = sDist.toInt();
  text = sanitizeText(sText);
  return true;
}

// ═══════════════════════════════════════════════════════════════════
//  PRIMITIF GAMBAR
// ═══════════════════════════════════════════════════════════════════

// Garis tebal: Adafruit GFX drawLine() tidak punya parameter lebar,
// jadi digambar sebagai beberapa garis paralel.
// Offset tegak lurus dihitung dari arah garis, jadi otomatis benar
// untuk garis horizontal, vertikal, maupun diagonal.
static void thickLine(int16_t x0, int16_t y0, int16_t x1, int16_t y1, int16_t w) {
  if (w < 1) w = 1;
  int16_t dx = x1 - x0;
  int16_t dy = y1 - y0;
  float len = sqrtf((float)dx * dx + (float)dy * dy);
  if (len < 0.01f) {
    display.drawPixel(x0, y0, SSD1306_WHITE);
    return;
  }
  float px = -(float)dy / len;   // tegak lurus (x)
  float py =  (float)dx / len;   // tegak lurus (y)
  int16_t from = -(w / 2);
  int16_t to = w - 1 - (w / 2);
  for (int16_t o = from; o <= to; o++) {
    display.drawLine(x0 + (int16_t)lroundf(px * o), y0 + (int16_t)lroundf(py * o),
                     x1 + (int16_t)lroundf(px * o), y1 + (int16_t)lroundf(py * o),
                     SSD1306_WHITE);
  }
}

// Kepala panah terisi. Puncak di (tipX,tipY), mengarah ke (fx,fy)
// (vektor arah, tidak harus ternormalisasi). Basis tegak lurus arah.
static void arrowHead(int16_t tipX, int16_t tipY, float fx, float fy, int16_t len, int16_t halfW) {
  float fl = sqrtf(fx * fx + fy * fy);
  if (fl < 0.01f) return;
  fx /= fl; fy /= fl;

  float bx = (float)tipX - fx * len;
  float by = (float)tipY - fy * len;
  float rx = -fy;   // tegak lurus arah
  float ry =  fx;

  display.fillTriangle(tipX, tipY,
                       (int16_t)lroundf(bx + rx * halfW), (int16_t)lroundf(by + ry * halfW),
                       (int16_t)lroundf(bx - rx * halfW), (int16_t)lroundf(by - ry * halfW),
                       SSD1306_WHITE);
}

// ═══════════════════════════════════════════════════════════════════
//  PANAH MANEUVER
// ═══════════════════════════════════════════════════════════════════
//  Semua panah digambar PROSEDURAL dari thickLine + fillTriangle,
//  bukan tabel bitmap hex. Alasannya: satu set parameter bisa
//  menghasilkan semua arah diagonal, dan ukurannya mudah diskalakan.
//
//  Kotak 32x32, titik tengah (cx,cy). Extent tiap bentuk sudah
//  dihitung supaya muat: panah longest 29px (up), checkmark 21px.
//
//  Tabel ikon (HARUS sama dengan maneuverCode() di index.html):
//    0 depart       4 sharp-left    8 sharp-right  12 unknown
//    1 continue     5 uturn         9 roundabout
//    2 slight-left  6 slight-right 10 merge
//    3 left         7 right        11 arrive
// ═══════════════════════════════════════════════════════════════════

// Panah straight: batang tebal + kepala, arah (fx,fy).
// half=14, headLen=10, headHalf=8 untuk size 32.
static void dirArrow(int16_t cx, int16_t cy, int16_t size, float fx, float fy) {
  float fl = sqrtf(fx * fx + fy * fy);
  if (fl < 0.01f) return;
  fx /= fl; fy /= fl;

  int16_t half     = size / 2 - 2;  // 14
  int16_t headLen  = size / 3;      // 10
  int16_t headHalf = size / 4;      // 8

  int16_t tipX  = cx + (int16_t)lroundf(fx * half);
  int16_t tipY  = cy + (int16_t)lroundf(fy * half);
  int16_t baseX = tipX - (int16_t)lroundf(fx * headLen);
  int16_t baseY = tipY - (int16_t)lroundf(fy * headLen);
  int16_t tailX = cx - (int16_t)lroundf(fx * half);
  int16_t tailY = cy - (int16_t)lroundf(fy * half);

  thickLine(tailX, tailY, baseX, baseY, 5);
  arrowHead(tipX, tipY, fx, fy, headLen, headHalf);
}

// Belok kiri/kanan & variant: cukup ganti vektor arah.
//   slight  = 30° dari atas, sharp = 60° dari atas, penuh = 90°
static void turnArrow(int16_t cx, int16_t cy, int16_t size, uint8_t icon) {
  switch (icon) {
    case 2: dirArrow(cx, cy, size, -0.5f,    -0.866f); break;  // slight-left
    case 3: dirArrow(cx, cy, size, -1.0f,     0.0f);   break;  // left
    case 4: dirArrow(cx, cy, size, -0.866f,  -0.5f);   break;  // sharp-left
    case 6: dirArrow(cx, cy, size,  0.5f,    -0.866f); break;  // slight-right
    case 7: dirArrow(cx, cy, size,  1.0f,     0.0f);   break;  // right
    case 8: dirArrow(cx, cy, size,  0.866f,  -0.5f);   break;  // sharp-right
    default: break;
  }
}

// Putar balik: busur bawah (180°→360°) lalu batang ke atas di sisi kanan.
// Extent: x cx-10..cx+14, y cy-14..cy+11 — muat di kotak 32.
static void uturnArrow(int16_t cx, int16_t cy, int16_t size) {
  int16_t r    = size / 4;   // 8
  int16_t th   = 5;
  int16_t ax   = cx - 2;
  int16_t ay   = cy + 3;
  int16_t pX = 0, pY = 0;
  bool first = true;

  for (int a = 180; a <= 360; a += 6) {
    float rad = a * DEG_TO_RAD;
    int16_t X = ax + (int16_t)lroundf(r * cosf(rad));
    int16_t Y = ay + (int16_t)lroundf(r * sinf(rad));
    if (!first) thickLine(pX, pY, X, Y, th);
    pX = X; pY = Y;
    first = false;
  }

  int16_t tipY = cy - size / 2 + 2;  // cy-14
  thickLine(pX, pY, pX, tipY + size / 3, th);
  arrowHead(pX, tipY, 0, -1, size / 3, size / 4);
}

// Bundaran: busur 0°→330° (celah di kanan-bawah) + kepala searah tangen
// di titik keluar. Kepala sengaja lebih kecil dari panah lain supaya
// seluruh bentuk tetap muat di kotak 32 tanpa menabrak header.
// Exten: busur x cx-12..cx+12, y cy-12..cy+12; kepala menambah y sampai
// cy-15.
static void roundaboutArrow(int16_t cx, int16_t cy, int16_t size) {
  int16_t r  = size / 3;  // 10
  int16_t th = 5;
  int16_t pX = 0, pY = 0;
  bool first = true;
  float lfx = 1.0f, lfy = 0.0f;

  // Busur 0..330 (bukan 0..300): titik keluar di a=330 ada di kanan-bawah
  // dan tangent-nya mengarah turun-kanan, sehingga kepala panah tidak
  // keluar dari kotak 32x32 dan tidak menabrak header.
  for (int a = 0; a <= 330; a += 5) {
    float rad = a * DEG_TO_RAD;
    int16_t X = cx + (int16_t)lroundf(r * cosf(rad));
    int16_t Y = cy + (int16_t)lroundf(r * sinf(rad));
    if (!first) thickLine(pX, pY, X, Y, th);
    pX = X; pY = Y;
    first = false;
    // Tangen arah gerak (a bertambah).
    lfx = -sinf(rad);
    lfy =  cosf(rad);
  }
  // Kepala lebih kecil dari panah lain supaya seluruhnya tetap di kotak.
  arrowHead(pX, pY, lfx, lfy, size / 4, size / 5);
}

// Gabung: dua garis diagonal menyatu ke batang vertikal + kepala atas.
// Extent x/y cx±10, cy-14..cy+14 — muat di kotak 32.
static void mergeArrow(int16_t cx, int16_t cy, int16_t size) {
  int16_t th   = 5;
  int16_t tipY = cy - size / 2 + 2;  // cy-14

  thickLine(cx, cy + size / 2 - 2, cx, tipY + size / 3, th);
  thickLine(cx - size / 3, cy + size / 2 - 4, cx - 3, cy + 4, th);
  thickLine(cx + size / 3, cy + size / 2 - 4, cx + 3, cy + 4, th);
  arrowHead(cx, tipY, 0, -1, size / 3, size / 4);
}

// Tiba: centang. Extent x/y cx±10 — muat di kotak 32.
static void arriveArrow(int16_t cx, int16_t cy, int16_t size) {
  int16_t th = 5;
  thickLine(cx - size / 3, cy - 1,      cx - 2, cy + size / 3, th);
  thickLine(cx - 2,        cy + size/3, cx + size / 3, cy - size / 3, th);
}

// Titik masuk untuk semua bentuk.
static void drawArrow(uint8_t icon, int16_t x, int16_t y, int16_t size) {
  int16_t cx = x + size / 2;
  int16_t cy = y + size / 2;

  switch (icon) {
    case 0:  // depart   - lurus ke atas
    case 1:  // continue - lurus ke atas
    case 12: // unknown  - fallback lurus
      dirArrow(cx, cy, size, 0, -1);
      break;
    case 2: case 3: case 4:
    case 6: case 7: case 8:
      turnArrow(cx, cy, size, icon);
      break;
    case 5:  uturnArrow(cx, cy, size);      break;
    case 9:  roundaboutArrow(cx, cy, size); break;
    case 10: mergeArrow(cx, cy, size);      break;
    case 11: arriveArrow(cx, cy, size);     break;
    default: dirArrow(cx, cy, size, 0, -1); break;
  }
}

// ═══════════════════════════════════════════════════════════════════
//  DISPLAY FUNCTIONS
// ═══════════════════════════════════════════════════════════════════

// Header bar putih, judul hitam, titik koneksi di kanan.
void drawHeader(const char* title) {
  display.fillRect(0, 0, SCREEN_WIDTH, HEADER_H, SSD1306_WHITE);
  display.setTextColor(SSD1306_BLACK);
  display.setTextSize(1);
  display.setCursor(2, 2);
  display.print(title);

  // Titik digambar hitam di atas bar putih. "NAVIGASI" size 1 = 8*6 = 48px
  // berakhir di x=50, jadi tidak bentrok dengan titik di x=122.
  if (deviceConnected) display.fillCircle(122, 6, 3, SSD1306_BLACK);
  else                display.drawCircle(122, 6, 3, SSD1306_BLACK);

  display.setTextColor(SSD1306_WHITE);
}

void showStatus(const char* msg, bool connected) {
  display.clearDisplay();
  drawHeader(connected ? "ESP32-NAV" : "ESP32-NAV");

  display.setTextSize(1);
  display.setCursor(0, 22);
  display.print(msg);

  if (!connected) {
    display.setCursor(0, 36);
    display.print("Buka website lalu");
    display.setCursor(0, 46);
    display.print("tap Hubungkan");
  }

  display.display();
}

// Format jarak dari meter mentah (web mengirim angka, bukan string).
// -1 atau tidak valid = tanpa jarak.
String formatDist(long m) {
  if (m < 0) return "";
  if (m < 1000) {
    char buf[16];
    snprintf(buf, sizeof(buf), "%ld m", m);
    return String(buf);
  }
  char buf[20];
  snprintf(buf, sizeof(buf), "%.1f km", m / 1000.0);
  return String(buf);
}

// Potong teks ke [start,end) tanpa melewati batas,prefer memotong di
// spasi. Kalau satu kata lebih panjang dari maxLen, dipotong keras.
// *end = indeks akhir (exclusive).
static void wrapLine(const String& s, unsigned int start, unsigned int maxLen, unsigned int* end) {
  unsigned int len = s.length();
  if (start >= len) { *end = start; return; }

  unsigned int stop = start + maxLen;
  if (stop >= len) { *end = len; return; }

  int sp = s.lastIndexOf(' ', stop);
  if (sp > (int)start) { *end = (unsigned int)sp; return; }

  *end = stop;  // kata kepanjangan → potong keras
}

// Footer 2 baris. Glyph size 1 menempati baris y..y+7, jadi baris di
// y=56 mengisi 56..63 — baris terakhir yang valid. Jangan turunkan.
void drawFooter(const String& text) {
  if (text.length() == 0) return;

  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);

  unsigned int end = 0;
  wrapLine(text, 0, FOOT_CHARS, &end);
  display.setCursor(0, FOOT_Y1);
  display.print(text.substring(0, end));

  // Lewati satu spasi pemisah kalau ada.
  unsigned int start2 = (end < text.length() && text.charAt(end) == ' ') ? end + 1 : end;
  if (start2 < text.length()) {
    unsigned int end2 = 0;
    wrapLine(text, start2, FOOT_CHARS, &end2);
    display.setCursor(0, FOOT_Y2);
    display.print(text.substring(start2, end2));
  }
}

void renderNav(uint8_t icon, long dist, const String& text) {
  display.clearDisplay();
  drawHeader("NAVIGASI");

  // Panah 32x32 di kiri, jarak di kanan.
  drawArrow(icon, ARROW_X, ARROW_Y, ARROW_SIZE);

  String d = formatDist(dist);
  if (d.length() > 0) {
    // textWidth() mengukur pixel sebenarnya, jadi angka panjang
    // otomatis turun ke size 1 alih-alih meluber melewati tepi layar.
    uint8_t sz = 2;
    while (sz > 1 && display.textWidth(d.c_str(), sz) > (SCREEN_WIDTH - DIST_X - 2)) {
      sz--;
    }
    display.setTextSize(sz);
    display.setCursor(DIST_X, DIST_Y);
    display.print(d);
    display.setTextSize(1);
  }

  drawFooter(text);
  display.display();
}

// ═══════════════════════════════════════════════════════════════════
//  SETUP
// ═══════════════════════════════════════════════════════════════════

void setup() {
  Serial.begin(115200);

  // Init OLED
  if (!display.begin(SSD1306_SWITCHCAPVCC, OLED_ADDRESS)) {
    Serial.println("[ERROR] OLED tidak ditemukan! Cek wiring.");
    for (;;);  // halt
  }

  display.clearDisplay();
  display.display();

  // Antrean dibuat sebelum BLE aktif supaya callback tak pernah
  // menemukan navQueue == NULL.
  navQueue = xQueueCreate(4, LINE_MAX);
  if (navQueue == NULL) {
    Serial.println("[ERROR] Gagal membuat antrean!");
    for (;;);
  }

  showStatus("Memulai BLE...", false);
  delay(500);

  // Init BLE
  NimBLEDevice::init("ESP32-NAV");

  NimBLEServer* pServer = NimBLEDevice::createServer();
  pServer->setCallbacks(new ServerCallbacks());

  NimBLEService* pService = pServer->createService(SERVICE_UUID);

  // WRITE_NR tetap dipakai supaya writeValueWithResponse() (dipakai website
  // sekarang) maupun writeValue() versi lama (halaman yang masih cached di
  // browser) sama-sama diterima. Di NimBLE 2.x flag-nya pindah ke enum
  // NIMBLE_PROPERTY, bukan lagi BLECharacteristic::PROPERTY_*.
  NimBLECharacteristic* pChar = pService->createCharacteristic(
    CHAR_UUID,
    NIMBLE_PROPERTY::WRITE | NIMBLE_PROPERTY::WRITE_NR
  );
  pChar->setCallbacks(new CharCallbacks());
  // Descriptor BLE2902 (Client Characteristic Configuration) DIHAPUS.
  // Di Bluedroid itu perlu; di NimBLE kelasnya tidak ada, dan characteristic
  // ini write-only tanpa notify -- CCCD tidak pernah dipakai. Chrome tidak
  // memerlukannya untuk menulis.

  pService->start();

  NimBLEAdvertising* pAdv = NimBLEDevice::getAdvertising();

  // WAJIB. Di NimBLE 2.x nama perangkat tidak lagi dikirim di packet
  // advertising secara default. Website memfilter dengan
  // filters: [{ name: 'ESP32-NAV' }], jadi tanpa baris ini Chrome akan
  // menampilkan perangkat TANPA NAMA dan filter tidak akan pernah cocok --
  // gejalanya: "no devices found" padahal ESP32 menyala dan liegt di dekat.
  pAdv->setName("ESP32-NAV");

  pAdv->addServiceUUID(pService->getUUID());
  pAdv->enableScanResponse(true);
  // setMinPreferred() DIHAPUS di NimBLE 2.x (digantikan setPreferredParams).
  // Itu cuma hint PHY, bukan syarat koneksi, dan Chrome menegosiasikan
  // PHY-nya sendiri -- jadi dibuang, bukan diterjemahkan.
  pAdv->start();

  Serial.println("[BLE] Advertising dimulai sebagai ESP32-NAV");
  Serial.println("[BLE] Protokol: \"V1|<icon>|<dist_m>|<text>\\n\"");
  showStatus("Menunggu HP...", false);
}

// ═══════════════════════════════════════════════════════════════════
//  LOOP
// ═══════════════════════════════════════════════════════════════════

// loop() adalah SATU-SATUNYA pemilik objek display. Callback BLE
// cuma enqueue; semua gambar terjadi di sini. Ini mencegah dua task
// menulis ke framebuffer SSD1306 bersamaan.
void loop() {
  char line[LINE_MAX];

  if (xQueueReceive(navQueue, line, pdMS_TO_TICKS(100)) == pdTRUE) {
    uint8_t icon = 1;
    long dist = -1;
    String text;

    if (parseMessage(line, icon, dist, text)) {
      Serial.print("[NAV] ikon=");
      Serial.print(icon);
      Serial.print(" jarak=");
      Serial.print(dist);
      Serial.print(" teks=\"");
      Serial.print(text);
      Serial.println("\"");
      renderNav(icon, dist, text);
    } else {
      // Input rusak / versi protokol lain: abaikan, jangan crash.
      Serial.print("[NAV] pesan diabaikan: ");
      Serial.println(line);
    }
  }
}
