const CLIENT_TIMEOUT_MS = 8000;

const REASON_TEXT: Record<string, string> = {
  'not-a-link':         'Link itu bukan tautan yang bisa dibuka.',
  'not-https':          'Link itu bukan HTTPS.',
  'missing-url':        'Linknya kosong.',
  'method-not-allowed': 'Permintaan ditolak server.',
  'host-not-allowed':   'Tautan itu bukan short link Google Maps.',
  'no-redirect':        'Tautan itu tidak mengarah ke peta.',
  'too-many-hops':      'Rantai pengalihan terlalu panjang.',
  'timeout':            'Server terlalu lama menjawab.',
  'fetch-failed':       'Tidak bisa menghubungi server. Cek koneksi internet.',
  'bad-location':       'Tautan itu tidak valid.',
};

export class ResolveError extends Error {
  reason: string;
  offline: boolean;
  constructor(reason: string, offline: boolean) {
    super(REASON_TEXT[reason] || 'Tautan tidak bisa dibuka.');
    this.name = 'ResolveError';
    this.reason = reason;
    this.offline = offline;
  }
  get userMessage() { return this.message; }
}

export function looksLikeUrl(text: string): boolean {
  return /^https?:\/\/\S+$/i.test(String(text || '').trim());
}

export async function resolveShortLink(url: string): Promise<string> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), CLIENT_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch('/api/expand?url=' + encodeURIComponent(String(url)), {
      signal: ctl.signal,
    });
  } catch {
    throw new ResolveError('fetch-failed', true);
  } finally {
    clearTimeout(timer);
  }

  let body: { ok?: boolean; url?: string; reason?: string } = {};
  try { body = await res.json(); } catch {
    throw new ResolveError('fetch-failed', true);
  }

  if (!res.ok || !body.ok || !body.url) {
    throw new ResolveError(body.reason || 'fetch-failed', false);
  }
  return body.url;
}
