'use client';
import { useEffect, useRef, useImperativeHandle, forwardRef } from 'react';
import L from 'leaflet';
import { setWorkerUrl } from 'maplibre-gl';
import '@maplibre/maplibre-gl-leaflet';
import type { RouteStep } from '@/types';

// Gaya gelap OpenFreeMap: vektor, tanpa API key, dan benar-benar gelap (bukan
// raster OSM yang di-invert). Atribusi wajib dicantumkan.
const BASEMAP_STYLE = 'https://tiles.openfreemap.org/styles/dark';
const BASEMAP_ATTRIBUTION =
  '© <a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> ' +
  '© <a href="https://openmaptiles.org" target="_blank" rel="noopener">OpenMapTiles</a> ' +
  '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';

export interface MapHandle {
  setView: (lat: number, lng: number, zoom?: number) => void;
  setUserMarker: (lat: number, lng: number) => void;
  setDestMarker: (lat: number, lng: number) => void;
  clearDestMarker: () => void;
  drawRoute: (coords: [number, number][]) => void;
  fitRoute: (coords: [number, number][]) => void;
  clearRoute: () => void;
}

interface Props {
  onReady?: () => void;
}

const USER_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22">
  <circle cx="11" cy="11" r="8" fill="#4f8ef7" stroke="#fff" stroke-width="3"/>
  <circle cx="11" cy="11" r="3" fill="#fff"/>
</svg>`;

const DEST_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="36" viewBox="0 0 28 36">
  <path d="M14 0C6.27 0 0 6.27 0 14c0 10.5 14 22 14 22s14-11.5 14-22C28 6.27 21.73 0 14 0z" fill="#f75f5f"/>
  <circle cx="14" cy="14" r="6" fill="#fff"/>
</svg>`;

export const Map = forwardRef<MapHandle, Props>(function Map({ onReady }, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef      = useRef<any>(null);
  const userMarker  = useRef<any>(null);
  const destMarker  = useRef<any>(null);
  const routeLayer  = useRef<any>(null);

  useEffect(() => {
    if (mapRef.current || !containerRef.current) return;
    // Worker MapLibre disalin ke public/ oleh postinstall; tanpa ini Turbopack
    // menghasilkan URL worker yang salah dan basemap tidak pernah termuat.
    setWorkerUrl('/maplibre-gl-worker.mjs');
    const m = L.map(containerRef.current, { zoomControl: false }).setView([0, 0], 3);
    // MapLibre GL sebagai basemap vektor, dibungkus sebagai layer Leaflet.
    // Kontrol atribusi MapLibre dimatikan; atribusi dipasang ke kontrol Leaflet
    // supaya tidak ada dua kontrol yang bertumpuk di kanan bawah.
    const mlLayer = L.maplibreGL({ style: BASEMAP_STYLE, attributionControl: false });
    mlLayer.addTo(m);
    m.attributionControl.addAttribution(BASEMAP_ATTRIBUTION);
    L.control.zoom({ position: 'bottomright' }).addTo(m);
    mapRef.current = m;

    // Perbaiki sprite OpenFreeMap: style mereferensikan 'circle-11' (hubung)
    // tapi sprite menyediakan 'circle_11' (garis bawah). Resolver ini dipanggil
    // MapLibre tepat saat gambar tidak ditemukan; kita salin dari nama yang
    // benar agar titik di samping label kota muncul dan warning konsol hilang.
    const gl = mlLayer.getMaplibreMap();
    gl.setMissingStyleImageResolver((id) => {
      if (id !== 'circle-11') return;
      const srcImg = gl.getImage('circle_11');
      if (srcImg) gl.addImage('circle-11', srcImg.data, { pixelRatio: srcImg.pixelRatio });
    });
    // Sprite OpenFreeMap juga tidak menyediakan 'wood-pattern' yang dipakai
    // layer landcover_wood. Tanpa pattern, MapLibre melewatkan fill sehingga
    // area hutan tidak tergambar. Hapus pattern-nya agar fill-color gelap tetap
    // tampil dan warning konsol hilang.
    gl.on('style.load', () => {
      if (gl.getLayer('landcover_wood')) {
        // null menghapus properti saat runtime; tipe TS terlalu ketat.
        gl.setPaintProperty('landcover_wood', 'fill-pattern', null as unknown as undefined);
      }
    });

    // Peta baru siap sekarang. Halaman memakai onReady untuk menandai ulang
    // marker yang mungkin saja terlewat saat mapRef masih null.
    onReady?.();
  }, [onReady]);

  useImperativeHandle(ref, () => ({
    setView(lat, lng, zoom = 15) {
      mapRef.current?.setView([lat, lng], zoom);
    },
    setUserMarker(lat, lng) {
      if (!mapRef.current) return;
      const icon = L.divIcon({
        html: USER_ICON_SVG,
        className: '',
        iconSize: [22, 22],
        iconAnchor: [11, 11],
      });
      if (userMarker.current) userMarker.current.setLatLng([lat, lng]);
      else userMarker.current = L.marker([lat, lng], { icon }).addTo(mapRef.current);
    },
    setDestMarker(lat, lng) {
      if (!mapRef.current) return;
      const icon = L.divIcon({
        html: DEST_ICON_SVG,
        className: '',
        iconSize: [28, 36],
        iconAnchor: [14, 36],
      });
      if (destMarker.current) destMarker.current.setLatLng([lat, lng]);
      else destMarker.current = L.marker([lat, lng], { icon }).addTo(mapRef.current);
    },
    clearDestMarker() {
      if (destMarker.current && mapRef.current) {
        mapRef.current.removeLayer(destMarker.current);
        destMarker.current = null;
      }
    },
    drawRoute(coords) {
      if (!mapRef.current) return;
      if (routeLayer.current) mapRef.current.removeLayer(routeLayer.current);
      const latlngs = coords.map(([lng, lat]) => [lat, lng] as [number, number]);
      // Casing (outline gelap) di bawah garis utama agar terbaca di basemap gelap/terang.
      const casing = L.polyline(latlngs, {
        color: '#0a0c12', weight: 9, opacity: 0.9,
        lineCap: 'round', lineJoin: 'round',
        interactive: false,
      });
      // Garis rute utama: biru aksen, sedikit lebih tipis dari casing.
      const mainLine = L.polyline(latlngs, {
        color: '#4f8ef7', weight: 5, opacity: 0.95,
        lineCap: 'round', lineJoin: 'round',
        interactive: false,
      });
      // Kedua garis dimasukkan ke satu grup yang ditambahkan ke peta. Penting:
      // jangan `.addTo(map)` per garis, karena `removeLayer(grup)` hanya
      // menghapus anak-anak grup yang benar-benar terdaftar lewat grup itu.
      routeLayer.current = L.layerGroup([casing, mainLine]).addTo(mapRef.current);
    },
    fitRoute(coords) {
      if (!mapRef.current) return;
      const latlngs = coords.map(([lng, lat]) => [lat, lng] as [number, number]);
      mapRef.current.fitBounds(L.latLngBounds(latlngs), { padding: [40, 40] });
    },
    clearRoute() {
      if (routeLayer.current && mapRef.current) {
        mapRef.current.removeLayer(routeLayer.current);
        routeLayer.current = null;
      }
    },
  }), []);

  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />;
});
