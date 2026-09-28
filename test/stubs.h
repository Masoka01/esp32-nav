// Stub Arduino / Adafruit / BLE / FreeRTOS untuk menguji logika firmware
// esp32_nav.ino di mesin host, tanpa hardware dan tanpa arduino-cli.
//
// Semua panggilan gambar dicatat supaya geometri panah dan batas teks bisa
// diperiksa secara otomatis, bukan dikira-kira.
#pragma once

#include <string>
#include <vector>
#include <utility>
#include <cstdio>
#include <cstring>
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <algorithm>

#define DEG_TO_RAD 0.017453292519943295769

#define SSD1306_BLACK 0
#define SSD1306_WHITE 1
#define SSD1306_SWITCHCAPVCC 0x02

// ==========================================================================
//  String (subset API Arduino yang dipakai sketch)
// ==========================================================================
class String {
 public:
  std::string s;
  String() {}
  String(const char* p) : s(p ? p : "") {}
  String(const std::string& o) : s(o) {}

  unsigned int length() const { return (unsigned int)s.size(); }
  char charAt(unsigned int i) const { return i < s.size() ? s[i] : '\0'; }
  const char* c_str() const { return s.c_str(); }
  void remove(unsigned int index) { if (index < s.size()) s.erase(index, 1); }

  bool startsWith(const char* p) const {
    size_t n = strlen(p);
    return s.size() >= n && s.compare(0, n, p) == 0;
  }
  int indexOf(char ch, unsigned int from) const {
    size_t p = s.find(ch, from);
    return p == std::string::npos ? -1 : (int)p;
  }
  int lastIndexOf(char ch, unsigned int from) const {
    if (s.empty()) return -1;
    size_t lim = std::min<size_t>(from, s.size() - 1);
    size_t p = s.rfind(ch, lim);
    return p == std::string::npos ? -1 : (int)p;
  }
  String substring(unsigned int a) const {
    return String(a < s.size() ? s.substr(a) : std::string());
  }
  String substring(unsigned int a, unsigned int b) const {
    if (a >= s.size() || b <= a) return String();
    return String(s.substr(a, b - a));
  }
  long toInt() const { return strtol(s.c_str(), nullptr, 10); }

  String& operator+=(char c) { s += c; return *this; }
  String& operator+=(const char* p) { if (p) s += p; return *this; }
  String& operator=(const char* p) { s = p ? p : ""; return *this; }
  bool operator==(const String& o) const { return s == o.s; }
  bool operator!=(const String& o) const { return s != o.s; }
  bool operator==(const char* p) const { return s == (p ? p : ""); }
  bool operator!=(const char* p) const { return s != (p ? p : ""); }
  friend String operator+(const String& a, const String& b) { return String(a.s + b.s); }
  friend String operator+(const String& a, const char* b) { return String(a.s + (b ? b : "")); }
};

// ==========================================================================
//  Serial
// ==========================================================================
struct SerialStub {
  std::string buf;
  void begin(unsigned long) {}
  void print(const char* s) { if (s) buf += s; }
  void print(const String& s) { buf += s.s; }
  void print(char c) { buf += c; }
  void print(long v) { char b[32]; snprintf(b, sizeof b, "%ld", v); buf += b; }
  void print(int v) { char b[32]; snprintf(b, sizeof b, "%d", v); buf += b; }
  void println() { buf += "\n"; }
  void println(const char* s) { if (s) buf += s; buf += "\n"; }
  void println(const String& s) { buf += s.s; buf += "\n"; }
  void println(long v) { char b[32]; snprintf(b, sizeof b, "%ld", v); buf += b; buf += "\n"; }
  void println(int v) { char b[32]; snprintf(b, sizeof b, "%d", v); buf += b; buf += "\n"; }
  void clear() { buf.clear(); }
};
extern SerialStub Serial;

static void delay(unsigned long) {}

// ==========================================================================
//  GFX - mencatat setiap pixel dan setiap panggilan print()
// ==========================================================================
struct TextDraw {
  int x, y, size;
  std::string str;
};

class GfxStub {
 public:
  int W = 128, H = 64;
  std::vector<std::pair<int, int>> px;
  std::vector<TextDraw> texts;
  int cursorX = 0, cursorY = 0, textSize = 1;

  void reset() { px.clear(); texts.clear(); cursorX = cursorY = 0; textSize = 1; }

  void clearDisplay() { px.clear(); texts.clear(); }
  void display() {}
  void setTextSize(int s) { textSize = s; }
  void setTextColor(int) {}
  void setCursor(int x, int y) { cursorX = x; cursorY = y; }

  void drawPixel(int x, int y, int) {
    if (x >= 0 && x < W && y >= 0 && y < H) px.push_back({x, y});
  }

  void drawLine(int x0, int y0, int x1, int y1, int c) {
    int dx = abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
    int dy = -abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
    int err = dx + dy;
    for (;;) {
      drawPixel(x0, y0, c);
      if (x0 == x1 && y0 == y1) break;
      int e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }

  void drawFastHLine(int x, int y, int l, int c) { drawLine(x, y, x + l, y, c); }
  void drawFastVLine(int x, int y, int l, int c) { drawLine(x, y, x, y + l, c); }

  void drawRect(int x, int y, int w, int h, int c) {
    drawLine(x, y, x + w, y, c);         drawLine(x, y + h, x + w, y + h, c);
    drawLine(x, y, x, y + h, c);         drawLine(x + w, y, x + w, y + h, c);
  }
  void fillRect(int x, int y, int w, int h, int c) {
    for (int j = y; j <= y + h; j++)
      for (int i = x; i <= x + w; i++) drawPixel(i, j, c);
  }
  void drawCircle(int x, int y, int r, int c) {
    for (int a = 0; a < 360; a++) {
      double rad = a * DEG_TO_RAD;
      drawPixel(x + (int)lround(r * cos(rad)), y + (int)lround(r * sin(rad)), c);
    }
  }
  void fillCircle(int x, int y, int r, int c) {
    for (int j = -r; j <= r; j++)
      for (int i = -r; i <= r; i++)
        if (i * i + j * j <= r * r) drawPixel(x + i, y + j, c);
  }
  void drawTriangle(int x0, int y0, int x1, int y1, int x2, int y2, int c) {
    drawLine(x0, y0, x1, y1, c); drawLine(x1, y1, x2, y2, c); drawLine(x2, y2, x0, y0, c);
  }
  void fillTriangle(int x0, int y0, int x1, int y1, int x2, int y2, int c) {
    int minx = std::min(x0, std::min(x1, x2)), maxx = std::max(x0, std::max(x1, x2));
    int miny = std::min(y0, std::min(y1, y2)), maxy = std::max(y0, std::max(y1, y2));
    auto edge = [](int ax, int ay, int bx, int by, int qx, int qy) {
      return (bx - ax) * (qy - ay) - (by - ay) * (qx - ax);
    };
    for (int y = miny; y <= maxy; y++) {
      for (int x = minx; x <= maxx; x++) {
        int d1 = edge(x0, y0, x1, y1, x, y);
        int d2 = edge(x1, y1, x2, y2, x, y);
        int d3 = edge(x2, y2, x0, y0, x, y);
        bool neg = (d1 < 0) || (d2 < 0) || (d3 < 0);
        bool pos = (d1 > 0) || (d2 > 0) || (d3 > 0);
        if (!(neg && pos)) drawPixel(x, y, c);
      }
    }
  }

  int16_t textWidth(const char* s, uint16_t size = 1) {
    return (int16_t)(strlen(s) * 6 * size);
  }
  void print(const char* s) { if (s) texts.push_back({cursorX, cursorY, textSize, s}); }
  void print(const String& s) { print(s.c_str()); }
  void print(long v) { char b[32]; snprintf(b, sizeof b, "%ld", v); print(b); }
  void print(int v) { char b[32]; snprintf(b, sizeof b, "%d", v); print(b); }
  void print(char c) { char b[2] = {c, 0}; print(b); }
};

class Adafruit_GFX : public GfxStub {};

// Mirrors TwoWire::begin() so the firmware's optional Wire.begin(SDA, SCL)
// call compiles, and records whether the firmware took ownership of the bus.
class TwoWire {
 public:
  bool beginCalled = false;
  int sda = -1;
  int scl = -1;
  void begin() { beginCalled = true; }
  void begin(int a, int b) { beginCalled = true; sda = a; scl = b; }
};
extern TwoWire Wire;

class Adafruit_SSD1306 : public GfxStub {
 public:
  // Mirrors the real signature: begin(vcs, addr, reset = true, periphBegin = true).
  // periphBeginSeen lets tests assert the firmware never lets the library
  // re-run Wire.begin() over user-supplied pins.
  int periphBeginSeen = -1;
  Adafruit_SSD1306(int w, int h, TwoWire*, int r) : GfxStub() { W = w; H = h; (void)r; }
  bool begin(int vcc, int addr, bool reset = true, bool periphBegin = true) {
    (void)vcc; (void)addr; (void)reset;
    periphBeginSeen = periphBegin ? 1 : 0;
    return true;
  }
};

// ==========================================================================
//  FreeRTOS queue
// ==========================================================================
typedef void* QueueHandle_t;
typedef unsigned int TickType_t;
#define pdTRUE 1
#define pdFALSE 0
#define pdMS_TO_TICKS(x) ((TickType_t)(x))

struct QueueImpl {
  std::vector<std::string> items;
  size_t itemSize = 0;
  size_t capacity = 0;   // 0 = tidak dibuat via xQueueCreate
};
QueueHandle_t xQueueCreate(size_t n, size_t sz);
int xQueueSend(QueueHandle_t h, const void* item, TickType_t);
int xQueueReceive(QueueHandle_t h, void* buf, TickType_t);

// ==========================================================================
//  NimBLE (cukup untuk kompilasi dan uji framing)
// ==========================================================================
// Stub ini mencerminkan API NimBLE-Arduino 2.x, BUKAN Bluedroid. Bentuknya
// sengaja ditiru: nilai ditulis dibungkus NimBLEAttValue, dan setiap
// callback koneksi menerima NimBLEConnInfo&. Kalau stub ini melenceng dari
// API asli, test tetap hijau tapi firmware gagal compile di Arduino IDE --
// itu bahaya yang paling mahal, karena baru ketahuan saat flash ke board.

class NimBLEConnInfo {
 public:
  uint16_t getConnHandle() const { return 1; }
};

class NimBLEUUID {
 public:
  NimBLEUUID() : uuid_("") {}
  explicit NimBLEUUID(const char* u) : uuid_(u ? u : "") {}
  std::string toString() const { return std::string(uuid_); }

 private:
  const char* uuid_;
};

// Nilai atribut BLE. Firmware membaca lewat data() + length(), bukan
// c_str(), supaya byte di luar 7-bit (nama jalan Indonesia) tidak rusak.
class NimBLEAttValue {
 public:
  NimBLEAttValue() = default;
  const uint8_t* data() const { return buf_.empty() ? nullptr : buf_.data(); }
  uint16_t length() const { return (uint16_t)buf_.size(); }
  uint16_t size() const { return (uint16_t)buf_.size(); }
  bool setValue(const uint8_t* v, uint16_t len) {
    if (!v) { buf_.clear(); return false; }
    buf_.assign(v, v + len);
    return true;
  }

 private:
  std::vector<uint8_t> buf_;
};

// Di NimBLE 2.x flag properti pindah dari BLECharacteristic::PROPERTY_*
// ke enum NIMBLE_PROPERTY.
struct NIMBLE_PROPERTY {
  static constexpr uint32_t READ     = 1 << 0;
  static constexpr uint32_t WRITE    = 1 << 1;
  static constexpr uint32_t NOTIFY   = 1 << 2;
  static constexpr uint32_t INDICATE  = 1 << 4;
  static constexpr uint32_t WRITE_NR = 1 << 5;
};

class NimBLECharacteristic;

class NimBLECharacteristicCallbacks {
 public:
  virtual ~NimBLECharacteristicCallbacks() {}
  virtual void onRead(NimBLECharacteristic*, NimBLEConnInfo&) {}
  virtual void onWrite(NimBLECharacteristic*, NimBLEConnInfo&) {}
  virtual void onSubscribe(NimBLECharacteristic*, NimBLEConnInfo&, uint16_t) {}
};

class NimBLECharacteristic {
 public:
  NimBLECharacteristic(const char* uuid, uint32_t props) : uuid_(uuid), props_(props) {}
  // Sengaja TIDAK menghapus cb_: pada BLE asli, callback dimiliki aplikasi
  // dan harus hidup selama server aktif. Menghapus ptr yang menunjuk objek
  // stack milik test akan jadi free() ilegal.

  void setCallbacks(NimBLECharacteristicCallbacks* cb) { cb_ = cb; }
  const NimBLEAttValue& getValue() const { return val_; }
  uint32_t getProperties() const { return props_; }
  NimBLEUUID getUUID() const { return NimBLEUUID(uuid_); }

  // Hanya untuk test: isi nilai lalu panggil onWrite seperti BLE sungguhan.
  void simulateWrite(const std::string& payload) {
    val_.setValue(reinterpret_cast<const uint8_t*>(payload.data()),
                  (uint16_t)payload.size());
    if (cb_) {
      NimBLEConnInfo ci;
      cb_->onWrite(this, ci);
    }
  }

 private:
  const char* uuid_;
  uint32_t props_;
  NimBLECharacteristicCallbacks* cb_ = nullptr;
  NimBLEAttValue val_;
};

class NimBLEServer;

class NimBLEServerCallbacks {
 public:
  virtual ~NimBLEServerCallbacks() {}
  virtual void onConnect(NimBLEServer*, NimBLEConnInfo&) {}
  virtual void onDisconnect(NimBLEServer*, NimBLEConnInfo&, int) {}
};

class NimBLEService {
 public:
  explicit NimBLEService(const char* uuid) : uuid_(uuid) {}
  ~NimBLEService() { for (auto* c : chars_) delete c; }
  NimBLECharacteristic* createCharacteristic(const char* uuid, uint32_t props) {
    NimBLECharacteristic* c = new NimBLECharacteristic(uuid, props);
    chars_.push_back(c);
    return c;
  }
  void start() {}
  NimBLEUUID getUUID() const { return NimBLEUUID(uuid_); }

 private:
  const char* uuid_;
  std::vector<NimBLECharacteristic*> chars_;
};

class NimBLEServer {
 public:
  void setCallbacks(NimBLEServerCallbacks* cb) { cb_ = cb; }
  NimBLEService* createService(const char* uuid) { return new NimBLEService(uuid); }

  // Pemicu event dari sisi stub. Memakai jalur callback yang sama dengan
  // BLE sungguhan, jadi kelas callback firmware bisa diuji tanpa membuka
  // akses private-nya.
  void fireConnect() {
    if (cb_) { NimBLEConnInfo ci; cb_->onConnect(this, ci); }
  }
  void fireDisconnect() {
    if (cb_) { NimBLEConnInfo ci; cb_->onDisconnect(this, ci, 0); }
  }

 private:
  NimBLEServerCallbacks* cb_ = nullptr;
};

// setName() sengaja ada di stub meski firmware tidak pernah membacanya:
// NimBLE 2.x tidak lagi mengirim nama perangkat di packet advertising, jadi
// tanpa setName() Chrome tidak akan bisa memfilter device berdasarkan nama.
// Stub ini tidak bisa membuktikan itu -- hanya board asli bisa.
class NimBLEAdvertising {
 public:
  void setName(const char*) {}
  void addServiceUUID(const NimBLEUUID&) {}
  void enableScanResponse(bool) {}
  void start() {}
};

class NimBLEDevice {
 public:
  static bool init(const char* = "") { return true; }

  // Server & characteristic terakhir yang dibuat setup() firmware, supaya
  // test bisa memicu event tanpa perlu membuat ulang sendiri.
  static NimBLEServer* lastServer() { return server_; }
  static NimBLEServer* createServer() { server_ = new NimBLEServer(); return server_; }
  static NimBLEAdvertising* getAdvertising() { static NimBLEAdvertising a; return &a; }
  static void startAdvertising() {}

 private:
  static NimBLEServer* server_;
};
inline NimBLEServer* NimBLEDevice::server_ = nullptr;
