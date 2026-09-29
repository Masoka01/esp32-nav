export function buildBookmarklet(appUrl: string): string {
  const base = String(appUrl || '').replace(/\/+$/, '');
  return 'javascript:(function(){window.open('
       + JSON.stringify(base + '#u=')
       + '+encodeURIComponent(location.href))})()';
}

export function readIncomingLink(): string | null {
  if (typeof window === 'undefined') return null;
  const hash = window.location.hash.replace(/^#/, '');
  if (!hash) return null;
  try { return new URLSearchParams(hash).get('u'); } catch { return null; }
}

export function cleanIncomingLink(): void {
  if (typeof window === 'undefined' || !window.location.hash) return;
  window.history.replaceState(null, '', window.location.pathname + window.location.search);
}

export type Platform = 'ios' | 'android' | 'desktop';

export function detectPlatform(): Platform {
  if (typeof navigator === 'undefined') return 'desktop';
  const ua = navigator.userAgent || '';
  if (/iPhone|iPad|iPod/.test(ua)
      || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'ios';
  if (/Android/.test(ua)) return 'android';
  return 'desktop';
}

export const BM_HELP: Record<'desktop' | 'android', { save: string; run: string; note: string }> = {
  desktop: {
    save: '(Chrome: ⋮ → Bookmark → Edit → More ⋮ → Edit)',
    run: 'klik bookmark <b>Kirim ke ESP-Nav</b>',
    note: '',
  },
  android: {
    save: '(Chrome: ⋮ → ⭐ → <b>Edit</b>, lalu ganti kolom URL dengan kode di bawah)',
    run: 'ketik <b>Kirim ke ESP-Nav</b> di address bar Google Maps, lalu tap sarannya',
    note: 'Bookmark Android tidak bisa dibuka dari daftar bookmark: Chrome membuang URL "javascript:" di sana. Address bar satu-satunya tempat yang menjalankannya.',
  },
};
