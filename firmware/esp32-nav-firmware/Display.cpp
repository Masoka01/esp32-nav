#include "Display.h"

#include <stdio.h>
#include <string.h>

#include "Arrow.h"
#include "Config.h"
#include "Protocol.h"

static const int W = 128;

// Lebar satu kolom glyph, dipakai untuk menyisakan ruang di kanan baris
// instruksi supaya teks panjang tidak menimpa glyph manuver.
static const int GLYPH_X = 100;
static const int GLYPH_SIZE = 28;

void Display::drawDistance(long dist) {
  char buf[16];

  if (dist < 0) {
    // Jarak tidak relevan, misalnya saat rute baru dimulai. Tanda hubung
    // lebih jujur daripada angka yang menebak-nebak jarak.
    strncpy(buf, "--", sizeof(buf));
  } else if (dist < 1000) {
    snprintf(buf, sizeof(buf), "%ld m", dist);
  } else if (dist < 10000) {
    // Bulatkan ke seperseratus kilometer. Dihitung sebagai satu angka utuh
    // supaya 1.999 km tidak ditulis jadi "1.10 km".
    const long tenths = (dist + 50) / 100;
    snprintf(buf, sizeof(buf), "%ld.%ld km", tenths / 10, tenths % 10);
  } else {
    snprintf(buf, sizeof(buf), "%ld km", dist / 1000);
  }

  gfx_.setTextSize(2);
  gfx_.setCursor(2, 2);
  gfx_.print(buf);
  gfx_.setTextSize(1);
}

void Display::drawWrapped(const char* text, int x, int y, int maxChars, int maxLines) {
  const size_t n = strlen(text);
  size_t start = 0;
  int line = 0;

  while (start < n && line < maxLines) {
    size_t take = n - start;
    if (take > (size_t)maxChars) {
      // Usahakan tidak memotong di tengah kata: mundur ke spasi terakhir.
      take = (size_t)maxChars;
      for (size_t k = 0; k < take; k++) {
        if (text[start + k] == ' ') {
          take = k;
          break;
        }
      }
      if (take == 0) take = (size_t)maxChars;
    }

    size_t copy = take;
    while (copy > 0 && text[start + copy - 1] == ' ') copy--;

    char buf[TEXT_MAX + 1];
    if (copy > TEXT_MAX) copy = TEXT_MAX;
    memcpy(buf, text + start, copy);
    buf[copy] = '\0';

    gfx_.setCursor(x, y + line * 10);
    gfx_.print(buf);

    start += take;
    while (start < n && text[start] == ' ') start++;
    line++;
  }

  // Baris ketiga dan seterusnya sengaja dibuang. Layar tidak punya tempat
  // untuk menampilkannya, dan sisa yang tidak terbaca lebih buruk daripada
  // teks yang terpotong. Sisi web sudah menjaga teks tetap pendek.
}

void Display::drawStatusLine(int code) {
  gfx_.setTextSize(1);
  gfx_.setCursor(0, 54);
  gfx_.print(DEVICE_NAME " ");
  gfx_.print(code);
}

void Display::showInstruction(int code, long dist, const char* text) {
  gfx_.clearDisplay();
  drawDistance(dist);
  drawArrowGlyph(gfx_, GLYPH_X, 0, GLYPH_SIZE, code);
  drawWrapped(text, 2, 32, 21, 2);
  drawStatusLine(code);
  gfx_.display();
}

void Display::showIdle() {
  gfx_.clearDisplay();
  gfx_.setTextSize(2);
  gfx_.setCursor(2, 2);
  gfx_.print(DEVICE_NAME);
  gfx_.setTextSize(1);
  gfx_.setCursor(2, 24);
  gfx_.print("menunggu instruksi");
  gfx_.setCursor(2, 36);
  gfx_.print("buka aplikasi di HP");
  drawStatusLine(-1);
  gfx_.display();
}

void Display::showBoot() {
  gfx_.clearDisplay();
  gfx_.setTextSize(2);
  gfx_.setCursor(2, 18);
  gfx_.print("ESP32-NAV");
  gfx_.setTextSize(1);
  gfx_.setCursor(2, 44);
  gfx_.print("menyalakan BLE...");
  gfx_.display();
}
