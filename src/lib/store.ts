import type { StoredTrip } from '@/types';
import { validLatLng } from './parse';

const TRIP_KEY = 'esp32nav.trip';

export function saveTrip(trip: StoredTrip): void {
  try {
    sessionStorage.setItem(TRIP_KEY, JSON.stringify(trip));
  } catch { /* storage penuh / private mode */ }
}

export function loadTrip(): StoredTrip | null {
  try {
    const raw = sessionStorage.getItem(TRIP_KEY);
    if (!raw) return null;
    const t = JSON.parse(raw) as StoredTrip;
    if (!t || !validLatLng(t.lat, t.lng)) { clearStoredTrip(); return null; }
    return t;
  } catch { return null; }
}

export function clearStoredTrip(): void {
  try { sessionStorage.removeItem(TRIP_KEY); } catch { /* abaikan */ }
}
