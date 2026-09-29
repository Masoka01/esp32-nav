'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import dynamic from 'next/dynamic';
import type { MapHandle } from '@/components/Map';
import { BLEPanel } from '@/components/BLEPanel';
import { Instruction } from '@/components/Instruction';
import { NavControls } from '@/components/NavControls';
import { SearchBar } from '@/components/SearchBar';
import { BookmarkletPanel } from '@/components/BookmarkletPanel';
import { Favorites } from '@/components/Favorites';
import { Toast, toast } from '@/components/Toast';
import { useBLE } from '@/hooks/useBLE';
import { useFavorites } from '@/hooks/useFavorites';
import { state } from '@/lib/state';
import { fetchRoute, formatDist, formatDur, haversine } from '@/lib/route';
import { saveTrip, loadTrip } from '@/lib/store';
import { sendToBLE } from '@/lib/ble';
import { requestWakeLock, releaseWakeLock } from '@/lib/wake';
import { parseMapsLink } from '@/lib/parse';
import { resolveShortLink, looksLikeUrl, ResolveError } from '@/lib/resolve';
import { readIncomingLink, cleanIncomingLink } from '@/lib/share';
import type { RouteStep } from '@/types';

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
  const [bmOpen, setBmOpen]           = useState(false);
  const [mapsConfirm, setMapsConfirm] = useState<{ name: string; lat: number; lng: number; exact: boolean } | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<{ lat: number; lng: number; name: string } | null>(null);

  const { bleStatus, toggle: toggleBLE } = useBLE(toast);
  const { favorites, loading: favLoading, add: addFav, remove: removeFav } = useFavorites();

  const setNote = useCallback((msg: string, warn = false) => {
    setAwakeNote(msg);
    setAwakeWarn(warn);
  }, []);

  const calcRoute = useCallback(async () => {
    if (!state.userLat || !state.destLat) return;
    try {
      const result = await fetchRoute(state.userLat, state.userLng!, state.destLat, state.destLng!);
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
  const instrIcon = currentStepData?.icon ?? '🗺️';
  const instrText = navigating && currentStepData ? currentStepData.instruction : destName ? `Tujuan: ${destName}` : 'Cari tujuan untuk mulai navigasi';
  const instrDist = navigating && currentStepData ? formatDist(currentStepData.distance) : '';

  return (
    <>
      <div id="app">
        <div id="top-panel">
          <div className="app-title">ESP32 NAVIGATOR</div>
          <div style={{ position: 'relative' }}>
            <SearchBar
              onDestination={selectDestination} onLocate={locateMe}
              onBookmarklet={() => setBmOpen(o => !o)} bookmarkletOpen={bmOpen}
              mapsConfirm={mapsConfirm}
              onConfirmAccept={() => { if (pendingConfirm) selectDestination(pendingConfirm.lat, pendingConfirm.lng, pendingConfirm.name); setMapsConfirm(null); setPendingConfirm(null); }}
              onConfirmReject={() => { setMapsConfirm(null); setPendingConfirm(null); }}
              defaultValue={searchValue}
            />
            <BookmarkletPanel open={bmOpen} onClose={() => setBmOpen(false)} />
          </div>
        </div>

        <div id="map">
          <MapComponent ref={mapRef} />
        </div>

        <div id="bottom-panel">
          <BLEPanel status={bleStatus} onToggle={toggleBLE} />
          <Instruction icon={instrIcon} text={instrText} dist={instrDist} totalDist={routeInfo?.dist} totalDur={routeInfo?.dur} showInfo={!!routeInfo && !navigating} />
          <NavControls visible={steps.length > 0} navigating={navigating} awakeNote={awakeNote} awakeWarn={awakeWarn} onStart={startNavigation} onStop={stopNavigation} />
          <Favorites
            favorites={favorites} loading={favLoading}
            currentDestName={destName} currentDestLat={state.destLat} currentDestLng={state.destLng}
            onSelect={selectDestination}
            onSave={async (name, lat, lng) => { await addFav(name, lat, lng); toast('Tersimpan ke favorit ⭐'); }}
            onDelete={async (id) => { await removeFav(id); toast('Favorit dihapus'); }}
          />
        </div>
      </div>
      <Toast />
    </>
  );
}
