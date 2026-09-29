'use client';
import type { VehicleType } from '@/types';

export interface VehicleSectionProps {
  vehicle: VehicleType;
  onChangeVehicle: (v: VehicleType) => void;
  avoidTolls: boolean;
  onChangeAvoidTolls: (v: boolean) => void;
  avoidHighways: boolean;
  onChangeAvoidHighways: (v: boolean) => void;
  canReRoute: boolean;
}

const VEHICLES: { id: VehicleType; icon: string; label: string }[] = [
  { id: 'motor', icon: '🏍️', label: 'Motor' },
  { id: 'car',   icon: '🚗', label: 'Mobil' },
];

export function VehicleSection({
  vehicle,
  onChangeVehicle,
  avoidTolls,
  onChangeAvoidTolls,
  avoidHighways,
  onChangeAvoidHighways,
  canReRoute,
}: VehicleSectionProps) {
  return (
    <div className="drawer-section">
      <div>
        <div className="section-title">Kendaraan</div>
        <p className="veh-hint">
          Rute dihitung sesuai kendaraan. Motor lebih dulu menghindari jalan tol.
        </p>
      </div>

      <div className="veh-choice" role="radiogroup" aria-label="Pilih kendaraan">
        {VEHICLES.map((v) => (
          <button
            key={v.id}
            type="button"
            role="radio"
            aria-checked={vehicle === v.id}
            className={`veh-choice-btn${vehicle === v.id ? ' active' : ''}`}
            onClick={() => onChangeVehicle(v.id)}
          >
            <span className="veh-choice-icon" aria-hidden="true">{v.icon}</span>
            <span className="veh-choice-label">{v.label}</span>
            {v.id === 'motor' && <span className="veh-choice-badge">Disarankan</span>}
          </button>
        ))}
      </div>

      <div className="veh-options">
        <label className="veh-check">
          <input
            type="checkbox"
            checked={avoidTolls}
            onChange={(e) => onChangeAvoidTolls(e.target.checked)}
          />
          <span>Hindari tol</span>
        </label>
        <label className="veh-check">
          <input
            type="checkbox"
            checked={avoidHighways}
            onChange={(e) => onChangeAvoidHighways(e.target.checked)}
          />
          <span>Hindari jalan tol/motorway</span>
        </label>
        <p className="veh-note">
          Menghindari tol membuat rute lebih jauh tapi tidak lewat jalan berbayar.
          Jalan sempit tetap boleh dilalui.
        </p>
        {canReRoute && (
          <p className="veh-note veh-note-live">Rute dihitung ulang…</p>
        )}
      </div>
    </div>
  );
}
