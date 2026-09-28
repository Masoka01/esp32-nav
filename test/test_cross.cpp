// Cross-check: byte yang dikirim web harus di-assemble dan di-parse oleh
// firmware dengan hasil yang sama.
//
// test_web.mjs membuktikan sisi web (payload, sanitasi, chunk 20 byte) benar.
// File ini membuktikan sisi firmware: payload yang sama, dipecah jadi chunk
// BLE 20 byte, di-feed lewat CharCallbacks, lalu hasilnya diperiksa lewat
// log [NAV] yang dicetak loop().
//
// Data payload & harapan: payloads.txt
//
// Build & run:  bash test/run.sh
#include <iostream>
#include <set>
#include <string>
#include <vector>
#include <algorithm>
#include <cstring>
#include <fstream>
#include <sstream>

#include "stubs.h"
#include "queue_impl.h"
#include "../esp32_nav/esp32_nav.ino"

SerialStub Serial;
TwoWire Wire;

static int passed = 0, failed = 0;
static std::string currentName;

static void check(bool cond, const std::string& what) {
  if (cond) { passed++; return; }
  failed++;
  std::cout << "  FAIL: [" << currentName << "] " << what << "\n";
}

// Ukuran write BLE characteristic di sisi web.
static const size_t BLE_WRITE = 20;

static std::string hexDecode(const std::string& hex) {
  std::string out;
  for (size_t i = 0; i + 1 < hex.size(); i += 2) {
    auto nib = [](char c) -> int {
      if (c >= '0' && c <= '9') return c - '0';
      if (c >= 'a' && c <= 'f') return c - 'a' + 10;
      if (c >= 'A' && c <= 'F') return c - 'A' + 10;
      return -1;
    };
    out += (char)((nib(hex[i]) << 4) | nib(hex[i + 1]));
  }
  return out;
}

static std::string trim(const std::string& s) {
  size_t a = s.find_first_not_of(" \t");
  if (a == std::string::npos) return "";
  size_t b = s.find_last_not_of(" \t");
  return s.substr(a, b - a + 1);
}

// Sengaja implementasi manual, bukan std::getline: getline membuang
// field kosong di akhir, padahal "teks kosong" adalah kasus uji yang sah
// (payload "1|10|" harus menghasilkan tiga field: ikon, jarak, teks kosong).
static std::vector<std::string> split(const std::string& s, char sep) {
  std::vector<std::string> v;
  std::string cur;
  for (char c : s) {
    if (c == sep) { v.push_back(cur); cur.clear(); }
    else cur += c;
  }
  v.push_back(cur);
  return v;
}

// Semua baris log "[NAV] ikon=... jarak=... teks=\"...\"".
static std::vector<std::string> navLines() {
  std::vector<std::string> out;
  std::istringstream is(Serial.buf);
  std::string line;
  while (std::getline(is, line)) {
    if (line.rfind("[NAV] ikon=", 0) == 0) out.push_back(line);
  }
  return out;
}

int main() {
  setup();
  display.reset();

  std::ifstream in("payloads.txt");
  if (!in) {
    std::cout << "payloads.txt tidak ditemukan — jalankan dari direktori test/\n";
    return 2;
  }

  std::string line;
  int cases = 0;
  while (std::getline(in, line)) {
    if (line.empty() || line[0] == '#') continue;
    auto f = split(line, '\t');
    if (f.size() < 5) continue;
    currentName = f[0];
    cases++;

    const std::string bytes = hexDecode(f[1]);
    const std::string verdict = f[2];
    const int expectedCount = atoi(f[3].c_str());
    std::vector<std::string> expected;
    for (auto& raw : split(f[4], ';')) {
      std::string e = trim(raw);
      if (!e.empty()) expected.push_back(e);   // abaikan entri kosong
    }

    // Bersihkan state antar kasus.
    Serial.clear();
    deviceConnected = true;
    display.reset();
    rxBuf = "";
    rxOverflow = false;

    // Feed payload dalam chunk 20 byte, sama seperti characteristic.write()
    // di web. loop() dipanggil setelah tiap chunk, seperti task loop di device.
    CharCallbacks cb;
    BLECharacteristic ch("", 0);
    ch.setCallbacks(&cb);
    for (size_t off = 0; off < bytes.size(); off += BLE_WRITE) {
      ch.simulateWrite(bytes.substr(off, BLE_WRITE));
      loop();
    }
    // Tuangkan sisa antrean (payload > 4 pesan akan menumpuk).
    for (int i = 0; i < 32 && !navLines().empty(); i++) loop();

    std::vector<std::string> got = navLines();
    check((int)got.size() == expectedCount,
          "jumlah pesan diproses: harap " + std::to_string(expectedCount) +
          ", dapat " + std::to_string(got.size()));

    if (verdict == "reject") {
      check(got.empty(), "payload rusak tidak boleh diproses");
      continue;
    }

    for (int i = 0; i < expectedCount && i < (int)got.size(); i++) {
      auto e = split(expected[i], '|');
      if (e.size() < 3) { check(false, "baris harapan tidak valid"); continue; }
      const std::string want = "[NAV] ikon=" + e[0] + " jarak=" + e[1] + " teks=\"" + e[2] + "\"";
      check(got[i] == want, "harus \"" + want + "\", dapat \"" + got[i] + "\"");
    }
  }

  std::cout << "payload diuji: " << cases << "\n";
  std::cout << "\n─────────────────────────────\n";
  std::cout << "PASS: " << passed << "   FAIL: " << failed << "\n";
  return failed == 0 ? 0 : 1;
}
