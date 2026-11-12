import { api } from 'sdk';
import { t } from '../lib/i18n.js';
import { updateHandler, reporter } from '../lib/runtime.js';
import { toggleFavorite, findById, deleteById } from '../lib/repo/messages.js';
import { eventActions, confirmDelete } from '../lib/links.js';
import { eraseOwner, drainJobs } from '../lib/jobs.js';
import { toggleMute, ensureSettings, updateSettings, langOf } from '../lib/repo/state.js';
import { drainMirror } from '../lib/archive.js';
import { drainOutbox } from '../lib/events.js';

async function sideWork(owner) {
  const s = await ensureSettings(owner);
  await drainOutbox(owner, 3).catch(reporter('drainOutbox', owner));
  await drainMirror(owner, s.timezone, new Date(), 5, 5, Infinity, s.lang).catch(reporter('drainMirror', owner));
  await drainJobs(owner, s.timezone, new Date(), 1, s.lang).catch(reporter('drainJobs', owner));
}

export default updateHandler(async (cq) => {
  if (!cq?.data) return null;
  const owner = cq.from?.id;
  const result = await handle(cq, owner);
  // После /delete_me владельца больше нет — не создаём ему настройки заново.
  if (owner && !result?.erased) await sideWork(Number(owner)).catch(reporter('sideWork', owner));
  return result;
});

async function handle(cq, owner) {
  // Язык нажавшего — из его настроек (без создания строки: после /delete_me её уже нет).
  const lang = await langOf(Number(owner), cq.from?.language_code);
  const answer = (text) => api.answerCallbackQuery({ callback_query_id: cq.id, text }).catch(() => {});

  const fav = /^fav:(\d+)$/.exec(cq.data);
  if (fav) {
    const state = await toggleFavorite(Number(owner), Number(fav[1]));
    await answer(t(lang, state === null ? 'bot.cb.eventNotFound' : state ? 'bot.cb.favOn' : 'bot.cb.favOff'));
    return { favorite: state };
  }
  const mute = /^mute:(-?\d+)$/.exec(cq.data);
  if (mute) {
    const muted = await toggleMute(Number(owner), Number(mute[1]));
    await answer(t(lang, muted ? 'bot.cb.muteOn' : 'bot.cb.muteOff'));
    return { muted };
  }
  const pin = /^pin:(reset|keep)$/.exec(cq.data);
  if (pin) {
    if (cq.message) await api.editMessageReplyMarkup({ chat_id: cq.message.chat.id, message_id: cq.message.message_id, reply_markup: { inline_keyboard: [] } }).catch(() => {});
    if (pin[1] === 'keep') { await answer(t(lang, 'bot.cb.pinKeep')); return { pinReset: false }; }
    // Чат с ботом — это сам владелец, поэтому сброс без проверки PIN.
    await updateSettings(Number(owner), { pinHash: null, pinSalt: null, pinFailed: 0, pinLockedUntil: null, lockMode: 'biometric', lockEnabled: true });
    await answer(t(lang, 'bot.cb.pinReset'));
    return { pinReset: true };
  }
  const erase = /^erase:(ok|no)$/.exec(cq.data);
  if (erase) {
    if (cq.message) await api.editMessageReplyMarkup({ chat_id: cq.message.chat.id, message_id: cq.message.message_id, reply_markup: { inline_keyboard: [] } }).catch(() => {});
    if (erase[1] === 'no') { await answer(t(lang, 'bot.cb.cancelled')); return { erased: false }; }
    const removed = await eraseOwner(Number(owner));
    await answer(t(lang, 'bot.cb.erased'));
    await api.sendMessage({ chat_id: owner, text: t(lang, 'bot.cb.erasedMsg', { removed, path: t(lang, 'bot.connectPath') }) }).catch(() => {});
    return { erased: true, removed };
  }
  const del = /^del:(\d+)(?::(ok|no))?$/.exec(cq.data);
  if (del) return deleteFlow(cq, Number(owner), Number(del[1]), /** @type {'ok' | 'no' | null} */ (del[2] ?? null), answer, lang);
  console.warn('unknown callback_data', cq.data);
  await api.answerCallbackQuery({ callback_query_id: cq.id }).catch(() => {});
  return null;
}

/**
 * @param {any} cq @param {number} owner @param {number} id @param {'ok' | 'no' | null} step @param {(text: string) => Promise<any>} answer @param {any} lang
 */
async function deleteFlow(cq, owner, id, step, answer, lang) {
  const at = { chat_id: cq.message?.chat?.id, message_id: cq.message?.message_id };
  const setKeyboard = (reply_markup) => (at.chat_id && at.message_id
    ? api.editMessageReplyMarkup({ ...at, reply_markup }).catch(reporter('editMessageReplyMarkup', owner))
    : null);
  const row = await findById(owner, id);
  if (!row) { await answer(t(lang, 'bot.cb.alreadyDeleted')); return { deleted: false }; }
  if (step === null) { await setKeyboard(confirmDelete(id, lang)); await answer(''); return { confirm: true }; }
  if (step === 'no') {
    await setKeyboard(await eventActions({ owner, eventId: id, chatId: Number(row.chatId), lang }));
    await answer('');
    return { confirm: false };
  }
  await deleteById(owner, id);
  await setKeyboard({ inline_keyboard: [[{ text: t(lang, 'kb.muteChat'), callback_data: `mute:${row.chatId}` }]] });
  await answer(t(lang, 'bot.cb.deletedFromArchive'));
  return { deleted: true };
}
