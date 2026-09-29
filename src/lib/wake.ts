import { state } from './state';

export function silentWavDataUri(): string {
  const RATE = 8000, FRAMES = 800, CHANNELS = 1, BITS = 8;
  const dataSize = FRAMES * CHANNELS * (BITS / 8);
  const buf = new ArrayBuffer(44 + dataSize);
  const v = new DataView(buf);
  const tag = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i));
  };
  tag(0, 'RIFF');
  v.setUint32(4, 36 + dataSize, true);
  tag(8, 'WAVE');
  tag(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, CHANNELS, true);
  v.setUint32(24, RATE, true);
  v.setUint32(28, RATE * CHANNELS * BITS / 8, true);
  v.setUint16(32, CHANNELS * BITS / 8, true);
  v.setUint16(34, BITS, true);
  tag(36, 'data');
  v.setUint32(40, dataSize, true);
  const bytes = new Uint8Array(buf);
  bytes.fill(128, 44);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return 'data:audio/wav;base64,' + btoa(bin);
}

let keepAwakeAudio: HTMLAudioElement | null = null;
let releasingIntentionally = false;

export function stopKeepAwakeFallback(): void {
  if (!keepAwakeAudio) return;
  try { keepAwakeAudio.pause(); } catch { /* abaikan */ }
  keepAwakeAudio = null;
}

export function startKeepAwakeFallback(setNote: (msg: string, warn?: boolean) => void): void {
  if (keepAwakeAudio) return;
  try {
    const audio = new Audio(silentWavDataUri());
    audio.loop = true;
    audio.volume = 0.01;
    const played = audio.play();
    if (played && played.catch) played.catch(() => {});
    keepAwakeAudio = audio;
    setNote('Layar dijaga (mode kompatibilitas, boros baterai).');
  } catch {
    setNote('Tidak bisa menjaga layar tetap menyala. Navigasi bisa terputus saat tab tidak aktif.', true);
  }
}

export async function requestWakeLock(setNote: (msg: string, warn?: boolean) => void): Promise<void> {
  if (!state.navigating) return;
  if (!('wakeLock' in navigator)) { startKeepAwakeFallback(setNote); return; }
  if (state.wakeLock && !state.wakeLock.released) return;

  try {
    const sentinel = await (navigator as any).wakeLock.request('screen');
    if (!state.navigating) { sentinel.release().catch(() => {}); return; }
    state.wakeLock = sentinel;
    setNote('Layar dijaga — layar tidak akan padam selama navigasi.');
    sentinel.addEventListener('release', () => {
      state.wakeLock = null;
      if (state.navigating && !releasingIntentionally) {
        setNote('Layar tidak lagi dijaga. Navigasi bisa berhenti kalau tab dibekukan browser.', true);
      }
    });
  } catch {
    setNote('Tidak bisa menjaga layar tetap menyala. Navigasi bisa terputus saat tab tidak aktif.', true);
  }
}

export function releaseWakeLock(setNote: (msg: string, warn?: boolean) => void): void {
  const sentinel = state.wakeLock;
  state.wakeLock = null;
  if (sentinel) {
    releasingIntentionally = true;
    try { sentinel.release().catch(() => {}); } catch { /* abaikan */ }
    setTimeout(() => { releasingIntentionally = false; }, 0);
  }
  stopKeepAwakeFallback();
  setNote('');
}
