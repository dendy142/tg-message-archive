import { describe, it, expect, beforeEach } from "vitest";
import { useFreshDb, bizMessage } from "./helpers.js";
import { apiMock, BotApiError } from "../sdk-shim/api.js";
import { db } from "../sdk-shim/db.js";
import { onNewMessage, onEdit, onDelete, onConnection } from "../tgcloud/lib/events.js";
import { drainMirror } from "../tgcloud/lib/archive.js";
import { ALBUM_SETTLE_MS } from "../tgcloud/lib/media.js";
import { linkArchive, getTopic, saveTopic } from "../tgcloud/lib/archive.js";
import { getChat, buildAllChats } from "../tgcloud/lib/repo/chats.js";
import { chatPref, setChatPref, startBatch, openBatch, ensureSettings } from "../tgcloud/lib/repo/state.js";
import { enqueueOutbox } from "../tgcloud/lib/runtime.js";
import { buildDaily } from "../tgcloud/lib/repo/chats.js";
import { startMediaExport } from "../tgcloud/lib/jobs.js";
import * as msg from "../tgcloud/lib/repo/messages.js";
import { dailyStats, edits, jobs, outbox } from "../tgcloud/schema.js";
import action from "../tgcloud/endpoints/action.js";
import search from "../tgcloud/endpoints/search.js";
import chatsEp from "../tgcloud/endpoints/chats.js";
import contact from "../tgcloud/endpoints/contact.js";

const OWNER = 999;
const GROUP = -100500;
const IVAN = 555;
const MASHA = 777;
const ctx = (id = OWNER) => ({ initData: { user: { id } } });
const photo = (id: string) => [{ file_id: id, file_unique_id: `${id}_u`, width: 1280, height: 960, file_size: 100 }];
const ivan = (over: Record<string, any> = {}) => bizMessage({ chat: { id: IVAN, type: "private", first_name: "Иван" }, from: { id: IVAN, first_name: "Иван" }, ...over });
const masha = (over: Record<string, any> = {}) => bizMessage({ chat: { id: MASHA, type: "private", first_name: "Маша" }, from: { id: MASHA, first_name: "Маша" }, ...over });
const rowsOf = async (table: any) => db.select().from(table).all();

describe("удаление переписки целиком", () => {
  useFreshDb();
  beforeEach(async () => {
    await onConnection({ id: "bc1", user_chat_id: OWNER, is_enabled: true, rights: {} });
    await buildAllChats((await ensureSettings(OWNER)).ownerUserId);
    await linkArchive({ ownerUserId: OWNER, chatId: GROUP, title: "Архив" });
    await onNewMessage(ivan({ message_id: 1, text: "секретное слово" }), "bc1");
    await onEdit(ivan({ message_id: 1, text: "секретное слово!", edit_date: Math.floor(Date.now() / 1000) }), "bc1");
    await onNewMessage(ivan({ message_id: 2, text: "удалю потом" }), "bc1");
    await onDelete({ chat: { id: IVAN }, message_ids: [2] }, "bc1");
    await onNewMessage(ivan({ message_id: 4, text: undefined, photo: photo("p1") }), "bc1");
    await onNewMessage(masha({ message_id: 3, text: "секретное у Маши" }), "bc1");
    await drainMirror(OWNER, "UTC", new Date(Date.now() + ALBUM_SETTLE_MS + 1000));
    await setChatPref(OWNER, IVAN, { muted: true, excluded: true });
    await setChatPref(OWNER, MASHA, { muted: true });
    await buildDaily(OWNER, { force: true });
  });

  it("стирает сообщения, правки, поиск, статистику, флаги, пачки, очередь и задачи только этого чата", async () => {
    await startBatch({ ownerUserId: OWNER, chatId: IVAN, kind: "deleted", messageId: 1, count: 1 });
    await enqueueOutbox({ ownerUserId: OWNER, chatId: OWNER, payload: { html: "x", rebuild: { fn: "wipe", args: { owner: OWNER, chatId: IVAN } } }, nextAt: new Date() });
    await enqueueOutbox({ ownerUserId: OWNER, chatId: OWNER, payload: { html: "y", rebuild: { fn: "wipe", args: { owner: OWNER, chatId: MASHA } } }, nextAt: new Date() });
    await enqueueOutbox({ ownerUserId: OWNER, chatId: OWNER, payload: { html: "z" }, nextAt: new Date() });
    expect((await startMediaExport(OWNER, { chatId: IVAN })).job).toBeTruthy();

    const info = await action({ type: "chatDeleteCounts", chatId: IVAN }, ctx());
    expect(info).toMatchObject({ counts: { all: 3 }, archiveTopic: true });

    const r = await action({ type: "deleteChat", chatId: IVAN, confirm: "DELETE_CHAT" }, ctx());
    expect(r).toEqual({ removed: 3, archive: "none" });

    expect(await msg.findByKey("bc1", IVAN, 1)).toBeNull();
    expect(await getChat(OWNER, IVAN)).toBeNull();
    expect(await chatPref(OWNER, IVAN)).toBeNull();
    expect(await openBatch(OWNER, IVAN, "deleted")).toBeNull();
    expect(await rowsOf(edits)).toHaveLength(0);
    expect((await rowsOf(dailyStats)).every((d: any) => Number(d.chatId) !== IVAN)).toBe(true);
    expect(await rowsOf(jobs)).toHaveLength(0);
    expect((await rowsOf(outbox)).map((o: any) => o.payload.html).sort()).toEqual(["y", "z"]);
    const found = await search({ q: "секретное" }, ctx());
    expect(found.items.map((i: any) => i.chatId)).toEqual([MASHA]);
    await expect(contact({ chatId: IVAN }, ctx())).rejects.toMatchObject({ parameters: { code: "NOT_FOUND" } });
    expect(apiMock.callsOf("deleteForumTopic")).toHaveLength(0);
    expect(await getTopic(OWNER, IVAN)).toBeTruthy();

    expect(await msg.findByKey("bc1", MASHA, 3)).toBeTruthy();
    expect(await chatPref(OWNER, MASHA)).toMatchObject({ muted: true });
    const list = await chatsEp({}, ctx());
    expect(list.items.map((c: any) => c.chatId)).toEqual([MASHA]);
  });

  it("с копиями: удаляет тему собеседника в группе-архиве", async () => {
    await saveTopic({ ownerUserId: OWNER, chatId: IVAN, archiveChatId: GROUP, threadId: 42, name: "Иван" });
    const r = await action({ type: "deleteChat", chatId: IVAN, archive: true, confirm: "DELETE_CHAT" }, ctx());
    expect(r).toEqual({ removed: 3, archive: "deleted" });
    expect(apiMock.callsOf("deleteForumTopic")).toEqual([{ chat_id: GROUP, message_thread_id: 42 }]);
    expect(await getTopic(OWNER, IVAN)).toBeNull();
  });

  it("без права удалять в группе переписка всё равно удаляется, тема — остаётся (kept)", async () => {
    await saveTopic({ ownerUserId: OWNER, chatId: IVAN, archiveChatId: GROUP, threadId: 42, name: "Иван" });
    apiMock.on("deleteForumTopic", () => { throw new BotApiError("deleteForumTopic", 400, "Bad Request: not enough rights to delete a topic"); });
    const r = await action({ type: "deleteChat", chatId: IVAN, archive: true, confirm: "DELETE_CHAT" }, ctx());
    expect(r).toEqual({ removed: 3, archive: "kept" });
    expect(await msg.findByKey("bc1", IVAN, 1)).toBeNull();
    expect(await getTopic(OWNER, IVAN)).toBeNull();
  });

  it("тему уже удалили руками — считается удалённой; без темы — none", async () => {
    await saveTopic({ ownerUserId: OWNER, chatId: IVAN, archiveChatId: GROUP, threadId: 42, name: "Иван" });
    apiMock.on("deleteForumTopic", () => { throw new BotApiError("deleteForumTopic", 400, "Bad Request: TOPIC_ID_INVALID"); });
    expect((await action({ type: "deleteChat", chatId: IVAN, archive: true, confirm: "DELETE_CHAT" }, ctx())).archive).toBe("deleted");
    expect((await action({ type: "chatDeleteCounts", chatId: MASHA }, ctx())).archiveTopic).toBe(false);
    expect((await action({ type: "deleteChat", chatId: MASHA, archive: true, confirm: "DELETE_CHAT" }, ctx())).archive).toBe("none");
  });

  it("нужны подтверждение и свой чат; чужой владелец ничего не удалит", async () => {
    await expect(action({ type: "deleteChat", chatId: IVAN }, ctx())).rejects.toMatchObject({ parameters: { code: "CONFIRM_REQUIRED" } });
    await expect(action({ type: "deleteChat", chatId: IVAN, confirm: "DELETE_CHAT" }, ctx(12345))).rejects.toMatchObject({ parameters: { code: "NOT_FOUND" } });
    expect(await msg.findByKey("bc1", IVAN, 1)).toBeTruthy();
  });

  it("собеседник написал снова — переписка начинается с нуля и сохраняется (исключение снято)", async () => {
    await action({ type: "deleteChat", chatId: IVAN, confirm: "DELETE_CHAT" }, ctx());
    await onNewMessage(ivan({ message_id: 10, text: "я снова тут" }), "bc1");
    expect(await getChat(OWNER, IVAN)).toMatchObject({ total: 1, deleted: 0, edited: 0 });
    expect(await chatPref(OWNER, IVAN)).toBeNull();
  });
});
