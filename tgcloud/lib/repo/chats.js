// Агрегаты архива: таблица chats, статистика по дням, выборки
import { db } from 'sdk';
import { and, desc, eq, inArray, sql, gte, lte } from 'sdk/db';
import { chats, messages, settings, dailyStats, edits, appMeta } from '../../schema.js';
import { endpointError } from '../i18n.js';
import { tsGte, tsLt, isSet, positive } from './state.js';
import { midnightOf, startOfDay, localClock, TTD_BUCKETS, typeGroup, MAX_SQL_VARS } from '../util.js';

// ── repo/chats: материализованные счётчики чатов
const ms = (v) => (v == null ? null : v instanceof Date ? v.getTime() : Number(v));
const num = (v) => Number(v ?? 0);

const AGG = {
  chatId: messages.chatId,
  total: sql`count(*)`,
  incoming: sql`sum(case when ${messages.isOutgoing} = 0 then 1 else 0 end)`,
  deleted: sql`sum(case when ${messages.isDeleted} = 1 then 1 else 0 end)`,
  edited: sql`sum(case when ${messages.editCount} > 0 then 1 else 0 end)`,
  media: sql`sum(case when ${messages.mediaType} is not null then 1 else 0 end)`,
  favorite: sql`sum(case when ${messages.isFavorite} = 1 then 1 else 0 end)`,
  oneTime: sql`sum(case when ${messages.oneTime} = 1 then 1 else 0 end)`,
  firstAt: sql`min(${messages.date})`,
  lastAt: sql`max(${messages.date})`,
  lastEventAt: sql`max(${messages.eventAt})`,
  lastIncomingAt: sql`max(case when ${messages.isOutgoing} = 0 then ${messages.date} end)`,
};

async function lastIncomingMeta(ownerUserId, chatId) {
  return (await db.select({ senderId: messages.senderId, senderName: messages.senderName, senderUsername: messages.senderUsername })
    .from(messages).where(and(eq(messages.ownerUserId, ownerUserId), eq(messages.chatId, chatId), eq(messages.isOutgoing, false)))
    .orderBy(desc(messages.date), desc(messages.id)).limit(1).get()) ?? null;
}
async function lastName(ownerUserId, chatId) {
  return (await db.select({ name: messages.chatName }).from(messages)
    .where(and(eq(messages.ownerUserId, ownerUserId), eq(messages.chatId, chatId), sql`${messages.chatName} is not null`))
    .orderBy(desc(messages.date)).limit(1).get())?.name ?? null;
}

/** Записывает агрегаты чата; если сообщений не осталось — удаляет строку. */
async function writeAgg(ownerUserId, a, now = new Date()) {
  const chatId = Number(a.chatId);
  if (num(a.total) === 0) { await db.delete(chats).where(and(eq(chats.ownerUserId, ownerUserId), eq(chats.chatId, chatId))); return; }
  const [meta, name] = await Promise.all([lastIncomingMeta(ownerUserId, chatId), lastName(ownerUserId, chatId)]);
  const row = {
    ownerUserId, chatId, name,
    senderId: meta?.senderId ?? null, senderName: meta?.senderName ?? null, senderUsername: meta?.senderUsername ?? null,
    total: num(a.total), incoming: num(a.incoming), deleted: num(a.deleted), edited: num(a.edited), media: num(a.media),
    favorite: num(a.favorite), oneTime: num(a.oneTime),
    firstAt: a.firstAt == null ? null : new Date(Number(a.firstAt)), lastAt: a.lastAt == null ? null : new Date(Number(a.lastAt)),
    lastEventAt: a.lastEventAt == null ? null : new Date(Number(a.lastEventAt)),
    lastIncomingAt: a.lastIncomingAt == null ? null : new Date(Number(a.lastIncomingAt)),
    updatedAt: now,
  };
  const { ownerUserId: _o, chatId: _c, ...set } = row;
  await db.insert(chats).values(row).onConflictDoUpdate({ target: [chats.ownerUserId, chats.chatId], set });
}

/** @param {number[]} chatIds */
export async function rebuildChats(ownerUserId, chatIds) {
  for (const chatId of [...new Set(chatIds.map(Number))]) {
    const a = await db.select(AGG).from(messages).where(and(eq(messages.ownerUserId, ownerUserId), eq(messages.chatId, chatId))).get();
    await writeAgg(ownerUserId, { ...(a ?? {}), chatId, total: a?.total ?? 0 });
  }
}

/** @returns {Promise<number>} сколько чатов */
export async function buildAllChats(ownerUserId) {
  const rows = await db.select(AGG).from(messages).where(eq(messages.ownerUserId, ownerUserId)).groupBy(messages.chatId).all();
  await db.delete(chats).where(eq(chats.ownerUserId, ownerUserId));
  for (const a of rows) await writeAgg(ownerUserId, a);
  await db.update(settings).set({ chatsBuilt: true }).where(eq(settings.ownerUserId, ownerUserId));
  return rows.length;
}

/** @param {{ ownerUserId: number, chatsBuilt?: boolean }} s */
export async function ensureChatsBuilt(s) {
  if (s.chatsBuilt) return false;
  await buildAllChats(s.ownerUserId);
  s.chatsBuilt = true;
  return true;
}

/**
 * @param {{ ownerUserId: number, chatId: number, chatName?: string | null, senderId?: number | null, senderName?: string | null,
 * senderUsername?: string | null, isOutgoing?: boolean, mediaType?: string | null, oneTime?: boolean, isFavorite?: boolean,
 * isDeleted?: boolean, editCount?: number, date: Date | number, eventAt?: Date | number | null }} m
 */
export async function chatAdded(m, now = new Date()) {
  const date = ms(m.date) ?? now.getTime();
  const incoming = !m.isOutgoing;
  const ev = ms(m.eventAt);
  const row = {
    ownerUserId: m.ownerUserId, chatId: Number(m.chatId), name: m.chatName ?? null,
    senderId: incoming ? m.senderId ?? null : null, senderName: incoming ? m.senderName ?? null : null,
    senderUsername: incoming ? m.senderUsername ?? null : null,
    total: 1, incoming: incoming ? 1 : 0, deleted: m.isDeleted ? 1 : 0, edited: (m.editCount ?? 0) > 0 ? 1 : 0,
    media: m.mediaType ? 1 : 0, favorite: m.isFavorite ? 1 : 0, oneTime: m.oneTime ? 1 : 0,
    firstAt: new Date(date), lastAt: new Date(date), lastEventAt: ev == null ? null : new Date(ev),
    lastIncomingAt: incoming ? new Date(date) : null, updatedAt: now,
  };
  const newer = sql`${date} >= coalesce(${chats.lastAt}, 0)`;
  const newerIncoming = sql`${date} >= coalesce(${chats.lastIncomingAt}, 0)`;
  await db.insert(chats).values(row).onConflictDoUpdate({
    target: [chats.ownerUserId, chats.chatId],
    set: {
      total: sql`${chats.total} + 1`,
      incoming: sql`${chats.incoming} + ${row.incoming}`,
      deleted: sql`${chats.deleted} + ${row.deleted}`,
      edited: sql`${chats.edited} + ${row.edited}`,
      media: sql`${chats.media} + ${row.media}`,
      favorite: sql`${chats.favorite} + ${row.favorite}`,
      oneTime: sql`${chats.oneTime} + ${row.oneTime}`,
      name: m.chatName ? sql`case when ${newer} then ${m.chatName} else ${chats.name} end` : sql`${chats.name}`,
      ...(incoming ? {
        senderId: sql`case when ${newerIncoming} then ${m.senderId ?? null} else ${chats.senderId} end`,
        senderName: sql`case when ${newerIncoming} then ${m.senderName ?? null} else ${chats.senderName} end`,
        senderUsername: sql`case when ${newerIncoming} then ${m.senderUsername ?? null} else ${chats.senderUsername} end`,
        lastIncomingAt: sql`max(coalesce(${chats.lastIncomingAt}, 0), ${date})`,
      } : {}),
      firstAt: sql`min(coalesce(${chats.firstAt}, ${date}), ${date})`,
      lastAt: sql`max(coalesce(${chats.lastAt}, 0), ${date})`,
      ...(ev == null ? {} : { lastEventAt: sql`max(coalesce(${chats.lastEventAt}, 0), ${ev})` }),
      updatedAt: now,
    },
  });
}

/**
 * @param {number} ownerUserId @param {number} chatId @param {'deleted' | 'edited' | 'favorite'} field @param {number} n
 * @param {Date | number | null} [eventAt]
 */
export async function chatBump(ownerUserId, chatId, field, n, eventAt = null) {
  if (!n && eventAt == null) return;
  const col = chats[field];
  const ev = ms(eventAt);
  await db.update(chats).set({
    [field]: sql`max(0, ${col} + ${n})`,
    ...(ev == null ? {} : { lastEventAt: sql`max(coalesce(${chats.lastEventAt}, 0), ${ev})` }),
    updatedAt: new Date(),
  }).where(and(eq(chats.ownerUserId, ownerUserId), eq(chats.chatId, Number(chatId))));
}

/** @param {number} ownerUserId @param {number} chatId */
export async function getChat(ownerUserId, chatId) {
  return (await db.select().from(chats).where(and(eq(chats.ownerUserId, ownerUserId), eq(chats.chatId, chatId))).get()) ?? null;
}

/** @param {{ limit?: number, offset?: number }} [o] */
export async function chatsPage(ownerUserId, o = {}) {
  return db.select().from(chats).where(eq(chats.ownerUserId, ownerUserId))
    .orderBy(desc(chats.lastAt), desc(chats.chatId)).limit(Math.min(o.limit ?? 50, 200)).offset(o.offset ?? 0).all();
}

export const countChatRows = (ownerUserId) => db.$count(chats, eq(chats.ownerUserId, ownerUserId));

export async function chatTotals(ownerUserId) {
  const r = await db.select({
    chats: sql`count(*)`, total: sql`sum(${chats.total})`, deleted: sql`sum(${chats.deleted})`, edited: sql`sum(${chats.edited})`,
    favorite: sql`sum(${chats.favorite})`, media: sql`sum(${chats.media})`, incoming: sql`sum(${chats.incoming})`,
  }).from(chats).where(eq(chats.ownerUserId, ownerUserId)).get();
  return { chats: num(r?.chats), total: num(r?.total), deleted: num(r?.deleted), edited: num(r?.edited), favorite: num(r?.favorite), media: num(r?.media), incoming: num(r?.incoming) };
}

/** @param {number[]} ids */
export async function chatIdsOf(ownerUserId, ids) {
  const out = new Set();
  for (let i = 0; i < ids.length; i += 400) {
    const rows = await db.select({ chatId: messages.chatId }).from(messages)
      .where(and(eq(messages.ownerUserId, ownerUserId), inArray(messages.id, ids.slice(i, i + 400)))).groupBy(messages.chatId).all();
    for (const r of rows) out.add(Number(r.chatId));
  }
  return [...out];
}

/** @param {number} ownerUserId @param {number} chatId */
export async function deleteChatRow(ownerUserId, chatId) {
  await db.delete(chats).where(and(eq(chats.ownerUserId, ownerUserId), eq(chats.chatId, chatId)));
}

export async function deleteOwnerChats(ownerUserId) {
  await db.delete(chats).where(eq(chats.ownerUserId, ownerUserId));
}

// ── repo/daily: статистика по дням
// Запись — атомарные инкременты (col + n, json_set); только при settings.statsBuilt
const DAY = 86_400_000;
export const TYPE_GROUPS = ['text', 'photo', 'video', 'voice', 'audio', 'sticker', 'document', 'other'];
const zeros = (n) => Array(n).fill(0);

// Читаем из базы на каждую запись: кеш в изоляте мог бы пережить сборку в другом изоляте и терять инкременты.
async function ownerState(owner) {
  const s = await db.select({ tz: settings.timezone, built: settings.statsBuilt }).from(settings).where(eq(settings.ownerUserId, owner)).get();
  return { tz: s?.tz ?? 'UTC', built: !!s?.built };
}

const durOf = (r) => Number(/** @type {any} */ (r.mediaMeta)?.duration) || 0;
const isVoice = (t) => t === 'voice' || t === 'audio';
const isVideo = (t) => t === 'video' || t === 'video_note' || t === 'animation';
const ttdIndex = (delta) => TTD_BUCKETS.findIndex((b) => delta < b.max);

/**
 * @typedef {{ inc?: Record<string, number>, json?: Record<string, Record<string, number>> }} Delta
 * json: { hoursDeleted: { '$[3]': 1 }, byType: { '$.photo': 1 } }
 */

const INIT = { hoursDeleted: () => zeros(24), hoursEdited: () => zeros(24), ttd: () => zeros(TTD_BUCKETS.length), byType: () => ({}) };

/** @param {number} owner @param {string} day @param {number} chatId @param {Delta} d */
async function bump(owner, day, chatId, d) {
  const values = { ownerUserId: owner, day, chatId, updatedAt: new Date() };
  /** @type {Record<string, any>} */
  const set = { updatedAt: new Date() };
  for (const [col, n] of Object.entries(d.inc ?? {})) {
    if (!n) continue;
    values[col] = n;
    set[col] = sql`${dailyStats[col]} + ${n}`;
  }
  for (const [col, paths] of Object.entries(d.json ?? {})) {
    const init = INIT[col]();
    const entries = Object.entries(paths).filter(([, n]) => n);
    if (!entries.length) continue;
    for (const [p, n] of entries) {
      const m = /^\$\[(\d+)\]$/.exec(p);
      if (m) init[Number(m[1])] += n; else init[p.slice(2)] = (init[p.slice(2)] ?? 0) + n;
    }
    values[col] = init;
    const colRef = dailyStats[col];
    const base = sql`coalesce(${colRef}, ${JSON.stringify(INIT[col]())})`;
    // Вложенный sql — без sql.join: его может не быть в sdk платформы.
    const args = entries.map(([p, n]) => sql`${p}, coalesce(json_extract(${base}, ${p}), 0) + ${n}`)
      .reduce((acc, part) => sql`${acc}, ${part}`);
    set[col] = sql`json_set(${base}, ${args})`;
  }
  await db.insert(dailyStats).values(/** @type {any} */ (values))
    .onConflictDoUpdate({ target: [dailyStats.ownerUserId, dailyStats.day, dailyStats.chatId], set });
}

/** @returns {{ inc: Record<string, number>, json: Record<string, Record<string, number>> }} */
function capturedDelta(r) {
  const t = r.mediaType;
  const incoming = !r.isOutgoing;
  const g = typeGroup(t);
  return {
    inc: {
      captured: 1, incoming: incoming ? 1 : 0, media: t ? 1 : 0, oneTime: r.oneTime ? 1 : 0,
      voiceSec: isVoice(t) ? Math.round(durOf(r)) : 0, videoSec: isVideo(t) ? Math.round(durOf(r)) : 0,
      bytes: r.fileSize ? Number(r.fileSize) : 0, files: r.fileSize ? 1 : 0,
    },
    json: incoming ? { byType: { [`$.${g}`]: 1 } } : {},
  };
}

/** @param {any} row */
export async function onCaptured(row) {
  const s = await ownerState(Number(row.ownerUserId));
  if (!s.built) return;
  const c = localClock(s.tz)(ms(row.date) ?? Date.now());
  await bump(Number(row.ownerUserId), c.key, Number(row.chatId), capturedDelta(row));
}

/** @param {any[]} rows @param {Date} at */
export async function onDeleted(rows, at) {
  if (!rows.length) return;
  const owner = Number(rows[0].ownerUserId);
  const s = await ownerState(owner);
  if (!s.built) return;
  const clock = localClock(s.tz);
  const atMs = at.getTime();
  const del = clock(atMs);
  /** @type {Map<string, { day: string, chatId: number, inc: Record<string, number>, json: Record<string, Record<string, number>> }>} */
  const acc = new Map();
  const get = (day, chatId) => {
    const k = `${day}|${chatId}`;
    let v = acc.get(k);
    if (!v) { v = { day, chatId, inc: {}, json: {} }; acc.set(k, v); }
    return v;
  };
  const add = (o, k, n = 1) => { o[k] = (o[k] ?? 0) + n; };
  for (const r of rows) {
    const chatId = Number(r.chatId);
    const d = get(del.key, chatId);
    add(d.inc, 'deleted');
    if (r.fileId) { add(d.inc, 'deletedMedia'); if (r.mirrorStatus === 'done') add(d.inc, 'deletedMirrored'); }
    if (r.isOutgoing) continue;
    add(d.inc, 'inDeleted');
    d.json.hoursDeleted ??= {}; add(d.json.hoursDeleted, `$[${del.hour}]`);
    const sent = ms(r.date);
    if (sent != null && atMs >= sent) { d.json.ttd ??= {}; add(d.json.ttd, `$[${ttdIndex(atMs - sent)}]`); }
    const own = get(clock(sent ?? atMs).key, chatId);
    add(own.inc, 'inDeletedOfDay');
    own.json.byType ??= {}; add(own.json.byType, `$.${typeGroup(r.mediaType)}_d`);
  }
  for (const v of acc.values()) await bump(owner, v.day, v.chatId, v);
}

/** @param {any} row до правки @param {Date} at */
export async function onEdited(row, at) {
  const owner = Number(row.ownerUserId);
  const s = await ownerState(owner);
  if (!s.built) return;
  const c = localClock(s.tz)(at.getTime());
  const incoming = !row.isOutgoing;
  await bump(owner, c.key, Number(row.chatId), {
    inc: { edited: 1, inEdited: incoming ? 1 : 0, inEditedMsgs: incoming && (row.editCount ?? 0) === 0 ? 1 : 0 },
    json: incoming ? { hoursEdited: { [`$[${c.hour}]`]: 1 } } : {},
  });
}

/** @param {number} owner @param {number | null} [chatId] */
export async function deleteDaily(owner, chatId = null) {
  await db.delete(dailyStats).where(chatId == null ? eq(dailyStats.ownerUserId, owner) : and(eq(dailyStats.ownerUserId, owner), eq(dailyStats.chatId, chatId)));
}

/** Сколько сообщений владельца собираем за один запрос — больше отдаём оператору. */
export const BUILD_LIMIT = 60_000;
const PAGE = 5000;

/** Сборка, которая не сняла занятость (изолят упал), через столько минут перестаёт мешать. */
const BUILD_STALE_MS = 5 * 60_000;
const buildKey = (owner) => `daily_build:${owner}`;

/**
 * Атомарный захват сборки: без него stats и insights разом писали одни строки — UNIQUE constraint failed.
 */
async function claimBuild(owner, now = Date.now()) {
  const key = buildKey(owner);
  const inserted = await db.insert(appMeta).values({ key, value: String(now), updatedAt: new Date(now) }).onConflictDoNothing().returning();
  if (inserted.length) return true;
  const claimed = await db.update(appMeta).set({ value: String(now), updatedAt: new Date(now) })
    .where(and(eq(appMeta.key, key), sql`cast(${appMeta.value} as integer) < ${now - BUILD_STALE_MS}`)).returning();
  return claimed.length > 0;
}

/**
 * Пока идёт сборка, инкременты не пишутся (statsBuilt=false) — события учтёт сборка.
 * Если сборку ведёт другой вызов — built: false.
 * @returns {Promise<{ built: boolean, messages: number, busy?: boolean }>}
 */
export async function buildDaily(owner, opts = { force: false }) {
  const total = await db.$count(messages, eq(messages.ownerUserId, owner));
  if (total > BUILD_LIMIT && !opts.force) return { built: false, messages: total };
  if (!(await claimBuild(owner))) return { built: false, messages: total, busy: true };
  try {
    return await buildDailyClaimed(owner, total);
  } finally {
    await db.delete(appMeta).where(eq(appMeta.key, buildKey(owner)));
  }
}

/** @param {number} owner @param {number} total */
async function buildDailyClaimed(owner, total) {
  await db.update(settings).set({ statsBuilt: false }).where(eq(settings.ownerUserId, owner));
  const tz = (await ownerState(owner)).tz;
  const clock = localClock(tz);
  /** @type {Map<string, { day: string, chatId: number, inc: Record<string, number>, json: Record<string, any> }>} */
  const acc = new Map();
  const cell = (day, chatId) => {
    const k = `${day}|${chatId}`;
    let v = acc.get(k);
    if (!v) { v = { day, chatId, inc: {}, json: { hoursDeleted: zeros(24), hoursEdited: zeros(24), ttd: zeros(TTD_BUCKETS.length), byType: {} } }; acc.set(k, v); }
    return v;
  };
  const add = (o, k, n = 1) => { if (n) o[k] = (o[k] ?? 0) + n; };
  /** @type {Map<number, { chatId: number, isOutgoing: boolean }>} */
  const meta = new Map();

  for (let lastId = 0; ;) {
    const rows = await db.select({
      id: messages.id, chatId: messages.chatId, isOutgoing: messages.isOutgoing, date: messages.date, mediaType: messages.mediaType,
      oneTime: messages.oneTime, fileSize: messages.fileSize, fileId: messages.fileId, mediaMeta: messages.mediaMeta,
      isDeleted: messages.isDeleted, deletedAt: messages.deletedAt, mirrorStatus: messages.mirrorStatus,
    }).from(messages).where(and(eq(messages.ownerUserId, owner), sql`${messages.id} > ${lastId}`)).orderBy(messages.id).limit(PAGE).all();
    if (!rows.length) break;
    for (const r of rows) {
      const chatId = Number(r.chatId);
      meta.set(r.id, { chatId, isOutgoing: !!r.isOutgoing });
      const sent = ms(r.date) ?? 0;
      const own = cell(clock(sent).key, chatId);
      const d = capturedDelta(r);
      for (const [k, n] of Object.entries(d.inc)) add(own.inc, k, n);
      if (!r.isOutgoing) add(own.json.byType, typeGroup(r.mediaType));
      if (r.isDeleted) {
        const at = ms(r.deletedAt) ?? sent;
        const c = clock(at);
        const del = cell(c.key, chatId);
        add(del.inc, 'deleted');
        if (r.fileId) { add(del.inc, 'deletedMedia'); if (r.mirrorStatus === 'done') add(del.inc, 'deletedMirrored'); }
        if (!r.isOutgoing) {
          add(del.inc, 'inDeleted');
          del.json.hoursDeleted[c.hour]++;
          if (at >= sent) del.json.ttd[ttdIndex(at - sent)]++;
          add(own.inc, 'inDeletedOfDay');
          add(own.json.byType, `${typeGroup(r.mediaType)}_d`);
        }
      }
    }
    lastId = /** @type {any} */ (rows.at(-1)).id;
  }

  const seenMsg = new Set();
  for (let lastId = 0; ;) {
    const rows = await db.select({ id: edits.id, pk: edits.messagePk, at: edits.editedAt }).from(edits)
      .where(and(eq(edits.ownerUserId, owner), sql`${edits.id} > ${lastId}`)).orderBy(edits.id).limit(PAGE).all();
    if (!rows.length) break;
    for (const e of rows) {
      const m = meta.get(e.pk);
      if (!m) continue;
      const c = clock(ms(e.at) ?? 0);
      const v = cell(c.key, m.chatId);
      add(v.inc, 'edited');
      if (!m.isOutgoing) {
        add(v.inc, 'inEdited');
        v.json.hoursEdited[c.hour]++;
        if (!seenMsg.has(e.pk)) { seenMsg.add(e.pk); add(v.inc, 'inEditedMsgs'); }
      }
    }
    lastId = /** @type {any} */ (rows.at(-1)).id;
    if (rows.length < PAGE) break;
  }

  await deleteDaily(owner);
  const now = new Date();
  const rows = [...acc.values()].map((v) => ({ ownerUserId: owner, day: v.day, chatId: v.chatId, ...v.inc, ...v.json, updatedAt: now }));
  // Одна пачка — один INSERT с одинаковым набором колонок (недостающие счётчики — явным 0):
  // иначе на платформе «Run error». Параметров (строки × колонки) — не больше MAX_SQL_VARS.
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const full = rows.map((r) => Object.fromEntries(cols.map((c) => [c, /** @type {any} */ (r)[c] ?? 0])));
  const per = Math.max(1, Math.floor(MAX_SQL_VARS / Math.max(1, cols.length)));
  for (let i = 0; i < full.length; i += per) await db.insert(dailyStats).values(/** @type {any} */ (full.slice(i, i + per)));
  await db.update(settings).set({ statsBuilt: true }).where(eq(settings.ownerUserId, owner));
  return { built: true, messages: total };
}

/** @param {{ ownerUserId: number, statsBuilt?: boolean }} s @returns {Promise<boolean>} готова ли таблица */
export async function ensureDailyBuilt(s) {
  if (s.statsBuilt) return true;
  const r = await buildDaily(s.ownerUserId);
  if (r.built) s.statsBuilt = true;
  return r.built;
}

export function dayRange(from, to, tz) {
  const clock = localClock(tz);
  return { a: clock(from.getTime() + 1).key, b: clock(to.getTime() - 1).key };
}

const SUM = (col) => sql`coalesce(sum(${col}), 0)`;
const SCALARS = ['captured', 'incoming', 'media', 'oneTime', 'voiceSec', 'videoSec', 'bytes', 'files', 'inDeletedOfDay',
  'deleted', 'inDeleted', 'deletedMedia', 'deletedMirrored', 'edited', 'inEdited', 'inEditedMsgs'];
const jsonSums = (col, n, prefix) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`${prefix}${i}`, sql`coalesce(sum(json_extract(${dailyStats[col]}, ${`$[${i}]`})), 0)`]));
const typeSums = () => Object.fromEntries(TYPE_GROUPS.flatMap((g) => [
  [`t_${g}`, sql`coalesce(sum(json_extract(${dailyStats.byType}, ${`$.${g}`})), 0)`],
  [`t_${g}_d`, sql`coalesce(sum(json_extract(${dailyStats.byType}, ${`$.${g}_d`})), 0)`],
]));

/** @param {number} owner @param {{ a: string, b: string }} r @param {number | null} chatId */
function where(owner, r, chatId) {
  const c = [eq(dailyStats.ownerUserId, owner), gte(dailyStats.day, r.a), lte(dailyStats.day, r.b)];
  if (chatId != null) c.push(eq(dailyStats.chatId, chatId));
  return and(...c);
}

const numRow = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, k === 'day' ? v : Number(v ?? 0)]));

/** @param {number} owner @param {{ a: string, b: string }} r @param {number | null} [chatId] */
export async function byDay(owner, r, chatId = null) {
  const rows = await db.select({
    day: dailyStats.day, ...Object.fromEntries(SCALARS.map((k) => [k, SUM(dailyStats[k])])),
    ...jsonSums('hoursDeleted', 24, 'hd'), ...jsonSums('hoursEdited', 24, 'he'),
  }).from(dailyStats).where(where(owner, r, chatId)).groupBy(dailyStats.day).all();
  return rows.map(numRow);
}

/** @param {number} owner @param {{ a: string, b: string }} r @param {number | null} [chatId] */
export async function byChat(owner, r, chatId = null) {
  const rows = await db.select({ chatId: dailyStats.chatId, ...Object.fromEntries(SCALARS.map((k) => [k, SUM(dailyStats[k])])) })
    .from(dailyStats).where(where(owner, r, chatId)).groupBy(dailyStats.chatId).all();
  return rows.map(numRow);
}

/** @param {number} owner @param {{ a: string, b: string }} r @param {number | null} [chatId] */
export async function totals(owner, r, chatId = null) {
  const row = await db.select({ ...jsonSums('ttd', TTD_BUCKETS.length, 'b'), ...typeSums() }).from(dailyStats).where(where(owner, r, chatId)).get();
  return numRow(row ?? {});
}

/** @param {number} owner @param {{ a: string, b: string }} r @param {number | null} [chatId] */
export async function activeDays(owner, r, chatId = null) {
  return db.select({ chatId: dailyStats.chatId, day: dailyStats.day }).from(dailyStats)
    .where(and(where(owner, r, chatId), sql`${dailyStats.captured} > 0`)).all();
}

export { DAY };

// ── repo/stats: выборки статистики за период
// БД платформы не группирует по выражениям — раскладка в lib/insights.js
/** Потолок строк одной выборки: при большем объёме считаем по самым свежим и честно помечаем. */
export const MAX_ROWS = 60_000;
export const MAX_RANGE_DAYS = 366;
const IN_CHUNK = 400;
const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

/** @typedef {{ from: Date, to: Date, prevFrom: Date, prevTo: Date, days: number }} Range */

/** @param {{ days?: unknown, from?: unknown, to?: unknown }} input @param {string} tz @returns {Range} */
export function resolveRange(input, tz, now = new Date()) {
  const end = startOfDay(now, tz, -1);
  const f = ISO.exec(String(input.from ?? '')), t = ISO.exec(String(input.to ?? ''));
  let from, to;
  if (f && t) {
    from = midnightOf(Number(f[1]), Number(f[2]), Number(f[3]), tz);
    to = midnightOf(Number(t[1]), Number(t[2]), Number(t[3]) + 1, tz);
    if (to > end) to = end;
    if (!(to > from)) throw endpointError('err.badRange', null, 'BAD_RANGE');
    if (to.getTime() - from.getTime() > MAX_RANGE_DAYS * DAY) from = new Date(to.getTime() - MAX_RANGE_DAYS * DAY);
  } else {
    const n = Number(input.days);
    const days = Number.isInteger(n) && n >= 1 && n <= MAX_RANGE_DAYS ? n : 30;
    to = end;
    from = startOfDay(now, tz, days - 1);
  }
  const len = to.getTime() - from.getTime();
  return { from, to, prevFrom: new Date(from.getTime() - len), prevTo: from, days: Math.max(1, Math.round(len / DAY)) };
}

/** Ключи локальных дней периода (полдень каждого дня — устойчиво к переводу часов). */
export function dayKeys(from, days, clock) {
  return Array.from({ length: days }, (_, i) => clock(from.getTime() + i * DAY + DAY / 2).key);
}

/** @param {number} ownerUserId @param {number | null} chatId */
function scope(ownerUserId, chatId) {
  const c = [eq(messages.ownerUserId, ownerUserId)];
  if (chatId != null) c.push(eq(messages.chatId, chatId));
  return c;
}

/** @param {number} ownerUserId @param {{ from: Date, to: Date }} r @param {number | null} chatId */
/** @param {number} ownerUserId @param {{ from: Date, to: Date }} r @param {number | null} [chatId] */
export async function periodTimes(ownerUserId, r, chatId = null) {
  const [created, deleted, editRows] = await Promise.all([
    db.select({ t: messages.date }).from(messages)
      .where(and(...scope(ownerUserId, chatId), tsGte(messages.date, r.from), tsLt(messages.date, r.to))).all(),
    db.select({ t: messages.deletedAt, chatId: messages.chatId, chatName: messages.chatName }).from(messages)
      .where(and(...scope(ownerUserId, chatId), isSet(messages.isDeleted), tsGte(messages.deletedAt, r.from), tsLt(messages.deletedAt, r.to))).all(),
    db.select({ t: edits.editedAt, pk: edits.messagePk }).from(edits)
      .where(and(eq(edits.ownerUserId, ownerUserId), tsGte(edits.editedAt, r.from), tsLt(edits.editedAt, r.to))).all(),
  ]);
  let editsOf = editRows;
  if (chatId != null && editRows.length) {
    const pks = new Set((await db.select({ id: messages.id }).from(messages)
      .where(and(...scope(ownerUserId, chatId), positive(messages.editCount))).all()).map((x) => x.id));
    editsOf = editRows.filter((e) => pks.has(e.pk));
  }
  return {
    created: created.map((x) => ms(x.t)),
    deleted: deleted.map((x) => ({ t: ms(x.t), chatId: Number(x.chatId), chatName: x.chatName ?? null })),
    edited: editsOf.map((x) => ms(x.t)),
  };
}

/** @param {number} ownerUserId @param {{ from: Date, to: Date }} r @param {number | null} [chatId] @param {number} [cap] потолок строк */
export async function periodMessages(ownerUserId, r, chatId = null, cap = MAX_ROWS) {
  const rows = await db.select({
    id: messages.id, chatId: messages.chatId, chatName: messages.chatName, isOutgoing: messages.isOutgoing,
    date: messages.date, isDeleted: messages.isDeleted, editCount: messages.editCount,
    mediaType: messages.mediaType, fileSize: messages.fileSize, mediaMeta: messages.mediaMeta,
  }).from(messages)
    .where(and(...scope(ownerUserId, chatId), tsGte(messages.date, r.from), tsLt(messages.date, r.to)))
    .orderBy(desc(messages.date)).limit(cap + 1).all();
  return { rows: rows.slice(0, cap).map((x) => ({ ...x, chatId: Number(x.chatId), date: ms(x.date) })), truncated: rows.length > cap };
}

/** @param {number} ownerUserId @param {{ from: Date, to: Date }} r @param {number | null} [chatId] @param {number} [cap] потолок строк */
export async function periodDeleted(ownerUserId, r, chatId = null, cap = MAX_ROWS) {
  const rows = await db.select({
    id: messages.id, chatId: messages.chatId, chatName: messages.chatName, isOutgoing: messages.isOutgoing,
    date: messages.date, deletedAt: messages.deletedAt, mediaType: messages.mediaType,
    text: messages.text, caption: messages.caption, fileId: messages.fileId, mirrorStatus: messages.mirrorStatus,
  }).from(messages)
    .where(and(...scope(ownerUserId, chatId), isSet(messages.isDeleted), tsGte(messages.deletedAt, r.from), tsLt(messages.deletedAt, r.to)))
    .orderBy(desc(messages.deletedAt)).limit(cap + 1).all();
  return {
    rows: rows.slice(0, cap).map((x) => ({ ...x, chatId: Number(x.chatId), date: ms(x.date), deletedAt: ms(x.deletedAt) })),
    truncated: rows.length > cap,
  };
}

/** @param {number} ownerUserId @param {{ from: Date, to: Date }} r @param {number | null} [chatId] @param {number} [cap] потолок строк */
export async function periodEdits(ownerUserId, r, chatId = null, cap = MAX_ROWS) {
  const editRows = await db.select({ messagePk: edits.messagePk, editedAt: edits.editedAt }).from(edits)
    .where(and(eq(edits.ownerUserId, ownerUserId), tsGte(edits.editedAt, r.from), tsLt(edits.editedAt, r.to)))
    .orderBy(desc(edits.editedAt)).limit(cap).all();
  const pks = [...new Set(editRows.map((e) => e.messagePk))];
  /** @type {Map<number, any>} */
  const byPk = new Map();
  for (let i = 0; i < pks.length; i += IN_CHUNK) {
    const part = pks.slice(i, i + IN_CHUNK);
    const rows = await db.select({
      id: messages.id, chatId: messages.chatId, chatName: messages.chatName, isOutgoing: messages.isOutgoing,
      editCount: messages.editCount, text: messages.text, caption: messages.caption,
    }).from(messages).where(and(...scope(ownerUserId, chatId), inArray(messages.id, part))).all();
    for (const m of rows) byPk.set(m.id, { ...m, chatId: Number(m.chatId) });
  }
  const own = editRows.filter((e) => byPk.has(e.messagePk)).map((e) => ({ messagePk: e.messagePk, editedAt: ms(e.editedAt) }));
  return { edits: own, byPk };
}
