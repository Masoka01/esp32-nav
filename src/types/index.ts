export interface RouteStep {
  lat: number;
  lng: number;
  instruction: string;
  icon: string;
  code: number;
  distance: number;
}

export interface AppState {
  userLat: number | null;
  userLng: number | null;
  destLat: number | null;
  destLng: number | null;
  destName: string | null;
  steps: RouteStep[];
  currentStep: number;
  navigating: boolean;
  pendingRestore: StoredTrip | null;
  pendingRoute: { lat: number; lng: number } | null;
  bleDevice: any | null;
  bleChar: any | null;
  wakeLock: WakeLockSentinel | null;
  watchId: number | null;
}

export interface StoredTrip {
  lat: number;
  lng: number;
  name: string | null;
  step: number;
  navigating: boolean;
}

export interface Favorite {
  id: string;
  name: string;
  lat: number;
  lng: number;
  savedAt: number;
}

export interface ParseResult {
  ok: boolean;
  lat?: number;
  lng?: number;
  name?: string;
  exact?: boolean;
  reason?: string;
}

export interface NominatimResult {
  display_name: string;
  lat: string;
  lon: string;
}

export interface BLEStatus {
  state: 'disconnected' | 'connecting' | 'connected';
  deviceName?: string;
}

// Web Bluetooth API declarations
declare global {
  interface Navigator {
    bluetooth: any;
  }
}
