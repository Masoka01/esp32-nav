import { NextResponse } from 'next/server';

/**
 * ID build yang sedang dilayani server.
 *
 * Dipakai klien untuk mendeteksi PWA yang basi: bundle yang sedang jalan
 * membandingkan `NEXT_PUBLIC_BUILD_ID` miliknya dengan nilai di sini. Kalau
 * beda, artinya ada deploy baru dan halaman perlu dimuat ulang.
 *
 * `no-store` wajib: kalau respons ini ikut ter-cache, justru tidak akan pernah
 * terlihat ada versi baru.
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(
    { buildId: process.env.NEXT_PUBLIC_BUILD_ID ?? 'dev' },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
