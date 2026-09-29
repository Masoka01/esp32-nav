import { initializeApp, getApps } from 'firebase/app';
import {
  getFirestore,
  collection,
  addDoc,
  getDocs,
  deleteDoc,
  doc,
  query,
  orderBy,
} from 'firebase/firestore';
import type { Favorite } from '@/types';

const firebaseConfig = {
  apiKey:            process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain:        process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId:         process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket:     process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId:             process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
export const db = getFirestore(app);

const FAVORITES_COLLECTION = 'favorites';

export async function addFavorite(fav: Omit<Favorite, 'id'>): Promise<string> {
  const ref = await addDoc(collection(db, FAVORITES_COLLECTION), fav);
  return ref.id;
}

export async function getFavorites(): Promise<Favorite[]> {
  const q = query(
    collection(db, FAVORITES_COLLECTION),
    orderBy('savedAt', 'desc'),
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() } as Favorite));
}

export async function deleteFavorite(id: string): Promise<void> {
  await deleteDoc(doc(db, FAVORITES_COLLECTION, id));
}
