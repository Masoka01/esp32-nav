import type { NominatimResult } from '@/types';

/**
 * Geocoding nama tempat lewat Nominatim.
 *
 * Dipakai bersama oleh kolom pencarian dan pemroses tautan. Sebelumnya logika
 * ini hanya hidup di dalam SearchBar, sehingga tautan Google Maps yang datang
 * tanpa koordinat tidak punya cara untuk menebak lokasinya.
 */

const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const TIMEOUT_MS = 6000;

/** Hasil geocoding yang sudah siap dipakai peta. */
export interface GeocodeHit {
  lat: number;
  lng: number;
  name: string;
}

const cache = new Map<string, NominatimResult[]>();

/**
 * Cari kandidat tempat untuk sebuah nama.
 *
 * Hasil disimpan di cache supaya menekan Enter berulang atau menempel tautan
 * yang sama tidak menghajar Nominatim berkali-kali.
 */
export async function searchPlaces(query: string): Promise<NominatimResult[]> {
  const key = query.trim();
  if (!key) return [];

  const cached = cache.get(key);
  if (cached) return cached;

  // AbortController dipakai alih-alih AbortSignal.timeout supaya tetap jalan
  // di WebView Android lama, yang belum mengenal AbortSignal.timeout.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const url = `${NOMINATIM}?q=${encodeURIComponent(key)}&format=json&limit=5&countrycodes=id`;
    const res = await fetch(url, {
      headers: { 'Accept-Language': 'id' },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`Nominatim membalas ${res.status}`);
    const data = (await res.json()) as NominatimResult[];
    cache.set(key, data);
    return data;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Ambil hasil cache tanpa memicu request baru.
 *
 * Dipakai kolom pencarian untuk menampilkan saran yang sudah pernah diambil
 * secara instan, tanpa menunggu jeda debounce.
 */
export function peekPlaces(query: string): NominatimResult[] | undefined {
  return cache.get(query.trim());
}

/**
 * Tebak koordinat dari nama tempat.
 *
 * Mengembalikan null kalau tidak ada kandidat atau koordinatnya tidak valid.
 * Pemanggil wajib menandai hasilnya sebagai perkiraan: nama yang sama bisa
 * menunjuk ke beberapa tempat berbeda.
 */
export async function geocodeName(name: string): Promise<GeocodeHit | null> {
  const hits = await searchPlaces(name);
  const first = hits[0];
  if (!first) return null;

  const lat = parseFloat(first.lat);
  const lng = parseFloat(first.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  return { lat, lng, name: first.display_name };
}
