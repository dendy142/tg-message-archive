import { api, BotApiError } from 'sdk';
import { endpointError, t } from '../lib/i18n.js';
import { authed } from '../lib/runtime.js';
import { findById } from '../lib/repo/messages.js';
import { formatTime } from '../lib/text.js';
import { SEND_METHOD, FILE_FIELD, NO_CAPTION } from '../lib/media.js';

const expired = (e) => e instanceof BotApiError && e.code === 400;

export default authed(async (input, { owner, settings }) => {
  const row = await findById(owner, Number(input.id));
  if (!row?.fileId) throw endpointError('err.noFile', null, 'NO_FILE');
  const method = SEND_METHOD[row.mediaType ?? ''];
  if (!method) throw endpointError('err.cantForward', null, 'UNSUPPORTED');
  const caption = NO_CAPTION.has(method)
    ? undefined
    : `${row.isOutgoing ? '➡️' : '⬅️'} ${row.senderName ?? t(settings.lang, 'common.contact')} · ${formatTime(new Date(row.date), settings.timezone, settings.lang)}${row.isDeleted ? ` · ${t(settings.lang, 'bot.cap.deleted')}` : ''}`;
  const send = (fileId) => api[method]({ chat_id: owner, [FILE_FIELD[method]]: fileId, ...(caption ? { caption } : {}) });
  try {
    const sent = await send(row.fileId).catch(async (e) => {
      if (!expired(e) || !row.mirrorFileId || row.mirrorFileId === row.fileId) throw e;
      return send(row.mirrorFileId);
    });
    return { sent: true, messageId: sent.message_id };
  } catch (e) {
    if (expired(e)) throw endpointError('err.fileExpired', null, 'EXPIRED');
    throw e;
  }
}, { limit: 'sendToMe' });
