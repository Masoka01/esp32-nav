'use client';
import { useState, useRef, useEffect, useCallback } from 'react';
import type { NominatimResult, BLEStatus } from '@/types';
import { toast } from '@/components/Toast';
import { looksLikeUrl } from '@/lib/resolve';
import { parseCoordinateText } from '@/lib/parse';
import { searchPlaces, peekPlaces } from '@/lib/geocode';

interface Props {
  onDestination: (lat: number, lng: number, name: string) => void;
  /**
   * Dipanggil saat user menekan Enter pada teks yang berupa tautan.
   *
   * Saran geocoding punya jalurnya sendiri — user mengklik salah satu saran —
   * jadi teks tautan tidak pernah sampai ke sana. Tanpa jalur ini, menempel
   * short link lalu menekan Enter benar-benar tidak melakukan apa-apa: tidak
   * ada handler submit sama sekali, dan geocoder hanya diam.
   */
  onSubmitText?: (text: string) => void;
  onLocate: () => void;
  onMenu: () => void;
  bleStatus?: BLEStatus;
  mapsConfirm?: { name: string; lat: number; lng: number; exact: boolean } | null;
  onConfirmAccept: () => void;
  onConfirmReject: () => void;
  defaultValue?: string;
  canClear?: boolean;
  onClear?: () => void;
  /**
   * Permintaan mengisi kotak pencarian dari luar, mis. saat tautan hanya
   * membawa nama tanpa koordinat dan geocoding otomatis gagal. `id` naik tiap
   * permintaan supaya efek tetap terpicu walau query-nya sama.
   */
  prefill?: { query: string; id: number } | null;
}

export function SearchBar({
  onDestination, onLocate, onMenu, bleStatus,
  onSubmitText,
  mapsConfirm, onConfirmAccept, onConfirmReject,
  defaultValue = '',
  canClear = false,
  onClear,
  prefill,
}: Props) {
  const [value, setValue] = useState(defaultValue);
  const [suggestions, setSuggestions] = useState<NominatimResult[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setValue(defaultValue); }, [defaultValue]);

  // Isi kotak dari luar lalu langsung cari saran. Dipakai saat tautan hanya
  // membawa nama tanpa koordinat dan geocoding otomatis gagal.
  useEffect(() => {
    if (!prefill) return;
    // Isi input ditangani lewat defaultValue (halaman menyetel searchValue),
    // jadi efek ini cukup memicu pencarian sarannya saja.
    (async () => {
      try {
        const data = await searchPlaces(prefill.query);
        setSuggestions(data);
        setShowSuggestions(data.length > 0);
        if (data.length === 0) toast('Tidak ada hasil. Coba ubah kata kunci.');
      } catch { toast('Gagal mencari lokasi'); }
    })();
    // Sengaja hanya bergantung pada id: query yang sama harus tetap memicu.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill?.id]);

  const fetchSuggestions = useCallback(async (q: string) => {
    try {
      const data = await searchPlaces(q);
      setSuggestions(data);
      setShowSuggestions(data.length > 0);
    } catch { toast('Gagal mencari lokasi'); }
  }, []);

  const handleInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const q = e.target.value;
    setValue(q);
    clearTimeout(timerRef.current);
    if (q.length < 3) { setShowSuggestions(false); return; }
    // Teks tautan bukan query geocoding. Mengirimnya ke Nominatim tidak pernah
    // menghasilkan saran yang berguna, hanya satu request sia-sia per ketikan.
    if (looksLikeUrl(q.trim()) || parseCoordinateText(q)) { setSuggestions([]); setShowSuggestions(false); return; }
    const cached = peekPlaces(q);
    if (cached) { setSuggestions(cached); setShowSuggestions(true); return; }
    timerRef.current = setTimeout(() => fetchSuggestions(q), 1000);
  };

  const selectSuggestion = (item: NominatimResult) => {
    setValue(item.display_name);
    setShowSuggestions(false);
    onDestination(parseFloat(item.lat), parseFloat(item.lon), item.display_name);
  };

  const handleSubmit = () => {
    const q = value.trim();
    if (!q) return;
    // Tautan: teruskan ke pemroses tautan di halaman, bukan ke geocoder.
    if (looksLikeUrl(q) || parseCoordinateText(q)) { setSuggestions([]); setShowSuggestions(false); onSubmitText?.(q); return; }
    // Teks biasa: Enter memakai saran teratas kalau ada — sama seperti
    // perilaku kolom pencarian peta mana pun. Sebelumnya Enter tidak melakukan
    // apa-apa sama sekali, jadi mengetiknya terasa seperti tombol mati.
    const top = suggestions[0];
    if (showSuggestions && top) selectSuggestion(top);
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
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleSubmit(); } }}
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

      {canClear && onClear && (
        <button
          className="btn-icon btn-clear"
          title="Hapus tujuan dan rute"
          aria-label="Hapus tujuan dan rute"
          onClick={onClear}
        >
          🗑
        </button>
      )}
      <button className="btn-icon" title="Lokasi saya" onClick={onLocate}>📍</button>
      <button className="btn-icon" title="Menu" onClick={onMenu}>
        ☰
        {bleStatus && (
          <span className={`menu-ble-dot${bleStatus.state === 'connected' ? ' connected' : bleStatus.state === 'connecting' ? ' connecting' : ''}`} />
        )}
      </button>
    </div>
  );
}
