import { describe, it, expect, beforeEach } from "vitest";
import { useFreshDb, bizMessage } from "./helpers.js";
import { onNewMessage, onEdit, onDelete, onConnection } from "../tgcloud/lib/events.js";
import { buildAllChats, chatsPage, getChat } from "../tgcloud/lib/repo/chats.js";
import { ensureSettings, updateSettings } from "../tgcloud/lib/repo/state.js";
import * as msg from "../tgcloud/lib/repo/messages.js";
import chatsEp from "../tgcloud/endpoints/chats.js";

const OWNER = 999;
const strip = (rows: any[]) => rows.map(({ updatedAt: _u, ...r }) => r).sort((a, b) => a.chatId - b.chatId);
async function expectConsistent() {
  const live = strip(await chatsPage(OWNER, { limit: 200 }));
  await buildAllChats(OWNER);
  expect(live).toEqual(strip(await chatsPage(OWNER, { limit: 200 })));
}
const ivan = (over: Record<string, any> = {}) => bizMessage({ chat: { id: 555, type: "private", first_name: "Иван" }, from: { id: 555, first_name: "Иван", username: "ivan" }, ...over });
const masha = (over: Record<string, any> = {}) => bizMessage({ chat: { id: 777, type: "private", first_name: "Маша" }, from: { id: 777, first_name: "Маша" }, ...over });

describe("chats: счётчики чатов", () => {
  useFreshDb();
  beforeEach(async () => {
    await onConnection({ id: "bc1", user_chat_id: OWNER, is_enabled: true, rights: {} });
    const s = await ensureSettings(OWNER);
    await buildAllChats(s.ownerUserId);
  });

  it("новые, удалённые, правки, избранное, медиа и свои сообщения", async () => {
    const t = Math.floor(Date.now() / 1000);
    await onNewMessage(ivan({ message_id: 1, date: t - 100, text: "раз" }), "bc1");
    await onNewMessage(ivan({ message_id: 2, date: t - 50, text: undefined, photo: [{ file_id: "p", file_unique_id: "u", width: 1, height: 1 }] }), "bc1");
    await onNewMessage(ivan({ message_id: 3, date: t - 10, from: { id: OWNER, first_name: "Я" }, text: "мой" }), "bc1");
    await onNewMessage(masha({ message_id: 4, date: t, text: "привет" }), "bc1");
    await onNewMessage(ivan({ message_id: 1, date: t - 100, text: "раз" }), "bc1");
    await onEdit(ivan({ message_id: 1, date: t - 100, text: "раз!", edit_date: t }), "bc1");
    await onEdit(ivan({ message_id: 1, date: t - 100, text: "раз!!", edit_date: t + 1 }), "bc1");
    await onDelete({ chat: { id: 555 }, message_ids: [2] }, "bc1");
    await msg.toggleFavorite(OWNER, (await msg.findByKey("bc1", 555, 1))!.id);
    const c = await getChat(OWNER, 555);
    expect(c).toMatchObject({ total: 3, incoming: 2, deleted: 1, edited: 1, media: 1, favorite: 1, name: "Иван", senderUsername: "ivan" });
    await expectConsistent();
  });

  it("удаление из архива и срок хранения пересчитывают чат, пустой чат исчезает", async () => {
    await onNewMessage(ivan({ message_id: 1, text: "a" }), "bc1");
    await onNewMessage(ivan({ message_id: 2, text: "b" }), "bc1");
    await onNewMessage(masha({ message_id: 3, text: "c" }), "bc1");
    await msg.deleteById(OWNER, (await msg.findByKey("bc1", 555, 1))!.id);
    expect((await getChat(OWNER, 555))?.total).toBe(1);
    await msg.deleteChatHistory(OWNER, 777, "all");
    expect(await getChat(OWNER, 777)).toBeNull();
    await expectConsistent();
    await msg.wipeOwnerArchive(OWNER);
    expect(await chatsPage(OWNER)).toHaveLength(0);
  });

  it("у владельца без собранной таблицы её строит первый запрос", async () => {
    await onNewMessage(ivan({ message_id: 1 }), "bc1");
    await onNewMessage(masha({ message_id: 2 }), "bc1");
    await updateSettings(OWNER, { chatsBuilt: false });
    const { db } = await import("../sdk-shim/db.js");
    const { chats } = await import("../tgcloud/schema.js");
    await db.delete(chats);
    const r = await chatsEp({}, { initData: { user: { id: OWNER } } });
    expect(r.total).toBe(2);
    expect((await ensureSettings(OWNER)).chatsBuilt).toBe(true);
  });
});
