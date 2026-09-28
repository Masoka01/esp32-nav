// @ts-check
//
//  BLE
//

import { state, SERVICE_UUID, CHAR_UUID } from './state.js';
import { bleBtn, bleDot, bleLabel } from './dom.js';
import { toast } from './toast.js';
// ══════════════════════════════════════════════
//  BLE
// ══════════════════════════════════════════════
//
// Konstanta di bawah diekspor supaya test/test_web.mjs membacanya dari sini.
// Sebelumnya test mengambilnya dengan regex dari index.html — rapuh, dan
// tidak mungkin dilakukan sekarang kode sudah tidak ada di index.html.


export function onBLEDisconnect() {
  state.bleChar = null;
  setBLEStatus('disconnected');
  toast('ESP32 terputus');
}

export function setBLEStatus(status, name = '') {
  bleDot.className = '';
  if (status === 'connected') {
    bleDot.classList.add('connected');
    bleLabel.textContent = `Terhubung: ${name}`;
    bleBtn.textContent = 'Putuskan';
    bleBtn.classList.add('connected');
  } else if (status === 'connecting') {
    bleDot.classList.add('connecting');
    bleLabel.textContent = 'Menghubungkan...';
    bleBtn.textContent = 'Batal';
    bleBtn.classList.remove('connected');
  } else {
    bleLabel.textContent = 'ESP32 belum terhubung';
    bleBtn.textContent = 'Hubungkan';
    bleBtn.classList.remove('connected');
  }
}

// ══════════════════════════════════════════════
//  BLE WRITE
//
//  Protokol (HARUS sinkron dengan esp32_nav.ino):
//      V1|<icon>|<dist_m>|<text>\n
//
//  onWrite() di firmware dipanggil SEKALI PER WRITE, jadi satu pesan
//  harus dikirim sebagai rangkaian write berurutan dan diakhiri newline.
//  Tanpa newline firmware tidak akan menggambar apa pun.
// ══════════════════════════════════════════════
export const BLE_CHUNK_SIZE = 20;  // muat pada MTU default 23 (3 byte header)
export const TEXT_MAX = 40;        // sama dengan TEXT_MAX di firmware
export const ICON_MAX = 12;

// Sanitasi defensif: firmware juga menyaring, tapi di sini kita menjamin
// payload 100% ASCII sehingga pemotongan per 20 byte tidak pernah memecah
// karakter multi-byte di tengah chunk.
export function sanitizeForBLE(text) {
  return String(text)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(/[|\r\n\t]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, TEXT_MAX);
}

export function clampCode(c) {
  const n = Math.round(Number(c));
  if (!Number.isFinite(n) || n < 0 || n > ICON_MAX) return 12;
  return n;
}

export function normalizeDist(d) {
  const n = Math.round(Number(d));
  return Number.isFinite(n) ? n : -1;
}

// Rantai antrean: satu pesan selesai sebelum yang berikutnya mulai, supaya
// dua write tidak pernah saling menimpa di tengah chunk.
let bleSendChain = Promise.resolve();

export async function writeChunks(bytes) {
  for (let i = 0; i < bytes.length; i += BLE_CHUNK_SIZE) {
    const chunk = bytes.slice(i, i + BLE_CHUNK_SIZE);
    const ch = state.bleChar;
    if (!ch) return;
    if (typeof ch.writeValueWithResponse === 'function') {
      await ch.writeValueWithResponse(chunk);
    } else {
      await ch.writeValue(chunk);
    }
  }
}

export function sendToBLE(code, text, distMeters = -1) {
  if (!state.bleChar) return Promise.resolve();
  const payload = `V1|${clampCode(code)}|${normalizeDist(distMeters)}|${sanitizeForBLE(text)}\n`;
  const bytes = new TextEncoder().encode(payload);
  bleSendChain = bleSendChain
    .then(() => writeChunks(bytes))
    .catch(e => { console.error('BLE write error:', e); });
  return bleSendChain;
}

/**
 * Koneksi Bluetooth ke ESP32.
 *
 * Dipanggil sekali dari src/main.js. Semua listener dipasang di sini,
 * bukan diatas modul modul, supaya urutan mendaftarnya mengikuti urutan pemanggilan
 * init dan bisa diuji tanpa memuat halaman.
 */
export function initBle() {
  bleBtn.addEventListener('click', async () => {
    if (state.bleDevice && state.bleDevice.gatt.connected) {
      state.bleDevice.gatt.disconnect();
      onBLEDisconnect();
      return;
    }
    if (!navigator.bluetooth) {
      toast('Browser ini tidak mendukung Web Bluetooth. Pakai Chrome Android.');
      return;
    }
    try {
      setBLEStatus('connecting');
      const device = await navigator.bluetooth.requestDevice({
        filters: [{ name: 'ESP32-NAV' }],
        optionalServices: [SERVICE_UUID],
      });
      state.bleDevice = device;
      device.addEventListener('gattserverdisconnected', onBLEDisconnect);
      const server  = await device.gatt.connect();
      const service = await server.getPrimaryService(SERVICE_UUID);
      state.bleChar  = await service.getCharacteristic(CHAR_UUID);
      setBLEStatus('connected', device.name);
      toast('ESP32 terhubung!');
    } catch (e) {
      setBLEStatus('disconnected');
      if (e.name !== 'NotFoundError') toast('Gagal konek: ' + e.message);
    }
  });
}
