// Представление событий для Mini App и настройки показа
import { tzOffsetMinutes, wordDiff } from './util.js';
import { entitiesToHtml } from './text.js';
import { mediaLabel, MEDIA_GROUPS, DOWNLOAD_LIMIT } from './media.js';

export const NOTIFY_TYPES = /** @type {const} */ (['deleted', 'deletedUnknown', 'edited', 'oneTime', 'keywords', 'wipe', 'rename']);

export const NOTIFY_DEFAULTS = { deleted: true, deletedUnknown: true, edited: true, oneTime: true, keywords: true, wipe: true, rename: false };

/** @param {any} s @param {typeof NOTIFY_TYPES[number]} type */
export const notifyTypeOn = (s, type) => (typeof s?.notifyTypes?.[type] === 'boolean' ? s.notifyTypes[type] : NOTIFY_DEFAULTS[type]);

/** @param {any} s настройки @param {typeof NOTIFY_TYPES[number]} type */
export function notifyAllowed(s, type) {
  return !!s?.notificationsEnabled && notifyTypeOn(s, type);
}

/** @param {unknown} v */
export function parseHm(v) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(v ?? ''));
  if (!m) return null;
  const h = Number(m[1]), mm = Number(m[2]);
  return h < 24 && mm < 60 ? h * 60 + mm : null;
}

/** @param {{ from?: string, to?: string } | null | undefined} q @param {string} tz */
export function inQuietHours(q, tz, now = new Date()) {
  const from = parseHm(q?.from), to = parseHm(q?.to);
  if (from == null || to == null || from === to) return false;
  let off = 0;
  try { off = tzOffsetMinutes(now, tz); } catch { /* неверный пояс — считаем по UTC */ }
  const local = new Date(now.getTime() + off * 60_000);
  const m = local.getUTCHours() * 60 + local.getUTCMinutes();
  return from < to ? m >= from && m < to : m >= from || m < to;
}

export const MIRROR_GROUPS = /** @type {const} */ (['photo', 'video', 'voice', 'document']);

/** @param {string | null | undefined} t */
export function mirrorGroup(t) {
  if (t === 'photo' || t === 'live_photo') return 'photo';
  if (t === 'video' || t === 'video_note' || t === 'animation') return 'video';
  if (t === 'voice' || t === 'audio') return 'voice';
  if (t === 'document') return 'document';
  return null;
}

/** @param {any} s @param {string | null} mediaType @param {number | null} fileSize */
export function mirrorAllowed(s, mediaType, fileSize) {
  const g = mirrorGroup(mediaType);
  if (!g) return false;
  if (Array.isArray(s?.mirrorTypes) && !s.mirrorTypes.includes(g)) return false;
  if (s?.mirrorMaxMb && fileSize && fileSize > s.mirrorMaxMb * 1024 * 1024) return false;
  return true;
}

const ms = (d) => (d == null ? null : new Date(d).getTime());

/** Стикер-картинка (webp) или видео-стикер (webm) — их браузер покажет сам; .tgs (Lottie) — нет. */
export const isDrawableSticker = (row) => row.mediaType === 'sticker' && !row.mediaMeta?.animated;
export const GIF_LIMIT = 5 * 1024 * 1024;

export function previewable(row) {
  if (!row.mediaType) return false;
  if (row.mediaType === 'sticker') return isDrawableSticker(row);
  if (row.mediaType === 'animation') return (row.fileSize ?? 0) <= GIF_LIMIT;
  const inlineTypes = [...MEDIA_GROUPS.photo, ...MEDIA_GROUPS.video, ...MEDIA_GROUPS.voice];
  if (!inlineTypes.includes(row.mediaType)) return false;
  return (row.fileSize ?? 0) <= DOWNLOAD_LIMIT;
}

export const hasThumb = (row) => !!(row.thumbFileId || row.mediaType === 'photo' || (isDrawableSticker(row) && !row.mediaMeta?.video));

export function statusOf(row) {
  if (row.isDeleted) return 'deleted';
  if ((row.editCount ?? 0) > 0) return 'edited';
  return 'plain';
}

/** @param {any} row @param {any} [lang] язык подписи типа медиа */
export function eventView(row, lang = 'ru') {
  const html = row.text ? entitiesToHtml(row.text, row.entities)
    : row.caption ? entitiesToHtml(row.caption, row.entities) : null;
  return {
    id: row.id,
    chatId: Number(row.chatId),
    chatName: row.chatName ?? null,
    senderId: row.senderId == null ? null : Number(row.senderId),
    senderName: row.senderName ?? null,
    isOutgoing: !!row.isOutgoing,
    status: statusOf(row),
    isDeleted: !!row.isDeleted,
    isFavorite: !!row.isFavorite,
    oneTime: !!row.oneTime,
    editCount: row.editCount ?? 0,
    text: row.text ?? null,
    caption: row.caption ?? null,
    html,
    mediaType: row.mediaType ?? null,
    mediaLabel: row.mediaType ? mediaLabel(row.mediaType, lang) : null,
    fileSize: row.fileSize ?? null,
    fileName: row.fileName ?? null,
    hasThumb: hasThumb(row),
    previewable: previewable(row),
    mediaMeta: row.mediaMeta ?? null,
    albumCount: row.albumCount ?? 1,
    reply: row.replyToText || row.replyToSender
      ? { sender: row.replyToSender ?? null, text: row.replyToText ?? null }
      : null,
    forwardOrigin: row.forwardOrigin ?? null,
    date: ms(row.date),
    eventAt: ms(row.eventAt),
    deletedAt: ms(row.deletedAt),
    lastEditedAt: ms(row.lastEditedAt),
    mirror: row.mirrorMessageId ? { chatId: Number(row.mirrorChatId), threadId: row.mirrorThreadId, messageId: row.mirrorMessageId } : null,
  };
}

/** @param {any} e */
export function editView(e) {
  return {
    id: e.id,
    oldText: e.oldText ?? null,
    newText: e.newText ?? null,
    oldHtml: e.oldText ? entitiesToHtml(e.oldText, e.oldEntities) : null,
    newHtml: e.newText ? entitiesToHtml(e.newText, e.newEntities) : null,
    diff: wordDiff(e.oldText ?? '', e.newText ?? ''),
    mediaReplaced: !!e.oldMedia,
    editedAt: ms(e.editedAt),
  };
}

/** @param {any} c */
export function chatView(c) {
  return {
    chatId: Number(c.chatId),
    chatName: c.chatName ?? null,
    total: c.total,
    incoming: c.incoming,
    deleted: c.deleted,
    edited: c.edited,
    media: c.media,
    lastAt: c.lastAt ?? null,
    lastEventAt: c.lastEventAt ?? null,
    muted: !!c.muted,
    autoRead: !!c.autoRead,
    excluded: !!c.excluded,
    unread: c.unread ?? 0,
    hasPhoto: !!c.hasPhoto,
  };
}

/** @param {any} s */
export function settingsView(s) {
  return {
    notificationsEnabled: !!s.notificationsEnabled,
    notifyOwn: !!s.notifyOwn,
    timezone: s.timezone,
    tzSource: s.tzSource === 'auto' ? 'auto' : s.tzSource === 'manual' ? 'manual' : null,
    lang: s.lang === 'en' ? 'en' : 'ru',
    langSource: s.langSource === 'manual' ? 'manual' : 'auto',
    retentionDays: s.retentionDays ?? null,
    keywords: Array.isArray(s.keywords) ? s.keywords : [],
    readMode: s.readMode ?? 'off',
    lockEnabled: !!s.lockEnabled,
    lockMode: s.lockMode === 'pin' && s.pinHash ? 'pin' : s.lockEnabled ? 'biometric' : 'off',
    hasPin: !!s.pinHash,
    onboardedAt: ms(s.onboardedAt),
    lastSeenEventsAt: ms(s.lastSeenEventsAt),
    quietHours: s.quietHours?.from && s.quietHours?.to ? { from: s.quietHours.from, to: s.quietHours.to } : null,
    notifyTypes: Object.fromEntries(NOTIFY_TYPES.map((t) => [t, notifyTypeOn(s, t)])),
    hidePreview: !!s.hidePreview,
    keywordWholeWord: !!s.keywordWholeWord,
    keywordExclude: Array.isArray(s.keywordExclude) ? s.keywordExclude : [],
    keywordLoud: s.keywordLoud !== false,
    mirrorTypes: Array.isArray(s.mirrorTypes) ? s.mirrorTypes : [...MIRROR_GROUPS],
    mirrorMaxMb: s.mirrorMaxMb ?? null,
    autoLockMin: s.autoLockMin ?? null,
    purgeAfterDisconnectDays: s.purgeAfterDisconnectDays ?? null,
  };
}
