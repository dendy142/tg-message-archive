import { test, expect, openApp, calls } from './fixtures';
import type { Page } from '@playwright/test';

const shown = (page: Page, text: string | RegExp) => page.getByText(text).filter({ visible: true }).first();

test('онбординг: пропуск группы → лента', async ({ page }) => {
  await openApp(page, { onboarded: false });
  await page.getByRole('button', { name: 'Пропустить' }).click();
  await expect(page.getByText('Это сообщение потом удалили')).toBeVisible();
  expect((await calls(page, 'settings')).some((c) => c.input.markOnboarded)).toBe(true);
});

test('карточка события с диффом правки', async ({ page }) => {
  await openApp(page);
  await shown(page, 'Встречаемся в пятницу').click();
  await expect(page.locator('.diff del', { hasText: 'четверг' })).toBeVisible();
  await expect(page.locator('.diff ins', { hasText: 'пятницу' })).toBeVisible();
});

test('переписка: подгрузка вверх и фильтр', async ({ page }) => {
  await openApp(page);
  await page.getByRole('button', { name: 'Чаты' }).click();
  await page.getByRole('button', { name: /^Иван Петров/ }).filter({ visible: true }).click();
  await expect(page.getByText('Сообщение №120')).toBeVisible();
  for (let i = 0; i < 10 && !(await page.getByText('Сообщение №1', { exact: true }).isVisible()); i++) {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(300);
  }
  await expect(page.getByText('Сообщение №1', { exact: true })).toBeAttached();
  expect((await calls(page, 'chatHistory')).some((c) => c.input.before)).toBe(true);
  await page.getByRole('tab', { name: 'Удалённые' }).filter({ visible: true }).click();
  await expect(shown(page, 'Это сообщение потом удалили')).toBeVisible();
  await expect(page.getByText('Сообщение №120')).toHaveCount(0);
  expect((await calls(page, 'chatHistory')).at(-1)?.input.filter).toBe('deleted');
});

test('настройки: переключатель и ключевые слова', async ({ page }) => {
  await openApp(page);
  await page.getByRole('button', { name: 'Настройки' }).click();
  await page.getByRole('switch', { name: 'Уведомления' }).click();
  await expect.poll(async () => (await calls(page, 'settings')).some((c) => c.input.notificationsEnabled === false)).toBe(true);
  await page.getByText('Ключевые слова').click();
  await expect(page.locator('.sheet')).toBeVisible();
});

test('просмотрщик фото', async ({ page }) => {
  await openApp(page);
  await shown(page, 'Фото с моря').click();
  await page.getByRole('button', { name: 'Открыть на весь экран' }).filter({ visible: true }).click();
  await expect(page.locator('.viewer')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.viewer')).toHaveCount(0);
});

test('профиль: удалить переписку целиком вместе с копиями в группе', async ({ page }) => {
  await openApp(page);
  await page.getByRole('button', { name: 'Чаты' }).click();
  await page.getByRole('button', { name: /^Иван Петров/ }).filter({ visible: true }).click();
  await page.getByRole('button', { name: 'Меню' }).filter({ visible: true }).click();
  await page.getByText('Профиль собеседника').click();
  await shown(page, 'Удалить переписку').click();
  await page.getByText('Удалить и копии в группе-архиве').click();
  await expect.poll(async () => (await calls(page, 'action')).find((c) => c.input.type === 'deleteChat')?.input)
    .toEqual({ type: 'deleteChat', chatId: 555, archive: true, confirm: 'DELETE_CHAT' });
  await expect(shown(page, 'Мария')).toBeVisible();
  await expect(page.getByRole('button', { name: /^Иван Петров/ }).filter({ visible: true })).toHaveCount(0);
  await expect(page.getByText('Переписка и копии в группе удалены', { exact: false })).toBeVisible();
});
