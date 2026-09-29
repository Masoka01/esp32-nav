'use client';

import { useEffect } from 'react';

/**
 * Daftarkan service worker.
 *
 * Harus jalan di client: SW tidak ada di server, dan panggilannya hanya bermakna
 * setelah document siap. Dipisah dari layout karena layout adalah Server
 * Component, dan `useEffect` tidak boleh dipakai di sana.
 *
 * Sengaja tidak pakai next-pwa. SW-nya ditulis tangan (public/sw.js) karena
 * aturannya spesifik dan tidak sesuai bawaan: /api/* tidak boleh di-cache,
 * prefetch RSC harus dilewati, dan share target harus ditangkap sebelum
 * menyentuh network. Preset bawaan next-pwa tidak menyatakan hal itu, dan yang lebih
 * berbahaya: ia membungkus build output sehingga pembaruan bisa tertahan di HP
 * — persis gejala yang dulu membuat PWA lama terlihat "basi" setelah deploy.
 */
export function SWRegister() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    // Hanya produksi: di dev, SW akan menahan modul dan membuat HMR tampak
    // macet. SW build produksi tidak kompatibel dengan aset dev.
    if (process.env.NODE_ENV !== 'production') return;

    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
      // Kegagalan registrasi bukan alasan membatalkan render — aplikasi tetap
      // berfungsi online, hanya kehilangan kemampuan install dan offline.
    });
  }, []);

  return null;
}
