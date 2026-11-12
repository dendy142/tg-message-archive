import { test as base, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

const read = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8');
const MOCK = read('./mock-telegram.js');
const FIXTURES = {
  bootstrap: JSON.parse(read('./fixtures/bootstrap.json')),
  events: JSON.parse(read('./fixtures/events.json')),
  chats: JSON.parse(read('./fixtures/chats.json')),
};

export async function openApp(page: Page, opts: { onboarded?: boolean; lang?: 'ru' | 'en' } = {}) {
  const lang = opts.lang ?? 'ru';
  const bootstrap = { ...FIXTURES.bootstrap, settings: { ...FIXTURES.bootstrap.settings, lang } };
  await page.addInitScript((f) => { (window as unknown as { __FIXTURES: unknown }).__FIXTURES = f; }, { ...FIXTURES, bootstrap, lang, onboarded: opts.onboarded ?? true });
  await page.route('https://telegram.org/js/telegram-web-app.js*', (r) => r.fulfill({ contentType: 'application/javascript', body: MOCK }));
  await page.goto('/');
}

export const calls = (page: Page, name?: string) =>
  page.evaluate((n) => (window as unknown as { __calls: { name: string; input: Record<string, unknown> }[] }).__calls.filter((c) => !n || c.name === n), name);

export { base as test, expect };
