import { describe, it, expect, beforeEach } from "vitest";
import { useFreshDb, bizMessage } from "./helpers.js";
import { onNewMessage, onEdit, onDelete, onConnection } from "../tgcloud/lib/events.js";
import { apiMock } from "../sdk-shim/api.js";

import feed from "../tgcloud/endpoints/feed.js";
import event from "../tgcloud/endpoints/event.js";
import chats from "../tgcloud/endpoints/chats.js";
import chatHistory from "../tgcloud/endpoints/chatHistory.js";
import search from "../tgcloud/endpoints/search.js";
import stats from "../tgcloud/endpoints/stats.js";
import settings from "../tgcloud/endpoints/settings.js";
import action from "../tgcloud/endpoints/action.js";
import exportEp from "../tgcloud/endpoints/export.js";
import reply from "../tgcloud/endpoints/reply.js";
import contact from "../tgcloud/endpoints/contact.js";

const OWNER = 999;
const ctx = (id = OWNER) => ({ initData: { user: { id } } });

async function seed() {
  await onConnection({ id: "bc1", user_chat_id: OWNER, is_enabled: true, rights: { can_reply: true, can_read_messages: true } });
  await onNewMessage(bizMessage({ message_id: 1, chat: { id: 555, type: "private", first_name: "Иван" }, from: { id: 555, first_name: "Иван" }, text: "привет как дела" }), "bc1");
  await onNewMessage(bizMessage({ message_id: 2, chat: { id: 555, type: "private", first_name: "Иван" }, from: { id: 555, first_name: "Иван" }, text: "секретное слово" }), "bc1");
  await onNewMessage(bizMessage({ message_id: 3, chat: { id: 777, type: "private", first_name: "Мария" }, from: { id: 777, first_name: "Мария" }, text: "фото ниже", photo: [{ file_id: "p_s", file_unique_id: "u1", width: 320, height: 320 }, { file_id: "p_b", file_unique_id: "u2", width: 1280, height: 1280, file_size: 1000 }] }), "bc1");
  await onEdit(bizMessage({ message_id: 1, chat: { id: 555, type: "private", first_name: "Иван" }, from: { id: 555, first_name: "Иван" }, text: "привет как ты", edit_date: Math.floor(Date.now() / 1000) }), "bc1");
  await onDelete({ chat: { id: 555 }, message_ids: [2] }, "bc1");
}

describe("endpoints", () => {
  useFreshDb();
  beforeEach(seed);

  it("feed: events отдаёт удалённые и правки, фильтр deleted — только удалённые", async () => {
    const all = await feed({ kind: "events" }, ctx());
    expect(all.items.length).toBe(2);
    const del = await feed({ kind: "deleted" }, ctx());
    expect(del.items.every((i: any) => i.isDeleted)).toBe(true);
    expect(del.items.length).toBe(1);
  });

  it("feed: чужой владелец видит пусто (изоляция)", async () => {
    const other = await feed({ kind: "all" }, ctx(12345));
    expect(other.items).toHaveLength(0);
  });

  it("event: карточка правки содержит пословный дифф", async () => {
    const f = await feed({ kind: "edited" }, ctx());
    const id = f.items[0].id;
    const res = await event({ id }, ctx());
    expect(res.edits.length).toBe(1);
    const ops = res.edits[0].diff.map((d: any) => d.op);
    expect(ops).toContain("del");
    expect(ops).toContain("ins");
  });

  it("chats: два чата со счётчиками", async () => {
    const res = await chats({}, ctx());
    expect(res.total).toBe(2);
    const ivan = res.items.find((c: any) => c.chatId === 555);
    expect(ivan.deleted).toBe(1);
    expect(ivan.edited).toBe(1);
  });

  it("chatHistory: переписка по возрастанию даты + правки в сообщении", async () => {
    const res = await chatHistory({ chatId: 555 }, ctx());
    expect(res.items.length).toBe(2);
    expect(res.items[0].date).toBeLessThanOrEqual(res.items[1].date);
    const edited = res.items.find((i: any) => i.editCount > 0);
    expect(edited.edits.length).toBe(1);
  });

  it("chatHistory: чужой чат отклоняется", async () => {
    await expect(chatHistory({ chatId: 111 }, ctx())).rejects.toMatchObject({ parameters: { code: "NOT_FOUND" } });
  });

  it("search: по подстроке и имени", async () => {
    expect((await search({ q: "секрет" }, ctx())).total).toBe(1);
    expect((await search({ q: "мария" }, ctx())).total).toBe(1);
    expect((await search({ q: "как" }, ctx())).total).toBe(1);
  });

  it("stats: активность по дням и общие счётчики", async () => {
    const res = await stats({ days: 30 }, ctx());
    expect(res.totals.total).toBe(3);
    expect(res.totals.deleted).toBe(1);
    expect(res.activity.length).toBeGreaterThanOrEqual(1);
    expect(res.media.find((m: any) => m.type === "photo").count).toBe(1);
  });

  it("settings: обновление пояса, срока хранения и ключевых слов", async () => {
    const res = await settings({ timezone: "Europe/Moscow", retentionDays: 90, keywords: ["Деньги", "деньги", "Срочно"] }, ctx());
    expect(res.settings.timezone).toBe("Europe/Moscow");
    expect(res.settings.retentionDays).toBe(90);
    expect(res.settings.keywords).toEqual(["деньги", "срочно"]);
    await expect(settings({ timezone: "Nowhere/Nope" }, ctx())).rejects.toMatchObject({ parameters: { code: "BAD_TZ" } });
  });

  it("action: избранное, тишина, удаление события", async () => {
    const f = await feed({ kind: "deleted" }, ctx());
    const id = f.items[0].id;
    expect((await action({ type: "favorite", id }, ctx())).favorite).toBe(true);
    expect((await action({ type: "mute", chatId: 555 }, ctx())).muted).toBe(true);
    expect((await action({ type: "deleteEvent", id }, ctx())).deleted).toBe(true);
    await expect(event({ id }, ctx())).rejects.toMatchObject({ parameters: { code: "NOT_FOUND" } });
  });

  it("export: шлёт документ в личку владельца", async () => {
    const res = await exportEp({ format: "json", period: "all" }, ctx());
    expect(res.sent).toBe(true);
    const docs = apiMock.callsOf("sendDocument");
    expect(docs.length).toBe(1);
    expect(docs[0].chat_id).toBe(OWNER);
  });

  it("reply: отправляет сообщение через business_connection", async () => {
    const res = await reply({ chatId: 555, text: "ответ" }, ctx());
    expect(res.sent).toBe(true);
    const sends = apiMock.callsOf("sendMessage");
    expect(sends[0].business_connection_id).toBe("bc1");
    expect(sends[0].chat_id).toBe(555);
  });

  it("contact: профиль собеседника", async () => {
    const res = await contact({ chatId: 555 }, ctx());
    expect(res.total).toBe(2);
    expect(res.deleted).toBe(1);
    expect(res.names).toContain("Иван");
  });

  it("contact: id собеседника не подменяется своим, имена — от новых к старым", async () => {
    const t = Math.floor(Date.now() / 1000);
    await onNewMessage(bizMessage({ message_id: 10, date: t + 60, chat: { id: 555, type: "private", first_name: "Иван" }, from: { id: OWNER, first_name: "Я" }, text: "ответ" }), "bc1");
    await onNewMessage(bizMessage({ message_id: 11, date: t + 120, chat: { id: 555, type: "private", first_name: "Ваня" }, from: { id: 555, first_name: "Ваня" }, text: "сменил имя" }), "bc1");
    const res = await contact({ chatId: 555 }, ctx());
    expect(res.senderId).toBe(555);
    expect(res.names).toEqual(["Ваня", "Иван"]);
  });

  it("feed/event: подпись медиа отдаётся отдельно (caption)", async () => {
    await onNewMessage(bizMessage({ message_id: 12, chat: { id: 777, type: "private", first_name: "Мария" }, from: { id: 777, first_name: "Мария" }, text: undefined, caption: "смотри", photo: [{ file_id: "p2", file_unique_id: "u3", width: 640, height: 480 }] }), "bc1");
    const res = await chatHistory({ chatId: 777 }, ctx());
    const photo = res.items.find((i: any) => i.caption === "смотри");
    expect(photo?.text).toBeNull();
    expect(photo?.html).toContain("смотри");
  });
});

describe("chatHistory: фильтр переписки", () => {
  useFreshDb();
  beforeEach(seed);

  it("только удалённые / изменённые / с файлами, переход к дате в рамках фильтра", async () => {
    expect((await chatHistory({ chatId: 555, filter: "deleted" }, ctx())).items.map((i: any) => i.isDeleted)).toEqual([true]);
    expect((await chatHistory({ chatId: 555, filter: "edited" }, ctx())).items).toHaveLength(1);
    expect((await chatHistory({ chatId: 777, filter: "media" }, ctx())).items).toHaveLength(1);
    expect((await chatHistory({ chatId: 555, filter: "media" }, ctx())).items).toHaveLength(0);
    expect((await chatHistory({ chatId: 555, filter: "bogus" }, ctx())).items).toHaveLength(2);
    const j = await chatHistory({ chatId: 555, filter: "deleted", jumpTo: "сегодня" }, ctx());
    expect(j.jump).toBeTruthy();
  });

  it("поиск по одной переписке", async () => {
    expect((await search({ q: "привет", chatId: 555 }, ctx())).total).toBe(1);
    expect((await search({ q: "фото", chatId: 555 }, ctx())).total).toBe(0);
  });
});
