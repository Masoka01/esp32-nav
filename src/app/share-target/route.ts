import { NextRequest, NextResponse } from 'next/server';

/**
 * Jaring pengaman untuk share target.
 *
 * Manifest mendeklarasikan action `./share-target`, dan service worker
 * (public/sw.js) yang biasanya menangkapnya. Tapi SW baru aktif setelah
 * aplikasi di-install DAN dibuka minimal sekali — dan share bisa saja terjadi
 * sebelum itu, terutama di install pertama. Tanpa route ini, Android membuka
 * halaman kosong karena POST-nya tidak ditangani siapa pun.
 *
 * Route `/api/share-target` yang lebih dulu dibuat tidak pernah terpakai untuk
 * keperluan ini, karena tidak ada yang menunjuk ke sana. Yang ini yang sesuai
 * dengan deklarasi manifest.
 *
 * Isi dan perilakunya sengaja meniru handler di service worker: baca semua
 * field (nama field dari Google Maps bisa berubah antar versi Android),
 * ambil URL pertama yang tampak, lalu redirect ke fragment. Fragment dipakai
 * supaya link tujuan tidak pernah masuk query string maupun access log server.
 *
 * Beda dari SW: halaman diagnostik di sini tidak bisa dibangun tanpa melihat
 * payload-nya, jadi kasus "share diterima tapi link tidak ditemukan" membalas
 * teks pendek.SW menanganinya dengan halaman HTML yang jauh lebih informatif
 * begitu sudah aktif — dan kasus itu hanya terjadi di sini, yaitu tepat sekali
 * saat SW belum aktif.
 */
export async function POST(req: NextRequest) {
  const URL_IN_TEXT = /https?:\/\/[^\s"'<>\u0000-\u001f]+/i;

  let link = '';

  try {
    const fd = await req.formData();
    for (const [, value] of fd.entries()) {
      if (typeof value !== 'string' || !value) continue;
      const m = value.match(URL_IN_TEXT);
      if (m) { link = m[0]; break; }
    }
  } catch {
    // Body tidak terbaca sebagai form data. Coba teks biasa supaya tetap ada
    // kesempatan menangkap link.
    try {
      const raw = await req.text();
      const m = raw.match(URL_IN_TEXT);
      if (m) link = m[0];
    } catch {
      // benar-benar tidak bisa dibaca — biarkan link kosong, balas teks.
    }
  }

  if (link) {
    return NextResponse.redirect(new URL('/#u=' + encodeURIComponent(link), req.url).href, 302);
  }

  return new NextResponse(
    'Share diterima, tapi tidak ada tautan di dalamnya. ' +
    'Buka aplikasi sekali untuk mengaktifkan service worker — setelah itu share ' +
    'akan menampilkan halaman diagnosis yang lengkap.',
    { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } }
  );
}
