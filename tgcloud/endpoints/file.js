// Байты файла для Mini App: качаем по file_id (getFile, до 20 МБ), отдаём base64
import { api, BotApiError } from 'sdk';
import { endpointError } from '../lib/i18n.js';
import { authed, requireOwnChat } from '../lib/runtime.js';
import { getChat } from '../lib/repo/chats.js';
import { findById } from '../lib/repo/messages.js';
import { previewable, isDrawableSticker } from '../lib/view.js';
import { MEDIA_GROUPS, DOWNLOAD_LIMIT } from '../lib/media.js';
import { toDataUrl } from '../lib/util.js';

const thumbMime = (row) => (row.mediaType === 'sticker' && !row.thumbFileId ? 'image/webp' : 'image/jpeg');
function fullMime(row) {
  if (row.mimeType) return row.mimeType;
  if (MEDIA_GROUPS.photo.includes(row.mediaType)) return 'image/jpeg';
  if (row.mediaType === 'sticker') return /** @type {any} */ (row.mediaMeta)?.video ? 'video/webm' : 'image/webp';
  if (row.mediaType === 'video' || row.mediaType === 'video_note' || row.mediaType === 'animation') return 'video/mp4';
  if (row.mediaType === 'voice') return 'audio/ogg';
  return 'application/octet-stream';
}

async function avatar(owner, input) {
  const chatId = await requireOwnChat(owner, input.chatId);
  const fileId = (await getChat(owner, chatId))?.photoFileId;
  if (!fileId) throw endpointError('err.noPhoto', null, 'NO_PREVIEW');
  try {
    return { kind: 'avatar', mime: 'image/jpeg', dataUrl: toDataUrl(await api.getFileContent(fileId), 'image/jpeg') };
  } catch (e) {
    if (e instanceof BotApiError && e.code === 400) throw endpointError('err.photoUnavailable', null, 'EXPIRED');
    throw e;
  }
}

export default authed(async (input, { owner }) => {
  if (input.kind === 'avatar') return avatar(owner, input);
  const id = Number(input.id);
  const kind = input.kind === 'full' ? 'full' : 'thumb';
  const row = await findById(owner, id);
  if (!row || !row.mediaType) throw endpointError('err.fileNotFound', null, 'NOT_FOUND');

  const selfThumb = row.mediaType === 'photo' || (isDrawableSticker(row) && !/** @type {any} */ (row.mediaMeta)?.video);
  const fileId = kind === 'thumb' ? (row.thumbFileId ?? (selfThumb ? row.fileId : null)) : row.fileId;
  // Запасной — копия в группе-архиве: её file_id живёт, даже когда исходный протух.
  const backupId = kind === 'thumb' ? (row.mirrorThumbFileId ?? (selfThumb ? row.mirrorFileId : null)) : row.mirrorFileId;
  if (!fileId) throw endpointError('err.noPreview', null, 'NO_PREVIEW');
  if (kind === 'full' && !previewable(row)) {
    throw endpointError('err.fileTooBigView', null, 'TOO_LARGE', { size: row.fileSize ?? null, limit: DOWNLOAD_LIMIT });
  }
  try {
    const bytes = await api.getFileContent(fileId).catch((e) => {
      if (!(e instanceof BotApiError && e.code === 400) || !backupId || backupId === fileId) throw e;
      return api.getFileContent(backupId);
    });
    const mime = kind === 'thumb' ? thumbMime(row) : fullMime(row);
    return { kind, mediaType: row.mediaType, mime, dataUrl: toDataUrl(bytes, mime) };
  } catch (e) {
    if (e instanceof BotApiError && e.code === 400) throw endpointError('err.fileExpired', null, 'EXPIRED');
    throw e;
  }
}, { limit: 'file' });
