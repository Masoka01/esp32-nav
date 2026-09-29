import type { RouteStep } from '@/types';

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

export function parseSteps(rawSteps: any[]): RouteStep[] {
  return rawSteps.map(s => {
    const loc = s.maneuver.location;
    return {
      lat: loc[1], lng: loc[0],
      instruction: cleanInstruction(s.maneuver.type, s.maneuver.modifier, s.name),
      icon: maneuverIcon(s.maneuver.type, s.maneuver.modifier),
      code: maneuverCode(s.maneuver.type, s.maneuver.modifier),
      distance: s.distance,
    };
  });
}

export async function fetchRoute(
  oLat: number, oLng: number,
  dLat: number, dLng: number,
): Promise<{ steps: RouteStep[]; coords: [number, number][]; distance: number; duration: number } | null> {
  const url = `https://router.project-osrm.org/route/v1/driving/${oLng},${oLat};${dLng},${dLat}?steps=true&geometries=geojson&overview=full&annotations=false`;
  const res  = await fetch(url);
  const data = await res.json();
  if (data.code !== 'Ok') return null;
  const route = data.routes[0];
  return {
    steps: parseSteps(route.legs[0].steps),
    coords: route.geometry.coordinates,
    distance: route.distance,
    duration: route.duration,
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
