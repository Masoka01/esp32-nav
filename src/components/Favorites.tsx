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
}

export function Favorites({
  favorites, loading,
  currentDestName, currentDestLat, currentDestLng,
  onSelect, onSave, onDelete,
}: Props) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const canSave = !!(currentDestLat && currentDestLng && currentDestName);

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      await onSave(currentDestName!, currentDestLat!, currentDestLng!);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="favorites-wrap">
      <button
        className={`btn-fav${open ? ' active' : ''}`}
        onClick={() => setOpen(o => !o)}
        title="Favorit"
      >
        ⭐
      </button>

      {open && (
        <div className="fav-panel">
          <div className="fav-header">
            <span className="fav-title">Favorit</span>
            {canSave && (
              <button className="btn-save-fav" onClick={handleSave} disabled={saving}>
                {saving ? '...' : '+ Simpan tujuan ini'}
              </button>
            )}
          </div>

          {loading && <div className="fav-empty">Memuat...</div>}

          {!loading && favorites.length === 0 && (
            <div className="fav-empty">Belum ada favorit tersimpan.</div>
          )}

          {!loading && favorites.map(fav => (
            <div key={fav.id} className="fav-item">
              <button className="fav-name" onClick={() => { onSelect(fav.lat, fav.lng, fav.name); setOpen(false); }}>
                <span className="fav-icon">📍</span>
                {fav.name}
              </button>
              <button className="fav-del" onClick={() => onDelete(fav.id)} title="Hapus">✕</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
