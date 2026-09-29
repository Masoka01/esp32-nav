#pragma once

#include <stddef.h>
#include <stdint.h>

// ── Kontrak protokol ───────────────────────────────────────────────────────
//
// NILAI DI SINI WAJIB IDENTIK dengan sisi web:
//   src/lib/ble.ts   -> TEXT_MAX, format frame, ukuran potongan
//   src/lib/route.ts -> tabel kode maneuvers
//
// Menyalin nilai berarti menggeser titik kegagalan: kalau satu sisi berubah
// tanpa sisi lain, C3 tidak memberi error, hanya menampilkan instruksi yang
// diam-diam salah.

// Batas teks setelah sanitizeForBLE() di sisi web.
constexpr size_t TEXT_MAX = 40;

// Panjang frame "`V1|12|-1|<teks>\n`" paling lama adalah sekitar 55 byte.
// Buffer sedikit lebih besar supaya tidak pernah penuh pada frame sah.
constexpr size_t FRAME_MAX = 64;

constexpr int CODE_MIN = 0;
constexpr int CODE_MAX = 12;

// Dipakai web kalau kodenya di luar rentang, dan dipakai firmware kalau
// field kodenya rusak. Keduanya harus jatuh ke nilai yang sama.
constexpr int CODE_FALLBACK = 12;

struct Frame {
  int code;   // 0..12, lihat tabel maneuvers di route.ts
  long dist;  // Meter ke manuver berikutnya, atau -1 bila tidak relevan
  char text[TEXT_MAX + 1];
};

/**
 * Akumulator baris untuk stream BLE.
 *
 * Web menulis dalam potongan 20 byte (BLE_CHUNK_SIZE di ble.ts), sedangkan
 * frame yang sah bisa jadi 50 byte. Jadi satu instruksi bisa datang terpecah
 * jadi tiga write, dan satu write bisa memuat lebih dari satu instruksi.
 * Parser ini karena itu menahan byte sampai ketemu '\n', bukan memeriksa satu
 * write sekaligus.
 *
 * Frame lengkap tidak langsung ditampilkan, tapi masuk antrean dulu.
 * Alasannya: onWrite() dipanggil beberapa kali sebelum loop() sempat jalan,
 * sehingga lebih dari satu instruksi bisa sudah utuh pada saat yang sama.
 * Parser yang hanya menyimpan satu frame akan membuang semua tapi yang
 * terakhir, dan itu hilang tanpa jejak.
 *
 * Sengaja tanpa dependensi Arduino supaya bisa diuji di desktop dengan g++,
 * tanpa hardware. Bagian inilah yang paling mudah salah dan paling mahal untuk
 * dicek di perangkat sungguhan.
 */
class FrameParser {
 public:
  // Kapasitas antrean yang dijanjikan: berapa frame yang bisa menunggu
  // sekaligus sebelum yang tertua dibuang.
  static const size_t QUEUE_MAX = 4;

  // Buffer cincin butuh satu slot ekstra yang selalu kosong, karena posisi yang
  // sama tidak bisa berarti "penuh" dan "kosong" sekaligus. Tanpa slot ekstra
  // ini, kapasitas sebenarnya hanya QUEUE_MAX - 1.
  static const size_t QUEUE_SLOTS = QUEUE_MAX + 1;

  void reset();

  /**
   * Masukkan potongan byte dari characteristic.
   *
   * Aman dipanggil berkali-kali sebelum take(): frame yang selesai akan
   * ditumpuk di antrean.
   *
   * @return true kalau antrean sedang tidak kosong.
   */
  bool feed(const uint8_t* data, size_t len);

  bool hasFrame() const { return head_ != tail_; }

  /** Ambil frame tertua. Panggil hanya kalau hasFrame() true. */
  Frame take();

  /**
   * Berapa frame yang dibuang karena antrean penuh. Kalau angka ini naik,
   * berarti loop() terlalu lambat untuk menyelesaikan instruksi, atau web
   * mengirim lebih cepat dari yang sempat dibaca.
   */
  uint32_t dropped() const { return dropped_; }

 private:
  bool parseLine(Frame& out);
  void discard();
  void push(const Frame& f);

  char buf_[FRAME_MAX];
  size_t len_ = 0;
  bool overflow_ = false;

  Frame queue_[QUEUE_SLOTS];
  size_t head_ = 0;
  size_t tail_ = 0;
  uint32_t dropped_ = 0;
};
