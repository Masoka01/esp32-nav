#include <Arduino.h>
#include <NimBLEDevice.h>
#include <Wire.h>

#include "Config.h"
#include "Display.h"
#include "Protocol.h"

static Adafruit_SSD1306 g_oled(OLED_WIDTH, OLED_HEIGHT, &Wire, OLED_RESET);
static Display g_display(g_oled);

// Parser dan penanda koneksi sengaja berkas statis, bukan lokal di dalam
// callback. Callback dipanggil dari konteks task BLE, bukan dari loop(), jadi
// keadaan di dalamnya harus bertahan lintas pemanggilan.
static FrameParser g_parser;
static bool g_connected = false;
static uint32_t g_lastAdvertiseAtMs = 0;

/**
 * Web menulis dalam potongan 20 byte (BLE_CHUNK_SIZE di src/lib/ble.ts), dan
 * callback ini bisa dipanggil berkali-kali untuk satu instruksi. Karena itu
 * datanya langsung masuk parser; parser yang memutuskan kapan sebuah frame
 * sudah utuh.
 */
class InstructionCallbacks : public NimBLECharacteristicCallbacks {
  void onWrite(NimBLECharacteristic *chr, NimBLEConnInfo &connInfo) override {
    (void)connInfo;
    // getValue() mengembalikan NimBLEAttValue berdasarkan nilai, bukan
    // rujukan. Disalin ke std::string dulu supaya tidak bergantung pada
    // operator konversi dan perpanjangan masa hidup temporary.
    const std::string value = chr->getValue();
    g_parser.feed(reinterpret_cast<const uint8_t *>(value.data()), value.size());
  }
};

/**
 * Hanya mencatat status koneksi.
 *
 * Advertising ulang setelah disconnect ditangani library lewat
 * server->advertiseOnDisconnect(true) di setup(), jadi callback ini tidak
 * perlu memanggil startAdvertising() sendiri. Kalau dipanggil dua kali dari
 * dua tempat, advertise bisa mulai dua kali dan saling meniadakan.
 */
class LinkCallbacks : public NimBLEServerCallbacks {
  void onConnect(NimBLEServer *server, NimBLEConnInfo &connInfo) override {
    (void)server;
    (void)connInfo;
    g_connected = true;
  }

  void onDisconnect(NimBLEServer *server, NimBLEConnInfo &connInfo, int reason) override {
    (void)server;
    (void)connInfo;
    (void)reason;
    g_connected = false;
    g_lastAdvertiseAtMs = millis();
  }
};

static void startAdvertising() {
  g_lastAdvertiseAtMs = millis();

  NimBLEAdvertising *adv = NimBLEDevice::getAdvertising();
  adv->setName(DEVICE_NAME);
  adv->addServiceUUID(SERVICE_UUID);
  adv->enableScanResponse(true);
  // Interval dalam satuan 0,625 ms, jadi angka di bawah berarti 20 ms dan
  // 40 ms. Pendek supaya HP cepat menemukan C3, panjang supaya radio tidak
  // terbebani.
  adv->setMinInterval(32);
  adv->setMaxInterval(64);
  adv->start();
}

/**
 * Tampilkan semua frame yang sudah lengkap.
 *
 * Ditaruh di loop(), bukan di dalam onWrite, karena display() lewat I2C
 * memerlukan waktu lama; memanggilnya dari konteks task BLE akan menahan
 * task BLE terlalu lama.
 */
static void drainFrames() {
  while (g_parser.hasFrame()) {
    const Frame f = g_parser.take();
    g_display.showInstruction(f.code, f.dist, f.text);
  }
}

void setup() {
  Serial.begin(115200);

  Wire.begin(PIN_SDA, PIN_SCL);
  g_oled.begin(SSD1306_SWITCHCAPVCC, OLED_ADDRESS);
  g_display.showBoot();

  NimBLEDevice::init(DEVICE_NAME);
  NimBLEServer *server = NimBLEDevice::createServer();

  LinkCallbacks *link = new LinkCallbacks();
  server->setCallbacks(link);

  NimBLEService *service = server->createService(SERVICE_UUID);

  // Hanya WRITE. Arahnya satu: HP menulis instruksi, C3 tidak pernah
  // menulis balik dan tidak ada notifikasi. Properti READ sengaja tidak
  // dipasang supaya tidak ada jalan yang bisa dipakai C3 mengirim data.
  NimBLECharacteristic *instr = service->createCharacteristic(CHAR_UUID, NIMBLE_PROPERTY::WRITE);
  instr->setCallbacks(new InstructionCallbacks());

  // Server yang memulai semua service. NimBLEService::start() sudah
  // deprecated di NimBLE-Arduino 2.x dan tidak lagi melakukan apa pun.
  server->start();

  // Setelah disconnect, HP tidak punya cara meminta C3 advertise lagi, jadi
  // library yang harus mengulangnya. Dengan flag ini, onDisconnect di bawah
  // tidak perlu memanggil startAdvertising() secara manual.
  server->advertiseOnDisconnect(true);

  startAdvertising();
  g_display.showIdle();
}

void loop() {
  static uint32_t reported = 0;
  drainFrames();

  // Kalau ada frame yang dibuang, laporkan. Instruksi yang hilang tanpa
  // jejak jauh lebih sulit dicari daripada yang hilang karena tercatat di sini.
  if (g_parser.dropped() != reported) {
    reported = g_parser.dropped();
    Serial.printf("frame dibuang: %lu\n", (unsigned long)reported);
  }

  // Jaring pengaman: kalau C3 sampai berhenti advertise tanpa koneksi, coba
  // lagi. Tanpa ini C3 bisa hilang dari daftar Bluetooth HP sampai di-restart.
  if (!g_connected && (millis() - g_lastAdvertiseAtMs) >= ADVERTISE_INTERVAL_MS) {
    NimBLEDevice::startAdvertising();
    g_lastAdvertiseAtMs = millis();
  }

  delay(20);
}
