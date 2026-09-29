import type { ParseResult } from '@/types';

const MAPS_NUM = '-?\\d+(?:\\.\\d+)?';

const GOOGLE_MAPS_CC = [
  'com', 'co.id', 'co.uk', 'com.br', 'co.jp', 'com.au', 'co.in', 'com.mx',
  'com.ar', 'com.sg', 'com.my', 'com.tw', 'com.ph', 'com.vn', 'com.tr',
  'com.ua', 'de', 'fr', 'es', 'it', 'nl', 'se', 'no', 'fi', 'dk',
  'pl', 'co.th', 'co.kr', 'co.il', 'ae', 'co.za', 'cz', 'at', 'ch', 'be',
  'pt', 'gr', 'ro', 'hu',
];

export const MAPS_HOSTS = new Set<string>();
for (const cc of GOOGLE_MAPS_CC)
  for (const sub of ['', 'www.', 'maps.']) MAPS_HOSTS.add(`${sub}google.${cc}`);

export function isGoogleMapsHost(u: URL): boolean {
  return MAPS_HOSTS.has(u.hostname.toLowerCase());
}

export function validLatLng(lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng)
      && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

export function parseMapsLink(text: string): ParseResult {
  const raw = String(text || '').trim();
  if (!raw) return { ok: false, reason: 'not-a-link' };

  if (/^https?:\/\/(maps\.app\.goo\.gl|goo\.gl\/maps)(\/|$)/i.test(raw))
    return { ok: false, reason: 'short-link' };

  let u: URL;
  try { u = new URL(raw); } catch { return { ok: false, reason: 'not-a-link' }; }

  if (!isGoogleMapsHost(u) || !u.pathname.startsWith('/maps'))
    return { ok: false, reason: 'not-a-link' };

  const safeDec = (t: string) => { try { return decodeURIComponent(t); } catch { return t; } };
  const dec = (t: string) => { try { return decodeURIComponent(t.replace(/\+/g, ' ')); } catch { return t.replace(/\+/g, ' '); } };
  const s = safeDec(raw);

  const coordPair = (str: string) => {
    const m = String(str).trim().match(new RegExp(`^(${MAPS_NUM})\\s*,\\s*(${MAPS_NUM})$`));
    if (!m) return null;
    const lat = parseFloat(m[1]), lng = parseFloat(m[2]);
    return validLatLng(lat, lng) ? { lat, lng } : null;
  };

  const m2s    = s.match(/!2s([^!]+)/);
  const mPlace = s.match(/\/place\/([^/@?]+)/);
  const dirSegs = (u.pathname.split('/dir/')[1] || '').split('/')
    .filter((x: string) => x && !x.startsWith('@') && !x.includes('=')).map(dec);
  const dirDest  = dirSegs.length ? dirSegs[dirSegs.length - 1] : '';
  const dirCoord = coordPair(dirDest);
  const qVal   = (u.searchParams.get('query') || u.searchParams.get('q')
               || u.searchParams.get('ll') || u.searchParams.get('daddr') || '').trim();
  const qCoord = coordPair(qVal);
  const isDirNamed = !!(dirDest && !dirCoord);

  const fallbackName = 'Tujuan dari Google Maps';
  const name = (m2s && dec(m2s[1]))
    || (mPlace && dec(mPlace[1]))
    || (dirDest && !dirCoord ? dirDest : '')
    || (qVal && !qCoord ? qVal : '')
    || fallbackName;

  const pairs = [...s.matchAll(new RegExp(`!3d(${MAPS_NUM})!4d(${MAPS_NUM})`, 'g'))];
  let lat: number, lng: number, exact = false;

  if (pairs.length) {
    lat = parseFloat(pairs[0][1]);
    lng = parseFloat(pairs[0][2]);
    exact = pairs.length === 1;
  } else {
    if (dirCoord) { lat = dirCoord.lat; lng = dirCoord.lng; exact = true; }
    else if (qCoord) { lat = qCoord.lat;  lng = qCoord.lng;  exact = true; }
    else {
      const at = isDirNamed
        ? null
        : s.match(new RegExp(`@(${MAPS_NUM}),(${MAPS_NUM})(?:,|$)`));
      if (at) { lat = parseFloat(at[1]); lng = parseFloat(at[2]); exact = false; }
      else return (name !== fallbackName)
        ? { ok: false, reason: 'needs-geocode', name }
        : { ok: false, reason: 'no-coords' };
    }
  }

  if (!validLatLng(lat!, lng!)) return { ok: false, reason: 'no-coords' };
  return { ok: true, lat: lat!, lng: lng!, name, exact };
}
