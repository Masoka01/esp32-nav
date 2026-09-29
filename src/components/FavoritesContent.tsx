'use client';
import { useState } from 'react';
import type { Favorite } from '@/types';

interface Props {
  favorites: Favorite[];
  loading: boolean;
  currentDestName?: string | null;
  currentDestLat?: number | null;
  currentDestLng?: number | null;
  onSelect: (lat: number, lng: number, name: string) => void;
  onSave: (name: string, lat: number, lng: number) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onClose: () => void;
}

export function FavoritesContent({
  favorites,
  loading,
  currentDestName,
  currentDestLat,
  currentDestLng,
  onSelect,
  onSave,
  onDelete,
  onClose,
}: Props) {
  const [saving, setSaving] = useState(false);

  const canSave = !!(currentDestLat && currentDestLng && currentDestName);

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      await onSave(currentDestName!, currentDestLat!, currentDestLng!);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="drawer-section">
      <div className="section-header">
        <h2 className="section-title">Favorit</h2>
        {canSave && (
          <button className="btn-save-fav" onClick={handleSave} disabled={saving}>
            {saving ? '...' : '+ Simpan tujuan ini'}
          </button>
        )}
      </div>

      {loading && <div className="section-empty">Memuat...</div>}

      {!loading && favorites.length === 0 && (
        <div className="section-empty">Belum ada favorit tersimpan.</div>
      )}

      {!loading && favorites.map((fav) => (
        <div key={fav.id} className="fav-item">
          <button
            className="fav-name"
            onClick={() => {
              onSelect(fav.lat, fav.lng, fav.name);
              onClose();
            }}
          >
            <span className="fav-icon">📍</span>
            {fav.name}
          </button>
          <button
            className="fav-del"
            onClick={() => onDelete(fav.id)}
            title="Hapus"
            aria-label={`Hapus ${fav.name}`}
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}