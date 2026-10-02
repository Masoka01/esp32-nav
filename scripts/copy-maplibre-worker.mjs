// Salin worker MapLibre GL ke public/.
//
// Kenapa perlu: MapLibre membuat Web Worker dari `new URL('./maplibre-gl-worker.mjs',
// import.meta.url)`. Setelah dibundel Turbopack, `import.meta.url` menunjuk ke chunk
// aplikasi, sehingga path relatif itu tidak ada dan worker gagal dimuat
// ("Worker failed to load"). Dengan menaruh worker di public/ dan memanggil
// `maplibregl.setWorkerUrl('/maplibre-gl-worker.mjs')`, URL-nya pasti benar.
//
// Worker mengimpor `./maplibre-gl-shared.mjs` secara relatif, jadi kedua file harus
// berada di folder yang sama. File hasil salinan di-ignore git dan dibuat ulang
// otomatis lewat `postinstall`.
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = resolve(root, 'node_modules/maplibre-gl/dist');
const dest = resolve(root, 'public');

mkdirSync(dest, { recursive: true });
for (const file of ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs']) {
  copyFileSync(resolve(src, file), resolve(dest, file));
}
console.log('[maplibre] worker disalin ke public/');
