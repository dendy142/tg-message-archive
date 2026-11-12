import { api, BotApiError, InputFile } from 'sdk';
import { endpointError } from '../lib/i18n.js';
import { authed, requireOwnChat } from '../lib/runtime.js';
import { connectionsOf } from '../lib/repo/state.js';
import { lastInChat, findById } from '../lib/repo/messages.js';
import { SEND_METHOD, FILE_FIELD, NO_CAPTION } from '../lib/media.js';
import { base64ToBytes } from '../lib/util.js';

/** Файл с устройства — не больше 5 МБ (тело запроса Mini App идёт base64). */
export const UPLOAD_LIMIT = 5 * 1024 * 1024;

/** @param {string} mime */
function methodForMime(mime) {
  if (/^image\/(jpeg|png|webp)$/.test(mime)) return 'sendPhoto';
  if (/^video\//.test(mime)) return 'sendVideo';
  if (/^audio\//.test(mime)) return 'sendAudio';
  return 'sendDocument';
}

export default authed(async (input, { owner }) => {
  const chatId = await requireOwnChat(owner, input.chatId);
  const text = String(input.text ?? '').trim();
  if (text.length > 4096) throw endpointError('err.tooLong', null, 'TOO_LONG');

  /** @type {{ method: string, file: any } | null} */
  let attach = null;
  if (input.fileEventId != null) {
    const f = await findById(owner, Number(input.fileEventId));
    const method = f?.fileId ? SEND_METHOD[f.mediaType ?? ''] : null;
    if (!f || !method) throw endpointError('err.noFile', null, 'NO_FILE');
    attach = { method, file: f.fileId };
  } else if (input.upload) {
    const u = input.upload;
    let bytes;
    try { bytes = base64ToBytes(String(u.base64 ?? '')); } catch { throw endpointError('err.fileBroken', null, 'BAD_FILE'); }
    if (!bytes.length) throw endpointError('err.fileEmpty', null, 'BAD_FILE');
    if (bytes.length > UPLOAD_LIMIT) throw endpointError('err.fileOver5', null, 'TOO_LARGE');
    const mime = String(u.mime ?? 'application/octet-stream');
    attach = { method: methodForMime(mime), file: new InputFile(bytes, String(u.name ?? 'file').slice(0, 120), { type: mime }) };
  }
  if (!text && !attach) throw endpointError('err.emptyMessage', null, 'EMPTY');
  if (attach && text.length > 1024) throw endpointError('err.captionTooLong', null, 'TOO_LONG');

  const last = await lastInChat(owner, chatId);
  const conns = await connectionsOf(owner);
  const conn = conns.find((c) => c.isEnabled && c.canReply && (!last || c.businessConnectionId === last.businessConnectionId))
    ?? conns.find((c) => c.isEnabled && c.canReply);
  if (!conn) throw endpointError('err.noReplyRight', null, 'NO_REPLY_RIGHT');

  let reply = {};
  if (input.replyTo != null) {
    const r = await findById(owner, Number(input.replyTo));
    if (r && Number(r.chatId) === chatId) reply = { reply_parameters: { message_id: Number(r.messageId), allow_sending_without_reply: true } };
  }

  const base = { business_connection_id: conn.businessConnectionId, chat_id: chatId, ...reply };
  try {
    const sent = attach
      ? await api[attach.method]({ ...base, [FILE_FIELD[attach.method]]: attach.file, ...(text && !NO_CAPTION.has(attach.method) ? { caption: text } : {}) })
      : await api.sendMessage({ ...base, text });
    return { sent: true, messageId: sent.message_id };
  } catch (e) {
    if (e instanceof BotApiError) {
      throw endpointError('err.tgRejectedReply', null, 'TG', { description: e.description });
    }
    throw e;
  }
}, { limit: 'reply' });
