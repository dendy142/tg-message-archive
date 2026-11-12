// Чистые помощники: config, время и пояса, base64, хеш PIN, дифф правок

// ── config: константы. Секретов здесь нет: токен бота держит платформа
/** Параметров в одном запросе (строки × колонки пакетной вставки) — классический предел SQLite;
 * у платформы он меньше, чем у локального libsql (sdk-shim/db.js проверяет то же число). */
export const MAX_SQL_VARS = 999;

export const DEFAULT_TZ = 'UTC';

export const BURST_DELETE_THRESHOLD = 5;

export const WIPE_MIN_MESSAGES = 5;

export const GLOBAL_HOUSEKEEPING_MS = 3_600_000;
export const OWNER_HOUSEKEEPING_MS = 6 * 3_600_000;
export const RETENTION_BATCHES = 3;

/** Через сколько дней после отключения бота можно удалить архив (null — не удалять). */
export const PURGE_AFTER_DISCONNECT_CHOICES = [null, 7, 30, 90];

/** Допустимые сроки хранения (дней); null — вечно. */
export const RETENTION_CHOICES = [null, 365, 90, 30];

export const EXPORT_MAX_ROWS = 20_000;
/** Потолок файла: лимит Bot API на документ — 50 МБ, держим запас. */
export const EXPORT_FILE_MAX_BYTES = 45 * 1024 * 1024;
export const EXPORT_TOTAL_MAX = 200_000;

/** Частота тяжёлых вызовов на пользователя: [сколько, за сколько мс]. */
export const RATE_LIMITS = {
  file: [120, 60_000], insights: [10, 60_000], stats: [30, 60_000], search: [60, 60_000],
  export: [5, 600_000], exportMedia: [2, 600_000], pin: [30, 60_000], sendToMe: [20, 60_000], reply: [20, 60_000], prepareShare: [20, 60_000],
  clientError: [5, 60_000],
};

export const KEYWORDS_MAX = 50;
export const KEYWORD_MAX_LEN = 64;

// ── time: календарные дни в поясе пользователя
/** @param {Date} at @param {string} tz */
export function tzOffsetMinutes(at, tz) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(at);
  const get = (t) => Number(parts.find((p) => p.type === t)?.value ?? '0');
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return Math.round((asUtc - at.getTime()) / 60_000);
}

/** @param {Date} at @param {string} tz @returns {[number, number, number]} */
export function ymd(at, tz) {
  const [y, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(at).split('-');
  return [Number(y), Number(m), Number(d)];
}

export function midnightOf(y, m, d, tz) {
  const guess = Date.UTC(y, m - 1, d, 0, 0, 0);
  let ts = guess - tzOffsetMinutes(new Date(guess), tz) * 60_000;
  ts = guess - tzOffsetMinutes(new Date(ts), tz) * 60_000;
  return new Date(ts);
}

/** @param {Date} now @param {string} tz @param {number} [daysBack] */
export function startOfDay(now, tz, daysBack = 0) {
  const [y, m, d] = ymd(now, tz);
  return midnightOf(y, m, d - daysBack, tz);
}

/** @param {string} tz */
export function isValidTimeZone(tz) {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}

/** @param {string} input @param {string} tz @param {Date} [now] */
export function parseUserDate(input, tz, now = new Date()) {
  const s = input.trim().toLowerCase();
  if (!s) return null;
  if (s === 'сегодня' || s === 'today') return startOfDay(now, tz);
  if (s === 'вчера' || s === 'yesterday') return startOfDay(now, tz, 1);
  let y, m, d;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  const ru = /^(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2,4}))?$/.exec(s);
  if (iso) { [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])]; }
  else if (ru) {
    d = Number(ru[1]); m = Number(ru[2]);
    const raw = ru[3];
    y = raw === undefined ? ymd(now, tz)[0] : Number(raw.length <= 2 ? `20${raw.padStart(2, '0')}` : raw);
  } else return null;
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1970 || y > 2999) return null;
  const at = midnightOf(y, m, d, tz);
  const [ay, am, ad] = ymd(at, tz);
  return ay === y && am === m && ad === d ? at : null;
}

/** @typedef {'today' | '7d' | '30d' | 'all'} Period */

/** @param {Period} period */
export function periodCutoff(period, tz = 'UTC', now = new Date()) {
  if (period === 'all') return null;
  if (period === '30d') return new Date(now.getTime() - 30 * 86_400_000);
  if (period === '7d') return new Date(now.getTime() - 7 * 86_400_000);
  return startOfDay(now, tz);
}

// ── base64: без btoa/Buffer (их в рантайме платформы нет)
const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** @param {Uint8Array} bytes */
export function bytesToBase64(bytes) {
  let out = '';
  const n = bytes.length;
  for (let i = 0; i < n; i += 3) {
    const a = bytes[i];
    const b = i + 1 < n ? bytes[i + 1] : undefined;
    const c = i + 2 < n ? bytes[i + 2] : undefined;
    out += CHARS[a >> 2];
    out += CHARS[((a & 3) << 4) | (b === undefined ? 0 : b >> 4)];
    out += b === undefined ? '=' : CHARS[((b & 15) << 2) | (c === undefined ? 0 : c >> 6)];
    out += c === undefined ? '=' : CHARS[c & 63];
  }
  return out;
}

/** @param {Uint8Array} bytes @param {string} mime */
export const toDataUrl = (bytes, mime) => `data:${mime || 'application/octet-stream'};base64,${bytesToBase64(bytes)}`;

const INDEX = new Int16Array(128).fill(-1);
for (let i = 0; i < CHARS.length; i++) INDEX[CHARS.charCodeAt(i)] = i;
INDEX['-'.charCodeAt(0)] = 62; INDEX['_'.charCodeAt(0)] = 63;

/** @param {string} s */
export function base64ToBytes(s) {
  const body = String(s).replace(/^data:[^,]*,/, '').replace(/[\s=]+/g, '');
  const out = new Uint8Array(Math.floor((body.length * 3) / 4));
  let o = 0, acc = 0, bits = 0;
  for (let i = 0; i < body.length; i++) {
    const c = body.charCodeAt(i);
    const v = c < 128 ? INDEX[c] : -1;
    if (v < 0) throw new Error('bad base64');
    acc = (acc << 6) | v; bits += 6;
    if (bits >= 8) { bits -= 8; out[o++] = (acc >> bits) & 0xff; }
  }
  return out.subarray(0, o);
}

// ── hash: SHA-256 на чистом JS (crypto.subtle в рантайме не обещан) и растянутый хеш PIN-кода.
// PIN из 4–6 цифр перебирается, главная защита — лимит попыток на сервере.
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01,
  0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08,
  0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** @param {Uint8Array} data @returns {Uint8Array} */
export function sha256(data) {
  const len = data.length;
  const total = Math.ceil((len + 9) / 64) * 64;
  const buf = new Uint8Array(total);
  buf.set(data);
  buf[len] = 0x80;
  const view = new DataView(buf.buffer);
  view.setUint32(total - 4, (len * 8) >>> 0);
  view.setUint32(total - 8, Math.floor((len * 8) / 0x100000000));
  const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const W = new Uint32Array(64);
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) W[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(W[i - 15], 7) ^ rotr(W[i - 15], 18) ^ (W[i - 15] >>> 3);
      const s1 = rotr(W[i - 2], 17) ^ rotr(W[i - 2], 19) ^ (W[i - 2] >>> 10);
      W[i] = (W[i - 16] + s0 + W[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + W[i]) >>> 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
  }
  const out = new Uint8Array(32);
  const ov = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) ov.setUint32(i * 4, H[i]);
  return out;
}

export const toHex = (b) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
const utf8 = (s) => new TextEncoder().encode(s);

/** @param {string} pin @param {string} salt */
export function hashPin(pin, salt, iterations = 20_000) {
  let h = sha256(utf8(`${salt}:${pin}`));
  const s = utf8(salt);
  const block = new Uint8Array(32 + s.length);
  for (let i = 0; i < iterations; i++) { block.set(h); block.set(s, 32); h = sha256(block); }
  return `v1:${iterations}:${toHex(h)}`;
}

/** @param {string} a @param {string} b */
export function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/** Случайная соль (Math.random достаточно: соль не секрет, она против радужных таблиц). */
export function newSalt() {
  const c = /** @type {any} */ (globalThis).crypto;
  const b = new Uint8Array(16);
  if (typeof c?.getRandomValues === 'function') c.getRandomValues(b); else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  return toHex(b);
}

export function checkPin(pin, salt, stored) {
  const m = /^v1:(\d+):[0-9a-f]{64}$/.exec(stored ?? '');
  return !!m && safeEqual(hashPin(pin, salt, Number(m[1])), stored);
}

// ── diff: пословный дифф «было → стало» (LCS по токенам)
/** @param {string} s @returns {string[]} токены: слова и разделители по отдельности */
function tokenize(s) {
  return s.match(/\s+|[^\s]+/g) ?? [];
}

/** @typedef {{ op: 'eq' | 'del' | 'ins', text: string }} DiffPart */

/** @param {string} oldText @param {string} newText @returns {DiffPart[]} */
export function wordDiff(oldText, newText) {
  const a = tokenize(oldText ?? '');
  const b = tokenize(newText ?? '');
  const n = a.length, m = b.length;
  if (n * m > 4_000_000) return [{ op: 'del', text: oldText ?? '' }, { op: 'ins', text: newText ?? '' }];
  const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  /** @type {DiffPart[]} */
  const out = [];
  const push = (op, text) => {
    const last = out[out.length - 1];
    if (last && last.op === op) last.text += text; else out.push({ op, text });
  };
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { push('eq', a[i]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { push('del', a[i]); i++; }
    else { push('ins', b[j]); j++; }
  }
  while (i < n) push('del', a[i++]);
  while (j < m) push('ins', b[j++]);
  return out;
}

// ── buckets: корзины статистики, общие для repo/chats и insights
const DAY = 86_400_000;

/**
 * Смещение кешируется по суткам (Intl на тысячи строк дорог);
 * ошибка возможна лишь в часы перевода стрелок.
 * @param {string} tz
 */
export function localClock(tz) {
  const cache = new Map();
  const offset = (ms) => {
    const k = Math.floor(ms / DAY);
    let o = cache.get(k);
    if (o === undefined) {
      try { o = tzOffsetMinutes(new Date(ms), tz); } catch { o = 0; }
      cache.set(k, o);
    }
    return o;
  };
  /** @param {number} ms */
  return (ms) => {
    const d = new Date(ms + offset(ms) * 60_000);
    const y = d.getUTCFullYear(), m = d.getUTCMonth() + 1, day = d.getUTCDate();
    return {
      key: `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
      /** Понедельник = 0. */
      weekday: (d.getUTCDay() + 6) % 7,
      hour: d.getUTCHours(),
      dayNo: Math.floor(Date.UTC(y, m - 1, day) / DAY),
    };
  };
}

export const TTD_BUCKETS = [
  { max: 10_000, key: 's10' },
  { max: 60_000, key: 'm1' },
  { max: 10 * 60_000, key: 'm10' },
  { max: 3_600_000, key: 'h1' },
  { max: DAY, key: 'd1' },
  { max: 7 * DAY, key: 'w1' },
  { max: Infinity, key: 'over' },
];

/** @param {string | null} t */
export function typeGroup(t) {
  if (!t) return 'text';
  if (t === 'photo' || t === 'live_photo') return 'photo';
  if (t === 'video' || t === 'animation' || t === 'video_note') return 'video';
  if (t === 'voice') return 'voice';
  if (t === 'audio') return 'audio';
  if (t === 'sticker') return 'sticker';
  if (t === 'document') return 'document';
  return 'other';
}
