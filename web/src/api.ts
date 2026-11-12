// initData добавляет и проверяет платформа. Таймаут; повтор только для читающих запросов.
import { tg } from './telegram';
import { t } from './i18n';

export class ApiError extends Error {
  code: string;
  type: string;
  parameters: Record<string, unknown>;
  constructor(message: string, type: string, parameters: Record<string, unknown>) {
    super(message);
    this.type = type;
    this.parameters = parameters;
    this.code = String(parameters?.code ?? type);
  }
}

const READ_ONLY = new Set(['bootstrap', 'feed', 'chats', 'chatHistory', 'event', 'media', 'search', 'stats', 'insights', 'contact', 'file']);
export const TIMEOUT_MS = 20_000;

function callOnce<T>(name: string, input: Record<string, unknown>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const sl = tg?.Serverless;
    if (!sl) { reject(new ApiError(t('app.error.openInTelegram'), 'NO_RUNTIME', {})); return; }
    let done = false;
    const timer = setTimeout(() => { if (!done) { done = true; reject(new ApiError(t('app.error.timeout'), 'TIMEOUT', {})); } }, timeoutMs);
    sl.call(name, input, (err, res) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (err) { reject(new ApiError(err.message || t('ui.error.generic'), err.type || 'ERROR', err.parameters ?? {})); return; }
      resolve(res as T);
    });
  });
}

const retriable = (e: unknown) => e instanceof ApiError && (e.type === 'TIMEOUT' || e.type === 'NETWORK_ERROR' || e.type === 'ERROR');

export async function call<T = unknown>(name: string, input: Record<string, unknown> = {}, opts: { timeoutMs?: number } = {}): Promise<T> {
  const timeout = opts.timeoutMs ?? TIMEOUT_MS;
  try {
    return await callOnce<T>(name, input, timeout);
  } catch (e) {
    if (!READ_ONLY.has(name) || !retriable(e)) throw e;
    return callOnce<T>(name, input, timeout);
  }
}
