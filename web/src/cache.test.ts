import { describe, it, expect } from 'vitest';
import { readCache, writeCache, setCacheEnabled, clearCache } from './cache';

describe('cache', () => {
  it('читает свежее, забывает через 10 минут', () => {
    writeCache('feed', { a: 1 }, 1000);
    expect(readCache('feed', 1000 + 60_000)).toEqual({ a: 1 });
    expect(readCache('feed', 1000 + 11 * 60_000)).toBeNull();
  });

  it('ключ привязан к пользователю Telegram', () => {
    writeCache('feed', 1);
    expect(Object.keys(localStorage).some((k) => k.includes('cache.7.feed'))).toBe(true);
  });

  it('выключение (замок) стирает и не пишет', () => {
    writeCache('feed', 1);
    setCacheEnabled(false);
    expect(readCache('feed')).toBeNull();
    writeCache('feed', 2);
    setCacheEnabled(true);
    expect(readCache('feed')).toBeNull();
    writeCache('x', 3);
    clearCache();
    expect(readCache('x')).toBeNull();
  });
});
