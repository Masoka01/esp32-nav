'use client';
import { useState, useEffect, useRef } from 'react';
import { FavoritesContent } from './FavoritesContent';
import { BookmarkletContent } from './BookmarkletContent';
import { BLESection } from './BLESection';
import { VehicleSection } from './VehicleSection';
import type { Favorite } from '@/types';
import type { BLEStatus } from '@/types';

type Section = 'vehicle' | 'favorites' | 'bookmarklet';

interface Props {
  open: boolean;
  onClose: () => void;
  favorites: Favorite[];
  favLoading: boolean;
  currentDestName: string | null;
  currentDestLat: number | null;
  currentDestLng: number | null;
  onSelectFav: (lat: number, lng: number, name: string) => void;
  onSaveFav: (name: string, lat: number, lng: number) => Promise<void>;
  onDeleteFav: (id: string) => Promise<void>;
  bleStatus: BLEStatus;
  onToggleBLE: () => void;
  // Vehicle section props
  vehicle: 'car' | 'motor';
  onChangeVehicle: (v: 'car' | 'motor') => void;
  avoidTolls: boolean;
  onChangeAvoidTolls: (v: boolean) => void;
  avoidHighways: boolean;
  onChangeAvoidHighways: (v: boolean) => void;
  canReRoute: boolean;
}

const MENU_ITEMS: { id: Section; label: string; icon: string }[] = [
  { id: 'vehicle', label: 'Kendaraan', icon: '🚗' },
  { id: 'favorites', label: 'Favorit', icon: '⭐' },
  { id: 'bookmarklet', label: 'Kirim dari Google Maps', icon: '🔗' },
];

export function Drawer({
  open,
  onClose,
  favorites,
  favLoading,
  currentDestName,
  currentDestLat,
  currentDestLng,
  onSelectFav,
  onSaveFav,
  onDeleteFav,
  bleStatus,
  onToggleBLE,
  vehicle,
  onChangeVehicle,
  avoidTolls,
  onChangeAvoidTolls,
  avoidHighways,
  onChangeAvoidHighways,
  canReRoute,
}: Props) {
  const drawerRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const previousActiveElement = useRef<HTMLElement | null>(null);
  const [activeSection, setActiveSection] = useState<Section>('vehicle');
  const [mounted, setMounted] = useState(false);
  const [animating, setAnimating] = useState(false);
  const [entered, setEntered] = useState(false);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState(0);

  // Hook untuk prefers-reduced-motion yang reaktif
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    setPrefersReducedMotion(mediaQuery.matches);
    const handler = (e: MediaQueryListEvent) => setPrefersReducedMotion(e.matches);
    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, []);

  // Mount/unmount logic: tetap di DOM selama animasi keluar berjalan
  useEffect(() => {
    if (open) {
      setMounted(true);
      // Reset entered ke false agar animasi masuk bisa jalan dari translateX(100%)
      setEntered(false);
      previousActiveElement.current = document.activeElement as HTMLElement;
      // Scroll lock yang lebih halus: hanya prevent body scroll, biarkan drawer scroll
      document.body.style.overflow = 'hidden';
      // Jangan set touchAction=none di body - itu memblokir scroll di dalam drawer
      setTimeout(() => {
        const closeBtn = drawerRef.current?.querySelector('[data-drawer-close]') as HTMLElement;
        closeBtn?.focus();
      }, 0);

      // Trigger animasi masuk di frame berikutnya
      // Gunakan requestAnimationFrame ganda untuk memastikan browser sudah paint state awal
      if (!prefersReducedMotion) {
        let raf2 = 0;
        const raf1 = requestAnimationFrame(() => {
          raf2 = requestAnimationFrame(() => {
            setEntered(true);
          });
        });
        return () => {
          cancelAnimationFrame(raf1);
          cancelAnimationFrame(raf2);
        };
      } else {
        // prefers-reduced-motion: langsung tampilkan tanpa animasi
        setEntered(true);
      }
    } else if (mounted) {
      // Reset entered saat mulai menutup
      setEntered(false);
      // Mulai animasi keluar
      setAnimating(true);
      // Fallback timeout jika transitionend tidak datang (tab disembunyikan, dll)
      const fallback = setTimeout(() => {
        setAnimating(false);
        setMounted(false);
        document.body.style.overflow = '';
        previousActiveElement.current?.focus();
      }, prefersReducedMotion ? 0 : 250); // durasi keluar ~200ms + buffer

      const handleTransitionEnd = (e: TransitionEvent) => {
        if (e.target === drawerRef.current && e.propertyName === 'transform') {
          clearTimeout(fallback);
          setAnimating(false);
          setMounted(false);
          document.body.style.overflow = '';
          previousActiveElement.current?.focus();
          drawerRef.current?.removeEventListener('transitionend', handleTransitionEnd);
        }
      };
      drawerRef.current?.addEventListener('transitionend', handleTransitionEnd);
      return () => {
        clearTimeout(fallback);
        drawerRef.current?.removeEventListener('transitionend', handleTransitionEnd);
      };
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [open, mounted, prefersReducedMotion]);

  // Focus trap
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const focusable = drawerRef.current?.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  // Swipe to close - interaktif, mengikuti jari
  useEffect(() => {
    if (!open || prefersReducedMotion) return;

    let startX = 0;
    let startY = 0;
    let currentX = 0;
    let startTime = 0;
    let isHorizontal = false;
    let isVertical = false;

    const handleTouchStart = (e: TouchEvent) => {
      const touch = e.touches[0];
      startX = touch.clientX;
      startY = touch.clientY;
      currentX = startX;
      startTime = performance.now();
      isHorizontal = false;
      isVertical = false;
      setIsDragging(true);
      // Matikan transisi saat drag
      if (drawerRef.current) {
        drawerRef.current.style.transition = 'none';
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!isDragging) return;
      const touch = e.touches[0];
      currentX = touch.clientX;
      const deltaX = currentX - startX;
      const deltaY = touch.clientY - startY;

      // Tentukan arah gesture pada gerakan pertama yang signifikan
      if (!isHorizontal && !isVertical) {
        if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 10) {
          isHorizontal = true;
          // Prevent default hanya untuk horizontal swipe
          e.preventDefault();
        } else if (Math.abs(deltaY) > Math.abs(deltaX) && Math.abs(deltaY) > 10) {
          isVertical = true;
          // Biarkan scroll vertikal berjalan normal
        }
      }

      if (isHorizontal) {
        e.preventDefault();
        // Hanya izinkan drag ke kanan (menutup), tidak ke kiri
        const offset = Math.max(0, deltaX);
        setDragOffset(offset);
      }
      // Jika isVertical, biarkan browser handle scroll - jangan set dragOffset
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (!isDragging) return;
      setIsDragging(false);

      const drawer = drawerRef.current;
      if (!drawer) return;

      // Kembalikan transisi
      drawer.style.transition = '';

      const elapsed = performance.now() - startTime;
      const velocity = Math.abs(currentX - startX) / Math.max(elapsed, 1); // px/ms
      const drawerWidth = drawer.offsetWidth;
      const threshold = drawerWidth / 3; // 1/3 lebar drawer
      const shouldClose = dragOffset > threshold || velocity > 0.5;

      if (shouldClose) {
        // Tutup dengan momentum - biarkan CSS transition handle
        onClose();
      } else {
        // Kembali ke posisi terbuka
        setDragOffset(0);
      }
    };

    const handleTouchCancel = () => {
      if (!isDragging) return;
      setIsDragging(false);
      const drawer = drawerRef.current;
      if (drawer) {
        drawer.style.transition = '';
        setDragOffset(0);
      }
    };

    // Handle pointerup/pointercancel di luar drawer (mouse/touch)
    const handlePointerUp = () => {
      if (isDragging) {
        handleTouchCancel();
      }
    };

    const drawer = drawerRef.current;
    if (!drawer) return;

    drawer.addEventListener('touchstart', handleTouchStart, { passive: false });
    drawer.addEventListener('touchmove', handleTouchMove, { passive: false });
    drawer.addEventListener('touchend', handleTouchEnd, { passive: true });
    drawer.addEventListener('touchcancel', handleTouchCancel, { passive: true });
    // Juga handle mouse untuk desktop testing
    drawer.addEventListener('pointerup', handlePointerUp);
    drawer.addEventListener('pointercancel', handlePointerUp);
    // Document level untuk menangkap lepas di luar area
    document.addEventListener('pointerup', handlePointerUp);
    document.addEventListener('pointercancel', handlePointerUp);

    return () => {
      drawer.removeEventListener('touchstart', handleTouchStart);
      drawer.removeEventListener('touchmove', handleTouchMove);
      drawer.removeEventListener('touchend', handleTouchEnd);
      drawer.removeEventListener('touchcancel', handleTouchCancel);
      drawer.removeEventListener('pointerup', handlePointerUp);
      drawer.removeEventListener('pointercancel', handlePointerUp);
      document.removeEventListener('pointerup', handlePointerUp);
      document.removeEventListener('pointercancel', handlePointerUp);
    };
  }, [open, prefersReducedMotion, onClose, isDragging, dragOffset]);

  // Render null jika belum mounted (belum buka) atau sudah unmount (animasi keluar selesai)
  if (!mounted) return null;

  // Class untuk animasi: .open saat entered=true, .closing saat animating=true
  // Saat drag, kita override transform via style inline
  const drawerClasses = `drawer${prefersReducedMotion ? ' no-animation' : ''} ${entered && !animating ? 'open' : ''} ${animating ? 'closing' : ''}`;
  const backdropClasses = `drawer-backdrop${prefersReducedMotion ? ' no-animation' : ''} ${entered && !animating ? 'open' : ''} ${animating ? 'closing' : ''}`;

  // Inline style untuk drag offset
  const drawerStyle: React.CSSProperties = {
    transform: isDragging ? `translateX(${dragOffset}px)` : undefined,
  };

  return (
    <>
      <div
        ref={backdropRef}
        className={backdropClasses}
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        ref={drawerRef}
        className={drawerClasses}
        style={drawerStyle}
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
      >
        <div className="drawer-header">
          <span className="drawer-title">Menu</span>
          <button
            className="drawer-close"
            onClick={onClose}
            aria-label="Tutup menu"
            data-drawer-close
          >
            ✕
          </button>
        </div>
        <BLESection status={bleStatus} onToggle={onToggleBLE} />
        <nav className="drawer-menu" role="tablist" aria-label="Menu navigasi">
          {MENU_ITEMS.map((item) => (
            <button
              key={item.id}
              role="tab"
              aria-selected={activeSection === item.id}
              aria-controls={`panel-${item.id}`}
              id={`tab-${item.id}`}
              className={`drawer-tab${activeSection === item.id ? ' active' : ''}`}
              onClick={() => setActiveSection(item.id)}
              aria-label={item.label}
              title={item.label}
            >
              <span className="tab-icon">{item.icon}</span>
              <span className="tab-label">{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="drawer-content" role="tabpanel" aria-labelledby={`tab-${activeSection}`} id={`panel-${activeSection}`}>
          {activeSection === 'vehicle' && (
            <VehicleSection
              vehicle={vehicle}
              onChangeVehicle={onChangeVehicle}
              avoidTolls={avoidTolls}
              onChangeAvoidTolls={onChangeAvoidTolls}
              avoidHighways={avoidHighways}
              onChangeAvoidHighways={onChangeAvoidHighways}
              canReRoute={canReRoute}
            />
          )}
          {activeSection === 'favorites' && (
            <FavoritesContent
              favorites={favorites}
              loading={favLoading}
              currentDestName={currentDestName}
              currentDestLat={currentDestLat}
              currentDestLng={currentDestLng}
              onSelect={onSelectFav}
              onSave={onSaveFav}
              onDelete={onDeleteFav}
              onClose={onClose}
            />
          )}
          {activeSection === 'bookmarklet' && (
            <BookmarkletContent onClose={onClose} />
          )}
        </div>
      </aside>
    </>
  );
}