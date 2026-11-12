// Кеш ответов на устройстве. При включённом замке не пишется и стирается: архив не должен лежать открытым.
import { tg } from './telegram';
import { getItem, setItem, removeByPrefix } from './storage';

const TTL = 10 * 60_000;
let enabled = true;

const prefix = () => `cache.${tg?.initDataUnsafe?.user?.id ?? 'anon'}.`;

export function setCacheEnabled(on: boolean) {
  enabled = on;
  if (!on) clearCache();
}

export function readCache<T>(key: string, now = Date.now()): T | null {
  if (!enabled) return null;
  const v = getItem<{ at: number; data: T }>(prefix() + key);
  if (!v || typeof v.at !== 'number' || now - v.at > TTL) return null;
  return v.data;
}

export function writeCache(key: string, data: unknown, now = Date.now()) {
  if (enabled) setItem(prefix() + key, { at: now, data });
}

export function clearCache() { removeByPrefix(prefix()); }
