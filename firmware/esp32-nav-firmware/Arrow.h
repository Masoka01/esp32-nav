#pragma once

#include <Adafruit_GFX.h>

/**
 * Gambar penanda manuver untuk kode 0..12 di dalam kotak (x, y) berukuran
 * size x size piksel.
 *
 * Glyph digambar prosedural dari garis, bukan dari font atau gambar: tidak
 * ada aset yang perlu ikut di-commit, dan ukurannya bebas mengikuti kotak yang
 * dipakai tanpa menggambar ulang.
 */
void drawArrowGlyph(Adafruit_GFX& gfx, int x, int y, int size, int code);
