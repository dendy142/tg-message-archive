// Группа-архив: темы, зеркалирование копий, подключение группы
import { db, api, BotApiError, InputFile } from 'sdk';
import { and, eq } from 'sdk/db';
import { archives, archiveTopics } from '../schema.js';
import * as msg from './repo/messages.js';
import { report, reporter } from './runtime.js';
import { botId } from './links.js';
import { extractMedia, MIRROR_TYPES, SEND_METHOD, FILE_FIELD, NO_CAPTION } from './media.js';
import { formatTime } from './text.js';
import { t } from './i18n.js';
import { langOf, ensureSettings } from './repo/state.js';

// ── repo/archive: группа-архив и темы форума
/** @param {number} ownerUserId */
export async function getArchive(ownerUserId) {
  return (await db.select().from(archives).where(eq(archives.ownerUserId, ownerUserId)).get()) ?? null;
}

/** @param {number} chatId */
export async function getArchiveByChat(chatId) {
  return (await db.select().from(archives).where(eq(archives.chatId, chatId)).get()) ?? null;
}

/** @param {{ ownerUserId: number, chatId: number, title?: string | null }} v */
export async function linkArchive(v, now = new Date()) {
  await db.insert(archives).values({
    ownerUserId: v.ownerUserId, chatId: v.chatId, title: v.title ?? null,
    status: 'active', lostReason: null, retryAt: null, linkedAt: now, updatedAt: now,
  }).onConflictDoUpdate({
    target: archives.ownerUserId,
    set: { chatId: v.chatId, title: v.title ?? null, status: 'active', lostReason: null, retryAt: null, updatedAt: now },
  });
  return getArchive(v.ownerUserId);
}

/** @param {number} ownerUserId @param {{ status?: string, lostReason?: string | null, retryAt?: Date | null, title?: string | null }} patch */
export async function setArchiveStatus(ownerUserId, patch) {
  await db.update(archives).set({ ...patch, updatedAt: new Date() }).where(eq(archives.ownerUserId, ownerUserId));
}

/** Группа потеряна (бота убрали/лишили прав): копии продолжают копиться в очереди. */
export async function markArchiveLost(ownerUserId, reason) {
  await setArchiveStatus(ownerUserId, { status: 'lost', lostReason: reason });
}

export async function getTopic(ownerUserId, chatId) {
  return (await db.select().from(archiveTopics).where(and(eq(archiveTopics.ownerUserId, ownerUserId), eq(archiveTopics.chatId, chatId))).get()) ?? null;
}

/** @param {{ ownerUserId: number, chatId: number, archiveChatId: number, threadId: number, name?: string | null }} v */
export async function saveTopic(v, now = new Date()) {
  await db.insert(archiveTopics).values({ ...v, name: v.name ?? null, createdAt: now }).onConflictDoUpdate({
    target: [archiveTopics.ownerUserId, archiveTopics.chatId],
    set: { archiveChatId: v.archiveChatId, threadId: v.threadId, name: v.name ?? null },
  });
  return getTopic(v.ownerUserId, v.chatId);
}

export async function dropTopic(ownerUserId, chatId) {
  await db.delete(archiveTopics).where(and(eq(archiveTopics.ownerUserId, ownerUserId), eq(archiveTopics.chatId, chatId)));
}

export async function clearTopics(ownerUserId) {
  await db.delete(archiveTopics).where(eq(archiveTopics.ownerUserId, ownerUserId));
}

// ── archive: копирование файлов в группу
/** @param {any} row @param {string} tz @param {any} [lang] язык владельца */
export function mirrorCaption(row, tz, lang = 'ru') {
  const arrow = row.isOutgoing ? '➡️' : '⬅️';
  const parts = [`${arrow} ${row.senderName ?? t(lang, 'common.contact')}`, formatTime(new Date(row.date), tz, lang)];
  if (row.isDeleted) parts.push(`${t(lang, 'bot.cap.deleted')} ${row.deletedAt ? formatTime(new Date(row.deletedAt), tz, lang) : ''}`.trim());
  else if (row.editCount > 0) parts.push(t(lang, 'bot.cap.edited'));
  const base = parts.join(' · ');
  const own = row.caption && row.mediaType !== 'sticker' ? `\n${row.caption}` : '';
  // Подпись Telegram ограничена 1024 символами.
  return (base + own).slice(0, 1020);
}

async function archiveReady(ownerUserId, now) {
  const a = await getArchive(ownerUserId);
  if (!a || a.status !== 'active') return null;
  if (a.retryAt && new Date(a.retryAt).getTime() > now.getTime()) return null;
  return a;
}

async function ensureTopic(archive, row, lang) {
  const existing = await getTopic(row.ownerUserId, row.chatId);
  if (existing) return existing;
  const name = (row.chatName ?? `${t(lang, 'bot.chatN', { id: row.chatId })}`).slice(0, 128);
  const topic = await api.createForumTopic({ chat_id: archive.chatId, name });
  const saved = await saveTopic({
    ownerUserId: row.ownerUserId, chatId: row.chatId, archiveChatId: archive.chatId,
    threadId: topic.message_thread_id, name,
  });
  return saved ?? { threadId: topic.message_thread_id };
}

function retryAfter(e) {
  return e instanceof BotApiError && e.code === 429 ? Number(e.parameters?.retry_after ?? 30) : null;
}

function mirrorFields(archive, topic, sent, row) {
  const m = extractMedia(sent ?? {});
  return {
    mirrorStatus: 'done', mirrorChatId: archive.chatId, mirrorThreadId: topic.threadId,
    mirrorMessageId: sent.message_id, mirrorAttempts: row.mirrorAttempts + 1,
    mirrorRetryAt: null, mirrorError: null, mirrorDirty: false,
    mirrorFileId: m.fileId ?? null, mirrorThumbFileId: m.thumbFileId ?? null,
  };
}

/**
 * У кружка и голосового подписи нет — «кто/когда/удалено» уходит отдельным тихим ответом
 * на копию; его id запоминаем, чтобы перерисовывать при удалении/правке.
 */
async function sendCaptionNote(archive, topic, row, sentId, tz, lang) {
  const note = await api.sendMessage({
    chat_id: archive.chatId, message_thread_id: topic.threadId, text: mirrorCaption(row, tz, lang),
    reply_parameters: { message_id: sentId }, disable_notification: true,
  });
  return note?.message_id ?? null;
}

/**
 * file_id пересылается без перезагрузки и без лимита размера.
 * replyTo — первая копия альбома, если часть уже скопирована поштучно.
 * @param {any} archive @param {any} row @param {string} tz @param {number | null} replyTo @param {any} lang
 */
async function mirrorOne(archive, row, tz, replyTo, lang) {
  const method = SEND_METHOD[row.mediaType];
  if (!method || !row.fileId || !MIRROR_TYPES.has(row.mediaType)) {
    await msg.setMirror(row.id, { mirrorStatus: 'failed', mirrorError: 'unsupported' });
    return;
  }
  const topic = await ensureTopic(archive, row, lang);
  const noCaption = NO_CAPTION.has(method);
  const sent = await api[method]({
    chat_id: archive.chatId,
    message_thread_id: topic.threadId,
    [FILE_FIELD[method]]: row.fileId,
    ...(noCaption ? {} : { caption: mirrorCaption(row, tz, lang) }),
    ...(replyTo ? { reply_parameters: { message_id: replyTo } } : {}),
    disable_notification: true,
  });
  const fields = mirrorFields(archive, topic, sent, row);
  await msg.setMirror(row.id, fields);
  if (noCaption) {
    const noteId = await sendCaptionNote(archive, topic, row, sent.message_id, tz, lang).catch((e) => { console.warn('caption note', e); return null; });
    if (noteId) await msg.setMirror(row.id, { mirrorCaptionMessageId: noteId });
  }
}

/** Как Telegram группирует альбом: фото и видео вместе, документы и аудио — отдельными альбомами. */
const ALBUM_KIND = { photo: 'visual', live_photo: 'visual', video: 'visual', document: 'document', audio: 'audio' };
const INPUT_TYPE = { photo: 'photo', live_photo: 'photo', video: 'video', document: 'document', audio: 'audio' };

/** Настоящий альбом (sendMediaGroup, до 10 файлов); голосовые и кружки — поштучно. */
async function mirrorAlbum(archive, rows, tz, lang) {
  const topic = await ensureTopic(archive, rows[0], lang);
  /** @type {Map<string, any[]>} */
  const groups = new Map();
  const singles = [];
  for (const r of rows) {
    const k = ALBUM_KIND[r.mediaType];
    if (!k) { singles.push(r); continue; }
    const g = groups.get(k);
    if (g) g.push(r); else groups.set(k, [r]);
  }
  for (const list of groups.values()) {
    for (let i = 0; i < list.length; i += 10) {
      const part = list.slice(i, i + 10);
      if (part.length === 1) { singles.push(part[0]); continue; }
      const sent = await api.sendMediaGroup({
        chat_id: archive.chatId, message_thread_id: topic.threadId, disable_notification: true,
        media: part.map((r) => ({ type: INPUT_TYPE[r.mediaType], media: r.fileId, caption: mirrorCaption(r, tz, lang) })),
      });
      for (let j = 0; j < part.length; j++) {
        if (sent?.[j]) await msg.setMirror(part[j].id, mirrorFields(archive, topic, sent[j], part[j]));
      }
    }
  }
  for (const r of singles) await mirrorOne(archive, r, tz, null, lang);
}

async function handleFailure(rows, e, now) {
  const wait = retryAfter(e);
  for (const row of rows) {
    if (wait != null) {
      await msg.setMirror(row.id, { mirrorRetryAt: new Date(now.getTime() + wait * 1000) });
      continue;
    }
    const attempts = row.mirrorAttempts + 1;
    const giveUp = attempts >= 5 || (e instanceof BotApiError && e.code === 400 && rows.length === 1);
    await msg.setMirror(row.id, {
      mirrorAttempts: attempts,
      mirrorStatus: giveUp ? 'failed' : 'pending',
      mirrorRetryAt: giveUp ? null : new Date(now.getTime() + 60_000 * attempts),
      mirrorError: String(e?.description ?? e?.message ?? e).slice(0, 300),
    });
  }
  if (wait != null && rows[0]) await setArchiveStatus(rows[0].ownerUserId, { retryAt: new Date(now.getTime() + wait * 1000) });
  if (wait == null && rows[0]) await report('mirror', e, Number(rows[0].ownerUserId));
}

/**
 * Если всё ушло без 429, берём ещё (до maxLimit).
 * deadline — мс, после которых новые файлы не берём.
 * @param {number} ownerUserId @param {string} tz @param {any} [lang]
 */
export async function drainMirror(ownerUserId, tz, now = new Date(), limit = 5, maxLimit = limit, deadline = Infinity, lang = undefined) {
  const archive = await archiveReady(ownerUserId, now);
  if (!archive) return { sent: 0, updated: 0 };
  lang ??= await langOf(ownerUserId);
  let sent = 0, updated = 0, processed = 0, failed = false, cap = limit;
  /** @type {Set<number>} */
  const handled = new Set();
  for (;;) {
    const rows = (await msg.pendingMirrors(ownerUserId, now, cap)).filter((r) => !handled.has(r.id));
    let progressed = false;
    for (const row of rows) {
      if (processed >= cap || Date.now() > deadline) break;
      if (handled.has(row.id)) continue;
      let batch = [row];
      if (row.mediaGroupId) {
        const album = (await msg.albumRows(row)).filter((r) => r.mirrorStatus === 'pending' && !handled.has(r.id));
        if (album.length) batch = album;
      }
      batch.forEach((r) => handled.add(r.id));
      processed += batch.length;
      progressed = true;
      try {
        const head = row.mediaGroupId ? await msg.albumHeadMirror(row) : null;
        // Альбомом — только если ни один файл ещё не копировался и прошлой неудачи не было.
        if (batch.length > 1 && !head && batch.every((r) => r.mirrorAttempts === 0)) await mirrorAlbum(archive, batch, tz, lang);
        else for (const r of batch) await mirrorOne(archive, r, tz, head?.mirrorMessageId ?? null, lang);
        sent += batch.length;
      } catch (e) {
        failed = true;
        await handleFailure(batch, e, now);
        if (retryAfter(e) != null) return { sent, updated };
      }
    }
    if (!progressed || Date.now() > deadline) break;
    if (processed >= cap) {
      if (failed || cap >= maxLimit) break;
      cap = Math.min(cap + 5, maxLimit);
    }
  }
  for (const row of await msg.dirtyMirrors(ownerUserId, limit)) {
    try {
      const text = mirrorCaption(row, tz, lang);
      if (row.mirrorCaptionMessageId) await api.editMessageText({ chat_id: row.mirrorChatId, message_id: row.mirrorCaptionMessageId, text });
      else await api.editMessageCaption({ chat_id: row.mirrorChatId, message_id: row.mirrorMessageId, caption: text });
      await msg.setMirror(row.id, { mirrorDirty: false });
      updated++;
    } catch (e) {
      // Подпись нельзя отредактировать (слишком старое сообщение и т.п.) — снимаем флаг, это не критично.
      await msg.setMirror(row.id, { mirrorDirty: false });
      const wait = retryAfter(e);
      if (wait != null) { await setArchiveStatus(ownerUserId, { retryAt: new Date(now.getTime() + wait * 1000) }); return { sent, updated }; }
    }
  }
  return { sent, updated };
}

const EXT = { photo: 'jpg', live_photo: 'jpg', video: 'mp4', video_note: 'mp4', voice: 'ogg', audio: 'mp3', document: 'bin' };

/**
 * Одноразовое медиа не переслать по file_id, он живёт мгновение:
 * скачиваем и перезаливаем, получая долговечный file_id.
 * @param {number} owner @param {any} input строка из repliedOneTimeInput @param {string} tz @param {Date} [now] @param {any} [lang]
 * @returns {Promise<{ saved: any, delivered: 'group' | 'pm' | 'none' } | null>}
 */
export async function captureOneTime(owner, input, tz, now = new Date(), lang = undefined) {
  lang ??= await langOf(owner);
  let bytes;
  try {
    bytes = await api.getFileContent(input.fileId);
  } catch (e) {
    const saved = await msg.backupIfAbsent({ ...input, mirrorStatus: 'failed', mirrorError: 'one-time: ' + String(e?.description ?? e?.message ?? e) });
    return saved ? { saved, delivered: 'none' } : null;
  }
  const method = SEND_METHOD[input.mediaType] ?? 'sendDocument';
  const field = FILE_FIELD[method];
  const file = new InputFile(bytes, `one-time-${input.messageId}.${EXT[input.mediaType] ?? 'bin'}`);
  const caption = `${t(lang, 'bot.cap.oneTime')} · ${input.senderName ?? t(lang, 'common.contact')} · ${formatTime(new Date(input.date), tz, lang)}`;

  const archive = await archiveReady(owner, now);
  let delivered = /** @type {'group' | 'pm' | 'none'} */ ('pm');
  let sent;
  let topic = null;
  if (archive) {
    try {
      topic = await ensureTopic(archive, input, lang);
      sent = await api[method]({ chat_id: archive.chatId, message_thread_id: topic.threadId, [field]: file, ...(NO_CAPTION.has(method) ? {} : { caption }) });
      delivered = 'group';
    } catch (e) {
      console.warn('one-time → group failed, fallback to PM', e);
    }
  }
  if (!sent) {
    sent = await api[method]({ chat_id: owner, [field]: file, ...(NO_CAPTION.has(method) ? {} : { caption }) });
    delivered = 'pm';
  }
  const dm = extractMedia(sent);
  const saved = await msg.backupIfAbsent({
    ...input,
    fileId: dm.fileId ?? input.fileId,
    fileUniqueId: dm.fileUniqueId ?? input.fileUniqueId,
    thumbFileId: dm.thumbFileId ?? null,
    mediaMeta: dm.mediaMeta ?? input.mediaMeta ?? null,
    mirrorStatus: delivered === 'group' ? 'done' : 'none',
    mirrorChatId: delivered === 'group' ? archive?.chatId ?? null : null,
    mirrorThreadId: delivered === 'group' ? topic?.threadId ?? null : null,
    mirrorMessageId: delivered === 'group' ? sent.message_id : null,
    mirrorFileId: dm.fileId ?? null,
    mirrorThumbFileId: dm.thumbFileId ?? null,
  });
  if (saved && delivered === 'group' && archive && topic && NO_CAPTION.has(method)) {
    const noteId = await sendCaptionNote(archive, topic, saved, sent.message_id, tz, lang).catch(() => null);
    if (noteId) await msg.setMirror(saved.id, { mirrorCaptionMessageId: noteId });
  }
  return saved ? { saved, delivered } : null;
}

export async function hasChatTopic(ownerUserId, chatId) {
  const [archive, topic] = await Promise.all([getArchive(ownerUserId), getTopic(ownerUserId, chatId)]);
  return !!(archive && topic && Number(topic.archiveChatId) === Number(archive.chatId));
}

/** Telegram: темы уже нет (удалили руками) — удалять нечего. */
const TOPIC_GONE = /TOPIC_ID_INVALID|thread not found|topic not found|TOPIC_DELETED/i;

/**
 * Тему забываем в любом случае: не удалось удалить — владелец удалит руками,
 * новые файлы пойдут в новую тему.
 * @param {number} ownerUserId @param {number} chatId
 * @returns {Promise<'deleted' | 'kept' | 'none'>} kept — тема осталась (нет прав, группа недоступна)
 */
export async function deleteChatTopic(ownerUserId, chatId) {
  const topic = await getTopic(ownerUserId, chatId);
  if (!topic) return 'none';
  /** @type {'deleted' | 'kept'} */
  let result = 'deleted';
  try {
    await api.deleteForumTopic({ chat_id: Number(topic.archiveChatId), message_thread_id: Number(topic.threadId) });
  } catch (e) {
    const desc = String(/** @type {any} */ (e)?.description ?? /** @type {any} */ (e)?.message ?? e);
    if (!(e instanceof BotApiError && TOPIC_GONE.test(desc))) {
      console.warn('[archive] deleteForumTopic', ownerUserId, desc);
      result = 'kept';
    }
  }
  await dropTopic(ownerUserId, chatId);
  return result;
}

export async function checkArchiveRights(chatId) {
  const chat = await api.getChat({ chat_id: chatId });
  if (chat.type !== 'supergroup' || !chat.is_forum) return 'not_forum';
  const me = await botId();
  const member = await api.getChatMember({ chat_id: chatId, user_id: me });
  if (member.status !== 'administrator') return 'not_admin';
  if (!member.can_manage_topics) return 'no_topics';
  return null;
}

// ── onboarding: подключение группы и членство бота
/** @param {any} m сервисное сообщение с полем chat_shared */
export async function linkArchiveFromShare(m) {
  const owner = m.from?.id ?? m.chat?.id;
  const shared = m.chat_shared;
  if (!owner || !shared?.chat_id) return null;
  const chatId = shared.chat_id;
  let reason;
  try {
    reason = await checkArchiveRights(chatId);
  } catch (e) {
    reason = 'unreachable';
    console.warn('checkArchiveRights failed', e);
  }
  const prev = await getArchive(owner);
  if (reason) {
    if (!prev || prev.chatId !== chatId) await linkArchive({ ownerUserId: owner, chatId, title: shared.title ?? null });
    await markArchiveLost(owner, reason);
    return { linked: false, reason };
  }
  if (prev && prev.chatId !== chatId) await clearTopics(owner);
  await linkArchive({ ownerUserId: owner, chatId, title: shared.title ?? null });
  const s = await ensureSettings(owner);
  await drainMirror(owner, s.timezone, new Date(), 20, 20, Infinity, s.lang).catch(reporter('drain_on_link', owner));
  return { linked: true, chatId };
}

/** @param {any} upd ChatMemberUpdated (my_chat_member) */
export async function onBotMembershipChange(upd) {
  const chatId = upd?.chat?.id;
  if (chatId == null) return null;
  // Владельца ищем по самой группе: права может поменять и другой администратор.
  const archive = await getArchiveByChat(chatId);
  if (!archive) return null;
  const owner = Number(archive.ownerUserId);
  const status = upd.new_chat_member?.status;
  if (status === 'left' || status === 'kicked' || status === 'restricted') {
    await markArchiveLost(owner, status);
    return { archive: 'lost', status };
  }
  if (status === 'administrator') {
    const me = await botId();
    if (upd.new_chat_member?.user?.id !== me) return null;
    if (upd.new_chat_member?.can_manage_topics) {
      await setArchiveStatus(owner, { status: 'active', lostReason: null });
      const s = await ensureSettings(owner);
      await drainMirror(owner, s.timezone, new Date(), 20, 20, Infinity, s.lang).catch(reporter('drain_on_reactivate', owner));
      return { archive: 'active' };
    }
    await markArchiveLost(owner, 'no_topics');
    return { archive: 'lost', status };
  }
  if (status === 'member') { await markArchiveLost(owner, 'no_topics'); return { archive: 'lost', status }; }
  return null;
}
