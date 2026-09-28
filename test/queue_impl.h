// Implementasi queue FreeRTOS untuk host test.
//
// Item adalah char[LINE_MAX] mentah (bukan struct), jadi xQueueReceive
// selalu menulis tepat itemSize byte ke buffer pemanggil — persis seperti
// yang diharapkan loop() yang punya `char line[LINE_MAX]`.
#pragma once
#include "stubs.h"
#include <map>

struct _QStore {
  std::map<int, QueueImpl> map;   // key = id integer, bukan pointer
  int next = 0;
};

inline _QStore& _qstore() {
  static _QStore s;
  return s;
}

inline int _qid(QueueHandle_t h) { return (int)(intptr_t)h; }

inline QueueHandle_t xQueueCreate(size_t n, size_t sz) {
  _QStore& s = _qstore();
  int id = ++s.next;
  s.map[id] = QueueImpl();
  s.map[id].itemSize = sz;
  s.map[id].capacity = n;
  return (QueueHandle_t)(intptr_t)id;
}

inline int xQueueSend(QueueHandle_t h, const void* item, TickType_t) {
  _QStore& s = _qstore();
  auto it = s.map.find(_qid(h));
  if (it == s.map.end() || it->second.itemSize == 0) return pdFALSE;  // queue tidak ada
  // xQueueSend tanpa wait tidak boleh menimpa: queue penuh → pdFALSE.
  if (it->second.capacity != 0 && it->second.items.size() >= it->second.capacity)
    return pdFALSE;
  it->second.items.emplace_back((const char*)item, it->second.itemSize);
  return pdTRUE;
}

inline int xQueueReceive(QueueHandle_t h, void* buf, TickType_t) {
  _QStore& s = _qstore();
  auto it = s.map.find(_qid(h));
  if (it == s.map.end() || it->second.itemSize == 0) return pdFALSE;
  if (it->second.items.empty()) return pdFALSE;
  memcpy(buf, it->second.items.front().data(), it->second.itemSize);
  it->second.items.erase(it->second.items.begin());
  return pdTRUE;
}
