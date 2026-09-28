#!/usr/bin/env bash
# Jalankan seluruh test. Tidak butuh board ESP32, tidak butuh arduino-cli.
#
#   bash test/run.sh
#
# Semua test berjalan di host: logika .ino diuji lewat stub Arduino/BLE,
# dan logika index.html diekstrak lalu dijalankan di Node.
set -uo pipefail
cd "$(dirname "$0")"

fail=0
run() {
  local name="$1"; shift
  echo
  echo "═══════════ ${name} ═══════════"
  if "$@"; then
    echo "✓ ${name}"
  else
    echo "✗ ${name}"
    fail=1
  fi
}

mkdir -p build

# -I . supaya <BLEDevice.h> & friends di test/ ketemu.
# Leak dari stub BLE sengaja diabaikan: stub membuat objek dengan new dan
# tidak membebaskan, yang tidak relevan untuk test yang sekali jalan.
export ASAN_OPTIONS=detect_leaks=0

g++ -std=c++17 -I. -w -o build/test_firmware test_firmware.cpp
g++ -std=c++17 -I. -w -o build/test_cross   test_cross.cpp

run "firmware: logika .ino"        ./build/test_firmware
run "cross-check: web → firmware"  ./build/test_cross
run "web: payload & ikon"          node test_web.mjs
run "web: wake lock"               node test_wake.mjs
run "web: persistensi tujuan"      node test_trip.mjs

echo
if [ "$fail" -eq 0 ]; then
  echo "SEMUA SUITE LULUS"
else
  echo "ADA SUITE YANG GAGAL"
fi
exit "$fail"
