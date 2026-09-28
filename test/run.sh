#!/usr/bin/env bash
# Jalankan seluruh test. Tidak butuh board ESP32, tidak butuh arduino-cli.
#
#   bash test/run.sh
#
# Semua test berjalan di host: logika .ino diuji lewat stub Arduino/BLE,
# dan logika src/*.js diimpor sungguhan lalu dijalankan di Node.
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

# -I . supaya <NimBLEDevice.h> di test/ ketemu.
# Leak dari stub BLE sengaja diabaikan: stub membuat objek dengan new dan
# tidak membebaskan, yang tidak relevan untuk test yang sekali jalan.
export ASAN_OPTIONS=detect_leaks=0

# Compile failure HARUS menghentikan script. Tanpa guard di sini, binary
# dari run sebelumnya tetap ada di build/ dan akan dieksekusi seolah-olah
# pengujian baru -- yang menghasilkan "PASS" untuk kode yang sebenarnya
# tidak pernah bisa dikompilasi. Itu sudah pernah terjadi sekali di sini.
if ! g++ -std=c++17 -I. -w -o build/test_firmware test_firmware.cpp; then
  echo "✗ firmware: GAGAL COMPILE"
  exit 1
fi
if ! g++ -std=c++17 -I. -w -o build/test_cross test_cross.cpp; then
  echo "✗ cross-check: GAGAL COMPILE"
  exit 1
fi

run "firmware: logika .ino"        ./build/test_firmware
run "cross-check: web → firmware"  ./build/test_cross
run "web: payload & ikon"          node test_web.mjs
run "web: wake lock"               node test_wake.mjs
run "web: persistensi tujuan"      node test_trip.mjs
run "web: PWA (manifest & cache)"  node test_pwa.mjs
run "api: resolver short link"     node test_expand.mjs

echo
if [ "$fail" -eq 0 ]; then
  echo "SEMUA SUITE LULUS"
else
  echo "ADA SUITE YANG GAGAL"
fi
exit "$fail"
