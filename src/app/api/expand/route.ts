import { NextRequest, NextResponse } from 'next/server';
import { expandShortLink } from './expand';

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get('url');
  if (!raw) {
    return NextResponse.json({ ok: false, reason: 'missing-url' }, { status: 400 });
  }

  const result = await expandShortLink(raw);

  const headers: Record<string, string> = {
    'Cache-Control': result.ok ? 'public, s-maxage=600' : 'no-store',
  };

  return NextResponse.json(result, {
    status: result.ok ? 200 : 422,
    headers,
  });
}
