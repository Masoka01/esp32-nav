'use client';

import { useEffect } from 'react';

/**
 * Daftarkan service worker dan jaga agar PWA tidak "basi".
 *
 * Kenapa perlu penjagaan versi
 * ----------------------------
 * PWA yang sudah terbuka lama tidak pernah memuat ulang saat menerima share
 * dari Google Maps: Android hanya memunculkannya ke depan lewat perubahan hash
 * (navigasi same-document), jadi bundle lama tetap yang jalan. Akibatnya
 * perbaikan yang sudah di-deploy tidak terlihat di HP, padahal di PC (yang
 * selalu memuat segar) jalan. Itu persis gejala "bisa di PC, gagal di HP".
 *
 * Dua lapis penjagaan:
 *   1. `registration.update()` tiap kali app terlihat/di-fokus, supaya SW baru
 *      (mis. setelah VERSION di sw.js naik) cepat terpasang.
 *   2. Bandingkan build-id bundle dengan /api/version. Kalau beda, muat ulang.
 *      Ini menangkap kasus di mana sw.js sendiri tidak berubah antar deploy.
 *
 * Reload dijaga agar tidak berulang: sekali per build-id per sesi, dan
 * `controllerchange` hanya memicu reload kalau sebelumnya sudah ada controller
 * (bukan saat instalasi pertama).
 */
export function SWRegister() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    // Hanya produksi: di dev, SW akan menahan modul dan membuat HMR tampak
    // macet. SW build produksi tidak kompatibel dengan aset dev.
    if (process.env.NODE_ENV !== 'production') return;

    const BUILD_ID = process.env.NEXT_PUBLIC_BUILD_ID ?? 'dev';
    const RELOAD_KEY = 'esp32nav-build';
    let refreshing = false;
    let hadController = !!navigator.serviceWorker.controller;
    let reg: ServiceWorkerRegistration | null = null;

    const reloadOnce = () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    };

    const checkBuildId = async () => {
      if (BUILD_ID === 'dev') return;
      try {
        const res = await fetch('/api/version', { cache: 'no-store' });
        if (!res.ok) return;
        const body = (await res.json()) as { buildId?: string };
        if (!body.buildId || body.buildId === BUILD_ID) return;
        // Server melayani build lain. Muat ulang, tapi hanya sekali per build
        // supaya tidak ada loop kalau build-id tidak pernah cocok.
        if (sessionStorage.getItem(RELOAD_KEY) === body.buildId) return;
        sessionStorage.setItem(RELOAD_KEY, body.buildId);
        reloadOnce();
      } catch {
        // Offline atau endpoint tidak tersedia: bukan alasan mengganggu user.
      }
    };

    const checkUpdate = () => {
      reg?.update().catch(() => {});
      void checkBuildId();
    };

    const onVisible = () => {
      if (document.visibilityState === 'visible') checkUpdate();
    };

    const onControllerChange = () => {
      // Controller berganti = SW baru mengambil alih. Muat ulang agar bundle
      // baru dipakai, tapi jangan saat instalasi pertama (belum ada controller).
      if (hadController) reloadOnce();
      hadController = true;
    };

    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', checkUpdate);

    navigator.serviceWorker
      .register('/sw.js', { scope: '/', updateViaCache: 'none' })
      .then((r) => {
        reg = r;
        // Cek sekali saat load, jaga-jaga kalau app dibuka dari share.
        checkUpdate();
      })
      .catch(() => {
        // Kegagalan registrasi bukan alasan membatalkan render — aplikasi tetap
        // berfungsi online, hanya kehilangan kemampuan install dan offline.
      });

    return () => {
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', checkUpdate);
    };
  }, []);

  return null;
}
