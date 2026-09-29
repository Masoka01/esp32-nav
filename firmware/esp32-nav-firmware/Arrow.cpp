#include "Arrow.h"

#include <stdint.h>

// Kedelapan arah kompas, y ke bawah. Indeks dipakai helper head() di bawah.
struct Vec {
  int8_t x, y;
};

static const Vec DIRS[8] = {
    {1, 0},   // 0 timur
    {1, -1},  // 1 timur laut
    {0, -1},  // 2 utara
    {-1, -1}, // 3 barat laut
    {-1, 0},  // 4 barat
    {-1, 1},  // 5 barat daya
    {0, 1},   // 6 selatan
    {1, 1},   // 7 tenggara
};

// Semua glyph digambar pada grid ternormalisasi 0..GRID, lalu diskalakan ke
// ukuran kotak yang diminta. Dengan begitu satu definisi glyph berlaku untuk
// kotak 16 piksel maupun 40 piksel.
static const int GRID = 16;
static const int INK = 1;

class Pen {
 public:
  Pen(Adafruit_GFX& g, int x, int y, int size) : g_(g), x_(x), y_(y), s_(size) {}

  int px(int v) const { return x_ + (v * s_) / GRID; }
  int py(int v) const { return y_ + (v * s_) / GRID; }
  int len(int v) const { return (v * s_) / GRID; }

  void line(int x1, int y1, int x2, int y2) const {
    g_.drawLine(px(x1), py(y1), px(x2), py(y2));
  }

 private:
  Adafruit_GFX& g_;
  int x_, y_, s_;
};

// Ujung panah: dua sayap yang membentang ke belakang dari ujung, mengikuti arah
// panah. Sayap memakai arah yang bersebelahan dengan arah kebalikan, bukan
// dengan arah panah itu sendiri.
static void head(Adafruit_GFX& g, const Pen& p, int tipX, int tipY, int dir, int wing) {
  const Vec a = DIRS[(dir + 5) & 7];
  const Vec b = DIRS[(dir + 3) & 7];
  g.drawLine(p.px(tipX), p.py(tipY), p.px(tipX - a.x * wing), p.py(tipY - a.y * wing));
  g.drawLine(p.px(tipX), p.py(tipY), p.px(tipX - b.x * wing), p.py(tipY - b.y * wing));
}

void drawArrowGlyph(Adafruit_GFX& g, int x, int y, int size, int code) {
  const Pen p(g, x, y, size);

  switch (code) {
    case 0:   // mulai
    case 1:   // lanjut
      p.line(8, 15, 8, 3);
      head(g, p, 8, 3, 2, 5);
      break;

    case 2:   // sedikit kiri
      p.line(11, 15, 4, 4);
      head(g, p, 4, 4, 3, 5);
      break;

    case 3:   // kiri
      p.line(15, 8, 3, 8);
      head(g, p, 3, 8, 4, 5);
      break;

    case 4:   // tajam kiri
      p.line(15, 8, 3, 8);
      head(g, p, 3, 8, 4, 5);
      p.line(5, 8, 9, 4);
      break;

    case 5:   // putar balik
      p.line(12, 15, 12, 5);
      p.line(12, 5, 4, 5);
      p.line(4, 5, 4, 11);
      head(g, p, 4, 11, 6, 5);
      break;

    case 6:   // sedikit kanan
      p.line(5, 15, 12, 4);
      head(g, p, 12, 4, 1, 5);
      break;

    case 7:   // kanan
      p.line(1, 8, 13, 8);
      head(g, p, 13, 8, 0, 5);
      break;

    case 8:   // tajam kanan
      p.line(1, 8, 13, 8);
      head(g, p, 13, 8, 0, 5);
      p.line(11, 8, 7, 4);
      break;

    case 9: {  // bundar atau simpang
      g.drawCircle(p.px(6), p.py(8), p.len(5), INK);
      p.line(9, 8, 15, 8);
      head(g, p, 15, 8, 0, 4);
      break;
    }

    case 10: {  // gabung atau ramp
      p.line(2, 3, 8, 9);
      p.line(14, 3, 8, 9);
      p.line(8, 9, 8, 15);
      head(g, p, 8, 15, 6, 4);
      break;
    }

    case 11: {  // sampai di tujuan
      // Kotak berganda, supaya berbeda dari semua glyph manuver.
      for (int i = 0; i < 2; i++) {
        for (int j = 0; j < 2; j++) {
          if ((i + j) % 2 == 0) {
            g.fillRect(p.px(2 + i * 6), p.py(2 + j * 6), p.len(6), p.len(6), INK);
          }
        }
      }
      break;
    }

    default: {  // kode di luar tabel: segitiga peringatan
      p.line(8, 1, 15, 14);
      p.line(15, 14, 1, 14);
      p.line(1, 14, 8, 1);
      p.line(8, 6, 8, 10);
      g.fillCircle(p.px(8), p.py(12), p.len(1), INK);
      break;
    }
  }
}
