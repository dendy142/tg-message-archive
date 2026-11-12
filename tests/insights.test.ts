import { describe, it, expect, beforeEach } from "vitest";
import { useFreshDb, bizMessage } from "./helpers.js";
import { onNewMessage, onEdit, onDelete, onConnection } from "../tgcloud/lib/events.js";
import {
  heatmap, timeToDelete, deletionBursts, wipeChronicle, regretIndex, balance, topWords, records, median,
} from "../tgcloud/lib/insights.js";
import { localClock } from "../tgcloud/lib/util.js";
import { resolveRange } from "../tgcloud/lib/repo/chats.js";
import stats from "../tgcloud/endpoints/stats.js";
import insights from "../tgcloud/endpoints/insights.js";

const OWNER = 999;
const ctx = () => ({ initData: { user: { id: OWNER } } });
const H = 3_600_000;

describe("insights: чистые расчёты", () => {
  it("localClock: день недели, час и ключ дня в поясе пользователя", () => {
    const c = localClock("Asia/Tashkent");
    const t = Date.UTC(2026, 9, 26, 20, 30);
    expect(c(t)).toMatchObject({ key: "2026-10-27", weekday: 1, hour: 1 });
  });

  it("heatmap раскладывает по дням недели и часам", () => {
    const c = localClock("UTC");
    const g = heatmap([Date.UTC(2026, 9, 26, 10), Date.UTC(2026, 9, 26, 10, 59), null], c);
    expect(g[0][10]).toBe(2);
  });

  it("timeToDelete: медиана и корзины", () => {
    const r = timeToDelete([
      { date: 0, deletedAt: 5_000 }, { date: 0, deletedAt: 30_000 }, { date: 0, deletedAt: 2 * H }, { date: 10, deletedAt: 5 },
    ]);
    expect(r.total).toBe(3);
    expect(r.median).toBe(30_000);
    expect(r.buckets[0].count).toBe(1);
  });

  it("пачки удалений по чату и моменту; хроника — от порога", () => {
    const rows = Array.from({ length: 6 }, (_, i) => ({ id: 10 + i, chatId: 1, chatName: "А", deletedAt: 1000 }));
    rows.push({ id: 1, chatId: 2, chatName: "Б", deletedAt: 1000 });
    const b = deletionBursts(rows);
    expect(b.find((x) => x.chatId === 1)).toMatchObject({ count: 6, firstId: 10 });
    expect(wipeChronicle(b)).toHaveLength(1);
  });

  it("индекс сожаления — доля, а не абсолют, с порогом выборки", () => {
    const rows = [
      ...Array.from({ length: 10 }, (_, i) => ({ chatId: 1, isOutgoing: false, isDeleted: i < 1 })),  // 10%
      ...Array.from({ length: 20 }, (_, i) => ({ chatId: 2, isOutgoing: false, isDeleted: i < 10 })), // 50%
      ...Array.from({ length: 3 }, () => ({ chatId: 3, isOutgoing: false, isDeleted: true })),         // мало данных
    ];
    const r = regretIndex(rows);
    expect(r.map((x) => x.chatId)).toEqual([2, 1]);
    expect(r[0].share).toBe(0.5);
  });

  it("баланс и время ответа: смена стороны, длинные паузы не считаются", () => {
    const rows = [
      { id: 1, chatId: 1, isOutgoing: false, date: 0 },
      { id: 2, chatId: 1, isOutgoing: true, date: 60_000 },        // я ответил за минуту
      { id: 3, chatId: 1, isOutgoing: false, date: 120_000 },      // мне ответили за минуту
      { id: 4, chatId: 1, isOutgoing: true, date: 120_000 + 13 * H }, // пауза больше 12 ч — не ответ
    ];
    const b = balance(rows);
    expect(b.chats[0]).toMatchObject({ incoming: 2, outgoing: 2, myReply: 60_000, theirReply: 60_000 });
  });

  it("облако слов без стоп-слов и ссылок", () => {
    const w = topWords(["Пароль от вайфая", "пароль и логин https://x.y/z", "а пароль?"]);
    expect(w[0]).toEqual({ word: "пароль", count: 3 });
    expect(w.some((x) => x.word === "https")).toBe(false);
  });

  it("рекорды: самая длинная серия дней подряд", () => {
    const c = localClock("UTC");
    const day = (d: number) => Date.UTC(2026, 9, d, 12);
    const rows = [1, 2, 3, 5].map((d, i) => ({ id: i, chatId: 7, chatName: "Серия", date: day(d) }));
    const r = records(rows, [], [], c);
    expect(r.longestStreak).toMatchObject({ chatId: 7, days: 3, from: "2026-10-01", to: "2026-10-03" });
    expect(median([3, 1, 2])).toBe(2);
  });

  it("resolveRange: N дней включая сегодня и такой же прошлый период; свои даты", () => {
    const now = new Date(Date.UTC(2026, 9, 26, 12));
    const r = resolveRange({ days: 7 }, "UTC", now);
    expect(r.from.toISOString()).toBe("2026-10-20T00:00:00.000Z");
    expect(r.to.toISOString()).toBe("2026-10-27T00:00:00.000Z");
    expect(r.prevFrom.toISOString()).toBe("2026-10-13T00:00:00.000Z");
    const c = resolveRange({ from: "2026-10-01", to: "2026-10-10" }, "UTC", now);
    expect(c.days).toBe(10);
    expect(() => resolveRange({ from: "2026-10-10", to: "2026-10-01" }, "UTC", now)).toThrow();
  });
});

describe("insights: endpoints", () => {
  useFreshDb();
  beforeEach(async () => {
    await onConnection({ id: "bc1", user_chat_id: OWNER, is_enabled: true, rights: { can_reply: true } });
    const now = Math.floor(Date.now() / 1000);
    for (let i = 1; i <= 6; i++) {
      await onNewMessage(bizMessage({ message_id: i, date: now - 3600 + i, text: `секретный пароль номер ${i}` }), "bc1");
    }
    await onNewMessage(bizMessage({ message_id: 7, date: now - 1000, from: { id: OWNER, first_name: "Я" }, text: "мой ответ" }), "bc1");
    await onEdit(bizMessage({ message_id: 1, date: now - 3600 + 1, text: "исправленный пароль", edit_date: now }), "bc1");
    await onDelete({ chat: { id: 555 }, message_ids: [1, 2, 3, 4, 5, 6] }, "bc1");
  });

  it("stats: итоги периода и прошлого, дни без пропусков", async () => {
    const res = await stats({ days: 7 }, ctx());
    expect(res.activity).toHaveLength(7);
    expect(res.prevActivity).toHaveLength(7);
    expect(res.period).toMatchObject({ captured: 7, deleted: 6, edited: 1 });
    expect(res.prev).toMatchObject({ captured: 0, deleted: 0, edited: 0 });
    expect(res.topChats[0]).toMatchObject({ chatId: 555, deleted: 6 });
  });

  it("insights: пачка удалений, время до удаления, слова, баланс", async () => {
    const res = await insights({ days: 30 }, ctx());
    expect(res.wipes[0]).toMatchObject({ chatId: 555, count: 6 });
    expect(res.ttd.total).toBe(6);
    expect(res.words[0].word).toBe("пароль");
    expect(res.balance.chats[0]).toMatchObject({ chatId: 555, incoming: 6, outgoing: 1 });
    expect(res.editors[0]).toMatchObject({ chatId: 555, edits: 1 });
    expect(res.heatmap.deleted.flat().reduce((a: number, b: number) => a + b, 0)).toBe(6);
  });

  it("фильтр по чату: чужой чат — NOT_FOUND", async () => {
    await expect(insights({ chatId: 4242 }, ctx())).rejects.toMatchObject({ parameters: { code: "NOT_FOUND" } });
    const res = await stats({ days: 7, chatId: 555 }, ctx());
    expect(res.totals.total).toBe(7);
    expect(res.topChats).toEqual([]);
  });
});
