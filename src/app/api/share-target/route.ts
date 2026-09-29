import { NextRequest, NextResponse } from 'next/server';

const URL_IN_TEXT = /https?:\/\/[^\s"'<>\u0000-\u001f]+/i;

function extractUrl(text: string): string {
  const m = String(text).match(URL_IN_TEXT);
  return m ? m[0] : '';
}

export async function POST(req: NextRequest) {
  let link = '';

  try {
    const fd = await req.formData();
    for (const [, value] of fd.entries()) {
      if (typeof value !== 'string' || !value) continue;
      if (!link) link = extractUrl(value);
    }
  } catch {
    try {
      const raw = await req.text();
      if (raw) link = extractUrl(raw);
    } catch { /* abaikan */ }
  }

  if (link) {
    const target = new URL('/#u=' + encodeURIComponent(link), req.url);
    return NextResponse.redirect(target.href, 302);
  }

  return new NextResponse('Share diterima, tapi link peta tidak ditemukan.', {
    status: 200,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
