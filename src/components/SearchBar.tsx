'use client';
import { useState, useRef, useEffect, useCallback } from 'react';
import type { NominatimResult } from '@/types';
import { toast } from '@/components/Toast';

interface Props {
  onDestination: (lat: number, lng: number, name: string) => void;
  onLocate: () => void;
  onBookmarklet: () => void;
  bookmarkletOpen: boolean;
  mapsConfirm?: { name: string; lat: number; lng: number; exact: boolean } | null;
  onConfirmAccept: () => void;
  onConfirmReject: () => void;
  defaultValue?: string;
}

const geocodeCache = new Map<string, NominatimResult[]>();

export function SearchBar({
  onDestination, onLocate, onBookmarklet, bookmarkletOpen,
  mapsConfirm, onConfirmAccept, onConfirmReject,
  defaultValue = '',
}: Props) {
  const [value, setValue] = useState(defaultValue);
  const [suggestions, setSuggestions] = useState<NominatimResult[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setValue(defaultValue); }, [defaultValue]);

  const fetchSuggestions = useCallback(async (q: string) => {
    if (geocodeCache.has(q)) { setSuggestions(geocodeCache.get(q)!); setShowSuggestions(true); return; }
    try {
      const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=5&countrycodes=id`;
      const res  = await fetch(url, { headers: { 'Accept-Language': 'id' } });
      const data = await res.json();
      geocodeCache.set(q, data);
      setSuggestions(data);
      setShowSuggestions(data.length > 0);
    } catch { toast('Gagal mencari lokasi'); }
  }, []);

  const handleInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const q = e.target.value;
    setValue(q);
    clearTimeout(timerRef.current);
    if (q.length < 3) { setShowSuggestions(false); return; }
    if (geocodeCache.has(q)) { setSuggestions(geocodeCache.get(q)!); setShowSuggestions(true); return; }
    timerRef.current = setTimeout(() => fetchSuggestions(q), 1000);
  };

  const selectSuggestion = (item: NominatimResult) => {
    setValue(item.display_name);
    setShowSuggestions(false);
    onDestination(parseFloat(item.lat), parseFloat(item.lon), item.display_name);
  };

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div className="search-row">
      <div className="search-wrap" ref={wrapRef}>
        <span className="search-icon">🔍</span>
        <input
          type="text"
          className="search-input"
          placeholder="Cari tujuan..."
          autoComplete="off"
          value={value}
          onChange={handleInput}
          onFocus={() => { if (suggestions.length > 0) setShowSuggestions(true); }}
        />

        {showSuggestions && suggestions.length > 0 && (
          <div className="suggestions">
            {suggestions.map((item, i) => (
              <div
                key={i}
                className="suggestion-item"
                onMouseDown={() => selectSuggestion(item)}
              >
                {item.display_name}
              </div>
            ))}
          </div>
        )}

        {mapsConfirm && (
          <div className="maps-confirm">
            <div className="mc-name">{mapsConfirm.name}</div>
            <div className="mc-coord">
              {mapsConfirm.lat.toFixed(6)}, {mapsConfirm.lng.toFixed(6)}
            </div>
            <div className={`mc-tag${mapsConfirm.exact ? '' : ' approx'}`}>
              {mapsConfirm.exact ? 'Koordinat tepat' : 'Koordinat perkiraan'}
            </div>
            <div className="mc-actions">
              <button onClick={onConfirmReject}>Batal</button>
              <button className="primary" onClick={onConfirmAccept}>Gunakan tujuan ini</button>
            </div>
          </div>
        )}
      </div>

      <button className="btn-icon" title="Lokasi saya" onClick={onLocate}>📍</button>
      <button
        className={`btn-icon${bookmarkletOpen ? ' active' : ''}`}
        title="Kirim dari Google Maps"
        onClick={onBookmarklet}
      >
        🔗
      </button>
    </div>
  );
}
