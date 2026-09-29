#include "Protocol.h"

#include <stdlib.h>
#include <string.h>

void FrameParser::reset() {
  len_ = 0;
  overflow_ = false;
  head_ = 0;
  tail_ = 0;
  dropped_ = 0;
}

void FrameParser::discard() {
  len_ = 0;
  overflow_ = false;
}

void FrameParser::push(const Frame& f) {
  const size_t next = (tail_ + 1) % QUEUE_SLOTS;
  if (next == head_) {
    // Antrean penuh. Buang yang paling lama, bukan yang baru: untuk navigasi,
    // instruksi basi lebih berbahaya daripada instruksi yang belum tampil.
    head_ = (head_ + 1) % QUEUE_SLOTS;
    dropped_++;
  }
  queue_[tail_] = f;
  tail_ = next;
}

bool FrameParser::feed(const uint8_t* data, size_t len) {
  for (size_t i = 0; i < len; i++) {
    const char c = (char)data[i];

    if (c == '\n') {
      if (overflow_) {
        // Baris sebelumnya melewati batas buffer, jadi isinya sudah tidak
        // dipercaya. Buang, lalu lanjut ke baris berikutnya.
        discard();
        continue;
      }
      if (len_ > 0) {
        Frame f;
        if (parseLine(f)) push(f);
      }
      len_ = 0;
      continue;
    }

    // Buang sisa baris yang sudah rusak sampai newline berikutnya. Menahan
    // penanda overflow tanpa membatasi panjang akan membuat parser diam
    // selamanya setelah satu baris yang terlalu panjang.
    if (overflow_) continue;

    if (len_ + 1 >= FRAME_MAX) {
      overflow_ = true;
      continue;
    }
    buf_[len_++] = c;
  }
  return hasFrame();
}

bool FrameParser::parseLine(Frame& out) {
  buf_[len_] = '\0';

  // sanitizeForBLE() di sisi web mengganti '|' dengan spasi, jadi teks tidak
  // pernah memuat '|' sendiri. Memecah baris di '|' karena itu aman.
  char* parts[4];
  int found = 0;
  char* start = buf_;

  for (size_t i = 0; i <= len_; i++) {
    if (i == len_ || buf_[i] == '|') {
      buf_[i] = '\0';
      if (found < 4) parts[found] = start;
      found++;
      start = buf_ + i + 1;
    }
  }

  if (found != 4) return false;

  // Nomor versi harus cocok. Frame dari versi protokol lain jangan
  // ditampilkan seolah-olah maknanya sama.
  if (strcmp(parts[0], "V1") != 0) return false;

  char* end = nullptr;
  long code = strtol(parts[1], &end, 10);
  if (end == parts[1] || *end != '\0' || code < CODE_MIN || code > CODE_MAX) {
    code = CODE_FALLBACK;
  }

  end = nullptr;
  long dist = strtol(parts[2], &end, 10);
  if (end == parts[2] || *end != '\0') dist = -1;

  out.code = (int)code;
  out.dist = dist;

  strncpy(out.text, parts[3], TEXT_MAX);
  out.text[TEXT_MAX] = '\0';
  return true;
}

Frame FrameParser::take() {
  const Frame f = queue_[head_];
  head_ = (head_ + 1) % QUEUE_SLOTS;
  return f;
}
