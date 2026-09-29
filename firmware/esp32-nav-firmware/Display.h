#pragma once

#include <Adafruit_GFX.h>

/**
 * Susunan layar 128x64:
 *
 *   y = 0..15    jarak ke manuver berikutnya, font besar
 *   y = 0..27    glyph manuver, di kolom kanan
 *   y = 32..49   teks instruksi, font kecil, maksimal dua baris
 *   y = 54..63   nama perangkat dan kode mentah
 *
 * Baris bawah sengaja menampilkan kode mentah. Saat di jalan, kode itu
 * satu-satunya cara mencocokkan apa yang tampil di layar dengan apa yang
 * dikirim aplikasi, tanpa harus menebak-nebak.
 */
class Display {
 public:
  explicit Display(Adafruit_GFX& gfx) : gfx_(gfx) {}

  /** Tampilkan satu instruksi. dist negatif berarti jarak tidak relevan. */
  void showInstruction(int code, long dist, const char* text);

  /** Layar diam: belum ada instruksi yang masuk. */
  void showIdle();

  /** Layar saat C3 dinyalakan, sebelum BLE siap. */
  void showBoot();

 private:
  void drawDistance(long dist);
  void drawWrapped(const char* text, int x, int y, int maxChars, int maxLines);
  void drawStatusLine(int code);

  Adafruit_GFX& gfx_;
};
