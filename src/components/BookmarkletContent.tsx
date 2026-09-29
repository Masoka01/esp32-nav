'use client';
import { useEffect, useRef } from 'react';
import { buildBookmarklet, detectPlatform, BM_HELP } from '@/lib/share';
import { toast } from './Toast';

interface Props {
  onClose: () => void;
}

export function BookmarkletContent({ onClose }: Props) {
  const codeRef = useRef<HTMLTextAreaElement>(null);

  const platform = typeof window !== 'undefined' ? detectPlatform() : 'desktop';
  const bmCode = typeof window !== 'undefined'
    ? buildBookmarklet(window.location.origin)
    : '';

  useEffect(() => {
    if (codeRef.current) {
      codeRef.current.value = bmCode;
      // Auto-resize
      codeRef.current.style.height = 'auto';
      codeRef.current.style.height = codeRef.current.scrollHeight + 'px';
    }
  }, [bmCode]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(bmCode);
      toast('Kode tersalin. Simpan sebagai bookmark "Kirim ke ESP-Nav".');
    } catch {
      codeRef.current?.focus();
      codeRef.current?.select();
      toast('Tekan Ctrl+C untuk menyalin kode yang tersorot.');
    }
  };

  return (
    <div className="drawer-section">
      <h2 className="section-title">Kirim tujuan dari Google Maps</h2>

      {platform === 'ios' ? (
        <div className="bm-alt">
          <p><b>Safari di iOS tidak bisa menjalankan bookmarklet.</b> Apple menghentikan eksekusi JavaScript di address bar maupun di bookmarknya.</p>
          <p>Buka lokasi di <b>Chrome</b> (bukan aplikasi Google Maps), tekan address bar, salin URL panjangnya, lalu tempel ke kotak pencarian di atas.</p>
        </div>
      ) : (
        <>
          <ol className="bm-steps">
            <li>Salin kode di bawah ini.</li>
            <li>Simpan sebagai bookmark bernama <b>Kirim ke ESP-Nav</b>
                {' '}<span className="bm-hint">{BM_HELP[platform].save}</span></li>
            <li>Buka lokasi di Google Maps, lalu <span dangerouslySetInnerHTML={{ __html: BM_HELP[platform].run }} />.</li>
          </ol>
          <textarea
            ref={codeRef}
            className="bm-code"
            readOnly
            rows={3}
            spellCheck={false}
            defaultValue={bmCode}
          />
          {BM_HELP[platform].note && (
            <div className="bm-note">{BM_HELP[platform].note}</div>
          )}
          <div className="bm-actions">
            <button className="primary" onClick={handleCopy}>Salin kode</button>
            <button onClick={onClose}>Tutup</button>
          </div>
        </>
      )}
    </div>
  );
}