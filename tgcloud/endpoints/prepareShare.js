import { api } from 'sdk';
import { endpointError, t } from '../lib/i18n.js';
import { authed } from '../lib/runtime.js';
import { findById } from '../lib/repo/messages.js';
import { escapeHtml, formatTime, cut, entitiesToHtml } from '../lib/text.js';
import { mediaLabel } from '../lib/media.js';

const CACHED = {
  photo: ['photo', 'photo_file_id'], live_photo: ['photo', 'photo_file_id'], video: ['video', 'video_file_id'],
  animation: ['gif', 'gif_file_id'], document: ['document', 'document_file_id'], voice: ['voice', 'voice_file_id'],
  audio: ['audio', 'audio_file_id'], sticker: ['sticker', 'sticker_file_id'],
};
const NEEDS_TITLE = new Set(['video', 'document', 'voice']);

/** @param {any} row @param {string} tz @param {any} [lang] язык владельца: подпись «Вы · время» уходит в чат получателя его словами */
export function shareResult(row, tz, lang = 'ru') {
  const who = row.isOutgoing ? t(lang, 'bot.share.you') : row.senderName ?? t(lang, 'bot.share.contact');
  const sign = `${who} · ${formatTime(new Date(row.date), tz, lang)}${row.isDeleted ? ` · ${t(lang, 'bot.share.deleted')}` : ''}`;
  const id = `ev${row.id}`;
  const cached = CACHED[row.mediaType];
  if (cached && row.fileId) {
    const [type, field] = cached;
    const caption = [row.caption, `— ${sign}`].filter(Boolean).join('\n').slice(0, 1024);
    return {
      type, id, [field]: row.fileId,
      ...(NEEDS_TITLE.has(type) ? { title: row.fileName ?? mediaLabel(row.mediaType, lang) } : {}),
      ...(type === 'sticker' ? {} : { caption }),
    };
  }
  const body = row.text ? entitiesToHtml(row.text, row.entities)
    : row.caption ? entitiesToHtml(row.caption, row.entities)
      : `<i>${escapeHtml(row.mediaType ? mediaLabel(row.mediaType, lang) : t(lang, 'bot.share.noText'))}</i>`;
  return {
    type: 'article', id,
    title: cut(row.text ?? row.caption ?? mediaLabel(row.mediaType ?? 'text', lang), 60),
    description: sign,
    input_message_content: { message_text: `${body}\n\n<i>— ${escapeHtml(sign)}</i>`.slice(0, 4096), parse_mode: 'HTML', link_preview_options: { is_disabled: true } },
  };
}

export default authed(async (input, { owner, settings }) => {
  const row = await findById(owner, Number(input.id));
  if (!row) throw endpointError('err.eventNotFound', null, 'NOT_FOUND');
  const prepared = await api.savePreparedInlineMessage({
    user_id: owner, result: shareResult(row, settings.timezone, settings.lang),
    allow_user_chats: true, allow_bot_chats: true, allow_group_chats: true, allow_channel_chats: true,
  });
  return { preparedId: prepared.id };
}, { limit: 'prepareShare' });
