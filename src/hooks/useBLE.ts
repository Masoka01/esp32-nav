'use client';
import { useState, useCallback } from 'react';
import { connectBLE } from '@/lib/ble';
import type { BLEStatus } from '@/types';

export function useBLE(onToast: (msg: string) => void) {
  const [bleStatus, setBleStatus] = useState<BLEStatus>({ state: 'disconnected' });

  const handleStatus = useCallback((
    status: 'connecting' | 'connected' | 'disconnected',
    name?: string,
  ) => {
    setBleStatus({ state: status, deviceName: name });
  }, []);

  const toggle = useCallback(() => {
    connectBLE(handleStatus, onToast);
  }, [handleStatus, onToast]);

  return { bleStatus, toggle };
}
