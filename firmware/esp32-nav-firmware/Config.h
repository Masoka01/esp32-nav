#pragma once

// ── Kontrak BLE ────────────────────────────────────────────────────────────
//
// NILAI DI SINI WAJIB IDENTIK dengan sisi web. Sumbernya:
//   src/lib/state.ts  -> SERVICE_UUID, CHAR_UUID
//   src/lib/ble.ts    -> DEVICE_NAME (filter requestDevice)
//
// Web Bluetooth memfilter perangkat berdasarkan nama persis. Mengubah satu
// huruf di sini membuat aplikasi tidak pernah menemukan C3 sama sekali, dan
// gejalanya "tidak ada perangkat yang muncul" tanpa pesan error.

// Pasangan UUID ini adalah default UART NimBLE-Arduino.
#define DEVICE_NAME "ESP32-NAV"
#define SERVICE_UUID "6e400001-b5b3-f393-e0a9-e50e24dcca9e"
#define CHAR_UUID    "6e400002-b5b3-f393-e0a9-e50e24dcca9e"

// ── Hardware ───────────────────────────────────────────────────────────────
//
// PIN I2C BERGANTUNG PAPAN. Yang tertulis di bawah hanya nilai yang umum pada
// ESP32-C3 Super Mini, bukan nilai standar. Ganti sesuai papanmu di sini;
// jangan disalin ke file lain.

#define PIN_SDA 8
#define PIN_SCL 9

#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 64
#define OLED_ADDRESS 0x3C
#define OLED_RESET -1  // Tidak ada pin reset di sebagian besar modul.

// ── BLE ────────────────────────────────────────────────────────────────────

// Lamanya C3 boleh diam sebelum advertise diulang. Nilai ini hanya relevan
// kalau loop() menjalankan advertise ulang berkala; lihat loop() di
// esp32-nav-firmware.ino.
#define ADVERTISE_INTERVAL_MS 1000
