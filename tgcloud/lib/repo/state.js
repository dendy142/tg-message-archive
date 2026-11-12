// Состояние: настройки, app_meta, дедуп апдейтов, capabilities, ts-сравнения
import { db } from 'sdk';
import { sql, and, eq } from 'sdk/db';
import { langFromCode, normLang } from '../i18n.js';
import { DEFAULT_TZ } from '../util.js';
import { connections, settings, chatPrefs, notifBatches, processedUpdates, appMeta } from '../../schema.js';

// ── repo/ts: сравнения по времени
// В WHERE платформа принимает только числа, libsql в тестах — Date; верен лишь сырой sql с числом
const ms = (d) => (d == null ? null : d instanceof Date ? d.getTime() : Number(d));

export const tsGte = (col, d) => sql`${col} >= ${ms(d)}`;
export const tsGt = (col, d) => sql`${col} > ${ms(d)}`;
export const tsLt = (col, d) => sql`${col} < ${ms(d)}`;
export const tsLte = (col, d) => sql`${col} <= ${ms(d)}`;

export const beforeTs = (col, idCol, k, id) => sql`(${col} < ${Number(k)} or (${col} = ${Number(k)} and ${idCol} < ${Number(id)}))`;

export const afterTs = (col, idCol, k, id) => sql`(${col} > ${Number(k)} or (${col} = ${Number(k)} and ${idCol} > ${Number(id)}))`;

// Флаги литералами, не параметрами: частичный индекс SQLite применяет,
// только если условие стоит в запросе буквально.
export const isSet = (col) => sql`${col} = 1`;
export const notSet = (col) => sql`${col} = 0`;
export const positive = (col) => sql`${col} > 0`;

// ── repo/state: подключения, настройки, флаги чатов, пачки уведомлений, служебные значения

/** @param {any} bc */
export function connectionFromApi(bc) {
  return {
    businessConnectionId: bc.id,
    ownerUserId: Number(bc.user_chat_id ?? bc.user?.id),
    isEnabled: bc.is_enabled ?? true,
    canReply: !!bc.rights?.can_reply,
    canRead: !!bc.rights?.can_read_messages,
    rights: bc.rights ?? null,
  };
}

/** @param {ReturnType<typeof connectionFromApi>} v */
export async function upsertConnection(v, now = new Date()) {
  await db.insert(connections).values({ ...v, createdAt: now, updatedAt: now }).onConflictDoUpdate({
    target: connections.businessConnectionId,
    set: { ownerUserId: v.ownerUserId, isEnabled: v.isEnabled, canReply: v.canReply, canRead: v.canRead, rights: v.rights ?? null, updatedAt: now },
  });
}

/** @param {string} id */
export async function getConnection(id) {
  return (await db.select().from(connections).where(eq(connections.businessConnectionId, id)).get()) ?? null;
}

export async function connectionsOf(ownerUserId) {
  const rows = await db.select().from(connections).where(eq(connections.ownerUserId, ownerUserId)).all();
  return rows.sort((a, b) => Number(b.isEnabled) - Number(a.isEnabled) || new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

/** @typedef {typeof settings.$inferSelect} SettingsRow */

/** @returns {Promise<SettingsRow>} */
export async function ensureSettings(ownerUserId) {
  const existing = await db.select().from(settings).where(eq(settings.ownerUserId, ownerUserId)).get();
  if (existing) return existing;
  // Пояс задаём явно: значение по умолчанию у колонки в уже созданной базе может быть другим.
  await db.insert(settings).values({ ownerUserId, timezone: DEFAULT_TZ, updatedAt: new Date() }).onConflictDoNothing();
  return /** @type {SettingsRow} */ (await db.select().from(settings).where(eq(settings.ownerUserId, ownerUserId)).get());
}

/**
 * Язык без создания строки настроек: нет строки — по language_code, иначе ru.
 * @param {number} ownerUserId @param {string | null} [code]
 */
export async function langOf(ownerUserId, code = null) {
  const row = await db.select({ lang: settings.lang }).from(settings).where(eq(settings.ownerUserId, ownerUserId)).get();
  return row ? normLang(row.lang) : code ? langFromCode(code) : 'ru';
}

/** @param {number} ownerUserId @param {Partial<SettingsRow>} patch */
export async function updateSettings(ownerUserId, patch) {
  await ensureSettings(ownerUserId);
  const [row] = await db.update(settings).set({ ...patch, updatedAt: new Date() }).where(eq(settings.ownerUserId, ownerUserId)).returning();
  return row;
}

export async function chatPref(ownerUserId, chatId) {
  return (await db.select().from(chatPrefs).where(and(eq(chatPrefs.ownerUserId, ownerUserId), eq(chatPrefs.chatId, chatId))).get()) ?? null;
}

export async function countExcluded(ownerUserId) {
  return db.$count(chatPrefs, and(eq(chatPrefs.ownerUserId, ownerUserId), eq(chatPrefs.excluded, true)));
}

export async function isMuted(ownerUserId, chatId) {
  return !!(await chatPref(ownerUserId, chatId))?.muted;
}

/** @param {{ muted?: boolean, autoRead?: boolean, excluded?: boolean }} patch */
export async function setChatPref(ownerUserId, chatId, patch) {
  const now = new Date();
  await db.insert(chatPrefs).values({ ownerUserId, chatId, muted: false, autoRead: false, excluded: false, ...patch, updatedAt: now })
    .onConflictDoUpdate({ target: [chatPrefs.ownerUserId, chatPrefs.chatId], set: { ...patch, updatedAt: now } });
  return chatPref(ownerUserId, chatId);
}

export async function toggleMute(ownerUserId, chatId) {
  const next = !(await isMuted(ownerUserId, chatId));
  await setChatPref(ownerUserId, chatId, { muted: next });
  return next;
}

export const BATCH_WINDOW_MS = 60_000;
/** Потолок жизни пачки: иначе ручеёк удалений вечно дописывался бы в давно пролистанное сообщение. */
export const BATCH_MAX_AGE_MS = 10 * 60_000;

export async function openBatch(ownerUserId, chatId, kind, now = new Date()) {
  return (await db.select().from(notifBatches).where(and(
    eq(notifBatches.ownerUserId, ownerUserId),
    eq(notifBatches.chatId, chatId),
    eq(notifBatches.kind, kind),
    tsGte(notifBatches.updatedAt, now.getTime() - BATCH_WINDOW_MS),
    tsGte(notifBatches.startedAt, now.getTime() - BATCH_MAX_AGE_MS),
  )).get()) ?? null;
}

/** @param {{ ownerUserId: number, chatId: number, kind: string, messageId: number, count: number }} v */
export async function startBatch(v, now = new Date()) {
  await db.insert(notifBatches).values({ ...v, startedAt: now, updatedAt: now }).onConflictDoUpdate({
    target: [notifBatches.ownerUserId, notifBatches.chatId, notifBatches.kind],
    set: { messageId: v.messageId, count: v.count, startedAt: now, updatedAt: now },
  });
}

export async function touchBatch(ownerUserId, chatId, kind, count, now = new Date()) {
  await db.update(notifBatches).set({ count, updatedAt: now }).where(and(
    eq(notifBatches.ownerUserId, ownerUserId), eq(notifBatches.chatId, chatId), eq(notifBatches.kind, kind),
  ));
}

export async function dropBatch(ownerUserId, chatId, kind) {
  await db.delete(notifBatches).where(and(
    eq(notifBatches.ownerUserId, ownerUserId), eq(notifBatches.chatId, chatId), eq(notifBatches.kind, kind),
  ));
}

/** Сколько храним отметки (Telegram повторяет доставку максимум сутки). */
export const UPDATE_TTL_MS = 24 * 3600 * 1000;
/** Через сколько «занятый», но не завершённый апдейт снова можно взять: лучше дубль, чем пропажа. */
export const CLAIM_TTL_MS = 10 * 60 * 1000;

/** Занимает апдейт: true — обрабатываем, false — это повтор доставки. @param {number} updateId */
export async function claimUpdate(updateId, now = new Date()) {
  const existing = await db.select().from(processedUpdates).where(eq(processedUpdates.updateId, updateId)).get();
  if (existing && new Date(existing.createdAt).getTime() > now.getTime() - CLAIM_TTL_MS) return false;
  if (existing) {
    await db.update(processedUpdates).set({ createdAt: now }).where(eq(processedUpdates.updateId, updateId));
    return true;
  }
  const inserted = await db.insert(processedUpdates).values({ updateId, createdAt: now }).onConflictDoNothing().returning();
  return inserted.length > 0;
}

/** Снимает отметку, если обработка упала, — повторную доставку надо принять. */
export async function releaseUpdate(updateId) {
  await db.delete(processedUpdates).where(eq(processedUpdates.updateId, updateId));
}

export async function purgeOldUpdates(olderThan = new Date(Date.now() - UPDATE_TTL_MS)) {
  await db.delete(processedUpdates).where(tsLt(processedUpdates.createdAt, olderThan));
}

export async function getMeta(key) {
  return (await db.select().from(appMeta).where(eq(appMeta.key, key)).get())?.value ?? null;
}

export async function setMeta(key, value) {
  const now = new Date();
  await db.insert(appMeta).values({ key, value, updatedAt: now }).onConflictDoUpdate({ target: appMeta.key, set: { value, updatedAt: now } });
}

export async function delMeta(key) {
  await db.delete(appMeta).where(eq(appMeta.key, key));
}

/**
 * Язык по language_code, пока не выбран вручную; возвращает актуальные настройки.
 * @param {number} owner @param {any} s настройки @param {string | null | undefined} code
 */
export async function syncLang(owner, s, code) {
  if (s.langSource === 'manual' || !code) return s;
  const lang = langFromCode(code);
  if (s.lang === lang && s.langSource === 'auto') return s;
  return updateSettings(owner, { lang, langSource: 'auto' });
}

// ── capabilities: что умеет рантайм
// Пробы кешируются в app_meta, selftest пересчитывает после деплоя; код спрашивает здесь
const KEY = 'capabilities';
/** Версия набора проб: при добавлении новой кеш пересчитывается. */
const VERSION = 1;

/** @typedef {{ v: number, fts5: boolean, subtle: boolean, checkedAt: number }} Caps */

async function probeFts5() {
  try {
    await db.run(sql.raw('CREATE VIRTUAL TABLE IF NOT EXISTS _probe_fts USING fts5(t)'));
    await db.run(sql.raw('DROP TABLE IF EXISTS _probe_fts'));
    return true;
  } catch {
    return false;
  }
}

async function probeSubtle() {
  try {
    const c = /** @type {any} */ (globalThis).crypto;
    if (typeof c?.subtle?.digest !== 'function') return false;
    await c.subtle.digest('SHA-256', new TextEncoder().encode('x'));
    return true;
  } catch {
    return false;
  }
}

/** @returns {Promise<Caps>} */
export async function refreshCapabilities(now = Date.now()) {
  const caps = { v: VERSION, fts5: await probeFts5(), subtle: await probeSubtle(), checkedAt: now };
  await setMeta(KEY, JSON.stringify(caps));
  memo = caps;
  return caps;
}

/** @type {Caps | null} */
let memo = null;

/** @returns {Promise<Caps>} */
export async function capabilities() {
  if (memo) return memo;
  const raw = await getMeta(KEY);
  if (raw) {
    try {
      const c = JSON.parse(raw);
      if (c?.v === VERSION) { memo = c; return c; }
    } catch { /* пересчитаем */ }
  }
  return refreshCapabilities();
}

export function resetCapabilitiesMemo() { memo = null; }
