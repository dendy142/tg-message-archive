// Расчёты статистики и ответы stats / insights
import { db } from 'sdk';
import { eq } from 'sdk/db';
import { BURST_DELETE_THRESHOLD, localClock, TTD_BUCKETS, typeGroup } from './util.js';
import { t } from './i18n.js';
import { chats } from '../schema.js';
import * as daily from './repo/chats.js';
import { dayKeys, periodMessages, periodDeleted, periodEdits, chatTotals, getChat } from './repo/chats.js';
import { mediaBreakdown } from './repo/messages.js';
import { mediaLabel } from './media.js';

// ── insights: чистые расчёты. БД платформы не группирует по выражениям — корзины считаем здесь
const toMs = (v) => (v == null ? null : v instanceof Date ? v.getTime() : Number(v));

/** @param {number[]} xs */
export function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

/** @param {(number | null)[]} times @param {ReturnType<typeof localClock>} clock */
export function heatmap(times, clock) {
  const grid = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (const t of times) {
    if (t == null) continue;
    const c = clock(t);
    grid[c.weekday][c.hour]++;
  }
  return grid;
}

export function nightShare(times, clock, from = 0, to = 6) {
  let night = 0, total = 0;
  for (const t of times) {
    if (t == null) continue;
    total++;
    const h = clock(t).hour;
    if (h >= from && h < to) night++;
  }
  return { night, total, share: total ? night / total : 0 };
}

/** @param {{ key: string }} b @param {any} [lang] */
export const ttdLabel = (b, lang = 'ru') => t(lang, `insights.ttd.${b.key}`);

/** @param {any[]} deleted @param {any} [lang] язык подписей корзин */
export function timeToDelete(deleted, lang = 'ru') {
  const deltas = [];
  for (const r of deleted) {
    const a = toMs(r.date), b = toMs(r.deletedAt);
    if (a == null || b == null || b < a) continue;
    deltas.push(b - a);
  }
  const buckets = TTD_BUCKETS.map((b) => ({ label: ttdLabel(b, lang), count: 0 }));
  for (const d of deltas) buckets[TTD_BUCKETS.findIndex((b) => d < b.max)].count++;
  return { median: median(deltas), total: deltas.length, buckets };
}

/**
 * Массовые удаления: одно событие deleted_business_messages помечает все строки одним
 * deletedAt, поэтому «пачка» = чат + одинаковый момент удаления.
 * @param {any[]} deleted
 */
export function deletionBursts(deleted) {
  const map = new Map();
  for (const r of deleted) {
    const at = toMs(r.deletedAt);
    if (at == null) continue;
    const k = `${r.chatId}:${at}`;
    const g = map.get(k);
    if (g) { g.count++; if (r.id < g.firstId) g.firstId = r.id; }
    else map.set(k, { chatId: Number(r.chatId), chatName: r.chatName ?? null, at, count: 1, firstId: r.id });
  }
  return [...map.values()];
}

export function wipeChronicle(bursts, min = BURST_DELETE_THRESHOLD, limit = 20) {
  return bursts.filter((b) => b.count >= min).sort((a, b) => b.at - a.at).slice(0, limit);
}

/** @param {any[]} rows сообщения периода */
export function regretIndex(rows, minIncoming = 10, limit = 8) {
  const by = new Map();
  for (const r of rows) {
    if (r.isOutgoing) continue;
    const c = by.get(r.chatId) ?? { chatId: Number(r.chatId), chatName: r.chatName ?? null, incoming: 0, deleted: 0 };
    c.incoming++;
    if (r.isDeleted) c.deleted++;
    if (r.chatName) c.chatName = r.chatName;
    by.set(r.chatId, c);
  }
  return [...by.values()]
    .filter((c) => c.incoming >= minIncoming && c.deleted > 0)
    .map((c) => ({ ...c, share: c.deleted / c.incoming }))
    .sort((a, b) => b.share - a.share || b.deleted - a.deleted)
    .slice(0, limit);
}

/** @param {any[]} editRows { messagePk } @param {Map<number, any>} msgByPk */
export function editorsAndRewritten(editRows, msgByPk, limit = 8) {
  const by = new Map();
  const perMsg = new Map();
  for (const e of editRows) {
    const m = msgByPk.get(e.messagePk);
    if (!m || m.isOutgoing) continue;
    perMsg.set(e.messagePk, (perMsg.get(e.messagePk) ?? 0) + 1);
    const c = by.get(m.chatId) ?? { chatId: Number(m.chatId), chatName: m.chatName ?? null, edits: 0, messages: new Set() };
    c.edits++;
    c.messages.add(e.messagePk);
    by.set(m.chatId, c);
  }
  const editors = [...by.values()]
    .map((c) => ({ chatId: c.chatId, chatName: c.chatName, edits: c.edits, messages: c.messages.size }))
    .sort((a, b) => b.edits - a.edits).slice(0, limit);
  const rewritten = [...perMsg.keys()].map((pk) => msgByPk.get(pk))
    .filter((m) => (m.editCount ?? 0) >= 2)
    .sort((a, b) => b.editCount - a.editCount)
    .slice(0, 5)
    .map((m) => ({ id: m.id, chatId: Number(m.chatId), chatName: m.chatName ?? null, editCount: m.editCount, text: String(m.text ?? m.caption ?? '').slice(0, 140) || null }));
  return { editors, rewritten };
}

/** Пауза дольше этого — уже не ответ, а новый разговор. */
export const REPLY_MAX_MS = 12 * 3_600_000;

/** @param {any[]} rows сообщения периода */
export function balance(rows, limit = 8) {
  const chats = new Map();
  for (const r of rows) {
    const list = chats.get(r.chatId) ?? [];
    list.push(r);
    chats.set(r.chatId, list);
  }
  const mine = [], theirs = [];
  const out = [];
  for (const [chatId, list] of chats) {
    list.sort((a, b) => (toMs(a.date) ?? 0) - (toMs(b.date) ?? 0) || a.id - b.id);
    let incoming = 0, outgoing = 0, chatName = null;
    const my = [], their = [];
    for (let i = 0; i < list.length; i++) {
      const r = list[i];
      if (r.isOutgoing) outgoing++; else incoming++;
      if (r.chatName) chatName = r.chatName;
      const p = list[i - 1];
      if (!p || !!p.isOutgoing === !!r.isOutgoing) continue;
      const d = (toMs(r.date) ?? 0) - (toMs(p.date) ?? 0);
      if (d < 0 || d > REPLY_MAX_MS) continue;
      (r.isOutgoing ? my : their).push(d);
    }
    mine.push(...my); theirs.push(...their);
    out.push({ chatId: Number(chatId), chatName, incoming, outgoing, myReply: median(my), theirReply: median(their) });
  }
  return {
    chats: out.sort((a, b) => (b.incoming + b.outgoing) - (a.incoming + a.outgoing)).slice(0, limit),
    myReply: median(mine),
    theirReply: median(theirs),
  };
}

const STOP = new Set(`
и в во не что он на я с со как а то все она так его но да ты к у же вы за бы по только ее её мне было вот от меня еще ещё нет о из ему
теперь когда даже ну вдруг ли если уже или ни быть был него до вас нибудь опять уж вам ведь там потом себя ничего ей может они тут где
есть надо ней для мы тебя их чем была сам чтоб без будто чего раз тоже себе под будет ж тогда кто этот того потому этого какой совсем
ним здесь этом один почти мой тем чтобы нее сейчас были куда зачем всех никогда можно при наконец два об другой хоть после над больше
тот через эти нас про всего них какая много разве три эту моя впрочем хорошо свою этой перед иногда лучше чуть том нельзя такой им
более всегда конечно всю между это эта эти тебе мне меня тоже просто очень вообще кстати типа короче блин ага угу ок окей ладно пока
привет спасибо пожалуйста да нет щас сейчас ещё уже будет буду будем бы был была было были мой твой наш ваш свой
the and for you that with this are was have not but what all were when your can said there use each which she how their will
other about out many then them these some her would make like him into time has look two more write see number way could people
`.split(/\s+/).filter(Boolean));

/** @param {(string | null)[]} texts */
export function topWords(texts, limit = 40) {
  const counts = new Map();
  for (const t of texts) {
    if (!t) continue;
    const words = t.toLowerCase().replace(/ё/g, 'е').replace(/https?:\/\/\S+/g, ' ').match(/\p{L}{3,}/gu) ?? [];
    for (const w of words) {
      if (STOP.has(w) || w.length > 24) continue;
      counts.set(w, (counts.get(w) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .filter(([, c]) => c > 1 || counts.size < 30)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([word, count]) => ({ word, count }));
}

/** @param {any[]} rows */
export function deletedByType(rows) {
  const by = new Map();
  for (const r of rows) {
    if (r.isOutgoing) continue;
    const g = typeGroup(r.mediaType);
    const c = by.get(g) ?? { type: g, total: 0, deleted: 0 };
    c.total++;
    if (r.isDeleted) c.deleted++;
    by.set(g, c);
  }
  return [...by.values()].sort((a, b) => b.total - a.total);
}

/**
 * @param {any[]} rows @param {any[]} deleted @param {ReturnType<typeof deletionBursts>} bursts
 * @param {ReturnType<typeof localClock>} clock
 */
export function records(rows, deleted, bursts, clock) {
  const perDay = new Map();
  const chatDays = new Map();
  for (const r of rows) {
    const t = toMs(r.date);
    if (t == null) continue;
    const c = clock(t);
    perDay.set(c.key, (perDay.get(c.key) ?? 0) + 1);
    const set = chatDays.get(r.chatId) ?? { chatName: r.chatName ?? null, days: new Map() };
    set.days.set(c.dayNo, c.key);
    if (r.chatName) set.chatName = r.chatName;
    chatDays.set(r.chatId, set);
  }
  let busiestDay = null;
  for (const [date, count] of perDay) if (!busiestDay || count > busiestDay.count) busiestDay = { date, count };

  let longestDeleted = null;
  for (const r of deleted) {
    const t = r.text ?? r.caption;
    if (!t || r.isOutgoing) continue;
    if (!longestDeleted || t.length > longestDeleted.length) {
      longestDeleted = { id: r.id, chatId: Number(r.chatId), chatName: r.chatName ?? null, length: t.length, preview: t.slice(0, 160) };
    }
  }

  let biggestBurst = null;
  for (const b of bursts) if (!biggestBurst || b.count > biggestBurst.count) biggestBurst = b;

  let longestStreak = null;
  for (const [chatId, { chatName, days }] of chatDays) {
    const nums = [...days.keys()].sort((a, b) => a - b);
    let run = 1, start = nums[0];
    for (let i = 1; i <= nums.length; i++) {
      if (i < nums.length && nums[i] === nums[i - 1] + 1) { run++; continue; }
      if (run > 1 && (!longestStreak || run > longestStreak.days)) {
        longestStreak = { chatId: Number(chatId), chatName, days: run, from: days.get(start), to: days.get(nums[i - 1]) };
      }
      run = 1; start = nums[i];
    }
  }
  return { busiestDay, longestDeleted, biggestBurst: biggestBurst && biggestBurst.count > 1 ? biggestBurst : null, longestStreak };
}

export function mediaTotals(rows, deleted) {
  let voiceSec = 0, videoSec = 0, bytes = 0, files = 0;
  for (const r of rows) {
    if (!r.mediaType) continue;
    const dur = Number(r.mediaMeta?.duration) || 0;
    if (r.mediaType === 'voice' || r.mediaType === 'audio') voiceSec += dur;
    if (r.mediaType === 'video' || r.mediaType === 'video_note' || r.mediaType === 'animation') videoSec += dur;
    if (r.fileSize) { bytes += Number(r.fileSize); files++; }
  }
  let savedMedia = 0, mirrored = 0;
  for (const r of deleted) {
    if (!r.fileId) continue;
    savedMedia++;
    if (r.mirrorStatus === 'done') mirrored++;
  }
  return { voiceSec, videoSec, bytes, files, savedMedia, mirrored };
}

export function bucketByDay(dayKeys, series, clock) {
  const idx = new Map(dayKeys.map((k, i) => [k, i]));
  const out = dayKeys.map((date) => ({ date, captured: 0, deleted: 0, edited: 0 }));
  for (const [name, times] of Object.entries(series)) {
    for (const t of times) {
      if (t == null) continue;
      const i = idx.get(clock(t).key);
      if (i !== undefined) out[i][name]++;
    }
  }
  return out;
}

// ── statsDaily: stats и insights из статистики по дням
export const ROW_CAP = 10_000;

async function chatNames(owner) {
  const rows = await db.select({ chatId: chats.chatId, name: chats.name }).from(chats).where(eq(chats.ownerUserId, owner)).all();
  return new Map(rows.map((r) => [Number(r.chatId), r.name ?? null]));
}

const sum = (rows, k) => rows.reduce((a, r) => a + (r[k] ?? 0), 0);
const weekdayOf = (key) => { const [y, m, d] = key.split('-').map(Number); return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7; };

/** @param {number} owner @param {string} tz @param {import('./repo/chats.js').Range} range @param {number | null} chatId @param {any} [lang] язык подписей типов медиа */
export async function statsFromDaily(owner, tz, range, chatId, lang = 'ru') {
  const clock = localClock(tz);
  const cur = daily.dayRange(range.from, range.to, tz);
  const prev = daily.dayRange(range.prevFrom, range.prevTo, tz);
  const [curDays, prevDays, perChat, names, media, totals] = await Promise.all([
    daily.byDay(owner, cur, chatId), daily.byDay(owner, prev, chatId),
    chatId == null ? daily.byChat(owner, cur) : Promise.resolve([]),
    chatNames(owner), mediaBreakdown(owner, chatId),
    chatId == null ? chatTotals(owner) : getChat(owner, chatId),
  ]);
  const series = (days, from) => {
    const at = new Map(days.map((d) => [d.day, d]));
    return dayKeys(from, range.days, clock).map((date) => ({ date, captured: at.get(date)?.captured ?? 0, deleted: at.get(date)?.deleted ?? 0, edited: at.get(date)?.edited ?? 0 }));
  };
  const sums = (days) => ({ captured: sum(days, 'captured'), deleted: sum(days, 'deleted'), edited: sum(days, 'edited') });
  /** @type {any} */
  const t = totals ?? {};
  return {
    totals: { total: t.total ?? 0, deleted: t.deleted ?? 0, edited: t.edited ?? 0, favorite: t.favorite ?? 0, media: t.media ?? 0, incoming: t.incoming ?? 0, chats: chatId == null ? t.chats ?? 0 : t.total ? 1 : 0 },
    period: sums(curDays),
    prev: sums(prevDays),
    activity: series(curDays, range.from),
    prevActivity: series(prevDays, range.prevFrom),
    topChats: perChat.filter((c) => c.deleted > 0).sort((a, b) => b.deleted - a.deleted).slice(0, 8)
      .map((c) => ({ chatId: Number(c.chatId), chatName: names.get(Number(c.chatId)) ?? null, deleted: c.deleted })),
    media: media.map((m) => ({ ...m, label: mediaLabel(m.type, lang) })),
    days: range.days,
    range: { from: range.from.getTime(), to: range.to.getTime(), prevFrom: range.prevFrom.getTime() },
    chatId,
  };
}

/** @param {number} owner @param {string} tz @param {import('./repo/chats.js').Range} range @param {number | null} chatId @param {any} [lang] язык подписей корзин */
export async function insightsFromDaily(owner, tz, range, chatId, lang = 'ru') {
  const r = daily.dayRange(range.from, range.to, tz);
  const [days, perChat, tot, active, names, msgs, del, ed] = await Promise.all([
    daily.byDay(owner, r, chatId), daily.byChat(owner, r, chatId), daily.totals(owner, r, chatId), daily.activeDays(owner, r, chatId),
    chatNames(owner),
    periodMessages(owner, range, chatId, ROW_CAP), periodDeleted(owner, range, chatId, ROW_CAP), periodEdits(owner, range, chatId, ROW_CAP),
  ]);
  const name = (id) => names.get(Number(id)) ?? null;

  const heat = (prefix) => {
    const grid = Array.from({ length: 7 }, () => Array(24).fill(0));
    for (const d of days) { const w = weekdayOf(d.day); for (let h = 0; h < 24; h++) grid[w][h] += d[`${prefix}${h}`] ?? 0; }
    return grid;
  };
  const deletedGrid = heat('hd');
  const nightCount = deletedGrid.reduce((a, row) => a + row.slice(0, 6).reduce((x, y) => x + y, 0), 0);
  const nightTotal = sum(days, 'inDeleted');

  const incomingDeleted = del.rows.filter((x) => !x.isOutgoing);
  const exact = timeToDelete(incomingDeleted, lang);
  const buckets = TTD_BUCKETS.map((b, i) => ({ label: ttdLabel(b, lang), count: tot[`b${i}`] ?? 0 }));
  const bursts = deletionBursts(del.rows);

  const regret = perChat.filter((c) => c.incoming >= (chatId == null ? 10 : 1) && c.inDeletedOfDay > 0)
    .map((c) => ({ chatId: Number(c.chatId), chatName: name(c.chatId), incoming: c.incoming, deleted: c.inDeletedOfDay, share: c.inDeletedOfDay / c.incoming }))
    .sort((a, b) => b.share - a.share || b.deleted - a.deleted).slice(0, 8);
  const editors = perChat.filter((c) => c.inEdited > 0)
    .map((c) => ({ chatId: Number(c.chatId), chatName: name(c.chatId), edits: c.inEdited, messages: c.inEditedMsgs }))
    .sort((a, b) => b.edits - a.edits).slice(0, 8);
  const { rewritten } = editorsAndRewritten(ed.edits, ed.byPk);

  const bal = balance(msgs.rows, 100);
  const counts = new Map(perChat.map((c) => [Number(c.chatId), c]));
  const balChats = [...counts.values()].map((c) => {
    const b = bal.chats.find((x) => x.chatId === Number(c.chatId));
    return { chatId: Number(c.chatId), chatName: name(c.chatId), incoming: c.incoming, outgoing: c.captured - c.incoming, myReply: b?.myReply ?? null, theirReply: b?.theirReply ?? null };
  }).filter((c) => c.incoming + c.outgoing > 0).sort((a, b) => (b.incoming + b.outgoing) - (a.incoming + a.outgoing)).slice(0, 8);

  const deletedByType = daily.TYPE_GROUPS.map((g) => ({ type: g, total: tot[`t_${g}`] ?? 0, deleted: tot[`t_${g}_d`] ?? 0 }))
    .filter((x) => x.total > 0).sort((a, b) => b.total - a.total);

  let busiestDay = null;
  for (const d of days) if (d.captured > 0 && (!busiestDay || d.captured > busiestDay.count)) busiestDay = { date: d.day, count: d.captured };
  const dayNo = (key) => { const [y, m, d] = key.split('-').map(Number); return Math.floor(Date.UTC(y, m - 1, d) / daily.DAY); };
  /** @type {Map<number, string[]>} */
  const perChatDays = new Map();
  for (const a of active) { const l = perChatDays.get(Number(a.chatId)) ?? []; l.push(String(a.day)); perChatDays.set(Number(a.chatId), l); }
  let longestStreak = null;
  for (const [cid, list] of perChatDays) {
    const ks = [...new Set(list)].sort();
    let run = 1, start = ks[0];
    for (let i = 1; i <= ks.length; i++) {
      if (i < ks.length && dayNo(ks[i]) === dayNo(ks[i - 1]) + 1) { run++; continue; }
      if (run > 1 && (!longestStreak || run > longestStreak.days)) longestStreak = { chatId: cid, chatName: name(cid), days: run, from: start, to: ks[i - 1] };
      run = 1; start = ks[i];
    }
  }
  let longestDeleted = null;
  for (const x of incomingDeleted) {
    const tx = x.text ?? x.caption;
    if (tx && (!longestDeleted || tx.length > longestDeleted.length)) longestDeleted = { id: x.id, chatId: Number(x.chatId), chatName: x.chatName ?? null, length: tx.length, preview: tx.slice(0, 160) };
  }
  let biggestBurst = null;
  for (const b of bursts) if (!biggestBurst || b.count > biggestBurst.count) biggestBurst = b;

  return {
    days: range.days,
    heatmap: { deleted: deletedGrid, edited: heat('he') },
    night: { night: nightCount, total: nightTotal, share: nightTotal ? nightCount / nightTotal : 0 },
    ttd: { median: exact.median ?? median([]), total: buckets.reduce((a, b) => a + b.count, 0), buckets },
    wipes: wipeChronicle(bursts),
    regret, editors, rewritten,
    balance: { chats: balChats, myReply: bal.myReply, theirReply: bal.theirReply },
    words: topWords(incomingDeleted.map((x) => x.text ?? x.caption)),
    deletedByType,
    records: { busiestDay, longestDeleted, biggestBurst: biggestBurst && biggestBurst.count > 1 ? biggestBurst : null, longestStreak },
    media: { voiceSec: sum(days, 'voiceSec'), videoSec: sum(days, 'videoSec'), bytes: sum(days, 'bytes'), files: sum(days, 'files'), savedMedia: sum(days, 'deletedMedia'), mirrored: sum(days, 'deletedMirrored') },
    truncated: msgs.truncated || del.truncated,
    source: 'daily',
  };
}
