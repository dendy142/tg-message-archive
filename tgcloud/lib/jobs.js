// Удаление данных и фоновые задачи
import { db, api, BotApiError } from 'sdk';
import { and, eq, isNotNull, sql, asc } from 'sdk/db';
import { settings, connections, archives, archiveTopics, chatPrefs, rateLimits, jobs } from '../schema.js';
import { wipeOwnerArchive, purgeChat, mediaPage, countMedia, chatTitle } from './repo/messages.js';
import { clearOutbox, clearChatOutbox, GLOBAL_TASKS, report } from './runtime.js';
import { tsLt, ensureSettings, langOf } from './repo/state.js';
import { deleteChatTopic } from './archive.js';
import { SEND_METHOD, FILE_FIELD, NO_CAPTION } from './media.js';
import { formatTime } from './text.js';
import { t } from './i18n.js';

/**
 * Счётчики лимитов чистим здесь же: lib/runtime.js сам импортируется отсюда,
 * обратный импорт дал бы цикл.
 * @type {((ownerUserId: number) => Promise<unknown>)[]}
 */
export const ERASERS = [(owner) => db.delete(rateLimits).where(eq(rateLimits.ownerUserId, owner))];

/** @type {((ownerUserId: number, chatId: number) => Promise<unknown>)[]} */
export const CHAT_ERASERS = [];

/**
 * Тему архива удаляем первой: если не выйдет, переписка всё равно удаляется,
 * а владелец узнаёт об оставшихся копиях.
 * @param {number} ownerUserId @param {number} chatId @param {{ archive?: boolean }} [opts]
 * @returns {Promise<{ removed: number, archive: 'deleted' | 'kept' | 'none' }>}
 */
export async function eraseChat(ownerUserId, chatId, opts = {}) {
  const archive = opts.archive ? await deleteChatTopic(ownerUserId, chatId) : 'none';
  const removed = await purgeChat(ownerUserId, chatId);
  await clearChatOutbox(ownerUserId, chatId);
  for (const fn of CHAT_ERASERS) await fn(ownerUserId, chatId);
  return { removed, archive };
}

/** @returns {Promise<number>} сколько сообщений удалено */
export async function eraseOwner(ownerUserId) {
  const removed = await wipeOwnerArchive(ownerUserId);
  await clearOutbox(ownerUserId);
  for (const fn of ERASERS) await fn(ownerUserId);
  await db.delete(chatPrefs).where(eq(chatPrefs.ownerUserId, ownerUserId));
  await db.delete(archiveTopics).where(eq(archiveTopics.ownerUserId, ownerUserId));
  await db.delete(archives).where(eq(archives.ownerUserId, ownerUserId));
  await db.delete(connections).where(eq(connections.ownerUserId, ownerUserId));
  await db.delete(settings).where(eq(settings.ownerUserId, ownerUserId));
  return removed;
}

export async function duePurges(now = new Date(), limit = 5) {
  const rows = await db.select({ owner: settings.ownerUserId, days: settings.purgeAfterDisconnectDays, at: settings.disconnectedAt })
    .from(settings)
    .where(and(isNotNull(settings.purgeAfterDisconnectDays), isNotNull(settings.disconnectedAt),
      tsLt(settings.disconnectedAt, now.getTime() - 7 * 86_400_000)))
    .limit(limit * 4).all();
  return rows
    .filter((r) => new Date(/** @type {any} */ (r.at)).getTime() + Number(r.days) * 86_400_000 <= now.getTime())
    .slice(0, limit).map((r) => Number(r.owner));
}

/** @type {((owner: number) => Promise<unknown>) | null} уведомление «архив удалён» (ставит lib/events.js, раздел notify). */
let onPurged = null;
export function setPurgeNotifier(fn) { onPurged = fn; }

GLOBAL_TASKS.push({
  name: 'purge_disconnected',
  run: async (now) => {
    for (const owner of await duePurges(now)) {
      // Сначала сообщаем (пока есть кому), потом стираем.
      await Promise.resolve(onPurged?.(owner)).catch(() => {});
      await eraseOwner(owner);
    }
  },
});

/** @param {number} ownerUserId @param {boolean} enabled */
export async function markConnectionState(ownerUserId, enabled, now = new Date()) {
  await db.update(settings).set({ disconnectedAt: enabled ? null : sql`coalesce(${settings.disconnectedAt}, ${now.getTime()})` })
    .where(eq(settings.ownerUserId, ownerUserId));
}

const BATCH = 10;
const ALBUM = { photo: 'visual', live_photo: 'visual', video: 'visual', document: 'document', audio: 'audio' };
const INPUT = { photo: 'photo', live_photo: 'photo', video: 'video', document: 'document', audio: 'audio' };

const jobView = (j) => ({ id: j.id, kind: j.kind, params: j.params, done: j.done, total: j.total, status: j.status, error: j.error });

export async function activeJobs(owner) {
  return (await db.select().from(jobs).where(and(eq(jobs.ownerUserId, owner), eq(jobs.status, 'active'))).all()).map(jobView);
}

/** @param {number} owner @param {{ chatId: number, group?: string, deletedOnly?: boolean }} p */
export async function startMediaExport(owner, p, now = new Date()) {
  const busy = await db.select({ id: jobs.id }).from(jobs).where(and(eq(jobs.ownerUserId, owner), eq(jobs.status, 'active'))).get();
  if (busy) return { error: 'BUSY' };
  const params = { chatId: p.chatId, group: p.group ?? 'all', deletedOnly: !!p.deletedOnly };
  const total = await countMedia(owner, params);
  if (!total) return { error: 'EMPTY' };
  const [job] = await db.insert(jobs).values({ ownerUserId: owner, kind: 'media_export', params, cursor: null, total, nextAt: now, createdAt: now, updatedAt: now }).returning();
  return { job: jobView(job) };
}

export async function cancelJob(owner, id) {
  const r = await db.update(jobs).set({ status: 'cancelled', updatedAt: new Date() })
    .where(and(eq(jobs.ownerUserId, owner), eq(jobs.id, id), eq(jobs.status, 'active'))).returning({ id: jobs.id });
  return r.length > 0;
}

const captionOf = (r, tz, lang) => `${r.isOutgoing ? '➡️' : '⬅️'} ${r.senderName ?? t(lang, 'common.contact')} · ${formatTime(new Date(r.date), tz, lang)}${r.isDeleted ? ` · ${t(lang, 'bot.cap.deleted')}` : ''}`.slice(0, 1024);

async function sendBatch(owner, rows, tz, lang) {
  /** @type {Map<string, any[]>} */
  const groups = new Map();
  const singles = [];
  for (const r of rows) {
    const k = ALBUM[r.mediaType];
    if (!k) { singles.push(r); continue; }
    const g = groups.get(k); if (g) g.push(r); else groups.set(k, [r]);
  }
  for (const list of groups.values()) {
    if (list.length === 1) { singles.push(list[0]); continue; }
    await api.sendMediaGroup({ chat_id: owner, disable_notification: true, media: list.map((r) => ({ type: INPUT[r.mediaType], media: r.fileId, caption: captionOf(r, tz, lang) })) });
  }
  for (const r of singles) {
    const method = SEND_METHOD[r.mediaType];
    if (!method) continue;
    await api[method]({ chat_id: owner, [FILE_FIELD[method]]: r.fileId, disable_notification: true, ...(NO_CAPTION.has(method) ? {} : { caption: captionOf(r, tz, lang) }) });
  }
}

/**
 * @param {number} owner @param {string} tz @param {Date} [now] @param {number} [batches] @param {any} [lang]
 */
export async function drainJobs(owner, tz, now = new Date(), batches = 2, lang = undefined) {
  const job = await db.select().from(jobs).where(and(eq(jobs.ownerUserId, owner), eq(jobs.status, 'active'), sql`${jobs.nextAt} <= ${now.getTime()}`))
    .orderBy(asc(jobs.id)).limit(1).get();
  if (!job) return 0;
  lang ??= await langOf(owner);
  const p = /** @type {any} */ (job.params);
  let cursor = /** @type {any} */ (job.cursor), done = job.done, sent = 0;
  if (done === 0 && !cursor) {
    const title = (await chatTitle(owner, p.chatId)) ?? t(lang, 'bot.chatLower', { id: p.chatId });
    await api.sendMessage({ chat_id: owner, text: t(lang, 'bot.jobs.start', { title, total: job.total }) }).catch(() => {});
  }
  try {
    for (let i = 0; i < batches; i++) {
      const { rows, next } = await mediaPage(owner, { ...p, cursor, limit: BATCH });
      if (rows.length) await sendBatch(owner, rows, tz, lang);
      done += rows.length; sent += rows.length; cursor = next;
      await db.update(jobs).set({ cursor, done, updatedAt: new Date() }).where(eq(jobs.id, job.id));
      if (!next) {
        await db.update(jobs).set({ status: 'done', updatedAt: new Date() }).where(eq(jobs.id, job.id));
        await api.sendMessage({ chat_id: owner, text: t(lang, 'bot.jobs.done', { n: done }) }).catch(() => {});
        break;
      }
    }
  } catch (e) {
    const ra = e instanceof BotApiError && e.code === 429 ? Number(e.parameters?.retry_after ?? 30) : null;
    if (ra != null || !(e instanceof BotApiError)) {
      await db.update(jobs).set({ nextAt: new Date(now.getTime() + (ra ?? 60) * 1000), updatedAt: new Date() }).where(eq(jobs.id, job.id));
    } else {
      // Пачку Telegram не принял (протухший file_id) — пропускаем её, чтобы задача не встала.
      await report('jobs:media_export', e, owner);
      const { next } = await mediaPage(owner, { ...p, cursor, limit: BATCH });
      await db.update(jobs).set({ cursor: next, done: done + BATCH, error: String(e.description).slice(0, 200), updatedAt: new Date(), ...(next ? {} : { status: 'done' }) }).where(eq(jobs.id, job.id));
    }
  }
  return sent;
}

ERASERS.push((owner) => db.delete(jobs).where(eq(jobs.ownerUserId, owner)));
CHAT_ERASERS.push((owner, chatId) => db.delete(jobs).where(and(eq(jobs.ownerUserId, owner),
  sql`json_extract(${jobs.params}, '$.chatId') = ${chatId}`)));
GLOBAL_TASKS.push({
  name: 'jobs',
  run: async (now) => {
    const owners = await db.select({ o: jobs.ownerUserId }).from(jobs).where(eq(jobs.status, 'active')).groupBy(jobs.ownerUserId).limit(10).all();
    for (const { o } of owners) { const s = await ensureSettings(Number(o)); await drainJobs(Number(o), s.timezone, now, 1, s.lang); }
    await db.delete(jobs).where(and(sql`${jobs.status} <> 'active'`, sql`${jobs.updatedAt} < ${now.getTime() - 7 * 86_400_000}`));
  },
});
