// Ссылки на Mini App, inline-клавиатуры, аватары собеседников
import { api, BotApiError, db } from 'sdk';
import { and, eq } from 'sdk/db';
import { getMeta, setMeta, connectionsOf } from './repo/state.js';
import { t } from './i18n.js';
import { chats } from '../schema.js';
import { getChat } from './repo/chats.js';

// ── links: ссылки на Mini App и на копии в группе-архиве
export async function botUsername() {
  const cached = await getMeta('bot_username');
  if (cached) return cached;
  try {
    const me = await api.getMe();
    if (me?.username) {
      await setMeta('bot_username', me.username);
      await setMeta('bot_id', String(me.id));
      return me.username;
    }
  } catch (e) {
    console.warn('getMe failed', e);
  }
  return '';
}

export async function botId() {
  const cached = await getMeta('bot_id');
  if (cached) return Number(cached);
  const me = await api.getMe();
  await setMeta('bot_id', String(me.id));
  if (me.username) await setMeta('bot_username', me.username);
  return Number(me.id);
}

/** Разрешённые адреса Mini App — только хосты tgcloud, чтобы в кнопки не попало чужое. */
export const isAppUrl = (u) => typeof u === 'string' && /^https:\/\/app\d+\.tgcloud\.ai\/?$/.test(u);

export async function instanceAppUrl() {
  const v = await getMeta('app_url');
  return v && isAppUrl(v) ? v : '';
}

/**
 * @param {string} start маршрут: e<id> — событие, c<chatId> — переписка, '' — главная
 * @returns {Promise<{ web_app: { url: string } } | { url: string }>}
 */
export async function openTarget(start) {
  const base = await instanceAppUrl();
  if (base) return { web_app: { url: `${base.replace(/\/$/, '')}/${start ? `?s=${encodeURIComponent(start)}` : ''}` } };
  const u = await botUsername();
  return { url: `https://t.me/${u}?startapp${start ? `=${encodeURIComponent(start)}` : ''}` };
}

/** @param {number} chatId */
export const internalChatId = (chatId) => String(chatId).replace(/^-100/, '');

export function archiveMessageLink(chatId, threadId, messageId) {
  return threadId
    ? `https://t.me/c/${internalChatId(chatId)}/${threadId}/${messageId}`
    : `https://t.me/c/${internalChatId(chatId)}/${messageId}`;
}

// ── keyboards: callback_data ≤ 64 байт
async function openBtn(text, start) {
  const target = await openTarget(start);
  return { text, ...target };
}

async function canReply(owner) {
  if (owner == null) return false;
  return (await connectionsOf(owner)).some((c) => c.isEnabled && c.canReply);
}

/** @param {{ owner?: number, eventId?: number, chatId: number, muted?: boolean, lang?: any }} o */
export async function eventActions(o) {
  const rows = [];
  const open = o.eventId != null
    ? await openBtn(t(o.lang, 'kb.openEvent'), `e${o.eventId}`)
    : await openBtn(t(o.lang, 'kb.openChat'), `c${o.chatId}`);
  rows.push([open]);
  const second = [];
  if (o.eventId != null) second.push({ text: t(o.lang, 'kb.favorite'), callback_data: `fav:${o.eventId}` });
  second.push({ text: t(o.lang, o.muted ? 'kb.unmute' : 'kb.mute'), callback_data: `mute:${o.chatId}` });
  rows.push(second);
  const third = [];
  if (await canReply(o.owner)) third.push(await openBtn(t(o.lang, 'kb.reply'), `r${o.chatId}`));
  if (o.eventId != null) third.push({ text: t(o.lang, 'kb.fromArchive'), callback_data: `del:${o.eventId}` });
  if (third.length) rows.push(third);
  return { inline_keyboard: rows };
}

/** @param {number} eventId @param {any} [lang] */
export function confirmDelete(eventId, lang) {
  return {
    inline_keyboard: [[
      { text: t(lang, 'kb.confirmDelete'), callback_data: `del:${eventId}:ok` },
      { text: t(lang, 'kb.cancel'), callback_data: `del:${eventId}:no` },
    ]],
  };
}

/** @param {any} [lang] */
export async function openOnly(lang) {
  return { inline_keyboard: [[await openBtn(t(lang, 'common.openApp'), '')]] };
}

// ── avatars: Bot API не обещает фото собеседника, пробуем лениво; при отказе платформы запоминаем
const DAY = 86_400_000;
const GIVE_UP_AFTER = 5;

/** @param {any[]} sizes */
function pick(sizes) {
  if (!sizes?.length) return null;
  return (sizes.find((s) => Math.max(s.width ?? 0, s.height ?? 0) >= 160) ?? sizes.at(-1)).file_id ?? null;
}

/** @param {number} owner @param {number} chatId */
export async function refreshAvatar(owner, chatId, now = Date.now()) {
  if ((await getMeta('cap_profile_photos')) === 'false') return null;
  const c = await getChat(owner, chatId);
  if (!c?.senderId) return null;
  if (c.photoCheckedAt && now - new Date(c.photoCheckedAt).getTime() < DAY) return c.photoFileId ?? null;
  let fileId = null;
  try {
    const r = await api.getUserProfilePhotos({ user_id: Number(c.senderId), limit: 1 });
    fileId = pick(r?.photos?.[0]);
    await setMeta('avatar_failures', '0');
  } catch (e) {
    if (!(e instanceof BotApiError)) { console.warn('getUserProfilePhotos', e); return c.photoFileId ?? null; }
    const fails = Number((await getMeta('avatar_failures')) ?? 0) + 1;
    await setMeta('avatar_failures', String(fails));
    if (fails >= GIVE_UP_AFTER) await setMeta('cap_profile_photos', 'false');
  }
  await db.update(chats).set({ photoFileId: fileId, photoCheckedAt: new Date(now) })
    .where(and(eq(chats.ownerUserId, owner), eq(chats.chatId, chatId)));
  return fileId;
}
