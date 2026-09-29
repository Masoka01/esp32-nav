'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import dynamic from 'next/dynamic';
import type { MapHandle } from '@/components/Map';
import { Instruction } from '@/components/Instruction';
import { NavControls } from '@/components/NavControls';
import { SearchBar } from '@/components/SearchBar';
import { Drawer } from '@/components/Drawer';
import { FavoritesContent } from '@/components/FavoritesContent';
import { BookmarkletContent } from '@/components/BookmarkletContent';
import { Toast, toast } from '@/components/Toast';
import { useBLE } from '@/hooks/useBLE';
import { useFavorites } from '@/hooks/useFavorites';
import { state } from '@/lib/state';
import { fetchRoute, formatDist, formatDur, haversine } from '@/lib/route';
import { saveTrip, loadTrip, clearStoredTrip, loadVehiclePrefs, saveVehiclePrefs } from '@/lib/store';
import { sendToBLE } from '@/lib/ble';
import { requestWakeLock, releaseWakeLock } from '@/lib/wake';
import { parseMapsLink } from '@/lib/parse';
import { resolveShortLink, looksLikeUrl, ResolveError } from '@/lib/resolve';
import { readIncomingLink, cleanIncomingLink } from '@/lib/share';
import type { RouteStep, VehicleType } from '@/types';

const MapComponent = dynamic(
  () => import('@/components/Map').then(m => m.Map),
  { ssr: false },
);

export default function Home() {
  const mapRef = useRef<MapHandle>(null);

  const [steps, setSteps]             = useState<RouteStep[]>([]);
  const [currentStep, setCurrentStep] = useState(0);
  const [navigating, setNavigating]   = useState(false);
  const [destName, setDestName]       = useState<string | null>(null);
  const [routeInfo, setRouteInfo]     = useState<{ dist: string; dur: string } | null>(null);
  const [awakeNote, setAwakeNote]     = useState('');
  const [awakeWarn, setAwakeWarn]     = useState(false);
  const [searchValue, setSearchValue] = useState('');
  const [drawerOpen, setDrawerOpen]   = useState(false);
  const [mapsConfirm, setMapsConfirm] = useState<{ name: string; lat: number; lng: number; exact: boolean } | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<{ lat: number; lng: number; name: string } | null>(null);
  const [vehicle, setVehicle]                 = useState<VehicleType>(state.vehicle);
  const [avoidTolls, setAvoidTolls]           = useState(state.avoidTolls);
  const [avoidHighways, setAvoidHighways]     = useState(state.avoidHighways);

  const { bleStatus, toggle: toggleBLE } = useBLE(toast);
  const { favorites, loading: favLoading, add: addFav, remove: removeFav } = useFavorites();

  const setNote = useCallback((msg: string, warn = false) => {
    setAwakeNote(msg);
    setAwakeWarn(warn);
  }, []);

  const calcRoute = useCallback(async () => {
    if (!state.userLat || !state.destLat) return;
    try {
      const result = await fetchRoute(state.userLat, state.userLng!, state.destLat, state.destLng!, {
        vehicle: state.vehicle,
        avoidTolls: state.avoidTolls,
        avoidHighways: state.avoidHighways,
      });
      if (!result) { toast('Rute tidak ditemukan'); return; }
      setSteps(result.steps);
      state.steps = result.steps;
      setCurrentStep(0);
      state.currentStep = 0;
      setRouteInfo({ dist: `📏 ${formatDist(result.distance)}`, dur: `⏱ ${formatDur(result.duration)}` });
      mapRef.current?.drawRoute(result.coords);
      mapRef.current?.fitRoute(result.coords);
    } catch { toast('Gagal mengambil rute'); }
  }, []);

  // Perubahan kendaraan/preferensi disimpan, lalu rute dihitung ulang otomatis
  const changeVehiclePrefs = useCallback((patch: Partial<{
    vehicle: VehicleType; avoidTolls: boolean; avoidHighways: boolean;
  }>) => {
    if (patch.vehicle !== undefined)     { state.vehicle = patch.vehicle; setVehicle(patch.vehicle); }
    if (patch.avoidTolls !== undefined)  { state.avoidTolls = patch.avoidTolls; setAvoidTolls(patch.avoidTolls); }
    if (patch.avoidHighways !== undefined) { state.avoidHighways = patch.avoidHighways; setAvoidHighways(patch.avoidHighways); }
    saveVehiclePrefs({ vehicle: state.vehicle, avoidTolls: state.avoidTolls, avoidHighways: state.avoidHighways });
    // hanya hitung ulang kalau sudah ada titik asal dan tujuan
    if (state.userLat && state.destLat) calcRoute();
  }, [calcRoute]);

  const selectDestination = useCallback(async (lat: number, lng: number, name: string) => {
    state.destLat = lat; state.destLng = lng; state.destName = name;
    state.currentStep = 0; state.pendingRestore = null; state.pendingRoute = null;
    setDestName(name); setSearchValue(name); setCurrentStep(0);
    setNavigating(false); state.navigating = false;
    saveTrip({ lat, lng, name, step: 0, navigating: false });
    mapRef.current?.setDestMarker(lat, lng);
    if (!state.userLat) { state.pendingRoute = { lat, lng }; toast('Menunggu GPS...'); return; }
    await calcRoute();
  }, [calcRoute]);

  const checkStepProgress = useCallback((lat: number, lng: number) => {
    const step = state.steps[state.currentStep];
    if (!step) return;
    if (haversine(lat, lng, step.lat, step.lng) < 25) {
      const next = state.currentStep + 1;
      if (next >= state.steps.length) {
        setNavigating(false); state.navigating = false;
        releaseWakeLock(setNote);
        toast('🏁 Anda telah tiba!');
        sendToBLE(11, 'Anda telah tiba di tujuan', -1);
        return;
      }
      state.currentStep = next; setCurrentStep(next);
      saveTrip({ lat: state.destLat!, lng: state.destLng!, name: state.destName, step: next, navigating: true });
      const s = state.steps[next];
      if (s) sendToBLE(s.code, s.instruction, s.distance);
    }
  }, [setNote]);

  const setUserPos = useCallback((lat: number, lng: number) => {
    state.userLat = lat; state.userLng = lng;
    mapRef.current?.setUserMarker(lat, lng);
    if (state.pendingRestore) {
      const t = state.pendingRestore; state.pendingRestore = null;
      calcRoute().then(() => {
        if (state.steps.length) {
          const step = Math.min(t.step || 0, state.steps.length - 1);
          setCurrentStep(step); state.currentStep = step;
          if (t.navigating) { setNavigating(true); state.navigating = true; }
        }
      });
      return;
    }
    if (state.pendingRoute) { state.pendingRoute = null; calcRoute(); return; }
    if (state.navigating) checkStepProgress(lat, lng);
  }, [calcRoute, checkStepProgress]);

  const locateMe = useCallback(() => {
    if (!navigator.geolocation) { toast('GPS tidak tersedia'); return; }
    navigator.geolocation.getCurrentPosition(
      pos => { setUserPos(pos.coords.latitude, pos.coords.longitude); mapRef.current?.setView(pos.coords.latitude, pos.coords.longitude, 15); },
      () => toast('Tidak bisa mendapatkan lokasi'),
    );
  }, [setUserPos]);

  const startNavigation = useCallback(() => {
    if (!steps.length) { toast('Cari tujuan dulu'); return; }
    state.navigating = true; state.currentStep = 0;
    setNavigating(true); setCurrentStep(0);
    saveTrip({ lat: state.destLat!, lng: state.destLng!, name: state.destName, step: 0, navigating: true });
    const first = steps[0];
    if (first) sendToBLE(first.code, first.instruction, first.distance);
    requestWakeLock(setNote);
    if (!state.watchId) {
      state.watchId = navigator.geolocation.watchPosition(
        pos => setUserPos(pos.coords.latitude, pos.coords.longitude), null,
        { enableHighAccuracy: true, maximumAge: 2000 },
      );
    }
    toast('Navigasi dimulai');
  }, [steps, setNote, setUserPos]);

  const stopNavigation = useCallback(() => {
    state.navigating = false; state.pendingRestore = null; setNavigating(false);
    if (state.watchId !== null) { navigator.geolocation.clearWatch(state.watchId); state.watchId = null; }
    releaseWakeLock(setNote); toast('Navigasi dihentikan');
  }, [setNote]);

  // Hapus tujuan: kalau sedang navigating, berhenti dulu lalu bersihkan semua
  const clearDestination = useCallback(() => {
    if (state.navigating) stopNavigation();

    state.destLat = null; state.destLng = null; state.destName = null;
    state.steps = []; state.currentStep = 0;
    state.pendingRestore = null; state.pendingRoute = null;

    setSteps([]); setCurrentStep(0); setDestName(null); setSearchValue(''); setRouteInfo(null);
    mapRef.current?.clearRoute();
    mapRef.current?.clearDestMarker();
    clearStoredTrip();
    toast('Tujuan dihapus');
  }, [stopNavigation]);

  const handleMapsInput = useCallback(async (input: string) => {
    const raw = input.trim();
    if (!raw) return;
    if (looksLikeUrl(raw) && /maps\.app\.goo\.gl|goo\.gl\/maps/i.test(raw)) {
      toast('Membuka short link...');
      try {
        const expanded = await resolveShortLink(raw);
        const result = parseMapsLink(expanded);
        if (result.ok) { setMapsConfirm({ name: result.name!, lat: result.lat!, lng: result.lng!, exact: !!result.exact }); setPendingConfirm({ lat: result.lat!, lng: result.lng!, name: result.name! }); }
        else toast('Link tidak bisa dibaca: ' + result.reason);
      } catch (e) { toast(e instanceof ResolveError ? e.userMessage : 'Gagal membuka link'); }
      return;
    }
    const result = parseMapsLink(raw);
    if (result.ok) { setMapsConfirm({ name: result.name!, lat: result.lat!, lng: result.lng!, exact: !!result.exact }); setPendingConfirm({ lat: result.lat!, lng: result.lng!, name: result.name! }); }
    else if (result.reason === 'short-link') toast('Short link tidak bisa dibuka dari browser. Pakai bookmarklet.')
    else toast('Link tidak dikenali sebagai link Google Maps.');
  }, []);

  useEffect(() => {
    // pulihkan preferensi kendaraan dari sesi sebelumnya
    const prefs = loadVehiclePrefs();
    state.vehicle = prefs.vehicle ?? state.vehicle;
    state.avoidTolls = prefs.avoidTolls ?? state.avoidTolls;
    state.avoidHighways = prefs.avoidHighways ?? state.avoidHighways;
    setVehicle(state.vehicle); setAvoidTolls(state.avoidTolls); setAvoidHighways(state.avoidHighways);

    locateMe();
    const trip = loadTrip();
    if (trip) {
      state.destLat = trip.lat; state.destLng = trip.lng; state.destName = trip.name;
      state.navigating = !!trip.navigating;
      setDestName(trip.name); setSearchValue(trip.name || ''); setNavigating(!!trip.navigating);
      mapRef.current?.setDestMarker(trip.lat, trip.lng);
      if (!state.userLat) { state.pendingRestore = trip; toast('Tujuan dipulihkan. Menunggu GPS...'); }
      else calcRoute();
    }
    const link = readIncomingLink();
    if (link) { cleanIncomingLink(); handleMapsInput(link); }
    const onHash = () => { const l = readIncomingLink(); if (l) { cleanIncomingLink(); handleMapsInput(l); } };
    const onVis = () => { if (document.visibilityState === 'visible' && state.navigating && !state.wakeLock) requestWakeLock(setNote); };
    window.addEventListener('hashchange', onHash);
    document.addEventListener('visibilitychange', onVis);
    return () => { window.removeEventListener('hashchange', onHash); document.removeEventListener('visibilitychange', onVis); };
  }, [locateMe, calcRoute, handleMapsInput, setNote]);

  const currentStepData = steps[currentStep];
  const hasInstr = navigating && currentStepData;
  const instrIcon = hasInstr ? currentStepData.icon : destName ? '📍' : undefined;
  const instrText = hasInstr ? currentStepData.instruction : destName ? `Tujuan: ${destName}` : undefined;
  const instrDist = hasInstr ? formatDist(currentStepData.distance) : undefined;

  return (
    <>
      <div id="app">
        <div id="top-panel">
          <div style={{ position: 'relative' }}>
            <SearchBar
              onDestination={selectDestination} onLocate={locateMe}
              onMenu={() => setDrawerOpen(true)}
              canClear={!!destName}
              onClear={clearDestination}
              bleStatus={bleStatus}
              mapsConfirm={mapsConfirm}
              onConfirmAccept={() => { if (pendingConfirm) selectDestination(pendingConfirm.lat, pendingConfirm.lng, pendingConfirm.name); setMapsConfirm(null); setPendingConfirm(null); }}
              onConfirmReject={() => { setMapsConfirm(null); setPendingConfirm(null); }}
              defaultValue={searchValue}
            />
          </div>
        </div>

        <div id="map">
          <MapComponent
            ref={mapRef}
            onReady={() => {
              // Peta dimuat dinamis, jadi saat efek mount berjalan mapRef masih null
              // dan penanda sempat terlewat. Terapkan ulang dari state global.
              if (state.destLat != null) mapRef.current?.setDestMarker(state.destLat, state.destLng!);
              if (state.userLat != null) mapRef.current?.setUserMarker(state.userLat, state.userLng!);
            }}
          />
        </div>

        <div id="bottom-panel">
          <Instruction icon={instrIcon} text={instrText} dist={instrDist} totalDist={routeInfo?.dist} totalDur={routeInfo?.dur} showInfo={!!routeInfo && !navigating} />
          <NavControls visible={steps.length > 0} navigating={navigating} awakeNote={awakeNote} awakeWarn={awakeWarn} onStart={startNavigation} onStop={stopNavigation} />
        </div>
      </div>
      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        favorites={favorites}
        favLoading={favLoading}
        currentDestName={destName}
        currentDestLat={state.destLat}
        currentDestLng={state.destLng}
        onSelectFav={selectDestination}
        onSaveFav={async (name, lat, lng) => { await addFav(name, lat, lng); toast('Tersimpan ke favorit ⭐'); }}
        onDeleteFav={async (id) => { await removeFav(id); toast('Favorit dihapus'); }}
        bleStatus={bleStatus}
        onToggleBLE={toggleBLE}
        vehicle={vehicle}
        onChangeVehicle={(v) => changeVehiclePrefs({ vehicle: v })}
        avoidTolls={avoidTolls}
        onChangeAvoidTolls={(v) => changeVehiclePrefs({ avoidTolls: v })}
        avoidHighways={avoidHighways}
        onChangeAvoidHighways={(v) => changeVehiclePrefs({ avoidHighways: v })}
        canReRoute={!!state.destLat && !!state.userLat}
      />
      <Toast />
    </>
  );
}
