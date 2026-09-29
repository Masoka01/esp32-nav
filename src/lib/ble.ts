import { state, SERVICE_UUID, CHAR_UUID } from './state';

export const BLE_CHUNK_SIZE = 20;
export const TEXT_MAX = 40;
export const ICON_MAX = 12;

export function sanitizeForBLE(text: string): string {
  return String(text)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(/[|\r\n\t]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, TEXT_MAX);
}

export function clampCode(c: number): number {
  const n = Math.round(Number(c));
  if (!Number.isFinite(n) || n < 0 || n > ICON_MAX) return 12;
  return n;
}

export function normalizeDist(d: number): number {
  const n = Math.round(Number(d));
  return Number.isFinite(n) ? n : -1;
}

let bleSendChain = Promise.resolve();

export async function writeChunks(bytes: Uint8Array): Promise<void> {
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

export function sendToBLE(code: number, text: string, distMeters = -1): Promise<void> {
  if (!state.bleChar) return Promise.resolve();
  const payload = `V1|${clampCode(code)}|${normalizeDist(distMeters)}|${sanitizeForBLE(text)}\n`;
  const bytes = new TextEncoder().encode(payload);
  bleSendChain = bleSendChain
    .then(() => writeChunks(bytes))
    .catch(e => { console.error('BLE write error:', e); });
  return bleSendChain;
}

export async function connectBLE(
  onStatus: (status: 'connecting' | 'connected' | 'disconnected', name?: string) => void,
  onToast: (msg: string) => void,
): Promise<void> {
  if (state.bleDevice && state.bleDevice.gatt.connected) {
    state.bleDevice.gatt.disconnect();
    state.bleChar = null;
    onStatus('disconnected');
    onToast('ESP32 terputus');
    return;
  }

  if (!navigator.bluetooth) {
    onToast('Browser ini tidak mendukung Web Bluetooth. Pakai Chrome Android.');
    return;
  }

  try {
    onStatus('connecting');
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ name: 'ESP32-NAV' }],
      optionalServices: [SERVICE_UUID],
    });
    state.bleDevice = device;
    device.addEventListener('gattserverdisconnected', () => {
      state.bleChar = null;
      onStatus('disconnected');
      onToast('ESP32 terputus');
    });
    const server  = await device.gatt.connect();
    const service = await server.getPrimaryService(SERVICE_UUID);
    state.bleChar  = await service.getCharacteristic(CHAR_UUID);
    onStatus('connected', device.name);
    onToast('ESP32 terhubung!');
  } catch (e: any) {
    onStatus('disconnected');
    if (e.name !== 'NotFoundError') onToast('Gagal konek: ' + e.message);
  }
}
