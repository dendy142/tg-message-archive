import { test, expect, openApp } from './fixtures';
import type { Page } from '@playwright/test';

const uiText = (page: Page) => page.evaluate(() => {
  const data = ['Иван Петров', 'Мария', 'ИП', 'М', 'Это сообщение потом удалили', 'Встречаемся в пятницу', 'Встречаемся в четверг', 'Фото с моря', 'Тест'];
  let s = document.body.innerText;
  for (const d of data) s = s.split(d).join('');
  return s.replace(/Сообщение №\d+/g, '');
});
const cyrillic = (s: string) => s.match(/[А-Яа-яЁё]+/g) ?? [];

test('интерфейс на английском', async ({ page }) => {
  await openApp(page, { lang: 'en' });
  await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible();
  await expect(page.getByText('Это сообщение потом удалили').filter({ visible: true }).first()).toBeVisible();
  expect(cyrillic(await uiText(page))).toEqual([]);

  await page.getByRole('button', { name: 'Chats' }).click();
  await page.getByRole('button', { name: /^Иван Петров/ }).filter({ visible: true }).click();
  await expect(page.getByText('Сообщение №120')).toBeVisible();
  expect(cyrillic(await uiText(page))).toEqual([]);

  await page.goBack().catch(() => {});
  await openApp(page, { lang: 'en' });
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByText('Language')).toBeVisible();
  expect(cyrillic(await uiText(page))).toEqual([]);
});
