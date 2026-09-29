import type { StoredTrip, VehicleType } from '@/types';
import { validLatLng } from './parse';

const TRIP_KEY = 'esp32nav.trip';
const PREFS_KEY = 'esp32nav.vehiclePrefs';

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

export interface VehiclePrefs {
  vehicle: VehicleType;
  avoidTolls: boolean;
  avoidHighways: boolean;
}

// Preferensi kendaraan bertahan antar sesi, jadi localStorage (bukan sessionStorage seperti trip)
export function saveVehiclePrefs(prefs: VehiclePrefs): void {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* abaikan */ }
}

export function loadVehiclePrefs(): Partial<VehiclePrefs> {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return {};
    const p = JSON.parse(raw) as Partial<VehiclePrefs>;
    if (!p || typeof p !== 'object') return {};
    // hanya terima nilai yang valid, selain itu pakai default
    const out: Partial<VehiclePrefs> = {};
    if (p.vehicle === 'car' || p.vehicle === 'motor') out.vehicle = p.vehicle;
    if (typeof p.avoidTolls === 'boolean')   out.avoidTolls = p.avoidTolls;
    if (typeof p.avoidHighways === 'boolean') out.avoidHighways = p.avoidHighways;
    return out;
  } catch { return {}; }
}
