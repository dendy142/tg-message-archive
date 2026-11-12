// События бизнес-чатов: сохранение (capture) и уведомления (notify)
import { api, BotApiError, InputFile } from 'sdk';
import * as msg from './repo/messages.js';
import { ensureSettings, getConnection, upsertConnection, connectionFromApi, chatPref, updateSettings, langOf, isMuted, openBatch, startBatch, touchBatch, dropBatch } from './repo/state.js';
import { messageInput, entitiesOf, extractMedia, repliedOneTimeInput, mediaLabel } from './media.js';
import { matchKeywords, h, p, footer, mark, quote, details, list, table, time, blocks, br, entitiesToHtml, escapeHtml, formatTime, formatDateTime, userLink, cut } from './text.js';
import { captureOneTime } from './archive.js';
import { notifyAllowed, mirrorAllowed, inQuietHours } from './view.js';
import { ensureChatsBuilt, getChat } from './repo/chats.js';
import { markConnectionState, setPurgeNotifier } from './jobs.js';
import { WIPE_MIN_MESSAGES, BURST_DELETE_THRESHOLD } from './util.js';
import { admitChat } from './plans.js';
import { t } from './i18n.js';
import { eventActions, openOnly } from './links.js';
import { sendView, editViewAt, isTransient, isBlocked, retryDelayMs, outboxHead, deleteOutbox, bumpOutbox, outboxOwners, clearOutbox, GLOBAL_TASKS, report } from './runtime.js';

// ── capture: обработка бизнес-событий
/** Трансляция геопозиции: Telegram правит сообщение каждые несколько секунд — применяем молча. @param {any} m */
export const isLocationEdit = (m) => !!m.location;

/**
 * Нет в базе — восстанавливаем через getBusinessConnection; отключённые игнорируем.
 * @param {string} connId
 */
export async function resolveConnection(connId) {
  let conn = await getConnection(connId);
  if (!conn) {
    try {
      const bc = await api.getBusinessConnection(connId);
      if (!bc) return null;
      await upsertConnection(connectionFromApi(bc));
      await ensureSettings(Number(bc.user_chat_id ?? bc.user?.id));
      conn = await getConnection(connId);
    } catch (e) {
      console.warn('getBusinessConnection failed for', connId, e);
      return null;
    }
  }
  return conn && conn.isEnabled ? conn : null;
}

async function maybeRead(conn, settings, chatId, messageId) {
  if (!conn.canRead || settings.readMode === 'off') return;
  if (settings.readMode === 'chats') {
    const pref = await chatPref(settings.ownerUserId, chatId);
    if (!pref?.autoRead) return;
  }
  try {
    await api.readBusinessMessage({ business_connection_id: conn.businessConnectionId, chat_id: chatId, message_id: messageId });
  } catch (e) {
    if (!(e instanceof BotApiError)) throw e;
    console.warn('readBusinessMessage failed', e.description);
  }
}

const isExcluded = async (owner, chatId) => !!(await chatPref(owner, chatId))?.excluded;

/** @param {any} input @param {any} settings */
function applyMirrorPolicy(input, settings) {
  if (input.mirrorStatus === 'pending' && !mirrorAllowed(settings, input.mediaType, input.fileSize)) input.mirrorStatus = 'none';
  return input;
}

/** @param {number} owner @param {any} input */
async function detectRename(owner, input) {
  if (input.isOutgoing || !input.senderName) return null;
  const prev = await getChat(owner, input.chatId);
  if (!prev?.senderName) return null;
  const nameChanged = prev.senderName !== input.senderName;
  const userChanged = (prev.senderUsername ?? null) !== (input.senderUsername ?? null) && prev.senderUsername != null;
  if (!nameChanged && !userChanged) return null;
  return {
    chatId: input.chatId, oldName: prev.senderName, newName: input.senderName,
    oldUsername: prev.senderUsername ?? null, newUsername: input.senderUsername ?? null,
  };
}

/** @param {any} m businessMessage @param {string} connId */
export async function onNewMessage(m, connId) {
  const conn = await resolveConnection(connId);
  if (!conn) return null;
  const owner = conn.ownerUserId;
  // self-chat владельца (chat.id == owner) не архивируем.
  if (m.chat.id === owner) return null;
  if (await isExcluded(owner, m.chat.id)) return null;
  const settings = await ensureSettings(owner);
  await ensureChatsBuilt(settings);
  if (!(await admitChat(owner, m.chat.id))) return null;
  const input = applyMirrorPolicy(messageInput(connId, m, owner), settings);
  const rename = notifyAllowed(settings, 'rename') ? await detectRename(owner, input) : null;
  const saved = await msg.saveMessage(input);
  await maybeRead(conn, settings, m.chat.id, m.message_id);
  // Ответ свайпом несёт view-once файл: его не переслать по file_id,
  // поэтому ловим сразу (скачать + перезалить), без очереди.
  let oneTime = null;
  const replied = repliedOneTimeInput(m, owner, connId);
  if (replied && !(await msg.findByKey(connId, replied.chatId, replied.messageId))) {
    const res = await captureOneTime(owner, replied, settings.timezone, new Date(), settings.lang).catch((e) => { console.warn('captureOneTime', e); return null; });
    oneTime = res?.saved ?? null;
  }
  const hits = !input.isOutgoing
    ? matchKeywords(/** @type {string[] | null} */ (settings.keywords), input.searchText, {
      wholeWord: settings.keywordWholeWord, exclude: /** @type {string[] | null} */ (settings.keywordExclude),
    })
    : [];
  return { owner, tz: settings.timezone, lang: settings.lang, saved, keywordHits: hits, oneTime, rename };
}

/** @param {any} m editedBusinessMessage @param {string} connId */
export async function onEdit(m, connId) {
  const conn = await resolveConnection(connId);
  if (!conn) return null;
  const owner = conn.ownerUserId;
  if (m.chat.id === owner) return null;
  if (await isExcluded(owner, m.chat.id)) return null;
  const settings = await ensureSettings(owner);
  const silent = isLocationEdit(m);
  const media = extractMedia(m);
  const newText = m.text ?? m.caption ?? (media.mediaType && !media.fileId ? media.caption ?? null : null);
  const key = { businessConnectionId: connId, chatId: m.chat.id, messageId: m.message_id };
  const res = await msg.applyEdit(key, {
    silent,
    text: newText,
    entities: entitiesOf(m),
    media: media.fileUniqueId ? media : undefined,
    editedAt: m.edit_date ? new Date(m.edit_date * 1000) : undefined,
  });
  // Правка сообщения, пришедшего до подключения, — сохранить как новое.
  if (!res.existed) {
    const input = applyMirrorPolicy(messageInput(connId, m, owner), settings);
    const saved = await msg.saveMessage(input);
    return { owner, tz: settings.timezone, lang: settings.lang, created: true, saved };
  }
  return { owner, tz: settings.timezone, lang: settings.lang, silent, changed: res.changed, row: res.row };
}

/** @param {any} d deletedBusinessMessages @param {string} connId */
export async function onDelete(d, connId) {
  const conn = await resolveConnection(connId);
  if (!conn) return null;
  const owner = conn.ownerUserId;
  const chatId = d.chat.id;
  if (await isExcluded(owner, chatId)) return null;
  const settings = await ensureSettings(owner);
  const deletedAt = new Date();
  const ids = (d.message_ids ?? []).map(Number);
  const known = await msg.existingMessageIds(connId, chatId, ids);
  const missing = ids.filter((id) => !known.has(id));
  const transitioned = await msg.markDeletedMany(connId, chatId, ids, deletedAt);
  if (transitioned.length === 0) return { owner, tz: settings.timezone, lang: settings.lang, chatId, transitioned: [], wipe: false, missing, deletedAt };
  const counts = await msg.chatCounts(connId, chatId);
  const wipe = counts.nonDeleted === 0 && counts.total >= WIPE_MIN_MESSAGES;
  return { owner, tz: settings.timezone, lang: settings.lang, chatId, transitioned, wipe, counts, deletedAt, missing };
}

/** @param {any} bc businessConnection */
export async function onConnection(bc) {
  const v = connectionFromApi(bc);
  await upsertConnection(v);
  await ensureSettings(v.ownerUserId);
  await markConnectionState(v.ownerUserId, !!v.isEnabled);
  return v;
}

// ── notify: уведомления владельцу
const DEL_BATCH = 'del';
const INLINE_DELETED = 5;
const MAX_ARCHIVE_CHARS = 3_000_000;

// Язык (lang) везде берётся из настроек владельца: в одном изоляте одновременно идут запросы
// разных владельцев, глобального «текущего языка» нет.
const who = (r, lang) => (r.senderId ? userLink(Number(r.senderId), r.senderName ?? t(lang, 'common.contact')) : escapeHtml(r.senderName ?? t(lang, 'common.contact')));
const chatSuffix = (r) => (!r.chatName || r.chatName === r.senderName ? '' : ` · 💬 ${escapeHtml(r.chatName)}`);
const whoLine = (r, lang) => `👤 ${who(r, lang)}${chatSuffix(r)}`;
const when = (d, tz, fmt = 'dt', lang = 'ru') => time(new Date(d), formatTime(new Date(d), tz, lang), fmt);

/** @param {any} r */
function contextHtml(r, lang) {
  const lines = [];
  if (r.forwardOrigin) lines.push(t(lang, 'notify.forwarded'));
  if (r.replyToText || r.replyToSender) {
    const s = r.replyToSender ? `${escapeHtml(r.replyToSender)}: ` : '';
    const what = r.replyToText ? t(lang, 'notify.quote', { text: escapeHtml(cut(String(r.replyToText).replace(/\s+/g, ' '), 80)) }) : t(lang, 'notify.messageWord');
    lines.push(t(lang, 'notify.replyTo', { who: s, what }));
  }
  return lines.length ? lines.join(br) + br : '';
}

/** @param {any} r */
function bodyHtml(r, lang) {
  const ctx = contextHtml(r, lang);
  if (r.text) return ctx + entitiesToHtml(r.text, r.entities);
  if (r.mediaType) {
    const album = r.albumCount > 1;
    const label = `<i>${album ? t(lang, 'notify.album', { n: r.albumCount }) : mediaLabel(r.mediaType, lang)}</i>`;
    return ctx + (r.caption ? `${label}${br}${entitiesToHtml(r.caption, r.entities)}` : label);
  }
  return ctx + `<i>${t(lang, 'notify.noText')}</i>`;
}

/** @param {any[]} rows */
function groupAlbums(rows) {
  const out = [];
  const at = new Map();
  for (const r of rows) {
    const g = r.mediaGroupId;
    if (!g) { out.push({ ...r, albumCount: 1 }); continue; }
    const i = at.get(g);
    if (i === undefined) { at.set(g, out.length); out.push({ ...r, albumCount: 1 }); continue; }
    out[i].albumCount++;
    if (!out[i].caption && r.caption) { out[i].caption = r.caption; out[i].entities = r.entities; }
  }
  return out;
}

const eventQuote = (r, tz, lang) => quote(bodyHtml(r, lang), `${who(r, lang)} · ${when(r.date, tz, 't', lang)}`, (r.text ?? r.caption ?? '').length > 300);

const hidden = (lang) => p(t(lang, 'notify.hidden'));

/** @param {number} n @param {any} lang */
const missingLine = (n, lang) => t(lang, 'notify.missing', { n });

function renderDeleted(rows, tz, burst, hide = false, missing = 0, lang = 'ru') {
  if (!rows.length) return '';
  const r0 = rows[0];
  const title = rows.length === 1 ? t(lang, 'notify.deleted.one') : t(lang, 'notify.deleted.many', { n: rows.length });
  const shown = rows.slice(0, INLINE_DELETED);
  const rest = rows.slice(INLINE_DELETED);
  return blocks(
    burst && p(mark(t(lang, 'notify.burst'))),
    h(3, title),
    p(`${whoLine(r0, lang)} · ${when(r0.date, tz, 'dt', lang)}`),
    ...(hide ? [hidden(lang)] : shown.map((r) => eventQuote(r, tz, lang))),
    !hide && rest.length > 0 && details(t(lang, 'notify.more', { n: rest.length }), rest.map((r) => eventQuote(r, tz, lang)).join('')),
    footer(missing > 0 ? t(lang, 'notify.copySavedMissing', { missing: missingLine(missing, lang) }) : t(lang, 'notify.copySaved')),
  );
}

/** @param {string | null} chatName @param {number} n @param {any} lang */
function renderDeletedUnknown(chatName, n, lang) {
  return blocks(
    h(3, t(lang, 'notify.deletedN', { n })),
    p(`${chatName ? `💬 ${escapeHtml(chatName)} · ` : ''}${t(lang, n === 1 ? 'notify.unknown.one' : 'notify.unknown.many')}`),
    footer(t(lang, 'notify.notStored')),
  );
}

function renderEdited(row, oldText, newText, tz, ents, hide = false, lang = 'ru') {
  if (hide) return blocks(h(3, t(lang, 'notify.edited.title')), p(`${whoLine(row, lang)} · ${when(row.date, tz, 'dt', lang)}`), hidden(lang));
  const oldHtml = oldText ? entitiesToHtml(oldText, ents?.old) : t(lang, 'notify.empty');
  const newHtml = newText ? entitiesToHtml(newText, ents?.new) : t(lang, 'notify.empty');
  return blocks(
    h(3, t(lang, 'notify.edited.title')),
    p(`${whoLine(row, lang)} · ${when(row.date, tz, 'dt', lang)}`),
    h(5, t(lang, 'notify.edited.was')), quote(oldHtml, undefined, (oldText ?? '').length > 300),
    h(5, t(lang, 'notify.edited.now')), quote(newHtml, t(lang, 'notify.edited.at', { time: when(row.lastEditedAt ?? new Date(), tz, 't', lang) }), (newText ?? '').length > 300),
  );
}

function renderEditedNoOriginal(chatName, newText, tz, date, ents, hide = false, lang = 'ru') {
  if (hide) return blocks(h(3, t(lang, 'notify.edited.title')), p([chatName && `💬 ${escapeHtml(chatName)}`, when(date, tz, 'dt', lang)].filter(Boolean).join(' · ')), hidden(lang));
  return blocks(
    h(3, t(lang, 'notify.edited.title')),
    p([chatName && `💬 ${escapeHtml(chatName)}`, when(date, tz, 'dt', lang)].filter(Boolean).join(' · ')),
    p(t(lang, 'notify.edited.noOriginal')),
    quote(newText ? entitiesToHtml(newText, ents) : t(lang, 'notify.empty')),
  );
}

function renderKeyword(row, hits, tz, hide = false, lang = 'ru') {
  if (hide) return blocks(h(3, t(lang, 'notify.keyword.title')), p(`${whoLine(row, lang)} · ${when(row.date, tz, 'dt', lang)}`), hidden(lang));
  return blocks(
    h(3, t(lang, 'notify.keyword.title')),
    p(`${whoLine(row, lang)} · ${when(row.date, tz, 'dt', lang)}`),
    p(t(lang, 'notify.keyword.hit', { words: hits.map((w) => `<b>${escapeHtml(w)}</b>`).join(', ') })),
    quote(bodyHtml(row, lang)),
  );
}

function renderConnected(lang) {
  return blocks(
    h(3, t(lang, 'notify.connected.title')),
    p(t(lang, 'notify.connected.body')),
    list([{ html: t(lang, 'notify.connected.li1') }, { html: t(lang, 'notify.connected.li2') }, { html: t(lang, 'notify.connected.li3') }]),
    footer(t(lang, 'notify.connected.footer')),
  );
}

/** @param {number | null} purgeDays @param {any} lang */
function renderDisconnected(purgeDays, lang) {
  return blocks(
    h(3, t(lang, 'notify.disconnected.title')),
    p(purgeDays ? t(lang, 'notify.disconnected.purge', { days: purgeDays }) : t(lang, 'notify.disconnected.keep')),
    footer(t(lang, 'notify.disconnected.footer', { path: escapeHtml(t(lang, 'bot.connectPath')) })),
  );
}

function renderPurged(lang) {
  return blocks(
    h(3, t(lang, 'notify.purged.title')),
    p(t(lang, 'notify.purged.body')),
  );
}

function renderRename(r, lang) {
  const lines = [];
  if (r.oldName !== r.newName) lines.push(`${escapeHtml(r.oldName)} → <b>${escapeHtml(r.newName)}</b>`);
  if ((r.oldUsername ?? null) !== (r.newUsername ?? null)) {
    lines.push(r.newUsername ? `@${escapeHtml(r.oldUsername ?? '—')} → <b>@${escapeHtml(r.newUsername)}</b>` : t(lang, 'notify.rename.hid', { u: escapeHtml(r.oldUsername ?? '') }));
  }
  return blocks(
    h(3, t(lang, 'notify.rename.title')),
    p(lines.join(br)),
    footer(t(lang, 'notify.rename.footer')),
  );
}

/** @param {string | null} chatName @param {number} count @param {boolean} attached приложен ли .txt-архив @param {any} lang */
function renderWipe(chatName, count, attached, lang) {
  return blocks(
    h(3, t(lang, 'notify.wipe.title')),
    p(t(lang, 'notify.wipe.body', { name: escapeHtml(chatName ?? '—') })),
    table([
      [{ html: t(lang, 'notify.wipe.thCount'), header: true }, { html: t(lang, 'notify.wipe.thSaved'), header: true }],
      [{ html: String(count), align: 'center' }, { html: t(lang, 'notify.wipe.saved'), align: 'center' }],
    ], { compact: true }),
    attached
      ? `<figure><tg-document src="tg://document?id=archive"></tg-document><figcaption>${t(lang, 'notify.wipe.file')}</figcaption></figure>`
      : p(t(lang, 'notify.wipe.noFile')),
  );
}

/** @param {any} [lang] */
export function chatArchiveTxt(chatName, rows, edits, tz, lang = 'ru') {
  const title = chatName ?? (rows[0]?.chatId != null ? String(rows[0].chatId) : '—');
  const lines = [t(lang, 'notify.txt.title', { title, n: rows.length }), ''];
  const byMsg = new Map();
  for (const e of edits) { const a = byMsg.get(e.messagePk); if (a) a.push(e); else byMsg.set(e.messagePk, [e]); }
  const preview = (r) => r.text ?? (r.mediaType ? `[${r.mediaType}${r.caption ? `: ${r.caption}` : ''}]` : t(lang, 'notify.noText'));
  for (const r of rows) {
    lines.push(`[${formatDateTime(new Date(r.date), tz, lang)}] ${r.senderName ?? t(lang, 'common.contact')}: ${preview(r)}`);
    for (const e of byMsg.get(r.id) ?? []) lines.push(t(lang, 'notify.txt.edit', { old: e.oldText ?? '', new: e.newText ?? '' }));
    if (r.isDeleted) lines.push(t(lang, 'notify.txt.deleted'));
  }
  const out = lines.join('\n');
  return out.length > MAX_ARCHIVE_CHARS ? out.slice(0, MAX_ARCHIVE_CHARS) + '\n\n' + t(lang, 'notify.txt.truncated') : out;
}

export const notifyConnected = async (owner) => {
  const { lang } = await ensureSettings(owner);
  return sendView(owner, { html: renderConnected(lang), reply_markup: await openOnly(lang) });
};
export const notifyDisconnected = async (owner) => {
  const s = await ensureSettings(owner);
  return sendView(owner, { html: renderDisconnected(s.purgeAfterDisconnectDays, s.lang) });
};
/** Зовётся до стирания настроек: язык берём из них. Шлём напрямую, без очереди. */
export const notifyPurged = async (owner) => sendView(owner, { html: renderPurged(await langOf(owner)) }, { direct: true }).catch(() => null);
setPurgeNotifier(notifyPurged);

/**
 * @param {number} owner @param {number} chatId @param {import('./view.js').NOTIFY_TYPES[number]} type @param {string} tz
 */
async function gate(owner, chatId, type, tz) {
  const s = await ensureSettings(owner);
  if (s.notificationsBlocked || !notifyAllowed(s, type)) return null;
  const muted = await isMuted(owner, chatId);
  if (muted) return null;
  const quiet = inQuietHours(/** @type {any} */ (s.quietHours), tz);
  return { s, lang: s.lang, hide: !!s.hidePreview, silent: quiet && !(type === 'keywords' && s.keywordLoud) };
}

export async function notifyEdited(owner, res, tz) {
  if (res.created) {
    const r = res.saved;
    const g = await gate(owner, Number(r.chatId), 'edited', tz);
    if (!g || (r.isOutgoing && !g.s.notifyOwn)) return;
    await sendView(owner, {
      html: renderEditedNoOriginal(r.chatName, r.caption ?? r.text ?? '', tz, r.date, r.entities, g.hide, g.lang),
      reply_markup: await eventActions({ owner, eventId: r.id, chatId: Number(r.chatId), lang: g.lang }),
      silent: g.silent,
    });
    return;
  }
  if (res.silent || !res.changed || !res.row) return;
  const r = res.row;
  const g = await gate(owner, Number(r.chatId), 'edited', tz);
  if (!g || (r.isOutgoing && !g.s.notifyOwn)) return;
  const hist = await msg.editsForMessage(owner, r.id);
  const last = hist[hist.length - 1];
  await sendView(owner, {
    html: renderEdited(r, last?.oldText ?? '', r.mediaType ? r.caption ?? '' : r.text ?? '', tz, { old: last?.oldEntities, new: r.entities }, g.hide, g.lang),
    reply_markup: await eventActions({ owner, eventId: r.id, chatId: Number(r.chatId), muted: false, lang: g.lang }),
    silent: g.silent,
  });
}

export async function notifyDeleted(owner, del, tz) {
  const chatId = Number(del.chatId);
  const g = await gate(owner, chatId, del.wipe ? 'wipe' : del.transitioned.length ? 'deleted' : 'deletedUnknown', tz);
  if (!g) return;

  if (del.wipe) {
    await dropBatch(owner, chatId, DEL_BATCH);
    await sendView(owner, await wipeView({ owner, chatId, tz, total: del.counts.total, hide: g.hide, silent: g.silent, lang: g.lang }));
    return;
  }

  const missing = notifyAllowed(g.s, 'deletedUnknown') ? del.missing?.length ?? 0 : 0;
  if (del.transitioned.length === 0) {
    if (!missing) return;
    await sendView(owner, {
      html: renderDeletedUnknown(await msg.chatTitle(owner, chatId), missing, g.lang),
      reply_markup: await eventActions({ owner, chatId, lang: g.lang }),
      silent: true,
    });
    return;
  }
  const visible = g.s.notifyOwn ? del.transitioned : del.transitioned.filter((r) => !r.isOutgoing);
  if (visible.length === 0) return;
  await sendDeletedBatched(owner, chatId, tz, visible, del.deletedAt, { ...g, missing });
}

/**
 * Отдельной функцией, чтобы очередь могла пересобрать экран при повторной доставке.
 * @param {{ owner: number, chatId: number, tz: string, total: number, hide: boolean, silent: boolean, lang?: any }} a
 */
async function wipeView(a) {
  const rows = await msg.allForChat(a.owner, a.chatId);
  const name = rows[0]?.chatName ?? null;
  const media = [];
  if (!a.hide) {
    const edits = await msg.editsForChat(a.owner, a.chatId);
    media.push({ id: 'archive', file: new InputFile(new TextEncoder().encode(chatArchiveTxt(name, rows, edits, a.tz, a.lang)), `chat-${a.chatId}-archive.txt`) });
  }
  return {
    html: renderWipe(name, a.total, !a.hide, a.lang),
    media,
    reply_markup: await eventActions({ owner: a.owner, chatId: a.chatId, muted: false, lang: a.lang }),
    silent: a.silent,
    rebuild: { fn: 'wipe', args: a },
  };
}

const REBUILD = { wipe: wipeView };

/** Паузы между попытками доставки, мин. После последней — уведомление отбрасывается. */
const OUTBOX_BACKOFF_MIN = [1, 2, 5, 15, 60, 120, 120, 120];

/**
 * Строго по порядку: пока голова не ушла, остальные ждут —
 * иначе серии удалений и «было/стало» придут вперемешку.
 * @param {number} owner @returns {Promise<number>} сколько доставлено
 */
export async function drainOutbox(owner, limit = 5, now = new Date()) {
  let sent = 0;
  for (let i = 0; i < limit; i++) {
    const head = await outboxHead(owner);
    if (!head || new Date(head.nextAt).getTime() > now.getTime()) break;
    const p = /** @type {any} */ (head.payload);
    try {
      const view = p.rebuild && REBUILD[p.rebuild.fn] ? await REBUILD[p.rebuild.fn](p.rebuild.args) : p;
      await sendView(Number(head.chatId), view, { direct: true });
      await deleteOutbox(head.id);
      sent++;
    } catch (e) {
      if (isBlocked(e)) {
        await updateSettings(owner, { notificationsBlocked: true }).catch(() => {});
        await clearOutbox(owner);
        break;
      }
      const attempts = head.attempts + 1;
      if (!isTransient(e) || attempts >= OUTBOX_BACKOFF_MIN.length) {
        await report('outbox_dropped', e, owner);
        await deleteOutbox(head.id);
        continue;
      }
      await bumpOutbox(head.id, {
        attempts, lastError: String(/** @type {any} */ (e)?.description ?? e).slice(0, 300),
        nextAt: new Date(now.getTime() + retryDelayMs(e, OUTBOX_BACKOFF_MIN[attempts - 1] * 60_000)),
      });
      break;
    }
  }
  return sent;
}

GLOBAL_TASKS.push({
  name: 'outbox',
  run: async (now) => { for (const o of await outboxOwners(20)) await drainOutbox(o, 3, now); },
});

async function sendDeletedBatched(owner, chatId, tz, rows, at, g) {
  const withButtons = async (all) => {
    const grouped = groupAlbums(all);
    return {
      html: renderDeleted(grouped, tz, grouped.length >= BURST_DELETE_THRESHOLD, g.hide, g.missing ?? 0, g.lang),
      reply_markup: await eventActions({ owner, eventId: grouped.length === 1 ? grouped[0].id : undefined, chatId, lang: g.lang }),
      silent: g.silent,
    };
  };
  const batch = await openBatch(owner, chatId, DEL_BATCH, at);
  if (batch) {
    const all = await msg.deletedSince(owner, chatId, new Date(batch.startedAt), { includeOutgoing: g.s.notifyOwn });
    if (all.length > 0) {
      const ok = await editViewAt(owner, Number(batch.messageId), await withButtons(all));
      if (ok) { await touchBatch(owner, chatId, DEL_BATCH, all.length, at); return; }
    }
  }
  const messageId = await sendView(owner, await withButtons(rows));
  if (messageId == null) { await dropBatch(owner, chatId, DEL_BATCH); return; }
  await startBatch({ ownerUserId: owner, chatId, kind: DEL_BATCH, messageId, count: rows.length }, at);
}

export async function notifyOneTime(owner, row, tz) {
  const g = await gate(owner, Number(row.chatId), 'oneTime', tz);
  if (!g) return;
  const html = blocks(
    h(3, t(g.lang, 'notify.oneTime.title')),
    p(`${whoLine(row, g.lang)} · ${when(row.date, tz, 'dt', g.lang)}`),
    g.hide ? hidden(g.lang) : quote(bodyHtml(row, g.lang)),
    footer(t(g.lang, 'notify.oneTime.footer')),
  );
  await sendView(owner, { html, reply_markup: await eventActions({ owner, eventId: row.id, chatId: Number(row.chatId), lang: g.lang }), silent: g.silent });
}

export async function notifyKeyword(owner, row, hits, tz) {
  if (hits.length === 0) return;
  const g = await gate(owner, Number(row.chatId), 'keywords', tz);
  if (!g) return;
  await sendView(owner, {
    html: renderKeyword(row, hits, tz, g.hide, g.lang),
    reply_markup: await eventActions({ owner, eventId: row.id, chatId: Number(row.chatId), lang: g.lang }),
    silent: g.silent,
  });
}

export async function notifyRename(owner, info, tz) {
  const g = await gate(owner, Number(info.chatId), 'rename', tz);
  if (!g) return;
  await sendView(owner, {
    html: renderRename(info, g.lang),
    reply_markup: await eventActions({ owner, chatId: Number(info.chatId), lang: g.lang }),
    silent: g.silent,
  });
}
