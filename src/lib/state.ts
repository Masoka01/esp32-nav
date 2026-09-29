import type { AppState } from '@/types';

export const SERVICE_UUID = '6e400001-b5b3-f393-e0a9-e50e24dcca9e';
export const CHAR_UUID    = '6e400002-b5b3-f393-e0a9-e50e24dcca9e';

export const state: AppState = {
  userLat: null, userLng: null,
  destLat: null, destLng: null,
  destName: null,
  steps: [],
  currentStep: 0,
  navigating: false,
  pendingRestore: null,
  pendingRoute: null,
  bleDevice: null,
  bleChar: null,
  wakeLock: null,
  watchId: null,
};
