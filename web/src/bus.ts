// Шина изменений между экранами: экраны стека не размонтируются, остальным нужно сообщать об изменениях.
import { useEffect, useRef } from 'react';

export type BusEvent =
  | { type: 'eventDeleted'; id: number }
  | { type: 'favorite'; id: number; value: boolean }
  | { type: 'muted'; chatId: number; value: boolean }
  /** Удалена часть истории чата (за сегодня / 3 дня) — списки перезагружаются. */
  | { type: 'historyDeleted'; chatId: number }
  /** Переписка удалена целиком — чата больше нет: его экраны закрываются, события убираются. */
  | { type: 'chatDeleted'; chatId: number }
  | { type: 'wiped' };

const subs = new Set<(e: BusEvent) => void>();

export function emit(e: BusEvent) {
  for (const s of [...subs]) s(e);
}

export function useBus(fn: (e: BusEvent) => void) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    const h = (e: BusEvent) => ref.current(e);
    subs.add(h);
    return () => { subs.delete(h); };
  }, []);
}
