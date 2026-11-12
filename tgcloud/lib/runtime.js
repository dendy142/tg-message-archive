// Обвязка рантайма: отправка, outbox, ошибки, уборка, обёртки, лимиты
import { db, api, BotApiError, EndpointError } from 'sdk';
import { and, asc, eq, sql, desc, isNull, or } from 'sdk/db';
import { outbox, errors, appMeta, settings, rateLimits } from '../schema.js';
import { clampRich, toPlainHtml, RICH_LIMIT, chunkHtml, h, p, blocks, quote, escapeHtml } from './text.js';
import { updateSettings, langOf, getMeta, tsGte, tsLt, isSet, purgeOldUpdates, claimUpdate, releaseUpdate, ensureSettings } from './repo/state.js';
import { t as tr, endpointError, localizeError, langFromCode } from './i18n.js';
import { purgeOlderThan, ownsChat } from './repo/messages.js';
import { GLOBAL_HOUSEKEEPING_MS, OWNER_HOUSEKEEPING_MS, RETENTION_BATCHES, RATE_LIMITS } from './util.js';
import { ensureChatsBuilt } from './repo/chats.js';

// ── repo/outbox: очередь исходящих
/** @param {number} ownerUserId */
export async function hasOutbox(ownerUserId) {
  return (await db.$count(outbox, eq(outbox.ownerUserId, ownerUserId))) > 0;
}

/** @param {{ ownerUserId: number, chatId: number, payload: any, nextAt: Date, lastError?: string | null }} v */
export async function enqueueOutbox(v, now = new Date()) {
  const [row] = await db.insert(outbox).values({ ...v, attempts: 0, lastError: v.lastError ?? null, createdAt: now }).returning();
  return row;
}

export async function outboxHead(ownerUserId) {
  return (await db.select().from(outbox).where(eq(outbox.ownerUserId, ownerUserId)).orderBy(asc(outbox.id)).limit(1).get()) ?? null;
}

/** @param {number} id */
export async function deleteOutbox(id) {
  await db.delete(outbox).where(eq(outbox.id, id));
}

/** @param {number} id @param {{ attempts: number, nextAt: Date, lastError: string }} patch */
export async function bumpOutbox(id, patch) {
  await db.update(outbox).set(patch).where(eq(outbox.id, id));
}

export async function outboxOwners(limit = 20) {
  const rows = await db.select({ owner: outbox.ownerUserId, n: sql`count(*)` }).from(outbox)
    .groupBy(outbox.ownerUserId).orderBy(sql`min(${outbox.id})`).limit(limit).all();
  return rows.map((r) => Number(r.owner));
}

export const outboxDepth = () => db.$count(outbox);

/**
 * Экраны с rebuild: после удаления переписки им не из чего собираться.
 * @param {number} ownerUserId @param {number} chatId
 */
export async function clearChatOutbox(ownerUserId, chatId) {
  await db.delete(outbox).where(and(eq(outbox.ownerUserId, ownerUserId),
    sql`json_extract(${outbox.payload}, '$.rebuild.args.chatId') = ${chatId}`));
}

/** @param {number} ownerUserId */
export async function clearOutbox(ownerUserId) {
  await db.delete(outbox).where(eq(outbox.ownerUserId, ownerUserId));
}

// ── send: отправка и редактирование экранов
const HTML_OPTS = { parse_mode: 'HTML', link_preview_options: { is_disabled: true } };

/**
 * rebuild — как пересобрать экран при доставке из очереди, если в нём файлы
 * (InputFile в базу не сериализуется).
 * @typedef {{
 * html: string,
 * reply_markup?: any,
 * media?: { id: string, file: import('sdk').InputFile }[],
 * silent?: boolean,
 * rebuild?: { fn: string, args: any }
 * }} View
 * rebuild — как пересобрать экран при доставке из очереди, если в нём есть файлы
 * (InputFile в базу не сериализуется). Функции регистрирует lib/events.js.
 */

const errDesc = (e) => (e instanceof BotApiError ? e.description : String(e?.message ?? '')).toLowerCase();
const isNotModified = (e) => errDesc(e).includes('message is not modified');
const isNotEditable = (e) => {
  const d = errDesc(e);
  return d.includes("can't be edited") || d.includes('message to edit not found') || d.includes('there is no text in the message');
};
const richRejected = (e) => e instanceof BotApiError && e.code === 400 && !isNotModified(e) && !isNotEditable(e);

/** @param {number} chatId @param {View} v */
const clampLang = async (chatId, v) => (v.html.length > RICH_LIMIT ? langOf(chatId) : 'ru');

/** @param {View} v @param {any} lang */
function richPayload(v, lang) {
  return {
    html: clampRich(v.html, RICH_LIMIT, lang),
    ...(v.media?.length ? { media: v.media.map((m) => ({ id: m.id, media: { type: 'document', media: m.file } })) } : {}),
  };
}

const idOf = (msg) => (typeof msg?.message_id === 'number' ? msg.message_id : null);

/** @param {View} v */
const quiet = (v) => (v.silent ? { disable_notification: true } : {});

export function isTransient(e) {
  if (!(e instanceof BotApiError)) return true;
  return e.code === 429 || e.code >= 500;
}
export const isBlocked = (e) => e instanceof BotApiError && e.code === 403;
export function retryDelayMs(e, minMs) {
  const ra = e instanceof BotApiError ? Number(e.parameters?.retry_after) : NaN;
  return Math.max(minMs, Number.isFinite(ra) ? ra * 1000 : 0);
}

/** @param {View} v */
const queueable = (v) => !v.media?.length || !!v.rebuild;
/** @param {View} v */
const toPayload = (v) => ({ html: v.html, reply_markup: v.reply_markup ?? null, silent: !!v.silent, rebuild: v.rebuild ?? null });

/** @param {number} chatId @param {View} v @param {string | null} [error] @param {number} [delayMs] */
export async function queueView(chatId, v, error = null, delayMs = 60_000, now = new Date()) {
  await enqueueOutbox({ ownerUserId: chatId, chatId, payload: toPayload(v), nextAt: new Date(now.getTime() + delayMs), lastError: error });
}

/**
 * Пока у владельца непуста очередь, новое встаёт за ней — порядок сохраняется.
 * direct — из самой очереди: без постановки в очередь, ошибки наружу.
 * @param {number} chatId @param {View} v @param {{ direct?: boolean }} [opts]
 */
export async function sendView(chatId, v, opts = {}) {
  if (opts.direct) return deliver(chatId, v);
  if (queueable(v) && (await hasOutbox(chatId))) { await queueView(chatId, v, null, 0); return null; }
  try {
    return await deliver(chatId, v);
  } catch (e) {
    return onSendError(chatId, v, e);
  }
}

async function onSendError(chatId, v, e) {
  if (isBlocked(e)) {
    await updateSettings(chatId, { notificationsBlocked: true }).catch(() => {});
    console.warn('[send] bot blocked by', chatId);
    return null;
  }
  if (isTransient(e) && queueable(v)) {
    await queueView(chatId, v, String(e?.description ?? e?.message ?? e).slice(0, 300), retryDelayMs(e, 5_000));
    console.warn('[send] queued after transient error', chatId, e?.code ?? e);
    return null;
  }
  throw e;
}

/** @param {number} chatId @param {View} v */
async function deliver(chatId, v) {
  try {
    const msg = await api.sendRichMessage({ chat_id: chatId, rich_message: richPayload(v, await clampLang(chatId, v)), reply_markup: v.reply_markup, ...quiet(v) });
    return idOf(msg);
  } catch (e) {
    if (!richRejected(e)) throw e;
    console.warn('[send] rich rejected → HTML:', errDesc(e));
  }
  return sendPlain(chatId, v);
}

/** @param {number} chatId @param {View} v */
export async function sendPlain(chatId, v) {
  const parts = chunkHtml(toPlainHtml(v.html));
  let last = null;
  for (let i = 0; i < parts.length; i++) {
    const isLast = i === parts.length - 1;
    const msg = await api.sendMessage({ chat_id: chatId, text: parts[i], ...HTML_OPTS, ...quiet(v), ...(isLast && v.reply_markup ? { reply_markup: v.reply_markup } : {}) });
    if (isLast) last = idOf(msg);
  }
  // Файлы отдельными документами (в plain-ветке rich-блок tg-document не поддержан).
  for (const m of v.media ?? []) {
    try { await api.sendDocument({ chat_id: chatId, document: m.file, ...quiet(v) }); }
    catch (e) { console.error('[send] sendDocument failed', e); }
  }
  return last;
}

/** false — не редактируется или временный сбой; вызывающий шлёт новое сообщение. */
export async function editViewAt(chatId, messageId, v) {
  try {
    return await editDirect(chatId, messageId, v);
  } catch (e) {
    if (isTransient(e) || isBlocked(e)) return false;
    throw e;
  }
}

async function editDirect(chatId, messageId, v) {
  try {
    await api.editMessageText({ chat_id: chatId, message_id: messageId, ...richPayload(v, await clampLang(chatId, v)), reply_markup: v.reply_markup });
    return true;
  } catch (e) {
    if (isNotModified(e)) return true;
    if (isNotEditable(e)) return false;
    if (!richRejected(e)) throw e;
  }
  try {
    await api.editMessageText({ chat_id: chatId, message_id: messageId, text: chunkHtml(toPlainHtml(v.html))[0], ...HTML_OPTS, reply_markup: v.reply_markup });
    return true;
  } catch (e) {
    if (isNotModified(e)) return true;
    if (isNotEditable(e)) return false;
    throw e;
  }
}

// ── errors: журнал ошибок. report() не бросает никогда: стоит в catch-ветках.
export const ERRORS_KEEP_DAYS = 14;
const WRITE_EVERY_MS = 60_000;
const NOTIFY_EVERY_MS = 3_600_000;

const messageOf = (e) => String(e?.description ?? e?.message ?? e).slice(0, 1000);

/**
 * @param {string} where @param {any} e @param {number | null} [owner]
 * @returns {Promise<boolean>} записана ли строка (false — дубль за минуту или сбой записи)
 */
export async function report(where, e, owner = null, now = new Date()) {
  console.warn(`[${where}]`, e);
  try {
    const message = messageOf(e);
    const stack = typeof e?.stack === 'string' ? e.stack.slice(0, 4000) : null;
    const signature = `${where}|${message.slice(0, 80)}`;
    const t = now.getTime();
    const same = (since, ...more) => db.select({ id: errors.id }).from(errors)
      .where(and(eq(errors.signature, signature), tsGte(errors.at, t - since), ...more)).limit(1).get();
    if (await same(WRITE_EVERY_MS)) return false;
    const op = (await same(NOTIFY_EVERY_MS, isSet(errors.notified))) ? null : await getMeta('operator_id');
    await db.insert(errors).values({ at: now, where, message, stack, ownerUserId: owner, signature, notified: !!op });
    if (op) {
      const lang = await langOf(Number(op)).catch(() => 'ru');
      const html = blocks(
        h(3, `⚠️ ${escapeHtml(where)}`),
        p(escapeHtml(message)),
        owner != null ? p(tr(lang, 'report.owner', { id: owner })) : '',
        stack ? quote(`<code>${escapeHtml(stack.split('\n').slice(0, 6).join('\n'))}</code>`, '', true) : '',
        p(tr(lang, 'report.next')),
      );
      // Напрямую, без очереди: сбой уведомления оператора не должен плодить новые ошибки.
      await sendView(Number(op), { html, silent: true }, { direct: true }).catch(() => {});
    }
    return true;
  } catch (e2) {
    console.warn('[report] failed', e2);
    return false;
  }
}

/** @param {string} where @param {number | null} [owner] */
export const reporter = (where, owner = null) => (/** @type {any} */ e) => report(where, e, owner);

/** Ключ проекции `place`, не `where`: ключевые слова SQL псевдонимом не годятся. */
export async function recentErrors(limit = 50) {
  const rows = await db.select({ id: errors.id, at: errors.at, place: errors.where, message: errors.message, stack: errors.stack, ownerUserId: errors.ownerUserId })
    .from(errors).orderBy(desc(errors.at), desc(errors.id)).limit(limit).all();
  return rows.map(({ place, ...r }) => ({ ...r, where: place }));
}

export async function purgeOldErrors(now = new Date()) {
  await db.delete(errors).where(tsLt(errors.at, now.getTime() - ERRORS_KEEP_DAYS * 86_400_000));
}

// ── housekeeping: уборка без крона
// Общая — раз в час, по владельцу — раз в 6 часов; захват атомарный.
const GLOBAL_KEY = 'housekeeping_at';

/**
 * Каждая задача получает now и не должна бросать.
 * @type {{ name: string, run: (now: Date) => Promise<unknown> }[]}
 */
export const GLOBAL_TASKS = [{ name: 'processed_updates', run: () => purgeOldUpdates() }, { name: 'errors', run: (now) => purgeOldErrors(now) }];

export async function claimGlobal(now = new Date()) {
  const ts = now.getTime();
  const inserted = await db.insert(appMeta).values({ key: GLOBAL_KEY, value: String(ts), updatedAt: now })
    .onConflictDoNothing().returning();
  if (inserted.length) return true;
  const claimed = await db.update(appMeta).set({ value: String(ts), updatedAt: now })
    .where(and(eq(appMeta.key, GLOBAL_KEY), sql`cast(${appMeta.value} as integer) < ${ts - GLOBAL_HOUSEKEEPING_MS}`))
    .returning();
  return claimed.length > 0;
}

export async function maybeGlobalHousekeeping(now = new Date()) {
  if (!(await claimGlobal(now))) return null;
  const done = [];
  for (const t of GLOBAL_TASKS) {
    try { await t.run(now); done.push(t.name); } catch (e) { await report(`housekeeping:${t.name}`, e); }
  }
  return done;
}

export async function claimOwner(ownerUserId, now = new Date()) {
  const claimed = await db.update(settings).set({ housekeptAt: now })
    .where(and(eq(settings.ownerUserId, ownerUserId),
      or(isNull(settings.housekeptAt), tsLt(settings.housekeptAt, now.getTime() - OWNER_HOUSEKEEPING_MS))))
    .returning({ retentionDays: settings.retentionDays });
  return claimed[0] ?? null;
}

/** @returns {Promise<number | null>} сколько удалено; null — время не подошло */
export async function maybeOwnerHousekeeping(ownerUserId, now = new Date()) {
  const s = await claimOwner(ownerUserId, now);
  if (!s) return null;
  if (!s.retentionDays) return 0;
  const cutoff = new Date(now.getTime() - s.retentionDays * 86_400_000);
  let removed = 0;
  for (let i = 0; i < RETENTION_BATCHES; i++) {
    const n = await purgeOlderThan(ownerUserId, cutoff);
    removed += n;
    if (n === 0) break;
  }
  return removed;
}

// ── handler: обёртка обработчиков апдейтов
/**
 * @param {((payload: any, ctx: any) => Promise<any>) | null} own собственная обработка (может отсутствовать)
 */
export function updateHandler(own) {
  return async function (payload, ctx) {
    const update = ctx?.update;
    const id = update?.update_id;
    // Повтор доставки (Telegram ретраит после ошибки) — уже обработан, второй раз не пишем.
    if (id != null && !(await claimUpdate(id))) return { skipped: 'duplicate' };
    if (id != null) await maybeGlobalHousekeeping().catch((e) => report('housekeeping', e));
    try {
      return { result: own ? await own(payload, ctx) : null };
    } catch (e) {
      // Отметку снимаем: повторную доставку надо принять, иначе событие потеряется.
      if (id != null) await releaseUpdate(id).catch(() => {});
      const kind = Object.keys(update ?? {}).find((k) => k !== 'update_id') ?? 'update';
      await report(`handlers/${kind}`, e, payload?.from?.id ?? payload?.user_chat_id ?? null);
      throw e;
    }
  };
}

// ── ratelimit: ограничение частоты
/** @param {number} owner @param {keyof typeof RATE_LIMITS} bucket */
export async function rateLimit(owner, bucket, now = Date.now()) {
  const [max, windowMs] = RATE_LIMITS[bucket];
  const stale = now - windowMs;
  const [row] = await db.insert(rateLimits).values({ ownerUserId: owner, bucket, windowStart: now, count: 1 })
    .onConflictDoUpdate({
      target: [rateLimits.ownerUserId, rateLimits.bucket],
      set: {
        count: sql`case when ${rateLimits.windowStart} <= ${stale} then 1 else ${rateLimits.count} + 1 end`,
        windowStart: sql`case when ${rateLimits.windowStart} <= ${stale} then ${now} else ${rateLimits.windowStart} end`,
      },
    }).returning();
  if (row.count > max) {
    const retryAfterMs = Math.max(1000, Number(row.windowStart) + windowMs - now);
    throw endpointError('err.rateLimited', { s: Math.ceil(retryAfterMs / 1000) }, 'RATE_LIMITED', { retryAfterMs });
  }
}

GLOBAL_TASKS.push({ name: 'rate_limits', run: (now) => db.delete(rateLimits).where(sql`${rateLimits.windowStart} < ${now.getTime() - 3_600_000}`) });

// ── endpoint: обвязка endpoints Mini App
/**
 * @param {(input: any, c: { owner: number, settings: any, ctx: any }) => Promise<any>} fn
 * @param {{ limit?: keyof typeof import('./util.js').RATE_LIMITS }} [opts]
 */
export function authed(fn, opts = {}) {
  return async function (input, ctx) {
    const user = ctx?.initData?.user;
    /** @type {any} */
    let settings = null;
    try {
      if (!user?.id) throw endpointError('err.unauthorized', null, 'UNAUTHORIZED');
      const owner = Number(user.id);
      if (opts.limit) await rateLimit(owner, opts.limit);
      settings = await ensureSettings(owner);
      await ensureChatsBuilt(settings);
      return await fn(input ?? {}, { owner, settings, ctx });
    } catch (e) {
      if (e && /** @type {any} */ (e).i18n) {
        if (!settings && user?.id) settings = await ensureSettings(Number(user.id)).catch(() => null);
        throw localizeError(e, settings?.lang ?? (user?.language_code ? langFromCode(user.language_code) : 'ru'));
      }
      if (e instanceof EndpointError) throw e;
      // Сбой, а не отказ: Mini App увидит лишь «Server error».
      // Пишем в журнал, оператору отдаём текст ошибки.
      const owner = user?.id ? Number(user.id) : null;
      await report(`endpoint${typeof input?.type === 'string' ? `:${input.type.slice(0, 40)}` : ''}`, e, owner);
      const op = owner == null ? null : await getMeta('operator_id').catch(() => null);
      if (op != null && Number(op) === owner) throw new EndpointError(messageOf(e).slice(0, 300), { code: 'INTERNAL' });
      throw e;
    }
  };
}

/** Проверяет, что chatId принадлежит владельцу (защита от чужих/выдуманных id). */
export async function requireOwnChat(owner, chatId) {
  const id = Number(chatId);
  if (!Number.isFinite(id) || !(await ownsChat(owner, id))) {
    throw endpointError('err.chatNotFound', null, 'NOT_FOUND');
  }
  return id;
}

export function parseCursor(c) {
  if (c && Number.isFinite(c.k) && Number.isFinite(c.id)) return { k: Number(c.k), id: Number(c.id) };
  return null;
}
