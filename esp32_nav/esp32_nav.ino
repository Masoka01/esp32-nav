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

#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

// ── OLED Config ──
#define SCREEN_WIDTH  128
#define SCREEN_HEIGHT  64
#define OLED_RESET     -1   // Reset pin (tidak dipakai)
#define OLED_ADDRESS  0x3C  // Ganti 0x3D jika tidak terdeteksi

Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, OLED_RESET);

// ── BLE UUIDs (harus sama dengan website) ──
#define SERVICE_UUID  "6E400001-B5B3-F393-E0A9-E50E24DCCA9E"
#define CHAR_UUID     "6E400002-B5B3-F393-E0A9-E50E24DCCA9E"

// ── State ──
bool deviceConnected = false;
String lastInstruction = "";

// ══════════════════════════════════════════════
//  BLE CALLBACKS
// ══════════════════════════════════════════════
class ServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer* pServer) override {
    deviceConnected = true;
    showStatus("Terhubung!", true);
    Serial.println("[BLE] Device connected");
  }

  void onDisconnect(BLEServer* pServer) override {
    deviceConnected = false;
    showStatus("Menunggu HP...", false);
    Serial.println("[BLE] Device disconnected");
    // Restart advertising
    BLEDevice::startAdvertising();
  }
};

class CharCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* pChar) override {
    String value = pChar->getValue().c_str();
    if (value.length() == 0) return;

    Serial.print("[NAV] ");
    Serial.println(value);

    lastInstruction = value;
    showInstruction(value);
  }
};

// ══════════════════════════════════════════════
//  DISPLAY FUNCTIONS
// ══════════════════════════════════════════════
void showStatus(const char* msg, bool connected) {
  display.clearDisplay();

  // Header bar
  display.fillRect(0, 0, SCREEN_WIDTH, 14, SSD1306_WHITE);
  display.setTextColor(SSD1306_BLACK);
  display.setTextSize(1);
  display.setCursor(2, 3);
  display.print("ESP32 Navigator");

  // Connection dot
  if (connected) {
    display.fillCircle(122, 7, 4, SSD1306_BLACK);
  } else {
    display.drawCircle(122, 7, 4, SSD1306_BLACK);
  }

  // Status message
  display.setTextColor(SSD1306_WHITE);
  display.setTextSize(1);
  display.setCursor(0, 22);
  display.println(msg);

  if (!connected) {
    display.setCursor(0, 36);
    display.println("Buka website lalu");
    display.setCursor(0, 46);
    display.println("tap Hubungkan");
  }

  display.display();
}

void showInstruction(String text) {
  display.clearDisplay();

  // Header bar
  display.fillRect(0, 0, SCREEN_WIDTH, 14, SSD1306_WHITE);
  display.setTextColor(SSD1306_BLACK);
  display.setTextSize(1);
  display.setCursor(2, 3);
  display.print("NAVIGASI");

  // Connected indicator
  display.fillCircle(122, 7, 4, SSD1306_BLACK);

  display.setTextColor(SSD1306_WHITE);

  // Parse: coba pisah icon dari teks
  // Format dari website: "⬅️ Belok kiri ke Jalan XYZ (200 m)"
  // Karena emoji multi-byte, kita render teks saja mulai baris 1
  display.setTextSize(1);

  // Word wrap manual untuk 128px lebar (21 char per baris di textSize 1)
  int y = 18;
  int maxCharsPerLine = 21;
  int len = text.length();
  int start = 0;

  while (start < len && y < SCREEN_HEIGHT) {
    int end = start + maxCharsPerLine;
    if (end >= len) {
      end = len;
    } else {
      // Mundur ke spasi terdekat
      int space = text.lastIndexOf(' ', end);
      if (space > start) end = space;
    }
    display.setCursor(0, y);
    display.print(text.substring(start, end));
    start = (text.charAt(end) == ' ') ? end + 1 : end;
    y += 11;
  }

  display.display();
}

// ══════════════════════════════════════════════
//  SETUP
// ══════════════════════════════════════════════
void setup() {
  Serial.begin(115200);

  // Init OLED
  if (!display.begin(SSD1306_SWITCHCAPVCC, OLED_ADDRESS)) {
    Serial.println("[ERROR] OLED tidak ditemukan! Cek wiring.");
    for (;;); // halt
  }

  display.clearDisplay();
  display.display();

  showStatus("Memulai BLE...", false);
  delay(500);

  // Init BLE
  BLEDevice::init("ESP32-NAV");

  BLEServer* pServer = BLEDevice::createServer();
  pServer->setCallbacks(new ServerCallbacks());

  BLEService* pService = pServer->createService(SERVICE_UUID);

  BLECharacteristic* pChar = pService->createCharacteristic(
    CHAR_UUID,
    BLECharacteristic::PROPERTY_WRITE
  );
  pChar->setCallbacks(new CharCallbacks());
  pChar->addDescriptor(new BLE2902());

  pService->start();

  BLEAdvertising* pAdv = BLEDevice::getAdvertising();
  pAdv->addServiceUUID(SERVICE_UUID);
  pAdv->setScanResponse(true);
  pAdv->setMinPreferred(0x06);
  BLEDevice::startAdvertising();

  Serial.println("[BLE] Advertising dimulai sebagai ESP32-NAV");
  showStatus("Menunggu HP...", false);
}

// ══════════════════════════════════════════════
//  LOOP
// ══════════════════════════════════════════════
void loop() {
  // Semua logic ada di callbacks
  // Bisa tambah logic lain di sini (buzzer, LED, dsb)
  delay(100);
}
