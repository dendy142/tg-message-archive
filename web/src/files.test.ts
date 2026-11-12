import { describe, it, expect, vi, beforeAll } from 'vitest';
import { loadThumb, loadFull, cachedFull } from './files';
import { serverless } from './test/tg';

const PIXEL = 'data:image/png;base64,iVBORw0KGgo=';

beforeAll(() => {
  let n = 0;
  URL.createObjectURL = vi.fn(() => `blob:test/${++n}`);
  URL.revokeObjectURL = vi.fn();
});

describe('files', () => {
  it('миниатюры: очередь ≤ 4 параллельных, повтор id — из кеша', async () => {
    let active = 0, peak = 0;
    const release: (() => void)[] = [];
    serverless.handler = () => new Promise((resolve) => {
      active++; peak = Math.max(peak, active);
      release.push(() => { active--; resolve({ dataUrl: PIXEL }); });
    });
    let done = false;
    const all = Promise.all(Array.from({ length: 10 }, (_, i) => loadThumb(100 + i))).finally(() => { done = true; });
    for (let i = 0; i < 100 && !done; i++) {
      await new Promise((r) => setTimeout(r, 0));
      release.shift()?.();
    }
    await all;
    expect(peak).toBe(4);
    expect(serverless.calls).toHaveLength(10);
    await loadThumb(100);
    expect(serverless.calls).toHaveLength(10);
  });

  it('полные файлы: держим 8 последних, вытесненный blob освобождается', async () => {
    serverless.handler = () => ({ dataUrl: PIXEL });
    const urls: string[] = [];
    for (let i = 0; i < 9; i++) urls.push(await loadFull(i));
    expect(urls.every((u) => u.startsWith('blob:'))).toBe(true);
    expect(cachedFull(0)).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(urls[0]);
    expect(cachedFull(8)).toBe(urls[8]);
    await loadFull(1);
    await loadFull(9);
    expect(cachedFull(1)).toBe(urls[1]);
    expect(cachedFull(2)).toBeNull();
  });
});
