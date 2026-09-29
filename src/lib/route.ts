import type { RouteStep, VehicleType } from '@/types';

export function cleanInstruction(type: string, modifier: string, name: string): string {
  const road = name && name !== '' ? ` ke ${name}` : '';
  if (type === 'depart') return `Mulai perjalanan${road}`;
  if (type === 'arrive') return 'Anda telah tiba di tujuan';
  if (type === 'turn') {
    if (modifier === 'left')         return `Belok kiri${road}`;
    if (modifier === 'right')        return `Belok kanan${road}`;
    if (modifier === 'slight left')  return `Sedikit belok kiri${road}`;
    if (modifier === 'slight right') return `Sedikit belok kanan${road}`;
    if (modifier === 'sharp left')   return `Belok tajam kiri${road}`;
    if (modifier === 'sharp right')  return `Belok tajam kanan${road}`;
    if (modifier === 'uturn')        return `Putar balik${road}`;
  }
  if (type === 'roundabout') return `Masuk bundaran${road}`;
  if (type === 'merge')      return `Gabung ke jalan${road}`;
  if (type === 'fork') {
    if (modifier === 'left')  return `Ambil kiri di persimpangan${road}`;
    if (modifier === 'right') return `Ambil kanan di persimpangan${road}`;
  }
  return `Lanjutkan${road}`;
}

export function maneuverIcon(type: string, modifier: string): string {
  if (type === 'depart') return '🚦';
  if (type === 'arrive') return '🏁';
  if (type === 'roundabout') return '🔄';
  if (modifier === 'left' || modifier === 'sharp left') return '⬅️';
  if (modifier === 'right' || modifier === 'sharp right') return '➡️';
  if (modifier === 'slight left') return '↖️';
  if (modifier === 'slight right') return '↗️';
  if (modifier === 'uturn') return '↩️';
  return '⬆️';
}

export function maneuverCode(type: string, modifier: string): number {
  if (type === 'depart')    return 0;
  if (type === 'arrive')    return 11;
  if (type === 'roundabout' || type === 'rotary' ||
      type === 'roundabout turn' || type === 'exit roundabout' ||
      type === 'exit rotary') return 9;
  if (type === 'merge' || type === 'on ramp' || type === 'off ramp') return 10;
  if (modifier === 'uturn')         return 5;
  if (modifier === 'slight left')   return 2;
  if (modifier === 'left')          return 3;
  if (modifier === 'sharp left')    return 4;
  if (modifier === 'slight right')  return 6;
  if (modifier === 'right')         return 7;
  if (modifier === 'sharp right')   return 8;
  if (type === 'continue' || type === 'new name' || type === 'end of road') return 1;
  return 12;
}

// Peta maneuvers numerik Valhalla ke kosakata OSRM, supaya cleanInstruction/maneuverCode
// yang sudah ada bisa dipakai ulang. Kode maneuver ke ESP32 jadi tidak berubah sama sekali.
const VALHALLA_MANEUVER: Record<number, { type: string; modifier: string }> = {
  1:  { type: 'depart',           modifier: '' },
  2:  { type: 'depart',           modifier: 'right' },
  3:  { type: 'depart',           modifier: 'left' },
  4:  { type: 'arrive',           modifier: '' },
  5:  { type: 'arrive',           modifier: 'right' },
  6:  { type: 'arrive',           modifier: 'left' },
  7:  { type: 'continue',         modifier: '' },
  8:  { type: 'continue',         modifier: '' },
  9:  { type: 'turn',             modifier: 'slight right' },
  10: { type: 'turn',             modifier: 'right' },
  11: { type: 'turn',             modifier: 'sharp right' },
  12: { type: 'turn',             modifier: 'uturn' },
  13: { type: 'turn',             modifier: 'uturn' },
  14: { type: 'turn',             modifier: 'sharp left' },
  15: { type: 'turn',             modifier: 'left' },
  16: { type: 'turn',             modifier: 'slight left' },
  17: { type: 'merge',            modifier: '' },
  18: { type: 'fork',             modifier: 'right' },
  19: { type: 'fork',             modifier: 'left' },
  20: { type: 'fork',             modifier: 'right' },
  21: { type: 'fork',             modifier: 'left' },
  22: { type: 'continue',         modifier: '' },
  23: { type: 'fork',             modifier: 'right' },
  24: { type: 'fork',             modifier: 'left' },
  25: { type: 'merge',            modifier: '' },
  26: { type: 'roundabout',       modifier: '' },
  27: { type: 'exit roundabout', modifier: '' },
  28: { type: 'merge',            modifier: '' },
  29: { type: 'merge',            modifier: '' },
  37: { type: 'merge',            modifier: '' },
  38: { type: 'merge',            modifier: '' },
  // sisanya (transit, elevator, tangga, dan apa pun yang belum dikenal) dianggap lanjut jalan
};

const DEFAULT_MANEUVER = { type: 'continue', modifier: '' };

/** Ambil nama jalan dari instruction English Valhalla. Best-effort, boleh kosong. */
function extractStreet(instruction: string): string {
  if (!instruction) return '';
  const m = instruction.match(/\b(?:onto|on|in)\s+((?:Jalan|Jl\.?|Jl)\s+.+)$/i)
         || instruction.match(/\b(?:onto|on)\s+([^.,]+?)(?:\s+at\s+the end)?\.?$/i);
  if (!m) return '';
  const name = m[1].trim().replace(/\.$/, '');
  // buang yang terlalu panjang atau kelihatan bukan nama jalan
  if (name.length < 2 || name.length > 60) return '';
  return name;
}

export interface RouteOptions {
  vehicle: VehicleType;
  avoidTolls: boolean;
  avoidHighways: boolean;
}

export function costingFor(vehicle: VehicleType): 'auto' | 'motorcycle' {
  return vehicle === 'motor' ? 'motorcycle' : 'auto';
}

/** Decode polyline Valhalla (precision 6). Hasil berurutan [lat, lon]. */
export function decodePolyline(shape: string, precision = 6): [number, number][] {
  const out: [number, number][] = [];
  if (!shape) return out;
  const factor = Math.pow(10, precision);
  let i = 0, lat = 0, lon = 0;
  while (i < shape.length) {
    let shift = 0, result = 0, b: number;
    do {
      if (i >= shape.length) return out;
      b = shape.charCodeAt(i++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lat += (result & 1) ? ~(result >> 1) : (result >> 1);

    shift = 0; result = 0;
    do {
      if (i >= shape.length) return out;
      b = shape.charCodeAt(i++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lon += (result & 1) ? ~(result >> 1) : (result >> 1);

    out.push([lat / factor, lon / factor]);
  }
  return out;
}

export function buildValhallaSteps(maneuvers: any[], latlngs: [number, number][]): RouteStep[] {
  return maneuvers.map((m) => {
    const mv = VALHALLA_MANEUVER[m.type] ?? DEFAULT_MANEUVER;
    const name = extractStreet(m.instruction ?? '');
    // Valhalla tidak punya maneuver.location, jadi koordinat diambil dari polyline.
    // Indeks di luar jangkauan dijepit ke titik terdekat, bukan jadi 0,0 (Null Island).
    const idx = Math.min(Math.max(m.begin_shape_index ?? 0, 0), latlngs.length - 1);
    const [lat, lng] = latlngs[idx] ?? [0, 0];
    return {
      lat, lng,
      instruction: cleanInstruction(mv.type, mv.modifier, name),
      icon: maneuverIcon(mv.type, mv.modifier),
      code: maneuverCode(mv.type, mv.modifier),
      distance: (m.length ?? 0) * 1000, // Valhalla satuan km -> meter, biar formatDist tetap jalan
    };
  });
}

export async function fetchRoute(
  oLat: number, oLng: number,
  dLat: number, dLng: number,
  opts: RouteOptions,
): Promise<{ steps: RouteStep[]; coords: [number, number][]; distance: number; duration: number } | null> {
  const costing = costingFor(opts.vehicle);
  // hanya kirim opsi yang aktif; Valhalla diam-diam mengabaikan nama opsi yang tidak dikenal
  const costingOptions: Record<string, number> = {};
  if (opts.avoidTolls)     costingOptions.use_tolls = 0;
  if (opts.avoidHighways)  costingOptions.use_highways = 0;

  const body: Record<string, unknown> = {
    locations: [{ lat: oLat, lon: oLng }, { lat: dLat, lon: dLng }],
    costing,
    directions_options: { units: 'kilometers' },
  };
  if (Object.keys(costingOptions).length > 0) {
    // bentuk bersarang wajib; bentuk datar/legacy diabaikan oleh server
    body.costing_options = { [costing]: costingOptions };
  }

  const url = `https://valhalla1.openstreetmap.de/route?json=${encodeURIComponent(JSON.stringify(body))}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.error || data.error_code || !data.trip) return null;

  const leg = data.trip.legs?.[0];
  if (!leg?.shape) return null;
  const latlngs = decodePolyline(leg.shape, 6);
  if (!latlngs.length) return null;

  return {
    steps: buildValhallaSteps(leg.maneuvers ?? [], latlngs),
    // Map.tsx mengandaikan [lng, lat] lalu menukarnya sendiri untuk Leaflet
    coords: latlngs.map(([lat, lon]) => [lon, lat]),
    distance: data.trip.summary.length * 1000, // km -> meter
    duration: data.trip.summary.time,
  };
}

export function formatDist(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}

export function formatDur(s: number): string {
  const m = Math.round(s / 60);
  return m >= 60 ? `${Math.floor(m / 60)} jam ${m % 60} mnt` : `${m} mnt`;
}

export function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
