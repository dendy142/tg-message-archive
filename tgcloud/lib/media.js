// Разбор содержимого сообщения Bot API в поля архива
import { normalizeSearch, personName } from './text.js';
import { t } from './i18n.js';

export const MEDIA_TYPES = new Set([
  'photo', 'live_photo', 'video', 'animation', 'audio', 'voice', 'video_note', 'document', 'sticker', 'paid_media',
  'story', 'contact', 'location', 'venue', 'poll', 'dice', 'checklist', 'gift', 'unique_gift', 'game', 'invoice', 'rich_message',
]);
/** @param {string} type @param {any} [lang] */
export const mediaLabel = (type, lang = 'ru') => (MEDIA_TYPES.has(type) ? t(lang, `media.${type}`) : `📎 ${type}`);

export const MIRROR_TYPES = new Set(['photo', 'live_photo', 'video', 'video_note', 'voice', 'audio', 'document']);

export const SEND_METHOD = {
  photo: 'sendPhoto', live_photo: 'sendPhoto', video: 'sendVideo', video_note: 'sendVideoNote',
  voice: 'sendVoice', audio: 'sendAudio', document: 'sendDocument', animation: 'sendAnimation', sticker: 'sendSticker',
};
export const FILE_FIELD = {
  sendPhoto: 'photo', sendVideo: 'video', sendVideoNote: 'video_note', sendVoice: 'voice',
  sendAudio: 'audio', sendDocument: 'document', sendAnimation: 'animation', sendSticker: 'sticker',
};
export const NO_CAPTION = new Set(['sendVideoNote', 'sendVoice', 'sendSticker']);

export const MEDIA_GROUPS = {
  photo: ['photo', 'live_photo'],
  video: ['video', 'animation', 'video_note'],
  voice: ['voice', 'audio'],
  document: ['document'],
  sticker: ['sticker'],
};

export const ALBUM_SETTLE_MS = 15_000;

/** Скачать байты платформа даёт только до 20 МБ (лимит getFile Bot API). */
export const DOWNLOAD_LIMIT = 20 * 1024 * 1024;

/** @param {any[]} sizes */
function thumbOfPhoto(sizes) {
  if (!sizes?.length) return null;
  return (sizes.find((s) => Math.max(s.width ?? 0, s.height ?? 0) >= 320) ?? sizes.at(-1)).file_id ?? null;
}

/**
 * @typedef {{
 * mediaType?: string | null, fileId?: string | null, fileUniqueId?: string | null, mimeType?: string | null,
 * fileSize?: number | null, fileName?: string | null, thumbFileId?: string | null, mediaMeta?: any, caption?: string | null
 * }} Media
 */

/** @param {string} type @param {any} f @param {Partial<Media>} [extra] @returns {Media} */
const file = (type, f, extra = {}) => ({
  mediaType: type,
  fileId: f?.file_id ?? null,
  fileUniqueId: f?.file_unique_id ?? null,
  mimeType: f?.mime_type ?? null,
  fileSize: f?.file_size ?? null,
  fileName: f?.file_name ?? null,
  thumbFileId: f?.thumbnail?.file_id ?? null,
  ...extra,
});

/**
 * @param {any} m Message
 * @returns {Media}
 */
export function extractMedia(m) {
  if (m.live_photo) {
    // Bot API 10.0: file_id живого фото — это видео; статичное фото — в live_photo.photo (и в m.photo).
    const sizes = m.live_photo.photo ?? m.photo ?? [];
    const big = sizes.at(-1);
    return {
      mediaType: 'live_photo', fileId: big?.file_id ?? m.live_photo.file_id, fileUniqueId: m.live_photo.file_unique_id ?? big?.file_unique_id ?? null,
      mimeType: 'image/jpeg', fileSize: big?.file_size ?? null, fileName: null, thumbFileId: thumbOfPhoto(sizes),
      mediaMeta: { liveVideoFileId: m.live_photo.file_id, width: m.live_photo.width, height: m.live_photo.height, duration: m.live_photo.duration },
    };
  }
  if (m.photo) {
    const big = m.photo.at(-1);
    return file('photo', big, { mimeType: 'image/jpeg', thumbFileId: thumbOfPhoto(m.photo), mediaMeta: { width: big?.width, height: big?.height } });
  }
  if (m.video) return file('video', m.video, { mediaMeta: { duration: m.video.duration, width: m.video.width, height: m.video.height } });
  if (m.animation) return file('animation', m.animation, { mediaMeta: { duration: m.animation.duration, width: m.animation.width, height: m.animation.height } });
  if (m.audio) return file('audio', m.audio, { mediaMeta: { duration: m.audio.duration, performer: m.audio.performer ?? null, title: m.audio.title ?? null } });
  if (m.voice) return file('voice', m.voice, { mimeType: m.voice.mime_type ?? 'audio/ogg', mediaMeta: { duration: m.voice.duration } });
  if (m.video_note) return file('video_note', m.video_note, { mimeType: 'video/mp4', mediaMeta: { duration: m.video_note.duration, length: m.video_note.length } });
  if (m.document) return file('document', m.document);
  if (m.sticker) {
    return file('sticker', m.sticker, {
      caption: m.sticker.emoji ?? null,
      mimeType: m.sticker.is_video ? 'video/webm' : m.sticker.is_animated ? 'application/x-tgsticker' : 'image/webp',
      mediaMeta: { emoji: m.sticker.emoji ?? null, setName: m.sticker.set_name ?? null, animated: !!m.sticker.is_animated, video: !!m.sticker.is_video },
    });
  }
  if (m.paid_media) return { mediaType: 'paid_media', caption: `${m.paid_media.star_count ?? '?'} ⭐️` };
  if (m.story) return { mediaType: 'story', caption: m.story.chat?.title ?? m.story.chat?.first_name ?? null };
  if (m.contact) return { mediaType: 'contact', caption: [m.contact.first_name, m.contact.last_name].filter(Boolean).join(' ') + (m.contact.phone_number ? ` · ${m.contact.phone_number}` : '') };
  if (m.venue) return { mediaType: 'venue', caption: [m.venue.title, m.venue.address].filter(Boolean).join(', '), mediaMeta: { lat: m.venue.location?.latitude, lon: m.venue.location?.longitude } };
  if (m.location) return { mediaType: 'location', caption: `${m.location.latitude}, ${m.location.longitude}`, mediaMeta: { lat: m.location.latitude, lon: m.location.longitude, live: !!m.location.live_period } };
  if (m.poll) return { mediaType: 'poll', caption: m.poll.question ?? null };
  if (m.dice) return { mediaType: 'dice', caption: `${m.dice.emoji ?? '🎲'} ${m.dice.value ?? ''}`.trim() };
  if (m.checklist) return { mediaType: 'checklist', caption: m.checklist.title ?? null };
  if (m.unique_gift) return { mediaType: 'unique_gift', caption: m.unique_gift.gift?.name ?? m.unique_gift.text ?? null };
  if (m.gift) return { mediaType: 'gift', caption: m.gift.text ?? null };
  if (m.game) return { mediaType: 'game', caption: m.game.title ?? null };
  if (m.invoice) return { mediaType: 'invoice', caption: m.invoice.title ?? null };
  if (m.rich_message && !m.text) return { mediaType: 'rich_message', caption: richPlainText(m.rich_message) };
  return {};
}

function richPlainText(rich) {
  /** @type {string[]} */
  const out = [];
  const walk = (n) => {
    if (n == null) return;
    if (typeof n === 'string') { out.push(n); return; }
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (typeof n === 'object') { for (const k of ['text', 'blocks', 'items', 'summary', 'cells']) if (k in n) walk(n[k]); }
  };
  walk(rich?.blocks);
  const s = out.join(' ').replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, 4000) : null;
}

const REPLY_PREVIEW_LEN = 200;

/** @param {any} m */
export function replyInfo(m) {
  const r = m.reply_to_message;
  if (!r) return {};
  const media = extractMedia(r);
  const raw = m.quote?.text ?? r.text ?? r.caption ?? (media.mediaType ? mediaLabel(media.mediaType) : null);
  return {
    replyToMessageId: r.message_id ?? null,
    replyToSender: personName(r.from) ?? r.sender_chat?.title ?? null,
    replyToText: raw ? String(raw).slice(0, REPLY_PREVIEW_LEN) : null,
  };
}

/** @param {any} chat */
export const chatName = (chat) => chat.title ?? ([chat.first_name, chat.last_name].filter(Boolean).join(' ') || null);

/**
 * Снимок из reply_to_message: так бэкапятся view-once медиа (ответ несёт file_id оригинала до открытия)
 * @param {any} carrier сообщение-ответ (business_message) @param {number} ownerUserId @param {string} connId @param {Date} [now]
 */
export function repliedOneTimeInput(carrier, ownerUserId, connId, now = new Date()) {
  const r = carrier.reply_to_message;
  if (!r || r.message_id == null) return null;
  const media = extractMedia(r);
  if (!media.mediaType || !MIRROR_TYPES.has(media.mediaType) || !media.fileId) return null;
  const chat = r.chat ?? carrier.chat;
  const senderName = r.from ? personName(r.from) : null;
  const name = chatName(chat);
  return {
    businessConnectionId: connId,
    ownerUserId,
    chatId: chat.id,
    chatName: name,
    messageId: r.message_id,
    senderId: r.from?.id ?? null,
    senderName,
    senderUsername: r.from?.username ?? null,
    isOutgoing: r.from?.id != null && r.from.id === ownerUserId,
    text: r.text ?? null,
    caption: r.caption ?? media.caption ?? null,
    entities: entitiesOf(r),
    mediaGroupId: r.media_group_id ?? null,
    forwardOrigin: r.forward_origin ?? null,
    mediaType: media.mediaType ?? null,
    fileId: media.fileId ?? null,
    fileUniqueId: media.fileUniqueId ?? null,
    mimeType: media.mimeType ?? null,
    fileSize: media.fileSize ?? null,
    fileName: media.fileName ?? null,
    thumbFileId: media.thumbFileId ?? null,
    mediaMeta: media.mediaMeta ?? null,
    oneTime: true,
    mirrorStatus: 'pending',
    date: new Date((r.date ?? carrier.date) * 1000),
    createdAt: now,
    searchText: normalizeSearch(r.text, r.caption ?? media.caption, senderName, name, media.fileName),
  };
}

/** @param {any} m */
export const entitiesOf = (m) => m.entities ?? m.caption_entities ?? null;

/** @param {string} connId @param {any} m Message @param {number} ownerUserId @param {Date} [now] */
export function messageInput(connId, m, ownerUserId, now = new Date()) {
  const media = extractMedia(m);
  const senderName = m.from ? personName(m.from) : null;
  const name = chatName(m.chat);
  const mirrorable = !!media.mediaType && MIRROR_TYPES.has(media.mediaType) && !!media.fileId;
  return {
    businessConnectionId: connId,
    ownerUserId,
    chatId: m.chat.id,
    chatName: name,
    messageId: m.message_id,
    senderId: m.from?.id ?? null,
    senderName,
    senderUsername: m.from?.username ?? null,
    isOutgoing: m.from?.id != null && m.from.id === ownerUserId,
    text: m.text ?? null,
    caption: m.caption ?? media.caption ?? null,
    entities: entitiesOf(m),
    mediaGroupId: m.media_group_id ?? null,
    forwardOrigin: m.forward_origin ?? null,
    ...replyInfo(m),
    mediaType: media.mediaType ?? null,
    fileId: media.fileId ?? null,
    fileUniqueId: media.fileUniqueId ?? null,
    mimeType: media.mimeType ?? null,
    fileSize: media.fileSize ?? null,
    fileName: media.fileName ?? null,
    thumbFileId: media.thumbFileId ?? null,
    mediaMeta: media.mediaMeta ?? null,
    mirrorStatus: mirrorable ? 'pending' : 'none',
    // Файлы альбома приходят отдельными апдейтами — даём им собраться, чтобы скопировать альбомом.
    ...(mirrorable && m.media_group_id ? { mirrorRetryAt: new Date(now.getTime() + ALBUM_SETTLE_MS) } : {}),
    date: new Date(m.date * 1000),
    createdAt: now,
    searchText: normalizeSearch(m.text, m.caption ?? media.caption, senderName, name, media.fileName),
  };
}
