'use client';
import { useState, useEffect, useCallback } from 'react';
import { addFavorite, getFavorites, deleteFavorite } from '@/lib/firebase';
import type { Favorite } from '@/types';

export function useFavorites() {
  const [favorites, setFavorites] = useState<Favorite[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const data = await getFavorites();
      setFavorites(data);
    } catch (e) {
      console.error('Gagal memuat favorit:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const add = useCallback(async (name: string, lat: number, lng: number) => {
    const id = await addFavorite({ name, lat, lng, savedAt: Date.now() });
    setFavorites(prev => [{ id, name, lat, lng, savedAt: Date.now() }, ...prev]);
    return id;
  }, []);

  const remove = useCallback(async (id: string) => {
    await deleteFavorite(id);
    setFavorites(prev => prev.filter(f => f.id !== id));
  }, []);

  return { favorites, loading, add, remove, reload: load };
}
