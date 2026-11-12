// Telegram.WebApp подменяется до импорта модулей: telegram.ts читает его при загрузке.
import { afterEach, beforeEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import { webApp, resetServerless } from './tg';

(window as unknown as { Telegram: unknown }).Telegram = { WebApp: webApp };

beforeEach(() => resetServerless());
afterEach(() => {
  cleanup();
  try { localStorage.clear(); } catch { /* jsdom без storage */ }
});
