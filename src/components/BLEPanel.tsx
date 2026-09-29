'use client';
import type { BLEStatus } from '@/types';

interface Props {
  status: BLEStatus;
  onToggle: () => void;
}

export function BLEPanel({ status, onToggle }: Props) {
  const dotClass = status.state === 'connected'
    ? 'ble-dot connected'
    : status.state === 'connecting'
      ? 'ble-dot connecting'
      : 'ble-dot';

  const label = status.state === 'connected'
    ? `Terhubung: ${status.deviceName}`
    : status.state === 'connecting'
      ? 'Menghubungkan...'
      : 'ESP32 belum terhubung';

  const btnText = status.state === 'connected'
    ? 'Putuskan'
    : status.state === 'connecting'
      ? 'Batal'
      : 'Hubungkan';

  return (
    <div className="ble-bar">
      <div className={dotClass} />
      <span className="ble-label">{label}</span>
      <button
        className={`btn-ble${status.state === 'connected' ? ' connected' : ''}`}
        onClick={onToggle}
      >
        {btnText}
      </button>
    </div>
  );
}
