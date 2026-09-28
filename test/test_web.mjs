// Test sisi web: sanitasi, pemetaan ikon, dan formation payload BLE.
//
// Fungsi diambil langsung dari index.html (bukan disalin), jadi test ini
// menguji kode yang benar-benar terkirim ke ESP32.
//
// Pasangannya: test_cross.cpp membuktikan byte yang sama diterima firmware.
//
// Run:  node test/test_web.mjs
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(here, '..', 'index.html'), 'utf8');

let pass = 0, fail = 0;
const section = n => console.log('== ' + n + ' ==');
function check(cond, what) {
  if (cond) { pass++; return; }
  fail++;
  console.log('  FAIL: ' + what);
}

// ── ekstraksi dari index.html ────────────────────────────────────────────
function block(startMarker, endMarker) {
  const a = html.indexOf(startMarker);
  if (a < 0) throw new Error('tidak menemukan: ' + startMarker);
  const b = html.indexOf(endMarker, a);
  if (b < 0) throw new Error('tidak menemukan akhir untuk: ' + startMarker);
  return html.slice(a, b + endMarker.length);
}

const consts = {};
for (const name of ['BLE_CHUNK_SIZE', 'TEXT_MAX', 'ICON_MAX']) {
  const m = html.match(new RegExp('const ' + name + '\\s*=\\s*([^;]+);'));
  if (!m) throw new Error('konstanta tidak ditemukan: ' + name);
  consts[name] = Number(m[1].trim());
}

const src = [
  block('function sanitizeForBLE', '    .slice(0, TEXT_MAX);\n}'),
  block('function clampCode', '}'),
  block('function normalizeDist', '}'),
  block('function maneuverCode', '  return 12;\n}'),
  block('async function writeChunks', '      await ch.writeValue(chunk);\n    }\n  }\n}'),
  block('function sendToBLE', '  return bleSendChain;\n}'),
].join('\n\n');

const state = { bleChar: null, bleSendChain: Promise.resolve() };

// Stub characteristic: mencatat setiap write beserta urutan dan async-ness.
function makeChar() {
  const log = [];
  const ch = {
    log,
    async writeValueWithResponse(chunk) {
      log.push({ chunk: new Uint8Array(chunk), kind: 'withResponse' });
      await new Promise(r => setImmediate(r));   // realistis: async
    },
    async writeValue(chunk) {
      log.push({ chunk: new Uint8Array(chunk), kind: 'plain' });
    },
  };
  return ch;
}

const factory = new Function(
  'state', 'TextEncoder', 'console', 'setImmediate',
  'const TEXT_MAX = ' + consts.TEXT_MAX + '; const ICON_MAX = ' + consts.ICON_MAX +
  '; const BLE_CHUNK_SIZE = ' + consts.BLE_CHUNK_SIZE + ';\n' +
  'let bleSendChain = Promise.resolve();\n' +
  src + '\nreturn { sanitizeForBLE, clampCode, normalizeDist, maneuverCode, writeChunks, sendToBLE };'
);
const api = factory(state, TextEncoder, console, setImmediate);
// ── sanitizeForBLE ──────────────────────────────────────────────────────
section('sanitizeForBLE');
{
  const s = api.sanitizeForBLE;
  check(s('') === '', 'string kosong');
  check(s('   ') === '', 'spasi semua');
  check(s('  hello  ') === 'hello', 'spasi tepi dibuang');
  check(s('a     b') === 'a b', 'spasi dalam dirapatkan');
  check(s('a|b') === 'a b', 'pipe jadi spasi (bukan dihapus)');
  check(s('a\tb') === 'a b', 'tab jadi spasi');
  check(s('a\nb') === 'a b', 'newline jadi spasi');
  check(s('a\rb') === 'a b', 'CR jadi spasi');
  check(s('Café') === 'Cafe', 'aksen dipecah via NFD');
  check(s('naïve') === 'naive', 'diaeresis dipecah');
  check(s('北京') === '', 'CJK tidak punya padanan ASCII');
  check(s('a\x00b') === 'a b', 'NUL jadi spasi');
  check(s('Jl. Sudirman No. 1') === 'Jl. Sudirman No. 1', 'alamat utuh');
  check(s('x'.repeat(100)).length === consts.TEXT_MAX,
        'dipotong ke TEXT_MAX (' + consts.TEXT_MAX + ')');
  check(s('a' + '|'.repeat(60)).split('|').length === 1,
        'tidak ada pipe yang lolos ke wire');
  check(!/[\x00-\x1F\x7F]/.test(s('a\x01b\x7Fc')), 'tidak ada byte kontrol');
}

// ── clampCode / normalizeDist ───────────────────────────────────────────
section('clampCode & normalizeDist');
{
  const c = api.clampCode;
  check(c(0) === 0, '0 tetap 0');
  check(c(12) === 12, 'batas atas 12');
  check(c(13) === 12, 'di atas batas jadi 12');
  check(c(-1) === 12, 'negatif jadi 12');
  check(c(3.4) === 3, 'pembulatan ke bawah');
  check(c(3.6) === 4, 'pembulatan ke atas');
  check(c(NaN) === 12, 'NaN jadi 12');
  check(c('abc') === 12, 'string rusak jadi 12');
  check(c(undefined) === 12, 'undefined jadi 12');

  const d = api.normalizeDist;
  check(d(120) === 120, 'bulat tetap');
  check(d(120.4) === 120, 'pembulatan ke bawah');
  check(d(120.6) === 121, 'pembulatan ke atas');
  check(d(-1) === -1, 'minus satu = tidak diketahui');
  check(d(-40) === -40, 'jarak negatif diteruskan');
  check(d(NaN) === -1, 'NaN jadi -1');
  check(d(Infinity) === -1, 'Infinity jadi -1');
  check(d('abc') === -1, 'string rusak jadi -1');
}

// ── maneuverCode ────────────────────────────────────────────────────────
section('maneuverCode');
{
  const m = api.maneuverCode;
  const cases = [
    ['depart', null, 0], ['arrive', null, 11],
    ['roundabout', null, 9], ['rotary', null, 9],
    ['roundabout turn', null, 9], ['exit roundabout', null, 9], ['exit rotary', null, 9],
    ['merge', null, 10], ['on ramp', null, 10], ['off ramp', null, 10],
    ['turn', 'uturn', 5],
    ['turn', 'slight left', 2], ['turn', 'left', 3], ['turn', 'sharp left', 4],
    ['turn', 'slight right', 6], ['turn', 'right', 7], ['turn', 'sharp right', 8],
    ['continue', null, 1], ['new name', null, 1], ['end of road', null, 1],
    ['tipeTidakDikenal', null, 12],
  ];
  for (const [type, modifier, want] of cases) {
    check(m(type, modifier) === want,
          type + (modifier ? '/' + modifier : '') + ' -> ' + want);
  }
  for (const [type, mod] of cases) {
    const v = m(type, mod);
    check(Number.isInteger(v) && v >= 0 && v <= consts.ICON_MAX,
          type + ' dalam rentang ikon');
  }
}

// ── payload & chunking ──────────────────────────────────────────────────
section('sendToBLE: format payload');
{
  const ch = makeChar();
  state.bleChar = ch;
  await api.sendToBLE(3, 'Jalan Merdeka', 120);
  const bytes = ch.log.map(e => e.chunk);
  const all = new Uint8Array(bytes.flatMap(b => [...b]));
  const text = new TextDecoder().decode(all);
  check(text === 'V1|3|120|Jalan Merdeka\n',
        'payload persis "V1|3|120|Jalan Merdeka\\n", dapat ' + JSON.stringify(text));
  check(all[all.length - 1] === 0x0A, 'diakhiri newline');
  check(text.split('|').length - 1 === 3, 'tepat 3 separator, dapat ' + (text.split('|').length - 1));
  ch.log.length = 0;
}

section('writeChunks: memecah 20 byte');
{
  const ch = makeChar();
  state.bleChar = ch;
  // 60 karakter teks -> payload jauh di atas 20 byte -> harus dipecah.
  const long = 'x'.repeat(60);
  await api.sendToBLE(1, long, 999);
  const sizes = ch.log.map(e => e.chunk.length);
  check(sizes.length > 1, 'payload panjang dipecah jadi beberapa write');
  check(sizes.every(s => s <= consts.BLE_CHUNK_SIZE),
        'tiapot write <= BLE_CHUNK_SIZE, dapat ' + sizes.join(','));
  check(sizes.slice(0, -1).every(s => s === consts.BLE_CHUNK_SIZE),
        'semua chunk penuh kecuali yang terakhir');
  const joined = new Uint8Array(ch.log.flatMap(e => [...e.chunk]));
  check(new TextDecoder().decode(joined) === 'V1|1|999|' + 'x'.repeat(40) + '\n',
        'payload utuh setelah dipecah');
  check(ch.log.every(e => e.kind === 'withResponse'),
        'memakai writeValueWithResponse bila tersedia');
  ch.log.length = 0;
}

section('writeChunks: fallback tanpa writeValueWithResponse');
{
  const log = [];
  state.bleChar = { async writeValue(c) { log.push(new Uint8Array(c)); } };
  await api.sendToBLE(1, 'abc', 10);
  check(log.length === 1, 'satu write, dapat ' + log.length);
  state.bleChar = null;
}

section('sendToBLE: tanpa koneksi & antrean');
{
  state.bleChar = null;
  const p = api.sendToBLE(1, 'x', 1);
  check(p instanceof Promise, 'return Promise walau tanpa characteristic');
  await p;

  // Dua kiriman beruntun tidak boleh saling menimpa di tengah chunk.
  const ch = makeChar();
  state.bleChar = ch;
  const order = [];
  const t0 = api.sendToBLE(1, 'AAA', 1);
  const t1 = api.sendToBLE(2, 'BBB', 2);
  await Promise.all([t0, t1]);
  for (const e of ch.log) order.push(new TextDecoder().decode(e.chunk));
  check(order[0].startsWith('V1|1|1|AAA'), 'pesan pertama lengkap');
  check(order[order.length - 1].endsWith('V1|2|2|BBB\n'), 'pesan kedua lengkap');
  check(order.some(x => x.includes('V1|2|2|BBB')), 'pesan kedua terkirim');
  state.bleChar = null;
}

section('payload: tidak pernah punya byte di luar ASCII');
{
  const ch = makeChar();
  state.bleChar = ch;
  await api.sendToBLE(9, 'Belok kiri ke Jalan Übäh–Tokyo 東京', 250);
  const all = new Uint8Array(ch.log.flatMap(e => [...e.chunk]));
  // Semua byte isi harus ASCII printable; byte terakhir adalah terminator
  // '\n' yang memang di luar rentang itu.
  check(all[all.length - 1] === 0x0A, 'terminator newline di akhir');
  check(all.slice(0, -1).every(b => b >= 0x20 && b < 0x7F),
        'semua byte isi ASCII printable');
  const t = new TextDecoder().decode(all);
  check(/^V1\|9\|250\|/.test(t), 'header payload benar, dapat ' + JSON.stringify(t.slice(0, 14)));
  state.bleChar = null;
}

console.log('\n─────────────────────────────');
console.log('PASS: ' + pass + '   FAIL: ' + fail);
process.exit(fail === 0 ? 0 : 1);
