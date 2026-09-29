'use client';
import { useEffect, useRef, useImperativeHandle, forwardRef } from 'react';
import L from 'leaflet';
import type { RouteStep } from '@/types';

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
  onMapClick?: (lat: number, lng: number) => void;
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

export const Map = forwardRef<MapHandle, Props>(function Map({ onMapClick, onReady }, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef      = useRef<any>(null);
  const userMarker  = useRef<any>(null);
  const destMarker  = useRef<any>(null);
  const routeLayer  = useRef<any>(null);

  useEffect(() => {
    if (mapRef.current || !containerRef.current) return;
    const m = L.map(containerRef.current, { zoomControl: false }).setView([0, 0], 3);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(m);
    L.control.zoom({ position: 'bottomright' }).addTo(m);
    if (onMapClick) {
      m.on('click', (e: any) => onMapClick(e.latlng.lat, e.latlng.lng));
    }
    mapRef.current = m;
    // Peta baru siap sekarang. Halaman leveraging onReady untuk menandai ulang
    // marker yang mungkin saja terlewat saat mapRef masih null.
    onReady?.();
  }, [onMapClick]);

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
      routeLayer.current = L.polyline(latlngs, {
        color: '#4f8ef7', weight: 5, opacity: 0.85,
        lineCap: 'round', lineJoin: 'round',
      }).addTo(mapRef.current);
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
