// Endpoint file отдаёт base64 (≤20 МБ). Миниатюры — не больше 4 запросов разом.
// Полные файлы — blob-URL: iOS не перематывает видео из data:-URL.
import { call, ApiError } from './api';
import { decodeOpusToWav } from './voice';
import { t } from './i18n';

const thumbs = new Map<number, string>();
const fulls = new Map<number, string>();
const wavs = new Map<number, string>();
const inflight = new Map<string, Promise<string>>();
const MAX_FULL = 8;
const MAX_PARALLEL = 4;

let active = 0;
const queue: (() => void)[] = [];
function limited<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const run = () => {
      active++;
      fn().then(resolve, reject).finally(() => { active--; queue.shift()?.(); });
    };
    if (active < MAX_PARALLEL) run(); else queue.push(run);
  });
}

function once(key: string, fn: () => Promise<string>): Promise<string> {
  const hit = inflight.get(key);
  if (hit) return hit;
  const p = fn().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

function remember(map: Map<number, string>, id: number, url: string) {
  map.set(id, url);
  while (map.size > MAX_FULL) {
    const [oldId, oldUrl] = map.entries().next().value as [number, string];
    map.delete(oldId);
    if (oldUrl.startsWith('blob:')) URL.revokeObjectURL(oldUrl);
  }
}

async function toBlobUrl(dataUrl: string): Promise<string> {
  try { return URL.createObjectURL(await (await fetch(dataUrl)).blob()); } catch { return dataUrl; }
}

export const cachedThumb = (id: number) => thumbs.get(id) ?? null;

/** Фото собеседника: null — фото нет или Telegram не отдал, повторно не спрашиваем. */
const avatars = new Map<number, string | null>();
export const cachedAvatar = (chatId: number) => avatars.get(chatId);
export function loadAvatar(chatId: number): Promise<string | null> {
  if (avatars.has(chatId)) return Promise.resolve(avatars.get(chatId) ?? null);
  return once(`a${chatId}`, () => limited(() => call<{ dataUrl: string }>('file', { kind: 'avatar', chatId }))
    .then((r) => r.dataUrl, () => '')).then((u) => { avatars.set(chatId, u || null); return u; }).then((u) => u || null);
}
export const cachedFull = (id: number) => fulls.get(id) ?? null;

export function loadThumb(id: number): Promise<string> {
  const hit = thumbs.get(id);
  if (hit) return Promise.resolve(hit);
  return once(`t${id}`, () => limited(() => call<{ dataUrl: string }>('file', { id, kind: 'thumb' }))
    .then((r) => { thumbs.set(id, r.dataUrl); return r.dataUrl; }));
}

export function loadFull(id: number): Promise<string> {
  const hit = fulls.get(id);
  if (hit) { fulls.delete(id); fulls.set(id, hit); return Promise.resolve(hit); }
  return once(`f${id}`, async () => {
    const r = await call<{ dataUrl: string }>('file', { id, kind: 'full' });
    const url = await toBlobUrl(r.dataUrl);
    remember(fulls, id, url);
    return url;
  });
}

let oggSupport: boolean | null = null;
/** Умеет ли вебвью сам играть OGG/Opus (Android, Desktop — да; iOS — обычно нет). */
export function canPlayOgg(): boolean {
  if (oggSupport == null) {
    try { oggSupport = document.createElement('audio').canPlayType('audio/ogg; codecs="opus"') !== ''; } catch { oggSupport = false; }
  }
  return oggSupport;
}

export function loadVoiceWav(id: number): Promise<string> {
  const hit = wavs.get(id);
  if (hit) return Promise.resolve(hit);
  return once(`w${id}`, async () => {
    const src = await loadFull(id);
    const buf = await (await fetch(src)).arrayBuffer();
    const wav = await decodeOpusToWav(new Uint8Array(buf));
    const url = URL.createObjectURL(new Blob([wav], { type: 'audio/wav' }));
    remember(wavs, id, url);
    return url;
  });
}

export function fileErrorText(e: unknown): string {
  const code = e instanceof ApiError ? e.code : '';
  if (code === 'TOO_LARGE') return t('viewer.file.tooLarge');
  if (code === 'EXPIRED') return t('viewer.file.expired');
  if (code === 'NO_PREVIEW') return t('viewer.file.noPreview');
  return t('viewer.file.failed');
}
