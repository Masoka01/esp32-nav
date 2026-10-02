import type { NominatimResult } from '@/types';
import { state } from './state';

/**
 * Geocoding nama tempat.
 *
 * Dipakai bersama oleh kolom pencarian dan pemroses tautan. Sebelumnya logika
 * ini hanya hidup di dalam SearchBar, sehingga tautan Google Maps yang datang
 * tanpa koordinat tidak punya cara untuk menebak lokasinya.
 *
 * Dua penyedia dipakai berlapis:
 *   - Nominatim (OSM) sebagai utama: bagus untuk alamat dan nama resmi.
 *   - Photon (komoot) sebagai cadangan: pencocokannya lebih toleran terhadap
 *     kata tambahan. Contoh nyata: Nominatim mengembalikan 0 hasil untuk
 *     "Wisata Bukit Kayoe putih", sedangkan Photon menemukan "Bukit Kayoe
 *     Putih" di koordinat yang benar. Tanpa cadangan ini, tautan nama-saja
 *     berakhir di kotak pencarian kosong.
 */

const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const PHOTON = 'https://photon.komoot.io/api';
const TIMEOUT_MS = 6000;

// bbox Indonesia (minLon,minLat,maxLon,maxLat). Dipakai sebagai bias Photon
// saat lokasi user belum diketahui, supaya hasil tidak melompat ke luar negeri.
const ID_BBOX = '95.0,-11.0,141.0,6.0';

/** Hasil geocoding yang sudah siap dipakai peta. */
export interface GeocodeHit {
  lat: number;
  lng: number;
  name: string;
}

const cache = new Map<string, NominatimResult[]>();

/**
 * AbortController dipakai alih-alih AbortSignal.timeout supaya tetap jalan di
 * WebView Android lama, yang belum mengenal AbortSignal.timeout.
 */
function withTimeout(): { signal: AbortSignal; done: () => void } {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  return { signal: ctrl.signal, done: () => clearTimeout(timer) };
}

async function tryNominatim(key: string): Promise<NominatimResult[]> {
  const { signal, done } = withTimeout();
  try {
    const url = `${NOMINATIM}?q=${encodeURIComponent(key)}&format=json&limit=5&countrycodes=id`;
    const res = await fetch(url, {
      headers: { 'Accept-Language': 'id' },
      signal,
    });
    if (!res.ok) throw new Error(`Nominatim membalas ${res.status}`);
    return (await res.json()) as NominatimResult[];
  } finally {
    done();
  }
}

interface PhotonFeature {
  properties: {
    name?: string;
    street?: string;
    housenumber?: string;
    city?: string;
    county?: string;
    state?: string;
    country?: string;
    countrycode?: string;
  };
  geometry: { coordinates: [number, number] };
}

/** Susun label yang enak dibaca dari properti Photon. */
function photonDisplay(p: PhotonFeature['properties']): string {
  const street = p.street ? (p.housenumber ? `${p.street} ${p.housenumber}` : p.street) : '';
  const parts = [p.name, street, p.city, p.state, p.country].filter(Boolean) as string[];
  // Buang duplikat berurutan (mis. name sama dengan city).
  const out: string[] = [];
  for (const part of parts) if (out[out.length - 1] !== part) out.push(part);
  return out.join(', ');
}

async function tryPhoton(key: string): Promise<NominatimResult[]> {
  const { signal, done } = withTimeout();
  try {
    const hasUser = state.userLat != null && state.userLng != null;
    const bias = hasUser
      ? `&lat=${state.userLat}&lon=${state.userLng}`
      : `&bbox=${ID_BBOX}`;
    const url = `${PHOTON}?q=${encodeURIComponent(key)}&limit=5${bias}`;
    const res = await fetch(url, { signal });
    if (!res.ok) throw new Error(`Photon membalas ${res.status}`);
    const data = (await res.json()) as { features?: PhotonFeature[] };
    return (data.features ?? [])
      // Tanpa lokasi user, saring ke Indonesia supaya hasil tidak ngawur.
      .filter((f) => hasUser || f.properties.countrycode === 'ID')
      .map((f) => {
        const [lon, lat] = f.geometry.coordinates;
        return {
          display_name: photonDisplay(f.properties),
          lat: String(lat),
          lon: String(lon),
        };
      });
  } finally {
    done();
  }
}

/**
 * Cari kandidat tempat untuk sebuah nama.
 *
 * Hasil disimpan di cache supaya menekan Enter berulang atau menempel tautan
 * yang sama tidak menghajar geocoder berkali-kali.
 */
export async function searchPlaces(query: string): Promise<NominatimResult[]> {
  const key = query.trim();
  if (!key) return [];

  const cached = cache.get(key);
  if (cached) return cached;

  // `null` berarti Nominatim gagal (bukan sekadar kosong). Perbedaan ini dipakai
  // untuk memutuskan apakah kegagalan total layak dilempar ke UI.
  let data: NominatimResult[] | null = null;
  try {
    data = await tryNominatim(key);
  } catch {
    data = null;
  }

  if (!data || data.length === 0) {
    try {
      const photon = await tryPhoton(key);
      if (photon.length > 0) data = photon;
      else if (data === null) data = [];
    } catch {
      // Photon gagal. Kalau Nominatim juga gagal, baru lempar supaya UI bisa
      // membedakan "tidak ada hasil" dari "gagal jaringan".
      if (data === null) throw new Error('geocoder tidak bisa dihubungi');
    }
  }

  const result = data ?? [];
  cache.set(key, result);
  return result;
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
