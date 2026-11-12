// localStorage в приватном режиме и превью бросает или пуст: только удобства устройства.
import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';

export function getItem<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? null : (JSON.parse(raw) as T);
  } catch { return null; }
}

export function setItem(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* приватный режим / нет места */ }
}

export function removeItem(key: string): void {
  try { localStorage.removeItem(key); } catch { /* нет доступа */ }
}

export function removeByPrefix(prefix: string): void {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k?.startsWith(prefix)) localStorage.removeItem(k);
    }
  } catch { /* нет доступа */ }
}

export const isSnoozed = (key: string, now = Date.now()) => (getItem<number>(key) ?? 0) > now;
export const snooze = (key: string, ms: number, now = Date.now()) => setItem(key, now + ms);

export function usePersistent<T>(key: string, initial: T, valid?: (v: unknown) => v is T): [T, Dispatch<SetStateAction<T>>] {
  const [v, setV] = useState<T>(() => {
    const saved = getItem<T>(`ui.${key}`);
    return saved != null && (!valid || valid(saved)) ? saved : initial;
  });
  useEffect(() => { setItem(`ui.${key}`, v); }, [key, v]);
  return [v, setV];
}
