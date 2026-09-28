// Host test untuk logika firmware di esp32_nav/esp32_nav.ino.
//
// Semua fungsi gambar (drawArrow, renderNav, drawFooter, ...) dan callback
// BLE bisa dipanggil langsung di host, jadi geometri panah, parsing
// protokol, dan framing bisa diperiksa tanpa board.
//
// Build & run:  bash test/run.sh
//
// Urutan include penting: header standar dulu, baru stub, baru .ino.
// .ino mendefinisikan makro (LINE_MAX, TEXT_MAX, ...) yang bisa bentrok
// dengan internal STL, jadi STL harus sudah selesai dimuat sebelum itu.
#include <iostream>
#include <set>
#include <string>
#include <vector>
#include <algorithm>
#include <cstring>

#include "stubs.h"
#include "queue_impl.h"
#include "../esp32_nav/esp32_nav.ino"

SerialStub Serial;
TwoWire Wire;

static int passed = 0, failed = 0;
static const char* currentSection = "?";

static void check(bool cond, const std::string& what) {
  if (cond) { passed++; return; }
  failed++;
  std::cout << "  FAIL: " << what << "  [" << currentSection << "]\n";
}

// Bentuk "hasil == harapan" supaya serangkaian nilai boolean mudah dibaca
// sebaris, misalnya check(allDigits("12a"), false, "huruf ditolak").
static void check(bool got, bool expected, const std::string& what) {
  if (got == expected) { passed++; return; }
  failed++;
  std::cout << "  FAIL: " << what << " (harap " << (expected ? "true" : "false")
            << ", dapat " << (got ? "true" : "false") << ")  [" << currentSection << "]\n";
}

static void section(const char* name) {
  currentSection = name;
  std::cout << "== " << name << " ==\n";
}

// Pixel yang benar-benar tergambar (di dalam batas layar).
static std::set<std::pair<int, int>> drawnPixels() {
  std::set<std::pair<int, int>> s;
  for (auto& p : display.px)
    if (p.first >= 0 && p.first < display.W && p.second >= 0 && p.second < display.H)
      s.insert(p);
  return s;
}

static bool inBounds() {
  for (auto& p : display.px)
    if (p.first < 0 || p.first >= display.W || p.second < 0 || p.second >= display.H)
      return false;
  return true;
}

int main() {
  setup();
  display.reset();

  // ────────────────────────────────────────────────────────────────────
  section("formatDist");
  {
    check(formatDist(-1).length() == 0,          "negatif → string kosong");
    check(formatDist(-500).length() == 0,        "negatif besar → kosong");
    check(formatDist(0) == "0 m",                "nol → 0 m");
    check(formatDist(1) == "1 m",                 "satu meter");
    check(formatDist(999) == "999 m",             "999 m tidak jadi km");
    check(formatDist(1000) == "1.0 km",           "1000 → 1.0 km");
    check(formatDist(1500) == "1.5 km",           "1.5 km");
    check(formatDist(12345) == "12.3 km",         "12.3 km satu desimal");
    check(formatDist(100000) == "100.0 km",       "100.0 km");
  }

  // ────────────────────────────────────────────────────────────────────
  section("allDigits");
  {
    check(allDigits(String("")),          false, "string kosong bukan angka");
    check(allDigits(String("0")),         true,  "nol");
    check(allDigits(String("12")),        true,  "dua digit");
    check(allDigits(String("12a")),       false, "huruf ditolak");
    check(allDigits(String("-12")),       false, "tanda minus ditolak");
    check(allDigits(String("1 2")),       false, "spasi di tengah ditolak");
    check(allDigits(String("007")),       true,  "nol di depan diterima");
  }

  // ────────────────────────────────────────────────────────────────────
  section("sanitizeText");
  {
    check(sanitizeText(String("")) == "",                       "kosong tetap kosong");
    check(sanitizeText(String("   ")) == "",                    "spasi semua jadi kosong");
    check(sanitizeText(String("  hello  ")) == "hello",         "spasi tepi dirapatkan");
    check(sanitizeText(String("a     b")) == "a b",            "spasi dalam dirapatkan");
    check(sanitizeText(String("a|b")) == "ab",                 "field separator dibuang");
    check(sanitizeText(String("a\nb")) == "ab",                 "newline dibuang");
    check(sanitizeText(String("a\tb")) == "ab",                 "tab dibuang");
    check(sanitizeText(String(std::string("x") + (char)0x7F + "y")) == "xy", "byte >= 0x7F dibuang");
    // Font GFX ASCII-only, jadi sisipan UTF-8 dibuang, bukan dirombak.
    check(sanitizeText(String("a\xC3\xA9" "b")) == "ab", "sisipan UTF-8 dibuang");
    std::string big(TEXT_MAX + 20, 'X');
    check(sanitizeText(String(big)).length() == TEXT_MAX,        "dipotong ke TEXT_MAX");
    check(sanitizeText(String("Jl. Sudirman No. 1")).length() <= TEXT_MAX, "alamat <= TEXT_MAX");
  }

  // ────────────────────────────────────────────────────────────────────
  section("parseMessage");
  {
    uint8_t ic = 99; long d = 999; String t = "sisa";

    check(parseMessage("V1|1|120|Jalan Merdeka", ic, d, t), "pesan valid diterima");
    check(ic == 1, "ikon ter-parse"); check(d == 120, "jarak ter-parse");
    check(t == "Jalan Merdeka", "teks ter-parse");

    check(parseMessage("V1|1|120|", ic, d, t) && t.length() == 0, "teks kosong diizinkan");
    check(parseMessage("V1|0|0|Berangkat", ic, d, t) && d == 0,   "jarak nol diizinkan");
    check(parseMessage("V1|1|-50|Mundur", ic, d, t) && d == -50, "jarak negatif diizinkan");

    check(parseMessage("V1|13|10|Lebih", ic, d, t) == false, "ikon > ICON_MAX ditolak");
    check(parseMessage("V1|0|10|", ic, d, t),                "batas atas ikon 0 ok");
    check(parseMessage("V1|12|10|Aman", ic, d, t) && ic == 12, "batas ikon 12 ok");

    check(parseMessage("V2|1|10|x", ic, d, t) == false, "versi protokol lain ditolak");
    check(parseMessage("1|10|x",    ic, d, t) == false, "tanpa prefix ditolak");
    check(parseMessage("V1|1|abc|x", ic, d, t) == false, "jarak non-numerik ditolak");
    check(parseMessage("V1|1||x",    ic, d, t) == false, "jarak kosong ditolak");
    check(parseMessage("V1|a|10|x",  ic, d, t) == false, "ikon non-numerik ditolak");
    check(parseMessage("V1|1",       ic, d, t) == false, "field kurang ditolak");
    check(parseMessage("",           ic, d, t) == false, "string kosong ditolak");
  }

  // ────────────────────────────────────────────────────────────────────
  //  Ikon 0..12: semua harus menggambar sesuatu, semua di dalam kotak, dan
  //  semua bentuknya berbeda kecuali 0/1/12 yang memang berbagi fallback.
  section("drawArrow: semua ikon valid");
  {
    std::set<std::set<std::pair<int, int>>> shapes;
    for (int icon = 0; icon <= ICON_MAX; icon++) {
      display.reset();
      drawArrow((uint8_t)icon, ARROW_X, ARROW_Y, ARROW_SIZE);
      std::set<std::pair<int, int>> px = drawnPixels();
      check(!px.empty(), "ikon " + std::to_string(icon) + " menggambar sesuatu");
      check(inBounds(), "ikon " + std::to_string(icon) + " stay inside the screen");
      // Arah panah tidak boleh keluar dari kotak 32x32 miliknya.
      int x0 = ARROW_X, y0 = ARROW_Y, x1 = ARROW_X + ARROW_SIZE, y1 = ARROW_Y + ARROW_SIZE;
      bool fits = true;
      for (auto& p : px)
        if (p.first < x0 - 1 || p.first > x1 + 1 || p.second < y0 - 1 || p.second > y1 + 1)
          fits = false;
      check(fits, "ikon " + std::to_string(icon) + " muat di kotak 32x32");
      shapes.insert(px);
    }
    check(shapes.size() == 11, "11 bentuk berbeda dari 13 kode (0/1/12 berbagi)");
  }

  section("drawArrow: ikon 0/1/12 identik");
  {
    std::set<std::pair<int, int>> ref;
    drawArrow(0, ARROW_X, ARROW_Y, ARROW_SIZE);
    ref = drawnPixels();
    display.reset(); drawArrow(1, ARROW_X, ARROW_Y, ARROW_SIZE);
    check(drawnPixels() == ref, "ikon 1 sama dengan ikon 0");
    display.reset(); drawArrow(12, ARROW_X, ARROW_Y, ARROW_SIZE);
    check(drawnPixels() == ref, "ikon 12 sama dengan ikon 0");
    display.reset(); drawArrow(9, ARROW_X, ARROW_Y, ARROW_SIZE);
    check(drawnPixels() != ref, "bundaran (9) berbeda dari lurus (0)");
  }

  // ────────────────────────────────────────────────────────────────────
  section("renderNav: layout dan batas layar");
  {
    deviceConnected = true;
    display.reset();
    renderNav(1, 120, "Jalan Merdeka");
    check(inBounds(), "tidak menggambar di luar layar");
    check(drawnPixels().size() > 200, "ada isi layar yang jelas");

    // Header: baris y=0..11 harus terisi penuh (putih).
    int headerPx = 0;
    for (int x = 0; x < SCREEN_WIDTH; x++)
      for (int y = 0; y < HEADER_H; y++)
        if (display.px.end() != std::find(display.px.begin(), display.px.end(), std::make_pair(x, y)))
          headerPx++;
    check(headerPx >= SCREEN_WIDTH * HEADER_H - 10, "bar header penuh terisi");

    // Judul "NAVIGASI" harus digambar di header.
    bool sawTitle = false;
    for (auto& t : display.texts) if (t.str == "NAVIGASI" && t.y <= 2) sawTitle = true;
    check(sawTitle, "judul NAVIGASI digambar di header");

    // Baris footer terakhir y=56 masih di dalam layar (56+7 = 63).
    display.reset();
    renderNav(1, 120, "Satu dua tiga empat lima enam tujuh delapan sembilan sepuluh sebelas");
    bool sawY2 = false;
    for (auto& t : display.texts) if (t.y == FOOT_Y2) sawY2 = true;
    check(sawY2, "baris footer kedua di y=56 terpakai");
    check(inBounds(), "teks panjang tidak melewati tepi bawah");

    // Jarak panjang otomatis turun ke size 1 supaya tidak meluber.
    display.reset();
    renderNav(1, 123456, "Jauh");
    bool sawSmall = false;
    for (auto& t : display.texts) if (t.str.find("km") != std::string::npos && t.size == 1) sawSmall = true;
    check(sawSmall, "jarak panjang turun ke size 1");
    check(inBounds(), "jarak panjang tetap di dalam layar");
    display.reset();
    renderNav(1, 120, "Jalan Merdeka");
  }

  // ────────────────────────────────────────────────────────────────────
  section("drawFooter: pemenggalan kata");
  {
    display.reset();
    drawFooter("");
    check(display.texts.empty(), "teks kosong tidak menggambar apa pun");

    display.reset();
    drawFooter("Pendek");
    check(display.texts.size() == 1, "teks pendek satu baris");
    check(display.texts[0].str == "Pendek", "isi baris benar");

    display.reset();
    drawFooter(std::string(FOOT_CHARS + 6, 'A'));
    check(display.texts.size() == 2, "teks > FOOT_CHARS jadi dua baris");
    check(display.texts[0].str.length() <= FOOT_CHARS, "baris 1 <= FOOT_CHARS");
    check(display.texts[1].str.length() <= FOOT_CHARS, "baris 2 <= FOOT_CHARS");

    // Kata kepanjangan dipotong keras, tidak menggantung.
    display.reset();
    std::string noSpace(FOOT_CHARS + 5, 'B');
    drawFooter(noSpace);
    check(display.texts.size() == 2, "kata tanpa spasi dipecah jadi dua baris");

    display.reset();
    drawFooter(std::string(FOOT_CHARS, 'C'));
    check(display.texts.size() == 1, "tepat FOOT_CHARS tetap satu baris");
  }

  // ────────────────────────────────────────────────────────────────────
  section("framing BLE: pemisahan pesan di terminator");
  {
    display.reset();
    Serial.clear();
    CharCallbacks cb;
    BLECharacteristic ch("", 0);
    ch.setCallbacks(&cb);

    ch.simulateWrite("V1|1|50|Haloo");
    Serial.clear(); loop();
    check(Serial.buf.find("V1|1|50|Haloo") == std::string::npos, "tanpa \\n belum diproses");

    ch.simulateWrite("\n");
    loop();
    check(Serial.buf.find("ikon=1") != std::string::npos, "terminator memicu pemrosesan");
    check(Serial.buf.find("50") != std::string::npos, "jarak masuk log");
    check(Serial.buf.find("Haloo") != std::string::npos, "teks masuk log");

    // CRLF harus diperlakukan sama dengan LF.
    Serial.clear();
    ch.simulateWrite("V1|2|80|Tiga\r\n");
    loop();
    check(Serial.buf.find("ikon=2") != std::string::npos, "CRLF diterima");
    check(Serial.buf.find("\\r") == std::string::npos, "\\r tidak ikut ke teks");

    // Dua pesan dalam satu write.
    Serial.clear();
    ch.simulateWrite("V1|3|10|Satu\nV1|4|20|Dua\n");
    loop(); loop();
    check(Serial.buf.find("Satu") != std::string::npos, "pesan pertama diproses");
    check(Serial.buf.find("Dua")  != std::string::npos, "pesan kedua diproses");

    // Pesan rusak diabaikan, tidak crash.
    Serial.clear();
    ch.simulateWrite("sampah\n");
    loop();
    check(Serial.buf.find("diabaikan") != std::string::npos, "pesan rusak diabaikan");

    // Pesan kepanjangan: ditolak utuh lalu resync di terminator berikutnya.
    Serial.clear();
    ch.simulateWrite(std::string("V1|1|10|") + std::string(LINE_MAX + 40, 'x'));
    check(Serial.buf.find("melebihi buffer") != std::string::npos, "pesan kepanjangan ditolak");
    // Selama flag overflow masih menyala, isi baru ikut dibuang.
    Serial.clear();
    ch.simulateWrite("V1|1|10|Terbuang\n");
    loop();
    check(Serial.buf.find("Terbuang") == std::string::npos, "isi baru dibuang sampai resync");
    // Terminator berikutnya menutup flag; pesan setelahnya diterima.
    Serial.clear();
    ch.simulateWrite("\nV1|1|10|Sembuh\n");
    loop(); loop();
    check(Serial.buf.find("Sembuh") != std::string::npos, "state pulih setelah overflow");

    // Write kosong tidak boleh apa-apa.
    Serial.clear();
    ch.simulateWrite("");
    loop();
    check(Serial.buf.empty(), "write kosong tidak menghasilkan apa pun");
    display.reset();
  }

  // ────────────────────────────────────────────────────────────────────
  section("antrean: penuh dan tidak ada");
  {
    display.reset();
    Serial.clear();
    CharCallbacks cb;
    BLECharacteristic ch("", 0);
    ch.setCallbacks(&cb);
    for (int i = 0; i < 6; i++) ch.simulateWrite("V1|1|10|Antar" + std::to_string(i) + "\n");
    check(Serial.buf.find("antrean penuh") != std::string::npos, "kelebihan antrean dilaporkan");
    display.reset();
  }

  // ────────────────────────────────────────────────────────────────────
  section("koneksi");
  {
    display.reset();
    Serial.clear();
    // Server & callback-nya dibuat setup() firmware; kita memicu event
    // lewat stub, bukan memanggil onConnect() yang private.
    BLEServer* srv = BLEDevice::lastServer();
    check(srv != nullptr, "setup() mendaftarkan server");
    srv->fireConnect();
    check(deviceConnected, "onConnect menandai tersambung");
    check(Serial.buf.find("Device connected") != std::string::npos, "log koneksi");
    // "Terhubung!" digambar ke layar; Serial hanya berisi log BLE.
    bool sawStatus = false;
    for (auto& t : display.texts) if (t.str == "Terhubung!") sawStatus = true;
    check(sawStatus, "status 'Terhubung!' tampil di layar");

    Serial.clear();
    srv->fireDisconnect();
    check(!deviceConnected, "onDisconnect menandai terputus");
    check(Serial.buf.find("Device disconnected") != std::string::npos, "log disconnection");
    display.reset();
  }

  // ────────────────────────────────────────────────────────────────────
  std::cout << "\n─────────────────────────────\n";
  std::cout << "PASS: " << passed << "   FAIL: " << failed << "\n";
  return failed == 0 ? 0 : 1;
}
