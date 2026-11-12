// Сообщения архива и полнотекстовый индекс поиска
import { db } from 'sdk';
import { and, eq, sql, or, ne, isNull, isNotNull, inArray, asc, desc } from 'sdk/db';
import { messages, settings, edits, chatPrefs, notifBatches } from '../../schema.js';
import { capabilities, tsGte, tsGt, tsLt, tsLte, beforeTs, afterTs, isSet, notSet, positive } from './state.js';
import { MEDIA_GROUPS } from '../media.js';
import { normalizeSearch, escapeLike } from '../text.js';
import { periodCutoff, startOfDay } from '../util.js';
import * as chatsRepo from './chats.js';

// ── repo/fts: индекс FTS5 (rowid = messages.id)
// Только при ftsBuilt и поддержке рантайма; запись сырыми запросами — таблица виртуальная
const CREATE = `CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(search_text, owner_user_id UNINDEXED, tokenize = 'unicode61 remove_diacritics 2')`;
/** Больше — собирает оператор: lib/admin {"rebuildFts": …}. */
export const FTS_BUILD_LIMIT = 100_000;

const ensureTable = () => db.run(sql.raw(CREATE));
/** @param {() => Promise<any>} fn */
async function withTable(fn) {
  try { return await fn(); }
  catch (e) {
    if (!/no such table: messages_fts/.test(String(/** @type {any} */ (e)?.message ?? e) + String(/** @type {any} */ (e)?.cause?.message ?? ''))) throw e;
    await ensureTable();
    return fn();
  }
}

/** Флаг читаем из базы каждый раз: кеш в изоляте мог бы разойтись с пересборкой в другом изоляте. */
export async function ftsOn(owner) {
  if (!(await capabilities()).fts5) return false;
  const s = await db.select({ b: settings.ftsBuilt }).from(settings).where(eq(settings.ownerUserId, owner)).get();
  return !!s?.b;
}

/** @param {{ id: number, ownerUserId: number, searchText: string | null }[]} rows */
export async function ftsUpsert(rows) {
  if (!rows.length || !(await ftsOn(Number(rows[0].ownerUserId)))) return;
  for (const r of rows) {
    await withTable(() => db.run(sql`DELETE FROM messages_fts WHERE rowid = ${r.id}`));
    if (r.searchText) await db.run(sql`INSERT INTO messages_fts(rowid, search_text, owner_user_id) VALUES (${r.id}, ${r.searchText}, ${r.ownerUserId})`);
  }
}

/** @param {number} owner @param {number[]} ids */
export async function ftsDelete(owner, ids) {
  if (!ids.length || !(await ftsOn(owner))) return;
  for (let i = 0; i < ids.length; i += 400) {
    const part = ids.slice(i, i + 400);
    await withTable(() => db.run(sql`DELETE FROM messages_fts WHERE rowid IN (${sql.raw(part.map(Number).join(','))})`));
  }
}

export async function ftsDeleteOwner(owner) {
  if (!(await capabilities()).fts5) return;
  await withTable(() => db.run(sql`DELETE FROM messages_fts WHERE owner_user_id = ${owner}`));
}

/**
 * @returns {Promise<boolean>} собран ли
 * @param {number} owner @param {{ force?: boolean }} [o]
 */
export async function buildFts(owner, o = {}) {
  if (!(await capabilities()).fts5) return false;
  const total = await db.$count(messages, eq(messages.ownerUserId, owner));
  if (total > FTS_BUILD_LIMIT && !o.force) return false;
  await ensureTable();
  await db.update(settings).set({ ftsBuilt: false }).where(eq(settings.ownerUserId, owner));
  await db.run(sql`DELETE FROM messages_fts WHERE owner_user_id = ${owner}`);
  for (let last = 0; ;) {
    const rows = await db.select({ id: messages.id, t: messages.searchText }).from(messages)
      .where(and(eq(messages.ownerUserId, owner), sql`${messages.id} > ${last}`)).orderBy(messages.id).limit(2000).all();
    if (!rows.length) break;
    for (const r of rows) if (r.t) await db.run(sql`INSERT INTO messages_fts(rowid, search_text, owner_user_id) VALUES (${r.id}, ${r.t}, ${owner})`);
    last = /** @type {any} */ (rows.at(-1)).id;
  }
  await db.update(settings).set({ ftsBuilt: true }).where(eq(settings.ownerUserId, owner));
  return true;
}

export async function ensureFts(owner) {
  if (await ftsOn(owner)) return true;
  if (!(await capabilities()).fts5) return false;
  return buildFts(owner);
}

/** @param {string[]} words */
export const ftsQuery = (words) => words.map((w) => `"${w.replace(/"/g, '""')}"*`).join(' ');

export const ftsMatch = (owner, words) =>
  sql`${messages.id} IN (SELECT rowid FROM messages_fts WHERE messages_fts MATCH ${ftsQuery(words)} AND owner_user_id = ${owner})`;

// ── repo/messages: всё скоупится по владельцу (owner_user_id)
/** SQLite ограничивает число параметров запроса — длинные списки id режем на куски. */
const IN_CHUNK = 400;

/** @template T @param {T[]} arr @param {number} n */
function chunks(arr, n = IN_CHUNK) {
  /** @type {T[][]} */
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

/** @typedef {typeof messages.$inferSelect} MessageRow */
/** @typedef {typeof messages.$inferInsert} NewMessage */
/** @typedef {{ businessConnectionId: string, chatId: number, messageId: number }} Key */

const whereKey = (/** @type {Key} */ k) => and(
  eq(messages.businessConnectionId, k.businessConnectionId),
  eq(messages.chatId, k.chatId),
  eq(messages.messageId, k.messageId),
);

const CONTENT_FIELDS = /** @type {const} */ ([
  'chatName', 'senderName', 'senderUsername', 'text', 'caption', 'entities', 'mediaGroupId', 'forwardOrigin',
  'replyToMessageId', 'replyToSender', 'replyToText', 'mediaType', 'fileId', 'fileUniqueId', 'mimeType',
  'fileSize', 'fileName', 'thumbFileId', 'mediaMeta', 'searchText',
]);

/**
 * Upsert; повторная доставка обновляет содержимое, но не состояние (удалено/избранное) и копию в архиве.
 * @param {NewMessage} input
 * @returns {Promise<MessageRow>}
 */
export async function saveMessage(input) {
  /** @type {Record<string, any>} */
  const set = {};
  for (const f of CONTENT_FIELDS) set[f] = input[f] ?? null;
  set.mirrorStatus = sql`case when ${messages.mirrorStatus} = 'none' then ${input.mirrorStatus ?? 'none'} else ${messages.mirrorStatus} end`;
  const existed = !!(await db.select({ id: messages.id }).from(messages).where(whereKey(input)).get());
  const [row] = await db.insert(messages).values(input)
    .onConflictDoUpdate({ target: [messages.businessConnectionId, messages.chatId, messages.messageId], set })
    .returning();
  if (!existed) { await chatsRepo.chatAdded(row); await chatsRepo.onCaptured(row); }
  await ftsUpsert([row]);
  return row;
}

/** @param {string} businessConnectionId @param {number} chatId @param {number} messageId */
/**
 * Бэкап одноразового медиа из reply_to_message: вставляет, только если сообщения нет; иначе null.
 * @param {NewMessage} input
 */
export async function backupIfAbsent(input) {
  const [row] = await db.insert(messages).values(input)
    .onConflictDoNothing({ target: [messages.businessConnectionId, messages.chatId, messages.messageId] })
    .returning();
  if (row) { await chatsRepo.chatAdded(row); await chatsRepo.onCaptured(row); await ftsUpsert([row]); }
  return row ?? null;
}

export async function findByKey(businessConnectionId, chatId, messageId) {
  return (await db.select().from(messages).where(whereKey({ businessConnectionId, chatId, messageId })).get()) ?? null;
}

/** @param {number} ownerUserId @param {number} id */
export async function findById(ownerUserId, id) {
  return (await db.select().from(messages).where(and(eq(messages.ownerUserId, ownerUserId), eq(messages.id, id))).get()) ?? null;
}

/**
 * @typedef {{
 * text: string | null, entities?: any, editedAt?: Date, silent?: boolean,
 * media?: { mediaType?: string | null, fileId?: string | null, fileUniqueId?: string | null, mimeType?: string | null,
 * fileSize?: number | null, fileName?: string | null, thumbFileId?: string | null, mediaMeta?: any }
 * }} EditPatch
 */

/**
 * silent — трансляция геопозиции: строка обновляется, версия не пишется, правкой не считается.
 * @param {Key} key @param {EditPatch} p
 */
export async function applyEdit(key, p) {
  const row = await findByKey(key.businessConnectionId, key.chatId, key.messageId);
  if (!row) return { row: null, oldText: null, changed: false, existed: false, mediaChanged: false };
  const field = row.mediaType ? 'caption' : 'text';
  const oldText = row[field] ?? null;
  const newText = p.text ?? null;
  const mediaChanged = !!p.media?.fileUniqueId && p.media.fileUniqueId !== row.fileUniqueId;
  if (oldText === newText && !mediaChanged) return { row, oldText, changed: false, existed: true, mediaChanged: false };
  const at = p.editedAt ?? new Date();
  if (!p.silent) {
    await db.insert(edits).values({
      messagePk: row.id, ownerUserId: row.ownerUserId, oldText, newText,
      oldEntities: row.entities ?? null, newEntities: p.entities ?? null, editedAt: at,
      oldMedia: mediaChanged ? { mediaType: row.mediaType, fileId: row.fileId, fileUniqueId: row.fileUniqueId, mirrorMessageId: row.mirrorMessageId } : null,
    });
  }
  /** @type {Record<string, any>} */
  const set = { [field]: newText, entities: p.entities ?? null };
  const media = p.media ?? {};
  if (mediaChanged) Object.assign(set, media);
  set.searchText = normalizeSearch(field === 'text' ? newText : row.text, field === 'caption' ? newText : row.caption,
    row.senderName, row.chatName, mediaChanged ? media.fileName : row.fileName);
  if (!p.silent) {
    set.editCount = sql`${messages.editCount} + 1`;
    set.lastEditedAt = at;
    set.eventAt = at;
    if (row.mirrorMessageId != null) {
      if (mediaChanged) { set.mirrorStatus = 'pending'; set.mirrorAttempts = 0; set.mirrorRetryAt = null; }
      else set.mirrorDirty = true;
    } else if (mediaChanged && media.fileId) set.mirrorStatus = 'pending';
  }
  const [updated] = await db.update(messages).set(set).where(eq(messages.id, row.id)).returning();
  if (updated.searchText !== row.searchText) await ftsUpsert([updated]);
  if (!p.silent) {
    await chatsRepo.chatBump(row.ownerUserId, Number(row.chatId), 'edited', (row.editCount ?? 0) === 0 ? 1 : 0, at);
    await chatsRepo.onEdited(row, at);
  }
  return { row: updated, oldText, changed: true, existed: true, mediaChanged };
}

/**
 * Возвращает только строки, реально перешедшие в «удалено», в порядке апдейта Telegram.
 * @param {string} businessConnectionId @param {number} chatId @param {number[]} messageIds @param {Date} [deletedAt]
 */
export async function markDeletedMany(businessConnectionId, chatId, messageIds, deletedAt = new Date()) {
  /** @type {MessageRow[]} */
  const rows = [];
  for (const part of chunks(messageIds)) {
    const got = await db.update(messages)
      .set({
        isDeleted: true, deletedAt, eventAt: deletedAt,
        mirrorDirty: sql`case when ${messages.mirrorMessageId} is not null then 1 else ${messages.mirrorDirty} end`,
      })
      .where(and(
        eq(messages.businessConnectionId, businessConnectionId),
        eq(messages.chatId, chatId),
        inArray(messages.messageId, part),
        notSet(messages.isDeleted),
      )).returning();
    rows.push(...got);
  }
  if (rows.length) {
    await chatsRepo.chatBump(rows[0].ownerUserId, chatId, 'deleted', rows.length, deletedAt);
    await chatsRepo.onDeleted(rows, deletedAt);
  }
  const order = new Map(messageIds.map((id, i) => [id, i]));
  return rows.sort((a, b) => (order.get(a.messageId) ?? 0) - (order.get(b.messageId) ?? 0));
}

export async function existingMessageIds(businessConnectionId, chatId, messageIds) {
  const out = new Set();
  for (const part of chunks(messageIds)) {
    const rows = await db.select({ m: messages.messageId }).from(messages).where(and(
      eq(messages.businessConnectionId, businessConnectionId), eq(messages.chatId, chatId), inArray(messages.messageId, part),
    )).all();
    for (const r of rows) out.add(Number(r.m));
  }
  return out;
}

/** @typedef {'events' | 'deleted' | 'edited' | 'favorite' | 'oneTime' | 'all'} FeedKind */
/** @typedef {'any' | 'in' | 'out'} Direction */
/** @typedef {'any' | 'text' | 'media' | keyof typeof MEDIA_GROUPS} MediaFilter */
/** @typedef {{ k: number, id: number }} Cursor */
/**
 * @typedef {{
 * ownerUserId: number, kind?: FeedKind, direction?: Direction, media?: MediaFilter,
 * period?: import('../util.js').Period, tz?: string, chatId?: number | null, cursor?: Cursor | null, limit?: number,
 * since?: number | null
 * }} FeedOpts
 */

export function sortColumn(kind = 'events') {
  if (kind === 'events' || kind === 'deleted') return messages.eventAt;
  if (kind === 'edited') return messages.lastEditedAt;
  return messages.date;
}

/** @param {Partial<FeedOpts>} f */
export function filterConds(f) {
  const c = [];
  if (f.kind === 'events') c.push(isEvent());
  if (f.kind === 'deleted') c.push(isSet(messages.isDeleted));
  if (f.kind === 'edited') c.push(positive(messages.editCount));
  if (f.kind === 'favorite') c.push(isSet(messages.isFavorite));
  if (f.kind === 'oneTime') c.push(isSet(messages.oneTime));
  if (f.direction === 'in') c.push(eq(messages.isOutgoing, false));
  if (f.direction === 'out') c.push(eq(messages.isOutgoing, true));
  if (f.media === 'text') c.push(isNull(messages.mediaType));
  if (f.media === 'media') c.push(isNotNull(messages.mediaType));
  if (f.media && MEDIA_GROUPS[f.media]) c.push(inArray(messages.mediaType, MEDIA_GROUPS[f.media]));
  return c;
}

/** @param {FeedOpts} o */
function feedConds(o) {
  const col = sortColumn(o.kind);
  const conds = [eq(messages.ownerUserId, o.ownerUserId), ...filterConds(o)];
  const cutoff = periodCutoff(o.period ?? 'all', o.tz ?? 'UTC');
  if (cutoff) conds.push(tsGte(col, cutoff));
  if (o.chatId != null) conds.push(eq(messages.chatId, o.chatId));
  if (o.since != null) conds.push(tsGt(col, o.since));
  return conds;
}

/** @param {any} col @param {Cursor} c */
const beforeCursor = (col, c) => beforeTs(col, messages.id, c.k, c.id);

/** @param {MessageRow} row */
/** @param {any} row */
export function cursorOf(row, kind = 'events') {
  if (!row) return null;
  const v = kind === 'events' || kind === 'deleted' ? row.eventAt : kind === 'edited' ? row.lastEditedAt : row.date;
  return v ? { k: new Date(v).getTime(), id: row.id } : null;
}

/** @param {FeedOpts} o */
export async function feed(o) {
  const col = sortColumn(o.kind);
  const limit = Math.min(Math.max(o.limit ?? 30, 1), 100);
  const conds = feedConds(o);
  if (o.cursor) conds.push(beforeCursor(col, o.cursor));
  const rows = await db.select().from(messages).where(and(...conds)).orderBy(desc(col), desc(messages.id)).limit(limit + 1).all();
  const more = rows.length > limit;
  const page = more ? rows.slice(0, limit) : rows;
  return { rows: page, next: more ? cursorOf(page.at(-1), o.kind) : null };
}

const isEvent = () => or(isSet(messages.isDeleted), positive(messages.editCount));

/** @param {number} ownerUserId @param {Date | number} since */
export async function unreadEvents(ownerUserId, since) {
  const rows = await db.select({ chatId: messages.chatId, n: sql`count(*)` }).from(messages)
    .where(and(eq(messages.ownerUserId, ownerUserId), tsGt(messages.eventAt, since), isEvent()))
    .groupBy(messages.chatId).all();
  /** @type {Map<number, number>} */
  const byChat = new Map(rows.map((r) => [Number(r.chatId), Number(r.n)]));
  return { total: [...byChat.values()].reduce((a, b) => a + b, 0), byChat };
}

/** @param {FeedOpts} o */
export async function countFeed(o) {
  return db.$count(messages, and(...feedConds({ ...o, cursor: null })));
}

/** @param {string} q */
export function searchWords(q) {
  return normalizeSearch(q).split(' ').filter(Boolean).slice(0, 8);
}

/** @param {number} ownerUserId @param {string} query @param {Omit<FeedOpts, 'ownerUserId'>} [o] */
export async function search(ownerUserId, query, o = {}) {
  const words = searchWords(query);
  if (!words.length) return { rows: [], next: null, total: 0 };
  const kind = o.kind ?? 'all';
  const base = feedConds({ ...o, ownerUserId, kind, cursor: null, since: null });
  const match = (await ensureFts(ownerUserId))
    ? [ftsMatch(ownerUserId, words)]
    : words.map((w) => sql`${messages.searchText} LIKE ${`%${escapeLike(w)}%`} ESCAPE '\\'`);
  const conds = [...base, ...match];
  const total = o.cursor ? null : await db.$count(messages, and(...conds));
  const col = sortColumn(kind);
  if (o.cursor) conds.push(beforeCursor(col, o.cursor));
  const limit = Math.min(Math.max(o.limit ?? 30, 1), 100);
  const rows = await db.select().from(messages).where(and(...conds)).orderBy(desc(col), desc(messages.id)).limit(limit + 1).all();
  const more = rows.length > limit;
  const page = more ? rows.slice(0, limit) : rows;
  return { rows: page, next: more ? cursorOf(page.at(-1), kind) : null, total };
}

async function prefsMap(ownerUserId) {
  const rows = await db.select().from(chatPrefs).where(eq(chatPrefs.ownerUserId, ownerUserId)).all();
  return new Map(rows.map((r) => [r.chatId, r]));
}

/**
 * @param {number} ownerUserId @param {{ limit?: number, offset?: number, unreadSince?: Date | number | null }} [o]
 */
export async function listChats(ownerUserId, o = {}) {
  const [rows, prefs, unread] = await Promise.all([
    chatsRepo.chatsPage(ownerUserId, o), prefsMap(ownerUserId),
    o.unreadSince != null ? unreadEvents(ownerUserId, o.unreadSince) : Promise.resolve(null),
  ]);
  const ms = (v) => (v == null ? null : new Date(v).getTime());
  return rows.map((r) => ({
    chatId: Number(r.chatId),
    chatName: r.name ?? null,
    total: r.total, incoming: r.incoming, deleted: r.deleted, edited: r.edited, media: r.media,
    lastAt: ms(r.lastAt),
    lastEventAt: ms(r.lastEventAt),
    muted: !!prefs.get(Number(r.chatId))?.muted,
    autoRead: !!prefs.get(Number(r.chatId))?.autoRead,
    excluded: !!prefs.get(Number(r.chatId))?.excluded,
    unread: unread?.byChat.get(Number(r.chatId)) ?? 0,
    hasPhoto: !!r.photoFileId,
  }));
}

/** @param {number} ownerUserId */
export const countChats = (ownerUserId) => chatsRepo.countChatRows(ownerUserId);

/** @param {number} ownerUserId @param {number} chatId */
export async function chatTitle(ownerUserId, chatId) {
  return (await chatsRepo.getChat(ownerUserId, chatId))?.name ?? null;
}

export async function ownsChat(ownerUserId, chatId) {
  return !!(await chatsRepo.getChat(ownerUserId, chatId));
}

export async function chatCounts(businessConnectionId, chatId) {
  const row = await db.select({
    total: sql`count(*)`,
    nonDeleted: sql`sum(case when ${messages.isDeleted} = 0 then 1 else 0 end)`,
  }).from(messages).where(and(eq(messages.businessConnectionId, businessConnectionId), eq(messages.chatId, chatId))).get();
  return { total: Number(row?.total ?? 0), nonDeleted: Number(row?.nonDeleted ?? 0) };
}

/**
 * Строки по возрастанию даты; before — в прошлое, after — в будущее, без курсора — самые свежие.
 * @param {number} ownerUserId @param {number} chatId
 * filter — показать только удалённые / изменённые / с файлами / избранное.
 * @param {{ before?: Cursor | null, after?: Cursor | null, limit?: number, filter?: ChatFilter }} [o]
 */
export async function chatPage(ownerUserId, chatId, o = {}) {
  const limit = Math.min(Math.max(o.limit ?? 50, 1), 200);
  const base = [eq(messages.ownerUserId, ownerUserId), eq(messages.chatId, chatId), ...chatFilterConds(o.filter)];
  if (o.after) {
    const c = o.after;
    const rows = await db.select().from(messages)
      .where(and(...base, afterTs(messages.date, messages.id, c.k, c.id)))
      .orderBy(asc(messages.date), asc(messages.id)).limit(limit + 1).all();
    const more = rows.length > limit;
    return { rows: more ? rows.slice(0, limit) : rows, hasOlder: true, hasNewer: more };
  }
  const conds = [...base];
  if (o.before) conds.push(beforeCursor(messages.date, o.before));
  const rows = await db.select().from(messages).where(and(...conds))
    .orderBy(desc(messages.date), desc(messages.id)).limit(limit + 1).all();
  const more = rows.length > limit;
  const page = (more ? rows.slice(0, limit) : rows).reverse();
  return { rows: page, hasOlder: more, hasNewer: !!o.before };
}

/** @typedef {'all' | 'deleted' | 'edited' | 'media' | 'favorite'} ChatFilter */
export const CHAT_FILTERS = /** @type {ChatFilter[]} */ (['all', 'deleted', 'edited', 'media', 'favorite']);
/** @param {ChatFilter | undefined} f */
function chatFilterConds(f) {
  if (f === 'media') return filterConds({ media: 'media' });
  if (f === 'deleted' || f === 'edited' || f === 'favorite') return filterConds({ kind: f });
  return [];
}

/** @param {ChatFilter} [filter] */
export async function cursorForDay(ownerUserId, chatId, day, tz, filter = 'all') {
  const start = startOfDay(day, tz);
  const row = await db.select({ id: messages.id, date: messages.date }).from(messages)
    .where(and(eq(messages.ownerUserId, ownerUserId), eq(messages.chatId, chatId), ...chatFilterConds(filter), tsGte(messages.date, start)))
    .orderBy(asc(messages.date), asc(messages.id)).limit(1).get();
  // «after» отдаёт строки строго после курсора — сдвигаем на миллисекунду раньше первой строки дня.
  return row ? { k: new Date(row.date).getTime() - 1, id: 0 } : null;
}

export async function lastIncoming(ownerUserId, chatId) {
  return (await db.select().from(messages)
    .where(and(eq(messages.ownerUserId, ownerUserId), eq(messages.chatId, chatId), eq(messages.isOutgoing, false)))
    .orderBy(desc(messages.date), desc(messages.id)).limit(1).get()) ?? null;
}

export async function lastInChat(ownerUserId, chatId) {
  return (await db.select().from(messages)
    .where(and(eq(messages.ownerUserId, ownerUserId), eq(messages.chatId, chatId)))
    .orderBy(desc(messages.date), desc(messages.id)).limit(1).get()) ?? null;
}

export async function allForChat(ownerUserId, chatId, limit = 20_000) {
  return db.select().from(messages).where(and(eq(messages.ownerUserId, ownerUserId), eq(messages.chatId, chatId)))
    .orderBy(asc(messages.date), asc(messages.messageId)).limit(limit).all();
}

export async function editsForChat(ownerUserId, chatId) {
  const pks = (await db.select({ id: messages.id }).from(messages)
    .where(and(eq(messages.ownerUserId, ownerUserId), eq(messages.chatId, chatId))).all()).map((r) => r.id);
  const byPk = await editsForMessages(ownerUserId, pks);
  return [...byPk.values()].flat().sort((a, b) => new Date(a.editedAt).getTime() - new Date(b.editedAt).getTime());
}

export async function editsForMessage(ownerUserId, messagePk) {
  return db.select().from(edits).where(and(eq(edits.ownerUserId, ownerUserId), eq(edits.messagePk, messagePk)))
    .orderBy(asc(edits.editedAt), asc(edits.id)).all();
}

/** @param {number[]} pks */
export async function editsForMessages(ownerUserId, pks) {
  /** @type {Map<number, any[]>} */
  const out = new Map();
  for (const part of chunks(pks)) {
    if (!part.length) continue;
    const rows = await db.select().from(edits).where(and(eq(edits.ownerUserId, ownerUserId), inArray(edits.messagePk, part)))
      .orderBy(asc(edits.editedAt), asc(edits.id)).all();
    for (const r of rows) {
      const arr = out.get(r.messagePk);
      if (arr) arr.push(r); else out.set(r.messagePk, [r]);
    }
  }
  return out;
}

export async function albumRows(row) {
  if (!row.mediaGroupId) return [row];
  return db.select().from(messages).where(and(
    eq(messages.businessConnectionId, row.businessConnectionId),
    eq(messages.chatId, row.chatId),
    eq(messages.mediaGroupId, row.mediaGroupId),
  )).orderBy(asc(messages.messageId)).all();
}

export async function deletedSince(ownerUserId, chatId, since, opts = {}) {
  const conds = [
    eq(messages.ownerUserId, ownerUserId), eq(messages.chatId, chatId), isSet(messages.isDeleted), tsGte(messages.deletedAt, since),
  ];
  if (opts.includeOutgoing === false) conds.push(eq(messages.isOutgoing, false));
  return db.select().from(messages).where(and(...conds)).orderBy(asc(messages.deletedAt), asc(messages.messageId)).all();
}

/** @param {number} ownerUserId @param {any} o */
function mediaConds(ownerUserId, o) {
  const types = o.group && o.group !== 'all' ? MEDIA_GROUPS[o.group] : [...MEDIA_GROUPS.photo, ...MEDIA_GROUPS.video, ...MEDIA_GROUPS.voice, ...MEDIA_GROUPS.document];
  const conds = [eq(messages.ownerUserId, ownerUserId), inArray(messages.mediaType, types), isNotNull(messages.fileId)];
  if (o.chatId != null) conds.push(eq(messages.chatId, o.chatId));
  if (o.deletedOnly) conds.push(isSet(messages.isDeleted));
  return conds;
}

export const countMedia = (ownerUserId, o = {}) => db.$count(messages, and(...mediaConds(ownerUserId, o)));

/**
 * @param {number} ownerUserId
 * @param {{ group?: keyof typeof MEDIA_GROUPS | 'all', chatId?: number | null, deletedOnly?: boolean, cursor?: Cursor | null, limit?: number }} o
 */
export async function mediaPage(ownerUserId, o = {}) {
  const limit = Math.min(Math.max(o.limit ?? 60, 1), 120);
  const conds = mediaConds(ownerUserId, o);
  if (o.cursor) conds.push(beforeCursor(messages.date, o.cursor));
  const rows = await db.select().from(messages).where(and(...conds)).orderBy(desc(messages.date), desc(messages.id)).limit(limit + 1).all();
  const more = rows.length > limit;
  const page = more ? rows.slice(0, limit) : rows;
  return { rows: page, next: more ? cursorOf(page.at(-1), 'all') : null };
}

/** @param {number} ownerUserId @param {number | null} [chatId] */
export async function overall(ownerUserId, chatId = null) {
  const row = await db.select({
    total: sql`count(*)`,
    deleted: sql`sum(case when ${messages.isDeleted} = 1 then 1 else 0 end)`,
    edited: sql`sum(case when ${messages.editCount} > 0 then 1 else 0 end)`,
    favorite: sql`sum(case when ${messages.isFavorite} = 1 then 1 else 0 end)`,
    media: sql`sum(case when ${messages.mediaType} is not null then 1 else 0 end)`,
    incoming: sql`sum(case when ${messages.isOutgoing} = 0 then 1 else 0 end)`,
    chats: sql`count(distinct ${messages.chatId})`,
  }).from(messages).where(chatId == null ? eq(messages.ownerUserId, ownerUserId) : and(eq(messages.ownerUserId, ownerUserId), eq(messages.chatId, chatId))).get();
  const num = (v) => Number(v ?? 0);
  return { total: num(row?.total), deleted: num(row?.deleted), edited: num(row?.edited), favorite: num(row?.favorite), media: num(row?.media), incoming: num(row?.incoming), chats: num(row?.chats) };
}

/** @param {number} ownerUserId @param {number | null} [chatId] */
export async function mediaBreakdown(ownerUserId, chatId = null) {
  const conds = [eq(messages.ownerUserId, ownerUserId), isNotNull(messages.mediaType)];
  if (chatId != null) conds.push(eq(messages.chatId, chatId));
  const rows = await db.select({ t: messages.mediaType, c: sql`count(*)` })
    .from(messages).where(and(...conds))
    .groupBy(messages.mediaType).orderBy(sql`count(*) desc`).all();
  return rows.map((r) => ({ type: String(r.t), count: Number(r.c ?? 0) }));
}

/**
 * Стирает архив владельца; настройки, подключение и группа-архив (и копии в ней) остаются.
 * @param {number} ownerUserId
 */
export async function wipeOwnerArchive(ownerUserId) {
  const removed = await db.$count(messages, eq(messages.ownerUserId, ownerUserId));
  await db.delete(edits).where(eq(edits.ownerUserId, ownerUserId));
  await db.delete(messages).where(eq(messages.ownerUserId, ownerUserId));
  await db.delete(chatPrefs).where(eq(chatPrefs.ownerUserId, ownerUserId));
  await db.delete(notifBatches).where(eq(notifBatches.ownerUserId, ownerUserId));
  await chatsRepo.deleteOwnerChats(ownerUserId);
  await chatsRepo.deleteDaily(ownerUserId);
  await ftsDeleteOwner(ownerUserId);
  return removed;
}

/** Переключает «избранное». null — события нет (или чужое). */
export async function toggleFavorite(ownerUserId, id) {
  const [row] = await db.update(messages).set({ isFavorite: sql`not ${messages.isFavorite}` })
    .where(and(eq(messages.ownerUserId, ownerUserId), eq(messages.id, id)))
    .returning({ isFavorite: messages.isFavorite, chatId: messages.chatId });
  if (row) await chatsRepo.chatBump(ownerUserId, Number(row.chatId), 'favorite', row.isFavorite ? 1 : -1);
  return row ? !!row.isFavorite : null;
}

/** Каскад вручную — FK на платформе нет. @param {number[]} ids */
async function deleteRows(ownerUserId, ids) {
  const touched = await chatsRepo.chatIdsOf(ownerUserId, ids);
  let n = 0;
  for (const part of chunks(ids)) {
    if (!part.length) continue;
    await db.delete(edits).where(and(eq(edits.ownerUserId, ownerUserId), inArray(edits.messagePk, part)));
    const removed = await db.delete(messages).where(and(eq(messages.ownerUserId, ownerUserId), inArray(messages.id, part))).returning({ id: messages.id });
    n += removed.length;
    await ftsDelete(ownerUserId, removed.map((x) => x.id));
  }
  if (n) await chatsRepo.rebuildChats(ownerUserId, touched);
  return n;
}

export async function deleteById(ownerUserId, id) {
  return (await deleteRows(ownerUserId, [id])) > 0;
}

/** @typedef {'today' | '3d' | 'all'} DeletePeriod */
export function deleteCutoff(period, tz = 'UTC', now = new Date()) {
  if (period === 'all') return null;
  if (period === '3d') return new Date(now.getTime() - 3 * 86_400_000);
  return startOfDay(now, tz);
}

/**
 * Ключ проекции не `all`: платформа не экранирует псевдоним, `count(*) AS all` — синтаксическая ошибка.
 * Проверка — в sdk-shim/db.js.
 */
export async function chatHistoryCounts(ownerUserId, chatId, tz = 'UTC') {
  const today = /** @type {Date} */ (deleteCutoff('today', tz));
  const d3 = /** @type {Date} */ (deleteCutoff('3d', tz));
  const row = await db.select({
    total: sql`count(*)`,
    last3d: sql`sum(case when ${messages.date} >= ${d3.getTime()} then 1 else 0 end)`,
    today: sql`sum(case when ${messages.date} >= ${today.getTime()} then 1 else 0 end)`,
  }).from(messages).where(and(eq(messages.ownerUserId, ownerUserId), eq(messages.chatId, chatId))).get();
  return { today: Number(row?.today ?? 0), last3d: Number(row?.last3d ?? 0), all: Number(row?.total ?? 0) };
}

/** @param {DeletePeriod} period */
export async function deleteChatHistory(ownerUserId, chatId, period, tz = 'UTC') {
  const cutoff = deleteCutoff(period, tz);
  const conds = [eq(messages.ownerUserId, ownerUserId), eq(messages.chatId, chatId)];
  if (cutoff) conds.push(tsGte(messages.date, cutoff));
  const ids = (await db.select({ id: messages.id }).from(messages).where(and(...conds)).all()).map((r) => r.id);
  // Вся история чата — и его статистика; частичное удаление историю статистики не трогает.
  if (period === 'all') await chatsRepo.deleteDaily(ownerUserId, chatId);
  return deleteRows(ownerUserId, ids);
}

/**
 * Полностью стирает переписку с собеседником из базы бота.
 * Тема в группе-архиве, очередь и задачи — в lib/jobs.js (eraseChat).
 * @param {number} ownerUserId @param {number} chatId @returns {Promise<number>} сколько сообщений удалено
 */
export async function purgeChat(ownerUserId, chatId) {
  const removed = await deleteChatHistory(ownerUserId, chatId, 'all');
  await db.delete(chatPrefs).where(and(eq(chatPrefs.ownerUserId, ownerUserId), eq(chatPrefs.chatId, chatId)));
  await db.delete(notifBatches).where(and(eq(notifBatches.ownerUserId, ownerUserId), eq(notifBatches.chatId, chatId)));
  await chatsRepo.deleteChatRow(ownerUserId, chatId);
  return removed;
}

/** Порциями, кроме избранного: крона нет, вызывается попутно с апдейтами, поэтому за раз немного. */
export async function purgeOlderThan(ownerUserId, cutoff, limit = 300) {
  const ids = (await db.select({ id: messages.id }).from(messages).where(and(
    eq(messages.ownerUserId, ownerUserId), tsLt(messages.date, cutoff), notSet(messages.isFavorite),
  )).limit(limit).all()).map((r) => r.id);
  return deleteRows(ownerUserId, ids);
}

/**
 * @typedef {{ kind?: FeedKind, period?: import('../util.js').Period, tz?: string, chatId?: number | null,
 * from?: Date | null, to?: Date | null }} ExportOpts
 * from/to — свой период по дате сообщения (to не включительно), вместо period.
 */
/** @param {number} ownerUserId @param {ExportOpts} o */
function exportConds(ownerUserId, o) {
  const conds = feedConds({ ownerUserId, kind: o.kind ?? 'all', period: o.from || o.to ? 'all' : o.period ?? 'all', tz: o.tz, chatId: o.chatId ?? null });
  if (o.from) conds.push(tsGte(messages.date, o.from));
  if (o.to) conds.push(tsLt(messages.date, o.to));
  return conds;
}

/** @param {number} ownerUserId @param {ExportOpts} o */
export const countExport = (ownerUserId, o = {}) => db.$count(messages, and(...exportConds(ownerUserId, o)));

/** @param {number} ownerUserId @param {ExportOpts} o @param {Cursor | null} [cursor] */
export async function exportPage(ownerUserId, o = {}, cursor = null, limit = 20_000) {
  const conds = exportConds(ownerUserId, o);
  if (cursor) conds.push(beforeCursor(messages.date, cursor));
  const rows = await db.select().from(messages).where(and(...conds)).orderBy(desc(messages.date), desc(messages.id)).limit(limit).all();
  return { rows, next: rows.length === limit ? cursorOf(rows.at(-1), 'all') : null };
}

/** Литерал — под частичный индекс messages_mirror_pending_idx. */
const mirrorPendingCond = sql`${messages.mirrorStatus} = 'pending'`;

export async function pendingMirrors(ownerUserId, now = new Date(), limit = 5) {
  return db.select().from(messages).where(and(
    eq(messages.ownerUserId, ownerUserId),
    mirrorPendingCond,
    or(isNull(messages.mirrorRetryAt), tsLte(messages.mirrorRetryAt, now)),
  )).orderBy(asc(messages.date), asc(messages.id)).limit(limit).all();
}

export async function dirtyMirrors(ownerUserId, limit = 5) {
  return db.select().from(messages).where(and(
    eq(messages.ownerUserId, ownerUserId), isSet(messages.mirrorDirty), sql`${messages.mirrorStatus} = 'done'`,
  )).orderBy(asc(messages.date)).limit(limit).all();
}

export async function countPendingMirrors(ownerUserId) {
  return db.$count(messages, and(eq(messages.ownerUserId, ownerUserId), mirrorPendingCond));
}

export async function countFailedMirrors(ownerUserId) {
  return db.$count(messages, and(eq(messages.ownerUserId, ownerUserId), sql`${messages.mirrorStatus} = 'failed'`));
}

/** Не трогаем «не поддерживается» и одноразовые, которые Telegram не отдал, — повторять бессмысленно. */
export async function retryFailedMirrors(ownerUserId) {
  const rows = await db.update(messages)
    .set({ mirrorStatus: 'pending', mirrorAttempts: 0, mirrorRetryAt: null, mirrorError: null })
    .where(and(eq(messages.ownerUserId, ownerUserId), sql`${messages.mirrorStatus} = 'failed'`,
      sql`coalesce(${messages.mirrorError}, '') <> 'unsupported'`, sql`coalesce(${messages.mirrorError}, '') not like 'one-time:%'`))
    .returning({ id: messages.id });
  return rows.length;
}

/** @param {number} id @param {Record<string, any>} patch */
export async function setMirror(id, patch) {
  await db.update(messages).set(patch).where(eq(messages.id, id));
}

export async function albumHeadMirror(row) {
  if (!row.mediaGroupId) return null;
  return (await db.select({ mirrorMessageId: messages.mirrorMessageId }).from(messages).where(and(
    eq(messages.businessConnectionId, row.businessConnectionId),
    eq(messages.chatId, row.chatId),
    eq(messages.mediaGroupId, row.mediaGroupId),
    ne(messages.id, row.id),
    isNotNull(messages.mirrorMessageId),
  )).orderBy(asc(messages.messageId)).limit(1).get()) ?? null;
}
