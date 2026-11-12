import { describe, it, expect, vi, afterEach } from 'vitest';
import { call, ApiError, TIMEOUT_MS } from './api';
import { serverless, NEVER } from './test/tg';

afterEach(() => vi.useRealTimers());

describe('call', () => {
  it('ответ и EndpointError с кодом', async () => {
    serverless.handler = (name) => { if (name === 'action') throw { message: 'Нельзя', type: 'ENDPOINT_ERROR', parameters: { code: 'BUSY' } }; return { ok: 1 }; };
    expect(await call('feed')).toEqual({ ok: 1 });
    const e = await call('action').catch((x) => x);
    expect(e).toBeInstanceOf(ApiError);
    expect(e).toMatchObject({ message: 'Нельзя', type: 'ENDPOINT_ERROR', code: 'BUSY' });
    expect(serverless.calls.filter((c) => c.name === 'action')).toHaveLength(1);
  });

  it('таймаут читающего запроса — один повтор', async () => {
    vi.useFakeTimers();
    let n = 0;
    serverless.handler = () => (++n === 1 ? NEVER : { items: [] });
    const p = call('feed');
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS + 1);
    expect(await p).toEqual({ items: [] });
    expect(n).toBe(2);
  });

  it('пишущий запрос по таймауту не повторяется', async () => {
    vi.useFakeTimers();
    serverless.handler = () => NEVER;
    const p = call('action', { type: 'wipeAll' }).catch((x) => x);
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS + 1);
    expect(await p).toMatchObject({ type: 'TIMEOUT' });
    expect(serverless.calls).toHaveLength(1);
  });
});
